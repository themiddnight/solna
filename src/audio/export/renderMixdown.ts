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
 *  - `updateSynthParams` is not called at all: it only reshapes voices that
 *    are already live, and there are none before the first note. Each voice
 *    gets its params at trigger time, which is where they come from anyway.
 */
import { createRenderEngine, type AudioEngine } from '../engine';
import { sequencerStepEvents } from '../sequencerSteps';
import {
  leadScheduleHits,
  leadSoundingNotes,
  resolveLeadStepTriggers,
  type LeadNote,
  type LeadTrigger,
} from '../leadMelody';
import { isApproachToken, resolveBassSteps } from '../bassPatterns';
import { buildChordEvents, emitStepEvents, eventsForStep, arpEventsForStep, playFullHoldChord, type BarInvariantEvent } from '../playback/chordPlayback';
import { resolvePadArm } from '../playback/padPlayback';
import {
  adaptBassPattern,
  adaptRhythmPattern,
  feelToHoldScale,
  fullHoldDuration,
  isFullHoldBass,
  isFullHoldRhythm,
  resolvePlaybackBassPattern,
  resolvePlaybackRhythmPattern,
} from '../chordRhythms';
import { MIXDOWN_SEED, withSeededRandom } from '../rng';
import { DEFAULT_VELOCITY } from '../constants';
import { loopDwellSteps, loopEffectiveLengthSteps } from '@/utils/songStructure';
import { barDurationSec, generateBlockChordNotes, stepDurationSec } from '@/utils/musicTheory';
import { TICKS_PER_SIXTEENTH, columnsPerBar, strideFor, type LeadStepResolutionId } from '@/utils/stepResolution';
import { arpStepFor, getMeter, type MeterId } from '@/utils/meter';
import { encodeWav } from '@/utils/encodeWav';
import type { BassPattern, BassStepChoice } from '@/data/bassPatterns';
import type { RhythmPattern } from '@/data/chordRhythms';
import type { DrumKit } from '@/data/drumKits';
import type {
  ChordItem,
  FilterType,
  MasterEffects,
  PadInterval,
  PadMode,
  PadVoicing,
  SequencerTrack,
  SynthParams,
} from '@/types';

export const MIXDOWN_SAMPLE_RATE = 44100;
export const MIXDOWN_CHANNELS = 2;
/** The floor on the tail: release + reverb. Never shorter than this. */
export const MIXDOWN_TAIL_SEC = 2;

/** One source bus, its gain already converted from the store's dB to linear. */
export interface MixdownBusState {
  source: string;
  gain: number;
  muted: boolean;
}

/** One drum track's fader, already converted from dB to linear. */
export interface MixdownDrumTrack {
  instrument: string;
  gain: number;
}

export interface MixdownDrumFilter {
  cutoff: number;
  resonance: number;
  type: FilterType;
}

/**
 * One melody track's render material: the four per-track columns the renderer
 * reads, plus the engine source its voices belong on (`'synth'` for Lead,
 * `'fx'` for FX) and the patch it plays. Built by `mixdownLeadTrack` /
 * `mixdownFxTrack` below, because the store spells the Lead row irregularly
 * (`synthParams`, not `leadSynthParams`) and that irregularity is exactly what
 * `MELODY_TRACKS` exists to encode — a table this module may not import.
 */
export interface MixdownMelodyTrack {
  steps: LeadNote[][];
  /** Bars. The melody loop's own length, not the chord loop's. */
  loopLength: number;
  stepResolution: LeadStepResolutionId;
  gate: number;
  params: SynthParams;
  source: string;
}

function mixdownLeadTrack(loop: MixdownLoop): MixdownMelodyTrack {
  return {
    steps: loop.leadMelodySteps,
    loopLength: loop.leadLoopLength,
    stepResolution: loop.leadStepResolution,
    gate: loop.leadGate,
    params: loop.synthParams,
    source: 'synth',
  };
}

