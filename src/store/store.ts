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
import { INITIAL_EFFECTS, INITIAL_SYNTH_PARAMS } from './initialState';
import { EFFECT_LIMITS, clampEffectValue, type EffectNumericKey } from '../audio/effectLimits';
import type { SynthParams, ChordItem, SequencerTrack, FilterType } from '../types';
import { createUiSlice } from './uiSlice';
import { createPresetsSlice } from './presetsSlice';
import { createLoopSlice, createDefaultLoop } from './loopSlice';
import {
  migrateLegacyPresets,
  migrateProjectTitleToVibeId,
  migrateTrackColors,
  migrateMeterAndStepWidth,
  wrapFlatStateIntoLoop,
  renameRegionKeysToLoop,
  removeLegacyKeys,
  LEGACY_PERSIST_KEY,
} from './migrate';
import { loopStatePatch } from './loop';
import { createLoopMirroringSet } from './loopSync';
import type { BassStepChoice } from '../audio/bassPatterns';
import { isMeterId } from '../utils/meter';
import { createCoalescedStorage } from '../utils/coalescedStorage';
import type { AppStore, PersistedState, Loop } from './types';

export const PERSIST_KEY = 'musibox_project_state_v1';

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

// `pagehide` (not `beforeunload`) is the event that actually fires on iOS
// Safari and on bfcache navigations; `visibilitychange` covers a tab that is
// backgrounded and then killed by the OS without ever firing pagehide.
try {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', flushPersistedWrites);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPersistedWrites();
    });
  }
} catch {
  // ignore — a restricted embedding context may deny even addEventListener
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
const OSC_TYPES = new Set(['sawtooth', 'square', 'sine', 'triangle']);
const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass']);
const LFO_TARGETS = new Set(['cutoff', 'pitch', 'volume']);
const ARP_MODES = new Set(['up', 'down', 'updown', 'random']);
const ARP_RATES = new Set(['4n', '8n', '16n', '32n']);

/**
 * Synth params are written straight onto AudioParams, so a wrong-typed
 * persisted value (a string cutoff, a null attack) would land as
 * setValueAtTime(NaN) and silence the voice. Each field keeps its stored value
 * only when the type matches the factory default — and, for the enum fields,
 * only when the engine and arpeggiator actually understand it.
 */
function sanitizeSynthParams(value: unknown): SynthParams {
  const fallback = INITIAL_SYNTH_PARAMS;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const out = { ...fallback } as Record<string, unknown>;

  for (const [key, def] of Object.entries(fallback)) {
    const stored = raw[key];
    if (typeof def === 'number') {
      out[key] = typeof stored === 'number' && Number.isFinite(stored) ? stored : def;
    } else if (typeof def === 'boolean') {
      out[key] = typeof stored === 'boolean' ? stored : def;
    } else if (typeof def === 'string') {
      out[key] = typeof stored === 'string' ? stored : def;
    }
  }

  if (!OSC_TYPES.has(out.oscType as string)) out.oscType = fallback.oscType;
  if (!FILTER_TYPES.has(out.filterType as string)) out.filterType = fallback.filterType;
  if (!LFO_TARGETS.has(out.lfoTarget as string)) out.lfoTarget = fallback.lfoTarget;
  if (!ARP_MODES.has(out.arpMode as string)) out.arpMode = fallback.arpMode;
  if (!ARP_RATES.has(out.arpRate as string)) out.arpRate = fallback.arpRate;

  return out as unknown as SynthParams;
}

// The MasterEffects payload: plain-object check (a partial effects object
// with valid fields is preserved as-is; anything else falls back to the
// factory defaults), every numeric field clamped through the SAME table the
// engine uses (audio/effectLimits.ts) so the two can no longer drift — the
// old code clamped only reverbDecay and compressorThreshold and let a
// persisted delayFeedback of 1.2 through to a runaway feedback loop. The
// ternary can hand back the SHARED INITIAL_EFFECTS constant — clone before
// writing so the module constant is never mutated. Fields removed from
// MasterEffects must not resurrect from old persisted payloads.
function sanitizeEffectsValue(effects: unknown): unknown {
  let result =
    typeof effects === 'object' && effects !== null && !Array.isArray(effects)
      ? effects
      : INITIAL_EFFECTS;

  if (result && typeof result === 'object') {
    if (result === INITIAL_EFFECTS) result = { ...INITIAL_EFFECTS };
    const fxWritable = result as Record<string, unknown>;
    for (const key of Object.keys(EFFECT_LIMITS) as EffectNumericKey[]) {
      fxWritable[key] = clampEffectValue(key, fxWritable[key]);
    }
  }

  if (result && typeof result === 'object') {
    const fx = result as Record<string, unknown>;
    for (const key of ['chorusRate', 'chorusDepth', 'chorusWet', 'compressorRatio', 'compressorBypass', 'delayTime', 'distortionDrive']) {
      delete fx[key];
    }
  }

  return result;
}

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback;
}

function isPatternMode(value: unknown): value is 'preset' | 'custom' {
  return value === 'preset' || value === 'custom';
}

function asPatternMode(value: unknown, fallback: 'preset' | 'custom'): 'preset' | 'custom' {
  return isPatternMode(value) ? value : fallback;
}

function asFilterType(value: unknown, fallback: FilterType): FilterType {
  return FILTER_TYPES.has(value as string) ? (value as FilterType) : fallback;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function asPositiveInteger(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}

function isStringMatrix(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((row) => Array.isArray(row) && row.every((n) => typeof n === 'string'))
  );
}

