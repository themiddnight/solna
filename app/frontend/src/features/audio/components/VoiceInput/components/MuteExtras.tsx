import { memo } from "react";
import { Icon } from "@/shared/ui";
import { t } from "@lingui/core/macro";
import { Popover } from "@/features/ui";
import type { CleanInputReport } from "@/engine/audio";
import { GainControl } from "./GainControl";
import { CleanInputBadge } from "./CleanInputBadge";
import type { VoiceState } from "../index";

interface MuteExtrasProps {
  voiceState: Pick<VoiceState, "cleanMode" | "gain" | "isConnected" | "autoGain">;
  /** What `acquireCleanInput` actually got the browser to do — sibling to voiceState, not part
   * of it: this is derived runtime information, not a control the user toggles. */
  cleanInputReport: CleanInputReport | null;
  handleCleanModeToggle: () => void;
  handleGainChangeWithState: (gain: number) => void;
}

/**
 * Popover behind the mute button's caret — the controls that shape the mic
 * signal itself (Clean Mode, input gain). Split out of the old VoiceSettings
 * popup so these frequently-adjusted-mid-session controls sit right next to
 * the mute button, separate from the setup-level controls under the gear
 * icon (device select, Voice Chat connect/disconnect).
 */
const MuteExtrasComponent = ({
  voiceState,
  cleanInputReport,
  handleCleanModeToggle,
  handleGainChangeWithState,
}: MuteExtrasProps) => {
  return (
    <Popover.Content side="bottom" className="w-72">
      <div className="p-4">
        <h4 className="font-semibold mb-5">{t`Mute Options`}</h4>

        {/* Clean Mode */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{t`Clean Mode`}</span>
            <span className="text-xs text-base-content/60">
              {t`Ultra-low latency, no processing`}
            </span>
          </div>
          <button
            onClick={handleCleanModeToggle}
            className={`btn btn-sm ${voiceState.cleanMode ? "btn-warning" : "btn-outline"
              }`}
            title={
              voiceState.cleanMode
                ? t`Disable clean mode (enable audio processing)`
                : t`Enable clean mode (disable audio processing)`
            }
          >
            <Icon name="fire" className="inline" />
          </button>
        </div>

        <div className="flex justify-end mb-3">
          <CleanInputBadge report={cleanInputReport} cleanMode={voiceState.cleanMode} />
        </div>

        <div className="divider" />

        {/* Professional Input Gain Control */}
        <div className="mb-3">
          <GainControl
            gain={voiceState.gain}
            onGainChange={handleGainChangeWithState}
            disabled={!voiceState.isConnected || voiceState.autoGain}
          />
        </div>
      </div>
    </Popover.Content>
  );
};

export const MuteExtras = memo(MuteExtrasComponent);
