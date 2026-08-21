import type { Socket } from 'socket.io';
import type { RoomLifecycleHandler } from './RoomLifecycleHandler';
import { ROOM_SWITCH_EVENTS } from '@jam-band/shared';
import { loggingService } from "@/shared/infrastructure/logging/LoggingService";

/**
 * RoomSwitchHandler - Controls transitions between Perform and Arrange Rooms (BR-10).
 * Extracted from RoomLifecycleHandler to comply with Single Responsibility Principle.
 */
export class RoomSwitchHandler {
  constructor(private readonly handler: RoomLifecycleHandler) {}

  /**
   * Handle room owner initiating a switch to another room.
   * Validates the user is the room owner, validates the target room exists,
   * and broadcasts the switch event to all other members in the current room.
   */
  async handleInitiateSwitch(socket: Socket, data: { targetRoomId: string; targetRoomType: 'perform' | 'arrange' }): Promise<void> {
    try {
      let session = this.handler.roomSessionManager.getRoomSession(socket.id);
      if (!session) {
        // The in-memory session may be missing if the socket reconnected (new socket.id).
        // Fall back to Redis to restore the session.
        session = await this.handler.roomSessionManager.getRoomSessionFromRedis(socket.id);
      }
      if (!session) {
        socket.emit(ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED, {
          success: false,
          error: 'No active session found'
        });
        return;
      }

      const roomId = session.roomId;
      const userId = session.userId;

      // Validate user is room owner
      const currentRoom = await this.handler.roomLifecycleService.getRoom(roomId);
      if (!currentRoom) {
        socket.emit(ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED, {
          success: false,
          error: 'Current room not found'
        });
        return;
      }

      // Check ownership using room.owner (persistent field) to handle the case where
      // the owner is in grace period (temporarily isDisconnected) and not yet in bandMembers
      const isOwner = currentRoom.owner === userId;
      if (!isOwner) {
        socket.emit(ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED, {
          success: false,
          error: 'Only the room owner can initiate a room switch'
        });
        return;
      }

      // Validate target room exists
      const targetRoom = await this.handler.roomLifecycleService.getRoom(data.targetRoomId);
      if (!targetRoom) {
        socket.emit(ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED, {
          success: false,
          error: 'Target room not found'
        });
        return;
      }

      // Get username from bandMembers if isAvailable, otherwise fall back to audiences
      const user = currentRoom.bandMembers.get(userId) || currentRoom.audiences.get(userId);
      const ownerUsername = user?.username ?? '';

      const ownerSwitchedPayload = {
        targetRoomId: data.targetRoomId,
        targetRoomType: data.targetRoomType,
        ownerUsername,
        ownerUserId: userId,
      };

      const roomNamespace = this.handler.getOrCreateRoomNamespace(roomId);
      let notifiedMemberCount = 0;

      if (roomNamespace) {
        const roomSessions = this.handler.roomSessionManager.getRoomSessions(roomId);
        for (const [socketId, roomSession] of roomSessions.entries()) {
          if (socketId === socket.id || roomSession.userId === userId) {
            continue;
          }

          const memberSocket = roomNamespace.sockets.get(socketId);
          if (!memberSocket) {
            continue;
          }

          memberSocket.emit(ROOM_SWITCH_EVENTS.OWNER_SWITCHED, ownerSwitchedPayload);
          notifiedMemberCount++;
        }
      }

      if (notifiedMemberCount === 0) {
        socket.to(roomId).emit(ROOM_SWITCH_EVENTS.OWNER_SWITCHED, ownerSwitchedPayload);
      }

      // COLL-14 FIX: Remove user from current room atomically to prevent dual presence
      // This ensures user is removed from old room before joining new room
      // Prevents partial disconnect leaving user in both rooms simultaneously
      
      // Clear grace period timer if exists to prevent race with timeout callback
      const existingTimer = this.handler.ownerGracePeriodTimers.get(roomId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.handler.ownerGracePeriodTimers.delete(roomId);
      }

      // Send ack BEFORE handleLeaveRoom: namespace cleanup (when room is empty after owner leaves)
      // calls disconnectSockets(true) which disconnects user1's socket, making subsequent
      // socket.emit() silently fail. Sending the ack first guarantees it reaches the client.
      socket.emit(ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED, {
        success: true,
        targetRoomId: data.targetRoomId,
        targetRoomType: data.targetRoomType,
      });

      try {
        await this.handler.handleLeaveRoom(socket, true);

        loggingService.logInfo('Room owner initiated switch', {
          roomId,
          userId,
          username: ownerUsername,
          targetRoomId: data.targetRoomId,
          targetRoomType: data.targetRoomType,
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'handleInitiateSwitch.handleLeaveRoom',
          socketId: socket.id,
          roomId,
          userId,
        });
        // Ack already wasSent; log the error but do not re-emit a failure response
      }
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'handleInitiateSwitch',
        socketId: socket.id,
      });
      socket.emit(ROOM_SWITCH_EVENTS.SWITCH_ACKNOWLEDGED, {
        success: false,
        error: 'Failed to initiate room switch'
      });
    }
  }
}
