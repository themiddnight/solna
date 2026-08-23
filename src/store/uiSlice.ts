import type { StoreApi } from 'zustand';
import type { AppStore, UiSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * UI slice: active tab + modal visibility. None of this is persisted — the
 * active tab lives in the URL query (?tab=...) instead.
 */
export function createUiSlice(set: Set, _get: Get): UiSlice {
  return {
    activeTab: 'synth',
    isProjectModalOpen: false,

    setActiveTab: (activeTab) => set({ activeTab }),
    openProjectsModal: () => set({ isProjectModalOpen: true }),
    closeProjectsModal: () => set({ isProjectModalOpen: false }),
  };
}
