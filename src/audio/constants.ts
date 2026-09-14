/**
 * Audio-domain scalars shared across the engine and the playback layer.
 * Imports nothing — this file must stay a leaf so audio/, store/ and the
 * invariant scripts can all pull from it.
 */

/** The velocity the engine assumes when a caller does not name one. */
export const DEFAULT_VELOCITY = 0.8;

/**
 * The floor every exponential envelope ramp aims for. exponentialRampToValueAtTime
 * cannot reach 0, so a floor is mandatory; one shared value keeps voices from
 * ending 20 dB apart purely because a call site typed an extra zero.
 */
export const ENV_FLOOR = 0.0001;

/** Velocity is a 0..1 scalar; a caller passing 3 clips at `ctx.destination`. The
 *  master limiter (default ON since DEV-383) only catches the summed mix near
 *  full scale — it does not validate one voice's velocity multiplier, so this
 *  clamp is still the only guard against an out-of-range value there is. */
export function clampVelocity(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VELOCITY;
  return Math.min(1, Math.max(0, v));
}
