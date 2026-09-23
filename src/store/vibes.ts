/**
 * Turning a VibeSpec into sound.
 *
 * `resolveVibe` is the ONLY place a vibe's library ids become values, and it
 * resolves all of them before it returns anything. That ordering is the same
 * rule applyVibeToStore follows for the three synth presets, and for the same
 * reason: a throw part-way through a swap leaves the store holding half of one
 * vibe and half of another, with the transport stopped.
 */
import type { ChordItem, MasterEffects } from '../types';
import type { ActiveSynth } from '../types/synth';
import type { SynthControlTarget } from '../utils/synthControl';
import type { VibeSpec } from '../data/vibes';
import { VIBES } from '../data/vibes';
import { audioEngine } from '../audio/engine';
import { ACCOMPANIMENT_SOURCES } from '../audio/playback/playbackEngine';
import { presetById } from '../utils/synthPresets';
import { progressionById, resolveProgression } from '../audio/chordProgressions';
import { drumGridById } from '../audio/drumGrids';
import { requireEffectChain } from '../audio/effectChains';
import { gainToDb, toLinearGain } from '../utils/gainUnits';
import { useAppStore } from './store';
import { commitRestartAfterStop } from './stopAndRestart';
import { captureActivePlayers } from './transportSlice';
import { defaultTrackSynth } from './initialState';
import { beatFilterPatch, beatPresetPatch, replaceBeatPatternPatch } from './beatSlice';
import { chordsPatch } from './chordsSlice';
import { loopTempNamePatch } from './loopSlice';
import { loopMirrorPartial } from './loopSync';
import { changeKey } from './keyChange';
import { normalizePadIntervals } from './sanitize';
import type { AppStore } from './types';
import { clampBpm } from '../utils/tempo';

/** A VibeSpec with its three library references turned into values. */
export interface ResolvedVibe extends VibeSpec {
  chords: ChordItem[];
  /** The grid's rows, one bar of the vibe's own meter. A fresh copy. */
  drumPattern: Record<string, boolean[]>;
  /** A Partial — an omitted key means "inherit the current value". */
  effects: Partial<MasterEffects>;
}

/**
 * Resolve a vibe's progression, drum grid and effect chain.
 *
 * All three throw on an unknown id. That symmetry is the point: before the
 * VibeSpec split, two of the three used `!` and handed back `undefined`, which
 * failed somewhere downstream, and only the effect chain threw.
 */
export function resolveVibe(spec: VibeSpec): ResolvedVibe {
  const progression = progressionById(spec.progressionId);
  if (!progression) {
    throw new Error(`Vibe "${spec.id}" references unknown progression id: ${spec.progressionId}`);
  }
  const grid = drumGridById(spec.drumGridId);
  if (!grid) {
    throw new Error(`Vibe "${spec.id}" references unknown drum grid id: ${spec.drumGridId}`);
  }
  return {
    ...spec,
    // The vibe's OWN key and scale, by construction. These used to be
    // literals written beside the id, and a mismatch changed what the
    // vibe sounded like without changing progressionId.
    chords: resolveProgression(progression, spec.scaleRoot, spec.scaleType),
    drumPattern: grid.rows,
    effects: requireEffectChain(spec.effectChainId),
  };
}

/**
 * Resolve one of a vibe's synth voices from a library preset id.
 *
 * The preset's OWN complete patch, on whichever bus the vibe named — a preset
 * is a sound, not a role, so the same id gives the same sound everywhere. This
 * used to answer with the TARGET's factory patch and merely record the id as
 * provenance, because the flat library could not produce an `ActiveSynth` at
 * all; that shortcut is what made applying a vibe stop changing the sound.
 *
 * An unresolvable id falls back to the target's default rather than throwing
 * (design doc: "Missing factory references fail data tests; runtime resolution
 * falls back to the relevant track default"). `vibes.test.ts` is what makes an
 * authoring typo loud; at runtime, one track on its factory sound beats a
 * half-applied vibe with the transport stopped. `sourcePresetId` then names
 * the sound that is ACTUALLY playing — never the id that failed — because it
 * is display provenance and a lie there is worse than a blank.
 *
 * No Arp is produced here. Arp is performance state and a vibe states it
 * separately, in its own `arp` table; a resolver that returned a patch and an
 * Arp together could not express "change the sound, keep the performance".
 */
export function resolveVibeSynthParams(
  presetId: string,
  target: SynthControlTarget,
): ActiveSynth {
  const preset = presetById(presetId);
  if (!preset) return defaultTrackSynth(target);
  return { engine: preset.engine, patch: structuredClone(preset.patch), sourcePresetId: preset.id };
}

/** Same instant-but-clickless release the hard-stop button uses. */
const VIBE_SWAP_RELEASE = 0.02;

