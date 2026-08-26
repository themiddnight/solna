import type { StoreApi } from 'zustand';
import type { AppStore, MusicContextSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Music context slice: the global key/scale plus the id of the Instant Vibe
 * that was last loaded. `selectedVibeId` is persisted so the vibe bar's
 * highlight survives a reload; it is written by applyInstantVibeToStore, not
 * by the key/scale setters, so editing the key by hand does not clear it.
 */
export function createMusicContextSlice(set: Set): MusicContextSlice {
  return {
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    selectedVibeId: null,

    setScaleRoot: (scaleRoot) => set({ scaleRoot }),
    setScaleType: (scaleType) => set({ scaleType }),
    setSelectedVibeId: (selectedVibeId) => set({ selectedVibeId }),
  };
}
