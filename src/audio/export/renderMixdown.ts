/**
 * The offline mixdown renderer.
 *
 * Binds a throwaway engine to an `OfflineAudioContext`, applies the snapshot
 * through the engine's own public setters, walks the arrangement driving the
 * SAME pure step functions the live clock drives, and hands back an encoded
 * WAV. The realtime singleton, the shared clock and the transport are not
 * involved and are not disturbed: an export is a side effect on a file, not
 * on the session.
 *
 * Imports only src/data/, src/utils/ and src/audio/ — no store, no component,
 * not even a type: the eslint block covering src/audio/** has no
 * allowTypeImports exemption. Everything the render reads arrives in the
 * snapshot, which is why `MixdownLoop` below names the fields this module
 * reads rather than importing the store's `ProjectLoop`. The store enriches
 * each project loop with its source-bus mixer at that boundary; every other
 * field remains the flat project-content shape.
 *
 * Two consequences of the offline clock, both deliberate:
 *
 *  - Source-bus gain/mute and drum-filter cutoff/resonance are scheduled at
 *    every loop boundary, matching the per-loop state live song mode installs
 *    as it advances. Drum track faders are still applied once; BiquadFilter
 *    `type` is not an AudioParam and therefore cannot be time-automated.
 *  - `updateSynthPatch` is not called at all: it only reshapes voices that
 *    are already live, and there are none before the first note. Each voice
 *    gets its params at trigger time, which is where they come from anyway.
 */
import { createRenderEngine, type AudioEngine } from '../engine';
import { type LeadNote } from '../leadMelody';
import { emitStepEvents, playFullHoldChord } from '../playback/chordPlayback';
import { planPadArm, type PadPlanSnapshot } from '../playback/plan/padPlan';
import {
  planChordArm,
  planChordStep,
  type ArmedChordPlan,
  type ChordPlanSnapshot,
} from '../playback/plan/chordPlan';
import { planMelodyStep, type MelodyPlanSnapshot } from '../playback/plan/melodyPlan';
import { MIXDOWN_SEED, withSeededRandom } from '../rng';
import { DEFAULT_VELOCITY } from '../constants';
import { loopDwellSteps, loopEffectiveLengthSteps } from '@/utils/songStructure';
import { noteFrequency, stepDurationSec } from '@/utils/musicTheory';
import { TICKS_PER_SIXTEENTH, type LeadStepResolutionId } from '@/utils/stepResolution';
import { getMeter, type MeterId } from '@/utils/meter';
import { encodeWav } from '@/utils/encodeWav';
import type { BassStepChoice } from '@/data/bassPatterns';
import { applyBeatParams } from '../beatAdapter';
import { beatStepEvents } from '../beatSteps';
import type {
  BeatMix,
  BeatParams,
  BeatPattern,
  BeatVoiceId,
  ChordItem,
  MasterEffects,
  PadInterval,
  PadMode,
  PadVoicing,
} from '@/types';
import type { ActiveSynth, ArpSettings } from '@/types/synth';
import { synthReleaseSeconds } from '@/utils/synthPatch';

export const MIXDOWN_SAMPLE_RATE = 44100;
const MIXDOWN_CHANNELS = 2;
/** The floor on the tail: release + reverb. Never shorter than this. */
const MIXDOWN_TAIL_SEC = 2;

/** One source bus, its gain already converted from the store's dB to linear. */
interface MixdownBusState {
  source: string;
  gain: number;
  muted: boolean;
}

/**
 * One Beat voice's fader, already converted from the store's dB to linear at
 * the slice boundary, with the voice's MUTE folded in as a gain of 0 — the
 * same one-line rule `engineSync.ts` applies live, so the exported mix and the
 * monitored one cannot drift apart.
 */
interface MixdownBeatVoiceGain {
  voice: BeatVoiceId;
  gain: number;
}

/**
 * One melody track as the renderer holds it: the planner's snapshot plus the
 * two things the planner must not know about — the patch to play it with and
 * the bus to play it on. Built by `mixdownLeadTrack` / `mixdownFxTrack`
 * below, because the store spells the Lead row irregularly (`synthParams`,
 * not `leadSynthParams`) and that irregularity is exactly what
 * `MELODY_TRACKS` exists to encode — a table this module may not import.
 */
interface MixdownMelodyTrack extends MelodyPlanSnapshot {
  params: ActiveSynth;
  source: string;
}

