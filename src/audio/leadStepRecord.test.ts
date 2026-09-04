import { describe, expect, test } from 'bun:test';
import {
  LEAD_WINDOW_OCTAVES,
  leadRecordOctave,
  noteOctave,
  stepRecordOff,
  stepRecordOn,
} from './leadStepRecord';

const none = new Set<string>();

describe('stepRecordOn', () => {
  test('a fresh press writes and joins the held set', () => {
    const r = stepRecordOn(none, 'C4');
    expect(r.write).toBe(true);
    expect([...r.held]).toEqual(['C4']);
  });

  test('a repeat of a key already down does NOT write again', () => {
    // Browsers repeat keydown while a key is held. Without this, leaning on a
    // key would write the same note over and over at the same column.
    const first = stepRecordOn(none, 'C4');
    const second = stepRecordOn(first.held, 'C4');
    expect(second.write).toBe(false);
    expect([...second.held]).toEqual(['C4']);
  });

  test('a chord builds up in the held set, each note writing once', () => {
    const c = stepRecordOn(none, 'C4');
    const e = stepRecordOn(c.held, 'E4');
    const g = stepRecordOn(e.held, 'G4');
    expect([c.write, e.write, g.write]).toEqual([true, true, true]);
    expect([...g.held].sort()).toEqual(['C4', 'E4', 'G4']);
  });

  test('does not mutate the set it was given', () => {
    const held = new Set(['C4']);
    stepRecordOn(held, 'E4');
    expect([...held]).toEqual(['C4']);
  });
});

describe('stepRecordOff', () => {
  test('releasing the only held key advances the cursor', () => {
    const down = stepRecordOn(none, 'C4');
    const up = stepRecordOff(down.held, 'C4');
    expect(up.advance).toBe(true);
    expect(up.held.size).toBe(0);
  });

  test('a chord advances ONCE, as the last key comes up', () => {
    // The whole reason the advance hangs off release: three notes must land
    // in one column, not three.
    let held: ReadonlySet<string> = none;
    for (const n of ['C4', 'E4', 'G4']) held = stepRecordOn(held, n).held;

    const first = stepRecordOff(held, 'E4');
    const second = stepRecordOff(first.held, 'C4');
    const third = stepRecordOff(second.held, 'G4');

    expect([first.advance, second.advance, third.advance]).toEqual([false, false, true]);
  });

  test('a release for a note never pressed advances nothing', () => {
    // Arriving after arming mid-hold. Advancing here would skip a column for
    // a note the recorder never captured.
    expect(stepRecordOff(none, 'C4').advance).toBe(false);
  });

  test('a second release of the same note does not advance twice', () => {
    const down = stepRecordOn(none, 'C4');
    const up = stepRecordOff(down.held, 'C4');
    expect(stepRecordOff(up.held, 'C4').advance).toBe(false);
  });

  test('does not mutate the set it was given', () => {
    const held = new Set(['C4', 'E4']);
    stepRecordOff(held, 'C4');
    expect([...held].sort()).toEqual(['C4', 'E4']);
  });
});

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
