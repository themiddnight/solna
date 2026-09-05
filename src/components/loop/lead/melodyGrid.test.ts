import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import {
  isBlackKey,
  isRootNote,
  leadCellKinds,
  leadColumnCells,
  leadNoteCells,
  leadPitchRows,
  leadResizeLen,
  leadSpanClasses,
  resolveLeadCellSpan,
  type LeadCellKind,
  leadCursorKeyTarget,
  leadMarkerColumn,
} from './melodyGrid';
import type { LeadNote } from '../../../audio/leadMelody';
import { columnsPerBar, LEAD_TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from '@/utils/stepResolution';
import { getMeter } from '@/utils/meter';

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

const emptyBar = (): LeadNote[][] => Array.from({ length: 48 }, () => [] as LeadNote[]);

describe('leadCellKinds', () => {
  // Fixed at TICKS_PER_SIXTEENTH (the 1/16 stride): these fixtures predate
  // per-resolution stride and their `len`s are chosen so a "1-cell",
  // "2-cell" etc. story reads the same as it always did — `len` is
  // TICKS_PER_SIXTEENTH per intended cell, since leadNoteCells rounds up.
  const stride = TICKS_PER_SIXTEENTH;

  test('a one-step note is a lone start', () => {
    const m = emptyBar();
    m[0] = [{ note: 'C4', len: 1 }];
    const kinds = leadCellKinds(m, ['C4'], 4, 16, stride);
    expect(kinds.get('C4')).toEqual(['start', 'none', 'none', 'none']);
  });

  test('a two-cell note is start then end, with no body', () => {
    const m = emptyBar();
    m[0] = [{ note: 'C4', len: 4 }];
    expect(leadCellKinds(m, ['C4'], 4, 16, stride).get('C4')).toEqual([
      'start', 'end', 'none', 'none',
    ]);
  });

  test('a three-cell note is start, body, end', () => {
    const m = emptyBar();
    m[2] = [{ note: 'C4', len: 6 }]; // column 1 -> stored tick 2
    expect(leadCellKinds(m, ['C4'], 5, 16, stride).get('C4')).toEqual([
      'none', 'start', 'body', 'end', 'none',
    ]);
  });

  test('two notes in one pitch row are painted independently', () => {
    const m = emptyBar();
    m[0] = [{ note: 'C4', len: 4 }];
    m[6] = [{ note: 'C4', len: 1 }]; // column 3 -> stored tick 6
    expect(leadCellKinds(m, ['C4'], 5, 16, stride).get('C4')).toEqual([
      'start', 'end', 'none', 'start', 'none',
    ]);
  });

  test('a note crossing the bar boundary spans into the next bar', () => {
    const m: LeadNote[][] = [...emptyBar(), ...emptyBar()];
    m[30] = [{ note: 'C4', len: 6 }]; // column 15 -> stored tick 30
    const kinds = leadCellKinds(m, ['C4'], 32, 16, stride) as Map<string, LeadCellKind[]>;
    expect(kinds.get('C4')?.slice(14, 19)).toEqual(['none', 'start', 'body', 'end', 'none']);
  });

  test('a span running past the last column is truncated, not wrapped', () => {
    const m = emptyBar();
    m[28] = [{ note: 'C4', len: 12 }]; // column 14 -> stored tick 28
    // 'end' marks the last cell of the DRAWN run, not the note's true last
    // cell: it is resolveLeadCellSpan's sole signal for endsSpan, which
    // gates the resize handle. A truncated note still needs a handle at the
    // window edge — startResize already clamps maxLen to columns - startCol,
    // so a handle there can only ever shrink toward the loop end, never
    // reach past it.
    expect(leadCellKinds(m, ['C4'], 16, 16, stride).get('C4')?.slice(13)).toEqual([
      'none', 'start', 'end',
    ]);
  });

  test('every requested row gets an entry, all none when nothing is drawn', () => {
    const kinds = leadCellKinds(emptyBar(), ['C4', 'E4'], 3, 16, stride);
    expect(kinds.get('E4')).toEqual(['none', 'none', 'none']);
    expect([...kinds.keys()]).toEqual(['C4', 'E4']);
  });

  test('a note whose pitch row is outside the visible window is ignored', () => {
    const m = emptyBar();
    m[0] = [{ note: 'C7', len: 4 }];
    const kinds = leadCellKinds(m, ['C4'], 3, 16, stride);
    expect(kinds.get('C4')).toEqual(['none', 'none', 'none']);
    expect(kinds.has('C7')).toBe(false);
  });
});

describe('resolveLeadCellSpan', () => {
  const stride = TICKS_PER_SIXTEENTH;

  test('a one-step note resolves to itself and ends its own span', () => {
    const rowKinds: LeadCellKind[] = ['none', 'start', 'none'];
    const m = emptyBar();
    m[2] = [{ note: 'C4', len: 1 }]; // column 1 -> stored tick 2
    expect(resolveLeadCellSpan(rowKinds, 1, 16, stride, 'C4', m)).toEqual({
      spanStartIdx: 2,
      spanLen: 1,
      spanCells: 1,
      endsSpan: true,
      startCol: 1,
    });
  });

  test('a cell in the MIDDLE of a span resolves back to the span start, not itself', () => {
    const rowKinds: LeadCellKind[] = ['start', 'body', 'end'];
    const m = emptyBar();
    m[0] = [{ note: 'C4', len: 3 }];
    expect(resolveLeadCellSpan(rowKinds, 1, 16, stride, 'C4', m)).toEqual({
      spanStartIdx: 0,
      spanLen: 3,
      spanCells: 2,
      endsSpan: false,
      startCol: 0,
    });
    // The end cell of the same span both resolves to the same start and ends it.
    expect(resolveLeadCellSpan(rowKinds, 2, 16, stride, 'C4', m)).toEqual({
      spanStartIdx: 0,
      spanLen: 3,
      spanCells: 2,
      endsSpan: true,
      startCol: 0,
    });
  });

  test('a span crossing a bar boundary resolves through the stored index, not the column, at a stepsPerBar other than the 24-step storage width', () => {
    // stepsPerBar=5: bar 1 starts at column 5. A span starting at column 7
    // (bar 1, column 2) stores at bar 1's base plus 2 columns of 2 ticks =
    // 48 + 4 = 52, not at column 7 — LEAD_TICKS_PER_BAR (48) is fixed
    // regardless of the active meter or resolution.
    const rowKinds: LeadCellKind[] = [
      'none', 'none', 'none', 'none', 'none', // bar 0 (columns 0-4)
      'none', 'none', 'start', 'body', 'end', // bar 1 (columns 5-9)
    ];
    const m = [...emptyBar(), ...emptyBar()];
    m[52] = [{ note: 'C4', len: 3 }];
    expect(resolveLeadCellSpan(rowKinds, 8, 5, stride, 'C4', m)).toEqual({
      spanStartIdx: 52,
      spanLen: 3,
      spanCells: 2,
      endsSpan: false,
      startCol: 7,
    });
  });

  test('an empty cell has no span to resolve', () => {
    const rowKinds: LeadCellKind[] = ['none', 'none'];
    expect(resolveLeadCellSpan(rowKinds, 0, 16, stride, 'C4', emptyBar())).toEqual({
      spanStartIdx: -1,
      spanLen: 0,
      spanCells: 1,
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

  test('shift jumps a bar in COLUMNS, not in 16ths', () => {
    // 4/4 at 1/8: a bar is eight columns and the loop is sixteen. Every
    // other case in this describe passes 16 with columns 32, which reads
    // equally well as a 4/4 stepsPerBar — so only a case where the two
    // numbers disagree can tell the parameter's coordinate space.
    expect(leadCursorKeyTarget(0, 'ArrowRight', true, 8, 16)).toBe(8);
    expect(leadCursorKeyTarget(8, 'ArrowLeft', true, 8, 16)).toBe(0);
    expect(leadCursorKeyTarget(9, 'ArrowRight', true, 8, 16)).toBe(15);
  });

  test('any other key is not ours — null, so the browser keeps its own behaviour', () => {
    expect(leadCursorKeyTarget(5, 'Enter', false, 16, 32)).toBeNull();
    expect(leadCursorKeyTarget(5, 'ArrowUp', false, 16, 32)).toBeNull();
  });
});

describe('leadMarkerColumn', () => {
  test('stopped, the marker is the cursor — the user placed it there', () => {
    expect(leadMarkerColumn(false, 7, 3, 16)).toBe(3);
  });

  test('playing, the marker is the clock — and the cursor is untouched', () => {
    expect(leadMarkerColumn(true, 7, 3, 16)).toBe(7);
  });

  test('stopping returns the marker to where the cursor was left', () => {
    // Free, because leadCursor was never written during playback: there is
    // no save-and-restore step here to get wrong.
    expect(leadMarkerColumn(true, 11, 3, 16)).toBe(11);
    expect(leadMarkerColumn(false, 11, 3, 16)).toBe(3);
  });

  test('stopped, a cursor outside the window clamps to the edge, not off the grid', () => {
    // A meter or loop-length change can narrow the window under the cursor
    // between one render and the next. The cursor is user-placed, not a
    // clock quantity, so it clamps rather than wrapping.
    expect(leadMarkerColumn(false, 0, 99, 16)).toBe(15);
  });

  test('playing, the live branch goes through clockStepToGridColumn, not its own clamp', () => {
    // Decision 6 (one named conversion): the marker's live branch must agree
    // with clockStepToGridColumn exactly, wrap semantics included, or the
    // marker and the recorder's write column (store/leadRecord.ts) can point
    // at different cells for the same clock step.
    expect(leadMarkerColumn(true, 16, 0, 16)).toBe(0);
    expect(leadMarkerColumn(true, -4, 0, 16)).toBe(12);
  });

  test('a grid with no columns has column 0 and nothing else', () => {
    expect(leadMarkerColumn(false, 0, 5, 0)).toBe(0);
    expect(leadMarkerColumn(true, 5, 0, 0)).toBe(0);
  });

  test('a non-finite cursor is column 0, never NaN pixels — stopped only', () => {
    // currentStep never carries a non-finite value in practice (stepPublisher
    // seeds it at 0), so this guard is specific to the stopped/cursor branch.
    expect(leadMarkerColumn(false, 0, Number.NaN, 16)).toBe(0);
  });
});

describe('the stored-index conversion has exactly one copy', () => {
  test('melodyGrid does not declare its own', () => {
    // Two copies of bar-major arithmetic agreed only for as long as it took
    // no meter argument. DEV-375 gives it a stride as well, and a second
    // copy that looks correct in isolation is how a note ends up drawn on
    // one column and scheduled on another.
    const src = readFileSync(new URL('./melodyGrid.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('export function leadStoredIndex(');
    expect(src).toContain('leadStoredIndexAt');
  });
});

describe('leadNoteCells', () => {
  test('a quarter note is 2 cells at 1/8, 4 at 1/16 and 8 at 1/32', () => {
    expect(leadNoteCells(8, 4)).toBe(2);
    expect(leadNoteCells(8, 2)).toBe(4);
    expect(leadNoteCells(8, 1)).toBe(8);
  });

  test('a note finer than the grid still draws one cell, never zero', () => {
    // The same ceil and the same floor holdSec uses. What sounds is what
    // is drawn: two roundings that could disagree would put a note on the
    // grid at a width its sound does not match.
    expect(leadNoteCells(1, 4)).toBe(1);
    expect(leadNoteCells(3, 4)).toBe(1);
    expect(leadNoteCells(5, 4)).toBe(2);
  });
});

describe('leadColumnCells', () => {
  const meter = getMeter('4/4');

  test('one descriptor per COLUMN, not per 16th', () => {
    expect(leadColumnCells(meter, 2)).toHaveLength(16);
    expect(leadColumnCells(meter, 4)).toHaveLength(8);
    expect(leadColumnCells(meter, 1)).toHaveLength(32);
  });

  test('a beat starts on the column that starts the accent group', () => {
    // 4/4 accents every 4 sixteenths = every 8 ticks: columns 0/2/4/6 at
    // 1/8, 0/4/8/12 at 1/16, 0/8/16/24 at 1/32.
    expect(leadColumnCells(meter, 4).filter((c) => c.isBeatStart).map((c) => c.index))
      .toEqual([0, 2, 4, 6]);
    expect(leadColumnCells(meter, 2).filter((c) => c.isBeatStart).map((c) => c.index))
      .toEqual([0, 4, 8, 12]);
    expect(leadColumnCells(meter, 1).filter((c) => c.isBeatStart).map((c) => c.index))
      .toEqual([0, 8, 16, 24]);
  });

  test('the odd meter still groups 3+2+2', () => {
    const seven = leadColumnCells(getMeter('7/8'), 4);
    expect(seven).toHaveLength(7);
    expect(seven.filter((c) => c.isBeatStart).map((c) => c.index)).toEqual([0, 3, 5]);
  });

  test('labels are 1-based columns, so every column has a distinct one', () => {
    expect(leadColumnCells(meter, 1)[31].label).toBe(32);
  });
});

describe('leadCellKinds draws a note its audible width', () => {
  const rows = ['C4'];
  const melody = (len: number): LeadNote[][] => {
    const steps: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
    steps[0] = [{ note: 'C4', len }];
    return steps;
  };
  const kinds = (len: number, stride: number): LeadCellKind[] =>
    leadCellKinds(melody(len), rows, columnsPerBar(16, stride), 16, stride).get('C4')!;

  test('a quarter note spans 2 cells at 1/8 and 8 at 1/32', () => {
    expect(kinds(8, 4).slice(0, 3)).toEqual(['start', 'end', 'none']);
    expect(kinds(8, 1).slice(0, 9)).toEqual([
      'start', 'body', 'body', 'body', 'body', 'body', 'body', 'end', 'none',
    ]);
  });

  test('an off-grid note is not drawn at all — it is dormant, not lost', () => {
    const steps: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
    steps[1] = [{ note: 'C4', len: 1 }];
    expect(leadCellKinds(steps, rows, 16, 16, 2).get('C4')!.every((k) => k === 'none')).toBe(true);
    expect(leadCellKinds(steps, rows, 32, 16, 1).get('C4')![1]).toBe('start');
  });

  test('a span running past the last column is truncated, never wrapped', () => {
    expect(kinds(64, 4)).toHaveLength(8);
    // Index 7 is the last VISIBLE cell of a note that needs 16 to sound in
    // full — 'end' here marks where the grab handle goes, not where the
    // note stops. A handle at the window edge is correct: startResize caps
    // maxLen at columns - startCol (the loop end), never at the next
    // note's position, so it can only shrink this note, not extend it past
    // the window.
    expect(kinds(64, 4)[7]).toBe('end');
  });
});

describe('resolveLeadCellSpan reports both units', () => {
  test('the stored start, the tick length and the drawn cell count', () => {
    const previewed: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
    previewed[0] = [{ note: 'C4', len: 8 }];
    const rowKinds = leadCellKinds(previewed, ['C4'], 8, 16, 4).get('C4')!;

    // Shift+Arrow must work from ANY cell of a span, not just its first.
    const span = resolveLeadCellSpan(rowKinds, 1, 16, 4, 'C4', previewed);
    expect(span.spanStartIdx).toBe(0);
    expect(span.startCol).toBe(0);
    expect(span.spanLen).toBe(8);
    expect(span.spanCells).toBe(2);
    expect(span.endsSpan).toBe(true);
  });

  test('an empty cell resolves to no span', () => {
    const previewed: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
    const rowKinds = leadCellKinds(previewed, ['C4'], 8, 16, 4).get('C4')!;
    expect(resolveLeadCellSpan(rowKinds, 3, 16, 4, 'C4', previewed).spanStartIdx).toBe(-1);
  });
});
