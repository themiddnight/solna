/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/member-ordering, @typescript-eslint/prefer-readonly, @typescript-eslint/naming-convention */
import { User, BandMember, Audience } from "../../../../types";
import { INSTRUMENT_CONSTANTS } from '@jam-band/shared';
import { RoomRepository } from "../../infrastructure/repositories/RoomRepository";
import { RoomCleanupService } from "./RoomCleanupService";
import { namespaceGracePeriodManager } from "../../../../shared/infrastructure/namespace/NamespaceGracePeriodManager";
import { roomUserRepository } from "../../infrastructure/repositories/RoomUserRepository";
import { cacheUserJoin, cacheUserLeave } from "../../../../shared/utils/redisCacheUtils";
import { getRedisClient } from "../../../../config/redis";
import { redisStateService } from "../../../../shared/infrastructure/caching/RedisStateService";
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";

export class RoomUserService {
  constructor(
    private roomRepository: RoomRepository,
    private roomCleanupService: RoomCleanupService
  ) { }

  // User Lookup
  async findUserInRoom(roomId: string, userId: string): Promise<User | undefined> {
    // Use RoomUserRepository for atomic read (no race condition)
    const user = await roomUserRepository.getUser(roomId, userId);
    return user || undefined;
  }

  async findUserInRoomByUsername(roomId: string, username: string): Promise<User | undefined> {
    // Use RoomUserRepository for atomic read
    const [bandMembers, audiences] = await Promise.all([
      roomUserRepository.getBandMembers(roomId),
      roomUserRepository.getAudiences(roomId),
    ]);
    const allUsers = [...bandMembers, ...audiences];
    return allUsers.find((u) => u.username === username);
  }

  // Membership Management
  private withBandMemberDefaults(member: BandMember): BandMember {
    return {
      ...member,
      // Joining band members follow the room scale by default; the room owner sets it and does not follow.
      followScale: member.followScale ?? member.role !== 'room_owner',
      currentInstrument: member.currentInstrument || INSTRUMENT_CONSTANTS.DEFAULT_INSTRUMENT,
      currentCategory: member.currentCategory || INSTRUMENT_CONSTANTS.DEFAULT_CATEGORY,
    };
  }

  async addBandMember(
    roomId: string,
    member: BandMember,
    effectChainsInitializer: (user: BandMember) => void
  ): Promise<boolean> {
    // Verify room exists
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return false;

    const normalizedMember = this.withBandMemberDefaults(member);

    // Initialize effect chains
    effectChainsInitializer(normalizedMember);

    // Use RoomUserRepository for atomic user add (no race condition with instrument updates)
    const success = await roomUserRepository.addUser(roomId, normalizedMember);
    if (!success) return false;

    // Cache user membership in Redis for realtime auth checks
    try {
      const redis = await getRedisClient();
      await cacheUserJoin(redis, roomId, member.id);
    } catch (err) {
      // Log but don't fail - Redis is optional optimization
      loggingService.logWarn('Failed to cache user join', { error: String(err) });
    }

    // Remove from intentionally left list if they were there
    this.roomCleanupService.removeFromIntentionallyLeft(member.id);

    // Invalidate list caches
    await this.roomRepository.invalidateRoomCache(roomId);
    await this.roomRepository.invalidateListCaches();

    return true;
  }

  async addAudience(
    roomId: string,
    audience: Audience
  ): Promise<boolean> {
    // Verify room exists
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return false;

    // Use RoomUserRepository for atomic user add (no race condition)
    const success = await roomUserRepository.addUser(roomId, audience);
    if (!success) return false;

    // Cache user membership in Redis for realtime auth checks
    try {
      const redis = await getRedisClient();
      await cacheUserJoin(redis, roomId, audience.id);
    } catch (err) {
      // Log but don't fail - Redis is optional optimization
      loggingService.logWarn('Failed to cache user join', { error: String(err) });
    }

    // Remove from intentionally left list if they were there
    this.roomCleanupService.removeFromIntentionallyLeft(audience.id);

    // Invalidate list caches
    await this.roomRepository.invalidateRoomCache(roomId);
    await this.roomRepository.invalidateListCaches();

    return true;
  }

  // Backward compatibility wrapper
  async addUserToRoom(
    roomId: string,
    user: User,
    effectChainsInitializer: (user: BandMember) => void
  ): Promise<boolean> {
    if (user.role === 'audience') {
      return this.addAudience(roomId, user as Audience);
    } else {
      return this.addBandMember(roomId, user as BandMember, effectChainsInitializer);
    }
  }

  async addPendingMember(roomId: string, member: BandMember): Promise<boolean> {
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return false;

    const normalizedMember = this.withBandMemberDefaults(member);

    // เฉพาะ band members เท่านั้นที่ต้อง approve
    room.pendingMembers.set(normalizedMember.id, normalizedMember);
    await this.roomRepository.saveRoom(room);
    return true;
  }

