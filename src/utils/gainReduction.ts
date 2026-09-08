/**
 * Display maths for a master dynamics stage's gain reduction.
 *
 * `DynamicsCompressorNode.reduction` is a NEGATIVE number of dB: 0 means the
 * stage is passing the signal untouched, -6 means six dB of squash. These
 * helpers are pure — no imports, no globals — so the readout can be tested
 * without a DOM, the same shape as utils/vuMeter.ts.
 */

/** Full scale of the reduction bar, in dB. Past this the bar simply pins. */
export const REDUCTION_METER_FLOOR_DB = -12;

/**
 * Quantisation step, in dB. The readout re-renders only when the reading
 * crosses one — the same discipline VuMeter's segment count follows, and the
 * reason a per-frame value can drive React state at all.
 */
export const REDUCTION_STEP_DB = 0.5;

/**
 * Snaps a raw reading onto the step, rounding AWAY from zero so the readout
 * never under-reports how hard the stage is working. A positive or non-finite
 * reading — a broken node, or no node at all — becomes 0.
 */
export function quantiseReduction(reductionDb: number): number {
  if (!Number.isFinite(reductionDb) || reductionDb >= 0) return 0;
  return Math.floor(reductionDb / REDUCTION_STEP_DB) * REDUCTION_STEP_DB;
}

/** `0` -> `'0.0 dB'`, `-4.3` -> `'-4.5 dB'`. */
export function formatReduction(reductionDb: number): string {
  return `${quantiseReduction(reductionDb).toFixed(1)} dB`;
}

/** 0..100 percent of the bar, pinned at REDUCTION_METER_FLOOR_DB. */
export function reductionPercent(reductionDb: number): number {
  const pct = (quantiseReduction(reductionDb) / REDUCTION_METER_FLOOR_DB) * 100;
  return Math.max(0, Math.min(100, pct));
}
