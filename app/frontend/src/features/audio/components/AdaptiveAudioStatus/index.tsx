import { useAdaptiveAudio } from "../../hooks/useAdaptiveAudio";
import { Icon } from "@/shared/ui";
import React from "react";
import { t } from "@lingui/core/macro";
import { formatRelativeTime } from "@/shared/utils/dateTimeFormatting";

interface AdaptiveAudioStatusProps {
  audioContext?: AudioContext | null;
  userCount?: number;
  currentLatency?: number | null;
  variant?: "compact" | "detailed" | "badge";
  showRecommendations?: boolean;
}

const AdaptiveAudioStatus: React.FC<AdaptiveAudioStatusProps> = ({
  audioContext,
  userCount = 0,
  currentLatency = null,
  variant = "compact",
  showRecommendations = false,
}) => {
  const {
    configSummary,
    qualityLevel,
    isUltraLowLatency,
    isBalanced,
    isStable,
    recommendations,
    lastAdjustment,
  } = useAdaptiveAudio({
    audioContext,
    userCount,
    currentLatency,
  });

  // Get quality color
  const getQualityColor = () => {
    if (isUltraLowLatency) return "text-success";
    if (isBalanced) return "text-warning";
    if (isStable) return "text-info";
    return "text-base-content";
  };

  // Get quality icon
  const getQualityIcon = () => {
    if (isUltraLowLatency) return <Icon name="lightning-bolt" />;
    if (isBalanced) return <Icon name="scale-balance" />;
    if (isStable) return <Icon name="shield" />;
    return <Icon name="music-note" />;
  };

  const getQualityLabel = () => {
    if (isUltraLowLatency) return t`Ultra low latency`;
    if (isBalanced) return t`Balanced`;
    if (isStable) return t`Stable`;
    return qualityLevel.replace("-", " ");
  };

  if (variant === "badge") {
    return (
      <div className={`badge badge-outline ${getQualityColor()}`}>
        {getQualityIcon()} {getQualityLabel()}
      </div>
    );
  }

  if (variant === "detailed") {
    return (
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="card-title text-sm">{t`Adaptive Audio`}</h4>
            <span className={`badge ${getQualityColor()}`}>
              {getQualityIcon()} {getQualityLabel()}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span>{t`Mode:`}</span>
              <span className="font-mono">{configSummary.description}</span>
            </div>
            <div className="flex justify-between">
              <span>{t`Target Latency:`}</span>
              <span className="font-mono">{configSummary.latencyTarget}</span>
            </div>
            <div className="flex justify-between">
              <span>{t`Buffer Size:`}</span>
              <span className="font-mono">
                {t`${configSummary.bufferSize} samples`}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{t`Look-ahead:`}</span>
              <span className="font-mono">{configSummary.lookAhead}</span>
            </div>
            <div className="flex justify-between">
              <span>{t`Users:`}</span>
              <span className="font-mono">{userCount}</span>
            </div>
            <div className="flex justify-between">
              <span>{t`Last Adjusted:`}</span>
              <span className="font-mono text-xs">
                {formatRelativeTime(lastAdjustment)}
              </span>
            </div>
          </div>

          {showRecommendations && recommendations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-base-300">
              <div className="text-xs font-semibold mb-2">{t`Recommendations:`}</div>
              <ul className="text-xs space-y-1">
                {recommendations.map((rec, index) => (
                  <li key={index} className="text-warning">
                    • {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Compact variant (default)
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={getQualityColor()}>{getQualityIcon()}</span>
      <span className="font-mono">{getQualityLabel()}</span>
      <span className="text-base-content/60">{t`(${userCount} users)`}</span>
    </div>
  );
};

export default AdaptiveAudioStatus;
