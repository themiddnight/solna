import type { SynthPresetItem } from '../audio/synthPresets';
import type { CustomChordProgressionItem } from '../types';
import { DEFAULT_METER_ID, isMeterId } from '../utils/meter';
import { padStepRow } from '../utils/patternAdapt';
import { newLoopId, LOOP_FLAT_KEYS } from './loop';

// Legacy localStorage keys written by the pre-Zustand app:
// - synth presets:   src/audio/synthPresets.ts (STORAGE_KEY)
// - chord progressions: src/components/loop/ChordPresetLibrary.tsx
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

/**
 * v3 → v4: the project concept (title, modal, templates) is gone, and the
 * Instant Vibes bar's highlight — which used to be derived by string-matching
 * the persisted `projectTitle` against each vibe's own title — is now real
 * state. Old titles are deliberately NOT mapped back to vibe ids: the
 * highlight simply clears once and self-heals on the next vibe click.
 */
export function migrateProjectTitleToVibeId<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) };
  delete next.projectTitle;
  if (!('selectedVibeId' in next)) next.selectedVibeId = null;
  return next as unknown as T;
}

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

/**
 * v4 -> v5: meter support.
 *
 * 1. Sequencer step arrays are now ALWAYS stored at MAX_STEPS_PER_BAR (24), so
 *    switching meter windows the user's programming instead of destroying it.
 *    Legacy 16-length rows are padded with silence.
 * 2. `meterId` defaults to '4/4'. An unknown or wrong-typed value is replaced
 *    rather than preserved — it feeds the clock, and getMeter's own fallback
 *    should never have to fire on a payload we already own.
 *
 * Pure and non-mutating, like its three siblings above.
 */
export function migrateMeterAndStepWidth<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) };

  if (!isMeterId(next.meterId)) next.meterId = DEFAULT_METER_ID;

  const tracks = next.sequencerTracks;
  if (Array.isArray(tracks)) {
    next.sequencerTracks = tracks.map((track) => {
      if (!track || typeof track !== 'object') return track;
      const steps = (track as { steps?: unknown }).steps;
      if (!Array.isArray(steps)) return track;
      return { ...(track as object), steps: padStepRow(steps as boolean[]) };
    });
  }

  return next as unknown as T;
}

/**
 * v5 -> v6: the single-loop wrap. The flat per-loop fields become the
 * first loop; the global fields stay top-level. Runs at the END of the
 * migrate chain for every version < 6, after the v1->v5 chain has normalised
 * older payloads to the v5 flat shape — so it only ever sees the current flat
 * layout. Pure and non-mutating, like its four siblings above.
 */
export function wrapFlatStateIntoLoop<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) } as Record<string, unknown>;
  const loop: Record<string, unknown> = {
    id: newLoopId(),
    name: 'Loop 1',
  };
  for (const key of LOOP_FLAT_KEYS) {
    if (key in next) loop[key] = next[key];
  }
  next.loops = [loop];
  next.activeLoopId = loop.id;
  for (const key of LOOP_FLAT_KEYS) delete next[key];
  return next as unknown as T;
}

/**
 * v6 -> v7: rename the two historical persisted keys (`regions` /
 * `activeRegionId`) to the loop shape (`loops` / `activeLoopId`). Runs LAST in
 * the migrate chain for every version < 7, after the v5->v6 wrap has already
 * normalised older payloads to the loop shape — for those the rename is a
 * no-op. Pure and non-mutating, like its siblings.
 */
export function renameRegionKeysToLoop<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) } as Record<string, unknown>;
  if ('regions' in next) {
    next.loops = next.regions;
    delete next.regions;
  }
  if ('activeRegionId' in next) {
    next.activeLoopId = next.activeRegionId;
    delete next.activeRegionId;
  }
  return next as unknown as T;
}

/**
 * v7 -> v8: the lead melody's octave window and view mode became per-loop
 * fields. Every loop persisted before v8 lacks them, and `loadLoop` writes the
 * patch verbatim — so without this backfill activating an old loop would set
 * `leadMelodyOctave` to undefined and `leadPitchRows` would build its window
 * from NaN. Backfills the slice defaults. Runs after the v5->v6 wrap and the
 * v6->v7 rename, so `loops` is always the current key by the time it sees the
 * payload. Pure and non-mutating, like its siblings.
 */
export function backfillLeadWindow<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) } as Record<string, unknown>;
  if (!Array.isArray(next.loops)) return next as unknown as T;
  next.loops = next.loops.map((loop) => {
    if (!loop || typeof loop !== 'object') return loop;
    const row = loop as Record<string, unknown>;
    return {
      ...row,
      leadMelodyView: row.leadMelodyView ?? 'scale-locked',
      leadMelodyOctave: row.leadMelodyOctave ?? 3,
    };
  });
  return next as unknown as T;
}

/**
 * v8 -> v9: the working buffer carries the project identity (which stored
 * project the session belongs to) and the dirty baseline fingerprint, so a
 * killed tab comes back knowing which project was open. Both default to null.
 */
export function migrateAddProjectIdentity<T extends object>(state: T): T {
  const next = { ...(state as Record<string, unknown>) };
  if (!('currentProjectId' in next)) next.currentProjectId = null;
  if (!('projectBaselineHash' in next)) next.projectBaselineHash = null;
  return next as unknown as T;
}
