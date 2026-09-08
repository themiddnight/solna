/**
 * A tiny deterministic PRNG (mulberry32) for the calibration harness only. It
 * lives here rather than in `src/audio/` because it is a calibration concern,
 * not an engine one — the engine only ever knows about `src/audio/rng.ts`'s
 * `random()`/`setRandomSource()` seam.
 *
 * Not cryptographically random and not meant to be: the only requirement is
 * that the same seed produces the same stream of `[0, 1)` values every time,
 * on every platform, so a render is reproducible.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fixed seed every calibration render is reset to. Not a secret, just a
 *  constant: any value works as long as it never changes between renders. */
export const CALIBRATION_SEED = 0x53_4f_4c_4e; // 'SOLN' ascii-ish, arbitrary
