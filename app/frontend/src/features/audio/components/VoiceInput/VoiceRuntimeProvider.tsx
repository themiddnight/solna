import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useAudioDeviceStore } from "@/features/audio/stores/audioDeviceStore";
import type { VoiceConnectionDiagnostics } from "@/features/audio/types/voice";
import {
  useAudioStream,
  useConnectionStatus,
  useInputLevelMonitoring,
  useVoiceControls,
  useVoiceInputHandlers,
} from "./hooks";
import { useVoiceStateStore } from "./stores/voiceStateStore";
import { HeadphoneModal } from "./components/HeadphoneModal";
import {
  VoiceRuntimeContext,
  type VoiceRuntimeContextValue,
  type VoiceState,
} from "./VoiceInputRuntimeContext";

interface VoiceRuntimeProviderProps {
  children: ReactNode;
  isVoiceEnabled?: boolean;
  canTransmitVoice?: boolean;
  onVoiceStateChange?: ((state: VoiceState) => void) | undefined;
  onMuteStateChange?: ((isMuted: boolean) => void) | undefined;
  onStreamReady?: ((stream: MediaStream) => void) | undefined;
  onStreamRemoved?: (() => void) | undefined;
  rtcLatency?: (number | null) | undefined;
  rtcLatencyActive?: boolean;
  userCount?: number;
  activeBandMemberCount?: number | undefined;
  browserAudioLatency?: number | undefined;
  meshLatency?: number | null | undefined;
  jitterBufferMs?: number | null | undefined;
  connectionDiagnostics?: VoiceConnectionDiagnostics | undefined;
  isConnecting?: boolean;
  connectionError?: boolean;
  onConnectionRetry?: (() => void) | undefined;
  connectedPeers?: number;
  totalPeers?: number;
  onRetryConnections?: (() => void) | undefined;
}

