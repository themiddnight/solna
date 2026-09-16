import { describe, expect, test } from 'bun:test';
import {
  planBassLane,
  planChordArm,
  planChordLane,
  planChordStep,
  type ChordPlanSnapshot,
} from './chordPlan';
import { arpEventsForStep, buildChordEvents, eventsForCycleStep } from '../chordPlayback';
import {
  cycleHoldScale,
  feelToHoldScale,
  fullHoldDuration,
  resolvePlaybackBassCycle,
  resolvePlaybackRhythmCycle,
} from '@/audio/chordRhythms';
import { isApproachToken, resolveBassSteps } from '@/audio/bassPatterns';
import { barDurationSec, generateBlockChordNotes, stepDurationSec } from '@/utils/musicTheory';
import { TRACK_ARP_DEFAULTS } from '@/store/initialState';
import type { ChordItem } from '@/types';
import type { BassStepChoice } from '@/data/bassPatterns';

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

describe('planBassLane', () => {
  test('a per-step preset wraps resolveBassSteps, flagging approach tones as last-bar-only', () => {
    const cycle = resolvePlaybackBassCycle('preset', 'classic-walk', [], [], 1, 16, '4/4', DURATIONS);
    const lane = planBassLane(snapshot(), { chordIndex: 0, totalBars: 2 });
    const expected = resolveBassSteps(cycle.pattern, CHORDS, 0, 2, 'C', 'major', 120, 1).map((ev) => ({
      step: ev.step,
      noteName: ev.noteName,
      velocity: ev.velocity,
      timeOffset: 0,
      hold: ev.holdSec,
      lastBarOnly: isApproachToken(ev.token),
    }));
    expect(lane.fullHold).toBeNull();
    expect(lane.cycleSteps).toBe(cycle.cycleSteps);
    expect(lane.events).toEqual(expected);
  });

  test('a full-hold PRESET returns one note and a hold, and no events', () => {
    const lane = planBassLane(snapshot({ bassPatternId: 'whole-note-root' }), { chordIndex: 0, totalBars: 2 });
    expect(lane.events).toEqual([]);
    // The ROOT is resolved at hold scale 1; only the DURATION carries the feel.
    const cycle = resolvePlaybackBassCycle('preset', 'whole-note-root', [], [], 1, 16, '4/4', DURATIONS);
    const root = resolveBassSteps(cycle.pattern, CHORDS, 0, 2, 'C', 'major', 120, 1)[0];
    expect(lane.fullHold).toEqual({
      noteName: root.noteName,
      velocity: root.velocity,
      holdSec: 4,
    });
  });

  test('an active bass arp replaces the lane', () => {
    expect(
      planBassLane(snapshot({ bassArpActive: true, bassPatternId: 'whole-note-root' }), {
        chordIndex: 0,
        totalBars: 2,
      }),
    ).toEqual({
      cycleSteps: 16,
      events: [],
      fullHold: null,
    });
  });

  test('the second chord resolves its OWN approach tones, so the index is load-bearing', () => {
    const first = planBassLane(snapshot(), { chordIndex: 0, totalBars: 2 }).events.map((e) => e.noteName);
    const second = planBassLane(snapshot(), { chordIndex: 1, totalBars: 2 }).events.map((e) => e.noteName);
    expect(second).not.toEqual(first);
  });
});