export function mixdownLeadTrack(loop: MixdownLoop): MixdownMelodyTrack {
  return {
    steps: loop.leadMelodySteps,
    loopLength: loop.leadLoopLength,
    stepResolution: loop.leadStepResolution,
    gate: loop.leadGate,
    params: loop.synthParams,
    arp: loop.synthArpSettings,
    source: 'synth',
  };
}

export function mixdownFxTrack(loop: MixdownLoop): MixdownMelodyTrack {
  return {
    steps: loop.fxMelodySteps,
    loopLength: loop.fxLoopLength,
    stepResolution: loop.fxStepResolution,
    gate: loop.fxGate,
    params: loop.fxSynthParams,
    arp: loop.fxArpSettings,
    source: 'fx',
  };
}

/**
 * One loop of the arrangement, structurally: the per-loop columns this module
 * reads, named exactly as `ProjectLoop` names them (`src/store/projectFormat.ts`).
 *
 * Deliberately the flat store names rather than a nested, renderer-shaped
 * restatement, except for `buses`: that is the store→audio conversion seam
 * where persisted dB becomes linear gain. The slice spreads each project
 * loop and adds only that derived row set, so the musical content is not
 * hand-mapped field by field.
 */
export interface MixdownLoop {
  id: string;
  repeatCount?: number;
  scaleRoot: string;
  scaleType: string;
  chords: ChordItem[];
  synthParams: ActiveSynth;
  chordSynthParams: ActiveSynth;
  bassSynthParams: ActiveSynth;
  padSynthParams: ActiveSynth;
  fxSynthParams: ActiveSynth;
  synthArpSettings: ArpSettings;
  chordArpSettings: ArpSettings;
  bassArpSettings: ArpSettings;
  padArpSettings: ArpSettings;
  fxArpSettings: ArpSettings;
  chordRhythmId: string;
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  /**
   * The custom chord lane's OWN cycle, in bars, and its holds. The renderer
   * resolves the lane's cycle from these — `src/audio/` may not reach back
   * into the store for them, so the snapshot carries them like any other loop
   * field.
   */
  customChordLoopLength: number;
  customChordHoldSteps: number[];
  chordFeel: number;
  chordOctave: number;
  bassPatternId: string;
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
  /** The bass lane's own cycle. See `customChordLoopLength`. */
  customBassLoopLength: number;
  customBassHoldSteps: number[];
  bassFeel: number;
  bassOctave: number;
  padMode: PadMode;
  padOctave: number;
  padVoicing: PadVoicing;
  padDroneDegree: number;
  padDroneIntervals: PadInterval[];
  /**
   * The Beat instrument, per loop: the sound, the events and the mix.
   *
   * `beatParams` and `beatPattern` are the store's own shapes. `beatMix` is
   * too, and the renderer reads only its per-voice MUTE flags — the dB in it
   * is never read here, because the levels arrive already converted as
   * `beatVoiceGains` and the bus level arrives in `buses`. Two fields rather
   * than one because the mute is a SCHEDULING decision (`beatStepEvents`
   * builds no voice for a muted row) while the level is an AudioParam.
   */
  beatParams: BeatParams;
  beatPattern: BeatPattern;
  beatMix: BeatMix;
  beatVoiceGains: MixdownBeatVoiceGain[];
  leadMelodySteps: LeadNote[][];
  leadLoopLength: number;
  leadStepResolution: LeadStepResolutionId;
  leadGate: number;
  fxMelodySteps: LeadNote[][];
  fxLoopLength: number;
  fxStepResolution: LeadStepResolutionId;
  fxGate: number;
  /** Per-loop source mixer, converted to linear gain by the store boundary. */
  buses: MixdownBusState[];
}

export interface MixdownSnapshot {
  bpm: number;
  meterId: MeterId;
  /** Resolved from `meterId` before it crosses the seam, so the renderer never parses a meter string. */
  stepsPerBar: number;
  /** Linear gain. */
  masterVolume: number;
  effects: MasterEffects;
  buses: MixdownBusState[];
  /**
   * There is no arrangement-wide Beat here, deliberately: a Beat belongs to a
   * LOOP, and a single snapshot-level kit is precisely the defect this
   * replaced — a song whose second loop used a different Beat exported the
   * first loop's sound over the whole arrangement.
   */
  loops: MixdownLoop[];
}

