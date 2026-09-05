/**
 * Live capture: the arithmetic that turns "a key went down just now" into a
 * grid column, and "it came back up" into a length in steps.
 *
 * Everything here is a pure function over plain numbers — no AudioContext,
 * no store, no DOM, and no imports at all. That is not tidiness. There is no
 * DOM in this suite to press a key against, so anything left inside the
 * clock callback or the bus listener cannot be tested at all, and this
 * feature area's history is a fully green suite that proved nothing about
 * whether the gesture worked.
 */

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
 * How many steps the key was held for. Counted in STEPS, not seconds, so a
 * bpm change during the hold cannot change the answer. The loop-end
 * truncation is setLeadNoteLength's (invariant 2), not this function's.
 */
export function heldStepLength(onStep: number, offStep: number): number {
  return Math.max(1, Math.round(offStep - onStep));
}

/**
 * A clock step as a grid column. Today the clock's 16th step and a grid
 * column are the same thing, so the resolution part is the identity and only
 * the loop wrap does any work — named anyway, because when DEV-375 makes the
 * step resolution adjustable there is then ONE place to change instead of
 * three scattered pieces of arithmetic that each look correct in isolation.
 */
export function clockStepToGridColumn(clockStep: number, columns: number): number {
  if (!(columns > 0)) return 0;
  const step = Math.round(clockStep);
  return ((step % columns) + columns) % columns;
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