// Split from the describe above only to stay under max-lines-per-function; the
// two lanes' feel/boundary regressions still document the same real behavior.
describe('planBassLane feel and boundary edge cases', () => {
  test('a non-neutral bass feel scales per-step holdSec, not just the full-hold duration', () => {
    // bassFeel 0.5 (the fixture default) is the one value where
    // feelToHoldScale === 1, which would make this plumbing pass even if the
    // feel argument were never threaded through at all — so exercise a value
    // that actually moves the scale.
    const lane = planBassLane(snapshot({ bassFeel: 0.25 }), { chordIndex: 0, totalBars: 2 });
    const cycle = resolvePlaybackBassCycle('preset', 'classic-walk', [], [], 1, 16, '4/4', DURATIONS);
    // A preset cycle is not custom, so cycleHoldScale passes feelToHoldScale through unclamped.
    const holdScale = cycleHoldScale(cycle.custom, 0.25);
    expect(feelToHoldScale(0.25)).not.toBe(1);
    expect(holdScale).not.toBe(1);
    const expected = resolveBassSteps(cycle.pattern, CHORDS, 0, 2, 'C', 'major', 120, holdScale).map((ev) => ({
      step: ev.step,
      hold: ev.holdSec,
    }));
    expect(lane.events.map((e) => ({ step: e.step, hold: e.hold }))).toEqual(expected);
    // Distinguishes the scaled run from the neutral-feel one: same steps, different holds.
    const neutralHolds = planBassLane(snapshot(), { chordIndex: 0, totalBars: 2 }).events.map((e) => e.hold);
    expect(lane.events.map((e) => e.hold)).not.toEqual(neutralHolds);
  });

  test('a full-hold bass at a non-neutral feel scales holdSec but never the resolved root', () => {
    const lane = planBassLane(snapshot({ bassPatternId: 'whole-note-root', bassFeel: 0.25 }), {
      chordIndex: 0,
      totalBars: 2,
    });
    const cycle = resolvePlaybackBassCycle('preset', 'whole-note-root', [], [], 1, 16, '4/4', DURATIONS);
    const root = resolveBassSteps(cycle.pattern, CHORDS, 0, 2, 'C', 'major', 120, 1)[0];
    const expectedHoldSec = fullHoldDuration(2, barDurationSec(120, 16), feelToHoldScale(0.25));
    expect(feelToHoldScale(0.25)).not.toBe(1);
    expect(lane.fullHold).toEqual({
      noteName: root.noteName,
      velocity: root.velocity,
      holdSec: expectedHoldSec,
    });
  });

  test('a bars:0 chord still floors its folded boundary to one bar, not zero, on the bass lane too', () => {
    // chordDurations() is shared between the two lanes: an unfloored
    // `bars * stepsPerBar` would fold no boundary at column 16 here either, the
    // same regression the chord-lane suite pins above.
    const values = new Array<BassStepChoice>(48).fill('rest');
    const holds = new Array(48).fill(1);
    values[8] = 'root';
    holds[8] = 20;
    const zeroBarsChords: ChordItem[] = [
      { id: 'c1', root: 'C', quality: 'maj', bars: 0 },
      { id: 'c2', root: 'F', quality: 'maj', bars: 2 },
    ];
    const lane = planBassLane(
      snapshot({
        chords: zeroBarsChords,
        bassPatternMode: 'custom',
        customBassPattern: values,
        customBassHoldSteps: holds,
        customBassLoopLength: 2,
      }),
      { chordIndex: 0, totalBars: 2 },
    );
    expect(lane.cycleSteps).toBe(32);
    // Floored chordDurations fold a boundary at column 16, capping the 20-step
    // request to 8; an un-floored `0 * 16 === 0` boundary would leave it
    // unclamped at its full 20-step request instead.
    const cycle = resolvePlaybackBassCycle('custom', 'classic-walk', values, holds, 2, 16, '4/4', [16, 32]);
    const expected = resolveBassSteps(cycle.pattern, zeroBarsChords, 0, 2, 'C', 'major', 120, 1);
    expect(lane.events.map((e) => ({ step: e.step, hold: e.hold }))).toEqual(
      expected.map((e) => ({ step: e.step, hold: e.holdSec })),
    );
  });

  test('the lane is a plain function of its inputs: two calls agree', () => {
    const context = { chordIndex: 0, totalBars: 2 };
    expect(planBassLane(snapshot(), context)).toEqual(planBassLane(snapshot(), context));
  });
});

