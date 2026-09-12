/**
 * The calibration harness's seeded PRNG. `mulberry32` itself now lives in
 * src/audio/rng.ts, beside the `setRandomSource` seam it feeds, because the
 * offline mixdown renderer needs it too and `src/` cannot import from
 * `scripts/`. Re-exported rather than duplicated: two implementations of "the
 * seeded stream" is the shape that drifts silently, and the pinning test in
 * src/audio/rng.test.ts is what holds this one honest.
 */
export { mulberry32 } from '@/audio/rng';

/** The fixed seed every calibration render is reset to. Not a secret, just a
 *  constant: any value works as long as it never changes between renders. */
export const CALIBRATION_SEED = 0x53_4f_4c_4e; // 'SOLN' ascii-ish, arbitrary
