import { describe, expect, test } from 'bun:test';
import { getRandomSource, random, withSeededRandom, yieldPreservingRandomStream } from '../rng';

/**
 * Final-review fix (perf/audio-engine-fixes, Finding 2): Task 3 made
 * `scheduleArrangement` yield mid-walk with a plain `setTimeout(resolve, 0)`
 * macrotask hop. `rng.ts`'s `randomSource` is a module GLOBAL with no
 * caller identity, so if the user is ALSO playing the project live while an
 * export runs (nothing pauses live playback for an export — see
 * `store/exportSlice.ts`), the live 16th-clock's `setInterval` tick can
 * fire inside that gap and steal a draw from the export's seeded generator,
 * silently shifting every value the render reads afterward — an offline
 * export that is supposed to be byte-for-byte reproducible becomes
 * non-deterministic specifically when something else is also making sound.
 *
 * No DOM, no `AudioContext`, no `OfflineAudioContext` needed: the defect is
 * entirely in how `random()`'s shared source is handed across an `await`,
 * so this drives that seam directly, the way `.claude/rules/testing.md`
 * asks a planner test to construct its snapshot directly rather than reach
 * for the zustand singleton.
 */
// The ambient default `random()` reads outside any `withSeededRandom` call,
// obtained through the seam rather than naming `Math.random` directly — this
// file lives under src/audio/**, where `no-restricted-syntax` bans that
// reference outright (see eslint.config.js's AUDIO_RANDOM_BAN_SYNTAX and its
// exemption list, which does not include this file).
const DEFAULT_RANDOM_SOURCE = getRandomSource();

describe('yieldPreservingRandomStream (Finding 2: seeded RNG survives a concurrent live draw)', () => {
  test('a foreign random() draw landing inside the yield window does not shift the seeded stream', async () => {
    const seed = 0xf00d_1234;

    // Baseline: two consecutive draws from the same seed, no yield between
    // them at all — the sequence a fully synchronous scheduling walk would
    // produce.
    const baseline = await withSeededRandom(seed, () => [random(), random()]);

    // Patch setTimeout so the macrotask `yieldPreservingRandomStream` opens
    // is "won" by a foreign caller's random() draw before the yield's own
    // resolve runs — this is the live clock's setInterval tick landing in
    // the gap, modeled as a plain competing random() call the way the
    // review asked ("call random() directly between two
    // scheduleArrangement-related steps").
    const realSetTimeout = globalThis.setTimeout;
    let foreignDraws = 0;
    globalThis.setTimeout = ((fn: () => void) => {
      random(); // the foreign draw — must land on the ambient default, not our stream
      foreignDraws += 1;
      fn();
      return 1;
    }) as typeof setTimeout;

    let interrupted: number[];
    try {
      interrupted = await withSeededRandom(seed, async () => {
        const first = random();
        await yieldPreservingRandomStream();
        const second = random();
        return [first, second];
      });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }

    // The foreign draw really happened (proving the test would have caught
    // a regression, not skipped the interruption entirely)...
    expect(foreignDraws).toBe(1);
    // ...yet the render's own two draws are UNAFFECTED by it.
    expect(interrupted).toEqual(baseline);
  });

  test('the seeded generator is reinstalled immediately after the yield resolves, before the caller draws again', async () => {
    const seed = 42;
    const realSetTimeout = globalThis.setTimeout;
    let sourceDuringGap: (() => number) | undefined;
    globalThis.setTimeout = ((fn: () => void) => {
      // Mid-gap: the render released ownership, so the installed source
      // must be the ambient default, never the render's own generator.
      sourceDuringGap = getRandomSource();
      fn();
      return 1;
    }) as typeof setTimeout;

    let sourceAfterYield: (() => number) | undefined;
    try {
      await withSeededRandom(seed, async () => {
        const ownSource = getRandomSource();
        await yieldPreservingRandomStream();
        sourceAfterYield = getRandomSource();
        expect(sourceAfterYield).toBe(ownSource);
      });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }

    expect(sourceDuringGap).toBe(DEFAULT_RANDOM_SOURCE);
    expect(sourceAfterYield).not.toBe(DEFAULT_RANDOM_SOURCE);
    // withSeededRandom's own finally restores the default once the whole
    // call completes, same as before this fix.
    expect(getRandomSource()).toBe(DEFAULT_RANDOM_SOURCE);
  });
});
