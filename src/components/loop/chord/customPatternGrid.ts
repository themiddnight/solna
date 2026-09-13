import { beatIndexAt } from '@/utils/meter';
import { normalizePatternHold } from '@/utils/customPattern';
import { maxPatternHold, patternStoredIndexAt } from '@/utils/patternTimeline';

/**
 * The one-lane custom Chord/Bass pattern's cell model: a pure, bar-major view
 * of a stored pattern, addressed by VISIBLE COLUMN.
 *
 * Two coordinate spaces meet here, and the split is the whole reason this file
 * exists rather than a `.map()` in the component:
 *
 *   - A COLUMN is a 16th-step position in the ACTIVE meter. A two-bar 3/4 loop
 *     has 24 of them, and every accessible name, edit callback and resize
 *     gesture is expressed in columns.
 *   - A STORED slot is bar-major at MAX_STEPS_PER_BAR, the widest meter's row.
 *     `customChordRhythm`/`customBassPattern` and their hold arrays are stored
 *     that way so a meter change never rewrites them — it only changes which
 *     slots are reachable — so every read goes through
 *     `patternStoredIndexAt`. Reading `values[column]` instead would be right
 *     in 4/4 and silently wrong in every other meter.
 *
 * A span is one HEAD (the onset the user can edit) plus the BODY cells it
 * covers. Bodies are owned by their head and are not events: the store clears
 * every onset a hold swallows, so a body only ever means "the head before me
 * is still sounding".
 */

/** One visible column of a custom pattern, as the timeline draws it. */
export type CustomPatternCell<TValue> =
  | { kind: 'empty'; column: number; storedIndex: number }
  | {
      kind: 'head';
      column: number;
      storedIndex: number;
      value: TValue;
      /** Visible length in 16th steps, never below 1 and never past the cap. */
      length: number;
      /** The longest this span may become: the next folded boundary or the cycle end. */
      maxLength: number;
    }
  | { kind: 'body'; column: number; storedIndex: number; ownerColumn: number };

/** A head cell, once `kind` has been narrowed. */
export type CustomPatternHead<TValue> = Extract<
  CustomPatternCell<TValue>,
  { kind: 'head' }
>;

/**
 * The drawn length of a stored hold: whole steps, at least one, never past the
 * boundary cap.
 *
 * A fractional hold ROUNDS to the nearest step — the same convention the store
 * uses to repair one (`normalizePatternHold`) and the same one playback reads it back
 * with. Flooring here instead would draw a span one step shorter than the one
 * that sounds, which is exactly the disagreement this defensive read exists to
 * prevent: a stored 2.5 is a three-step span everywhere else.
 *
 * A hold that is not a finite number at all (NaN, an infinite value, a missing
 * entry, a negative) is one step rather than zero — a zero-step span cannot be
 * drawn and cannot be grabbed again, and imported state is the one place an
 * invalid hold can still arrive from.
 */
function visibleHold(hold: number | undefined, maxLength: number): number {
  return Math.min(normalizePatternHold(hold), Math.max(1, maxLength));
}

/**
 * Every visible column of the active meter, in order.
 *
 * `values`/`holds` are the stored, bar-major arrays; `boundaries` are the
 * progression's chord changes folded onto the cycle (see
 * `foldPatternBoundaries`) and cap every span so a held chord never crosses a
 * change.
 *
 * Walking columns rather than stored slots is what keeps a short meter honest:
 * a stored slot the active meter cannot reach is never visited, so a hit left
 * in bar zero's dormant half by a meter change is not drawn in the wrong bar.
 *
 * Encountering an ACTIVE value inside a span that is still open ends the prior
 * span and starts a new head. Store writes clear swallowed onsets, so that
 * shape is only reachable from imported state — and drawing it as an overlap
 * would be two events in one place rather than the two heads it really is.
 */
