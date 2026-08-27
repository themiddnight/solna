import { MAX_STEPS_PER_BAR } from './meter';

/**
 * Array-shaped pattern adaptation: the drum rows, which are dense per-step
 * arrays (`boolean[]` in GENRE_PRESETS, `number[]` in VIBE_DRUM_PATTERNS).
 * The event-shaped siblings (RhythmHit[]/BassStep[]) live in eventAdapt.ts.
 *
 * Two rules, and only two (see the spec, "Pattern adaptation"):
 *
 *   - Shorter target -> TRIM. Drop every step at or after `targetSteps`.
 *   - Longer target  -> LOOP. Repeat the source from index 0 until the bar is
 *     full, so every bar plays identically and nothing drifts across bar lines.
 *
 * NEVER stretch or rescale. A four-on-floor kick at 0/4/8/12 trimmed to a
 * 12-step bar must yield 0/4/8 — musically correct. A proportional stretch
 * would yield 0/3/6/9, which is wrong, and rounding a dense hi-hat row onto the
 * 16th grid collapses or duplicates hits.
 */
export function adaptStepRow<T>(row: readonly T[], targetSteps: number): T[] {
  if (targetSteps <= 0 || row.length === 0) return [];
  const out: T[] = new Array(targetSteps);
  for (let i = 0; i < targetSteps; i++) out[i] = row[i % row.length];
  return out;
}

/** `adaptStepRow` across a whole instrument -> row map, preserving the key set. */
export function adaptStepRows<T>(
  rows: Record<string, readonly T[]>,
  targetSteps: number,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const [name, row] of Object.entries(rows)) {
    out[name] = adaptStepRow(row, targetSteps);
  }
  return out;
}

/**
 * Widen a stored sequencer row to the persisted step width. Distinct from
 * `adaptStepRow`: padding adds SILENCE, because these are the user's own
 * programming and inventing hits for the extra steps would be a lie. Cells are
 * coerced to booleans so a corrupt persisted payload cannot reach the grid.
 */
export function padStepRow(row: readonly boolean[], width = MAX_STEPS_PER_BAR): boolean[] {
  const out: boolean[] = new Array(width);
  for (let i = 0; i < width; i++) out[i] = row[i] === true;
  return out;
}

/**
 * Sequencer rows are ALWAYS stored at MAX_STEPS_PER_BAR; only the first
 * `stepsPerBar` cells are played and drawn. Everything past the window is the
 * user's programming for a wider meter and must survive untouched — that is
 * what makes switching meter non-destructive.
 */
export function writeStepWindow(
  steps: readonly boolean[],
  stepsPerBar: number,
  next: readonly boolean[],
): boolean[] {
  const out = padStepRow(steps);
  const width = Math.min(Math.max(0, stepsPerBar), MAX_STEPS_PER_BAR);
  for (let i = 0; i < width; i++) out[i] = next[i] === true;
  return out;
}

/**
 * Rotate ONLY the visible window by one step. Rotating the whole stored array
 * (the historical `pop()/unshift()`) would carry padding cells into view the
 * moment rows became wider than the bar.
 */
export function rotateStepWindow(
  steps: readonly boolean[],
  stepsPerBar: number,
  direction: 'left' | 'right',
): boolean[] {
  const out = padStepRow(steps);
  const width = Math.min(Math.max(0, stepsPerBar), MAX_STEPS_PER_BAR);
  if (width < 2) return out;
  const window = out.slice(0, width);
  if (direction === 'right') {
    window.unshift(window.pop()!);
  } else {
    window.push(window.shift()!);
  }
  for (let i = 0; i < width; i++) out[i] = window[i];
  return out;
}
