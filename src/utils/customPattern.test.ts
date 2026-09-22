import { describe, expect, test } from 'bun:test';
import { MAX_STEPS_PER_BAR } from './timeSignature';
import { normalizePatternSpans, resizePatternBars, writePatternSpan } from './customPattern';

/** A full stored pattern of `bars` fixed-width bars, every slot empty. */
function storedSlots<TValue>(bars: number, empty: TValue): TValue[] {
  return new Array<TValue>(bars * MAX_STEPS_PER_BAR).fill(empty);
}

/** Every hold one — a rest-only stored pattern's parallel hold array. */
function unitHolds(bars: number): number[] {
  return new Array<number>(bars * MAX_STEPS_PER_BAR).fill(1);
}

describe('writePatternSpan', () => {
  test('writes a multi-step span and clears every onset it covers', () => {
    const result = writePatternSpan({
      values: ['root', 'rest', 'fifth', 'rest'],
      holds: [1, 1, 1, 1],
      column: 0,
      value: 'root',
      holdSteps: 4,
      empty: 'rest',
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 4],
    });
    expect(result.values).toEqual(['root', 'rest', 'rest', 'rest']);
    expect(result.holds[0]).toBe(4);
    expect(result.holds.slice(1)).toEqual([1, 1, 1]);
  });

  test('clamps the requested length at the next chord boundary', () => {
    const result = writePatternSpan({
      values: ['rest', 'rest', 'fifth', 'rest'],
      holds: [1, 1, 1, 1],
      column: 0,
      value: 'root',
      holdSteps: 4,
      empty: 'rest',
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 2, 4],
    });
    // The boundary at step 2 caps the span at two steps, so the onset at
    // step 2 is NOT swallowed.
    expect(result.values).toEqual(['root', 'rest', 'fifth', 'rest']);
    expect(result.holds).toEqual([2, 1, 1, 1]);
  });

  test('a span across a bar line lands on the fixed-width stored slots', () => {
    const values = storedSlots(2, 'rest');
    values[4] = 'dormant';
    values[24] = 'fifth';
    const result = writePatternSpan({
      values,
      holds: unitHolds(2),
      column: 3,
      value: 'root',
      holdSteps: 3,
      empty: 'rest',
      stepsPerBar: 4,
      cycleSteps: 8,
      boundaries: [0, 8],
    });
    expect(result.values[3]).toBe('root');
    expect(result.holds[3]).toBe(3);
    // Columns 4 and 5 of the cycle are bar one's stored slots 24 and 25 —
    // never bar zero's slots 4 and 5.
    expect(result.values[24]).toBe('rest');
    expect(result.values[25]).toBe('rest');
    expect(result.holds[24]).toBe(1);
    expect(result.holds[25]).toBe(1);
    // The 12/8-only slot inside bar zero is dormant here, not overwritten.
    expect(result.values[4]).toBe('dormant');
  });

  test('an erase writes the empty value and resets that slot to hold one', () => {
    const result = writePatternSpan({
      values: ['root', 'rest', 'fifth', 'root'],
      holds: [3, 1, 2, 1],
      column: 0,
      value: 'rest',
      holdSteps: 3,
      empty: 'rest',
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 4],
    });
    expect(result.values).toEqual(['rest', 'rest', 'rest', 'root']);
    expect(result.holds).toEqual([1, 1, 1, 1]);
  });
});

