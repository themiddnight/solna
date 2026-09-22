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
 * seeded generator for the duration of the render. FOUR callers install a
 * replacement: the calibration harness in scripts/calibration/, the tests in
 * this directory, and — since the mixdown export shipped — the offline
 * renderer in src/audio/export/renderMixdown.ts, which is the first
 * PRODUCTION path to do so, and, since DEV-428, the MIDI export in
 * src/audio/export/renderMidi.ts. Its replacement is scoped to one render and
 * is restored on every exit path; a caller that leaves one installed would
 * make every later caller, in the same process, silently non-random.
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
 * Reads whatever source is currently installed, without changing it. Exists
 * so a long-running seeded caller that must yield control mid-run (an
 * `await` that lets other macrotasks — a live `setInterval` clock tick among
 * them — run before it resumes) can save its own generator, release the
 * global for the duration of the yield, and reassert its own generator
 * before drawing from it again. See `withSeededRandom`'s own restore-on-exit
 * contract: this is the same discipline applied around an INNER pause rather
 * than only around the whole run.
 */
export function getRandomSource(): () => number {
  return randomSource;
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

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Yields exactly like `yieldToMainThread`, but additionally protects the
 * seeded RNG stream `withSeededRandom` installed for this render from being
 * corrupted by a concurrent caller.
 *
 * `rng.ts`'s `randomSource` is a module GLOBAL, and this render's own draws
 * (a drum voice's noise start offset, a reverb impulse sample, an LFO's
 * random waveform sample) all go through the shared `random()` seam with no
 * argument identifying who is asking. Between two of THIS walk's own
 * synchronous bursts nothing else can run — JS has one thread — so the only
 * window where a foreign draw can land on our stream is the macrotask gap
 * `setTimeout(resolve, 0)` opens. If the user is ALSO playing the project
 * live while exporting (nothing pauses live playback for an export — see
 * `store/exportSlice.ts`), the live 16th-clock's `setInterval` tick is a
 * macrotask too, and a live note triggered in that gap would otherwise steal
 * a draw from this render's mulberry32 generator, silently shifting every
 * value the render reads after it resumes.
 *
 * The fix is to hand the generator itself, not just the intent to use it,
 * out of scope for the gap: capture whatever `withSeededRandom` installed,
 * swap the global to the ambient default so a foreign draw lands on
 * `Math.random` instead (harmless — live playback has no determinism
 * contract), then reassert this render's own generator before drawing from
 * it again. The generator's internal counter is therefore only ever
 * advanced by calls this render itself makes.
 *
 * Used by both offline exports (`export/renderMixdown.ts`, `export/renderMidi.ts`)
 * and driven directly by `export/renderMixdownRngIsolation.test.ts` — proving
 * this needs no `OfflineAudioContext`, only a seeded generator and a foreign
 * `random()` call landing mid-yield, so the test drives this function
 * directly rather than a whole render.
 */
export async function yieldPreservingRandomStream(): Promise<void> {
  const ownRandomSource = getRandomSource();
  setRandomSource(null);
  try {
    await yieldToMainThread();
  } finally {
    setRandomSource(ownRandomSource);
  }
}
