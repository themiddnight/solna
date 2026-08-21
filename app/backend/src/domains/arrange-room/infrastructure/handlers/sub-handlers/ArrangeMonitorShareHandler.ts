import type { Socket, Namespace } from 'socket.io';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';

export class ArrangeMonitorShareHandler {
  constructor(private readonly handler: ArrangeRoomHandler) {}

  /**
   * Handle realtime recording preview updates
   */
  async handleRecordingPreview(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      preview: {
        trackId: string;
        recordingType: 'midi' | 'audio';
        startBeat: number;
        durationBeats: number;
      };
    }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    namespace.to(data.roomId).emit(ARRANGE_EVENTS.RECORDING_PREVIEW, {
      userId: session.userId,
      username: session.username,
      preview: data.preview,
    });
  }

  /**
   * Handle recording preview end events
   */
  async handleRecordingPreviewEnd(socket: Socket, namespace: Namespace, data: { roomId: string }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    namespace.to(data.roomId).emit(ARRANGE_EVENTS.RECORDING_PREVIEW_END, {
      userId: session.userId,
    });
  }

  /**
   * Handle monitor share state change (user starts/stops sharing)
   */
  async handleVoiceState(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; isMuted: boolean }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      await this.handler.getStateService().setVoiceState(data.roomId, session.userId, data.isMuted);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.VOICE_STATE, {
        userId: session.userId,
        isMuted: data.isMuted,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeMonitorShareHandler:handleVoiceState',
        roomId: data.roomId,
      });
    }
  }

  async handleMonitorShareState(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      userId: string;
      username: string;
      sharing: boolean;
      trackId: string | null;
    }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // DEV-179: broadcaster identity comes from the token-verified session, never the client
    // payload — otherwise a client could attribute a monitor share to another user. getSession()
    // always resolves username to the room member's name (falling back to the userId).
    const userId = session.userId;
    const username = session.username;

    try {
      await this.handler.getStateService().setMonitorShareState(data.roomId, userId, {
        username,
        trackId: data.sharing ? data.trackId : null,
      });
      // Broadcast to all other users in the room (exclude sender)
      socket.to(data.roomId).emit(ARRANGE_EVENTS.MONITOR_SHARE_STATE, {
        userId,
        username,
        sharing: data.sharing,
        trackId: data.trackId,
      });

      loggingService.logInfo('Monitor share state changed', {
        roomId: data.roomId,
        userId,
        sharing: data.sharing,
        trackId: data.trackId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeMonitorShareHandler:handleMonitorShareState',
        roomId: data.roomId,
      });
    }
  }

  /**
   * Handle monitor share note (user plays a note while sharing)
   */
  async handleMonitorShareNote(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      userId: string;
      trackId: string;
      noteData: {
        note: number;
        velocity: number;
        type: 'noteon' | 'noteoff';
      };
      timestamp: number;
    }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // DEV-179: note attribution comes from the token-verified session, never the client payload.
    const userId = session.userId;

    try {
      loggingService.logInfo('Monitor share note', {
        roomId: data.roomId,
        userId,
        trackId: data.trackId,
        note: data.noteData.note,
        type: data.noteData.type,
      });

      // Broadcast to all other users in the room (exclude sender)
      socket.to(data.roomId).emit(ARRANGE_EVENTS.MONITOR_SHARE_NOTE, {
        userId,
        trackId: data.trackId,
        noteData: data.noteData,
        timestamp: data.timestamp,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeMonitorShareHandler:handleMonitorShareNote',
        roomId: data.roomId,
      });
    }
  }

  /**
   * Clean up monitor share states when user leaves
   */
  async handleUserLeaveMonitorShare(roomId: string, userId: string, namespace: Namespace): Promise<void> {
    if (await this.handler.getStateService().removeVoiceState(roomId, userId)) {
      namespace.to(roomId).emit(ARRANGE_EVENTS.VOICE_STATE, { userId, isMuted: true });
    }

    const removedMonitorShare = await this.handler.getStateService().removeMonitorShareState(roomId, userId);
    if (removedMonitorShare) {
      namespace.to(roomId).emit(ARRANGE_EVENTS.MONITOR_SHARE_STATE, {
        userId,
        username: removedMonitorShare.username,
        sharing: false,
        trackId: null,
      });
    }
  }
}
