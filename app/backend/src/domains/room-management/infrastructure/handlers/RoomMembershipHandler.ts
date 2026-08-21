import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload } from '@jam-band/shared';
import type { Server } from 'socket.io';
import type { RoomMembershipService } from '../../application/RoomMembershipService';
import type { RoomLifecycleService } from '../../application/RoomLifecycleService';
import type { NamespaceManager } from "../../../../shared/infrastructure/namespace/NamespaceManager";
import type { RoomSessionManager } from '../services/RoomSessionManager';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { buildRoomPayload } from '../../../../shared/utils/roomPayloadUtils';
import type {
  User,
  BandMember,
  TransferOwnershipData
} from '../../../../types';
import { redisStateService } from "../../../../shared/infrastructure/caching/RedisStateService";
import { SHARED_EVENTS, ROOM_STATE_EVENTS, PERFORM_EVENTS } from '@jam-band/shared';
// Event names centralized

/**
 * RoomMembershipHandler - Handles room member management operations
 *
 * This handler manages member-related operations within rooms:
 * - Member approval for private rooms
 * - Member rejection for private rooms
 * - Member-related coordination logic
 * - Room state updates after membership changes
 *
 * Requirements: 4.1, 4.6
 */
/* eslint-disable @typescript-eslint/member-ordering */
export class RoomMembershipHandler {
  constructor(
    private readonly roomMembershipService: RoomMembershipService,
    private readonly roomLifecycleService: RoomLifecycleService,
    private readonly io: Server,
    private readonly namespaceManager: NamespaceManager,
    private readonly roomSessionManager: RoomSessionManager
  ) {}

  /**
   * Build a room payload with fresh bandMembers, audiences, and pendingMembers from Redis.
   */
  private async buildRoomPayload(room: unknown, roomId: string) {
    return buildRoomPayload(this.roomMembershipService, room, roomId);
  }

  /**
   * Handle member approval through namespace
   * Requirements: 4.1, 4.6
   */
  async handleApproveMemberNamespace(socket: Socket, data: { userId: string; roomId?: string }, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const roomId = data.roomId || session.roomId;
    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Room not found'));
      return;
    }

