import type { StoreApi } from 'zustand';
import { BASS_PATTERNS, type BassStepChoice } from '../audio/bassPatterns';
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
import { deriveChordNotes } from '../utils/musicTheory';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { INITIAL_CHORDS, INITIAL_SEQUENCER_TRACKS, INITIAL_SYNTH_PARAMS } from './initialState';
import { cloneRegion, fallbackActiveId, newRegionId, nextRegionName } from './region';
import type { AppStore, Region, RegionSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export const DEFAULT_REGION_ID = 'region-default-1';

/** The region every fresh project starts with — matches the store's flat defaults. */
export function createDefaultRegion(): Region {
  return {
    id: DEFAULT_REGION_ID,
    name: 'Region 1',
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    synthParams: INITIAL_SYNTH_PARAMS,
    chordSynthParams: INITIAL_SYNTH_PARAMS,
    bassSynthParams: { ...INITIAL_SYNTH_PARAMS, ...FACTORY_BASS_PRESETS[0].params },
    chords: INITIAL_CHORDS.map((c) => deriveChordNotes(c, 4)),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    chordFeel: 0.5,
    chordOctave: 4,
    bassPatternId: BASS_PATTERNS[0].id,
    bassPatternMode: 'preset',
    customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),
    bassFeel: 0.5,
    bassOctave: 2,
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]),
    leadLoopLength: 1,
    sequencerTracks: INITIAL_SEQUENCER_TRACKS.map((t) => ({ ...t, steps: [...t.steps] })),
    soundKit: 'Retro Drive',
    drumFilterCutoff: 12000,
    drumFilterResonance: 0.7,
    drumFilterType: 'lowpass',
    synthVolume: 1.0,
    synthMuted: false,
    chordVolume: 1.0,
    chordMuted: false,
    bassVolume: 1.0,
    bassMuted: false,
    masterSequencerVolume: 0.8,
    drumMuted: false,
  };
}

export function createRegionSlice(set: Set, get: Get): RegionSlice {
  return {
    regions: [createDefaultRegion()],
    activeRegionId: DEFAULT_REGION_ID,

    // A new region is a copy of the active region (default), appended. Content
    // is identical to what the flat slices already hold, so no loadRegion call
    // is needed — only the cursor moves.
    addRegion: () => {
      const state = get();
      const source =
        state.regions.find((r) => r.id === state.activeRegionId) ?? state.regions[0];
      const region: Region = {
        ...cloneRegion(source),
        id: newRegionId(),
        name: nextRegionName(state.regions),
      };
      set({ regions: [...state.regions, region], activeRegionId: region.id });
      return region.id;
    },

    // Deep clone inserted immediately after the original. When the clone is
    // auto-activated (original was active) the content matches the flat slices,
    // so no loadRegion is needed; otherwise the caller must load the clone.
    duplicateRegion: (id) => {
      const state = get();
      const index = state.regions.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const clone: Region = {
        ...cloneRegion(state.regions[index]),
        id: newRegionId(),
        name: nextRegionName(state.regions),
      };
      const cloneActive = id === state.activeRegionId;
      const regions = [
        ...state.regions.slice(0, index + 1),
        clone,
        ...state.regions.slice(index + 1),
      ];
      set(cloneActive ? { regions, activeRegionId: clone.id } : { regions });
      return cloneActive ? null : clone.id;
    },

    // A project always has ≥ 1 region. Deleting the active region returns the
    // fallback id so the caller can loadRegion it.
    deleteRegion: (id) => {
      const state = get();
      if (state.regions.length <= 1) return null;
      const index = state.regions.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const wasActive = id === state.activeRegionId;
      const regions = state.regions.filter((r) => r.id !== id);
      // Song mode: the cursor must track the ACTIVE region's index in the NEW
      // list, so a delete (of the active region or a neighbour) can't leave it
      // pointing at the wrong region or out of range (which would freeze the
      // song advance). Loop mode keeps the null cursor.
      const cursor = (activeId: string) =>
        state.songRegionIndex !== null
          ? Math.max(0, regions.findIndex((r) => r.id === activeId))
          : null;
      if (!wasActive) {
        set({ regions, songRegionIndex: cursor(state.activeRegionId) });
        return null;
      }
      const fallback = fallbackActiveId(state.regions, id) ?? regions[0].id;
      set({ regions, activeRegionId: fallback, songRegionIndex: cursor(fallback) });
      return fallback;
    },

    reorderRegions: (id, direction) =>
      set((state) => {
        const index = state.regions.findIndex((r) => r.id === id);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= state.regions.length) return {};
        const regions = [...state.regions];
        const [moved] = regions.splice(index, 1);
        regions.splice(target, 0, moved);
        return {
          regions,
          // activeRegionId is unchanged by a reorder; only its list index
          // shifts, so re-derive the song cursor onto its new position (kept
          // null in loop mode).
          songRegionIndex:
            state.songRegionIndex !== null
              ? Math.max(0, regions.findIndex((r) => r.id === state.activeRegionId))
              : null,
        };
      }),

    setRegionMix: (id, patch) =>
      set((state) => {
        const regions = state.regions.map((r) => (r.id === id ? { ...r, ...patch } : r));
        // Mirror onto the flat slices only when the edited region is the active
        // (sounding) one, so the engine follows live (engineSync reads the flat
        // fields) and regionSync writes the same values back idempotently. A
        // non-active region is edited for later use only.
        if (id !== state.activeRegionId) return { regions };
        return { regions, ...patch };
      }),

    setActiveRegion: (id) => set({ activeRegionId: id }),
  };
}
