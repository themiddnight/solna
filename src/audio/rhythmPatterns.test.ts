import { describe, expect, test } from 'bun:test';
import { equalPowerVelocityScale, feelToHoldScale, fullHoldDuration } from './rhythmPatterns';

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

describe('fullHoldDuration', () => {
  test('caps a full-bar hold at the chord length when holdScale > 1', () => {
    // 2 bars × 2 s, holdScale 2 → 8 s unclamped, clamped to the 4 s chord.
    expect(fullHoldDuration(2, 2, 2)).toBeCloseTo(4, 5);
  });
  test('keeps the hold at chord length when holdScale is neutral', () => {
    expect(fullHoldDuration(2, 2, 1)).toBeCloseTo(4, 5);
  });
  test('shortens the hold when holdScale < 1', () => {
    expect(fullHoldDuration(2, 2, 0.5)).toBeCloseTo(2, 5);
  });
});

describe('equalPowerVelocityScale', () => {
  test('a single note keeps its full velocity', () => {
    expect(equalPowerVelocityScale(1)).toBeCloseTo(1, 5);
  });
  test('4 notes scale by 1/√4 = 0.5', () => {
    expect(equalPowerVelocityScale(4)).toBeCloseTo(0.5, 5);
  });
  test('7 notes scale by 1/√7', () => {
    expect(equalPowerVelocityScale(7)).toBeCloseTo(1 / Math.sqrt(7), 5);
  });
  test('zero notes fall back to 1 instead of Infinity', () => {
    expect(equalPowerVelocityScale(0)).toBeCloseTo(1, 5);
  });
});
