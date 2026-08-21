import { createContext, useContext } from "react";
import type { useConnectionStatus } from "./hooks";
import type { VoiceConnectionDiagnostics } from "@/features/audio/types/voice";
import type { CleanInputReport } from "@/engine/audio";

export interface VoiceState {
  isMuted: boolean;
  gain: number;
  isSelfMonitoring: boolean;
  /** Self-monitoring playback level in dB (DEV-307 review fix — was 0..1 linear). */
  monitorLevel: number;
  isConnected: boolean;
  hasSeenHeadphoneModal: boolean;
  cleanMode: boolean;
  autoGain: boolean;
}

export interface VoiceRuntimeContextValue {
  voiceState: VoiceState;
  connectionStatus: ReturnType<typeof useConnectionStatus>;
  rtcLatency: number | null;
  rtcLatencyActive: boolean;
  browserAudioLatency: number | undefined;
  meshLatency: number | null | undefined;
  jitterBufferMs: number | null | undefined;
  connectionDiagnostics: VoiceConnectionDiagnostics | undefined;
  inputDriverLatencySeconds: number | null;
  /** What `acquireCleanInput` actually got the browser to do — see CleanInputBadge. */
  cleanInputReport: CleanInputReport | null;
  isConnecting: boolean;
  connectionError: boolean;
  onConnectionRetry: (() => void) | undefined;
  connectedPeers: number;
  totalPeers: number;
  userCount: number;
  onRetryConnections: (() => void) | undefined;
  analyser: AnalyserNode | null;
  handleMuteToggleWithState: () => Promise<void>;
  voiceInputDeviceId: string | null;
  setVoiceInputDeviceId: (deviceId: string | null) => void;
  handleCleanModeToggle: () => void;
  handleGainChangeWithState: (gain: number) => void;
  handleSelfMonitorToggleWithState: () => void | Promise<void>;
  handleMonitorLevelChange: (levelDb: number) => void;
  handleConnect: () => Promise<void>;
  handleDisconnect: () => void;
}

export const VoiceRuntimeContext = createContext<VoiceRuntimeContextValue | null>(null);

export const useVoiceRuntime = (): VoiceRuntimeContextValue => {
  const value = useContext(VoiceRuntimeContext);
  if (value == null) {
    throw new Error("VoiceInputView must be rendered inside VoiceRuntimeProvider");
  }
  return value;
};
