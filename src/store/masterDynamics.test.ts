import { describe, expect, test } from 'bun:test';
import { EFFECT_LIMITS, clampEffectValue } from '../audio/effectLimits';
import { INITIAL_EFFECTS } from './initialState';

/**
 * The DEV-385 state contract, updated by DEV-383. The compressor and limiter are
 * explicit master FX: their parameters are stored and clamped. Their seeded
 * NUMERIC values deliberately equal the engine's historical hardcodes, so
 * switching a module on reproduces exactly what the app used to do behind the
 * user's back. `compressorEnabled` still defaults OFF (DEV-385: a user must opt
 * into compression shaping the mix). `limiterEnabled` defaults ON (DEV-383): the
 * master analysers tap ahead of both dynamics stages, so an engaged limiter
 * never caps what a meter can show, and its -3 dB threshold against the -6 dB
 * source-bus default only catches occasional peaks, not a continuous squash.
 */
describe('master dynamics defaults', () => {
  test('the compressor defaults OFF, the limiter defaults ON', () => {
    expect(INITIAL_EFFECTS.compressorEnabled).toBe(false);
    expect(INITIAL_EFFECTS.limiterEnabled).toBe(true);
  });

  test('the compressor is seeded with the engine\'s historical values', () => {
    expect(INITIAL_EFFECTS.compressorThreshold).toBe(-12);
    expect(INITIAL_EFFECTS.compressorRatio).toBe(4);
    expect(INITIAL_EFFECTS.compressorAttack).toBeCloseTo(0.003, 6);
    expect(INITIAL_EFFECTS.compressorRelease).toBeCloseTo(0.25, 6);
  });

  test('the limiter is seeded with the engine\'s historical values', () => {
    expect(INITIAL_EFFECTS.limiterThreshold).toBe(-3);
    expect(INITIAL_EFFECTS.limiterRatio).toBe(20);
    expect(INITIAL_EFFECTS.limiterAttack).toBeCloseTo(0.003, 6);
    expect(INITIAL_EFFECTS.limiterRelease).toBeCloseTo(0.15, 6);
  });
});

describe('master dynamics clamping', () => {
  test('every new numeric field has a range, and its fallback is the factory default', () => {
    const keys = [
      'compressorThreshold',
      'compressorRatio',
      'compressorAttack',
      'compressorRelease',
      'limiterThreshold',
      'limiterRatio',
      'limiterAttack',
      'limiterRelease',
    ] as const;
    for (const key of keys) {
      expect(EFFECT_LIMITS[key]).toBeDefined();
      expect(EFFECT_LIMITS[key].fallback).toBe(INITIAL_EFFECTS[key]);
    }
  });

  test('ratio and attack/release ranges match what a DynamicsCompressorNode will accept', () => {
    // Web Audio's own AudioParam ranges: ratio 1..20, attack/release 0..1.
    // Clamping to the node's range means a clamped value is always a legal write.
    expect(EFFECT_LIMITS.compressorRatio).toEqual({ min: 1, max: 20, fallback: 4 });
    expect(EFFECT_LIMITS.limiterRatio).toEqual({ min: 1, max: 20, fallback: 20 });
    expect(clampEffectValue('compressorAttack', 5)).toBe(1);
    expect(clampEffectValue('limiterRelease', -3)).toBe(0);
  });

  test('a non-finite persisted value becomes the factory default, not NaN', () => {
    expect(clampEffectValue('limiterThreshold', Number.NaN)).toBe(-3);
    expect(clampEffectValue('compressorRatio', 'loud')).toBe(4);
  });
});
