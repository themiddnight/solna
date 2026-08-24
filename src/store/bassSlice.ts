import type { StoreApi } from 'zustand';
import { BASS_PATTERNS } from '../audio/bassPatterns';
import type { AppStore, BassSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/** Bass module slice: pattern/feel/octave plus per-layer mute and volume. */
export function createBassSlice(set: Set): BassSlice {
  return {
    bassPatternId: BASS_PATTERNS[0].id,
    bassFeel: 0.5,
    bassOctave: 2,
    bassMuted: false,
    bassVolume: 1.0,

    setBassPatternId: (bassPatternId) => set({ bassPatternId }),
    setBassFeel: (bassFeel) => set({ bassFeel }),
    setBassOctave: (bassOctave) => set({ bassOctave }),
    setBassVolume: (bassVolume) => set({ bassVolume }),
    toggleBassMuted: () => set((state) => ({ bassMuted: !state.bassMuted })),
  };
}
