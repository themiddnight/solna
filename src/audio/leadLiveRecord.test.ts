import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  clockStepToGridColumn,
  createLeadLiveClock,
  heldStepLength,
  measuredStepDurationSec,
  pushClockAnchor,
  quantiseInputStep,
  wrapColumn,
} from './leadLiveRecord';
import { stepDurationSec } from '../utils/musicTheory';

describe('pushClockAnchor', () => {
  test('keeps the two most recent anchors and nothing else', () => {
    let anchors = pushClockAnchor([], { step: 1, time: 0.1 });
    anchors = pushClockAnchor(anchors, { step: 2, time: 0.2 });
    anchors = pushClockAnchor(anchors, { step: 3, time: 0.3 });
    expect(anchors).toEqual([
      { step: 2, time: 0.2 },
      { step: 3, time: 0.3 },
    ]);
  });

  test('a repeated step replaces its anchor rather than duplicating it', () => {
    // The clock re-dispatches a step whenever the stall detector re-anchors
    // the grid. That is a better time for the same step, not a new anchor —
    // and taking it as one would make the measured duration 0.
    const anchors = pushClockAnchor(
      [
        { step: 1, time: 0.1 },
        { step: 2, time: 0.2 },
      ],
      { step: 2, time: 0.25 },
    );
    expect(anchors).toEqual([
      { step: 1, time: 0.1 },
      { step: 2, time: 0.25 },
    ]);
  });

  test('a step going backwards is a rewind, and drops the history', () => {
    // resetClock() sets clockStepIndex back to 0. Projecting across that
    // seam would give a negative duration and a nonsense column.
    const anchors = pushClockAnchor(
      [
        { step: 40, time: 9.0 },
        { step: 41, time: 9.25 },
      ],
      { step: 0, time: 12.0 },
    );
    expect(anchors).toEqual([{ step: 0, time: 12.0 }]);
  });
});

