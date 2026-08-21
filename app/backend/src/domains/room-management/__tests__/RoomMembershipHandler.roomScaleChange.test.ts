/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
/**
 * RoomMembershipHandler — handleRoomScaleChange Unit Tests (W2)
 *
 * Locks the owner-only guard (TR-33): only the room owner may change the
 * room scale. A non-owner emission must be rejected without mutating
 * room state or notifying anyone.
 *
 * Covers:
 *  - non-owner: handleRoomScaleChange returns false, room.roomScale is not
 *    mutated, and ROOM_SCALE_CHANGED is not emitted
 *  - owner: handleRoomScaleChange returns true, room.roomScale is updated,
 *    and ROOM_SCALE_CHANGED is emitted to the namespace
 */

import { RoomMembershipHandler } from '../infrastructure/handlers/RoomMembershipHandler';
import { redisStateService } from '@/shared/infrastructure/caching/RedisStateService';
import { buildRoomPayload } from '@/shared/utils/roomPayloadUtils';
import { PERFORM_EVENTS } from '@jam-band/shared';
import { RoomType } from '../../../types';

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('@/shared/infrastructure/caching/RedisStateService', () => ({
  RedisStateService: { getInstance: jest.fn() },
  redisStateService: {
    executeWithLock: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  },
}));

jest.mock('@/shared/utils/roomPayloadUtils', () => ({
  buildRoomPayload: jest.fn().mockResolvedValue({ room: {} }),
}));

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRoom(overrides: Partial<any> = {}): any {
  return {
    id: 'room-1',
    name: 'Test Room',
    owner: 'owner-1',
    bandMembers: new Map([
      ['owner-1', { id: 'owner-1', username: 'Owner', role: 'room_owner' }],
      ['member-2', { id: 'member-2', username: 'BandMember2', role: 'band_member' }],
    ]),
    audiences: new Map(),
    pendingMembers: new Map(),
    isPrivate: false,
    isHidden: false,
    createdAt: new Date(),
    roomType: RoomType.PERFORM,
    metronome: { bpm: 120, beatZeroAt: Date.now() },
    ...overrides,
  };
}

function makeSocket(overrides: Partial<any> = {}): any {
  return {
    id: 'socket-owner',
    emit: jest.fn(),
    ...overrides,
  };
}

function makeNamespace(sockets: Map<string, any> = new Map()): any {
  return {
    emit: jest.fn(),
    sockets,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RoomMembershipHandler — handleRoomScaleChange', () => {
  let handler: RoomMembershipHandler;
  let mockRoomMembershipService: any;
  let mockRoomLifecycleService: any;
  let mockRoomSessionManager: any;
  let mockIo: any;
  let mockNamespaceManager: any;

  beforeEach(() => {
    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _ttl: number, _timeout: number, fn: () => Promise<void>) => fn()
    );
    (buildRoomPayload as jest.Mock).mockResolvedValue({ room: {} });

    mockRoomMembershipService = {
      isRoomOwner: jest.fn(),
      findUserInRoom: jest.fn(),
      getBandMembers: jest.fn().mockResolvedValue([]),
      getAudiences: jest.fn().mockResolvedValue([]),
      getPendingMembers: jest.fn().mockResolvedValue([]),
    };

    mockRoomLifecycleService = {
      getRoom: jest.fn(),
      saveRoom: jest.fn().mockResolvedValue(undefined),
    };

    mockRoomSessionManager = {
      getRoomSession: jest.fn(),
      findSocketByUserIdAsync: jest.fn().mockResolvedValue(undefined),
    };

    mockIo = { sockets: { sockets: new Map() } };
    mockNamespaceManager = {};

    handler = new RoomMembershipHandler(
      mockRoomMembershipService,
      mockRoomLifecycleService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager
    );
  });

  it('rejects a non-owner emission: returns false, does not mutate roomScale, does not emit ROOM_SCALE_CHANGED', async () => {
    const session = { roomId: 'room-1', userId: 'member-2' };
    mockRoomSessionManager.getRoomSession.mockReturnValue(session);

    const room = makeRoom();
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    const socket = makeSocket({ id: 'socket-member-2' });
    const namespace = makeNamespace();

    const didChangeScale = await handler.handleRoomScaleChange(
      socket,
      { rootNote: 'C', scale: 'major' },
      namespace
    );

    expect(didChangeScale).toBe(false);
    expect(room.roomScale).toBeUndefined();
    expect(namespace.emit).not.toHaveBeenCalledWith(
      PERFORM_EVENTS.ROOM_SCALE_CHANGED,
      expect.anything()
    );
  });

  it('allows the room owner: returns true, updates roomScale, and emits ROOM_SCALE_CHANGED', async () => {
    const session = { roomId: 'room-1', userId: 'owner-1' };
    mockRoomSessionManager.getRoomSession.mockReturnValue(session);

    const room = makeRoom();
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    const socket = makeSocket({ id: 'socket-owner' });
    const namespace = makeNamespace();

    const didChangeScale = await handler.handleRoomScaleChange(
      socket,
      { rootNote: 'C', scale: 'major' },
      namespace
    );

    expect(didChangeScale).toBe(true);
    expect(room.roomScale).toEqual({ rootNote: 'C', scale: 'major' });
    expect(namespace.emit).toHaveBeenCalledWith(
      PERFORM_EVENTS.ROOM_SCALE_CHANGED,
      expect.objectContaining({ rootNote: 'C', scale: 'major', ownerId: 'owner-1' })
    );
  });

  it('persists the room scale via saveRoom so a later-joining member receives it', async () => {
    // Regression: previously handleRoomScaleChange mutated the room object
    // returned by getRoom() (a fresh clone) but never called saveRoom(), so the
    // roomScale was discarded. A member who joined AFTER the owner set the scale
    // read a Redis payload with no roomScale and fell back to their local scale.
    const session = { roomId: 'room-1', userId: 'owner-1' };
    mockRoomSessionManager.getRoomSession.mockReturnValue(session);

    const room = makeRoom();
    mockRoomLifecycleService.getRoom.mockResolvedValue(room);

    const socket = makeSocket({ id: 'socket-owner' });
    const namespace = makeNamespace();

    await handler.handleRoomScaleChange(
      socket,
      { rootNote: 'D', scale: 'minor' },
      namespace
    );

    expect(mockRoomLifecycleService.saveRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'room-1',
        roomScale: { rootNote: 'D', scale: 'minor' },
      })
    );
  });

  it('performs the read-modify-write under the per-room mutex (TR-2)', async () => {
    const session = { roomId: 'room-1', userId: 'owner-1' };
    mockRoomSessionManager.getRoomSession.mockReturnValue(session);
    mockRoomLifecycleService.getRoom.mockResolvedValue(makeRoom());

    await handler.handleRoomScaleChange(
      makeSocket({ id: 'socket-owner' }),
      { rootNote: 'C', scale: 'major' },
      makeNamespace()
    );

    expect(redisStateService.executeWithLock).toHaveBeenCalledWith(
      'room-state-mutex:room-1',
      expect.any(Number),
      expect.any(Number),
      expect.any(Function)
    );
  });
});
