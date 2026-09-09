import type { MeterZone } from './meterZones';

/**
 * The zone → theme-token map, and the ONLY place a meter's colour is decided.
 *
 * It is a whole module for one switch because of what it replaced. This file was `vuMeter.ts`
 * and carried the segment quantisation for a ten-block bar — `vuSegment`, `isSegmentActive`,
 * `segmentTone` — which had a recorded artefact: `segmentTone` coloured a segment by where its
 * TOP edge sat, `vuSegment` lit segments by `Math.round`, the two were written in separate
 * tasks, and between about -1.0 and -0.43 dBFS they disagreed — the top lit segment painted
 * `hot` while `classifyZone` at the same reading already said `over`. The note pinning that
 * artefact left the call to DEV-389. DEV-389's answer is this file: a continuous fill takes its
 * colour from `classifyZone(peakDbfs)` directly, so there is no second derivation left to
 * disagree with the first, and the artefact is gone rather than fixed.
 *
 * Never paint a meter fill as a gradient. A gradient rescales with the element it is painted on
 * and so always reaches its own last stop — murva shipped that and it put a red tip on the bar
 * at every level, silence included.
 */
export function zoneFillClass(zone: MeterZone): string {
  switch (zone) {
    case 'over':
      return 'bg-error';
    case 'hot':
      return 'bg-warning';
    case 'good':
      return 'bg-success';
    // Deliberately not green. While this was a segment bar `tooQuiet` shared the success token,
    // because a segment count already said "low" and a fourth colour would have said it twice.
    // A continuous fill says nothing of the kind — a short green bar reads as "fine, quiet" —
    // so the zone that means "nothing is really coming through here" gets a neutral of its own.
    // It is the reading that answers "is this loud enough?", which is half of what the mixer's
    // meters are for.
    case 'tooQuiet':
      return 'bg-base-content/30';
  }
}
