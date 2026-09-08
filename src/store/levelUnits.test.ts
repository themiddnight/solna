import { describe, expect, test } from 'bun:test';
import { DEFAULT_BUS_TRIM_DB, DEFAULT_FADER_DB, FADER_MIN_DB, FADER_POSITION_STEP, asFaderDb, faderDbToGain } from './levelUnits';

describe('asFaderDb', () => {
  test('passes an in-range value through untouched', () => {
    expect(asFaderDb(-6)).toBe(-6);
    expect(asFaderDb(0)).toBe(0);
    expect(asFaderDb(11.5)).toBe(11.5);
  });

  test('an out-of-range finite number falls back to the default, not the nearest bound', () => {
    // What is unknown about an out-of-range value is its UNIT, not its
    // magnitude — pulling it to the ceiling would be a confident wrong guess.
    expect(asFaderDb(-200)).toBe(DEFAULT_FADER_DB);
    expect(asFaderDb(48)).toBe(DEFAULT_FADER_DB);
    // Uses the caller's own fallback, not a hardcoded 0 — a bus default is
    // DEFAULT_BUS_TRIM_DB (-6 dB), not unity.
    expect(asFaderDb(70, DEFAULT_BUS_TRIM_DB)).toBe(DEFAULT_BUS_TRIM_DB);
    expect(asFaderDb(100, DEFAULT_BUS_TRIM_DB)).toBe(DEFAULT_BUS_TRIM_DB);
  });

  test('falls back for anything that is not a finite number', () => {
    expect(asFaderDb(undefined)).toBe(DEFAULT_FADER_DB);
    expect(asFaderDb('-6')).toBe(DEFAULT_FADER_DB);
    expect(asFaderDb(NaN)).toBe(DEFAULT_FADER_DB);
    expect(asFaderDb(-Infinity)).toBe(DEFAULT_FADER_DB);
    expect(asFaderDb(null, -12)).toBe(-12);
  });
});

describe('faderDbToGain', () => {
  test('the bottom of the fader is TRUE silence, not 0.001', () => {
    expect(faderDbToGain(FADER_MIN_DB)).toBe(0);
    expect(faderDbToGain(-60)).toBe(0);
    // Anything clamped below the floor lands on the floor, so it is silent too.
    expect(faderDbToGain(-120)).toBe(0);
  });

  test('just above the floor is quiet but NOT zero', () => {
    const nearFloor = faderDbToGain(-59.9);
    expect(nearFloor).toBeGreaterThan(0);
    expect(nearFloor).toBeLessThan(0.002);
  });

  test('unity and the top of the range convert exactly', () => {
    expect(faderDbToGain(0)).toBeCloseTo(1, 10);
    expect(faderDbToGain(-6)).toBeCloseTo(0.5011872, 6);
    expect(faderDbToGain(12)).toBeCloseTo(3.9810717, 6);
  });

  test('a non-finite value is silence, never NaN reaching an AudioParam', () => {
    expect(faderDbToGain(Number.NaN)).toBe(0);
    expect(faderDbToGain(-Infinity)).toBe(0);
  });
});

describe('the shared constants', () => {
  test('every fader starts at unity and steps by position, not by dB', () => {
    expect(DEFAULT_FADER_DB).toBe(0);
    expect(FADER_POSITION_STEP).toBe(0.005);
  });
});
