import { describe, expect, test } from 'bun:test';
import { createDefaultLoop } from '@/store/loopSlice';
import type { Loop } from '@/store/types';
import { canApplyKeyChange, keyChangePreview, TRANSPOSE_STEPS } from './useKeyChangeDialog';

const loop = (id: string, name: string, scaleRoot: string, scaleType = 'Natural Minor'): Loop =>
  ({ ...createDefaultLoop(), id, name, scaleRoot, scaleType });
const loops = [loop('a', 'Verse', 'A'), loop('b', 'Chorus', 'C', 'Major')];

describe('keyChangePreview', () => {
  test('one row per loop, labelled, with display-spelled old → new keys', () => {
    const rows = keyChangePreview(loops, { mode: 'transpose', semitones: 1 });
    expect(rows.map((r) => r.label)).toEqual(['Verse', 'Chorus']);
    expect(rows.every((r) => r.changes)).toBe(true);
    expect(rows[0].from).not.toBe(rows[0].to);
  });

  test('a loop already in the Set target is marked unchanged', () => {
    const rows = keyChangePreview(loops, { mode: 'set', root: 'C', scaleType: 'Major' });
    expect(rows.find((r) => r.id === 'b')!.changes).toBe(false);
    expect(rows.find((r) => r.id === 'a')!.changes).toBe(true);
  });
});

describe('canApplyKeyChange', () => {
  const rows = keyChangePreview(loops, { mode: 'set', root: 'C', scaleType: 'Major' });
  test('needs at least one selected loop that would change', () => {
    expect(canApplyKeyChange(rows, new Set(['a']))).toBe(true);
    expect(canApplyKeyChange(rows, new Set(['b']))).toBe(false);
    expect(canApplyKeyChange(rows, new Set())).toBe(false);
  });
});

test('TRANSPOSE_STEPS is -11..+11 without 0', () => {
  expect(TRANSPOSE_STEPS.length).toBe(22);
  expect(TRANSPOSE_STEPS).not.toContain(0);
  expect(Math.min(...TRANSPOSE_STEPS)).toBe(-11);
  expect(Math.max(...TRANSPOSE_STEPS)).toBe(11);
});
