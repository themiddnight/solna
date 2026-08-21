/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/naming-convention, @typescript-eslint/strict-boolean-expressions */
import type { BandMember, Audience, User } from "../../../../types";
import type { EffectChainType, EffectChainState } from "../../../../types";
import { redisStateService } from "../../../../shared/infrastructure/caching/RedisStateService";
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { REDIS_KEYS } from "../../../../shared/constants/RedisKeys";

/**
 * RoomUserRepository - Manages user data separately from room metadata
 * This prevents race conditions between user joins and instrument updates
 */
export class RoomUserRepository {

  /**
   * Add user to room (atomic operation)
   */
  async addUser(roomId: string, user: User): Promise<boolean> {
    try {
      const userDataKey = REDIS_KEYS.roomMemberData(roomId, user.id);
      const isBandMember = user.role === 'room_owner' || user.role === 'band_member';
      const setKey = isBandMember
        ? REDIS_KEYS.roomMembers(roomId)
        : REDIS_KEYS.roomAudiences(roomId);

      // Both operations must succeed. RedisStateService catches its own errors and
      // returns false (never throws), so Promise.all always resolves — we must
      // inspect the results explicitly to detect partial failures.
      // If sadd silently fails and we return true, the user won't appear in the
      // members set and the cleanup scan will see the room as empty and delete it.
      const [setSuccess, saddSuccess] = await Promise.all([
        redisStateService.set(userDataKey, user),
        redisStateService.sadd(setKey, user.id),
      ]);

      if (!setSuccess || !saddSuccess) {
        loggingService.logError(
          new Error('addUser: partial Redis write failure — user not fully registered'),
          {
            context: 'RoomUserRepository.addUser',
            roomId,
            userId: user.id,
            setSuccess,
            saddSuccess,
          },
        );

        // Rollback the operation that succeeded to prevent orphaned data
        if (setSuccess && !saddSuccess) {
          // User data was written but set membership wasn't — clean up the orphaned key
          const rollbackResult = await redisStateService.del(userDataKey);
          if (!rollbackResult) {
            loggingService.logError(new Error('addUser: rollback of userDataKey failed'), {
              context: 'RoomUserRepository.addUser.rollback',
              roomId,
              userId: user.id,
            });
          }
        } else if (!setSuccess && saddSuccess) {
          // Set membership was written but user data wasn't — clean up the orphaned set entry
          const rollbackResult = await redisStateService.srem(setKey, user.id);
          if (!rollbackResult) {
            loggingService.logError(new Error('addUser: rollback of set membership failed'), {
              context: 'RoomUserRepository.addUser.rollback',
              roomId,
              userId: user.id,
              setKey,
            });
          }
        }

        return false;
      }

      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.addUser',
        roomId,
        userId: user.id,
      });
      return false;
    }
  }

  /**
   * Remove user from room (atomic operation)
   */
  async removeUser(roomId: string, userId: string): Promise<boolean> {
    try {
      const userDataKey = REDIS_KEYS.roomMemberData(roomId, userId);
      
      // Remove from both sets (one will succeed, one will be no-op)
      await Promise.all([
        redisStateService.del(userDataKey),
        redisStateService.srem(REDIS_KEYS.roomMembers(roomId), userId),
        redisStateService.srem(REDIS_KEYS.roomAudiences(roomId), userId),
      ]);

      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.removeUser',
        roomId,
        userId,
      });
      return false;
    }
  }

  /**
   * Get user data
   */
  async getUser(roomId: string, userId: string): Promise<User | null> {
    try {
      const userDataKey = REDIS_KEYS.roomMemberData(roomId, userId);
      const userData = await redisStateService.get<User>(userDataKey);
      if (!userData) return null;

      // Auto-detect and repair set membership mismatches (recovery from crash during changeUserRole).
      // Only check the "should NOT be in" set — one sismember call keeps this lightweight.
      const shouldBeInMembers = userData.role === 'room_owner' || userData.role === 'band_member';
      const wrongSetKey = shouldBeInMembers
        ? REDIS_KEYS.roomAudiences(roomId)
        : REDIS_KEYS.roomMembers(roomId);
      const isInWrongSet = await redisStateService.sismember(wrongSetKey, userId);
      if (isInWrongSet) {
        // Fire-and-forget repair — non-blocking
        this.repairUserSetMembership(roomId, userId).catch((repairError: unknown) => {
          loggingService.logError(repairError instanceof Error ? repairError : new Error(String(repairError)), {
            context: 'RoomUserRepository.getUser.repair',
            roomId,
            userId,
          });
        });
      }

      return userData;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.getUser',
        roomId,
        userId,
      });
      return null;
    }
  }

  /**
   * Check whether the room has any band members — throws on Redis error so callers
   * can treat the failure as "has members" (fail-safe for deletion decisions).
   * Use this instead of getBandMembers() whenever the result gates a destructive action.
   */
  async hasBandMembersStrict(roomId: string): Promise<boolean> {
    const memberIds = await redisStateService.smembers(REDIS_KEYS.roomMembers(roomId), true);
    return (memberIds?.length ?? 0) > 0;
  }

  /**
   * Get all band members
   */
  async getBandMembers(roomId: string): Promise<BandMember[]> {
    try {
      const memberIds = await redisStateService.smembers(REDIS_KEYS.roomMembers(roomId));
      if (!memberIds || memberIds.length === 0) {
        return [];
      }

      const members = await Promise.all(
        memberIds.map(async (userId) => {
          const user = await this.getUser(roomId, userId);
          return user as BandMember | null;
        })
      );

      return members.filter((m): m is BandMember => m !== null);
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.getBandMembers',
        roomId,
      });
      return [];
    }
  }

  /**
   * Get all audiences
   */
  async getAudiences(roomId: string): Promise<Audience[]> {
    try {
      const audienceIds = await redisStateService.smembers(REDIS_KEYS.roomAudiences(roomId));
      if (!audienceIds || audienceIds.length === 0) {
        return [];
      }

      const audiences = await Promise.all(
        audienceIds.map(async (userId) => {
          const user = await this.getUser(roomId, userId);
          return user as Audience | null;
        })
      );

      return audiences.filter((a): a is Audience => a !== null);
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.getAudiences',
        roomId,
      });
      return [];
    }
  }

  /**
   * Update user instrument (atomic - only updates instrument fields)
   */
  async updateUserInstrument(
    roomId: string,
    userId: string,
    instrument: string,
    category: string
  ): Promise<boolean> {
    try {
      const user = await this.getUser(roomId, userId);
      if (!user || user.role === 'audience') {
        return false;
      }

      const bandMember = user as BandMember;
      bandMember.currentInstrument = instrument;
      bandMember.currentCategory = category;

      const userDataKey = REDIS_KEYS.roomMemberData(roomId, userId);
      await redisStateService.set(userDataKey, bandMember);

      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.updateUserInstrument',
        roomId,
        userId,
      });
      return false;
    }
  }

  /**
   * Update user synth params (atomic - only updates synth params)
   */
  async updateUserSynthParams(
    roomId: string,
    userId: string,
    synthParams: Record<string, unknown>
  ): Promise<boolean> {
    try {
      const user = await this.getUser(roomId, userId);
      if (!user || user.role === 'audience') {
        return false;
      }

      const bandMember = user as BandMember;
      bandMember.synthParams = synthParams;

      const userDataKey = REDIS_KEYS.roomMemberData(roomId, userId);
      await redisStateService.set(userDataKey, bandMember);

      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.updateUserSynthParams',
        roomId,
        userId,
      });
      return false;
    }
  }

  /**
   * Update user instrument params (atomic - only updates instrument params)
   * DEV-301: non-synth instrument pre-gain, sibling to updateUserSynthParams above.
   */
  async updateUserInstrumentParams(
    roomId: string,
    userId: string,
    instrumentParams: Record<string, unknown>
  ): Promise<boolean> {
    try {
      const user = await this.getUser(roomId, userId);
      if (!user || user.role === 'audience') {
        return false;
      }

      const bandMember = user as BandMember;
      bandMember.instrumentParams = instrumentParams;

      const userDataKey = REDIS_KEYS.roomMemberData(roomId, userId);
      await redisStateService.set(userDataKey, bandMember);

      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.updateUserInstrumentParams',
        roomId,
        userId,
      });
      return false;
    }
  }

  /**
   * Update user effect chains (atomic - only updates effect chains)
   */
  async updateUserEffectChains(
    roomId: string,
    userId: string,
    effectChains: Record<string, unknown>
  ): Promise<boolean> {
    try {
      const user = await this.getUser(roomId, userId);
      if (!user || user.role === 'audience') {
        return false;
      }

      const bandMember = user as BandMember;
      bandMember.effectChains = effectChains as unknown as Record<EffectChainType, EffectChainState>;

      const userDataKey = REDIS_KEYS.roomMemberData(roomId, userId);
      await redisStateService.set(userDataKey, bandMember);

      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.updateUserEffectChains',
        roomId,
        userId,
      });
      return false;
    }
  }

  /**
   * Check if user exists in room
   */
  async userExists(roomId: string, userId: string): Promise<boolean> {
    try {
      const [isInMembers, inAudiences] = await Promise.all([
        redisStateService.sismember(REDIS_KEYS.roomMembers(roomId), userId),
        redisStateService.sismember(REDIS_KEYS.roomAudiences(roomId), userId),
      ]);
      return isInMembers || inAudiences;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.userExists',
        roomId,
        userId,
      });
      return false;
    }
  }

  /**
   * Change a user's role in-place without removing/re-adding them.
   * This avoids the 0-user window where remove-then-add could trigger
   * aggressive room cleanup (DEV-139).
   */
  async changeUserRole(
    roomId: string,
    userId: string,
    newRole: 'room_owner' | 'band_member' | 'audience',
  ): Promise<boolean> {
    try {
      const user = await this.getUser(roomId, userId);
      if (!user) {
        loggingService.logWarn('changeUserRole: user not found in room', {
          roomId,
          userId,
          newRole,
        });
        return false;
      }

      if (user.role === newRole) {
        return true; // no-op
      }

      const wasOldBandMember = user.role === 'room_owner' || user.role === 'band_member';
      const isNewBandMember = newRole === 'room_owner' || newRole === 'band_member';

      const userDataKey = REDIS_KEYS.roomMemberData(roomId, userId);
      const updatedUser = { ...user, role: newRole };

      // Sequential writes: update user data first, then move between sets.
      // If a later step fails, the user data write is the source of truth for recovery;
      // a compensating fix can re-sync the set membership from the user data key.
      await redisStateService.set(userDataKey, updatedUser);

      // If crossing the band/audience boundary, move between sets sequentially
      if (wasOldBandMember && !isNewBandMember) {
        // band → audience: remove from members, add to audiences
        await redisStateService.srem(REDIS_KEYS.roomMembers(roomId), userId);
        await redisStateService.sadd(REDIS_KEYS.roomAudiences(roomId), userId);
      } else if (!wasOldBandMember && isNewBandMember) {
        // audience → band: remove from audiences, add to members
        await redisStateService.srem(REDIS_KEYS.roomAudiences(roomId), userId);
        await redisStateService.sadd(REDIS_KEYS.roomMembers(roomId), userId);
      }

      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.changeUserRole',
        roomId,
        userId,
        newRole,
      });
      return false;
    }
  }

  /**
   * Repair user set membership when role and set membership are inconsistent.
   * Called when a role/set mismatch is detected (e.g. after a crash during changeUserRole).
   */
  async repairUserSetMembership(roomId: string, userId: string): Promise<boolean> {
    try {
      const user = await this.getUser(roomId, userId);
      if (!user) return false;

      const shouldBeInMembers = user.role === 'room_owner' || user.role === 'band_member';
      const [isInMembers, isInAudiences] = await Promise.all([
        redisStateService.sismember(REDIS_KEYS.roomMembers(roomId), userId),
        redisStateService.sismember(REDIS_KEYS.roomAudiences(roomId), userId),
      ]);

      if (shouldBeInMembers && isInMembers && !isInAudiences) return true; // already correct
      if (!shouldBeInMembers && !isInMembers && isInAudiences) return true; // already correct

      // Repair: remove from both, then add to correct one
      await Promise.all([
        redisStateService.srem(REDIS_KEYS.roomMembers(roomId), userId),
        redisStateService.srem(REDIS_KEYS.roomAudiences(roomId), userId),
      ]);

      if (shouldBeInMembers) {
        await redisStateService.sadd(REDIS_KEYS.roomMembers(roomId), userId);
      } else {
        await redisStateService.sadd(REDIS_KEYS.roomAudiences(roomId), userId);
      }

      loggingService.logInfo('Repaired user set membership inconsistency', {
        roomId,
        userId,
        role: user.role,
      });

      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.repairUserSetMembership',
        roomId,
        userId,
      });
      return false;
    }
  }

  /**
   * Get user count (band members + audiences).
   * Fail-open: returns 0 on Redis error. Use getUserCountStrict for destructive gates.
   */
  async getUserCount(roomId: string): Promise<number> {
    try {
      const [memberCount, audienceCount] = await Promise.all([
        redisStateService.scard(REDIS_KEYS.roomMembers(roomId)),
        redisStateService.scard(REDIS_KEYS.roomAudiences(roomId)),
      ]);
      return (memberCount || 0) + (audienceCount || 0);
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.getUserCount',
        roomId,
      });
      return 0;
    }
  }

  /**
   * Get user count — throws on Redis error so callers can distinguish
   * "room is empty" from "Redis is down". Use this for destructive gates
   * where a false-positive empty count would clear active room mappings.
   */
  async getUserCountStrict(roomId: string): Promise<number> {
    const [memberCount, audienceCount] = await Promise.all([
      redisStateService.scard(REDIS_KEYS.roomMembers(roomId)),
      redisStateService.scard(REDIS_KEYS.roomAudiences(roomId)),
    ]);
    return (memberCount || 0) + (audienceCount || 0);
  }

  /**
   * Clear all users from room (for cleanup)
   */
  async clearAllUsers(roomId: string): Promise<void> {
    try {
      const [memberIds, audienceIds] = await Promise.all([
        redisStateService.smembers(REDIS_KEYS.roomMembers(roomId)),
        redisStateService.smembers(REDIS_KEYS.roomAudiences(roomId)),
      ]);

      const allUserIds = [...(memberIds || []), ...(audienceIds || [])];
      
      // Delete all user data keys
      const deletePromises = allUserIds.map(userId => 
        redisStateService.del(REDIS_KEYS.roomMemberData(roomId, userId))
      );

      // Delete sets
      deletePromises.push(
        redisStateService.del(REDIS_KEYS.roomMembers(roomId)),
        redisStateService.del(REDIS_KEYS.roomAudiences(roomId))
      );

      await Promise.all(deletePromises);
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomUserRepository.clearAllUsers',
        roomId,
      });
    }
  }
}

// Singleton instance
export const roomUserRepository = new RoomUserRepository();
