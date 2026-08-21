import { memo, useState } from "react";
import { Icon } from "@/shared/ui";
import { t } from "@lingui/core/macro";
import { Popover } from "@/features/ui";
import { AdaptiveAudioStatus } from "@/features/audio";
import { computeLatencyBreakdown } from "../../../utils/latencyBreakdown";
import { getWebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";
import {
  getOutputLatencyGuidance,
  getStallGuidance,
  getConnectionPathGuidance,
} from "../../../utils/latencyGuidance";
import type { ConnectionPathType } from "../../../utils/rtcStatsUtils";
import type { NetworkStallReport } from "../../../utils/latencyStats";

/**
 * Wired output on modern devices sits around 5–15ms; Bluetooth adds 80ms+ (and
 * drops to HFP quality once the mic is live), and built-in laptop speakers run
 * their own DSP chain — measured ~50ms on a MacBook. Above this threshold the
 * output stage is almost certainly a route problem the user can fix, not
 * something the app can tune — so surface a hint instead of staying silent.
 */
const HIGH_OUTPUT_LATENCY_WARN_MS = 30;

/**
 * Above this, the buffer is inflated well past the structural floor (~30ms with
 * ptime:10), so a detected stall is worth acting on. Below it NetEq is coping —
 * spikes exist but cost the user nothing, and a warning would be noise.
 */
const INFLATED_JITTER_BUFFER_MS = 60;

interface VoiceInfoProps {
  browserAudioLatency?: number | undefined;
  meshLatency?: number | null | undefined;
  jitterBufferMs?: number | null | undefined;
  inputLatencyMs?: number | undefined;
  isConnecting: boolean;
  connectionError: boolean;
  rtcLatencyActive: boolean;
  rtcLatency?: number | null | undefined;
  userCount: number;
  /** Route the audio actually takes — explains an unexpectedly high RTT. */
  connectionPath?: ConnectionPathType | null | undefined;
  /** Raw path unevenness — explains (or fails to explain) the jitter buffer. */
  networkJitterMs?: number | null | undefined;
  /** Recurring-stall verdict — the cause the median-smoothed numbers hide. */
  networkStall?: NetworkStallReport | null | undefined;
}

/** One label/value line, with its explanation only when details are open. */
interface MetricRowProps {
  label: string;
  /** Pre-formatted display value (a number + unit, or a path name). */
  value: string;
  description: string;
  isDetailsOpen: boolean;
  testId: string;
}

const MetricRow = ({
  label,
  value,
  description,
  isDetailsOpen,
  testId,
}: MetricRowProps) => (
  <div>
    <div className="flex justify-between items-center gap-2">
      <span className="text-base-content/70">{label}</span>
      <span className="font-mono text-sm shrink-0" data-testid={testId}>
        {value}
      </span>
    </div>
    {isDetailsOpen && (
      <p className="text-xs text-base-content/50 mt-0.5 pr-8">{description}</p>
    )}
  </div>
);

const formatMs = (valueMs: number | null): string =>
  valueMs !== null ? t`${Math.round(valueMs)}ms` : "—";

/** Warning text: the action always, the reasoning only for those who ask. */
interface GuidanceProps {
  action: string;
  reason?: string | undefined;
  isDetailsOpen: boolean;
  testId: string;
}

const Guidance = ({ action, reason, isDetailsOpen, testId }: GuidanceProps) => (
  <p className="text-xs text-warning mt-0.5 pr-8" data-testid={testId}>
    <Icon name="alert" className="inline" /> {action}
    {isDetailsOpen && reason != null ? ` ${reason}` : ""}
  </p>
);

/** Human-readable label + explanation for the route the audio takes. */
const describeConnectionPath = (
  path: ConnectionPathType,
): { label: string; description: string } => {
  switch (path) {
    case "local":
      return {
        label: t`Local network`,
        description: t`Audio goes straight between the two devices on this network — the shortest route available.`,
      };
    case "internet":
      return {
        label: t`Via the internet`,
        description: t`Audio leaves this network and comes back, even if the other person is nearby.`,
      };
    case "relayed":
      return {
        label: t`Relayed`,
        description: t`Audio passes through a relay server because a direct connection wasn't possible.`,
      };
  }
};

const VoiceInfoComponent = ({
  browserAudioLatency,
  meshLatency,
  jitterBufferMs,
  inputLatencyMs,
  isConnecting,
  connectionError,
  rtcLatencyActive,
  rtcLatency,
  userCount,
  connectionPath,
  networkJitterMs,
  networkStall,
}: VoiceInfoProps) => {
  // Default view answers "how am I doing / what do I fix": numbers and actions.
  // The "what IS a jitter buffer" reading is a one-time need, so it hides behind
  // one toggle instead of crowding every visit.
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Same helper as the headline number in RTCLatencyDisplay — the total shown
  // here is always the exact sum of the rows above it. Diagnostics below are
  // deliberately NOT part of this: they explain the stages, they aren't stages.
  const breakdown = computeLatencyBreakdown({
    inputDriverMs: inputLatencyMs,
    audioOutputMs: browserAudioLatency,
    networkRttMs: meshLatency,
    jitterBufferMs,
  });

  const caps = getWebRTCCapabilities();
  const pathInfo = connectionPath != null ? describeConnectionPath(connectionPath) : null;
  const isBreakdownAvailable = breakdown.totalMs !== null;

  // Only worth raising when the stalls are actually costing latency: NetEq
  // inflates the buffer to cover recurring spikes, and that inflation is the
  // damage the user feels. Spikes with a healthy buffer are free.
  const stallGuidance =
    networkStall?.hasStall === true &&
    breakdown.jitterBufferMs !== null &&
    breakdown.jitterBufferMs > INFLATED_JITTER_BUFFER_MS
      ? getStallGuidance(caps, networkStall)
      : null;

  const outputGuidance =
    breakdown.audioOutputMs !== null &&
    breakdown.audioOutputMs > HIGH_OUTPUT_LATENCY_WARN_MS
      ? getOutputLatencyGuidance(caps)
      : null;

  const pathGuidance =
    connectionPath != null ? getConnectionPathGuidance(caps, connectionPath) : null;

  // One note covers every "—" row, so the rows themselves stay silent.
  const hasUnmeasuredStage =
    breakdown.inputDriverMs === null ||
    breakdown.networkOneWayMs === null ||
    breakdown.jitterBufferMs === null ||
    breakdown.audioOutputMs === null;

  return (
    <Popover.Content side="bottom" className="w-96">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold"><Icon name="music-note" className="inline" /> {t`Audio Performance`}</h4>
          <span className="text-xs text-base-content/60">
            {t`Real-time monitoring`}
          </span>
        </div>

        {/* Latency Breakdown */}
        <div className="mb-4 p-3 bg-base-200 rounded-lg">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h5 className="font-semibold text-sm">{t`Latency Breakdown`}</h5>
            {isBreakdownAvailable && (
              <button
                type="button"
                className="btn btn-xs btn-ghost gap-1 font-normal text-base-content/60"
                onClick={() => setIsDetailsOpen((isOpen) => !isOpen)}
                aria-expanded={isDetailsOpen}
                data-testid="voice-info-details-toggle"
              >
                <Icon name="information" />
                {isDetailsOpen ? t`Hide details` : t`Show details`}
              </button>
            )}
          </div>
          {isDetailsOpen && (
            <p className="text-xs text-base-content/50 mb-3">
              {t`The journey of sound from a voice into your ear, stage by stage.`}
            </p>
          )}
          {isBreakdownAvailable ? (
            <div className={`text-sm ${isDetailsOpen ? "space-y-3" : "space-y-2"}`}>
              <MetricRow
                label={t`Microphone input`}
                value={formatMs(breakdown.inputDriverMs)}
                description={
                  breakdown.inputDriverMs === null
                    ? t`Not reported by this device's audio driver.`
                    : t`Time the mic hardware and OS take to hand audio to the browser. This part affects what others hear from you.`
                }
                isDetailsOpen={isDetailsOpen}
                testId="voice-info-input-driver"
              />
              <MetricRow
                label={t`Network (one-way)`}
                value={formatMs(breakdown.networkOneWayMs)}
                description={t`Travel time for audio packets to reach the other person — half of the measured round-trip (${Math.round(breakdown.networkRttMs ?? 0)}ms). Set by distance and internet routing; the direct peer-to-peer connection already minimizes it.`}
                isDetailsOpen={isDetailsOpen}
                testId="voice-info-rtt-latency"
              />
              <MetricRow
                label={t`Jitter buffer`}
                value={formatMs(breakdown.jitterBufferMs)}
                description={
                  breakdown.jitterBufferMs === null
                    ? t`No measurement yet for this connection — appears after a few seconds of incoming audio.`
                    : t`Incoming audio is held briefly to smooth out uneven packet arrival. Tuned low for music — a smaller buffer means less delay but less protection against a shaky connection.`
                }
                isDetailsOpen={isDetailsOpen}
                testId="voice-info-jitter-buffer"
              />
              {stallGuidance != null && (
                <Guidance
                  action={stallGuidance.action}
                  reason={stallGuidance.reason}
                  isDetailsOpen={isDetailsOpen}
                  testId="voice-info-stall-warning"
                />
              )}
              <MetricRow
                label={t`Audio output`}
                value={formatMs(breakdown.audioOutputMs)}
                description={t`Browser and speaker/headphone buffering on this device before you actually hear the sound.`}
                isDetailsOpen={isDetailsOpen}
                testId="voice-info-audio-processing"
              />
              {outputGuidance != null && (
                <Guidance
                  action={outputGuidance.action}
                  reason={outputGuidance.reason}
                  isDetailsOpen={isDetailsOpen}
                  testId="voice-info-output-warning"
                />
              )}
              <div className="divider my-2"></div>
              <div>
                <div className="flex justify-between items-center font-semibold gap-2">
                  <span>{t`Total (mouth-to-ear)`}</span>
                  <span className="font-mono text-sm shrink-0" data-testid="voice-info-total-latency">
                    {t`${Math.round(breakdown.totalMs ?? 0)}ms+`}
                  </span>
                </div>
                {hasUnmeasuredStage && (
                  <p
                    className="text-xs text-base-content/50 mt-0.5 pr-8"
                    data-testid="voice-info-total-note"
                  >
                    {t`Stages marked — aren't measurable here, so the real total can be slightly higher.`}
                  </p>
                )}
              </div>

              {/* Diagnostics — context for the stages above, never part of the sum. */}
              {(pathInfo != null || networkJitterMs != null) && (
                <>
                  <div className="divider my-2"></div>
                  <div className={isDetailsOpen ? "space-y-3" : "space-y-2"}>
                    {pathInfo != null && (
                      <div>
                        <MetricRow
                          label={t`Connection`}
                          value={pathInfo.label}
                          description={pathInfo.description}
                          isDetailsOpen={isDetailsOpen}
                          testId="voice-info-connection-path"
                        />
                        {pathGuidance != null && (
                          <Guidance
                            action={pathGuidance.action}
                            reason={pathGuidance.reason}
                            isDetailsOpen={isDetailsOpen}
                            testId="voice-info-path-warning"
                          />
                        )}
                      </div>
                    )}
                    {networkJitterMs != null && (
                      <MetricRow
                        label={t`Network jitter`}
                        value={formatMs(networkJitterMs)}
                        description={t`How unevenly packets arrive. This is what the jitter buffer above is sized to absorb — low jitter with a large buffer means the connection has occasional spikes rather than steady unevenness.`}
                        isDetailsOpen={isDetailsOpen}
                        testId="voice-info-network-jitter"
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="text-center text-base-content/50 py-2" data-testid="voice-info-no-connection">
              {isConnecting ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="loading loading-spinner loading-xs"></div>
                  <span>{t`Measuring latency...`}</span>
                </div>
              ) : connectionError ? (
                <span>{t`Connection error - unable to measure`}</span>
              ) : !rtcLatencyActive ? (
                <span>{t`No active voice connections`}</span>
              ) : (
                <span>{t`Latency data not available`}</span>
              )}
            </div>
          )}
        </div>

        <div className="mb-4">
          <AdaptiveAudioStatus
            userCount={userCount}
            currentLatency={rtcLatency ?? null}
            variant="compact"
            showRecommendations={true}
          />
        </div>
      </div>
    </Popover.Content>
  );
};

export const VoiceInfo = memo(VoiceInfoComponent);
