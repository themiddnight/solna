/**
 * Live capture: the arithmetic that turns "a key went down just now" into a
 * grid column, and "it came back up" into a length in steps.
 *
 * Everything here is a pure function over plain numbers — no AudioContext,
 * no store, no DOM, and one leaf import. That is not tidiness. There is no
 * DOM in this suite to press a key against, so anything left inside the
 * clock callback or the bus listener cannot be tested at all, and this
 * feature area's history is a fully green suite that proved nothing about
 * whether the gesture worked.
 */

import { TICKS_PER_SIXTEENTH, leadNoteCells } from '../utils/stepResolution';

/** One clock dispatch, as handed over by subscribePlaybackClock. */
export interface ClockAnchor {
  /** The clock's monotonic 16th-step index. Never wraps; resetClock zeroes it. */
  step: number;
  /** The AudioContext time that step is scheduled to SOUND at — in the future. */
  time: number;
}

/**
 * How far past the newest anchor an observation may sit before the clock
 * counts as stopped. Anchors are future times, so this is generous by
 * construction: the honest reading of a `now` well past the last scheduled
 * step is that nothing is scheduling any more.
 */
export const LEAD_ANCHOR_STALE_STEPS = 4;

/**
 * The two most recent anchors, and only those. Two is all the arithmetic
 * needs, and keeping more would mean averaging across a tempo change.
 */
export function pushClockAnchor(
  anchors: readonly ClockAnchor[],
  next: ClockAnchor,
): ClockAnchor[] {
  const last = anchors[anchors.length - 1];
  // A rewind (resetClock sets the index back to 0) makes the two sides of
  // the seam incomparable: projecting across it yields a negative duration.
  if (last && next.step < last.step) return [next];
  // The stall detector re-dispatches a step already handed over. That is a
  // better time for the same step, not a second anchor — taken as one, the
  // measured duration would be a division by zero steps.
  if (last && next.step === last.step) return [...anchors.slice(0, -1), next];
  return [...anchors, next].slice(-2);
}

/**
 * Seconds per step, MEASURED from the anchors rather than computed from bpm.
 * Measuring makes the quantiser independent of what a step is: a bpm change,
 * a meter change and a future adjustable step resolution all follow for
 * free. A bpm-derived constant would keep returning the old value with no
 * error anywhere — the notes would simply land on the wrong columns.
 */
export function measuredStepDurationSec(anchors: readonly ClockAnchor[]): number | null {
  if (anchors.length < 2) return null;
  const a = anchors[anchors.length - 2];
  const b = anchors[anchors.length - 1];
  const steps = b.step - a.step;
  const seconds = b.time - a.time;
  if (steps <= 0 || !(seconds > 0)) return null;
  return seconds / steps;
}

/**
 * The clock step a press observed at `observedTime` belongs to, or null when
 * there is no running clock to quantise against.
 *
 * Two decisions live here. The latency subtraction: at ctx.currentTime = C
 * the sound reaching the player's ear was scheduled for C - outputLatency,
 * so a press observed at C is interpreted as having happened then — the
 * exact mirror of the delay DEV-376 adds to hold a playhead back. And
 * round-to-nearest: players straddle the beat in both directions, and
 * flooring turns that into a one-directional drag onto the previous step,
 * which reads as a sluggish groove and gets worse as tempo rises.
 *
 * Input latency — finger to JS event — is deliberately not compensated: it
 * cannot be measured from the page, and it is a few milliseconds.
 */
export function quantiseInputStep(
  anchors: readonly ClockAnchor[],
  observedTime: number,
  outputLatencySec: number,
): number | null {
  const stepDur = measuredStepDurationSec(anchors);
  if (stepDur === null) return null;
  const latest = anchors[anchors.length - 1];
  if (observedTime - latest.time > LEAD_ANCHOR_STALE_STEPS * stepDur) return null;
  const inputTime = observedTime - outputLatencySec;
  return Math.round(latest.step + (inputTime - latest.time) / stepDur);
}

/**
 * Wrap a column into the loop. Split out because the marker is handed a
 * column that has ALREADY been converted by the publisher and must not be
 * converted twice — one copy of the wrap with two entry points, rather than
 * two copies that agree today by coincidence.
 */
