/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
/**
 * BR-1: 1 Opened Project = 1 Arrange Room
 * Tests for ProjectRoomService — Redis project↔room mapping
 *
 * Mock strategy: Because jest.config has resetMocks:true, all jest.fn()
 * implementations are reset before each test. We use a shared in-memory
 * store (plain object, not jest.fn) and re-assign mock implementations
 * in beforeEach to survive resets.
 */

// ─── Shared in-memory Redis store (survives resetMocks) ─────────────
const redisStore = {
  hashes: new Map<string, Map<string, string>>(),
  getHash(key: string): Map<string, string> {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    return this.hashes.get(key)!;
  },
  buildKey(hash: string) { return `collab:${hash}`; },
  clear() { this.hashes.clear(); },
};

// ─── Mock implementations (plain functions, not jest.fn) ────────────
// These match real RedisStateService behavior exactly:
//   hset(hash, field, value) → client.hSet(prefixedKey, field, JSON.stringify(value))
//   hget(hash, field) → JSON.parse(client.hGet(prefixedKey, field))
//   eval(script, keys, args) → client.eval(script, { keys: prefixed, arguments: args.map(String) })

const redisImpl = {
  hset: async (hash: string, field: string, value: unknown): Promise<boolean> => {
    redisStore.getHash(redisStore.buildKey(hash)).set(field, JSON.stringify(value));
    return true;
  },
  hget: async (hash: string, field: string): Promise<unknown> => {
    const raw = redisStore.getHash(redisStore.buildKey(hash)).get(field);
    if (raw === undefined) return null;
    return JSON.parse(raw);
  },
  hgetMany: async (hash: string, fields: string[]): Promise<Map<string, unknown>> => {
    const result = new Map<string, unknown>();
    const hashStore = redisStore.getHash(redisStore.buildKey(hash));

    for (const field of fields) {
      const raw = hashStore.get(field);
      if (raw !== undefined) {
        result.set(field, JSON.parse(raw));
      }
    }

    return result;
  },
  hdel: async (hash: string, field: string): Promise<boolean> => {
    redisStore.getHash(redisStore.buildKey(hash)).delete(field);
    return true;
  },
  // Simulates SET_ACTIVE_ROOM_LUA with 4 ARGV:
  //   ARGV[0] = projectId (plain field)
  //   ARGV[1] = JSON.stringify(roomId) (value for KEYS[1])
  //   ARGV[2] = roomId (plain field for KEYS[2])
  //   ARGV[3] = JSON.stringify(projectId) (value for KEYS[2])
  eval: async (script: string, keys: string[], args: (string | number)[]): Promise<any> => {
    const KEYS = keys.map(k => redisStore.buildKey(k));
    const ARGV = args.map(String);
    const projectHash = redisStore.getHash(KEYS[0]!);
    const roomHash = redisStore.getHash(KEYS[1]!);

    const existing = projectHash.get(ARGV[0]!) ?? null;
    if (existing !== null && existing !== ARGV[1]!) {
      return existing; // conflict — return stored value (JSON-stringified roomId)
    }
    projectHash.set(ARGV[0]!, ARGV[1]!);
void roomHash.set(ARGV[2]!, ARGV[3]!);
    return 'OK';
  },
};

// ─── Module mocks ───────────────────────────────────────────────────
jest.mock('@/shared/infrastructure/caching/RedisStateService', () => ({
  redisStateService: {
    hset: jest.fn(),
    hget: jest.fn(),
    hgetMany: jest.fn(),
    hdel: jest.fn(),
    eval: jest.fn(),
  },
}));

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: { logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() },
}));

jest.mock('@/config/prisma', () => ({
  prisma: { savedProject: { findUnique: jest.fn() } },
}));

const mockGetRoom = jest.fn();
jest.mock('@/domains/room-management/infrastructure/repositories/RoomRepository', () => ({
  RoomRepository: jest.fn().mockImplementation(() => ({
    getRoom: (...a: any[]) => mockGetRoom(...a),
    getAllRooms: jest.fn().mockResolvedValue([]),
  })),
}));

const mockGetUserCount = jest.fn();
jest.mock('@/domains/room-management/infrastructure/repositories/RoomUserRepository', () => ({
  roomUserRepository: {
    getUserCount: (...a: any[]) => mockGetUserCount(...a),
    getUserCountStrict: (...a: any[]) => mockGetUserCount(...a),
  },
}));

