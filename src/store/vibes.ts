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
    // The vibe's OWN key, scale and octave, by construction. These used to be
    // three literals written beside the id, and a mismatch changed what the
    // vibe sounded like without changing progressionId.
    chords: resolveProgression(progression, spec.scaleRoot, spec.scaleType, spec.chordOctave),
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

export function applyVibeToStore(vibe: ResolvedVibe) {
  const store = useAppStore.getState();

  // Resolve every preset id first. It no longer throws — an unknown id falls
  // back to the target default — but resolving before any state is touched is
  // still the rule: `resolveVibe` above DOES throw on an unknown progression,
  // grid or effect chain, and a swap that writes half a vibe is the failure
  // all of that ordering exists to prevent.
  const finalChordSynthParams = resolveVibeSynthParams(vibe.chordPresetId, 'chord');
  const finalBassSynthParams = resolveVibeSynthParams(vibe.bassPresetId, 'bass');
  const finalSynthParams = resolveVibeSynthParams(vibe.synthPresetId, 'synth');
  const finalFxSynthParams = resolveVibeSynthParams(vibe.fxPresetId, 'fx');
  // The pad's own settings and its resolved voice, carried together so the
  // write block below reads one object instead of a vibe field and a parallel
  // nullable params variable that must be null-checked in lockstep with it.
  const pad = vibe.pad ? { ...vibe.pad, params: resolveVibeSynthParams(vibe.pad.presetId, 'pad') } : null;

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

  // 1. Context & BPM
  store.setBpm(vibe.bpm);
  // MUST precede replaceDrumPattern below: that action adapts the incoming rows
  // to whatever meter is active when it runs, so setting the meter afterwards
  // would leave the grid adapted to the OUTGOING vibe's bar length.
  store.setMeter(vibe.meter);
  store.setScaleRoot(vibe.scaleRoot);
  store.setScaleType(vibe.scaleType);
  store.setSelectedVibeId(vibe.id);
  // A SNAPSHOT of the vibe's display name, on the loop being rewritten — not
  // the id, and not a pointer to the entry. Applying a vibe is a bulk setter,
  // not a declaration that the loop IS that genre: the user is free to keep
  // the chords, swap the kit and end up somewhere else, and a stored id would
  // go on claiming an identity the sound has left. Unconditional, so a loop
  // with a user `name` still tracks the last vibe applied behind it.
  store.setLoopTempName(store.activeLoopId, vibe.name);

  // 2. Drums & Sequencer (Pattern + Sound Kit + Drum Filter)
  store.setSoundKit(vibe.soundKit);
  store.replaceDrumPattern(vibe.drumPattern);

  if (vibe.drumFilterCutoff !== undefined) {
    store.setDrumFilterCutoff(vibe.drumFilterCutoff);
  }
  if (vibe.drumFilterResonance !== undefined) {
    store.setDrumFilterResonance(vibe.drumFilterResonance);
  }
  if (vibe.drumFilterType !== undefined) {
    store.setDrumFilterType(vibe.drumFilterType);
  }

  // 3. Chords & Rhythm Pattern & Feel (Tight/Loose) & Sound Preset
  store.setChords(vibe.chords);
  store.setChordRhythmId(vibe.chordRhythmId);
  store.setChordRhythmMode('preset');
  store.setChordFeel(vibe.chordFeel);
  store.setChordOctave(vibe.chordOctave);
  store.setChordSynthParams(finalChordSynthParams);
  store.setChordArpSettings(structuredClone(vibe.arp.chord));

  // 4. Bass Pattern & Feel (Tight/Loose) & Sound Preset
  store.setBassPatternId(vibe.bassPatternId);
  store.setBassPatternMode('preset');
  store.setBassFeel(vibe.bassFeel);
  store.setBassOctave(vibe.bassOctave);
  store.setBassSynthParams(finalBassSynthParams);
  store.setBassArpSettings(structuredClone(vibe.arp.bass));

  // A vibe without a pad mutes the layer and leaves the rest of its settings
  // alone. Muting is reversible and resetting is not: Boom Bap -> Synthwave ->
  // Boom Bap must not erase pad settings the user tuned by hand.
  if (pad) {
    store.setPadSynthParams(pad.params);
    store.setPadArpSettings(structuredClone(vibe.arp.pad));
    store.setPadMode(pad.mode);
    store.setPadOctave(pad.octave);
    store.setPadVoicing(pad.voicing);
    store.setPadDroneDegree(pad.droneDegree);
    store.setPadDroneIntervals(pad.droneIntervals);
    // `VibeSpec.pad.volume` is an internal voicing constant (DEV-383's divergence 4)
    // and stays LINEAR like the rest of that family — `padVolume` became a dB fader
    // in DEV-386, so the conversion happens here at the store boundary rather than
    // in `src/data/vibes.ts`, which may not call a resolver.
    store.setPadVolume(gainToDb(toLinearGain(pad.volume)));
  }
  // Mute is a toggle, not a setter, so it is expressed as "the state the vibe
  // wants" and only touched when it differs — read live, because the setters
  // above may have run in between.
  const wantMuted = !pad;
  if (useAppStore.getState().padMuted !== wantMuted) store.togglePadMuted();

  // 5. Main Synth + FX Sound Presets
  //
  // Arp is written beside each patch rather than with it: they are two
  // independent axes of a vibe (design doc, "A Vibe may set all three
  // independently"), and the two setters keep a preset load from ever
  // re-arming the arpeggiator by accident. Cloned, so two loops given the
  // same vibe cannot share one Arp object.
  store.setSynthParams(finalSynthParams);
  store.setSynthArpSettings(structuredClone(vibe.arp.synth));
  // A vibe supplies a VOICE, never NOTES: `fxMelodySteps` is deliberately not
  // written here, exactly as `leadMelodySteps` is not. Applying a vibe must
  // never destroy something the user wrote.
  store.setFxSynthParams(finalFxSynthParams);
  store.setFxArpSettings(structuredClone(vibe.arp.fx));

  // 6. Master Effects
  store.setEffects({
    ...store.effects,
    ...vibe.effects,
  });

  // Restart what was running, in ONE set() that also puts the scope back —
  // see commitRestartAfterStop for the rule and its no-op guard. Both playback
  // hooks arm on `step % stepsPerBar === 0` for the ACTIVE meter, which was
  // just set above, so the restart lands on the next bar by construction — no
  // alignment code needed here.
  //
  // A vibe rewrites the CURRENT loop and never moves activeLoopId, so it
  // always lands on restartAfterStop's "same loop" row: it keeps playing,
  // under the scope it already had. The three play(module) calls this
  // replaces set no scope at all, which is why clicking a vibe mid-playback
  // used to leave every player 'playing' under `none`.
  //
  // activeLoopId is read live rather than captured because the setters above
  // do not touch it — the value is the same either way.
  commitRestartAfterStop(scopeBefore, useAppStore.getState().activeLoopId, wasActive);
}

/** Every vibe's id, in table order — the identity set the invariant tests pin against. */
export const VIBE_IDS: string[] = VIBES.map((v) => v.id);
