import { describe, expect, test } from 'bun:test';
import { DRUM_TRIMS } from '@/data/trimTable';
import { NEUTRAL_TRIM_GAIN, drumTrimGainFor } from '@/audio/trims';

describe('drumTrimGainFor', () => {
  test('an unknown kit yields NEUTRAL_TRIM_GAIN', () => {
    expect(drumTrimGainFor('No Such Kit')).toBe(NEUTRAL_TRIM_GAIN);
  });

  test('an undefined kit name yields NEUTRAL_TRIM_GAIN rather than throwing', () => {
    expect(drumTrimGainFor(undefined)).toBe(NEUTRAL_TRIM_GAIN);
  });

  test('every committed kit entry becomes a positive finite gain', () => {
    for (const kitName of Object.keys(DRUM_TRIMS)) {
      const gain = drumTrimGainFor(kitName);
      expect(Number.isFinite(gain)).toBe(true);
      expect(gain).toBeGreaterThan(0);
    }
  });

  test('NEUTRAL_TRIM_GAIN is unity', () => {
    expect(NEUTRAL_TRIM_GAIN).toBe(1);
  });
});
