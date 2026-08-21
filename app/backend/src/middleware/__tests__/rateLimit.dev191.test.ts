import type { Socket } from 'socket.io';
import {
  ARRANGE_EVENTS,
  OCCUPANCY_EVENTS,
  arrangeMonitorShareNoteSchema,
  arrangeSaveLockRequestSchema,
} from '@jam-band/shared';
import { socketRateLimits, DEFAULT_SOCKET_RATE_LIMIT, checkSocketRateLimit } from '../rateLimit';
import { createPartialMock } from '@/testing/mocks';

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logError: jest.fn(),
    logRateLimitViolation: jest.fn(),
    logSecurityEvent: jest.fn(),
  },
}));

const socketWith = (userId: string, socketId = userId, ip = '127.0.0.1'): Socket =>
  createPartialMock<Socket>({
    id: socketId,
    data: { userId },
    handshake: createPartialMock<Socket['handshake']>({ address: ip }),
  });

// Pre-join socket: socket.data still holds the authenticated socket user (not yet reassigned to a
// room session), so socket.data.userId is absent and the key derives from socket.data.user.id.
const preJoinSocketWith = (userId: string, socketId = userId, ip = '127.0.0.1'): Socket =>
  createPartialMock<Socket>({
    id: socketId,
    data: { user: { id: userId } },
    handshake: createPartialMock<Socket['handshake']>({ address: ip }),
  });

const ROOM_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('DEV-191 — socket rate limiting', () => {
  it('configures the previously-unlimited arrange monitor-share + save-lock events', () => {
    expect(socketRateLimits[ARRANGE_EVENTS.MONITOR_SHARE_STATE]).toBeDefined();
    expect(socketRateLimits[ARRANGE_EVENTS.MONITOR_SHARE_NOTE]).toBeDefined();
    expect(socketRateLimits[ARRANGE_EVENTS.SAVE_LOCK_REQUEST]).toBeDefined();
    expect(socketRateLimits[ARRANGE_EVENTS.SAVE_LOCK_RELEASE]).toBeDefined();
  });

  it('bounds an event that has no explicit config via the default limit (never unlimited)', () => {
    const socket = socketWith('user-default-limit');
    const eventName = 'some_unconfigured_event_dev191';

    let isAllowed = true;
    for (let i = 0; i < DEFAULT_SOCKET_RATE_LIMIT.maxEvents; i++) {
      isAllowed = checkSocketRateLimit(socket, eventName).allowed;
    }
    // Every call up to the default ceiling is allowed...
    expect(isAllowed).toBe(true);
    // ...the one past it is blocked (previously this event would have been unlimited).
    expect(checkSocketRateLimit(socket, eventName).allowed).toBe(false);
  });

  it('keys on verified userId + IP, so reconnecting (new socket.id) cannot reset the budget', () => {
    const event = 'some_reconnect_event_dev191';
    // Same verified user + IP, but a different socket.id (as if reconnected).
    const before = socketWith('u-reconnect', 'sock-A', '9.9.9.9');
    const afterReconnect = socketWith('u-reconnect', 'sock-B', '9.9.9.9');

    for (let i = 0; i < DEFAULT_SOCKET_RATE_LIMIT.maxEvents; i++) {
      checkSocketRateLimit(before, event);
    }
    expect(checkSocketRateLimit(before, event).allowed).toBe(false);
    // The reconnected socket shares the userId+IP budget — still blocked (no reset).
    expect(checkSocketRateLimit(afterReconnect, event).allowed).toBe(false);
  });

  it('keys pre-join events on the authenticated socket user, not just IP (co-NAT users get their own budget)', () => {
    const event = 'some_prejoin_event_dev191';
    // Two distinct authenticated users behind the SAME IP, neither joined yet.
    const userA = preJoinSocketWith('pre-A', 'sock-A', '5.5.5.5');
    const userB = preJoinSocketWith('pre-B', 'sock-B', '5.5.5.5');

    // Exhaust user A's budget.
    for (let i = 0; i < DEFAULT_SOCKET_RATE_LIMIT.maxEvents; i++) {
      checkSocketRateLimit(userA, event);
    }
    expect(checkSocketRateLimit(userA, event).allowed).toBe(false);
    // User B (same IP, different verified user) is unaffected — not throttled by A.
    expect(checkSocketRateLimit(userB, event).allowed).toBe(true);
  });
});

describe('DEV-191 — arrange monitor-share/save-lock payload validation', () => {
  it('accepts a well-formed monitor-share note and rejects a malformed one', () => {
    expect(
      arrangeMonitorShareNoteSchema.safeParse({
        roomId: ROOM_UUID,
        userId: 'u',
        trackId: 't',
        noteData: { note: 60, velocity: 100, type: 'noteon' },
        timestamp: 1,
      }).success,
    ).toBe(true);

    // Bad roomId + out-of-range MIDI note are rejected.
    expect(
      arrangeMonitorShareNoteSchema.safeParse({
        roomId: 'not-a-uuid',
        userId: 'u',
        trackId: 't',
        noteData: { note: 999, velocity: 100, type: 'noteon' },
        timestamp: 1,
      }).success,
    ).toBe(false);
  });

  it('requires projectId on a save-lock request', () => {
    expect(arrangeSaveLockRequestSchema.safeParse({ roomId: ROOM_UUID, projectId: 'p' }).success).toBe(true);
    expect(arrangeSaveLockRequestSchema.safeParse({ roomId: ROOM_UUID }).success).toBe(false);
  });
});

describe('DEV-350 — occupancy events have an explicit socket budget', () => {
  // Without these entries the occupancy path falls through to DEFAULT_SOCKET_RATE_LIMIT
  // (6000/min) — a 50x loosening versus the 120/min lock events it replaced, on a path that
  // takes the room-wide Redis state mutex and rewrites full room state on every event.
  it.each([
    OCCUPANCY_EVENTS.JOIN,
    OCCUPANCY_EVENTS.LEAVE,
    OCCUPANCY_EVENTS.HEARTBEAT,
  ])('budgets %s at 120/min, not the 6000/min default', (eventName) => {
    const limit = socketRateLimits[eventName];
    expect(limit).toBeDefined();
    expect(limit?.maxEvents).toBe(120);
    expect(limit?.windowMs).toBe(60 * 1000);
    expect(limit?.maxEvents).toBeLessThan(DEFAULT_SOCKET_RATE_LIMIT.maxEvents);
  });

  it('actually blocks the 121st occupancy join inside the window', () => {
    const socket = socketWith('user-occupancy-flood');

    let isAllowed = true;
    for (let i = 0; i < 120; i++) {
      isAllowed = checkSocketRateLimit(socket, OCCUPANCY_EVENTS.JOIN).allowed;
    }
    expect(isAllowed).toBe(true);
    expect(checkSocketRateLimit(socket, OCCUPANCY_EVENTS.JOIN).allowed).toBe(false);
  });
});
