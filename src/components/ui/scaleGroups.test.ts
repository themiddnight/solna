import { describe, expect, test } from 'bun:test';
import { SCALES, SCALE_CATEGORIES } from '@/data/scales';
import { SCALE_GROUPS } from './scaleGroups';

describe('SCALE_GROUPS', () => {
  test('one group per category, in SCALE_CATEGORIES order', () => {
    expect(SCALE_GROUPS.map((group) => group.category)).toEqual([...SCALE_CATEGORIES]);
  });

  test('holds every SCALES key exactly once, in SCALES order', () => {
    const keys = SCALE_GROUPS.flatMap((group) => group.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(Object.keys(SCALES));
  });

  test('each key sits under its own category', () => {
    for (const { category, keys } of SCALE_GROUPS) {
      for (const key of keys) expect(SCALES[key].category, key).toBe(category);
    }
  });

  test('Jazz & Other is the last group, with the five jazz scales in murva\'s order', () => {
    expect(SCALE_GROUPS.at(-1)).toEqual({
      category: 'Jazz & Other',
      keys: ['Bebop', 'Bebop Major', 'Bebop Minor', 'Whole Tone', 'Diminished'],
    });
  });
});
