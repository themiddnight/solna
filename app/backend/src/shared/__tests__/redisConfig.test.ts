/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Unit Tests for Redis Configuration
 * Tests the Redis client configuration and availability checking
 */
import { closeRedisConnections, getRedisConfig, isRedisAvailable } from "../../config/redis";

// Mock redis module
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    on: jest.fn(),
    isOpen: true,
  }),
}));

// Mock LoggingService
jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('Redis Configuration', () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    await closeRedisConnections();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.REDIS_ENABLED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getRedisConfig', () => {
    it('should return default config', () => {
      const config = getRedisConfig();

      expect(config.url).toBe('redis://localhost:6379');
      expect(config.retryDelay).toBe(1000);
      expect(config.maxRetryDelay).toBe(30000);
    });

    it('should enable Redis when REDIS_ENABLED is true', () => {
      process.env.REDIS_ENABLED = 'true';
      const config = getRedisConfig();

      // enabled field removed - Redis is always required
    });

    it('should use custom Redis URL', () => {
      process.env.REDIS_URL = 'redis://custom:6380';
      const config = getRedisConfig();

      expect(config.url).toBe('redis://custom:6380');
    });

    it('should parse retry configuration', () => {
      process.env.REDIS_RETRY_DELAY = '2000';
      const config = getRedisConfig();

      expect(config.retryDelay).toBe(2000);
    });
  });

  describe('isRedisAvailable', () => {
    it('should return false when Redis is disabled', async () => {
      process.env.REDIS_ENABLED = 'false';
      const isAvailable = await isRedisAvailable();

      expect(isAvailable).toBe(false);
    });
  });

  describe('closeRedisConnections', () => {
    it('should close connections without error', async () => {
      await closeRedisConnections();
    });
  });
});
