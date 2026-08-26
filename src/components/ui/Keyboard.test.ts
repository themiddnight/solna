import { describe, expect, test } from 'bun:test';
import {
  clampKeyboardOctave,
  getScaleLockedKeyboardNotes,
  getScaleLockedKeyboardNotesFlat,
  getChordKeyboardRows,
  MELODY_KEYS,
  HOME_ROW_KEYS,
  TOP_ROW_KEYS,
} from './Keyboard';
import { ROOTS } from '../../utils/musicTheory';

const pitchOf = (note: string): number => {
  const match = note.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!match) throw new Error(`bad note: ${note}`);
  const [, name, octave] = match;
  return (ROOTS as readonly string[]).indexOf(name) + 12 * parseInt(octave, 10);
};
import { DEFAULT_PADS } from '../DrumPads';

const byKey = (rows: ReturnType<typeof getScaleLockedKeyboardNotes>) =>
  Object.fromEntries(
    [...rows.homeRow, ...rows.topRow].map((n) => [n.key, n.note]),
  );

describe('getScaleLockedKeyboardNotes', () => {
  test('maps the top row Q..] to the tonic going up the scale', () => {
    const byKeyMap = byKey(getScaleLockedKeyboardNotes('C', 'Major', 0));

    expect(byKeyMap['KeyQ']).toBe('C4');
    expect(byKeyMap['BracketRight']).toBe('G5');
  });

  test('maps the home row A..\' to the 4th scale note two octaves below the tonic', () => {
    const byKeyMap = byKey(getScaleLockedKeyboardNotes('C', 'Major', 0));

    expect(byKeyMap['KeyA']).toBe('F2');
    expect(byKeyMap['Quote']).toBe('B3');
  });

  test('returns 11 home-row and 12 top-row notes with unique, non-empty keys', () => {
    const rows = getScaleLockedKeyboardNotes('C', 'Major', 0);
    const keys = [...rows.homeRow, ...rows.topRow].map((n) => n.key);

    expect(rows.homeRow.length).toBe(11);
    expect(rows.topRow.length).toBe(12);
    expect(keys.every((k) => k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.homeRow[0].note).toBe('F2');
    expect(rows.topRow.at(-1)!.note).toBe('G5');
  });

  test('fills all 11 home-row keys for a 5-note scale, overlapping the top row', () => {
    const rows = getScaleLockedKeyboardNotes('C', 'Minor Pentatonic', 0);
    const byKeyMap = byKey(rows);

    // C minor pentatonic: C D# F G A# → 4th note is G, two octaves below C4 = G2
    expect(byKeyMap['KeyA']).toBe('G2');
    expect(byKeyMap['KeyL']).toBe('D#4');
    expect(byKeyMap['Quote']).toBe('G4');
    expect(byKeyMap['KeyQ']).toBe('C4');
  });

  test('works for a 6-note scale', () => {
    const byKeyMap = byKey(getScaleLockedKeyboardNotes('C', 'Blues', 0));

    // C blues: C D# F F# G A# → 4th note is F#, two octaves below C4 = F#2
    expect(byKeyMap['KeyA']).toBe('F#2');
  });

  test('shifts both rows with the octave offset', () => {
    const byKeyMap = byKey(getScaleLockedKeyboardNotes('C', 'Major', 1));

    expect(byKeyMap['KeyQ']).toBe('C5');
    expect(byKeyMap['KeyA']).toBe('F3');
  });

  test('ascends across the octave boundary for non-C roots', () => {
    const gByKey = byKey(getScaleLockedKeyboardNotes('G', 'Major', 0));

    // G major: G A B C D E F# — the 4th note C wraps into the next octave
    expect(gByKey['KeyR']).toBe('C5');
    expect(gByKey['KeyU']).toBe('F#5');
    expect(gByKey['BracketRight']).toBe('D6');
    // 4th note (C) two octaves below the tonic G4
    expect(gByKey['KeyA']).toBe('C3');

    const dByKey = byKey(getScaleLockedKeyboardNotes('D', 'Major', 0));
    // 7th note C# crosses into octave 5
    expect(dByKey['KeyU']).toBe('C#5');
    expect(dByKey['KeyA']).toBe('G2');
  });
});

describe('getScaleLockedKeyboardNotesFlat', () => {
  test('returns home row followed by top row', () => {
    const flat = getScaleLockedKeyboardNotesFlat('C', 'Major', 0);

    expect(flat[0]).toEqual({ note: 'F2', label: 'F2', key: 'KeyA', isBlack: false });
    expect(flat.at(-1)).toEqual({
      note: 'G5',
      label: 'G5',
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

describe('getChordKeyboardRows', () => {
  test('degree count follows the scale length: 7 for Major', () => {
    const rows = getChordKeyboardRows('C', 'Major', 0);
    expect(rows.triadRow.length).toBe(7);
  });

  test('degree count follows the scale length: 5 for Hirajoshi', () => {
    const rows = getChordKeyboardRows('C', 'Hirajoshi', 0);
    expect(rows.triadRow.length).toBe(5);
  });

  test('triad labels are the expected chord symbols for A Natural Minor', () => {
    const rows = getChordKeyboardRows('A', 'Natural Minor', 0);
    // A natural minor: Am Bdim C Dm Em F G
    expect(rows.triadRow.map((b) => b.label)).toEqual([
      'Am',
      'Bdim',
      'C',
      'Dm',
      'Em',
      'F',
      'G',
    ]);
  });

  test('a triad button plays the expected three notes', () => {
    const rows = getChordKeyboardRows('C', 'Major', 0);
    // C major I: C E G at octave 3
    expect(rows.triadRow[0].notes).toEqual(['C3', 'E3', 'G3']);
  });

  test('octave offset shifts the triad row', () => {
    const rows = getChordKeyboardRows('C', 'Major', 1);
    expect(rows.triadRow[0].notes).toEqual(['C4', 'E4', 'G4']);
  });

  test('bound key codes are the first N of HOME_ROW_KEYS and never collide with drum pads', () => {
    const rows = getChordKeyboardRows('C', 'Major', 0);
    expect(rows.triadRow.map((b) => b.key)).toEqual([
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyF',
      'KeyG',
      'KeyH',
      'KeyJ',
    ]);

    const drumCodes = new Set(DEFAULT_PADS.map((p) => p.shortcut));
    const chordCodes = rows.triadRow.map((b) => b.key);
    expect(chordCodes.every((c) => !drumCodes.has(c))).toBe(true);
  });

  test('melody row keys are exactly the nine melody keys, in order', () => {
    const rows = getChordKeyboardRows('C', 'Major', 0);
    expect(rows.melodyRow.map((b) => b.key)).toEqual([
      'KeyK',
      'KeyL',
      'Semicolon',
      'Quote',
      'KeyI',
      'KeyO',
      'KeyP',
      'BracketLeft',
      'BracketRight',
    ]);
    expect(MELODY_KEYS).toEqual([
      'KeyK',
      'KeyL',
      'Semicolon',
      'Quote',
      'KeyI',
      'KeyO',
      'KeyP',
      'BracketLeft',
      'BracketRight',
    ]);
  });

  test('melody row starts on the tonic at the triad row octave and ascends for a 7-degree scale', () => {
    const rows = getChordKeyboardRows('C', 'Major', 0);
    expect(rows.melodyRow.map((b) => b.notes[0])).toEqual([
      'C4',
      'D4',
      'E4',
      'F4',
      'G4',
      'A4',
      'B4',
      'C5',
      'D5',
    ]);
  });

  test('melody row wraps octaves correctly for a 5-degree scale (Hirajoshi)', () => {
    const rows = getChordKeyboardRows('C', 'Hirajoshi', 0);
    const notes = rows.melodyRow.map((b) => b.notes[0]);
    for (let i = 1; i < notes.length; i++) {
      expect(pitchOf(notes[i])).toBeGreaterThan(pitchOf(notes[i - 1]));
    }
  });

  test('melody row ascends strictly for a non-C root', () => {
    const rows = getChordKeyboardRows('G', 'Major', 0);
    const notes = rows.melodyRow.map((b) => b.notes[0]);
    for (let i = 1; i < notes.length; i++) {
      expect(pitchOf(notes[i])).toBeGreaterThan(pitchOf(notes[i - 1]));
    }
    expect(notes[0]).toBe('G4');
  });

  test('melody keys and triad-row keys are disjoint for a 7-degree scale', () => {
    const rows = getChordKeyboardRows('C', 'Major', 0);
    const triadKeys = new Set(rows.triadRow.map((b) => b.key));
    const melodyKeys = rows.melodyRow.map((b) => b.key);
    expect(melodyKeys.every((k) => !triadKeys.has(k))).toBe(true);
  });

  test('melody keys and triad-row keys are disjoint for a 5-degree scale (Hirajoshi)', () => {
    const rows = getChordKeyboardRows('C', 'Hirajoshi', 0);
    const triadKeys = new Set(rows.triadRow.map((b) => b.key));
    const melodyKeys = rows.melodyRow.map((b) => b.key);
    expect(melodyKeys.every((k) => !triadKeys.has(k))).toBe(true);
  });

  test('melody keys and triad-row keys are disjoint for a 6-degree scale (Blues)', () => {
    const rows = getChordKeyboardRows('C', 'Blues', 0);
    const triadKeys = new Set(rows.triadRow.map((b) => b.key));
    const melodyKeys = rows.melodyRow.map((b) => b.key);
    expect(melodyKeys.every((k) => !triadKeys.has(k))).toBe(true);
  });

  test('MELODY_KEYS is exactly HOME_ROW_KEYS[7..10] followed by TOP_ROW_KEYS[7..11]', () => {
    expect(MELODY_KEYS).toEqual([
      ...HOME_ROW_KEYS.slice(7, 11),
      ...TOP_ROW_KEYS.slice(7, 12),
    ]);
  });
});
