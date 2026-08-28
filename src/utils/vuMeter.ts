/**
 * Pure quantization for the transport VU meter, kept out of the component so
 * it can be tested without rendering React — this repo has no DOM setup and
 * every component's testable logic is exported like this.
 */

/** Number of discrete segments the transport meter draws. */
export const VU_SEGMENT_COUNT = 10;

/**
 * Quantize a 0..1 audio level to a lit-segment count in 0..VU_SEGMENT_COUNT.
 * Out-of-range input clamps to the ends; NaN reads as silence rather than
 * propagating through Math.round/min/max (all of which pass NaN through).
 */
export function vuSegment(level: number): number {
  if (Number.isNaN(level)) return 0;
  return Math.max(0, Math.min(VU_SEGMENT_COUNT, Math.round(level * VU_SEGMENT_COUNT)));
}

/** Whether the 0-based segment at `index` is lit when `segment` are lit. */
export function isSegmentActive(segment: number, index: number): boolean {
  return segment > index;
}
