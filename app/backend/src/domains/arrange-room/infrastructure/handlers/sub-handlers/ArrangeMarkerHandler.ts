import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload } from '@jam-band/shared';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import type { ChordBlock } from '@jam-band/shared';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import type { Track, Region, TimeMarker, TimeMarkerUpdate } from '../../../domain/models/ArrangeRoomState';

export class ArrangeMarkerHandler {
  constructor(private readonly handler: ArrangeRoomHandler) {}

  /**
   * Handle marker add
   */
  async handleMarkerAdd(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; marker: { id: string; position: number; description?: string | undefined; color?: string | undefined } }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      const marker = { ...data.marker, description: data.marker.description ?? '' };

      // Update backend state
      await this.handler.getStateService().addMarker(data.roomId, marker);

      // Broadcast to all users in the room (exclude sender)
      socket.to(data.roomId).emit(ARRANGE_EVENTS.MARKER_ADDED, {
        marker,
        userId: session.userId,
      });

      loggingService.logInfo('Marker added', {
        roomId: data.roomId,
        markerId: data.marker.id,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeMarkerHandler:handleMarkerAdd',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to add marker'));
    }
  }

  /**
   * Handle marker update
   */
  async handleMarkerUpdate(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; markerId: string; updates: TimeMarkerUpdate }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      // Update backend state
      await this.handler.getStateService().updateMarker(data.roomId, data.markerId, data.updates);

      // Broadcast to all users in the room (exclude sender)
      socket.to(data.roomId).emit(ARRANGE_EVENTS.MARKER_UPDATED, {
        markerId: data.markerId,
        updates: data.updates,
        userId: session.userId,
      });

      loggingService.logInfo('Marker updated', {
        roomId: data.roomId,
        markerId: data.markerId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeMarkerHandler:handleMarkerUpdate',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to update marker'));
    }
  }

  /**
   * Handle marker delete
   */
  async handleMarkerDelete(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; markerId: string }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      // Update backend state
      await this.handler.getStateService().removeMarker(data.roomId, data.markerId);

      // Broadcast to all users in the room (exclude sender)
      socket.to(data.roomId).emit(ARRANGE_EVENTS.MARKER_DELETED, {
        markerId: data.markerId,
        userId: session.userId,
      });

      loggingService.logInfo('Marker deleted', {
        roomId: data.roomId,
        markerId: data.markerId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeMarkerHandler:handleMarkerDelete',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to delete marker'));
    }
  }

  /**
   * Handle full state update (for undo/redo operations)
   */
  async handleFullStateUpdate(
    socket: Socket,
    namespace: Namespace,
    data: {
      roomId: string;
      state: {
        tracks: Track[];
        regions: Region[];
        markers: TimeMarker[];
        chordTrack: ChordBlock[];
        bpm: number;
        timeSignature: { numerator: number; denominator: number };
      };
    }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      // Permission check: only the project owner (or room owner before first save) may
      // broadcast a full state replacement. This prevents non-owners from overwriting
      // the entire Arrange state via undo/redo events.
      const roomState = await this.handler.getStateService().getState(data.roomId);
      if (!roomState) {
        return;
      }
      const isProjectOwner = roomState.projectOwnerId
        ? roomState.projectOwnerId === session.userId
        : true; // Before first save, any band member can undo/redo
      if (!isProjectOwner) {
        socket.emit('error', createSocketErrorPayload('Only the project owner can perform undo/redo'));
        return;
      }

      // DEV-32: Monitor payload size before persisting and broadcasting
      const FULL_STATE_WARN_BYTES = 50_000;   // 50 KB
      const FULL_STATE_ERROR_BYTES = 200_000; // 200 KB
      const payloadBytes = JSON.stringify(data.state).length;
      if (payloadBytes >= FULL_STATE_ERROR_BYTES) {
        loggingService.logError(new Error('full_state_update payload size critical'), {
          context: 'ArrangeMarkerHandler:handleFullStateUpdate',
          roomId: data.roomId,
          payloadSizeKB: Math.round(payloadBytes / 1024),
          tracks: data.state.tracks.length,
          regions: data.state.regions.length,
        });
      } else if (payloadBytes >= FULL_STATE_WARN_BYTES) {
        loggingService.logInfo('full_state_update payload size warning', {
          roomId: data.roomId,
          payloadSizeKB: Math.round(payloadBytes / 1024),
          tracks: data.state.tracks.length,
          regions: data.state.regions.length,
        });
      }

      // Update backend state with the new full state
      await this.handler.getStateService().setFullState(data.roomId, data.state);

      // Broadcast to all other users in the room (exclude sender)
      socket.to(data.roomId).emit(ARRANGE_EVENTS.FULL_STATE_UPDATE, {
        userId: session.userId,
        state: data.state,
      });

      loggingService.logInfo('Full state updated (undo/redo)', {
        roomId: data.roomId,
        userId: session.userId,
        tracks: data.state.tracks.length,
        regions: data.state.regions.length,
        markers: data.state.markers.length,
        payloadSizeKB: Math.round(payloadBytes / 1024),
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeMarkerHandler:handleFullStateUpdate',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to update full state'));
    }
  }

  /**
   * Handle project scale change
   */
  async handleProjectScaleChange(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; rootNote: string; scale: 'major' | 'minor' }
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session) return;

    try {
      await this.handler.getStateService().updateScale(data.roomId, data.rootNote, data.scale);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.PROJECT_SCALE_CHANGED, {
        rootNote: data.rootNote,
        scale: data.scale,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeMarkerHandler:handleProjectScaleChange',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to change project scale'));
    }
  }
}
