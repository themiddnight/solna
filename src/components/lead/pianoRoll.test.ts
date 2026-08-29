import { describe, expect, test } from 'bun:test';
import { hasOutOfScaleNote, leadPitchRows, leadStoredIndex } from './pianoRoll';

describe('leadPitchRows — scale-locked', () => {
  test('lists the scale notes across the window, highest first', () => {
    expect(leadPitchRows('scale-locked', 'C', 'Major', 3, 2)).toEqual([
      'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4',
      'B3', 'A3', 'G3', 'F3', 'E3', 'D3', 'C3',
    ]);
  });
  test('a pentatonic scale yields 5 rows per octave', () => {
    expect(leadPitchRows('scale-locked', 'C', 'Minor Pentatonic', 3, 2)).toHaveLength(10);
  });
});

describe('leadPitchRows — chromatic', () => {
  test('lists all 12 semitones per octave, highest first', () => {
    const rows = leadPitchRows('chromatic', 'C', 'Major', 3, 1);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toBe('B3');
    expect(rows[11]).toBe('C3');
  });
});

describe('hasOutOfScaleNote', () => {
  test('detects a note outside the active scale', () => {
    expect(hasOutOfScaleNote(['C4', 'C#4'], 'C', 'Major')).toBe(true);
    expect(hasOutOfScaleNote(['C4', 'E4'], 'C', 'Major')).toBe(false);
    expect(hasOutOfScaleNote([], 'C', 'Major')).toBe(false);
  });
});

describe('leadStoredIndex', () => {
  test('maps a (bar, step) column to the fixed-width stored slot', () => {
    expect(leadStoredIndex(0, 0)).toBe(0);
    expect(leadStoredIndex(0, 15)).toBe(15);
    expect(leadStoredIndex(1, 0)).toBe(24);
    expect(leadStoredIndex(2, 5)).toBe(53);
  });
});