/** Every voice a vibe installs, resolved before any state is touched. */
interface VibeVoices {
  chord: ActiveSynth;
  bass: ActiveSynth;
  synth: ActiveSynth;
  fx: ActiveSynth;
  /** The pad's own settings and its resolved voice, carried together; null = no pad. */
  pad: (NonNullable<ResolvedVibe['pad']> & { params: ActiveSynth }) | null;
}

/**
 * Every voice a vibe installs, resolved before any state is touched: an
 * unknown preset id falls back to the target default, and `resolveVibe`
 * (which does throw) has already run — a swap that writes half a vibe is
 * the failure this ordering exists to prevent.
 */
export function resolveVibeVoices(vibe: ResolvedVibe): VibeVoices {
  return {
    chord: resolveVibeSynthParams(vibe.chordPresetId, 'chord'),
    bass: resolveVibeSynthParams(vibe.bassPresetId, 'bass'),
    synth: resolveVibeSynthParams(vibe.synthPresetId, 'synth'),
    fx: resolveVibeSynthParams(vibe.fxPresetId, 'fx'),
    pad: vibe.pad ? { ...vibe.pad, params: resolveVibeSynthParams(vibe.pad.presetId, 'pad') } : null,
  };
}

/**
 * A draft of the store threaded through the vibe's builders: `put` merges a
 * patch into both the accumulated output and the draft, so every builder sees
 * the effects of the ones before it exactly as the sequential setters did.
 */
interface VibeDraft {
  readonly state: AppStore;
  put(patch: Partial<AppStore>): void;
}

function createVibeDraft(state: AppStore): { draft: VibeDraft; out: Partial<AppStore> } {
  const out: Partial<AppStore> = {};
  let current = state;
  const draft: VibeDraft = {
    get state() {
      return current;
    },
    put(patch) {
      Object.assign(out, patch);
      current = { ...current, ...patch };
    },
  };
  return { draft, out };
}

/** 1. Context & BPM. */
function putVibeContext(d: VibeDraft, vibe: ResolvedVibe): void {
  d.put({ bpm: clampBpm(vibe.bpm) });
  // MUST precede replaceBeatPatternPatch below: that builder adapts the
  // incoming rows to whatever meter the draft holds when it runs, so setting
  // the meter afterwards would leave the grid adapted to the OUTGOING vibe's
  // bar length.
  d.put({ meterId: vibe.meter });
  // Every melody track follows the key, root first then scale. The vibe's
  // chords are NOT harmonized: they were built in this key and are written by
  // the vibe's own chord step. The badge clears — those chords were replaced
  // wholesale, not harmonized.
  d.put(changeKey(d.state, { root: vibe.scaleRoot, scaleType: vibe.scaleType }, { harmonizeChords: false }));
  d.put({ reharmonizedIndicator: false });
  d.put({ selectedVibeId: vibe.id });
  // A SNAPSHOT of the vibe's display name, on the loop being rewritten — not
  // the id, and not a pointer to the entry. Applying a vibe is a bulk setter,
  // not a declaration that the loop IS that genre: the user is free to keep
  // the chords, swap the kit and end up somewhere else, and a stored id would
  // go on claiming an identity the sound has left. Unconditional, so a loop
  // with a user `name` still tracks the last vibe applied behind it.
  d.put(loopTempNamePatch(d.state, d.state.activeLoopId, vibe.name));
}

/** 2. Beat (Sound + Pattern + Drum Filter). */
function putVibeBeat(d: VibeDraft, vibe: ResolvedVibe): void {
  // TWO INDEPENDENT WRITES, in this order. A vibe chooses a sound AND a
  // rhythm, and they are separate state: `beatPresetPatch` installs the named
  // preset's complete patch as `beatParams` and records it as the base, and
  // `replaceBeatPatternPatch` writes the grid's rows. Neither implies the
  // other — the grid's own `beatPresetId` is provenance nothing applies, so
  // picking a grid in the sequencer still changes no sound, and a vibe naming
  // a sound still cannot smuggle a rhythm in behind it.
  //
  // The pattern write REPLACES: a voice the grid does not name is cleared,
  // so a vibe gives you that grid and never that grid plus the last one's
  // leftovers. The clear goes through `writeStepWindow`, so only the active
  // meter's window moves and wider-meter programming past it survives.
  d.put(beatPresetPatch(d.state, vibe.beatPresetId));
  d.put(replaceBeatPatternPatch(d.state, vibe.drumPattern));

  // The filter override, AFTER the preset and never before it: the preset
  // installs a complete patch including its own filter, so an override
  // written first would be the thing the preset overwrote. Only the fields
  // the vibe actually states are written — a vibe that names none leaves the
  // preset's filter exactly as the preset voiced it.
  const beatFilter = {
    ...(vibe.beatFilterCutoff !== undefined && { cutoff: vibe.beatFilterCutoff }),
    ...(vibe.beatFilterResonance !== undefined && { resonance: vibe.beatFilterResonance }),
    ...(vibe.beatFilterType !== undefined && { type: vibe.beatFilterType }),
  };
  if (Object.keys(beatFilter).length > 0) d.put(beatFilterPatch(d.state, beatFilter));
}

