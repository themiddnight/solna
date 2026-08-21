import type { Socket } from 'socket.io';
import { createSocketErrorPayload, ROOM_STATE_EVENTS, ROOM_LIFECYCLE_EVENTS } from '@jam-band/shared';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { RoomLifecycleHandler } from './RoomLifecycleHandler';

export function scheduleDuplicateSessionKick(params: {
  handler: RoomLifecycleHandler;
  roomId: string;
  userId: string;
  oldSocketId: string;
  newSocketId: string;
}): void {
  const { handler, roomId, userId, oldSocketId, newSocketId } = params;
  loggingService.logInfo('Kicking duplicate device session globally', {
    roomId,
    userId,
    oldSocketId,
    newSocketId,
  });

  const namespacePath = `/room/${roomId}`;
  handler.io.of(namespacePath).to(oldSocketId).emit(ROOM_STATE_EVENTS.KICKED, {
    message: 'You have joined this room from another device.',
  });

  const ioInstance = handler.io;
  const sessionManager = handler.roomSessionManager;
  setTimeout(async () => {
    try {
      ioInstance.of(namespacePath).to(oldSocketId).disconnectSockets(true);
      await sessionManager.removeSession(oldSocketId);
    } catch (err) {
      loggingService.logError(err as Error, {
        context: 'RoomConnectionHandler.handleJoinRoom.delayedKickDisconnect',
        roomId,
        oldSocketId,
      });
    }
  }, 500);
}

export function bindMembershipVerification(socket: Socket, handler: RoomLifecycleHandler): void {
  socket.removeAllListeners(ROOM_LIFECYCLE_EVENTS.VERIFY_MEMBERSHIP);
  socket.on(ROOM_LIFECYCLE_EVENTS.VERIFY_MEMBERSHIP, async (_data: { userId?: string; expectedRole?: string }) => {
    const session = handler.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(ROOM_LIFECYCLE_EVENTS.VERIFICATION_FAILED, createSocketErrorPayload('No session found'));
      return;
    }

    const room = await handler.roomLifecycleService.getRoom(session.roomId);
    if (!room) {
      socket.emit(ROOM_LIFECYCLE_EVENTS.VERIFICATION_FAILED, createSocketErrorPayload('Room not found'));
      return;
    }

    const user = room.bandMembers.get(session.userId) || room.audiences.get(session.userId);
    if (!user) {
      socket.emit(ROOM_LIFECYCLE_EVENTS.VERIFICATION_FAILED, createSocketErrorPayload('User not in room'));
      return;
    }

    socket.emit(ROOM_LIFECYCLE_EVENTS.MEMBERSHIP_VERIFIED, {
      user,
      room: {
        id: room.id,
        name: room.name,
        userCount: room.bandMembers.size + room.audiences.size,
      },
    });
  });
}
