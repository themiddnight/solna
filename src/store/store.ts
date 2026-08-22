import { create } from 'zustand';
import type { StoreApi } from 'zustand';
import { persist, subscribeWithSelector, createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { createTransportSlice } from './transportSlice';
import { createMusicContextSlice } from './musicContextSlice';
import { createSynthSlice } from './synthSlice';
import { createChordsSlice } from './chordsSlice';
import { createBassSlice } from './bassSlice';
import { createSequencerSlice } from './sequencerSlice';
import { createEffectsSlice } from './effectsSlice';
import { INITIAL_EFFECTS } from './initialState';
import { createUiSlice } from './uiSlice';
import { createPresetsSlice } from './presetsSlice';
import { migrateLegacyPresets, removeLegacyKeys } from './migrate';
import type { AppStore, PersistedState } from './types';

export const PERSIST_KEY = 'murva_project_state_v1';

// Fallback when localStorage is unavailable (SSR, tests, restricted
// contexts): an in-memory stub keeps the persist middleware functional so the
// app still runs, it just doesn't survive a reload.
const memoryStorage: StateStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (name) => store.get(name) ?? null,
    setItem: (name, value) => {
      store.set(name, value);
    },
    removeItem: (name) => {
      store.delete(name);
    },
  };
})();

function resolveStorage(): StateStorage | null {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      return localStorage;
    }
  } catch {
    // ignore
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

// Captured during store creation so the persist onRehydrateStorage callback
// (which runs synchronously inside create(), while the `useAppStore` binding
// is still in its temporal dead zone) can still reach the store api.
let storeApi: StoreApi<AppStore> | undefined;

// Explicit allow-list: everything except the ui slice, the transient playing
// flags, and all actions.
export function partializeAppState(state: AppStore): PersistedState {
  return {
    bpm: state.bpm,
    masterVolume: state.masterVolume,
    metronomeActive: state.metronomeActive,
    scaleRoot: state.scaleRoot,
    scaleType: state.scaleType,
    projectTitle: state.projectTitle,
    synthParams: state.synthParams,
    chordSynthParams: state.chordSynthParams,
    bassSynthParams: state.bassSynthParams,
    controlTarget: state.controlTarget,
    chords: state.chords,
    chordRhythmId: state.chordRhythmId,
    chordFeel: state.chordFeel,
    chordOctave: state.chordOctave,
    chordMuted: state.chordMuted,
    chordVolume: state.chordVolume,
    bassPatternId: state.bassPatternId,
    bassFeel: state.bassFeel,
    bassOctave: state.bassOctave,
    bassMuted: state.bassMuted,
    bassVolume: state.bassVolume,
    sequencerTracks: state.sequencerTracks,
    soundKit: state.soundKit,
    masterSequencerVolume: state.masterSequencerVolume,
    effects: state.effects,
    customSynthPresets: state.customSynthPresets,
    customChordProgressions: state.customChordProgressions,
  };
}

// Type-guard the parsed persisted payload before it is merged into the live
// state. Corrupt JSON never reaches this point (createJSONStorage returns null
// and persist falls back to defaults), but WRONG-TYPED values survive parsing
// and would flow straight into engine setters (`bpm: "fast"` -> NaN clock,
// string volumes -> setTargetAtTime(NaN)). Each checked key is clamped,
// coerced, or dropped; dropped keys fall back to the freshly-built
// currentState defaults. Only the keys listed here are checked — everything
// else passes through unchanged.
function sanitizePersistedState(persisted: unknown): Partial<AppStore> {
  if (typeof persisted !== 'object' || persisted === null) return {};
  const sanitized = { ...(persisted as Record<string, unknown>) };

  const clampFinite = (value: unknown, min: number, max: number, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  };
  const asBoolean = (value: unknown): boolean => (typeof value === 'boolean' ? value : false);
  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined;

  sanitized.bpm = clampFinite(sanitized.bpm, 20, 300, 120);
  sanitized.masterVolume = clampFinite(sanitized.masterVolume, 0, 1, 0.85);
  sanitized.chordVolume = clampFinite(sanitized.chordVolume, 0, 1, 1.0);
  sanitized.bassVolume = clampFinite(sanitized.bassVolume, 0, 1, 1.0);
  sanitized.masterSequencerVolume = clampFinite(sanitized.masterSequencerVolume, 0, 1, 0.8);
  sanitized.metronomeActive = asBoolean(sanitized.metronomeActive);
  sanitized.chordMuted = asBoolean(sanitized.chordMuted);
  sanitized.bassMuted = asBoolean(sanitized.bassMuted);
  sanitized.soundKit = asString(sanitized.soundKit) ?? 'Retro Drive';
  // Plain-object check only: a partial effects object with valid fields is
  // preserved as-is; anything else falls back to the factory defaults.
  sanitized.effects =
    typeof sanitized.effects === 'object' &&
    sanitized.effects !== null &&
    !Array.isArray(sanitized.effects)
      ? sanitized.effects
      : INITIAL_EFFECTS;

  // Arrays and free-form strings: drop invalid values so the currentState
  // defaults win in the merge spread below.
  for (const key of ['chords', 'sequencerTracks', 'customSynthPresets', 'customChordProgressions']) {
    if (!Array.isArray(sanitized[key])) delete sanitized[key];
  }
  for (const key of ['scaleRoot', 'scaleType', 'projectTitle', 'chordRhythmId', 'bassPatternId']) {
    if (typeof sanitized[key] !== 'string') delete sanitized[key];
  }

  return sanitized as unknown as Partial<AppStore>;
}

export const useAppStore = create<AppStore>()(
  persist(
    subscribeWithSelector((set, get, api) => {
      storeApi = api;
      return {
        ...createTransportSlice(set, get),
        ...createMusicContextSlice(set, get),
        ...createSynthSlice(set, get),
        ...createChordsSlice(set, get),
        ...createBassSlice(set, get),
        ...createSequencerSlice(set, get),
        ...createEffectsSlice(set, get),
        ...createUiSlice(set, get),
        ...createPresetsSlice(set, get),
      };
    }),
    {
      name: PERSIST_KEY,
      version: 1,
      storage: createJSONStorage<PersistedState>(() => resolveStorage() ?? memoryStorage),
      partialize: partializeAppState,
      // Old-version persisted data: adopt the legacy localStorage presets
      // before the merge (merge only fills empty arrays, so it is safe).
      migrate: (persisted, _version) =>
        migrateLegacyPresets((persisted ?? {}) as Partial<PersistedState>) as PersistedState,
      // Runs on every hydration (also when nothing was stored): sanitize the
      // parsed payload (wrong-typed persisted values must never reach the
      // engine), adopt any legacy presets into the freshly-built state, then
      // drop the legacy keys once the merged state has been written under the
      // new key.
      merge: (persistedState, currentState) => {
        const base = { ...currentState, ...sanitizePersistedState(persistedState) };
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
