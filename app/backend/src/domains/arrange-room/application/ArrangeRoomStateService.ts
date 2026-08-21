import { v4 as uuidv4 } from 'uuid';
import type { ChordBlock } from '@jam-band/shared';
import { DEFAULT_MASTER_VOLUME_DB } from '@jam-band/shared';
import type { ElementOccupancy } from '@jam-band/shared';
import type { ArrangeRoomState, Track, Region, MidiNote, TimeMarker, TrackUpdate, RegionUpdate, MidiNoteUpdate, TimeMarkerUpdate, ChordBlockUpdate, CompanionRegionConfig, CompanionRegionMetadata } from '../domain/models/ArrangeRoomState';
import { UNITY_DB } from '../domain/models/ArrangeRoomState';
import type { EffectChainState } from '../domain/models/ArrangeRoomState';
import { BaseRoomStateService } from '../../../shared/domain/room-state/BaseRoomStateService';
import { DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS } from '@jam-band/shared';
import { REDIS_KEYS } from '../../../shared/constants/RedisKeys';
import { redisStateService } from '../../../shared/infrastructure/caching/RedisStateService';
import {
  addChordBlockToState,
  addMarkerToState,
  addRegionToState,
  addTrackToState,
  convertCompanionRegionToMidiInState,
  removeChordBlockFromState,
  removeMarkerFromState,
  removeRegionFromState,
  removeTrackFromState,
  reorderTracksInState,
  revertMidiRegionToCompanionInState,
  updateChordBlockInState,
  updateCompanionRegionConfigInState,
  updateMarkerInState,
  updateMidiRegionNotes,
  updateRegionInState,
  updateTrackInState,
} from './ArrangeRoomStateMutations';
import { buildTemplateInitialState, isGenreTemplateId } from './buildTemplateInitialState';

export class ArrangeRoomStateService extends BaseRoomStateService<ArrangeRoomState> {
  protected readonly STATE_TTL = 24 * 60 * 60; // 24 hours

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Initialize state for a new room
   */
  async initializeState(roomId: string, templateId?: string): Promise<ArrangeRoomState> {
    let initialTracks: Track[] = [];
    let initialRegions: Region[] = [];
    let initialBpm = 120;
    let initialScale: { rootNote: string; scale: 'major' | 'minor' } | undefined;

    // DEV-44: Template logic. A genre templateId seeds the full template atomically here
    // (single source of truth) so it can't be clobbered by a later client-applied seed.
    if (templateId && isGenreTemplateId(templateId)) {
      const seed = buildTemplateInitialState(templateId);
      initialTracks = seed.tracks;
      initialRegions = seed.regions;
      initialBpm = seed.bpm;
      initialScale = seed.scale;
    } else if (templateId === 'empty') {
      initialTracks = [];
    } else if (!templateId || templateId === 'default') {
      initialTracks = [
        {
          id: uuidv4(),
          name: 'MIDI 1',
          type: 'midi',
          instrumentId: 'acoustic_grand_piano',
          instrumentCategory: 'melodic',
          volume: UNITY_DB, // DEV-303: generic default track volume, was linear 0.8
          pan: 0,
          color: '#3b82f6',
          regionIds: [],
        },
        {
          id: uuidv4(),
          name: 'Audio 2',
          type: 'audio',
          volume: UNITY_DB, // DEV-303: generic default track volume, was linear 0.8
          pan: 0,
          color: '#10b981',
          regionIds: [],
        },
      ];
    } else {
      // Unknown template id — start blank.
      initialTracks = [];
    }

    const state: ArrangeRoomState = {
      roomId,
      roomType: 'arrange',
      tracks: initialTracks,
      regions: initialRegions,
      occupancy: new Map(),
      selectedTrackId: null,
      selectedRegionIds: [],
      synthStates: {},
      effectChains: {},
      bpm: initialBpm,
      timeSignature: { numerator: 4, denominator: 4 },
      masterVolume: DEFAULT_MASTER_VOLUME_DB,
      markers: [],
      // DEV-279 P1: single source of truth for chordTrack init. projectId is not yet known
      // at room-init time (state.projectId itself is unset until a project is loaded/saved
      // — see ArrangeRoomState.projectId), so it starts blank and is not backfilled here.
      chordTrack: { id: uuidv4(), projectId: '', blocks: [] },
      voiceStates: {},
      broadcastStates: {},
      hasBeenSaved: false,
      lastUpdated: new Date(),
      ...(initialScale ? { scale: initialScale } : {}),
    };

    await this.saveState(roomId, state);

    return state;
  }

