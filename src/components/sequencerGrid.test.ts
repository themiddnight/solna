import { describe, expect, test } from 'bun:test';
import { sequencerMeterBadge, stepCells } from './sequencerGrid';
import { METERS } from '../utils/meter';

describe('sequencerMeterBadge', () => {
  // The name now comes from VIEW_META; the badge carries only the
  // machine-computed part, which design.md 3 says belongs in tabular-nums
  // chrome rather than inside a heading.
  test('reports step count and meter label', () => {
    expect(sequencerMeterBadge(METERS['4/4'])).toBe('16-Step · 4/4');
    expect(sequencerMeterBadge(METERS['3/4'])).toBe('12-Step · 3/4');
    expect(sequencerMeterBadge(METERS['6/8'])).toBe('12-Step · 6/8');
    expect(sequencerMeterBadge(METERS['12/8'])).toBe('24-Step · 12/8');
    expect(sequencerMeterBadge(METERS['7/8'])).toBe('14-Step · 7/8');
  });
});

describe('stepCells', () => {
  test('4/4 reproduces the old Array.from({ length: 16 }) grid exactly', () => {
    const cells = stepCells(METERS['4/4']);
    expect(cells.length).toBe(16);
    cells.forEach((cell, i) => {
      expect(cell.index).toBe(i);
      expect(cell.label).toBe(i + 1);
      expect(cell.isBeatStart).toBe(i % 4 === 0);
      expect(cell.beatIndex).toBe(Math.floor(i / 4));
      expect(cell.isAltBeatGroup).toBe(Math.floor(i / 4) % 2 === 0);
    });
  });

  test('3/4 draws twelve cells in three groups of four', () => {
    const cells = stepCells(METERS['3/4']);
    expect(cells.length).toBe(12);
    expect(cells.filter((c) => c.isBeatStart).map((c) => c.index)).toEqual([0, 4, 8]);
    expect(cells[11].beatIndex).toBe(2);
  });

  test('6/8 draws twelve cells in two groups of six — different from 3/4', () => {
    const waltz = stepCells(METERS['3/4']);
    const compound = stepCells(METERS['6/8']);
    expect(compound.length).toBe(waltz.length);
    expect(compound.filter((c) => c.isBeatStart).map((c) => c.index)).toEqual([0, 6]);
    expect(compound.map((c) => c.beatIndex)).not.toEqual(waltz.map((c) => c.beatIndex));
  });

  test('7/8 groups 3+2+2 and alternates shading per beat group, not per four steps', () => {
    const cells = stepCells(METERS['7/8']);
    expect(cells.length).toBe(14);
    expect(cells.filter((c) => c.isBeatStart).map((c) => c.index)).toEqual([0, 6, 10]);
    expect(cells.map((c) => c.isAltBeatGroup)).toEqual([
      true, true, true, true, true, true,
      false, false, false, false,
      true, true, true, true,
    ]);
  });

  test('labels are always 1-based and contiguous', () => {
    for (const id of ['4/4', '3/4', '6/8', '12/8', '5/4', '7/8'] as const) {
      const cells = stepCells(METERS[id]);
      expect(cells.map((c) => c.label)).toEqual(cells.map((_, i) => i + 1));
    }
  });
});