describe('writePatternSpan input guards', () => {
  test('invalid or non-finite requested lengths become one step', () => {
    for (const holdSteps of [0, -3, 0.4, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = writePatternSpan({
        values: ['fifth', 'rest', 'fifth', 'rest'],
        holds: [2, 1, 2, 1],
        column: 0,
        value: 'root',
        holdSteps,
        empty: 'rest',
        stepsPerBar: 4,
        cycleSteps: 4,
        boundaries: [0, 4],
      });
      expect(result.values).toEqual(['root', 'rest', 'fifth', 'rest']);
      expect(result.holds).toEqual([1, 1, 2, 1]);
    }
  });

  test('a stale column at or past the cycle end writes nothing', () => {
    for (const column of [4, 5]) {
      const values = storedSlots(2, 'rest');
      const holds = unitHolds(2);
      values[24] = 'fifth';
      holds[24] = 3;
      const result = writePatternSpan({
        values,
        holds,
        column,
        value: 'root',
        holdSteps: 4,
        empty: 'rest',
        stepsPerBar: 4,
        cycleSteps: 4,
        boundaries: [0, 4],
      });
      expect(result.values).toEqual(values);
      expect(result.holds).toEqual(holds);
    }
  });

  test('a negative, fractional or non-finite column writes nothing', () => {
    for (const column of [-1, 0.5, Number.NaN]) {
      const result = writePatternSpan({
        values: ['root', 'rest', 'rest', 'rest'],
        holds: [1, 1, 1, 1],
        column,
        value: 'fifth',
        holdSteps: 2,
        empty: 'rest',
        stepsPerBar: 4,
        cycleSteps: 4,
        boundaries: [0, 4],
      });
      expect(result.values).toEqual(['root', 'rest', 'rest', 'rest']);
      expect(result.holds).toEqual([1, 1, 1, 1]);
    }
  });
});

describe('resizePatternBars', () => {
  test('grows by whole fixed-width bars without moving bar zero', () => {
    const values = storedSlots(1, 'rest');
    const holds = unitHolds(1);
    values[0] = 'root';
    values[4] = 'dormant';
    holds[0] = 4;

    const result = resizePatternBars(values, holds, 2, 'rest');
    expect(result.values).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(result.holds).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(result.values.slice(0, MAX_STEPS_PER_BAR)).toEqual(values);
    expect(result.holds.slice(0, MAX_STEPS_PER_BAR)).toEqual(holds);
    expect(result.values.slice(MAX_STEPS_PER_BAR)).toEqual(storedSlots(1, 'rest'));
    expect(result.holds.slice(MAX_STEPS_PER_BAR)).toEqual(unitHolds(1));
  });

  test('trims to the leading bars', () => {
    const values = storedSlots(2, 'rest');
    values[0] = 'root';
    values[MAX_STEPS_PER_BAR] = 'fifth';

    const result = resizePatternBars(values, unitHolds(2), 1, 'rest');
    expect(result.values).toHaveLength(MAX_STEPS_PER_BAR);
    expect(result.holds).toHaveLength(MAX_STEPS_PER_BAR);
    expect(result.values).toEqual(values.slice(0, MAX_STEPS_PER_BAR));
    expect(result.values[0]).toBe('root');
  });

  test('an invalid or sub-one bar count falls back to one bar', () => {
    const values = storedSlots(2, 'rest');
    for (const bars of [0, -2, 0.4, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = resizePatternBars(values, unitHolds(2), bars, 'rest');
      expect(result.values).toHaveLength(MAX_STEPS_PER_BAR);
      expect(result.holds).toHaveLength(MAX_STEPS_PER_BAR);
    }
  });

  test('pads a short hold array to the stored width', () => {
    const values = storedSlots(1, 'rest');
    values[0] = 'root';
    const result = resizePatternBars(values, [4], 1, 'rest');
    expect(result.holds).toHaveLength(MAX_STEPS_PER_BAR);
    expect(result.holds[0]).toBe(4);
    expect(result.holds[1]).toBe(1);
  });
});

describe('normalizePatternSpans holds', () => {
  test('a non-positive or non-finite hold on an active onset becomes one', () => {
    const result = normalizePatternSpans({
      values: ['fifth', 'rest', 'root', 'rest'],
      holds: [0, Number.NaN, 2, 1],
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 4],
      empty: 'rest',
    });
    expect(result.values).toEqual(['fifth', 'rest', 'root', 'rest']);
    expect(result.holds).toEqual([1, 1, 2, 1]);
  });

  test('a fractional hold rounds to the nearest step', () => {
    const result = normalizePatternSpans({
      values: ['root', 'rest', 'rest', 'rest'],
      holds: [2.6, 1, 1, 1],
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 4],
      empty: 'rest',
    });
    expect(result.holds).toEqual([3, 1, 1, 1]);
  });

  test('clamps a hold that crosses the next folded boundary', () => {
    const result = normalizePatternSpans({
      values: ['root', 'rest', 'fifth', 'rest'],
      holds: [9, 1, 9, 1],
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 2, 4],
      empty: 'rest',
    });
    expect(result.holds).toEqual([2, 1, 2, 1]);
  });

  test('rest slots always end with hold one', () => {
    const result = normalizePatternSpans({
      values: ['rest', 'root', 'rest', 'rest'],
      holds: [4, 2, 7, Number.NaN],
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 4],
      empty: 'rest',
    });
    expect(result.values).toEqual(['rest', 'root', 'rest', 'rest']);
    expect(result.holds).toEqual([1, 2, 1, 1]);
  });
});