  async approveMember(roomId: string, userId: string): Promise<BandMember | undefined> {
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return undefined;

    const pendingMember = room.pendingMembers.get(userId);
    if (!pendingMember) return undefined;

    const normalizedPendingMember = this.withBandMemberDefaults(pendingMember);

    // Use RoomUserRepository for atomic user add
    const success = await roomUserRepository.addUser(roomId, normalizedPendingMember);
    if (!success) return undefined;

    // Remove from pending in memory room object
    room.pendingMembers.delete(userId);
    await this.roomRepository.saveRoom(room);

    // Cache user membership in Redis for realtime auth checks
    try {
      const redis = await getRedisClient();
      await cacheUserJoin(redis, roomId, userId);
    } catch (err) {
      loggingService.logWarn('Failed to cache user join', { error: String(err) });
    }

    // Invalidate caches
    await this.roomRepository.invalidateRoomCache(roomId);
    await this.roomRepository.invalidateListCaches();

    return normalizedPendingMember;
  }

  async rejectMember(roomId: string, userId: string): Promise<BandMember | undefined> {
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return undefined;

    const pendingMember = room.pendingMembers.get(userId);
    if (!pendingMember) return undefined;

    // Already exists in room.pendingMembers (Map)
    room.pendingMembers.delete(userId);
    await this.roomRepository.saveRoom(room);

    // Invalidate caches
    await this.roomRepository.invalidateRoomCache(roomId);
    await this.roomRepository.invalidateListCaches();

    return pendingMember;
  }

  async removeUserFromRoom(
    roomId: string,
    userId: string,
    isIntendedLeave: boolean = false
  ): Promise<User | undefined> {
    // Get user data before removing
    const user = await roomUserRepository.getUser(roomId, userId);
    if (!user) {
      return undefined;
    }

    // Verify room exists
    const room = await this.roomRepository.getRoom(roomId);
    if (!room) {
      return undefined;
    }

    // Use RoomUserRepository for atomic user removal (no race condition)
    const success = await roomUserRepository.removeUser(roomId, userId);
    if (!success) {
      return undefined;
    }

    // Remove from Redis membership cache for realtime auth
    try {
      const redis = await getRedisClient();
      await cacheUserLeave(redis, roomId, userId);
    } catch (err) {
      // Log but don't fail - Redis is optional optimization
      loggingService.logWarn('Failed to remove user from cache', { error: String(err) });
    }

    // Also remove from pending members if exists (still uses room object for pending)
    room.pendingMembers.delete(userId);
    await this.roomRepository.saveRoom(room);

    if (isIntendedLeave) {
      // For intentional leave, delegate to cleanup service
      this.roomCleanupService.markIntentionalLeave(userId, roomId, user);
    } else {
      // Grace period เฉพาะ band members (ไม่ใช้กับ audience)
      if (user.role !== 'audience') {
        namespaceGracePeriodManager.addToGracePeriod(
          userId,
          roomId,
          `/room/${roomId}`,
          user,
          false
        );
      }
    }

    // Invalidate caches since user count has changed
    await this.roomRepository.invalidateRoomCache(roomId);
    await this.roomRepository.invalidateListCaches();

    return user;
  }

  /**
   * Change a user's role in-place without removing/re-adding them.
   * Avoids the 0-user window where remove-then-add could trigger
   * aggressive room cleanup (DEV-139).
   */
  async changeUserRole(
    roomId: string,
    userId: string,
    newRole: 'room_owner' | 'band_member' | 'audience',
  ): Promise<boolean> {
    const success = await roomUserRepository.changeUserRole(roomId, userId, newRole);
    if (!success) {
      return false;
    }

    // If user is in grace period, update their role there too
    const graceEntry = namespaceGracePeriodManager.getGracePeriodEntry(userId, roomId);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
    if (graceEntry && graceEntry.userData) {
      namespaceGracePeriodManager.addToGracePeriod(
        userId,
        roomId,
        graceEntry.namespacePath,
        { ...graceEntry.userData, role: newRole } as unknown as User,
        false,
      );
    }

    // Invalidate caches since user role has changed
    await this.roomRepository.invalidateRoomCache(roomId);
    await this.roomRepository.invalidateListCaches();

    return true;
  }