/**
 * Why a render produced no file. A union rather than a string so the slice's
 * `projectNotice` sentence is a switch the compiler checks, and so a test can
 * assert the reason without matching prose.
 */
export type MixdownFailureReason =
  | { kind: 'empty-arrangement' }
  | { kind: 'unsupported-context' }
  | { kind: 'cancelled' }
  | { kind: 'render-failed'; detail: string };

/**
 * The buffer is returned BESIDE the blob, not instead of it: the spec's own
 * assertions (channel count, exact length, non-silence) are only writable
 * against samples, and the encode has to sit inside the same `try` that turns
 * a throw into a failed result.
 */
export type MixdownRenderResult =
  | { ok: true; buffer: AudioBuffer; blob: Blob }
  | { ok: false; reason: MixdownFailureReason };

/** One loop's dwell in the arrangement, as a range of absolute steps. */
interface ArrangementPass {
  loopIndex: number;
  startStep: number;
  /** One pass: the loop's own length, floored at a bar for a chordless loop. */
  passSteps: number;
  /** The whole loop: `passSteps × repeats`. */
  dwellSteps: number;
}

export interface ArrangementPlan {
  totalSteps: number;
  passes: ArrangementPass[];
}

export interface LoopAudioAutomation {
  loopIndex: number;
  time: number;
  buses: MixdownBusState[];
  beatParams: BeatParams;
  beatVoiceGains: MixdownBeatVoiceGain[];
}

/**
 * Every pass of every loop, in order, as absolute step ranges.
 *
 * `loopDwellSteps` is the loop's TOTAL dwell (`passSteps × repeats`) — it is
 * `songAdvanceDecision`'s own `totalSteps`, deliberately, so the walk the
 * renderer performs and the decision the live transport makes are the same
 * arithmetic. The walk therefore iterates `dwellSteps` ONCE and derives a
 * pass-relative index as `i % passSteps`; iterating `repeats × dwell` would
 * schedule `repeats²` passes, and the repeats past the first would render
 * silent because `chordPlanPosition`'s equivalent — the `chordsByBar` lookup
 * below — would run out of bars.
 */
export function planArrangement(snapshot: MixdownSnapshot): ArrangementPlan {
  const passes: ArrangementPass[] = [];
  let step = 0;
  for (let loopIndex = 0; loopIndex < snapshot.loops.length; loopIndex += 1) {
    const loop = snapshot.loops[loopIndex];
    const passSteps = loopEffectiveLengthSteps(loop.chords, snapshot.stepsPerBar);
    const dwellSteps = loopDwellSteps(loop, snapshot.stepsPerBar);
    passes.push({ loopIndex, startStep: step, passSteps, dwellSteps });
    step += dwellSteps;
  }
  return { totalSteps: step, passes };
}

/** Per-loop mixer/filter changes positioned on the offline audio timeline. */
export function planLoopAudioAutomation(
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
): LoopAudioAutomation[] {
  const stepDur = stepDurationSec(snapshot.bpm);
  return plan.passes.map((pass) => ({
    loopIndex: pass.loopIndex,
    time: pass.startStep * stepDur,
    buses: snapshot.loops[pass.loopIndex].buses,
    beatParams: snapshot.loops[pass.loopIndex].beatParams,
    beatVoiceGains: snapshot.loops[pass.loopIndex].beatVoiceGains,
  }));
}

/**
 * One loop's chord/bass material, pre-resolved per chord: the SAME
 * `ArmedChordPlan` the live scheduler arms, one per chord, built once per pass
 * instead of on a clock tick.
 */
export interface LoopVoices {
  /** Pass bar -> the index of the chord covering it. */
  chordsByBar: number[];
  /** Per chord: the pass-relative step it starts on. */
  chordStartStep: number[];
  /** Per chord: its armed plan. */
  plans: ArmedChordPlan[];
}

/**
 * The pad lane's snapshot for one loop — the offline twin of
 * `padPlanSnapshot` (src/store/playbackPlanSnapshots.ts). Both feed the same
 * `planPadArm`, so an export and a live session can only disagree about the pad
 * if these two builders disagree, which renderMixdown.test.ts pins directly.
 */
