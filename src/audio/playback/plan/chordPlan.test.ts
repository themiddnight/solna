import { describe, expect, test } from 'bun:test';
import { planChordLane, type ChordPlanSnapshot } from './chordPlan';
import { buildChordEvents } from '../chordPlayback';
import {
  cycleHoldScale,
  feelToHoldScale,
  fullHoldDuration,
  resolvePlaybackRhythmCycle,
} from '@/audio/chordRhythms';
import { barDurationSec, generateBlockChordNotes, stepDurationSec } from '@/utils/musicTheory';
import type { ChordItem } from '@/types';

const CHORDS: ChordItem[] = [
  { id: 'c1', root: 'C', quality: 'maj', bars: 2 },
  { id: 'c2', root: 'F', quality: 'maj', bars: 2 },
];
/** Two two-bar chords at 16 steps/bar. */
const DURATIONS = [32, 32];
const NOTES = generateBlockChordNotes('maj', 'C', 4);

function snapshot(over: Partial<ChordPlanSnapshot> = {}): ChordPlanSnapshot {
  return {
    chords: CHORDS,
    bpm: 120,
    meterId: '4/4',
    stepsPerBar: 16,
    chordOctave: 4,
    bassOctave: 2,
    scaleRoot: 'C',
    scaleType: 'major',
    chordRhythmMode: 'preset',
    chordRhythmId: 'fourOnFloor',
    customChordRhythm: [],
    customChordHoldSteps: [],
    customChordLoopLength: 1,
    chordFeel: 0.5,
    bassPatternMode: 'preset',
    bassPatternId: 'classic-walk',
    customBassPattern: [],
    customBassHoldSteps: [],
    customBassLoopLength: 1,
    bassFeel: 0.5,
    chordArpActive: false,
    bassArpActive: false,
    ...over,
  };
}

