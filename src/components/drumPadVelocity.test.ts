import { describe, expect, test } from 'bun:test';
import type { DrumPad } from '@/types';
import { DEFAULT_PADS } from './ui/DrumPadGrid';
import { padsWithVelocities } from './drumPadVelocity';

describe('padsWithVelocities', () => {
  test('overrides then draft win over DEFAULT_PADS volume, per pad id', () => {
    const pads = padsWithVelocities(DEFAULT_PADS, { kick: 0.4 }, { snare: 0.2 });
    expect(pads.find((p: DrumPad) => p.id === 'kick')!.volume).toBe(0.4);
    expect(pads.find((p: DrumPad) => p.id === 'snare')!.volume).toBe(0.2);
    expect(pads.find((p: DrumPad) => p.id === 'hihat')!.volume).toBe(0.75);
  });

  test('a draft beats an override for the same pad', () => {
    const pads = padsWithVelocities(DEFAULT_PADS, { kick: 0.4 }, { kick: 0.1 });
    expect(pads.find((p: DrumPad) => p.id === 'kick')!.volume).toBe(0.1);
  });

  test('no overrides and no draft hands back the defaults untouched', () => {
    expect(padsWithVelocities(DEFAULT_PADS, {}, {})).toEqual(DEFAULT_PADS);
  });
});
