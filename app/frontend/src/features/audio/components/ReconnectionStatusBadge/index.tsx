import React, { useEffect, useState, useRef } from "react";
import { t } from "@lingui/core/macro";
import "./styles.css";

interface ReconnectionStatusBadgeProps {
  isConnected: boolean;
  isInGracePeriod: boolean;
  reconnectionAttempts: number;
  maxReconnectionAttempts?: number;
}

const ReconnectionStatusBadge: React.FC<ReconnectionStatusBadgeProps> = ({
  isConnected,
  isInGracePeriod,
  reconnectionAttempts,
  maxReconnectionAttempts = 3,
}) => {
  const [shouldShowSuccess, setShowSuccess] = useState(false);
  const prevIsInGracePeriod = useRef(false);

  useEffect(() => {
    const hasHadGracePeriod = prevIsInGracePeriod.current;
    prevIsInGracePeriod.current = isInGracePeriod;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Detect transition from grace period (reconnecting) to connected state
    if (hasHadGracePeriod && !isInGracePeriod && isConnected) {
      setShowSuccess(true);
      timer = setTimeout(() => {
        setShowSuccess(false);
      }, 3000); // Show success indicator for 3 seconds before fading out
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isInGracePeriod, isConnected]);

  if (isInGracePeriod) {
    return (
      <div className="reconnect-badge reconnecting">
        <span className="reconnect-dot bg-warning"></span>
        <span className="reconnect-text">
          {t`Reconnecting (${reconnectionAttempts}/${maxReconnectionAttempts})...`}
        </span>
      </div>
    );
  }

  if (shouldShowSuccess) {
    return (
      <div className="reconnect-badge connected success-flash">
        <span className="reconnect-dot bg-success"></span>
        <span className="reconnect-text">{t`Connected`}</span>
      </div>
    );
  }

  return null;
};

export default ReconnectionStatusBadge;
