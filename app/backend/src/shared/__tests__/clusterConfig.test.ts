/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
/**
 * Unit Tests for Cluster Configuration
 * Tests the cluster module for multi-process scaling
 */

// Mock LoggingService before importing
jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('Cluster Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CLUSTER_ENABLED;
    delete process.env.REDIS_ENABLED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getClusterConfig', () => {
    it('should return disabled cluster config by default', () => {
      // Import fresh
      const { getClusterConfig } = require('@/config/cluster');
      const config = getClusterConfig();

      expect(config.enabled).toBe(false);
      expect(typeof config.workers).toBe('number');
      expect(config.workers).toBeGreaterThan(0);
      expect(config.restartOnCrash).toBe(true);
      expect(config.maxRestarts).toBe(10);
    });

    it('should enable clustering when CLUSTER_ENABLED is true', () => {
      process.env.CLUSTER_ENABLED = 'true';
      const { getClusterConfig } = require('@/config/cluster');
      const config = getClusterConfig();

      expect(config.enabled).toBe(true);
    });

    it('should use custom worker count when specified', () => {
      process.env.CLUSTER_WORKERS = '2';
      const { getClusterConfig } = require('@/config/cluster');
      const config = getClusterConfig();

      expect(config.workers).toBe(2);
    });

    it('should disable restart on crash when configured', () => {
      process.env.CLUSTER_RESTART_ON_CRASH = 'false';
      const { getClusterConfig } = require('@/config/cluster');
      const config = getClusterConfig();

      expect(config.restartOnCrash).toBe(false);
    });
  });

  describe('getWorkerId', () => {
    it('should return 0 when not in cluster mode', () => {
      const { getWorkerId } = require('@/config/cluster');
      expect(getWorkerId()).toBe(0);
    });
  });

  describe('isClusterWorker', () => {
    it('should return false when not a worker', () => {
      const { isClusterWorker } = require('@/config/cluster');
      expect(isClusterWorker()).toBe(false);
    });
  });
});
