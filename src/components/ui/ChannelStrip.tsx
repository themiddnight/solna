import React from "react";
import { Volume2 } from "lucide-react";
import { Slider } from "./Slider";

const LABEL_BASE = "text-[10px] text-slate-500 block mb-1";

interface ChannelStripProps {
  idPrefix: string;
  label: string;
  volume: number;
  accentClass: string;
  onVolumeChange: (v: number) => void;
  // The original chord panel shows a live % readout; the bass panel does not.
  showReadout?: boolean;
  // The original panels differ only in the slider accent color (indigo vs emerald).
  sliderClassName?: string;
}

export const ChannelStrip: React.FC<ChannelStripProps> = ({
  idPrefix,
  label,
  volume,
  accentClass,
  onVolumeChange,
  showReadout = true,
  sliderClassName = "w-full h-1 bg-[#0B0D19] rounded cursor-pointer accent-indigo-500",
}) => {
  // idPrefix is the layer slug ("chord"/"bass"); the original tooltip reads
  // "Chord Layer Gain: X%" / "Bass Layer Gain: X%".
  const layerName = idPrefix.charAt(0).toUpperCase() + idPrefix.slice(1);
  return (
    <div className="min-w-[160px]">
      <label className={LABEL_BASE}>
        {label} ({Math.round(volume * 100)}%)
      </label>
      <div className="flex items-center gap-2 bg-[#171B36] border border-[#2D355A] rounded-lg px-2.5 py-1 text-xs h-[30px]">
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
          <span className="text-[10px] text-indigo-300 font-mono min-w-8 text-right">
            {(volume * 100).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
};
