import { describe, expect, test } from 'bun:test';
import { loopBars } from '@/utils/songStructure';
import type { ChordItem } from '@/types';

function chord(bars: number): ChordItem {
  return { id: `c-${bars}-${Math.random()}`, root: 'C', quality: 'maj', bars };
}

describe('loopBars(chords) selector narrowness', () => {
  test('a chord edit that does not change total bars returns an equal number', () => {
    const before = [chord(2), chord(2)];
    const after = [chord(2), chord(2)]; // same bars, different root/quality would go here too —
                                          // loopBars only reads `.bars`, so identity of the array
                                          // itself must not matter to the RESULT.
    expect(loopBars(before)).toBe(loopBars(after));
  });

  test('a chord edit that changes total bars returns a different number', () => {
    const before = [chord(2), chord(2)];
    const after = [chord(4), chord(2)];
    expect(loopBars(before)).not.toBe(loopBars(after));
  });
});
