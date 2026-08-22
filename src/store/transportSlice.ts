import type { StoreApi } from 'zustand';
import { audioEngine } from '../audio/engine';
import type { AppStore, TransportSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Transport slice. `isSequencerPlaying` / `isChordsPlaying` are transient
 * (excluded from persistence); everything else persists.
 *
 * Semantics mirror the original useState handlers in App.tsx:
 * - toggling a single view restarts the shared clock only when both views are
 *   stopped, so a paused companion view resumes from its grid position.
 * - Play All starts both views together from the top of the grid.
 */
export function createTransportSlice(set: Set, get: Get): TransportSlice {
  return {
    bpm: 120,
    masterVolume: 0.85,
    metronomeActive: false,
    isSequencerPlaying: false,
    isChordsPlaying: false,

    setBpm: (bpm) => set({ bpm }),
    setMasterVolume: (masterVolume) => set({ masterVolume }),

    toggleMetronome: () => set((state) => ({ metronomeActive: !state.metronomeActive })),

    resetClockIfStopped: () => {
      const { isSequencerPlaying, isChordsPlaying } = get();
      if (!isSequencerPlaying && !isChordsPlaying) {
        audioEngine.resetClock();
      }
    },

    toggleSequencerPlay: () => {
      audioEngine.init();
      get().resetClockIfStopped();
      set((state) => ({ isSequencerPlaying: !state.isSequencerPlaying }));
    },

    toggleChordsPlay: () => {
      audioEngine.init();
      get().resetClockIfStopped();
      set((state) => ({ isChordsPlaying: !state.isChordsPlaying }));
    },

    toggleMasterPlay: () => {
      audioEngine.init();
      const { isSequencerPlaying, isChordsPlaying } = get();
      if (isSequencerPlaying || isChordsPlaying) {
        set({ isSequencerPlaying: false, isChordsPlaying: false });
      } else {
        // Play All: every view starts together on the shared engine clock
        audioEngine.resetClock();
        set({ isSequencerPlaying: true, isChordsPlaying: true });
      }
    },
  };
}
