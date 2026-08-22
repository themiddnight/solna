import { describe, expect, test } from 'bun:test';
import {
  SCALES,
  generateBlockChordNotes,
  getBorrowedChords,
  getDiatonicChordForDegree,
  isChordDiatonic,
  isNoteInScale,
} from './musicTheory';

const SCALE_KEYS = Object.keys(SCALES);

function inScalePaletteEntries(root: string, scaleType: string): Set<string> {
  const numDegrees = SCALES[scaleType]?.intervals.length ?? 7;
  const entries = new Set<string>();
  for (let degree = 0; degree < numDegrees; degree++) {
    for (const use7ths of [false, true]) {
      const chord = getDiatonicChordForDegree(degree, root, scaleType, use7ths);
      entries.add(`${chord.root}:${chord.quality}`);
    }
  }
  return entries;
}

function strictlyDiatonic(
  chordRoot: string,
  quality: string,
  root: string,
  scaleType: string,
): boolean {
  const notes = generateBlockChordNotes(quality, chordRoot);
  return notes.length > 0 && notes.every((n) => isNoteInScale(n, root, scaleType));
}

describe('isChordDiatonic', () => {
  test('Dmin7 is diatonic in C Major', () => {
    expect(isChordDiatonic('D', 'min7', 'C', 'Major')).toBe(true);
  });

  test('Fmin is not diatonic in C Major', () => {
    expect(isChordDiatonic('F', 'min', 'C', 'Major')).toBe(false);
  });

  test('A# major is diatonic in C Mixolydian', () => {
    expect(isChordDiatonic('A#', 'maj', 'C', 'Mixolydian')).toBe(true);
  });

  test('Dm7b5 is not diatonic in C Major', () => {
    expect(isChordDiatonic('D', 'm7b5', 'C', 'Major')).toBe(false);
  });
});

describe('getBorrowedChords catalog', () => {
  test('major branch returns the standard set with corrected iiø7 (m7b5) quality', () => {
    const got = getBorrowedChords('C', 'Major')
      .map((c) => `${c.root}:${c.quality}`)
      .sort();
    expect(got).toEqual(
      ['A#:maj', 'C#:maj', 'D:m7b5', 'D#:maj', 'F:min', 'G#:maj'].sort(),
    );
  });

  test('minor branch contains no III entry', () => {
    for (const scaleType of ['Natural Minor', 'Harmonic Minor', 'Dorian', 'Phrygian']) {
      const borrowed = getBorrowedChords('C', scaleType);
      expect(borrowed.filter((c) => c.label.includes('III'))).toEqual([]);
    }
  });

  test('never duplicates an in-scale palette chord nor a strictly diatonic chord', () => {
    for (const scaleType of SCALE_KEYS) {
      const palette = inScalePaletteEntries('C', scaleType);
      const duplicates = getBorrowedChords('C', scaleType)
        .filter(
          (c) =>
            palette.has(`${c.root}:${c.quality}`) ||
            strictlyDiatonic(c.root, c.quality, 'C', scaleType),
        )
        .map((d) => `${scaleType}: ${d.root}${d.quality}`);
      expect(duplicates).toEqual([]);
    }
  });
});
