import { create } from 'zustand';
import type { StoreApi } from 'zustand';
import { persist, subscribeWithSelector, createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { createTransportSlice } from './transportSlice';
import { createMusicContextSlice } from './musicContextSlice';
import { createSynthSlice } from './synthSlice';
import { createChordsSlice } from './chordsSlice';
import { createBassSlice } from './bassSlice';
import { createPadSlice } from './padSlice';
import { createLeadSlice } from './leadSlice';
import { createSequencerSlice } from './sequencerSlice';
import { createEffectsSlice } from './effectsSlice';
import { createUiSlice } from './uiSlice';
import { createPresetsSlice } from './presetsSlice';
import { createLoopSlice } from './loopSlice';
import { DEFAULT_LEAD_GATE } from '../audio/leadMelody';
import { DEFAULT_LEAD_STEP_RESOLUTION } from '../utils/stepResolution';
import { migrateLegacyPresets, removeLegacyKeys, LEGACY_PERSIST_KEY } from './migrate';
import { asFaderDb, DEFAULT_BUS_TRIM_DB, DEFAULT_FADER_DB } from './levelUnits';
import { loopStatePatch, resolveActiveLoop } from './loop';
import { createLoopMirroringSet } from './loopSync';
import { PROJECT_DB_LEVEL_KEYS } from './projectFormat';
import { createProjectSlice } from './projectSlice';
import { createDirtyTracker } from './projectDirty';
import { createProjectStore } from './projectStore';
import { openIndexedDbBackend } from './projectStoreIdb';
import { isMeterId } from '../utils/meter';
import { createCoalescedStorage } from '../utils/coalescedStorage';
import type { AppStore, PersistedState, Loop } from './types';
import {
  sanitizeSynthParams,
  sanitizeEffectsValue,
  sanitizeLoops,
  asLeadStepResolution,
  clampFinite,
  asBoolean,
  asNullableString,
  isPatternMode,
  asFilterType,
  isPositiveInteger,
  asLeadNoteMatrix,
  sanitizeSequencerTracks,
  isChordItem,
  isBassStepChoice,
  isRootNote,
  isScaleType,
  isChordRhythmId,
  isBassPatternId,
  asSoundKit,
} from './sanitize';
import { INITIAL_SEQUENCER_TRACKS } from './initialState';

export const PERSIST_KEY = 'musibox_project_state_v1';

/**
 * The current persist `version`, stamped on every write.
 *
 * DEV-388 deleted the 15-step `if (version < N)` migration chain that used to
 * live in `migrate:` below (see CLAUDE.md: solna has no real users yet, so a
 * per-version upgrade chain was machinery maintained for nobody). What
 * replaced it is VALIDATION, not migration: `merge` below runs every
 * hydrated payload through `sanitizePersistedState` / `sanitizeLoops`
 * regardless of what version wrote it. Those functions decide per KEY
 * whether a value is trustworthy — in range, correctly typed, a member of
 * its allowed set — never per payload version. A value that reads oddly
 * because it predates a unit change (a fader stored as linear gain before
 * DEV-386, say) is NOT reconstructed: once both the old and the new unit are
 * "a number in range", nothing about the value itself says which one wrote
 * it, so guessing would be exactly the silent-wrong-answer trap this
 * boundary exists to avoid. A developer who hits a stale value like that
 * adjusts it by hand — there is no session left to protect.
 *
 * `PERSIST_VERSION` still exists and is still stamped into every persisted
 * payload — it is the murva-facing format marker — but it now drives NO
 * read-time decision. `migrate:` below is an identity pass-through, kept
 * (not removed) because zustand's persist middleware requires SOME `migrate`
 * function whenever a stored `version` differs from this one: without one it
 * logs `console.error` and then THROWS destructuring the migration result
 * (`node_modules/zustand/esm/middleware.mjs`, confirmed by reading it, not
 * assumed). A future per-key validation rule must never be written as a
 * comparison against this constant, for the same reason the old chain's
 * guards were frozen literals: `PERSIST_VERSION` is where the app is now,
 * not a fact about any stored payload.
 */
export const PERSIST_VERSION = 19;

/** One project store per tab; opened lazily on the first Project Manager call. */
export const projectStore = createProjectStore(openIndexedDbBackend);

// Fallback when localStorage is unavailable (SSR, tests, restricted
// contexts): an in-memory stub keeps the persist middleware functional so the
// app still runs, it just doesn't survive a reload.
const memoryStorage: StateStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (name) => store.get(name) ?? (name === PERSIST_KEY ? (store.get(LEGACY_PERSIST_KEY) ?? null) : null),
    setItem: (name, value) => {
      store.set(name, value);
    },
    removeItem: (name) => {
      store.delete(name);
    },
  };
})();

