import type { StoreApi } from 'zustand';
import { INITIAL_EFFECTS } from './initialState';
import type { AppStore, EffectsSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/** Master effects chain slice. */
export function createEffectsSlice(set: Set, _get: Get): EffectsSlice {
  return {
    effects: INITIAL_EFFECTS,

    setEffects: (effects) => set({ effects }),
  };
}
