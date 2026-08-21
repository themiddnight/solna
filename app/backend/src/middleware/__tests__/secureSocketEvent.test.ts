import type { NextFunction, Request, Response } from 'express';
import type { Socket } from 'socket.io';
import {
  PERFORM_EVENTS,
  SHARED_EVENTS,
  SOCKET_ERROR_CODES,
  chatMessageSchema,
} from '@jam-band/shared';
import { createPartialMock } from '@/testing/mocks';

// ─── scope note ───────────────────────────────────────────────────────────────
// This file covers ONLY the brief cases not already asserted elsewhere:
//   - generic 256 KB payload cap        → security.payloadSize.test.ts
//   - invalid-Zod rejection             → security.test.ts
//   - rate-limit denial wiring (mocked limiter) → security.test.ts
// The 1.5 MB BROADCAST_AUDIO_CHUNK cap, the threshold-driven RATE_LIMITED emit,
// the handler-throw UNKNOWN path, and the sanitizeInput skip list live here.
// ──────────────────────────────────────────────────────────────────────────────

// Redis-backed socket rate limiting: the wrapper runs the REAL
// `checkSocketRateLimitAsync` → `RedisRateLimiter.checkLimit` logic; only the
// Redis client underneath is stubbed (same pattern as rateLimit.test.ts). The
// real limiter never touches a real store in this file.
const mockRedisState = {
  incr: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
};

jest.mock('../../shared/infrastructure/caching/RedisStateService', () => ({
  RedisStateService: {
    getInstance: () => mockRedisState,
  },
}));

jest.mock('../../shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logSocketEvent: jest.fn(),
    logSecurityEvent: jest.fn(),
    logValidationFailure: jest.fn(),
    logError: jest.fn(),
    logRateLimitViolation: jest.fn(),
    logWarn: jest.fn(),
    logInfo: jest.fn(),
    logPerformanceMetric: jest.fn(),
  },
}));

jest.mock('../../shared/infrastructure/security/webrtcValidation', () => ({
  validateWebRTCRequest: jest.fn(() => ({ isValid: true })),
}));

// Imported AFTER the mocks: loading security.ts pulls in rateLimit.ts, whose
// RedisRateLimiter constructor calls RedisStateService.getInstance() — the mock
// above — at module evaluation time, so `mockRedisState` must already exist.
import { sanitizeInput, secureSocketEvent } from '../security';

const ROOM_UUID = '123e4567-e89b-42d3-a456-426614174000';

// The jest config (clearMocks/resetMocks) wipes implementations between tests,
// so (re)apply the happy-path Redis responses here: one in-budget increment.
beforeEach(() => {
  mockRedisState.incr.mockResolvedValue(1);
  mockRedisState.expire.mockResolvedValue(true);
  mockRedisState.ttl.mockResolvedValue(42);
});

const makeSocket = (): { socket: Socket; emit: jest.Mock } => {
  const emit = jest.fn();
  const socket = createPartialMock<Socket>({
    id: 's1',
    data: { userId: 'user-1' },
    emit,
    handshake: createPartialMock<Socket['handshake']>({ address: '127.0.0.1', headers: {} }),
  });
  return { socket, emit };
};

