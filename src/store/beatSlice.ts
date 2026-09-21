import type { StoreApi } from 'zustand';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { getMeter } from '@/utils/meter';
import { adaptStepRow, writeStepWindow } from '@/utils/patternAdapt';
import { beatPresetById, defaultBeatState } from './beatPresets';
import type { AppStore, BeatSlice } from './types';
import type {
  BeatFilterParams,
  BeatParams,
  BeatPattern,
  BeatPreset,
  BeatVoiceId,
  BeatVoiceMix,
  BeatVoices,
} from '@/types';

type Set = StoreApi<AppStore>['setState'];

/**
 * The Beat instrument's slice: `beatParams` (sound), `beatPattern` (events)
 * and `beatMix` (levels), plus every action that writes one of them.
 *
 * Two rules run through the whole file.
 *
 * IMMUTABLE AT THE NARROWEST OBJECT. A voice edit rebuilds that voice, the
 * `voices` map and `beatParams` — and nothing else. Rebuilding the siblings
 * too would make every mounted view re-render on every knob tick, which is the
 * cost CLAUDE.md's "every view stays mounted" note is about.
 *
 * NEVER SHARE A REFERENCE. `paramsFromPreset` and `defaultBeatState` hand
 * back fresh deep copies, and every row this file writes is a new array, so no
 * two loops — and no loop and the factory table — can ever hold the same
 * object. One in-place write would otherwise reach all of them.
 *
 * Nothing here is high-frequency by accident: a step toggle, a knob release
 * and a fader move are user gestures, the same rate the other per-loop slices
 * are written at.
 */
/**
 * One preset id resolved against BOTH libraries — the factory table and the
 * user's own — and the complete params it names. Every reader of a
 * `basePresetId` goes through here, so "which presets exist" is answered in
 * exactly one place: a reset that knew only the factory table would silently
 * do nothing for a loop based on a preset the user saved.
 *
 * Module scope, taking the state it reads: the store is where a user library
 * lives, so this cannot be the pure resolver in `beatPresets.ts`, and it needs
 * nothing from the slice's closure.
 */
function presetById(state: AppStore, id: string): BeatPreset | undefined {
  return beatPresetById(id) ?? state.customBeatPresets.find((preset) => preset.id === id);
}

function paramsFromPreset(state: AppStore, id: string): BeatParams {
  const preset = presetById(state, id);
  if (!preset) throw new Error(`Unknown Beat preset id: ${id}`);
  return { basePresetId: preset.id, ...structuredClone(preset.patch) };
}

/** `setBeatPreset`'s write, pure, so a vibe can fold it into one `set()`. */
export function beatPresetPatch(state: AppStore, presetId: string): Pick<AppStore, 'beatParams'> {
  return { beatParams: paramsFromPreset(state, presetId) };
}

/** `updateBeatFilter`'s write: the filter only, over the patch installed now. */
export function beatFilterPatch(
  state: Pick<AppStore, 'beatParams'>,
  patch: Partial<BeatFilterParams>,
): Pick<AppStore, 'beatParams'> {
  return { beatParams: { ...state.beatParams, filter: { ...state.beatParams.filter, ...patch } } };
}

/**
 * `replaceBeatPattern`'s write. REPLACES, does not merge — a voice `rows` does
 * not name is cleared, so picking a grid gives you that grid and never that
 * grid plus leftovers. The clear goes through `writeStepWindow` like every
 * other write, so only the ACTIVE window (read from `state.meterId`) changes
 * and the wider-meter padding survives.
 */
export function replaceBeatPatternPatch(
  state: Pick<AppStore, 'meterId' | 'beatPattern'>,
  rows: Partial<Record<BeatVoiceId, readonly boolean[]>>,
): Pick<AppStore, 'beatPattern'> {
  const stepsPerBar = getMeter(state.meterId).stepsPerBar;
  const silent = new Array<boolean>(stepsPerBar).fill(false);
  const next = {} as BeatPattern['rows'];
  for (const voice of BEAT_VOICE_IDS) {
    const row = rows[voice];
    // A fresh array per voice, always: `silent` is read, never stored.
    next[voice] = writeStepWindow(
      state.beatPattern.rows[voice],
      stepsPerBar,
      row ? adaptStepRow(row, stepsPerBar) : silent,
    );
  }
  return { beatPattern: { rows: next } };
}

