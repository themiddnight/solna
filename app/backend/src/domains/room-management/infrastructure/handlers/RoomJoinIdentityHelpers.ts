/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { SOCKET_ERROR_CODES, createSocketErrorPayload } from '@jam-band/shared';
import type { Socket } from 'socket.io';
import type { Room } from '@/types';
import type { JoinRoomEventData } from '@jam-band/shared';
import { loggingService } from "@/shared/infrastructure/logging/LoggingService";
import { ERROR_EVENTS } from '@jam-band/shared';
import { ROOM_CREATION_GRACE_PERIOD_MS } from '@jam-band/shared';
import type { AuthUser } from '@/domains/auth/domain/models/User';
import type { RoomLifecycleHandler } from './RoomLifecycleHandler';

/**
 * Handle joining a room via Socket
 */
/**
 * Resolves the authenticated or guest identity from socket data.
 * Returns null and emits a JOIN_ERROR if identity cannot be resolved.
 */
export async function resolveJoinIdentity(
  handler: RoomLifecycleHandler,
  socket: Socket,
  data: JoinRoomEventData,
): Promise<{ finalUserId: string; finalUsername: string } | null> {
  const { username } = data;
  const authUser = (socket.data as { user?: AuthUser }).user;

  // Identity is always established by socket auth (DEV-179) — registered or guest — and is
  // never taken from the client payload. The namespace auth middleware rejects unauthenticated
  // sockets, so authUser should always be present; guard defensively.
  if (authUser == null) {
    socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload('Authentication required'));
    return null;
  }

  const finalUserId: string = authUser.id;
  const finalUsername: string = authUser.username != null ? authUser.username : (username || `User_${authUser.id.slice(0, 6)}`);

  return { finalUserId, finalUsername };
}

/**
 * Validates that the room is not a ghost room (empty with no grace-period users).
 * Emits the appropriate error event and returns true if the room IS a ghost (caller should return).
 * Skip for existing/grace-period users and newly created rooms.
 */
export async function checkGhostRoom(
  handler: RoomLifecycleHandler,
  socket: Socket,
  roomIdString: string,
  room: Room,
  userIdString: string,
  isInGracePeriod: boolean,
): Promise<boolean> {
  const isNewRoom = Date.now() - new Date(room.createdAt).getTime() < ROOM_CREATION_GRACE_PERIOD_MS;
  const allExistingUsers = [...room.bandMembers.values(), ...room.audiences.values()];

  if (isNewRoom || isInGracePeriod) return false;

  if (allExistingUsers.length === 0) {
    const roomGracePeriodUsers = handler.roomLifecycleService.getRoomGracePeriodUsers(roomIdString);
    const hasMusicianInGracePeriod = roomGracePeriodUsers.some((entry) => {
      const role = entry.userData.role;
      return role === 'room_owner' || role === 'band_member';
    });

    if (hasMusicianInGracePeriod) {
      loggingService.logInfo('handleJoinRoom: JOIN_ERROR — musician in grace period', { roomId: roomIdString, userId: userIdString });
      socket.emit(ERROR_EVENTS.JOIN_ERROR, createSocketErrorPayload(
        'This room is temporarily unavailable. The owner may be reconnecting. Please try again shortly.',
        { code: SOCKET_ERROR_CODES.SESSION_UNAVAILABLE, roomId: roomIdString },
      ));
      return true;
    }

    loggingService.logInfo('handleJoinRoom: GHOST_ROOM_ERROR', {
      roomId: roomIdString,
      userId: userIdString,
      gracePeriodUsers: handler.roomLifecycleService.getRoomGracePeriodUsers(roomIdString).map(u => u.userId),
    });
    socket.emit(ERROR_EVENTS.GHOST_ROOM_ERROR, createSocketErrorPayload(
      'This room is no longer active.',
      { code: SOCKET_ERROR_CODES.ROOM_INACTIVE, roomId: roomIdString, roomName: room.name },
    ));
    return true;
  }

  // Room has users — verify at least one has a real active socket or is in grace period
  const otherUsers = allExistingUsers.filter(u => u.id !== userIdString);
  if (otherUsers.length > 0) {
    let hasRealActiveUser = false;
    for (const existingRoomUser of otherUsers) {
      if (handler.roomLifecycleService.isUserInGracePeriod(existingRoomUser.id, roomIdString)) {
        hasRealActiveUser = true;
        break;
      }
      const isActive = await handler.roomSessionManager.isUserActiveInRoom(roomIdString, existingRoomUser.id);
      if (isActive) {
        hasRealActiveUser = true;
        break;
      }
    }

    if (!hasRealActiveUser) {
      loggingService.logInfo('Ghost room detected during join — all existing users have no active sessions', {
        roomId: roomIdString,
        roomName: room.name,
        staleUserCount: otherUsers.length,
      });
      socket.emit(ERROR_EVENTS.GHOST_ROOM_ERROR, createSocketErrorPayload(
        'This room has no active sessions.',
        { code: SOCKET_ERROR_CODES.ROOM_NO_ACTIVE_SESSIONS, roomId: roomIdString, roomName: room.name },
      ));
      return true;
    }
  }

  return false;
}
