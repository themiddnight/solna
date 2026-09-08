import type { StoreApi } from 'zustand';
import { BASS_PATTERNS, type BassStepChoice } from '@/data/bassPatterns';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
import type { AppStore, BassSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/** Bass module slice: pattern/feel/octave plus per-layer mute and volume. */
export function createBassSlice(set: Set): BassSlice {
  return {
    bassPatternId: BASS_PATTERNS[0].id,
    bassPatternMode: 'preset',
    customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),
    bassFeel: 0.5,
    bassOctave: 2,
    bassMuted: false,
    bassVolume: DEFAULT_BUS_TRIM_DB,

    setBassPatternId: (bassPatternId) => set({ bassPatternId }),
    setBassPatternMode: (bassPatternMode) => set({ bassPatternMode }),
    setCustomBassPattern: (customBassPattern) => set({ customBassPattern }),
    setBassFeel: (bassFeel) => set({ bassFeel }),
    setBassOctave: (bassOctave) => set({ bassOctave }),
    setBassVolume: (bassVolume) => set({ bassVolume }),
    toggleBassMuted: () => set((state) => ({ bassMuted: !state.bassMuted })),
  };
}
