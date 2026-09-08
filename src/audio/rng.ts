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
 * It exists so the offline calibration renders in `scripts/calibration/` can
 * be made reproducible by installing a seeded generator for the duration of a
 * render. Production code always runs on the real `Math.random` — no
 * production code path installs a replacement; only tests and the calibration
 * harness call `setRandomSource`.
 * Anything that DOES install a replacement (calibration scripts, tests) is
 * responsible for restoring the default when it is done, including on the
 * error path — a replacement left installed would make every later caller,
 * in the same process, silently non-random.
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
