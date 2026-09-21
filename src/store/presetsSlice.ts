import type { StoreApi } from 'zustand';
import { beatPatchOf } from './beatPresets';
import type { SynthPreset } from '../data/synthPresets';
import type { AppStore, PresetsSlice } from './types';
import type { BeatPatch, BeatPreset } from '@/types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Soft cap on each user library array. A cap is a validation-time guard, not
 * a persisted-shape migration (ADR-0023: "no migration chains") — it simply
 * bounds what a save action writes going forward; it never reads or repairs
 * an existing over-cap array on load.
 */
export const MAX_LIBRARY_ENTRIES = 200;

/**
 * Presets slice: the user's custom synth presets, chord progressions and Beat
 * presets, persisted app-level in localStorage (replacing the old per-key
 * writes — see migrate.ts for the one-time adoption of those legacy keys).
 * None of the three is project content: a library travels with the browser,
 * and every project carries its own complete sounds.
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
    customBeatPresets: [],

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
      set((state) => ({
        customSynthPresets: [newPreset, ...state.customSynthPresets].slice(0, MAX_LIBRARY_ENTRIES),
      }));
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
        ].slice(0, MAX_LIBRARY_ENTRIES),
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

    /**
     * Quick Save: the current Beat patch becomes a named user preset AND the
     * loop's new base, without the sound changing by a single field.
     *
     * Three things follow the synth library's rules for the same reasons.
     * The patch is a `structuredClone`, so the next knob edit cannot write
     * back into the library entry. `basePresetId` is DROPPED rather than
     * copied: a preset is a source, and keeping the id it was derived from
     * would make every saved sound go on claiming the factory one behind it.
     * And `origin: 'user'` is stated, never inherited — a library entry the
     * user authored must never read back as factory content.
     *
     * The base then moves onto this entry, and that id is the ONLY field of
     * `beatParams` a save writes — the live params are not re-written from
     * `params`, so a save cannot change the sound even if a caller hands in
     * something other than what the loop is currently holding.
     */
    saveCustomBeatPreset: (name, params) => {
      const patch: BeatPatch = structuredClone(beatPatchOf(params));
      const preset: BeatPreset = {
        id: `user-beat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: name.trim() || 'Untitled Beat',
        origin: 'user',
        patch,
      };
      set((state) => ({
        customBeatPresets: [preset, ...state.customBeatPresets].slice(0, MAX_LIBRARY_ENTRIES),
        // ONE FIELD of the live params, never a patch written back over them.
        // This is what makes "saving does not change the sound" structural
        // rather than a coincidence of the caller having passed the live
        // object: whatever `state.beatParams` holds is what it goes on
        // holding, and the only thing that moves is where it says it came
        // from. It also means the loop and the library entry can never share
        // an object — nothing from `patch` is written into state at all.
        beatParams: { ...state.beatParams, basePresetId: preset.id },
      }));
      return preset;
    },

    /**
     * A library edit and nothing more. No loop is touched: every project
     * stores a COMPLETE `beatParams`, so a loop built on this preset keeps
     * sounding exactly as it did and simply stops being able to resolve its
     * base — which `resetBeatVoice`/`resetBeatParams` already read as "no
     * answer, change nothing".
     */
    deleteCustomBeatPreset: (id) => {
      let updated: BeatPreset[] = [];
      set((state) => {
        updated = state.customBeatPresets.filter((p) => p.id !== id);
        return { customBeatPresets: updated };
      });
      return updated;
    },
  };
}
