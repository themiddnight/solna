import React from "react";
import { Icon } from "@/shared/ui";
import { t } from "@lingui/core/macro";
import { getWebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";
import { computeLatencyBreakdown } from "../../utils/latencyBreakdown";

interface RTCLatencyDisplayProps {
  latency: number | null;
  isActive: boolean;
  showLabel?: boolean | undefined;
  showMs?: boolean | undefined;
  size?: "sm" | "md" | "lg" | undefined;
  /** AudioContext baseLatency + outputLatency (ms). */
  browserAudioLatency?: number | undefined;
  /** Network RTT to peers (ms) — halved to one-way inside the total. */
  meshLatency?: number | null | undefined;
  /** Average receive jitter buffer delay (ms). */
  jitterBufferMs?: number | null | undefined;
  /** Input driver latency from track.getSettings().latency (ms). */
  inputLatencyMs?: number | undefined;
  // Connection state props
  isConnecting?: boolean | undefined;
  connectionError?: boolean | undefined;
  onRetry?: (() => void) | undefined;
}

const RTCLatencyDisplay: React.FC<RTCLatencyDisplayProps> = ({
  latency,
  isActive,
  showMs = true,
  size = "sm",
  browserAudioLatency,
  meshLatency,
  jitterBufferMs,
  inputLatencyMs,
  isConnecting = false,
  connectionError = false,
  onRetry,
}) => {
  // Estimated mouth-to-ear total: input driver + RTT/2 + jitter buffer + audio
  // output. Same helper feeds the VoiceInfo breakdown so both always agree.
  const breakdown = computeLatencyBreakdown({
    inputDriverMs: inputLatencyMs,
    audioOutputMs: browserAudioLatency,
    networkRttMs: meshLatency,
    jitterBufferMs,
  });
  const displayLatency = breakdown.totalMs ?? latency;

  // Thresholds are on the mouth-to-ear scale (the full chain, not just RTT):
  // <30ms plays like the same room; 30–60ms is a workable jam; beyond ~100ms
  // rhythm-tight playing breaks down and voice is conversation-grade only.
  const getLatencyColor = (latencyValue: number | null) => {
    if (!isActive || latencyValue === null) return "text-base-content/50";
    if (latencyValue < 30) return "text-success"; // Excellent: < 30ms
    if (latencyValue < 60) return "text-success"; // Good: 30-60ms
    if (latencyValue < 100) return "text-warning"; // Fair: 60-100ms
    if (latencyValue < 150) return "text-orange-500"; // Poor: 100-150ms
    return "text-error"; // Very Poor: > 150ms
  };

  const getLatencyStatus = (latencyValue: number | null) => {
    if (!isActive) return t`No voice connections`;
    if (latencyValue === null) return t`Measuring...`;
    if (latencyValue < 30) return t`Excellent`;
    if (latencyValue < 60) return t`Good`;
    if (latencyValue < 100) return t`Fair`;
    if (latencyValue < 150) return t`Poor`;
    return t`Very Poor`;
  };

  // Get size classes
  const getSizeClasses = () => {
    switch (size) {
      case "sm":
        return "text-xs";
      case "md":
        return "text-sm";
      case "lg":
        return "text-base";
      default:
        return "text-xs";
    }
  };

  // Format latency value with appropriate precision
  const formatLatencyValue = (latencyValue: number | null) => {
    if (latencyValue === null) return "---";

    // For very low latency (< 10ms), show 1 decimal place
    if (latencyValue < 10) {
      return `${latencyValue.toFixed(1)}${showMs ? "ms+" : ""}`;
    }

    // For higher latency, round to nearest integer
    return `${Math.round(latencyValue)}${showMs ? "ms+" : ""}`;
  };

  const getTooltip = () => {
    const status = getLatencyStatus(displayLatency);
    return t`Estimated voice latency (mouth-to-ear): ${formatLatencyValue(displayLatency)} — ${status}. Open the info panel for a full breakdown.`;
  };

  const sizeClass = getSizeClasses();

  // Handle different connection states
  if (isConnecting) {
    return (
      <div
        className={`flex items-center gap-1 ${sizeClass}`}
        title={t`Connecting...`}
      >
        <div className="loading loading-spinner loading-xs"></div>
        <span className="text-base-content/60">---</span>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className={`flex items-center gap-1 ${sizeClass}`}>
        {onRetry ? (
          <button
            onClick={onRetry}
            className="text-error hover:text-error/80 cursor-pointer"
            title={t`Connection failed. Click to retry`}
          >
            <Icon name="refresh" />
          </button>
        ) : (
          <span className="text-error" title={t`Connection failed`}>
            <Icon name="close-circle" />
          </span>
        )}
        <span className="text-base-content/60">---</span>
      </div>
    );
  }

  if (!isActive) {
    const caps = getWebRTCCapabilities();
    return (
      <span
        data-testid="voice-latency-display"
        className={`text-base-content/50 ${sizeClass} font-mono`}
        title={caps.isIOS ? t`Latency measurement not available on iOS` : t`No voice connections`}
      >
        {caps.isIOS ? t`N/A` : "---"}
      </span>
    );
  }

  const displayValue = formatLatencyValue(displayLatency);
  const colorClass = getLatencyColor(displayLatency);

  // Connected state - show latency
  return (
    <span
      data-testid="voice-latency-display"
      className={`${colorClass} ${sizeClass} font-mono`}
      title={getTooltip()}
    >
      {displayValue}
    </span>
  );
};

export default RTCLatencyDisplay;
