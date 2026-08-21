/**
 * RoomSessionManager - Orphan Session Cleanup Regression Tests
 *
 * Regression tests for the ghost room deadlock bug:
 *
 * 1. The orphan sweep checked `socket?.isConnected` — a property that does NOT
 *    exist on Socket.IO sockets (the real property is `connected`). It was always
 *    `undefined ?? false`, so every live socket was misclassified as an orphan
 *    and had its Redis session keys deleted while still connected.
 *
 * 2. `removeOrphanSessionFromRedis` cleaned `socketToSession` but NOT the
 *    `roomSessions[roomId]` map. The zombie entry made `findSocketByUserId()`
 *    keep returning the dead socket, which (a) tripped handleLeaveRoom's
 *    duplicate-session guard so leave cleanup was skipped, and (b) made
 *    `isUserActiveInRoom()` return true so ghost-user cleanup never removed
 *    the user — blocking `shouldCloseRoom` forever. See FAILURE_PATTERNS.md.
 */
jest.mock('@/shared/infrastructure/caching/RedisStateService', () => {
  const instance = {
    executePipeline: jest.fn().mockResolvedValue([]),
    smembers: jest.fn().mockResolvedValue([]),
    hgetall: jest.fn().mockResolvedValue(new Map()),
    hget: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(true),
  };
  return {
    RedisStateService: {
      // Plain function (not jest.fn) — jest.config has resetMocks: true, which
      // would wipe a jest.fn implementation before each test.
      getInstance: () => instance,
    },
  };
});

import { RoomSessionManager } from '../infrastructure/services/RoomSessionManager';
import { RedisStateService } from '@/shared/infrastructure/caching/RedisStateService';

const mockRedisState = (RedisStateService as unknown as { getInstance: () => MockRedisState }).getInstance();

interface MockRedisState {
  executePipeline: jest.Mock;
  smembers: jest.Mock;
  hgetall: jest.Mock;
  hget: jest.Mock;
  delete: jest.Mock;
}

jest.mock('@/shared/infrastructure/logging/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logError: jest.fn(),
  },
}));

// Must be hex+dash only — isRoomNamespace validates /room/:roomId against /^\/room\/[a-f0-9-]+$/
const ROOM_ID = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
const USER_ID = 'user-1';
const SOCKET_ID = 'socket-abc';

interface MockIoSocket {
  connected: boolean;
}

/** Build the io stub `cleanupOrphanRedisSessions` expects, with the given sockets per namespace. */
function createMockIo(socketsById: Record<string, MockIoSocket>) {
  return {
    of: jest.fn(() => ({
      sockets: {
        get: (sid: string) => socketsById[sid],
      },
    })),
  };
}

function redisSessionFor(roomId: string, socketId: string, userId: string) {
  return {
    roomId,
    userId,
    socketId,
    namespacePath: `/room/${roomId}`,
    connectedAt: new Date(),
    lastActivity: new Date(),
  };
}

describe('RoomSessionManager.cleanupOrphanRedisSessions', () => {
  let manager: RoomSessionManager;

  beforeEach(() => {
    manager = new RoomSessionManager();

    mockRedisState.executePipeline.mockReset().mockResolvedValue([]);
    mockRedisState.hget.mockReset().mockResolvedValue(null);
    mockRedisState.smembers.mockReset();
    mockRedisState.hgetall.mockReset();
    // One room in the registry; its session hash holds one socket
    mockRedisState.smembers.mockResolvedValue([ROOM_ID]);
    mockRedisState.hgetall.mockImplementation((key: string) => {
      if (key === `sessions:room:${ROOM_ID}`) {
        return Promise.resolve(new Map([[SOCKET_ID, redisSessionFor(ROOM_ID, SOCKET_ID, USER_ID)]]));
      }
      return Promise.resolve(new Map()); // approval + lobby hashes are empty
    });
  });

  it('does NOT treat a connected socket as an orphan (isConnected typo regression)', async () => {
    // The real Socket.IO property is `connected` — the old code read the
    // non-existent `isConnected`, which made every live socket an "orphan".
    const io = createMockIo({ [SOCKET_ID]: { connected: true } });
    const onOrphanFound = jest.fn();

    const { orphanCount, affectedRoomIds } = await manager.cleanupOrphanRedisSessions(io, onOrphanFound);

    expect(orphanCount).toBe(0);
    expect(affectedRoomIds).toEqual([]);
    expect(onOrphanFound).not.toHaveBeenCalled();
  });

  it('treats a disconnected socket as an orphan and notifies the callback', async () => {
    const io = createMockIo({}); // socket not present in namespace at all
    const onOrphanFound = jest.fn().mockResolvedValue(undefined);

    const { orphanCount, affectedRoomIds } = await manager.cleanupOrphanRedisSessions(io, onOrphanFound);

    expect(orphanCount).toBe(1);
    expect(affectedRoomIds).toEqual([ROOM_ID]);
    expect(onOrphanFound).toHaveBeenCalledWith(ROOM_ID, USER_ID);
  });

  it('removes the in-memory roomSessions entry for an orphan (zombie session regression)', async () => {
    // Simulate the session existing in BOTH Redis and the in-memory maps
    // (the state right before the original bug: Redis says orphan, memory still has it).
    await manager.setRoomSession(ROOM_ID, SOCKET_ID, { roomId: ROOM_ID, userId: USER_ID });
    expect(manager.findSocketByUserId(ROOM_ID, USER_ID)).toBe(SOCKET_ID);

    const io = createMockIo({}); // disconnected → orphan
    await manager.cleanupOrphanRedisSessions(io);

    // The old code left the roomSessions entry behind: findSocketByUserId kept
    // returning the dead socket, blocking leave cleanup AND ghost-user cleanup.
    expect(manager.findSocketByUserId(ROOM_ID, USER_ID)).toBeUndefined();
    expect(manager.getRoomSessions(ROOM_ID).size).toBe(0);
    expect(manager.getRoomSession(SOCKET_ID)).toBeUndefined();
  });

  it('keeps the in-memory session intact when the socket is still connected', async () => {
    await manager.setRoomSession(ROOM_ID, SOCKET_ID, { roomId: ROOM_ID, userId: USER_ID });

    const io = createMockIo({ [SOCKET_ID]: { connected: true } });
    await manager.cleanupOrphanRedisSessions(io);

    expect(manager.findSocketByUserId(ROOM_ID, USER_ID)).toBe(SOCKET_ID);
    expect(manager.getRoomSession(SOCKET_ID)).toBeDefined();
  });
});
