/**
 * KEEP IN SYNC WITH MURVA — see murva `src/shared/audio/meterScale.ts`.
 *
 * A copy, by decision (DEV-388). The interior breakpoints are module-private,
 * so `src/utils/gainContract.test.ts` pins the SHAPE through `dbfsToPercent` at
 * -60/-48/-24/0/+6 and at three midpoints — a segment can be reshaped without
 * any exported constant changing, and that is the drift this file is most
 * exposed to.
 */
import { DISPLAY_FLOOR_DBFS } from './gainUnits';
import { ZONE_GOOD_MAX, ZONE_TOO_QUIET_MAX } from './meterZones';

/**
 * The meter's display scale, ported from murva's `src/shared/audio/meterScale.ts`. Three linear
 * segments, not one:
 *
 *   -inf .. -48 dBFS  ->   0 -  5% of the track
 *   -48  .. -24       ->   5 - 30%
 *   -24  ..  +6       ->  30 - 100%
 *
 * A single linear -60..0 mapping spends 60% of the track on a zone with no decision in it, puts
 * 0 dBFS exactly on the bar's edge (indistinguishable from the bar simply ending), and squeezes
 * the whole `over` zone into 1.7%. Professional meters are piecewise for this reason — IEC
 * 60268-18 specifies a piecewise digital PPM scale — and the principle is always the same:
 * resolution where decisions are made, compression where nothing is actionable.
 */

// Module-private: nothing outside needs the interior breakpoints, and exporting them would
// leave two exports nothing imports.
const METER_SCALE_KNEE_DBFS = ZONE_TOO_QUIET_MAX; // -24
const METER_SCALE_FLOOR_DBFS = -48;

export const METER_SCALE_CEILING_DBFS = 6;

const FLOOR_PERCENT = 5;
const KNEE_PERCENT = 30;

/**
 * The ticks a scale draws. Two of the three are IMPORTED from `meterZones.ts` rather than
 * re-typed, so if `classifyZone`'s boundaries ever move these ticks move with them instead of
 * going stale. The third, `0`, is not a zone boundary at all (the hot->over edge is
 * `ZONE_HOT_MAX` = -1); it marks the digital ceiling, a landmark a meter always wants shown.
 * `ZONE_HOT_MAX` itself is deliberately absent: it sits 1.7% from 0 and the two lines collide.
 */
export const METER_TICK_DBFS: readonly number[] = [ZONE_TOO_QUIET_MAX, ZONE_GOOD_MAX, 0];

/** Maps `from`..`to` onto `fromPercent`..`toPercent`, linearly. */
function interpolate(
  value: number,
  from: number,
  to: number,
  fromPercent: number,
  toPercent: number,
): number {
  return fromPercent + ((value - from) / (to - from)) * (toPercent - fromPercent);
}

/**
 * The single source of truth for turning a dBFS reading into a position along the track. Fills,
 * ticks, markers and the transport meter's segment quantisation all go through here, so they
 * can never disagree about where a given dB value sits.
 */
export function dbfsToPercent(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return dbfs > 0 ? 100 : 0;
  if (dbfs <= DISPLAY_FLOOR_DBFS) return 0;
  if (dbfs >= METER_SCALE_CEILING_DBFS) return 100;

  if (dbfs <= METER_SCALE_FLOOR_DBFS) {
    return interpolate(dbfs, DISPLAY_FLOOR_DBFS, METER_SCALE_FLOOR_DBFS, 0, FLOOR_PERCENT);
  }
  if (dbfs <= METER_SCALE_KNEE_DBFS) {
    return interpolate(
      dbfs,
      METER_SCALE_FLOOR_DBFS,
      METER_SCALE_KNEE_DBFS,
      FLOOR_PERCENT,
      KNEE_PERCENT,
    );
  }
  return interpolate(dbfs, METER_SCALE_KNEE_DBFS, METER_SCALE_CEILING_DBFS, KNEE_PERCENT, 100);
}
