/**
 * BaseSocketHandler — trackRoomEvent error handling, error classification and
 * event-data sanitization (BE-slices test-coverage plan, task 4).
 *
 * Exercises the REAL protected methods through a concrete test subclass; only
 * the socket and errorRecoveryService are mocked. Tests document EXISTING
 * behavior:
 * - `sanitizeEventData` redacts the keys password/token/secret/key/auth/apiKey
 *   CASE-INSENSITIVELY and at ANY depth (nested objects and arrays of
 *   objects), non-mutating, with the walk capped at depth 10.
 * - `classifyError` prefers message keywords (validation > rate limit >
 *   permission > session) before the join/leave eventName fallback, which
 *   itself beats the room/network message keywords.
 */

import type { Namespace, Socket } from 'socket.io';
import { createPartialMock } from '@/testing/mocks';
import {
  BackendErrorType,
  type BackendErrorContext,
  type BackendErrorRecoveryService
} from '../../resilience/BackendErrorRecoveryService';
import type { ConnectionHealthService } from '../../resilience/ConnectionHealthService';
import type { PerformanceMonitoringService } from '../../performance/PerformanceMonitoringService';
import { BaseSocketHandler } from '../BaseSocketHandler';

type RoomEventHandler<T> = (socket: Socket, data: T, namespace?: Namespace) => Promise<void> | void;

class TestBaseSocketHandler extends BaseSocketHandler {
  public readonly errorRecovery = createPartialMock<BackendErrorRecoveryService>({
    handleError: jest.fn()
  });

  constructor() {
    super();
    this.errorRecoveryService = this.errorRecovery;
  }

  public useErrorRecovery(recovery: BackendErrorRecoveryService): void {
    this.errorRecoveryService = recovery;
  }

  public wrap<T>(
    roomId: string,
    eventName: string,
    handler: RoomEventHandler<T>
  ): (socket: Socket, data: T) => Promise<void> {
    return super.trackRoomEvent(roomId, eventName, handler) as (socket: Socket, data: T) => Promise<void>;
  }

  public classify(message: string, eventName: string): BackendErrorType {
    return super.classifyError(new Error(message), eventName);
  }

  public isCritical(message: string): boolean {
    return super.isCriticalError(new Error(message));
  }

  public sanitize(data: unknown): unknown {
    return super.sanitizeEventData(data);
  }
}

const ROOM_ID = 'room-1';
const SOCKET_ID = 'sock-1';
const EVENT_NAME = 'test:event';

interface RecoveryCapture {
  context: BackendErrorContext | undefined;
  socket: Socket | undefined;
}

const makeSocket = (): Socket & { emit: jest.Mock } =>
  createPartialMock<Socket & { emit: jest.Mock }>({ id: SOCKET_ID, emit: jest.fn() });

// Fake errorRecoveryService that records what trackRoomEvent hands it, so
// assertions land on the REAL wrapper behavior (classified type, sanitized
// data, re-throw vs swallow) rather than on mock call shapes alone.
const buildHandler = (): { handler: TestBaseSocketHandler; capture: RecoveryCapture } => {
  const capture: RecoveryCapture = { context: undefined, socket: undefined };
  const handleError = jest.fn((context: BackendErrorContext, socket?: Socket) => {
    capture.context = context;
    capture.socket = socket;
    return Promise.resolve();
  });
  const handler = new TestBaseSocketHandler();
  handler.useErrorRecovery(createPartialMock<BackendErrorRecoveryService>({ handleError }));
  return { handler, capture };
};

