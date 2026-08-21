import { ARRANGE_CONSTANTS, createDefaultCompanionConfig, deriveRoleFromInstrument } from '@jam-band/shared';
import type { ChordBlock } from '@jam-band/shared';
import { toDecibels } from '../domain/models/ArrangeRoomState';
import type { ArrangeRoomState, MidiNote, Region, Track, TrackUpdate, RegionUpdate, TimeMarker, TimeMarkerUpdate, ChordBlockUpdate, CompanionRegion, CompanionRegionConfig, MidiRegion, CompanionRegionMetadata } from '../domain/models/ArrangeRoomState';

export const MAX_TRACKS_PER_ROOM = ARRANGE_CONSTANTS.MAX_TRACKS_PER_ROOM;
export const MAX_COMPANION_REGIONS_PER_PROJECT = ARRANGE_CONSTANTS.MAX_COMPANION_REGIONS_PER_PROJECT;

export function addTrackToState(state: ArrangeRoomState, track: Track, roomId: string): ArrangeRoomState {
  if (state.tracks.length >= MAX_TRACKS_PER_ROOM) {
    throw new Error(`Maximum track limit (${MAX_TRACKS_PER_ROOM}) reached for room: ${roomId}`);
  }

  return {
    ...state,
    tracks: [...state.tracks, track],
    lastUpdated: new Date(),
  };
}

export function updateTrackInState(state: ArrangeRoomState, trackId: string, updates: TrackUpdate): ArrangeRoomState {
  return {
    ...state,
    tracks: state.tracks.map((track) => (track.id === trackId ? ({ ...track, ...updates } as Track) : track)),
    lastUpdated: new Date(),
  };
}

export function removeTrackFromState(state: ArrangeRoomState, trackId: string): ArrangeRoomState {
  const regionsToRemove = state.regions.filter((region) => region.trackId === trackId).map((region) => region.id);
  const chainType = `track:${trackId}`;
  const { [chainType]: _removedChain, ...remainingChains } = state.effectChains;

  return {
    ...state,
    tracks: state.tracks.filter((track) => track.id !== trackId),
    regions: state.regions.filter((region) => region.trackId !== trackId),
    effectChains: remainingChains,
    selectedTrackId: state.selectedTrackId === trackId ? null : state.selectedTrackId,
    selectedRegionIds: state.selectedRegionIds.filter((id) => !regionsToRemove.includes(id)),
    lastUpdated: new Date(),
  };
}

export function reorderTracksInState(state: ArrangeRoomState, trackIds: string[]): ArrangeRoomState {
  const trackMap = new Map(state.tracks.map((track) => [track.id, track]));
  const reorderedTracks = trackIds
    .map((id) => trackMap.get(id))
    .filter((track): track is Track => track !== undefined);
  const existingIds = new Set(trackIds);
  const remainingTracks = state.tracks.filter((track) => !existingIds.has(track.id));

  return {
    ...state,
    tracks: [...reorderedTracks, ...remainingTracks],
    lastUpdated: new Date(),
  };
}

export function addRegionToState(state: ArrangeRoomState, region: Region): ArrangeRoomState {
  if (region.type === 'companion') {
    const companionCount = state.regions.filter((existing) => existing.type === 'companion').length;
    if (companionCount >= MAX_COMPANION_REGIONS_PER_PROJECT) {
      throw new Error(`Maximum companion regions (${MAX_COMPANION_REGIONS_PER_PROJECT}) reached for room: ${state.roomId}`);
    }
  }

  const updatedTracks = state.tracks.map((track) =>
    track.id === region.trackId && !track.regionIds.includes(region.id)
      ? { ...track, regionIds: [...track.regionIds, region.id] }
      : track
  );

  return {
    ...state,
    tracks: updatedTracks,
    regions: [...state.regions, region],
    lastUpdated: new Date(),
  };
}

export function updateRegionInState(state: ArrangeRoomState, regionId: string, updates: RegionUpdate, roomId: string): ArrangeRoomState {
  const existingRegion = state.regions.find((region) => region.id === regionId);
  if (!existingRegion) {
    throw new Error(`Region ${regionId} not found in room ${roomId}`);
  }

  const updatedRegion: Region = { ...existingRegion, ...updates } as Region;
  let updatedTracks = state.tracks;

  if (updates.trackId && updates.trackId !== existingRegion.trackId) {
    updatedTracks = state.tracks.map((track) => {
      if (track.id === existingRegion.trackId) {
        return { ...track, regionIds: track.regionIds.filter((id) => id !== regionId) };
      }
      if (track.id === updates.trackId && !track.regionIds.includes(regionId)) {
        return { ...track, regionIds: [...track.regionIds, regionId] };
      }
      return track;
    });
  }

  return {
    ...state,
    tracks: updatedTracks,
    regions: state.regions.map((region) => (region.id === regionId ? updatedRegion : region)),
    lastUpdated: new Date(),
  };
}

