import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload } from '@jam-band/shared';
import type { Server } from 'socket.io';
import type { RoomLifecycleService } from '../../../room-management/application/RoomLifecycleService';
import type { RoomMembershipService } from '../../../room-management/application/RoomMembershipService';
import type { NamespaceManager } from "../../../../shared/infrastructure/namespace/NamespaceManager";
import type { RoomSessionManager } from '../../../room-management/infrastructure/services/RoomSessionManager';
import { ApprovalSessionManager } from '../../../room-management/infrastructure/services/ApprovalSessionManager';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import type {
  ApprovalRequestData,
  ApprovalResponseData,
  ApprovalCancelData,
  BandMember,
  ApprovalSession
} from '../../../../types';
import { ERROR_EVENTS, ROOM_STATE_EVENTS, APPROVAL_EVENTS, APPROVAL_BE_EVENTS } from '@jam-band/shared';

/**
 * ApprovalWorkflowHandler - Handles private room join approval workflows
 * 
 * This handler manages the complete approval process for users requesting to join private rooms:
 * - Approval requests from users wanting to join
 * - Approval responses from room owners (approve/reject)
 * - Approval cancellations from waiting users
 * - Approval timeouts for expired requests
 * - Cleanup on disconnections
 * 
 * Requirements: 4.1, 4.6
 */
export class ApprovalWorkflowHandler {
  private readonly approvalSessionManager: ApprovalSessionManager;

  constructor(
    private readonly roomLifecycleService: RoomLifecycleService,
    private readonly roomMembershipService: RoomMembershipService,
    private readonly io: Server,
    private readonly namespaceManager: NamespaceManager,
    private readonly roomSessionManager: RoomSessionManager,
    approvalSessionManager?: ApprovalSessionManager
  ) {
    this.approvalSessionManager = approvalSessionManager || new ApprovalSessionManager();
  }

  /**
   * Handle initial connection to approval namespace
   * Requirements: 3.1, 3.2
   */
  handleApprovalConnection(socket: Socket, roomId: string, approvalNamespace: Namespace): void {
    // Basic connection setup - actual session will be created when approval request is made
    loggingService.logInfo('User connected to approval namespace', {
      socketId: socket.id,
      roomId,
      namespacePath: `/approval/${roomId}`,
      namespace: approvalNamespace.name
    });
  }

