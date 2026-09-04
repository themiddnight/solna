import { describe, expect, test } from 'bun:test';
import { LEAD_WINDOW_OCTAVES, leadRecordOctave, noteOctave } from './leadStepRecord';

describe('noteOctave', () => {
  test('reads the trailing digits', () => {
    expect(noteOctave('C4')).toBe(4);
    expect(noteOctave('F#3')).toBe(3);
    expect(noteOctave('Bb10')).toBe(10);
  });

  test('is null for a pitch class with no octave', () => {
    expect(noteOctave('C')).toBeNull();
    expect(noteOctave('')).toBeNull();
  });
});

describe('leadRecordOctave', () => {
  const follow = (note: string, lowest: number): number | null =>
    leadRecordOctave(note, lowest, LEAD_WINDOW_OCTAVES, 1, 6);

  test('a note already inside the window leaves it alone', () => {
    // Window at 3 shows octaves 3 and 4.
    expect(follow('C3', 3)).toBe(3);
    expect(follow('B4', 3)).toBe(3);
  });

  test('a note below the window drops the window onto it', () => {
    expect(follow('C2', 3)).toBe(2);
  });

  test('a note above the window raises it so the note is the top octave', () => {
    // C5 with a 2-octave window means lowest 4, showing 4 and 5.
    expect(follow('C5', 3)).toBe(4);
  });

  test('the window never leaves its legal range', () => {
    // Lowest may not go past 6, whose window tops out at octave 7.
    expect(follow('C7', 3)).toBe(6);
    expect(follow('C1', 3)).toBe(1);
  });

  test('a note no legal window can show is refused, not clamped to a lie', () => {
    // Octave 8 needs lowest 7, past the maximum; returning 6 would put the
    // note off-screen while claiming it had been placed.
    expect(follow('C8', 3)).toBeNull();
    expect(follow('C0', 3)).toBeNull();
  });

  test('a note with no octave is refused', () => {
    expect(follow('C', 3)).toBeNull();
  });
});