function mixdownFxTrack(loop: MixdownLoop): MixdownMelodyTrack {
  return {
    steps: loop.fxMelodySteps,
    loopLength: loop.fxLoopLength,
    stepResolution: loop.fxStepResolution,
    gate: loop.fxGate,
    params: loop.fxSynthParams,
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
  synthParams: SynthParams;
  chordSynthParams: SynthParams;
  bassSynthParams: SynthParams;
  padSynthParams: SynthParams;
  fxSynthParams: SynthParams;
  chordRhythmId: string;
  chordRhythmMode: 'preset' | 'custom';
  customChordRhythm: boolean[];
  chordFeel: number;
  chordOctave: number;
  bassPatternId: string;
  bassPatternMode: 'preset' | 'custom';
  customBassPattern: BassStepChoice[];
  bassFeel: number;
  bassOctave: number;
  padMode: PadMode;
  padOctave: number;
  padVoicing: PadVoicing;
  padDroneDegree: number;
  padDroneIntervals: PadInterval[];
  sequencerTracks: SequencerTrack[];
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
  drumFilter: MixdownDrumFilter;
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
  drumTracks: MixdownDrumTrack[];
  drumKit: Partial<DrumKit>;
  drumKitName: string | undefined;
  drumFilter: MixdownDrumFilter;
  /** The flat `synthParams` — what a sequencer note voice uses (the DEV-386 note). */
  sequencerParams: SynthParams;
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
export interface ArrangementPass {
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
  drumFilter: MixdownDrumFilter;
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
    drumFilter: snapshot.loops[pass.loopIndex].drumFilter,
  }));
}

/**
 * Everything one loop needs to sound, resolved ONCE for the whole render
 * rather than per pass: the chord patterns, the bass patterns, the arp flag,
 * the whole-chord holds and the bar→chord map. A loop is played `repeatCount`
 * times and every repeat is identical, so resolving twice would be work the
 * render pays for and nothing reads.
 */
export interface LoopVoices {
  /** Chord index per bar of ONE pass; length = the pass's bars. */
  chordsByBar: number[];
  /** Per chord: its first step within a pass. */
  chordStartStep: number[];
  /** Per chord: its bars, floored at 1. */
  chordBars: number[];
  /** Per chord: its block notes at `chordOctave`. */
  chordNotes: string[][];
  /** Per chord: its block notes at `bassOctave` (the arp bus reads these per step). */
  bassNotes: string[][];
  /** Per chord: its rhythm events, empty when arpeggiated or a full hold. */
  chordEvents: BarInvariantEvent[][];
  /** Per chord: its bass events, empty when arpeggiated or a full hold. */
  bassEvents: BarInvariantEvent[][];
  chordArp: boolean;
  bassArp: boolean;
  /** Per chord: the hold length for a full-hold rhythm, else 0. */
  chordHoldSec: number[];
  /** Per chord: the bass root for a full-hold bass pattern, else null. */
  bassHoldNotes: ({ noteName: string; velocity: number } | null)[];
  /** Per chord: the hold length for a full-hold bass, else 0. */
  bassHoldSec: number[];
  chordHoldScale: number;
  bassHoldScale: number;
}

/**
 * The loop's chord and bass patterns, resolved once for the whole loop at the
 * ACTIVE meter. A custom grid is synthesized at the active meter and is stamped
 * with it, so adaptRhythmPattern returns it unchanged — the same two-step the
 * live hook performs, in the same order.
 */
function resolveLoopPatterns(
  loop: MixdownLoop,
  meterId: MeterId,
  stepsPerBar: number,
): { rhythmPattern: RhythmPattern; bassPattern: BassPattern } {
  const rhythmPattern = adaptRhythmPattern(
    resolvePlaybackRhythmPattern(
      loop.chordRhythmMode,
      loop.chordRhythmId,
      loop.customChordRhythm,
      stepsPerBar,
      meterId,
    ),
    stepsPerBar,
  );
  const bassPattern = adaptBassPattern(
    resolvePlaybackBassPattern(
      loop.bassPatternMode,
      loop.bassPatternId,
      loop.customBassPattern,
      stepsPerBar,
      meterId,
    ),
    stepsPerBar,
  );
  return { rhythmPattern, bassPattern };
}

/**
 * One chord's bass events: empty when the pattern is arpeggiated or a full hold
 * (`skip` is the caller's `bassFullHold || bassArp`, computed once for the
 * loop), otherwise the steps resolved against the chord at `chordIndex`.
 */
