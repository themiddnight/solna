/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions */
import type { Namespace } from 'socket.io';
import type { RoomLifecycleHandler } from './RoomLifecycleHandler';
import type { BandMember, User } from '../../../../types';
import type { RoomId, UserId } from '@/shared/domain/models/ValueObjects';
import { MemberLeft } from '@/shared/domain/events/RoomEvents';
import { loggingService } from "@/shared/infrastructure/logging/LoggingService";
import { ROOM_STATE_EVENTS } from '@jam-band/shared';
import { GRACE_PERIOD_OWNER_MS, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS } from '@jam-band/shared';
import { redisStateService } from '@/shared/infrastructure/caching/RedisStateService';
import { projectRoomService } from '@/domains/arrange-room/infrastructure/storage/ProjectRoomService';
import { prisma } from '@/config/prisma';

/**
 * RoomOwnershipHandler - Orchestrates immediate and delayed room owner transfers (BR-8).
 * Extracted from RoomLifecycleHandler to comply with Single Responsibility Principle.
 */
export class RoomOwnershipHandler {
  constructor(private readonly handler: RoomLifecycleHandler) {}

  /**
   * Private method to handle room owner leaving
   */
  async handleRoomOwnerLeaving(
    roomId: string | RoomId,
    leavingUserId: string | UserId,
    isIntendedLeave: boolean = false,
    // Caller-supplied snapshot: fetched before leave_confirmed, so it's valid even if the
    // concurrent disconnect handler already removed the user from Redis by the time we run.
    knownUserData?: User,
  ): Promise<void> {
    const roomIdTyped = this.handler.ensureRoomId(roomId);
    const leavingUserIdTyped = this.handler.ensureUserId(leavingUserId);
    const roomIdString = this.handler.roomIdToString(roomIdTyped);
    const leavingUserIdString = this.handler.userIdToString(leavingUserIdTyped);

    const room = await this.handler.roomLifecycleService.getRoom(roomIdString);
    if (!room) return;

    const leavingUser = room.bandMembers.get(leavingUserIdString) || room.audiences.get(leavingUserIdString) || knownUserData;
    if (!leavingUser) return;

    // If user is not in the current room snapshot, the concurrent disconnect handler already
    // removed them from Redis.  For an intentional leave we still need to close/transfer.
    const isUserAlreadyRemoved = !room.bandMembers.has(leavingUserIdString) && !room.audiences.has(leavingUserIdString);

    // Store the old owner information before removing them
    const oldOwner = { ...leavingUser };

    // Race condition fix: mark intentional leave BEFORE removeUserFromRoom so that
    // shouldCloseRoom skips any grace period entry the concurrent disconnect handler may add.
    // (The disconnect handler fires after leave_confirmed is emitted, which happens before
    // this path; marking here wins the race even if removeUserFromRoom is delayed.)
    if (isIntendedLeave) {
      this.handler.roomLifecycleService.markUserIntentionalLeave(leavingUserIdString, roomIdString);
    }

    // If the disconnect handler already removed the user from Redis, skip removeUserFromRoom
    // and go straight to ownership transfer (the user is already gone from the room).
    if (isUserAlreadyRemoved) {
      if (isIntendedLeave) {
        loggingService.logInfo('handleRoomOwnerLeaving: user already removed from Redis before getRoom, proceeding with ownership transfer', {
          context: 'RoomOwnershipHandler.handleRoomOwnerLeaving',
          roomId: roomIdString,
          userId: leavingUserIdString,
        });
        await this.handleImmediateOwnershipTransfer(roomIdTyped, oldOwner, oldOwner);
      } else {
        // Concurrent disconnect handler already removed the user; if it set a grace timer, do nothing.
        // If no timer is pending (race: disconnect handler crashed before setting it), schedule now.
        if (!this.handler.ownerGracePeriodTimers.has(roomIdString)) {
          loggingService.logInfo('handleRoomOwnerLeaving: user already removed, no timer found — scheduling delayed transfer as safety net', {
            roomId: roomIdString,
            userId: leavingUserIdString,
          });
          await this.handleDelayedOwnershipTransfer(roomIdTyped, oldOwner);
        }
      }
      return;
    }

    // Remove the leaving user from room
    const removedUser = await this.handler.roomMembershipService.removeUserFromRoom(
      roomIdString, leavingUserIdString, isIntendedLeave,
    );

    if (!removedUser) {
      if (isIntendedLeave) {
        // The concurrent disconnect handler beat us between getRoom and removeUserFromRoom:
        // user was removed as non-intentional and added to grace period.  We still need to
        // close/transfer — the early markUserIntentionalLeave above ensures shouldCloseRoom
        // ignores that grace period entry.
        loggingService.logInfo('handleRoomOwnerLeaving: user removed by concurrent disconnect between getRoom and removeUserFromRoom, proceeding with ownership transfer', {
          context: 'RoomOwnershipHandler.handleRoomOwnerLeaving',
          roomId: roomIdString,
          userId: leavingUserIdString,
        });
        await this.handleImmediateOwnershipTransfer(roomIdTyped, oldOwner, oldOwner);
      } else {
        // Bug #4: Redis write failed — owner was NOT removed from room.
        loggingService.logError(new Error('removeUserFromRoom failed for room owner — owner may still appear in room'), {
          context: 'RoomOwnershipHandler.handleRoomOwnerLeaving',
          roomId: roomIdString,
          userId: leavingUserIdString,
          isIntendedLeave,
        });
      }
      return;
    }

    // Publish MemberLeft event for intentional leaves to notify lobby
    // For unintentional leaves, we don't publish immediately as the user might rejoin
    if (isIntendedLeave && this.handler.eventBus) {
      const memberLeftEvent = new MemberLeft(
        roomIdString,
        leavingUserIdString,
        removedUser.username,
      );
      await this.handler.eventBus.publish(memberLeftEvent);
    }

    // For unintentional leave (like page refresh), keep the room alive if owner is alone
    if (!isIntendedLeave) {
      loggingService.logInfo('handleRoomOwnerLeaving: setTimeout set', { roomId: roomIdString, userId: leavingUserIdString, graceMs: GRACE_PERIOD_OWNER_MS + 500 });
      // For unintentional disconnects, delay ownership transfer until grace period expires
      // This prevents the double owner issue when room owners refresh the page
      const timeoutId = setTimeout(async () => {
        const lockKey = `room-promotion-lock:${roomIdString}`;
        try {
          await redisStateService.executeWithLock(lockKey, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
            this.handler.ownerGracePeriodTimers.delete(roomIdString);
          // Check if the user has rejoined the room (more robust than grace period check
          // which can race with the grace period expiry at the same boundary)
          const currentRoom = await this.handler.roomLifecycleService.getRoom(roomIdString);
          
          if (!currentRoom) {
            // Room no longer exists, it was already cleaned up - no action needed
            return;
          }

          const hasUserRejoinedRoom = currentRoom.bandMembers.has(leavingUserIdString) || currentRoom.audiences.has(leavingUserIdString);

          // COLL-15 FIX: Check active session is in THIS room, not just any room
          // Prevents dual presence when owner joins different room during grace period
          const activeSessionUsers = this.handler.roomSessionManager.getRoomUsers(roomIdString);
          const hasActiveSessionInThisRoom = activeSessionUsers.some(u => u.userId === leavingUserIdString);

          loggingService.logInfo('handleRoomOwnerLeaving timeout check', {
            roomId: roomIdString,
            leavingUserId: leavingUserIdString,
            hasUserRejoinedRoom,
            hasActiveSessionInThisRoom,
            bandMemberIds: Array.from(currentRoom.bandMembers.keys()),
            gracePeriodUsers: this.handler.roomLifecycleService.getRoomGracePeriodUsers(roomIdString).map(u => u.userId),
          });

          // If user has active session in THIS room but is not in bandMembers, fix the inconsistency
          // caused by the race condition before proceeding
          if (!hasUserRejoinedRoom && hasActiveSessionInThisRoom) {
            // COLL-BR8 FIX: If the owner intentionally left while this grace period timer was
            // isPending, do NOT restore them — the ownership transfer already happened via
            // handleImmediateOwnershipTransfer when they clicked Leave Room. Just return.
            const hasIntentionallyLeft = await this.handler.roomLifecycleService.hasUserIntentionallyLeft(leavingUserIdString, roomIdString);
            if (hasIntentionallyLeft) {
              loggingService.logInfo('handleRoomOwnerLeaving: owner intentionally left during grace period, skipping restore', {
                roomId: roomIdString,
                userId: leavingUserIdString,
              });
              return;
            }

            loggingService.logWarn('handleRoomOwnerLeaving: race condition detected — owner has active session but not in bandMembers, restoring', {
              roomId: roomIdString,
              userId: leavingUserIdString,
            });
            await this.handler.roomMembershipService.addUserToRoom(roomIdString, oldOwner);
            const roomNamespace = this.handler.getOrCreateRoomNamespace(roomIdTyped);
            if (roomNamespace) {
              const restoredRoom = await this.handler.roomLifecycleService.getRoom(roomIdString);
              if (restoredRoom) {
                roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.handler.buildRoomPayload(restoredRoom, roomIdString));
              }
            }
            return;
          }

          if (!hasUserRejoinedRoom && !hasActiveSessionInThisRoom) {
            // COLL-BR8 FIX: If owner intentionally left (immediate transfer already handled it),
            // skip the delayed transfer to avoid duplicate OWNERSHIP_TRANSFERRED events.
            if (await this.handler.roomLifecycleService.hasUserIntentionallyLeft(leavingUserIdString, roomIdString)) {
              loggingService.logInfo('handleRoomOwnerLeaving: owner intentionally left, skipping delayed transfer (already handled by immediate transfer)', {
                roomId: roomIdString,
                userId: leavingUserIdString,
              });
              return;
            }
            // Check if room should be closed completely before attempting transfer
            if (await this.handler.roomLifecycleService.shouldCloseRoom(roomIdString)) {
              // Room is isEmpty, delete it immediately instead of waiting for interval
              const roomNamespace = this.handler.getOrCreateRoomNamespace(roomIdTyped);
              if (roomNamespace) {
                roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_CLOSED, { message: 'Room is empty and has been closed' });
              }
              this.handler.metronomeService.cleanupRoom(roomIdString);
              this.handler.namespaceManager.cleanupRoomNamespace(roomIdString);
              this.handler.namespaceManager.cleanupApprovalNamespace(roomIdString);
              await this.handler.deleteRoomAndCleanup(roomIdString);
              this.handler.broadcastToLobby(ROOM_STATE_EVENTS.ROOM_CLOSED_BROADCAST, { roomId: roomIdString });
            } else {
              // Room is not isEmpty, proceed with ownership transfer
              await this.handleDelayedOwnershipTransfer(roomIdTyped, oldOwner);
            }
          }
          });
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'RoomLifecycleHandler.handleRoomOwnerLeaving.executeWithLock',
            roomId: roomIdString,
            userId: leavingUserIdString
          });
        }
      }, GRACE_PERIOD_OWNER_MS + 500); // Add 500ms safety buffer to ensure grace period has fully expired
      this.handler.ownerGracePeriodTimers.set(roomIdString, timeoutId);

      return;
    }

    // For intentional leave, proceed with immediate ownership transfer
    await this.handleImmediateOwnershipTransfer(roomIdTyped, leavingUser, oldOwner);
  }

  /**
   * Handle immediate ownership transfer for intentional leaves
   */
  async handleImmediateOwnershipTransfer(roomId: string | RoomId, leavingUser: User, oldOwner: User): Promise<void> {
    const roomIdTyped = this.handler.ensureRoomId(roomId);

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.handler.getOrCreateRoomNamespace(roomIdTyped);
    if (!roomNamespace) {
      loggingService.logInfo('Room namespace not found for ownership transfer', { roomId: roomIdTyped.toString() });
      return;
    }

    // First, notify all users that the owner is leaving
    roomNamespace.emit(ROOM_STATE_EVENTS.USER_LEFT, { user: leavingUser });

    await this.executeOwnershipTransfer(roomIdTyped, oldOwner, roomNamespace);
  }

  /**
   * Handle delayed ownership transfer for unintentional disconnects
   */
  async handleDelayedOwnershipTransfer(roomId: string | RoomId, oldOwner: User): Promise<void> {
    const roomIdTyped = this.handler.ensureRoomId(roomId);
    const roomIdString = this.handler.roomIdToString(roomIdTyped);

    const room = await this.handler.roomLifecycleService.getRoom(roomIdString);
    if (!room) return;

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.handler.getOrCreateRoomNamespace(roomIdTyped);
    if (!roomNamespace) {
      loggingService.logInfo('Room namespace not found for delayed ownership transfer', { roomId: roomIdTyped.toString() });
      return;
    }

    await this.executeOwnershipTransfer(roomIdTyped, oldOwner, roomNamespace);
  }

  /**
   * Shared logic for ownership transfer (used by both immediate and delayed transfers)
   */
  async executeOwnershipTransfer(roomIdTyped: RoomId, oldOwner: User, roomNamespace: Namespace): Promise<void> {
    const roomIdString = this.handler.roomIdToString(roomIdTyped);

    // Check if room should be closed (no users left)
    if (await this.handler.roomLifecycleService.shouldCloseRoom(roomIdString)) {
      roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_CLOSED, { message: 'Room is empty and has been closed' });
      this.handler.metronomeService.cleanupRoom(roomIdString);
      this.handler.namespaceManager.cleanupRoomNamespace(roomIdString);
      this.handler.namespaceManager.cleanupApprovalNamespace(roomIdString);
      await this.handler.deleteRoomAndCleanup(roomIdString);

      // Broadcast to all clients that the room was closed (via /lobby namespace)
      this.handler.broadcastToLobby(ROOM_STATE_EVENTS.ROOM_CLOSED_BROADCAST, { roomId: roomIdTyped.toString() });
      return;
    }

    // Try to transfer ownership to any remaining eligible musician
    let newOwner = await this.handler.roomMembershipService.getOwnershipCandidate(roomIdString);

    // If no active band member isFound, check grace-period users: a member who disconnected
    // briefly may not yet be back in Redis bandMembers but is still an eligible owner candidate.
    if (!newOwner) {
      const gracePeriodUsers = this.handler.roomLifecycleService.getRoomGracePeriodUsers(roomIdString);
      const gracePeriodCandidate = gracePeriodUsers.find((entry) => {
        if (entry.isIntendedLeave) return false;
        const role = entry.userData?.role;
        return role === 'band_member' || role === 'room_owner';
      });
      if (gracePeriodCandidate) {
        // Restore the grace-period user back to active band members so that
        // transferOwnership can operate on them and emit OWNERSHIP_TRANSFERRED.
        const room = await this.handler.roomLifecycleService.getRoom(roomIdString);
        if (room && gracePeriodCandidate.userData) {
          await this.handler.roomMembershipService.addUserToRoom(roomIdString, gracePeriodCandidate.userData);
          newOwner = gracePeriodCandidate.userData as BandMember;
          loggingService.logInfo('executeOwnershipTransfer: using grace-period user as ownership candidate', {
            roomId: roomIdString,
            candidateId: gracePeriodCandidate.userId,
          });
        }
      }
    }

    if (!newOwner) {
      roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_CLOSED, { message: 'Room has no eligible owner and has been closed' });
      this.handler.metronomeService.cleanupRoom(roomIdString);
      this.handler.namespaceManager.cleanupRoomNamespace(roomIdString);
      this.handler.namespaceManager.cleanupApprovalNamespace(roomIdString);
      await this.handler.deleteRoomAndCleanup(roomIdString);
      this.handler.broadcastToLobby(ROOM_STATE_EVENTS.ROOM_CLOSED_BROADCAST, { roomId: roomIdTyped.toString() });
      return;
    }

    // oldOwner is always a BandMember since only band_member/room_owner roles can be room owners
    const result = await this.handler.roomMembershipService.transferOwnership(roomIdString, newOwner.id, oldOwner as BandMember);
    if (result) {
      roomNamespace.emit(ROOM_STATE_EVENTS.OWNERSHIP_TRANSFERRED, {
        newOwner: result.newOwner,
        oldOwner: result.oldOwner
      });

      // Send updated room state to all users to ensure UI consistency
      const room = await this.handler.roomLifecycleService.getRoom(roomIdString);
      if (room) {
        roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.handler.buildRoomPayload(room, roomIdString));
      }
    }
  }

  /**
   * Check if user is the project owner for the project associated with this room
   * Used for BR-2: Project Owner Always Opens as Room Owner
   * @returns true if user owns the project, false otherwise
   */
  async checkIsProjectOwner(roomId: string, userId: string): Promise<boolean> {
    try {
      const project = await projectRoomService.getProjectByActiveRoom(roomId);
      if (!project) {
        return false;
      }

      // Get project details from DB to check ownership
      const projectDetails = await prisma.savedProject.findUnique({
        where: { id: project.id },
        select: { userId: true },
      });

      return projectDetails?.userId === userId;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RoomOwnershipHandler:checkIsProjectOwner',
        roomId,
        userId,
      });
      return false;
    }
  }
}
