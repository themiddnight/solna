import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AudioContextManager } from "../audioContextManager";

vi.mock("@/shared/webrtc/webrtcCapabilities", () => ({
  getWebRTCCapabilities: () => ({ isSafari: false }),
}));

class MockAudioContext {
  public state: AudioContextState = "running";
  public sampleRate = 48000;
  public baseLatency = 0.001;
  public outputLatency = 0.001;
  public destination = {} as AudioDestinationNode;

  resume = vi.fn(async () => {
    this.state = "running";
  });

  suspend = vi.fn(async () => {
    this.state = "suspended";
  });

  close = vi.fn(async () => {
    this.state = "closed";
  });

  createGain(): GainNode {
    return {
      gain: { value: 1, setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    } as unknown as GainNode;
  }

  createDynamicsCompressor(): DynamicsCompressorNode {
    return {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 1 },
      attack: { value: 0 },
      release: { value: 0 },
      reduction: 0,
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as DynamicsCompressorNode;
  }

  createChannelSplitter(): ChannelSplitterNode {
    return { connect: vi.fn(), disconnect: vi.fn() } as unknown as ChannelSplitterNode;
  }

  createAnalyser(): AnalyserNode {
    return { connect: vi.fn(), disconnect: vi.fn() } as unknown as AnalyserNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    return { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioBufferSourceNode;
  }

  createOscillator(): OscillatorNode {
    return { connect: vi.fn(), disconnect: vi.fn() } as unknown as OscillatorNode;
  }
}

describe("AudioContextManager", () => {
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

  beforeEach(() => {
    vi.stubGlobal("AudioContext", MockAudioContext as unknown as typeof AudioContext);
  });

  afterEach(async () => {
    await AudioContextManager.cleanup();
    setIntervalSpy.mockClear();
    clearIntervalSpy.mockClear();
    vi.unstubAllGlobals();
  });

  it("creates the performance monitor only once per instrument context lifecycle", async () => {
    await AudioContextManager.getInstrumentContext();
    await AudioContextManager.getInstrumentContext();

    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it("clears the performance monitor during cleanup", async () => {
    await AudioContextManager.getInstrumentContext();

    await AudioContextManager.cleanup();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