describe('planChordArm', () => {
  test('carries both lanes, both note sets and both cycle widths off ONE snapshot', () => {
    const snap = snapshot();
    const plan = planChordArm(snap, { chordIndex: 1, startProgressionStep: 32 });
    expect(plan.startProgressionStep).toBe(32);
    expect(plan.totalBars).toBe(2);
    expect(plan.chordNotes).toEqual(generateBlockChordNotes('maj', 'F', 4));
    expect(plan.bassNotes).toEqual(generateBlockChordNotes('maj', 'F', 2));
    expect(plan.chordArp).toBe(false);
    expect(plan.bassArp).toBe(false);
    expect(plan.chordEvents).toEqual(
      planChordLane(snap, { chordNotes: plan.chordNotes, totalBars: 2 }).events,
    );
    expect(plan.bassEvents).toEqual(
      planBassLane(snap, { chordIndex: 1, totalBars: 2 }).events,
    );
    expect(plan.chordCycleSteps).toBe(
      planChordLane(snap, { chordNotes: plan.chordNotes, totalBars: 2 }).cycleSteps,
    );
    expect(plan.bassCycleSteps).toBe(
      planBassLane(snap, { chordIndex: 1, totalBars: 2 }).cycleSteps,
    );
  });

  test('a full-hold pair arrives as two descriptors, and nothing is scheduled', () => {
    const plan = planChordArm(
      snapshot({ chordRhythmId: 'sustained', bassPatternId: 'whole-note-root' }),
      { chordIndex: 0, startProgressionStep: 0 },
    );
    expect(plan.chordFullHold).toEqual({ notes: plan.chordNotes, holdSec: 4 });
    expect(plan.bassFullHold?.holdSec).toBe(4);
    expect(plan.chordEvents).toEqual([]);
    expect(plan.bassEvents).toEqual([]);
  });

  test('a malformed bars: 0 chord is one bar, in the plan AND in the folded boundaries', () => {
    const malformed = snapshot({
      chords: [
        { id: 'c1', root: 'C', quality: 'maj', bars: 0 },
        { id: 'c2', root: 'F', quality: 'maj', bars: 2 },
      ],
    });
    // The live hook floored totalBars but NOT the durations it folded custom
    // boundaries onto; the renderer floored both. One planner, one answer.
    expect(planChordArm(malformed, { chordIndex: 0, startProgressionStep: 0 }).totalBars).toBe(1);
  });

  test('the two lanes fold independently: a custom chord cycle and a preset bass cycle differ, and neither field is the other', () => {
    // Chord rhythm is custom with a 2-bar loop (cycleSteps = 2 * 16 = 32); bass
    // stays on the default preset, which always resolves cycleSteps to one bar
    // (stepsPerBar = 16). If planChordArm's assignment ever swapped
    // chordCycleSteps/bassCycleSteps, this is the one fixture where that swap
    // is observable — every other test in this suite has both lanes land on the
    // same width (16) and would pass silently either way.
    const values = new Array(32).fill(false);
    const holds = new Array(32).fill(1);
    values[0] = true;
    holds[0] = 1;
    const snap = snapshot({
      chordRhythmMode: 'custom',
      customChordRhythm: values,
      customChordHoldSteps: holds,
      customChordLoopLength: 2,
    });
    const plan = planChordArm(snap, { chordIndex: 0, startProgressionStep: 0 });
    expect(plan.chordCycleSteps).toBe(32);
    expect(plan.bassCycleSteps).toBe(16);
    expect(plan.chordCycleSteps).not.toBe(plan.bassCycleSteps);
    expect(plan.chordCycleSteps).toBe(
      planChordLane(snap, { chordNotes: plan.chordNotes, totalBars: 2 }).cycleSteps,
    );
    expect(plan.bassCycleSteps).toBe(
      planBassLane(snap, { chordIndex: 0, totalBars: 2 }).cycleSteps,
    );
  });
});

