import { describe, expect, test } from 'bun:test';
import {
  IMPULSE_CACHE_SAMPLE_BUDGET,
  impulseSampleCount,
  keysToEvict,
} from './impulseBudget';

describe('impulseSampleCount', () => {
  test('counts both channels of the buffer buildImpulseResponse creates', () => {
    // buildImpulseResponse: createBuffer(2, floor(sampleRate * durationSec), sampleRate)
    expect(impulseSampleCount(48000, 10)).toBe(48000 * 10 * 2);
    expect(impulseSampleCount(44100, 2)).toBe(44100 * 2 * 2);
  });

  test('a sub-sample decay still counts one frame, matching the engine clamp', () => {
    expect(impulseSampleCount(48000, 0)).toBe(2);
  });

  test('the channel count is overridable but defaults to stereo', () => {
    expect(impulseSampleCount(48000, 1, 1)).toBe(48000);
  });
});

describe('keysToEvict', () => {
  test('evicts nothing while the total is inside the budget', () => {
    expect(keysToEvict([{ key: 1, samples: 10 }, { key: 2, samples: 20 }], 100)).toEqual([]);
  });

  test('evicts the oldest keys first, and only as many as it must', () => {
    const entries = [
      { key: 0.1, samples: 40 },
      { key: 0.2, samples: 40 },
      { key: 0.3, samples: 40 },
    ];
    expect(keysToEvict(entries, 100)).toEqual([0.1]);
    expect(keysToEvict(entries, 45)).toEqual([0.1, 0.2]);
  });

  test('never evicts the newest entry, even when it alone blows the budget', () => {
    const entries = [
      { key: 0.1, samples: 10 },
      { key: 9.9, samples: 5_000_000 },
    ];
    expect(keysToEvict(entries, 1000)).toEqual([0.1]);
  });

  test('a single over-budget entry is kept rather than evicting the whole cache', () => {
    expect(keysToEvict([{ key: 9.9, samples: 5_000_000 }], 1000)).toEqual([]);
  });

  test('an empty cache evicts nothing', () => {
    expect(keysToEvict([], 100)).toEqual([]);
  });

  test('the shipped budget holds four full-length 10 s stereo impulses at 48 kHz', () => {
    const one = impulseSampleCount(48000, 10);
    expect(Math.floor(IMPULSE_CACHE_SAMPLE_BUDGET / one)).toBe(4);
  });

  test('the shipped budget is strictly tighter than the old 8-entry cap ever was', () => {
    // Old worst case: 8 x 10 s stereo at 48 kHz = 7,680,000 samples (~30 MB).
    expect(IMPULSE_CACHE_SAMPLE_BUDGET).toBeLessThan(8 * impulseSampleCount(48000, 10));
  });
});
