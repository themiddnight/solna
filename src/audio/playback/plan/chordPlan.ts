import type { BassStepChoice } from '@/data/bassPatterns';
import type { ChordItem } from '@/types';
import type { MeterId } from '@/utils/meter';
import { barDurationSec, generateBlockChordNotes, stepDurationSec } from '@/utils/musicTheory';
import {
  cycleHoldScale,
  fullHoldDuration,
  isFullHoldBassCycle,
  isFullHoldRhythmCycle,
  resolvePlaybackBassCycle,
  resolvePlaybackRhythmCycle,
} from '@/audio/chordRhythms';
import { isApproachToken, resolveBassSteps } from '@/audio/bassPatterns';
import { buildChordEvents, type BarInvariantEvent } from '../chordPlayback';

/**
 * Everything the chord and bass lanes read when a chord is ARMED.
 *
 * Arm-time, and only arm-time. The synth patches, the two Arp SETTINGS objects
 * and both feel values are read LIVE by the controller on every step and handed
 * to `planChordStep` instead — that split is what makes a knob tweak audible on
 * the very next hit rather than on the next chord, and folding them in here
 * would silently take that away. What IS captured is the arp's ACTIVE flag:
 * flipping Arp mid-chord must not stack an arpeggio on top of a chord already
 * sounding, so the pattern/arp choice is fixed for the plan's whole life.
 *
 * One snapshot serves both lanes because they are armed together, from one read
 * of the loop state — but their CYCLES stay independent (a two-bar chord cycle
 * under a three-bar bass cycle is normal), which is why each lane resolves and
 * carries its own `cycleSteps`.
 */
export interface ChordPlanSnapshot {
  chords: readonly ChordItem[];
  bpm: number;
  meterId: MeterId;
  stepsPerBar: number;
  chordOctave: number;
  bassOctave: number;
  scaleRoot: string;
  scaleType: string;
  chordRhythmMode: 'preset' | 'custom';
  chordRhythmId: string;
  customChordRhythm: boolean[];
  customChordHoldSteps: number[];
  customChordLoopLength: number;
  chordFeel: number;
  bassPatternMode: 'preset' | 'custom';
  bassPatternId: string;
  customBassPattern: BassStepChoice[];
  customBassHoldSteps: number[];
  customBassLoopLength: number;
  bassFeel: number;
  chordArpActive: boolean;
  bassArpActive: boolean;
}

/**
 * The progression's durations in ACTIVE-meter columns — what a custom lane
 * folds its chord boundaries onto.
 *
 * Floored at one bar per chord. The live hook used `c.bars * stepsPerBar` and
 * the renderer `Math.max(1, c.bars || 1) * stepsPerBar`; one planner cannot
 * have both, and the floored form is the one that agrees with `totalBars`
 * (`chord.bars || 1`) everywhere else — a `bars: 0` chord would otherwise fold
 * a zero-width boundary the rest of the code says is one bar wide.
 */
function chordDurations(snapshot: ChordPlanSnapshot): number[] {
  return snapshot.chords.map((c) => Math.max(1, c.bars || 1) * snapshot.stepsPerBar);
}

/** One armed lane: the cycle it repeats over, its events, and its full hold if it has one. */
interface ChordLanePlan {
  cycleSteps: number;
  events: BarInvariantEvent[];
  /**
   * A PRESET full-hold lane: strike these notes once, at the chord's first
   * step, and hold them this long. A descriptor rather than an engine call,
   * because a function that touches the engine cannot be called by a test with
   * no engine — and cannot be shared with the offline renderer either.
   */
  fullHold: { notes: string[]; holdSec: number } | null;
}

/**
 * The chord lane of a plan.
 *
 * An active arp replaces the lane outright: no cycle is resolved, and the
 * reported width is the one bar the arp's stride is measured against. A
 * full-hold cycle is PRESET-only (`isFullHoldRhythmCycle`), so a custom span
 * covering its whole cycle stays a span — it strikes, releases at the seam and
 * strikes again, which is the length the user drew.
 *
 * The second parameter is an object, not bare positional scalars, by the
 * binding convention every `plan<Lane>` function follows (Task 1's review;
 * see `planPadArm`'s `{ chordIndex }`): a later per-call addition is then a
 * shape change to `context`, not a signature change every call site must
 * follow in argument order.
 */
