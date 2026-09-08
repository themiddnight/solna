import React from "react";
import type { KnobColor } from "./Knob";
import { Volume2 } from "lucide-react";
import { VolumeFader } from "./VolumeFader";
import { FIELD_LABEL } from "./fieldClasses";
import { formatDb } from "@/utils/gainUnits";

/** Icon tints allowed by the theme; reuses KnobColor so drift is impossible. */
type StripAccent = KnobColor;

interface ChannelStripProps {
  idPrefix: string;
  label?: string;
  /**
   * The bus level in DECIBELS: unity is 0, the range is -60..+12 for every
   * bus. There is no `max` prop any more. It used to be a required LINEAR
   * ceiling — 1.5 for a boostable layer, 1.0 for the drum bus — because the
   * ceiling was a property of the bus. On a shared dB range that distinction
   * is gone, and a per-call ceiling would be worse than useless: the taper is
   * derived from FADER_MAX_DB, so a caller-supplied ceiling would make the
   * same physical position mean a different level on different strips.
   */
  volumeDb: number;
  accentClass: StripAccent;
  onVolumeDbChange: (db: number) => void;
  // The chord panel shows a live dB readout; the bass panel does not.
  showReadout?: boolean;
  // Full daisyUI class list for the fader, e.g. 'range range-xs range-primary'.
  sliderClassName?: string;
}

export function ChannelStrip({
  idPrefix,
  label,
  volumeDb,
  accentClass,
  onVolumeDbChange,
  showReadout = true,
  sliderClassName = "range range-xs range-accent",
}: ChannelStripProps) {
  // idPrefix is the layer slug ("chord"/"bass"); the tooltip reads
  // "Chord Layer Gain: -6.0 dB".
  const layerName = idPrefix.charAt(0).toUpperCase() + idPrefix.slice(1);
  const readout = formatDb(volumeDb);
  return (
    <div className="min-w-40">
      {label && <label className={FIELD_LABEL}>
        {label} <span className="font-mono">({readout})</span>
      </label>}
      <div className="flex items-center gap-2 bg-base-200 border border-base-300 rounded-box px-2.5 py-1 text-xs h-8">
        <Volume2 className={`w-3.5 h-3.5 ${accentClass} shrink-0`} />
        {/* No taper, no step, no formatting here. VolumeFader owns all three,
            which is what makes "unity at 0.75 of travel" one fact rather than
            twenty. This component contributes the icon, the field label and
            the box — and DEV-389 will replace exactly that, plus a meter. */}
        <VolumeFader
          id={`slider-${idPrefix}-layer-volume`}
          label={`${layerName} Layer Gain`}
          valueDb={volumeDb}
          onChangeDb={onVolumeDbChange}
          className={sliderClassName}
          showReadout={showReadout}
          readoutClassName="text-[10px] font-mono min-w-14 text-right"
        />
      </div>
    </div>
  );
}