  /**
   * Handle approval request in approval namespace
   * Requirements: 3.1, 3.2
   */
  async handleApprovalRequest(socket: Socket, data: ApprovalRequestData, approvalNamespace: Namespace): Promise<void> {
    const { roomId, role } = data;
    // Identity from the verified socket token (DEV-179), never the client payload.
    const authUser = (socket.data as { user?: { id: string; username: string | null } }).user;
    if (!authUser) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('Authentication required'));
      return;
    }
    const userId = authUser.id;
    const username = authUser.username ?? data.username;

    loggingService.logInfo('Approval request received', {
      roomId,
      userId,
      socketId: socket.id,
      namespace: approvalNamespace.name
    });

    // Validate room exists
    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('Room not found'));
      return;
    }

    // Validate room is private
    if (!room.isPrivate) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('Room is not private'));
      return;
    }

    // Validate ghost-room state before entering approval flow.
    // This prevents users from getting stuck waiting when no owner can approve.
    const ghostValidation = await this.validateRoomIsJoinableForApproval(roomId, userId);
    if (!ghostValidation.joinable) {
      socket.emit(ERROR_EVENTS.GHOST_ROOM_ERROR, createSocketErrorPayload(
        ghostValidation.message,
        {
        roomId,
        roomName: room.name,
        },
      ));
      return;
    }

    // If user already has a stale approval session (e.g. from a previous browser context
    // that disconnected without clean cancellation), remove it so the new request can proceed.
    if (this.approvalSessionManager.hasApprovalSession(userId)) {
      loggingService.logInfo('Cleaning up stale approval session before new request', { userId, roomId });
      this.approvalSessionManager.removeApprovalSessionByUserId(userId);
    }

    // Check if user is already in the room
    if (await this.roomMembershipService.findUserInRoom(roomId, userId)) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('You are already in this room'));
      return;
    }

    // Create approval session with timeout callback
    const approvalSession = this.approvalSessionManager.createApprovalSession(
      socket.id, roomId, userId, username, role,
      (socketId, session) => this.handleApprovalTimeout(socketId, session)
    );

    // Add user to pending members in room service
    const pendingUser = {
      id: userId,
      username,
      role,
      isReady: role === 'audience'
    } as BandMember;
    await this.roomMembershipService.addPendingMember(roomId, pendingUser);

    // Notify the requesting user that they're waiting for approval
    socket.emit(APPROVAL_EVENTS.APPROVAL_PENDING, {
      message: 'Waiting for room owner approval',
      timeoutMs: this.approvalSessionManager.getApprovalTimeoutMs()
    });

    // Notify room owner through room namespace with retry mechanism
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      const isNotificationSent = this.sendRoomOwnerNotification(roomNamespace, {
        user: pendingUser,
        requestedAt: approvalSession.requestedAt.toISOString()
      });
      
      if (!isNotificationSent) {
        // Fallback: Try to get room owner socket directly
        const room = await this.roomLifecycleService.getRoom(roomId);
        if (room) {
          const owner = Array.from(room.bandMembers.values()).find(member => member.role === 'room_owner');
          if (owner) {
            void this.sendDirectNotificationToOwner(roomId, owner.id, {
              user: pendingUser,
              requestedAt: approvalSession.requestedAt.toISOString()
            });
          }
        }
      }
    } else {
      loggingService.logError(new Error('Room namespace not found for approval notification'), {
        roomId,
        context: 'ApprovalWorkflowHandler.handleApprovalRequest'
      });
      
      // Clean up the approval session since we can't notify the owner
      this.approvalSessionManager.removeApprovalSession(socket.id);
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('Unable to notify room owner. Please try again.'));
      return;
    }
  }

  /**
   * Handle approval response from room owner
   * Requirements: 3.3, 3.9
   */
  async handleApprovalResponse(socket: Socket, data: ApprovalResponseData, roomNamespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('You are not in a room'));
      return;
    }

    const room = await this.roomLifecycleService.getRoom(session.roomId);
    if (!room) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('Room not found'));
      return;
    }

    // Verify user is room owner
    if (!await this.roomMembershipService.isRoomOwner(session.roomId, session.userId)) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('Only room owner can approve members'));
      return;
    }

    const { userId: targetUserId, approved: isApproved } = data;

    // Check if user still has an approval session
    const approvalSession = this.approvalSessionManager.getApprovalSessionByUserId(targetUserId);
    if (!approvalSession) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('No approval session found', {
        userId: targetUserId
      }));
      return;
    }

    // Get approval namespace to notify the waiting user
    const approvalNamespace = this.namespaceManager.getApprovalNamespace(session.roomId);

    if (isApproved) {
      // Approve the user
      const approvedUser = await this.roomMembershipService.approveMember(session.roomId, targetUserId);
      if (approvedUser) {
        // Notify the approved user through approval namespace with enhanced data
        if (approvalNamespace) {
          let isNotificationSent = false;
          
          // Find the socket in the approval namespace by iterating through connected sockets
          for (const [socketId, userSocket] of approvalNamespace.sockets) {
            const socketSession = this.approvalSessionManager.getApprovalSession(socketId);
            if (socketSession && socketSession.userId === targetUserId) {
              const roomData = {
                ...room,
                users: await this.roomMembershipService.getRoomUsers(session.roomId),
                pendingMembers: await this.roomMembershipService.getPendingMembers(session.roomId)
              };
              
              userSocket.emit(APPROVAL_EVENTS.APPROVAL_GRANTED, {
                room: roomData,
                user: approvedUser,
                approvedAt: new Date().toISOString(),
                message: 'Welcome to the room! You are now a band member.'
              });
              
              isNotificationSent = true;
              break;
            }
          }
          
          if (!isNotificationSent) {
            loggingService.logInfo('Could not find approved user socket in approval namespace', {
              roomId: session.roomId,
              userId: targetUserId,
              connectedSockets: approvalNamespace.sockets.size
            });
          }
        }

        // Notify all users in room about the new member
        roomNamespace.emit(ROOM_STATE_EVENTS.USER_JOINED, { user: approvedUser });

        // Send updated room state
        const updatedRoomData = {
          room: {
            ...room,
            users: await this.roomMembershipService.getRoomUsers(session.roomId),
            pendingMembers: await this.roomMembershipService.getPendingMembers(session.roomId)
          }
        };
        roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, updatedRoomData);

        // Confirm to room owner
        socket.emit(APPROVAL_BE_EVENTS.APPROVAL_SUCCESS, {
          message: 'User approved successfully',
          userId: targetUserId,
          username: approvalSession.username
        });
      }
    } else {
      // Reject the user
      const rejectedUser = await this.roomMembershipService.rejectMember(session.roomId, targetUserId);
      if (rejectedUser) {
        // Notify the rejected user through approval namespace
        if (approvalNamespace) {
          // Find the socket in the approval namespace by iterating through connected sockets
          for (const [socketId, socket] of approvalNamespace.sockets) {
            const socketSession = this.approvalSessionManager.getApprovalSession(socketId);
            if (socketSession && socketSession.userId === targetUserId) {
              socket.emit(ROOM_STATE_EVENTS.MEMBER_DENIED, {
                message: data.message || 'Your request was rejected'
              });
              break;
            }
          }
        }

        // Send updated room state to room users
        const updatedRoomData = {
          room: {
            ...room,
            users: await this.roomMembershipService.getRoomUsers(session.roomId),
            pendingMembers: await this.roomMembershipService.getPendingMembers(session.roomId)
          }
        };
        roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, updatedRoomData);

        // Confirm to room owner
        socket.emit(APPROVAL_BE_EVENTS.APPROVAL_SUCCESS, {
          message: 'User rejected successfully',
          userId: targetUserId,
          username: approvalSession.username
        });
      }
    }

    // Clean up approval session
    this.approvalSessionManager.removeApprovalSessionByUserId(targetUserId);
  }

  /**
   * Handle approval cancellation from waiting user
   * Requirements: 3.6, 3.7
   */
  async handleApprovalCancel(socket: Socket, data: ApprovalCancelData, approvalNamespace: Namespace): Promise<void> {
    const { roomId } = data;
    // Identity from the verified socket token (DEV-179), never the client payload.
    const authUser = (socket.data as { user?: { id: string; username: string | null } }).user;
    if (!authUser) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('Authentication required'));
      return;
    }
    const userId = authUser.id;

    // Get approval session
    const approvalSession = this.approvalSessionManager.getApprovalSession(socket.id);
    if (!approvalSession) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('No approval session found'));
      return;
    }

    // Verify session matches the request (cross-check the token-verified identity)
    if (approvalSession.userId !== userId || approvalSession.roomId !== roomId) {
      socket.emit(APPROVAL_EVENTS.APPROVAL_ERROR, createSocketErrorPayload('Invalid cancellation request'));
      return;
    }

    // Remove from pending members
    await this.roomMembershipService.rejectMember(roomId, userId);

    // Notify room owner through room namespace
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      roomNamespace.emit(ROOM_STATE_EVENTS.APPROVAL_REQUEST_CANCELLED, {
        userId,
        username: approvalSession.username,
        message: 'User cancelled their join request'
      });
    }

    // Confirm cancellation to user
    socket.emit(ROOM_STATE_EVENTS.APPROVAL_CANCELLED, {
      message: 'Your request has been cancelled'
    });

    loggingService.logInfo('Approval request cancelled by user', {
      roomId,
      userId,
      namespace: approvalNamespace.name
    });

    // Clean up approval session
    this.approvalSessionManager.removeApprovalSession(socket.id);

    // Disconnect the user from approval namespace
    socket.disconnect();
  }

  /**
   * Handle approval timeout
   * Requirements: 3.4
   */
  async handleApprovalTimeout(socketId: string, approvalSession: ApprovalSession): Promise<void> {
    const { roomId, userId, username } = approvalSession;

    // Remove from pending members
    await this.roomMembershipService.rejectMember(roomId, userId);

    // Notify room owner through room namespace
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      roomNamespace.emit(ROOM_STATE_EVENTS.APPROVAL_REQUEST_CANCELLED, {
        userId,
        username,
        message: 'Approval request timed out'
      });
    }

    // Notify the waiting user through approval namespace
    const approvalNamespace = this.namespaceManager.getApprovalNamespace(roomId);
    if (approvalNamespace) {
      const socket = approvalNamespace.sockets.get(socketId);
      if (socket) {
        socket.emit(ROOM_STATE_EVENTS.APPROVAL_TIMEOUT, {
          message: 'Your approval request has timed out'
        });
        // Disconnect the socket after timeout
        socket.disconnect();
      }
    }

    // Clean up approval session
    this.approvalSessionManager.removeApprovalSession(socketId);
  }

  /**
   * Handle approval disconnect (accidental disconnect)
   * Requirements: 3.8
   */
  async handleApprovalDisconnect(socket: Socket): Promise<void> {
    const approvalSession = this.approvalSessionManager.getApprovalSession(socket.id);
    if (!approvalSession) return;

    const { roomId, userId, username } = approvalSession;

    // Remove from pending members
    await this.roomMembershipService.rejectMember(roomId, userId);

    // Notify room owner through room namespace
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      roomNamespace.emit(ROOM_STATE_EVENTS.APPROVAL_REQUEST_CANCELLED, {
        userId,
        username,
        message: 'User disconnected'
      });
    }

    // Clean up approval session
    this.approvalSessionManager.removeApprovalSession(socket.id);
  }

  /**
   * Get approval session manager for external access
   */
  getApprovalSessionManager(): ApprovalSessionManager {
    return this.approvalSessionManager;
  }

  /**
   * Send notification to room owner with retry mechanism
   */
  private sendRoomOwnerNotification(roomNamespace: Namespace, data: { user: BandMember; requestedAt: string }): boolean {
    try {
      const connectedSockets = roomNamespace.sockets.size;
      if (connectedSockets === 0) {
        return false;
      }
      
      roomNamespace.emit(ROOM_STATE_EVENTS.APPROVAL_REQUEST, data);
      
      loggingService.logInfo('Approval notification sent to room owner', {
        namespace: roomNamespace.name,
        connectedSockets
      });
      
      return true;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ApprovalWorkflowHandler.sendRoomOwnerNotification'
      });
      return false;
    }
  }

  /**
   * Send direct notification to specific room owner
   */
  private async sendDirectNotificationToOwner(roomId: string, ownerId: string, data: { user: BandMember; requestedAt: string }): Promise<void> {
    try {
      // Try to find the owner socket across all namespaces
      const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
      
      if (roomNamespace) {
        for (const [socketId, socket] of roomNamespace.sockets) {
          const session = this.roomSessionManager.getRoomSession(socketId);
          if (session && session.userId === ownerId) {
            socket.emit(ROOM_STATE_EVENTS.APPROVAL_REQUEST, data);
            loggingService.logInfo('Direct notification sent to room owner', {
              roomId,
              ownerId
            });
            return;
          }
        }
      }
      
      loggingService.logInfo('Room owner socket not found for direct notification', {
        roomId,
        ownerId
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ApprovalWorkflowHandler.sendDirectNotificationToOwner',
        roomId,
        ownerId
      });
    }
  }

  private async validateRoomIsJoinableForApproval(
    roomId: string,
    requesterUserId: string,
  ): Promise<{ joinable: boolean; message: string }> {
    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) {
      return { joinable: false, message: 'This room is no longer active.' };
    }

    const ROOM_GRACE_PERIOD_MS = 30_000;
    const isNewRoom = Date.now() - new Date(room.createdAt).getTime() < ROOM_GRACE_PERIOD_MS;
    const allUsers = [...room.bandMembers.values(), ...room.audiences.values()];

    if (isNewRoom) {
      return { joinable: true, message: '' };
    }

    if (allUsers.length === 0) {
      const roomGracePeriodUsers = this.roomLifecycleService.getRoomGracePeriodUsers(roomId);
      // Only a room_owner in grace period keeps the room joinable for approval —
      // band_member / audience cannot approve requests.
      const hasOwnerInGracePeriod = roomGracePeriodUsers.some(
        (entry) => entry.userData.role === 'room_owner',
      );

      if (!hasOwnerInGracePeriod) {
        return { joinable: false, message: 'This room is no longer active.' };
      }

      return {
        joinable: false,
        message: 'This room is temporarily unavailable. The owner may be reconnecting. Please try again shortly.',
      };
    }

    // Only room owners can approve join requests.
    // Verify at least one active room_owner exists before entering the approval queue,
    // otherwise the requester would wait forever with no one to approve them.
    const ownerUsers = Array.from(room.bandMembers.values()).filter(
      (member) => member.role === 'room_owner' && member.id !== requesterUserId,
    );

    if (ownerUsers.length === 0) {
      return {
        joinable: false,
        message: 'No room owner is currently available to approve your request.',
      };
    }

    for (const owner of ownerUsers) {
      if (this.roomLifecycleService.isUserInGracePeriod(owner.id, roomId)) {
        return { joinable: true, message: '' };
      }

      const isActive = await this.roomSessionManager.isUserActiveInRoom(roomId, owner.id);
      if (isActive) {
        return { joinable: true, message: '' };
      }
    }

    return {
      joinable: false,
      message: 'The room owner is not currently active. Please try again later.',
    };
  }
}