export function wrapColumn(column: number, columns: number): number {
  if (!(columns > 0) || !Number.isFinite(column)) return 0;
  const c = Math.round(column);
  return ((c % columns) + columns) % columns;
}

/**
 * A loop TICK as a grid column: tick -> column -> wrapped into the loop.
 * THE primitive under clockStepToGridColumn and under every scheduler that
 * already holds a tick — leadScheduleHits in useLeadPlayback.ts reaches it
 * rather than keeping its own `wrapColumn(Math.floor(tick / stride), ...)`,
 * because two copies of a floor-then-wrap agree only by coincidence.
 */
export function tickToColumn(tick: number, columns: number, stride: number): number {
  if (!(columns > 0) || !(stride > 0)) return 0;
  return wrapColumn(Math.floor(tick / stride), columns);
}

/**
 * A clock step as a grid column: 16th -> tick -> column -> wrapped into the
 * loop. THE named conversion — useLeadPlayback, leadRecord.ts and the
 * marker all reach it (or the tickToColumn primitive it is one line of)
 * rather than each dividing by their own copy of the stride, which is the
 * "three scattered pieces of arithmetic that each look correct in
 * isolation" this function was created to prevent.
 *
 * At 1/32 a quantiser that rounds to the nearest 16th can only ever produce
 * EVEN columns. That is correct and deliberate: the clock is the only time
 * reference there is, and a performance cannot be captured finer than the
 * grid the anchors describe.
 */
export function clockStepToGridColumn(
  clockStep: number,
  columns: number,
  stride: number,
): number {
  return tickToColumn(Math.round(clockStep) * TICKS_PER_SIXTEENTH, columns, stride);
}

/**
 * How long the key was held, in TICKS, rounded UP to a whole CELL with a
 * floor of one, so a captured note is never shorter than the grid can draw
 * and never ends inside a cell. Counted from raw clock steps, not seconds,
 * so a bpm change during the hold cannot change the answer. The loop-end
 * truncation is setLeadNoteLength's (invariant 2).
 *
 * The editor writes whole cells, and UP is the only direction that agrees
 * with what the note already sounded and drew — which is why this counts
 * cells with leadNoteCells, the same one the scheduler and the grid use,
 * and multiplies back into ticks. At 1/8 an odd-clock-step hold of 6 ticks
 * was heard and drawn as 8. Rounding down would shorten the capture, and
 * switching that loop to 1/32 later would shorten it again — the ratchet
 * the non-destructive rule exists to keep out of a change of view. Only
 * stride 4 can produce a sub-cell length at all; at 1/16 and 1/32 the raw
 * count is already a whole number of cells and this changes nothing.
 */
export function heldStepLength(onStep: number, offStep: number, stride: number): number {
  const cell = stride > 0 ? stride : 1;
  const raw = Math.round(offStep - onStep) * TICKS_PER_SIXTEENTH;
  return leadNoteCells(raw, cell) * cell;
}

/** Everything the live clock needs from the outside world, as functions. */
export interface LeadLiveClockDeps {
  /** The AudioContext's clock, or null when there is no context. */
  now: () => number | null;
  /** Seconds between the context reaching a time and the sound being heard. */
  outputLatency: () => number;
}

export interface LeadLiveClock {
  /** One clock dispatch: the step, and the time it will sound at. */
  anchor(step: number, time: number): void;
  /**
   * The quantised clock step for an input observed NOW, or null when there
   * is no running clock to quantise against. Null is the mode gate: it is
   * what tells the recorder to fall back to the cursor.
   */
  inputStep(): number | null;
  /** Drops every anchor. A stopped transport must not still have an answer. */
  reset(): void;
}

export function createLeadLiveClock(deps: LeadLiveClockDeps): LeadLiveClock {
  let anchors: ClockAnchor[] = [];
  return {
    anchor: (step, time) => {
      anchors = pushClockAnchor(anchors, { step, time });
    },
    inputStep: () => {
      const now = deps.now();
      if (now === null) return null;
      return quantiseInputStep(anchors, now, deps.outputLatency());
    },
    reset: () => {
      anchors = [];
    },
  };
}
