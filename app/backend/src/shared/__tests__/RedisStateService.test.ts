import { RedisStateService } from '@/shared/infrastructure/caching/RedisStateService';
import * as redisConfig from '@/config/redis';

type MockRedisClient = Record<
  | 'get'
  | 'set'
  | 'setEx'
  | 'del'
  | 'exists'
  | 'hGet'
  | 'hSet'
  | 'hGetAll'
  | 'hDel'
  | 'hLen'
  | 'sAdd'
  | 'sMembers'
  | 'sRem'
  | 'keys'
  | 'expire'
  | 'ping',
  jest.Mock
>;

// Mock the redis config module
jest.mock('@/config/redis');
jest.mock('@/shared/infrastructure/logging/LoggingService');

describe('RedisStateService', () => {
  let mockRedisClient: MockRedisClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Reset the singleton instance for each test
    (RedisStateService as unknown as { instance?: unknown }).instance = undefined;

    // Create mock Redis client
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      setEx: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      exists: jest.fn().mockResolvedValue(1),
      hGet: jest.fn(),
      hSet: jest.fn().mockResolvedValue(1),
      hGetAll: jest.fn().mockResolvedValue({}),
      hDel: jest.fn().mockResolvedValue(1),
      hLen: jest.fn().mockResolvedValue(0),
      sAdd: jest.fn().mockResolvedValue(1),
      sMembers: jest.fn().mockResolvedValue([]),
      sRem: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
      expire: jest.fn().mockResolvedValue(1),
      ping: jest.fn().mockResolvedValue('PONG'),
    };

    // Mock getRedisConfig to return enabled
    (redisConfig.getRedisConfig as jest.Mock).mockReturnValue({ enabled: true });

    // Mock getRedisClient to return our mock client
    (redisConfig.getRedisClient as jest.Mock).mockResolvedValue(mockRedisClient);
  });

  // isEnabled() method removed - Redis is always required

  describe('get/set operations', () => {
    it('should get value and parse JSON', async () => {
      const service = RedisStateService.getInstance();
      const testData = { foo: 'bar', count: 42 };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(testData));

      const result = await service.get<typeof testData>('test-key');

      expect(result).toEqual(testData);
    });

    it('should return null for non-existent key', async () => {
      const service = RedisStateService.getInstance();
void mockRedisClient.get.mockResolvedValue(null);

      const result = await service.get('non-existent');

      expect(result).toBeNull();
    });

    it('should set value with JSON serialization', async () => {
      const service = RedisStateService.getInstance();
      const testData = { foo: 'bar' };

      const didSet = await service.set('test-key', testData);

      expect(didSet).toBe(true);
    });

    it('should set value with TTL', async () => {
      const service = RedisStateService.getInstance();
      const testData = { foo: 'bar' };

      const didSet = await service.set('test-key', testData, 3600);

      expect(didSet).toBe(true);
    });
  });

  describe('hash operations', () => {
    it('should get hash field value', async () => {
      const service = RedisStateService.getInstance();
      const testData = { name: 'Test Room' };
      mockRedisClient.hGet.mockResolvedValue(JSON.stringify(testData));

      const result = await service.hget<typeof testData>('rooms', 'room-1');

      expect(result).toEqual(testData);
    });

    it('should set hash field value', async () => {
      const service = RedisStateService.getInstance();
      const testData = { name: 'Test Room' };

      const didSet = await service.hset('rooms', 'room-1', testData);

      expect(didSet).toBe(true);
    });

    it('should get all hash fields', async () => {
      const service = RedisStateService.getInstance();
      const roomKey1 = 'room-1';
      const roomKey2 = 'room-2';
      mockRedisClient.hGetAll.mockResolvedValue({
        [roomKey1]: JSON.stringify({ name: 'Room 1' }),
        [roomKey2]: JSON.stringify({ name: 'Room 2' }),
      });

      const result = await service.hgetall<{ name: string }>('rooms');

      expect(result.size).toBe(2);
      expect(result.get('room-1')).toEqual({ name: 'Room 1' });
      expect(result.get('room-2')).toEqual({ name: 'Room 2' });
    });
  });

  describe('delete operations', () => {
    it('should delete key', async () => {
      const service = RedisStateService.getInstance();

      const didDelete = await service.delete('test-key');

      expect(didDelete).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      const service = RedisStateService.getInstance();
void mockRedisClient.del.mockResolvedValue(0);

      const didDelete = await service.delete('non-existent');

      expect(didDelete).toBe(false);
    });
  });

  describe('exists operation', () => {
    it('should return true when key exists', async () => {
      const service = RedisStateService.getInstance();

      const hasKey = await service.exists('test-key');

      expect(hasKey).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      const service = RedisStateService.getInstance();
void mockRedisClient.exists.mockResolvedValue(0);

      const hasKey = await service.exists('non-existent');

      expect(hasKey).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should return null on get error', async () => {
      const service = RedisStateService.getInstance();
void mockRedisClient.get.mockRejectedValue(new Error('Connection failed'));

      const result = await service.get('test-key');

      expect(result).toBeNull();
    });

    it('should return false on set error', async () => {
      const service = RedisStateService.getInstance();
void mockRedisClient.set.mockRejectedValue(new Error('Connection failed'));
void mockRedisClient.setEx.mockRejectedValue(new Error('Connection failed'));

      const didSet = await service.set('test-key', { foo: 'bar' });

      expect(didSet).toBe(false);
    });
  });
});
