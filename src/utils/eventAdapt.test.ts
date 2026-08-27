import { describe, expect, test } from 'bun:test';
import { adaptStepEvents, type StepPositioned } from './eventAdapt';

interface Hit extends StepPositioned {
  step: number;
  holdSteps?: number;
  tag: string;
}

const EIGHTHS: Hit[] = [
  { step: 0, holdSteps: 2, tag: 'a' },
  { step: 4, holdSteps: 2, tag: 'b' },
  { step: 8, holdSteps: 2, tag: 'c' },
  { step: 12, holdSteps: 2, tag: 'd' },
];

describe('adaptStepEvents — equal length', () => {
  test('16 -> 16 returns the same events with the same holds', () => {
    expect(adaptStepEvents(EIGHTHS, 16, 16)).toEqual(EIGHTHS);
  });

  test('returns fresh objects so a caller cannot mutate the library', () => {
    const out = adaptStepEvents(EIGHTHS, 16, 16);
    expect(out[0]).not.toBe(EIGHTHS[0]);
    out[0].tag = 'mutated';
    expect(EIGHTHS[0].tag).toBe('a');
  });
});

describe('adaptStepEvents — shorter target trims and clamps', () => {
  test('16 -> 12 drops the step-12 hit entirely', () => {
    const out = adaptStepEvents(EIGHTHS, 16, 12);
    expect(out.map((e) => e.step)).toEqual([0, 4, 8]);
    expect(out.map((e) => e.tag)).toEqual(['a', 'b', 'c']);
  });

  test('a hold that would ring past the bar end is clamped to the bar end', () => {
    const long: Hit[] = [{ step: 10, holdSteps: 8, tag: 'long' }];
    const out = adaptStepEvents(long, 16, 12);
    expect(out).toEqual([{ step: 10, holdSteps: 2, tag: 'long' }]);
  });

  test('a hold already inside the bar is left alone', () => {
    const short: Hit[] = [{ step: 2, holdSteps: 2, tag: 'short' }];
    expect(adaptStepEvents(short, 16, 12)).toEqual([{ step: 2, holdSteps: 2, tag: 'short' }]);
  });

  test('an absent holdSteps is materialised only when it must be clamped', () => {
    const noHold: Hit[] = [
      { step: 0, tag: 'x' },
      { step: 11, tag: 'y' },
    ];
    const out = adaptStepEvents(noHold, 16, 12);
    expect(out[0].holdSteps).toBeUndefined();
    expect(out[1].holdSteps).toBeUndefined(); // default 1 step already fits 11 -> 12
  });

  test('a default-1 hold on the very last step still fits and stays implicit', () => {
    const edge: Hit[] = [{ step: 11, tag: 'edge' }];
    expect(adaptStepEvents(edge, 16, 12)).toEqual([{ step: 11, tag: 'edge' }]);
  });

  test('every surviving hold ends at or before the bar line', () => {
    const messy: Hit[] = [
      { step: 0, holdSteps: 16, tag: 'p' },
      { step: 6, holdSteps: 9, tag: 'q' },
      { step: 13, holdSteps: 1, tag: 'r' },
    ];
    const out = adaptStepEvents(messy, 16, 12);
    for (const e of out) expect(e.step + (e.holdSteps ?? 1)).toBeLessThanOrEqual(12);
  });
});

describe('adaptStepEvents — longer target loops', () => {
  test('16 -> 20 repeats the source from step 0 into steps 16-19', () => {
    const out = adaptStepEvents(EIGHTHS, 16, 20);
    expect(out.map((e) => e.step)).toEqual([0, 4, 8, 12, 16]);
    expect(out[4].tag).toBe('a');
  });

  test('the looped copy keeps its hold, clamped to the bar end', () => {
    const out = adaptStepEvents(EIGHTHS, 16, 18);
    expect(out.map((e) => e.step)).toEqual([0, 4, 8, 12, 16]);
    expect(out[4].holdSteps).toBe(2);

    const tight = adaptStepEvents(EIGHTHS, 16, 17);
    expect(tight.map((e) => e.step)).toEqual([0, 4, 8, 12, 16]);
    expect(tight[4].holdSteps).toBe(1);
  });

  test('16 -> 24 wraps one and a half times', () => {
    const out = adaptStepEvents(EIGHTHS, 16, 24);
    expect(out.map((e) => e.step)).toEqual([0, 4, 8, 12, 16, 20]);
    expect(out.map((e) => e.tag)).toEqual(['a', 'b', 'c', 'd', 'a', 'b']);
  });

  test('a 12-step source filling a 24-step bar repeats exactly twice', () => {
    const waltz: Hit[] = [
      { step: 0, holdSteps: 4, tag: 'one' },
      { step: 4, holdSteps: 4, tag: 'two' },
      { step: 8, holdSteps: 4, tag: 'three' },
    ];
    const out = adaptStepEvents(waltz, 12, 24);
    expect(out.map((e) => e.step)).toEqual([0, 4, 8, 12, 16, 20]);
    expect(out.every((e) => e.holdSteps === 4)).toBe(true);
  });
});

describe('adaptStepEvents — degenerate input', () => {
  test('an event outside the source bar is dropped', () => {
    const stray: Hit[] = [
      { step: -1, tag: 'before' },
      { step: 16, tag: 'after' },
      { step: 3, tag: 'inside' },
    ];
    expect(adaptStepEvents(stray, 16, 16).map((e) => e.tag)).toEqual(['inside']);
  });

  test('an empty source or non-positive target yields no events', () => {
    expect(adaptStepEvents([], 16, 12)).toEqual([]);
    expect(adaptStepEvents(EIGHTHS, 16, 0)).toEqual([]);
    expect(adaptStepEvents(EIGHTHS, 0, 12)).toEqual([]);
  });

  test('output is sorted by step ascending', () => {
    const unsorted: Hit[] = [
      { step: 9, tag: 'c' },
      { step: 1, tag: 'a' },
      { step: 5, tag: 'b' },
    ];
    expect(adaptStepEvents(unsorted, 12, 24).map((e) => e.step)).toEqual([1, 5, 9, 13, 17, 21]);
  });
});
