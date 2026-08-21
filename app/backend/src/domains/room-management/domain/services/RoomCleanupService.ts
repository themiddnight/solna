import type { User } from "../../../../types";
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { namespaceGracePeriodManager } from "../../../../shared/infrastructure/namespace/NamespaceGracePeriodManager";
import type { RoomRepository } from "../../infrastructure/repositories/RoomRepository";
import { roomUserRepository } from "../../infrastructure/repositories/RoomUserRepository";
import { redisStateService } from "../../../../shared/infrastructure/caching/RedisStateService";
import { getRedisClient } from "../../../../config/redis";
import { clearRoomMembership } from "../../../../shared/utils/redisCacheUtils";
import { REDIS_KEYS } from "../../../../shared/constants/RedisKeys";

export class RoomCleanupService {
  private readonly intentionallyLeftUsers = new Map<
    string,
    { roomId: string; timestamp: number; userData: User }
  >();
  private readonly INTENTIONAL_LEAVE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  private readonly INTENTIONAL_LEAVE_REDIS_TTL = 300; // 5 minutes in seconds (matching EXPIRY_MS)
  private onRoomDeletedCallback: ((roomId: string) => Promise<void>) | null = null;

  constructor(private readonly roomRepository: RoomRepository) { }

  /**
   * Set callback to be invoked when a room is deleted during cleanup.
   * Used to sync external state (e.g. clear Redis project↔room mapping).
   */
  setOnRoomDeletedCallback(callback: (roomId: string) => Promise<void>): void {
    this.onRoomDeletedCallback = callback;
  }

  // Intentional leave management
  markIntentionalLeave(userId: string, roomId: string, user: User): void {
    this.intentionallyLeftUsers.set(userId, {
      roomId,
      timestamp: Date.now(),
      userData: user,
    });

    // Persist to Redis for crash recovery (fire-and-forget, non-blocking)
    this.persistIntentionalLeaveToRedis(userId, roomId, user);

    // Also remove from grace period if they were there
    namespaceGracePeriodManager.removeFromGracePeriod(userId, roomId);
  }

  markIntentionalLeaveById(userId: string, roomId: string): void {
    this.intentionallyLeftUsers.set(userId, {
      roomId,
      timestamp: Date.now(),
      userData: { id: userId } as User,
    });

    namespaceGracePeriodManager.removeFromGracePeriod(userId, roomId);
  }

