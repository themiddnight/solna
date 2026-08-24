import type { SynthPresetItem } from '../audio/synthPresets';
import type { CustomChordProgressionItem } from '../types';

// Legacy localStorage keys written by the pre-Zustand app:
// - synth presets:   src/audio/synthPresets.ts (STORAGE_KEY)
// - chord progressions: src/components/ChordPresetLibrary.tsx
export const LEGACY_SYNTH_PRESETS_KEY = 'murva_synth_custom_presets_v1';
export const LEGACY_CHORD_PROGRESSIONS_KEY = 'murva_chord_custom_progressions_v1';
export const LEGACY_PERSIST_KEY = 'murva_project_state_v1';

export interface LegacyPresetsState {
  customSynthPresets?: SynthPresetItem[];
  customChordProgressions?: CustomChordProgressionItem[];
}

function readLegacySynthPresets(): SynthPresetItem[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_SYNTH_PRESETS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readLegacyChordProgressions(): CustomChordProgressionItem[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_CHORD_PROGRESSIONS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Adopt the two legacy localStorage keys into the persisted state. Merges only
 * when the target array is still empty, so already-persisted presets win.
 * Every localStorage access is try/catch-guarded (SSR/test environments and
 * restricted browser contexts).
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
