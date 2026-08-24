import { describe, expect, test } from 'bun:test';
import {
  SCALES,
  formatChordLabel,
  formatChordQuality,
  generateBlockChordNotes,
  getBorrowedChords,
  getDiatonicChordForDegree,
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

describe('formatChordLabel', () => {
  test('renders standard chord shorthand for every quality token', () => {
    expect(formatChordLabel('C', 'maj')).toBe('C');
    expect(formatChordLabel('C', 'min')).toBe('Cm');
    expect(formatChordLabel('C', 'maj7')).toBe('Cmaj7');
    expect(formatChordLabel('C', 'min7')).toBe('Cm7');
    expect(formatChordLabel('C', '7')).toBe('C7');
    expect(formatChordLabel('C', 'm7b5')).toBe('Cm7b5');
    expect(formatChordLabel('C', 'dim')).toBe('Cdim');
    expect(formatChordLabel('C', 'dim7')).toBe('Cdim7');
    expect(formatChordLabel('C', 'aug')).toBe('Caug');
    expect(formatChordLabel('C', 'sus2')).toBe('Csus2');
    expect(formatChordLabel('C', 'sus4')).toBe('Csus4');
    expect(formatChordLabel('C', '7sus4')).toBe('C7sus4');
    expect(formatChordLabel('C', '9')).toBe('C9');
    expect(formatChordLabel('C', 'maj9')).toBe('Cmaj9');
    expect(formatChordLabel('C', 'min9')).toBe('Cm9');
    expect(formatChordLabel('C', 'add9')).toBe('Cadd9');
    expect(formatChordLabel('C', '6')).toBe('C6');
    expect(formatChordLabel('C', 'min6')).toBe('Cm6');
    expect(formatChordLabel('C', 'minMaj7')).toBe('CmM7');
    expect(formatChordLabel('C', 'maj7#5')).toBe('Cmaj7#5');
    expect(formatChordLabel('F#', 'min7')).toBe('F#m7');
  });

  test('falls back to the raw quality for unknown tokens', () => {
    expect(formatChordLabel('C', 'unknown')).toBe('Cunknown');
  });

  test('formatChordQuality returns just the suffix', () => {
    expect(formatChordQuality('maj')).toBe('');
    expect(formatChordQuality('min7')).toBe('m7');
    expect(formatChordQuality('minMaj7')).toBe('mM7');
  });
});