  async hasUserIntentionallyLeft(userId: string, roomId: string): Promise<boolean> {
    // 1. Check in-memory map first (fast)
    const intentionalEntry = this.intentionallyLeftUsers.get(userId);
    if (intentionalEntry) {
      if (intentionalEntry.roomId !== roomId) return false;

      const now = Date.now();
      if (now - intentionalEntry.timestamp > this.INTENTIONAL_LEAVE_EXPIRY_MS) {
        this.intentionallyLeftUsers.delete(userId);
        // Also clean Redis on expiry
        redisStateService.del(this.getIntentionalLeaveKey(userId, roomId)).catch(() => {});
        return false;
      }

      return true;
    }

    // 2. Fallback: check Redis (for crash recovery across restarts)
    try {
      const key = this.getIntentionalLeaveKey(userId, roomId);
      const redisEntry = await redisStateService.get<{
        userId: string;
        roomId: string;
        timestamp: number;
        userData: User;
      }>(key);

      if (redisEntry && redisEntry.roomId === roomId) {
        const age = Date.now() - redisEntry.timestamp;
        if (age > this.INTENTIONAL_LEAVE_EXPIRY_MS) {
          // Expired — clean up
          redisStateService.del(key).catch(() => {});
          return false;
        }
        // Restore to in-memory map for future fast lookups
        this.intentionallyLeftUsers.set(userId, {
          roomId: redisEntry.roomId,
          timestamp: redisEntry.timestamp,
          userData: redisEntry.userData,
        });
        return true;
      }
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomCleanupService.hasUserIntentionallyLeft.redisFallback',
        roomId,
        userId,
      });
    }

    return false;
  }

  removeFromIntentionallyLeft(userId: string): void {
    // Clear from in-memory map
    const entry = this.intentionallyLeftUsers.get(userId);
    this.intentionallyLeftUsers.delete(userId);

    // Clear from Redis if we know the roomId
    if (entry) {
      const key = this.getIntentionalLeaveKey(userId, entry.roomId);
      redisStateService.del(key).catch((error: unknown) => {
        loggingService.logWarn('Failed to remove intentional leave from Redis', {
          error: String(error),
          userId,
          roomId: entry.roomId,
        });
      });
    }
  }

  cleanupExpiredIntentionalLeaves(): void {
    const now = Date.now();
    for (const [userId, entry] of this.intentionallyLeftUsers.entries()) {
      if (now - entry.timestamp > this.INTENTIONAL_LEAVE_EXPIRY_MS) {
        this.intentionallyLeftUsers.delete(userId);
      }
    }
  }

  clearRoomIntentionalLeaves(roomId: string): void {
    for (const [userId, entry] of this.intentionallyLeftUsers.entries()) {
      if (entry.roomId === roomId) {
        this.intentionallyLeftUsers.delete(userId);
        const key = this.getIntentionalLeaveKey(userId, roomId);
        redisStateService.del(key).catch((error: unknown) => {
          loggingService.logWarn('Failed to remove intentional leave from Redis during room cleanup', {
            error: String(error),
            userId,
            roomId,
          });
        });
      }
    }
  }

  // Room Cleanup Logic
  async shouldCloseRoom(roomId: string, aggressiveMode: boolean = false): Promise<boolean> {
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return true;

    // Primary check: band members from getRoom (populated via getBandMembers which
    // returns [] on Redis error — fail-open). Only trust this when it returns > 0.
    const activeBandMembers = Array.from(room.bandMembers.values());
    if (activeBandMembers.length > 0) {
      return false;
    }

    // Secondary strict check: hasBandMembersStrict throws on Redis error so we can
    // treat the failure as "has members" (fail-safe). This catches the scenario where
    // getBandMembers silently returned [] due to a transient Redis error.
    try {
      const hasMembers = await roomUserRepository.hasBandMembersStrict(roomId);
      if (hasMembers) {
        return false;
      }
    } catch (err) {
      loggingService.logError(err instanceof Error ? err : new Error(String(err)), {
        context: 'RoomCleanupService.shouldCloseRoom.hasBandMembersStrict',
        roomId,
      });
      return false; // fail-safe: unknown membership state → don't delete
    }

    // DEV-221: an isolated tour room has no legitimate reason to linger once its owner (the only
    // possible member) is gone — skip the grace-period reprieve and close it now.
    if (room.isIsolated && activeBandMembers.length === 0) {
      return true;
    }

    const gracePeriodUsers =
      namespaceGracePeriodManager.getRoomGracePeriodUsers(roomId);

    // Aggressive Mode: Force cleanup for rooms older than 5 minutes with no grace period users
    // This prevents orphan rooms from staying in Redis indefinitely
    if (aggressiveMode) {
      const roomAgeMs = Date.now() - new Date(room.createdAt).getTime();
      const AGGRESSIVE_CLEANUP_AGE_MS = 5 * 60 * 1000; // 5 minutes
      
      if (roomAgeMs > AGGRESSIVE_CLEANUP_AGE_MS && gracePeriodUsers.length === 0) {
        loggingService.logInfo('Aggressive cleanup: Deleting old room with no grace period users', {
          roomId,
          roomAgeMinutes: Math.floor(roomAgeMs / 60000),
          bandMembersCount: activeBandMembers.length,
          gracePeriodUsersCount: gracePeriodUsers.length
        });
        return true; // Force cleanup
      }
    }

    let hasGracePeriodMusician = false;
    for (const entry of gracePeriodUsers) {
      // Check if this user has intentionally left (and leave is still valid)
      const hasIntentionallyLeft = await this.hasUserIntentionallyLeft(entry.userId, roomId);
      if (hasIntentionallyLeft) {
        continue; // skip this user — they left intentionally
      }

      const userRole = entry.userData.role;
      if (userRole === "room_owner" || userRole === "band_member") {
        hasGracePeriodMusician = true;
        break;
      }
    }

    return !hasGracePeriodMusician;
  }

  async cleanupExpiredGraceTime(aggressiveMode: boolean = false): Promise<string[]> {
    // Clean up expired grace period entries and get rooms to delete
    const roomsNeedingCleanup = namespaceGracePeriodManager.cleanupExpiredGracePeriods();

    // Clean up expired intentional leave entries
    this.cleanupExpiredIntentionalLeaves();

    // Check which rooms should actually be deleted
    const roomsToDelete: string[] = [];

    // Check rooms from grace period cleanup
    for (const roomId of roomsNeedingCleanup) {
      if (await this.shouldCloseRoom(roomId, aggressiveMode)) {
        roomsToDelete.push(roomId);
      }
    }

    // Check all rooms for immediate cleanup (no active users)
    const allRooms = await this.roomRepository.getAllRooms();
    for (const room of allRooms) {
      if (await this.shouldCloseRoom(room.id, aggressiveMode)) {
        roomsToDelete.push(room.id);
      }
    }

    // Deduplicate
    const uniqueRoomsToDelete = Array.from(new Set(roomsToDelete));

    // Execute deletion — only return rooms that were actually deleted
    const deletedRooms: string[] = [];
    for (const roomId of uniqueRoomsToDelete) {
      // Fetch before deletion to access invite codes for cleanup
      const roomBeforeDelete = await this.roomRepository.getRoom(roomId);
      const isDeleted = await this.roomRepository.deleteRoom(roomId);
      if (isDeleted) {
        // Clear grace period data for this room
        namespaceGracePeriodManager.cleanupRoomGracePeriod(roomId);
        // Clear intentional leaves
        this.clearRoomIntentionalLeaves(roomId);

        // Clear Redis room membership cache to prevent stale cache entries
        try {
          const redis = await getRedisClient();
          await clearRoomMembership(redis, roomId);
        } catch (err) {
          loggingService.logError(err instanceof Error ? err : new Error(String(err)), {
            context: 'RoomCleanupService.cleanupExpiredGraceTime.clearRoomMembership',
            roomId,
          });
        }

        // Remove invite codes from reverse-lookup index
        if (roomBeforeDelete) {
          const inviteCodeDels: Promise<unknown>[] = [];
          if (roomBeforeDelete.bandMemberInviteCode) {
            inviteCodeDels.push(redisStateService.hdel(REDIS_KEYS.INVITE_CODE_LOOKUP, roomBeforeDelete.bandMemberInviteCode));
          }
          if (roomBeforeDelete.audienceInviteCode) {
            inviteCodeDels.push(redisStateService.hdel(REDIS_KEYS.INVITE_CODE_LOOKUP, roomBeforeDelete.audienceInviteCode));
          }
          if (inviteCodeDels.length > 0) {
            await Promise.all(inviteCodeDels).catch((err: unknown) => {
              loggingService.logError(err instanceof Error ? err : new Error(String(err)), {
                context: 'RoomCleanupService.cleanupExpiredGraceTime.inviteCodeIndex',
                roomId,
              });
            });
          }
        }

        // Notify external systems (e.g. clear Redis project↔room mapping)
        if (this.onRoomDeletedCallback) {
          try {
            await this.onRoomDeletedCallback(roomId);
          } catch (error) {
            loggingService.logError(error as Error, { context: 'RoomCleanupService.onRoomDeletedCallback', roomId });
          }
        }

        loggingService.logInfo(`Deleted empty room: ${roomId}`, {
          roomId,
          aggressiveMode
        });
        deletedRooms.push(roomId);
      }
    }

    return deletedRooms;
  }

  // ── Private helpers (declared after public members per member-ordering) ──

  private getIntentionalLeaveKey(userId: string, roomId: string): string {
    return `intentional_leave:${userId}:${roomId}`;
  }

  /**
   * Persist intentional leave entry to Redis with TTL for cross-process / crash recovery.
   */
  private persistIntentionalLeaveToRedis(userId: string, roomId: string, userData: User): void {
    const key = this.getIntentionalLeaveKey(userId, roomId);
    redisStateService.set(key, { userId, roomId, timestamp: Date.now(), userData }, this.INTENTIONAL_LEAVE_REDIS_TTL)
      .catch((error: unknown) => {
        loggingService.logWarn('Failed to persist intentional leave to Redis', {
          error: String(error),
          userId,
          roomId,
        });
      });
  }
}
