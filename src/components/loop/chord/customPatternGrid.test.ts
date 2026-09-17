import { describe, expect, test } from 'bun:test';
import { MAX_STEPS_PER_BAR } from '@/utils/meter';
import {
  customPatternCells,
  customPatternFoldedStep,
  customPatternKeyOutcome,
  customPatternPositionLabel,
  resizedPatternLength,
  type CustomPatternCell,
} from './customPatternGrid';

/**
 * The pure half of the one-lane Chord/Bass timeline. The store keeps `values`
 * and `holds` BAR-MAJOR at MAX_STEPS_PER_BAR (the same fixed-width storage the
 * sequencer, chord-rhythm and bass grids use), so every lookup here goes
 * through `patternStoredIndexAt`: a visible column in a 3/4 bar 2 is stored at
 * MAX_STEPS_PER_BAR, not at column 12.
 *
 * The cells are asserted with `toEqual` on the WHOLE cell rather than a partial
 * match: `bun:test`'s `toMatchObject` is not in the type definitions this repo
 * type-checks against (there is no other use of it anywhere), and a full object
 * is the stronger claim — it pins `maxLength` and the carried value as well.
 */

/** A stored pair of arrays sized for `bars` bars, all empty, every hold 1. */
function stored(bars: number): { values: boolean[]; holds: number[] } {
  return {
    values: new Array<boolean>(bars * MAX_STEPS_PER_BAR).fill(false),
    holds: new Array<number>(bars * MAX_STEPS_PER_BAR).fill(1),
  };
}

