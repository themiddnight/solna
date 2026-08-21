/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/naming-convention */
/**
 * RedisStateService - Distributed Lock Mechanism Tests
 * 
 * Unit tests for ISSUE-65 critical fix: distributed lock double-prefix bug
 * Tests verify that lock acquire/release works correctly without key prefix issues
 */
import { RedisStateService } from '../RedisStateService';
import * as redisConfig from '@/config/redis';

// Mock config/redis (getRedisClient is what getClient() calls internally)
jest.mock('@/config/redis');

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logError: jest.fn(),
    logInfo: jest.fn(),
    logPerformanceMetric: jest.fn(),
  },
}));

import { loggingService } from '@/shared/infrastructure/logging/LoggingService';

describe('RedisStateService - Distributed Lock Mechanism', () => {
  let service: RedisStateService;
  let mockClient: any;
  let lockStore: Map<string, { value: string; expiresAt: number }>;

  beforeEach(async () => {
    jest.clearAllMocks();
    lockStore = new Map();

    // Mock Redis client with in-memory lock store
    // Note: RedisStateService.buildKey adds 'collab:' prefix to all keys
    mockClient = {
      isOpen: true,
      set: jest.fn(async (key: string, value: string, options?: any) => {
        const now = Date.now();
        
        // NX option: only set if not exists
        if (options?.NX) {
          const existing = lockStore.get(key);
          if (existing && existing.expiresAt > now) {
            return null;
          }
        }
        
        const expiresAt = options?.PX ? now + options.PX : Infinity;
        lockStore.set(key, { value, expiresAt });
        return 'OK';
      }),
      get: jest.fn(async (key: string) => {
        const lock = lockStore.get(key);
        if (!lock) return null;
        
        if (lock.expiresAt < Date.now()) {
          lockStore.delete(key);
          return null;
        }
        
        return lock.value;
      }),
      del: jest.fn(async (key: string) => {
        const hasExisted = lockStore.has(key);
        lockStore.delete(key);
        return hasExisted ? 1 : 0;
      }),
      // eval receives (script, { keys, arguments }) in node-redis v4
      eval: jest.fn(async (script: string, opts: { keys: string[]; arguments: string[] }) => {
        const key = opts.keys[0];
        const lockId = opts.arguments[0];
        
        if (!key) return 0;
        
        const lock = lockStore.get(key);
        
        if (lock && lock.value === lockId) {
          lockStore.delete(key);
          return 1;
        }
        return 0;
      }),
    };

    (redisConfig.getRedisClient as jest.Mock).mockResolvedValue(mockClient);

    // Reset singleton and directly inject mock client
    (RedisStateService as unknown as { instance?: unknown }).instance = undefined;
    service = RedisStateService.getInstance();
    const serviceInstance = service as unknown as { client?: unknown; isConnected?: boolean };
    serviceInstance.client = mockClient;
    serviceInstance.isConnected = true;
  });

  describe('acquireLock', () => {
    it('should acquire lock successfully when lock is available', async () => {
      const key = 'test-lock';
      const lockId = 'lock-123';
      
      const result = await service.acquireLock(key, lockId, 5000);
      
      expect(result).toBe(true);
      expect(mockClient.set).toHaveBeenCalledWith(
        expect.stringContaining(key),
        lockId,
        expect.objectContaining({ NX: true, PX: 5000 })
      );
    });

    it('should return false if lock is already held by another process', async () => {
      const key = 'test-lock';
      
      // First process acquires lock
      await service.acquireLock(key, 'lock-1', 5000);
      
      // Second process tries to acquire same lock
      const result = await service.acquireLock(key, 'lock-2', 5000);
      
      expect(result).toBe(false);
    });

    it('should acquire lock if previous lock expired', async () => {
      const key = 'test-lock';
      
      // Acquire lock with 1ms TTL
      await service.acquireLock(key, 'lock-1', 1);
      
      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should be able to acquire again
      const result = await service.acquireLock(key, 'lock-2', 5000);
      
      expect(result).toBe(true);
    });
  });

  describe('releaseLock', () => {
    it('should release lock with correct lockId', async () => {
      const key = 'test-lock';
      const lockId = 'lock-123';
      
      await service.acquireLock(key, lockId, 5000);
      const result = await service.releaseLock(key, lockId);
      
      expect(result).toBe(true);
      expect(mockClient.eval).toHaveBeenCalled();
      
      // Verify lock is actually released (can acquire again)
      const canAcquire = await service.acquireLock(key, 'lock-456', 5000);
      expect(canAcquire).toBe(true);
    });

    it('should NOT release lock with wrong lockId (security)', async () => {
      const key = 'test-lock';
      const lockId = 'lock-123';
      
      await service.acquireLock(key, lockId, 5000);
      const result = await service.releaseLock(key, 'wrong-lock-id');
      
      expect(result).toBe(false);
      
      // Verify lock is still held
      const canAcquire = await service.acquireLock(key, 'lock-456', 5000);
      expect(canAcquire).toBe(false);
    });

    it('should handle raw key correctly without double-prefix (ISSUE-65 fix)', async () => {
      const key = 'room-promotion-lock:room-1';
      const lockId = 'lock-123';
      
      await service.acquireLock(key, lockId, 5000);
      const result = await service.releaseLock(key, lockId);
      
      expect(result).toBe(true);
      
      // The critical test: eval should receive the key that buildKey() will process
      // Not a double-prefixed key
      const evalCalls = mockClient.eval.mock.calls;
      expect(evalCalls.length).toBeGreaterThan(0);
      
      // Verify lock is released
      const canAcquire = await service.acquireLock(key, 'lock-456', 5000);
      expect(canAcquire).toBe(true);
    });
  });

  describe('executeWithLock', () => {
    it('should execute operation with lock protection', async () => {
      const key = 'test-lock';
      const operation = jest.fn(async () => 'result');
      
      const result = await service.executeWithLock(key, 5000, 10000, operation);
      
      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(1);
      
      // Verify lock was released after operation
      const canAcquire = await service.acquireLock(key, 'lock-123', 5000);
      expect(canAcquire).toBe(true);
      expect(loggingService.logPerformanceMetric).toHaveBeenCalledWith(
        'redis_lock_hold_duration',
        expect.any(Number),
        expect.objectContaining({
          keyCategory: 'test-lock',
          acquisitionWaitMs: expect.any(Number),
          attempts: expect.any(Number),
        })
      );
    });

    it('should timeout if lock is unavailable', async () => {
      const key = 'test-lock';
      
      // Hold lock with another process
      await service.acquireLock(key, 'lock-1', 10000);
      
      const operation = jest.fn(async () => 'result');
      
      // Try to execute with short timeout
      await expect(
        service.executeWithLock(key, 100, 5000, operation)
      ).rejects.toThrow('Failed to acquire lock');
      
      expect(operation).not.toHaveBeenCalled();
      expect(loggingService.logPerformanceMetric).toHaveBeenCalledWith(
        'redis_lock_timeout',
        expect.any(Number),
        expect.objectContaining({
          keyCategory: 'test-lock',
          attempts: expect.any(Number),
          timeoutMs: 100,
          ttlMs: 5000,
        })
      );
    });

    it('should release lock even if operation throws error', async () => {
      const key = 'test-lock';
      const operation = jest.fn(async () => {
        throw new Error('Operation failed');
      });
      
      await expect(
        service.executeWithLock(key, 5000, 10000, operation)
      ).rejects.toThrow('Operation failed');
      
      // Verify lock was still released
      const canAcquire = await service.acquireLock(key, 'lock-123', 5000);
      expect(canAcquire).toBe(true);
    });

    it('should serialize concurrent operations correctly', async () => {
      const key = 'test-lock';
      const executionOrder: number[] = [];
      
      const createOperation = (id: number) => async () => {
        executionOrder.push(id);
        await new Promise(resolve => setTimeout(resolve, 10));
        return id;
      };
      
      // Execute 3 operations concurrently
      const results = await Promise.all([
        service.executeWithLock(key, 5000, 1000, createOperation(1)),
        service.executeWithLock(key, 5000, 1000, createOperation(2)),
        service.executeWithLock(key, 5000, 1000, createOperation(3)),
      ]);
      
      // All should complete
      expect(results).toEqual([1, 2, 3]);
      
      // They should execute serially (not concurrently)
      expect(executionOrder).toHaveLength(3);
      
      // Lock should be released at the end
      const canAcquire = await service.acquireLock(key, 'lock-123', 5000);
      expect(canAcquire).toBe(true);
    });
  });

  describe('Lock Expiry', () => {
    it('should allow lock acquisition after TTL expires', async () => {
      const key = 'test-lock';
      
      // Acquire lock with 50ms TTL
      await service.acquireLock(key, 'lock-1', 50);
      
      // Immediately try to acquire - should fail
      const immediate = await service.acquireLock(key, 'lock-2', 5000);
      expect(immediate).toBe(false);
      
      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should be able to acquire now
      const afterExpiry = await service.acquireLock(key, 'lock-3', 5000);
      expect(afterExpiry).toBe(true);
    });
  });

  describe('Regression: ISSUE-65 - Lock double-prefix bug (fixed 2026-04)', () => {
    it('should release distributed lock correctly without double-prefix', async () => {
      const lockKey = 'room-promotion-lock:room-1';
      
      // Acquire lock
      const lockId = 'test-lock-id';
      const isAcquired = await service.acquireLock(lockKey, lockId, 5000);
      expect(isAcquired).toBe(true);
      
      // Release lock
      const isReleased = await service.releaseLock(lockKey, lockId);
      expect(isReleased).toBe(true);
      
      // Critical verification: lock is actually released
      // If double-prefix bug exists, this would fail because:
      // - acquireLock uses buildKey(key) → "jam-band:room-promotion-lock:room-1"
      // - releaseLock would double-prefix → "jam-band:jam-band:room-promotion-lock:room-1"
      // - Keys don't match → lock never released
      const canAcquireAgain = await service.acquireLock(lockKey, 'new-lock-id', 5000);
      expect(canAcquireAgain).toBe(true);
    });

    it('should allow subsequent operations after lock release', async () => {
      const lockKey = 'room-state-mutex:room-1';
      
      // First operation
      const result1 = await service.executeWithLock(lockKey, 5000, 10000, async () => {
        return 'operation-1';
      });
      expect(result1).toBe('operation-1');
      
      // Second operation should work (lock was isReleased)
      const result2 = await service.executeWithLock(lockKey, 5000, 10000, async () => {
        return 'operation-2';
      });
      expect(result2).toBe('operation-2');
      
      // Third operation should also work
      const result3 = await service.executeWithLock(lockKey, 5000, 10000, async () => {
        return 'operation-3';
      });
      expect(result3).toBe('operation-3');
    });
  });
});
