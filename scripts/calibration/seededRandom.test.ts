import { describe, expect, test } from 'bun:test';
import { mulberry32 } from './seededRandom.ts';

describe('mulberry32', () => {
  test('the same seed produces the same stream', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  test('different seeds produce different streams', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  test('every value is in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('calling it again from a fresh instance replays the same first value', () => {
    const rng1 = mulberry32(99);
    const first = rng1();
    rng1(); // advance the stream
    const rng2 = mulberry32(99);
    expect(rng2()).toBe(first);
  });
});
