import { useCallback, useEffect } from "react";
import type { VoiceState } from "../index";

interface UseVoiceInputHandlersProps {
  voiceState: VoiceState;
  activeBandMemberCount: number | undefined;
  mediaStream: MediaStream | null;
  // Audio stream controls
  initializeAudioStream: () => Promise<void>;
  cleanup: () => void;
  startInputLevelMonitoring: () => void;
  stopInputLevelMonitoring: () => void;
  // Lower-level audio controls
  handleMuteToggle: () => Promise<void>;
  handleGainChange: (gain: number) => void;
  handleSelfMonitorToggle: () => void;
  // Store setters
  setMuted: (v: boolean) => void;
  setGain: (v: number) => void;
  setConnected: (v: boolean) => void;
  setSelfMonitoring: (v: boolean) => void;
  setCleanMode: (v: boolean) => void;
  setAutoGain: (v: boolean) => void;
  setHasSeenHeadphoneModal: (v: boolean) => void;
  setShowHeadphoneModal: (v: boolean) => void;
}

export function useVoiceInputHandlers({
  voiceState,
  activeBandMemberCount,
  mediaStream,
  initializeAudioStream,
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
  setShowHeadphoneModal,
}: UseVoiceInputHandlersProps) {
  const ROOM_FULL_MSG = "ห้องเต็มแล้ว (10/10 active members) - ไม่สามารถเปิด voice input ได้";

  const handleConnect = useCallback(async () => {
    if (activeBandMemberCount !== undefined && activeBandMemberCount >= 10) {
      alert(ROOM_FULL_MSG);
      return;
    }
    if (!voiceState.isConnected) {
      await initializeAudioStream();
      if (!voiceState.isMuted) {
        startInputLevelMonitoring();
      }
    }
  }, [voiceState.isConnected, voiceState.isMuted, initializeAudioStream, startInputLevelMonitoring, activeBandMemberCount]);

  const handleDisconnect = useCallback(() => {
    if (voiceState.isConnected) {
      cleanup();
      setConnected(false);
      stopInputLevelMonitoring();
    }
  }, [voiceState.isConnected, cleanup, setConnected, stopInputLevelMonitoring]);

  const handleMuteToggleWithState = useCallback(async () => {
    if (voiceState.isMuted && activeBandMemberCount !== undefined && activeBandMemberCount >= 10) {
      alert(ROOM_FULL_MSG);
      return;
    }
    await handleMuteToggle();
    setMuted(!voiceState.isMuted);
  }, [handleMuteToggle, setMuted, voiceState.isMuted, activeBandMemberCount]);

  const handleGainChangeWithState = useCallback(
    (newGain: number) => {
      handleGainChange(newGain);
      setGain(newGain);
    },
    [handleGainChange, setGain],
  );

  const handleSelfMonitorToggleWithState = useCallback(() => {
    handleSelfMonitorToggle();
    setSelfMonitoring(!voiceState.isSelfMonitoring);
  }, [handleSelfMonitorToggle, setSelfMonitoring, voiceState.isSelfMonitoring]);

  const handleCleanModeToggle = useCallback(() => {
    if (!voiceState.cleanMode && !voiceState.hasSeenHeadphoneModal) {
      setShowHeadphoneModal(true);
      return;
    }
    setCleanMode(!voiceState.cleanMode);
  }, [voiceState.cleanMode, voiceState.hasSeenHeadphoneModal, setCleanMode, setShowHeadphoneModal]);

  const handleProceedCleanMode = useCallback(() => {
    setShowHeadphoneModal(false);
    setHasSeenHeadphoneModal(true);
    setCleanMode(true);
  }, [setCleanMode, setHasSeenHeadphoneModal, setShowHeadphoneModal]);

  const handleCancelCleanMode = useCallback(() => {
    setShowHeadphoneModal(false);
  }, [setShowHeadphoneModal]);

  // Enforce auto gain: clean mode OFF → auto gain ON, clean mode ON → auto gain OFF
  useEffect(() => {
    if (voiceState.cleanMode) {
      if (voiceState.autoGain) setAutoGain(false);
    } else {
      if (!voiceState.autoGain) setAutoGain(true);
    }
  }, [voiceState.cleanMode, voiceState.autoGain, setAutoGain]);

  // Re-enable track when user unmutes on a fresh stream (reconnection case)
  useEffect(() => {
    if (mediaStream && !voiceState.isMuted && voiceState.isConnected) {
      const audioTrack = mediaStream.getAudioTracks()[0];
      if (audioTrack && !audioTrack.enabled) {
        audioTrack.enabled = true;
        startInputLevelMonitoring();
      }
    }
  }, [mediaStream, voiceState.isMuted, voiceState.isConnected, startInputLevelMonitoring]);

  return {
    handleConnect,
    handleDisconnect,
    handleMuteToggleWithState,
    handleGainChangeWithState,
    handleSelfMonitorToggleWithState,
    handleCleanModeToggle,
    handleProceedCleanMode,
    handleCancelCleanMode,
  };
}