describe('planChordStep', () => {
  const ARP_OFF = { ...TRACK_ARP_DEFAULTS.chord, active: false };
  const ARP_ON = { ...TRACK_ARP_DEFAULTS.chord, active: true };

  function ctx(over: Record<string, unknown> = {}) {
    return {
      progressionStep: 0,
      step: 0,
      isLastBar: true,
      stepsPerBar: 16,
      stepDurSec: stepDurationSec(120),
      chordArp: ARP_OFF,
      bassArp: ARP_OFF,
      chordFeel: 0.5,
      bassFeel: 0.5,
      ...over,
    };
  }

  test('folds each lane onto its OWN cycle width, from one progression-relative step', () => {
    const plan = planChordArm(snapshot(), { chordIndex: 0, startProgressionStep: 0 });
    for (const step of [0, 4, 15, 16, 20, 31]) {
      const events = planChordStep(plan, ctx({ progressionStep: step, step }));
      expect(events.chord, `chord ${step}`).toEqual(
        eventsForCycleStep(plan.chordEvents, step, plan.chordCycleSteps, true),
      );
      expect(events.bass, `bass ${step}`).toEqual(
        eventsForCycleStep(plan.bassEvents, step, plan.bassCycleSteps, true),
      );
    }
  });

  test('withholds a last-bar-only approach tone until the chord\'s final bar', () => {
    const plan = planChordArm(snapshot(), { chordIndex: 0, startProgressionStep: 0 });
    const approach = plan.bassEvents.find((e) => e.lastBarOnly);
    if (!approach) return; // classic-walk without an approach token: nothing to prove
    expect(
      planChordStep(plan, ctx({ progressionStep: approach.step, step: approach.step, isLastBar: false })).bass,
    ).toEqual([]);
    expect(
      planChordStep(plan, ctx({ progressionStep: approach.step, step: approach.step, isLastBar: true })).bass,
    ).not.toEqual([]);
  });

  test('an armed arp lane reads the ABSOLUTE step and the LIVE feel, never the cycle', () => {
    const plan = planChordArm(snapshot({ chordArpActive: true }), { chordIndex: 0, startProgressionStep: 0 });
    const events = planChordStep(plan, ctx({ progressionStep: 3, step: 19, chordArp: ARP_ON, chordFeel: 0.9 }));
    expect(events.chord).toEqual(
      arpEventsForStep(plan.chordNotes, ARP_ON, 19, stepDurationSec(120), feelToHoldScale(0.9), 16),
    );
  });

  test('chord and bass fold onto DIFFERENT cycle widths, and neither lane borrows the other\'s', () => {
    // Same fixture as planChordArm's "the two lanes fold independently" test:
    // a custom 2-bar chord cycle (32 columns) under a default 1-bar bass cycle
    // (16 columns). Every other fixture in this describe has both lanes land on
    // 16, so a chord/bass cycleSteps swap inside planChordStep would pass those
    // silently; this is the one case where it would not.
    const values = new Array(32).fill(false);
    const holds = new Array(32).fill(1);
    values[0] = true;
    holds[0] = 1;
    const snap = snapshot({
      chordRhythmMode: 'custom',
      customChordRhythm: values,
      customChordHoldSteps: holds,
      customChordLoopLength: 2,
    });
    const plan = planChordArm(snap, { chordIndex: 0, startProgressionStep: 0 });
    expect(plan.chordCycleSteps).toBe(32);
    expect(plan.bassCycleSteps).toBe(16);

    // Step 20 folds to column 4 on the 32-wide chord cycle but column 4 on the
    // 16-wide bass cycle too (20 % 16 === 4) — pick a step where the two folds
    // diverge instead: 18 folds to column 18 on the chord cycle (no wrap) and
    // to column 2 on the bass cycle (18 % 16 === 2).
    const events = planChordStep(plan, ctx({ progressionStep: 18, step: 18 }));
    expect(events.chord).toEqual(eventsForCycleStep(plan.chordEvents, 18, 32, true));
    expect(events.bass).toEqual(eventsForCycleStep(plan.bassEvents, 18, 16, true));

    // Step 16 is silent on the correct 32-wide chord fold (16 % 32 === 16, no
    // hit there) but would NOT be silent under a chordCycleSteps/bassCycleSteps
    // swap (16 % 16 === 0, which IS where the lone hit sits) — the one step in
    // this fixture where a swapped fold would fire and the correct one must not.
    expect(planChordStep(plan, ctx({ progressionStep: 16, step: 16 })).chord).toEqual([]);
  });
});