function bassEventsForChord(
  loop: MixdownLoop,
  bassPattern: BassPattern,
  chordIndex: number,
  bpm: number,
  bassHoldScale: number,
  skip: boolean,
): BarInvariantEvent[] {
  if (skip) return [];
  // The chord INDEX matters, not the chord object: resolveBassSteps walks
  // `chords[(i + 1) % length]` for its approach tones, which is what makes
  // the last chord lead back into the first at the loop seam.
  return resolveBassSteps(
    bassPattern,
    loop.chords,
    chordIndex,
    loop.bassOctave,
    loop.scaleRoot,
    loop.scaleType,
    bpm,
    bassHoldScale,
  ).map((ev) => ({
    step: ev.step,
    noteName: ev.noteName,
    velocity: ev.velocity,
    timeOffset: 0,
    hold: ev.holdSec,
    // Approach tones lead into the NEXT chord, so they belong on the last bar.
    lastBarOnly: isApproachToken(ev.token),
  }));
}

/**
 * The note a full-hold bass pattern starts on, or null when the pattern is not
 * a full hold. holdScale 1: the live hook resolves the full-hold bass at full
 * length and applies the feel only through fullHoldDuration, so the note-off
 * and the hold it is paired with are measured the same way.
 */
function fullHoldBassNote(
  loop: MixdownLoop,
  bassPattern: BassPattern,
  chordIndex: number,
  bpm: number,
  fullHold: boolean,
): { noteName: string; velocity: number } | null {
  if (!fullHold) return null;
  const root = resolveBassSteps(
    bassPattern,
    loop.chords,
    chordIndex,
    loop.bassOctave,
    loop.scaleRoot,
    loop.scaleType,
    bpm,
    1,
  )[0];
  return root ? { noteName: root.noteName, velocity: root.velocity } : null;
}

export function buildLoopVoices(
  loop: MixdownLoop,
  meterId: MeterId,
  bpm: number,
  stepsPerBar: number,
): LoopVoices {
  const stepDur = stepDurationSec(bpm);
  const barDur = barDurationSec(bpm, stepsPerBar);
  const chordOctave = loop.chordOctave;

  const chordsByBar: number[] = [];
  const chordStartStep: number[] = [];
  const chordBars: number[] = [];
  const chordNotes: string[][] = [];
  const bassNotes: string[][] = [];
  const chordEvents: BarInvariantEvent[][] = [];
  const bassEvents: BarInvariantEvent[][] = [];
  const chordHoldSec: number[] = [];
  const bassHoldNotes: ({ noteName: string; velocity: number } | null)[] = [];
  const bassHoldSec: number[] = [];

  const chordArp = !!loop.chordSynthParams.arpActive;
  const bassArp = !!loop.bassSynthParams.arpActive;
  const chordHoldScale = feelToHoldScale(loop.chordFeel);
  const bassHoldScale = feelToHoldScale(loop.bassFeel);

  const { rhythmPattern, bassPattern } = resolveLoopPatterns(loop, meterId, stepsPerBar);
  const chordFullHold = !chordArp && isFullHoldRhythm(rhythmPattern, stepsPerBar);
  const bassFullHold = !bassArp && isFullHoldBass(bassPattern, stepsPerBar);

  let barCursor = 0;
  for (let i = 0; i < loop.chords.length; i += 1) {
    const chord = loop.chords[i];
    const bars = Math.max(1, chord.bars || 1);
    const notes = generateBlockChordNotes(chord.quality, chord.root, chordOctave);
    const bassChordNotes = generateBlockChordNotes(chord.quality, chord.root, loop.bassOctave);

    chordStartStep.push(barCursor * stepsPerBar);
    chordBars.push(bars);
    chordNotes.push(notes);
    bassNotes.push(bassChordNotes);
    for (let b = 0; b < bars; b += 1) chordsByBar.push(i);
    barCursor += bars;

    chordEvents.push(
      chordFullHold || chordArp
        ? []
        : buildChordEvents(rhythmPattern, notes, stepDur, chordHoldScale),
    );

    bassEvents.push(
      bassEventsForChord(loop, bassPattern, i, bpm, bassHoldScale, bassFullHold || bassArp),
    );

    chordHoldSec.push(chordFullHold ? fullHoldDuration(bars, barDur, chordHoldScale) : 0);
    bassHoldNotes.push(fullHoldBassNote(loop, bassPattern, i, bpm, bassFullHold));
    bassHoldSec.push(bassFullHold ? fullHoldDuration(bars, barDur, bassHoldScale) : 0);
  }
  return {
    chordsByBar,
    chordStartStep,
    chordBars,
    chordNotes,
    bassNotes,
    chordEvents,
    bassEvents,
    chordArp,
    bassArp,
    chordHoldSec,
    bassHoldNotes,
    bassHoldSec,
    chordHoldScale,
    bassHoldScale,
  };
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
  engine.setDrumKit(snapshot.drumKit, snapshot.drumKitName);
  for (const track of snapshot.drumTracks) {
    engine.setDrumTrackGain(track.instrument, track.gain);
  }
  engine.setDrumFilter(snapshot.drumFilter.cutoff, snapshot.drumFilter.resonance, snapshot.drumFilter.type);
  engine.updateEffects(snapshot.effects);
  engine.setReverbDecay(snapshot.effects.reverbDecay);
}

