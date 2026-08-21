import { useRef, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { audioInputEffectsManager } from "@/features/audio/services/AudioInputEffectsManager";
import { getOrCreateGlobalMixer } from "@/engine/effects/runtime/effectsArchitecture";
import { getWebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";
import { acquireCleanInput, type CleanInputReport } from "@/engine/audio";
import { isRoomPath } from "@/shared/constants";
import { applyVoiceInputGainDb } from "../utils/voiceGain";

interface UseAudioStreamProps {
  gain: number;
  cleanMode: boolean;
  autoGain: boolean;
  deviceId?: string | null | undefined;
  onStreamReady?: ((stream: MediaStream) => void) | undefined;
  onStreamRemoved?: (() => void) | undefined;
}

interface UseAudioStreamReturn {
  mediaStream: MediaStream | null;
  audioContext: AudioContext | null;
  gainNode: GainNode | null;
  processedOutputNode: AudioNode | null;
  monitorTapNode: AudioNode | null;
  analyser: AnalyserNode | null;
  micPermission: boolean;
  /** Input driver latency reported by the OS/hardware (seconds). Null until a stream is acquired. */
  inputDriverLatencySeconds: number | null;
  /** Whether the browser actually honoured the clean-input request. Null until a stream is acquired. */
  cleanInputReport: CleanInputReport | null;
  initializeAudioStream: (options?: { forceReinitialize?: boolean }) => Promise<void>;
  cleanup: () => void;
}

// Covers slow mobile Safari/iPad breakpoint reflow without retaining the mic
// long enough to mask real route leave or hard navigation cleanup.
const LAYOUT_TRANSITION_TEARDOWN_GRACE_MS = 3000;

interface RetainedVoiceRuntime {
  mediaStream: MediaStream;
  originalStream: MediaStream | null;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  gainNode: GainNode | null;
  processedOutputNode: AudioNode | null;
  monitorTapNode: AudioNode | null;
  micPermission: boolean;
  onStreamRemoved?: (() => void) | undefined;
  teardownTimer: ReturnType<typeof setTimeout> | null;
}

interface PendingVoiceRuntimeClaim {
  owner: symbol;
  claim: (runtime: RetainedVoiceRuntime) => void;
}

let retainedVoiceRuntime: RetainedVoiceRuntime | null = null;
let pendingVoiceRuntimeClaim: PendingVoiceRuntimeClaim | null = null;
let shouldImmediatelyTeardownNextVoiceUnmount = false;

const hasLiveAudioTrack = (stream: MediaStream | null): stream is MediaStream =>
  !!stream && stream.getAudioTracks().some((track) => track.readyState !== "ended");

/**
 * Reads the mounted flag through a call so TypeScript cannot narrow it across an `await` —
 * the whole point of the checkpoints below is that its value changes while we are suspended.
 */
const isStillMounted = (ref: { current: boolean }): boolean => ref.current;

const stopStream = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => {
    if (track.readyState !== "ended") {
      track.stop();
    }
  });
};

const detachAudioInputEffects = () => {
  try {
    audioInputEffectsManager.detachSource();
  } catch {
    /* noop */
  }
};

const releaseRetainedVoiceRuntime = (runtime: RetainedVoiceRuntime) => {
  stopStream(runtime.mediaStream);
  stopStream(runtime.originalStream);

  try {
    runtime.analyser?.disconnect();
  } catch {
    /* noop */
  }

  try {
    runtime.gainNode?.disconnect();
  } catch {
    /* noop */
  }

  detachAudioInputEffects();
  runtime.onStreamRemoved?.();

  if (retainedVoiceRuntime === runtime) {
    retainedVoiceRuntime = null;
  }
};

