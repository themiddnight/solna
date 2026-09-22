import { MAX_STEPS_PER_BAR } from './timeSignature';
import { maxPatternHold, patternStoredIndexAt } from './patternTimeline';

/**
 * The immutable span edits the custom chord and bass timelines share.
 *
 * Two coordinate spaces, inherited from `patternTimeline.ts` and never mixed
 * here: a COLUMN is a 16th-step position in the active meter and a STORED slot
 * is bar-major at `MAX_STEPS_PER_BAR`. Every loop below walks COLUMNS and
 * converts through `patternStoredIndexAt`, which is what keeps bar one in 4/4
 * out of the slots 12/8 draws in — the two spaces have different widths, so a
 * direct index is only ever correct in the widest meter.
 *
 * Three invariants this module exists to make true before anything else reads
 * a pattern:
 *
 *   - **One lane never overlaps.** `writePatternSpan` and
 *     `normalizePatternSpans` both CLEAR every onset a span covers, earliest
 *     onset first, so a later onset inside an earlier span loses rather than
 *     layering under it.
 *   - **A hold is a finite positive integer that stops at the next folded chord
 *     boundary and at the pattern-cycle end** (`maxPatternHold`).
 *   - **Storage is fixed-width per bar.** Growing allocates whole
 *     `MAX_STEPS_PER_BAR` bars and never moves bar zero; trimming keeps the
 *     leading bars. A meter change therefore only changes which slots a view
 *     can reach — it never rewrites the row.
 *
 * Pure and generic over the value type (the chord lane stores booleans, the
 * bass lane stores symbolic tokens), so `src/utils/` stays a leaf and the store
 * slices that call this impose no shape on it. Nothing here mutates an input:
 * each changed array is cloned exactly once.
 */

/** The stored pattern state a span edit reads: values, parallel holds, window. */
export interface PatternSpans<TValue> {
  readonly values: readonly TValue[];
  readonly holds: readonly number[];
  /**
   * The active meter's bar length in 16th steps (`METERS[id].stepsPerBar`),
   * always one of 12..24: callers resolve it through `getMeter`, which falls
   * back to 4/4 rather than throwing, so no guard here has a real caller.
   */
  readonly stepsPerBar: number;
  /** The custom pattern's cycle in columns (`loopLength * stepsPerBar`). */
  readonly cycleSteps: number;
  /** Folded chord boundaries in columns (`foldPatternBoundaries`). */
  readonly boundaries: readonly number[];
  /** The value a rest slot carries — the lane's own "nothing here". */
  readonly empty: TValue;
}

/** A requested span write: the state, the visible onset, and its length. */
export interface PatternSpanWrite<TValue> extends PatternSpans<TValue> {
  readonly column: number;
  readonly value: TValue;
  readonly holdSteps: number;
}

/** A new stored pattern plus its parallel holds, both freshly allocated. */
export interface PatternSpansResult<TValue> {
  values: TValue[];
  holds: number[];
}

/** A finite count floored at `min`; anything else falls back to `min`. */
function finiteCount(value: number, min: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.round(value)) : min;
}

/**
 * The one hold sanitiser, used by all three edits: a hold is a finite positive
 * integer. Finite fractional values round to the nearest step; negative,
 * zero or non-finite values collapse to the harmless default of one step.
 */
export function normalizePatternHold(hold: number | undefined): number {
  if (hold === undefined) return 1;
  return finiteCount(hold, 1);
}

/** The columns a pattern's cycle exposes, floored at zero for a bad input. */
function visibleColumns(cycleSteps: number): number {
  return Number.isFinite(cycleSteps) ? Math.max(0, Math.round(cycleSteps)) : 0;
}

/** Whether a column belongs to the lane's currently visible cycle. */
export function isVisiblePatternColumn(column: number, cycleSteps: number): boolean {
  return Number.isInteger(column) && column >= 0 && column < visibleColumns(cycleSteps);
}

/**
 * True only for a slot the stored arrays actually have. `patternStoredIndexAt`
 * divides by `stepsPerBar` and multiplies by the bar, so a negative, NaN or
 * fractional column lands outside the row rather than throwing — and an index
 * is not a bounds check: `values[-1] = x` and `values[NaN] = x` both quietly
 * create a property instead of writing a slot.
 */
