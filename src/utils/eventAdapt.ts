/**
 * Event-shaped pattern adaptation: the sparse, positioned patterns —
 * `RhythmHit[]` (audio/rhythmPatterns.ts) and `BassStep[]`
 * (audio/bassPatterns.ts). The dense drum-row siblings live in patternAdapt.ts.
 *
 * Structurally typed on `{ step, holdSteps? }` on purpose: utils/ must not
 * import audio/, and both event types already satisfy this shape.
 *
 * Same two rules as the array-shaped side, plus one extra obligation: an event
 * carries a DURATION, so trimming must also clamp `holdSteps` — otherwise a
 * note rings past the bar end and over the next chord.
 */
export interface StepPositioned {
  /** 16th-note position within the bar. */
  step: number;
  /** How many 16th steps the event holds. Absent means 1. */
  holdSteps?: number;
}

const DEFAULT_HOLD_STEPS = 1;

export function adaptStepEvents<T extends StepPositioned>(
  events: readonly T[],
  sourceSteps: number,
  targetSteps: number,
): T[] {
  if (targetSteps <= 0 || sourceSteps <= 0 || events.length === 0) return [];

  const inBar = events.filter((ev) => ev.step >= 0 && ev.step < sourceSteps);
  const repetitions = Math.ceil(targetSteps / sourceSteps);
  const out: T[] = [];

  for (let rep = 0; rep < repetitions; rep++) {
    const offset = rep * sourceSteps;
    for (const ev of inBar) {
      const step = ev.step + offset;
      if (step >= targetSteps) continue;
      const room = targetSteps - step;
      const hold = ev.holdSteps ?? DEFAULT_HOLD_STEPS;
      // Only materialise holdSteps when the clamp actually bites: leaving an
      // implicit hold implicit keeps the adapted event deep-equal to the
      // source in the common 4/4 -> 4/4 case.
      const clamped: T =
        hold > room ? ({ ...ev, step, holdSteps: room } as T) : ({ ...ev, step } as T);
      out.push(clamped);
    }
  }

  return out.sort((a, b) => a.step - b.step);
}
