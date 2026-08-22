import type { StoreApi } from 'zustand';
import type { SynthPresetItem, SynthPresetCategory } from '../audio/synthPresets';
import type { ChordItem } from '../types';
import type { AppStore, PresetsSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Presets slice: the user's custom synth presets and chord progressions,
 * persisted in the main project state (replacing the old per-key localStorage
 * writes — see migrate.ts for the one-time adoption of those legacy keys).
 *
 * Action signatures mirror the wrappers in src/audio/synthPresets.ts and
 * src/components/ChordPresetLibrary.tsx so the UI layer can swap to the store
 * without changing its call sites.
 */
export function createPresetsSlice(set: Set, _get: Get): PresetsSlice {
  return {
    customSynthPresets: [],
    customChordProgressions: [],

    saveCustomPreset: (name, params, category = 'User', description = '') => {
      // Extract pure sound params (drop the preset label)
      const { preset, ...pureParams } = params;
      const newPreset: SynthPresetItem = {
        id: `user-preset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: name.trim() || 'Untitled Preset',
        category,
        isFactory: false,
        createdAt: Date.now(),
        description: description.trim() || 'Custom user preset',
        params: { ...pureParams },
      };
      set((state) => ({ customSynthPresets: [newPreset, ...state.customSynthPresets] }));
      return newPreset;
    },

    updateCustomPreset: (id, updates) => {
      let updated: SynthPresetItem[] = [];
      set((state) => {
        updated = state.customSynthPresets.map((p) => (p.id === id ? { ...p, ...updates } : p));
        return { customSynthPresets: updated };
      });
      return updated;
    },

    deleteCustomPreset: (id) => {
      let updated: SynthPresetItem[] = [];
      set((state) => {
        updated = state.customSynthPresets.filter((p) => p.id !== id);
        return { customSynthPresets: updated };
      });
      return updated;
    },

    saveCustomChordProgression: (name, chords, category = 'User', description = '', roman = '') => {
      const newItem = {
        id: `chord-prog-${Date.now()}`,
        name,
        category,
        description,
        roman: roman || chords.map((c) => `${c.root}${c.quality}`).join(' - '),
        chords: [...chords],
        createdAt: Date.now(),
      };
      set((state) => ({
        customChordProgressions: [
          newItem,
          ...state.customChordProgressions.filter((c) => c.name !== name),
        ],
      }));
      return newItem;
    },

    deleteCustomChordProgression: (id) => {
      let updated: ReturnType<Get>['customChordProgressions'] = [];
      set((state) => {
        updated = state.customChordProgressions.filter((c) => c.id !== id);
        return { customChordProgressions: updated };
      });
      return updated;
    },
  };
}