export function padSnapshotForLoop(
  loop: MixdownLoop,
  bpm: number,
  stepsPerBar: number,
): PadPlanSnapshot {
  return {
    mode: loop.padMode,
    chords: loop.chords,
    degree: loop.padDroneDegree,
    intervals: loop.padDroneIntervals,
    padOctave: loop.padOctave,
    voicing: loop.padVoicing,
    scaleRoot: loop.scaleRoot,
    scaleType: loop.scaleType,
    bpm,
    stepsPerBar,
  };
}

/**
 * The chord+bass ARM-time snapshot for one loop — the offline twin of
 * `chordPlanSnapshot` (src/store/playbackPlanSnapshots.ts).
 *
 * `src/audio/` may not reach into the store, so every field arrives on the
 * MixdownLoop; the names match the store's on purpose, so the two builders read
 * as the same list and an equivalence test is a deep-equality assertion.
 */
export function chordSnapshotForLoop(
  loop: MixdownLoop,
  meterId: MeterId,
  bpm: number,
  stepsPerBar: number,
): ChordPlanSnapshot {
  return {
    chords: loop.chords,
    bpm,
    meterId,
    stepsPerBar,
    chordOctave: loop.chordOctave,
    bassOctave: loop.bassOctave,
    scaleRoot: loop.scaleRoot,
    scaleType: loop.scaleType,
    chordRhythmMode: loop.chordRhythmMode,
    chordRhythmId: loop.chordRhythmId,
    customChordRhythm: loop.customChordRhythm,
    customChordHoldSteps: loop.customChordHoldSteps,
    customChordLoopLength: loop.customChordLoopLength,
    chordFeel: loop.chordFeel,
    bassPatternMode: loop.bassPatternMode,
    bassPatternId: loop.bassPatternId,
    customBassPattern: loop.customBassPattern,
    customBassHoldSteps: loop.customBassHoldSteps,
    customBassLoopLength: loop.customBassLoopLength,
    bassFeel: loop.bassFeel,
    chordArpActive: loop.chordArpSettings.active,
    bassArpActive: loop.bassArpSettings.active,
  };
}

export function buildLoopVoices(
  loop: MixdownLoop,
  meterId: MeterId,
  bpm: number,
  stepsPerBar: number,
): LoopVoices {
  const snapshot = chordSnapshotForLoop(loop, meterId, bpm, stepsPerBar);
  const chordsByBar: number[] = [];
  const chordStartStep: number[] = [];
  const plans: ArmedChordPlan[] = [];

  let barCursor = 0;
  for (let i = 0; i < loop.chords.length; i += 1) {
    const bars = Math.max(1, loop.chords[i].bars || 1);
    const startStep = barCursor * stepsPerBar;
    chordStartStep.push(startStep);
    for (let b = 0; b < bars; b += 1) chordsByBar.push(i);
    barCursor += bars;
    // A pass restarts the progression, so a pass-relative step IS the
    // progression-relative step live playback measures from its run origin —
    // which is why the same `startProgressionStep` works for both.
    plans.push(planChordArm(snapshot, { chordIndex: i, startProgressionStep: startStep }));
  }
  return { chordsByBar, chordStartStep, plans };
}

/**
 * Settles the graph from the snapshot, in the order `applySliceState`
 * (src/store/engineSync.ts) uses, so an export is configured by the same
 * call sequence a live session uses rather than a parallel one.
 *
 * `time` 0 on the two bus setters: an offline render has no "now" to
 * automate against, and passing 0 makes the bus state settled before the
 * first event instead of ramping into it.
 */
function applyMasterState(engine: AudioEngine, snapshot: MixdownSnapshot): void {
  engine.setClockBpm(snapshot.bpm);
  engine.setMeter(getMeter(snapshot.meterId));
  engine.setMasterVolume(snapshot.masterVolume);
  for (const bus of snapshot.buses) {
    engine.setSourceGain(bus.source, bus.gain, 0);
    engine.setSourceMuted(bus.source, bus.muted, 0);
  }
  // No Beat here: every loop installs its own at its pass boundary below, so
  // there is nothing arrangement-wide left to settle.
  engine.updateEffects(snapshot.effects);
  engine.setReverbDecay(snapshot.effects.reverbDecay);
}

