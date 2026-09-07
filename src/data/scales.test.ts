import { describe, expect, test } from 'bun:test';
import { SCALES } from './scales';

describe('SCALES', () => {
  test('holds 11 scales', () => {
    expect(Object.keys(SCALES).length).toBe(11);
  });

  test('every scale has one triad and one seventh quality per degree', () => {
    // getDiatonicChordForDegree indexes both arrays by degree; a short array
    // hands back `undefined` and the chord silently loses its quality.
    for (const [key, scale] of Object.entries(SCALES)) {
      expect(scale.triadQualities.length, key).toBe(scale.intervals.length);
      expect(scale.seventhQualities.length, key).toBe(scale.intervals.length);
    }
  });

  test('every scale starts on the root', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      expect(scale.intervals[0], key).toBe(0);
    }
  });
});
