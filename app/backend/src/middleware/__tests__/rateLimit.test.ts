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
    logRateLimitViolation: jest.fn(),
    logSecurityEvent: jest.fn(),
    logWarn: jest.fn(),
    logPerformanceMetric: jest.fn(),
  },
}));

import { checkSocketRateLimitAsync } from '../rateLimit';
import type { Socket } from 'socket.io';
import { SHARED_EVENTS } from '@jam-band/shared';

describe('checkSocketRateLimitAsync', () => {
  const socket = {
    id: 'socket-1',
    data: { userId: 'user-1' },
    handshake: { address: '127.0.0.1', headers: {} },
  } as unknown as Socket;

  beforeEach(() => {
    jest.clearAllMocks();
void mockRedisState.expire.mockResolvedValue(true);
void mockRedisState.ttl.mockResolvedValue(60);
  });

  it('allows requests under the Redis-backed limit', async () => {
void mockRedisState.incr.mockResolvedValue(1);

    const result = await checkSocketRateLimitAsync(socket, SHARED_EVENTS.CHAT_MESSAGE);

    expect(result.allowed).toBe(true);
    expect(mockRedisState.expire).toHaveBeenCalledWith(expect.any(String), 60);
  });

  it('denies requests over the Redis-backed limit', async () => {
void mockRedisState.incr.mockResolvedValue(31);
void mockRedisState.ttl.mockResolvedValue(42);

    const result = await checkSocketRateLimitAsync(socket, SHARED_EVENTS.CHAT_MESSAGE);

    expect(result).toEqual({ allowed: false, retryAfter: 42, count: 31 });
  });

  it('allows gracefully when Redis limiter reports unavailable', async () => {
void mockRedisState.incr.mockResolvedValue(null);

    const result = await checkSocketRateLimitAsync(socket, SHARED_EVENTS.CHAT_MESSAGE);

    expect(result.allowed).toBe(true);
  });
});
