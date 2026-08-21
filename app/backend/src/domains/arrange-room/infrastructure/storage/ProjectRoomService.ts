import { prisma } from '../../../../config/prisma';
import { RoomRepository } from '../../../room-management/infrastructure/repositories/RoomRepository';
import { roomUserRepository } from '../../../room-management/infrastructure/repositories/RoomUserRepository';
import { redisStateService } from '../../../../shared/infrastructure/caching/RedisStateService';
import { REDIS_KEYS } from '../../../../shared/constants/RedisKeys';

// Singleton RoomRepository for accessing Redis room state
const roomRepository = new RoomRepository();

/**
 * ProjectRoomService
 * 
 * Manages active room tracking for projects.
 * Uses Redis as the **source of truth** for real-time project↔room mapping.
 */
export class ProjectRoomService {

  // ─── Redis mapping (source of truth) ───────────────────────────

  /**
   * Lua script for atomic check-and-set of active room.
   * Returns:
   *   "OK"              — successfully set (no conflict)
   *   existing roomId   — conflict: project already has a different active room
   *
   * RedisStateService.hset() stores: field=plain, value=JSON.stringify'd.
   * So we need separate ARGV for field (plain) and value (JSON-stringified).
   *
   * KEYS[1] = project:active_rooms hash
   * KEYS[2] = room:projects hash
   * ARGV[1] = projectId (plain — used as field in KEYS[1])
   * ARGV[2] = JSON.stringify(roomId) (used as value in KEYS[1], for comparison)
   * ARGV[3] = roomId (plain — used as field in KEYS[2])
   * ARGV[4] = JSON.stringify(projectId) (used as value in KEYS[2])
   */
  private static readonly SET_ACTIVE_ROOM_LUA = `
    local existing = redis.call('HGET', KEYS[1], ARGV[1])
    if existing and existing ~= ARGV[2] then
      return existing
    end
    redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
    redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
    return "OK"
  `;

  /**
   * Set the active room for a project (Redis)
   */
  async setActiveRoom(projectId: string, roomId: string): Promise<void> {
    await redisStateService.hset(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, projectId, roomId);
    await redisStateService.hset(REDIS_KEYS.ROOM_PROJECTS, roomId, projectId);
  }

  /**
   * Atomically try to set the active room for a project.
   * If the project already has a different active room, returns the existing roomId (conflict).
   * If no conflict, sets the mapping and returns null (isSuccess).
   * This prevents TOCTOU race conditions where two concurrent requests both pass the check.
   */
  async trySetActiveRoom(projectId: string, roomId: string): Promise<{ conflictRoomId: string } | null> {
    // ARGV: plain fields + JSON-stringified values to match hset() storage format
    const result = await redisStateService.eval<string>(
      ProjectRoomService.SET_ACTIVE_ROOM_LUA,
      [REDIS_KEYS.PROJECT_ACTIVE_ROOMS, REDIS_KEYS.ROOM_PROJECTS],
      [projectId, JSON.stringify(roomId), roomId, JSON.stringify(projectId)]
    );

    if (result === null) {
      throw new Error('SERVICE_UNAVAILABLE: Failed to set active room atomically');
    }

    if (result === 'OK') {
      return null;
    }

    // result is the existing JSON-stringified roomId — unwrap it
    let conflictRoomId: string;
    try {
      conflictRoomId = JSON.parse(result) as string;
    } catch {
      conflictRoomId = result; // fallback if not JSON-wrapped
    }

    // Verify the conflicting room is actually alive
    const [room, totalUsers] = await Promise.all([
      roomRepository.getRoom(conflictRoomId),
      roomUserRepository.getUserCountStrict(conflictRoomId)
    ]);

    if (!room || totalUsers <= 0) {
      // Stale mapping — self-heal and allow the new room
      await this.clearActiveRoomByRoomId(conflictRoomId);
      await this.setActiveRoom(projectId, roomId);
      return null;
    }

    return { conflictRoomId };
  }

  /**
   * Clear the active room for a project
   */
  async clearActiveRoom(projectId: string): Promise<void> {
    // Get current roomId so we can clear reverse mapping
    const roomId = await redisStateService.hget<string>(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, projectId);
    await redisStateService.hdel(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, projectId);
    if (roomId) {
      await redisStateService.hdel(REDIS_KEYS.ROOM_PROJECTS, roomId);
    }
  }

  /**
   * Clear active room by room ID (used when room is deleted/cleaned up)
   */
  async clearActiveRoomByRoomId(roomId: string): Promise<void> {
    // Reverse lookup: roomId → projectId
    const projectId = await redisStateService.hget<string>(REDIS_KEYS.ROOM_PROJECTS, roomId);
    await redisStateService.hdel(REDIS_KEYS.ROOM_PROJECTS, roomId);
    if (projectId) {
      await redisStateService.hdel(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, projectId);
    }
  }

  // ─── Real-time queries (Redis only) ────────────────────────────

