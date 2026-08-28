import React from "react";
import type { KnobColor } from "./Knob";
import { Volume2 } from "lucide-react";
import { Slider } from "./Slider";
import { FIELD_LABEL } from "./fieldClasses";


/** Icon tints allowed by the theme; reuses KnobColor so drift is impossible. */
type StripAccent = KnobColor;

interface ChannelStripProps {
  idPrefix: string;
  label: string;
  volume: number;
  accentClass: StripAccent;
  onVolumeChange: (v: number) => void;
  // The chord panel shows a live % readout; the bass panel does not.
  showReadout?: boolean;
  // Full daisyUI class list for the fader, e.g. 'range range-xs range-primary'.
  sliderClassName?: string;
  /**
   * Fader ceiling. Required, not defaulted: the ceiling is a property of the
   * bus, not of this widget. The chord and bass layers can be pushed to 1.5
   * for a boost, the drum bus is a plain 0..1 master — a default would hand
   * whichever value it picked to the next caller by silence.
   */
  max: number;
}

export const ChannelStrip: React.FC<ChannelStripProps> = ({
  idPrefix,
  label,
  volume,
  accentClass,
  onVolumeChange,
  showReadout = true,
  sliderClassName = "range range-xs range-accent",
  max,
}) => {
  // idPrefix is the layer slug ("chord"/"bass"); the original tooltip reads
  // "Chord Layer Gain: X%" / "Bass Layer Gain: X%".
  const layerName = idPrefix.charAt(0).toUpperCase() + idPrefix.slice(1);
  return (
    <div className="min-w-40">
      <label className={FIELD_LABEL}>
        {label} <span className="font-mono">({Math.round(volume * 100)}%)</span>
      </label>
      <div className="flex items-center gap-2 bg-base-200 border border-base-300 rounded-box px-2.5 py-1 text-xs h-8">
        <Volume2 className={`w-3.5 h-3.5 ${accentClass} shrink-0`} />
        <Slider
          id={`slider-${idPrefix}-layer-volume`}
          min={0}
          max={max}
          step={0.05}
          value={volume}
          onChange={onVolumeChange}
          className={sliderClassName}
          title={`${layerName} Layer Gain: ${(volume * 100).toFixed(0)}%`}
        />
        {showReadout && (
          <span className="text-[10px] font-mono min-w-8 text-right">
            {(volume * 100).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
};
