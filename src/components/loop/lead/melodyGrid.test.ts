import { describe, expect, test } from 'bun:test';
import {
  isBlackKey,
  isRootNote,
  leadCellKinds,
  leadPitchRows,
  leadResizeLen,
  leadSpanClasses,
  leadStoredIndex,
  resolveLeadCellSpan,
  type LeadCellKind,
  leadCursorKeyTarget,
} from './melodyGrid';
import type { LeadNote } from '../../../audio/leadMelody';

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

const emptyBar = (): LeadNote[][] => Array.from({ length: 24 }, () => [] as LeadNote[]);

describe('leadCellKinds', () => {
  test('a one-step note is a lone start', () => {
    const m = emptyBar();
    m[0] = [{ note: 'C4', len: 1 }];
    const kinds = leadCellKinds(m, ['C4'], 4, 16);
    expect(kinds.get('C4')).toEqual(['start', 'none', 'none', 'none']);
  });

  test('a two-step note is start then end, with no body', () => {
    const m = emptyBar();
    m[0] = [{ note: 'C4', len: 2 }];
    expect(leadCellKinds(m, ['C4'], 4, 16).get('C4')).toEqual(['start', 'end', 'none', 'none']);
  });

  test('a three-step note is start, body, end', () => {
    const m = emptyBar();
    m[1] = [{ note: 'C4', len: 3 }];
    expect(leadCellKinds(m, ['C4'], 5, 16).get('C4')).toEqual([
      'none', 'start', 'body', 'end', 'none',
    ]);
  });

  test('two notes in one pitch row are painted independently', () => {
    const m = emptyBar();
    m[0] = [{ note: 'C4', len: 2 }];
    m[3] = [{ note: 'C4', len: 1 }];
    expect(leadCellKinds(m, ['C4'], 5, 16).get('C4')).toEqual([
      'start', 'end', 'none', 'start', 'none',
    ]);
  });

  test('a note crossing the bar boundary spans into the next bar', () => {
    const m: LeadNote[][] = [...emptyBar(), ...emptyBar()];
    m[15] = [{ note: 'C4', len: 3 }];
    const kinds = leadCellKinds(m, ['C4'], 32, 16) as Map<string, LeadCellKind[]>;
    expect(kinds.get('C4')?.slice(14, 19)).toEqual(['none', 'start', 'body', 'end', 'none']);
  });

  test('a span running past the last column is truncated, not wrapped', () => {
    const m = emptyBar();
    m[14] = [{ note: 'C4', len: 6 }];
    expect(leadCellKinds(m, ['C4'], 16, 16).get('C4')?.slice(13)).toEqual([
      'none', 'start', 'end',
    ]);
  });

  test('every requested row gets an entry, all none when nothing is drawn', () => {
    const kinds = leadCellKinds(emptyBar(), ['C4', 'E4'], 3, 16);
    expect(kinds.get('E4')).toEqual(['none', 'none', 'none']);
    expect([...kinds.keys()]).toEqual(['C4', 'E4']);
  });

  test('a note whose pitch row is outside the visible window is ignored', () => {
    const m = emptyBar();
    m[0] = [{ note: 'C7', len: 2 }];
    const kinds = leadCellKinds(m, ['C4'], 3, 16);
    expect(kinds.get('C4')).toEqual(['none', 'none', 'none']);
    expect(kinds.has('C7')).toBe(false);
  });
});

describe('resolveLeadCellSpan', () => {
  test('a one-step note resolves to itself and ends its own span', () => {
    const rowKinds: LeadCellKind[] = ['none', 'start', 'none'];
    const m = emptyBar();
    m[1] = [{ note: 'C4', len: 1 }];
    expect(resolveLeadCellSpan(rowKinds, 1, 16, 'C4', m)).toEqual({
      spanStartIdx: 1,
      spanLen: 1,
      endsSpan: true,
      startCol: 1,
    });
  });

  test('a cell in the MIDDLE of a span resolves back to the span start, not itself', () => {
    const rowKinds: LeadCellKind[] = ['start', 'body', 'end'];
    const m = emptyBar();
    m[0] = [{ note: 'C4', len: 3 }];
    expect(resolveLeadCellSpan(rowKinds, 1, 16, 'C4', m)).toEqual({
      spanStartIdx: 0,
      spanLen: 3,
      endsSpan: false,
      startCol: 0,
    });
    // The end cell of the same span both resolves to the same start and ends it.
    expect(resolveLeadCellSpan(rowKinds, 2, 16, 'C4', m)).toEqual({
      spanStartIdx: 0,
      spanLen: 3,
      endsSpan: true,
      startCol: 0,
    });
  });

  test('a span crossing a bar boundary resolves through the stored index, not the column, at a stepsPerBar other than the 24-step storage width', () => {
    // stepsPerBar=5: bar 1 starts at column 5. A span starting at column 7
    // (bar 1, step 2) stores at leadStoredIndex(1, 2) = 24 + 2 = 26, not at
    // column 7 — MAX_STEPS_PER_BAR (24) is fixed regardless of the active meter.
    const rowKinds: LeadCellKind[] = [
      'none', 'none', 'none', 'none', 'none', // bar 0 (columns 0-4)
      'none', 'none', 'start', 'body', 'end', // bar 1 (columns 5-9)
    ];
    const m = [...emptyBar(), ...emptyBar()];
    m[26] = [{ note: 'C4', len: 3 }];
    expect(resolveLeadCellSpan(rowKinds, 8, 5, 'C4', m)).toEqual({
      spanStartIdx: 26,
      spanLen: 3,
      endsSpan: false,
      startCol: 7,
    });
  });

  test('an empty cell has no span to resolve', () => {
    const rowKinds: LeadCellKind[] = ['none', 'none'];
    expect(resolveLeadCellSpan(rowKinds, 0, 16, 'C4', emptyBar())).toEqual({
      spanStartIdx: -1,
      spanLen: 0,
      endsSpan: false,
      startCol: -1,
    });
  });
});

