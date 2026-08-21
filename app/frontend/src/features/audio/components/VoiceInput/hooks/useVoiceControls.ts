import { useCallback, useRef, useEffect } from "react";
import { applyVoiceInputGainDb, applyMonitorLevelDb } from "../utils/voiceGain";

interface UseVoiceControlsProps {
  audioContext: AudioContext | null;
  gainNode: GainNode | null;
  monitorNode: AudioNode | null;
  mediaStream: MediaStream | null;
  micPermission: boolean;
  isMuted: boolean;
  isSelfMonitoring: boolean;
  /** Self-monitoring playback level (dB, DEV-307 review fix — was 0..1 linear). Converted to
   *  a linear GainNode multiplier via applyMonitorLevelDb at the AudioParam write boundary
   *  (TR-40). Applied live while monitoring is active. */
  monitorLevel: number;
  initializeAudioStream: () => Promise<void>;
  startInputLevelMonitoring: () => void;
  stopInputLevelMonitoring: () => void;
}

interface UseVoiceControlsReturn {
  handleMuteToggle: () => Promise<void>;
  handleGainChange: (newGain: number) => void;
  handleSelfMonitorToggle: () => void;
}

export const useVoiceControls = ({
  audioContext,
  gainNode,
  monitorNode,
  mediaStream,
  micPermission,
  isMuted,
  isSelfMonitoring,
  monitorLevel,
  initializeAudioStream,
  startInputLevelMonitoring,
  stopInputLevelMonitoring,
}: UseVoiceControlsProps): UseVoiceControlsReturn => {
  // Keep a reference to the monitoring connection
  const monitoringConnectionRef = useRef<{ node: AudioNode; gain: GainNode } | null>(null);

  // Read the latest monitor level from a ref so `handleSelfMonitorToggle` stays stable
  // across slider drags; live changes while monitoring are applied by the effect below.
  const monitorLevelRef = useRef(monitorLevel);

  // Handle mute/unmute toggle
  const handleMuteToggle = useCallback(async () => {
    const isNowMuted = !isMuted;

    if (!isNowMuted && (!micPermission || !mediaStream)) {
      // Unmuting but no stream available - initialize audio stream

      await initializeAudioStream();
      // The new stream will be created with track disabled, so we need to enable it
      // This will be handled by the effect in the parent component
    } else if (!isNowMuted && micPermission && mediaStream) {
      // Already have permission and stream, just enable the track

      const audioTrack = mediaStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = true;
      }
      startInputLevelMonitoring();
    } else if (isNowMuted && mediaStream) {
      // Muting - disable track but don't destroy stream

      const audioTrack = mediaStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = false;
      }
      stopInputLevelMonitoring();
    }
  }, [
    isMuted,
    micPermission,
    mediaStream,
    initializeAudioStream,
    startInputLevelMonitoring,
    stopInputLevelMonitoring,
  ]);

  // Handle gain adjustment. `newGain` is dB (DEV-307); clamp to the voice-input range then
  // convert to the linear multiplier the GainNode AudioParam expects.
  const handleGainChange = useCallback(
    (newGainDb: number) => {
      if (gainNode) {
        gainNode.gain.value = applyVoiceInputGainDb(newGainDb);
      }
    },
    [gainNode],
  );

  // Handle self-monitoring toggle
  const handleSelfMonitorToggle = useCallback(() => {
    if (!audioContext || !monitorNode) {

      return;
    }

    try {
      if (!isSelfMonitoring) {
        // Enable self-monitoring: add monitoring connection to speakers
        // Create a monitoring gain node to control self-monitoring volume
        // This allows hearing yourself at the input gain level but with volume control
        if (monitoringConnectionRef.current) {
          try {
            monitoringConnectionRef.current.node.disconnect(
              monitoringConnectionRef.current.gain,
            );
          } catch {
            /* noop */
          }

          try {
            monitoringConnectionRef.current.gain.disconnect(
              audioContext.destination,
            );
          } catch {
            /* noop */
          }

          monitoringConnectionRef.current = null;
        }

        const monitoringGain = audioContext.createGain();
        // User-controlled level (dB, DEV-307 review fix); convert to linear at this AudioParam
        // write boundary (TR-40). Default is a feedback-safe ~-4.4dB, unity (0dB) is opt-in.
        monitoringGain.gain.value = applyMonitorLevelDb(monitorLevelRef.current);

        // Connect the effects output (monitorNode) to the monitoring gain, then to speakers.
        // This adds a path: effectsOutput -> monitoringGain -> destination (speakers). The
        // original path (effectsOutput -> analyser + WebRTC destination) remains intact.
        monitorNode.connect(monitoringGain);
        monitoringGain.connect(audioContext.destination);

        // Store reference for cleanup
        monitoringConnectionRef.current = {
          node: monitorNode,
          gain: monitoringGain,
        };


      } else {
        // Disable self-monitoring: remove only the monitoring connection
        const monitoringConnection = monitoringConnectionRef.current;

        if (monitoringConnection) {
          try {
            monitoringConnection.node.disconnect(monitoringConnection.gain);
          } catch {
            /* noop */
          }

          try {
            monitoringConnection.gain.disconnect(audioContext.destination);
          } catch {
            /* noop */
          }

          monitoringConnectionRef.current = null;
        }
      }
    } catch (error) {
      console.error("❌ Error toggling self-monitoring:", error);
    }
  }, [audioContext, monitorNode, isSelfMonitoring]);

  // Live-apply monitor level while self-monitoring is active. Ramp with a short time
  // constant instead of a hard set so dragging the slider doesn't zipper/click the audio.
  // `monitorLevel` is dB (DEV-307 review fix); convert to linear at this AudioParam write
  // boundary (TR-40) — same pattern as applyVoiceInputGainDb for the input-gain side.
  useEffect(() => {
    monitorLevelRef.current = monitorLevel;
    const connection = monitoringConnectionRef.current;
    if (connection && audioContext) {
      connection.gain.gain.setTargetAtTime(
        applyMonitorLevelDb(monitorLevel),
        audioContext.currentTime,
        0.02,
      );
    }
  }, [monitorLevel, audioContext]);

  // Cleanup monitoring connection on unmount or when audioContext changes
  useEffect(() => {
    return () => {
      const monitoringConnection = monitoringConnectionRef.current;
      if (monitoringConnection) {
        try {
          monitoringConnection.node.disconnect(monitoringConnection.gain);
        } catch {
          /* noop */
        }
        try {
          monitoringConnection.gain.disconnect();
        } catch {
          /* noop */
        }
        monitoringConnectionRef.current = null;
      }
    };
  }, [audioContext]);

  return {
    handleMuteToggle,
    handleGainChange,
    handleSelfMonitorToggle,
  };
};