function isStoredSlot(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

/**
 * Grow or trim a stored pattern by WHOLE fixed-width bars, as Lead/FX's
 * `resizeLeadMelody` does on its own axis: each bar is `MAX_STEPS_PER_BAR`
 * slots whatever the active meter is, so a loop-length change never moves the
 * contents of a bar that survives. Growing pads with `empty` and a hold of one;
 * trimming keeps the leading bars and drops the rest.
 *
 * A bar count below one or not finite falls back to one bar — the smallest
 * cycle the progression rules permit, never an empty pattern.
 */
export function resizePatternBars<TValue>(
  values: readonly TValue[],
  holds: readonly number[],
  bars: number,
  empty: TValue,
): PatternSpansResult<TValue> {
  const target = finiteCount(bars, 1) * MAX_STEPS_PER_BAR;
  const nextValues = values.slice(0, target);
  const nextHolds = holds.slice(0, target);
  while (nextValues.length < target) nextValues.push(empty);
  // Holds pad to the WIDTH, not to the incoming hold array: a pattern whose
  // hold array is missing or short (an old saved pattern, an imported body)
  // still comes back parallel to its values, one step per unpadded slot.
  while (nextHolds.length < target) nextHolds.push(1);
  for (let i = 0; i < nextHolds.length; i += 1) {
    nextHolds[i] = normalizePatternHold(nextHolds[i]);
  }
  return { values: nextValues, holds: nextHolds };
}

/**
 * Write one onset at a visible `column` for `holdSteps` steps, clearing every
 * onset the span covers. This is the write half of the one-lane non-overlap
 * invariant: the caller commits here rather than to a lane that may already
 * hold a later onset, so "an explicit edit deletes what it covers" (the
 * Lead/FX rule) is one code path instead of one per editor.
 *
 * The requested length clamps at the next folded chord boundary and at the
 * cycle end through `maxPatternHold`, and a non-finite or sub-one request
 * becomes a single step. Writing the `empty` value IS an erase — it writes the
 * empty value and resets that slot's hold to one, so a rest never carries a
 * duration.
 *
 * A covered slot the stored array does not reach is skipped rather than
 * appended: storage is fixed-width, and extending it here would silently
 * reshape a pattern a meter change is supposed to leave alone.
 *
 * Every hold in the returned array is a finite positive integer — a stale or
 * missing hold anywhere in the row collapses to one, exactly as
 * `normalizePatternSpans` would leave it, so one write cannot resurrect an
 * invalid duration the next read has to clean up again.
 * An invalid or no-longer-visible column is the exception: it returns cloned
 * inputs unchanged because a stale pointer stream is not an edit.
 */
export function writePatternSpan<TValue>(input: PatternSpanWrite<TValue>): PatternSpansResult<TValue> {
  if (!isVisiblePatternColumn(input.column, input.cycleSteps)) {
    return { values: [...input.values], holds: [...input.holds] };
  }
  const values = [...input.values];
  const holds = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    holds[i] = normalizePatternHold(input.holds[i]);
  }

  const requested = normalizePatternHold(input.holdSteps);
  const ceiling = Math.max(1, maxPatternHold(input.column, input.boundaries, input.cycleSteps));
  const allowed = Math.min(requested, ceiling);
  for (let offset = 1; offset < allowed; offset += 1) {
    const covered = patternStoredIndexAt(input.column + offset, input.stepsPerBar);
    if (!isStoredSlot(covered, values.length)) continue;
    values[covered] = input.empty;
    holds[covered] = 1;
  }

  const head = patternStoredIndexAt(input.column, input.stepsPerBar);
  if (isStoredSlot(head, values.length)) {
    values[head] = input.value;
    holds[head] = input.value === input.empty ? 1 : allowed;
  }
  return { values, holds };
}

/**
 * Make a stored pattern's spans legal in place of any read-time upgrade chain
 * (this project has none — validation replaced them): walk the ACTIVE visible
 * columns left to right, clamp each onset's hold to its boundary and cycle
 * ceiling, clear every onset that hold covers, and reset every visible rest
 * slot's hold to one. Earliest onset wins by construction: a span clears the
 * slots ahead of it, so when the walk reaches one it is a rest and starts no
 * span of its own.
 *
 * **Meter-dormant slots are left exactly as they are.** A slot the active
 * window cannot reach is not overhanging, it is dormant — normalizing it here
 * would make a meter round-trip destructive, and the round trip is the only
 * reason a pattern authored in 12/8 survives being viewed in 4/4. The visible
 * columns come from `cycleSteps`, so the dormant set is exactly the slots no
 * column maps to.
 *
 * A column past the end of the stored arrays is skipped rather than padded:
 * the caller owns the array's width, and this function only makes what is
 * already there legal.
 */
export function normalizePatternSpans<TValue>(input: PatternSpans<TValue>): PatternSpansResult<TValue> {
  const values = [...input.values];
  const holds = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    holds[i] = normalizePatternHold(input.holds[i]);
  }

  const columns = visibleColumns(input.cycleSteps);
  for (let column = 0; column < columns; column += 1) {
    const index = patternStoredIndexAt(column, input.stepsPerBar);
    if (!isStoredSlot(index, values.length)) continue;
    if (values[index] === input.empty) {
      holds[index] = 1;
      continue;
    }
    const ceiling = Math.max(1, maxPatternHold(column, input.boundaries, input.cycleSteps));
    const hold = Math.min(holds[index], ceiling);
    holds[index] = hold;
    for (let offset = 1; offset < hold; offset += 1) {
      const covered = patternStoredIndexAt(column + offset, input.stepsPerBar);
      if (!isStoredSlot(covered, values.length)) continue;
      values[covered] = input.empty;
      holds[covered] = 1;
    }
  }
  return { values, holds };
}
