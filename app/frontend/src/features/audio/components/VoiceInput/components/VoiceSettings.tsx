import { memo } from "react";
import { Icon } from "@/shared/ui";
import { t } from "@lingui/core/macro";
import { Popover, Switch } from "@/features/ui";
import { AudioInputSelector } from "@/features/audio/components/AudioInputSelector";

interface VoiceSettingsProps {
  isConnected: boolean;
  voiceInputDeviceId: string | null;
  setVoiceInputDeviceId: (deviceId: string) => void;
  handleConnect: () => void;
  handleDisconnect: () => void;
  connectedPeers?: number | undefined;
  totalPeers?: number | undefined;
  onRetryConnections?: (() => void) | undefined;
}

/**
 * Popover behind the gear icon — setup-level controls (which mic to use,
 * Voice Mesh diagnostics + retry, whether Voice Chat is on at all). Clean
 * Mode, gain, and self-monitor volume moved to the mute/monitor button
 * groups. Voice Chat kept last so the one control that fully disconnects
 * the room never sits next to controls adjusted mid-session, where a
 * mis-click would cost more than the others.
 */
const VoiceSettingsComponent = ({
  isConnected,
  voiceInputDeviceId,
  setVoiceInputDeviceId,
  handleConnect,
  handleDisconnect,
  connectedPeers,
  totalPeers,
  onRetryConnections,
}: VoiceSettingsProps) => {
  return (
    <Popover.Content side="bottom" className="w-72">
      <div className="p-4">
        <h4 className="font-semibold mb-5">{t`Voice Settings`}</h4>

        {/* Input Device Selector */}
        <div className="mb-3">
          <AudioInputSelector
            value={voiceInputDeviceId}
            onChange={setVoiceInputDeviceId}
            className="w-full"
          />
        </div>

        <div className="divider" />

        {/* Voice Mesh diagnostics — peer count + retry button. */}
        {isConnected && onRetryConnections != null && (
          <div className="mb-3" data-testid="voice-settings-mesh-section">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{t`Voice Mesh`}</span>
                <span className="text-xs text-base-content/60" data-testid="voice-settings-mesh-peer-count">
                  {t`${connectedPeers ?? 0}/${totalPeers ?? 0} peers connected`}
                </span>
              </div>
              <button
                onClick={onRetryConnections}
                className="btn btn-sm btn-outline"
                title={t`Retry voice connections if you can't hear someone`}
                data-testid="voice-settings-mesh-retry-btn"
              >
                <Icon name="refresh" className="inline" />
                {t`Retry`}
              </button>
            </div>

            {(totalPeers ?? 0) > 0 && (connectedPeers ?? 0) < (totalPeers ?? 0) && (
              <div className="alert alert-warning shadow-sm mt-2" data-testid="voice-settings-mesh-warning">
                <Icon name="alert" />
                <div className="text-xs">
                  {t`Only ${connectedPeers ?? 0} of ${totalPeers ?? 0} connections active. Click Retry to reconnect.`}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="divider" />

        {/* Connect/Disconnect Controls */}
        <div className="flex items-center justify-between">
          <span className="text-sm">{t`Voice Chat`}</span>
          <div className="form-control">
            <label className="label cursor-pointer gap-2">
              <span className="label-text text-xs">{t`Enable`}</span>
              <Switch
                checked={isConnected}
                onCheckedChange={(checked) => {
                  if (checked) {
                    handleConnect();
                  } else {
                    handleDisconnect();
                  }
                }}
                aria-label={t`Enable voice`}
              />
            </label>
          </div>
        </div>
      </div>
    </Popover.Content>
  );
};

export const VoiceSettings = memo(VoiceSettingsComponent);
