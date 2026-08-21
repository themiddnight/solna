import type { Socket, Namespace } from 'socket.io';
import { createSocketErrorPayload, ARRANGE_EVENTS } from '@jam-band/shared';
import { loggingService } from '@/shared/infrastructure/logging/LoggingService';
import type { ArrangeRoomState, CompanionRegionConfig, MidiNote, CompanionRegionMetadata } from '@/domains/arrange-room/domain/models/ArrangeRoomState';
import type { ArrangeRoomHandler } from '@/domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler';
import { ownerConflictFromOccupancy } from './arrangeRegionGuards';

/**
 * Companion-region config sync socket handlers (DEV-279 P2 Task 2.8) — completes
 * the TODO left by Task 2.4's `CompanionSettingsPanel.update()` ("ephemeral/commit
 * socket sync — DEV-279 Task 2.8").
 *
 * Mirrors `ArrangeRegionHandler`'s ephemeral/commit pattern (TR-1) exactly, and
 * reuses its authorization model for region property edits: a companion
 * region's config is edited like any other region property, so the SAME two
 * checks apply here — `validateTrackLock` (the region's track isn't locked by
 * someone else, project owner bypasses) AND the region's own occupancy-queue
 * ownership check (DEV-350 M2, Task 14 Part 2 — `ownerConflictFromOccupancy`, mirroring
 * `ArrangeChordTrackHandler`'s pattern, rejected via LOCK_CONFLICT if the
 * queue's `holders[0]` is another user). No new authorization scheme is
 * introduced; this replaces the retired `state.locks.get(regionId)` check,
 * which was dead for the same reason plain-region locking went dead in Task
 * 12 (nothing has populated `state.locks` for any regionId since the old
 * LOCK_ACQUIRE event retired in Task 7 — companion regions share the same
 * bare-regionId occupancy keyspace as plain regions).
 *
 * `updates` arrives already validated by `arrangeCompanionConfigUpdateSchema`/
 * `arrangeCompanionConfigCommitSchema` (Zod `.transform` running the shared
 * `validateCompanionRegionConfigUpdates` — TR-31, boundary validation), so by
 * the time it reaches these handlers it is a `Partial<CompanionRegionConfig>`
 * with every invalid/unknown key already dropped. An empty result (every key
 * was invalid, or the payload carried none) is treated as nothing to do.
 *
 * FIELD-MERGE, not flat-clobber: the commit calls
 * `ArrangeRoomStateService.updateCompanionRegionConfig` (→
 * `updateCompanionRegionConfigInState`), which merges the patch into the
 * region's EXISTING config — never routed through the generic `updateRegion`,
 * whose flat `{ ...region, ...updates }` merge would REPLACE the whole config
 * object and drop every field the patch didn't touch (see that mutation's doc
 * comment in ArrangeRoomStateMutations.ts).
 *
 * Also hosts the companion region CONVERT/REVERT handlers (DEV-279 Phase 3
 * Task 3.3a) — `handleCompanionRegionConvert`/`handleCompanionRegionRevert`.
 * These are one-shot COMMIT-style events (namespace.to broadcast incl.
 * sender, Redis write under mutex), NOT ephemeral — no auto-commit
 * scheduling. They reuse the SAME `validateTrackLock` + region-lock
 * authorization checks as the config handlers above. Revert reads the
 * reverted `config` from the region's own AUTHORITATIVE
 * `companionMetadata.config` on server state — never a client-supplied
 * config (TR-33).
 */
export class ArrangeCompanionHandler {
  constructor(private readonly handler: ArrangeRoomHandler) {}

  /**
   * Handle companion config update (EPHEMERAL — broadcast only, no Redis write)
   * TR-10: Schedules auto-commit in case the user disconnects before sending
   * the commit event.
   */
  async handleCompanionConfigUpdate(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; regionId: string; updates: Partial<CompanionRegionConfig> },
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    if (Object.keys(data.updates).length === 0) {
      return;
    }

    const state = await this.handler.getStateService().getState(data.roomId);
    if (!state) {
      return;
    }

    const region = state.regions.find((candidate) => candidate.id === data.regionId);
    if (!region || region.type !== 'companion') {
      return;
    }

    const trackValidation = this.validateTrackLock(state, region.trackId, session.userId);
    if (!trackValidation.valid) {
      socket.emit('error', createSocketErrorPayload(trackValidation.error ?? 'Permission denied'));
      return;
    }

