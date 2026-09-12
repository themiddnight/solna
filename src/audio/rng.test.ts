import { describe, expect, test, afterEach } from 'bun:test';
import { mulberry32, MIXDOWN_SEED, random, setRandomSource, withSeededRandom } from './rng';

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

describe('mulberry32', () => {
  test('is byte-for-byte the calibration stream it was ported from', () => {
    // Pinned from scripts/calibration/seededRandom.ts BEFORE the port. The
    // port is only correct if these three numbers do not move.
    const r = mulberry32(42);
    expect([r(), r(), r()]).toEqual([
      0.60110375192016363, 0.44829055899754167, 0.85246579349040985,
    ]);
  });

  test('the same seed replays the same stream, a different seed does not', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const c = mulberry32(1235);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect([mulberry32(1234)(), mulberry32(1234)()]).toEqual([mulberry32(1234)(), mulberry32(1234)()]);
    expect(mulberry32(1234)()).not.toBe(c());
  });

  test('every value is inside [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('MIXDOWN_SEED is a 32-bit unsigned integer', () => {
    expect(Number.isInteger(MIXDOWN_SEED)).toBe(true);
    expect(MIXDOWN_SEED).toBeGreaterThanOrEqual(0);
    expect(MIXDOWN_SEED).toBeLessThanOrEqual(0xffff_ffff);
  });
});

describe('withSeededRandom', () => {
  test('random() is the seeded stream for the duration of `run`', async () => {
    const inside = await withSeededRandom(99, () => random());
    expect(inside).toBe(mulberry32(99)());
  });

  test('restores the default on the success path', async () => {
    const original = Math.random;
    // Patch Math.random so "the default" is an exact value rather than a
    // statistical claim: setRandomSource(null) reads Math.random at call
    // time, so a patch installed before the call is what it lands on.
    Math.random = () => 0.3141592653589793;
    try {
      await withSeededRandom(5, () => undefined);
      expect(random()).toBe(0.3141592653589793);
    } finally {
      Math.random = original;
    }
  });

  test('restores the default when `run` throws, and rethrows', async () => {
    const original = Math.random;
    Math.random = () => 0.2718281828459045;
    try {
      const boom = new Error('render exploded');
      // try/catch rather than a `.rejects` matcher: this repo's `bun:test`
      // shim declares no `.rejects` member — see src/types/bun-test.d.ts.
      let caught: unknown;
      try {
        await withSeededRandom(5, () => {
          throw boom;
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(boom);
      expect(random()).toBe(0.2718281828459045);
    } finally {
      Math.random = original;
    }
  });

  test('a SECOND render replays the stream from the top, not from where it stopped', async () => {
    const first = await withSeededRandom(3, () => [random(), random(), random()]);
    const second = await withSeededRandom(3, () => [random(), random(), random()]);
    expect(second).toEqual(first);
  });
});
