import type { StoreApi } from 'zustand';
import type { SynthPreset } from '../data/synthPresets';
import type { AppStore, PresetsSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Presets slice: the user's custom synth presets and chord progressions,
 * persisted in the main project state (replacing the old per-key localStorage
 * writes — see migrate.ts for the one-time adoption of those legacy keys).
 *
 * These actions are called directly by the UI layer (the thin store-wrapper
 * helpers that used to live beside the preset registry and in
 * ChordPresetLibrary.tsx were deleted; components call the slice actions
 * themselves).
 */
export function createPresetsSlice(set: Set): PresetsSlice {
  return {
    customSynthPresets: [],
    customChordProgressions: [],

    /**
     * Capture the track's CURRENT sound as a custom preset.
     *
     * It takes an `ActiveSynth` and stores the engine plus a deep copy of the
     * complete patch, so a saved preset is the same shape as a factory one and
     * loads through the same `applySynthPreset`. Three things are deliberately
     * dropped rather than stored:
     *
     * - `sourcePresetId`, because the saved entry IS the new source; keeping
     *   the old id would make every derived patch claim to be the factory one
     *   it was tweaked from.
     * - Arp, because it is performance state and never travelled in a patch.
     * - The master effect chain, which is not this track's and not a sound.
     *
     * `tags: []` is honest, not a stub: the save form collects a name, a
     * category and a description, and inventing tags from the patch would put
     * words in the user's mouth that the browser's filter then acts on.
     */
    saveCustomPreset: (name, activeSynth, category = 'User', description = '') => {
      const newPreset: SynthPreset = {
        id: `user-preset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: name.trim() || 'Untitled Preset',
        category,
        engine: activeSynth.engine,
        patch: structuredClone(activeSynth.patch),
        tags: [],
        isFactory: false,
        createdAt: Date.now(),
        description: description.trim() || 'Custom user preset',
      };
      set((state) => ({ customSynthPresets: [newPreset, ...state.customSynthPresets] }));
      return newPreset;
    },

    deleteCustomPreset: (id) => {
      let updated: SynthPreset[] = [];
      set((state) => {
        updated = state.customSynthPresets.filter((p) => p.id !== id);
        return { customSynthPresets: updated };
      });
      return updated;
    },

    saveCustomChordProgression: (name, chords, category = 'User', description = '', roman = '') => {
      const newItem = {
        id: `chord-prog-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
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
