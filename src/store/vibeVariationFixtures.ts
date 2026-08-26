import type { VibeDraw } from './vibeVariation';
import { eligibleFor } from './vibeVariation';

/**
 * Deterministic VibeDraw implementations for tests. They live in their own
 * module rather than in a test file so several test files can share them
 * without importing each other. Nothing in src/ ships them to the app.
 */

/** Always the first eligible item; `int` returns `min`. */
export const firstDraw: VibeDraw = {
  pick: <T,>(items: T[]): T => {
    if (items.length === 0) throw new Error('firstDraw.pick: empty pool');
    return items[0];
  },
  pickDistinct: <T,>(items: T[], current: T): T => {
    const eligible = eligibleFor(items, current);
    return eligible.length === 0 ? current : eligible[0];
  },
  int: (min: number): number => min,
};

/** Always the last eligible item; `int` returns `max`. */
export const lastDraw: VibeDraw = {
  pick: <T,>(items: T[]): T => {
    if (items.length === 0) throw new Error('lastDraw.pick: empty pool');
    return items[items.length - 1];
  },
  pickDistinct: <T,>(items: T[], current: T): T => {
    const eligible = eligibleFor(items, current);
    return eligible.length === 0 ? current : eligible[eligible.length - 1];
  },
  int: (_min: number, max: number): number => max,
};

/**
 * Consumes a fixed list of indices, one per call, in call order. Indices
 * address the *eligible* list, so `pickDistinct` is scripted the same way as
 * `pick`. `int` treats the index as an offset from `min`.
 *
 * It throws when the script runs out rather than wrapping: a silent wrap would
 * let a change to the resolver's draw order pass a test that pins an exact
 * InstantVibe.
 */
export function scriptedDraw(indices: number[]): VibeDraw {
  let cursor = 0;
  const next = (limit: number): number => {
    if (cursor >= indices.length) {
      throw new Error(`scriptedDraw: script exhausted after ${indices.length} draws`);
    }
    const index = indices[cursor];
    cursor += 1;
    if (index < 0 || index >= limit) {
      throw new Error(`scriptedDraw: index ${index} out of range for ${limit} candidates`);
    }
    return index;
  };

  return {
    pick: <T,>(items: T[]): T => {
      if (items.length === 0) throw new Error('scriptedDraw.pick: empty pool');
      return items[next(items.length)];
    },
    pickDistinct: <T,>(items: T[], current: T): T => {
      const eligible = eligibleFor(items, current);
      return eligible.length === 0 ? current : eligible[next(eligible.length)];
    },
    int: (min: number, max: number): number => min + next(max - min + 1),
  };
}
