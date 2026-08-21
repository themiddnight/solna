/**
 * Extracted from RoomConnectionHandler — TR-20 facade split.
 * Contains the handleLeaveRoom execution logic as a plain async function.
 * The facade delegates here so RoomConnectionHandler stays under 800 lines.
 */

import type { Socket } from 'socket.io';
import type { RoomLifecycleHandler } from './RoomLifecycleHandler';
import { ROOM_STATE_EVENTS, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, GRACE_PERIOD_MEMBER_MS } from '@jam-band/shared';
import { redisStateService } from '@/shared/infrastructure/caching/RedisStateService';
import { projectRoomService } from '@/domains/arrange-room/infrastructure/storage/ProjectRoomService';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import { MemberLeft } from '@/shared/domain/events/RoomEvents';

export async function executeLeaveRoom(
  socket: Socket,
  isIntendedLeave: boolean,
  handler: RoomLifecycleHandler,
): Promise<void> {
  const session = handler.roomSessionManager.getRoomSession(socket.id);

  if (!session) {
    socket.emit(ROOM_STATE_EVENTS.LEAVE_CONFIRMED, { message: 'Successfully left the room' });
    return;
  }

  const roomIdString = session.roomId;
  const userIdString = session.userId;

  // Check if this socket has been replaced by a new session for the same user
  const activeSocketId = await handler.roomSessionManager.findSocketByUserIdAsync(roomIdString, userIdString);
  if (activeSocketId && activeSocketId !== socket.id) {
    loggingService.logInfo('Skipping room leave cleanup for replaced duplicate session', {
      roomId: roomIdString,
      userId: userIdString,
      oldSocketId: socket.id,
      newSocketId: activeSocketId
    });
    socket.emit(ROOM_STATE_EVENTS.LEAVE_CONFIRMED, { message: 'Successfully left the room' });
    await handler.roomSessionManager.removeSession(socket.id);
    return;
  }

  const room = await handler.roomLifecycleService.getRoom(roomIdString);
  const user = room ? (room.bandMembers.get(userIdString) || room.audiences.get(userIdString)) : undefined;

  // Always confirm the leave to the user first to prevent UI hanging
  socket.emit(ROOM_STATE_EVENTS.LEAVE_CONFIRMED, { message: 'Successfully left the room' });

  // Remove user from socket room immediately to prevent further message reception
  try {
    void socket.leave(roomIdString);
  } catch (leaveError) {
    loggingService.logError(leaveError as Error, {
      context: 'handleLeaveRoom.socketLeave',
      roomId: roomIdString,
      userId: userIdString,
      socketId: socket.id,
    });
    // Non-fatal: continue with cleanup even if socket.leave fails
  }

  if (!room) {
    await handler.roomSessionManager.removeSession(socket.id);
    return;
  }

  if (!user) {
    const roomNamespace = handler.getOrCreateRoomNamespace(roomIdString);
    if (roomNamespace) {
      roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await handler.buildRoomPayload(room, roomIdString));
    }

    if (isIntendedLeave) {
      handler.roomLifecycleService.markUserIntentionalLeave(userIdString, roomIdString);
    }

    await handler.roomSessionManager.removeSession(socket.id);
    return;
  }

  // Domain-specific state cleanup — must happen BEFORE Redis membership removal
  // so domain handlers can read session/user data from Redis.
  // This was previously only called from the disconnect handler; now consolidated
  // so both explicit LEAVE_ROOM and disconnect paths clean up properly.
  const socketNamespace = socket.nsp;
  try {
    if (handler.performEventHandler) {
      await handler.performEventHandler.handleUserLeave(roomIdString, userIdString, socketNamespace);
    }
    if (handler.arrangeEventHandler) {
      await handler.arrangeEventHandler.handleUserLeave(roomIdString, userIdString, socketNamespace);
    }
    if (handler.voiceConnectionHandler) {
      handler.voiceConnectionHandler.handleLeaveVoiceNamespace(
        socket,
        { roomId: roomIdString, userId: userIdString },
        socketNamespace,
      );
    }
  } catch (domainError) {
    loggingService.logError(domainError as Error, {
      context: 'handleLeaveRoom.domainCleanup',
      roomId: roomIdString,
      userId: userIdString,
    });
    // Continue with membership removal even if domain cleanup fails
  }

  // Release arrange locks held by this user
  await handler.releaseArrangeLocksForUser(roomIdString, userIdString);

  // Update active user count for associated project.
  // DEV-143 (L-2): This is the single decrement point per leave. Audit confirms:
  // - deleteRoomAndCleanup does NOT call decrementUserCount (it calls clearActiveRoomByRoomId)
  // - RoomCleanupService.cleanupExpiredGraceTime does NOT call decrementUserCount
  // - Each leave triggers exactly one decrement; no double-decrement risk on room deletion.
  const project = await projectRoomService.getProjectByActiveRoom(roomIdString);
  if (project) {
      await projectRoomService.decrementUserCount(project.id);
  }

  // If room owner leaves, handle ownership transfer or room closure
  if (user.role === 'room_owner') {
    // Pass the user snapshot fetched at the top of executeLeaveRoom (before leave_confirmed).
    // This ensures handleRoomOwnerLeaving has fallback user data even if the concurrent
    // disconnect handler has already removed the user from Redis by the time it runs.
    await handler.ownershipHandler.handleRoomOwnerLeaving(session.roomId, session.userId, isIntendedLeave, user);
  } else {
    // Wrap removal + close decision in a distributed lock to prevent race conditions
    // between concurrent leave operations (Bug #2).
    const lockKey = `room-leave-lock:${session.roomId}`;
    try {
      await redisStateService.executeWithLock(
        lockKey,
        DISTRIBUTED_LOCK_TIMEOUT_MS,
        DISTRIBUTED_LOCK_TTL_MS,
        async () => {
          // Re-fetch fresh room state inside the lock
          const freshRoom = await handler.roomLifecycleService.getRoom(session.roomId);
          const freshUser = freshRoom
            ? (freshRoom.bandMembers.get(session.userId) || freshRoom.audiences.get(session.userId))
            : undefined;

          if (!freshRoom || !freshUser) {
            // User already removed by a concurrent operation — clean up session only
            await handler.roomSessionManager.removeSession(socket.id);
            return;
          }

          // Disconnect/rejoin race: the entry guard ran before acquiring this
          // lock, so a newer socket for this user may have registered in the
          // meantime (the user rejoined). If so, the user is active again —
          // removing them here and broadcasting the grace-period snapshot would
          // mark the freshly-joined user as "Reconnecting" on their own client
          // until a manual refresh. Skip removal/broadcast and drop this stale
          // session only.
          const newerSocketId = await handler.roomSessionManager.findSocketByUserIdAsync(
            session.roomId,
            session.userId,
          );
          if (newerSocketId && newerSocketId !== socket.id) {
            loggingService.logInfo('Leave: newer session detected inside lock, skipping removal/broadcast', {
              roomId: session.roomId,
              userId: session.userId,
              oldSocketId: socket.id,
              newerSocketId,
            });
            await handler.roomSessionManager.removeSession(socket.id);
            return;
          }

          const removedUser = await handler.roomMembershipService.removeUserFromRoom(
            session.roomId, session.userId, isIntendedLeave,
          );

          if (!removedUser) {
            // Bug #4: Redis write failed — user was NOT removed. Do not emit USER_LEFT.
            loggingService.logError(new Error('removeUserFromRoom failed — user may still appear in room'), {
              context: 'RoomConnectionHandler.handleLeaveRoom.removeUserFailed',
              roomId: session.roomId,
              userId: session.userId,
              isIntendedLeave,
            });
            await handler.roomSessionManager.removeSession(socket.id);
            return;
          }

          // Publish MemberLeft event for intentional leaves to notify lobby
          if (isIntendedLeave && handler.eventBus) {
            const memberLeftEvent = new MemberLeft(
              session.roomId,
              session.userId,
              removedUser.username,
            );
            await handler.eventBus.publish(memberLeftEvent);
          }

          // Get or create the room namespace for proper isolation
          const roomNamespace = handler.getOrCreateRoomNamespace(session.roomId);

          // Check if room should be closed after regular user leaves
          const shouldClose = await handler.roomLifecycleService.shouldCloseRoom(session.roomId);

          if (shouldClose) {
            if (roomNamespace) {
              roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_CLOSED, { message: 'Room is empty and has been closed' });
            }

            // Attempt to close room
            await handler.deleteRoomAndCleanup(session.roomId);
          } else {
            // Room still has users, notify others and broadcast updated state
            if (roomNamespace) {
              // First, emit user_left event so frontend can clean up immediately
              roomNamespace.emit(ROOM_STATE_EVENTS.USER_LEFT, { user: removedUser });

              // Then, send updated room state to all users to ensure UI consistency
              const updatedRoom = await handler.roomLifecycleService.getRoom(session.roomId);
              if (updatedRoom) {
                roomNamespace.emit(ROOM_STATE_EVENTS.ROOM_STATE_UPDATED, await handler.buildRoomPayload(updatedRoom, session.roomId));
              }
            }

            // Schedule an immediate check when this user's grace period expires
            if (!isIntendedLeave && removedUser.role !== 'audience') {
              const memberTimer = setTimeout(() => {
                void (async () => {
                  try {
                    handler.clearMemberGracePeriodTimer(roomIdString, userIdString);

                    // Bug #6: Defensive check — room may have been deleted by owner's
                    // grace period timer (10.5s, which fires before this 30.5s timer).
                    const existingRoom = await handler.roomLifecycleService.getRoom(roomIdString);
                    if (!existingRoom) {
                      loggingService.logInfo('memberGracePeriodTimer: room already deleted, skipping', {
                        roomId: roomIdString,
                        userId: userIdString,
                      });
                      return;
                    }

                    // Check if room is completely empty after grace period
                    if (await handler.roomLifecycleService.shouldCloseRoom(roomIdString)) {
                      loggingService.logInfo('Closing room immediately after last user grace period expired', { roomId: roomIdString });

                      const currentNamespace = handler.getOrCreateRoomNamespace(roomIdString);
                      if (currentNamespace) {
                        currentNamespace.emit(ROOM_STATE_EVENTS.ROOM_CLOSED, { message: 'Room is empty and has been closed' });
                      }

                      handler.metronomeService.cleanupRoom(roomIdString);
                      handler.namespaceManager.cleanupRoomNamespace(roomIdString);
                      handler.namespaceManager.cleanupApprovalNamespace(roomIdString);
                      const isDeleted = await handler.deleteRoomAndCleanup(roomIdString);
                      if (isDeleted) {
                        handler.broadcastToLobby(ROOM_STATE_EVENTS.ROOM_CLOSED_BROADCAST, { roomId: roomIdString });
                      }
                      return;
                    }

                    const currentRoom = await handler.roomLifecycleService.getRoom(roomIdString);
                    const currentNamespace = handler.getOrCreateRoomNamespace(roomIdString);
                    if (currentRoom && currentNamespace) {
                      currentNamespace.emit(
                        ROOM_STATE_EVENTS.ROOM_STATE_UPDATED,
                        await handler.buildRoomPayload(currentRoom, roomIdString),
                      );
                    }
                  } catch (error) {
                    loggingService.logError(error as Error, {
                      context: 'RoomConnectionHandler.handleLeaveRoom.memberGracePeriodTimer',
                      roomId: roomIdString,
                      userId: userIdString,
                    });
                  }
                })();
              }, GRACE_PERIOD_MEMBER_MS + 500); // Add 500ms safety buffer to ensure grace period has fully expired
              handler.setMemberGracePeriodTimer(roomIdString, userIdString, memberTimer);
            }
          }
        },
      );
    } catch (lockError) {
      loggingService.logError(lockError as Error, {
        context: 'handleLeaveRoom.leaveLock',
        roomId: session.roomId,
        userId: session.userId,
      });
    }
  }

  // Clean up session last
  await handler.roomSessionManager.removeSession(socket.id);
}
