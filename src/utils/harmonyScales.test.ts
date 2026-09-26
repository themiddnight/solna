import { describe, expect, test } from 'bun:test';
import { getDiatonicChordForDegree, getDiatonicChords } from './musicTheory';

describe('getDiatonicChords', () => {
  test('is one getDiatonicChordForDegree per degree of the chord-hosting scale', () => {
    expect(getDiatonicChords('C', 'Major', false)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((degree) => getDiatonicChordForDegree(degree, 'C', 'Major', false)),
    );
    expect(getDiatonicChords('A', 'Hirajoshi', true)).toHaveLength(5);
  });

  test('C major triads read I to vii°', () => {
    expect(getDiatonicChords('C', 'Major', false).map((c) => `${c.root}${c.quality}:${c.degreeName}`)).toEqual([
      'Cmaj:I', 'Dmin:ii', 'Emin:iii', 'Fmaj:IV', 'Gmaj:V', 'Amin:vi', 'Bdim:vii',
    ]);
  });
});