/** Install per-loop audio state at the same boundary where live song mode loads the loop. */
function applyLoopAudioState(engine: AudioEngine, state: LoopAudioAutomation): void {
  for (const bus of state.buses) {
    engine.setSourceGain(bus.source, bus.gain, state.time);
    engine.setSourceMuted(bus.source, bus.muted, state.time);
  }
  engine.setDrumFilter(
    state.drumFilter.cutoff,
    state.drumFilter.resonance,
    state.drumFilter.type,
    state.time,
  );
}

/**
 * One melody track's material at one PASS-RELATIVE step, at an explicit
 * absolute time.
 *
 * A transcription of the live hook's clock callback with `time` supplied
 * instead of read from the scheduler, and with the store reads replaced by
 * the snapshot. `stepInPass` is the loop-relative step the live clock holds
 * (it resets to 0 at each loop boundary via `resetClock`), so the column and
 * arp phase derive from it exactly as they do live; `time` stays the absolute
 * song position, which is the only thing the explicit note-on/off times need.
 * The three-way split it keeps — `leadScheduleHits` decides which columns
 * fire, `leadSoundingNotes` decides what is held, and `resolveLeadStepTriggers`
 * decides what sounds and for how long — is the whole point: this function
 * contains no scheduling decision of its own.
 */
