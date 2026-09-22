import { MAX_STEPS_PER_BAR } from './timeSignature';

/**
 * The timeline arithmetic the Chord and Bass editors share. Headless on
 * purpose: every function here is a pure mapping between a VISIBLE column, a
 * STORED row slot and the span boundaries a custom pattern is drawn against,
 * so the store, the grid components and their tests all read one answer.
 *
 * Two coordinate spaces, and the distinction is the whole point:
 *
 *   - A COLUMN is a 16th-step position in the active meter. `cycleSteps` is a
 *     column count (`loopLength * stepsPerBar`), and so is every position an
 *     editor hands in.
 *   - A STORED slot is bar-major at `MAX_STEPS_PER_BAR`, the widest meter's
 *     row, exactly as the sequencer, chord-rhythm and bass grids are stored.
 *     Only the active window of each bar is reachable, so a meter change never
 *     rewrites a row — it changes which slots the view can draw.
 *
 * `loopLengthDivisors` and `clampLoopLength` were lifted here out of
 * `audio/leadMelody.ts` (as `clampLeadLoopLength`) once a second and third
 * editor needed them: "a loop length must divide the progression" is a rule
 * about the progression, not about the lead melody, and two copies of it would
 * be two chances to disagree. `audio/` imports them back from here.
 */

/** Positive divisors ascending; an invalid total falls back to `[1]`. */
export function loopLengthDivisors(totalBars: number): number[] {
  if (!Number.isInteger(totalBars) || totalBars < 1) return [1];
  const divisors: number[] = [];
  for (let n = 1; n <= totalBars; n++) {
    if (totalBars % n === 0) divisors.push(n);
  }
  return divisors;
}

/**
 * Clamp down to the largest divisor of totalBars that is <= current. Falls
 * back to 1 for a zero/invalid totalBars. Always returns a divisor, so a
 * stored loopLength never runs past the progression.
 */
export function clampLoopLength(current: number, totalBars: number): number {
  const divisors = loopLengthDivisors(totalBars);
  let best = 1;
  for (const d of divisors) {
    if (d <= current) best = d;
  }
  return best;
}

/**
 * The stored slot for a visible COLUMN: bar-major at MAX_STEPS_PER_BAR, with
 * the column's offset inside its bar preserved. The 16th-step sibling of
 * `audio/leadMelody.ts`'s tick-keyed `leadStoredIndexAtTick` — the melody
 * tracks store at a step resolution on top of the meter, the chord and bass
 * grids do not.
 */
export function patternStoredIndexAt(column: number, stepsPerBar: number): number {
  const bar = Math.floor(column / stepsPerBar);
  return bar * MAX_STEPS_PER_BAR + (column % stepsPerBar);
}

/**
 * Every column at which a pattern's chord changes, folded onto the cycle:
 * the running sum of `durations` mapped into 0..cycleSteps, deduped and
 * ascending, always including 0 and cycleSteps.
 *
 * The durations are authored against the progression, which can be longer
 * than the loop, so the walk is folded with `%` rather than truncated: a
 * 4-bar progression over a 2-bar loop must produce the same boundaries in
 * both bars, not two boundaries and then silence. A sum landing exactly on
 * the cycle adds nothing — 0 is already the first boundary and cycleSteps the
 * last, so a chord that ends where the loop ends is a boundary, not a
 * duplicate.
 */
export function foldPatternBoundaries(durations: readonly number[], cycleSteps: number): number[] {
  const points = new Set<number>([0, cycleSteps]);
  let cursor = 0;
  for (const duration of durations) {
    cursor += duration;
    const folded = cursor % cycleSteps;
    if (folded > 0) points.add(folded);
  }
  return [...points].sort((a, b) => a - b);
}

/**
 * The longest a span starting at `start` may hold before it would swallow the
 * next chord change — the steps from `start` to the nearest boundary greater
 * than it, or to the cycle end when `start` is in the last segment.
 *
 * A column that IS a boundary holds the whole next segment (never 0): the
 * boundary marks where the chord changes, and the head sitting on it is the
 * span that begins there. The search is a minimum rather than "first greater
 * than", so the answer does not depend on `boundaries` arriving sorted.
 */
export function maxPatternHold(
  start: number,
  boundaries: readonly number[],
  cycleSteps: number,
): number {
  let hold = cycleSteps - start;
  for (const boundary of boundaries) {
    if (boundary > start && boundary - start < hold) hold = boundary - start;
  }
  return hold;
}
