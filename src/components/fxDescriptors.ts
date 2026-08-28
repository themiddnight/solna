/**
 * Plain-language readings for the master-rack knobs, kept out of
 * EffectsRackView so they can be tested without rendering React — the same
 * pattern as sequencerGrid.ts and meterSelect.ts.
 *
 * Only parameters whose number does not say what the user will hear get one.
 * Mix percentages and EQ gains in dB already read plainly and deliberately
 * have no descriptor; adding one there would be noise, not consistency.
 */

/** Reverb decay, 0.5s - 6.0s. */
export function reverbDecayDescriptor(seconds: number): string {
  if (seconds < 1.5) return 'Room';
  if (seconds < 3.5) return 'Hall';
  return 'Cathedral';
}

/** Delay feedback, 0 - 1. */
export function delayFeedbackDescriptor(amount: number): string {
  if (amount < 0.25) return 'Slapback';
  if (amount < 0.65) return 'Echo';
  return 'Runaway';
}

/** Distortion drive, 0 - 1. */
export function distortionDriveDescriptor(amount: number): string {
  if (amount < 0.3) return 'Warm';
  if (amount < 0.65) return 'Crunch';
  return 'Fuzz';
}