describe('BaseSocketHandler — trackRoomEvent', () => {
  it('calls the wrapped handler with (socket, data, socket.nsp) and records performance on success', async () => {
    const recordRoomEvent = jest.fn();
    const recordRoomError = jest.fn();
    const handler = new TestBaseSocketHandler();
    handler.setPerformanceServices(
      createPartialMock<PerformanceMonitoringService>({ recordRoomEvent, recordRoomError }),
      createPartialMock<ConnectionHealthService>({})
    );
    const nsp = createPartialMock<Namespace>({});
    const socket = createPartialMock<Socket & { emit: jest.Mock }>({ id: SOCKET_ID, emit: jest.fn(), nsp });
    const payload = { note: 'hello' };
    const eventHandler = jest.fn((s: Socket, d: { note: string }, ns?: Namespace) => {
      expect(s).toBe(socket);
      expect(d).toBe(payload);
      expect(ns).toBe(nsp);
      return Promise.resolve();
    });
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(2000);

    await handler.wrap<{ note: string }>(ROOM_ID, EVENT_NAME, eventHandler)(socket, payload);

    expect(recordRoomEvent).toHaveBeenCalledWith(ROOM_ID, EVENT_NAME, 1000);
    expect(recordRoomError).not.toHaveBeenCalled();
    expect(handler.errorRecovery.handleError).not.toHaveBeenCalled();
  });

  it('forwards the classified error with SANITIZED event data to errorRecoveryService', async () => {
    const { handler, capture } = buildHandler();
    const socket = makeSocket();
    const payload = { token: 'abc123', password: 'hunter2', note: 'keep me' };
    // start=1000, duration call=2000, timestamp call=2000
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000).mockReturnValue(2000);

    const thrown = new Error('validation failed: token format');
    const wrapped = handler.wrap<typeof payload>(ROOM_ID, EVENT_NAME, () => {
      throw thrown;
    });
    await wrapped(socket, payload);

    expect(capture.context).toBeDefined();
    expect(capture.socket).toBe(socket);
    expect(capture.context).toMatchObject({
      errorType: BackendErrorType.ValidationError,
      message: `Error in ${EVENT_NAME}: validation failed: token format`,
      originalError: thrown,
      socketId: SOCKET_ID,
      roomId: ROOM_ID,
      namespace: `/room/${ROOM_ID}`,
      timestamp: 2000,
      additionalData: {
        eventName: EVENT_NAME,
        duration: 1000,
        data: {
          token: '[REDACTED]',
          password: '[REDACTED]',
          note: 'keep me'
        }
      }
    });
  });

  it('swallows non-critical errors (wrapper resolves normally after recovery handling)', async () => {
    const { handler, capture } = buildHandler();
    const socket = makeSocket();

    const wrapped = handler.wrap<Record<string, unknown>>(ROOM_ID, EVENT_NAME, () => {
      throw new Error('room state error');
    });

    await expect(wrapped(socket, {})).resolves.toBeUndefined();
    expect(capture.context?.errorType).toBe(BackendErrorType.RoomStateError);
    expect(capture.context?.message).toContain('room state error');
  });

  it('re-throws critical errors (out of memory) after still reporting them to errorRecoveryService', async () => {
    const { handler, capture } = buildHandler();
    const socket = makeSocket();

    const wrapped = handler.wrap<Record<string, unknown>>(ROOM_ID, EVENT_NAME, () => {
      throw new Error('out of memory');
    });

    await expect(wrapped(socket, {})).rejects.toThrow('out of memory');
    expect(capture.context).toBeDefined();
    expect(capture.context?.errorType).toBe(BackendErrorType.UnknownError);
    expect(capture.socket).toBe(socket);
  });

  it('records the room error through performanceMonitoring before re-throwing a critical error', async () => {
    const recordRoomError = jest.fn();
    const handler = new TestBaseSocketHandler();
    handler.setPerformanceServices(
      createPartialMock<PerformanceMonitoringService>({ recordRoomEvent: jest.fn(), recordRoomError }),
      createPartialMock<ConnectionHealthService>({})
    );
    const socket = makeSocket();
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000).mockReturnValue(2000);

    const wrapped = handler.wrap<Record<string, unknown>>(ROOM_ID, EVENT_NAME, () => {
      throw new Error('database connection lost');
    });

    await expect(wrapped(socket, {})).rejects.toThrow('database connection lost');
    expect(recordRoomError).toHaveBeenCalledWith(
      ROOM_ID,
      expect.any(Error),
      expect.objectContaining({ eventName: EVENT_NAME, socketId: SOCKET_ID, duration: 1000 })
    );
  });
});

