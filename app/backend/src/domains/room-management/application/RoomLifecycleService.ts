/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { v4 as uuidv4 } from "uuid";
import type { Room, User, BandMember, UserSession } from "../../../types";
import { RoomType } from "../../../types";
import type { RoomRepository } from "../infrastructure/repositories/RoomRepository";
import type { RoomCleanupService } from "../domain/services/RoomCleanupService";
import type { RoomSessionManager } from "../infrastructure/services/RoomSessionManager";
import type { NamespaceGracePeriodManager } from "../../../shared/infrastructure/namespace/NamespaceGracePeriodManager";
import type { GracePeriodEntry } from "../../../shared/infrastructure/namespace/NamespaceGracePeriodManager";
import type { EffectChainService } from "../../audio-processing/infrastructure/services/EffectChainService";
import type { ArrangeRoomStateService } from "../../arrange-room/application/ArrangeRoomStateService";
import type { PerformRoomStateService } from "../../perform-room/application/PerformRoomStateService";
import { CacheService } from "../../../shared/infrastructure/caching/CacheService";
import { CACHE_KEYS } from "../../../shared/constants/CacheKeys";
import { REDIS_KEYS } from "../../../shared/constants/RedisKeys";
import { METRONOME_CONSTANTS, ROOM_CREATION_GRACE_PERIOD_MS, INSTRUMENT_CONSTANTS } from '@jam-band/shared';
import { loggingService } from "../../../shared/infrastructure/logging/LoggingService";
import type { RoomUserService } from "../domain/services/RoomUserService"; // Needed for removeUserFromRoom helper call in cleanup
import type { RoomSettingsService } from "../infrastructure/services/RoomSettingsService";
import { getRedisClient } from "../../../config/redis";
import { redisStateService } from "../../../shared/infrastructure/caching/RedisStateService";
import { clearRoomMembership } from "../../../shared/utils/redisCacheUtils";
import { projectRoomService } from "../../arrange-room/infrastructure/storage/ProjectRoomService";

/** Live occupancy snapshot for one room, matching the lobby card's count fields. */
export interface RoomOccupancy {
  activeBandMemberCount: number;
  audienceCount: number;
  companionCount: number;
  userCount: number;
  roomType: RoomType;
  isBroadcasting: boolean;
}

export class RoomLifecycleService {
  private readonly cacheService = CacheService.getInstance();

  /**
   * DEV-258: counts sockets connected to THIS process's Socket.IO server across all
   * namespaces. Wired by the composition root (registerBackgroundJobs); null until then.
   * Powers the zero-socket sanity fuse in {@link cleanupGhostUsers}.
   */
  private localSocketCounter: (() => number) | null = null;

  constructor(
    private readonly roomRepository: RoomRepository,
    private readonly roomCleanupService: RoomCleanupService,
    private readonly roomSessionManager: RoomSessionManager,
    private readonly namespaceGracePeriodManager: NamespaceGracePeriodManager,
    private readonly arrangeRoomStateService: ArrangeRoomStateService,
    private readonly effectChainService: EffectChainService,
    private readonly roomUserService: RoomUserService, // Needed for cleanupGhostUsers calling removeUserFromRoom
    private readonly roomSettingsService: RoomSettingsService,
    private readonly performRoomStateService?: PerformRoomStateService
  ) { }

