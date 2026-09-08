import { dbfsToPercent } from './meterScale';
import { ZONE_GOOD_MAX, ZONE_HOT_MAX, type MeterZone } from './meterZones';

/**
 * Pure quantisation for the segment meters, kept out of the components so it can be tested
 * without rendering React — this repo has no DOM setup.
 *
 * Everything here is keyed in dBFS. It used to take a 0..1 "level" (a spectrum average) and
 * multiply by ten, so no segment corresponded to any dB and the red segments were a guess.
 */

/** Number of discrete segments a meter draws. */
export const VU_SEGMENT_COUNT = 10;

/**
 * Quantise a dBFS reading to a lit-segment count in 0..VU_SEGMENT_COUNT, through the piecewise
 * scale — so the segments are spaced the way the fill is, and the two can never disagree.
 * NaN reads as silence rather than propagating through Math.round/min/max.
 */
export function vuSegment(dbfs: number): number {
  if (Number.isNaN(dbfs)) return 0;
  const segments = (dbfsToPercent(dbfs) / 100) * VU_SEGMENT_COUNT;
  return Math.max(0, Math.min(VU_SEGMENT_COUNT, Math.round(segments)));
}

/** Whether the 0-based segment at `index` is lit when `segment` are lit. */
export function isSegmentActive(segment: number, index: number): boolean {
  return segment > index;
}

/**
 * The tone a given segment carries, derived from the zone boundaries through the same scale the
 * fill uses rather than from hand-picked indices. A segment is coloured by where its TOP edge
 * sits: index 7's top edge is 80% of the track, `ZONE_GOOD_MAX` (-6 dBFS) is 72%, and
 * `ZONE_HOT_MAX` (-1 dBFS) is 83.7%, so 7 is hot and 8-9 are over.
 *
 * `tooQuiet` gets no tone of its own: a meter reading low is not an error state to colour, it is
 * just a short bar, and giving it a fourth colour would say otherwise.
 *
 * KNOWN ARTEFACT: this top-edge rule and `vuSegment`'s `Math.round` quantisation were written in
 * separate tasks and disagree by half a segment near the hot/over knee. A reading between about
 * -1.0 and -0.43 dBFS rounds to 8 lit segments (index 7 on top), and topPercent(7) = 80% sits
 * below `dbfsToPercent(ZONE_HOT_MAX)` (~83.7%), so that segment paints `hot` even though
 * `classifyZone` at the same reading already returns `'over'`. Pinned, not fixed, in
 * `vuMeter.test.ts`; `Math.round` is not to be swapped for `Math.ceil` to close the gap here —
 * DEV-389 replaces this provisional bar and owns that call.
 */
export function segmentTone(index: number): 'good' | 'hot' | 'over' {
  const topPercent = ((index + 1) / VU_SEGMENT_COUNT) * 100;
  if (topPercent > dbfsToPercent(ZONE_HOT_MAX)) return 'over';
  if (topPercent > dbfsToPercent(ZONE_GOOD_MAX)) return 'hot';
  return 'good';
}

/**
 * Theme token per zone, so a colour is never written as a literal. `tooQuiet` and `good` share
 * the success token for the reason in `segmentTone`. `segmentTone`'s three results are all
 * `MeterZone` members, so `zoneFillClass(segmentTone(i))` is the only place a segment's colour
 * is decided — there is no second ternary anywhere to drift out of step with it.
 */
export function zoneFillClass(zone: MeterZone): string {
  switch (zone) {
    case 'over':
      return 'bg-error';
    case 'hot':
      return 'bg-warning';
    default:
      return 'bg-success';
  }
}
