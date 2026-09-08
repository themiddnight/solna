import { describe, expect, test } from 'bun:test';
import {
  REDUCTION_METER_FLOOR_DB,
  REDUCTION_STEP_DB,
  formatReduction,
  quantiseReduction,
  reductionPercent,
} from './gainReduction';

describe('quantiseReduction', () => {
  test('rounds AWAY from zero onto the step, so the readout never flatters the mix', () => {
    expect(REDUCTION_STEP_DB).toBe(0.5);
    expect(quantiseReduction(-4.3)).toBe(-4.5);
    expect(quantiseReduction(-4.5)).toBe(-4.5);
    expect(quantiseReduction(-0.1)).toBe(-0.5);
  });

  test('a stage that is doing nothing reads exactly zero', () => {
    expect(quantiseReduction(0)).toBe(0);
    // DynamicsCompressorNode.reduction is never positive; a positive reading
    // is a broken or absent node, and 0 is the honest answer for that.
    expect(quantiseReduction(2)).toBe(0);
    expect(quantiseReduction(Number.NaN)).toBe(0);
    expect(quantiseReduction(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('formatReduction', () => {
  test('always one decimal and always a dB suffix', () => {
    expect(formatReduction(0)).toBe('0.0 dB');
    expect(formatReduction(-4.3)).toBe('-4.5 dB');
    expect(formatReduction(-12)).toBe('-12.0 dB');
  });
});

describe('reductionPercent', () => {
  test('fills the bar in proportion to the floor and pins there', () => {
    expect(REDUCTION_METER_FLOOR_DB).toBe(-12);
    expect(reductionPercent(0)).toBe(0);
    expect(reductionPercent(-6)).toBe(50);
    expect(reductionPercent(-12)).toBe(100);
    expect(reductionPercent(-30)).toBe(100);
  });
});