/**
 * Validates a persisted `loops` array. Each loop is rebuilt through the
 * same per-field guards/clamps the flat payload used (synth params, finite
 * clamps, string/enum checks), with createDefaultLoop() as the fallback for
 * missing or wrong-typed fields. Rows that are not plain objects are dropped;
 * an empty result means "no valid loops" and the caller falls back to the
 * default single loop.
 */
function sanitizeLoops(value: unknown): Loop[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const loops: Loop[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const fallback = createDefaultLoop();
    const r = { ...fallback, ...(raw as Record<string, unknown>) } as Record<string, unknown>;
    loops.push({
      id: typeof r.id === 'string' && r.id.length > 0 ? r.id : `loop-${loops.length}`,
      name: typeof r.name === 'string' && r.name.length > 0 ? r.name : `Loop ${loops.length + 1}`,
      repeatCount: clampFinite(asPositiveInteger(r.repeatCount, fallback.repeatCount ?? 1), 1, 32, 1),
      scaleRoot: asString(r.scaleRoot, fallback.scaleRoot),
      scaleType: asString(r.scaleType, fallback.scaleType),
      synthParams: sanitizeSynthParams(r.synthParams),
      chordSynthParams: sanitizeSynthParams(r.chordSynthParams),
      bassSynthParams: sanitizeSynthParams(r.bassSynthParams),
      chords: asArray<ChordItem>(r.chords, fallback.chords),
      chordRhythmId: asString(r.chordRhythmId, fallback.chordRhythmId),
      chordRhythmMode: asPatternMode(r.chordRhythmMode, fallback.chordRhythmMode),
      customChordRhythm: asArray<boolean>(r.customChordRhythm, fallback.customChordRhythm),
      chordFeel: clampFinite(r.chordFeel, 0, 1, fallback.chordFeel),
      chordOctave: clampFinite(r.chordOctave, 0, 8, fallback.chordOctave),
      bassPatternId: asString(r.bassPatternId, fallback.bassPatternId),
      bassPatternMode: asPatternMode(r.bassPatternMode, fallback.bassPatternMode),
      customBassPattern: asArray<BassStepChoice>(r.customBassPattern, fallback.customBassPattern),
      bassFeel: clampFinite(r.bassFeel, 0, 1, fallback.bassFeel),
      bassOctave: clampFinite(r.bassOctave, 0, 8, fallback.bassOctave),
      leadMelodySteps: asArray<string[]>(r.leadMelodySteps, fallback.leadMelodySteps),
      leadLoopLength: asPositiveInteger(r.leadLoopLength, fallback.leadLoopLength),
      sequencerTracks: asArray<SequencerTrack>(r.sequencerTracks, fallback.sequencerTracks),
      soundKit: asString(r.soundKit, fallback.soundKit),
      drumFilterCutoff: clampFinite(r.drumFilterCutoff, 50, 12000, fallback.drumFilterCutoff),
      drumFilterResonance: clampFinite(r.drumFilterResonance, 0.1, 20, fallback.drumFilterResonance),
      drumFilterType: asFilterType(r.drumFilterType, fallback.drumFilterType),
      synthVolume: clampFinite(r.synthVolume, 0, 1.5, fallback.synthVolume),
      synthMuted: asBoolean(r.synthMuted),
      chordVolume: clampFinite(r.chordVolume, 0, 1.5, fallback.chordVolume),
      chordMuted: asBoolean(r.chordMuted),
      bassVolume: clampFinite(r.bassVolume, 0, 1.5, fallback.bassVolume),
      bassMuted: asBoolean(r.bassMuted),
      masterSequencerVolume: clampFinite(r.masterSequencerVolume, 0, 1, fallback.masterSequencerVolume),
      drumMuted: asBoolean(r.drumMuted),
    });
  }
  return loops.length > 0 ? loops : undefined;
}

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
  if (!isStringMatrix(sanitized.leadMelodySteps)) {
    delete sanitized.leadMelodySteps;
  }
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
        ...createLeadSlice(setWithLoopMirror),
        ...createSequencerSlice(setWithLoopMirror),
        ...createEffectsSlice(setWithLoopMirror),
        ...createUiSlice(setWithLoopMirror),
        ...createPresetsSlice(setWithLoopMirror),
        ...createLoopSlice(setWithLoopMirror, get),
      };
    }),
    {
      name: PERSIST_KEY,
      version: 7,
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
        // v4 → v5 (runs on EVERY older version, after the chain above)
        const metered = (payload: PersistedState): PersistedState =>
          version >= 5 ? payload : (migrateMeterAndStepWidth(payload) as PersistedState);
        // v5 → v6 (single-loop wrap; forward-compat guard for a future v7)
        const wrapped = (payload: PersistedState): PersistedState =>
          version >= 6 ? payload : (wrapFlatStateIntoLoop(payload) as PersistedState);
        // v6 → v7 (historical-key rename; no-op once the payload already uses
        // the loop shape, which the wrap above always emits). Runs LAST so it
        // also translates a v6 payload's two old keys.
        const looped = (payload: PersistedState): PersistedState =>
          version >= 7 ? payload : (renameRegionKeysToLoop(payload) as PersistedState);
        if (version >= 2) return looped(wrapped(metered(recoloured)));
        // v1 arp fix (unchanged) …
        const next = { ...recoloured } as Record<string, unknown>;
        for (const key of ['synthParams', 'chordSynthParams', 'bassSynthParams']) {
          const params = next[key];
          if (params && typeof params === 'object' && !Array.isArray(params)) {
            next[key] = { ...(params as object), arpActive: false };
          }
        }
        return looped(wrapped(metered(next as unknown as PersistedState)));
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
          const activeId =
            typeof sanitized.activeLoopId === 'string' ? sanitized.activeLoopId : loops[0].id;
          const active = loops.find((l) => l.id === activeId) ?? loops[0];
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
