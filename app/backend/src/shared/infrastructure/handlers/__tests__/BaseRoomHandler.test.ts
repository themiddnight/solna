/**
 * BaseRoomHandler — session validation (DEV-199) and TR-10 ephemeral-commit
 * timer safety net (BE-slices test-coverage plan, task 5).
 *
 * Exercises the REAL protected methods through a concrete test subclass; only
 * RoomSessionManager / RoomLifecycleService / loggingService / the socket are
 * mocked. Tests document EXISTING behavior:
 * - `getSession` returns null SILENTLY when the registered session's room
 *   exists but has a different roomType than this handler (DEV-199: emitting a
 *   "rejoin" recovery error there caused a spurious error/recovery loop in
 *   healthy rooms). Only `validateSession` may emit the recovery error, and
 *   only when the socket's own room is genuinely GONE.
 * - `validateSessionWithRetry` re-queries after `delayMs`, resolving the
 *   request_state-before-join_room race without emitting anything.
 * - `scheduleEphemeralCommit` fires the commit handler after
 *   EPHEMERAL_COMMIT_TIMEOUT_MS and deletes the map entry; `clearEphemeralCommit`
 *   cancels the pending timer; `clearAllEphemeralCommitsForUser` only touches
 *   that user's keys (map isolation); a throwing commit handler is caught and
 *   logged, never unhandled.
 */

import type { Namespace, Socket } from 'socket.io';
import { EPHEMERAL_COMMIT_TIMEOUT_MS, SOCKET_ERROR_CODES, type SocketErrorCode } from '@jam-band/shared';
import type { Room, BandMember } from '@/types';
import type { NamespaceSession } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { RoomSessionManager } from '@/domains/room-management/infrastructure/services/RoomSessionManager';
import type { RoomLifecycleService } from '@/domains/room-management/application/RoomLifecycleService';
import type { BaseRoomStateService } from '@/shared/domain/room-state/BaseRoomStateService';
import type { BaseRoomState } from '@/shared/domain/room-state/BaseRoomState';
import { createPartialMock } from '@/testing/mocks';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import { BaseRoomHandler } from '../BaseRoomHandler';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() },
}));

type RoomSession = { roomId: string; userId: string; username: string };
type CommitHandler = () => Promise<void>;

