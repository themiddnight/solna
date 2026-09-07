import type { SynthPresetItem } from '../data/synthPresets';
import type { CustomChordProgressionItem, SequencerTrack } from '../types';
import {
  DEFAULT_LEAD_GATE,
  isLegacyLeadMelody,
  upgradeLeadMelodyToTicks,
  upgradeLeadMelodyV1,
  type LeadNote,
} from '../audio/leadMelody';
import { DEFAULT_METER_ID, isMeterId } from '../utils/meter';
import { DEFAULT_LEAD_STEP_RESOLUTION } from '../utils/stepResolution';
import { padStepRow } from '../utils/patternAdapt';
import {
  defaultPadState,
  recolourDrumTracks,
  renameDrumTrack,
  renameSoundKit,
  withDrumTracks,
} from './initialState';
import { newLoopId, LOOP_FLAT_KEYS } from './loop';

// Legacy localStorage keys written by the pre-Zustand app:
// - synth presets:   src/audio/presetRegistry.ts (STORAGE_KEY)
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
 * The traversal every per-loop persist step repeats: copy the payload, leave it
 * untouched when `loops` is not an array, and map each loop that is a plain
 * object through `fn` (anything else — null, a string, an array — passes
 * through, for sanitize to refuse). Every step below is then only its field
 * lines.
 *
 * File-local and unexported on purpose. The `.solna` chain in
 * projectFormatMigrate.ts carries its own copy of the equivalent traversal and
 * the two must NOT be merged: a project body is an external contract, the
 * persist payload is private localStorage shape, and their version numbers move
 * for different reasons (CLAUDE.md).
 */
