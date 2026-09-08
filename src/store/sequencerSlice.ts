import type { StoreApi } from 'zustand';
import { INITIAL_SEQUENCER_TRACKS } from './initialState';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
import { getMeter } from '../utils/meter';
import { adaptStepRow, writeStepWindow } from '../utils/patternAdapt';
import type { AppStore, SequencerSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Sequencer slice. `replaceDrumPattern` writes a whole grid: matching tracks
 * take their row, every other track is cleared in its window.
 */
export function createSequencerSlice(set: Set): SequencerSlice {
  return {
    sequencerTracks: INITIAL_SEQUENCER_TRACKS,
    soundKit: 'Retro Drive',
    masterSequencerVolume: DEFAULT_BUS_TRIM_DB,
    drumMuted: false,
    // Drum bus filter defaults: fully open so it reads as bypass until touched.
    drumFilterCutoff: 12000,
    drumFilterResonance: 0.7,
    drumFilterType: 'lowpass',

    // Apply-time adaptation (see the spec, "Where adaptation happens differs by
    // target"): the user edits this grid, so an incoming pattern is adapted to
    // the active bar length HERE and materialised into state. Trimming at
    // playback instead would make the UI lie, showing steps that never sound.
    //
    // REPLACES, does not merge. A track the pattern does not name is cleared,
    // because a drum grid determines the whole kit. Clearing goes through
    // writeStepWindow like every other write, so it clears only the ACTIVE
    // WINDOW and the padding past stepsPerBar — the wider-meter content —
    // survives. Assigning `new Array(stepsPerBar).fill(false)` straight to
    // `steps` would pass every window assertion and silently truncate the
    // track; store.test.ts seeds a `true` at index 20 to catch exactly that.
    replaceDrumPattern: (pattern) =>
      set((state) => {
        const stepsPerBar = getMeter(state.meterId).stepsPerBar;
        return {
          sequencerTracks: state.sequencerTracks.map((track) => {
            const row = pattern[track.instrument];
            const next = row
              ? adaptStepRow(row, stepsPerBar)
              : new Array(stepsPerBar).fill(false);
            return {
              ...track,
              steps: writeStepWindow(track.steps, stepsPerBar, next),
            };
          }),
        };
      }),

    // Setters backing the SequencerView grid and master volume (previously
    // App.tsx setState wrappers / local useState with the same semantics).
    setSequencerTracks: (sequencerTracks) => set({ sequencerTracks }),
    setTrackVolume: (trackId, volume) =>
      set((state) => ({
        sequencerTracks: state.sequencerTracks.map((track) =>
          track.id === trackId ? { ...track, volume } : track,
        ),
      })),
    setSoundKit: (soundKit) => set({ soundKit }),
    setMasterSequencerVolume: (masterSequencerVolume) => set({ masterSequencerVolume }),
    toggleDrumMuted: () => set((state) => ({ drumMuted: !state.drumMuted })),
    setDrumFilterCutoff: (drumFilterCutoff) => set({ drumFilterCutoff }),
    setDrumFilterResonance: (drumFilterResonance) => set({ drumFilterResonance }),
    setDrumFilterType: (drumFilterType) => set({ drumFilterType }),
  };
}