describe('measuredStepDurationSec', () => {
  test('is the gap between two anchors divided by the steps between them', () => {
    expect(
      measuredStepDurationSec([
        { step: 8, time: 10 },
        { step: 9, time: 10.2 },
      ]),
    ).toBeCloseTo(0.2, 10);
    expect(
      measuredStepDurationSec([
        { step: 8, time: 10 },
        { step: 12, time: 10.8 },
      ]),
    ).toBeCloseTo(0.2, 10);
  });

  test('bpm is irrelevant to the result, because bpm is not an input', () => {
    // The whole point of measuring: a bpm change, a meter change and a
    // future adjustable step resolution all follow for free. A bpm-derived
    // constant would keep returning the old value with no error anywhere —
    // the notes would simply land on the wrong columns.
    const anchors = [
      { step: 8, time: 10 },
      { step: 9, time: 10.2 },
    ];
    expect(measuredStepDurationSec(anchors)).toBeCloseTo(0.2, 10);
    expect(stepDurationSec(120)).toBeCloseTo(0.125, 10);
    expect(stepDurationSec(60)).toBeCloseTo(0.25, 10);
    expect(measuredStepDurationSec(anchors)).not.toBeCloseTo(stepDurationSec(120), 10);
    expect(measuredStepDurationSec(anchors)).not.toBeCloseTo(stepDurationSec(60), 10);
  });

  test('the module still cannot reach the bpm-derived duration', () => {
    const src = readFileSync(new URL('./leadLiveRecord.ts', import.meta.url), 'utf8');
    // The pin that matters is unchanged: measuring the step from the
    // anchors is the whole reason a bpm change mid-take does not move the
    // notes, and a bpm-derived constant would keep returning the old value
    // with no error anywhere.
    expect(src).not.toContain('stepDurationSec');
    // It may now reach the subdivision table, and nothing else. That leaf
    // imports only meter.ts, so this module stays testable with no
    // AudioContext, no store and no DOM.
    const imports = [...src.matchAll(/^import .*? from '(.*?)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['../utils/stepResolution']);
  });

  test('one anchor, none, or a non-advancing pair has no answer', () => {
    expect(measuredStepDurationSec([])).toBeNull();
    expect(measuredStepDurationSec([{ step: 8, time: 10 }])).toBeNull();
    expect(
      measuredStepDurationSec([
        { step: 8, time: 10 },
        { step: 8, time: 10 },
      ]),
    ).toBeNull();
  });
});

describe('quantiseInputStep', () => {
  // 0.25 s per step — a 60 bpm 16th, chosen so the numbers stay readable.
  const anchors = [
    { step: 32, time: 10.0 },
    { step: 33, time: 10.25 },
  ];

  test('a press one step past the newest anchor lands on the next step', () => {
    expect(quantiseInputStep(anchors, 10.5, 0)).toBe(34);
  });

  test('rounds to the NEAREST step, never the floor', () => {
    // 0.6 of a step past 33: the floor says 33, the ear says 34.
    expect(quantiseInputStep(anchors, 10.4, 0)).toBe(34);
    expect(quantiseInputStep(anchors, 10.65, 0)).toBe(35);
  });

  test('a press slightly EARLY still lands on the step it was aiming at', () => {
    // 20 ms before step 34 sounds. Flooring would push it back to 33, which
    // is the same one-sided error the latency subtraction exists to avoid.
    expect(quantiseInputStep(anchors, 10.48, 0)).toBe(34);
  });

  test('output latency advances the press: what was heard was already late', () => {
    // Uncompensated, a press observed at 10.63 rounds up to step 35.
    expect(quantiseInputStep(anchors, 10.63, 0)).toBe(35);
    // The sound the player reacted to left the speaker 20 ms after the
    // context reached its time, so the press really happened at 10.61 —
    // step 34, the one they were aiming at.
    expect(quantiseInputStep(anchors, 10.63, 0.02)).toBe(34);
  });

  test('fewer than two anchors means no clock, and no answer', () => {
    expect(quantiseInputStep([], 10.5, 0)).toBeNull();
    expect(quantiseInputStep([{ step: 32, time: 10 }], 10.5, 0)).toBeNull();
  });

  test('a stale newest anchor means the clock has stopped', () => {
    // Anchors are FUTURE times (the clock is a lookahead scheduler), so a
    // `now` well past the newest one can only mean nothing is scheduling.
    expect(quantiseInputStep(anchors, 10.25 + 1.0 + 0.01, 0)).toBeNull();
    expect(quantiseInputStep(anchors, 10.25 + 1.0 - 0.01, 0)).not.toBeNull();
  });
});

describe('clockStepToGridColumn', () => {
  test('at 1/16 a clock step is still a column, exactly as before', () => {
    expect(clockStepToGridColumn(0, 16, 2)).toBe(0);
    expect(clockStepToGridColumn(7, 16, 2)).toBe(7);
    expect(clockStepToGridColumn(16, 16, 2)).toBe(0);
    expect(clockStepToGridColumn(37, 16, 2)).toBe(5);
  });

  test('at 1/8 two clock steps share a column', () => {
    // stride 4: tick = step * 2, column = tick / 4.
    expect(clockStepToGridColumn(0, 8, 4)).toBe(0);
    expect(clockStepToGridColumn(1, 8, 4)).toBe(0);
    expect(clockStepToGridColumn(2, 8, 4)).toBe(1);
    expect(clockStepToGridColumn(16, 8, 4)).toBe(0);
  });

  test('at 1/32 a clock step lands on an even column, always', () => {
    // Correct and deliberate: a quantiser that rounds to the nearest 16th
    // can only ever produce even columns. The clock is the only time
    // reference there is, and a performance cannot be captured finer than
    // the grid the anchors describe — half the 1/32 columns are reachable
    // by drawing but not by recording, the same way a note played between
    // two 16ths is captured on one of them today.
    expect(clockStepToGridColumn(0, 32, 1)).toBe(0);
    expect(clockStepToGridColumn(1, 32, 1)).toBe(2);
    expect(clockStepToGridColumn(7, 32, 1)).toBe(14);
    expect(clockStepToGridColumn(16, 32, 1)).toBe(0);
  });

  test('a negative step wraps forward rather than escaping the grid', () => {
    expect(clockStepToGridColumn(-1, 16, 2)).toBe(15);
    expect(clockStepToGridColumn(-1, 32, 1)).toBe(30);
  });

  test('a loop with no columns has nowhere to land', () => {
    expect(clockStepToGridColumn(4, 0, 2)).toBe(0);
  });
});

describe('wrapColumn', () => {
  test('is the wrap the conversion already did, named on its own', () => {
    // The marker consumes a column the publisher already converted, so it
    // must wrap and NOT convert again. One copy of the wrap, two entry
    // points — not two copies that agree today by coincidence.
    expect(wrapColumn(5, 16)).toBe(5);
    expect(wrapColumn(16, 16)).toBe(0);
    expect(wrapColumn(-1, 16)).toBe(15);
    expect(wrapColumn(4, 0)).toBe(0);
    expect(wrapColumn(Number.NaN, 16)).toBe(0);
  });
});

describe('heldStepLength', () => {
  test('returns TICKS: four clock steps held is eight ticks', () => {
    expect(heldStepLength(4, 8, 2)).toBe(8);
  });

  test('a tap is one CELL, never one tick — a sub-cell note is undrawable', () => {
    expect(heldStepLength(4, 4, 1)).toBe(1);
    expect(heldStepLength(4, 4, 2)).toBe(2);
    expect(heldStepLength(4, 4, 4)).toBe(4);
  });

  test('a release quantised earlier than the press is still one cell', () => {
    expect(heldStepLength(4, 3, 4)).toBe(4);
  });

  test('rounds UP to a whole cell, so the recorder never writes a sub-cell length', () => {
    // At 1/8 an odd clock-step hold is 1.5 cells. The editor writes whole
    // cells, and UP is the only direction that agrees with what the note
    // already sounded and drew: resolveLeadStepTriggers and leadNoteCells
    // both ceil, so a 6-tick note at stride 4 was heard as 8 ticks. Rounding
    // down would shorten the capture, and switching that loop to 1/32 later
    // would shorten it again — the ratchet the non-destructive rule exists
    // to keep out of view changes.
    expect(heldStepLength(0, 3, 4)).toBe(8);
    expect(heldStepLength(0, 5, 4)).toBe(12);
    expect(heldStepLength(0, 7, 4)).toBe(16);
    // Even strides can never produce a sub-cell length, and must not move.
    expect(heldStepLength(0, 3, 2)).toBe(6);
    expect(heldStepLength(0, 3, 1)).toBe(6);
  });

  test('counts straight across the loop seam, because the clock never wraps', () => {
    // Truncating at the loop end is setLeadNoteLength's job (invariant 2),
    // not this function's; counting in raw clock steps is what makes the
    // length immune to a bpm change during the hold.
    expect(heldStepLength(14, 20, 2)).toBe(12);
  });
});

describe('createLeadLiveClock', () => {
  const makeClock = (): {
    clock: ReturnType<typeof createLeadLiveClock>;
    world: { now: number | null; latency: number };
  } => {
    const world = { now: 0 as number | null, latency: 0 };
    const clock = createLeadLiveClock({
      now: () => world.now,
      outputLatency: () => world.latency,
    });
    return { clock, world };
  };

  test('has no answer until two anchors have arrived', () => {
    const { clock, world } = makeClock();
    world.now = 10.5;
    expect(clock.inputStep()).toBeNull();
    clock.anchor(32, 10.0);
    expect(clock.inputStep()).toBeNull();
    clock.anchor(33, 10.25);
    expect(clock.inputStep()).toBe(34);
  });

  test('subtracts the output latency it is handed, live', () => {
    const { clock, world } = makeClock();
    clock.anchor(32, 10.0);
    clock.anchor(33, 10.25);
    world.now = 10.63;
    expect(clock.inputStep()).toBe(35);
    world.latency = 0.02;
    expect(clock.inputStep()).toBe(34);
  });

  test('reset makes it silent again, so a stopped transport cannot answer', () => {
    const { clock, world } = makeClock();
    clock.anchor(32, 10.0);
    clock.anchor(33, 10.25);
    world.now = 10.5;
    expect(clock.inputStep()).toBe(34);
    clock.reset();
    expect(clock.inputStep()).toBeNull();
  });

  test('no context means no time, and therefore no answer', () => {
    const clock = createLeadLiveClock({ now: () => null, outputLatency: () => 0 });
    clock.anchor(32, 10.0);
    clock.anchor(33, 10.25);
    expect(clock.inputStep()).toBeNull();
  });
});

