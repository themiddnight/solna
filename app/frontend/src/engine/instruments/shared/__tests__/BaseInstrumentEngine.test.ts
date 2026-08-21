import { describe, expect, it, vi, beforeEach } from "vitest";
import { BaseInstrumentEngine } from "../BaseInstrumentEngine";
import { InstrumentCategory } from "../constants";
import type { InstrumentEngineConfig } from "../types";
import type { NoteEvent, NoteStopEvent } from "@/engine/instruments/noteEvent";
import type * as EngineAudioModule from "@/engine/audio";
import type * as EffectsArchitectureModule from "@/engine/effects/runtime/effectsArchitecture";

// BaseInstrumentEngine.getPreGainNode() lazily creates its GainNode via
// getInstrumentAudioContext(), which dynamically imports AudioContextManager. Mock it so we
// control the AudioContext returned and can assert on the GainNode it produces.
const mockGainNode = {
  gain: { value: 1 },
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const mockAudioContext = {
  createGain: vi.fn(() => mockGainNode),
};

// Defaults to immediately resolving with `mockAudioContext`. Tests that need to control the
// exact timing of the resolution (e.g. the re-entrancy regression test below) swap this out for
// a manually-resolvable promise via `getInstrumentContextMock.mockReturnValueOnce(...)`.
const getInstrumentContextMock = vi.fn(() => Promise.resolve(mockAudioContext));

vi.mock("@/engine/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof EngineAudioModule>();
  return {
    ...actual,
    AudioContextManager: {
      ...actual.AudioContextManager,
      getInstrumentContext: getInstrumentContextMock,
    },
  };
});

// BaseInstrumentEngine.connectPreGainToMixer() also depends on getMixerDestinationNode(),
// which dynamically imports the global mixer. Mock it so tests control whether a mixer
// destination is available.
const mockChannel = { inputGain: { id: "mock-input-gain" } };
const mockGetOrCreateGlobalMixer = vi.fn();

vi.mock("@/engine/effects/runtime/effectsArchitecture", async (importOriginal) => {
  const actual = await importOriginal<typeof EffectsArchitectureModule>();
  return {
    ...actual,
    getOrCreateGlobalMixer: mockGetOrCreateGlobalMixer,
  };
});

class TestEngine extends BaseInstrumentEngine {
  async load(): Promise<void> {}
  playNote(_event: NoteEvent): void {}
  stopNote(_event: NoteStopEvent): void {}
  stopAllNotes(): void {}
  setVolume(_volume: number): void {}
  setSustain(_sustain: boolean): void {}
  destroy(): void {}
  getAudioNode(): AudioNode | null {
    return null;
  }

  // Test-only seam: getPreGainNode is protected on the base class.
  exposeGetPreGainNode(): Promise<GainNode> {
    return this.getPreGainNode();
  }

  exposeConnectPreGainToMixer(): Promise<AudioNode> {
    return this.connectPreGainToMixer();
  }
}

function makeConfig(): InstrumentEngineConfig {
  return {
    userId: "user-1",
    username: "Test User",
    instrumentName: "test-instrument",
    category: InstrumentCategory.Melodic,
  };
}

describe("BaseInstrumentEngine — instrument-params base no-op contract", () => {
  it("getInstrumentParams returns null by default", () => {
    const engine = new TestEngine(makeConfig());
    expect(engine.getInstrumentParams()).toBeNull();
  });

  it("updateInstrumentParams resolves without throwing by default", async () => {
    const engine = new TestEngine(makeConfig());
    await expect(
      engine.updateInstrumentParams({ volume: -6 }),
    ).resolves.toBeUndefined();
  });
});

describe("BaseInstrumentEngine — pre-gain node", () => {
  beforeEach(() => {
    mockGainNode.gain.value = 1;
    mockAudioContext.createGain.mockClear();
    mockGainNode.connect.mockClear();
    getInstrumentContextMock.mockClear();
    getInstrumentContextMock.mockImplementation(() => Promise.resolve(mockAudioContext));
  });

  it("getPreGainNode lazily creates and caches the same GainNode instance across calls", async () => {
    const engine = new TestEngine(makeConfig());

    const first = await engine.exposeGetPreGainNode();
    const second = await engine.exposeGetPreGainNode();

    expect(first).toBe(second);
    expect(mockAudioContext.createGain).toHaveBeenCalledTimes(1);
  });

  it("defaults the pre-gain node's gain.value to unity (1.0) before any setVolume call", async () => {
    const engine = new TestEngine(makeConfig());

    const node = await engine.exposeGetPreGainNode();

    expect(node.gain.value).toBe(1.0);
  });

  it("concurrent calls before the audio context resolves share one GainNode (no re-entrancy race)", async () => {
    // Give getInstrumentContext() a manually-resolvable promise for this test only, so we can
    // deterministically prove: both calls are issued BEFORE the context resolves.
    let resolveContext!: (context: typeof mockAudioContext) => void;
    const controlledContextPromise = new Promise<typeof mockAudioContext>((resolve) => {
      resolveContext = resolve;
    });
    getInstrumentContextMock.mockReturnValueOnce(controlledContextPromise);

    const engine = new TestEngine(makeConfig());

    // Issue both calls before the context promise resolves — this is the exact re-entrancy
    // window the fix must close: without the in-flight-promise cache, both calls would see
    // `preGainNode === null`, both call createGain(), and the second would silently overwrite
    // the first in `this.preGainNode`.
    const firstCall = engine.exposeGetPreGainNode();
    const secondCall = engine.exposeGetPreGainNode();

    resolveContext(mockAudioContext);

    const [first, second] = await Promise.all([firstCall, secondCall]);

    expect(first).toBe(second);
    expect(mockAudioContext.createGain).toHaveBeenCalledTimes(1);
  });

  it("retries on the next call after a transient failure instead of staying permanently rejected", async () => {
    getInstrumentContextMock.mockImplementationOnce(() =>
      Promise.reject(new Error("transient context failure")),
    );

    const engine = new TestEngine(makeConfig());

    await expect(engine.exposeGetPreGainNode()).rejects.toThrow(
      "transient context failure",
    );

    // Second call must retry (not reuse the permanently-rejected cached promise) and succeed
    // now that the mock resolves normally again.
    const node = await engine.exposeGetPreGainNode();

    expect(node).toBe(mockGainNode);
    expect(mockAudioContext.createGain).toHaveBeenCalledTimes(1);
  });
});

describe("BaseInstrumentEngine — connectPreGainToMixer", () => {
  beforeEach(() => {
    mockGainNode.gain.value = 1;
    mockAudioContext.createGain.mockClear();
    mockGainNode.connect.mockClear();
    mockGetOrCreateGlobalMixer.mockReset();
  });

  it("connects the pre-gain node to the mixer destination and returns it", async () => {
    mockGetOrCreateGlobalMixer.mockResolvedValue({
      getChannel: vi.fn().mockReturnValue(mockChannel),
      createUserChannel: vi.fn(),
    });
    const engine = new TestEngine(makeConfig());

    const result = await engine.exposeConnectPreGainToMixer();

    expect(result).toBe(mockGainNode);
    expect(mockGainNode.connect).toHaveBeenCalledWith(mockChannel.inputGain);
  });

  it("returns the pre-gain node unconnected when the mixer destination is unavailable", async () => {
    mockGetOrCreateGlobalMixer.mockRejectedValue(new Error("mixer unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = new TestEngine(makeConfig());

    const result = await engine.exposeConnectPreGainToMixer();

    expect(result).toBe(mockGainNode);
    expect(mockGainNode.connect).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
