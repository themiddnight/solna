import type { StoreApi } from 'zustand';
import { INITIAL_SEQUENCER_TRACKS } from './initialState';
import type { AppStore, SequencerSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Sequencer slice. `applyDrumPattern` maps the drum-pattern hits onto the
 * matching tracks by instrument, mirroring handleApplyDrumPattern in App.tsx.
 */
export function createSequencerSlice(set: Set, _get: Get): SequencerSlice {
  return {
    sequencerTracks: INITIAL_SEQUENCER_TRACKS,
    soundKit: 'Retro Drive',
    masterSequencerVolume: 0.8,

    applyDrumPattern: (pattern) =>
      set((state) => ({
        sequencerTracks: state.sequencerTracks.map((track) => {
          if (pattern[track.instrument]) {
            return { ...track, steps: [...pattern[track.instrument]] };
          }
          return track;
        }),
      })),

    // Setters backing the SequencerView grid and master volume (previously
    // App.tsx setState wrappers / local useState with the same semantics).
    setSequencerTracks: (sequencerTracks) => set({ sequencerTracks }),
    setSoundKit: (soundKit) => set({ soundKit }),
    setMasterSequencerVolume: (masterSequencerVolume) => set({ masterSequencerVolume }),
  };
}