function scheduleMelodyStep(
  engine: AudioEngine,
  track: MixdownMelodyTrack,
  stepInPass: number,
  stepsPerBar: number,
  tickDur: number,
  time: number,
): void {
  const stride = strideFor(track.stepResolution);
  const columns = track.loopLength * columnsPerBar(stepsPerBar, stride);
  const melodyTicks = track.loopLength * stepsPerBar * TICKS_PER_SIXTEENTH;
  const arpStep = arpStepFor(stepInPass, stepsPerBar);
  const hits = leadScheduleHits(stepInPass, stride, columns, track.params.arpActive, tickDur);

  for (const hit of hits) {
    const at = time + hit.offsetSec;
    const sounding = leadSoundingNotes(track.steps, hit.column, stepsPerBar, stride);
    const triggers: LeadTrigger[] = resolveLeadStepTriggers(
      sounding,
      track.params.arpActive,
      arpStep,
      track.params,
      tickDur,
      track.gate,
      stride,
      { tickInLoop: hit.column * stride, melodyTicks },
    );
    for (const trigger of triggers) {
      const start = at + trigger.timeOffsetSec;
      engine.triggerSynthNoteOn(trigger.note, track.params, DEFAULT_VELOCITY, start, track.source, 1, 'sequencer');
      engine.triggerSynthNoteOff(trigger.note, track.params.release, start + trigger.holdSec, track.source);
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

    for (let i = 0; i < pass.dwellSteps; i += 1) {
      // Pass-relative, so repeats 2..n reset the chord plan exactly as a live
      // loop restart does. See planArrangement's docblock: the dwell already
      // counts the repeats, so this is NOT a repeat loop.
      const stepInPass = i % pass.passSteps;
      const step = pass.startStep + i;
      const time = step * stepDur;
      const stepInBar = stepInPass % stepsPerBar;
      const barInPass = Math.floor(stepInPass / stepsPerBar);
      const isLoopStart = stepInPass === 0;

      // Drums: the same per-step decision the sequencer hook makes, with the
      // explicit time the render needs.
      for (const ev of sequencerStepEvents(loop.sequencerTracks, stepInBar, snapshot.sequencerParams, snapshot.bpm)) {
        if (ev.kind === 'note') {
          engine.triggerSynthNoteOn(ev.note, snapshot.sequencerParams, DEFAULT_VELOCITY, time, 'synth', 1, 'sequencer');
          engine.triggerSynthNoteOff(ev.note, ev.release, time + ev.offsetSec, 'synth');
        } else {
          engine.triggerDrum(ev.instrument, DEFAULT_VELOCITY, time);
        }
      }

      if (!chordless) {
        const chordIndex = voices.chordsByBar[barInPass];
        const stepsIntoChord = stepInPass - voices.chordStartStep[chordIndex];
        const chordSteps = voices.chordBars[chordIndex] * stepsPerBar;
        const chordEnd = time + (chordSteps - stepsIntoChord) * stepDur;
        const isLastBar = Math.floor(stepsIntoChord / stepsPerBar) === voices.chordBars[chordIndex] - 1;
        const chordParams = loop.chordSynthParams;

        // Chord. Full hold arms once, on the chord's own first step; the arp
        // reads the ABSOLUTE step so it keeps stride across chords and bars;
        // otherwise the bar-invariant events are filtered to this step.
        if (voices.chordArp) {
          emitStepEvents(
            arpEventsForStep(voices.chordNotes[chordIndex], chordParams, step, stepDur, voices.chordHoldScale, stepsPerBar),
            chordParams, 'chord', time, chordEnd, engine,
          );
        } else if (voices.chordHoldSec[chordIndex] > 0) {
          if (stepsIntoChord === 0) {
            playFullHoldChord(voices.chordNotes[chordIndex], chordParams, time, voices.chordHoldSec[chordIndex], 'chord', engine);
          }
        } else {
          emitStepEvents(
            eventsForStep(voices.chordEvents[chordIndex], stepInBar, isLastBar),
            chordParams, 'chord', time, chordEnd, engine,
          );
        }

        // Bass, the same three-way split on its own bus.
        const bassParams = loop.bassSynthParams;
        if (voices.bassArp) {
          emitStepEvents(
            arpEventsForStep(voices.bassNotes[chordIndex], bassParams, step, stepDur, voices.bassHoldScale, stepsPerBar),
            bassParams, 'bass', time, chordEnd, engine,
          );
        } else if (voices.bassHoldSec[chordIndex] > 0) {
          const root = voices.bassHoldNotes[chordIndex];
          if (root && stepsIntoChord === 0) {
            engine.triggerSynthNoteOn(root.noteName, bassParams, root.velocity, time, 'bass', 1, 'sequencer');
            engine.triggerSynthNoteOff(root.noteName, bassParams.release, time + voices.bassHoldSec[chordIndex], 'bass');
          }
        } else {
          emitStepEvents(
            eventsForStep(voices.bassEvents[chordIndex], stepInBar, isLastBar),
            bassParams, 'bass', time, chordEnd, engine,
          );
        }

        // Pad. `resolvePadArm` is called per chord because pad mode arms on
        // EVERY chord and drone mode only at the top of a pass — see its own
        // docblock. The trigger is `playFullHoldChord` on the pad bus, which
        // is exactly how the live hook holds a drone.
        if (stepsIntoChord === 0) {
          const arm = resolvePadArm({
            mode: loop.padMode,
            isLoopStart,
            chord: loop.chords[chordIndex],
            degree: loop.padDroneDegree,
            intervals: loop.padDroneIntervals,
            padOctave: loop.padOctave,
            voicing: loop.padVoicing,
            scaleRoot: loop.scaleRoot,
            scaleType: loop.scaleType,
            barDur: barDurationSec(snapshot.bpm, stepsPerBar),
            // Only a drone reads the loop's length, and loopBars walks the
            // whole progression — pad mode arms on every chord and must not
            // pay for it. `pass.passSteps / stepsPerBar` is the pass's bars.
            loopBarCount: pass.passSteps / stepsPerBar,
          });
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