/**
 * Field-merges a companion config PATCH into a companion region's EXISTING
 * config (DEV-279 P2 Task 2.8) — deliberately NOT routed through
 * `updateRegionInState`, whose `{ ...existingRegion, ...updates }` flat merge
 * would REPLACE `region.config` wholesale with just the patch, dropping every
 * config field the patch didn't touch (carry-forwards Task 0.6c/2.4's
 * field-merge requirement). Only companion regions carry a `config`, so this
 * is a no-op (returns `state` unchanged) for a missing region or a region
 * that isn't type `'companion'` — the caller (`ArrangeCompanionHandler`)
 * treats that as a failure and reports it, rather than silently corrupting a
 * midi/audio region.
 */
export function updateCompanionRegionConfigInState(
  state: ArrangeRoomState,
  regionId: string,
  configPatch: Partial<CompanionRegionConfig>,
): ArrangeRoomState {
  const existingRegion = state.regions.find((region) => region.id === regionId);
  if (!existingRegion || existingRegion.type !== 'companion') {
    return state;
  }

  const updatedRegion: CompanionRegion = {
    ...existingRegion,
    config: { ...existingRegion.config, ...configPatch },
  };

  return {
    ...state,
    regions: state.regions.map((region) => (region.id === regionId ? updatedRegion : region)),
    lastUpdated: new Date(),
  };
}

/**
 * Convert a companion region to a plain MIDI region IN PLACE (DEV-279 Phase 3
 * Task 3.3a) — freezes the region's on-the-fly-generated notes into stored
 * notes, carrying `companionMetadata` (the convert "recipe") so the region can
 * later be reverted. Same `id`, same position in `state.regions`, same track
 * (`track.regionIds` is untouched — the region isn't removed/re-added, just
 * transformed). No-op (returns `state` unchanged) for a missing region or a
 * region that isn't type `'companion'` — the caller treats an unchanged
 * return as a no-op/failure, mirroring `updateCompanionRegionConfigInState`.
 */
export function convertCompanionRegionToMidiInState(
  state: ArrangeRoomState,
  regionId: string,
  notes: MidiNote[],
  metadata: CompanionRegionMetadata,
): ArrangeRoomState {
  const existingRegion = state.regions.find((region) => region.id === regionId);
  if (!existingRegion || existingRegion.type !== 'companion') {
    return state;
  }

  const convertedRegion: MidiRegion = {
    id: existingRegion.id,
    trackId: existingRegion.trackId,
    name: existingRegion.name,
    start: existingRegion.start,
    length: existingRegion.length,
    loopEnabled: existingRegion.loopEnabled,
    loopIterations: existingRegion.loopIterations,
    color: existingRegion.color,
    ownerId: existingRegion.ownerId,
    type: 'midi',
    notes,
    sustainEvents: [],
    companionMetadata: metadata,
  };

  return {
    ...state,
    regions: state.regions.map((region) => (region.id === regionId ? convertedRegion : region)),
    lastUpdated: new Date(),
  };
}

/**
 * Revert a MIDI region to a companion region IN PLACE (DEV-279 Phase 3 Task
 * 3.3a; symmetric MIDI↔Companion swap follow-up) — the inverse of
 * `convertCompanionRegionToMidiInState`. Discards the frozen notes and rebuilds
 * a companion `config`:
 * - a MIDI region that was itself produced by converting a companion region
 *   restores its exact saved recipe (`region.companionMetadata.config`);
 * - a plain MIDI region (never a companion) gets a fresh role-default config,
 *   derived server-side from the track's instrument via
 *   `createDefaultCompanionConfig(deriveRoleFromInstrument(...))` — the SAME
 *   default the FE create/convert paths seed, so the two never diverge.
 * The config is always resolved from AUTHORITATIVE server state (stored recipe
 * or server-derived default), never from a client payload — TR-33.
 * Same `id`, same position, same track. No-op for a missing region or a region
 * that isn't type `'midi'`.
 *
 * Enforces the SAME ≤`MAX_COMPANION_REGIONS_PER_PROJECT` soft cap `addRegionToState`
 * enforces (P2) — the invariant must hold on every entry path that can produce a
 * live companion region, including revert (review fix round 1): the region being
 * reverted is currently type `'midi'` so it is NOT itself counted in
 * `companionCount` below; reverting while already at the cap would create the
 * (cap + 1)th companion region, so it THROWS (mirrors `addRegionToState`'s
 * message/shape) rather than silently exceeding the cap — the caller
 * (`ArrangeRoomStateService.revertMidiToCompanion`) lets this propagate so no
 * Redis write happens and the handler's try/catch surfaces it as a socket error.
 */
