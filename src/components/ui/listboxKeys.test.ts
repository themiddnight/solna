import { describe, expect, test } from 'bun:test';
import { isCommandChord, isOpenKey, listboxKey } from './listboxKeys';

// Flat order across groups; index 4 is lower-case on purpose (case-insensitive type-ahead).
const LABELS = ['Major', 'Minor (Natural)', 'Dorian', 'Mixolydian', 'lydian'];
const at = (active: number, key: string) => listboxKey({ active, labels: LABELS }, key);
const moved = (active: number) => ({ active, commit: false, handled: true });

describe('listboxKey: arrows, Home and End move the highlight', () => {
  test('ArrowDown moves one option down', () => {
    expect(at(1, 'ArrowDown')).toEqual(moved(2));
  });

  test('ArrowUp moves one option up', () => {
    expect(at(2, 'ArrowUp')).toEqual(moved(1));
  });

  test('ArrowDown stops at the last option: no wrap, as in a native select', () => {
    expect(at(4, 'ArrowDown')).toEqual(moved(4));
  });

  test('ArrowUp stops at the first option: no wrap', () => {
    expect(at(0, 'ArrowUp')).toEqual(moved(0));
  });

  test('Home and End jump to the first and last option', () => {
    expect(at(3, 'Home')).toEqual(moved(0));
    expect(at(0, 'End')).toEqual(moved(4));
  });
});

describe('listboxKey: commit is explicit', () => {
  test('Enter commits the highlighted option', () => {
    expect(at(2, 'Enter')).toEqual({ active: 2, commit: true, handled: true });
  });

  // Space arrives as e.key === ' ', a single printable character: it must hit
  // the commit branch before the type-ahead branch ever sees it.
  test('Space commits the highlighted option and is never type-ahead', () => {
    const labels = [' starts with a space', 'Major'];
    expect(listboxKey({ active: 1, labels }, ' ')).toEqual({ active: 1, commit: true, handled: true });
  });

  test('a highlight outside the list never commits', () => {
    expect(listboxKey({ active: -1, labels: LABELS }, 'Enter').commit).toBe(false);
  });
});

describe('listboxKey: type-ahead', () => {
  test('a character jumps to the next option whose label starts with it', () => {
    expect(at(0, 'm')).toEqual(moved(1));
  });

  test('matching is case-insensitive', () => {
    expect(at(2, 'L')).toEqual(moved(4));
  });

  test('repeating the character steps through the matches and wraps', () => {
    expect(at(1, 'm')).toEqual(moved(3));
    expect(at(3, 'm')).toEqual(moved(0));
  });

  test('with no highlight the search starts at the first option', () => {
    expect(at(-1, 'm')).toEqual(moved(0));
  });

  test('no match leaves the highlight put but still claims the key', () => {
    expect(at(2, 'z')).toEqual(moved(2));
  });
});

describe('listboxKey: every other key, and an empty list', () => {
  test('any other key is a no-op the listbox does not claim', () => {
    for (const key of ['Tab', 'Escape', 'Shift', 'F1', 'PageDown', 'ArrowLeft']) {
      expect(at(2, key)).toEqual({ active: 2, commit: false, handled: false });
    }
  });

  test('an empty list never throws, moves or commits', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'm']) {
      expect(listboxKey({ active: -1, labels: [] }, key)).toEqual({ active: -1, commit: false, handled: false });
    }
  });
});

describe('isOpenKey', () => {
  test('ArrowDown, ArrowUp, Enter and Space open the list from its trigger', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) expect(isOpenKey(key)).toBe(true);
  });

  test('nothing else does', () => {
    for (const key of ['Escape', 'Tab', 'ArrowLeft', 'm', 'Home']) expect(isOpenKey(key)).toBe(false);
  });
});

describe('isCommandChord', () => {
  const none = { ctrlKey: false, metaKey: false, altKey: false };

  test('Ctrl, Meta or Alt make the key a browser or OS command, never type-ahead', () => {
    expect(isCommandChord({ ...none, ctrlKey: true })).toBe(true);
    expect(isCommandChord({ ...none, metaKey: true })).toBe(true);
    expect(isCommandChord({ ...none, altKey: true })).toBe(true);
  });

  test('a bare key (Shift is not a command) is not a chord', () => {
    expect(isCommandChord(none)).toBe(false);
  });
});