import { ProjectRoomService } from '../infrastructure/storage/ProjectRoomService';
import { redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import { REDIS_KEYS } from '../../../shared/constants/RedisKeys';

const mockRedis = redisStateService as jest.Mocked<typeof redisStateService>;

describe('BR-1: ProjectRoomService', () => {
  let service: ProjectRoomService;

  beforeEach(() => {
    // Re-assign implementations after resetMocks clears them
    redisStore.clear();
void mockGetRoom.mockReset();
void mockGetUserCount.mockReset();
    (mockRedis.hset as jest.Mock).mockImplementation(redisImpl.hset);
    (mockRedis.hget as jest.Mock).mockImplementation(redisImpl.hget);
    (mockRedis.hgetMany as jest.Mock).mockImplementation(redisImpl.hgetMany);
    (mockRedis.hdel as jest.Mock).mockImplementation(redisImpl.hdel);
    (mockRedis.eval as jest.Mock).mockImplementation(redisImpl.eval);

    service = new ProjectRoomService();
  });

  // ─── setActiveRoom / getActiveRoom roundtrip ──────────────

  describe('setActiveRoom + getActiveRoom roundtrip', () => {
    it('should set and get mapping correctly', async () => {
      const projectId = 'proj-111';
      const roomId = 'room-222';

      mockGetRoom.mockResolvedValue({
        id: roomId,
        bandMembers: new Map(),
        audiences: new Map(),
      });
void mockGetUserCount.mockResolvedValue(1);

      await service.setActiveRoom(projectId, roomId);
      const result = await service.getActiveRoom(projectId);

      expect(result.activeRoomId).toBe(roomId);
      expect(result.activeUserCount).toBe(1);
    });

    it('should return null when no mapping exists', async () => {
      const result = await service.getActiveRoom('nonexistent-project');
      expect(result.activeRoomId).toBeNull();
      expect(result.activeUserCount).toBe(0);
    });

    it('should set both forward and reverse mappings', async () => {
      await service.setActiveRoom('proj-aaa', 'room-bbb');

      expect(mockRedis.hset).toHaveBeenCalledWith(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, 'proj-aaa', 'room-bbb');
      expect(mockRedis.hset).toHaveBeenCalledWith(REDIS_KEYS.ROOM_PROJECTS, 'room-bbb', 'proj-aaa');
    });
  });

  // ─── clearActiveRoom ──────────────────────────────────────

  describe('clearActiveRoom', () => {
    it('should clear both forward and reverse mappings', async () => {
      await service.setActiveRoom('proj-clear', 'room-clear');
      await service.clearActiveRoom('proj-clear');

      const result = await service.getActiveRoom('proj-clear');
      expect(result.activeRoomId).toBeNull();
    });
  });

  describe('clearActiveRoomByRoomId', () => {
    it('should clear both mappings via reverse lookup', async () => {
      await service.setActiveRoom('proj-rev', 'room-rev');
      await service.clearActiveRoomByRoomId('room-rev');

      const result = await service.getActiveRoom('proj-rev');
      expect(result.activeRoomId).toBeNull();
    });
  });

  // ─── trySetActiveRoom (atomic Lua) ────────────────────────

  describe('trySetActiveRoom', () => {
    it('should succeed when no existing mapping', async () => {
      const result = await service.trySetActiveRoom('proj-new', 'room-new');
      expect(result).toBeNull();
    });

    it('should fail closed when Redis eval returns null', async () => {
      (mockRedis.eval as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.trySetActiveRoom('proj-null', 'room-null'))
        .rejects.toThrow('SERVICE_UNAVAILABLE');
    });

    it('should succeed when same room is re-set (idempotent)', async () => {
      await service.setActiveRoom('proj-same', 'room-same');

      const result = await service.trySetActiveRoom('proj-same', 'room-same');
      expect(result).toBeNull();
    });

    it('should return conflict when project has a different active room (alive)', async () => {
      await service.trySetActiveRoom('proj-conflict', 'room-A');

      mockGetRoom.mockResolvedValue({
        id: 'room-A',
        bandMembers: new Map(),
        audiences: new Map(),
      });
void mockGetUserCount.mockResolvedValue(1);

      const result = await service.trySetActiveRoom('proj-conflict', 'room-B');
      expect(result).not.toBeNull();
      expect(result!.conflictRoomId).toBe('room-A');
    });

    it('should self-heal when conflicting room is dead (no users)', async () => {
      await service.trySetActiveRoom('proj-stale', 'room-dead');

void mockGetRoom.mockResolvedValue(null);

      const result = await service.trySetActiveRoom('proj-stale', 'room-alive');
      expect(result).toBeNull();
    });

    it('should self-heal when conflicting room has 0 users', async () => {
      await service.trySetActiveRoom('proj-empty', 'room-empty');

void mockGetUserCount.mockResolvedValue(0);

      const result = await service.trySetActiveRoom('proj-empty', 'room-new');
      expect(result).toBeNull();
    });
  });

  // ─── Format consistency (the critical bug that was fixed) ─

  describe('Format consistency: Lua script vs hset', () => {
    it('trySetActiveRoom should pass 4 ARGV: plain fields + JSON-stringified values', async () => {
      await service.trySetActiveRoom('proj-fmt', 'room-fmt');

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        [REDIS_KEYS.PROJECT_ACTIVE_ROOMS, REDIS_KEYS.ROOM_PROJECTS],
        ['proj-fmt', JSON.stringify('room-fmt'), 'room-fmt', JSON.stringify('proj-fmt')]
      );
    });

    it('mapping set by hset should be readable by trySetActiveRoom (no false conflict)', async () => {
      // Set via hset (self-heal path) — stores field=plain, value=JSON-stringified
      await service.setActiveRoom('proj-cross', 'room-cross');

      mockGetRoom.mockResolvedValue({
        id: 'room-cross',
        bandMembers: new Map(),
        audiences: new Map(),
      });
void mockGetUserCount.mockResolvedValue(1);

      // trySetActiveRoom with SAME roomId should NOT conflict
      const result = await service.trySetActiveRoom('proj-cross', 'room-cross');
      expect(result).toBeNull();
    });

    it('mapping set by hset should detect conflict from trySetActiveRoom (different room)', async () => {
      await service.setActiveRoom('proj-cross2', 'room-existing');

      mockGetRoom.mockResolvedValue({
        id: 'room-existing',
        bandMembers: new Map(),
        audiences: new Map(),
      });
void mockGetUserCount.mockResolvedValue(1);

      const result = await service.trySetActiveRoom('proj-cross2', 'room-new');
      expect(result).not.toBeNull();
      expect(result!.conflictRoomId).toBe('room-existing');
    });
  });

  // ─── getActiveRoom self-heal ──────────────────────────────

  describe('getActiveRoom self-heal', () => {
    it('should clear stale mapping when room does not exist', async () => {
      await service.setActiveRoom('proj-ghost', 'room-ghost');
void mockGetRoom.mockResolvedValue(null);

      const result = await service.getActiveRoom('proj-ghost');
      expect(result.activeRoomId).toBeNull();
      expect(result.activeUserCount).toBe(0);
    });

    it('should clear stale mapping when room has 0 users', async () => {
      await service.setActiveRoom('proj-empty2', 'room-empty2');
      mockGetRoom.mockResolvedValue({
        id: 'room-empty2',
        bandMembers: new Map(),
        audiences: new Map(),
      });
void mockGetUserCount.mockResolvedValue(0);

      const result = await service.getActiveRoom('proj-empty2');
      expect(result.activeRoomId).toBeNull();
      expect(result.activeUserCount).toBe(0);
    });
  });

  describe('bulk active-room lookups', () => {
    it('should bulk-read project active rooms without per-project hget', async () => {
      await service.setActiveRoom('proj-bulk-1', 'room-bulk-1');
      await service.setActiveRoom('proj-bulk-2', 'room-bulk-2');
      jest.clearAllMocks();
      (mockRedis.hgetMany as jest.Mock).mockImplementation(redisImpl.hgetMany);

      const result = await service.getActiveRooms(['proj-bulk-1', 'proj-bulk-2', 'proj-missing']);

      expect(mockRedis.hgetMany).toHaveBeenCalledWith(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, [
        'proj-bulk-1',
        'proj-bulk-2',
        'proj-missing',
      ]);
      expect(mockRedis.hget).not.toHaveBeenCalled();
      expect(result.get('proj-bulk-1')).toBe('room-bulk-1');
      expect(result.get('proj-bulk-2')).toBe('room-bulk-2');
      expect(result.get('proj-missing')).toBeNull();
    });

    it('should bulk-read active room counts and skip stale rooms without cleanup', async () => {
      mockGetRoom.mockImplementation(async (roomId: string) => (
        roomId === 'room-live' ? { id: roomId, isPrivate: true } : null
      ));
      mockGetUserCount.mockImplementation(async (roomId: string) => (
        roomId === 'room-live' ? 2 : 0
      ));

      const result = await service.getActiveRoomCounts(['room-live', 'room-stale']);

      expect(result.get('room-live')).toEqual({ activeUserCount: 2, isPrivate: true });
      expect(result.has('room-stale')).toBe(false);
      expect(mockRedis.hdel).not.toHaveBeenCalled();
    });
  });

  // ─── decrementUserCount ───────────────────────────────────

  describe('decrementUserCount', () => {
    it('should clear mapping when no users remain', async () => {
      await service.setActiveRoom('proj-dec', 'room-dec');
      mockGetRoom.mockResolvedValue({
        audiences: new Map(),
      });
void mockGetUserCount.mockResolvedValue(0);

      const count = await service.decrementUserCount('proj-dec');
      expect(count).toBe(0);
    });

    it('should return real user count when users exist', async () => {
      await service.setActiveRoom('proj-dec2', 'room-dec2');
      mockGetRoom.mockResolvedValue({
        id: 'room-dec2',
        bandMembers: new Map(),
        audiences: new Map(),
      });
void mockGetUserCount.mockResolvedValue(3);

      const count = await service.decrementUserCount('proj-dec2');
      expect(count).toBe(3);
    });
  });
});
