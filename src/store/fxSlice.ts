import type { StoreApi } from 'zustand';
import { createMelodySlice } from './leadSlice';
import { melodyTrack } from './melodyTracks';
import { defaultFxBusState } from './initialState';
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
    // createMelodySlice — lead must not gain siblings for them. Their VALUES
    // come from initialState, which states them for a new loop too: a default
    // spelled in both places drifts into a session and a loop disagreeing.
    ...defaultFxBusState(),
    setFxSynthParams: (fxSynthParams) => set({ fxSynthParams }),
    setFxVolume: (fxVolume) => set({ fxVolume }),
    toggleFxMuted: () => set((state) => ({ fxMuted: !state.fxMuted })),
  } as FxSlice;
}