  async updateState(roomId: string, updates: Partial<Omit<ArrangeRoomState, 'roomId'>>): Promise<ArrangeRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const currentState = await this.getState(roomId);
      if (!currentState) {
        throw new Error(`Room state not found for room: ${roomId}`);
      }

      const updatedState: ArrangeRoomState = {
        ...currentState,
        ...updates,
        voiceStates: updates.voiceStates ?? currentState.voiceStates,
        broadcastStates: updates.broadcastStates ?? currentState.broadcastStates,
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, updatedState);

      return updatedState;
    });
  }

  /**
   * Update scale for arrange room
   */
  async updateScale(roomId: string, rootNote: string, scale: 'major' | 'minor'): Promise<ArrangeRoomState> {
    return await this.updateState(roomId, {
      scale: { rootNote, scale },
    });
  }

  /**
   * Clear scale for arrange room
   */
  async clearScale(roomId: string): Promise<ArrangeRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Room state not found for room: ${roomId}`);
      }

      const { scale: _scale, ...rest } = state;
      const updatedState: ArrangeRoomState = {
        ...rest,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  /**
   * Add a track
   */
  async addTrack(roomId: string, track: Track): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, addTrackToState(state, track, roomId))
    );
  }

  /**
   * Update a track
   */
  async updateTrack(roomId: string, trackId: string, updates: TrackUpdate): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, updateTrackInState(state, trackId, updates))
    );
  }

  /**
   * Remove a track
   */
  async removeTrack(roomId: string, trackId: string): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, removeTrackFromState(state, trackId))
    );
  }

  /**
   * Reorder tracks
   */
  async reorderTracks(roomId: string, trackIds: string[]): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, reorderTracksInState(state, trackIds))
    );
  }

  /**
   * Add a region
   */
  async addRegion(roomId: string, region: Region): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, addRegionToState(state, region))
    );
  }

  /**
   * Update a region
   */
  async updateRegion(roomId: string, regionId: string, updates: RegionUpdate): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, updateRegionInState(state, regionId, updates, roomId))
    );
  }

  /**
   * Field-merge a companion config PATCH into a companion region's existing
   * config, under the same per-room mutex as every other RMW method here
   * (TR-2). See `updateCompanionRegionConfigInState`'s doc comment for why
   * this is a dedicated method rather than routing through `updateRegion`
   * (DEV-279 P2 Task 2.8).
   */
  async updateCompanionRegionConfig(roomId: string, regionId: string, configPatch: Partial<CompanionRegionConfig>): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, updateCompanionRegionConfigInState(state, regionId, configPatch))
    );
  }

  /**
   * Convert a companion region to a plain MIDI region under the per-room mutex
   * (TR-2) — freezes the pre-rendered `notes` + `companionMetadata` onto the
   * region in place. See `convertCompanionRegionToMidiInState`'s doc comment
   * for the no-op conditions (DEV-279 Phase 3 Task 3.3a).
   */
  async convertCompanionToMidi(roomId: string, regionId: string, notes: MidiNote[], metadata: CompanionRegionMetadata): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, convertCompanionRegionToMidiInState(state, regionId, notes, metadata))
    );
  }

  /**
   * Revert a MIDI region to a companion region under the per-room mutex (TR-2)
   * — drops notes and rebuilds `config` from the region's own
   * `companionMetadata.config` (a converted region) or a fresh role-default
   * (a plain MIDI region). Returns the mutated state so the caller can read the
   * applied config from the authoritative result. See
   * `revertMidiRegionToCompanionInState`'s doc comment for the config-resolution
   * and no-op conditions (DEV-279 Phase 3 Task 3.3a; symmetric-swap follow-up).
   */
  async revertMidiToCompanion(roomId: string, regionId: string): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, revertMidiRegionToCompanionInState(state, regionId))
    );
  }

  /**
   * Batch-update multiple regions under a single lock acquisition.
   */
  async batchUpdateRegions(roomId: string, updates: Array<{ regionId: string; updates: RegionUpdate }>): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) => {
      let mutated = state;
      for (const { regionId, updates: regionUpdates } of updates) {
        mutated = updateRegionInState(mutated, regionId, regionUpdates, roomId);
      }
      return this.saveMutatedState(roomId, mutated);
    });
  }

  /**
   * Update synth params — uses distributed lock to prevent TOCTOU race
   * when two users edit different synth params on the same track simultaneously.
   * Synth params are committed to Redis state and should be atomic per-room.
   */
  async updateSynthParams(roomId: string, trackId: string, params: Record<string, unknown>): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) => {
      const currentSynth = state.synthStates[trackId] ?? {};
      state.synthStates[trackId] = { ...currentSynth, ...params };
      state.lastUpdated = new Date();
      return this.saveMutatedState(roomId, state);
    });
  }

  /**
   * Update non-synth instrument params (e.g. pre-gain volume) — uses distributed lock to
   * prevent TOCTOU race when two users edit different instrument params on the same track
   * simultaneously. DEV-301: mirrors `updateSynthParams` exactly, keyed on a sibling
   * `instrumentParamsStates` map so non-synth instruments (drum kits, samplers, etc.) get the
   * same atomic-per-room persistence as synths.
   */
  async updateInstrumentParams(roomId: string, trackId: string, params: Record<string, unknown>): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) => {
      const currentInstrumentParams = state.instrumentParamsStates?.[trackId] ?? {};
      state.instrumentParamsStates = {
        ...state.instrumentParamsStates,
        [trackId]: { ...currentInstrumentParams, ...params },
      };
      state.lastUpdated = new Date();
      return this.saveMutatedState(roomId, state);
    });
  }

  /**
   * Remove a region
   */
  async removeRegion(roomId: string, regionId: string): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, removeRegionFromState(state, regionId))
    );
  }

  /**
   * Update selection state
   */
  async updateSelection(roomId: string, selectedTrackId: string | null, selectedRegionIds: string[]): Promise<ArrangeRoomState> {
    return await this.updateState(roomId, {
      selectedTrackId,
      selectedRegionIds,
    });
  }

  async setVoiceState(roomId: string, userId: string, isMuted: boolean): Promise<void> {
    await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Room state not found for room: ${roomId}`);
      }

      const updatedState: ArrangeRoomState = {
        ...state,
        voiceStates: {
          ...state.voiceStates,
          [userId]: { isMuted },
        },
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
    });
  }

  async removeVoiceState(roomId: string, userId: string): Promise<boolean> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state || !state.voiceStates[userId]) {
        return false;
      }

      const { [userId]: _removed, ...rest } = state.voiceStates;
      const updatedState: ArrangeRoomState = {
        ...state,
        voiceStates: rest,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return true;
    });
  }

  async setMonitorShareState(
    roomId: string,
    userId: string,
    stateData: { username: string; trackId: string | null },
  ): Promise<void> {
    await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Room state not found for room: ${roomId}`);
      }

      const broadcastStates = { ...state.broadcastStates };
      if (stateData.trackId) {
        broadcastStates[userId] = stateData;
      } else {
        delete broadcastStates[userId];
      }

      const updatedState: ArrangeRoomState = {
        ...state,
        broadcastStates,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
    });
  }

  async removeMonitorShareState(roomId: string, userId: string): Promise<{ username: string; trackId: string | null } | null> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      const existingState = state?.broadcastStates[userId];
      if (!state || !existingState) {
        return null;
      }

      const { [userId]: _removed, ...rest } = state.broadcastStates;
      const updatedState: ArrangeRoomState = {
        ...state,
        broadcastStates: rest,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return existingState;
    });
  }

  /**
   * Add a marker
   */
  async addMarker(roomId: string, marker: { id: string; position: number; description?: string | undefined; color?: string | undefined }): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, addMarkerToState(state, marker))
    );
  }

  /**
   * Update a marker
   */
  async updateMarker(roomId: string, markerId: string, updates: TimeMarkerUpdate): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, updateMarkerInState(state, markerId, updates))
    );
  }

  /**
   * Remove a marker
   */
  async removeMarker(roomId: string, markerId: string): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, removeMarkerFromState(state, markerId))
    );
  }

  /**
   * Add a chord block (DEV-279 P1)
   */
  async addChordBlock(roomId: string, block: ChordBlock): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, addChordBlockToState(state, block))
    );
  }

  /**
   * Update a chord block (DEV-279 P1)
   */
  async updateChordBlock(roomId: string, blockId: string, updates: ChordBlockUpdate): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, updateChordBlockInState(state, blockId, updates))
    );
  }

  /**
   * Remove a chord block (DEV-279 P1)
   */
  async removeChordBlock(roomId: string, blockId: string): Promise<ArrangeRoomState> {
    return await this.withStateLock(roomId, async (state) =>
      this.saveMutatedState(roomId, removeChordBlockFromState(state, blockId))
    );
  }

  /**
   * Atomically check lock + add a note to a MIDI region.
   * Returns 'lock_conflict' if region is locked by another user, 'not_found' if region/room missing.
   */
  async addNoteAtomic(
    roomId: string,
    regionId: string,
    note: MidiNote,
    requestingUserId: string,
  ): Promise<{ result: 'ok'; state: ArrangeRoomState } | { result: 'lock_conflict'; lockedBy: string } | { result: 'not_found' }> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) return { result: 'not_found' };

      // Region occupancy queue (DEV-350 Round 2 Task 1) — holders[0] is the owner with edit
      // rights. Replaces the retired `state.locks`/`getActiveLockConflict` read: this is the
      // in-mutex guard, kept alongside ArrangeRegionHandler.getOwnerConflict's mutex-free
      // pre-check (TR-2) rather than deleted outright.
      const owner = state.occupancy.get(regionId)?.holders[0];
      if (owner && owner.userId !== requestingUserId) {
        return { result: 'lock_conflict', lockedBy: owner.username };
      }

      const updatedState = updateMidiRegionNotes(state, regionId, (notes) => [...notes, note]);
      if (!updatedState) return { result: 'not_found' };
      await this.saveState(roomId, updatedState);
      return { result: 'ok', state: updatedState };
    });
  }

  /**
   * Atomically check lock + update a note in a MIDI region.
   */
  async updateNoteAtomic(
    roomId: string,
    regionId: string,
    noteId: string,
    updates: MidiNoteUpdate,
    requestingUserId: string,
  ): Promise<{ result: 'ok'; state: ArrangeRoomState } | { result: 'lock_conflict'; lockedBy: string } | { result: 'not_found' }> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) return { result: 'not_found' };

      // Region occupancy queue (DEV-350 Round 2 Task 1) — holders[0] is the owner with edit
      // rights. Replaces the retired `state.locks`/`getActiveLockConflict` read: this is the
      // in-mutex guard, kept alongside ArrangeRegionHandler.getOwnerConflict's mutex-free
      // pre-check (TR-2) rather than deleted outright.
      const owner = state.occupancy.get(regionId)?.holders[0];
      if (owner && owner.userId !== requestingUserId) {
        return { result: 'lock_conflict', lockedBy: owner.username };
      }

      const updatedState = updateMidiRegionNotes(state, regionId, (notes) =>
        notes.map((existingNote) => existingNote.id === noteId ? ({ ...existingNote, ...updates } as MidiNote) : existingNote)
      );
      if (!updatedState) return { result: 'not_found' };
      await this.saveState(roomId, updatedState);
      return { result: 'ok', state: updatedState };
    });
  }

  /**
   * Atomically check lock + delete a note from a MIDI region.
   */
  async deleteNoteAtomic(
    roomId: string,
    regionId: string,
    noteId: string,
    requestingUserId: string,
  ): Promise<{ result: 'ok'; state: ArrangeRoomState } | { result: 'lock_conflict'; lockedBy: string } | { result: 'not_found' }> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) return { result: 'not_found' };

      // Region occupancy queue (DEV-350 Round 2 Task 1) — holders[0] is the owner with edit
      // rights. Replaces the retired `state.locks`/`getActiveLockConflict` read: this is the
      // in-mutex guard, kept alongside ArrangeRegionHandler.getOwnerConflict's mutex-free
      // pre-check (TR-2) rather than deleted outright.
      const owner = state.occupancy.get(regionId)?.holders[0];
      if (owner && owner.userId !== requestingUserId) {
        return { result: 'lock_conflict', lockedBy: owner.username };
      }

      const updatedState = updateMidiRegionNotes(state, regionId, (notes) =>
        notes.filter((existingNote) => existingNote.id !== noteId)
      );
      if (!updatedState) return { result: 'not_found' };
      await this.saveState(roomId, updatedState);
      return { result: 'ok', state: updatedState };
    });
  }

  /**
   * Set full state (for undo/redo operations)
   */
  async setFullState(
    roomId: string,
    newState: {
      tracks: Track[];
      regions: Region[];
      markers: TimeMarker[];
      chordTrack: ChordBlock[];
      bpm: number;
      timeSignature: { numerator: number; denominator: number };
    }
  ): Promise<ArrangeRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Room state not found for room: ${roomId}`);
      }

      const updatedState: ArrangeRoomState = {
        ...state,
        tracks: newState.tracks,
        regions: newState.regions,
        markers: newState.markers,
        chordTrack: {
          ...state.chordTrack,
          blocks: newState.chordTrack,
        },
        bpm: newState.bpm,
        timeSignature: newState.timeSignature,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  /**
   * Update effect chain for a track or other chain type
   */
  async updateEffectChain(roomId: string, chainType: string, effectChain: EffectChainState): Promise<ArrangeRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Room state not found for room: ${roomId}`);
      }

      const updatedState: ArrangeRoomState = {
        ...state,
        effectChains: {
          ...state.effectChains,
          [chainType]: effectChain,
        },
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  /**
   * Remove effect chain for a track or other chain type
   */
  async removeEffectChain(roomId: string, chainType: string): Promise<ArrangeRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Room state not found for room: ${roomId}`);
      }

      const { [chainType]: _removed, ...rest } = state.effectChains;
      const updatedState: ArrangeRoomState = {
        ...state,
        effectChains: rest,
        lastUpdated: new Date(),
      };
      await this.saveState(roomId, updatedState);
      return updatedState;
    });
  }

  /**
   * Set project metadata (called when loading a project or after first save)
   */
  async setProjectMetadata(
    roomId: string,
    projectId: string,
    projectOwnerId: string,
    hasBeenSaved: boolean = true
  ): Promise<ArrangeRoomState> {
    return await this.updateState(roomId, {
      projectId,
      projectOwnerId,
      hasBeenSaved,
    });
  }

  /**
   * Get project metadata from room state
   */
  async getProjectMetadata(roomId: string): Promise<{
    projectId: string | undefined;
    projectOwnerId: string | undefined;
    hasBeenSaved: boolean;
  } | null> {
    const state = await this.getState(roomId);
    if (!state) {
      return null;
    }
    return {
      projectId: state.projectId,
      projectOwnerId: state.projectOwnerId,
      hasBeenSaved: state.hasBeenSaved,
    };
  }

  /**
   * Mark project as saved (called after successful save)
   */
  async markProjectAsSaved(roomId: string, projectId: string): Promise<ArrangeRoomState> {
    return await this.updateState(roomId, {
      projectId,
      hasBeenSaved: true,
    });
  }

  /**
   * Clear project metadata (e.g., when creating a new project in the room)
   */
  async clearProjectMetadata(roomId: string): Promise<ArrangeRoomState> {
    return await redisStateService.executeWithLock(`room-state-mutex:${roomId}`, DISTRIBUTED_LOCK_TIMEOUT_MS, DISTRIBUTED_LOCK_TTL_MS, async () => {
      const state = await this.getState(roomId);
      if (!state) {
        throw new Error(`Room state not found for room: ${roomId}`);
      }

      const { projectId: _projectId, projectOwnerId: _projectOwnerId, ...stateWithoutProject } = state;
      const clearedState: ArrangeRoomState = {
        ...stateWithoutProject,
        hasBeenSaved: false,
        lastUpdated: new Date(),
      };

      await this.saveState(roomId, clearedState);
      return clearedState;
    });
  }

  // ─── Protected overrides (BaseRoomStateService) ──────────────

  protected getStateKey(roomId: string): string {
    return REDIS_KEYS.arrangeState(roomId);
  }

  protected serializeState(state: ArrangeRoomState): Record<string, unknown> {
    return {
      ...state,
      occupancy: Array.from(state.occupancy.entries()),
    };
  }

  protected deserializeState(savedState: Record<string, unknown>): ArrangeRoomState {
    // DEV-350 M2: `occupancy` is additive — pre-deploy Redis state (24h TTL) has no such key.
    const occupancy = new Map<string, ElementOccupancy>((savedState.occupancy as Array<[string, ElementOccupancy]> | undefined) ?? []);
    const lastUpdated = savedState.lastUpdated !== undefined ? new Date(savedState.lastUpdated as string | number | Date) : new Date();
    // DEV-350 Round 2 Task 1: `locks` was the retired primitive element-lock map's Redis
    // representation — dropped here too. `savedState.locks` may still be present on rooms
    // persisted before this deploy (24h TTL); destructuring it out keeps it from leaking
    // into the returned ArrangeRoomState, which no longer has a `locks` field.
    const { locks: _locks, ...savedStateWithoutLocks } = savedState;

    return {
      ...savedStateWithoutLocks as unknown as Omit<ArrangeRoomState, 'occupancy' | 'lastUpdated'>,
      occupancy,
      lastUpdated,
    };
  }

  // ─── Private helpers ─────────────────────────────────────────

  private async withStateLock<T>(roomId: string, operation: (state: ArrangeRoomState) => Promise<T> | T): Promise<T> {
    return await redisStateService.executeWithLock(
      `room-state-mutex:${roomId}`,
      DISTRIBUTED_LOCK_TIMEOUT_MS,
      DISTRIBUTED_LOCK_TTL_MS,
      async () => {
        const state = await this.getState(roomId);
        if (!state) {
          throw new Error(`Room state not found for room: ${roomId}`);
        }
        return await operation(state);
      }
    );
  }

  private async saveMutatedState(roomId: string, state: ArrangeRoomState): Promise<ArrangeRoomState> {
    await this.saveState(roomId, state);
    return state;
  }
}

// Export singleton instance
export const arrangeRoomStateService = new ArrangeRoomStateService();
