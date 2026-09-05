import { create } from 'zustand';
import type { StoreApi } from 'zustand';
import { persist, subscribeWithSelector, createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { createTransportSlice } from './transportSlice';
import { createMusicContextSlice } from './musicContextSlice';
import { createSynthSlice } from './synthSlice';
import { createChordsSlice } from './chordsSlice';
import { createBassSlice } from './bassSlice';
import { createLeadSlice } from './leadSlice';
import { createSequencerSlice } from './sequencerSlice';
import { createEffectsSlice } from './effectsSlice';
import { createUiSlice } from './uiSlice';
import { createPresetsSlice } from './presetsSlice';
import { createLoopSlice } from './loopSlice';
import { DEFAULT_LEAD_GATE } from '../audio/leadMelody';
import { DEFAULT_LEAD_STEP_RESOLUTION } from '../utils/stepResolution';
import {
  migrateLegacyPresets,
  migrateProjectTitleToVibeId,
  migrateTrackColors,
  migrateMeterAndStepWidth,
  wrapFlatStateIntoLoop,
  renameRegionKeysToLoop,
  backfillLeadWindow,
  migrateAddProjectIdentity,
  migrateLeadNoteLength,
  migrateLeadStepResolution,
  removeLegacyKeys,
  LEGACY_PERSIST_KEY,
} from './migrate';
import { loopStatePatch, resolveActiveLoop } from './loop';
import { createLoopMirroringSet } from './loopSync';
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
  asString,
  asNullableString,
  isPatternMode,
  asFilterType,
  isPositiveInteger,
  asLeadNoteMatrix,
} from './sanitize';

export const PERSIST_KEY = 'musibox_project_state_v1';

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
 * Type-guards the parsed persist payload before it reaches the merge. ONLY the
 * keys listed here are checked — everything else in the payload passes through
 * unchanged, so a key added to partialize gets no validation until it is added
 * here too. The per-value rules live in sanitize.ts, shared with the `.solna`
 * import path (projectFile.ts) so the two readers cannot drift.
 */
function sanitizePersistedState(persisted: unknown): Partial<AppStore> {
  if (typeof persisted !== 'object' || persisted === null) return {};
  const sanitized = { ...(persisted as Record<string, unknown>) };

  sanitized.bpm = clampFinite(sanitized.bpm, 20, 300, 120);
  sanitized.masterVolume = clampFinite(sanitized.masterVolume, 0, 1, 0.85);
  sanitized.synthVolume = clampFinite(sanitized.synthVolume, 0, 1.5, 1.0);
  sanitized.chordVolume = clampFinite(sanitized.chordVolume, 0, 1.5, 1.0);
  sanitized.bassVolume = clampFinite(sanitized.bassVolume, 0, 1.5, 1.0);
  sanitized.masterSequencerVolume = clampFinite(sanitized.masterSequencerVolume, 0, 1, 0.8);
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
  sanitized.soundKit = asString(sanitized.soundKit, 'Retro Drive');
  sanitized.effects = sanitizeEffectsValue(sanitized.effects);

  // Arrays and free-form strings: drop invalid values so the currentState
  // defaults win in the merge spread below.
  for (const key of ['chords', 'sequencerTracks', 'customSynthPresets', 'customChordProgressions', 'customChordRhythm', 'customBassPattern']) {
    if (!Array.isArray(sanitized[key])) delete sanitized[key];
  }
  for (const key of ['scaleRoot', 'scaleType', 'chordRhythmId', 'bassPatternId']) {
    if (typeof sanitized[key] !== 'string') delete sanitized[key];
  }
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
  for (const key of ['synthParams', 'chordSynthParams', 'bassSynthParams']) {
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
      version: 11,
      storage: createJSONStorage<PersistedState>(() => persistStorage),
      partialize: partializeAppState,
      // Old-version persisted data: adopt the legacy localStorage presets
      // before the merge (merge only fills empty arrays, so it is safe).
      migrate: (persisted, version) => {
        const migrated = migrateLegacyPresets(
          (persisted ?? {}) as Partial<PersistedState>
        ) as PersistedState;
        // v3 → v4
        const deprojected =
          version >= 4 ? migrated : (migrateProjectTitleToVibeId(migrated) as PersistedState);
        // v2 → v3
        const recoloured =
          version >= 3 ? deprojected : (migrateTrackColors(deprojected) as PersistedState);
        let next: PersistedState = recoloured;
        // v1 arp fix (unchanged) …
        if (version < 2) {
          const fixed = { ...recoloured } as Record<string, unknown>;
          for (const key of ['synthParams', 'chordSynthParams', 'bassSynthParams']) {
            const params = fixed[key];
            if (params && typeof params === 'object' && !Array.isArray(params)) {
              fixed[key] = { ...(params as object), arpActive: false };
            }
          }
          next = fixed as unknown as PersistedState;
        }
        // One step per version, in version order — reading order IS run order,
        // and a new version is one more line at the bottom. The order is load-
        // bearing twice over: the wrap and the rename must precede everything
        // that maps `loops`, and migrateLeadNoteLength must precede
        // migrateLeadStepResolution (widening a pre-DEV-369 string[][] leaves a
        // shape sanitize refuses — blank melody, no throw; see CLAUDE.md).
        //
        // v4 → v5 (meter + always-widest step rows)
        if (version < 5) next = migrateMeterAndStepWidth(next) as PersistedState;
        // v5 → v6 (single-loop wrap)
        if (version < 6) next = wrapFlatStateIntoLoop(next) as PersistedState;
        // v6 → v7 (historical-key rename; a no-op once the payload already uses
        // the loop shape, which the wrap above always emits)
        if (version < 7) next = renameRegionKeysToLoop(next) as PersistedState;
        // v7 → v8 (per-loop lead octave window + view mode)
        if (version < 8) next = backfillLeadWindow(next) as PersistedState;
        // v8 → v9 (project identity)
        if (version < 9) next = migrateAddProjectIdentity(next) as PersistedState;
        // v9 → v10 (lead note length + per-loop gate)
        if (version < 10) next = migrateLeadNoteLength(next) as PersistedState;
        // v10 → v11 (lead melody in ticks + per-loop step resolution)
        if (version < 11) next = migrateLeadStepResolution(next) as PersistedState;
        return next;
      },
      // Runs on every hydration (also when nothing was stored): sanitize the
      // parsed payload (wrong-typed persisted values must never reach the
      // engine), adopt any legacy presets into the freshly-built state, then
      // drop the legacy keys once the merged state has been written under the
      // new key.
      merge: (persistedState, currentState) => {
        const sanitized = sanitizePersistedState(persistedState);
        const base = { ...currentState, ...sanitized };
        const withPresets = { ...base, ...migrateLegacyPresets(base as Partial<PersistedState>) };
        // v7: load loops[activeLoopId] into the flat slices LAST, so the
        // loop's fields win over any stale top-level per-loop keys that a
        // legacy payload still carried. Guarded on the SANITIZED payload having
        // loops (a pre-v6 flat payload has none, so the flat keys hydrate the
        // old way until the wrap migration normalises them).
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
