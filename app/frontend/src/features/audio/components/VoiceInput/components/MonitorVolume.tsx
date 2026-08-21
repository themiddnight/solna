import { memo } from "react";
import { t } from "@lingui/core/macro";
import { Popover } from "@/features/ui";
import { Fader } from "@/shared/ui";
import { formatDb } from "../../../utils/audioUtils";
import { MONITOR_LEVEL_MIN_DB, MONITOR_LEVEL_MAX_DB } from "../stores/voiceStateStore";

const MONITOR_RANGE_COLOR = "range-info";

interface MonitorVolumeProps {
  /** Self-monitoring playback level in dB (DEV-307 review fix — was 0..1 linear). */
  monitorLevel: number;
  handleMonitorLevelChange: (levelDb: number) => void;
  disabled: boolean;
}

/**
 * Popover behind the self-monitor button's caret — just the playback-volume
 * slider for hearing yourself (with effects applied) through your own
 * headphones. The on/off toggle itself lives on the main button now, not
 * here, so this popup only has one job: how loud.
 */
const MonitorVolumeComponent = ({
  monitorLevel,
  handleMonitorLevelChange,
  disabled,
}: MonitorVolumeProps) => {
  return (
    <Popover.Content side="bottom" className="w-64">
      <div className="p-4">
        <h4 className="font-semibold mb-3">{t`Monitoring Volume`}</h4>
        <div className="flex items-center justify-between mb-1">
          <Fader
            id="voice-monitor-level"
            minDb={MONITOR_LEVEL_MIN_DB}
            maxDb={MONITOR_LEVEL_MAX_DB}
            disabled={disabled}
            value={Number(monitorLevel)}
            onChange={handleMonitorLevelChange}
            rangeColor={MONITOR_RANGE_COLOR}
            className="w-full"
            aria-label={t`Self-monitoring level`}
            data-testid="voice-monitor-level"
          />
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-base-200 text-info ml-2">
            {formatDb(monitorLevel)}
          </span>
        </div>
        <p className="text-xs text-base-content/60 mt-1">
          {t`How loud you hear yourself through effects, in your own headphones.`}
        </p>
      </div>
    </Popover.Content>
  );
};

export const MonitorVolume = memo(MonitorVolumeComponent);
