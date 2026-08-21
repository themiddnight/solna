import { Icon, type IconName } from "@/shared/ui";
import { memo } from "react";
import { t } from "@lingui/core/macro";

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'failed';

interface ConnectionQualityIndicatorProps {
  quality: ConnectionQuality;
  latency?: number;
  packetLoss?: number;
  showDetails?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const ConnectionQualityIndicatorComponent = ({
  quality,
  latency,
  packetLoss,
  showDetails = false,
  size = 'sm',
}: ConnectionQualityIndicatorProps) => {
  const getQualityConfig = (): {
    icon: IconName;
    color: string;
    bgColor: string;
    label: string;
    tooltip: string;
  } => {
    switch (quality) {
      case 'excellent':
        return {
          icon: 'signal-cellular-3',
          color: 'text-success',
          bgColor: 'bg-success/10',
          label: t`Excellent`,
          tooltip: t`Connection quality is excellent`,
        };
      case 'good':
        return {
          icon: 'signal-cellular-2',
          color: 'text-warning',
          bgColor: 'bg-warning/10',
          label: t`Good`,
          tooltip: t`Connection quality is good`,
        };
      case 'poor':
        return {
          icon: 'signal-cellular-1',
          color: 'text-error',
          bgColor: 'bg-error/10',
          label: t`Poor`,
          tooltip: t`Connection quality is poor`,
        };
      case 'failed':
        return {
          icon: 'signal-cellular-outline',
          color: 'text-base-content/30',
          bgColor: 'bg-base-300',
          label: t`Failed`,
          tooltip: t`Connection failed`,
        };
    }
  };

  const config = getQualityConfig();

  const sizeClasses = {
    xs: 'text-xs',
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  if (!showDetails) {
    return (
      <div
        className={`tooltip tooltip-bottom ${sizeClasses[size]}`}
        data-tip={config.tooltip}
      >
        <Icon name={config.icon} className={config.color} />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${sizeClasses[size]}`}>
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded-full ${config.bgColor}`}
      >
        <Icon name={config.icon} className={config.color} />
        <span className={`font-medium ${config.color}`}>{config.label}</span>
      </div>
      {latency !== undefined && (
      <span className="text-xs text-base-content/60 font-mono">
          {t`${latency.toFixed(0)}ms`}
        </span>
      )}
      {packetLoss !== undefined && packetLoss > 0 && (
        <span className="text-xs text-error font-mono">
          {t`${(packetLoss * 100).toFixed(1)}% loss`}
        </span>
      )}
    </div>
  );
};

export const ConnectionQualityIndicator = memo(ConnectionQualityIndicatorComponent);
