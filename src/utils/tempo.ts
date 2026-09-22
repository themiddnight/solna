/**
 * Transport timing: tempo bounds and how a bpm becomes seconds.
 *
 * Split out of `utils/musicTheory.ts` (DEV-426), which mixed these with pitch,
 * chord and scale helpers — two different domains behind one import. The
 * engine may read timing but must never read the music-domain half (R179), and
 * a module that states only one of the two is what makes that ban a boundary
 * rather than a per-name allowlist.
 *
 * This module imports only `utils/timeSignature.ts`, which imports nothing.
 */

import { METERS } from './timeSignature';

export function sixteenthNoteMs(bpm: number): number {
  return ((60 / Math.max(1, bpm)) * 1000) / 4;
}

/**
 * The 4/4 bar length, in 16th steps.
 *
 * This is a DEFAULT: the live bar length comes from the transport's meter
 * (`getMeter(meterId).stepsPerBar`). It stays 16 so the functions that take
 * `stepsPerBar` as a defaulted parameter keep their historical behaviour when a
 * caller has no meter to hand.
 */
export const STEPS_PER_BAR = METERS['4/4'].stepsPerBar;

/** Transport tempo bounds. The engine clock and the store clamp to the same pair. */
export const MIN_BPM = 20;
export const MAX_BPM = 300;

/**
 * A bpm the clock can actually use. The BPM input is `type="number"`, so an
 * empty field yields 0 — an unclamped 0 makes every listener compute a step
 * duration from a 1-bpm floor and land its note-offs minutes away (stuck notes).
 */
export function clampBpm(bpm: number): number {
  if (Number.isNaN(bpm)) return 120;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

/** One 16th-note step, in seconds. */
export function stepDurationSec(bpm: number): number {
  return sixteenthNoteMs(bpm) / 1000;
}

/** One bar, in seconds. `stepsPerBar` defaults to the 4/4 bar. */
export function barDurationSec(bpm: number, stepsPerBar: number = STEPS_PER_BAR): number {
  return stepDurationSec(bpm) * stepsPerBar;
}
