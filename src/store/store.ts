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
import { INITIAL_EFFECTS, INITIAL_SYNTH_PARAMS } from './initialState';
import { EFFECT_LIMITS, clampEffectValue, type EffectNumericKey } from '../audio/effectLimits';
import type { SynthParams } from '../types';
import { createUiSlice } from './uiSlice';
import { createPresetsSlice } from './presetsSlice';
import {
  migrateLegacyPresets,
  migrateProjectTitleToVibeId,
  migrateTrackColors,
  migrateMeterAndStepWidth,
  removeLegacyKeys,
  LEGACY_PERSIST_KEY,
} from './migrate';
import { isMeterId } from '../utils/meter';
import type { AppStore, PersistedState } from './types';

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

// Captured during store creation so the persist onRehydrateStorage callback
// (which runs synchronously inside create(), while the `useAppStore` binding
// is still in its temporal dead zone) can still reach the store api.
let storeApi: StoreApi<AppStore> | undefined;

// Explicit allow-list: everything except the ui slice, the transient playing
// flags, and all actions.
export function partializeAppState(state: AppStore): PersistedState {
  return {
    bpm: state.bpm,
    meterId: state.meterId,
    masterVolume: state.masterVolume,
    metronomeActive: state.metronomeActive,
    scaleRoot: state.scaleRoot,
    scaleType: state.scaleType,
    selectedVibeId: state.selectedVibeId,
    synthParams: state.synthParams,
    chordSynthParams: state.chordSynthParams,
    bassSynthParams: state.bassSynthParams,
    controlTarget: state.controlTarget,
    synthVolume: state.synthVolume,
    synthMuted: state.synthMuted,
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
    drumMuted: state.drumMuted,
    drumFilterCutoff: state.drumFilterCutoff,
    drumFilterResonance: state.drumFilterResonance,
    drumFilterType: state.drumFilterType,
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
// MasterEffects (Task 4) must not resurrect from old persisted payloads.
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
  sanitized.synthVolume = clampFinite(sanitized.synthVolume, 0, 1.5, 1.0);
  sanitized.chordVolume = clampFinite(sanitized.chordVolume, 0, 1.5, 1.0);
  sanitized.bassVolume = clampFinite(sanitized.bassVolume, 0, 1.5, 1.0);
  sanitized.masterSequencerVolume = clampFinite(sanitized.masterSequencerVolume, 0, 1, 0.8);
  sanitized.drumFilterCutoff = clampFinite(sanitized.drumFilterCutoff, 50, 12000, 12000);
  sanitized.drumFilterResonance = clampFinite(sanitized.drumFilterResonance, 0.1, 20, 0.7);
  sanitized.drumFilterType =
    sanitized.drumFilterType === 'lowpass' ||
    sanitized.drumFilterType === 'highpass' ||
    sanitized.drumFilterType === 'bandpass'
      ? sanitized.drumFilterType
      : 'lowpass';
  sanitized.metronomeActive = asBoolean(sanitized.metronomeActive);
  sanitized.synthMuted = asBoolean(sanitized.synthMuted);
  sanitized.chordMuted = asBoolean(sanitized.chordMuted);
  sanitized.bassMuted = asBoolean(sanitized.bassMuted);
  sanitized.drumMuted = asBoolean(sanitized.drumMuted);
  sanitized.soundKit = asString(sanitized.soundKit) ?? 'Retro Drive';
  sanitized.effects = sanitizeEffectsValue(sanitized.effects);

  // Arrays and free-form strings: drop invalid values so the currentState
  // defaults win in the merge spread below.
  for (const key of ['chords', 'sequencerTracks', 'customSynthPresets', 'customChordProgressions']) {
    if (!Array.isArray(sanitized[key])) delete sanitized[key];
  }
  for (const key of ['scaleRoot', 'scaleType', 'chordRhythmId', 'bassPatternId']) {
    if (typeof sanitized[key] !== 'string') delete sanitized[key];
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

  return sanitized as unknown as Partial<AppStore>;
}

export const useAppStore = create<AppStore>()(
  persist(
    subscribeWithSelector((set, get, api) => {
      storeApi = api;
      return {
        ...createTransportSlice(set, get),
        ...createMusicContextSlice(set),
        ...createSynthSlice(set),
        ...createChordsSlice(set),
        ...createBassSlice(set),
        ...createSequencerSlice(set),
        ...createEffectsSlice(set),
        ...createUiSlice(set),
        ...createPresetsSlice(set),
      };
    }),
    {
      name: PERSIST_KEY,
      version: 5,
      storage: createJSONStorage<PersistedState>(() => resolveStorage() ?? memoryStorage),
      partialize: partializeAppState,
      // Old-version persisted data: adopt the legacy localStorage presets
      // before the merge (merge only fills empty arrays, so it is safe).
      migrate: (persisted, version) => {
        const migrated = migrateLegacyPresets(
          (persisted ?? {}) as Partial<PersistedState>
        ) as PersistedState;
        // v3 → v4: the project concept is gone; the vibe bar's highlight is
        // its own persisted field now.
        const deprojected =
          version >= 4 ? migrated : (migrateProjectTitleToVibeId(migrated) as PersistedState);
        // v2 → v3: raw Tailwind track colours become daisyUI semantic tokens.
        const recoloured =
          version >= 3 ? deprojected : (migrateTrackColors(deprojected) as PersistedState);
        // v4 → v5: step arrays widen to MAX_STEPS_PER_BAR and meterId appears.
        // Runs on EVERY older version, so it is applied after the chain above
        // rather than inside the version >= 2 short-circuit below.
        const metered = (payload: PersistedState): PersistedState =>
          version >= 5 ? payload : (migrateMeterAndStepWidth(payload) as PersistedState);
        if (version >= 2) return metered(recoloured);
        // v1 persisted `arpActive: true` from an arpeggiator that never
        // produced a note, while that same flag gated the keyboard's direct
        // trigger — so those sessions came back with a silent keyboard. Clear
        // the flag once on the way to v2; the arp can be switched back on.
        const next = { ...recoloured } as Record<string, unknown>;
        for (const key of ['synthParams', 'chordSynthParams', 'bassSynthParams']) {
          const params = next[key];
          if (params && typeof params === 'object' && !Array.isArray(params)) {
            next[key] = { ...(params as object), arpActive: false };
          }
        }
        return metered(next as unknown as PersistedState);
      },
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
