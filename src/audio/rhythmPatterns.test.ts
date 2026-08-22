import { describe, expect, test } from 'bun:test';
import { feelToHoldScale } from './rhythmPatterns';

describe('feelToHoldScale', () => {
  test('neutral (0.5) keeps the hold at x1', () => {
    expect(feelToHoldScale(0.5)).toBeCloseTo(1, 5);
  });
  test('tight (0) halves the hold', () => {
    expect(feelToHoldScale(0)).toBeCloseTo(0.5, 5);
  });
  test('loose (1) doubles the hold', () => {
    expect(feelToHoldScale(1)).toBeCloseTo(2, 5);
  });
});
