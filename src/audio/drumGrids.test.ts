import { describe, expect, test } from 'bun:test';
import { drumGridById } from './drumGrids';
import { DRUM_GRIDS } from '@/data/drumGrids';

// Lookup semantics only. What the table itself holds — ids, meters, kits, row
// sets, step counts — is pinned in src/data/drumGrids.test.ts.
describe('drumGridById', () => {
  test('resolves every library id to a grid equal to the table entry', () => {
    for (const id of Object.keys(DRUM_GRIDS)) {
      expect(drumGridById(id), id).toEqual(DRUM_GRIDS[id]);
    }
  });

  test('returns undefined for an unknown id', () => {
    expect(drumGridById('no-such-grid')).toBeUndefined();
    expect(drumGridById('')).toBeUndefined();
  });

  test('carries the entry\'s name, meter and kit through, not just its rows', () => {
    const grid = drumGridById('waltz-brush-three')!;
    expect(grid.meter).toBe('3/4');
    expect(grid.name).toBe('Waltz Brush Three');
    expect(grid.kit).toBe('Lo-Fi Vinyl');
  });

  test('returns a fresh deep copy, so mutating the result cannot reach module state', () => {
    const first = drumGridById('lofi-half-time-brush')!;
    first.rows.kick[0] = false;
    first.rows.snare = new Array(16).fill(true);

    const second = drumGridById('lofi-half-time-brush')!;
    expect(second.rows.kick[0]).toBe(true);
    expect(second.rows.snare).toEqual([
      false, false, false, false, true, false, false, false,
      false, false, false, false, true, false, false, false,
    ]);
    expect(DRUM_GRIDS['lofi-half-time-brush'].rows.kick[0]).toBe(true);
  });

  test('never hands back the same array instance twice', () => {
    const first = drumGridById('zen-bamboo-pulse')!;
    const second = drumGridById('zen-bamboo-pulse')!;
    expect(first).not.toBe(second);
    expect(first.rows).not.toBe(second.rows);
    expect(first.rows.hihat).not.toBe(second.rows.hihat);
    expect(first.rows.hihat).not.toBe(DRUM_GRIDS['zen-bamboo-pulse'].rows.hihat);
  });

  test('the sequencer genre grids resolve through the same lookup the vibes use', () => {
    // The point of the merge: a vibe may reference any of the 30, and the
    // sequencer menu may offer any of the 30. One library, one lookup.
    const trap = drumGridById('trap')!;
    expect(trap.name).toBe('Trap');
    expect(trap.kit).toBe('Trap Beat');
    expect(trap.rows.kick.length).toBe(16);
  });
});
