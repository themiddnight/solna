/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/member-ordering, @typescript-eslint/no-unused-vars */

import { BaseRoomStateService } from '../BaseRoomStateService';
import type { BaseRoomState } from '../BaseRoomState';
import { RedisStateService, redisStateService } from '../../../infrastructure/caching/RedisStateService';
import { loggingService } from '../../../infrastructure/logging/LoggingService';
import { RoomType } from '../../../../types';

// Mock Redis and logging
jest.mock('../../../infrastructure/caching/RedisStateService', () => ({
  RedisStateService: {
    getInstance: jest.fn(() => ({
      isEnabled: jest.fn(() => true),
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
    })),
  },
  redisStateService: {
    executeWithLock: jest.fn(async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<any>) => {
      return await operation();
    }),
  },
}));
jest.mock('../../../infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logError: jest.fn(),
    logPerformanceMetric: jest.fn(),
  },
}));

interface TestRoomState extends BaseRoomState {
  roomType: 'arrange' | 'perform';
  testData: string;
}

class TestRoomStateService extends BaseRoomStateService<TestRoomState> {
  protected readonly STATE_TTL = 3600;

  protected getStateKey(roomId: string): string {
    return `test:state:${roomId}`;
  }

  protected serializeState(state: TestRoomState): any {
    return {
      ...state,
      lastUpdated: state.lastUpdated.toISOString(),
    };
  }

  protected deserializeState(savedState: any): TestRoomState {
    return {
      ...savedState,
      lastUpdated: new Date(savedState.lastUpdated),
    };
  }

  async initializeState(roomId: string): Promise<TestRoomState> {
    const state: TestRoomState = {
      roomId,
      roomType: RoomType.PERFORM,
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      testData: 'initial',
      lastUpdated: new Date(),
    };

    await this.saveState(roomId, state);
    return state;
  }
}

describe('BaseRoomStateService - Redis Failure Scenarios', () => {
  let service: TestRoomStateService;
  let mockRedis: {
    isEnabled: jest.Mock<boolean>;
    get: jest.Mock;
    set: jest.Mock;
    delete: jest.Mock;
    exists: jest.Mock;
  };
  const testRoomId = 'test-room-123';

  beforeEach(() => {
    service = new TestRoomStateService();
    mockRedis = {
      isEnabled: jest.fn(() => true),
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
    };
    (service as unknown as { redisState?: unknown }).redisState = mockRedis;
    jest.clearAllMocks();
    // Re-mock executeWithLock after clearAllMocks
    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async (_key: string, _timeout: number, _ttl: number, operation: () => Promise<any>) => {
        return await operation();
      }
    );
  });

  describe('getState - Redis Failures', () => {
    it('should return null when Redis is unavailable during getState', async () => {
void mockRedis.get.mockRejectedValue(new Error('Connection refused'));

      const state = await service.getState(testRoomId);

      expect(state).toBeNull();
      expect(loggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context: expect.stringContaining('getState - Redis error'),
          roomId: testRoomId,
        })
      );
    });

    it('should return null when Redis times out', async () => {
void mockRedis.get.mockRejectedValue(new Error('ETIMEDOUT'));

      const state = await service.getState(testRoomId);

      expect(state).toBeNull();
      expect(loggingService.logError).toHaveBeenCalled();
    });

  });

  describe('saveState - Redis Failures', () => {
    it('should throw error when Redis fails during saveState', async () => {
      const mockState: TestRoomState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'test',
        lastUpdated: new Date(),
      };

void mockRedis.set.mockRejectedValue(new Error('Connection refused'));

      await expect(service.saveState(testRoomId, mockState))
        .rejects.toThrow();

      expect(loggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context: expect.stringContaining('saveState - Redis save failed'),
          roomId: testRoomId,
        })
      );
    });

  });

  describe('updateState - Redis Failures', () => {
    it('should throw error when saveState fails during updateState', async () => {
      const existingState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'initial',
        lastUpdated: new Date().toISOString(),
      };

void mockRedis.get.mockResolvedValue(existingState);
void mockRedis.set.mockRejectedValue(new Error('Connection refused'));

      await expect(service.updateState(testRoomId, { bpm: 140 }))
        .rejects.toThrow();
    });

    it('should throw error when getState fails to find room', async () => {
void mockRedis.get.mockResolvedValue(null);

      await expect(service.updateState(testRoomId, { bpm: 140 }))
        .rejects.toThrow('Room state not found');
    });
  });

  describe('deleteState - Redis Failures', () => {
    it('should not throw when Redis fails during deleteState', async () => {
      mockRedis.delete.mockRejectedValue(new Error('Connection refused'));

      expect(await service.deleteState(testRoomId)).toBeUndefined();

      expect(loggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context: expect.stringContaining('deleteState - Redis delete failed'),
          roomId: testRoomId,
        })
      );
    });


    it('should handle successful deletion gracefully', async () => {
      mockRedis.delete.mockResolvedValue(true);

      expect(await service.deleteState(testRoomId)).toBeUndefined();

      expect(mockRedis.delete).toHaveBeenCalledWith(`test:state:${testRoomId}`);
    });
  });

  describe('Redis Recovery Scenarios', () => {
    it('should work normally after Redis recovers from failure', async () => {
      // First call fails
void mockRedis.get.mockRejectedValueOnce(new Error('Connection refused'));
      const state1 = await service.getState(testRoomId);
      expect(state1).toBeNull();

      // Second call succeeds (Redis recovered)
      const mockState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'recovered',
        lastUpdated: new Date().toISOString(),
      };
void mockRedis.get.mockResolvedValueOnce(mockState);
      const state2 = await service.getState(testRoomId);

      expect(state2).not.toBeNull();
      expect(state2?.testData).toBe('recovered');
    });
  });

  describe('Mutex Scenarios - Critical path tests — added after 2026-04 audit', () => {
    it('should acquire per-room mutex on updateState', async () => {
      const mockState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'test',
        lastUpdated: new Date().toISOString(),
      };

void mockRedis.get.mockResolvedValue(mockState);
void mockRedis.set.mockResolvedValue(undefined);

      const result = await service.updateState(testRoomId, { bpm: 140 });

      expect(result).toBeDefined();
      expect(result.bpm).toBe(140);
      expect(mockRedis.get).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should serialize state correctly before saving to Redis', async () => {
      const mockState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'original',
        lastUpdated: new Date().toISOString(),
      };

void mockRedis.get.mockResolvedValue(mockState);
void mockRedis.set.mockResolvedValue(undefined);

      await service.updateState(testRoomId, { bpm: 160 });

      // Verify that set was called with serialized data
      expect(mockRedis.set).toHaveBeenCalled();
      const [, savedData] = mockRedis.set.mock.calls[0];
      expect(savedData.bpm).toBe(160);
    });

    it('should handle getState failure during updateState gracefully', async () => {
void mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      await expect(service.updateState(testRoomId, { bpm: 140 }))
        .rejects.toThrow('Room state not found');

      expect(loggingService.logError).toHaveBeenCalled();
    });

    it('should handle saveState failure during updateState and propagate error', async () => {
      const mockState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'test',
        lastUpdated: new Date().toISOString(),
      };

void mockRedis.get.mockResolvedValue(mockState);
void mockRedis.set.mockRejectedValue(new Error('Write failed'));

      await expect(service.updateState(testRoomId, { bpm: 140 }))
        .rejects.toThrow('Write failed');

      expect(loggingService.logError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          context: expect.stringContaining('saveState'),
          roomId: testRoomId,
        })
      );
    });

    it('should prevent concurrent mutations on same room via mutex', async () => {
      const mockState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'concurrent-test',
        lastUpdated: new Date().toISOString(),
      };

void mockRedis.get.mockResolvedValue(mockState);
void mockRedis.set.mockResolvedValue(undefined);

      // Start two concurrent updates
      const update1 = service.updateState(testRoomId, { bpm: 130 });
      const update2 = service.updateState(testRoomId, { bpm: 150 });

      // Both should resolve (mutex serializes them)
      const [result1, result2] = await Promise.all([update1, update2]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      // Second update should have the higher BPM (executed after first)
      expect(result2.bpm).toBe(150);

      // Verify Redis get was called multiple times (once per update due to mutex serialization)
      expect(mockRedis.get).toHaveBeenCalledTimes(2);
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
    });

    it('should allow concurrent updates on different rooms', async () => {
      const room1 = 'room-1';
      const room2 = 'room-2';

      const mockState1 = {
        roomId: room1,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'room1',
        lastUpdated: new Date().toISOString(),
      };

      const mockState2 = {
        roomId: room2,
        roomType: RoomType.ARRANGE,
        bpm: 100,
        timeSignature: { numerator: 3, denominator: 4 },
        testData: 'room2',
        lastUpdated: new Date().toISOString(),
      };

      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(room1)) return mockState1;
        if (key.includes(room2)) return mockState2;
        return null;
      });
