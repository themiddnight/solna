import type { CSSProperties } from "react";
import { classifyZone } from "@/shared/audio/meterZones";
import {
  dbfsToPercent,
  METER_TICK_DBFS,
  METER_SCALE_ENDPOINT_DBFS,
} from "@/shared/audio/meterScale";
import { meterColorForZone } from "./meterColor";
import type { MeterLevel } from "@/features/audio/hooks/useMeterLevel";

type Orientation = "horizontal" | "vertical";
type Thickness = "sm" | "md" | "lg";
type ScaleDetail = "none" | "minimal" | "medium" | "full";

export interface MeterProps {
  /** 1 entry = mono (one bar), 2+ = multi-channel (one bar per entry). Callers own channel splitting. */
  levels: MeterLevel[];
  orientation?: Orientation;
  /** Fixed dimension of every bar in the meter: height when horizontal, width when vertical. Default "md". */
  thickness?: Thickness;
  /** The faint average-loudness layer (the RMS fill). Default true -- off for peak-only displays
   * like a limiter's gain-reduction meter, where an RMS layer has no meaningful reading. */
  showRms?: boolean;
  /** Thin marker line tracking `heldPeakDbfs`. Default false. */
  showPeakHold?: boolean;
  /** Tick-mark detail on the dB scale. Ticks are drawn *inside* every bar (as the Figma design
   * has them), so "minimal" and "medium" cost no extra layout at all. "minimal" shows only the
   * 0 dBFS tick; "medium" shows the fixed tick set -- the zone boundaries from `meterZones.ts`,
   * including the former -6 dBFS target line; "full" adds a label row beneath the bars, carrying
   * one label per tick plus the two scale endpoints. Default "medium". */
  scaleDetail?: ScaleDetail;
}

/** Plain numeric tick label (e.g. "-12", "0", "+6") -- mirrors `GainControl`'s tick convention,
 * not `formatDb`'s "+6.0dB" readout, since these sit in a compact scale, not a value display. */
