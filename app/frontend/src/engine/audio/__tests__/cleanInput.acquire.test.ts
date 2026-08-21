import { describe, it, expect, vi, afterEach } from "vitest";
import { acquireCleanInput, verifyCleanInput, type CleanInputEnv } from "../cleanInput";
import type { WebRTCCapabilities } from "@/shared/webrtc/webrtcCapabilities";

const CAPS: WebRTCCapabilities = {
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
  supportsGoogConstraints: false,
  supportsVoiceIsolation: true,
  supportsRemoteStreamWebAudio: true,
  cleanModeLatencyHint: 0.005,
  normalModeLatencyHint: 0.01,
  isLocalOrE2E: false,
};

const ENV: CleanInputEnv = {
  supported: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: true,
  } as MediaTrackSupportedConstraints,
  capabilities: CAPS,
};

function trackWithSettings(settings: Record<string, unknown>): Pick<MediaStreamTrack, "getSettings"> {
  return { getSettings: () => settings };
}

function streamWith(track: Pick<MediaStreamTrack, "getSettings">) {
  return { getAudioTracks: () => [track], getTracks: () => [track] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyCleanInput", () => {
  it("reports clean when every requested stage reads back disabled", () => {
    const track = trackWithSettings({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    const report = verifyCleanInput(track, { cleanMode: true, channelCount: 2 }, ENV);
    expect(report.verdict).toBe("clean");
    expect(report.unsupported).toEqual(["voiceIsolation"]);
  });

  it("reports partial when the browser kept a stage on", () => {
    const track = trackWithSettings({
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
    });
    const report = verifyCleanInput(track, { cleanMode: true, channelCount: 2 }, ENV);
    expect(report.verdict).toBe("partial");
    expect(report.actual.noiseSuppression).toBe(true);
  });

  it("reports unknown when the browser does not report the settings back", () => {
    const track = trackWithSettings({});
    const report = verifyCleanInput(track, { cleanMode: true, channelCount: 2 }, ENV);
    expect(report.verdict).toBe("unknown");
  });

  it("in normal mode, requests autoGainControl off when autoGain is unset, matching a compliant track", () => {
    // Regression: verifyCleanInput used to derive `requested` as a flat `!cleanMode` for every
    // stage, but buildInputConstraints overrides autoGainControl with the autoGain preference —
    // unset (the common default) means it asks for autoGainControl: false even in normal mode.
    // A track that honestly reports it off must read as clean, not partial.
    const track = trackWithSettings({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    });
    const report = verifyCleanInput(track, { cleanMode: false, channelCount: 1 }, ENV);
    expect(report.verdict).toBe("clean");
  });

  it("in normal mode, requests autoGainControl on when autoGain is true, matching a compliant track", () => {
    const track = trackWithSettings({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    const report = verifyCleanInput(
      track,
      { cleanMode: false, channelCount: 1, autoGain: true },
      ENV,
    );
    expect(report.verdict).toBe("clean");
  });
});

describe("acquireCleanInput", () => {
  it("asks with exact first and reports that it was honoured", async () => {
    const track = trackWithSettings({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    const getUserMedia = vi.fn().mockResolvedValue(streamWith(track));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const { report } = await acquireCleanInput({ cleanMode: true, channelCount: 2 }, ENV);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const first = getUserMedia.mock.calls[0]?.[0] as MediaStreamConstraints;
    const audio = first.audio as Record<string, unknown>;
    expect(audio["echoCancellation"]).toEqual({ exact: false });
    expect(report.exactHonoured).toBe(true);
  });

  it("falls back to plain booleans when the exact request is over-constrained", async () => {
    const track = trackWithSettings({
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
    });
    const overconstrained = Object.assign(new Error("over"), { name: "OverconstrainedError" });
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(overconstrained)
      .mockResolvedValueOnce(streamWith(track));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const { report } = await acquireCleanInput({ cleanMode: true, channelCount: 2 }, ENV);

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    const second = getUserMedia.mock.calls[1]?.[0] as MediaStreamConstraints;
    const audio = second.audio as Record<string, unknown>;
    expect(audio["echoCancellation"]).toBe(false);
    expect(report.exactHonoured).toBe(false);
    expect(report.verdict).toBe("partial");
  });

  it("does not retry when the failure is a permission denial", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const getUserMedia = vi.fn().mockRejectedValue(denied);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(acquireCleanInput({ cleanMode: true, channelCount: 2 }, ENV)).rejects.toThrow(
      "denied",
    );
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