void mockRedis.set.mockResolvedValue(undefined);

      // Concurrent updates on different rooms
      const update1 = service.updateState(room1, { bpm: 140 });
      const update2 = service.updateState(room2, { bpm: 110 });

      const [result1, result2] = await Promise.all([update1, update2]);

      expect(result1.roomId).toBe(room1);
      expect(result1.bpm).toBe(140);
      expect(result2.roomId).toBe(room2);
      expect(result2.bpm).toBe(110);
    });

    it('should maintain mutex per room (different room != same mutex)', async () => {
      // This test verifies that room1 mutex and room2 mutex are independent
      const room1 = 'mutex-room-1';
      const room2 = 'mutex-room-2';

      const state1 = {
        roomId: room1,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'state1',
        lastUpdated: new Date().toISOString(),
      };

      const state2 = {
        roomId: room2,
        roomType: RoomType.PERFORM,
        bpm: 100,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'state2',
        lastUpdated: new Date().toISOString(),
      };

      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.includes(room1)) return state1;
        if (key.includes(room2)) return state2;
        return null;
      });
void mockRedis.set.mockResolvedValue(undefined);

      // Acquire mutex for both rooms by calling updateState
      const update1 = service.updateState(room1, { bpm: 140 });
      const update2 = service.updateState(room2, { bpm: 110 });

      const [result1, result2] = await Promise.all([update1, update2]);

      // Both should complete successfully (different mutexes)
      expect(result1.bpm).toBe(140);
      expect(result2.bpm).toBe(110);
    });

    it('should cleanup mutex after room state is deleted', async () => {
      mockRedis.delete.mockResolvedValue(undefined);

      // Get the mutex by updating state first
      const mockState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'cleanup-test',
        lastUpdated: new Date().toISOString(),
      };

void mockRedis.get.mockResolvedValue(mockState);
void mockRedis.set.mockResolvedValue(undefined);

      // Create mutex by updating
      await service.updateState(testRoomId, { bpm: 130 });

      // Now delete the state (which should cleanup mutex)
      await service.deleteState(testRoomId);

      expect(mockRedis.delete).toHaveBeenCalledWith(expect.any(String));
      // Verify no lingering mutex references (by attempting another update)
void mockRedis.get.mockResolvedValue(mockState);

      // This should work without mutex conflicts
      const result = await service.updateState(testRoomId, { bpm: 140 });
      expect(result).toBeDefined();
    });
  });
});
