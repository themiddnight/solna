import { describe, expect, test, afterEach } from 'bun:test';
import { random, setRandomSource } from './rng';

describe('rng', () => {
  afterEach(() => setRandomSource(null));

  test('defaults to reading Math.random', () => {
    // random() is a wrapper, so it can't be `.toBe`-compared to Math.random
    // directly; assert it stays in range and is not pinned to a fixed value,
    // which is what installing a replacement (below) would otherwise mask.
    const values = new Set(Array.from({ length: 5 }, () => random()));
    expect(values.size).toBeGreaterThan(1);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('setRandomSource installs a replacement', () => {
    setRandomSource(() => 0.5);
    expect(random()).toBe(0.5);
  });

  test('setRandomSource(null) restores the default', () => {
    setRandomSource(() => 0.5);
    setRandomSource(null);
    expect(random()).not.toBe(0.5);
  });

  test('setRandomSource(undefined) restores the default', () => {
    setRandomSource(() => 0.5);
    setRandomSource(undefined);
    expect(random()).not.toBe(0.5);
  });
});
