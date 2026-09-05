import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_LEAD_STEP_RESOLUTION,
  LEAD_STEP_STRIDES,
  LEAD_STEP_RESOLUTION_IDS,
  LEAD_TICKS_PER_BAR,
  TICKS_PER_SIXTEENTH,
  clampColumn,
  columnsPerBar,
  isLeadStepResolutionId,
  leadNoteCells,
  strideFor,
} from './stepResolution';
import { MAX_STEPS_PER_BAR, METERS, METER_IDS } from './meter';

describe('the table', () => {
  test('stores at 1/32 and strides down to the active resolution', () => {
    expect(TICKS_PER_SIXTEENTH).toBe(2);
    expect(LEAD_TICKS_PER_BAR).toBe(MAX_STEPS_PER_BAR * TICKS_PER_SIXTEENTH);
    expect(LEAD_STEP_STRIDES['1/8']).toBe(4);
    expect(LEAD_STEP_STRIDES['1/16']).toBe(2);
    expect(LEAD_STEP_STRIDES['1/32']).toBe(1);
  });

  test('lists coarse to fine — the order the select shows', () => {
    expect(LEAD_STEP_RESOLUTION_IDS).toEqual(['1/8', '1/16', '1/32']);
  });

  test('every listed id has a row, and every row is listed', () => {
    // The same invariant meter.test.ts pins for METER_IDS: a resolution
    // added to one and not the other is a select option that resolves to
    // the default, silently.
    expect([...LEAD_STEP_RESOLUTION_IDS].sort()).toEqual(
      Object.keys(LEAD_STEP_STRIDES).sort(),
    );
    for (const id of LEAD_STEP_RESOLUTION_IDS) {
      expect(strideFor(id)).toBe(LEAD_STEP_STRIDES[id]);
    }
  });

  test('the default is 1/16 — what every existing project is authored at', () => {
    expect(DEFAULT_LEAD_STEP_RESOLUTION).toBe('1/16');
    expect(strideFor(DEFAULT_LEAD_STEP_RESOLUTION)).toBe(TICKS_PER_SIXTEENTH);
  });

  test('the module reaches meter and nothing else', () => {
    // utils/ leaves may be imported by audio/, store/ AND components/. An
    // import from any of those three would make this module unimportable
    // by the other two under the layering rules.
    const src = readFileSync(new URL('./stepResolution.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/^import .*? from '(.*?)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./meter']);
  });
});

describe('isLeadStepResolutionId', () => {
  test('accepts exactly the three ids', () => {
    expect(isLeadStepResolutionId('1/8')).toBe(true);
    expect(isLeadStepResolutionId('1/16')).toBe(true);
    expect(isLeadStepResolutionId('1/32')).toBe(true);
  });

  test('rejects everything else, including triplets', () => {
    expect(isLeadStepResolutionId('1/12')).toBe(false);
    expect(isLeadStepResolutionId('')).toBe(false);
    expect(isLeadStepResolutionId(16)).toBe(false);
    expect(isLeadStepResolutionId(null)).toBe(false);
    expect(isLeadStepResolutionId(undefined)).toBe(false);
  });
});

describe('strideFor', () => {
  test('resolves a known id', () => {
    expect(strideFor('1/32')).toBe(1);
    expect(strideFor('1/8')).toBe(4);
  });

  test('falls back to the default rather than throwing', () => {
    // The same reasoning getMeter states verbatim: a persisted id from a
    // future build, a corrupt payload or an empty string must not throw,
    // because this value feeds the scheduler and a throw there would
    // freeze the transport.
    const fallback = LEAD_STEP_STRIDES[DEFAULT_LEAD_STEP_RESOLUTION];
    expect(strideFor('1/12')).toBe(fallback);
    expect(strideFor('')).toBe(fallback);
    expect(strideFor(null)).toBe(fallback);
    expect(strideFor(undefined)).toBe(fallback);
  });
});

describe('leadNoteCells', () => {
  // The ONE copy of "what sounds is what is drawn": the scheduler's holdSec,
  // the live recorder's captured length and the grid's drawn width all round
  // ticks to whole cells through this.
  test('rounds a tick length UP to whole cells', () => {
    expect(leadNoteCells(8, 4)).toBe(2);
    expect(leadNoteCells(5, 4)).toBe(2);
    expect(leadNoteCells(9, 4)).toBe(3);
    expect(leadNoteCells(3, 1)).toBe(3);
  });

  test('a note is never shorter than one cell, whatever the input', () => {
    // A zero-cell note is neither audible nor drawable, and the grid would
    // size it in zero or NaN pixels.
    expect(leadNoteCells(0, 2)).toBe(1);
    expect(leadNoteCells(-4, 2)).toBe(1);
    expect(leadNoteCells(1, 0)).toBe(1);
    expect(leadNoteCells(3, 0)).toBe(3);
    expect(leadNoteCells(3, -1)).toBe(3);
  });

  test('a whole number of cells is left exactly alone', () => {
    for (const stride of [1, 2, 4]) {
      for (const cells of [1, 2, 7]) {
        expect(leadNoteCells(cells * stride, stride)).toBe(cells);
      }
    }
  });
});

describe('clampColumn', () => {
  // Clamping, not wrapping: these columns are USER-placed positions, so
  // modulo would land on column 0 and look like a choice the user made.
  test('pulls a column onto the grid and rounds to a whole one', () => {
    expect(clampColumn(5, 16)).toBe(5);
    expect(clampColumn(5.4, 16)).toBe(5);
    expect(clampColumn(5.6, 16)).toBe(6);
    expect(clampColumn(-3, 16)).toBe(0);
    expect(clampColumn(99, 16)).toBe(15);
  });

  test('answers 0 rather than propagating NaN', () => {
    expect(clampColumn(Number.NaN, 16)).toBe(0);
    expect(clampColumn(Number.POSITIVE_INFINITY, 16)).toBe(0);
  });

  test('a grid with no columns still has an answer', () => {
    expect(clampColumn(4, 0)).toBe(0);
    expect(clampColumn(4, -2)).toBe(0);
  });
});

describe('columnsPerBar', () => {
  test('is the bar’s ticks divided by the stride', () => {
    expect(columnsPerBar(16, 4)).toBe(8);
    expect(columnsPerBar(16, 2)).toBe(16);
    expect(columnsPerBar(16, 1)).toBe(32);
  });

  test('a nonsense stride gives one column, never zero or NaN', () => {
    // A zero would divide the grid by nothing; a NaN would size it in NaN
    // pixels. Both are worse than a one-column bar.
    expect(columnsPerBar(16, 0)).toBe(1);
    expect(columnsPerBar(16, Number.NaN)).toBe(1);
    expect(columnsPerBar(0, 2)).toBe(1);
  });
});

describe('every meter divides cleanly at every resolution', () => {
  // The eighteen-cell matrix from the spec, pinned as a table — an
  // invariant of the meter table, not a property of any one call site. A
  // seventh meter added later must fail loudly HERE rather than quietly
  // draw a bar that ends mid-column. 7/8 is the row to watch: 28 ticks
  // gives 7 columns at 1/8, and 7/8 is precisely the meter whose bar
  // length is not a multiple of 4 (the reason ARP_PHASE_QUANTUM exists).
  // It works because divisibility runs the other way here — ticks by
  // stride, not bar by subdivision.
  const expected: Record<string, [number, number, number]> = {
    '4/4': [8, 16, 32],
    '3/4': [6, 12, 24],
    '6/8': [6, 12, 24],
    '12/8': [12, 24, 48],
    '5/4': [10, 20, 40],
    '7/8': [7, 14, 28],
  };

  test('the matrix is exactly the spec’s', () => {
    for (const meterId of METER_IDS) {
      const stepsPerBar = METERS[meterId].stepsPerBar;
      const row = LEAD_STEP_RESOLUTION_IDS.map((id) =>
        columnsPerBar(stepsPerBar, strideFor(id)),
      );
      expect(row).toEqual(expected[meterId]);
    }
  });

  test('no bar ever ends mid-column, at any stride', () => {
    for (const meterId of METER_IDS) {
      const ticks = METERS[meterId].stepsPerBar * TICKS_PER_SIXTEENTH;
      for (const id of LEAD_STEP_RESOLUTION_IDS) {
        expect(ticks % strideFor(id)).toBe(0);
      }
    }
  });

  test('the storage width covers the widest meter at the finest stride', () => {
    // 12/8 at 1/32 is 48 columns, which is exactly LEAD_TICKS_PER_BAR — no
    // meter loses columns to the storage width.
    const widest = Math.max(...METER_IDS.map((id) => METERS[id].stepsPerBar));
    expect(columnsPerBar(widest, 1)).toBe(LEAD_TICKS_PER_BAR);
  });
});
