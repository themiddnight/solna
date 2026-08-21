import type { Socket, Namespace } from 'socket.io';
import type { RoomSessionManager } from '../../../domains/room-management/infrastructure/services/RoomSessionManager';
import type { RoomLifecycleService } from '../../../domains/room-management/application/RoomLifecycleService';
import { loggingService } from "../../../shared/infrastructure/logging/LoggingService";
import type { SocketErrorCode } from '@jam-band/shared';
import { EPHEMERAL_COMMIT_TIMEOUT_MS, createSocketErrorPayload } from '@jam-band/shared';
import type { BaseRoomStateService } from '../../domain/room-state/BaseRoomStateService';
import type { BaseRoomState } from '../../domain/room-state/BaseRoomState';

/**
 * TR-10: Ephemeral commit safety net entry
 * Key: `${roomId}:${userId}:${fieldName}`
 * Value: { value: unknown, timerId: NodeJS.Timeout }
 */
type EphemeralCommitEntry = {
  value: unknown;
  timerId: NodeJS.Timeout;
};

/* eslint-disable @typescript-eslint/member-ordering */
export abstract class BaseRoomHandler<
  TStateService extends BaseRoomStateService<TState>,
  TState extends BaseRoomState = BaseRoomState
> {
  protected abstract readonly roomType: 'arrange' | 'perform';
  protected pendingEphemeralCommits = new Map<string, EphemeralCommitEntry>();

  protected abstract readonly eventPrefix: string;

  constructor(
    protected stateService: TStateService,
    protected roomSessionManager: RoomSessionManager,
    protected roomLifecycleService: RoomLifecycleService
  ) {}

  protected async getSession(socket: Socket): Promise<{ roomId: string; userId: string; username: string } | null> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (session == null) {
      return null;
    }

    const room = await this.roomLifecycleService.getRoom(session.roomId);
    if (room == null) {
      loggingService.logError(new Error(`Room not found during session validation`), {
        context: `${this.constructor.name}.getSession`,
        roomId: session.roomId,
        socketId: socket.id,
      });
      return null;
    }

    if (room.roomType !== this.roomType) {
      return null;
    }

    const user = room.bandMembers.get(session.userId) || room.audiences.get(session.userId);

    return {
      roomId: session.roomId,
      userId: session.userId,
      username: user?.username ?? session.userId,
    };
  }

  protected async validateSession(socket: Socket, roomId: string): Promise<{ roomId: string; userId: string; username: string } | null> {
    const registeredSession = this.roomSessionManager.getRoomSession(socket.id);
    const session = await this.getSession(socket);

    if (session == null) {
      // Surface a recovery error ONLY when this socket has a session for THIS room but the room
      // itself is gone (a genuine "rejoin" situation). getSession also returns null when the room
      // exists but is a different roomType than this handler — that means the event was simply
      // routed to the wrong room-type handler (e.g. a perform event reaching the perform handler
      // in an arrange room). That handler must ignore it SILENTLY: emitting "please rejoin" there
      // produced a spurious error/recovery loop in healthy rooms (DEV-199).
      if (registeredSession != null && registeredSession.roomId === roomId) {
        const room = await this.roomLifecycleService.getRoom(roomId);
        if (room == null) {
          socket.emit('error', createSocketErrorPayload('Room session unavailable — please rejoin the room'));
        }
      }
      return null;
    }

    if (session.roomId !== roomId) {
      return null;
    }

    return session;
  }

  /**
   * Validate session with retry — handles race condition where request_state
   * arrives before join_room finishes setting up the session.
   */
  protected async validateSessionWithRetry(
    socket: Socket,
    roomId: string,
    retries = 1,
    delayMs = 500,
  ): Promise<{ roomId: string; userId: string; username: string } | null> {
    let session = await this.getSession(socket);
    if (session != null && session.roomId === roomId) {
      return session;
    }

    for (let i = 0; i < retries; i++) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      session = await this.getSession(socket);
      if (session != null && session.roomId === roomId) {
        return session;
      }
    }

    return null;
  }

  protected broadcast(namespace: Namespace, roomId: string, event: string, data: unknown): void {
    namespace.to(roomId).emit(`${this.eventPrefix}:${event}`, data);
  }

  protected handleError(socket: Socket, error: Error, context: string, roomId?: string, code?: SocketErrorCode): void {
    loggingService.logError(error, { context, roomId });
    socket.emit('error', createSocketErrorPayload(error.message !== '' ? error.message : 'An error occurred', code != null ? { code } : undefined));
  }

  /**
   * TR-10: Schedule an ephemeral commit timeout. If the user doesn't send a commit event
   * within EPHEMERAL_COMMIT_TIMEOUT_MS, this method will call the provided commit handler.
   * Called on ephemeral event, cleared on commit event.
   *
   * @param roomId - Room ID
   * @param userId - User ID
   * @param fieldName - Name of the field being updated (e.g., 'synthParams', 'volume', 'regionDrag')
   * @param value - The ephemeral value to auto-commit if timeout expires
   * @param commitHandler - Async function to call on timeout (should perform the commit)
   */
  protected scheduleEphemeralCommit(
    roomId: string,
    userId: string,
    fieldName: string,
    value: unknown,
    commitHandler: () => Promise<void>
  ): void {
    const key = `${roomId}:${userId}:${fieldName}`;

    // Clear any existing timer for this field
    const existing = this.pendingEphemeralCommits.get(key);
    if (existing != null) {
      clearTimeout(existing.timerId);
    }

    // Schedule new timeout
    const timerId = setTimeout(async () => {
      try {
        await commitHandler();
        loggingService.logInfo('TR-10: Auto-committed ephemeral event on timeout', {
          roomId,
          userId,
          fieldName,
        });
      } catch (error) {
        loggingService.logError(error as Error, {
          context: 'BaseRoomHandler.scheduleEphemeralCommit.timeout',
          roomId,
          userId,
          fieldName,
        });
      }
      this.pendingEphemeralCommits.delete(key);
    }, EPHEMERAL_COMMIT_TIMEOUT_MS);

    this.pendingEphemeralCommits.set(key, { value, timerId });
  }

  /**
   * TR-10: Clear an ephemeral commit timeout (called when user sends commit event)
   *
   * @param roomId - Room ID
   * @param userId - User ID
   * @param fieldName - Name of the field being updated
   */
  protected clearEphemeralCommit(roomId: string, userId: string, fieldName: string): void {
    const key = `${roomId}:${userId}:${fieldName}`;
    const existing = this.pendingEphemeralCommits.get(key);
    if (existing != null) {
      clearTimeout(existing.timerId);
      this.pendingEphemeralCommits.delete(key);
    }
  }

  /**
   * TR-10: Clear all ephemeral commits for a user (called on disconnect)
   *
   * @param userId - User ID to clean up
   */
  protected clearAllEphemeralCommitsForUser(userId: string): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.pendingEphemeralCommits.entries()) {
      if (key.split(':')[1] === userId) {
        clearTimeout(entry.timerId);
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.pendingEphemeralCommits.delete(key));
  }

  /**
   * TR-10: Cleanup all ephemeral commits (called when handler is destroyed or room closes)
   */
  protected clearAllEphemeralCommits(): void {
    for (const [, entry] of this.pendingEphemeralCommits.entries()) {
      clearTimeout(entry.timerId);
    }
    this.pendingEphemeralCommits.clear();
  }

  abstract handleRequestState(socket: Socket, data: { roomId: string }): Promise<void>;
}
