import { getWebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";

// Application-wide polyphony specification
export const APP_MAX_POLYPHONY = 16; // Maximum simultaneous notes per user across all browsers and synth types

// Preferred sample rate for all audio contexts.
// 48 kHz is the sweet spot: half the CPU of 96 kHz, covers full human hearing range (Nyquist = 24 kHz),
// and avoids the sample-rate conversion penalty when mixing with WebRTC (which also runs at 48 kHz).
// NOTE: Browsers may silently ignore this hint — macOS follows the system Audio MIDI Setup device setting.
export const PREFERRED_SAMPLE_RATE = 48000;

// Audio configuration for ultra-low latency optimization with separate contexts
export const AUDIO_CONFIG = {
  // Tone.js context settings for instruments
  TONE_CONTEXT: {
    // Ultra-low values for minimum latency
    lookAhead: 0.005, // 5ms (reduced from 10ms)
    updateInterval: 0.005, // 5ms (reduced from 10ms)
  },

  // Web Audio API context settings for instruments
  INSTRUMENT_AUDIO_CONTEXT: {
    sampleRate: 48000, // Match WebRTC sample rate to avoid conversion overhead
    latencyHint: "interactive" as AudioContextLatencyCategory, // Optimized for low latency
  },

  // Web Audio API context settings for WebRTC - Ultra-low latency mode
  WEBRTC_AUDIO_CONTEXT: {
    sampleRate: 48000, // WebRTC preferred sample rate
    latencyHint: "interactive" as AudioContextLatencyCategory, // Lowest latency for real-time performance
  },

  // Synthesizer timing settings - Ultra-responsive
  SYNTHESIZER: {
    noteRetriggerDelay: 1, // Reduced delay from 2ms to 1ms
    envelopeAttackMin: 0.0005, // Reduced from 0.001s for ultra-fast response
  },

  // Performance settings
  PERFORMANCE: {
    cleanupInterval: 4000, // More frequent cleanup (reduced from 5000ms)
  },

  // Enhanced audio node pooling configuration
  NODE_POOL: {
    maxGainNodes: 50,
    maxOscillatorNodes: 20,
    maxAnalyserNodes: 10,
    maxBufferSourceNodes: 30,
    cleanupInterval: 10000, // Clean unused nodes every 10s
  },

  // Master audio bus configuration for future effects/mixer
  MASTER_BUS: {
    enabled: true,
    // masterGainLevel REMOVED (DEV-306) — the store's DEFAULT_MASTER_VOLUME_DB
    // (app/frontend/src/shared/audio/masterVolume.ts, re-exported from the arrange project
    // store) is now the single source of truth for the master gain default. This file used to
    // also set a default (0.8) that MasterChannel.tsx silently overwrote to 1.0 on mount — two
    // sources of truth, picked by component mount order. Fixed by deleting this one.
    busRouting: {
      instruments: "master",
      metronome: "master",
      voice: "direct", // WebRTC bypasses master bus for lowest latency
    },
    // NO limiter, and nothing else corrective, lives on the master bus (DEV-322). The
    // DynamicsCompressorNode that used to sit here could not deliver the ceiling it claimed
    // (3 ms attack lets transients through) and a look-ahead limiter would add latency the
    // Perform room cannot take. murva measures level honestly and lets the user fix it —
    // see TR-40. Do not reintroduce a limiter, auto-gain, or auto-trim here.
    effects: {
      // Future effects configuration (dead placeholder — read by nothing, kept for reference)
      reverb: { enabled: false, wetLevel: 0.3 },
      delay: { enabled: false, time: 0.25, feedback: 0.3 },
      compressor: { enabled: false, threshold: -24, ratio: 4 },
    },
  },
};

// Adaptive audio configuration based on mesh size
export const ADAPTIVE_AUDIO_CONFIG = {
  // Small mesh (1-3 users): Ultra-low latency priority
  SMALL_MESH: {
    maxUsers: 3,
    sampleSize: 128,
    bufferSize: 128,
    lookAhead: 0.002, // 2ms
    updateInterval: 0.002, // 2ms
    quality: "ultra-low-latency",
    description: "Ultra-low latency mode for small groups",
    latencyTarget: "5-8ms",
    cpuTarget: "20-40%",
  },

  // Medium mesh (4-6 users): Balanced approach
  MEDIUM_MESH: {
    maxUsers: 6,
    sampleSize: 256,
    bufferSize: 256,
    lookAhead: 0.003, // 3ms
    updateInterval: 0.003, // 3ms
    quality: "balanced",
    description: "Balanced latency and quality for medium groups",
    latencyTarget: "8-12ms",
    cpuTarget: "40-60%",
  },

  // Large mesh (7-10 users): Stability priority
  LARGE_MESH: {
    maxUsers: 10,
    sampleSize: 512,
    bufferSize: 512,
    lookAhead: 0.004, // 4ms
    updateInterval: 0.004, // 4ms
    quality: "stable",
    description: "Stable performance for large groups",
    latencyTarget: "12-18ms",
    cpuTarget: "60-80%",
  },
};

// Helper function to get optimal settings based on device capability
export const getOptimalAudioConfig = () => {
  const { isSafari } = getWebRTCCapabilities();

  // Check if device supports low latency
  const hasLowLatency =
    "AudioContext" in window && typeof AudioContext !== "undefined";

  // Check if device supports 48kHz sample rate (most modern devices do)
  const has48kHz = (() => {
    try {
      const TestCtx = AudioContext;

      const testContext = new TestCtx();
      const hasSupport = testContext.sampleRate >= 48000;
      void testContext.close();
      return hasSupport;
    } catch {
      return false;
    }
  })();

  if (!hasLowLatency) {
    return {
      ...AUDIO_CONFIG,
      TONE_CONTEXT: {
        lookAhead: 0.05, // Higher latency for compatibility
        updateInterval: 0.025,
      },
      INSTRUMENT_AUDIO_CONTEXT: {
        sampleRate: has48kHz ? 48000 : 44100, // Fallback to 44.1kHz if needed
        latencyHint: "balanced" as AudioContextLatencyCategory,
      },
    };
  }

  // Safari-specific optimizations
  if (isSafari) {
    return {
      ...AUDIO_CONFIG,
      TONE_CONTEXT: {
        lookAhead: 0.008, // Slightly higher than Chrome for stability (8ms vs 5ms)
        updateInterval: 0.008, // Slightly higher than Chrome for stability
      },
      INSTRUMENT_AUDIO_CONTEXT: {
        sampleRate: 48000, // Safari works best with 48kHz
        latencyHint: "playback" as AudioContextLatencyCategory, // More stable than 'interactive' on Safari
      },
      // DEV-257 experiment: voice is the latency-critical path — 'interactive'
      // to match webkitCompat.createWebKitCompatibleAudioContext (the actual
      // Safari voice-context factory; this entry documents intent for
      // non-Safari WebKit). Instruments above deliberately keep 'playback'.
      // Revert both together if Safari voice playback glitches on real devices.
      WEBRTC_AUDIO_CONTEXT: {
        sampleRate: 48000,
        latencyHint: "interactive" as AudioContextLatencyCategory,
      },
    };
  }

  // Return optimal configuration for Chrome/Edge
  return {
    ...AUDIO_CONFIG,
    INSTRUMENT_AUDIO_CONTEXT: {
      sampleRate: has48kHz ? 48000 : 44100,
      latencyHint: "interactive" as AudioContextLatencyCategory,
    },
  };
};

// Helper function to get adaptive audio configuration based on mesh size
export const getAdaptiveAudioConfig = (userCount: number) => {
  if (userCount <= ADAPTIVE_AUDIO_CONFIG.SMALL_MESH.maxUsers) {
    return ADAPTIVE_AUDIO_CONFIG.SMALL_MESH;
  } else if (userCount <= ADAPTIVE_AUDIO_CONFIG.MEDIUM_MESH.maxUsers) {
    return ADAPTIVE_AUDIO_CONFIG.MEDIUM_MESH;
  } else {
    return ADAPTIVE_AUDIO_CONFIG.LARGE_MESH;
  }
};

// Helper function to check if quality should be reduced
export const shouldReduceQuality = (
  userCount: number,
  currentLatency: number,
  cpuUsage?: number,
) => {
  const config = getAdaptiveAudioConfig(userCount);
  const latencyTarget = Number.parseFloat(config.latencyTarget.split("-")[1] ?? "0");

  // If latency exceeds thresholds for current mesh size, reduce quality
  if (currentLatency > latencyTarget) {
    return true;
  }

  // If CPU usage is high, reduce quality

  if (cpuUsage != null && cpuUsage > 80) {
    return true;
  }

  return false;
};

// Helper function to get performance metrics
export const getPerformanceMetrics = () => {
  return {
    timestamp: Date.now(),
    userAgent: navigator.userAgent,
    audioContext: {
      supported: "AudioContext" in window || "webkitAudioContext" in window,

      workletSupported:
        "audioWorklet" in AudioContext.prototype,
    },
    hardware: {
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      cores: navigator.hardwareConcurrency || "unknown",
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory || "unknown",
    },
  };
};