describe('leadResizeLen', () => {
  test('rounds the drag distance to the nearest whole cell', () => {
    expect(leadResizeLen(1, 0, 20, 16)).toBe(1);
    expect(leadResizeLen(1, 9, 20, 16)).toBe(1);
    expect(leadResizeLen(1, 10, 20, 16)).toBe(2);
    expect(leadResizeLen(1, 31, 20, 16)).toBe(3);
    expect(leadResizeLen(2, -21, 20, 16)).toBe(1);
  });

  test('clamps to 1 at the bottom, however far left the drag goes', () => {
    expect(leadResizeLen(3, -400, 20, 16)).toBe(1);
  });

  test('clamps to maxLen at the top, however far right the drag goes', () => {
    expect(leadResizeLen(3, 4000, 20, 16)).toBe(16);
    expect(leadResizeLen(1, 100, 20, 2)).toBe(2);
  });

  test('a maxLen below 1 still yields 1', () => {
    expect(leadResizeLen(1, 100, 20, 0)).toBe(1);
  });
});

describe('leadSpanClasses', () => {
  test('an empty cell gets no span classes at all', () => {
    expect(leadSpanClasses('none', 'none')).toBe('');
    expect(leadSpanClasses('none', 'start')).toBe('');
  });

  test('a one-step note rounds BOTH sides', () => {
    expect(leadSpanClasses('start', 'none')).toBe(
      'bg-primary text-primary-content rounded-l-xs rounded-r-xs',
    );
    expect(leadSpanClasses('start', 'start')).toBe(
      'bg-primary text-primary-content rounded-l-xs rounded-r-xs',
    );
  });

  test('the start of a longer span rounds only its left corners', () => {
    expect(leadSpanClasses('start', 'body')).toBe(
      'bg-primary text-primary-content rounded-l-xs border-r-0',
    );
    expect(leadSpanClasses('start', 'end')).toBe(
      'bg-primary text-primary-content rounded-l-xs border-r-0',
    );
  });

  test('a body cell drops its left border and rounds nothing', () => {
    expect(leadSpanClasses('body', 'end')).toBe(
      'bg-primary text-primary-content border-l-0 border-r-0',
    );
  });

  test('an end cell drops its left border and rounds its right corners', () => {
    expect(leadSpanClasses('end', 'none')).toBe(
      'bg-primary text-primary-content border-l-0 rounded-r-xs',
    );
  });
});

describe('leadCursorKeyTarget', () => {
  test('arrows step one column, and stop at the loop edges', () => {
    expect(leadCursorKeyTarget(5, 'ArrowRight', false, 16, 32)).toBe(6);
    expect(leadCursorKeyTarget(5, 'ArrowLeft', false, 16, 32)).toBe(4);
    expect(leadCursorKeyTarget(0, 'ArrowLeft', false, 16, 32)).toBe(0);
    expect(leadCursorKeyTarget(31, 'ArrowRight', false, 16, 32)).toBe(31);
  });

  test('shift jumps a whole bar', () => {
    expect(leadCursorKeyTarget(5, 'ArrowRight', true, 16, 32)).toBe(21);
    expect(leadCursorKeyTarget(21, 'ArrowLeft', true, 16, 32)).toBe(5);
  });

  test('a shift jump past the edge lands ON the edge rather than doing nothing', () => {
    expect(leadCursorKeyTarget(20, 'ArrowRight', true, 16, 32)).toBe(31);
    expect(leadCursorKeyTarget(5, 'ArrowLeft', true, 16, 32)).toBe(0);
  });

  test('any other key is not ours — null, so the browser keeps its own behaviour', () => {
    expect(leadCursorKeyTarget(5, 'Enter', false, 16, 32)).toBeNull();
    expect(leadCursorKeyTarget(5, 'ArrowUp', false, 16, 32)).toBeNull();
  });
});
