import React from "react";
import type { KnobColor } from "./Knob";
import { Volume2 } from "lucide-react";
import { Slider } from "./Slider";

const LABEL_BASE = "text-[10px] text-base-content/50 block mb-1";

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
}

export const ChannelStrip: React.FC<ChannelStripProps> = ({
  idPrefix,
  label,
  volume,
  accentClass,
  onVolumeChange,
  showReadout = true,
  sliderClassName = "range range-xs range-accent",
}) => {
  // idPrefix is the layer slug ("chord"/"bass"); the original tooltip reads
  // "Chord Layer Gain: X%" / "Bass Layer Gain: X%".
  const layerName = idPrefix.charAt(0).toUpperCase() + idPrefix.slice(1);
  return (
    <div className="min-w-40">
      <label className={LABEL_BASE}>
        {label} <span className="font-mono">({Math.round(volume * 100)}%)</span>
      </label>
      <div className="flex items-center gap-2 bg-base-200 border border-base-300 rounded-box px-2.5 py-1 text-xs h-7.5">
        <Volume2 className={`w-3.5 h-3.5 ${accentClass} shrink-0`} />
        <Slider
          id={`slider-${idPrefix}-layer-volume`}
          min={0}
          max={1.5}
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