export function VoiceRuntimeProvider({
  children,
  isVoiceEnabled = false,
  canTransmitVoice = false,
  onVoiceStateChange,
  onMuteStateChange,
  onStreamReady,
  onStreamRemoved,
  rtcLatency = null,
  rtcLatencyActive = false,
  userCount = 1,
  activeBandMemberCount,
  browserAudioLatency,
  meshLatency,
  jitterBufferMs = null,
  connectionDiagnostics,
  isConnecting = false,
  connectionError = false,
  onConnectionRetry,
  connectedPeers = 0,
  totalPeers = 0,
  onRetryConnections,
}: VoiceRuntimeProviderProps) {
  const [isHeadphoneModalOpen, setIsHeadphoneModalOpen] = useState(false);
  const hasAutoConnectedRef = useRef(false);
  const autoConnectAttemptRef = useRef(0);
  const initializeAudioStreamRef = useRef<(() => Promise<void>) | null>(null);
  const hasInitializedRef = useRef(false);
  const canUseVoiceRuntime = isVoiceEnabled && canTransmitVoice;

  const {
    isMuted,
    setMuted,
    gain,
    setGain,
    isSelfMonitoring,
    setSelfMonitoring,
    monitorLevel,
    setMonitorLevel,
    isConnected,
    setConnected,
    hasSeenHeadphoneModal,
    setHasSeenHeadphoneModal,
    cleanMode: isCleanModeEnabled,
    setCleanMode,
    autoGain: isAutoGainEnabled,
    setAutoGain,
  } = useVoiceStateStore(
    useShallow((state) => ({
      isMuted: state.isMuted,
      setMuted: state.setMuted,
      gain: state.gain,
      setGain: state.setGain,
      isSelfMonitoring: state.isSelfMonitoring,
      setSelfMonitoring: state.setSelfMonitoring,
      monitorLevel: state.monitorLevel,
      setMonitorLevel: state.setMonitorLevel,
      isConnected: state.isConnected,
      setConnected: state.setConnected,
      hasSeenHeadphoneModal: state.hasSeenHeadphoneModal,
      setHasSeenHeadphoneModal: state.setHasSeenHeadphoneModal,
      cleanMode: state.cleanMode,
      setCleanMode: state.setCleanMode,
      autoGain: state.autoGain,
      setAutoGain: state.setAutoGain,
    })),
  );

  const { voiceInputDeviceId, setVoiceInputDeviceId } = useAudioDeviceStore(
    useShallow((state) => ({
      voiceInputDeviceId: state.voiceInputDeviceId,
      setVoiceInputDeviceId: state.setVoiceInputDeviceId,
    })),
  );

  const voiceState: VoiceState = useMemo(
    () => ({
      isMuted,
      gain,
      isSelfMonitoring,
      monitorLevel,
      isConnected,
      hasSeenHeadphoneModal,
      cleanMode: isCleanModeEnabled,
      autoGain: isAutoGainEnabled,
    }),
    [
      isMuted,
      gain,
      isSelfMonitoring,
      monitorLevel,
      isConnected,
      hasSeenHeadphoneModal,
      isCleanModeEnabled,
      isAutoGainEnabled,
    ],
  );

  const handleRuntimeStreamReady = useCallback(
    (stream: MediaStream) => {
      if (!canUseVoiceRuntime) return;
      onStreamReady?.(stream);
    },
    [canUseVoiceRuntime, onStreamReady],
  );

  const {
    mediaStream,
    audioContext,
    gainNode,
    processedOutputNode,
    analyser,
    micPermission: isMicPermissionGranted,
    inputDriverLatencySeconds,
    cleanInputReport,
    initializeAudioStream,
    cleanup,
  } = useAudioStream({
    gain: voiceState.gain,
    cleanMode: voiceState.cleanMode,
    autoGain: voiceState.autoGain,
    deviceId: voiceInputDeviceId,
    onStreamReady: handleRuntimeStreamReady,
    onStreamRemoved,
  });

  const initializePermittedAudioStream = useCallback(async () => {
    if (!canUseVoiceRuntime) return;
    await initializeAudioStream();
  }, [canUseVoiceRuntime, initializeAudioStream]);

  const { startInputLevelMonitoring, stopInputLevelMonitoring } = useInputLevelMonitoring({
    analyser,
    isConnected: voiceState.isConnected,
    isMuted: voiceState.isMuted,
  });

  const { handleMuteToggle, handleGainChange, handleSelfMonitorToggle } = useVoiceControls({
    audioContext,
    gainNode,
    monitorNode: processedOutputNode,
    mediaStream,
    micPermission: isMicPermissionGranted,
    isMuted: voiceState.isMuted,
    isSelfMonitoring: voiceState.isSelfMonitoring,
    monitorLevel: voiceState.monitorLevel,
    initializeAudioStream: initializePermittedAudioStream,
    startInputLevelMonitoring,
    stopInputLevelMonitoring,
  });

  const {
    handleConnect,
    handleDisconnect,
    handleMuteToggleWithState,
    handleGainChangeWithState,
    handleSelfMonitorToggleWithState,
    handleCleanModeToggle,
    handleProceedCleanMode,
    handleCancelCleanMode,
  } = useVoiceInputHandlers({
    voiceState,
    activeBandMemberCount,
    mediaStream,
    initializeAudioStream: initializePermittedAudioStream,
    cleanup,
    startInputLevelMonitoring,
    stopInputLevelMonitoring,
    handleMuteToggle,
    handleGainChange,
    handleSelfMonitorToggle,
    setMuted,
    setGain,
    setConnected,
    setSelfMonitoring,
    setCleanMode,
    setAutoGain,
    setHasSeenHeadphoneModal,
    setShowHeadphoneModal: setIsHeadphoneModalOpen,
  });

  // Self-monitoring level (dB, DEV-307 review fix): write to the store; useVoiceControls
  // converts dB->linear at the GainNode AudioParam write boundary (TR-40) and applies it live
  // while monitoring is active (and on the next enable when it isn't).
  const handleMonitorLevelChange = useCallback(
    (levelDb: number) => {
      setMonitorLevel(levelDb);
    },
    [setMonitorLevel],
  );

  useEffect(() => {
    initializeAudioStreamRef.current = initializePermittedAudioStream;
  }, [initializePermittedAudioStream]);

  useEffect(() => {
    if (canUseVoiceRuntime) return;
    hasAutoConnectedRef.current = false;
    if (mediaStream) {
      cleanup();
    }
  }, [canUseVoiceRuntime, cleanup, mediaStream]);

  useEffect(() => {
    if (!canUseVoiceRuntime) {
      hasAutoConnectedRef.current = false;
      return;
    }
    if (hasAutoConnectedRef.current) return;
    const attemptId = autoConnectAttemptRef.current + 1;
    autoConnectAttemptRef.current = attemptId;
    void (async () => {
      try {
        await initializeAudioStreamRef.current?.();
        if (autoConnectAttemptRef.current === attemptId) {
          hasAutoConnectedRef.current = true;
        }
      } catch {
        if (autoConnectAttemptRef.current === attemptId) {
          hasAutoConnectedRef.current = false;
        }
      }
    })();
    return () => {
      autoConnectAttemptRef.current += 1;
      hasAutoConnectedRef.current = false;
    };
  }, [canUseVoiceRuntime]);

  useEffect(() => {
    onVoiceStateChange?.(voiceState);
  }, [voiceState, onVoiceStateChange]);

  useEffect(() => {
    onMuteStateChange?.(voiceState.isMuted);
  }, [voiceState.isMuted, onMuteStateChange]);

  useEffect(() => {
    if (!mediaStream && !hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    setConnected(!!mediaStream);
  }, [mediaStream, setConnected]);

  const connectionStatus = useConnectionStatus({
    isConnecting,
    connectionError,
    isConnected: voiceState.isConnected,
    userCount,
    meshLatency,
    rtcLatencyActive,
  });

  const value = useMemo<VoiceRuntimeContextValue>(
    () => ({
      voiceState,
      connectionStatus,
      rtcLatency,
      rtcLatencyActive,
      browserAudioLatency,
      meshLatency,
      jitterBufferMs,
      connectionDiagnostics,
      inputDriverLatencySeconds,
      cleanInputReport,
      isConnecting,
      connectionError,
      onConnectionRetry,
      connectedPeers,
      totalPeers,
      userCount,
      onRetryConnections,
      analyser,
      handleMuteToggleWithState,
      voiceInputDeviceId,
      setVoiceInputDeviceId,
      handleCleanModeToggle,
      handleGainChangeWithState,
      handleSelfMonitorToggleWithState,
      handleMonitorLevelChange,
      handleConnect,
      handleDisconnect,
    }),
    [
      voiceState,
      connectionStatus,
      rtcLatency,
      rtcLatencyActive,
      browserAudioLatency,
      meshLatency,
      jitterBufferMs,
      connectionDiagnostics,
      inputDriverLatencySeconds,
      cleanInputReport,
      isConnecting,
      connectionError,
      onConnectionRetry,
      connectedPeers,
      totalPeers,
      userCount,
      onRetryConnections,
      analyser,
      handleMuteToggleWithState,
      voiceInputDeviceId,
      setVoiceInputDeviceId,
      handleCleanModeToggle,
      handleGainChangeWithState,
      handleSelfMonitorToggleWithState,
      handleMonitorLevelChange,
      handleConnect,
      handleDisconnect,
    ],
  );

  return (
    <VoiceRuntimeContext.Provider value={value}>
      {children}
      <HeadphoneModal
        open={isHeadphoneModalOpen}
        setOpen={setIsHeadphoneModalOpen}
        onProceed={handleProceedCleanMode}
        onCancel={handleCancelCleanMode}
      />
    </VoiceRuntimeContext.Provider>
  );
}