/** 3–4. Chords and Bass: pattern, feel, octave, sound and Arp. */
function putVibeAccompaniment(d: VibeDraft, vibe: ResolvedVibe, voices: VibeVoices): void {
  d.put(chordsPatch(d.state, vibe.chords));
  d.put({
    chordRhythmId: vibe.chordRhythmId,
    chordRhythmMode: 'preset',
    chordFeel: vibe.chordFeel,
    chordOctave: vibe.chordOctave,
    chordSynthParams: voices.chord,
    chordArpSettings: structuredClone(vibe.arp.chord),
  });
  d.put({
    bassPatternId: vibe.bassPatternId,
    bassPatternMode: 'preset',
    bassFeel: vibe.bassFeel,
    bassOctave: vibe.bassOctave,
    bassSynthParams: voices.bass,
    bassArpSettings: structuredClone(vibe.arp.bass),
  });
}

/** The pad layer. */
function putVibePad(d: VibeDraft, vibe: ResolvedVibe, pad: VibeVoices['pad']): void {
  // A vibe without a pad mutes the layer and leaves the rest of its settings
  // alone. Muting is reversible and resetting is not: Boom Bap -> Synthwave ->
  // Boom Bap must not erase pad settings the user tuned by hand.
  if (pad) {
    d.put({
      padSynthParams: pad.params,
      padArpSettings: structuredClone(vibe.arp.pad),
      padMode: pad.mode,
      padOctave: pad.octave,
      padVoicing: pad.voicing,
      padDroneDegree: pad.droneDegree,
      // Through normalizePadIntervals, exactly as setPadDroneIntervals writes.
      padDroneIntervals: normalizePadIntervals(pad.droneIntervals),
      // `VibeSpec.pad.volume` is an internal voicing constant (DEV-383's
      // divergence 4) and stays LINEAR like the rest of that family —
      // `padVolume` became a dB fader in DEV-386, so the conversion happens
      // here at the store boundary rather than in `src/data/vibes.ts`, which
      // may not call a resolver.
      padVolume: gainToDb(toLinearGain(pad.volume)),
    });
  }
  // The mute the vibe wants, stated directly rather than as a toggle.
  d.put({ padMuted: !pad });
}

/** 5–6. Main Synth + FX sound presets, then Master Effects. */
function putVibeVoicesAndEffects(d: VibeDraft, vibe: ResolvedVibe, voices: VibeVoices): void {
  // Arp is written beside each patch rather than with it: they are two
  // independent axes of a vibe (design doc, "A Vibe may set all three
  // independently"), which keeps a preset load from ever re-arming the
  // arpeggiator by accident. Cloned, so two loops given the same vibe cannot
  // share one Arp object.
  //
  // A vibe supplies a VOICE, never NOTES: `fxMelodySteps` is deliberately not
  // written here, exactly as `leadMelodySteps` is not (only the key change
  // above moves them). Applying a vibe must never destroy something the user
  // wrote.
  d.put({
    synthParams: voices.synth,
    synthArpSettings: structuredClone(vibe.arp.synth),
    fxSynthParams: voices.fx,
    fxArpSettings: structuredClone(vibe.arp.fx),
  });
  d.put({ effects: { ...d.state.effects, ...vibe.effects } });
}

/**
 * Everything a vibe writes, as ONE patch over `state`. Pure: builders run in
 * the order the old sequential setters did, each over a draft that already
 * holds the ones before it, so the final state is the same while subscribers
 * (engineSync included) see a single write instead of about thirty-five.
 * Exported for tests.
 */
export function vibeContentPatch(
  state: AppStore,
  vibe: ResolvedVibe,
  voices: VibeVoices,
): Partial<AppStore> {
  const { draft, out } = createVibeDraft(state);
  putVibeContext(draft, vibe);
  putVibeBeat(draft, vibe);
  putVibeAccompaniment(draft, vibe, voices);
  putVibePad(draft, vibe, voices.pad);
  putVibeVoicesAndEffects(draft, vibe, voices);
  return out;
}

/**
 * A raw `setState` bypasses the slices' mirroring `set`, so the loops[]
 * mirror is folded in here exactly as `createLoopMirroringSet` does it —
 * building on `patch.loops` when the patch carries one (the temp-name write).
 */
export function withMirror(state: AppStore, patch: Partial<AppStore>): Partial<AppStore> {
  return { ...patch, ...(loopMirrorPartial(state, patch) ?? {}) };
}