const cancelRetainedVoiceRuntimeTeardown = () => {
  if (retainedVoiceRuntime?.teardownTimer) {
    clearTimeout(retainedVoiceRuntime.teardownTimer);
    retainedVoiceRuntime.teardownTimer = null;
  }
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const __resetRetainedVoiceRuntimeForTests = () => {
  shouldImmediatelyTeardownNextVoiceUnmount = false;
  pendingVoiceRuntimeClaim = null;
  cancelRetainedVoiceRuntimeTeardown();
  stopStream(retainedVoiceRuntime?.mediaStream ?? null);
  stopStream(retainedVoiceRuntime?.originalStream ?? null);
  retainedVoiceRuntime = null;
};

// Assumes one active VoiceRuntimeProvider per room page. If multiple independent
// voice runtimes are introduced, replace this module signal with per-instance intent.
export const markNextVoiceInputUnmountForImmediateTeardown = () => {
  shouldImmediatelyTeardownNextVoiceUnmount = true;
};

export const useAudioStream = ({
  gain,
  cleanMode,
  autoGain,
  deviceId,
  onStreamReady,
  onStreamRemoved,
}: UseAudioStreamProps): UseAudioStreamReturn => {
  // Use useState for values that should trigger re-renders in consuming components
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [gainNode, setGainNode] = useState<GainNode | null>(null);
  const [processedOutputNode, setProcessedOutputNode] = useState<AudioNode | null>(null);
  const [monitorTapNode, setMonitorTapNode] = useState<AudioNode | null>(null);
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const [micPermission, setMicPermission] = useState<boolean>(false);
  // Input latency reported by the OS/hardware driver (seconds). Varies by device and OS.
  const [inputDriverLatencySeconds, setInputDriverLatencySeconds] = useState<number | null>(null);
  // What acquireCleanInput actually got the browser to do, so the UI can tell the user the
  // truth about clean mode instead of assuming the request succeeded.
  const [cleanInputReport, setCleanInputReport] = useState<CleanInputReport | null>(null);

  // Use refs for internal tracking that doesn't need re-renders
  const originalStreamRef = useRef<MediaStream | null>(null); // Keep reference to original stream
  const isReinitializingRef = useRef<boolean>(false);
  const isFirstRenderRef = useRef(true);
  const previousTrackEnabledRef = useRef<boolean>(false); // Track the previous enabled state
  const browserCapabilitiesRef = useRef(getWebRTCCapabilities());
  // Keep refs for cleanup purposes (to access current values in cleanup callbacks)
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processedOutputNodeRef = useRef<AudioNode | null>(null);
  const monitorTapNodeRef = useRef<AudioNode | null>(null);
  // False once this instance is really gone, so an acquisition still in flight can tell
  // whether anyone is left to own its stream (see initializeAudioStream). Deliberately not a
  // per-cleanup counter: StrictMode's mount → unmount → mount reuses these refs, and the
  // remounted instance still wants the stream its first pass asked for.
  const isMountedRef = useRef(true);
  const micPermissionRef = useRef(micPermission);
  const onStreamReadyRef = useRef(onStreamReady);
  const onStreamRemovedRef = useRef(onStreamRemoved);
  const instanceIdRef = useRef(Symbol("VoiceInput"));

  useEffect(() => {
    micPermissionRef.current = micPermission;
  }, [micPermission]);

  useEffect(() => {
    onStreamReadyRef.current = onStreamReady;
  }, [onStreamReady]);

  useEffect(() => {
    onStreamRemovedRef.current = onStreamRemoved;
  }, [onStreamRemoved]);

  // Browser-only layout effect: runtime handoff must run before paint so a
  // breakpoint remount can claim the retained stream before passive effects.
  useLayoutEffect(() => {
    let isMounted = true;
    isMountedRef.current = true;
    const instanceId = instanceIdRef.current;

    const claimRuntime = (runtime: RetainedVoiceRuntime) => {
      // A runtime that cannot be claimed must be released, never dropped: by the time we get
      // here the caller has already emptied the retained slot and cancelled the teardown
      // timer, so walking away would strand a live MediaStream that no later teardown can
      // reach — the mic would stay on for the rest of the page session.
      if (!isMounted || !hasLiveAudioTrack(runtime.mediaStream)) {
        releaseRetainedVoiceRuntime(runtime);
        return;
      }

      // Overlapping providers (responsive layout swap, ghost-room remount) can leave this
      // instance already holding its own live stream. Keep it and release the incoming one
      // rather than overwriting the refs, which would orphan whichever stream lost.
      if (
        hasLiveAudioTrack(mediaStreamRef.current) &&
        mediaStreamRef.current !== runtime.mediaStream
      ) {
        releaseRetainedVoiceRuntime(runtime);
        return;
      }

      if (runtime.teardownTimer) {
        clearTimeout(runtime.teardownTimer);
        runtime.teardownTimer = null;
      }

      mediaStreamRef.current = runtime.mediaStream;
      originalStreamRef.current = runtime.originalStream;
      audioContextRef.current = runtime.audioContext;
      analyserRef.current = runtime.analyser;
      gainNodeRef.current = runtime.gainNode;
      processedOutputNodeRef.current = runtime.processedOutputNode;
      monitorTapNodeRef.current = runtime.monitorTapNode;

      setMediaStream(runtime.mediaStream);
      setAudioContext(runtime.audioContext);
      setAnalyser(runtime.analyser);
      setGainNode(runtime.gainNode);
      setProcessedOutputNode(runtime.processedOutputNode);
      setMonitorTapNode(runtime.monitorTapNode);
      setMicPermission(runtime.micPermission);

      onStreamReadyRef.current?.(runtime.mediaStream);
    };

    const runtime = retainedVoiceRuntime;
    retainedVoiceRuntime = null;

    if (runtime && hasLiveAudioTrack(runtime.mediaStream)) {
      claimRuntime(runtime);
    } else {
      pendingVoiceRuntimeClaim = {
        owner: instanceId,
        claim: claimRuntime,
      };
    }

    return () => {
      isMounted = false;
      isMountedRef.current = false;
      if (pendingVoiceRuntimeClaim?.owner === instanceId) {
        pendingVoiceRuntimeClaim = null;
      }
    };
  }, []);

  // Initialize audio context and stream
  const initializeAudioStream = useCallback(async (options?: { forceReinitialize?: boolean }) => {
    if (hasLiveAudioTrack(mediaStreamRef.current) && !options?.forceReinitialize) {
      onStreamReadyRef.current?.(mediaStreamRef.current);
      return;
    }

    // Prevent concurrent reinitializations
    if (isReinitializingRef.current) {

      return;
    }

    isReinitializingRef.current = true;

    try {
      // Save the previous track enabled state before cleanup
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const wasPreviouslyEnabled = mediaStreamRef.current
        ? mediaStreamRef.current.getAudioTracks()[0]?.enabled ?? false
        : false;
      previousTrackEnabledRef.current = wasPreviouslyEnabled;

      // Clean up any existing resources first
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setMediaStream(null);
      }

      if (originalStreamRef.current) {
        originalStreamRef.current.getTracks().forEach((track) => track.stop());
        originalStreamRef.current = null;
      }

      audioInputEffectsManager.detachSource();

      if (gainNodeRef.current) {
        try {
          gainNodeRef.current.disconnect();
        } catch {
          /* noop */
        }
        gainNodeRef.current = null;
        setGainNode(null);
      }

      processedOutputNodeRef.current = null;
      setProcessedOutputNode(null);
      // The old stream is stopped above, but the previous report otherwise stays exposed across
      // the acquireCleanInput() permission round-trip below — the badge would briefly claim
      // "clean" for a microphone that is already dead. Blank it here too.
      setCleanInputReport(null);

      // One builder for every microphone in the app (engine/audio/cleanInput.ts). Voice keeps
      // the user's toggle; the report tells us what the browser actually did with it.
      const { stream, report } = await acquireCleanInput({
        cleanMode,
        channelCount: 1,
        ...(deviceId ? { deviceId } : {}),
        autoGain,
      });
      setCleanInputReport(report);

      // Unmounted while the permission/device round-trip was in flight. cleanup() ran before
      // this stream existed, so it found nothing to stop and nothing else will ever reach it:
      // stop it here, or the mic stays open for the rest of the page session. This is how a
      // live microphone survived leaving the room.
      if (!isStillMounted(isMountedRef)) {
        stopStream(stream);
        return;
      }

      // Store the original stream for cleanup
      originalStreamRef.current = stream;
      setMicPermission(true);

      // Read input driver latency reported by the OS/hardware.
      // `getSettings().latency` is in seconds (spec). Not all browsers/drivers expose it.
      const inputTrack = stream.getAudioTracks()[0];
      const reportedInputLatency = inputTrack
        ? ((inputTrack.getSettings() as Record<string, unknown>).latency as number | undefined) ?? null
        : null;
      setInputDriverLatencySeconds(reportedInputLatency);

      // Get the shared instrument audio context with ultra-low latency configuration
      let ctx: AudioContext;
      try {
        const { AudioContextManager } = await import("@/engine/audio");
        ctx = await AudioContextManager.getInstrumentContext();

      } catch (error) {
        console.warn(
          "Failed to get instrument AudioContext, creating ultra-low latency fallback:",
          error,
        );
        // Fallback: Create dedicated ultra-low latency context for voice
        // Use browser-specific optimal sample rate to avoid resampling latency
        const { optimalSampleRate } = browserCapabilitiesRef.current;

        ctx = new AudioContext({
            sampleRate: optimalSampleRate,
            latencyHint: "interactive", // Lowest latency hint available
          });

      }

      audioContextRef.current = ctx;
      setAudioContext(ctx);

      // iOS Safari: AudioContext starts suspended and requires user gesture to resume
      // This ensures audio works properly on iOS devices
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch (resumeError) {
          console.warn('Failed to resume AudioContext:', resumeError);
        }
      }

      await audioInputEffectsManager.initialize(ctx);

      const source = ctx.createMediaStreamSource(stream);

      // Create analyser with ultra-low latency settings
      const previousAnalyser = analyserRef.current;
      const newAnalyser = ctx.createAnalyser();
      newAnalyser.fftSize = 128; // Reduced from 256 to 128 for lower CPU usage (64 frequency bins)
      newAnalyser.smoothingTimeConstant = 0.6; // Faster response (reduced from 0.8)
      analyserRef.current = newAnalyser;
      setAnalyser(newAnalyser);

      // Create gain node for input gain control. `gain` prop is now dB (DEV-307); clamp to the
      // voice-input range (-60..+24) then convert to the linear multiplier the AudioParam expects.
      const newGainNode = ctx.createGain();
      newGainNode.gain.value = applyVoiceInputGainDb(gain);
      gainNodeRef.current = newGainNode;
      setGainNode(newGainNode);

      // Create a destination node to capture the processed audio
      // Safari/WebKit fallback: some older Safari versions may not support createMediaStreamDestination
      let destination: MediaStreamAudioDestinationNode | undefined;
      let processedStream: MediaStream;

      try {
        destination = ctx.createMediaStreamDestination();
        processedStream = destination.stream;
      } catch (destError) {
        console.warn('createMediaStreamDestination not supported, using original stream:', destError);
        // Fallback: Use the original stream directly (no local effects processing for WebRTC)
        // This is a graceful degradation for older Safari/WebKit
        processedStream = stream;
        destination = undefined;
      }

      // Build the processing graph: source -> gain -> effects -> analyser -> destination
      //
      // DSP effects (reverb, compression, etc.) are intentional sound design applied
      // at the source machine and sent pre-processed over WebRTC. This avoids the
      // O(N²) CPU cost of having every remote peer apply effects to every track.
      // Clean mode only disables hardware-level processing (getUserMedia constraints),
      // NOT the software DSP chain.
      source.connect(newGainNode);

      audioInputEffectsManager.attachSource(newGainNode);
      const effectsOutputNode = audioInputEffectsManager.getOutputNode();

      // Detach ONLY the previous analyser edge. `effectsOutputNode` is a long-lived
      // singleton owned by AudioInputEffectsManager, and other features tap it — most
      // notably the self-monitor branch (effectsOutput → monitoringGain → speakers) in
      // useVoiceControls. A bare `.disconnect()` here would sever those too, leaving
      // self-monitoring silently dead after any reinit (clean mode / autoGain / device).
      if (previousAnalyser && previousAnalyser !== newAnalyser) {
        try {
          effectsOutputNode.disconnect(previousAnalyser);
        } catch {
          // ignore if that edge no longer exists
        }
        try {
          previousAnalyser.disconnect();
        } catch {
          // ignore if the stale analyser has no outgoing connections
        }
      }

      effectsOutputNode.connect(newAnalyser);

      // Only connect to destination if we successfully created it
      if (destination) {
        newAnalyser.connect(destination);
      }

      processedOutputNodeRef.current = effectsOutputNode;
      setProcessedOutputNode(effectsOutputNode);

      // Attempt to fetch monitor tap from global mixer so local monitoring hears effect chain
      try {
        const mixer = await getOrCreateGlobalMixer();
        const monitorTap = mixer.getChannelMonitorTap("local-user") ?? null;
        monitorTapNodeRef.current = monitorTap;
        setMonitorTapNode(monitorTap);
      } catch (error) {
        console.warn("Failed to acquire mixer monitor tap", error);
        monitorTapNodeRef.current = null;
        setMonitorTapNode(null);
      }

      // Copy video tracks if any (shouldn't be any for audio-only, but just in case)
      const videoTracks = stream.getVideoTracks();
      videoTracks.forEach((track) => processedStream.addTrack(track));

      // Second checkpoint: the graph build above awaits the AudioContext, the effects
      // manager and the mixer, so the unmount can land in there too — and a dead instance
      // must not publish a stream nobody is left to release.
      if (!isStillMounted(isMountedRef)) {
        stopStream(stream);
        stopStream(processedStream);
        return;
      }

      // Store the processed stream instead of the raw stream
      mediaStreamRef.current = processedStream;
      setMediaStream(processedStream);

      // Set track enabled state based on previous state or default to disabled
      // This preserves the mute state when reinitializing due to settings changes
      try {
        const processedTrack = processedStream.getAudioTracks()[0];
        if (processedTrack) {
          processedTrack.enabled = previousTrackEnabledRef.current;

        }
      } catch {
        // ignore if no track available
      }

      // Notify parent about the processed stream (this is what gets sent to other users)
      retainedVoiceRuntime = null;
      onStreamReadyRef.current?.(processedStream);

      // Log latency metrics for monitoring

    } catch (error) {
      console.error("Failed to initialize voice input:", error);
      // Reset states on error
      setMicPermission(false);
      setMediaStream(null);
      mediaStreamRef.current = null;
      setAudioContext(null);
      audioContextRef.current = null;
      setAnalyser(null);
      analyserRef.current = null;
      setGainNode(null);
      gainNodeRef.current = null;
      setProcessedOutputNode(null);
      processedOutputNodeRef.current = null;
      setInputDriverLatencySeconds(null);
      setCleanInputReport(null);
      detachAudioInputEffects();
    } finally {
      // Always reset the reinitializing flag
      isReinitializingRef.current = false;
    }
  }, [gain, cleanMode, autoGain, deviceId]);

  // Cleanup function
  const cleanup = useCallback((options?: { deferForLayoutTransition?: boolean }) => {
    if (options?.deferForLayoutTransition && hasLiveAudioTrack(mediaStreamRef.current)) {
      // The slot holds one runtime. Anything already parked there is released — not merely
      // stripped of its teardown timer — so overwriting can never strand a live stream.
      const previouslyRetained = retainedVoiceRuntime;
      cancelRetainedVoiceRuntimeTeardown();
      if (previouslyRetained && previouslyRetained.mediaStream !== mediaStreamRef.current) {
        releaseRetainedVoiceRuntime(previouslyRetained);
      }

      const runtime: RetainedVoiceRuntime = {
        mediaStream: mediaStreamRef.current,
        originalStream: originalStreamRef.current,
        audioContext: audioContextRef.current,
        analyser: analyserRef.current,
        gainNode: gainNodeRef.current,
        processedOutputNode: processedOutputNodeRef.current,
        monitorTapNode: monitorTapNodeRef.current,
        micPermission: micPermissionRef.current,
        onStreamRemoved: onStreamRemovedRef.current,
        teardownTimer: null,
      };

      const pendingClaim = pendingVoiceRuntimeClaim;
      if (pendingClaim && pendingClaim.owner !== instanceIdRef.current) {
        pendingVoiceRuntimeClaim = null;
        pendingClaim.claim(runtime);
        return;
      }

      runtime.teardownTimer = setTimeout(() => {
        if (retainedVoiceRuntime === runtime) {
          releaseRetainedVoiceRuntime(runtime);
        }
      }, LAYOUT_TRANSITION_TEARDOWN_GRACE_MS);

      retainedVoiceRuntime = runtime;
      return;
    }

    const pendingRuntime = retainedVoiceRuntime;
    retainedVoiceRuntime = null;
    if (pendingVoiceRuntimeClaim?.owner === instanceIdRef.current) {
      pendingVoiceRuntimeClaim = null;
    }

    if (pendingRuntime?.teardownTimer) {
      clearTimeout(pendingRuntime.teardownTimer);
      pendingRuntime.teardownTimer = null;
      releaseRetainedVoiceRuntime(pendingRuntime);
    }

    if (mediaStreamRef.current) {

      stopStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
      setMediaStream(null);
      onStreamRemovedRef.current?.();
    }

    if (originalStreamRef.current) {

      stopStream(originalStreamRef.current);
      originalStreamRef.current = null;
    }

    detachAudioInputEffects();

    // DON'T close the audioContext because it's shared via AudioContextManager
    // The AudioContextManager will handle context lifecycle

    // Reset all refs and state to null after cleanup. Drop the analyser's incoming edge
    // too — the effects output node outlives this hook, so leaving effectsOutput → analyser
    // attached would strand a dead sink on the shared singleton.
    if (analyserRef.current) {
      try {
        processedOutputNodeRef.current?.disconnect(analyserRef.current);
      } catch {
        /* noop */
      }
      try {
        analyserRef.current.disconnect();
      } catch {
        /* noop */
      }
    }
    audioContextRef.current = null;
    setAudioContext(null);
    analyserRef.current = null;
    setAnalyser(null);
    gainNodeRef.current = null;
    setGainNode(null);
    processedOutputNodeRef.current = null;
    setProcessedOutputNode(null);
    monitorTapNodeRef.current = null;
    setMonitorTapNode(null);
    setMicPermission(false); // Reset mic permission state
    setInputDriverLatencySeconds(null);
    setCleanInputReport(null);
  }, []);

  // Update audio constraints when settings change by reinitializing the stream
  // This ensures constraints take effect immediately, especially on Chrome
  useEffect(() => {
    // Skip on first render (initial mount) - auto-connect handles the first initialization
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    // Skip if already reinitializing or no active stream
    if (isReinitializingRef.current || !originalStreamRef.current || !micPermission) {
      return;
    }

    // When cleanMode or autoGain changes, reinitialize the stream with new constraints
    // This is necessary because:
    // 1. Chrome doesn't always apply constraints immediately via applyConstraints()
    // 2. We need to recreate the entire audio processing graph with new settings
    // 3. The new stream will automatically replace tracks in peer connections

    void initializeAudioStream({ forceReinitialize: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanMode, autoGain, deviceId]);

  // Cleanup on unmount
  // Browser-only layout effect paired with the runtime-claim effect above.
  useLayoutEffect(() => {
    return () => {
      if (shouldImmediatelyTeardownNextVoiceUnmount) {
        shouldImmediatelyTeardownNextVoiceUnmount = false;
        cleanup();
        return;
      }

      // The grace window only pays for itself while another runtime can still claim the
      // stream — a breakpoint remount inside this room, or the room→room handoff. Once
      // the router has left every room route (Leave, browser Back, redirect, kick) there
      // is no claimant, and holding the mic just keeps the browser's recording indicator
      // lit after the user has already left. Read `window.location` rather than a router
      // hook: history is updated before React commits the unmount, so this sees the
      // destination, while `useLocation()` would still report the room we are leaving.
      if (!isRoomPath(window.location.pathname)) {
        cleanup();
        return;
      }

      cleanup({ deferForLayoutTransition: true });
    };
  }, [cleanup]);

  return {
    mediaStream,
    audioContext,
    gainNode,
    processedOutputNode,
    monitorTapNode,
    analyser,
    micPermission,
    inputDriverLatencySeconds,
    cleanInputReport,
    initializeAudioStream,
    cleanup,
  };
};
