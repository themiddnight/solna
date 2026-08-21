import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload } from '@jam-band/shared';
import type { RoomLifecycleService } from '../../application/RoomLifecycleService';
import type { RoomSessionManager } from '../../infrastructure/services/RoomSessionManager';
import type { NamespaceManager } from '../../../../shared/infrastructure/namespace/NamespaceManager';
import { loggingService } from "../../../../shared/infrastructure/logging/LoggingService";
import { hlsBroadcastService } from '../../../../domains/perform-room/infrastructure/services/HLSBroadcastService';
import type { ToggleBroadcastData, BroadcastAudioChunkData } from '../../../../types';
import { SHARED_EVENTS, ROOM_STATE_EVENTS, CORE_NAMESPACES } from '@jam-band/shared';

/**
 * DEV-191: max base64 length of a single live broadcast audio chunk (~1 MB string ≈ 768 KB binary).
 * Live Opus chunks are a few KB; this is a generous ceiling purely to cap allocation per message.
 */
const MAX_BROADCAST_CHUNK_BASE64_LENGTH = 1024 * 1024;

/**
 * Handler for perform room broadcast events
 * Manages audio streaming from room owner to audience members via HLS
 * Audio chunks are transcoded to HLS format using FFmpeg
 */
export class PerformBroadcastHandler {
  constructor(
    private readonly roomLifecycleService: RoomLifecycleService,
    private readonly roomSessionManager: RoomSessionManager,
    private readonly namespaceManager: NamespaceManager
  ) {}

  /**
   * Handle broadcast toggle from room owner
   */
  async handleToggleBroadcast(socket: Socket, data: ToggleBroadcastData, namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(SHARED_EVENTS.BROADCAST_ERROR, createSocketErrorPayload('No session found'));
      return;
    }

    const { roomId, userId } = session;
    const room = await this.roomLifecycleService.getRoom(roomId);

    if (!room) {
      socket.emit(SHARED_EVENTS.BROADCAST_ERROR, createSocketErrorPayload('Room not found'));
      return;
    }

    // Only room owner can toggle broadcast
    if (room.owner !== userId) {
      socket.emit(SHARED_EVENTS.BROADCAST_ERROR, createSocketErrorPayload('Only room owner can toggle broadcast'));
      return;
    }

    const { isBroadcasting } = data;

    if (isBroadcasting) {
      // Start HLS broadcast
      const hasStarted = hlsBroadcastService.startBroadcast(roomId);
      if (!hasStarted) {
        socket.emit(SHARED_EVENTS.BROADCAST_ERROR, createSocketErrorPayload('Failed to start broadcast'));
        return;
      }

      await this.roomLifecycleService.toggleBroadcast(roomId, true);
      
      // Get playlist URL for audience
      const playlistUrl = hlsBroadcastService.getPlaylistUrl(roomId);
      
      // Notify all users in the room
      namespace.to(roomId).emit(SHARED_EVENTS.BROADCAST_STATE_CHANGED, {
        isBroadcasting: true,
        playlistUrl,
      });

      // Also emit to the /lobby namespace so lobby room cards flip their LIVE badge on
      const lobbyNamespace = this.namespaceManager.getNamespace(CORE_NAMESPACES.LOBBY);
      if (lobbyNamespace) {
        lobbyNamespace.emit(ROOM_STATE_EVENTS.ROOM_BROADCAST_CHANGED, {
          roomId,
          isBroadcasting: true,
        });
      }

      loggingService.logInfo(`HLS broadcast started for room ${roomId}`, { userId, playlistUrl });
    } else {
      // Stop HLS broadcast
      hlsBroadcastService.stopBroadcast(roomId);
      await this.roomLifecycleService.toggleBroadcast(roomId, false);

      // Notify all users in the room
      namespace.to(roomId).emit(SHARED_EVENTS.BROADCAST_STATE_CHANGED, {
        isBroadcasting: false,
        playlistUrl: null,
      });

      // Also emit to the /lobby namespace so lobby room cards flip their LIVE badge off
      const lobbyNamespace = this.namespaceManager.getNamespace(CORE_NAMESPACES.LOBBY);
      if (lobbyNamespace) {
        lobbyNamespace.emit(ROOM_STATE_EVENTS.ROOM_BROADCAST_CHANGED, {
          roomId,
          isBroadcasting: false,
        });
      }

      loggingService.logInfo(`HLS broadcast stopped for room ${roomId}`, { userId });
    }
  }

  /**
   * Handle incoming audio chunk from room owner - pipe to FFmpeg for HLS transcoding
   */
  async handleBroadcastAudioChunk(socket: Socket, data: BroadcastAudioChunkData, _namespace: Namespace): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      return; // Silently ignore if no session
    }

    const { roomId, userId } = session;
    const room = await this.roomLifecycleService.getRoom(roomId);

    if (!room) {
      return;
    }

    // Only room owner can send audio chunks
    if (room.owner !== userId) {
      return;
    }

    // Check if broadcast is active
    if (!room.isBroadcasting) {
      return;
    }

    // DEV-191: bound the chunk size before allocating. A live audio chunk is a few KB; cap the
    // base64 string well above that so a malicious client can't drive unbounded Buffer allocation.
    if (data.chunk.length > MAX_BROADCAST_CHUNK_BASE64_LENGTH) {
      loggingService.logWarn('Dropped oversized broadcast audio chunk', {
        roomId,
        userId,
        length: data.chunk.length,
        limit: MAX_BROADCAST_CHUNK_BASE64_LENGTH,
      });
      return;
    }

    // Decode base64 chunk and write to FFmpeg
    try {
      const buffer = Buffer.from(data.chunk, 'base64');
      hlsBroadcastService.writeAudioChunk(roomId, buffer);
    } catch (err) {
      loggingService.logInfo(`Failed to process audio chunk for room ${roomId}`, { 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
  }

  /**
   * Handle request for current broadcast state
   * Returns playlist URL for HLS playback
   */
  async handleRequestBroadcastState(socket: Socket): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit(SHARED_EVENTS.BROADCAST_STATE, {
        isBroadcasting: false,
        playlistUrl: null,
      });
      return;
    }

    const { roomId } = session;
    const room = await this.roomLifecycleService.getRoom(roomId);

    if (!room) {
      socket.emit(SHARED_EVENTS.BROADCAST_STATE, {
        isBroadcasting: false,
        playlistUrl: null,
      });
      return;
    }

    const isBroadcasting = room.isBroadcasting ?? false;
    const playlistUrl = isBroadcasting ? hlsBroadcastService.getPlaylistUrl(roomId) : null;
    
    socket.emit(SHARED_EVENTS.BROADCAST_STATE, {
      isBroadcasting,
      playlistUrl,
    });
  }

  /**
   * Handle user leaving - stop broadcast if room owner leaves
   */
  async handleUserLeave(roomId: string, userId: string, namespace: Namespace): Promise<void> {
    const room = await this.roomLifecycleService.getRoom(roomId);
    if (!room) return;

    // If the leaving user is the room owner and broadcast is active, stop it
    if (room.owner === userId && room.isBroadcasting) {
      hlsBroadcastService.stopBroadcast(roomId);
      await this.roomLifecycleService.toggleBroadcast(roomId, false);

      namespace.to(roomId).emit(SHARED_EVENTS.BROADCAST_STATE_CHANGED, {
        isBroadcasting: false,
        playlistUrl: null,
      });

      loggingService.logInfo(`HLS broadcast stopped due to owner leaving room ${roomId}`);
    }
  }
}