describe('customPatternCells', () => {
  test('a two-bar 4/4 view is bar-major into fixed-width storage', () => {
    const { values, holds } = stored(2);
    values[MAX_STEPS_PER_BAR] = true;
    holds[MAX_STEPS_PER_BAR] = 4;

    // From the task brief: bar two opens at visible column 16 and stored slot
    // MAX_STEPS_PER_BAR, and its four-step hold covers 16..19.
    expect(customPatternCells(values, holds, 2, 16, false)[16]).toEqual({
      kind: 'head',
      column: 16,
      storedIndex: MAX_STEPS_PER_BAR,
      value: true,
      length: 4,
      // 32-step cycle, no folded boundary before the end.
      maxLength: 16,
    });
    const cells = customPatternCells(values, holds, 2, 16, false);
    expect(cells[17]).toEqual({
      kind: 'body',
      column: 17,
      storedIndex: MAX_STEPS_PER_BAR + 1,
      ownerColumn: 16,
    });
    expect(cells).toHaveLength(2 * 16);
    expect(cells[0]).toEqual({ kind: 'empty', column: 0, storedIndex: 0 });
    expect(cells[20]).toEqual({ kind: 'empty', column: 20, storedIndex: 28 });
  });

  test('a 3/4 meter starts bar two at visible column 12 but stored index MAX_STEPS_PER_BAR', () => {
    const { values, holds } = stored(2);
    values[MAX_STEPS_PER_BAR] = true;
    // Bar zero's dormant region — steps 12..23 of its fixed-width row.
    values[20] = true;

    const cells = customPatternCells(values, holds, 2, 12, false);

    expect(cells).toHaveLength(2 * 12);
    expect(cells[12]).toEqual({
      kind: 'head',
      column: 12,
      storedIndex: MAX_STEPS_PER_BAR,
      value: true,
      length: 1,
      maxLength: 12,
    });
    // A slot the active meter cannot reach is never drawn, however it was
    // written: bar zero's dormant half stays invisible rather than leaking
    // into a column of the next bar.
    expect(cells.some((cell) => cell.storedIndex === 20)).toBe(false);
  });

  test('an invalid stored hold draws one step', () => {
    for (const invalid of [0, -3, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { values, holds } = stored(1);
      values[0] = true;
      holds[0] = invalid;

      const cells = customPatternCells(values, holds, 1, 16, false);

      expect(cells[0]).toEqual({
        kind: 'head',
        column: 0,
        storedIndex: 0,
        value: true,
        length: 1,
        maxLength: 16,
      });
      expect(cells[1]).toEqual({ kind: 'empty', column: 1, storedIndex: 1 });
    }
  });

  test('a head is capped at the next supplied folded boundary', () => {
    const { values, holds } = stored(1);
    values[0] = true;
    holds[0] = 16;

    const cells = customPatternCells(values, holds, 1, 16, false, [0, 8, 16]);

    expect(cells[0]).toEqual({
      kind: 'head',
      column: 0,
      storedIndex: 0,
      value: true,
      length: 8,
      maxLength: 8,
    });
    expect(cells[7]).toEqual({ kind: 'body', column: 7, storedIndex: 7, ownerColumn: 0 });
    // The boundary itself begins the next span; it is not swallowed as a body.
    expect(cells[8].kind).toBe('empty');
  });

});

describe('customPatternCells against the cycle end and imported shapes', () => {
  test('a head in the last segment is capped by the cycle end', () => {
    const { values, holds } = stored(2);
    // Bar two, step eight — visible column 24.
    values[MAX_STEPS_PER_BAR + 8] = true;
    holds[MAX_STEPS_PER_BAR + 8] = 12;

    const cells = customPatternCells(values, holds, 2, 16, false);

    expect(cells[24]).toEqual({
      kind: 'head',
      column: 24,
      storedIndex: MAX_STEPS_PER_BAR + 8,
      value: true,
      length: 8,
      maxLength: 8,
    });
    expect(cells[31]).toEqual({
      kind: 'body',
      column: 31,
      storedIndex: MAX_STEPS_PER_BAR + 15,
      ownerColumn: 24,
    });
  });

  test('an active value inside a span ends it and starts a new head defensively', () => {
    const { values, holds } = stored(1);
    values[0] = true;
    holds[0] = 8;
    // Store writes clear swallowed onsets, so this shape is only reachable
    // from imported state — it must still draw two heads, never an overlap.
    values[4] = true;
    holds[4] = 2;

    const cells = customPatternCells(values, holds, 1, 16, false);

    expect(cells[0]).toEqual({
      kind: 'head',
      column: 0,
      storedIndex: 0,
      value: true,
      length: 8,
      maxLength: 16,
    });
    expect(cells[1]).toEqual({ kind: 'body', column: 1, storedIndex: 1, ownerColumn: 0 });
    expect(cells[4]).toEqual({
      kind: 'head',
      column: 4,
      storedIndex: 4,
      value: true,
      length: 2,
      maxLength: 12,
    });
    expect(cells[5]).toEqual({ kind: 'body', column: 5, storedIndex: 5, ownerColumn: 4 });
  });

  test('a non-boolean empty marker works the same way', () => {
    const values = new Array<string>(MAX_STEPS_PER_BAR).fill('rest');
    const holds = new Array<number>(MAX_STEPS_PER_BAR).fill(1);
    values[2] = 'fifth';
    holds[2] = 3;

    const cells = customPatternCells(values, holds, 1, 16, 'rest');

    expect(cells[0]).toEqual({ kind: 'empty', column: 0, storedIndex: 0 });
    expect(cells[2]).toEqual({
      kind: 'head',
      column: 2,
      storedIndex: 2,
      value: 'fifth',
      length: 3,
      maxLength: 14,
    });
    expect(cells[3]).toEqual({ kind: 'body', column: 3, storedIndex: 3, ownerColumn: 2 });
    expect(cells[5].kind).toBe('empty');
  });

  test('a missing hold array falls back to one step per event', () => {
    const values = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
    values[0] = true;

    const cells = customPatternCells(values, [], 1, 16, false);

    expect(cells[0]).toEqual({
      kind: 'head',
      column: 0,
      storedIndex: 0,
      value: true,
      length: 1,
      maxLength: 16,
    });
  });
});

describe('customPatternCells rounds a hold the way the store does', () => {
  test('a fractional stored hold rounds, never floors', () => {
    // The store repairs a fractional hold with Math.round (finiteCount in
    // utils/customPattern.ts) and playback reads it back the same way, so the
    // view must round too: flooring 2.5 would draw two steps over a note that
    // sounds for three — a one-step disagreement in the exact defensive case
    // this read exists for. 2.5 and 3.7 are the cases that tell the two
    // conventions apart; 1.4 rounds and floors to the same step and is here as
    // the boundary below 1.5.
    for (const [hold, drawn] of [
      [2.5, 3],
      [3.7, 4],
      [1.4, 1],
    ]) {
      const { values, holds } = stored(1);
      values[0] = true;
      holds[0] = hold;

      const cells = customPatternCells(values, holds, 1, 16, false);

      expect(cells[0]).toEqual({
        kind: 'head',
        column: 0,
        storedIndex: 0,
        value: true,
        length: drawn,
        maxLength: 16,
      });
      expect(cells[drawn]).toEqual({ kind: 'empty', column: drawn, storedIndex: drawn });
      if (drawn > 1) {
        expect(cells[drawn - 1]).toEqual({
          kind: 'body',
          column: drawn - 1,
          storedIndex: drawn - 1,
          ownerColumn: 0,
        });
      }
    }
  });
});

describe('customPatternKeyOutcome', () => {
  const head: CustomPatternCell<boolean> = {
    kind: 'head',
    column: 4,
    storedIndex: 4,
    value: true,
    length: 2,
    maxLength: 4,
  };
  const empty: CustomPatternCell<boolean> = { kind: 'empty', column: 5, storedIndex: 5 };
  const body: CustomPatternCell<boolean> = {
    kind: 'body',
    column: 5,
    storedIndex: 5,
    ownerColumn: 4,
  };

  test('Enter and Space activate, on an empty cell and on a head alike', () => {
    for (const key of ['Enter', ' ']) {
      expect(customPatternKeyOutcome(key, false, empty)).toBe('activate');
      expect(customPatternKeyOutcome(key, false, head)).toBe('activate');
    }
  });

  test('Delete and Backspace erase', () => {
    for (const key of ['Delete', 'Backspace']) {
      expect(customPatternKeyOutcome(key, false, head)).toBe('erase');
      expect(customPatternKeyOutcome(key, false, empty)).toBe('erase');
    }
  });

  test('Shift with an arrow resizes a head only while it is within its bounds', () => {
    expect(customPatternKeyOutcome('ArrowRight', true, head)).toBe('resize');
    expect(customPatternKeyOutcome('ArrowLeft', true, head)).toBe('resize');
    // At the ceiling a grow is impossible; at the floor a shrink is.
    expect(customPatternKeyOutcome('ArrowRight', true, { ...head, length: 4 })).toBe('none');
    expect(customPatternKeyOutcome('ArrowLeft', true, { ...head, length: 1 })).toBe('none');
    // Nothing to resize on an empty cell.
    expect(customPatternKeyOutcome('ArrowRight', true, empty)).toBe('none');
  });

  test('an unmodified arrow does nothing', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(customPatternKeyOutcome(key, false, head)).toBe('none');
      expect(customPatternKeyOutcome(key, false, empty)).toBe('none');
    }
  });

  test('a body cell is owned by its head and is no event of its own', () => {
    for (const key of ['Enter', ' ', 'Delete', 'Backspace', 'ArrowLeft', 'ArrowRight']) {
      expect(customPatternKeyOutcome(key, false, body)).toBe('none');
      expect(customPatternKeyOutcome(key, true, body)).toBe('none');
    }
  });
});

