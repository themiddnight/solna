import {
  formatDb,
  getDbColorClass,
  getSliderColorClass,
} from "../../../utils/audioUtils";
import { VOICE_INPUT_GAIN_MIN_DB, VOICE_INPUT_GAIN_MAX_DB } from "../stores/voiceStateStore";
import React, { useCallback } from "react";
import { t } from "@lingui/core/macro";
import { Fader } from "@/shared/ui";

interface GainControlProps {
  /** Current gain in dB (DEV-307 — was linear Web Audio format). */
  gain: number;
  /** Callback when gain changes, receives the new value in dB. */
  onGainChange: (newGainDb: number) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Professional mixer-style gain control with 0dB at center.
 * Range: -60dB to +24dB (0dB at center-ish; see DEV-307 for the range's rationale — a
 * deliberate exception to the app's -60..+12 mix-fader range, mic preamps need more headroom).
 */
export const GainControl: React.FC<GainControlProps> = ({
  gain,
  onGainChange,
  disabled = false,
  className = "",
}) => {
  const handleDbChange = useCallback(
    (newDb: number) => {
      onGainChange(newDb);
    },
    [onGainChange],
  );

  return (
    <div className={`${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm">{t`Input Gain`}</span>
        <span
          className={`text-xs font-mono px-2 rounded bg-base-200 ${getDbColorClass(gain)}`}
        >
          {formatDb(gain)}
        </span>
      </div>

      <div className="relative">
        <Fader
          minDb={VOICE_INPUT_GAIN_MIN_DB}
          maxDb={VOICE_INPUT_GAIN_MAX_DB}
          value={gain}
          onChange={handleDbChange}
          disabled={disabled}
          rangeColor={getSliderColorClass(gain)}
          className="w-full"
        />

        <div className="flex justify-between text-xs text-base-content/50 mt-1 px-1">
          <span>-60</span>
          <span>-36</span>
          <span>-12</span>
          <span className="font-bold text-primary border-b border-primary">
            {t`0dB`}
          </span>
          <span>+12</span>
          <span>+24</span>
        </div>
      </div>
    </div>
  );
};
