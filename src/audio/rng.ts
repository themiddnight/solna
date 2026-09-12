/**
 * The one seam every `Math.random()` call in `src/audio/` goes through — not
 * only the calls that affect rendered audio (the noise buffer fill, the noise
 * start offset) but also `arpeggiator.ts`'s `'random'` note-order mode, which
 * this seam also routes even though note order is not itself rendered audio.
 * Widened deliberately rather than narrowed: `no-restricted-syntax` (see
 * `eslint.config.js`) bans `Math.random` anywhere in `src/audio/`, with
 * `rng.ts` and its test exempted. Three selectors catch the forms a person
 * would actually reach for — `Math.random` referenced in any position (a
 * direct call `Math.random()` AND an alias assignment like `const r =
 * Math.random`), computed access (`Math['random']`), and destructuring
 * (`const { random } = Math`) — each verified individually to error. This is
 * NOT a guarantee that no `Math.random` reaches rendered audio: a
 * sufficiently determined indirection (reflection, a dynamically built
 * property-name string, routing through an untyped `any` that hides the
 * member access from the AST) can still evade a syntax-level lint rule.
 * What the rule buys is that the ordinary ways to write this by accident, or
 * to route around the seam without thinking about it, all fail the gate.
 * It exists so an offline render can be made reproducible by installing a
 * seeded generator for the duration of the render. THREE callers install a
 * replacement: the calibration harness in scripts/calibration/, the tests in
 * this directory, and — since the mixdown export shipped — the offline
 * renderer in src/audio/export/renderMixdown.ts, which is the first
 * PRODUCTION path to do so. Its replacement is scoped to one render and is
 * restored on every exit path; a caller that leaves one installed would make
 * every later caller, in the same process, silently non-random.
 */
let randomSource: () => number = Math.random;

/** The engine's one entry point for randomness that ends up in rendered audio. */
export function random(): number {
  return randomSource();
}

/**
 * Installs `fn` as the source `random()` reads from, or restores `Math.random`
 * when `fn` is nullish. Callers must restore the default themselves — typically
 * in a `finally` — once they are done.
 */
export function setRandomSource(fn: (() => number) | null | undefined): void {
  randomSource = fn ?? Math.random;
}

/**
 * A tiny deterministic PRNG (mulberry32), ported verbatim from
 * scripts/calibration/seededRandom.ts — which now re-exports THIS one — so the
 * offline mixdown render and the calibration renders draw from one
 * implementation rather than two that must be kept in step.
 *
 * Not cryptographically random and not meant to be: the only requirement is
 * that the same seed produces the same stream of [0, 1) values every time, on
 * every platform, so a render is reproducible.
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

/**
 * The seed every offline mixdown render resets to. A constant, not a secret:
 * any value works as long as it never changes between renders, which is what
 * makes two exports of the same song byte-identical.
 */
export const MIXDOWN_SEED = 0x6d69_7864; // 'mixd' ascii-ish, arbitrary

/**
 * Installs a FRESH `mulberry32(seed)` stream, runs `run`, and restores the
 * default on every exit path — success, throw and rejection alike.
 *
 * The reset happens at the START of every call rather than once per process,
 * so a render never carries stream state over from an earlier one. That is not
 * a nicety: without it, exporting the same song twice would produce two
 * different files, and a re-run of one test in isolation would not reproduce
 * the value a full-suite run produced.
 *
 * The seeding lives here rather than at each call site so "restored on every
 * exit path" is a property of one function instead of a `finally` every caller
 * has to remember.
 */
export async function withSeededRandom<T>(seed: number, run: () => T | Promise<T>): Promise<T> {
  setRandomSource(mulberry32(seed));
  try {
    return await run();
  } finally {
    setRandomSource(null);
  }
}
