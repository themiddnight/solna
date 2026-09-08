/**
 * KEEP IN SYNC WITH MURVA — see murva `src/shared/audio/meterZones.ts`.
 *
 * A copy, by decision (DEV-388); `src/utils/gainContract.test.ts` pins these
 * three boundaries as literal numbers and pins `classifyZone`'s exclusive-at-
 * the-top behaviour. Moving a boundary must be a change a human approves in
 * both repos, not one that lands green on this side alone.
 */

/**
 * The four bands a meter reading falls into. Ported verbatim from murva's
 * `src/shared/audio/meterZones.ts` — these boundaries are an interop contract with that repo
 * (DEV-383 "The numbers"), so they are copied, never re-argued here.
 *
 * Every boundary is INCLUSIVE UPWARD: -24 is already `good`, -6 is already `hot`, -1 is already
 * `over`. Written as a descending ladder of `<` tests so there is exactly one place each edge
 * can sit.
 */
export type MeterZone = 'tooQuiet' | 'good' | 'hot' | 'over';

export const ZONE_TOO_QUIET_MAX = -24;
export const ZONE_GOOD_MAX = -6;
export const ZONE_HOT_MAX = -1;

export function classifyZone(peakDbfs: number): MeterZone {
  if (peakDbfs < ZONE_TOO_QUIET_MAX) return 'tooQuiet';
  if (peakDbfs < ZONE_GOOD_MAX) return 'good';
  if (peakDbfs < ZONE_HOT_MAX) return 'hot';
  return 'over';
}
