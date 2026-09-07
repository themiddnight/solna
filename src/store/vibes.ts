/**
 * Turning a VibeSpec into sound.
 *
 * `resolveVibe` is the ONLY place a vibe's library ids become values, and it
 * resolves all of them before it returns anything. That ordering is the same
 * rule applyVibeToStore follows for the three synth presets, and for the same
 * reason: a throw part-way through a swap leaves the store holding half of one
 * vibe and half of another, with the transport stopped.
 */
import type { ChordItem, MasterEffects, SynthParams } from '../types';
import type { VibeSpec } from '../data/vibes';
import { VIBES } from '../data/vibes';
import { audioEngine } from '../audio/engine';
import { ACCOMPANIMENT_SOURCES } from '../audio/playback/playbackEngine';
import { applyPreset, presetById } from '../audio/presetRegistry';
import { progressionById, resolveProgression } from '../audio/chordProgressions';
import { drumGridById } from '../audio/drumGrids';
import { requireEffectChain } from '../audio/effectChains';
import { useAppStore } from './store';
import { INITIAL_SYNTH_PARAMS } from './initialState';

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
 * Resolve one of a vibe's three synth voices from a library preset id.
 *
 * The preset supplies the whole sound, and the `preset` display field is
 * stamped from the resolved entry's own name, so the preset select in
 * ChordView points at what is actually playing.
 *
 * Merge order is load-bearing: INITIAL_SYNTH_PARAMS fills the fields presets
 * omit (the four arp fields; `preset` is set here too but immediately
 * overwritten below with the resolved entry's own name), then the preset
 * overrides the 20 timbre fields. No arp field is ever written here — arp is a performance
 * setting the user drives from the UI, and INITIAL_SYNTH_PARAMS.arpActive is
 * already false, so a vibe never switches it on behind the user's back.
 */
export function resolveVibeSynthParams(presetId: string): SynthParams {
  const preset = presetById(presetId);
  if (!preset) {
    throw new Error(`Vibe references unknown synth preset id: ${presetId}`);
  }
  return applyPreset(INITIAL_SYNTH_PARAMS, preset);
}

/** Same instant-but-clickless release the hard-stop button uses. */
const VIBE_SWAP_RELEASE = 0.02;

export function applyVibeToStore(vibe: ResolvedVibe) {
  const store = useAppStore.getState();

  // Resolve all three preset ids first: resolveVibeSynthParams throws on an
  // unknown id, and doing that before any state is touched keeps a typo'd
  // preset id from throwing mid-swap and leaving the transport stopped with
  // the store holding a mix of two vibes.
  const finalChordSynthParams = resolveVibeSynthParams(vibe.chordPresetId);
  const finalBassSynthParams = resolveVibeSynthParams(vibe.bassPresetId);
  const finalSynthParams = resolveVibeSynthParams(vibe.synthPresetId);
  // The pad's own settings and its resolved voice, carried together so the
  // write block below reads one object instead of a vibe field and a parallel
  // nullable params variable that must be null-checked in lockstep with it.
  const pad = vibe.pad ? { ...vibe.pad, params: resolveVibeSynthParams(vibe.pad.presetId) } : null;

  // 0. Atomic swap: cut everything still scheduled BEFORE writing the new
  //    chords and patterns, otherwise the old progression's queued voices
  //    ring on top of the new one. A player that was mid-soft-stop counts as
  //    active and comes back — the user changed vibe, they did not cancel.
  const wasActive = {
    sequencer: store.sequencerPlayer !== 'stopped',
    chords: store.chordsPlayer !== 'stopped',
    lead: store.leadPlayer !== 'stopped',
  };
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

  // 4. Bass Pattern & Feel (Tight/Loose) & Sound Preset
  store.setBassPatternId(vibe.bassPatternId);
  store.setBassPatternMode('preset');
  store.setBassFeel(vibe.bassFeel);
  store.setBassOctave(vibe.bassOctave);
  store.setBassSynthParams(finalBassSynthParams);

  // A vibe without a pad mutes the layer and leaves the rest of its settings
  // alone. Muting is reversible and resetting is not: Boom Bap -> Synthwave ->
  // Boom Bap must not erase pad settings the user tuned by hand.
  if (pad) {
    store.setPadSynthParams(pad.params);
    store.setPadMode(pad.mode);
    store.setPadOctave(pad.octave);
    store.setPadVoicing(pad.voicing);
    store.setPadDroneDegree(pad.droneDegree);
    store.setPadDroneIntervals(pad.droneIntervals);
    store.setPadVolume(pad.volume);
  }
  // Mute is a toggle, not a setter, so it is expressed as "the state the vibe
  // wants" and only touched when it differs — read live, because the setters
  // above may have run in between.
  const wantMuted = !pad;
  if (useAppStore.getState().padMuted !== wantMuted) store.togglePadMuted();

  // 5. Main Synth Sound Preset
  store.setSynthParams(finalSynthParams);

  // 6. Master Effects
  store.setEffects({
    ...store.effects,
    ...vibe.effects,
  });

  // Restart only what was running. Both playback hooks arm on
  // `step % stepsPerBar === 0` for the ACTIVE meter, which was just set above,
  // so the restart lands on the next bar by construction — no alignment code
  // needed here.
  if (wasActive.sequencer) store.play('sequencer');
  if (wasActive.chords) store.play('chords');
  if (wasActive.lead) store.play('lead');
}

/** Every vibe's id, in table order — the identity set the invariant tests pin against. */
export const VIBE_IDS: string[] = VIBES.map((v) => v.id);
