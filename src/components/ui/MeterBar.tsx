/**
 * PROVISIONAL PRESENTATION — DEV-389 replaces this component.
 *
 * Its only job here is to prove the dBFS path draws: that a reading taken from an analyser
 * reaches the screen, lands on the piecewise scale, and changes colour at the zone boundaries.
 * It is a ten-segment bar because that is what `VuMeter` already was, NOT because a ten-segment
 * bar is the considered design — nothing about its size, spacing, orientation, hold marker or
 * label has been designed. Do not copy it into a new surface and do not treat its markup as a
 * contract; DEV-389 ("Design and place the meter and fader UI on the dBFS wiring") settles the
 * visual design once, for every place a meter appears.
 *
 * ONE property must survive that redesign, because it is correctness rather than taste: the fill
 * colour is chosen ONCE from a zone classification — here, per fixed segment index via
 * `zoneFillClass(segmentTone(i))`; for a continuous fill, from the current peak's zone — and is
 * NEVER painted as a gradient across the fill element. murva shipped the gradient version and it
 * put a red tip on the bar at every level, including silence, because a gradient rescales with
 * the element it is painted on and so always reaches its own last stop.
 */
import React from "react";
import {
  isSegmentActive,
  segmentTone,
  VU_SEGMENT_COUNT,
  vuSegment,
  zoneFillClass,
} from "@/utils/vuMeter";
import { dbfsToPercent } from "@/utils/meterScale";

/**
 * Index -> className, resolved ONCE at module scope. `segmentTone(i)` is two `dbfsToPercent`
 * calls on a compile-time-constant argument and `zoneFillClass` a switch over its result, so a
 * segment's class is a pure function of its index and can never change at runtime — while this
 * bar re-renders up to 60 times a second during playback, which made it 60 rebuilds a second of
 * an array whose contents were identical every time.
 *
 * This is a cache of the derivation, not a second copy of it: `zoneFillClass(segmentTone(i))` is
 * still the only place a segment's colour is decided (see `vuMeter.ts`), and nothing here may
 * grow a literal colour or a second ternary.
 */
const SEGMENT_BASE_CLASS = "flex-1 rounded-xs transition-colors duration-75";
const SEGMENT_INACTIVE_CLASS = `${SEGMENT_BASE_CLASS} bg-base-300/50`;
const SEGMENT_ACTIVE_CLASSES: readonly string[] = Object.freeze(
  Array.from(
    { length: VU_SEGMENT_COUNT },
    (_, i) => `${SEGMENT_BASE_CLASS} ${zoneFillClass(segmentTone(i))}`,
  ),
);

export interface MeterBarProps {
  /** Live peak, dBFS. `-Infinity` is silence. */
  peakDbfs: number;
  /** Decaying peak-hold marker, dBFS. Drawn only when it sits above the live peak. */
  heldPeakDbfs?: number;
  /** Extra classes for the outer element; the caller owns its width. */
  className?: string;
  title?: string;
}

/**
 * The segment bar itself. Purely presentational: it holds no timer, reads no analyser and takes
 * its numbers as props, which is what lets it be asserted with `renderToString`. See the
 * PROVISIONAL note at the top of the file before changing anything about how it looks.
 */
export const MeterBar = React.memo(function MeterBar({
  peakDbfs,
  heldPeakDbfs,
  className = "",
  title,
}: MeterBarProps) {
  const segment = vuSegment(peakDbfs);
  const showHold =
    heldPeakDbfs !== undefined && Number.isFinite(heldPeakDbfs) && heldPeakDbfs > peakDbfs;
  const holdPercent = showHold ? dbfsToPercent(heldPeakDbfs) : 0;

  return (
    <div className={`relative h-2 bg-base-300 rounded-xs overflow-hidden flex gap-0.5 p-0.5 ${className}`} title={title}>
      {SEGMENT_ACTIVE_CLASSES.map((activeClass, i) => (
        <div
          key={i}
          className={isSegmentActive(segment, i) ? activeClass : SEGMENT_INACTIVE_CLASS}
        />
      ))}
      {showHold && (
        <span
          data-meter-hold
          className="absolute top-0 bottom-0 w-px bg-base-content/70"
          style={{ left: `${holdPercent}%` }}
        />
      )}
    </div>
  );
});