  // Ownership Management
  async transferOwnership(
    roomId: string,
    newOwnerId: string,
    oldOwner?: BandMember
  ): Promise<{ newOwner: BandMember; oldOwner: BandMember } | undefined> {
    // COLL-12 FIX: Use distributed lock to prevent race conditions on multi-server deployment
    // Lock key format: "room-owner-mutation:{roomId}"
    const lockKey = `room-owner-mutation:${roomId}`;
    
    return await redisStateService.executeWithLock(
      lockKey,
      5000,  // 5s timeout
      10000, // 10s TTL
      async () => {
        const room = await this.roomRepository.getRoom(roomId);
        if (!room) return undefined;

        // Transfer ownership เฉพาะ band members เท่านั้น
        let newOwner = room.bandMembers.get(newOwnerId);

        if (!newOwner) {
          // Select first available band member that is not the current owner
          for (const member of room.bandMembers.values()) {
            if (member.id !== room.owner) {
              newOwner = member;
              break;
            }
          }
          // If still not found and there is at least one band member, pick the first
          if (!newOwner && room.bandMembers.size > 0) {
            newOwner = Array.from(room.bandMembers.values())[0];
          }
        }

        if (!newOwner) return undefined;

        let actualOldOwner = oldOwner;
        if (!actualOldOwner) {
          actualOldOwner =
            room.bandMembers.get(room.owner) ||
            ({ id: room.owner, username: "", role: "band_member", isReady: false } as BandMember);
        }

        // Perform ownership update
        room.owner = newOwner.id;
        newOwner.role = "room_owner";
        newOwner.followScale = false;

        // Preserve existing instruments or use defaults only as fallback
        if (!newOwner.currentInstrument || !newOwner.currentCategory) {
          newOwner.currentInstrument = INSTRUMENT_CONSTANTS.DEFAULT_INSTRUMENT;
          newOwner.currentCategory = INSTRUMENT_CONSTANTS.DEFAULT_CATEGORY;
        }

        // Demote old owner
        let persistedOldOwner: BandMember | undefined;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
        if (actualOldOwner && room.bandMembers.has(actualOldOwner.id)) {
          const foundOld = room.bandMembers.get(actualOldOwner.id)!;
          foundOld.role = "band_member";
          actualOldOwner = foundOld;
          persistedOldOwner = foundOld;
        }

        // User membership data is stored separately from room metadata. Keep it in
        // sync so fresh room payloads do not re-promote the previous owner.
        await roomUserRepository.addUser(roomId, newOwner);
        if (persistedOldOwner && persistedOldOwner.id !== newOwner.id) {
          await roomUserRepository.addUser(roomId, persistedOldOwner);
        }

        await this.roomRepository.saveRoom(room);

        return { newOwner, oldOwner: actualOldOwner };
      }
    );
  }

  // Helpers
  async getAnyUserInRoom(roomId: string): Promise<User | undefined> {
    const [bandMembers, audiences] = await Promise.all([
      roomUserRepository.getBandMembers(roomId),
      roomUserRepository.getAudiences(roomId),
    ]);

    if (bandMembers.length > 0) return bandMembers[0];
    if (audiences.length > 0) return audiences[0];
    return undefined;
  }

  async getOwnershipCandidate(roomId: string): Promise<BandMember | undefined> {
    const bandMembers = await roomUserRepository.getBandMembers(roomId);
    if (bandMembers.length === 0) return undefined;

    const room = await this.roomRepository.getRoom(roomId);
    if (!room) return undefined;

    // Primary: prefer members whose ID is not the current owner (room.owner still points to the
    // departing owner at this point — ownership hasn't been transferred yet).
    const candidates = bandMembers.filter((member) => member.id !== room.owner);

    if (candidates.length > 0) return candidates[0];

    // Secondary fallback: if all members share the owner ID (edge case where room.owner was
    // already cleared or a promoted member re-joined), prefer someone who isn't currently
    // carrying the 'room_owner' role to avoid a no-op transfer.
    const nonOwnerRoleCandidates = bandMembers.filter((member) => member.role !== 'room_owner');
    if (nonOwnerRoleCandidates.length > 0) return nonOwnerRoleCandidates[0];

    // Last resort: pick the first available member (caller must handle the no-op case)
    return bandMembers[0];
  }

  async getRoomUsers(roomId: string): Promise<User[]> {
    const [bandMembers, audiences] = await Promise.all([
      roomUserRepository.getBandMembers(roomId),
      roomUserRepository.getAudiences(roomId),
    ]);
    return [...bandMembers, ...audiences];
  }

  async getPendingMembers(roomId: string): Promise<BandMember[]> {
    const room = await this.roomRepository.getRoom(roomId);
    return room ? Array.from(room.pendingMembers.values()) : [];
  }

  async getBandMembers(roomId: string): Promise<BandMember[]> {
    return await roomUserRepository.getBandMembers(roomId);
  }

  async getAudiences(roomId: string): Promise<Audience[]> {
    return await roomUserRepository.getAudiences(roomId);
  }

  async isRoomOwner(roomId: string, userId: string): Promise<boolean> {
    const room = await this.roomRepository.getRoom(roomId);
    return room?.owner === userId;
  }
}
