import type { Socket } from 'socket.io';
import type { Room, BandMember } from '@/types';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { BaseRoomStateService } from '@/shared/domain/room-state/BaseRoomStateService';
import type { BaseRoomState } from '@/shared/domain/room-state/BaseRoomState';
import type { NamespaceSession } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import { createPartialMock } from '@/testing/mocks';
import { BaseRoomHandler } from '../BaseRoomHandler';

/**
 * DEV-199: validateSession must only emit the "Room session unavailable — please rejoin" recovery
 * error when the room is genuinely GONE. When the room exists but is a different roomType than this
 * handler (e.g. a perform event reaching the perform handler in an arrange room), it must return
 * null SILENTLY — emitting there caused a spurious error/recovery loop in healthy rooms.
 */

// Minimal concrete subclass to exercise the protected validateSession.
class TestPerformHandler extends BaseRoomHandler<BaseRoomStateService<BaseRoomState>, BaseRoomState> {
  protected readonly roomType = 'perform' as const;
  protected readonly eventPrefix = 'perform';
  async handleRequestState(): Promise<void> {
    // no-op; not exercised by these tests
  }
  public validate(socket: Socket, roomId: string) {
    return this.validateSession(socket, roomId);
  }
}

const ROOM_ID = 'room-1';

const makeRoom = (roomType: 'perform' | 'arrange'): Room =>
  createPartialMock<Room>({
    roomType: roomType as Room['roomType'],
    bandMembers: new Map<string, BandMember>(),
    audiences: new Map(),
  });

const makeSocket = (): Socket & { emit: jest.Mock } =>
  createPartialMock<Socket & { emit: jest.Mock }>({ id: 'sock-1', emit: jest.fn() });

const build = (opts: { session: NamespaceSession | undefined; room: Room | null }) => {
  const getRoomSession = jest.fn().mockReturnValue(opts.session);
  const getRoom = jest.fn().mockResolvedValue(opts.room);
  const handler = new TestPerformHandler(
    createPartialMock<BaseRoomStateService<BaseRoomState>>({}),
    createPartialMock<RoomSessionManager>({ getRoomSession }),
    createPartialMock<RoomLifecycleService>({ getRoom }),
  );
  return { handler, getRoom };
};

const session = (roomId: string): NamespaceSession =>
  createPartialMock<NamespaceSession>({ roomId, userId: 'u1' });

describe('DEV-199 — BaseRoomHandler.validateSession recovery-error suppression', () => {
  it('does NOT emit "rejoin" when the room exists but is a different roomType (silent no-op)', async () => {
    const { handler } = build({ session: session(ROOM_ID), room: makeRoom('arrange') });
    const socket = makeSocket();

    const result = await handler.validate(socket, ROOM_ID);

    expect(result).toBeNull();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('DOES emit "rejoin" when the registered session\'s room is genuinely gone', async () => {
    const { handler } = build({ session: session(ROOM_ID), room: null });
    const socket = makeSocket();

    const result = await handler.validate(socket, ROOM_ID);

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.anything());
  });

  it('does NOT emit when there is no registered session at all', async () => {
    const { handler } = build({ session: undefined, room: null });
    const socket = makeSocket();

    const result = await handler.validate(socket, ROOM_ID);

    expect(result).toBeNull();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns the session when the room exists and the roomType matches', async () => {
    const { handler } = build({ session: session(ROOM_ID), room: makeRoom('perform') });
    const socket = makeSocket();

    const result = await handler.validate(socket, ROOM_ID);

    expect(result).toEqual(expect.objectContaining({ roomId: ROOM_ID, userId: 'u1' }));
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