    // Verify user is room owner
    if (!await this.roomMembershipService.isRoomOwner(roomId, session.userId)) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Only room owner can approve members'));
      return;
    }

    const { userId: targetUserId } = data;

    // Check if user is in pending members
    const pendingUser = room.pendingMembers.get(targetUserId);
    if (!pendingUser) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload(
        'User is not in pending members',
        {
        userId: targetUserId
        },
      ));
      return;
    }

    // Approve the user
    const approvedUser = await this.roomMembershipService.approveMember(roomId, targetUserId);
    if (!approvedUser) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload(
        'Failed to approve member',
        {
        userId: targetUserId
        },
      ));
      return;
    }

    // Notify all users in namespace about the new member
    namespace.emit(ROOM_STATE_EVENTS.USER_JOINED, { user: approvedUser });

    // Send updated room state through namespace
    namespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.buildRoomPayload(room, roomId));

    // Confirm to room owner
    socket.emit(ROOM_STATE_EVENTS.MEMBER_APPROVED, {
      message: 'Member approved successfully',
      userId: targetUserId,
      username: approvedUser.username
    });

    loggingService.logInfo('Member approved via namespace', {
      roomId,
      ownerId: session.userId,
      approvedUserId: targetUserId,
      approvedUsername: approvedUser.username,
      namespaceName: namespace.name
    });
  }

  /**
   * Handle member rejection through namespace - namespace-aware version
   * Requirements: 4.1, 4.6
   */
  async handleRejectMemberNamespace(socket: Socket, data: { userId: string; roomId?: string; message?: string }, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const roomId = data.roomId || session.roomId;
    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Room not found'));
      return;
    }

    // Verify user is room owner
    if (!await this.roomMembershipService.isRoomOwner(roomId, session.userId)) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Only room owner can reject members'));
      return;
    }

    const { userId: targetUserId, message } = data;

    // Check if user is in pending members
    const pendingUser = room.pendingMembers.get(targetUserId);
    if (!pendingUser) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload(
        'User is not in pending members',
        {
        userId: targetUserId
        },
      ));
      return;
    }

    // Reject the user
    const rejectedUser = await this.roomMembershipService.rejectMember(roomId, targetUserId);
    if (!rejectedUser) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload(
        'Failed to reject member',
        {
        userId: targetUserId
        },
      ));
      return;
    }

    // Send updated room state through namespace
    namespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.buildRoomPayload(room, roomId));

    // Confirm to room owner
    socket.emit(ROOM_STATE_EVENTS.MEMBER_REJECTED, {
      message: 'Member rejected successfully',
      userId: targetUserId,
      username: rejectedUser.username
    });

    loggingService.logInfo('Member rejected via namespace', {
      roomId,
      ownerId: session.userId,
      rejectedUserId: targetUserId,
      rejectedUsername: rejectedUser.username,
      reason: message || 'No reason provided',
      namespaceName: namespace.name
    });
  }

  /**
   * Get pending members for a room
   * Requirements: 4.1
   */
  async getPendingMembers(roomId: string): Promise<User[]> {
    return await this.roomMembershipService.getPendingMembers(roomId);
  }

  /**
   * Check if a user is a pending member
   * Requirements: 4.1
   */
  async isPendingMember(roomId: string, userId: string): Promise<boolean> {
    const room = await this.roomLifecycleService.getRoom(roomId);
    return room ? room.pendingMembers.has(userId) : false;
  }

  /**
   * Get member count for a room (approved members only)
   * Requirements: 4.1
   */
  async getMemberCount(roomId: string): Promise<number> {
    const room = await this.roomLifecycleService.getRoom(roomId);
    return room ? (room.bandMembers.size + room.audiences.size) : 0;
  }

  /**
   * Get pending member count for a room
   * Requirements: 4.1
   */
  async getPendingMemberCount(roomId: string): Promise<number> {
    const room = await this.roomLifecycleService.getRoom(roomId);
    return room ? room.pendingMembers.size : 0;
  }

  /**
   * Handle ownership transfer through namespace
   * Requirements: 4.1, 4.6
   */
  async handleTransferOwnershipNamespace(socket: Socket, data: TransferOwnershipData, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(SHARED_EVENTS.OWNERSHIP_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    // Verify the caller is the current room owner (DEV-181 — authorization must be server-side;
    // the session identity is derived server-side, not from the event payload).
    if (!await this.roomMembershipService.isRoomOwner(session.roomId, session.userId)) {
      socket.emit(SHARED_EVENTS.OWNERSHIP_ERROR, createSocketErrorPayload('Only room owner can transfer ownership'));
      return;
    }

    // The new owner must be an existing band member of this room.
    const currentRoom = await this.roomLifecycleService.getRoom(session.roomId);
    if (!currentRoom) {
      socket.emit(SHARED_EVENTS.OWNERSHIP_ERROR, createSocketErrorPayload('Room not found'));
      return;
    }
    if (!currentRoom.bandMembers.has(data.newOwnerId)) {
      socket.emit(SHARED_EVENTS.OWNERSHIP_ERROR, createSocketErrorPayload('New owner must be a band member of this room'));
      return;
    }

    const result = await this.roomMembershipService.transferOwnership(session.roomId, data.newOwnerId);
    if (!result) {
      socket.emit(SHARED_EVENTS.OWNERSHIP_ERROR, createSocketErrorPayload('Failed to transfer ownership'));
      return;
    }

    // Notify all users in namespace
    namespace.emit(ROOM_STATE_EVENTS.OWNERSHIP_TRANSFERRED, {
      newOwner: result.newOwner,
      oldOwner: result.oldOwner
    });

    // Send updated room state to all users in namespace
    const room = await this.roomLifecycleService.getRoom(session.roomId);
    if (room) {
      namespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.buildRoomPayload(room, session.roomId));
    }

    loggingService.logInfo('Ownership transferred via namespace', {
      roomId: session.roomId,
      oldOwnerId: result.oldOwner.id,
      newOwnerId: result.newOwner.id,
      namespaceName: namespace.name
    });
  }

  /**
   * Handle room scale change - update room state and notify followers
   */
  async handleRoomScaleChange(socket: Socket, data: { rootNote: string; scale: 'major' | 'minor' }, namespace: Namespace): Promise<boolean> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return false;

    // Read-modify-write under the per-room mutex (TR-2): getRoom returns a fresh
    // clone each call, so the scale MUST be persisted via saveRoom — otherwise the
    // mutation is discarded and a member who joins AFTER the owner set the scale
    // reads a room payload with no roomScale and falls back to their local scale.
    const lockKey = `room-state-mutex:${session.roomId}`;
    let didChange = false;

    await redisStateService.executeWithLock(lockKey, 5000, 10000, async () => {
      const room = await this.roomLifecycleService.getRoom(session.roomId);
      if (!room) return;

      // Only room owner can change the room scale — silently ignore non-owner
      // (client guards prevent intentional non-owner emissions; timing-related
      //  emissions during ownership transfer are harmless and should not error)
      if (room.owner !== session.userId) {
        return;
      }

      // Update and persist the room's scale
      room.roomScale = {
        rootNote: data.rootNote,
        scale: data.scale
      };
      await this.roomLifecycleService.saveRoom(room);

      // Notify all users in the room about the scale change
      namespace.emit(PERFORM_EVENTS.ROOM_SCALE_CHANGED, {
        rootNote: data.rootNote,
        scale: data.scale,
        ownerId: session.userId
      });

      loggingService.logInfo('Room scale changed', {
        roomId: session.roomId,
        ownerId: session.userId,
        rootNote: data.rootNote,
        scale: data.scale
      });

      didChange = true;
    });

    return didChange;
  }

  /**
   * Handle toggle follow scale - update user follow state
   */
  async handleToggleFollowScale(socket: Socket, data: { followScale: boolean }, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = await this.roomLifecycleService.getRoom(session.roomId);
    if (!room) return;

    const user = room.bandMembers.get(session.userId) || room.audiences.get(session.userId);
    if (!user) return;

    // Only band members can follow the room scale (not audience or room owner themselves)
    if (user.role !== 'band_member') {
      socket.emit('error', createSocketErrorPayload('Only band members can follow room scale'));
      return;
    }

    // Update user's follow state
    user.followScale = data.followScale;

    // Notify the user about their follow state change
    socket.emit(PERFORM_EVENTS.FOLLOW_SCALE_TOGGLED, {
      followScale: data.followScale,
      roomScale: room.roomScale
    });

    // If they're now following and there's a room scale, send it
    if (data.followScale && room.roomScale) {
      socket.emit(PERFORM_EVENTS.ROOM_SCALE_CHANGED, {
        rootNote: room.roomScale.rootNote,
        scale: room.roomScale.scale,
        ownerId: room.owner
      });
    }

    // Notify room participants about follow state change for awareness
    namespace.emit(ROOM_STATE_EVENTS.ROOM_MEMBER_FOLLOW_SCALE_CHANGED, {
      userId: session.userId,
      followScale: data.followScale
    });

    loggingService.logInfo('Follow scale toggled', {
      roomId: session.roomId,
      userId: session.userId,
      followScale: data.followScale
    });
  }

  /**
   * Handle role change request from a room member
   * E.g. audience requests to become a band_member (promotion)
   * or band_member requests to become an audience (demotion)
   */
  async handleRequestRoleChange(
    socket: Socket,
    data: { targetRole: 'band_member' | 'audience' },
    namespace: Namespace
  ): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const { roomId, userId } = session;
    const { targetRole } = data;

    if (typeof targetRole !== 'string' || targetRole.length === 0 || !['band_member', 'audience'].includes(targetRole)) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Invalid target role'));
      return;
    }

    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Room not found'));
      return;
    }

    const user = await this.roomMembershipService.findUserInRoom(roomId, userId);
    if (!user) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('User not found in room'));
      return;
    }

    if ((user as unknown as Record<string, unknown>).role === targetRole) {
      return; // no-op
    }

    // Lock key format: "room-state-mutex:{roomId}"
    const lockKey = `room-state-mutex:${roomId}`;

    if (targetRole === 'band_member') {
      // Promotion request: requires approval from Room Owner
      await redisStateService.executeWithLock(lockKey, 5000, 10000, async () => {
        // Double-check room state under lock
        const freshRoom = await this.roomLifecycleService.getRoom(roomId);
        if (!freshRoom) return;

        // If they are already in pendingMembers, do nothing
        if (freshRoom.pendingMembers.has(userId)) {
          return;
        }

        // Add user to pending members (cast as BandMember)
        const pendingUser = {
          id: user.id,
          username: user.username,
          role: 'band_member',
          isReady: false,
          profilePictureUrl: user.profilePictureUrl,
          userType: user.userType,
        } as BandMember;

        await this.roomMembershipService.addPendingMember(roomId, pendingUser);

        // Notify room owner and others in namespace
        namespace.emit(ROOM_STATE_EVENTS.ROLE_CHANGE_REQUESTED, {
          userId: user.id,
          username: user.username,
          targetRole: 'band_member',
        });

        // Send updated room state to all
        namespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.buildRoomPayload(freshRoom, roomId));

        loggingService.logInfo('Role change to band_member requested', {
          roomId,
          userId,
          username: user.username,
        });
      });
    } else {
      // Demotion request: does not require owner approval (self-downgrade), unless they are the owner
      if (room.owner === userId) {
        socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Room owner cannot downgrade to audience without transferring ownership first'));
        return;
      }

      await redisStateService.executeWithLock(lockKey, 5000, 10000, async () => {
        const isSuccess = await this.roomMembershipService.changeUserRole(roomId, userId, 'audience');
        if (!isSuccess) {
          socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Failed to change role'));
          return;
        }

        // Broadcast to all that user role has changed
        namespace.emit(ROOM_STATE_EVENTS.USER_ROLE_CHANGED, {
          userId,
          username: user.username,
          role: 'audience',
        });

        // Send updated room state
        const freshRoom = await this.roomLifecycleService.getRoom(roomId);
        if (freshRoom) {
          namespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.buildRoomPayload(freshRoom, roomId));
        }

        loggingService.logInfo('User self-downgraded to audience', {
          roomId,
          userId,
          username: user.username,
        });
      });
    }
  }

  /**
   * Handle room owner approving a role change request
   */
  async handleApproveRoleChange(
    socket: Socket,
    data: { targetUserId: string; targetRole: 'band_member' },
    namespace: Namespace
  ): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const { roomId, userId } = session;
    const { targetUserId } = data;

    // Verify sender is the room owner
    const isOwner = await this.roomMembershipService.isRoomOwner(roomId, userId);
    if (!isOwner) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Only room owner can approve role changes'));
      return;
    }

    const lockKey = `room-state-mutex:${roomId}`;

    await redisStateService.executeWithLock(lockKey, 5000, 10000, async () => {
      const room = await this.roomLifecycleService.getRoom(roomId);
      if (!room) {
        socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Room not found'));
        return;
      }

      // Check if user is in pending members
      const pendingMember = room.pendingMembers.get(targetUserId);
      if (!pendingMember) {
        socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('User is not in pending promotion list'));
        return;
      }

      // Change role to band_member in Redis
      const isSuccess = await this.roomMembershipService.changeUserRole(roomId, targetUserId, 'band_member');
      if (!isSuccess) {
        socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Failed to change user role'));
        return;
      }

      // Remove from pending members list
      room.pendingMembers.delete(targetUserId);
      await this.roomLifecycleService.saveRoom(room);

      // Broadcast user role changed
      namespace.emit(ROOM_STATE_EVENTS.USER_ROLE_CHANGED, {
        userId: targetUserId,
        username: pendingMember.username,
        role: 'band_member',
      });

      // Broadcast updated room state
      namespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.buildRoomPayload(room, roomId));

      loggingService.logInfo('Role change to band_member approved by owner', {
        roomId,
        ownerId: userId,
        targetUserId,
        targetUsername: pendingMember.username,
      });
    });
  }

  /**
   * Handle room owner rejecting a role change request (promotion to band_member).
   * Unlike rejectMember (join rejection), this keeps the user in the audience —
   * only removes them from pendingMembers and notifies that specific user.
   */
  async handleRejectRoleChange(
    socket: Socket,
    data: { targetUserId: string },
    namespace: Namespace
  ): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const { roomId, userId } = session;
    const { targetUserId } = data;

    // Verify sender is the room owner
    const isOwner = await this.roomMembershipService.isRoomOwner(roomId, userId);
    if (!isOwner) {
      socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Only room owner can reject role changes'));
      return;
    }

    const lockKey = `room-state-mutex:${roomId}`;

    await redisStateService.executeWithLock(lockKey, 5000, 10000, async () => {
      const room = await this.roomLifecycleService.getRoom(roomId);
      if (!room) {
        socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('Room not found'));
        return;
      }

      // Check if user is actually in pending members (must be a role-change request, not join)
      const pendingMember = room.pendingMembers.get(targetUserId);
      if (!pendingMember) {
        socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('User is not in pending promotion list'));
        return;
      }

      // Verify the user is still in audiences (this is a role-change request, not a join request)
      const isInAudience = room.audiences.has(targetUserId);
      if (!isInAudience) {
        // Not a role-change request — fall back to normal member rejection
        socket.emit(SHARED_EVENTS.MEMBERSHIP_ERROR, createSocketErrorPayload('User is not in audience — use reject_member for join rejections'));
        return;
      }

      // Remove from pending members only — user stays in audience
      room.pendingMembers.delete(targetUserId);
      await this.roomLifecycleService.saveRoom(room);

      // Emit role_change_rejected only to that specific user's socket
      const targetSocketId = await this.roomSessionManager.findSocketByUserIdAsync(roomId, targetUserId);
      if (targetSocketId) {
        const targetSocket = namespace.sockets.get(targetSocketId);
        if (targetSocket) {
          targetSocket.emit(ROOM_STATE_EVENTS.ROLE_CHANGE_REJECTED, {
            userId: targetUserId,
            username: pendingMember.username,
            message: 'Your request to become a band member was declined',
          });
        }
      }

      // Broadcast updated room state to all (pending list hasChanged)
      namespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await this.buildRoomPayload(room, roomId));

      loggingService.logInfo('Role change to band_member rejected by owner', {
        roomId,
        ownerId: userId,
        targetUserId,
        targetUsername: pendingMember.username,
      });
    });
  }
}
