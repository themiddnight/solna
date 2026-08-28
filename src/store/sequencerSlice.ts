import type { StoreApi } from 'zustand';
import { INITIAL_SEQUENCER_TRACKS } from './initialState';
import { getMeter } from '../utils/meter';
import { adaptStepRow, writeStepWindow } from '../utils/patternAdapt';
import type { AppStore, SequencerSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Sequencer slice. `applyDrumPattern` maps the drum-pattern hits onto the
 * matching tracks by instrument, mirroring handleApplyDrumPattern in App.tsx.
 */
export function createSequencerSlice(set: Set): SequencerSlice {
  return {
    sequencerTracks: INITIAL_SEQUENCER_TRACKS,
    soundKit: 'Retro Drive',
    masterSequencerVolume: 0.8,
    drumMuted: false,
    // Drum bus filter defaults: fully open so it reads as bypass until touched.
    drumFilterCutoff: 12000,
    drumFilterResonance: 0.7,
    drumFilterType: 'lowpass',

    // Apply-time adaptation (see the spec, "Where adaptation happens differs by
    // target"): the user edits this grid, so an incoming pattern is adapted to
    // the active bar length HERE and materialised into state. Trimming at
    // playback instead would make the UI lie, showing steps that never sound.
    applyDrumPattern: (pattern) =>
      set((state) => {
        const stepsPerBar = getMeter(state.meterId).stepsPerBar;
        return {
          sequencerTracks: state.sequencerTracks.map((track) => {
            const row = pattern[track.instrument];
            if (!row) return track;
            return {
              ...track,
              steps: writeStepWindow(track.steps, stepsPerBar, adaptStepRow(row, stepsPerBar)),
            };
          }),
        };
      }),

    // Setters backing the SequencerView grid and master volume (previously
    // App.tsx setState wrappers / local useState with the same semantics).
    setSequencerTracks: (sequencerTracks) => set({ sequencerTracks }),
    setSoundKit: (soundKit) => set({ soundKit }),
    setMasterSequencerVolume: (masterSequencerVolume) => set({ masterSequencerVolume }),
    toggleDrumMuted: () => set((state) => ({ drumMuted: !state.drumMuted })),
    setDrumFilterCutoff: (drumFilterCutoff) => set({ drumFilterCutoff }),
    setDrumFilterResonance: (drumFilterResonance) => set({ drumFilterResonance }),
    setDrumFilterType: (drumFilterType) => set({ drumFilterType }),
  };
}
