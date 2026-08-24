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

/**
 * v2 → v3: sequencer track colours were raw Tailwind palette classes
 * (`bg-rose-500`, …) baked into persisted state, so a saved project kept
 * dark-theme-only colours after the daisyUI token migration. Remap them onto
 * the semantic ramps; unknown values are left untouched.
 */
export const LEGACY_TRACK_COLOR_MAP: Record<string, string> = {
  'bg-rose-500': 'bg-error', // theme-guard-ignore: persisted legacy user data lookup key, not a className
  'bg-amber-500': 'bg-warning', // theme-guard-ignore: persisted legacy user data lookup key, not a className
  'bg-emerald-500': 'bg-success', // theme-guard-ignore: persisted legacy user data lookup key, not a className
  'bg-cyan-500': 'bg-accent', // theme-guard-ignore: persisted legacy user data lookup key, not a className
  'bg-purple-500': 'bg-secondary', // theme-guard-ignore: persisted legacy user data lookup key, not a className
};

export function migrateTrackColors<T extends object>(state: T): T {
  const tracks = (state as { sequencerTracks?: unknown }).sequencerTracks;
  if (!Array.isArray(tracks)) return state;

  return {
    ...state,
    sequencerTracks: tracks.map((t) => {
      if (!t || typeof t !== 'object') return t;
      const color = (t as { color?: unknown }).color;
      if (typeof color !== 'string') return t;
      if (!Object.hasOwn(LEGACY_TRACK_COLOR_MAP, color)) return t;
      const next = LEGACY_TRACK_COLOR_MAP[color];
      return next ? { ...(t as object), color: next } : t;
    }),
  };
}