// Minimal concrete subclass exposing the protected members under test.
// NOTE: BaseRoomHandler starts NO timers at construction — timers only begin on
// scheduleEphemeralCommit (called by subclasses on ephemeral events), so no
// NODE_ENV guard is needed in these tests.
class TestPerformHandler extends BaseRoomHandler<BaseRoomStateService<BaseRoomState>, BaseRoomState> {
  protected readonly roomType = 'perform' as const;
  protected readonly eventPrefix = 'perform';
  async handleRequestState(): Promise<void> {
    // no-op; not exercised by these tests
  }
  public session(socket: Socket): Promise<RoomSession | null> {
    return this.getSession(socket);
  }
  public validate(socket: Socket, roomId: string): Promise<RoomSession | null> {
    return this.validateSession(socket, roomId);
  }
  public validateRetry(socket: Socket, roomId: string, retries = 1, delayMs = 500): Promise<RoomSession | null> {
    return this.validateSessionWithRetry(socket, roomId, retries, delayMs);
  }
  public schedule(roomId: string, userId: string, fieldName: string, value: unknown, commitHandler: CommitHandler): void {
    this.scheduleEphemeralCommit(roomId, userId, fieldName, value, commitHandler);
  }
  public clear(roomId: string, userId: string, fieldName: string): void {
    this.clearEphemeralCommit(roomId, userId, fieldName);
  }
  public clearAllForUser(userId: string): void {
    this.clearAllEphemeralCommitsForUser(userId);
  }
  public clearAll(): void {
    this.clearAllEphemeralCommits();
  }
  public pendingCount(): number {
    return this.pendingEphemeralCommits.size;
  }
  public broadcastPublic(namespace: Namespace, roomId: string, event: string, data: unknown): void {
    this.broadcast(namespace, roomId, event, data);
  }
  public handleErrorPublic(socket: Socket, error: Error, context: string, roomId?: string, code?: SocketErrorCode): void {
    this.handleError(socket, error, context, roomId, code);
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

const session = (roomId: string, userId = 'u1'): NamespaceSession =>
  createPartialMock<NamespaceSession>({ roomId, userId });

const build = (overrides: {
  session?: NamespaceSession | undefined;
  room?: Room | null;
  getRoomSession?: jest.Mock;
  getRoom?: jest.Mock;
} = {}) => {
  const getRoomSession = overrides.getRoomSession ?? jest.fn().mockReturnValue(overrides.session);
  const getRoom = overrides.getRoom ?? jest.fn().mockResolvedValue(overrides.room ?? null);
  const handler = new TestPerformHandler(
    createPartialMock<BaseRoomStateService<BaseRoomState>>({}),
    createPartialMock<RoomSessionManager>({ getRoomSession }),
    createPartialMock<RoomLifecycleService>({ getRoom }),
  );
  return { handler, getRoomSession, getRoom };
};

describe('DEV-199 — BaseRoomHandler.getSession silent null on room-type mismatch', () => {
  it('returns null SILENTLY when the room exists but is a different roomType (no error emitted)', async () => {
    const { handler } = build({ session: session(ROOM_ID), room: makeRoom('arrange') });
    const socket = makeSocket();

    const result = await handler.session(socket);

    // DEV-199: an arrange-room event routed to this perform handler must be a
    // silent no-op — emitting "please rejoin" here produced a spurious
    // error/recovery loop in healthy rooms.
    expect(result).toBeNull();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns null when there is no registered session at all (no error emitted)', async () => {
    const { handler } = build({ session: undefined });
    const socket = makeSocket();

    const result = await handler.session(socket);

    expect(result).toBeNull();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns null and logs when the session\'s room is gone', async () => {
    const { handler, getRoom } = build({ session: session(ROOM_ID), room: null });
    const socket = makeSocket();

    const result = await handler.session(socket);

    expect(result).toBeNull();
    expect(getRoom).toHaveBeenCalledTimes(1);
    expect(loggingService.logError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'TestPerformHandler.getSession', roomId: ROOM_ID }),
    );
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns the session when the room exists and the roomType matches (username falls back to userId)', async () => {
    const { handler } = build({ session: session(ROOM_ID), room: makeRoom('perform') });
    const socket = makeSocket();

    const result = await handler.session(socket);

    expect(result).toEqual({ roomId: ROOM_ID, userId: 'u1', username: 'u1' });
  });
});

describe('BaseRoomHandler.validateSession recovery error', () => {
  it('emits "Room session unavailable" ONLY when the socket\'s own room is genuinely gone', async () => {
    const { handler } = build({ session: session(ROOM_ID), room: null });
    const socket = makeSocket();

    const result = await handler.validate(socket, ROOM_ID);

    expect(result).toBeNull();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'Room session unavailable — please rejoin the room' }),
    );
  });

  it('does NOT emit when the room exists but is a different roomType (DEV-199 silent no-op)', async () => {
    const { handler } = build({ session: session(ROOM_ID), room: makeRoom('arrange') });
    const socket = makeSocket();

    const result = await handler.validate(socket, ROOM_ID);

    expect(result).toBeNull();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit when the registered session belongs to a different room', async () => {
    const { handler } = build({ session: session('other-room'), room: makeRoom('perform') });
    const socket = makeSocket();

    const result = await handler.validate(socket, ROOM_ID);

    expect(result).toBeNull();
    expect(socket.emit).not.toHaveBeenCalled();
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

describe('BaseRoomHandler.validateSessionWithRetry (fake timers)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Async functions only schedule their setTimeout after the microtask hops that
  // lead to it; flush between advancing so fake timers see the pending timer.
  const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it('resolves without emitting when the first lookup misses but the retry succeeds (retry race)', async () => {
    const getRoomSession = jest
      .fn()
      .mockReturnValueOnce(undefined) // first getSession → null
      .mockReturnValueOnce(session(ROOM_ID)); // retry lookup succeeds
    const getRoom = jest.fn().mockResolvedValue(makeRoom('perform'));
    const { handler } = build({ getRoomSession, getRoom });
    const socket = makeSocket();

    const pending = handler.validateRetry(socket, ROOM_ID, 1, 500);
    await flushMicrotasks(); // let the retry loop reach its setTimeout (scheduling is microtask-gated)
    jest.advanceTimersByTime(500);
    await flushMicrotasks(); // run the retry continuation
    const result = await pending;

    expect(result).toEqual(expect.objectContaining({ roomId: ROOM_ID, userId: 'u1' }));
    expect(getRoomSession).toHaveBeenCalledTimes(2);
    expect(getRoom).toHaveBeenCalledTimes(1);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns the session immediately without waiting when the first lookup succeeds', async () => {
    const getRoomSession = jest.fn().mockReturnValue(session(ROOM_ID));
    const getRoom = jest.fn().mockResolvedValue(makeRoom('perform'));
    const { handler } = build({ getRoomSession, getRoom });
    const socket = makeSocket();

    const pending = handler.validateRetry(socket, ROOM_ID, 1, 500);
    jest.advanceTimersByTime(0); // no timer must be pending for the success path
    const result = await pending;

    expect(result).toEqual(expect.objectContaining({ roomId: ROOM_ID, userId: 'u1' }));
    expect(getRoomSession).toHaveBeenCalledTimes(1);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('returns null after retries are exhausted (no error emitted)', async () => {
    const getRoomSession = jest.fn().mockReturnValue(undefined);
    const { handler } = build({ getRoomSession });
    const socket = makeSocket();

    const pending = handler.validateRetry(socket, ROOM_ID, 2, 500);
    await flushMicrotasks(); // reach the first retry setTimeout
    jest.advanceTimersByTime(500); // fire retry 1
    await flushMicrotasks(); // retry 1 lookup (null) → schedule retry 2
    jest.advanceTimersByTime(500); // fire retry 2
    await flushMicrotasks(); // retry 2 lookup (null) → return null
    const result = await pending;

    expect(result).toBeNull();
    expect(getRoomSession).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe('BaseRoomHandler ephemeral commit timers (TR-10, fake timers)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Timer callbacks are async; fake-timer advancement invokes them synchronously
  // up to their first await, so the test flushes the continuation microtasks.
  const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it('fires the commit handler after EPHEMERAL_COMMIT_TIMEOUT_MS and removes the map entry', async () => {
    const commitHandler = jest.fn().mockResolvedValue(undefined);
    const { handler } = build();
    handler.schedule(ROOM_ID, 'u1', 'synthParams', { gain: 0.5 }, commitHandler);

    jest.advanceTimersByTime(EPHEMERAL_COMMIT_TIMEOUT_MS - 1);
    expect(commitHandler).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await flushMicrotasks();

    expect(commitHandler).toHaveBeenCalledTimes(1);
    expect(handler.pendingCount()).toBe(0); // entry cleaned up after firing
  });

  it('clearEphemeralCommit cancels the pending timer (no commit, entry removed)', async () => {
    const commitHandler = jest.fn();
    const { handler } = build();
    handler.schedule(ROOM_ID, 'u1', 'volume', 0.3, commitHandler);

    handler.clear(ROOM_ID, 'u1', 'volume');
    jest.advanceTimersByTime(EPHEMERAL_COMMIT_TIMEOUT_MS);
    await flushMicrotasks();

    expect(commitHandler).not.toHaveBeenCalled();
    expect(handler.pendingCount()).toBe(0);
  });

  it('clearEphemeralCommit with no pending entry is a no-op', () => {
    const { handler } = build();

    expect(() => handler.clear(ROOM_ID, 'u1', 'volume')).not.toThrow();
    expect(handler.pendingCount()).toBe(0);
  });

  it('rescheduling the same key replaces the previous timer (only the latest value commits)', async () => {
    const firstHandler = jest.fn();
    const secondHandler = jest.fn();
    const { handler } = build();
    handler.schedule(ROOM_ID, 'u1', 'regionDrag', 1, firstHandler);
    handler.schedule(ROOM_ID, 'u1', 'regionDrag', 2, secondHandler);

    jest.advanceTimersByTime(EPHEMERAL_COMMIT_TIMEOUT_MS);
    await flushMicrotasks();

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });

  it('clearAllEphemeralCommitsForUser only clears that user\'s timers (map isolation)', async () => {
    const userA = jest.fn();
    const userB = jest.fn();
    const { handler } = build();
    handler.schedule(ROOM_ID, 'u-a', 'volume', 0.1, userA);
    handler.schedule(ROOM_ID, 'u-b', 'volume', 0.2, userB);

    handler.clearAllForUser('u-a');
    jest.advanceTimersByTime(EPHEMERAL_COMMIT_TIMEOUT_MS);
    await flushMicrotasks();

    expect(userA).not.toHaveBeenCalled();
    expect(userB).toHaveBeenCalledTimes(1); // untouched user's timer still fires
    expect(handler.pendingCount()).toBe(0);
  });

  it('a throwing commit handler is caught and logged, not unhandled', async () => {
    const boom = new Error('commit failed');
    const commitHandler = jest.fn().mockRejectedValue(boom);
    const { handler } = build();
    handler.schedule(ROOM_ID, 'u1', 'synthParams', {}, commitHandler);

    jest.advanceTimersByTime(EPHEMERAL_COMMIT_TIMEOUT_MS);
    await flushMicrotasks();

    expect(commitHandler).toHaveBeenCalledTimes(1);
    expect(loggingService.logError).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({
        context: 'BaseRoomHandler.scheduleEphemeralCommit.timeout',
        roomId: ROOM_ID,
        userId: 'u1',
        fieldName: 'synthParams',
      }),
    );
    expect(loggingService.logInfo).not.toHaveBeenCalled();
    expect(handler.pendingCount()).toBe(0); // entry cleaned up even on failure
  });
});

describe('BaseRoomHandler broadcast + handleError', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Timer callbacks are async; fake-timer advancement invokes them synchronously
  // up to their first await, so the test flushes the continuation microtasks.
  const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it('broadcast emits the event-prefixed message to the room via namespace.to (TR-3)', () => {
    const emit = jest.fn();
    const namespace = createPartialMock<Namespace>({
      to: jest.fn().mockReturnValue({ emit }),
    });
    const { handler } = build();

    handler.broadcastPublic(namespace, ROOM_ID, 'volume_changed', { value: 0.5 });

    expect(namespace.to).toHaveBeenCalledWith(ROOM_ID);
    expect(emit).toHaveBeenCalledWith('perform:volume_changed', { value: 0.5 });
  });

  it('handleError logs and emits an error payload carrying the explicit code', () => {
    const socket = makeSocket();
    const { handler } = build();

    handler.handleErrorPublic(socket, new Error('boom'), 'TestPerformHandler.ctx', ROOM_ID, SOCKET_ERROR_CODES.OPERATION_FAILED);

    expect(loggingService.logError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'TestPerformHandler.ctx', roomId: ROOM_ID })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'boom', code: SOCKET_ERROR_CODES.OPERATION_FAILED })
    );
  });

  it('handleError without a code falls back to the generic message', () => {
    const socket = makeSocket();
    const { handler } = build();

    handler.handleErrorPublic(socket, new Error(''), 'TestPerformHandler.ctx');

    // Empty error message → generic fallback text (code is then inferred by
    // createSocketErrorPayload, so only the message is asserted here).
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'An error occurred' }));
  });

  it('clearAllEphemeralCommits cancels every pending timer', async () => {
    const commitA = jest.fn();
    const commitB = jest.fn();
    const { handler } = build();
    handler.schedule(ROOM_ID, 'u1', 'synthParams', 1, commitA);
    handler.schedule(ROOM_ID, 'u2', 'volume', 2, commitB);
    expect(handler.pendingCount()).toBe(2);

    handler.clearAll();
    jest.advanceTimersByTime(EPHEMERAL_COMMIT_TIMEOUT_MS);
    await flushMicrotasks();

    expect(commitA).not.toHaveBeenCalled();
    expect(commitB).not.toHaveBeenCalled();
    expect(handler.pendingCount()).toBe(0);
  });
});
