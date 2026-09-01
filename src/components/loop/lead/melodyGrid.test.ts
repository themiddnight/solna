import { describe, expect, test } from 'bun:test';
import { isBlackKey, isRootNote, leadPitchRows, leadStoredIndex } from './melodyGrid';

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
  test('C# major keeps its 7th in the correct octave (C5, enharmonic B#)', () => {
    expect(leadPitchRows('scale-locked', 'C#', 'Major', 4, 1)).toEqual([
      'C5', 'A#4', 'G#4', 'F#4', 'F4', 'D#4', 'C#4',
    ]);
  });
  test('D major puts its leading tone C# in the next octave (C#5, not C#4)', () => {
    expect(leadPitchRows('scale-locked', 'D', 'Major', 4, 1)).toEqual([
      'C#5', 'B4', 'A4', 'G4', 'F#4', 'E4', 'D4',
    ]);
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

describe('leadStoredIndex', () => {
  test('maps a (bar, step) column to the fixed-width stored slot', () => {
    expect(leadStoredIndex(0, 0)).toBe(0);
    expect(leadStoredIndex(0, 15)).toBe(15);
    expect(leadStoredIndex(1, 0)).toBe(24);
    expect(leadStoredIndex(2, 5)).toBe(53);
  });
});

describe('isBlackKey', () => {
  test('sharp/flat pitch classes are black keys, naturals are not', () => {
    expect(isBlackKey('C#4')).toBe(true);
    expect(isBlackKey('Db4')).toBe(true);
    expect(isBlackKey('F#3')).toBe(true);
    expect(isBlackKey('C4')).toBe(false);
    expect(isBlackKey('E4')).toBe(false);
    expect(isBlackKey('B3')).toBe(false);
  });
});

describe('isRootNote', () => {
  test('matches the tonic pitch class regardless of octave', () => {
    expect(isRootNote('C4', 'C')).toBe(true);
    expect(isRootNote('C3', 'C')).toBe(true);
    expect(isRootNote('F#4', 'F#')).toBe(true);
    expect(isRootNote('F4', 'C')).toBe(false);
  });
});