describe('normalizePatternSpans coverage', () => {
  test('covered later onsets clear, earliest onset first', () => {
    const result = normalizePatternSpans({
      values: ['root', 'fifth', 'root', 'rest'],
      holds: [3, 1, 3, 1],
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 4],
      empty: 'rest',
    });
    expect(result.values).toEqual(['root', 'rest', 'rest', 'rest']);
    expect(result.holds).toEqual([3, 1, 1, 1]);
  });

  test('a hold clamped to one leaves the next onset alone', () => {
    const result = normalizePatternSpans({
      values: ['root', 'fifth', 'rest', 'rest'],
      holds: [Number.NaN, 2, 1, 1],
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 4],
      empty: 'rest',
    });
    expect(result.values).toEqual(['root', 'fifth', 'rest', 'rest']);
    expect(result.holds).toEqual([1, 2, 1, 1]);
  });

  test('visible columns past the stored end are skipped, not padded', () => {
    const result = normalizePatternSpans({
      values: ['root', 'rest', 'rest', 'rest'],
      holds: [2, 1, 1, 1],
      stepsPerBar: 4,
      cycleSteps: 8,
      boundaries: [0, 8],
      empty: 'rest',
    });
    expect(result.values).toEqual(['root', 'rest', 'rest', 'rest']);
    expect(result.holds).toEqual([2, 1, 1, 1]);
  });
});

describe('normalizePatternSpans dormancy', () => {
  test('leaves meter-dormant fixed-width slots untouched', () => {
    const values = storedSlots(1, 'rest');
    const holds = unitHolds(1);
    values[5] = 'fifth';
    holds[5] = 9;

    const result = normalizePatternSpans({
      values,
      holds,
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 4],
      empty: 'rest',
    });
    expect(result.values).toHaveLength(MAX_STEPS_PER_BAR);
    expect(result.holds).toHaveLength(MAX_STEPS_PER_BAR);
    expect(result.values[5]).toBe('fifth');
    expect(result.holds[5]).toBe(9);
  });

  test('a meter round-trip is non-destructive', () => {
    const values = storedSlots(2, 'rest');
    values[20] = 'fifth';

    // 12/8 sees stored slot 20 as a visible column; 4/4 never reaches it.
    const wide = normalizePatternSpans({
      values,
      holds: unitHolds(2),
      stepsPerBar: 24,
      cycleSteps: 48,
      boundaries: [0, 48],
      empty: 'rest',
    });
    expect(wide.values[20]).toBe('fifth');

    const narrow = normalizePatternSpans({
      values: wide.values,
      holds: wide.holds,
      stepsPerBar: 16,
      cycleSteps: 32,
      boundaries: [0, 32],
      empty: 'rest',
    });
    expect(narrow.values[20]).toBe('fifth');

    const back = normalizePatternSpans({
      values: narrow.values,
      holds: narrow.holds,
      stepsPerBar: 24,
      cycleSteps: 48,
      boundaries: [0, 48],
      empty: 'rest',
    });
    expect(back.values[20]).toBe('fifth');
  });
});

describe('pattern edit immutability', () => {
  test('writePatternSpan never mutates its inputs', () => {
    const values = Object.freeze(['root', 'rest', 'fifth', 'rest']);
    const holds = Object.freeze([1, 1, 1, 1]);
    const result = writePatternSpan({
      values,
      holds,
      column: 0,
      value: 'root',
      holdSteps: 4,
      empty: 'rest',
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 4],
    });
    expect(values).toEqual(['root', 'rest', 'fifth', 'rest']);
    expect(holds).toEqual([1, 1, 1, 1]);
    expect(result.values).not.toBe(values);
    expect(result.holds).not.toBe(holds);
  });

  test('resizePatternBars never mutates its inputs', () => {
    const values = Object.freeze(storedSlots(1, 'root'));
    const holds = Object.freeze(unitHolds(1));
    const result = resizePatternBars(values, holds, 2, 'rest');
    expect(values).toHaveLength(MAX_STEPS_PER_BAR);
    expect(holds).toHaveLength(MAX_STEPS_PER_BAR);
    expect(result.values).not.toBe(values);
    expect(result.holds).not.toBe(holds);
  });

  test('normalizePatternSpans never mutates its inputs', () => {
    const values = Object.freeze(['root', 'rest', 'rest', 'rest']);
    const holds = Object.freeze([2, 1, 1, 1]);
    const result = normalizePatternSpans({
      values,
      holds,
      stepsPerBar: 4,
      cycleSteps: 4,
      boundaries: [0, 4],
      empty: 'rest',
    });
    expect(values).toEqual(['root', 'rest', 'rest', 'rest']);
    expect(holds).toEqual([2, 1, 1, 1]);
    expect(result.values).not.toBe(values);
    expect(result.holds).not.toBe(holds);
  });
});