/** Install per-loop audio state at the same boundary where live song mode loads the loop. */
function applyLoopAudioState(engine: AudioEngine, state: LoopAudioAutomation): void {
  for (const bus of state.buses) {
    engine.setSourceGain(bus.source, bus.gain, state.time);
    engine.setSourceMuted(bus.source, bus.muted, state.time);
  }
  // The Beat patch, BEFORE this pass schedules a single hit: a drum voice is
  // built from the kit installed at the moment it is scheduled, so a patch
  // applied after the walk has passed is a patch nothing in this loop plays.
  // The bus filter inside it carries the pass time on every axis, INCLUDING
  // its response type: `BiquadFilterNode.type` is a plain field and cannot be
  // scheduled, so the filter is a three-lane bank of fixed-type biquads whose
  // GAINS (real AudioParams) crossfade — see `BeatFilterLane` in masterRack.ts.
  // Before that, every pass here wrote `.type` directly and the last one won
  // for the whole render, because these calls all happen before
  // `ctx.startRendering()`. The voices are plain fields, which is fine: they
  // are read by the next `triggerDrum`, and those run at schedule time too.
  applyBeatParams(engine, state.beatParams, state.time);
  for (const { voice, gain } of state.beatVoiceGains) {
    engine.setDrumTrackGain(voice, gain, state.time);
  }
}

/**
 * One melody track's material at one PASS-RELATIVE step, at an explicit
 * absolute time.
 *
 * This used to be a transcription of the live hook's clock callback — the same
 * three-function chain written twice, free to diverge. Both now call
 * `planMelodyStep`; what is left here is the render's half: the time, the patch
 * and the engine.
 */
function scheduleMelodyStep(
  engine: AudioEngine,
  track: MixdownMelodyTrack,
  stepInPass: number,
  stepsPerBar: number,
  tickDur: number,
  time: number,
): void {
  const planned = planMelodyStep(track, {
    stepInLoop: stepInPass,
    stepsPerBar,
    tickDurSec: tickDur,
  });
  for (const note of planned) {
    const start = time + note.startOffsetSec;
    const voiceId = engine.triggerSynthNoteOn(
      noteFrequency(note.note), track.params, DEFAULT_VELOCITY, start, track.source, 1, 'sequencer',
    );
    if (voiceId) {
      engine.triggerSynthNoteOff(voiceId, synthReleaseSeconds(track.params), start + note.holdSec);
    }
  }
}

