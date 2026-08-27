import { describe, expect, test } from 'bun:test';
import { adaptStepRow, adaptStepRows, padStepRow, rotateStepWindow, writeStepWindow } from './patternAdapt';
import { MAX_STEPS_PER_BAR } from './meter';

const FOUR_ON_FLOOR = [
  true, false, false, false,
  true, false, false, false,
  true, false, false, false,
  true, false, false, false,
];

describe('adaptStepRow — equal length', () => {
  test('a 16-step row targeted at 16 comes back element-for-element equal', () => {
    expect(adaptStepRow(FOUR_ON_FLOOR, 16)).toEqual(FOUR_ON_FLOOR);
  });

  test('returns a fresh array, never the caller-supplied one', () => {
    const out = adaptStepRow(FOUR_ON_FLOOR, 16);
    expect(out).not.toBe(FOUR_ON_FLOOR);
    out[0] = false;
    expect(FOUR_ON_FLOOR[0]).toBe(true);
  });
});

describe('adaptStepRow — shorter target trims', () => {
  test('four-on-floor trimmed to a 12-step bar keeps kicks at 0, 4, 8 and drops step 12', () => {
    const out = adaptStepRow(FOUR_ON_FLOOR, 12);
    expect(out.length).toBe(12);
    expect(out.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([0, 4, 8]);
  });

  test('never rescales: a trimmed row is a literal prefix of the source', () => {
    const dense = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1];
    expect(adaptStepRow(dense, 14)).toEqual(dense.slice(0, 14));
    expect(adaptStepRow(dense, 12)).toEqual(dense.slice(0, 12));
  });
});

describe('adaptStepRow — longer target loops from step 0', () => {
  test('16 filling 20 takes steps 16-19 from source steps 0-3', () => {
    const out = adaptStepRow(FOUR_ON_FLOOR, 20);
    expect(out.length).toBe(20);
    expect(out.slice(0, 16)).toEqual(FOUR_ON_FLOOR);
    expect(out.slice(16)).toEqual(FOUR_ON_FLOOR.slice(0, 4));
  });

  test('16 filling 24 wraps once and a half, so every bar sounds identical', () => {
    const out = adaptStepRow(FOUR_ON_FLOOR, 24);
    expect(out.length).toBe(24);
    for (let i = 0; i < 24; i++) expect(out[i]).toBe(FOUR_ON_FLOOR[i % 16]);
  });

  test('a source shorter than the target wraps repeatedly', () => {
    expect(adaptStepRow([1, 0, 0], 8)).toEqual([1, 0, 0, 1, 0, 0, 1, 0]);
  });
});

describe('adaptStepRow — degenerate input', () => {
  test('an empty source yields an empty row rather than looping forever', () => {
    expect(adaptStepRow([], 16)).toEqual([]);
  });

  test('a non-positive target yields an empty row', () => {
    expect(adaptStepRow(FOUR_ON_FLOOR, 0)).toEqual([]);
    expect(adaptStepRow(FOUR_ON_FLOOR, -4)).toEqual([]);
  });
});

