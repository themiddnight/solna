import { useMemo } from "react";

interface UseConnectionStatusParams {
  isConnecting: boolean;
  connectionError: boolean;
  isConnected: boolean;
  userCount: number;
  meshLatency: number | null | undefined;
  rtcLatencyActive: boolean;
}

interface ConnectionStatus {
  color: string;
  pulse: boolean;
  tooltip: string;
}

const deriveConnectionStatus = ({
  isConnecting,
  connectionError,
  isConnected,
  userCount,
  meshLatency,
  rtcLatencyActive,
}: UseConnectionStatusParams): ConnectionStatus => {
  if (connectionError) {
    return {
      color: "bg-red-500",
      pulse: false,
      tooltip: "Connection error - click retry or check your network",
    };
  }

  if (!isConnected) {
    return {
      color: "bg-red-500",
      pulse: false,
      tooltip: "Microphone not connected",
    };
  }

  if (isConnecting) {
    return {
      color: "bg-yellow-500",
      pulse: true,
      tooltip: "Connecting to voice mesh...",
    };
  }

  if (userCount <= 1) {
    return {
      color: "bg-yellow-500",
      pulse: true,
      tooltip: "Waiting for other users to join...",
    };
  }

  const hasLatencyStats = rtcLatencyActive && meshLatency != null;
  return {
    color: "bg-green-500",
    pulse: false,
    tooltip: hasLatencyStats
      ? `Connected (${meshLatency}ms latency)`
      : "Connected - ready to communicate",
  };
};

/**
 * Derives the voice input status indicator state.
 * Red = error or mic off, Yellow = connecting or waiting for peers, Green = live.
 *
 * Memoized so the returned object keeps a stable reference while its inputs are
 * unchanged — it feeds the shared voice-runtime context value, so a fresh object
 * each render would invalidate that value and re-render every VoiceInput consumer.
 */
export function useConnectionStatus({
  isConnecting,
  connectionError,
  isConnected,
  userCount,
  meshLatency,
  rtcLatencyActive,
}: UseConnectionStatusParams): ConnectionStatus {
  return useMemo(
    () =>
      deriveConnectionStatus({
        isConnecting,
        connectionError,
        isConnected,
        userCount,
        meshLatency,
        rtcLatencyActive,
      }),
    [
      isConnecting,
      connectionError,
      isConnected,
      userCount,
      meshLatency,
      rtcLatencyActive,
    ],
  );
}