export function planChordLane(
  snapshot: ChordPlanSnapshot,
  context: { chordNotes: string[]; totalBars: number },
): ChordLanePlan {
  const { chordNotes, totalBars } = context;
  if (snapshot.chordArpActive) {
    return { cycleSteps: snapshot.stepsPerBar, events: [], fullHold: null };
  }
  const cycle = resolvePlaybackRhythmCycle(
    snapshot.chordRhythmMode,
    snapshot.chordRhythmId,
    snapshot.customChordRhythm,
    snapshot.customChordHoldSteps,
    snapshot.customChordLoopLength,
    snapshot.stepsPerBar,
    snapshot.meterId,
    chordDurations(snapshot),
  );
  // Feel may only TIGHTEN a span the user drew, so the cycle's own custom flag
  // picks the scale; a preset keeps the whole loose range.
  const holdScale = cycleHoldScale(cycle.custom, snapshot.chordFeel);
  if (isFullHoldRhythmCycle(cycle)) {
    return {
      cycleSteps: cycle.cycleSteps,
      events: [],
      fullHold: {
        notes: chordNotes,
        holdSec: fullHoldDuration(
          totalBars,
          barDurationSec(snapshot.bpm, snapshot.stepsPerBar),
          holdScale,
        ),
      },
    };
  }
  return {
    cycleSteps: cycle.cycleSteps,
    events: buildChordEvents(cycle.pattern, chordNotes, stepDurationSec(snapshot.bpm), holdScale),
    fullHold: null,
  };
}

/** The bass lane's twin of ChordLanePlan. Bass is monophonic: one held note, not a voicing. */
interface BassLanePlan {
  cycleSteps: number;
  events: BarInvariantEvent[];
  fullHold: { noteName: string; velocity: number; holdSec: number } | null;
}

/**
 * The bass lane of a plan, over its own cycle, hold scale and tone resolution.
 *
 * The chord INDEX matters, not the chord object: `resolveBassSteps` walks
 * `chords[(i + 1) % length]` for its approach tones, which is what makes the
 * last chord lead back into the first at the loop seam.
 *
 * A full hold resolves its root at hold scale 1 and carries the feel in the
 * DURATION only, so the note-off and the hold it is paired with are measured
 * the same way.
 *
 * The second parameter is an object for the same reason `planChordLane`'s is
 * (see its docblock): a later per-call addition is a shape change to
 * `context`, never a signature change every call site must follow in
 * argument order.
 */
export function planBassLane(
  snapshot: ChordPlanSnapshot,
  context: { chordIndex: number; totalBars: number },
): BassLanePlan {
  const { chordIndex, totalBars } = context;
  if (snapshot.bassArpActive) {
    return { cycleSteps: snapshot.stepsPerBar, events: [], fullHold: null };
  }
  const cycle = resolvePlaybackBassCycle(
    snapshot.bassPatternMode,
    snapshot.bassPatternId,
    snapshot.customBassPattern,
    snapshot.customBassHoldSteps,
    snapshot.customBassLoopLength,
    snapshot.stepsPerBar,
    snapshot.meterId,
    chordDurations(snapshot),
  );
  const stepsAtHold = (holdScale: number) =>
    resolveBassSteps(
      cycle.pattern,
      // resolveBassSteps only indexes into this array (never mutates it), but
      // its signature predates ChordPlanSnapshot's readonly field.
      snapshot.chords as ChordItem[],
      chordIndex,
      snapshot.bassOctave,
      snapshot.scaleRoot,
      snapshot.scaleType,
      snapshot.bpm,
      holdScale,
    );
  const holdSec = () =>
    fullHoldDuration(
      totalBars,
      barDurationSec(snapshot.bpm, snapshot.stepsPerBar),
      cycleHoldScale(cycle.custom, snapshot.bassFeel),
    );

  if (isFullHoldBassCycle(cycle)) {
    const root = stepsAtHold(1)[0];
    return {
      cycleSteps: cycle.cycleSteps,
      events: [],
      fullHold: root
        ? { noteName: root.noteName, velocity: root.velocity, holdSec: holdSec() }
        : null,
    };
  }
  return {
    cycleSteps: cycle.cycleSteps,
    events: stepsAtHold(cycleHoldScale(cycle.custom, snapshot.bassFeel)).map((ev) => ({
      step: ev.step,
      noteName: ev.noteName,
      velocity: ev.velocity,
      timeOffset: 0,
      hold: ev.holdSec,
      // Approach tones lead into the NEXT chord, so they belong to the last bar.
      lastBarOnly: isApproachToken(ev.token),
    })),
    fullHold: null,
  };
}

