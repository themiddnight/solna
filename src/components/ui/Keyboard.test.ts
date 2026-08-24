import { describe, expect, test } from 'bun:test';
import {
  clampKeyboardOctave,
  getScaleLockedKeyboardNotes,
  getScaleLockedKeyboardNotesFlat,
} from './Keyboard';

const byKey = (rows: ReturnType<typeof getScaleLockedKeyboardNotes>) =>
  Object.fromEntries(
    [...rows.homeRow, ...rows.topRow].map((n) => [n.key, n.note]),
  );

describe('getScaleLockedKeyboardNotes', () => {
  test('maps the top row Q..] to the tonic going up the scale', () => {
    const byKeyMap = byKey(getScaleLockedKeyboardNotes('C', 'Major', 0));

    expect(byKeyMap['KeyQ']).toBe('C3');
    expect(byKeyMap['BracketRight']).toBe('G4');
  });

  test('maps the home row A..\' to the 4th scale note two octaves below the tonic', () => {
    const byKeyMap = byKey(getScaleLockedKeyboardNotes('C', 'Major', 0));

    expect(byKeyMap['KeyA']).toBe('F1');
    expect(byKeyMap['Quote']).toBe('B2');
  });

  test('returns 11 home-row and 12 top-row notes with unique, non-empty keys', () => {
    const rows = getScaleLockedKeyboardNotes('C', 'Major', 0);
    const keys = [...rows.homeRow, ...rows.topRow].map((n) => n.key);

    expect(rows.homeRow.length).toBe(11);
    expect(rows.topRow.length).toBe(12);
    expect(keys.every((k) => k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.homeRow[0].note).toBe('F1');
    expect(rows.topRow.at(-1)!.note).toBe('G4');
  });

  test('fills all 11 home-row keys for a 5-note scale, overlapping the top row', () => {
    const rows = getScaleLockedKeyboardNotes('C', 'Minor Pentatonic', 0);
    const byKeyMap = byKey(rows);

    // C minor pentatonic: C D# F G A# → 4th note is G, two octaves below C3 = G1
    expect(byKeyMap['KeyA']).toBe('G1');
    expect(byKeyMap['KeyL']).toBe('D#3');
    expect(byKeyMap['Quote']).toBe('G3');
    expect(byKeyMap['KeyQ']).toBe('C3');
  });

  test('works for a 6-note scale', () => {
    const byKeyMap = byKey(getScaleLockedKeyboardNotes('C', 'Blues', 0));

    // C blues: C D# F F# G A# → 4th note is F#, two octaves below C3 = F#1
    expect(byKeyMap['KeyA']).toBe('F#1');
  });

  test('shifts both rows with the octave offset', () => {
    const byKeyMap = byKey(getScaleLockedKeyboardNotes('C', 'Major', 1));

    expect(byKeyMap['KeyQ']).toBe('C4');
    expect(byKeyMap['KeyA']).toBe('F2');
  });

  test('ascends across the octave boundary for non-C roots', () => {
    const gByKey = byKey(getScaleLockedKeyboardNotes('G', 'Major', 0));

    // G major: G A B C D E F# — the 4th note C wraps into the next octave
    expect(gByKey['KeyR']).toBe('C4');
    expect(gByKey['KeyU']).toBe('F#4');
    expect(gByKey['BracketRight']).toBe('D5');
    // 4th note (C) two octaves below the tonic G3
    expect(gByKey['KeyA']).toBe('C2');

    const dByKey = byKey(getScaleLockedKeyboardNotes('D', 'Major', 0));
    // 7th note C# crosses into octave 4
    expect(dByKey['KeyU']).toBe('C#4');
    expect(dByKey['KeyA']).toBe('G1');
  });
});

describe('getScaleLockedKeyboardNotesFlat', () => {
  test('returns home row followed by top row', () => {
    const flat = getScaleLockedKeyboardNotesFlat('C', 'Major', 0);

    expect(flat[0]).toEqual({ note: 'F1', label: 'F1', key: 'KeyA', isBlack: false });
    expect(flat.at(-1)).toEqual({
      note: 'G4',
      label: 'G4',
      key: 'BracketRight',
      isBlack: false,
    });
  });
});

describe('clampKeyboardOctave', () => {
  test('clamps to the -2..2 octave range', () => {
    expect(clampKeyboardOctave(0)).toBe(0);
    expect(clampKeyboardOctave(-3)).toBe(-2);
    expect(clampKeyboardOctave(3)).toBe(2);
  });
});
