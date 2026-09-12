/**
 * Structural loop maths, free of the store. `src/audio/export/renderMixdown.ts`
 * has to know how long each loop dwells BEFORE it can size an
 * OfflineAudioContext, and src/audio/ may not import src/store/ — so the rule
 * lives here, in the one layer both can reach.
 *
 * The parameter types are declared HERE rather than imported from
 * `src/store/types.ts`, deliberately: importing them would widen the one
 * recorded `utils/ -> store/` inversion (utils/localFileSave.ts,
 * utils/driveBrowser.ts), which exists for a constant that cannot be
 * duplicated and would not be justified by a type. `Loop` is structurally
 * assignable to `StructuralLoop`, so no caller changes.
 */

/** One chord's structural contribution. `bars` absent means one bar. */
export interface StructuralChord {
  bars?: number;
}

/** The structural half of a loop — what the arrangement needs to know about it. */
export interface StructuralLoop {
  id: string;
  chords: readonly StructuralChord[];
  repeatCount?: number;
}

/**
 * A loop's length in bars — the same total the chord player already advances
 * through (`chord.bars x stepsPerBar` per chord), so the loop boundary is
 * exactly where the progression wraps.
 */
export function loopBars(chords: readonly StructuralChord[]): number {
  return chords.reduce((sum, c) => sum + (c.bars || 1), 0);
}

/** A loop's length in steps = sum(chord.bars) x stepsPerBar. */
export function loopLengthSteps(chords: readonly StructuralChord[], stepsPerBar: number): number {
  return loopBars(chords) * stepsPerBar;
}

/**
 * A loop's pass length in steps, repeats not included: the raw
 * `loopLengthSteps` floored at one bar, so a chordless loop (chord lengths sum
 * to zero) still occupies one silent bar. The `max(..., stepsPerBar)` floor is
 * what keeps `step % totalSteps === 0` reachable at all. ONE expression of the
 * floor rule, shared by `loopDwellSteps`, `songAdvanceDecision` and the offline
 * renderer's `planArrangement`, so the file's length and the live arrangement
 * cannot disagree.
 */
export function loopEffectiveLengthSteps(
  chords: readonly StructuralChord[],
  stepsPerBar: number,
): number {
  return Math.max(loopLengthSteps(chords, stepsPerBar), stepsPerBar);
}

/**
 * How many steps the arrangement spends on `loop`, repeats included.
 *
 * The obvious form — `loopLengthSteps x repeatCount` — is WRONG for a chordless
 * loop: its `loopLengthSteps` is 0, so the naive version schedules nothing
 * where the app dwells one silent bar. `loopEffectiveLengthSteps` floors it at
 * one bar first.
 */
export function loopDwellSteps(loop: StructuralLoop, stepsPerBar: number): number {
  return loopEffectiveLengthSteps(loop.chords, stepsPerBar) * Math.max(1, loop.repeatCount ?? 1);
}

/**
 * What the arrangement does at this clock step.
 *
 * Three answers, not two, and the third is why this is a union: `hold` is
 * "not a transition boundary" — every non-boundary step, loop mode, an
 * out-of-range cursor — while `end` is "the song is over". The old
 * `string | null` return spelled both of them `null`, so the caller could not
 * stop on one and do nothing on the other, and the arrangement could only
 * ever wrap.
 */
export type SongAdvance =
  | { kind: 'hold' }
  | { kind: 'advance'; loopId: string }
  | { kind: 'end' };

/** Nothing happens on this step. */
export const SONG_HOLD: SongAdvance = Object.freeze({ kind: 'hold' });

/** The last loop's last repeat just completed: the song is over. */
export const SONG_END: SongAdvance = Object.freeze({ kind: 'end' });

/**
 * The decision for one clock step. `step` is measured from the shared clock's
 * reset origin — every advance re-anchors the grid at the boundary, so each
 * loop's boundary is `loopDwellSteps` steps from 0 (the same alignment the
 * Instant Vibe swap relies on).
 *
 * The last slot ENDS the song; it does not wrap. A single-loop arrangement is
 * no exception. The exception that used to be here — "reloading the loop we
 * are already in would hard-stop the players and reset the shared clock on
 * every pass" — was answering a question this no longer asks: ending reloads
 * nothing. The user-facing reason is a separation of duties: auditioning
 * a loop card already means "loop one thing forever"; song mode means a piece
 * with an ending, and one arrangement size must not silently switch which of
 * the two the Play button does.
 */
export function songAdvanceDecision(
  loops: readonly StructuralLoop[],
  songLoopIndex: number | null,
  step: number,
  stepsPerBar: number,
): SongAdvance {
  if (songLoopIndex === null) return SONG_HOLD;
  const loop = loops[songLoopIndex];
  if (!loop) return SONG_HOLD;
  const totalSteps = loopDwellSteps(loop, stepsPerBar);
  if (step <= 0 || step % totalSteps !== 0) return SONG_HOLD;
  const next = loops[songLoopIndex + 1];
  return next ? { kind: 'advance', loopId: next.id } : SONG_END;
}
