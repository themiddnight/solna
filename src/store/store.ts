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
import { createFxSlice } from './fxSlice';
import { createSequencerSlice } from './sequencerSlice';
import { createEffectsSlice } from './effectsSlice';
import { createUiSlice } from './uiSlice';
import { createPresetsSlice } from './presetsSlice';
import { createLoopSlice } from './loopSlice';
import { createLoopCopySlice } from './loopCopySlice';
import { migrateLegacyPresets, removeLegacyKeys, LEGACY_PERSIST_KEY } from './migrate';
import { createLoopMirroringSet } from './loopSync';
import { createProjectSlice } from './projectSlice';
import { createProjectAutosave } from './projectAutosave';
import { createProjectStore } from './projectStore';
import { openIndexedDbBackend } from './projectStoreIdb';
import { isMixLayerId } from './focusTrack';
import { createCoalescedStorage } from '../utils/coalescedStorage';
import type { AppStore, PersistedState } from './types';
import { asBoolean } from './sanitize';

export const PERSIST_KEY = 'musibox_project_state_v1';

/**
 * The current persist `version`, stamped on every write.
 *
 * DEV-388 deleted the 15-step `if (version < N)` migration chain that used to
 * live in `migrate:` below (see CLAUDE.md: solna has no real users yet, so a
 * per-version upgrade chain was machinery maintained for nobody). What
 * replaced it is VALIDATION, not migration: `merge` below runs every
 * hydrated payload through `sanitizePersistedState` regardless of what
 * version wrote it. That function decides per KEY
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

/**
 * Explicit allow-list: session/view prefs plus the user's own library, and
 * NOTHING ELSE. Project content (bpm, meterId, masterVolume, effects, loops) is
 * no longer here — IndexedDB is its home now, written by the autosave path
 * below. What is left is exactly what must survive a reload but is not a
 * project: which track/loop the user was on, the metronome, the last vibe chip,
 * and the cross-project preset/progression library (never project content —
 * the 2026-09-03 "excluded — user library" rule).
 */
export function partializeAppState(state: AppStore): PersistedState {
  return {
    metronomeActive: state.metronomeActive,
    selectedVibeId: state.selectedVibeId,
    focusTrack: state.focusTrack,
    customSynthPresets: state.customSynthPresets,
    customChordProgressions: state.customChordProgressions,
    activeLoopId: state.activeLoopId,
  };
}

/**
 * Picks and validates only session preferences and user libraries. Old content
 * and unknown keys must never override the factory state or store actions.
 *
 * Musical content is deliberately absent: it no longer travels through
 * localStorage, so `sanitizeContent` (projectFile.ts) is the one reader that
 * validates it, on the `.solna` import and IndexedDB load paths where the
 * content actually enters the store. Repeating the rules here would be a second
 * copy of a rule that now has exactly one entry point.
 */
export function sanitizePersistedState(persisted: unknown): Partial<AppStore> {
  if (typeof persisted !== 'object' || persisted === null) return {};
  const input = persisted as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {
    metronomeActive: input.metronomeActive,
    focusTrack: input.focusTrack,
    selectedVibeId: input.selectedVibeId,
    customSynthPresets: input.customSynthPresets,
    customChordProgressions: input.customChordProgressions,
    activeLoopId: input.activeLoopId,
  };

  sanitized.metronomeActive = asBoolean(sanitized.metronomeActive);
  // Sanitizing here is what removes the bad-value case altogether — see the
  // focusTrack docblock this replaces: a 'drum' value leaking into the synth
  // path is not an error and not a visible mis-render, it silently points
  // every Sound-page knob at the Lead patch.
  sanitized.focusTrack = isMixLayerId(sanitized.focusTrack) ? sanitized.focusTrack : 'synth';
  if (typeof sanitized.selectedVibeId !== 'string' && sanitized.selectedVibeId !== null) {
    delete sanitized.selectedVibeId;
  }
  for (const key of ['customSynthPresets', 'customChordProgressions']) {
    if (!Array.isArray(sanitized[key])) delete sanitized[key];
  }
  // Only the TYPE is checked here. Whether the id names a loop can only be
  // decided once the loops themselves have loaded from IndexedDB, which happens
  // after hydration — `reconcileActiveLoop` in projectSlice.ts owns that.
  if (typeof sanitized.activeLoopId !== 'string') delete sanitized.activeLoopId;

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
        ...createFxSlice(setWithLoopMirror, get),
        ...createSequencerSlice(setWithLoopMirror),
        ...createEffectsSlice(setWithLoopMirror),
        ...createUiSlice(setWithLoopMirror),
        ...createPresetsSlice(setWithLoopMirror),
        ...createLoopSlice(setWithLoopMirror, get),
        ...createLoopCopySlice(setWithLoopMirror, get),
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
        return { ...base, ...migrateLegacyPresets(base as Partial<PersistedState>) };
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

/** The idle-coalesced autosave writer — see projectAutosave.ts. One per tab. */
export const projectAutosave = createProjectAutosave(useAppStore);

/**
 * Boot: read the one project slot, then arm autosave. Armed in a `finally` so a
 * rejected load still leaves the app writable rather than silently readonly.
 * Memoized — React StrictMode mounts App's effect twice, and a second load
 * would re-install a project over whatever the user had already touched.
 */
let booting: Promise<void> | null = null;
export function bootProject(): Promise<void> {
  booting ??= (async () => {
    try {
      await useAppStore.getState().loadProject();
    } finally {
      projectAutosave.arm();
    }
  })();
  return booting;
}

/**
 * The buffered writes go out on the way to hidden — both of them. The autosave
 * flush is what makes a killed tab's last edit durable, and the persist flush
 * is the pre-existing session-prefs one.
 */
export function flushBeforeHide(): void {
  projectAutosave.flush();
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