function scheduleArrangement(
  engine: AudioEngine,
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
): void {
  const stepDur = stepDurationSec(snapshot.bpm);
  const tickDur = stepDur / TICKS_PER_SIXTEENTH;
  const { stepsPerBar, meterId } = snapshot;
  const loopAutomation = planLoopAudioAutomation(snapshot, plan);

  for (let passIndex = 0; passIndex < plan.passes.length; passIndex += 1) {
    const pass = plan.passes[passIndex];
    const loop = snapshot.loops[pass.loopIndex];
    applyLoopAudioState(engine, loopAutomation[passIndex]);
    const voices = buildLoopVoices(loop, meterId, snapshot.bpm, stepsPerBar);
    // A chordless loop dwells its bar(s) and plays no chord, bass or pad: the
    // guard below reads this once per pass and skips that whole block, so the
    // walk never dereferences the chord arrays (which are empty for it).
    const chordless = loop.chords.length === 0;
    // Built once per pass, not once per step: the walk runs for every step of
    // every repeat, and two fresh objects per step is garbage the render pays
    // for and nobody reads.
    const leadTrack = mixdownLeadTrack(loop);
    const fxTrack = mixdownFxTrack(loop);
    const padSnapshot = padSnapshotForLoop(loop, snapshot.bpm, stepsPerBar);

    for (let i = 0; i < pass.dwellSteps; i += 1) {
      // Pass-relative, so repeats 2..n reset the chord plan exactly as a live
      // loop restart does. See planArrangement's docblock: the dwell already
      // counts the repeats, so this is NOT a repeat loop.
      const stepInPass = i % pass.passSteps;
      const step = pass.startStep + i;
      const time = step * stepDur;
      const stepInBar = stepInPass % stepsPerBar;
      const barInPass = Math.floor(stepInPass / stepsPerBar);

      // The Beat, through the SAME pure decision the live stepper uses: one
      // function answers "what sounds at this step" for both, so an export can
      // never disagree with what the grid played. The per-voice mute is
      // honoured inside it; solo is not, and must not be — solo is a
      // session-only monitoring gesture and never reaches an export.
      for (const event of beatStepEvents(loop.beatPattern, loop.beatMix, stepInBar)) {
        engine.triggerDrum(event.voice, DEFAULT_VELOCITY, time);
      }

      if (!chordless) {
        const chordIndex = voices.chordsByBar[barInPass];
        const plan = voices.plans[chordIndex];
        const stepsIntoChord = stepInPass - voices.chordStartStep[chordIndex];
        const chordSteps = plan.totalBars * stepsPerBar;
        const chordEnd = time + (chordSteps - stepsIntoChord) * stepDur;
        const isLastBar = Math.floor(stepsIntoChord / stepsPerBar) === plan.totalBars - 1;

        // The full holds arm once, on the chord's own first step. Both lanes
        // report empty events when they hold, so the per-step emit below is a
        // no-op for them rather than a branch.
        if (stepsIntoChord === 0 && plan.chordFullHold) {
          playFullHoldChord(
            plan.chordFullHold.notes,
            loop.chordSynthParams,
            time,
            plan.chordFullHold.holdSec,
            'chord',
            engine,
          );
        }
        if (stepsIntoChord === 0 && plan.bassFullHold) {
          const voiceId = engine.triggerSynthNoteOn(
            noteFrequency(plan.bassFullHold.noteName), loop.bassSynthParams, plan.bassFullHold.velocity,
            time, 'bass', 1, 'sequencer',
          );
          if (voiceId) {
            engine.triggerSynthNoteOff(
              voiceId,
              synthReleaseSeconds(loop.bassSynthParams),
              time + plan.bassFullHold.holdSec,
            );
          }
        }

        // The SAME step decision the live scheduler makes, at the same
        // progression-relative step.
        const events = planChordStep(plan, {
          progressionStep: stepInPass,
          step,
          isLastBar,
          stepsPerBar,
          stepDurSec: stepDur,
          chordArp: loop.chordArpSettings,
          bassArp: loop.bassArpSettings,
          chordFeel: loop.chordFeel,
          bassFeel: loop.bassFeel,
        });
        emitStepEvents(events.chord, loop.chordSynthParams, 'chord', time, chordEnd, engine);
        emitStepEvents(events.bass, loop.bassSynthParams, 'bass', time, chordEnd, engine);

        // Pad, through the SAME planner the live hook arms with. `chordIndex`
        // carries what `isLoopStart` used to: the pad block only runs at
        // `stepsIntoChord === 0`, and chord 0 starts at step 0 of the pass, so
        // `chordIndex === 0` there is exactly the old `stepInPass === 0`.
        if (stepsIntoChord === 0) {
          const arm = planPadArm(padSnapshot, { chordIndex });
          if (arm) {
            playFullHoldChord(arm.notes, loop.padSynthParams, time, arm.holdSec, 'pad', engine);
          }
        }
      }

      // Melody tracks run whether or not the loop has chords: a lead over a
      // chordless loop is a real thing, and the grid's own loop length is what
      // decides its material. No `stepInBar < stepsPerBar` guard here —
      // `stepInBar` IS a modulo by `stepsPerBar`, so such a guard is a
      // tautology, and the melody's own windowing already happens inside
      // leadActivePosAt/leadSoundingNotes.
      scheduleMelodyStep(engine, leadTrack, stepInPass, stepsPerBar, tickDur, time);
      scheduleMelodyStep(engine, fxTrack, stepInPass, stepsPerBar, tickDur, time);
    }
  }
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export type MixdownRenderProgress =
  | { phase: 'preparing' }
  | { phase: 'rendering'; percent: number }
  | { phase: 'encoding' };

export type MixdownProgressReporter = (progress: MixdownRenderProgress) => void;

/** A progress observer must never be able to turn a valid render into a failure. */
function safeProgressReporter(reporter?: MixdownProgressReporter): MixdownProgressReporter {
  return (progress) => {
    try {
      reporter?.(progress);
    } catch {
      // Reporting is best-effort; the audio render remains authoritative.
    }
  };
}

/**
 * Pause the offline timeline at two-percent checkpoints, publish its position,
 * then immediately resume. Older implementations without suspend/resume simply
 * keep the indeterminate spinner shown by the caller.
 */
function scheduleProgressCheckpoints(
  ctx: OfflineAudioContext,
  report: MixdownProgressReporter,
): void {
  if (typeof ctx.suspend !== 'function' || typeof ctx.resume !== 'function') return;

  const duration = ctx.length / ctx.sampleRate;
  for (let timelinePercent = 2; timelinePercent < 100; timelinePercent += 2) {
    const ratio = timelinePercent / 100;
    void ctx
      .suspend(duration * ratio)
      .then(() => {
        report({ phase: 'rendering', percent: timelinePercent });
        return ctx.resume();
      })
      .catch(() => {
        // A rejected checkpoint is a progress degradation, not a render error.
      });
  }
}

/**
 * The offline context constructor, or null. A capability probe, like the File
 * System Access API path: a device without one is a degraded state the UI
 * renders, never an exception path. Read off `globalThis` and tested for
 * presence rather than caught from a `new`, so nothing has to be constructed
 * to find out.
 */
function offlineContextCtor(): OfflineCtor | null {
  const g = globalThis as {
    OfflineAudioContext?: OfflineCtor;
    webkitOfflineAudioContext?: OfflineCtor;
  };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

/**
 * Renders the arrangement to a WAV. NEVER THROWS.
 *
 * The one `try` covers the context construction, the encode and the render
 * itself, so a failure anywhere becomes a failed result with a reason rather
 * than an unhandled rejection crossing into a click handler with no message
 * for the user.
 *
 * The seeded generator is installed for the whole graph-building phase — the
 * engine construction (`setupMasterChain` builds the reverb impulse at the
 * DEFAULT decay 2.0), the master-state settle and the scheduling walk —
 * because the reverb impulse, the noise-voice buffers and the arp's `'random'`
 * note order all read from it as they are created, which happens while the
 * graph is being built and not while it renders. It is restored in a `finally`
 * on every exit path, including the throwing one, so a leaked source cannot
 * make the rest of the session reproducible.
 */
export async function renderMixdown(
  snapshot: MixdownSnapshot,
  onProgress?: MixdownProgressReporter,
  signal?: AbortSignal,
): Promise<MixdownRenderResult> {
  const report = safeProgressReporter(onProgress);
  try {
    if (signal?.aborted) {
      return { ok: false, reason: { kind: 'cancelled' } };
    }
    if (snapshot.loops.length === 0) {
      return { ok: false, reason: { kind: 'empty-arrangement' } };
    }
    const Offline = offlineContextCtor();
    if (!Offline) return { ok: false, reason: { kind: 'unsupported-context' } };

    report({ phase: 'preparing' });

    const stepDur = stepDurationSec(snapshot.bpm);
    const plan = planArrangement(snapshot);
    const bodySamples = Math.ceil(plan.totalSteps * stepDur * MIXDOWN_SAMPLE_RATE);
    // The tail has to cover the longest release AND the reverb it feeds, or a
    // song ending on a held chord is cut off mid-decay.
    const tailSec = Math.max(MIXDOWN_TAIL_SEC, snapshot.effects.reverbDecay + 1);
    const ctx = new Offline(
      MIXDOWN_CHANNELS,
      bodySamples + Math.ceil(tailSec * MIXDOWN_SAMPLE_RATE),
      MIXDOWN_SAMPLE_RATE,
    );

    // Seeded BEFORE createRenderEngine: setupMasterChain (run inside
    // bindContext) builds the reverb impulse at the DEFAULT decay 2.0, and
    // setReverbDecay early-returns when the snapshot's decay equals that
    // default — so seeding only applyMasterState + scheduleArrangement would
    // leave an unseeded impulse in the graph for the store's default project,
    // and two renders of it would differ.
    await withSeededRandom(MIXDOWN_SEED, () => {
      const engine = createRenderEngine(ctx);
      applyMasterState(engine, snapshot);
      scheduleArrangement(engine, snapshot, plan);
    });

    report({ phase: 'rendering', percent: 1 });
    scheduleProgressCheckpoints(ctx, report);
    const buffer = await ctx.startRendering();
    // Yield between the terminal render state and encoding so both named
    // phases can be painted instead of collapsing into one React commit.
    report({ phase: 'rendering', percent: 100 });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) {
      return { ok: false, reason: { kind: 'cancelled' } };
    }
    report({ phase: 'encoding' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) {
      return { ok: false, reason: { kind: 'cancelled' } };
    }
    const blob = encodeWav(
      [buffer.getChannelData(0), buffer.getChannelData(1)],
      MIXDOWN_SAMPLE_RATE,
    );
    return { ok: true, buffer, blob };
  } catch (err) {
    return {
      ok: false,
      reason: { kind: 'render-failed', detail: err instanceof Error ? err.message : String(err) },
    };
  }
}
