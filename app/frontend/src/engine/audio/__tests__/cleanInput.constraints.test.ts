import { describe, it, expect } from "vitest";
import { buildInputConstraints, type CleanInputEnv } from "../cleanInput";
import type { WebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";

const BASE_CAPS: WebRTCCapabilities = {
  useOnTrackAsConnectedSignal: true,
  hasReliableConnectionState: true,
  rttPrimaryStrategy: "datachannel",
  requiresSyncAudioResume: false,
  isIOS: false,
  isAndroid: false,
  isWebKit: false,
  isSafari: false,
  browserType: "chrome",
  isMacOS: true,
  isWindows: false,
  optimalSampleRate: 48000,
  supportsAudioWorklet: true,
  supportsGoogConstraints: true,
  supportsVoiceIsolation: true,
  supportsRemoteStreamWebAudio: true,
  cleanModeLatencyHint: 0.005,
  normalModeLatencyHint: 0.01,
  isLocalOrE2E: false,
};

const CHROME: CleanInputEnv = {
  supported: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    voiceIsolation: true,
    latency: true,
    sampleRate: true,
    channelCount: true,
  } as MediaTrackSupportedConstraints,
  capabilities: BASE_CAPS,
};

const FIREFOX: CleanInputEnv = {
  supported: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: true,
  } as MediaTrackSupportedConstraints,
  capabilities: { ...BASE_CAPS, browserType: "firefox", supportsGoogConstraints: false, supportsVoiceIsolation: false },
};

const WEBKIT: CleanInputEnv = {
  supported: {
    echoCancellation: true,
    sampleRate: true,
  } as MediaTrackSupportedConstraints,
  capabilities: {
    ...BASE_CAPS,
    browserType: "safari",
    isSafari: true,
    isWebKit: true,
    supportsGoogConstraints: false,
    supportsVoiceIsolation: false,
    optimalSampleRate: 44100,
    cleanModeLatencyHint: 0.02,
    normalModeLatencyHint: 0.03,
  },
};

describe("buildInputConstraints — clean mode", () => {
  it("disables every processing stage the browser exposes (Chromium)", () => {
    const c = buildInputConstraints({ cleanMode: true, channelCount: 2 }, CHROME);
    expect(c.echoCancellation).toBe(false);
    expect(c.noiseSuppression).toBe(false);
    expect(c.autoGainControl).toBe(false);
    expect((c as Record<string, unknown>)["voiceIsolation"]).toBe(false);
    expect(c.channelCount).toBe(2);
  });

  it("omits constraints the browser does not expose (WebKit has no NS/AGC/voiceIsolation)", () => {
    const c = buildInputConstraints({ cleanMode: true, channelCount: 2 }, WEBKIT);
    expect(c.echoCancellation).toBe(false);
    expect("noiseSuppression" in c).toBe(false);
    expect("autoGainControl" in c).toBe(false);
    expect("voiceIsolation" in c).toBe(false);
  });

  it("never sets sampleRate on WebKit, where it breaks getUserMedia", () => {
    const c = buildInputConstraints({ cleanMode: true, channelCount: 1 }, WEBKIT);
    expect("sampleRate" in c).toBe(false);
  });

  it("sets the capability profile sample rate elsewhere", () => {
    const c = buildInputConstraints({ cleanMode: true, channelCount: 1 }, CHROME);
    expect(c.sampleRate).toBe(48000);
  });

  it("omits latency on Firefox, which does not expose it", () => {
    const c = buildInputConstraints({ cleanMode: true, channelCount: 1 }, FIREFOX);
    expect("latency" in c).toBe(false);
  });

  it("uses the clean-mode latency hint where latency is exposed", () => {
    const c = buildInputConstraints({ cleanMode: true, channelCount: 1 }, CHROME);
    expect((c as Record<string, unknown>)["latency"]).toBe(0.005);
  });

  it("passes deviceId through as an exact constraint", () => {
    const c = buildInputConstraints({ cleanMode: true, channelCount: 1, deviceId: "mic-7" }, CHROME);
    expect(c.deviceId).toEqual({ exact: "mic-7" });
  });
});

describe("buildInputConstraints — normal mode", () => {
  it("enables processing and honours the autoGain preference", () => {
    const c = buildInputConstraints({ cleanMode: false, channelCount: 1, autoGain: true }, CHROME);
    expect(c.echoCancellation).toBe(true);
    expect(c.noiseSuppression).toBe(true);
    expect(c.autoGainControl).toBe(true);
    expect((c as Record<string, unknown>)["voiceIsolation"]).toBe(true);
    expect((c as Record<string, unknown>)["latency"]).toBe(0.01);
  });

  it("leaves autoGainControl off when the user disabled auto gain", () => {
    const c = buildInputConstraints({ cleanMode: false, channelCount: 1, autoGain: false }, CHROME);
    expect(c.autoGainControl).toBe(false);
  });

  it("forces autoGainControl off in clean mode regardless of the preference", () => {
    const c = buildInputConstraints({ cleanMode: true, channelCount: 1, autoGain: true }, CHROME);
    expect(c.autoGainControl).toBe(false);
  });
});