    // Occupancy-queue check (DEV-350 M2, Task 14 Part 2) — replaces the retired
    // `state.locks` read, dead for the same reason regions went dead in Task 12: companion
    // regions share the same bare-regionId occupancy keyspace as plain regions, and nothing
    // has populated `state.locks` for any regionId since the old LOCK_ACQUIRE event retired.
    // Derived from the `state` already in hand — see this class's doc comment (finding 6).
    const conflict = ownerConflictFromOccupancy(state.occupancy.get(data.regionId), session.userId);
    if (conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: conflict.username });
      return;
    }

    // Ephemeral: broadcast to others only, no Redis write
    socket.to(data.roomId).emit(ARRANGE_EVENTS.COMPANION_CONFIG_UPDATED, {
      regionId: data.regionId,
      updates: data.updates,
      userId: session.userId,
    });

    // TR-10: Schedule auto-commit in case the user disconnects mid-edit
    this.handler.scheduleEphemeralCommitPublic(
      data.roomId,
      session.userId,
      `companionConfig:${data.regionId}`,
      data.updates,
      async () => {
        try {
          await this.handler.getStateService().updateCompanionRegionConfig(data.roomId, data.regionId, data.updates);
          namespace.to(data.roomId).emit(ARRANGE_EVENTS.COMPANION_CONFIG_COMMITTED, {
            regionId: data.regionId,
            updates: data.updates,
            userId: session.userId,
          });
        } catch (error) {
          loggingService.logError(error as Error, {
            context: 'ArrangeCompanionHandler.handleCompanionConfigUpdate.autoCommit',
            roomId: data.roomId,
            regionId: data.regionId,
            userId: session.userId,
          });
        }
      },
    );
  }

  /**
   * Handle companion config commit (COMMIT — field-merge into Redis under the
   * per-room mutex + broadcast committed via `namespace.to`, incl. sender).
   * TR-10: Clears the pending auto-commit since the user explicitly committed.
   */
  async handleCompanionConfigCommit(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; regionId: string; updates: Partial<CompanionRegionConfig> },
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    if (Object.keys(data.updates).length === 0) {
      return;
    }

    const state = await this.handler.getStateService().getState(data.roomId);
    if (!state) {
      socket.emit('error', createSocketErrorPayload('Project state not found'));
      return;
    }

    const region = state.regions.find((candidate) => candidate.id === data.regionId);
    if (!region || region.type !== 'companion') {
      socket.emit('error', createSocketErrorPayload('Region not found'));
      return;
    }

    const trackValidation = this.validateTrackLock(state, region.trackId, session.userId);
    if (!trackValidation.valid) {
      socket.emit('error', createSocketErrorPayload(trackValidation.error ?? 'Permission denied'));
      return;
    }

    // Occupancy-queue check (DEV-350 M2, Task 14 Part 2) — replaces the retired
    // `state.locks` read, dead for the same reason regions went dead in Task 12: companion
    // regions share the same bare-regionId occupancy keyspace as plain regions, and nothing
    // has populated `state.locks` for any regionId since the old LOCK_ACQUIRE event retired.
    // Derived from the `state` already in hand — see this class's doc comment (finding 6).
    const conflict = ownerConflictFromOccupancy(state.occupancy.get(data.regionId), session.userId);
    if (conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: conflict.username });
      return;
    }

    // TR-10: Clear the pending auto-commit since the user explicitly committed
    this.handler.clearEphemeralCommitPublic(data.roomId, session.userId, `companionConfig:${data.regionId}`);

    try {
      await this.handler.getStateService().updateCompanionRegionConfig(data.roomId, data.regionId, data.updates);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.COMPANION_CONFIG_COMMITTED, {
        regionId: data.regionId,
        updates: data.updates,
        userId: session.userId,
      });
      loggingService.logInfo('Companion config committed', {
        roomId: data.roomId,
        regionId: data.regionId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeCompanionHandler:handleCompanionConfigCommit', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to commit companion config'));
    }
  }

  /**
   * Handle companion region convert (COMMIT — freeze the region's generated
   * notes into a plain MIDI region carrying `companionMetadata`, under the
   * per-room mutex + broadcast via `namespace.to`, incl. sender). One-shot,
   * NOT ephemeral — no auto-commit scheduling (DEV-279 Phase 3 Task 3.3a).
   * Acting identity is always `session.userId` (TR-33).
   */
  async handleCompanionRegionConvert(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; regionId: string; notes: MidiNote[]; companionMetadata: CompanionRegionMetadata },
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const state = await this.handler.getStateService().getState(data.roomId);
    if (!state) {
      socket.emit('error', createSocketErrorPayload('Project state not found'));
      return;
    }

    const region = state.regions.find((candidate) => candidate.id === data.regionId);
    if (!region || region.type !== 'companion') {
      socket.emit('error', createSocketErrorPayload('Region not found'));
      return;
    }

    const trackValidation = this.validateTrackLock(state, region.trackId, session.userId);
    if (!trackValidation.valid) {
      socket.emit('error', createSocketErrorPayload(trackValidation.error ?? 'Permission denied'));
      return;
    }

    // Occupancy-queue check (DEV-350 M2, Task 14 Part 2) — replaces the retired
    // `state.locks` read, dead for the same reason regions went dead in Task 12: companion
    // regions share the same bare-regionId occupancy keyspace as plain regions, and nothing
    // has populated `state.locks` for any regionId since the old LOCK_ACQUIRE event retired.
    // Derived from the `state` already in hand — see this class's doc comment (finding 6).
    const conflict = ownerConflictFromOccupancy(state.occupancy.get(data.regionId), session.userId);
    if (conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: conflict.username });
      return;
    }

    try {
      await this.handler.getStateService().convertCompanionToMidi(data.roomId, data.regionId, data.notes, data.companionMetadata);
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.COMPANION_REGION_CONVERTED, {
        regionId: data.regionId,
        notes: data.notes,
        companionMetadata: data.companionMetadata,
        userId: session.userId,
      });
      loggingService.logInfo('Companion region converted', {
        roomId: data.roomId,
        regionId: data.regionId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeCompanionHandler:handleCompanionRegionConvert', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to convert companion region'));
    }
  }

  /**
   * Handle MIDI→companion revert (COMMIT — discard the frozen notes and
   * recreate the companion region, under the per-room mutex + broadcast via
   * `namespace.to`, incl. sender). One-shot, NOT ephemeral. Works for ANY MIDI
   * region: one that was converted from a companion restores its saved recipe,
   * a plain MIDI region gets a fresh role-default config. The broadcast `config`
   * is read from the AUTHORITATIVE mutated state the service returns — never a
   * client-supplied config (TR-33). Acting identity is always `session.userId`
   * (DEV-279 Phase 3 Task 3.3a; symmetric-swap follow-up).
   */
  async handleCompanionRegionRevert(
    socket: Socket,
    namespace: Namespace,
    data: { roomId: string; regionId: string },
  ): Promise<void> {
    const session = await this.handler.getSessionPublic(socket);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    const state = await this.handler.getStateService().getState(data.roomId);
    if (!state) {
      socket.emit('error', createSocketErrorPayload('Project state not found'));
      return;
    }

    const region = state.regions.find((candidate) => candidate.id === data.regionId);
    if (!region || region.type !== 'midi') {
      socket.emit('error', createSocketErrorPayload('Region not found'));
      return;
    }

    const trackValidation = this.validateTrackLock(state, region.trackId, session.userId);
    if (!trackValidation.valid) {
      socket.emit('error', createSocketErrorPayload(trackValidation.error ?? 'Permission denied'));
      return;
    }

    // Occupancy-queue check (DEV-350 M2, Task 14 Part 2) — replaces the retired
    // `state.locks` read, dead for the same reason regions went dead in Task 12: companion
    // regions share the same bare-regionId occupancy keyspace as plain regions, and nothing
    // has populated `state.locks` for any regionId since the old LOCK_ACQUIRE event retired.
    // Derived from the `state` already in hand — see this class's doc comment (finding 6).
    const conflict = ownerConflictFromOccupancy(state.occupancy.get(data.regionId), session.userId);
    if (conflict) {
      socket.emit(ARRANGE_EVENTS.LOCK_CONFLICT, { elementId: data.regionId, lockedBy: conflict.username });
      return;
    }

    try {
      // TR-33: broadcast the config the mutation actually applied (from the
      // authoritative returned state), never a client payload. Covers both the
      // saved-recipe (converted) and role-default (plain MIDI) cases uniformly.
      const nextState = await this.handler.getStateService().revertMidiToCompanion(data.roomId, data.regionId);
      const revertedRegion = nextState.regions.find((candidate) => candidate.id === data.regionId);
      if (revertedRegion?.type !== 'companion') {
        // The mutation no-op'd (region concurrently changed between read and the
        // locked mutation) — nothing was reverted, so don't broadcast a
        // config-less REVERTED that consumers can't apply.
        socket.emit('error', createSocketErrorPayload('Failed to revert companion region'));
        return;
      }
      namespace.to(data.roomId).emit(ARRANGE_EVENTS.COMPANION_REGION_REVERTED, {
        regionId: data.regionId,
        config: revertedRegion.config,
        userId: session.userId,
      });
      loggingService.logInfo('Companion region reverted', {
        roomId: data.roomId,
        regionId: data.regionId,
        userId: session.userId,
      });
    } catch (error) {
      loggingService.logError(error as Error, { context: 'ArrangeCompanionHandler:handleCompanionRegionRevert', roomId: data.roomId });
      socket.emit('error', createSocketErrorPayload('Failed to revert companion region'));
    }
  }

  /** Mirrors `ArrangeRegionHandler.validateTrackLock` — no new authorization scheme. */
  private validateTrackLock(
    state: ArrangeRoomState,
    trackId: string,
    userId: string,
  ): { valid: boolean; error?: string } {
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
      return { valid: false, error: 'Track not found' };
    }
    const isProjectOwner = userId === state.projectOwnerId;
    if (track.isLocked === true && !isProjectOwner) {
      return { valid: false, error: 'Track is locked' };
    }
    return { valid: true };
  }

}
