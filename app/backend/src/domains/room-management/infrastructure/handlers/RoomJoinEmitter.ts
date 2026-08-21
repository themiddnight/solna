import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload, ROOM_STATE_EVENTS, SOCKET_ERROR_CODES } from '@jam-band/shared';
import type { BandMember, Room, User } from '@/types';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { PhaseTimer } from '@/shared/infrastructure/profiling/PhaseTimer';
import type { RoomLifecycleHandler } from './RoomLifecycleHandler';

export async function emitJoinComplete(
  handler: RoomLifecycleHandler,
  params: {
    socket: Socket;
    roomIdString: string;
    userIdString: string;
    user: User;
    room?: Room;
    /** Optional hot-path profiler (DEV-178) — marks broadcast sub-phases when provided. */
    timer?: PhaseTimer;
    extraBroadcasts?: (
      roomNamespace: Namespace,
      room: Room,
      preBuiltPayload: Awaited<ReturnType<RoomLifecycleHandler['buildRoomPayload']>>,
    ) => Promise<void>;
  }
): Promise<void> {
  const roomIdTyped = handler.ensureRoomId(params.roomIdString);
  const userIdTyped = handler.ensureUserId(params.userIdString);

  const roomNamespace = handler.getOrCreateRoomNamespace(roomIdTyped);
  if (!roomNamespace) {
    loggingService.logError(new Error('Failed to create room namespace for join complete'), {
      context: 'RoomConnectionHandler.emitJoinComplete',
      roomId: params.roomIdString,
    });
    return;
  }

  const freshRoom = params.room ?? await handler.roomLifecycleService.getRoom(params.roomIdString);
  if (!freshRoom) {
    params.socket.emit('error', createSocketErrorPayload('Room not found'));
    return;
  }

  try {
    void params.socket.join(params.roomIdString);
  } catch (joinError) {
    loggingService.logError(joinError as Error, {
      context: 'emitJoinComplete.socketJoin',
      roomId: params.roomIdString,
      userId: params.userIdString,
      socketId: params.socket.id,
    });
    params.socket.emit('error', createSocketErrorPayload(
      'Failed to join room channel. You may not receive live updates.',
      { code: SOCKET_ERROR_CODES.OPERATION_FAILED, roomId: params.roomIdString },
    ));
    // Continue — the socket can still receive direct emits; broadcasts will be missed
    // but ROOM_JOINED below is a direct emit, so the client gets room state at least.
  }

  params.timer?.mark('emit.prep');

  // Build payload without invite codes (safe for broadcast to all clients)
  const payload = await handler.buildRoomPayload(freshRoom, params.roomIdString);
  params.timer?.mark('emit.buildPayload');

  // For the room_joined event sent only to this socket: include invite codes if the user is the room owner
  const ownerPayload = params.user.role === 'room_owner'
    ? {
        ...payload,
        room: {
          ...payload.room,
          bandMemberInviteCode: freshRoom.bandMemberInviteCode,
          audienceInviteCode: freshRoom.audienceInviteCode,
        },
      }
    : payload;

  params.socket.emit(ROOM_STATE_EVENTS.ROOM_JOINED, {
    ...ownerPayload,
    effectChains: params.user.role !== 'audience' ? (params.user as BandMember).effectChains : undefined,
    self: params.user,
  });

  params.socket.to(params.roomIdString).emit(ROOM_STATE_EVENTS.USER_JOINED, { user: params.user });
  params.socket.to(params.roomIdString).emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, payload);

  await Promise.all([
    handler.autoRequestSynthParamsForNewUser(params.socket, roomIdTyped, userIdTyped),
    handler.autoRequestSynthParamsForNewUserNamespace(roomNamespace, roomIdTyped, userIdTyped),
    handler.sendInstrumentParamsToNewUser(roomNamespace, roomIdTyped, userIdTyped),
  ]);

  if (params.extraBroadcasts) {
    await params.extraBroadcasts(roomNamespace, freshRoom, payload);
  }

  params.timer?.mark('emit.broadcast');
}
