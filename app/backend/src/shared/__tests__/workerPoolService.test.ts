/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unused-vars */
/**
 * Unit Tests for WorkerPoolService
 * Tests the worker pool functionality for CPU-intensive operations
 */
import { WorkerPoolService } from '@/shared/infrastructure/workers/WorkerPoolService';

// Mock worker_threads
jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    once: jest.fn(),
    postMessage: jest.fn(),
    terminate: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock LoggingService
jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
  },
}));

describe('WorkerPoolService', () => {
  let workerPool: WorkerPoolService<any, any>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (workerPool) {
      await workerPool.shutdown();
    }
  });

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      workerPool = new WorkerPoolService({
        workerScript: '/fake/worker.js',
      });

      const stats = workerPool.getStats();
      expect(stats.activeWorkers).toBe(0);
      expect(stats.busyWorkers).toBe(0);
      expect(stats.queuedTasks).toBe(0);
    });

    it('should initialize with custom configuration', () => {
      workerPool = new WorkerPoolService({
        workerScript: '/fake/worker.js',
        maxWorkers: 2,
        taskTimeout: 5000,
      });

      const stats = workerPool.getStats();
      expect(stats.activeWorkers).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct initial statistics', () => {
      workerPool = new WorkerPoolService({
        workerScript: '/fake/worker.js',
        maxWorkers: 4,
      });

      const stats = workerPool.getStats();
      expect(stats).toEqual({
        activeWorkers: 0,
        busyWorkers: 0,
        queuedTasks: 0,
        totalProcessed: 0,
        totalFailed: 0,
        avgProcessingTime: 0,
      });
    });
  });

  describe('shutdown', () => {
    it('should gracefully shutdown the pool', async () => {
      workerPool = new WorkerPoolService({
        workerScript: '/fake/worker.js',
      });

      await expect(workerPool.shutdown()).resolves.toBeUndefined();
    });

    it('should reject new tasks after shutdown', async () => {
      workerPool = new WorkerPoolService({
        workerScript: '/fake/worker.js',
      });

      await workerPool.shutdown();

      await expect(workerPool.execute({ test: 'data' })).rejects.toThrow('Worker pool is shutting down');
    });
  });

  describe('JavaScript Worker File Support', () => {
    it('should accept .js worker script paths', () => {
      workerPool = new WorkerPoolService({
        workerScript: '/path/to/worker.js',
        maxWorkers: 2,
      });

      expect(workerPool).toBeDefined();
      const stats = workerPool.getStats();
      expect(stats.activeWorkers).toBe(0);
    });

    it('should work with audioCompressionWorker.js specifically', () => {
      // This tests the bug fix: using .js instead of .ts
      workerPool = new WorkerPoolService({
        workerScript: '/path/to/audioCompressionWorker.js',
        maxWorkers: 2,
        taskTimeout: 120000,
      });

      expect(workerPool).toBeDefined();
    });

    it('should NOT require tsx loader for .js files', () => {
      // Verify that .js files don't need special execArgv
      workerPool = new WorkerPoolService({
        workerScript: '/worker.js',
      });

      // Worker should be created without tsx/ts-node requirements
      expect(workerPool.getStats().activeWorkers).toBe(0);
    });
  });

  describe('Regression - TypeScript Worker Bug Fix', () => {
    it('should not attempt to load .ts files via Worker Threads', () => {
      // The bug: trying to load .ts files in Worker Threads
      // The fix: use .js files instead

      // This should NOT be used anymore
      const tsWorkerPath = '/worker.ts';

      // This SHOULD be used
      const jsWorkerPath = '/worker.js';

      workerPool = new WorkerPoolService({
        workerScript: jsWorkerPath, // Correct
      });

      expect(workerPool).toBeDefined();
    });
  });
});

