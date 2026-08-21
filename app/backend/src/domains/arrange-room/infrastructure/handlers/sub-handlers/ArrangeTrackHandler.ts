import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload, ARRANGE_CONSTANTS, SOCKET_ERROR_CODES, isRestrictedUserTier } from '@jam-band/shared';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { Track, TrackUpdate, ArrangeTimeSignature, AudioRegion } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import type { SocketAuthUser } from '@/config/socket';

export class ArrangeTrackHandler {
  constructor(private readonly handler: ArrangeRoomHandler) {}

  /**
   * Handle track add
   */
  async handleTrackAdd(socket: Socket, namespace: Namespace, data: { roomId: string; track: Track }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      const user = (socket.data as { user?: SocketAuthUser | null }).user;
      const isRegistered = user != null && typeof user.userType === 'string' && user.userType.length > 0;
      data.track.ownerId = isRegistered ? session.userId : null;

      const isRestricted = user == null || isRestrictedUserTier(user);
      if (isRestricted) {
        // Best-effort gate: this pre-read is outside the per-room state lock, so two
        // concurrent adds from the same restricted user could both pass. That's a benign
        // single-actor race — the mutex-protected room-wide cap (MAX_TRACKS_PER_ROOM) inside
        // addTrack is the authoritative guard; this only nudges restricted users to register.
        const state = await this.handler.getStateService().getState(data.roomId);
        if ((state?.tracks.length ?? 0) >= ARRANGE_CONSTANTS.MAX_TRACKS_PER_ROOM_RESTRICTED) {
          socket.emit('error', createSocketErrorPayload(
            'Sign up to add more tracks',
            { code: SOCKET_ERROR_CODES.REGISTER_REQUIRED },
          ));
          return;
        }
      }

      await this.handler.getStateService().addTrack(data.roomId, data.track);
      // Use socket.to() to exclude sender, consistent with TR-3 mutation event pattern
      socket.to(data.roomId).emit(ARRANGE_EVENTS.TRACK_ADDED, { track: data.track, userId: session.userId });
      loggingService.logInfo('Track added', { roomId: data.roomId, trackId: data.track.id, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeTrackHandler:handleTrackAdd', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to add track'));
    }
  }

  /**
   * Handle track update
   * Ephemeral for volume/pan (broadcast only), persistent for other fields
   * TR-10: Schedules auto-commit for ephemeral volume/pan updates
   */
  async handleTrackUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; updates: TrackUpdate }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const validation = await this.validateTrackMutation(data.roomId, data.trackId, session.userId, data.updates);
    if (!validation.valid) {
      socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
      return;
    }

    const ephemeralFields = new Set(['volume', 'pan']);
    const updateKeys = Object.keys(data.updates);
    const isEphemeralOnly = updateKeys.every((k) => ephemeralFields.has(k));

    if (isEphemeralOnly) {
      // Ephemeral: broadcast to others only, no Redis write
      socket.to(data.roomId).emit(ARRANGE_EVENTS.TRACK_UPDATED, {
        trackId: data.trackId,
        updates: data.updates,
        userId: session.userId,
      });

      // TR-10: Schedule auto-commit in case user disconnects
      this.handler.scheduleEphemeralCommitPublic(
        data.roomId,
        session.userId,
        `trackProperties:${data.trackId}`,
        data.updates,
        async () => {
          try {
            await this.handler.getStateService().updateTrack(data.roomId, data.trackId, data.updates);
            namespace.to(data.roomId).emit(ARRANGE_EVENTS.TRACK_PROPERTY_COMMITTED, {
              trackId: data.trackId,
              updates: data.updates,
              userId: session.userId,
            });
          } catch (error) {
            loggingService.logError(error as Error, {
              context: 'ArrangeTrackHandler.handleTrackUpdate.autoCommit',
              roomId: data.roomId,
              trackId: data.trackId,
              userId: session.userId,
            });
          }
        }
      );
      return;
    }

    // Persistent: write to Redis + broadcast
    try {
      await this.handler.getStateService().updateTrack(data.roomId, data.trackId, data.updates);
      socket.to(data.roomId).emit(ARRANGE_EVENTS.TRACK_UPDATED, {
        trackId: data.trackId,
        updates: data.updates,
        userId: session.userId,
      });
      loggingService.logInfo('Track updated', { roomId: data.roomId, trackId: data.trackId, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeTrackHandler:handleTrackUpdate', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to update track'));
    }
  }

  /**
   * Handle track property commit (COMMIT — save volume/pan to Redis)
   * TR-10: Clears auto-commit timeout since user explicitly sent commit
   */
  async handleTrackPropertyCommit(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; updates: TrackUpdate }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const validation = await this.validateTrackMutation(data.roomId, data.trackId, session.userId, data.updates);
    if (!validation.valid) {
      socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
      return;
    }

    try {
      // TR-10: Clear pending auto-commit since user explicitly committed
      this.handler.clearEphemeralCommitPublic(data.roomId, session.userId, `trackProperties:${data.trackId}`);

      await this.handler.getStateService().updateTrack(data.roomId, data.trackId, data.updates);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.TRACK_PROPERTY_COMMITTED, {
        trackId: data.trackId,
        updates: data.updates,
        userId: session.userId,
      });
      loggingService.logInfo('Track property committed', { roomId: data.roomId, trackId: data.trackId, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeTrackHandler:handleTrackPropertyCommit', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to commit track property'));
    }
  }

  /**
   * Handle track delete
   */
  async handleTrackDelete(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const validation = await this.validateTrackMutation(data.roomId, data.trackId, session.userId);
    if (!validation.valid) {
      socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
      return;
    }

    try {
      const state = await this.handler.getStateService().getState(data.roomId);
      const audioRegions =
        state?.regions.filter(
          (region): region is AudioRegion =>
            region.trackId === data.trackId && region.type === 'audio'
        ) ?? [];

      await this.handler.getStateService().removeTrack(data.roomId, data.trackId);
      socket.to(data.roomId).emit(ARRANGE_EVENTS.TRACK_DELETED, { trackId: data.trackId, userId: session.userId });
      loggingService.logInfo('Track deleted', { roomId: data.roomId, trackId: data.trackId, userId: session.userId });

      const storage = this.handler.getAudioRegionStorageService();
      if (audioRegions.length > 0 && storage !== undefined && state !== null) {
        const removedIds = new Set(audioRegions.map((region) => region.id));
        const handledStorageIds = new Set<string>();
        const deletionPromises = audioRegions.map(async (region) => {
          const audioUrl = region.audioUrl;
          const hasOtherReferences =
            audioUrl !== undefined &&
            audioUrl !== '' &&
            state.regions.some(
              (candidate) =>
                !removedIds.has(candidate.id) &&
                candidate.type === 'audio' &&
                (candidate as AudioRegion).audioUrl === audioUrl
            );

          if (hasOtherReferences) {
            return;
          }

          const storageRegionId =
            (audioUrl !== undefined && audioUrl !== '' && storage.extractRegionIdFromPlaybackPath(audioUrl)) || region.id;

          if (handledStorageIds.has(storageRegionId)) {
            return;
          }

          handledStorageIds.add(storageRegionId);

          await storage
            .deleteRegionAudio(data.roomId, storageRegionId)
            .catch((error) =>
              loggingService.logError(error as Error, {
                context: 'ArrangeTrackHandler:deleteTrackAudio',
                roomId: data.roomId,
                regionId: storageRegionId,
              })
            );
        });

        void Promise.all(deletionPromises);
      }
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeTrackHandler:handleTrackDelete', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to delete track'));
    }
  }

  /**
   * Handle track reorder
   */
  async handleTrackReorder(socket: Socket, namespace: Namespace, data: { roomId: string; trackIds: string[] }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      await this.handler.getStateService().reorderTracks(data.roomId, data.trackIds);
      socket.to(data.roomId).emit(ARRANGE_EVENTS.TRACK_REORDERED, {
        trackIds: data.trackIds,
        userId: session.userId,
      });
      loggingService.logInfo('Tracks reordered', {
        roomId: data.roomId,
        trackCount: data.trackIds.length,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeTrackHandler:handleTrackReorder',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to reorder tracks'));
    }
  }

  /**
   * Handle track instrument change
   */
  async handleTrackInstrumentChange(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; instrumentId: string; instrumentCategory?: string | undefined }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const validation = await this.validateTrackMutation(data.roomId, data.trackId, session.userId);
    if (!validation.valid) {
      socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
      return;
    }

    try {
      const updates: Partial<Track> = {
        instrumentId: data.instrumentId,
      };
      if (data.instrumentCategory !== undefined) {
        updates.instrumentCategory = data.instrumentCategory;
      }
      await this.handler.getStateService().updateTrack(data.roomId, data.trackId, updates);
      socket.to(data.roomId).emit(ARRANGE_EVENTS.TRACK_INSTRUMENT_CHANGED, {
        trackId: data.trackId,
        instrumentId: data.instrumentId,
        instrumentCategory: data.instrumentCategory,
        userId: session.userId,
      });
      loggingService.logInfo('Track instrument changed', {
        roomId: data.roomId,
        trackId: data.trackId,
        instrumentId: data.instrumentId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeTrackHandler:handleTrackInstrumentChange',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to change track instrument'));
    }
  }

  /**
   * Handle synth params update (EPHEMERAL — broadcast only, no Redis write)
   * TR-10: Schedules auto-commit if user disconnects before sending commit event
   */
  async handleSynthParamsUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; params: Record<string, unknown> }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const validation = await this.validateTrackMutation(data.roomId, data.trackId, session.userId);
    if (!validation.valid) {
      socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
      return;
    }

    // Ephemeral: broadcast to others only, no Redis write
    socket.to(data.roomId).emit(ARRANGE_EVENTS.SYNTH_PARAMS_UPDATED, {
      trackId: data.trackId,
      params: data.params,
      userId: session.userId,
    });

    // TR-10: Schedule auto-commit in case user disconnects
    this.handler.scheduleEphemeralCommitPublic(
      data.roomId,
      session.userId,
      `synthParams:${data.trackId}`,
      data.params,
      async () => {
        try {
          await this.handler.getStateService().updateSynthParams(data.roomId, data.trackId, data.params);
          namespace.to(data.roomId).emit(ARRANGE_EVENTS.SYNTH_PARAMS_COMMITTED, {
            trackId: data.trackId,
            params: data.params,
            userId: session.userId,
          });
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'ArrangeTrackHandler.handleSynthParamsUpdate.autoCommit',
            roomId: data.roomId,
            trackId: data.trackId,
            userId: session.userId,
          });
        }
      }
    );
  }

  /**
   * Handle synth params commit (COMMIT — save to Redis + broadcast committed)
   * TR-10: Clears auto-commit timeout since user explicitly sent commit
   */
  async handleSynthParamsCommit(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; params: Record<string, unknown> }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const validation = await this.validateTrackMutation(data.roomId, data.trackId, session.userId);
    if (!validation.valid) {
      socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
      return;
    }

    try {
      // TR-10: Clear pending auto-commit since user explicitly committed
      this.handler.clearEphemeralCommitPublic(data.roomId, session.userId, `synthParams:${data.trackId}`);

      await this.handler.getStateService().updateSynthParams(data.roomId, data.trackId, data.params);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.SYNTH_PARAMS_COMMITTED, {
        trackId: data.trackId,
        params: data.params,
        userId: session.userId,
      });
      loggingService.logInfo('Synth params committed', {
        roomId: data.roomId,
        trackId: data.trackId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeTrackHandler:handleSynthParamsCommit',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to commit synth parameters'));
    }
  }

  /**
   * Handle instrument params update (EPHEMERAL — broadcast only, no Redis write)
   * DEV-301: non-synth counterpart to `handleSynthParamsUpdate` (pre-gain volume etc. for
   * drum kits, samplers, and other non-synth instruments).
   * TR-10: Schedules auto-commit if user disconnects before sending commit event
   */
  async handleInstrumentParamsUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; params: Record<string, unknown> }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const validation = await this.validateTrackMutation(data.roomId, data.trackId, session.userId);
    if (!validation.valid) {
      socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
      return;
    }

    // Ephemeral: broadcast to others only, no Redis write
    socket.to(data.roomId).emit(ARRANGE_EVENTS.INSTRUMENT_PARAMS_UPDATED, {
      trackId: data.trackId,
      params: data.params,
      userId: session.userId,
    });

    // TR-10: Schedule auto-commit in case user disconnects
    this.handler.scheduleEphemeralCommitPublic(
      data.roomId,
      session.userId,
      `instrumentParams:${data.trackId}`,
      data.params,
      async () => {
        try {
          await this.handler.getStateService().updateInstrumentParams(data.roomId, data.trackId, data.params);
          namespace.to(data.roomId).emit(ARRANGE_EVENTS.INSTRUMENT_PARAMS_COMMITTED, {
            trackId: data.trackId,
            params: data.params,
            userId: session.userId,
          });
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'ArrangeTrackHandler.handleInstrumentParamsUpdate.autoCommit',
            roomId: data.roomId,
            trackId: data.trackId,
            userId: session.userId,
          });
        }
      }
    );
  }

  /**
   * Handle instrument params commit (COMMIT — save to Redis + broadcast committed)
   * DEV-301: non-synth counterpart to `handleSynthParamsCommit`.
   * TR-10: Clears auto-commit timeout since user explicitly sent commit
   */
  async handleInstrumentParamsCommit(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; params: Record<string, unknown> }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const validation = await this.validateTrackMutation(data.roomId, data.trackId, session.userId);
    if (!validation.valid) {
      socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
      return;
    }

    try {
      // TR-10: Clear pending auto-commit since user explicitly committed
      this.handler.clearEphemeralCommitPublic(data.roomId, session.userId, `instrumentParams:${data.trackId}`);

      await this.handler.getStateService().updateInstrumentParams(data.roomId, data.trackId, data.params);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.INSTRUMENT_PARAMS_COMMITTED, {
        trackId: data.trackId,
        params: data.params,
        userId: session.userId,
      });
      loggingService.logInfo('Instrument params committed', {
        roomId: data.roomId,
        trackId: data.trackId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeTrackHandler:handleInstrumentParamsCommit',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to commit instrument parameters'));
    }
  }

  /**
   * Handle BPM change
   */
  async handleBpmChange(socket: Socket, namespace: Namespace, data: { roomId: string; bpm: number }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      await this.handler.getStateService().setBpm(data.roomId, data.bpm);
      socket.to(data.roomId).emit(ARRANGE_EVENTS.BPM_CHANGED, {
        bpm: data.bpm,
        userId: session.userId,
      });
      loggingService.logInfo('BPM changed', {
        roomId: data.roomId,
        bpm: data.bpm,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeTrackHandler:handleBpmChange',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to change BPM'));
    }
  }

  /**
   * Handle time signature change
   */
  /**
   * Handle master channel fader move (UPDATE — ephemeral broadcast, no Redis write).
   *
   * Lives beside BPM and time signature rather than beside the per-track controls, because
   * that is what it is: one project-wide setting, not a track-scoped one. So it takes no
   * collaborative lock — the same last-write-wins model BPM has always used (TR-4 locks are
   * per-track edit locks, and there is no master track to lock).
   *
   * It does take the ephemeral/commit treatment BPM does not (TR-1), because it is driven by a
   * knob drag: broadcasting every frame into Redis would hammer the room mutex.
   */
  async handleMasterVolumeUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; masterVolume: number }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    socket.to(data.roomId).emit(ARRANGE_EVENTS.MASTER_VOLUME_UPDATED, {
      masterVolume: data.masterVolume,
      userId: session.userId,
    });

    // TR-10: a drag that ends in a disconnect still has to land, or the room keeps a level
    // nobody can see in the project.
    this.handler.scheduleEphemeralCommitPublic(
      data.roomId,
      session.userId,
      'masterVolume',
      data.masterVolume,
      async () => {
        try {
          await this.handler.getStateService().updateState(data.roomId, { masterVolume: data.masterVolume });
          namespace.to(data.roomId).emit(ARRANGE_EVENTS.MASTER_VOLUME_COMMITTED, {
            masterVolume: data.masterVolume,
            userId: session.userId,
          });
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'ArrangeTrackHandler.handleMasterVolumeUpdate.autoCommit',
            roomId: data.roomId,
            userId: session.userId,
          });
        }
      }
    );
  }

  /** Handle master channel fader release (COMMIT — write to Redis + broadcast to everyone). */
  async handleMasterVolumeCommit(socket: Socket, namespace: Namespace, data: { roomId: string; masterVolume: number }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      this.handler.clearEphemeralCommitPublic(data.roomId, session.userId, 'masterVolume');
      await this.handler.getStateService().updateState(data.roomId, { masterVolume: data.masterVolume });
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.MASTER_VOLUME_COMMITTED, {
        masterVolume: data.masterVolume,
        userId: session.userId,
      });
      loggingService.logInfo('Master volume committed', {
        roomId: data.roomId,
        masterVolume: data.masterVolume,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeTrackHandler:handleMasterVolumeCommit',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to change master volume'));
    }
  }

  async handleTimeSignatureChange(socket: Socket, namespace: Namespace, data: { roomId: string; timeSignature: ArrangeTimeSignature }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      await this.handler.getStateService().setTimeSignature(data.roomId, data.timeSignature);
      socket.to(data.roomId).emit(ARRANGE_EVENTS.TIME_SIGNATURE_CHANGED, {
        timeSignature: data.timeSignature,
        userId: session.userId,
      });
      loggingService.logInfo('Time signature changed', {
        roomId: data.roomId,
        timeSignature: data.timeSignature,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeTrackHandler:handleTimeSignatureChange',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to change time signature'));
    }
  }

  private async validateTrackMutation(
    roomId: string,
    trackId: string,
    userId: string,
    updates?: TrackUpdate
  ): Promise<{ valid: boolean; error?: string }> {
    const state = await this.handler.getStateService().getState(roomId);
    if (!state) {
      return { valid: false, error: 'Project state not found' };
    }
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
      return { valid: false, error: 'Track not found' };
    }

    const isProjectOwner = userId === state.projectOwnerId;

    if (updates && updates.isLocked !== undefined) {
      if (!isProjectOwner) {
        return { valid: false, error: 'Only the project owner can lock/unlock tracks' };
      }
    }

    if (track.isLocked && !isProjectOwner) {
      return { valid: false, error: 'Track is locked' };
    }

    return { valid: true };
  }
}