  /**
   * Get active room info for a project — reads entirely from Redis.
   * Used by frontend to determine if a project already has an active room.
   */
  async getActiveRoomInfo(projectId: string): Promise<{
    activeRoomId: string | null;
    activeUserCount: number;
    isPrivate: boolean;
    roomType: 'perform' | 'arrange';
  } | null> {
    // Need roomType from DB (static project metadata, not real-time state)
    const project = await prisma.savedProject.findUnique({
      where: { id: projectId },
      select: { roomType: true },
    });
    if (!project) return null;

    const defaultResult = {
      activeRoomId: null as string | null,
      activeUserCount: 0,
      isPrivate: false,
      roomType: (project.roomType === 'arrange' ? 'arrange' : 'perform') as 'perform' | 'arrange',
    };

    // Check Redis mapping
    const roomId = await redisStateService.hget<string>(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, projectId);
    if (!roomId) return defaultResult;

    // Verify room actually exists and has users
    const [room, totalUsers] = await Promise.all([
      roomRepository.getRoom(roomId),
      roomUserRepository.getUserCountStrict(roomId)
    ]);

    if (room && totalUsers > 0) {
      return {
        activeRoomId: roomId,
        activeUserCount: totalUsers,
        isPrivate: room.isPrivate,
        roomType: defaultResult.roomType,
      };
    }

    // Room gone or empty — self-heal by clearing stale mapping
    await this.clearActiveRoomByRoomId(roomId);
    return defaultResult;
  }

  /**
   * Get active room with real-time user count from Redis
   */
  async getActiveRoomWithRealCount(projectId: string): Promise<{
    activeRoomId: string | null;
    activeUserCount: number;
    isPrivate: boolean;
  }> {
    const roomId = await redisStateService.hget<string>(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, projectId);
    if (!roomId) return { activeRoomId: null, activeUserCount: 0, isPrivate: false };

    const [room, totalUsers] = await Promise.all([
      roomRepository.getRoom(roomId),
      roomUserRepository.getUserCountStrict(roomId)
    ]);

    if (room && totalUsers > 0) {
      return { activeRoomId: roomId, activeUserCount: totalUsers, isPrivate: room.isPrivate };
    }

    // Stale mapping — clean up
    await this.clearActiveRoomByRoomId(roomId);
    return { activeRoomId: null, activeUserCount: 0, isPrivate: false };
  }

  /**
   * Bulk-read project active room mappings without self-healing.
   * Used by project list APIs so one page does not issue one Redis read per project.
   */
  async getActiveRooms(projectIds: string[]): Promise<Map<string, string | null>> {
    const uniqueProjectIds = Array.from(new Set(projectIds));
    const storedRooms = await redisStateService.hgetMany<string>(
      REDIS_KEYS.PROJECT_ACTIVE_ROOMS,
      uniqueProjectIds
    );

    return new Map(uniqueProjectIds.map((projectId) => [
      projectId,
      storedRooms.get(projectId) ?? null,
    ]));
  }

  /**
   * Bulk-read active room counts. Stale room mappings are intentionally not
   * cleaned here; cleanup belongs in lifecycle jobs, not project list requests.
   */
  async getActiveRoomCounts(roomIds: string[]): Promise<Map<string, {
    activeUserCount: number;
    isPrivate: boolean;
  }>> {
    const uniqueRoomIds = Array.from(new Set(roomIds.filter(Boolean)));
    const roomEntries = await Promise.all(
      uniqueRoomIds.map(async (roomId) => {
        const [room, activeUserCount] = await Promise.all([
          roomRepository.getRoom(roomId),
          roomUserRepository.getUserCountStrict(roomId),
        ]);

        if (!room || activeUserCount <= 0) {
          return null;
        }

        return [roomId, { activeUserCount, isPrivate: room.isPrivate }] as const;
      })
    );

    return new Map(roomEntries.filter((entry): entry is [string, { activeUserCount: number; isPrivate: boolean }] => entry !== null));
  }

  /**
   * Get the active room for a project (simple lookup with self-heal)
   */
  async getActiveRoom(projectId: string): Promise<{
    activeRoomId: string | null;
    activeUserCount: number;
  }> {
    const roomId = await redisStateService.hget<string>(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, projectId);
    if (!roomId) return { activeRoomId: null, activeUserCount: 0 };

    const [room, totalUsers] = await Promise.all([
      roomRepository.getRoom(roomId),
      roomUserRepository.getUserCountStrict(roomId)
    ]);

    if (!room || totalUsers <= 0) {
      // Stale mapping — self-heal
      await this.clearActiveRoomByRoomId(roomId);
      return { activeRoomId: null, activeUserCount: 0 };
    }

    return { activeRoomId: roomId, activeUserCount: totalUsers };
  }

  /**
   * Find which project a room belongs to (reverse lookup)
   */
  async getProjectByActiveRoom(roomId: string): Promise<{
    id: string;
    name: string;
  } | null> {
    const projectId = await redisStateService.hget<string>(REDIS_KEYS.ROOM_PROJECTS, roomId);
    if (!projectId) return null;

    const project = await prisma.savedProject.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    return project;
  }

  // ─── User count helpers (derived from Redis room state) ────────

  /**
   * Decrement user count — returns the real user count from Redis.
   * Clears active room mapping if no users remain.
   */
  async decrementUserCount(projectId: string): Promise<number> {
    const roomId = await redisStateService.hget<string>(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, projectId);
    if (!roomId) return 0;

    const totalUsers = await roomUserRepository.getUserCountStrict(roomId);

    if (totalUsers <= 0) {
      await this.clearActiveRoom(projectId);
      return 0;
    }

    return totalUsers;
  }

  /**
   * Increment user count — returns the real user count from Redis.
   */
  async incrementUserCount(projectId: string): Promise<number> {
    const roomId = await redisStateService.hget<string>(REDIS_KEYS.PROJECT_ACTIVE_ROOMS, projectId);
    if (!roomId) return 0;

    const totalUsers = await roomUserRepository.getUserCountStrict(roomId);

    return totalUsers;
  }

}

// Export singleton instance
export const projectRoomService = new ProjectRoomService();
