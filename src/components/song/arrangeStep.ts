/**
 * Above this the LCM stops being a useful bound (an arrangement of coprime
 * loop lengths can push it into the billions), so the raw monotonic step is
 * used instead — correct, just unbounded, exactly as it was before.
 */
export const ARRANGE_CYCLE_MAX = 100_000;

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * The smallest step count after which EVERY loop's progress repeats.
 *
 * ArrangeView reduces the playhead per card with `currentStep %
 * totalStepsInLoop`, and each card has its own total, so the stored value may
 * only be reduced modulo a COMMON multiple of all of them — the LCM. Returns 0
 * when there is no usable cycle (no positive totals, or the LCM exceeds
 * ARRANGE_CYCLE_MAX), which callers read as "do not reduce".
 */
export function arrangeCycleSteps(totals: readonly number[]): number {
  let cycle = 0;
  for (const total of totals) {
    // A non-positive total is not a real loop length; ignoring it is safer
    // than letting a 0 collapse the LCM.
    if (!Number.isFinite(total) || total <= 0) continue;
    const next = Math.round(total);
    if (cycle === 0) {
      cycle = next;
    } else {
      cycle = (cycle / gcd(cycle, next)) * next;
    }
    if (cycle > ARRANGE_CYCLE_MAX) return 0;
  }
  return cycle;
}

/** The step to store: reduced modulo `cycle`, or unchanged when cycle is 0. */
export function arrangeStep(rawStep: number, cycle: number): number {
  return cycle > 0 ? rawStep % cycle : rawStep;
}