describe('adaptStepRows', () => {
  test('adapts every row and preserves the row key set exactly', () => {
    const rows = {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    };
    const out = adaptStepRows(rows, 12);
    expect(Object.keys(out).sort()).toEqual(['kick', 'snare']);
    expect(out.kick.length).toBe(12);
    expect(out.snare.length).toBe(12);
    expect(out.snare.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([4]);
  });

  test('shares no array instance with the input', () => {
    const rows = { kick: [true, false] };
    const out = adaptStepRows(rows, 2);
    expect(out.kick).not.toBe(rows.kick);
  });
});

describe('padStepRow', () => {
  test('pads a legacy 16-length row to 24 with false', () => {
    const out = padStepRow(FOUR_ON_FLOOR);
    expect(out.length).toBe(MAX_STEPS_PER_BAR);
    expect(out.slice(0, 16)).toEqual(FOUR_ON_FLOOR);
    expect(out.slice(16)).toEqual([false, false, false, false, false, false, false, false]);
  });

  test('leaves an already-24-wide row untouched in value', () => {
    const wide = Array.from({ length: 24 }, (_, i) => i % 6 === 0);
    expect(padStepRow(wide)).toEqual(wide);
  });

  test('truncates anything wider than the target', () => {
    const tooWide = Array.from({ length: 32 }, () => true);
    expect(padStepRow(tooWide).length).toBe(24);
  });

  test('coerces non-boolean cells from a corrupt persisted payload', () => {
    const junk = [1, 'x', null, undefined] as unknown as boolean[];
    expect(padStepRow(junk).slice(0, 4)).toEqual([false, false, false, false]);
  });

  test('accepts an explicit width', () => {
    expect(padStepRow([true], 4)).toEqual([true, false, false, false]);
  });
});

const WIDE_16_IN_24 = [
  true, false, false, false, true, false, false, false,
  true, false, false, false, true, false, false, false,
  false, false, false, false, false, false, false, false,
];

describe('rotateStepWindow', () => {
  test('rotating right in a 16-step window moves step 15 to step 0 and leaves padding alone', () => {
    const source = [...WIDE_16_IN_24];
    source[15] = true;
    const out = rotateStepWindow(source, 16, 'right');
    expect(out.length).toBe(24);
    expect(out[0]).toBe(true);
    expect(out[1]).toBe(true); // old step 0
    expect(out.slice(16)).toEqual(source.slice(16));
  });

  test('rotating left in a 16-step window moves step 0 to step 15', () => {
    const out = rotateStepWindow(WIDE_16_IN_24, 16, 'left');
    expect(out[15]).toBe(true);
    expect(out[3]).toBe(true); // old step 4
    expect(out.slice(16).every((v) => v === false)).toBe(true);
  });

  test('THE BUG THIS FIXES: padding is never rotated into view', () => {
    // Mark the padding so a whole-array rotation would be visible.
    const marked = [...WIDE_16_IN_24];
    marked[23] = true;
    const out = rotateStepWindow(marked, 16, 'right');
    expect(out[0]).toBe(false); // NOT the padding cell that a naive pop()/unshift() would bring in
    expect(out[23]).toBe(true); // padding stayed exactly where it was
  });

  test('a 12-step window rotates only the first twelve cells', () => {
    const source = Array.from({ length: 24 }, (_, i) => i === 11 || i === 20);
    const out = rotateStepWindow(source, 12, 'right');
    expect(out[0]).toBe(true);
    expect(out[11]).toBe(false);
    expect(out[20]).toBe(true);
  });

  test('a one-cell window is its own rotation', () => {
    const source = Array.from({ length: 24 }, (_, i) => i === 0);
    expect(rotateStepWindow(source, 1, 'right')).toEqual(source);
    expect(rotateStepWindow(source, 1, 'left')).toEqual(source);
  });

  test('returns a fresh array', () => {
    const source = [...WIDE_16_IN_24];
    const out = rotateStepWindow(source, 16, 'left');
    expect(out).not.toBe(source);
    expect(source[15]).toBe(false);
  });
});

describe('writeStepWindow', () => {
  test('overwrites the window and preserves everything past it', () => {
    const source = Array.from({ length: 24 }, (_, i) => i >= 16);
    const out = writeStepWindow(source, 12, [true, true, true, true, true, true, true, true, true, true, true, true]);
    expect(out.length).toBe(24);
    expect(out.slice(0, 12).every((v) => v === true)).toBe(true);
    expect(out.slice(12, 16).every((v) => v === false)).toBe(true);
    expect(out.slice(16).every((v) => v === true)).toBe(true);
  });

  test('a short replacement is padded with silence rather than leaking old hits', () => {
    const source = Array.from({ length: 24 }, () => true);
    const out = writeStepWindow(source, 16, [true, false]);
    expect(out.slice(0, 2)).toEqual([true, false]);
    expect(out.slice(2, 16).every((v) => v === false)).toBe(true);
    expect(out.slice(16).every((v) => v === true)).toBe(true);
  });

  test('a long replacement is truncated to the window', () => {
    const source = Array.from({ length: 24 }, () => false);
    const out = writeStepWindow(source, 4, [true, true, true, true, true, true]);
    expect(out.slice(0, 4).every((v) => v === true)).toBe(true);
    expect(out[4]).toBe(false);
  });

  test('always returns a MAX_STEPS_PER_BAR-wide array even from a short source', () => {
    expect(writeStepWindow([true], 16, [true, true]).length).toBe(MAX_STEPS_PER_BAR);
  });
});