export function customPatternCells<TValue>(
  values: readonly TValue[],
  holds: readonly number[],
  loopLength: number,
  stepsPerBar: number,
  empty: TValue,
  boundaries: readonly number[] = [],
): CustomPatternCell<TValue>[] {
  const cycleSteps = loopLength * stepsPerBar;
  const cells: CustomPatternCell<TValue>[] = [];
  let ownerColumn = -1;
  let spanEnd = 0;

  for (let column = 0; column < cycleSteps; column++) {
    const storedIndex = patternStoredIndexAt(column, stepsPerBar);
    const value = values[storedIndex];

    if (value !== undefined && value !== empty) {
      const maxLength = maxPatternHold(column, boundaries, cycleSteps);
      const length = visibleHold(holds[storedIndex], maxLength);
      cells.push({ kind: 'head', column, storedIndex, value, length, maxLength });
      ownerColumn = column;
      spanEnd = column + length;
      continue;
    }

    if (column < spanEnd) {
      cells.push({ kind: 'body', column, storedIndex, ownerColumn });
      continue;
    }

    ownerColumn = -1;
    cells.push({ kind: 'empty', column, storedIndex });
  }

  return cells;
}

/** What a keypress on a cell means, decided without a DOM. */
export type CustomPatternKeyOutcome = 'none' | 'activate' | 'erase' | 'resize';

/**
 * The keyboard semantics of one cell, so they can be unit-tested without a
 * testing library: Enter/Space activate, Delete/Backspace erase, Shift with a
 * horizontal arrow resizes.
 *
 * A resize is only reported when it would actually move the span — a head
 * already at its `maxLength` cannot grow and one at a single step cannot
 * shrink — so a caller can treat the outcome as "there is something to write".
 *
 * A BODY cell answers 'none' to everything: it belongs to the head before it,
 * and giving it its own edit would let one span be erased or resized twice.
 */
export function customPatternKeyOutcome<TValue>(
  key: string,
  shiftKey: boolean,
  cell: CustomPatternCell<TValue>,
): CustomPatternKeyOutcome {
  if (cell.kind === 'body') return 'none';
  if (key === 'Enter' || key === ' ' || key === 'Spacebar') return 'activate';
  if (key === 'Delete' || key === 'Backspace') return 'erase';
  if (!shiftKey || cell.kind !== 'head') return 'none';
  if (key === 'ArrowRight') return cell.length < cell.maxLength ? 'resize' : 'none';
  if (key === 'ArrowLeft') return cell.length > 1 ? 'resize' : 'none';
  return 'none';
}

/**
 * Where a Shift+Arrow resize moves a head to: one step, clamped to the span's
 * own floor and ceiling. Only meaningful after `customPatternKeyOutcome` has
 * answered 'resize'.
 */
export function resizedPatternLength<TValue>(
  cell: CustomPatternHead<TValue>,
  key: string,
): number {
  const delta = key === 'ArrowLeft' ? -1 : 1;
  return Math.min(Math.max(1, cell.length + delta), Math.max(1, cell.maxLength));
}

/**
 * The bar, beat and step-within-beat a column sits on, all one-based. The
 * final coordinate keeps adjacent 16th cells from sharing an accessible name.
 *
 * The beat comes from the meter's ACCENT GROUPS rather than from a fixed four
 * steps: 3/4 and 6/8 share a 12-step bar and differ only in the grouping, so a
 * division hardcoded here would name the wrong beat in one of them.
 */
export function customPatternPositionLabel(
  column: number,
  stepsPerBar: number,
  accentGroups: readonly number[],
): string {
  const bar = Math.floor(column / stepsPerBar) + 1;
  // `beatIndexAt` takes the meter's mutable `accentGroups` array, so the
  // readonly view is copied rather than widened for everybody: the labeling
  // arithmetic stays one function, in `utils/meter.ts`, where the metronome
  // and the sequencer read it too.
  const beat = beatIndexAt(column % stepsPerBar, [...accentGroups]) + 1;
  const beatStart = accentGroups.slice(0, beat - 1).reduce((sum, size) => sum + size, 0);
  const step = (column % stepsPerBar) - beatStart + 1;
  return `bar ${bar} beat ${beat} step ${step}`;
}
