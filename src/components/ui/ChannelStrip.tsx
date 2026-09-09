import React from "react";
import type { KnobColor } from "./Knob";
import { Volume2 } from "lucide-react";
import { VolumeFader } from "./VolumeFader";

/**
 * The fader's element id, so a caller rendering its own `<label htmlFor>` is
 * not re-typing this template. SoundMixer does exactly that — the row label was
 * lifted out of here so the mute toggle beside it could align to the fader box
 * rather than to a label+box stack — and two independent literals that must
 * agree is how a label quietly stops being one.
 */
export const layerVolumeSliderId = (idPrefix: string) => `slider-${idPrefix}-layer-volume`;

/** Icon tints allowed by the theme; reuses KnobColor so drift is impossible. */
type StripAccent = KnobColor;

interface ChannelStripProps {
  idPrefix: string;
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
  /**
   * Print the dB beside the fader. The one production caller passes `false`
   * because its row label already carries the number; kept as a prop rather
   * than hard-coded so a surface without its own label can still show one.
   */
  showReadout?: boolean;
  // Full daisyUI class list for the fader, e.g. 'range range-xs range-primary'.
  sliderClassName?: string;
}

export function ChannelStrip({
  idPrefix,
  volumeDb,
  accentClass,
  onVolumeDbChange,
  showReadout = true,
  sliderClassName = "range range-xs range-accent",
}: ChannelStripProps) {
  // idPrefix is the layer slug ("chord"/"bass"); the tooltip reads
  // "Chord Layer Gain: -6.0 dB".
  const layerName = idPrefix.charAt(0).toUpperCase() + idPrefix.slice(1);
  return (
    <div className="min-w-40">
      {/* No label branch. The caller owns the label — see `layerVolumeSliderId`
          — and a second, unreachable way to render one here is an invitation to
          put it back inside the box and reproduce the misalignment the move
          fixed. */}
      <div className="flex items-center gap-2 bg-base-200 border border-base-300 rounded-box px-2.5 py-1 text-xs h-8">
        <Volume2 className={`w-3.5 h-3.5 ${accentClass} shrink-0`} />
        {/* No taper, no step, no formatting here. VolumeFader owns all three,
            which is what makes "unity at 0.75 of travel" one fact rather than
            twenty. This component contributes the icon, the field label and
            the box, all of which DEV-389's redesign still replaces.

            The meter is NOT one of them, and deliberately not: it sits outside
            this component, rendered as a sibling by the caller (see
            loop/SoundMixer.tsx). A meter has to read an analyser, and reading
            one means the layering-rule-3 exemption in eslint.config.js — which
            ui/SourceMeter.tsx holds alone. Pulling the meter in here would put
            every ChannelStrip call site behind that exemption to gain nothing.
        */}
        <VolumeFader
          id={layerVolumeSliderId(idPrefix)}
          label={`${layerName} Layer Gain`}
          valueDb={volumeDb}
          onChangeDb={onVolumeDbChange}
          className={sliderClassName}
          showReadout={showReadout}
          readoutClassName="text-[10px] tabular-nums min-w-14 text-right"
        />
      </div>
    </div>
  );
}
