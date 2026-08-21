import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload } from '@jam-band/shared';
import { ARRANGE_EVENTS } from '@jam-band/shared';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { Region, RegionUpdate, AudioRegion, EffectChainState } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import type { SocketAuthUser } from '@/config/socket';
import { checkRegionEditAccess, ownerConflictFromOccupancy, validateTrackLock } from './arrangeRegionGuards';

/**
 * Region + effect-chain sub-handler. The MIDI-note handlers that used to live here moved to
 * `ArrangeNoteHandler` in DEV-350 Round 2, Task 2 (TR-20 800-line cap); the permission guards
 * both files share now live in `arrangeRegionGuards`.
 */
export class ArrangeRegionHandler {
  constructor(private readonly handler: ArrangeRoomHandler) {}

  /**
   * Handle region add
   */
  async handleRegionAdd(socket: Socket, namespace: Namespace, data: { roomId: string; region: Region }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      const state = await this.handler.getStateService().getState(data.roomId);
      if (!state) {
        socket.emit('error', createSocketErrorPayload('Project state not found'));
        return;
      }
      const validation = validateTrackLock(state, data.region.trackId, session.userId);
      if (!validation.valid) {
        socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
        return;
      }

      const user = (socket.data as { user?: SocketAuthUser | null }).user;
      const isRegistered = user != null && typeof user.userType === 'string' && user.userType.length > 0;
      data.region.ownerId = isRegistered ? session.userId : null;

      await this.handler.getStateService().addRegion(data.roomId, data.region);
      socket.to(data.roomId).emit(ARRANGE_EVENTS.REGION_ADDED, { region: data.region, userId: session.userId });
      loggingService.logInfo('Region added', { roomId: data.roomId, regionId: data.region.id, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRegionHandler:handleRegionAdd', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to add region'));
    }
  }

  /**
   * Handle region update
   */
  async handleRegionUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; updates: RegionUpdate }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Track-lock + occupancy guard from ONE room-state read (DEV-350 review follow-up,
    // finding 5). `validateTrackLockForRegion` and `getOwnerConflict` each did a full Redis
    // GET + deserialize of every track/region/note, and the occupancy map lives on the very
    // state the first call already fetched.
    //
    // Occupancy rationale (DEV-350 M2, Task 14 Part 2) — holders[0] is the owner with edit
    // rights; replaces the retired `state.locks`/`isLocked` check (dead since Task 12).
    const access = await checkRegionEditAccess(this.handler, data.roomId, data.regionId, session.userId);
    if (!access.valid) {
      socket.emit('error', createSocketErrorPayload(access.error || 'Permission denied'));
      return;
    }
    if (access.conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: access.conflict.username });
      return;
    }

    try {
      await this.handler.getStateService().updateRegion(data.roomId, data.regionId, data.updates);

      socket.to(data.roomId).emit(ARRANGE_EVENTS.REGION_UPDATED, {
        regionId: data.regionId,
        updates: data.updates,
        userId: session.userId,
      });
      loggingService.logInfo('Region updated', { roomId: data.roomId, regionId: data.regionId, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRegionHandler:handleRegionUpdate', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to update region'));
    }
  }

  /**
   * Handle region move
   */
  async handleRegionMove(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string; deltaBeats: number }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      const state = await this.handler.getStateService().getState(data.roomId);
      if (!state) {
        return;
      }

      // Occupancy-queue check (DEV-350 M2, Task 14 Part 2) — replaces the retired
      // `state.locks` read (dead since Task 12). Derived from the `state` already read above
      // rather than a second whole-room GET (review follow-up, finding 6).
      const conflict = ownerConflictFromOccupancy(state.occupancy.get(data.regionId), session.userId);
      if (conflict) {
        socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: conflict.username });
        return;
      }

      const region = state.regions.find((r) => r.id === data.regionId);
      if (!region) {
        return;
      }

      const validation = validateTrackLock(state, region.trackId, session.userId);
      if (!validation.valid) {
        socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
        return;
      }

      const newStart = Math.max(0, region.start + data.deltaBeats);
      await this.handler.getStateService().updateRegion(data.roomId, data.regionId, { start: newStart });
      socket.to(data.roomId).emit(ARRANGE_EVENTS.REGION_MOVED, {
        regionId: data.regionId,
        newStart,
        userId: session.userId,
      });
      loggingService.logInfo('Region moved', { roomId: data.roomId, regionId: data.regionId, userId: session.userId });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRegionHandler:handleRegionMove', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to move region'));
    }
  }

  /**
   * Handle batched region drag updates (EPHEMERAL — broadcast only, no Redis write)
   * TR-10: Schedules auto-commit if user disconnects before sending drag end event
   */
  async handleRegionDrag(socket: Socket, namespace: Namespace, data: { roomId: string; updates: Array<{ regionId: string; newStart: number; trackId?: string | undefined }> }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    if (data.updates.length === 0) {
      return;
    }

    const state = await this.handler.getStateService().getState(data.roomId);
    if (!state) {
      socket.emit('error', createSocketErrorPayload('Project state not found'));
      return;
    }
    const isProjectOwner = session.userId === state.projectOwnerId;
    if (!isProjectOwner) {
      for (const update of data.updates) {
        const region = state.regions.find((r) => r.id === update.regionId);
        if (region) {
          const currentTrack = state.tracks.find((t) => t.id === region.trackId);
          if (currentTrack?.isLocked) {
            socket.emit('error', createSocketErrorPayload('Track is locked'));
            return;
          }
          if (update.trackId) {
            const targetTrack = state.tracks.find((t) => t.id === update.trackId);
            if (targetTrack?.isLocked) {
              socket.emit('error', createSocketErrorPayload('Track is locked'));
              return;
            }
          }
        }
      }
    }

    // Ephemeral: broadcast to others only, no Redis write
    socket.to(data.roomId).emit(ARRANGE_EVENTS.REGION_DRAGGED, {
      updates: data.updates,
      userId: session.userId,
    });

    // TR-10: Schedule auto-commit in case user disconnects mid-drag
    this.handler.scheduleEphemeralCommitPublic(
      data.roomId,
      session.userId,
      `regionDrag`,
      data.updates,
      async () => {
        try {
          const state = await this.handler.getStateService().getState(data.roomId);
          if (!state) {
            return;
          }

          const committedUpdates: Array<{ regionId: string; newStart: number; trackId?: string }> = [];

          for (const update of data.updates) {
            const region = state.regions.find((r) => r.id === update.regionId);
            if (!region) {
              continue;
            }

            const sanitizedStart = Math.max(0, update.newStart);
            const nextTrackId = update.trackId ?? region.trackId;

            if (update.trackId !== undefined && !state.tracks.some((track) => track.id === update.trackId)) {
              continue;
            }

            const updatesToApply: Partial<Region> = { start: sanitizedStart };
            if (nextTrackId !== '' && nextTrackId !== region.trackId) {
              updatesToApply.trackId = nextTrackId;
            }

            await this.handler.getStateService().updateRegion(data.roomId, region.id, updatesToApply);

            const payload: { regionId: string; newStart: number; trackId?: string } = {
              regionId: region.id,
              newStart: sanitizedStart,
            };
            if (updatesToApply.trackId) {
              payload.trackId = updatesToApply.trackId;
            }
            committedUpdates.push(payload);
          }

          if (committedUpdates.length > 0) {
            namespace.to(data.roomId).emit(ARRANGE_EVENTS.REGION_DRAG_COMMITTED, {
              updates: committedUpdates,
              userId: session.userId,
            });
          }
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'ArrangeRegionHandler.handleRegionDrag.autoCommit',
            roomId: data.roomId,
            userId: session.userId,
          });
        }
      }
    );
  }

  /**
   * Handle region drag end (COMMIT — save to Redis + broadcast committed)
   * TR-10: Clears auto-commit timeout since user explicitly sent drag end
   */
  async handleRegionDragEnd(socket: Socket, namespace: Namespace, data: { roomId: string; updates: Array<{ regionId: string; newStart: number; trackId?: string | undefined }> }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    if (data.updates.length === 0) {
      return;
    }

    const state = await this.handler.getStateService().getState(data.roomId);
    if (!state) {
      socket.emit('error', createSocketErrorPayload('Project state not found'));
      return;
    }
    const isProjectOwner = session.userId === state.projectOwnerId;
    if (!isProjectOwner) {
      for (const update of data.updates) {
        const region = state.regions.find((r) => r.id === update.regionId);
        if (region) {
          const currentTrack = state.tracks.find((t) => t.id === region.trackId);
          if (currentTrack?.isLocked) {
            socket.emit('error', createSocketErrorPayload('Track is locked'));
            return;
          }
          if (update.trackId) {
            const targetTrack = state.tracks.find((t) => t.id === update.trackId);
            if (targetTrack?.isLocked) {
              socket.emit('error', createSocketErrorPayload('Track is locked'));
              return;
            }
          }
        }
      }
    }

    // TR-10: Clear pending auto-commit since user explicitly sent drag end
    this.handler.clearEphemeralCommitPublic(data.roomId, session.userId, `regionDrag`);

    const committedUpdates: Array<{ regionId: string; newStart: number; trackId?: string }> = [];

    try {
      // Batch all region updates under a single lock acquisition
      const batchUpdates: Array<{ regionId: string; updates: Partial<Region> }> = [];

      for (const update of data.updates) {
        const region = state.regions.find((r) => r.id === update.regionId);
        if (!region) {
          continue;
        }

        const sanitizedStart = Math.max(0, update.newStart);
        const nextTrackId = update.trackId ?? region.trackId;

        if (update.trackId !== undefined && !state.tracks.some((track) => track.id === update.trackId)) {
          continue;
        }

        const updatesToApply: Partial<Region> = { start: sanitizedStart };
        if (nextTrackId !== '' && nextTrackId !== region.trackId) {
          updatesToApply.trackId = nextTrackId;
        }

        batchUpdates.push({ regionId: region.id, updates: updatesToApply });

        const payload: { regionId: string; newStart: number; trackId?: string } = {
          regionId: region.id,
          newStart: sanitizedStart,
        };
        if (updatesToApply.trackId) {
          payload.trackId = updatesToApply.trackId;
        }
        committedUpdates.push(payload);
      }

      if (committedUpdates.length === 0) {
        return;
      }

      if (batchUpdates.length > 0) {
        await this.handler.getStateService().batchUpdateRegions(data.roomId, batchUpdates);
      }

      namespace.to(data.roomId).emit(ARRANGE_EVENTS.REGION_DRAG_COMMITTED, {
        updates: committedUpdates,
        userId: session.userId,
      });
      loggingService.logInfo('Regions drag committed', {
        roomId: data.roomId,
        count: committedUpdates.length,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRegionHandler:handleRegionDragEnd', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to commit region drag'));
    }
  }

  /**
   * Handle region delete
   */
  async handleRegionDelete(socket: Socket, namespace: Namespace, data: { roomId: string; regionId: string }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    try {
      const state = await this.handler.getStateService().getState(data.roomId);
      if (!state) return;

      // Occupancy-queue check (DEV-350 M2, Task 14 Part 2) — replaces the retired
      // `state.locks` read (dead since Task 12). Derived from the `state` already read above
      // rather than a second whole-room GET (review follow-up, finding 6).
      const conflict = ownerConflictFromOccupancy(state.occupancy.get(data.regionId), session.userId);
      if (conflict) {
        socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: conflict.username });
        return;
      }

      const region = state.regions.find((r) => r.id === data.regionId);
      if (!region) {
        socket.emit('error', createSocketErrorPayload('Region not found'));
        return;
      }

      const validation = validateTrackLock(state, region.trackId, session.userId);
      if (!validation.valid) {
        socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
        return;
      }

      await this.handler.getStateService().removeRegion(data.roomId, data.regionId);
      socket.to(data.roomId).emit(ARRANGE_EVENTS.REGION_DELETED, { regionId: data.regionId, userId: session.userId });
      loggingService.logInfo('Region deleted', { roomId: data.roomId, regionId: data.regionId, userId: session.userId });

      const storage = this.handler.getAudioRegionStorageService();
      if (region.type === 'audio' && storage !== undefined) {
        const audioRegion = region as AudioRegion;
        const audioUrl = audioRegion.audioUrl;
        const hasOtherReferences =
          audioUrl !== undefined &&
          audioUrl !== '' &&
          state.regions.some(
            (candidate) =>
              candidate.id !== region.id &&
              candidate.type === 'audio' &&
              (candidate as AudioRegion).audioUrl === audioUrl
          );

        if (!hasOtherReferences) {
          const storageRegionId =
            (audioUrl !== undefined && audioUrl !== '' && storage.extractRegionIdFromPlaybackPath(audioUrl)) || region.id;

          storage
            .deleteRegionAudio(data.roomId, storageRegionId)
            .catch((error) =>
              loggingService.logError(error as Error, {
                context: 'ArrangeRegionHandler:handleRegionDeleteAudio',
                roomId: data.roomId,
                regionId: storageRegionId,
              })
            );
        }
      }
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeRegionHandler:handleRegionDelete', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to delete region'));
    }
  }

  /**
   * Handle effect chain update (EPHEMERAL — broadcast only, no Redis write)
   * TR-10: Schedules auto-commit if user disconnects before sending commit event
   */
  async handleEffectChainUpdate(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; chainType: string; effectChain: EffectChainState }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const state = await this.handler.getStateService().getState(data.roomId);
    if (!state) {
      socket.emit('error', createSocketErrorPayload('Project state not found'));
      return;
    }
    const validation = validateTrackLock(state, data.trackId, session.userId);
    if (!validation.valid) {
      socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
      return;
    }

    // Ephemeral: broadcast to others only, no Redis write
    socket.to(data.roomId).emit(ARRANGE_EVENTS.EFFECT_CHAIN_UPDATED, {
      trackId: data.trackId,
      chainType: data.chainType,
      effectChain: data.effectChain,
      userId: session.userId,
    });

    // TR-10: Schedule auto-commit in case user disconnects
    this.handler.scheduleEphemeralCommitPublic(
      data.roomId,
      session.userId,
      `effectChain:${data.trackId}:${data.chainType}`,
      data.effectChain,
      async () => {
        try {
          await this.handler.getStateService().updateEffectChain(data.roomId, data.chainType, data.effectChain);
          namespace.to(data.roomId).emit(ARRANGE_EVENTS.EFFECT_CHAIN_COMMITTED, {
            trackId: data.trackId,
            chainType: data.chainType,
            effectChain: data.effectChain,
            userId: session.userId,
          });
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'ArrangeRegionHandler.handleEffectChainUpdate.autoCommit',
            roomId: data.roomId,
            trackId: data.trackId,
            userId: session.userId,
          });
        }
      }
    );
  }

  /**
   * Handle effect chain commit (COMMIT — save to Redis + broadcast committed)
   * TR-10: Clears auto-commit timeout since user explicitly sent commit
   */
  async handleEffectChainCommit(socket: Socket, namespace: Namespace, data: { roomId: string; trackId: string; chainType: string; effectChain: EffectChainState }): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const state = await this.handler.getStateService().getState(data.roomId);
    if (!state) {
      socket.emit('error', createSocketErrorPayload('Project state not found'));
      return;
    }
    const validation = validateTrackLock(state, data.trackId, session.userId);
    if (!validation.valid) {
      socket.emit('error', createSocketErrorPayload(validation.error || 'Permission denied'));
      return;
    }

    try {
      // TR-10: Clear pending auto-commit since user explicitly committed
      this.handler.clearEphemeralCommitPublic(data.roomId, session.userId, `effectChain:${data.trackId}:${data.chainType}`);

      await this.handler.getStateService().updateEffectChain(data.roomId, data.chainType, data.effectChain);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.EFFECT_CHAIN_COMMITTED, {
        trackId: data.trackId,
        chainType: data.chainType,
        effectChain: data.effectChain,
        userId: session.userId,
      });
      loggingService.logInfo('Effect chain committed', {
        roomId: data.roomId,
        trackId: data.trackId,
        chainType: data.chainType,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'ArrangeRegionHandler:handleEffectChainCommit',
        roomId: data.roomId,
      });
      socket.emit('error', createSocketErrorPayload('Failed to commit effect chain'));
    }
  }
}