function resolveStorage(): StateStorage | null {
  const getRawStorage = (): Storage | null => {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch {
      // ignore
    }
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch {
      // ignore
    }
    return null;
  };

  const raw = getRawStorage();
  if (!raw) return null;

  return {
    getItem: (name: string) => {
      try {
        const val = raw.getItem(name);
        if (val !== null) return val;
        if (name === PERSIST_KEY) {
          return raw.getItem(LEGACY_PERSIST_KEY);
        }
        return null;
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: string) => {
      try {
        raw.setItem(name, value);
      } catch {
        // ignore
      }
    },
    removeItem: (name: string) => {
      try {
        raw.removeItem(name);
      } catch {
        // ignore
      }
    },
  };
}

/**
 * The persist storage. `resolveStorage()` may legitimately return null (no
 * localStorage at all) and its setItem already swallows throws; the in-memory
 * fallback keeps persist functional either way. The coalescer sits BELOW
 * partialize and createJSONStorage, so it only ever sees an already-serialised
 * string and cannot change WHAT is persisted — only how often it is written.
 */
const persistStorage = createCoalescedStorage(resolveStorage() ?? memoryStorage);

/**
 * Force every buffered persist write out to storage now. Called on pagehide and
 * on the hidden transition so closing or backgrounding a tab can never lose
 * state, and exported so tests can assert on storage right after a write.
 */
export function flushPersistedWrites(): void {
  persistStorage.flush();
}

// Captured during store creation so the persist onRehydrateStorage callback
// (which runs synchronously inside create(), while the `useAppStore` binding
// is still in its temporal dead zone) can still reach the store api.
let storeApi: StoreApi<AppStore> | undefined;

// Explicit allow-list: the nine global fields plus the loops arrangement.
// Every per-loop musical field lives inside `loops`; the flat copies in the
// live state are intentionally NOT persisted (they are the working copy of the
// active loop and are kept in sync by loopSync's live-write subscription).
export function partializeAppState(state: AppStore): PersistedState {
  return {
    bpm: state.bpm,
    meterId: state.meterId,
    masterVolume: state.masterVolume,
    metronomeActive: state.metronomeActive,
    selectedVibeId: state.selectedVibeId,
    controlTarget: state.controlTarget,
    effects: state.effects,
    customSynthPresets: state.customSynthPresets,
    customChordProgressions: state.customChordProgressions,
    loops: state.loops,
    activeLoopId: state.activeLoopId,
    currentProjectId: state.currentProjectId,
    projectBaselineHash: state.projectBaselineHash,
  };
}

/**
 * Validates the flat top-level `sequencerTracks` key (a pre-loop-wrap shape
 * sanitizeLoops never sees). Extracted out of sanitizePersistedState purely to
 * keep that function's cyclomatic complexity under the repo ceiling. The
 * per-row-drop reasoning (why an unrecognised instrument is dropped, not
 * defaulted, and why that does not shorten anything else) lives on
 * `sanitizeSequencerTracks` in sanitize.ts, which this reuses so the flat and
 * `loops[]` paths cannot drift.
 */
function sanitizeFlatSequencerTracks(sanitized: Record<string, unknown>): void {
  if (!Array.isArray(sanitized.sequencerTracks)) return;
  sanitized.sequencerTracks = sanitizeSequencerTracks(
    sanitized.sequencerTracks,
    INITIAL_SEQUENCER_TRACKS,
  );
}

/**
 * ELEMENT-checks the flat top-level `chords` / `customChordRhythm` /
 * `customBassPattern` keys (a pre-loop-wrap shape sanitizeLoops never sees).
 * Extracted out of sanitizePersistedState purely to keep that function's
 * cyclomatic complexity under the repo ceiling, same as
 * sanitizeFlatSequencerTracks above. Before DEV-388 these keys only reached
 * the top-level slices AFTER wrapFlatStateIntoLoop wrapped them into
 * `loops[0]` and sanitizeLoops validated each element (`isChordItem` /
 * `isBassStepChoice`); with that wrap deleted, a bare `Array.isArray` check
 * would let `{"chords": [1, 2, 3]}` reach the chord scheduler, which
 * isChordItem's own docblock (sanitize.ts) says is a crash, not a wrong
 * sound. All-or-nothing per key (not per-element) on purpose: these are
 * ordered sequences, the same reasoning asCheckedArray's docblock gives for
 * sanitizeLoops' own `chords`/`customChordRhythm`/`customBassPattern` checks
 * — unlike `sequencerTracks`, a set keyed by instrument, which drops per row
 * instead (see sanitizeSequencerTracks).
 */
function sanitizeFlatOrderedArrays(sanitized: Record<string, unknown>): void {
  if (Array.isArray(sanitized.chords) && !sanitized.chords.every(isChordItem)) {
    delete sanitized.chords;
  }
  if (
    Array.isArray(sanitized.customChordRhythm) &&
    !sanitized.customChordRhythm.every((v) => typeof v === 'boolean')
  ) {
    delete sanitized.customChordRhythm;
  }
  if (
    Array.isArray(sanitized.customBassPattern) &&
    !sanitized.customBassPattern.every(isBassStepChoice)
  ) {
    delete sanitized.customBassPattern;
  }
}

/**
 * Type-guards the parsed persist payload before it reaches the merge. ONLY the
 * keys listed here are checked — everything else in the payload passes through
 * unchanged, so a key added to partialize gets no validation until it is added
 * here too. The per-value rules live in sanitize.ts, shared with the `.solna`
 * import path (projectFile.ts) so the two readers cannot drift.
 */
/**
 * The five persisted keys that must name a real library entry, not just
 * satisfy a bare `typeof` — grouped here so `sanitizePersistedState` states
 * this as one cohesive job instead of five branches of unrelated shape (this
 * grouping is what took the function's complexity back under the eslint
 * ceiling after these five checks were added one at a time). See the
 * matching `is*`/`as*` guards' docblocks in sanitize.ts for why a bare
 * `typeof` check is not enough (the deleted kit-rename migration step).
 */
function sanitizeEnumeratedFields(sanitized: Record<string, unknown>): void {
  sanitized.soundKit = asSoundKit(sanitized.soundKit, 'Retro Drive');
  if (!isRootNote(sanitized.scaleRoot)) delete sanitized.scaleRoot;
  if (!isScaleType(sanitized.scaleType)) delete sanitized.scaleType;
  if (!isChordRhythmId(sanitized.chordRhythmId)) delete sanitized.chordRhythmId;
  if (!isBassPatternId(sanitized.bassPatternId)) delete sanitized.bassPatternId;
}

function sanitizePersistedState(persisted: unknown): Partial<AppStore> {
  if (typeof persisted !== 'object' || persisted === null) return {};
  const sanitized = { ...(persisted as Record<string, unknown>) };

  sanitized.bpm = clampFinite(sanitized.bpm, 20, 300, 120);
  // Driven off the format's own list, not repeated by hand: the hand-written repeat
  // this replaces silently omitted `padVolume`, so a corrupt stored value reached
  // faderDbToGain unvalidated and that function fails SAFE TO SILENCE — a muted pad
  // bus instead of the default every other fader got. `masterVolume` is the one key
  // here that is not a source bus, so it keeps asFaderDb's own UNITY default; the
  // five source buses default to the measured headroom trim (DEV-383).
  for (const key of PROJECT_DB_LEVEL_KEYS) {
    sanitized[key] = asFaderDb(
      sanitized[key],
      key === 'masterVolume' ? DEFAULT_FADER_DB : DEFAULT_BUS_TRIM_DB,
    );
  }
  sanitized.drumFilterCutoff = clampFinite(sanitized.drumFilterCutoff, 50, 12000, 12000);
  sanitized.drumFilterResonance = clampFinite(sanitized.drumFilterResonance, 0.1, 20, 0.7);
  sanitized.leadGate = clampFinite(sanitized.leadGate, 0.05, 1, DEFAULT_LEAD_GATE);
  sanitized.leadStepResolution = asLeadStepResolution(
    sanitized.leadStepResolution,
    DEFAULT_LEAD_STEP_RESOLUTION,
  );
  sanitized.drumFilterType = asFilterType(sanitized.drumFilterType, 'lowpass');
  sanitized.metronomeActive = asBoolean(sanitized.metronomeActive);
  sanitized.synthMuted = asBoolean(sanitized.synthMuted);
  sanitized.chordMuted = asBoolean(sanitized.chordMuted);
  sanitized.bassMuted = asBoolean(sanitized.bassMuted);
  sanitized.drumMuted = asBoolean(sanitized.drumMuted);
  sanitized.effects = sanitizeEffectsValue(sanitized.effects);

  // Arrays and free-form strings: drop invalid values so the currentState
  // defaults win in the merge spread below.
  for (const key of ['chords', 'sequencerTracks', 'customSynthPresets', 'customChordProgressions', 'customChordRhythm', 'customBassPattern']) {
    if (!Array.isArray(sanitized[key])) delete sanitized[key];
  }
  sanitizeFlatOrderedArrays(sanitized);
  // Like the five bus faders above: a garbage per-track `volume` must clamp
  // to a fader value, not reach faderDbToGain unclamped — that function fails
  // SAFE TO SILENCE (any non-finite or out-of-range-low input maps to 0 gain),
  // so a corrupted number here would otherwise mute a drum track with no
  // error rather than defaulting to unity like every other level key does.
  sanitizeFlatSequencerTracks(sanitized);
  sanitizeEnumeratedFields(sanitized);
  for (const key of ['chordRhythmMode', 'bassPatternMode']) {
    if (!isPatternMode(sanitized[key])) delete sanitized[key];
  }
  // Coerced, not merely checked: one fractional `len` must not cost the
  // session its whole melody (see asLeadNoteMatrix).
  const melody = asLeadNoteMatrix(sanitized.leadMelodySteps);
  if (melody) sanitized.leadMelodySteps = melody;
  else delete sanitized.leadMelodySteps;
  if (!isPositiveInteger(sanitized.leadLoopLength)) {
    delete sanitized.leadLoopLength;
  }
  if (typeof sanitized.selectedVibeId !== 'string' && sanitized.selectedVibeId !== null) {
    delete sanitized.selectedVibeId;
  }
  if (!isMeterId(sanitized.meterId)) delete sanitized.meterId;

  // Only rewrite the synth param objects that were actually stored; an absent
  // key must keep falling through to the freshly-built currentState default.
  for (const key of ['synthParams', 'chordSynthParams', 'bassSynthParams', 'padSynthParams']) {
    if (key in sanitized) sanitized[key] = sanitizeSynthParams(sanitized[key]);
  }

  // v7: loops + activeLoopId. A valid loops array also pins
  // activeLoopId to an existing loop (else the first); a missing/invalid
  // array drops both keys so the currentState defaults win in the merge.
  const loops = sanitizeLoops(sanitized.loops);
  if (loops) {
    sanitized.loops = loops;
    if (
      typeof sanitized.activeLoopId !== 'string' ||
      !loops.some((r) => r.id === sanitized.activeLoopId)
    ) {
      sanitized.activeLoopId = loops[0].id;
    }
  } else {
    delete sanitized.loops;
    delete sanitized.activeLoopId;
  }

  sanitized.currentProjectId = asNullableString(sanitized.currentProjectId);
  sanitized.projectBaselineHash = asNullableString(sanitized.projectBaselineHash);

  return sanitized as unknown as Partial<AppStore>;
}

export const useAppStore = create<AppStore>()(
  persist(
    subscribeWithSelector((set, get, api) => {
      storeApi = api;
      // Every slice writes through a `set` that carries the loops[] mirror in
      // the SAME state update — see loopSync.ts. This replaced a second,
      // independent setState that doubled persist writes and render waves on
      // every per-loop edit.
      const setWithLoopMirror = createLoopMirroringSet(set, get);
      return {
        ...createTransportSlice(setWithLoopMirror, get),
        ...createMusicContextSlice(setWithLoopMirror),
        ...createSynthSlice(setWithLoopMirror),
        ...createChordsSlice(setWithLoopMirror),
        ...createBassSlice(setWithLoopMirror),
        ...createPadSlice(setWithLoopMirror),
        ...createLeadSlice(setWithLoopMirror, get),
        ...createSequencerSlice(setWithLoopMirror),
        ...createEffectsSlice(setWithLoopMirror),
        ...createUiSlice(setWithLoopMirror),
        ...createPresetsSlice(setWithLoopMirror),
        ...createLoopSlice(setWithLoopMirror, get),
        ...createProjectSlice(setWithLoopMirror, get, projectStore),
      };
    }),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage<PersistedState>(() => persistStorage),
      partialize: partializeAppState,
      // The only remaining transform: adopt the legacy localStorage presets
      // (still live, still called from HERE rather than from a chain — see
      // migrateLegacyPresets' own docblock in migrate.ts). Everything else is
      // an identity pass-through; see PERSIST_VERSION's docblock above for
      // why `migrate` is kept rather than removed, and why no per-version
      // guard replaces the deleted chain. `version` is intentionally unused.
      migrate: (persisted) =>
        migrateLegacyPresets((persisted ?? {}) as Partial<PersistedState>) as PersistedState,
      // Runs on every hydration (also when nothing was stored): sanitize the
      // parsed payload (wrong-typed persisted values must never reach the
      // engine), adopt any legacy presets into the freshly-built state, then
      // drop the legacy keys once the merged state has been written under the
      // new key.
      merge: (persistedState, currentState) => {
        const sanitized = sanitizePersistedState(persistedState);
        const base = { ...currentState, ...sanitized };
        const withPresets = { ...base, ...migrateLegacyPresets(base as Partial<PersistedState>) };
        // Load loops[activeLoopId] into the flat slices LAST, so the loop's
        // fields win over any stale top-level per-loop keys a legacy payload
        // still carries. Guarded on the SANITIZED payload having `loops`: a
        // pre-loop-wrap flat payload has none (DEV-388 deleted the chain step
        // that used to wrap one into `loops[0]`), so its flat keys simply
        // hydrate the top-level slices directly and never gain a loop mirror.
        const loops = sanitized.loops as Loop[] | undefined;
        if (Array.isArray(loops) && loops.length > 0) {
          const active = resolveActiveLoop(
            loops,
            typeof sanitized.activeLoopId === 'string' ? sanitized.activeLoopId : null,
          );
          return { ...withPresets, loops, activeLoopId: active.id, ...loopStatePatch(active) };
        }
        return withPresets;
      },
      // Post-hydration: the merged state (legacy presets adopted by `merge`
      // above) must be written under the new persist key before the legacy
      // keys are dropped. On the fresh/no-data path zustand would otherwise
      // not write anything until the next state change, and the legacy data
      // would already be gone.
      onRehydrateStorage: () => (_state, error) => {
        if (error) return;
        storeApi?.setState({});
        removeLegacyKeys();
      },
    }
  )
);

