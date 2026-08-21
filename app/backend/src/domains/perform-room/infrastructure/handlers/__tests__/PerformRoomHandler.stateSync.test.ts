/**
 * DEV-350 final review M1 — `occupancy` must be present in the STATE_SYNC payload emitted by
 * `PerformRoomHandler.handleRequestState`, exactly as Arrange already does.
 *
 * A user joining a Perform room mid-session only ever learns the current presence/lock state
 * from this event. Without it they see no badges and locally believe every container is
 * unclaimed — they open the companion-settings / BPM / progression popup in editable mode and
 * are silently demoted to `holders[1]` when the server's JOINED broadcast lands.
 */
import type { Socket } from 'socket.io';
import { PERFORM_EVENTS } from '@jam-band/shared';
import type { ElementOccupancy } from '@jam-band/shared';
import type { Room, BandMember } from '@/types';
import type { NamespaceSession, RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { PerformRoomStateService } from '@/domains/perform-room/application/PerformRoomStateService';
import type { PerformRoomState } from '@/domains/perform-room/domain/models/PerformRoomState';
import { createPartialMock } from '@/testing/mocks';
import { PerformRoomHandler } from '../PerformRoomHandler';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

const ROOM_ID = 'room-1';
const USER_ID = 'user-1';
const USERNAME = 'tester';

function makeSession(): NamespaceSession {
  return createPartialMock<NamespaceSession>({
    roomId: ROOM_ID,
    userId: USER_ID,
    username: USERNAME,
    connectedAt: new Date(),
    lastActivity: new Date(),
  });
}

function makeRoom(): Room {
  return createPartialMock<Room>({
    roomType: 'perform' as Room['roomType'],
    bandMembers: new Map<string, BandMember>([
      [USER_ID, createPartialMock<BandMember>({ username: USERNAME })],
    ]),
    audiences: new Map(),
  });
}

function makeSocket(): Socket & { emit: jest.Mock } {
  return createPartialMock<Socket & { emit: jest.Mock }>({ id: 'sock-1', emit: jest.fn() });
}

function makeState(occupancy: Map<string, ElementOccupancy>): PerformRoomState {
  return createPartialMock<PerformRoomState>({
    roomId: ROOM_ID,
    userStates: new Map(),
    recordingStates: createPartialMock<PerformRoomState['recordingStates']>({}),
    broadcastStates: {},
    voiceStates: {},
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    companions: [],
    occupancy,
  });
}

function buildHandler(stateService: PerformRoomStateService): PerformRoomHandler {
  const roomSessionManager = createPartialMock<RoomSessionManager>({
    getRoomSession: jest.fn().mockReturnValue(makeSession()),
  });
  const roomLifecycleService = createPartialMock<RoomLifecycleService>({
    getRoom: jest.fn().mockResolvedValue(makeRoom()),
  });

  return new PerformRoomHandler(stateService, roomSessionManager, roomLifecycleService);
}

function emittedStateSync(socket: Socket & { emit: jest.Mock }): Record<string, unknown> {
  const call = socket.emit.mock.calls.find(([event]) => event === PERFORM_EVENTS.STATE_SYNC) as
    | [string, Record<string, unknown>]
    | undefined;
  expect(call).toBeDefined();
  return call![1];
}

describe('PerformRoomHandler.handleRequestState — occupancy in STATE_SYNC (DEV-350)', () => {
  it('serializes the occupancy Map into the payload for a late joiner', async () => {
    const holders = [{ userId: 'user-2', username: 'Bob', joinedAt: 10 }];
    const state = makeState(
      new Map<string, ElementOccupancy>([
        ['companion-settings:companion-1', { kind: 'container', holders }],
      ]),
    );
    const stateService = createPartialMock<PerformRoomStateService>({
      getState: jest.fn().mockResolvedValue(state),
    });
    const socket = makeSocket();

    await buildHandler(stateService).handleRequestState(socket, { roomId: ROOM_ID });

    expect(emittedStateSync(socket).occupancy).toEqual([
      { elementId: 'companion-settings:companion-1', kind: 'container', holders },
    ]);
  });

  it('sends an empty array (never undefined) when nothing is held', async () => {
    const stateService = createPartialMock<PerformRoomStateService>({
      getState: jest.fn().mockResolvedValue(makeState(new Map())),
    });
    const socket = makeSocket();

    await buildHandler(stateService).handleRequestState(socket, { roomId: ROOM_ID });

    expect(emittedStateSync(socket).occupancy).toEqual([]);
  });
});
