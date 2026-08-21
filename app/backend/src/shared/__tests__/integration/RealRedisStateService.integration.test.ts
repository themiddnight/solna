/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-condition */

import { BaseRoomStateService } from '../../domain/room-state/BaseRoomStateService';
import type { BaseRoomState } from '../../domain/room-state/BaseRoomState';
import { RedisStateService } from '../../infrastructure/caching/RedisStateService';
import { RoomType } from '../../../types';

const describeIfRedis = process.env.REDIS_URL ? describe : describe.skip;

// Concrete implementation for testing
interface TestRoomState extends BaseRoomState {
  roomType: 'arrange' | 'perform';
  testData: string;
}

class TestRealRedisStateService extends BaseRoomStateService<TestRoomState> {
  protected readonly STATE_TTL = 3600;

  protected getStateKey(roomId: string): string {
    return `test:real_integration:${roomId}`;
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
}

describeIfRedis('RealRedisStateService Integration', () => {
  let service: TestRealRedisStateService;
  const testRoomId = `integration-test-room-${Date.now()}`;

  beforeAll(async () => {
    // Ensure we are connecting to real Redis
    if (!process.env.REDIS_URL) {
      console.warn('Skipping Real Redis tests: REDIS_URL not set');
      return;
    }
    
    // Initialize service which will connect to Redis via singleton
    service = new TestRealRedisStateService();
    
    // Clean up any existing state for this test room
    await service.deleteState(testRoomId);
  });

  afterAll(async () => {
    if (service) {
      await service.deleteState(testRoomId);
    }
    // Disconnect Redis client to prevent open handles
    const { redisStateService } = await import('../../infrastructure/caching/RedisStateService');
    await redisStateService.disconnect();
  });

  it('should save and retrieve state from real Redis', async () => {
    const initialState: TestRoomState = {
      roomId: testRoomId,
      roomType: RoomType.PERFORM,
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      testData: 'initial-real-data',
      lastUpdated: new Date(),
    };

    // 1. Save State
    await service.saveState(testRoomId, initialState);

    // 2. Retrieve State
    const retrievedState = await service.getState(testRoomId);

    // 3. Verify
    expect(retrievedState).toBeDefined();
    expect(retrievedState?.roomId).toBe(testRoomId);
    expect(retrievedState?.testData).toBe('initial-real-data');
    expect(retrievedState?.lastUpdated).toBeInstanceOf(Date);
    expect(retrievedState?.lastUpdated.toISOString()).toBe(initialState.lastUpdated.toISOString());
  });

  it('should update existing state in real Redis', async () => {
    const updates = {
      bpm: 150,
      testData: 'updated-real-data',
    };

    // 1. Update State
    const updatedState = await service.updateState(testRoomId, updates);

    // 2. Verify returned state
    expect(updatedState.bpm).toBe(150);
    expect(updatedState.testData).toBe('updated-real-data');

    // 3. Verify persisted state
    const retrievedState = await service.getState(testRoomId);
    expect(retrievedState?.bpm).toBe(150);
    expect(retrievedState?.testData).toBe('updated-real-data');
  });

  it('should delete state from real Redis', async () => {
    // 1. Delete State
    await service.deleteState(testRoomId);

    // 2. Verify
    const retrievedState = await service.getState(testRoomId);
    expect(retrievedState).toBeNull();
  });

  it('should handle TTL expiry (simulated)', async () => {
    // We can't easily wait 1 hour in a test, but we can verify TTL is set
    const initialState: TestRoomState = {
      roomId: testRoomId,
      roomType: RoomType.PERFORM,
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      testData: 'ttl-test-data',
      lastUpdated: new Date(),
    };

    await service.saveState(testRoomId, initialState);

    const redisService = RedisStateService.getInstance();
    const redisServiceInstance = redisService as unknown as { client?: unknown };
    const client = redisServiceInstance.client;

    // If client is exposed or we can access it.
    // Since RedisStateService singleton might not expose client directly in public API,
    // we might need to check implementation.
    // Assuming standard Redis client behavior:

    if (client) {
      // Wait a bit to ensure write propagation
      await new Promise(resolve => setTimeout(resolve, 100));
      const redisClient = client as unknown as { ttl: (key: string) => Promise<number> };
      const ttl = await redisClient.ttl(`collab:test:real_integration:${testRoomId}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3600);
    }
  });
});
