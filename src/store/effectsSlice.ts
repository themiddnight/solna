import type { StoreApi } from 'zustand';
import { INITIAL_EFFECTS } from './initialState';
import type { AppStore, EffectsSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/** Master effects chain slice. */
export function createEffectsSlice(set: Set): EffectsSlice {
  return {
    effects: INITIAL_EFFECTS,

    setEffects: (effects) => set({ effects }),
  };
}