describe('planChordLane', () => {
  test('a per-step preset returns the events buildChordEvents builds, and no full hold', () => {
    const cycle = resolvePlaybackRhythmCycle('preset', 'fourOnFloor', [], [], 1, 16, '4/4', DURATIONS);
    const lane = planChordLane(snapshot(), { chordNotes: NOTES, totalBars: 2 });
    expect(lane.fullHold).toBeNull();
    expect(lane.cycleSteps).toBe(cycle.cycleSteps);
    // chordFeel 0.5 -> feelToHoldScale(0.5) === 1, and a preset cycle is not custom.
    expect(lane.events).toEqual(buildChordEvents(cycle.pattern, NOTES, stepDurationSec(120), 1));
  });

  test('a full-hold PRESET returns a descriptor instead of scheduling anything', () => {
    const lane = planChordLane(snapshot({ chordRhythmId: 'sustained' }), {
      chordNotes: NOTES,
      totalBars: 2,
    });
    expect(lane.events).toEqual([]);
    // 2 bars x 2 s at 120 bpm / 16 spb, hold scale 1.
    expect(lane.fullHold).toEqual({ notes: NOTES, holdSec: 4 });
  });

  test('a full hold at a non-neutral feel scales holdSec by feelToHoldScale, not by 1', () => {
    const lane = planChordLane(snapshot({ chordRhythmId: 'sustained', chordFeel: 0.25 }), {
      chordNotes: NOTES,
      totalBars: 2,
    });
    // feelToHoldScale(0.25) = 2 ** (2 * (0.25 - 0.5)) = 2 ** -0.5 ≈ 0.7071067811865476.
    // A preset cycle is not custom, so cycleHoldScale passes it through unclamped:
    // 2 bars x 2 s x that scale = 2.8284271247461903 s, well short of the 4 s cap.
    expect(feelToHoldScale(0.25)).not.toBe(1);
    const expectedHoldSec = fullHoldDuration(2, barDurationSec(120, 16), feelToHoldScale(0.25));
    expect(expectedHoldSec).toBeCloseTo(2.8284271247461903, 10);
    expect(lane.fullHold).toEqual({ notes: NOTES, holdSec: expectedHoldSec });
  });

  test('an active arp replaces the lane: no cycle is resolved and no event is built', () => {
    const lane = planChordLane(snapshot({ chordArpActive: true, chordRhythmId: 'sustained' }), {
      chordNotes: NOTES,
      totalBars: 2,
    });
    expect(lane).toEqual({ cycleSteps: 16, events: [], fullHold: null });
  });

  test('a custom lane clamps Feel to x1: a span the user drew is never loosened past it', () => {
    // One hit at column 0, holding 2 steps — comfortably inside the cycle, so no
    // boundary clamp is in play; only cycleHoldScale's custom clamp is exercised.
    const values = new Array(24).fill(false);
    const holds = new Array(24).fill(1);
    values[0] = true;
    holds[0] = 2;
    const customSnapshot = snapshot({
      chordRhythmMode: 'custom',
      customChordRhythm: values,
      customChordHoldSteps: holds,
      customChordLoopLength: 1,
      chordFeel: 0.9,
    });
    const lane = planChordLane(customSnapshot, { chordNotes: NOTES, totalBars: 2 });
    const cycle = resolvePlaybackRhythmCycle('custom', 'fourOnFloor', values, holds, 1, 16, '4/4', DURATIONS);
    // feelToHoldScale(0.9) > 1, but a custom cycle clamps it to 1 (cycleHoldScale's
    // own Math.min(1, scale)) — proven here against the real chordRhythms helper
    // rather than against a hand-typed number, so a swap for the unclamped
    // feelToHoldScale would fail this assertion.
    expect(feelToHoldScale(0.9)).toBeGreaterThan(1);
    expect(cycleHoldScale(true, 0.9)).toBe(1);
    expect(lane.events).toEqual(
      buildChordEvents(cycle.pattern, NOTES, stepDurationSec(120), cycleHoldScale(true, 0.9)),
    );
    // One event per chord note (a block hit fires every note), all sharing the
    // clamped-to-x1 hold: 2 steps at 120 bpm, never the unclamped x1.74.
    expect(lane.events.map((e) => ({ step: e.step, hold: e.hold }))).toEqual(
      NOTES.map(() => ({ step: 0, hold: 2 * stepDurationSec(120) })),
    );
  });

  test('a bars:0 chord still floors its folded boundary to one bar, not zero', () => {
    // Two chords, one authored with bars:0. chordDurations() floors that to
    // Math.max(1, 0 || 1) * stepsPerBar = 16 columns; an un-floored
    // `bars * stepsPerBar` would fold no boundary at column 16 at all, since
    // `0 * 16 === 0` lands back on the cycle's own start. Over a 2-bar (32
    // column) custom cycle that difference is a real, distinct boundary: with
    // the floor, a span starting at column 8 is capped at column 16 (8 steps);
    // without it, the same span would run unclamped to its full 20-step request.
    const values = new Array(48).fill(false);
    const holds = new Array(48).fill(1);
    values[8] = true;
    holds[8] = 20;
    const zeroBarsChords: ChordItem[] = [
      { id: 'c1', root: 'C', quality: 'maj', bars: 0 },
      { id: 'c2', root: 'F', quality: 'maj', bars: 2 },
    ];
    const lane = planChordLane(
      snapshot({
        chords: zeroBarsChords,
        chordRhythmMode: 'custom',
        customChordRhythm: values,
        customChordHoldSteps: holds,
        customChordLoopLength: 2,
      }),
      { chordNotes: NOTES, totalBars: 2 },
    );
    expect(lane.cycleSteps).toBe(32);
    // One event per chord note (a block hit fires every note) at the same step
    // and hold. Floored: hold clamps to 8 steps = 1 s. An un-floored
    // `bars * stepsPerBar` would fold no boundary at column 16, leaving the
    // span unclamped at its requested 20 steps = 2.5 s — this assertion fails
    // under that regression.
    expect(lane.events.map((e) => ({ step: e.step, hold: e.hold }))).toEqual(
      NOTES.map(() => ({ step: 8, hold: 8 * stepDurationSec(120) })),
    );
  });

  test('the lane is a plain function of its inputs: two calls agree', () => {
    const context = { chordNotes: NOTES, totalBars: 2 };
    expect(planChordLane(snapshot(), context)).toEqual(planChordLane(snapshot(), context));
  });
});
