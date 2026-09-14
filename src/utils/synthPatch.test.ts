import { describe, expect, test } from 'bun:test';
import type { ModRoute, NoteDivision } from '@/types/synth';
import {
  SYNTH_GAIN_FLOOR_DB,
  dbToGain,
  gainToDb,
  lfoRateHz,
  modulationAmount,
  oscillatorBalance,
  semitonesToRatio,
  writeOscillatorBalance,
} from '@/utils/synthPatch';

describe('dbToGain / gainToDb', () => {
  test('0 dB is unity gain', () => {
    expect(dbToGain(0)).toBeCloseTo(1);
  });

  test('round-trips through gain and back', () => {
    expect(gainToDb(dbToGain(-18))).toBeCloseTo(-18);
  });

  test('floors zero gain instead of returning -Infinity', () => {
    const db = gainToDb(0);
    expect(db).toBe(SYNTH_GAIN_FLOOR_DB);
    expect(Number.isFinite(db)).toBe(true);
  });

  test('floors negative gain the same way as zero', () => {
    expect(gainToDb(-1)).toBe(SYNTH_GAIN_FLOOR_DB);
  });

  test('floors a gain quieter than the floor', () => {
    expect(gainToDb(1e-12)).toBe(SYNTH_GAIN_FLOOR_DB);
  });

  test('the floor dB converts back to a near-silent, non-zero gain', () => {
    const gain = dbToGain(SYNTH_GAIN_FLOOR_DB);
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThan(0.001);
  });
});

describe('semitonesToRatio', () => {
  test('an octave up doubles frequency', () => {
    expect(semitonesToRatio(12)).toBeCloseTo(2);
  });

  test('an octave down halves frequency', () => {
    expect(semitonesToRatio(-12)).toBeCloseTo(0.5);
  });

  test('zero semitones is unity ratio', () => {
    expect(semitonesToRatio(0)).toBeCloseTo(1);
  });
});

describe('oscillatorBalance / writeOscillatorBalance', () => {
  test('writes and reads back the same balance while preserving combined power', () => {
    const original = { osc1Db: -6, osc2Db: -12 };
    const moved = writeOscillatorBalance(original, 0.75);
    expect(oscillatorBalance(moved)).toBeCloseTo(0.75);
    expect(dbToGain(moved.osc1Db) ** 2 + dbToGain(moved.osc2Db) ** 2).toBeCloseTo(
      dbToGain(original.osc1Db) ** 2 + dbToGain(original.osc2Db) ** 2,
    );
  });

  test('equal levels read as centered balance', () => {
    expect(oscillatorBalance({ osc1Db: -6, osc2Db: -6 })).toBeCloseTo(0.5);
  });

  test('a balance of 0 silences osc2 at the floor', () => {
    const moved = writeOscillatorBalance({ osc1Db: -3, osc2Db: -3 }, 0);
    expect(moved.osc2Db).toBe(SYNTH_GAIN_FLOOR_DB);
  });

  test('a balance of 1 silences osc1 at the floor', () => {
    const moved = writeOscillatorBalance({ osc1Db: -3, osc2Db: -3 }, 1);
    expect(moved.osc1Db).toBe(SYNTH_GAIN_FLOOR_DB);
  });

  test('both oscillators silent reads as centered rather than NaN', () => {
    expect(oscillatorBalance({ osc1Db: SYNTH_GAIN_FLOOR_DB, osc2Db: SYNTH_GAIN_FLOOR_DB })).toBe(0.5);
  });

  test('an out-of-range balance below 0 clamps to 0', () => {
    const pair = { osc1Db: -6, osc2Db: -12 };
    expect(writeOscillatorBalance(pair, -0.4)).toEqual(writeOscillatorBalance(pair, 0));
  });

  test('an out-of-range balance above 1 clamps to 1', () => {
    const pair = { osc1Db: -6, osc2Db: -12 };
    expect(writeOscillatorBalance(pair, 1.4)).toEqual(writeOscillatorBalance(pair, 1));
  });
});

describe('lfoRateHz', () => {
  const straight = (value: NoteDivision['value']): NoteDivision => ({ value, modifier: 'straight' });

  test('a quarter note at 120 BPM is 2 Hz', () => {
    expect(lfoRateHz(straight(4), 120)).toBeCloseTo(2);
  });

  test('an eighth note is twice the rate of a quarter note at the same tempo', () => {
    expect(lfoRateHz(straight(8), 120)).toBeCloseTo(lfoRateHz(straight(4), 120) * 2);
  });

  test('a dotted division is slower (lower Hz) than the same straight division', () => {
    const dotted = lfoRateHz({ value: 8, modifier: 'dotted' }, 120);
    const plain = lfoRateHz(straight(8), 120);
    expect(dotted).toBeLessThan(plain);
    expect(dotted).toBeCloseTo(plain / 1.5);
  });

  test('a triplet division is faster (higher Hz) than the same straight division', () => {
    const triplet = lfoRateHz({ value: 8, modifier: 'triplet' }, 120);
    const plain = lfoRateHz(straight(8), 120);
    expect(triplet).toBeGreaterThan(plain);
    expect(triplet).toBeCloseTo(plain * 1.5);
  });

  test('rate scales with tempo', () => {
    expect(lfoRateHz(straight(4), 60)).toBeCloseTo(1);
    expect(lfoRateHz(straight(4), 240)).toBeCloseTo(4);
  });
});

describe('modulationAmount', () => {
  test('scales a signed semitone route amount by depth', () => {
    const route: ModRoute = { target: 'pitch-all', unit: 'semitones', amount: -12 };
    expect(modulationAmount(route, 0.5)).toBeCloseTo(-6);
  });

  test('scales a signed dB route amount by depth', () => {
    const route: ModRoute = { target: 'amplitude', unit: 'db', amount: 6 };
    expect(modulationAmount(route, 0.25)).toBeCloseTo(1.5);
  });

  test('scales a signed normalized resonance route amount by depth', () => {
    const route: ModRoute = { target: 'filter-resonance', unit: 'normalized', amount: -0.4 };
    expect(modulationAmount(route, 1)).toBeCloseTo(-0.4);
  });

  test('clamps a pan route to -1..1 at the positive end', () => {
    const route: ModRoute = { target: 'pan', unit: 'pan', amount: 0.8 };
    expect(modulationAmount(route, 2)).toBe(1);
  });

  test('clamps a pan route to -1..1 at the negative end', () => {
    const route: ModRoute = { target: 'pan', unit: 'pan', amount: -0.8 };
    expect(modulationAmount(route, 2)).toBe(-1);
  });

  test('zero depth silences any route', () => {
    const route: ModRoute = { target: 'filter-cutoff', unit: 'semitones', amount: 24 };
    expect(modulationAmount(route, 0)).toBe(0);
  });
});
