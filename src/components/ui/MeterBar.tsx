import React from "react";
import { zoneFillClass } from "@/utils/meterColor";
import { classifyZone } from "@/utils/meterZones";
import { dbfsToPercent, METER_TICK_DBFS } from "@/utils/meterScale";

/**
 * The dBFS level bar: a continuous fill on the piecewise scale, with the zone ticks drawn on it.
 *
 * Every surface that shows a level renders THIS component — the transport's master meter
 * (`VuMeter`) and the Sound mixer's five per-layer meters (`SourceMeter`) — so the look is one
 * file, not one per surface. It is purely presentational: no timer, no analyser, numbers in as
 * props, which is what lets it be asserted with `renderToString` in a repo with no DOM.
 *
 * **Four layers, in paint order, and the order is the design.** The peak fill is painted first
 * and FAINT, the RMS fill solid on top of it, so the bar reads as one shape: a solid body out to
 * the RMS with a translucent overhang to the peak. The order is forced, not stylistic — RMS is a
 * power average of the same window whose max is the peak, so `rmsPercent <= peakPercent` always,
 * and the shorter fill can only be seen if it is the opaque one on top. (Painting the RMS faint
 * over a solid peak composites 0.4*C over opaque C, which is C: one flat bar, RMS discarded.)
 * The ticks are drawn OVER both, because a scale a loud reading can cover is not a scale; the
 * peak-hold marker is last, because it is the thing you look for when you missed the transient.
 *
 * **Two properties are correctness rather than taste, and must survive any restyling:**
 *
 * 1. The fill's colour is chosen ONCE, from `classifyZone(peakDbfs)`, and is NEVER a gradient. A
 *    gradient rescales with the element it is painted on and so always reaches its own last
 *    stop — murva shipped that and it put a red tip on the bar at every level, silence included.
 * 2. Every position — both fills, every tick, the hold marker — goes through `dbfsToPercent`.
 *    That is what makes the scale one fact: a tick and a fill at the same dB land on the same
 *    pixel, and cannot drift apart in a later edit.
 *
 * There are deliberately no tick LABELS. Five of these stack in one mixer column, where a label
 * row per meter is 60px of repeated axis for a reading you take at a glance; the ticks alone say
 * "you are past the middle mark" without asking anyone to read a number.
 */

/**
 * No CSS transition on either fill. A `duration-75` retargeted every 16-33ms
 * by the meter scheduler never reaches its target — it is restarted 30-60 times
 * a second on every live bar — so it bought a frame of lag rather than
 * smoothing. That lag is redundant for the RMS fill, which is already a 300ms
 * power average in `useMeterLevel`, and actively wrong for the peak fill: a
 * peak meter exists to show the transient, and an interpolation is precisely
 * what stops it from getting there. Smoothing belongs in `rmsWindowMs`, where
 * the averaging already lives.
 *
 * Tick positions, resolved ONCE at module scope. `dbfsToPercent` over a frozen table is a pure
 * function of nothing, while this bar re-renders up to 60 times a second during playback — which
 * made it 60 recomputations a second of an array that is identical every time.
 */
const TICK_PERCENTS: readonly number[] = Object.freeze(METER_TICK_DBFS.map(dbfsToPercent));

export interface MeterBarProps {
  /** Live peak, dBFS. `-Infinity` is silence. Sets the fill length AND the colour of both fills. */
  peakDbfs: number;
  /** Rolling-window RMS, dBFS. Drawn as the solid fill over the peak's translucent one. */
  rmsDbfs: number;
  /** Decaying peak-hold marker, dBFS. Drawn only when it sits above the live peak. */
  heldPeakDbfs?: number;
  /** Extra classes for the outer element; the caller owns its width. */
  className?: string;
  title?: string;
}

export const MeterBar = React.memo(function MeterBar({
  peakDbfs,
  rmsDbfs,
  heldPeakDbfs,
  className = "",
  title,
}: MeterBarProps) {
  // ONE classification for the whole bar. Both fills wear it, so the quiet layer can never
  // report a different zone from the loud one.
  const fillClass = zoneFillClass(classifyZone(peakDbfs));
  const peakPercent = dbfsToPercent(peakDbfs);
  const rmsPercent = dbfsToPercent(rmsDbfs);
  const showHold =
    heldPeakDbfs !== undefined && Number.isFinite(heldPeakDbfs) && heldPeakDbfs > peakDbfs;

  return (
    <div
      className={`relative h-1.5 bg-base-300 rounded-full overflow-hidden ${className}`}
      title={title}
    >
      {/* The PEAK fill is the faint one, and it is painted FIRST — it is the longer of the two,
          so it has to be the layer the solid RMS fill is drawn over. Painting the shorter fill
          faint on top of the longer solid one composites 0.4*C over opaque C, which is exactly
          C: the arrangement that shipped drew a single flat bar and threw the RMS reading away. */}
      <div
        data-meter-peak-fill
        className={`absolute inset-y-0 left-0 opacity-40 ${fillClass}`}
        style={{ width: `${peakPercent}%` }}
      />
      <div
        data-meter-rms-fill
        className={`absolute inset-y-0 left-0 ${fillClass}`}
        style={{ width: `${rmsPercent}%` }}
      />
      {/* Painted in the surface colour, so a tick reads as a cut through the fill on one side and
          a seam in the empty track on the other — one element doing both jobs. `-translate-x-1/2`
          centres the line on its position; without it the 0 dBFS tick would start at its percent
          and lean right, which at 100% would put it outside the overflow-hidden box entirely. */}
      {TICK_PERCENTS.map((percent) => (
        <span
          key={percent}
          data-meter-tick
          className="absolute inset-y-0 w-px bg-base-100/80 -translate-x-1/2"
          style={{ left: `${percent}%` }}
        />
      ))}
      {showHold && (
        <span
          data-meter-hold
          className="absolute inset-y-0 w-px bg-base-content/90 -translate-x-1/2"
          style={{ left: `${dbfsToPercent(heldPeakDbfs)}%` }}
        />
      )}
    </div>
  );
});