/** Idle-debounced dirty detection — see projectDirty.ts. Started once per tab. */
export const dirtyTracker = createDirtyTracker(useAppStore);

// The boot pass. persist hydration is SYNCHRONOUS inside create() above (a
// sync StateStorage resolves through zustand's toThenable without yielding),
// so it has already restored the content keys before this tracker existed and
// its subscription never sees them. Without this one scheduled pass a reloaded
// session carrying unsaved work reports `dirty: false` — no badge, and no
// dirty guard on Open / Import / New, which is exactly the tab-killed case the
// dirty flag exists for. Scheduled, not run now, so launch pays nothing.
dirtyTracker.schedule();

/**
 * The buffered persist write goes out on the way to hidden. The dirty pass is
 * forced first only so the badge and the guard are honest for whatever runs
 * next in this tab — `dirty` is transient (not in partialize), so this is not
 * about what gets persisted.
 */
export function flushBeforeHide(): void {
  dirtyTracker.runNow();
  flushPersistedWrites();
}

// `pagehide` (not `beforeunload`) is the event that actually fires on iOS
// Safari and on bfcache navigations; `visibilitychange` covers a tab that is
// backgrounded and then killed by the OS without ever firing pagehide.
try {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', flushBeforeHide);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushBeforeHide();
    });
  }
} catch {
  // ignore — a restricted embedding context may deny even addEventListener
}
