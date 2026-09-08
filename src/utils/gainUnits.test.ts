import { describe, expect, test } from 'bun:test';
import {
  clampForDisplay,
  dbToGain,
  dbToSliderPos,
  DEFAULT_UNITY_POS,
  DISPLAY_FLOOR_DBFS,
  FADER_MAX_DB,
  formatDb,
  gainToDb,
  gainToDbfs,
  SILENCE_DB,
  sliderPosTodB,
  toDecibels,
  toLinearGain,
  UNITY_DB,
  UNITY_GAIN,
} from './gainUnits';

describe('constants', () => {
  test('unity is 0 dB and 1.0 linear', () => {
    expect(UNITY_DB).toBe(0);
    expect(UNITY_GAIN).toBe(1);
  });

  test('silence is a finite -60, never -Infinity, because it is JSON.stringify-ed twice', () => {
    expect(SILENCE_DB).toBe(-60);
    expect(Number.isFinite(SILENCE_DB)).toBe(true);
    expect(JSON.parse(JSON.stringify({ db: SILENCE_DB })).db).toBe(-60);
  });

  test('the display floor and the silence value are the same place', () => {
    expect(DISPLAY_FLOOR_DBFS).toBe(-60);
    expect(DISPLAY_FLOOR_DBFS).toBe(SILENCE_DB as number);
  });

  test('the fader tops out at +12 with unity three quarters up', () => {
    expect(FADER_MAX_DB).toBe(12);
    expect(DEFAULT_UNITY_POS).toBe(0.75);
  });
});

describe('dbToGain / gainToDb', () => {
  test('unity round-trips', () => {
    expect(dbToGain(UNITY_DB)).toBeCloseTo(1, 12);
    expect(gainToDb(UNITY_GAIN)).toBeCloseTo(0, 12);
  });

  test('-6 dB halves, +6 dB doubles', () => {
    expect(dbToGain(toDecibels(-6))).toBeCloseTo(0.5012, 4);
    expect(dbToGain(toDecibels(6))).toBeCloseTo(1.9953, 4);
  });

  test('stored silence is inaudible but not zero', () => {
    expect(dbToGain(SILENCE_DB)).toBeCloseTo(0.001, 9);
  });

  test('round-trips an arbitrary value', () => {
    expect(gainToDb(dbToGain(toDecibels(-18)))).toBeCloseTo(-18, 10);
  });
});

describe('gainToDbfs', () => {
  test('full scale is 0 dBFS', () => {
    expect(gainToDbfs(toLinearGain(1))).toBeCloseTo(0, 12);
  });

  test('half amplitude is about -6 dBFS', () => {
    expect(gainToDbfs(toLinearGain(0.5))).toBeCloseTo(-6.0206, 4);
  });

  test('a sine RMS of 1/sqrt(2) is about -3 dBFS', () => {
    expect(gainToDbfs(toLinearGain(Math.SQRT1_2))).toBeCloseTo(-3.0103, 4);
  });

  test('zero gain is -Infinity, which is legal in a transient reading', () => {
    expect(gainToDbfs(toLinearGain(0))).toBe(-Infinity);
  });
});

describe('clampForDisplay', () => {
  test('lifts -Infinity to the display floor', () => {
    expect(clampForDisplay(-Infinity)).toBe(-60);
  });

  test('leaves a value above the floor alone', () => {
    expect(clampForDisplay(-12)).toBe(-12);
  });

  test('honours an explicit floor', () => {
    expect(clampForDisplay(-90, -48)).toBe(-48);
  });
});

describe('dbToSliderPos / sliderPosTodB', () => {
  test('unity sits at the default unity position', () => {
    expect(dbToSliderPos(0)).toBeCloseTo(0.75, 12);
    expect(sliderPosTodB(0.75)).toBeCloseTo(0, 12);
  });

  test('the ends are the ends', () => {
    expect(dbToSliderPos(-60)).toBe(0);
    expect(dbToSliderPos(12)).toBe(1);
    expect(sliderPosTodB(0)).toBe(-60);
    expect(sliderPosTodB(1)).toBe(12);
  });

  test('below the floor and -Infinity both pin to zero', () => {
    expect(dbToSliderPos(-120)).toBe(0);
    expect(dbToSliderPos(-Infinity)).toBe(0);
  });

  test('round-trips inside each half of the taper', () => {
    expect(sliderPosTodB(dbToSliderPos(-24))).toBeCloseTo(-24, 10);
    expect(sliderPosTodB(dbToSliderPos(6))).toBeCloseTo(6, 10);
  });

  test('a position outside 0..1 clamps rather than extrapolating', () => {
    expect(sliderPosTodB(-2)).toBe(-60);
    expect(sliderPosTodB(9)).toBe(12);
  });

  test('is monotonic across the whole range', () => {
    let previous = -1;
    for (let db = -60; db <= 12; db += 0.5) {
      const pos = dbToSliderPos(db);
      expect(pos).toBeGreaterThan(previous);
      previous = pos;
    }
  });

  test('the quiet range gets the resolution the linear fader denied it', () => {
    // -60..-6 dB used to live in the bottom third of a 0..1.5 linear travel.
    // On the taper it owns more than half of it. This is the whole point of
    // DEV-386's curve, so it is asserted rather than left to the anchors.
    const quietSpan = dbToSliderPos(-6) - dbToSliderPos(-60);
    expect(quietSpan).toBeGreaterThan(0.5);
  });
});

describe('formatDb', () => {
  test('renders one decimal with a unit', () => {
    expect(formatDb(0)).toBe('0.0 dB');
    expect(formatDb(-6)).toBe('-6.0 dB');
    expect(formatDb(3.14159)).toBe('3.1 dB');
  });

  test('negative zero prints as zero, not "-0.0 dB"', () => {
    expect(formatDb(-0)).toBe('0.0 dB');
  });

  test('the infinities and NaN read as silence or ceiling, never "NaN dB"', () => {
    expect(formatDb(-Infinity)).toBe('-∞ dB');
    expect(formatDb(Infinity)).toBe('+∞ dB');
    expect(formatDb(Number.NaN)).toBe('-∞ dB');
    // The finite silence sentinel renders as silence, not as its number — the fader's bottom
    // detent and true silence are the same place (contract divergence 2).
    expect(formatDb(SILENCE_DB)).toBe('-∞ dB');
    expect(formatDb(-59.9)).toBe('-59.9 dB');
  });
});