export function revertMidiRegionToCompanionInState(
  state: ArrangeRoomState,
  regionId: string,
): ArrangeRoomState {
  const existingRegion = state.regions.find((region) => region.id === regionId);
  if (!existingRegion || existingRegion.type !== 'midi') {
    return state;
  }

  const companionCount = state.regions.filter((region) => region.type === 'companion').length;
  if (companionCount >= MAX_COMPANION_REGIONS_PER_PROJECT) {
    throw new Error(`Maximum companion regions (${MAX_COMPANION_REGIONS_PER_PROJECT}) reached for room: ${state.roomId}`);
  }

  // Restore the exact recipe if this MIDI region was converted from a companion;
  // otherwise seed a fresh role-default config from the track's instrument
  // (server-derived, not client-supplied — TR-33).
  const instrumentId = state.tracks.find((track) => track.id === existingRegion.trackId)?.instrumentId ?? '';
  // DEV-304 (fix round 1): lazily seed the default only when there's no stored recipe to
  // restore — `createDefaultCompanionConfig` is cheap/pure so this was never a correctness
  // bug, but a `?? RHS` should stay lazy in intent, not run unconditionally before the check.
  const config: CompanionRegionConfig =
    existingRegion.companionMetadata?.config ??
    (() => {
      const defaultConfig = createDefaultCompanionConfig(deriveRoleFromInstrument(instrumentId));
      return { ...defaultConfig, volume: toDecibels(defaultConfig.volume) };
    })();

  const revertedRegion: CompanionRegion = {
    id: existingRegion.id,
    trackId: existingRegion.trackId,
    name: existingRegion.name,
    start: existingRegion.start,
    length: existingRegion.length,
    loopEnabled: existingRegion.loopEnabled,
    loopIterations: existingRegion.loopIterations,
    color: existingRegion.color,
    ownerId: existingRegion.ownerId,
    type: 'companion',
    config,
  };

  return {
    ...state,
    regions: state.regions.map((region) => (region.id === regionId ? revertedRegion : region)),
    lastUpdated: new Date(),
  };
}

export function removeRegionFromState(state: ArrangeRoomState, regionId: string): ArrangeRoomState {
  const region = state.regions.find((candidate) => candidate.id === regionId);
  const updatedTracks = region
    ? state.tracks.map((track) =>
      track.id === region.trackId
        ? { ...track, regionIds: track.regionIds.filter((id) => id !== regionId) }
        : track
    )
    : state.tracks;

  return {
    ...state,
    tracks: updatedTracks,
    regions: state.regions.filter((candidate) => candidate.id !== regionId),
    selectedRegionIds: state.selectedRegionIds.filter((id) => id !== regionId),
    lastUpdated: new Date(),
  };
}

export function updateMidiRegionNotes(
  state: ArrangeRoomState,
  regionId: string,
  updateNotes: (notes: MidiNote[]) => MidiNote[]
): ArrangeRoomState | null {
  const region = state.regions.find((candidate) => candidate.id === regionId && candidate.type === 'midi');
  if (!region || region.type !== 'midi') return null;

  const updatedNotes = updateNotes(region.notes);
  return {
    ...state,
    regions: state.regions.map((candidate) =>
      candidate.id === regionId ? ({ ...candidate, notes: updatedNotes } as Region) : candidate,
    ),
    lastUpdated: new Date(),
  };
}

export function addMarkerToState(
  state: ArrangeRoomState,
  marker: { id: string; position: number; description?: string | undefined; color?: string | undefined }
): ArrangeRoomState {
  const normalizedMarker = { ...marker, description: marker.description ?? '' };
  return {
    ...state,
    markers: [...state.markers, normalizedMarker].sort((a, b) => a.position - b.position),
    lastUpdated: new Date(),
  };
}

export function updateMarkerInState(
  state: ArrangeRoomState,
  markerId: string,
  updates: TimeMarkerUpdate
): ArrangeRoomState {
  return {
    ...state,
    markers: state.markers
      .map((marker) => (marker.id === markerId ? ({ ...marker, ...updates } as TimeMarker) : marker))
      .sort((a, b) => a.position - b.position),
    lastUpdated: new Date(),
  };
}

export function removeMarkerFromState(state: ArrangeRoomState, markerId: string): ArrangeRoomState {
  return {
    ...state,
    markers: state.markers.filter((marker) => marker.id !== markerId),
    lastUpdated: new Date(),
  };
}

/**
 * Chord track block mutations (DEV-279 P1). `chordTrack` is a single top-level entity
 * (one per project, per §7 of the design spec) — these mutate its `blocks` array only,
 * mirroring the region mutations' shape-in/shape-out contract.
 */
export function addChordBlockToState(state: ArrangeRoomState, block: ChordBlock): ArrangeRoomState {
  return {
    ...state,
    chordTrack: {
      ...state.chordTrack,
      blocks: [...state.chordTrack.blocks, block],
    },
    lastUpdated: new Date(),
  };
}

export function updateChordBlockInState(state: ArrangeRoomState, blockId: string, updates: ChordBlockUpdate): ArrangeRoomState {
  return {
    ...state,
    chordTrack: {
      ...state.chordTrack,
      blocks: state.chordTrack.blocks.map((block) => (block.id === blockId ? ({ ...block, ...updates } as ChordBlock) : block)),
    },
    lastUpdated: new Date(),
  };
}

export function removeChordBlockFromState(state: ArrangeRoomState, blockId: string): ArrangeRoomState {
  return {
    ...state,
    chordTrack: {
      ...state.chordTrack,
      blocks: state.chordTrack.blocks.filter((block) => block.id !== blockId),
    },
    lastUpdated: new Date(),
  };
}
