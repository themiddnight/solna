import { describe, expect, test } from 'bun:test';
import { loopIdKeyOf, loopIdsFromKey } from './loopIdKey';

const loops = (...ids: string[]) => ids.map((id) => ({ id }));

describe('loopIdKeyOf / loopIdsFromKey', () => {
  test('round-trips any id list', () => {
    for (const ids of [[], ['loop-default-1'], ['a', 'b', 'c'], ['loop-1770000000000-x9k2']]) {
      expect(loopIdsFromKey(loopIdKeyOf(loops(...ids)))).toEqual(ids);
    }
  });

  test('is stable across structurally-equal but distinct arrays', () => {
    const a = loops('loop-default-1', 'loop-2', 'loop-3');
    const b = a.map((l) => ({ ...l })); // what loopSync writes on every field change
    expect(a).not.toBe(b);
    expect(loopIdKeyOf(b)).toBe(loopIdKeyOf(a));
  });

  test('changes on reorder, on add and on remove; empty is the empty key', () => {
    const base = loopIdKeyOf(loops('a', 'b', 'c'));
    expect(loopIdKeyOf(loops('a', 'c', 'b'))).not.toBe(base);
    expect(loopIdKeyOf(loops('a', 'b', 'c', 'd'))).not.toBe(base);
    expect(loopIdKeyOf(loops('a', 'c'))).not.toBe(base);
    expect(loopIdKeyOf([])).toBe('');
    expect(loopIdsFromKey('')).toEqual([]);
  });
});