export function createBeatSlice(set: Set): BeatSlice {
  /** One voice's params replaced; every other voice object keeps its identity. */
  const withVoice = (
    voices: BeatVoices,
    voice: BeatVoiceId,
    next: BeatVoices[BeatVoiceId],
  ): BeatVoices => ({ ...voices, [voice]: next }) as BeatVoices;

  /** One mix entry replaced, same rule. */
  const withMixVoice = (
    voices: Record<BeatVoiceId, BeatVoiceMix>,
    voice: BeatVoiceId,
    next: BeatVoiceMix,
  ): Record<BeatVoiceId, BeatVoiceMix> => ({ ...voices, [voice]: next });

  return {
    ...defaultBeatState(),

    // FACTORY OR USER, and never a silent miss. `beatPresetById` only knows the
    // factory table — it is the pure resolver one layer above `src/data/`, with
    // no store access — so a saved user preset can only be resolved HERE, where
    // the library is in state. Before this, applying a user preset fell through
    // `beatParamsFromPreset`'s fallback and installed the DEFAULT preset's
    // sound: no error, no warning, just somebody else's kit under the user's
    // own name. An id nothing claims now THROWS, because the two honest answers
    // are "impossible by construction" (every caller picks from a rendered
    // list, and a vibe's id is pinned by `vibes.test.ts`) and "loud" — a silent
    // no-op would put the same wrong-sound class of bug back one level up.
    setBeatPreset: (presetId) => set((state) => beatPresetPatch(state, presetId)),

    // CLONED on the way in. The caller's object is often a library entry — a
    // factory preset today, a saved user preset from Task 5 — and installing
    // it by reference would let the next knob edit write back into the library
    // the patch came from. `setBeatPreset` clones through
    // `paramsFromPreset`; this door must not be the one left open.
    setBeatParams: (params) => set({ beatParams: structuredClone(params) }),

    // The FILTER ONLY, laid over whatever patch is installed at the moment it
    // runs — see the docblock on `BeatSlice.updateBeatFilter` for why a vibe
    // cannot build this object itself from a state snapshot.
    updateBeatFilter: (patch) => set((state) => beatFilterPatch(state, patch)),

    updateBeatVoice: (voice, patch) =>
      set((state) => ({
        beatParams: {
          ...state.beatParams,
          voices: withVoice(state.beatParams.voices, voice, {
            ...state.beatParams.voices[voice],
            ...patch,
          }),
        },
      })),

    // Reset restores from the BASE PRESET, never from the default one: an
    // unresolvable base (`basePresetId: null`, what the sanitizer records for
    // a patch whose origin is gone) has no answer, so the sound stays exactly
    // as stored rather than becoming somebody else's preset.
    resetBeatVoice: (voice) =>
      set((state) => {
        const base = presetById(state, state.beatParams.basePresetId ?? '');
        if (!base) return {};
        return {
          beatParams: {
            ...state.beatParams,
            voices: withVoice(
              state.beatParams.voices,
              voice,
              structuredClone(base.patch.voices[voice]),
            ),
          },
        };
      }),

    resetBeatParams: () =>
      set((state) => {
        const basePresetId = state.beatParams.basePresetId;
        if (!basePresetId || !presetById(state, basePresetId)) return {};
        return { beatParams: paramsFromPreset(state, basePresetId) };
      }),

    // See `replaceBeatPatternPatch`: replaces, never merges.
    replaceBeatPattern: (rows) => set((state) => replaceBeatPatternPatch(state, rows)),

    toggleBeatStep: (voice, step) =>
      set((state) => {
        const row = state.beatPattern.rows[voice];
        // Bounded by the ACTIVE WINDOW, not by the stored row's length. A
        // stored row is `MAX_STEPS_PER_BAR` wide and everything past
        // `stepsPerBar` is the user's programming for a WIDER meter — a write
        // there is a hit nothing draws and nothing plays, which surfaces later
        // as a phantom the first time the meter changes. `writeStepWindow`
        // keeps the same boundary from the other side.
        const stepsPerBar = Math.min(getMeter(state.meterId).stepsPerBar, row.length);
        if (!Number.isInteger(step) || step < 0 || step >= stepsPerBar) return {};
        const nextRow = [...row];
        nextRow[step] = !nextRow[step];
        return { beatPattern: { rows: { ...state.beatPattern.rows, [voice]: nextRow } } };
      }),

    setBeatVoiceLevel: (voice, levelDb) =>
      set((state) => ({
        beatMix: {
          ...state.beatMix,
          voices: withMixVoice(state.beatMix.voices, voice, {
            ...state.beatMix.voices[voice],
            levelDb,
          }),
        },
      })),

    toggleBeatVoiceMuted: (voice) =>
      set((state) => ({
        beatMix: {
          ...state.beatMix,
          voices: withMixVoice(state.beatMix.voices, voice, {
            ...state.beatMix.voices[voice],
            muted: !state.beatMix.voices[voice].muted,
          }),
        },
      })),

    setBeatLevel: (levelDb) => set((state) => ({ beatMix: { ...state.beatMix, levelDb } })),

    toggleBeatMuted: () =>
      set((state) => ({ beatMix: { ...state.beatMix, muted: !state.beatMix.muted } })),
  };
}