describe('secureSocketEvent — payload-size cap', () => {
  // MAX_MEDIA_EVENT_PAYLOAD_BYTES = 1_536 * 1024. JSON.stringify({ chunk }) adds
  // 12 wrapper chars (`{"chunk":"` + `"}`), so 10 extra chars land past the cap.
  it('rejects a BROADCAST_AUDIO_CHUNK payload just over the 1.5 MB media cap with INVALID_DATA_FORMAT', async () => {
    const handler = jest.fn();
    const { socket, emit } = makeSocket();
    const chunk = 'a'.repeat(1_536 * 1024 + 10);

    await secureSocketEvent(PERFORM_EVENTS.BROADCAST_AUDIO_CHUNK, null, handler)(socket, { chunk });

    expect(handler).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('error', expect.objectContaining({
      code: SOCKET_ERROR_CODES.INVALID_DATA_FORMAT,
    }));
  });

  it('passes a BROADCAST_AUDIO_CHUNK payload just under the 1.5 MB media cap', async () => {
    const handler = jest.fn();
    const { socket } = makeSocket();
    const chunk = 'a'.repeat(1_536 * 1024 - 100);

    await secureSocketEvent(PERFORM_EVENTS.BROADCAST_AUDIO_CHUNK, null, handler)(socket, { chunk });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('secureSocketEvent — rate limit (real limiter driven to threshold)', () => {
  // chat_message is capped at 30 events/min (socketRateLimits). The counting
  // Redis `incr` simulates the sliding-window counter returning 1..N, so the
  // 31st call crosses the threshold and retryAfter comes from the real ttl().
  it('emits RATE_LIMITED with retryAfter on the call past the threshold', async () => {
    const handler = jest.fn();
    const { socket, emit } = makeSocket();

    let count = 0;
    mockRedisState.incr.mockImplementation(async () => ++count);

    const wrapped = secureSocketEvent(SHARED_EVENTS.CHAT_MESSAGE, null, handler);

    for (let i = 0; i < 30; i++) {
      await wrapped(socket, { message: `m${i}` });
    }
    expect(handler).toHaveBeenCalledTimes(30);
    expect(emit).not.toHaveBeenCalled();

    await wrapped(socket, { message: 'overflow' });

    expect(mockRedisState.incr).toHaveBeenCalledTimes(31);
    expect(handler).toHaveBeenCalledTimes(30); // overflow never reaches the handler
    expect(emit).toHaveBeenCalledWith('error', expect.objectContaining({
      code: SOCKET_ERROR_CODES.RATE_LIMITED,
      message: 'Rate limit exceeded',
      retryAfter: 42, // surfaced from the limiter's ttl()
    }));
  });
});

describe('secureSocketEvent — Zod validation and handler errors', () => {
  it('runs the handler with the parsed payload and emits no error for valid data', async () => {
    const handler = jest.fn();
    const { socket, emit } = makeSocket();

    await secureSocketEvent(SHARED_EVENTS.CHAT_MESSAGE, chatMessageSchema, handler)(
      socket,
      { message: 'hello', roomId: ROOM_UUID, extraKey: 'stripped by zod' },
    );

    expect(handler).toHaveBeenCalledTimes(1);
    // Unknown keys are stripped by the real schema; the handler sees parsed data.
    expect(handler).toHaveBeenCalledWith(socket, { message: 'hello', roomId: ROOM_UUID });
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits the UNKNOWN error and does not crash when the handler throws', async () => {
    const { socket, emit } = makeSocket();
    const boom = jest.fn(async () => {
      throw new Error('handler exploded');
    });

    const wrapped = secureSocketEvent(SHARED_EVENTS.CHAT_MESSAGE, null, boom);

    // The wrapper must swallow the handler error — no rejection, no crash.
    await expect(wrapped(socket, { message: 'x' })).resolves.toBeUndefined();

    expect(boom).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('error', expect.objectContaining({
      code: SOCKET_ERROR_CODES.UNKNOWN,
      details: { eventName: SHARED_EVENTS.CHAT_MESSAGE },
    }));
  });
});

describe('sanitizeInput — XSS strip and sensitive-field skip list', () => {
  const next = jest.fn() as NextFunction;

  it('strips <script> tags, javascript: URLs, and on*= handlers from string fields', () => {
    const req = createPartialMock<Request>({
      body: {
        message: 'hello <script>alert(1)</script>world',
        url: 'javascript:alert(1)',
        note: 'img onload=alert(1) end',
      },
    });
    const res = createPartialMock<Response>({});

    sanitizeInput(req, res, next);

    expect(req.body).toEqual({
      message: 'hello world',
      url: 'alert(1)',
      note: 'img alert(1) end',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('recurses into nested objects and arrays', () => {
    const req = createPartialMock<Request>({
      body: {
        room: { name: '<script>evil</script>Room', tags: ['ok', 'javascript:x'] },
      },
    });
    const res = createPartialMock<Response>({});

    sanitizeInput(req, res, next);

    expect(req.body).toEqual({
      room: { name: 'Room', tags: ['ok', 'x'] },
    });
  });

  // Corruption bug class: trimming/stripping a credential or token makes a
  // stored password hash differ from what the user typed and lets two distinct
  // secrets collapse into one value. The skip list exists precisely so XSS
  // defense never mutates these fields — assertions below document that
  // `<script>`, `javascript:`, and `on*= ` content inside them is preserved.
  it('never mutates password/token/refreshToken fields, including nested ones', () => {
    const req = createPartialMock<Request>({
      body: {
        password: '<script>x</script>P@ssw0rd',
        token: 'javascript:abc.def.ghi',
        refreshToken: ' onload=refresh ',
        profile: { password: '<script>nested</script>pw' },
      },
    });
    const res = createPartialMock<Response>({});

    sanitizeInput(req, res, next);

    expect(req.body).toEqual({
      password: '<script>x</script>P@ssw0rd',
      token: 'javascript:abc.def.ghi',
      refreshToken: ' onload=refresh ',
      profile: { password: '<script>nested</script>pw' },
    });
  });
});

// Every domain shares one socket and one generic `error` channel, so a client
// cannot tell whose event failed from the code/message alone — the Arrange Room
// dropping a region looked identical to a voice-signaling failure and lit the
// voice mesh red. `context` names the rejected event so each domain can filter.
describe('secureSocketEvent — error attribution via context', () => {
  it('names the rejected event in context on a Zod validation failure', async () => {
    const handler = jest.fn();
    const { socket, emit } = makeSocket();

    await secureSocketEvent(SHARED_EVENTS.CHAT_MESSAGE, chatMessageSchema, handler)(socket, {});

    expect(handler).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('error', expect.objectContaining({
      code: SOCKET_ERROR_CODES.INVALID_DATA_FORMAT,
      context: SHARED_EVENTS.CHAT_MESSAGE,
    }));
  });

  it('names the rejected event in context on an oversized payload', async () => {
    const handler = jest.fn();
    const { socket, emit } = makeSocket();

    await secureSocketEvent(PERFORM_EVENTS.BROADCAST_AUDIO_CHUNK, null, handler)(socket, {
      chunk: 'a'.repeat(1_536 * 1024 + 10),
    });

    expect(emit).toHaveBeenCalledWith('error', expect.objectContaining({
      context: PERFORM_EVENTS.BROADCAST_AUDIO_CHUNK,
    }));
  });

  it('names the rejected event in context on a rate-limit denial', async () => {
    const handler = jest.fn();
    const { socket, emit } = makeSocket();

    let count = 0;
    mockRedisState.incr.mockImplementation(async () => ++count);
    const wrapped = secureSocketEvent(SHARED_EVENTS.CHAT_MESSAGE, null, handler);
    for (let i = 0; i < 31; i++) {
      await wrapped(socket, { message: `m${i}` });
    }

    expect(emit).toHaveBeenCalledWith('error', expect.objectContaining({
      code: SOCKET_ERROR_CODES.RATE_LIMITED,
      context: SHARED_EVENTS.CHAT_MESSAGE,
    }));
  });

  it('names the rejected event in context when the handler throws', async () => {
    const handler = jest.fn(() => {
      throw new Error('boom');
    });
    const { socket, emit } = makeSocket();

    await secureSocketEvent(SHARED_EVENTS.CHAT_MESSAGE, null, handler)(socket, { message: 'hi' });

    expect(emit).toHaveBeenCalledWith('error', expect.objectContaining({
      context: SHARED_EVENTS.CHAT_MESSAGE,
    }));
  });
});