describe('BaseSocketHandler — classifyError keyword mapping', () => {
  const mapping: Array<{ message: string; expected: BackendErrorType }> = [
    { message: 'validation failed', expected: BackendErrorType.ValidationError },
    { message: 'invalid request payload', expected: BackendErrorType.ValidationError },
    { message: 'rate limit exceeded', expected: BackendErrorType.RateLimitError },
    { message: 'too many requests', expected: BackendErrorType.RateLimitError },
    { message: 'permission denied', expected: BackendErrorType.PermissionError },
    { message: 'unauthorized access', expected: BackendErrorType.PermissionError },
    { message: 'session expired', expected: BackendErrorType.SessionManagementError },
    { message: 'room not found', expected: BackendErrorType.RoomStateError },
    { message: 'room state corrupted', expected: BackendErrorType.RoomStateError },
    { message: 'network timeout', expected: BackendErrorType.NetworkError },
    { message: 'connection lost', expected: BackendErrorType.NetworkError },
    { message: 'VALIDATION ERROR', expected: BackendErrorType.ValidationError }, // message is lowercased first
    { message: 'something unexpected', expected: BackendErrorType.UnknownError }
  ];

  it.each(mapping)('classifies "$message" as $expected', ({ message, expected }) => {
    expect(new TestBaseSocketHandler().classify(message, EVENT_NAME)).toBe(expected);
  });

  it('classifies join/leave events as session errors when the message has no earlier keyword', () => {
    const handler = new TestBaseSocketHandler();
    expect(handler.classify('something happened', 'room:join')).toBe(BackendErrorType.SessionManagementError);
    expect(handler.classify('something happened', 'room:leave')).toBe(BackendErrorType.SessionManagementError);
  });

  it('checks message keywords (validation/rate-limit/permission) before the join/leave eventName fallback', () => {
    const handler = new TestBaseSocketHandler();
    expect(handler.classify('permission denied', 'room:join')).toBe(BackendErrorType.PermissionError);
    expect(handler.classify('rate limit exceeded', 'room:join')).toBe(BackendErrorType.RateLimitError);
    expect(handler.classify('invalid payload', 'room:join')).toBe(BackendErrorType.ValidationError);
  });

  it('prefers the join/leave eventName fallback over the room/network message keywords', () => {
    const handler = new TestBaseSocketHandler();
    expect(handler.classify('network timeout', 'room:join')).toBe(BackendErrorType.SessionManagementError);
    expect(handler.classify('room state corrupted', 'room:leave')).toBe(BackendErrorType.SessionManagementError);
  });
});

describe('BaseSocketHandler — isCriticalError', () => {
  it.each(['out of memory', 'stack overflow', 'database connection lost', 'server shutting down'])(
    'treats "%s" as critical',
    (message: string) => {
      expect(new TestBaseSocketHandler().isCritical(message)).toBe(true);
    }
  );

  it('matches critical patterns case-insensitively', () => {
    const handler = new TestBaseSocketHandler();
    expect(handler.isCritical('OUT OF MEMORY')).toBe(true);
    expect(handler.isCritical('Database Connection Lost')).toBe(true);
  });

  it.each(['room state error', 'connection lost', 'network timeout', 'validation failed'])(
    'treats "%s" as non-critical',
    (message: string) => {
      expect(new TestBaseSocketHandler().isCritical(message)).toBe(false);
    }
  );
});

