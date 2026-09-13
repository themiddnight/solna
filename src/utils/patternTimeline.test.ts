import { describe, expect, test } from 'bun:test';
import { MAX_STEPS_PER_BAR } from './meter';
import {
  clampLoopLength,
  foldPatternBoundaries,
  loopLengthDivisors,
  maxPatternHold,
  patternStoredIndexAt,
} from './patternTimeline';

describe('loopLengthDivisors', () => {
  test('lists every positive divisor ascending', () => {
    const cases: Array<[number, number[]]> = [
      [1, [1]],
      [4, [1, 2, 4]],
      [6, [1, 2, 3, 6]],
      [12, [1, 2, 3, 4, 6, 12]],
      [7, [1, 7]],
    ];
    for (const [totalBars, expected] of cases) {
      expect(loopLengthDivisors(totalBars)).toEqual(expected);
    }
  });

  test('invalid totals fall back to the one-bar cycle', () => {
    expect(loopLengthDivisors(0)).toEqual([1]);
    expect(loopLengthDivisors(-4)).toEqual([1]);
    expect(loopLengthDivisors(2.5)).toEqual([1]);
    expect(loopLengthDivisors(Number.NaN)).toEqual([1]);
    expect(loopLengthDivisors(Number.POSITIVE_INFINITY)).toEqual([1]);
  });
});

describe('clampLoopLength', () => {
  test('returns the current value when it already divides', () => {
    expect(clampLoopLength(2, 4)).toBe(2);
    expect(clampLoopLength(4, 4)).toBe(4);
  });
  test('clamps DOWN to the largest divisor <= current', () => {
    expect(clampLoopLength(3, 4)).toBe(2);
    expect(clampLoopLength(5, 6)).toBe(3);
    expect(clampLoopLength(3, 2)).toBe(2);
  });
  test('a zero/invalid total falls back to 1', () => {
    expect(clampLoopLength(4, 0)).toBe(1);
  });
});

describe('patternStoredIndexAt', () => {
  test('is bar-major at MAX_STEPS_PER_BAR, windowed to the active meter', () => {
    expect(patternStoredIndexAt(16, 16)).toBe(MAX_STEPS_PER_BAR);
    expect(patternStoredIndexAt(0, 16)).toBe(0);
    expect(patternStoredIndexAt(15, 16)).toBe(15);
    expect(patternStoredIndexAt(17, 16)).toBe(MAX_STEPS_PER_BAR + 1);
  });
  test('a narrower meter repeats the same bar-major stride', () => {
    expect(patternStoredIndexAt(12, 12)).toBe(MAX_STEPS_PER_BAR);
    expect(patternStoredIndexAt(11, 12)).toBe(11);
    expect(patternStoredIndexAt(24, 12)).toBe(2 * MAX_STEPS_PER_BAR);
    // Only the active window is reachable at 12 steps/bar; the slots between
    // it and MAX_STEPS_PER_BAR stay dormant, which is the point of the width.
    expect(patternStoredIndexAt(12, 12) - patternStoredIndexAt(11, 12)).toBe(MAX_STEPS_PER_BAR - 11);
  });
});

describe('foldPatternBoundaries', () => {
  test('folds a duration walk onto the cycle and always spans 0..cycleSteps', () => {
    expect(foldPatternBoundaries([16, 48], 32)).toEqual([0, 16, 32]);
    expect(foldPatternBoundaries([16, 16], 32)).toEqual([0, 16, 32]);
    expect(foldPatternBoundaries([8, 8, 8, 8], 32)).toEqual([0, 8, 16, 24, 32]);
  });
  test('an empty chord list is one cycle-long span', () => {
    expect(foldPatternBoundaries([], 32)).toEqual([0, 32]);
  });
  test('a duration walk landing exactly on the cycle adds no duplicate 0', () => {
    expect(foldPatternBoundaries([32], 32)).toEqual([0, 32]);
    expect(foldPatternBoundaries([64], 32)).toEqual([0, 32]);
  });
});

describe('maxPatternHold', () => {
  const boundaries = foldPatternBoundaries([16, 16], 32);
  test('is the steps from a column to the next boundary', () => {
    expect(maxPatternHold(12, [0, 16, 32], 32)).toBe(4);
    expect(maxPatternHold(0, boundaries, 32)).toBe(16);
    expect(maxPatternHold(16, boundaries, 32)).toBe(16);
  });
  test('the last segment runs to the cycle end', () => {
    expect(maxPatternHold(20, [0, 16, 32], 32)).toBe(12);
    expect(maxPatternHold(31, [0, 16, 32], 32)).toBe(1);
  });
  test('a column on a boundary holds the whole next segment, never zero', () => {
    expect(maxPatternHold(16, [0, 16, 32], 32)).toBeGreaterThan(0);
  });
  test('boundary order does not change the answer', () => {
    expect(maxPatternHold(12, [32, 0, 16], 32)).toBe(4);
  });
});
