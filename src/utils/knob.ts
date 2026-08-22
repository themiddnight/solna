/**
 * Pure math helpers for the Knob component.
 * Everything is expressed in "t" space: t ∈ [0, 1] maps linearly onto the
 * knob sweep (0 = min at 7:30, 1 = max at 4:30, 0.5 = 12 o'clock).
 */

export type KnobScale = 'linear' | 'log';
export type KnobSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type KnobIndicator = 'progress' | 'none' | 'full';

/** Needle angle (degrees) when t = 0 → the 7:30 position. */
export const MIN_ANGLE_DEG = -135;
/** Full rotation sweep in degrees (7:30 → 4:30 through 12 o'clock). */
export const SWEEP_DEG = 270;
/** Pointer drag distance (px) that covers the full range. */
export const DRAG_RANGE_PX = 200;
/** Shift+drag divides drag sensitivity by this factor (fine control). */
export const FINE_DRAG_DIVISOR = 10;
/** Accumulated |delta| (px) before the drag axis is committed (anti-jitter). */
export const AXIS_PICK_THRESHOLD_PX = 3;
/** Progress arc length at t=1 on a pathLength=100 circle: 270/360 × 100. */
export const PROGRESS_ARC_UNITS = 75;
/** Pixel footprint per size, from the Figma design. */
export const SIZE_PX: Record<KnobSize, number> = {
  xs: 22,
  sm: 36,
  md: 48,
  lg: 60,
  xl: 72,
};

/**
 * Clamps value into [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Quantizes value to the nearest multiple of step, measured from min.
 * No-op when step is undefined, 0, or negative.
 */
export function snapToStep(value: number, min: number, step?: number): number {
  if (!step || step <= 0) return value;
  return min + Math.round((value - min) / step) * step;
}

/**
 * Maps a value in [min, max] to t ∈ [0, 1].
 * log: t = ln(value/min) / ln(max/min); falls back to linear when min <= 0.
 */
export function valueToT(
  value: number,
  min: number,
  max: number,
  scale: KnobScale,
): number {
  if (max <= min) return 0;
  const v = clamp(value, min, max);
  if (scale === 'log' && min > 0) {
    return Math.log(v / min) / Math.log(max / min);
  }
  return (v - min) / (max - min);
}

/**
 * Maps t ∈ [0, 1] back to a value in [min, max].
 * log: value = min · (max/min)^t; falls back to linear when min <= 0.
 */
export function tToValue(
  t: number,
  min: number,
  max: number,
  scale: KnobScale,
): number {
  const tt = clamp(t, 0, 1);
  if (scale === 'log' && min > 0) {
    return min * Math.pow(max / min, tt);
  }
  return min + tt * (max - min);
}

/**
 * Needle rotation angle (degrees) for t: MIN_ANGLE_DEG + t · SWEEP_DEG.
 * t=0 → −135° (7:30), t=0.5 → 0° (12 o'clock), t=1 → +135° (4:30).
 */
export function angleForT(t: number): number {
  return MIN_ANGLE_DEG + t * SWEEP_DEG;
}

/**
 * Needle angle (degrees) of a detent value — i.e. angleForT(valueToT(...)) —
 * or null when the detent lies outside [min, max] (no tick drawn).
 * Visual only: this never snaps values.
 */
export function detentAngle(
  detent: number,
  min: number,
  max: number,
  scale: KnobScale,
): number | null {
  if (detent < min || detent > max) return null;
  return angleForT(valueToT(detent, min, max, scale));
}

/**
 * Progress arc length in pathLength=100 units for t (0 → 0, 1 → 75).
 * Shares t with angleForT, so the arc tip always points at the needle.
 */
export function progressDash(t: number): number {
  return t * PROGRESS_ARC_UNITS;
}

/**
 * t-space delta for a pointer drag: deltaPx / DRAG_RANGE_PX, further divided
 * by FINE_DRAG_DIVISOR when fine (Shift held).
 */
export function dragDeltaT(deltaPx: number, fine: boolean): number {
  const base = deltaPx / DRAG_RANGE_PX;
  return fine ? base / FINE_DRAG_DIVISOR : base;
}

export type KeyDir = 'inc' | 'dec' | 'page-inc' | 'page-dec' | 'min' | 'max';

/**
 * Next value for keyboard navigation.
 * inc/dec: ±1 step (continuous → 1% of range); page: ±10 steps (or 10% of
 * range when continuous); min/max: the bounds exactly. Stepped results are
 * snapped to the min-anchored grid, then clamped to [min, max].
 */
export function nextKeyValue(
  value: number,
  min: number,
  max: number,
  step: number | undefined,
  dir: KeyDir,
): number {
  const hasStep = typeof step === 'number' && step > 0;
  const singleStep = hasStep ? (step as number) : (max - min) * 0.01;
  const pageStep = hasStep ? (step as number) * 10 : (max - min) * 0.1;
  let next = value;
  switch (dir) {
    case 'inc':
      next = value + singleStep;
      break;
    case 'dec':
      next = value - singleStep;
      break;
    case 'page-inc':
      next = value + pageStep;
      break;
    case 'page-dec':
      next = value - pageStep;
      break;
    case 'min':
      return min;
    case 'max':
      return max;
  }
  return clamp(snapToStep(next, min, step), min, max);
}
