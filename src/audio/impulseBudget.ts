/**
 * The reverb impulse cache's eviction policy, as pure arithmetic.
 *
 * The engine used to bound this cache by ENTRY COUNT (an 8-ENTRY cap), which
 * measures the wrong thing: eight 0.2 s impulses are ~150 KB, eight 10 s
 * stereo impulses at 48 kHz are ~30 MB, and the cache treated them the same.
 * Bounding on total samples makes the memory ceiling the thing that is
 * actually capped.
 *
 * Lives outside engine.ts so the policy is testable without an AudioContext.
 */

/** One cached impulse: its quantised-decay key and its Float32 sample count. */
export interface ImpulseCacheEntry {
  key: number;
  samples: number;
}

/**
 * ~16 MB of Float32 (4 bytes/sample) — four full-length 10 s stereo impulses
 * at 48 kHz, or ~40 one-second ones. Chosen against the OLD worst case: the
 * 8-entry cap allowed 7,680,000 samples (~30 MB) of pinned AudioBuffer after a
 * sweep near the top of the Decay range.
 */
export const IMPULSE_CACHE_SAMPLE_BUDGET = 4_000_000;

/**
 * Sample count of the buffer `AudioEngine.buildImpulseResponse` creates for a
 * decay: `createBuffer(2, max(1, floor(sampleRate * durationSec)), sampleRate)`.
 *
 * Derived from the decay rather than read off the AudioBuffer so the engine
 * never has to touch `length`/`numberOfChannels` — the test fake models
 * neither.
 */
export function impulseSampleCount(sampleRate: number, decaySec: number, channels = 2): number {
  return Math.max(1, Math.floor(sampleRate * decaySec)) * channels;
}

/**
 * Which keys to drop, oldest first, to bring `entries` inside `budget`.
 *
 * `entries` must be in LRU order (oldest first) — a Map's own iteration order,
 * which `getImpulseResponse` already maintains by re-inserting on every hit.
 *
 * The newest entry is never evicted: it is the impulse the caller just built
 * and is about to assign to the ConvolverNode, and a single 10 s impulse can
 * legitimately exceed a budget smaller than itself. Evicting it would make the
 * cache a guaranteed miss at the top of the Decay range.
 */
export function keysToEvict(
  entries: readonly ImpulseCacheEntry[],
  budget = IMPULSE_CACHE_SAMPLE_BUDGET,
): number[] {
  if (entries.length === 0) return [];
  let total = 0;
  for (const entry of entries) total += entry.samples;

  const evicted: number[] = [];
  // entries.length - 1: stop before the newest entry.
  for (let i = 0; i < entries.length - 1 && total > budget; i++) {
    evicted.push(entries[i].key);
    total -= entries[i].samples;
  }
  return evicted;
}