/**
 * A chord's playback shape, resolved once when the chord is armed and then
 * emitted one clock step at a time by the controller.
 *
 * Holding the events here rather than pushing them onto the audio clock upfront
 * is what keeps nothing scheduled further ahead than the clock's own lookahead
 * — which is what lets a knob tweak reach the next hit rather than the next
 * chord.
 *
 * The two `*FullHold` fields are the plan's only INSTRUCTIONS rather than
 * events: strike them once at the chord's first step. They exist because a
 * full-hold lane is a single long voice the patch can re-shape live, so it
 * needs no per-step work — and because the resolver that decides it must stay
 * callable from a test with no engine.
 */
export interface ArmedChordPlan {
  /**
   * The progression step this chord was armed on — measured from the run's
   * origin, so `chordPlanPosition` needs no second origin. Plans tile a run:
   * each is armed exactly one chord after the last.
   */
  startProgressionStep: number;
  totalBars: number;
  chordNotes: string[];
  bassNotes: string[];
  chordArp: boolean;
  bassArp: boolean;
  chordEvents: BarInvariantEvent[];
  bassEvents: BarInvariantEvent[];
  /**
   * The two lanes' cycle widths in 16th columns, resolved when the plan was
   * armed and carried for its whole life. A clock tick must never resolve one:
   * a mid-chord resize would re-phase a pattern that is already sounding.
   */
  chordCycleSteps: number;
  bassCycleSteps: number;
  chordFullHold: { notes: string[]; holdSec: number } | null;
  bassFullHold: { noteName: string; velocity: number; holdSec: number } | null;
}

/**
 * Arms the chord at `context.chordIndex`: its notes, both lanes' events and
 * both lanes' full holds, from ONE snapshot of the loop state.
 *
 * Pure. The controller does the two things this cannot: it fires the full holds
 * on the engine, and it keeps the arming state `startProgressionStep` is
 * measured from.
 *
 * The second parameter is an object for the same reason `planChordLane`'s and
 * `planBassLane`'s are (see their docblocks): a later per-call addition is a
 * shape change to `context`, never a signature change every call site must
 * follow in argument order.
 */
export function planChordArm(
  snapshot: ChordPlanSnapshot,
  context: { chordIndex: number; startProgressionStep: number },
): ArmedChordPlan {
  const { chordIndex, startProgressionStep } = context;
  const chord = snapshot.chords[chordIndex];
  const totalBars = Math.max(1, chord.bars || 1);
  const chordNotes = generateBlockChordNotes(chord.quality, chord.root, snapshot.chordOctave);
  const bassNotes = generateBlockChordNotes(chord.quality, chord.root, snapshot.bassOctave);
  const chordLane = planChordLane(snapshot, { chordNotes, totalBars });
  const bassLane = planBassLane(snapshot, { chordIndex, totalBars });

  return {
    startProgressionStep,
    totalBars,
    chordNotes,
    bassNotes,
    // Off the Arp fields, never off the patch: Arp is performance state, so a
    // preset load must not re-arm the arpeggiator.
    chordArp: snapshot.chordArpActive,
    bassArp: snapshot.bassArpActive,
    chordEvents: chordLane.events,
    bassEvents: bassLane.events,
    chordCycleSteps: chordLane.cycleSteps,
    bassCycleSteps: bassLane.cycleSteps,
    chordFullHold: chordLane.fullHold,
    bassFullHold: bassLane.fullHold,
  };
}
