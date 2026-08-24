import { describe, expect, test } from 'bun:test';
import { GENRE_PRESETS } from './genrePresets';

describe('GENRE_PRESETS data sanity', () => {
  test('every genre defines a 16-step boolean pattern for every instrument', () => {
    const genres = Object.keys(GENRE_PRESETS);
    expect(genres.length).toBeGreaterThan(0);
    for (const genre of genres) {
      const instruments = GENRE_PRESETS[genre];
      expect(Object.keys(instruments).length).toBeGreaterThan(0);
      for (const [instrument, steps] of Object.entries(instruments)) {
        expect(steps.length, `${genre}/${instrument} must be 16 steps`).toBe(16);
        expect(steps.every((v) => typeof v === 'boolean'), `${genre}/${instrument} must be booleans`).toBe(true);
      }
    }
  });
});