function formatTickLabel(dbfs: number): string {
  if (dbfs === -Infinity) return "-∞";
  const rounded = Math.round(dbfs);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/**
 * dBFS values to draw a tick at. `"minimal"` is the 0 dBFS tick alone; `"medium"` and `"full"`
 * both draw the same three ticks -- the tick *set* is identical between them, only the
 * labelling (added by the renderer) differs.
 */
function scaleTicks(detail: ScaleDetail): readonly number[] {
  switch (detail) {
    case "none":
      return [];
    case "minimal":
      return [0];
    case "medium":
    case "full":
      return METER_TICK_DBFS;
  }
}

// "md" (6px) matches the previous hard-coded h-1.5 bar so the default look is unchanged.
const THICKNESS_PX: Record<Thickness, number> = {
  sm: 4,
  md: 6,
  lg: 10,
};

/**
 * Everything that differs between orientations lives here, as data, not as branches scattered
 * through JSX. `dbfsToPercent` stays orientation-independent -- only which CSS dimension (and
 * which anchor edge) a given percent drives changes.
 */
interface OrientationStyles {
  /** Stacking axis for multiple bars: horizontal bars stack in a column, vertical bars sit in a row. */
  barsContainerClassName: string;
  barClassName: string;
  /** The fixed (thickness) dimension of a single bar. */
  barSizeStyle: (thicknessPx: number) => CSSProperties;
  /** The percent-driven (level) dimension of a fill layer, anchored at the "zero level" edge. */
  fillStyle: (percent: number) => CSSProperties;
  /**
   * Anchors a thin line (or a label) at `percent` along the level axis. Shared by the peak-hold
   * marker, the in-bar scale ticks and the label row -- all four are "a thing at a percent
   * position" and differ only in what gets drawn there.
   */
  markerLineStyle: (percent: number) => CSSProperties;
  peakHoldLineClassName: string;
  /** A tick mark drawn across the full thickness of a bar, from inside it. Positioned via
   * `markerLineStyle`, same as the peak-hold line, and painted in the surface colour so it reads
   * as a cut through the fill on one side and a seam in the empty track on the other. */
  scaleTickLineClassName: string;
  /** The `full`-only label row/column. Carries no lines -- the ticks live in the bars -- so it is
   * sized purely by its 9px text. */
  scaleLabelRowClassName: string;
  scaleTickLabelClassName: string;
  /** Endpoint labels hug the ends of the scale -- centring them would push half of the
   *  100% label outside the container. */
  scaleEndpointStartClassName: string;
  scaleEndpointEndClassName: string;
}

const ORIENTATION_STYLES: Record<Orientation, OrientationStyles> = {
  horizontal: {
    barsContainerClassName: "relative flex flex-col gap-px w-full",
    barClassName: "relative w-full rounded-full bg-base-300 overflow-hidden",
    barSizeStyle: (px) => ({ height: `${px}px` }),
    fillStyle: (percent) => ({ position: "absolute", top: 0, bottom: 0, left: 0, width: `${percent}%` }),
    markerLineStyle: (percent) => ({ left: `${percent}%` }),
    // -translate-x-1/2 centers the line on its percent position (matches the tick treatment
    // below) so a 100%-positioned line sits visibly at the bar's edge instead of starting at
    // the edge and extending entirely outside the overflow-hidden bar.
    peakHoldLineClassName: "absolute inset-y-0 w-px bg-base-content/90 -translate-x-1/2",
    scaleTickLineClassName: "absolute inset-y-0 w-px bg-base-100/80 -translate-x-1/2",
    // h-3 (12px) fits 9px text with a hair of breathing room above it.
    scaleLabelRowClassName: "relative w-full h-3",
    scaleTickLabelClassName:
      "absolute top-0.5 -translate-x-1/2 text-[9px] leading-none text-base-content/50 tabular-nums",
    scaleEndpointStartClassName:
      "absolute top-0.5 left-0 text-[9px] leading-none text-base-content/50 tabular-nums",
    scaleEndpointEndClassName:
      "absolute top-0.5 right-0 text-[9px] leading-none text-base-content/50 tabular-nums",
  },
  vertical: {
    barsContainerClassName: "relative flex flex-row items-end gap-px h-full",
    barClassName: "relative h-full rounded-full bg-base-300 overflow-hidden",
    barSizeStyle: (px) => ({ width: `${px}px` }),
    fillStyle: (percent) => ({ position: "absolute", left: 0, right: 0, bottom: 0, height: `${percent}%` }),
    markerLineStyle: (percent) => ({ bottom: `${percent}%` }),
    // translate-y-1/2 centers the line on its percent position, same reasoning as the
    // horizontal -translate-x-1/2 above (matches the tick treatment below).
    peakHoldLineClassName: "absolute inset-x-0 h-px bg-base-content/90 translate-y-1/2",
    scaleTickLineClassName: "absolute inset-x-0 h-px bg-base-100/80 translate-y-1/2",
    // w-6 (24px) fits a 3-character label ("-24", "+6") at 9px.
    scaleLabelRowClassName: "relative h-full w-6",
    scaleTickLabelClassName:
      "absolute left-0.5 translate-y-1/2 text-[9px] leading-none text-base-content/50 tabular-nums",
    scaleEndpointStartClassName:
      "absolute left-0.5 bottom-0 text-[9px] leading-none text-base-content/50 tabular-nums",
    scaleEndpointEndClassName:
      "absolute left-0.5 top-0 text-[9px] leading-none text-base-content/50 tabular-nums",
  },
};

export function Meter({
  levels,
  orientation = "horizontal",
  thickness = "md",
  showRms = true,
  showPeakHold = false,
  scaleDetail = "medium",
}: MeterProps) {
  const styles = ORIENTATION_STYLES[orientation];
  const thicknessPx = THICKNESS_PX[thickness];
  const ticks = scaleTicks(scaleDetail);

  return (
    <div
      className={styles.barsContainerClassName}
      data-testid="meter-bars"
      data-bar-count={levels.length}
    >
      {levels.map((level, index) => {
        const zone = classifyZone(level.peakDbfs);
        const peakPercent = dbfsToPercent(level.peakDbfs);
        const rmsPercent = dbfsToPercent(level.rmsDbfs);
        const heldPeakPercent = dbfsToPercent(level.heldPeakDbfs);

        return (
          <div
            key={index}
            data-testid="meter-bar"
            className={styles.barClassName}
            style={styles.barSizeStyle(thicknessPx)}
            data-orientation={orientation}
            data-thickness={thickness}
          >
            <div
              data-testid="meter-fill"
              className="transition-all duration-75 ease-out"
              style={{ ...styles.fillStyle(peakPercent), backgroundColor: meterColorForZone(zone) }}
            />
            {showRms && (
              <div
                data-testid="meter-rms-fill"
                className="opacity-40"
                style={{ ...styles.fillStyle(rmsPercent), backgroundColor: meterColorForZone(zone) }}
              />
            )}
            {/* Ticks sit inside the bar, over the fill -- the design draws the scale *on* the
              * meter, not beside it. They come after the fills so the fill cannot cover them,
              * and before the peak-hold marker, which must stay the topmost line. */}
            {ticks.map((tickDbfs) => (
              <div
                key={tickDbfs}
                data-testid="meter-tick"
                data-dbfs={tickDbfs}
                className={styles.scaleTickLineClassName}
                style={styles.markerLineStyle(dbfsToPercent(tickDbfs))}
              />
            ))}
            {showPeakHold && level.heldPeakDbfs !== -Infinity && (
              <div
                data-testid="meter-peak-hold"
                className={styles.peakHoldLineClassName}
                style={styles.markerLineStyle(heldPeakPercent)}
              />
            )}
          </div>
        );
      })}
      {/* L and R (or any further channels) share one dB axis by definition -- the labels are not
       * per-channel, so the label row renders once here, after all the bars, not once per bar. */}
      {scaleDetail === "full" && (
        <div data-testid="meter-scale" className={styles.scaleLabelRowClassName}>
          {ticks.map((tickDbfs) => (
            <span
              key={tickDbfs}
              data-testid="meter-tick-label"
              data-dbfs={tickDbfs}
              className={styles.scaleTickLabelClassName}
              style={styles.markerLineStyle(dbfsToPercent(tickDbfs))}
            >
              {formatTickLabel(tickDbfs)}
            </span>
          ))}
          {/* Endpoints are labelled but never ticked -- a line at 0% or 100% only duplicates the
            * bar's own edge. */}
          <span
            data-testid="meter-scale-endpoint"
            data-dbfs={String(METER_SCALE_ENDPOINT_DBFS[0])}
            className={styles.scaleEndpointStartClassName}
          >
            {formatTickLabel(METER_SCALE_ENDPOINT_DBFS[0])}
          </span>
          <span
            data-testid="meter-scale-endpoint"
            data-dbfs={String(METER_SCALE_ENDPOINT_DBFS[1])}
            className={styles.scaleEndpointEndClassName}
          >
            {formatTickLabel(METER_SCALE_ENDPOINT_DBFS[1])}
          </span>
        </div>
      )}
    </div>
  );
}