function mapLoops<T extends object>(
  state: T,
  fn: (loop: Record<string, unknown>) => Record<string, unknown>,
): T {
  const next = { ...(state as Record<string, unknown>) };
  if (!Array.isArray(next.loops)) return next as unknown as T;
  next.loops = next.loops.map((loop) => {
    if (!loop || typeof loop !== 'object' || Array.isArray(loop)) return loop;
    return fn(loop as Record<string, unknown>);
  });
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
  return mapLoops(state, (row) => ({
    ...row,
    leadMelodyView: row.leadMelodyView ?? 'scale-locked',
    leadMelodyOctave: row.leadMelodyOctave ?? 3,
  }));
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

/**
 * v9 -> v10: lead notes gain a length and each loop gains a gate. Only the
 * loops are touched — persist `merge` writes loops[activeLoopId] over the
 * flat lead keys through loopStatePatch, so the flat mirror is rebuilt from
 * the upgraded loop. Must run BEFORE sanitizePersistedState (zustand runs
 * `migrate` before `merge`, and `merge` is where sanitize is called):
 * asLeadNoteMatrix — the guard sanitizeLoops actually reads through — returns
 * `undefined` for the v1 string shape rather than throwing, and the caller then
 * falls back to the default melody. A payload that reached sanitize
 * un-upgraded would come back blank, with no error.
 */
export function migrateLeadNoteLength<T extends object>(state: T): T {
  return mapLoops(state, (row) => ({
    ...row,
    leadMelodySteps: isLegacyLeadMelody(row.leadMelodySteps)
      ? upgradeLeadMelodyV1(row.leadMelodySteps)
      : row.leadMelodySteps,
    leadGate: typeof row.leadGate === 'number' ? row.leadGate : DEFAULT_LEAD_GATE,
  }));
}

/**
 * v10 -> v11: the lead melody widens from MAX_STEPS_PER_BAR slots a bar to
 * LEAD_TICKS_PER_BAR, `len` starts counting ticks, and every loop gains the
 * resolution it was actually authored at.
 *
 * Runs AFTER migrateLeadNoteLength, never before: that step turns a
 * pre-DEV-369 string[][] into LeadNote[][] at the narrow width, and widening
 * an un-upgraded payload would leave a shape sanitize rejects — blank
 * melody, no throw, no warning.
 *
 * Pure, but deliberately NOT a no-op on an already-widened payload: applied
 * twice it re-doubles the melody. The `version >= 11` gate in store.ts's
 * migrate is what guarantees single application. The width guard that used to
 * make this self-idempotent is exactly what mistook two OLD bars for one NEW
 * one — LEAD_TICKS_PER_BAR is 2 * MAX_STEPS_PER_BAR — so do not restore it.
 *
 * Shares only the pure transform with the .solna chain in
 * projectFormatMigrate.ts. The two must NOT be refactored into one.
 */
export function migrateLeadStepResolution<T extends object>(state: T): T {
  return mapLoops(state, (row) => {
    const bars = typeof row.leadLoopLength === 'number' ? row.leadLoopLength : 1;
    return {
      ...row,
      leadMelodySteps: Array.isArray(row.leadMelodySteps)
        ? upgradeLeadMelodyToTicks(row.leadMelodySteps as LeadNote[][], bars)
        : row.leadMelodySteps,
      leadStepResolution:
        typeof row.leadStepResolution === 'string'
          ? row.leadStepResolution
          : DEFAULT_LEAD_STEP_RESOLUTION,
    };
  });
}

/**
 * The pad/drone layer's eight per-loop fields. Every loop persisted before it
 * lacks them, and `loopStatePatch` writes each LOOP_FLAT_KEYS entry with no
 * guard — so an unbackfilled loop does not fall back to the slice defaults, it
 * writes `undefined` over them the moment it is activated.
 *
 * `padMuted` is overridden to `true` on purpose, against defaultPadState()'s
 * `false`. A new project gets an audible pad because that is the point of
 * shipping the layer; a project saved before the pad existed gets a silent one
 * because its author never wrote a pad and a reopened project must sound the
 * way it sounded when it was closed. Do not collapse these into one value —
 * the change is inaudible in review and only migrate.test.ts would catch it.
 *
 * Shares only defaultPadState() — data — with the `.solna` chain's own step in
 * projectFormatMigrate.ts. The two traversals must NOT be merged.
 */
export function migratePadLayer<T extends object>(state: T): T {
  return mapLoops(state, (row) => ({
    ...row,
    ...defaultPadState(),
    padMuted: true,
  }));
}

/**
 * v12 -> v13: every loop's sequencer gains the `lowtom` and `crash` tracks, so
 * the 30 authored tom/crash rows in DRUM_GRIDS become audible. (This step
 * shipped naming the row `tom`; Task 7 renamed the INITIAL_SEQUENCER_TRACKS
 * entry to `lowtom`, and this step tracks that name because it only ever
 * calls withDrumTracks against the current constant — see migrateDrumVoices
 * below for the one-time rename a payload that already persisted a real `tom`
 * row still needs.)
 *
 * Shares only the pure withDrumTracks transform with the .solna chain's
 * upgradeDrumTracksV5 in projectFormatMigrate.ts, and must NOT be refactored
 * into one function with it: a project body is an external contract, the
 * persist payload is private localStorage shape, and their version numbers move
 * for different reasons.
 *
 * INITIAL_SEQUENCER_TRACKS holds eleven canonical tracks. For any payload
 * this app has written, the only ones a pre-v13 loop can be missing are the
 * six that landed after it — `lowtom`, `crash`, `rimshot`, `hitom`, `ride`
 * and `bell` — and all six canonical rows are authored with an empty bar
 * (INITIAL_SEQUENCER_TRACKS.filter((t) => !t.steps.some(Boolean)) is exactly
 * those six, evaluated, not counted by hand) — so a reopened session sounds
 * exactly the way it sounded when it was closed, the same guarantee
 * migratePadLayer buys with padMuted: true.
 *
 * That is a fact about those six rows, NOT about withDrumTracks: it appends
 * ANY missing canonical track, and the other five carry factory beats (kick 4
 * active steps, snare 2, hihat 8, openhat 1, clap 2). A payload missing more
 * than those six — hand-edited, truncated, or written by a build that never
 * had the full kit — is a repair case, and it gets those factory rows back
 * audibly. Restoring a playable kit is the right answer there; silence is
 * promised only for payloads this app actually wrote.
 *
 * The top-level branch is belt-and-braces. partializeAppState does not persist
 * a top-level sequencerTracks, and wrapFlatStateIntoLoop (v5 -> v6) runs
 * earlier in the chain, so a pre-v6 flat payload is already a loop by the time
 * this sees it. A legacy or hand-written payload can still carry the key.
 */
export function migrateDrumTracks<T extends object>(state: T): T {
  const mapped = mapLoops(state, (row) => ({
    ...row,
    sequencerTracks: Array.isArray(row.sequencerTracks)
      ? withDrumTracks(row.sequencerTracks as SequencerTrack[])
      : row.sequencerTracks,
  }));
  const next = { ...(mapped as Record<string, unknown>) };
  if (Array.isArray(next.sequencerTracks)) {
    next.sequencerTracks = withDrumTracks(next.sequencerTracks as SequencerTrack[]);
  }
  return next as unknown as T;
}


/**
 * v13 -> v14: the drum kit is renamed end to end. At this commit that is two
 * shape changes over the seven-voice roster; Task 8 grows the same roster to
 * eleven and this step then also appends the four new voices, with no further
 * version bump (the slice ships together):
 *
 *   1. the `tom` track becomes `lowtom`   -> renameDrumTrack, FIRST
 *   2. loop.soundKit '909 Modern' -> 'Club Standard' -> renameSoundKit
 *   3. rimshot / hitom / ride / bell are appended -> withDrumTracks
 *   4. the seven factory colours move to bg-drum-* -> recolourDrumTracks, LAST
 *
 * renameDrumTrack runs before withDrumTracks as defence in depth, not because
 * the reverse is unsafe — see renameDrumTrack's own docblock in
 * initialState.ts: its blank-target repair branch makes the two orders
 * produce byte-identical output. recolourDrumTracks must still run after the
 * rename, since before it the row is still `tom` and keeps bg-primary.
 *
 * Shares only the three pure transforms with the .solna chain's
 * upgradeDrumVoicesV6, and must NOT be refactored into one function with it: a
 * project body is an external contract, the persist payload is private
 * localStorage shape, and their version numbers move for different reasons.
 *
 * SOUND DOES NOT CHANGE. The renamed track keeps its steps; the renamed kit is
 * the same object under a new key; a later task's appended tracks are
 * authored with an empty bar. `loops` only — partializeAppState persists no
 * top-level sequencerTracks and wrapFlatStateIntoLoop (v5 -> v6) has already
 * run.
 */
export function migrateDrumVoices<T extends object>(state: T): T {
  return mapLoops(state, (row) => {
    const rekitted = renameSoundKit(row, '909 Modern', 'Club Standard');
    if (!Array.isArray(rekitted.sequencerTracks)) return rekitted;
    const tracks = rekitted.sequencerTracks as SequencerTrack[];
    const shaped = withDrumTracks(renameDrumTrack(tracks, 'tom', 'lowtom'));
    return { ...rekitted, sequencerTracks: recolourDrumTracks(shaped) };
  });
}
