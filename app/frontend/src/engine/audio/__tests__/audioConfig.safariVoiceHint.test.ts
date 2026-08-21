// @vitest-environment jsdom
/**
 * Unit tests: Safari voice-context latency hint (DEV-257 experiment)
 *
 * Safari's voice AudioContext previously used latencyHint 'playback'
 * (~24ms measured output) "for stability". Voice is the latency-critical
 * path, so both the webkitCompat factory (the real Safari path) and the
 * audioConfig Safari branch now use 'interactive'. Instruments deliberately
 * keep 'playback'. If Safari playback glitches on-device, revert BOTH
 * together (see comments at each site).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/shared/webrtc/webrtcCapabilities", () => ({
  getWebRTCCapabilities: () => ({ isSafari: true }),
}));

describe("getOptimalAudioConfig — Safari branch", () => {
  it("uses 'interactive' for the voice context and keeps 'playback' for instruments", async () => {
    const { getOptimalAudioConfig } = await import("../audioConfig");
    const config = getOptimalAudioConfig();
    expect(config.WEBRTC_AUDIO_CONTEXT.latencyHint).toBe("interactive");
    expect(config.INSTRUMENT_AUDIO_CONTEXT.latencyHint).toBe("playback");
  });
});

describe("createWebKitCompatibleAudioContext — latency hint", () => {
  let capturedOptions: AudioContextOptions | undefined;

  beforeEach(() => {
    capturedOptions = undefined;
    class FakeAudioContext {
      state: AudioContextState = "running";
      sampleRate = 48000;
      resume = vi.fn().mockResolvedValue(undefined);
      constructor(options?: AudioContextOptions) {
        capturedOptions = options;
      }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests 'interactive' regardless of browser", async () => {
    const { createWebKitCompatibleAudioContext } = await import(
      "@/shared/utils/webkitCompat"
    );
    await createWebKitCompatibleAudioContext();
    expect(capturedOptions?.latencyHint).toBe("interactive");
    expect(capturedOptions?.sampleRate).toBe(48000);
  });
});
