import type { PlayerState } from '../store/types';

/**
 * Stop-timing policy shared by the Beat and Chords playback hooks. Kept as
 * pure functions (not hook internals) so the transitions can be tested
 * without a DOM — the repo has no testing-library setup.
 */

/**
 * True when a player just became fully stopped and no soft stop is already
 * in flight. The soft path also ends on 'stopped', so `softStopPending`
 * exists to stop the hard-stop effect from clipping the tail the soft stop
 * deliberately left ringing.
 */
export function shouldHardStopNow(
  prev: PlayerState,
  next: PlayerState,
  softStopPending: boolean,
): boolean {
  return next === 'stopped' && prev !== 'stopped' && !softStopPending;
}

/**
 * True on the clock step where a soft-stopping player should actually stop:
 * the next bar line on the shared grid.
 */
export function isSoftStopBoundary(
  state: PlayerState,
  step: number,
  stepsPerBar: number,
): boolean {
  return state === 'stopping' && step % stepsPerBar === 0;
}