describe('BaseSocketHandler — sanitizeEventData', () => {
  it('redacts sensitive top-level keys (password/token/secret/key/auth)', () => {
    const result = new TestBaseSocketHandler().sanitize({ password: 'p', token: 't', secret: 's', key: 'k', auth: 'a' });
    expect(result).toEqual({
      password: '[REDACTED]',
      token: '[REDACTED]',
      secret: '[REDACTED]',
      key: '[REDACTED]',
      auth: '[REDACTED]'
    });
  });

  it('preserves non-sensitive keys and does not mutate the original payload', () => {
    const payload = { note: 'keep', token: 't' };
    const result = new TestBaseSocketHandler().sanitize(payload);
    expect(result).toEqual({ note: 'keep', token: '[REDACTED]' });
    expect(payload).toEqual({ note: 'keep', token: 't' });
  });

  it('passes null, undefined and non-object values through unchanged', () => {
    const handler = new TestBaseSocketHandler();
    expect(handler.sanitize(null)).toBeNull();
    expect(handler.sanitize(undefined)).toBeUndefined();
    expect(handler.sanitize('plain string')).toBe('plain string');
    expect(handler.sanitize(42)).toBe(42);
  });

  it('returns an empty object for an empty object', () => {
    expect(new TestBaseSocketHandler().sanitize({})).toEqual({});
  });

  it('redacts nested sensitive keys at any depth', () => {
    const result = new TestBaseSocketHandler().sanitize({
      nested: { token: 'inner', deeper: { secret: 'deep' } },
      keep: 'note'
    });
    expect(result).toEqual({
      nested: { token: '[REDACTED]', deeper: { secret: '[REDACTED]' } },
      keep: 'note'
    });
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    const result = new TestBaseSocketHandler().sanitize({
      items: [{ password: 'p1' }, { token: 't2' }, { note: 'keep' }]
    });
    expect(result).toEqual({
      items: [{ password: '[REDACTED]' }, { token: '[REDACTED]' }, { note: 'keep' }]
    });
  });

  it('matches sensitive keys case-insensitively (Password, PASSWORD, apiKey, API_KEY)', () => {
    const result = new TestBaseSocketHandler().sanitize({
      Password: 'mixed',
      PASSWORD: 'upper',
      apiKey: 'k',
      API_KEY: 'K',
      Auth: 'a',
      ToKeN: 't'
    });
    expect(result).toEqual({
      Password: '[REDACTED]',
      PASSWORD: '[REDACTED]',
      apiKey: '[REDACTED]',
      API_KEY: '[REDACTED]',
      Auth: '[REDACTED]',
      ToKeN: '[REDACTED]'
    });
  });

  it('does not mutate nested input (returns a sanitized copy at every level)', () => {
    const nested = { token: 'inner', note: 'keep' };
    const listItem = { password: 'p' };
    const payload = { nested, list: [listItem] };
    const result = new TestBaseSocketHandler().sanitize(payload);
    expect(result).toEqual({
      nested: { token: '[REDACTED]', note: 'keep' },
      list: [{ password: '[REDACTED]' }]
    });
    // Original payload untouched — object identity preserved.
    expect(payload).toEqual({ nested, list: [listItem] });
    expect(payload.nested).toBe(nested);
    expect(payload.list[0]).toBe(listItem);
  });

  it('redacts at the depth cap instead of passing nested objects through', () => {
    const handler = new TestBaseSocketHandler();

    // At the cap (depth 10) the walk stops and the whole subtree is redacted —
    // an adversarial payload must never bury a secret past the cap. The object
    // at depth 9 becomes { level: '[REDACTED]' }.
    let deep: unknown = { token: 'bottom-secret' };
    for (let i = 0; i < 10; i++) {
      deep = { level: deep };
    }
    let expected: unknown = { level: '[REDACTED]' };
    for (let i = 0; i < 9; i++) {
      expected = { level: expected };
    }
    expect(handler.sanitize(deep)).toEqual(expected);

    // Just inside the cap (depth 9) the token is still redacted.
    let near: unknown = { token: 'near-secret' };
    for (let i = 0; i < 9; i++) {
      near = { level: near };
    }
    let expectedNear: unknown = { token: '[REDACTED]' };
    for (let i = 0; i < 9; i++) {
      expectedNear = { level: expectedNear };
    }
    expect(handler.sanitize(near)).toEqual(expectedNear);
  });

  it('redacts compound sensitive keys (newAccessToken contains "token")', () => {
    const result = new TestBaseSocketHandler().sanitize({
      newAccessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c2VyLTEifQ.sig',
      note: 'keep me'
    });
    expect(result).toEqual({ newAccessToken: '[REDACTED]', note: 'keep me' });
  });

  it('redacts keys containing a sensitive word (author contains "auth")', () => {
    const result = new TestBaseSocketHandler().sanitize({ author: 'Alice' });
    expect(result).toEqual({ author: '[REDACTED]' });
  });

  it('defuses __proto__ keys without mutating prototypes', () => {
    // JSON.parse creates an OWN __proto__ data key (no setter invoked on parse).
    const evil = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    // sanitize returns unknown; the result is an object here, so the Record
    // view is safe (same cast as the `evil` line above).
    const result = new TestBaseSocketHandler().sanitize(evil) as Record<string, unknown>;
    // With the buggy `sanitized[key] = …` copy, the assignment invokes the
    // __proto__ setter: the key vanishes and the result's prototype becomes
    // { polluted: true }. Both assertions below are red on that behavior.
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toContain('__proto__');
    expect(result['__proto__']).toEqual({ polluted: true });
  });
});