/**
 * Every key a vibe patch may write, plus `loops` (the temp name and the
 * mirror) and `selectedVibeId`. The invariant test in vibePreview.test.ts
 * fails on any key a vibe writes that is missing here (R338).
 */
const VIBE_TARGET_KEYS = [
  'bpm', 'meterId', 'scaleRoot', 'scaleType', 'leadMelodySteps', 'fxMelodySteps', 'chords',
  'reharmonizedIndicator', 'selectedVibeId', 'loops', 'beatParams', 'beatPattern',
  'customChordRhythm', 'customChordHoldSteps', 'customChordLoopLength',
  'customBassPattern', 'customBassHoldSteps', 'customBassLoopLength',
  'chordRhythmId', 'chordRhythmMode', 'chordFeel', 'chordOctave', 'chordSynthParams', 'chordArpSettings',
  'bassPatternId', 'bassPatternMode', 'bassFeel', 'bassOctave', 'bassSynthParams', 'bassArpSettings',
  'padSynthParams', 'padArpSettings', 'padMode', 'padOctave', 'padVoicing', 'padDroneDegree',
  'padDroneIntervals', 'padVolume', 'padMuted',
  'synthParams', 'synthArpSettings', 'fxSynthParams', 'fxArpSettings', 'effects',
] as const satisfies readonly (keyof AppStore)[];

/**
 * What Cancel restores (R338): the current value of every vibe target, BY
 * REFERENCE. Safe because persisted values are replaced, never mutated (R210).
 */
export function captureVibeTargets(state: AppStore): Partial<AppStore> {
  return Object.fromEntries(VIBE_TARGET_KEYS.map((key) => [key, state[key]])) as Partial<AppStore>;
}

export function applyVibeToStore(vibe: ResolvedVibe) {
  const store = useAppStore.getState();

  // Resolve every preset id first — see resolveVibeVoices.
  const voices = resolveVibeVoices(vibe);

  // 0. Atomic swap: cut everything still scheduled BEFORE writing the new
  //    chords and patterns, otherwise the old progression's queued voices
  //    ring on top of the new one. A player that was mid-soft-stop counts as
  //    active and comes back — the user changed vibe, they did not cancel.
  // Captured BEFORE hardStopAll below, which resets it to 'none'.
  const scopeBefore = store.playbackScope;
  const wasActive = captureActivePlayers(store);
  store.hardStopAll();
  // The transport transition alone does NOT silence anything: the whole swap
  // runs inside one onClick, React 18 batches it, and the rendered player
  // state goes 'playing' -> 'playing' — so a React effect keyed on it never
  // runs and the queued chord/bass voices sing on over the new vibe.
  // (Measured: React logged a single 'playing' render while the zustand
  // subscription saw 'stopped' then 'playing'.) So cut the sources here,
  // synchronously, where the swap actually happens. store/ -> audio/ is the
  // allowed direction; engineSync.ts reaches the engine the same way.
  // Unconditional: a mid-soft-stop player still has a release pending on the
  // audio clock, and a stopped player may still be ringing out a preview.
  // Drums are fire-and-forget one-shots with no tracked voices — one already
  // scheduled hit can still land, which the spec accepts.
  for (const source of ACCOMPANIMENT_SOURCES) {
    audioEngine.stopSource(source, VIBE_SWAP_RELEASE);
  }

  // 1–6. The vibe's content, in ONE write — after the cut above, so nothing
  // of the old vibe is left queued when the new progression lands. engineSync
  // therefore sees the final state once: the meter reaches the engine with
  // the new grid, and both are read on the next bar.
  useAppStore.setState((s) => withMirror(s, vibeContentPatch(s, vibe, voices)));

  // Restart what was running, in ONE set() that also puts the scope back —
  // see commitRestartAfterStop for the rule and its no-op guard. Both playback
  // hooks arm on `step % stepsPerBar === 0` for the ACTIVE meter, which was
  // just written above, so the restart lands on the next bar by construction — no
  // alignment code needed here.
  //
  // A vibe rewrites the CURRENT loop and never moves activeLoopId, so it
  // always lands on restartAfterStop's "same loop" row: it keeps playing,
  // under the scope it already had. The three play(module) calls this
  // replaces set no scope at all, which is why clicking a vibe mid-playback
  // used to leave every player 'playing' under `none`.
  //
  // activeLoopId is read live rather than captured because the write above
  // does not touch it — the value is the same either way.
  commitRestartAfterStop(scopeBefore, useAppStore.getState().activeLoopId, wasActive);
}

/** Every vibe's id, in table order — the identity set the invariant tests pin against. */
export const VIBE_IDS: string[] = VIBES.map((v) => v.id);
