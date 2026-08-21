/* eslint-disable @typescript-eslint/member-ordering, @typescript-eslint/no-unused-vars */

import { BaseRoomStateService } from '../BaseRoomStateService';
import type { BaseRoomState } from '../BaseRoomState';
import { RedisStateService, redisStateService } from '../../../infrastructure/caching/RedisStateService';
import { RoomType } from '../../../../types';
import { loggingService } from '../../../infrastructure/logging/LoggingService';

// Helper mock interface for the Redis state methods used in tests
interface MockRedisState {
  isEnabled: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  delete: jest.Mock;
  exists: jest.Mock;
}

// Helper type that exposes the protected redisState field for test injection
type ServiceWithRedisState = { redisState: MockRedisState };

// Mock Redis
jest.mock('../../../infrastructure/caching/RedisStateService', () => ({
  RedisStateService: {
    getInstance: jest.fn(() => ({
      isEnabled: jest.fn(() => false),
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
    })),
  },
  redisStateService: {
    executeWithLock: jest.fn(async <T>(_key: string, _timeout: number, _ttl: number, operation: () => Promise<T>) => {
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

  protected serializeState(state: TestRoomState): unknown {
    return {
      ...state,
      lastUpdated: state.lastUpdated.toISOString(),
    };
  }

  protected deserializeState(savedState: unknown): TestRoomState {
    const s = savedState as Record<string, unknown>;
    return {
      ...(s as unknown as Omit<TestRoomState, 'lastUpdated'>),
      lastUpdated: new Date(s['lastUpdated'] as string),
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

describe('BaseRoomStateService', () => {
  let service: TestRoomStateService;
  const testRoomId = 'test-room-123';

  beforeEach(() => {
    service = new TestRoomStateService();
    // Inject mock redis client
    (service as unknown as ServiceWithRedisState).redisState = {
      isEnabled: jest.fn(() => false),
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      exists: jest.fn(),
    };
    // Re-mock executeWithLock after clearAllMocks
    (redisStateService.executeWithLock as jest.Mock).mockImplementation(
      async <T>(_key: string, _timeout: number, _ttl: number, operation: () => Promise<T>) => {
        return await operation();
      }
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeState', () => {
    it('should initialize state with default values', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
void mockRedis.set.mockResolvedValue(true);
      
      const state = await service.initializeState(testRoomId);

      expect(state.roomId).toBe(testRoomId);
      expect(state.roomType).toBe('perform');
      expect(state.bpm).toBe(120);
      expect(state.timeSignature).toEqual({ numerator: 4, denominator: 4 });
      expect(state.testData).toBe('initial');
      expect(state.lastUpdated).toBeInstanceOf(Date);
      expect(mockRedis.set).toHaveBeenCalled();
      expect(loggingService.logPerformanceMetric).toHaveBeenCalledWith(
        'room_state_payload_size_bytes',
        expect.any(Number),
        expect.objectContaining({
          service: 'TestRoomStateService',
          roomId: testRoomId,
          roomType: RoomType.PERFORM,
        })
      );
    });

    it('should store state in Redis', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
      const mockState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'initial',
        lastUpdated: new Date(),
      };
      
void mockRedis.set.mockResolvedValue(true);
void mockRedis.get.mockResolvedValue(mockState);
      
      await service.initializeState(testRoomId);
      const retrievedState = await service.getState(testRoomId);

      expect(retrievedState).toBeDefined();
      expect(retrievedState?.roomId).toBe(testRoomId);
    });
  });

  describe('getState', () => {
    it('should return null for non-existent room', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
void mockRedis.get.mockResolvedValue(null);
      
      const state = await service.getState('non-existent-room');
      expect(state).toBeNull();
    });

    it('should return state from Redis', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
      const mockState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'initial',
        lastUpdated: new Date().toISOString(),
      };
      
void mockRedis.get.mockResolvedValue(mockState);
      const state = await service.getState(testRoomId);

      expect(state).toBeDefined();
      expect(state?.roomId).toBe(testRoomId);
    });

    it('should return null when Redis fails', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
void mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));
      
      const state = await service.getState(testRoomId);
      expect(state).toBeNull();
    });
  });

  describe('updateState', () => {
    it('should update state with new values', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
      const existingState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'initial',
        lastUpdated: new Date().toISOString(),
      };
      
void mockRedis.get.mockResolvedValue(existingState);
void mockRedis.set.mockResolvedValue(true);
      
      const updatedState = await service.updateState(testRoomId, {
        bpm: 140,
        testData: 'updated',
      });

      expect(updatedState.bpm).toBe(140);
      expect(updatedState.testData).toBe('updated');
      expect(updatedState.roomId).toBe(testRoomId);
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('should update lastUpdated timestamp', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
      const initialTimestamp = new Date();
      const existingState = {
        roomId: testRoomId,
        roomType: RoomType.PERFORM,
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        testData: 'initial',
        lastUpdated: initialTimestamp.toISOString(),
      };
      
void mockRedis.get.mockResolvedValue(existingState);
void mockRedis.set.mockResolvedValue(true);

      await new Promise(resolve => setTimeout(resolve, 10));
      
      const updatedState = await service.updateState(testRoomId, { bpm: 140 });
      expect(updatedState.lastUpdated.getTime()).toBeGreaterThan(initialTimestamp.getTime());
    });

    it('should throw error for non-existent room', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
void mockRedis.get.mockResolvedValue(null);
      
      await expect(service.updateState('non-existent-room', { bpm: 140 }))
        .rejects.toThrow('Room state not found');
    });
  });

  describe('deleteState', () => {
    it('should delete state from Redis', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
      mockRedis.delete.mockResolvedValue(true);

      await service.deleteState(testRoomId);
      expect(mockRedis.delete).toHaveBeenCalledWith(`test:state:${testRoomId}`);
    });

    it('should not throw error when deleting non-existent state', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
      mockRedis.delete.mockResolvedValue(false);
      
      expect(await service.deleteState('non-existent-room')).toBeUndefined();
    });

    it('should not throw error when Redis fails', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
      mockRedis.delete.mockRejectedValue(new Error('Redis connection failed'));
      
      expect(await service.deleteState(testRoomId)).toBeUndefined();
    });
  });

  describe('serializeState and deserializeState', () => {
    it('should serialize and deserialize state correctly', async () => {
      const mockRedis = (service as unknown as ServiceWithRedisState).redisState;
void mockRedis.set.mockResolvedValue(true);
      
      const originalState = await service.initializeState(testRoomId);
      const serialized = service['serializeState'](originalState);
      const deserialized = service['deserializeState'](serialized);

      expect(deserialized.roomId).toBe(originalState.roomId);
      expect(deserialized.bpm).toBe(originalState.bpm);
      expect(deserialized.testData).toBe(originalState.testData);
      expect(deserialized.lastUpdated).toBeInstanceOf(Date);
    });
  });
});
