/**
 * The pure song timeline: arrangement planning (how many total steps an
 * arrangement takes and where each loop's pass starts) plus the walk that
 * turns a snapshot into the events an engine would perform.
 *
 * `walkSongTimeline` is today's `scheduleArrangement` (`renderMixdown.ts`)
 * with each `engine.*` call replaced by a `yield` of the event it would have
 * performed, and every planner call left exactly where it is today. Generators
 * are lazy, so a planner call runs only when the consumer asks for the next
 * item — which is what preserves the shared `random()` seam's draw order when
 * the renderer performs the walk instead of draining it first (spec §5, §6).
 */
import { loopDwellSteps, loopEffectiveLengthSteps } from '@/utils/songStructure';
import type { MeterId } from '@/utils/timeSignature';
import { DEFAULT_VELOCITY } from '@/audio/constants';
import { stepDurationSec } from '@/utils/tempo';
import { TICKS_PER_SIXTEENTH } from '@/utils/stepResolution';
import type { BeatVoiceId } from '@/types';
import { planBeatStep, type BeatPlanSnapshot } from './beatPlan';
import { planChordArm, planChordStep, type ArmedChordPlan } from './chordPlan';
import { fullHoldVelocity, stepNoteWindow } from './chordEvents';
import { planPadArm, type PadPlanSnapshot } from './padPlan';
import { planMelodyStep, type MelodyPlanSnapshot } from './melodyPlan';
import {
  beatSnapshotForLoop,
  chordSnapshotForLoop,
  mixdownFxTrack,
  mixdownLeadTrack,
  padSnapshotForLoop,
  type MixdownLoop,
  type MixdownSnapshot,
} from './songSnapshot';

/** The five lanes a song plays, one loop at a time. */
export type SongTrack = 'chord' | 'bass' | 'pad' | 'lead' | 'fx';

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

export type TimelineEvent =
  | {
      kind: 'note';
      track: SongTrack;
      loopIndex: number;
      /** ROOTS-spelled (R064); never Hz (R176) — the performer converts. */
      noteName: string;
      velocity: number;
      /** Absolute seconds from the start of the song. */
      startSec: number;
      /** Absolute note-off time, already clipped (step notes: `stepNoteWindow`). */
      endSec: number;
    }
  | {
      kind: 'drum';
      loopIndex: number;
      voice: BeatVoiceId;
      velocity: number;
      timeSec: number;
    };

/** What `walkSongTimeline` yields, in emit order. */
export type SongWalkItem =
  | TimelineEvent
  | { kind: 'pass'; passIndex: number; pass: ArrangementPass }
  | { kind: 'stepEnd'; step: number };

export interface SongTimeline {
  totalSteps: number;
  passes: ArrangementPass[];
  /** Sorted by `timelineEventTime`; ties keep emit order (stable sort). */
  events: TimelineEvent[];
}

/** Per-pass state, built AFTER the pass marker is yielded — in today's order. */
interface PassWalk {
  loop: MixdownLoop;
  pass: ArrangementPass;
  voices: LoopVoices;
  chordless: boolean;
  lead: MelodyPlanSnapshot;
  fx: MelodyPlanSnapshot;
  pad: PadPlanSnapshot;
  beat: BeatPlanSnapshot;
  stepDur: number;
  tickDur: number;
  stepsPerBar: number;
}

function note(
  track: SongTrack, loopIndex: number, noteName: string, velocity: number, startSec: number, endSec: number,
): TimelineEvent {
  return { kind: 'note', track, loopIndex, noteName, velocity, startSec, endSec };
}

export function timelineEventTime(e: TimelineEvent): number {
  return e.kind === 'note' ? e.startSec : e.timeSec;
}

export function* walkSongTimeline(
  snapshot: MixdownSnapshot,
  plan: ArrangementPlan,
): Generator<SongWalkItem, void, undefined> {
  for (let passIndex = 0; passIndex < plan.passes.length; passIndex += 1) {
    const pass = plan.passes[passIndex];
    // BEFORE any planning of this pass: the renderer applies the pass's audio
    // automation on this item, and buildLoopVoices must run after it.
    yield { kind: 'pass', passIndex, pass };
    yield* walkPass(snapshot, pass);
  }
}

function* walkPass(snapshot: MixdownSnapshot, pass: ArrangementPass): Generator<SongWalkItem, void, undefined> {
  const { bpm, meterId, stepsPerBar } = snapshot;
  const loop = snapshot.loops[pass.loopIndex];
  const stepDur = stepDurationSec(bpm);
  const w: PassWalk = {
    loop,
    pass,
    voices: buildLoopVoices(loop, meterId, bpm, stepsPerBar),
    // A chordless loop dwells its bar(s) and plays no chord, bass or pad: the
    // guard below reads this once per pass and skips that whole block, so the
    // walk never dereferences the chord arrays (which are empty for it).
    chordless: loop.chords.length === 0,
    // Built once per pass, not once per step: the walk runs for every step of
    // every repeat, and two fresh objects per step is garbage the render pays
    // for and nobody reads.
    lead: mixdownLeadTrack(loop),
    fx: mixdownFxTrack(loop),
    pad: padSnapshotForLoop(loop, bpm, stepsPerBar),
    beat: beatSnapshotForLoop(loop),
    stepDur,
    tickDur: stepDur / TICKS_PER_SIXTEENTH,
    stepsPerBar,
  };
  for (let i = 0; i < pass.dwellSteps; i += 1) {
    // Pass-relative, so repeats 2..n reset the chord plan exactly as a live
    // loop restart does. See planArrangement's docblock: the dwell already
    // counts the repeats, so this is NOT a repeat loop.
    const stepInPass = i % pass.passSteps;
    const step = pass.startStep + i;
    const time = step * stepDur;
    yield* walkStep(w, stepInPass, step, time);
    yield { kind: 'stepEnd', step };
  }
}

