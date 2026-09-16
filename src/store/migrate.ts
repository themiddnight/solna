import type { SynthPreset } from '../data/synthPresets';
import type { CustomChordProgressionItem } from '../types';
import { sanitizeCustomChordProgressions, sanitizeCustomSynthPresets } from './sanitize';

// Legacy localStorage keys written by the pre-Zustand app:
// - synth presets:   the preset registry that preceded src/utils/synthPresets.ts (STORAGE_KEY)
// - chord progressions: src/components/loop/ChordPresetLibrary.tsx
export const LEGACY_SYNTH_PRESETS_KEY = 'murva_synth_custom_presets_v1';
export const LEGACY_CHORD_PROGRESSIONS_KEY = 'murva_chord_custom_progressions_v1';
export const LEGACY_PERSIST_KEY = 'murva_project_state_v1';

export interface LegacyPresetsState {
  customSynthPresets?: SynthPreset[];
  customChordProgressions?: CustomChordProgressionItem[];
}

/**
 * Validated here rather than by `merge`'s `sanitizePersistedState`, because
 * adoption runs AFTER that pass: a legacy entry read straight through would be
 * the one custom preset in the app that never met the validator. Every entry
 * in this key predates the engine cutover unless the user re-saved it, so in
 * practice this is where the pre-cutover flat patch bodies are dropped.
 *
 * `null` still means "nothing to adopt" and an emptied array still means
 * "there was a key, and none of it survived" — the caller only replaces an
 * empty target, so the difference does not change what it does, but it keeps
 * "key absent" and "key unreadable" distinguishable here.
 */
function readLegacySynthPresets(): SynthPreset[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_SYNTH_PRESETS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sanitizeCustomSynthPresets(parsed) : null;
  } catch {
    return null;
  }
}

function readLegacyChordProgressions(): CustomChordProgressionItem[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_CHORD_PROGRESSIONS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Same real read as readLegacySynthPresets, above, and for the same
    // reason: this runs AFTER sanitizePersistedState (see store.ts's `merge`),
    // so an unvalidated legacy entry would be the one chord progression in
    // the app that never met a chord-quality/root check before reaching
    // resolveChordNotes.
    return Array.isArray(parsed) ? sanitizeCustomChordProgressions(parsed) : null;
  } catch {
    return null;
  }
}

/**
 * Adopt the two legacy localStorage keys into the persisted state. Merges only
 * when the target array is still empty, so already-persisted presets win.
 * Every localStorage access is try/catch-guarded (SSR/test environments and
 * restricted browser contexts).
 *
 * This is the ONE function DEV-388 kept from what used to be a 15-step
 * per-version migration chain (see store.ts's PERSIST_VERSION docblock for
 * why the rest was deleted rather than replaced). It survives because it is
 * not version machinery at all — it reads from a DIFFERENT, pre-Zustand
 * localStorage key that never carried a persist `version`, and is called
 * directly from store.ts's `migrate` and `merge`, not from a chain.
 */
export function migrateLegacyPresets<T extends LegacyPresetsState>(state: T): T {
  const result = { ...state };

  if (!result.customSynthPresets || result.customSynthPresets.length === 0) {
    const legacy = readLegacySynthPresets();
    if (legacy) {
      result.customSynthPresets = legacy;
    }
  }

  if (!result.customChordProgressions || result.customChordProgressions.length === 0) {
    const legacy = readLegacyChordProgressions();
    if (legacy) {
      result.customChordProgressions = legacy;
    }
  }

  return result;
}

/**
 * Remove the legacy localStorage keys. Called only after rehydration has
 * written the merged state under the new persist key.
 */
export function removeLegacyKeys(): void {
  try {
    localStorage.removeItem(LEGACY_SYNTH_PRESETS_KEY);
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(LEGACY_CHORD_PROGRESSIONS_KEY);
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(LEGACY_PERSIST_KEY);
  } catch {
    // ignore
  }
}