  async createRoom(
    name: string,
    username: string,
    userId: string,
    isPrivate: boolean = false,
    isHidden: boolean = false,
    description?: string,
    roomType: RoomType = RoomType.PERFORM,
    currentInstrument?: string,
    currentCategory?: string,
    profilePictureUrl?: string | null,
    isIsolated: boolean = false
  ): Promise<{ room: Room; user: User; session: UserSession }> {
    const roomId = uuidv4();
    const bandMemberInviteCode = `BM-${uuidv4().substring(0, 8).toUpperCase()}`;
    const audienceInviteCode = `AUD-${uuidv4().substring(0, 8).toUpperCase()}`;

    const room: Room = {
      id: roomId,
      name,
      ...(description && { description }),
      roomType,
      owner: userId,
      bandMembers: new Map(),
      audiences: new Map(),
      pendingMembers: new Map(),
      isPrivate,
      isHidden,
      isIsolated,
      createdAt: new Date(),
      metronome: {
        bpm: METRONOME_CONSTANTS.DEFAULT_BPM,
        beatZeroAt: Date.now(),
      },
      bandMemberInviteCode,
      audienceInviteCode,
    };

    const owner: BandMember = {
      id: userId,
      username,
      role: "room_owner",
      isReady: true,
      followScale: false,
      currentInstrument: currentInstrument || INSTRUMENT_CONSTANTS.DEFAULT_INSTRUMENT,
      currentCategory: currentCategory || INSTRUMENT_CONSTANTS.DEFAULT_CATEGORY,
      profilePictureUrl: profilePictureUrl || null,
    };

    this.effectChainService.ensureUserEffectChains(owner);

    // Save room first
    await this.roomRepository.saveRoom(room);

    // Add owner to room via roomUserService with effect chain initializer
    await this.roomUserService.addUserToRoom(roomId, owner, (user: BandMember) => {
      this.effectChainService.ensureUserEffectChains(user);
    });

    // Build invite code reverse-lookup index (O(1) lookup for /api/rooms/invite/:code)
    await Promise.all([
      redisStateService.hset(REDIS_KEYS.INVITE_CODE_LOOKUP, bandMemberInviteCode, roomId),
      redisStateService.hset(REDIS_KEYS.INVITE_CODE_LOOKUP, audienceInviteCode, roomId),
    ]).catch((err) => {
      loggingService.logError(err instanceof Error ? err : new Error(String(err)), {
        context: 'RoomLifecycleService.createRoom.inviteCodeIndex',
        roomId,
      });
    });

    // Invalidate room list cache
    await this.roomRepository.invalidateListCaches();

    const session: UserSession = { roomId, userId };
    return { room, user: owner, session };
  }

  async getRoom(roomId: string): Promise<Room | undefined> {
    return await this.roomRepository.getRoom(roomId);
  }

  /**
   * Isolated rooms (e.g. onboarding-tour rooms, DEV-221) owned by a given user. Reads the raw,
   * unfiltered repository list — {@link getAllRooms} filters isolated rooms out since they're
   * never shown in the lobby. Used to enforce the "one isolated room per owner" cap.
   */
  async getIsolatedRoomsOwnedBy(userId: string): Promise<Room[]> {
    const allRooms = await this.roomRepository.getAllRooms();
    return allRooms.filter((room) => room.isIsolated && room.owner === userId);
  }

  async getAllRooms(isAuthenticated: boolean = false) {
    // Try cache first (use different cache keys for authenticated vs guest)
    const cacheKey = isAuthenticated ? CACHE_KEYS.ROOMS_LIST_AUTHENTICATED : CACHE_KEYS.ROOMS_LIST_PUBLIC;
    const cachedRooms = this.cacheService.getCachedRoomList(cacheKey);
    if (cachedRooms) {
      return cachedRooms;
    }

    // Get from repository
    const allRooms = await this.roomRepository.getAllRooms();
    
    const rooms = (await Promise.all(
      allRooms.map(async (room) => {
        // Hidden and isolated rooms are never shown in room list
        // They can only be accessed via invite URL
        if (room.isHidden || room.isIsolated) {
          return null;
        }

        const roomAgeMs = Date.now() - new Date(room.createdAt).getTime();
        const isWithinCreationGracePeriod = roomAgeMs < ROOM_CREATION_GRACE_PERIOD_MS;

        const { activeBandMemberCount: rawBandMemberCount, audienceCount } =
          await this.countActiveOccupants(room.id, isWithinCreationGracePeriod);

        // Keep newly created rooms visible during grace period even if session
        // registration is slightly delayed, to avoid flicker/race in lobby list.
        const activeBandMemberCount =
          rawBandMemberCount + audienceCount <= 0 && isWithinCreationGracePeriod
            ? 1
            : rawBandMemberCount;

        const effectiveUserCount = activeBandMemberCount + audienceCount;
        if (effectiveUserCount <= 0) {
          return null;
        }

        const roomData: Record<string, unknown> = {
          id: room.id,
          name: room.name,
          description: room.description ?? "",
          roomType: room.roomType ?? RoomType.PERFORM,
          userCount: effectiveUserCount,
          activeBandMemberCount,
          owner: room.owner,
          isPrivate: room.isPrivate,
          createdAt: room.createdAt,
          isBroadcasting: room.isBroadcasting ?? false,
        };

        // Only include audienceCount for perform rooms that are broadcasting
        if (room.roomType === RoomType.PERFORM && room.isBroadcasting) {
          roomData.audienceCount = audienceCount;
        }

        // Surface companion usage for perform rooms so outsiders can see a room is
        // jamming with AI companions (e.g. members 1, companions 5 → solo-with-companions).
        const companionCount = await this.getCompanionCount(room.id, room.roomType);
        if (companionCount > 0) {
          roomData.companionCount = companionCount;
        }

        // Only include isHidden field for authenticated users
        // Guest users should not know which rooms are hidden
        if (isAuthenticated) {
          roomData.isHidden = room.isHidden;
        }

        return roomData;
      })
    )).filter((room): room is NonNullable<typeof room> => room !== null);

    // Cache for 10 seconds to balance load and freshness
    await this.roomRepository.cacheRoomList(cacheKey, rooms, 10);

    return rooms;
  }

