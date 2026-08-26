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

/** The lower floor used for a full release — quieter than ENV_FLOOR by 20 dB. */
export const SILENCE = 0.00001;

/** BiquadFilter cutoff bounds: below 20 Hz or above 20 kHz is inaudible and
 *  an exponential ramp through 0 is illegal. */
export function clampCutoff(hz: number): number {
  return Math.min(20000, Math.max(20, hz));
}

/** Velocity is a 0..1 scalar; a caller passing 3 would blow past the limiter. */
export function clampVelocity(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VELOCITY;
  return Math.min(1, Math.max(0, v));
}