describe('resizedPatternLength', () => {
  const head = (length: number, maxLength = 8): CustomPatternCell<boolean> & { kind: 'head' } => ({
    kind: 'head',
    column: 0,
    storedIndex: 0,
    value: true,
    length,
    maxLength,
  });

  test('moves by one step and stays inside [1, maxLength]', () => {
    expect(resizedPatternLength(head(3), 'ArrowRight')).toBe(4);
    expect(resizedPatternLength(head(3), 'ArrowLeft')).toBe(2);
    expect(resizedPatternLength(head(8), 'ArrowRight')).toBe(8);
    expect(resizedPatternLength(head(1), 'ArrowLeft')).toBe(1);
  });
});

describe('customPatternPositionLabel', () => {
  test('names the bar, beat and step a column sits on, all one-based', () => {
    expect(customPatternPositionLabel(0, 16, [4, 4, 4, 4])).toBe('bar 1 beat 1 step 1');
    expect(customPatternPositionLabel(3, 16, [4, 4, 4, 4])).toBe('bar 1 beat 1 step 4');
    expect(customPatternPositionLabel(20, 16, [4, 4, 4, 4])).toBe('bar 2 beat 2 step 1');
    // 3/4 shares its 12-step bar with 6/8 and differs only in the grouping.
    expect(customPatternPositionLabel(12, 12, [4, 4, 4])).toBe('bar 2 beat 1 step 1');
    // Step 4 is beat two of a 3-step group and the first step of a 6-step one.
    expect(customPatternPositionLabel(4, 12, [4, 4, 4])).toBe('bar 1 beat 2 step 1');
    expect(customPatternPositionLabel(4, 12, [6, 6])).toBe('bar 1 beat 1 step 5');
  });

  test('gives every visible column a distinct accessible position', () => {
    const labels = Array.from({ length: 16 }, (_, column) =>
      customPatternPositionLabel(column, 16, [4, 4, 4, 4]),
    );
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('customPatternFoldedStep', () => {
  test('passes a step through unchanged when it already fits the cycle', () => {
    expect(customPatternFoldedStep(0, 32)).toBe(0);
    expect(customPatternFoldedStep(20, 32)).toBe(20);
  });

  test('folds a run-absolute step by the lane cycle, so a shorter lane repeats', () => {
    // Two lanes, one published step: a one-bar (16-step) lane sees column 4
    // where a two-bar (32-step) lane sees column 20 — the exact case that
    // makes the chord and bass lanes draw different playhead columns for the
    // SAME published step.
    expect(customPatternFoldedStep(20, 16)).toBe(4);
    expect(customPatternFoldedStep(20, 32)).toBe(20);
    // One cycle later lands on the same column.
    expect(customPatternFoldedStep(20 + 32, 32)).toBe(20);
    expect(customPatternFoldedStep(20 + 2 * 32, 32)).toBe(20);
  });

  test('is null in, null out — a stopped or unarmed transport folds to no column', () => {
    expect(customPatternFoldedStep(null, 32)).toBeNull();
  });
});
