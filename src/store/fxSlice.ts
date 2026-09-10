import type { StoreApi } from 'zustand';
import { createMelodySlice } from './leadSlice';
import { melodyTrack } from './melodyTracks';
import { INITIAL_SYNTH_PARAMS } from './initialState';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
import type { AppStore, FxSlice } from './types';

/**
 * The FX half of the melody slice. Its own file, one call, no logic: everything
 * it does lives in createMelodySlice, and a file here is what makes the fx slice
 * findable by name in store.ts's composition list.
 */
export function createFxSlice(
  set: StoreApi<AppStore>['setState'],
  get: StoreApi<AppStore>['getState'],
): FxSlice {
  const melody = createMelodySlice(melodyTrack('fx'), set, get);

  return {
    ...melody,
    // FX has no legacy synth slice to inherit a bus/patch from (unlike lead,
    // whose synthVolume/synthMuted/synthParams predate this factory and live
    // in SynthSlice), so these three live here rather than in
    // createMelodySlice — lead must not gain siblings for them.
    fxSynthParams: INITIAL_SYNTH_PARAMS,
    fxVolume: DEFAULT_BUS_TRIM_DB,
    fxMuted: false,
    setFxSynthParams: (fxSynthParams) => set({ fxSynthParams }),
    setFxVolume: (fxVolume) => set({ fxVolume }),
    toggleFxMuted: () => set((state) => ({ fxMuted: !state.fxMuted })),
  } as FxSlice;
}
