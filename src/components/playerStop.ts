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

/**
 * Arms `arming` (mutating it) on the first bar line seen, so a stepper always
 * enters on beat 1. Returns whether the caller is armed — and may proceed —
 * after this call; once armed, stays armed until the caller resets it.
 */
export function armOnBarLine(
  arming: { armed: boolean },
  step: number,
  stepsPerBar: number,
): boolean {
  if (arming.armed) return true;
  if (step % stepsPerBar !== 0) return false;
  arming.armed = true;
  return true;
}
