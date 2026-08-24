import type { StoreApi } from 'zustand';
import type { AppStore, TransportSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Transport slice. `isSequencerPlaying` / `isChordsPlaying` are transient
 * (excluded from persistence); everything else persists.
 *
 * Engine side-effects (init/resetClock on the fully-stopped -> playing
 * transition) are handled by engineSync's transport-flags subscription.
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

    toggleSequencerPlay: () => set((state) => ({ isSequencerPlaying: !state.isSequencerPlaying })),

    toggleChordsPlay: () => set((state) => ({ isChordsPlaying: !state.isChordsPlaying })),

    toggleMasterPlay: () => {
      const { isSequencerPlaying, isChordsPlaying } = get();
      if (isSequencerPlaying || isChordsPlaying) {
        set({ isSequencerPlaying: false, isChordsPlaying: false });
      } else {
        set({ isSequencerPlaying: true, isChordsPlaying: true });
      }
    },
  };
}
