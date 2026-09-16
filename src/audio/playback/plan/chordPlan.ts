import type { BassStepChoice } from '@/data/bassPatterns';
import type { ChordItem } from '@/types';
import type { MeterId } from '@/utils/meter';
import { barDurationSec, stepDurationSec } from '@/utils/musicTheory';
import {
  cycleHoldScale,
  fullHoldDuration,
  isFullHoldRhythmCycle,
  resolvePlaybackRhythmCycle,
} from '@/audio/chordRhythms';
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
