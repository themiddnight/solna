import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { BeatFilterType } from './types';
import type { FilterType } from './types/synth';

describe('FilterType has one owner', () => {
  test('src/types.ts declares no FilterType of its own', () => {
    const src = readFileSync(new URL('./types.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/export type FilterType\b/);
  });
  test('the Beat filter set is the synth set minus notch', () => {
    const beat: BeatFilterType[] = ['lowpass', 'bandpass', 'highpass'];
    const all: FilterType[] = [...beat, 'notch'];
    // @ts-expect-error notch is not a Beat filter response
    const bad: BeatFilterType = 'notch';
    expect(all).toHaveLength(4);
    void bad;
  });
});
