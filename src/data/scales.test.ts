import { describe, expect, test } from 'bun:test';
import { SCALES } from './scales';
import { scaleEntry } from '@/musicCore';
import { parentDegreesFor, resolveParentDegreeQuality } from '@/utils/musicTheory';

// The golden pin. These are the interval arrays the eleven legacy scales were
// hand-authored with before intervals became derived from `tonal`. A saved
// project names its scale by key, so each of these must keep sounding exactly
// as it did: a tonal upgrade that shifts one fails here, never in a user's ear.
// Copied verbatim from src/data/scales.ts as it stood; never regenerate it.
const LEGACY_INTERVALS: Record<string, readonly number[]> = {
  'Major': [0, 2, 4, 5, 7, 9, 11],
  'Natural Minor': [0, 2, 3, 5, 7, 8, 10],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Lydian': [0, 2, 4, 6, 7, 9, 11],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10],
  'Minor Pentatonic': [0, 3, 5, 7, 10],
  'Major Pentatonic': [0, 2, 4, 7, 9],
  'Blues': [0, 3, 5, 6, 7, 10],
  'Hirajoshi': [0, 2, 3, 7, 8],
};

describe('SCALES', () => {
  test('the eleven legacy keys still exist', () => {
    for (const key of Object.keys(LEGACY_INTERVALS)) {
      expect(Object.hasOwn(SCALES, key), key).toBe(true);
    }
  });

  test('every legacy scale derives exactly the intervals it was authored with', () => {
    for (const [key, intervals] of Object.entries(LEGACY_INTERVALS)) {
      expect(scaleEntry(key).intervals, key).toEqual(intervals);
    }
  });

  test('every parent names a 7-note SCALES entry, and no 7-note scale declares one', () => {
    for (const key of Object.keys(SCALES)) {
      const scale = scaleEntry(key);
      if (scale.intervals.length === 7) {
        expect(scale.parent, key).toBeUndefined();
        continue;
      }
      expect(scale.parent, key).toBeDefined();
      const parentKey = scale.parent as string;
      expect(Object.hasOwn(SCALES, parentKey), key).toBe(true);
      expect(scaleEntry(parentKey).intervals.length, key).toBe(7);
    }
  });

  // A degree the parent does not contain resolves through its nearest parent
  // neighbours. When two are equidistant their qualities must AGREE — the tie
  // is decided by agreement, never by array order. If this goes red, the answer
  // is an explicit `parent` change, never a tiebreak rule invented at that
  // moment to make the suite pass.
  test('equidistant parent neighbours agree on the quality', () => {
    let ties = 0;
    for (const key of Object.keys(SCALES)) {
      scaleEntry(key).intervals.forEach((_, degree) => {
        const { parentKey, degrees } = parentDegreesFor(key, degree);
        if (degrees.length < 2) return;
        ties++;
        for (const use7ths of [false, true]) {
          const qualities = degrees.map((d) => resolveParentDegreeQuality(parentKey, d, use7ths));
          expect(new Set(qualities).size, `${key} degree ${degree} 7ths=${use7ths}`).toBe(1);
        }
      });
    }
    // Exactly one tie exists today: Blues degree 3, the b5 at interval 6,
    // equidistant from Natural Minor's interval 5 and interval 7.
    expect(ties).toBe(1);
  });
});