  /**
   * Live occupancy snapshot for a single room, in the same shape the lobby card
   * consumes. Used to enrich the lobby's real-time room-update broadcast so
   * member/companion/audience counts stay fresh without a full list refetch.
   */
  async getRoomOccupancy(roomId: string): Promise<RoomOccupancy | null> {
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) {
      return null;
    }

    const roomAgeMs = Date.now() - new Date(room.createdAt).getTime();
    const isWithinCreationGracePeriod = roomAgeMs < ROOM_CREATION_GRACE_PERIOD_MS;

    const { activeBandMemberCount, audienceCount } = await this.countActiveOccupants(
      roomId,
      isWithinCreationGracePeriod,
    );
    const companionCount = await this.getCompanionCount(roomId, room.roomType);
    const isBroadcasting = room.isBroadcasting ?? false;
    const roomType = room.roomType ?? RoomType.PERFORM;

    return {
      activeBandMemberCount,
      // Audience count is only meaningful for broadcasting perform rooms (matches getAllRooms).
      audienceCount: roomType === RoomType.PERFORM && isBroadcasting ? audienceCount : 0,
      companionCount,
      userCount: activeBandMemberCount + audienceCount,
      roomType,
      isBroadcasting,
    };
  }

  async deleteRoom(roomId: string): Promise<boolean> {
    // Fetch room data before deletion so we can remove invite codes from the lookup index
    const roomBeforeDelete = await this.roomRepository.getRoom(roomId);

    const isDeleted = await this.roomRepository.deleteRoom(roomId);
    if (isDeleted) {
      // Clear grace period data for this room
      this.namespaceGracePeriodManager.cleanupRoomGracePeriod(roomId);
      // Clear intentional leaves
      this.roomCleanupService.clearRoomIntentionalLeaves(roomId);
      // Clean up arrange room state (Hybrid Persistence)
      void this.arrangeRoomStateService.deleteState(roomId);
      // Clean up perform room state
      if (this.performRoomStateService) {
        this.performRoomStateService.deleteState(roomId).catch((err2: unknown) => {
          loggingService.logError(err2 instanceof Error ? err2 : new Error(String(err2)), {
            context: 'RoomLifecycleService.deleteRoom.performStateCleanup',
            roomId,
          });
        });
      }
      // Clear Redis room membership cache to prevent stale cache entries
      try {
        const redis = await getRedisClient();
        await clearRoomMembership(redis, roomId);

        // Remove invite codes from the reverse-lookup index
        const inviteCodeDels: Promise<unknown>[] = [];
        if (roomBeforeDelete?.bandMemberInviteCode) {
          inviteCodeDels.push(
            redisStateService.hdel(REDIS_KEYS.INVITE_CODE_LOOKUP, roomBeforeDelete.bandMemberInviteCode)
          );
        }
        if (roomBeforeDelete?.audienceInviteCode) {
          inviteCodeDels.push(
            redisStateService.hdel(REDIS_KEYS.INVITE_CODE_LOOKUP, roomBeforeDelete.audienceInviteCode)
          );
        }
        if (inviteCodeDels.length > 0) {
          await Promise.all(inviteCodeDels).catch((err: unknown) => {
            loggingService.logError(err instanceof Error ? err : new Error(String(err)), {
              context: 'RoomLifecycleService.deleteRoom.inviteCodeIndex',
              roomId,
            });
          });
        }
      } catch (err) {
        loggingService.logError(err instanceof Error ? err : new Error(String(err)), {
          context: 'RoomLifecycleService.deleteRoom.clearRoomMembership',
          roomId,
        });
      }
      // Clear Redis project↔room mapping (BR-1: 1 project = 1 room)
      await projectRoomService.clearActiveRoomByRoomId(roomId).catch((err: unknown) => {
        loggingService.logError(err instanceof Error ? err : new Error(String(err)), {
          context: 'RoomLifecycleService.deleteRoom.clearActiveRoom',
          roomId,
        });
      });
    } else {
      loggingService.logWarn('deleteRoom: room already deleted (concurrent cleanup race)', {
        roomId,
        context: 'RoomLifecycleService.deleteRoom',
      });
    }
    return isDeleted;
  }

  async shouldCloseRoom(roomId: string): Promise<boolean> {
    return await this.roomCleanupService.shouldCloseRoom(roomId);
  }

  // Cleanup Logic

  /** DEV-258: see {@link localSocketCounter}. */
  setLocalSocketCounter(counter: () => number): void {
    this.localSocketCounter = counter;
  }

  /** True when any room in Redis currently holds band members or audiences. */
  async hasAnyRoomOccupants(): Promise<boolean> {
    const rooms = await this.roomRepository.getAllRooms();
    return rooms.some((room) => room.bandMembers.size + room.audiences.size > 0);
  }

  async cleanupGhostUsers(): Promise<void> {
    // Get raw room entities from repository to access users Map
    const rooms = await this.roomRepository.getAllRooms();

    const totalOccupants = rooms.reduce(
      (sum, room) => sum + room.bandMembers.size + room.audiences.size,
      0,
    );
    if (totalOccupants === 0) return;

    // DEV-258 runtime guard — load-bearing, do NOT remove (TR-31): a process whose own
    // Socket.IO server has zero connected sockets cannot judge presence — to it, EVERY
    // occupant in shared Redis looks like a ghost. A zombie dev process (orphaned tsx
    // child) ghost-killed all live rooms this way (FAILURE_PATTERNS Pattern 10); the
    // same happens for any non-serving replica or deploy overlap. A serving process
    // always holds at least the sockets it is about to judge, so occupants > 0 with
    // zero local sockets means "not the serving process", never "everyone left".
    // Fail-safe trade-off: a truly idle server skips ghost cleanup until the next
    // client connects — stale rooms linger invisibly instead of live rooms dying.
    if (this.localSocketCounter && this.localSocketCounter() === 0) {
      loggingService.logWarn(
        'Ghost user cleanup skipped: this process has zero connected sockets while rooms show occupants — likely a non-serving (zombie/replica) process',
        { totalOccupants, roomCount: rooms.length },
      );
      return;
    }

    // Grace period for newly created rooms (30 seconds) — allow users time to connect socket
    const ROOM_GRACE_PERIOD_MS = 30_000;

    for (const room of rooms) {
      const totalUsers = room.bandMembers.size + room.audiences.size;
      if (totalUsers === 0) continue;

      // Skip ghost user cleanup for newly created rooms — users need time to connect socket
      const roomAgeMs = Date.now() - new Date(room.createdAt).getTime();
      if (roomAgeMs < ROOM_GRACE_PERIOD_MS) {
        continue;
      }

      // Copy values to array to avoid modification issues during iteration
      const allUsers = [...Array.from(room.bandMembers.values()), ...Array.from(room.audiences.values())];

      for (const user of allUsers) {
        // Skip user if they are in their grace period
        if (this.namespaceGracePeriodManager.isUserInGracePeriod(user.id, room.id)) {
          continue;
        }

        // Cross-process safe check: confirms user has an active Redis session in this room
        const isActiveInRoom = await this.roomSessionManager.isUserActiveInRoom(room.id, user.id);

        if (!isActiveInRoom) {
          // No active session found - this is a ghost user!
          loggingService.logInfo('Found ghost user - removing', {
            roomId: room.id,
            userId: user.id,
            username: user.username
          });

          // Remove them (true = isIntendedLeave = true)
          // We treat this as intended leave so they are NOT added to grace period
          // This allows the room to be closed immediately if empty
          await this.roomUserService.removeUserFromRoom(room.id, user.id, true);
        }
      }
    }
  }

  /**
   * Remove a specific user from a room if they have no active socket session.
   * Used by cleanupOrphanRedisSessions callback to sync room map after orphan session removal.
   */
  async removeUserIfGhost(roomId: string, userId: string): Promise<void> {
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return;

    const isInRoom = room.bandMembers.has(userId) || room.audiences.has(userId);
    if (!isInRoom) return;

    // Double-check: if user is in grace period, don't remove them
    if (this.namespaceGracePeriodManager.isUserInGracePeriod(userId, roomId)) return;

    // Cross-process safe check: confirms user has an active Redis session in this room
    const isActive = await this.roomSessionManager.isUserActiveInRoom(roomId, userId);
    if (isActive) return; // Still has active session — don't remove

    loggingService.logInfo('Removing ghost user from room map after orphan session cleanup', {
      roomId,
      userId,
    });
    await this.roomUserService.removeUserFromRoom(roomId, userId, true);
  }

  async cleanupExpiredGraceTime(aggressiveMode: boolean = false): Promise<string[]> {
    // Note: cleanupGhostUsers() is no longer called here.
    // The caller (index.ts cleanup timer) orchestrates the order:
    // ghost cleanup → grace period expiry → orphan session cleanup → targeted re-check.
    // This avoids redundant O(n) getAllRooms() scans (DEV-140).
    return await this.roomCleanupService.cleanupExpiredGraceTime(aggressiveMode);
  }

  cleanupExpiredIntentionalLeaves(): void {
    this.roomCleanupService.cleanupExpiredIntentionalLeaves();
  }

  // Grace Period Helpers
  getGracePeriodMs(): number {
    return this.namespaceGracePeriodManager.getGracePeriodMs();
  }

  isUserInGracePeriod(userId: string, roomId: string): boolean {
    return this.namespaceGracePeriodManager.isUserInGracePeriod(userId, roomId);
  }

  getRoomGracePeriodUsers(roomId: string): GracePeriodEntry[] {
    return this.namespaceGracePeriodManager.getRoomGracePeriodUsers(roomId);
  }

  async removeFromGracePeriod(userId: string, roomId?: string): Promise<void> {
    if (roomId) {
      this.namespaceGracePeriodManager.removeFromGracePeriod(userId, roomId);
      return;
    }
    // Fallback to remove from all rooms
    const rooms = await this.roomRepository.getAllRooms();
    for (const room of rooms) {
      const isRemoved = this.namespaceGracePeriodManager.removeFromGracePeriod(userId, room.id);
      if (isRemoved) break;
    }
  }

  getGracePeriodUserData(userId: string, roomId: string): User | null {
    const namespaceEntry = this.namespaceGracePeriodManager.getGracePeriodEntry(userId, roomId);
    return namespaceEntry ? namespaceEntry.userData : null;
  }

  rekeyGracePeriodEntry(
    roomId: string,
    oldUserId: string,
    newUserId: string,
    updatedUserData: User
  ): boolean {
    return this.namespaceGracePeriodManager.rekeyGracePeriodEntry(roomId, oldUserId, newUserId, updatedUserData);
  }

  async hasUserIntentionallyLeft(userId: string, roomId: string): Promise<boolean> {
    return await this.roomCleanupService.hasUserIntentionallyLeft(userId, roomId);
  }

  markUserIntentionalLeave(userId: string, roomId: string): void {
    this.roomCleanupService.markIntentionalLeaveById(userId, roomId);
  }

  removeFromIntentionallyLeft(userId: string): void {
    this.roomCleanupService.removeFromIntentionallyLeft(userId);
  }

  async updateRoomSettings(roomId: string, settings: {
    name?: string;
    description?: string;
    isPrivate?: boolean;
    isHidden?: boolean;
  }): Promise<boolean> {
    return await this.roomSettingsService.updateRoomSettings(roomId, settings);
  }

  async toggleBroadcast(roomId: string, isBroadcasting: boolean): Promise<boolean> {
    return await this.roomSettingsService.toggleBroadcast(roomId, isBroadcasting);
  }

  async getBroadcastStatus(roomId: string): Promise<boolean> {
    return await this.roomSettingsService.getBroadcastStatus(roomId);
  }

  async getMetronomeState(
    roomId: string
  ): Promise<{ bpm: number; beatZeroAt: number } | null> {
    const room = await this.getRoom(roomId);
    if (!room) return null;

    return {
      bpm: room.metronome.bpm,
      beatZeroAt: room.metronome.beatZeroAt,
    };
  }

  async getRoomByInviteCode(
    code: string
  ): Promise<{ room: Room; role: 'band_member' | 'audience' } | undefined> {
    // O(1) lookup via Redis hash (invite code → roomId)
    try {
      const roomId = await redisStateService.hget<string>(REDIS_KEYS.INVITE_CODE_LOOKUP, code);

      if (roomId) {
        const room = await this.roomRepository.getRoom(roomId);
        if (room) {
          // Determine role from which invite code matched
          const role: 'band_member' | 'audience' =
            room.bandMemberInviteCode === code ? 'band_member' : 'audience';
          return { room, role };
        }
        // Room was deleted but index wasn't cleaned — remove stale entry
        await redisStateService.hdel(REDIS_KEYS.INVITE_CODE_LOOKUP, code).catch(() => undefined);
      }
    } catch (err) {
      loggingService.logError(err instanceof Error ? err : new Error(String(err)), {
        context: 'RoomLifecycleService.getRoomByInviteCode',
        code,
      });
      // Fall back to linear scan on Redis error
      const allRooms = await this.roomRepository.getAllRooms();
      for (const room of allRooms) {
        if (room.bandMemberInviteCode === code) {
          return { room, role: 'band_member' };
        }
        if (room.audienceInviteCode === code) {
          return { room, role: 'audience' };
        }
      }
    }
    return undefined;
  }

  async saveRoom(room: Room): Promise<void> {
    await this.roomRepository.saveRoom(room);
  }

  /**
   * DEV-208 identity swap: when a guest registers mid-session, any room they owned as a guest must
   * follow them to the new registered identity — the Room aggregate's `owner` field is the source of
   * truth for ownership-gated flows (e.g. save-from-room, which rejects a guest owner with
   * ROOM_OWNER_IS_GUEST). Without this rekey the field stays pinned to the vanished guest id even
   * though the member-list `room_owner` role is rekeyed via the grace-period restore, so the UI looks
   * correct but the save reports the owner as a guest. Hands the room to `newOwnerId`.
   *
   * DEV-221: for an isolated tour room this ALSO lifts isolation (only the owner may join an isolated
   * room, so the swap's grace-period rejoin would otherwise be rejected) — the room stays `isHidden`,
   * becoming a legit verified-hidden room. Non-isolated rooms just get the owner rekey.
   *
   * Guarded/idempotent: a no-op unless the room still exists and is still owned by `prevOwnerId`, so
   * calling it more than once (or after a prior call already transferred ownership) is safe.
   */
  async transferOwnershipAndUnisolate(roomId: string, newOwnerId: string, prevOwnerId: string): Promise<void> {
    const room = await this.roomRepository.getRoom(roomId);
    if (!room || room.owner !== prevOwnerId) return;

    room.owner = newOwnerId;
    if (room.isIsolated) room.isIsolated = false;
    await this.roomRepository.saveRoom(room);
  }

  /**
   * Counts only users with verified active sessions (or within a grace period) to
   * avoid ghost users in Redis inflating room occupancy. Shared by the REST room
   * list ({@link getAllRooms}) and the live lobby occupancy broadcast
   * ({@link getRoomOccupancy}) so both report identical member/audience counts.
   */
  private async countActiveOccupants(
    roomId: string,
    isWithinCreationGracePeriod: boolean,
  ): Promise<{ activeBandMemberCount: number; audienceCount: number }> {
    const [bandMembers, audiences] = await Promise.all([
      this.roomUserService.getBandMembers(roomId),
      this.roomUserService.getAudiences(roomId),
    ]);

    let activeBandMemberCount = 0;
    let audienceCount = 0;

    for (const user of [...bandMembers, ...audiences]) {
      if (await this.roomCleanupService.hasUserIntentionallyLeft(user.id, roomId)) {
        continue;
      }

      if (!isWithinCreationGracePeriod) {
        const isInGracePeriod = this.namespaceGracePeriodManager.isUserInGracePeriod(user.id, roomId);
        const isActive = isInGracePeriod
          ? true
          : await this.roomSessionManager.isUserActiveInRoom(roomId, user.id);
        if (!isActive) {
          continue;
        }
      }

      if (user.role === 'audience') {
        audienceCount++;
      } else {
        activeBandMemberCount++;
      }
    }

    return { activeBandMemberCount, audienceCount };
  }

  /**
   * Number of configured companions in a perform room (max 5), regardless of
   * play/mute state — a signal that a room is jamming with AI companions.
   * Returns 0 for arrange rooms or when perform state is unavailable.
   */
  private async getCompanionCount(roomId: string, roomType?: RoomType): Promise<number> {
    if ((roomType ?? RoomType.PERFORM) !== RoomType.PERFORM || !this.performRoomStateService) {
      return 0;
    }
    const performState = await this.performRoomStateService.getState(roomId);
    return performState?.companions.length ?? 0;
  }
}