function* walkStep(
  w: PassWalk, stepInPass: number, step: number, time: number,
): Generator<SongWalkItem, void, undefined> {
  const { loopIndex } = w.pass;
  const stepInBar = stepInPass % w.stepsPerBar;
  // The Beat, through the SAME pure decision the live stepper uses: one
  // function answers "what sounds at this step" for both, so an export can
  // never disagree with what the grid played. The per-voice mute is honoured
  // inside it; solo is not, and must not be — solo is a session-only
  // monitoring gesture and never reaches an export.
  for (const ev of planBeatStep(w.beat, { stepInBar })) {
    yield { kind: 'drum', loopIndex, voice: ev.voice, velocity: ev.velocity, timeSec: time };
  }
  if (!w.chordless) yield* walkChordStep(w, stepInPass, step, time);
  // Melody tracks run whether or not the loop has chords: a lead over a
  // chordless loop is a real thing, and the grid's own loop length is what
  // decides its material.
  yield* walkMelodyStep(w, 'lead', w.lead, stepInPass, time);
  yield* walkMelodyStep(w, 'fx', w.fx, stepInPass, time);
}

function* walkChordStep(
  w: PassWalk, stepInPass: number, step: number, time: number,
): Generator<SongWalkItem, void, undefined> {
  const { loop, voices, stepsPerBar, stepDur } = w;
  const { loopIndex } = w.pass;
  const barInPass = Math.floor(stepInPass / stepsPerBar);
  const chordIndex = voices.chordsByBar[barInPass];
  const plan = voices.plans[chordIndex];
  const stepsIntoChord = stepInPass - voices.chordStartStep[chordIndex];
  const chordSteps = plan.totalBars * stepsPerBar;
  const chordEnd = time + (chordSteps - stepsIntoChord) * stepDur;
  const isLastBar = Math.floor(stepsIntoChord / stepsPerBar) === plan.totalBars - 1;

  // The full holds arm once, on the chord's own first step. Both lanes report
  // empty events when they hold, so the per-step emit below is a no-op for
  // them rather than a branch.
  if (stepsIntoChord === 0 && plan.chordFullHold) {
    const { notes, holdSec } = plan.chordFullHold;
    for (const n of notes) yield note('chord', loopIndex, n, fullHoldVelocity(notes.length), time, time + holdSec);
  }
  if (stepsIntoChord === 0 && plan.bassFullHold) {
    const { noteName, velocity, holdSec } = plan.bassFullHold;
    yield note('bass', loopIndex, noteName, velocity, time, time + holdSec);
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
  for (const ev of events.chord) {
    const { startSec, endSec } = stepNoteWindow(time, ev, chordEnd);
    yield note('chord', loopIndex, ev.noteName, ev.velocity, startSec, endSec);
  }
  for (const ev of events.bass) {
    const { startSec, endSec } = stepNoteWindow(time, ev, chordEnd);
    yield note('bass', loopIndex, ev.noteName, ev.velocity, startSec, endSec);
  }
  // Pad, through the SAME planner the live hook arms with. `chordIndex`
  // carries what `isLoopStart` used to: the pad block only runs at
  // `stepsIntoChord === 0`, and chord 0 starts at step 0 of the pass, so
  // `chordIndex === 0` there is exactly the old `stepInPass === 0`.
  if (stepsIntoChord === 0) {
    const arm = planPadArm(w.pad, { chordIndex });
    if (arm) {
      for (const n of arm.notes) {
        yield note('pad', loopIndex, n, fullHoldVelocity(arm.notes.length), time, time + arm.holdSec);
      }
    }
  }
}

function* walkMelodyStep(
  w: PassWalk, track: 'lead' | 'fx', melody: MelodyPlanSnapshot, stepInPass: number, time: number,
): Generator<SongWalkItem, void, undefined> {
  const planned = planMelodyStep(melody, { stepInLoop: stepInPass, stepsPerBar: w.stepsPerBar, tickDurSec: w.tickDur });
  for (const n of planned) {
    const start = time + n.startOffsetSec;
    yield note(track, w.pass.loopIndex, n.note, DEFAULT_VELOCITY, start, start + n.holdSec);
  }
}

/**
 * The whole song as sorted events: the same walk the renderer performs,
 * drained. Reads the shared random() seam for arp 'random' mode, like
 * planChordStep; it does not seed (the caller does, as renderMixdown does).
 */
export function buildSongTimeline(snapshot: MixdownSnapshot): SongTimeline {
  const plan = planArrangement(snapshot);
  const events: TimelineEvent[] = [];
  for (const item of walkSongTimeline(snapshot, plan)) {
    if (item.kind === 'note' || item.kind === 'drum') events.push(item);
  }
  // Array.prototype.sort is stable: equal times keep emit order.
  events.sort((a, b) => timelineEventTime(a) - timelineEventTime(b));
  return { totalSteps: plan.totalSteps, passes: plan.passes, events };
}
