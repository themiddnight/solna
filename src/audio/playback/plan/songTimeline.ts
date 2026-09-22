/**
 * The pure song timeline: arrangement planning lives here — how many total
 * steps an arrangement takes and where each loop's pass starts. The walk that
 * performs the timeline against an engine is added in the next commit
 * (Task 5).
 */
import { loopDwellSteps, loopEffectiveLengthSteps } from '@/utils/songStructure';
import type { MeterId } from '@/utils/meter';
import { planChordArm, type ArmedChordPlan } from './chordPlan';
import { chordSnapshotForLoop, type MixdownLoop, type MixdownSnapshot } from './songSnapshot';

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
