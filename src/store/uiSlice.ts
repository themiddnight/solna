import type { StoreApi } from 'zustand';
import type { AppStore, UiSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * UI slice: active tab + modal visibility. None of this is persisted — the
 * active tab lives in the URL query (?tab=...) instead.
 */
export function createUiSlice(set: Set): UiSlice {
  return {
    activeTab: 'synth',
    isProjectModalOpen: false,

    setActiveTab: (activeTab) => set({ activeTab }),
    openProjectsModal: () => set({ isProjectModalOpen: true }),
    closeProjectsModal: () => set({ isProjectModalOpen: false }),
  };
}
