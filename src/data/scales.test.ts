import { describe, expect, test } from 'bun:test';
import { SCALES, SCALE_CATEGORIES } from './scales';
import { scaleEntry } from '@/musicCore';
import { parentDegreesFor, resolveDegreeQuality, resolveParentDegreeQuality } from '@/utils/musicTheory';

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
    // Exactly two ties exist today, and both sides agree in each: Blues
    // degree 3, the b5 at interval 6, equidistant from Natural Minor's
    // intervals 5 and 7; and Major Blues degree 2, the blue b3 at interval 3,
    // equidistant from Major's intervals 2 and 4.
    expect(ties).toBe(2);
  });

  test('holds the library keys in display order', () => {
    expect(Object.keys(SCALES)).toEqual([
      'Major', 'Natural Minor', 'Harmonic Minor', 'Melodic Minor', 'Harmonic Major',
      'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Locrian', 'Dorian b2', 'Lydian Dominant',
      'Lydian Augmented', 'Mixolydian b6', 'Locrian #2', 'Phrygian Dominant',
      'Major Pentatonic', 'Minor Pentatonic', 'Egyptian',
      'Major Blues', 'Blues',
      'Hirajoshi', 'Pelog', 'Vietnamese',
    ]);
  });

  test('every scale has 5 to 7 intervals, from 0, strictly increasing, below 12', () => {
    for (const key of Object.keys(SCALES)) {
      const { intervals } = scaleEntry(key);
      expect(intervals.length, key).toBeGreaterThanOrEqual(5);
      expect(intervals.length, key).toBeLessThanOrEqual(7);
      expect(intervals[0], key).toBe(0);
      intervals.forEach((interval, i) => {
        expect(interval, key).toBeLessThan(12);
        if (i > 0) expect(interval, key).toBeGreaterThan(intervals[i - 1]);
      });
    }
  });

  test('no parent itself has a parent', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      if (scale.parent === undefined) continue;
      expect(SCALES[scale.parent].parent, key).toBeUndefined();
    }
  });

  // The major third decides, when the scale has one: Major Blues holds the b3
  // as a blue note beside its major third and is still a major-key scale. A
  // scale with no third at all (Egyptian) spells as minor.
  test('tonality agrees with the derived third', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      const expected = scaleEntry(key).intervals.includes(4) ? 'major' : 'minor';
      expect(scale.tonality, key).toBe(expected);
    }
  });

  test('categories run in SCALE_CATEGORIES order, contiguously, none empty', () => {
    const runs: string[] = [];
    for (const scale of Object.values(SCALES)) {
      if (runs[runs.length - 1] !== scale.category) runs.push(scale.category);
    }
    expect(runs).toEqual([...SCALE_CATEGORIES]);
  });

  test('every scale has a name and a one-line description', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      expect(scale.name.trim(), key).not.toBe('');
      expect(scale.description, key).toMatch(/^\S.* · \S.*$/);
      expect(scale.description, key).not.toContain('\n');
    }
  });

  // The header's short label renders the key itself, so a key must read as
  // plain text: letters, digits, spaces and '#' only — no '♭' or '♯'.
  test('every key is readable ASCII', () => {
    for (const key of Object.keys(SCALES)) {
      expect(key).toMatch(/^[A-Za-z0-9# ]+$/);
    }
  });
});

describe('harmony', () => {
  // Every scale must harmonize at every degree: a scale whose derived
  // interval tuple is missing from the quality tables throws in
  // resolveDegreeQuality, and that must fail here, not in the chord pads.
  test('every degree of every scale resolves a triad and a seventh', () => {
    for (const key of Object.keys(SCALES)) {
      scaleEntry(key).intervals.forEach((_, degree) => {
        for (const use7ths of [false, true]) {
          expect(() => resolveDegreeQuality(key, degree, use7ths), `${key} degree ${degree} 7ths=${use7ths}`).not.toThrow();
        }
      });
    }
  });
});
