import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PitchDetector } from "../PitchDetector";
import {
  PITCH_SOURCE_WINDOW,
  PITCH_DECIMATED_WINDOW,
  PITCH_DETECT_RATE_HZ,
  PITCH_SILENCE_RMS,
} from "../pitchConstants";

// Mock pitchfinder AMDF to a deterministic, spy-able detector. Each `AMDF(...)` call
// (one per PitchDetector construction) gets its own fresh spy, pushed here so the test
// helper can hand back the spy for the detector it just built. Vitest hoists vi.mock
// calls above imports/other statements, so referenced outer variables must be prefixed
// "mock" — see https://vitest.dev/api/vi.html#vi-mock.
const mockDetectSpies: Array<ReturnType<typeof vi.fn>> = [];
vi.mock("pitchfinder", () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- must match pitchfinder's real export name
  AMDF: () => {
    const spy = vi.fn((_buf: Float32Array) => 220);
    mockDetectSpies.push(spy);
    return spy;
  },
}));

// Controls getWebRTCCapabilities().supportsAudioWorklet for the whole file. Read
// dynamically through a mutable holder (not captured at mock-factory time) so
// individual describe blocks can flip it to exercise the fallback path. Wrapped in an
// object rather than a bare boolean so its name can start with "mock" (required for
// vitest's vi.mock hoisting) without also tripping the boolean-prefix naming rule.
const mockCapabilities = { isAudioWorkletSupported: true };
vi.mock("@/shared/webrtc/webrtcCapabilities", () => ({
  getWebRTCCapabilities: () => ({ supportsAudioWorklet: mockCapabilities.isAudioWorkletSupported }),
}));

/** Message shape mirroring public/worklets/pitch-tap-processor.js's postMessage payloads. */
type FakeWorkletMessage = { type: "silent" } | { type: "frame"; samples: Float32Array };
interface FakeWorkletMessageEvent {
  data: FakeWorkletMessage;
}

interface FakeAudioWorkletPort {
  onmessage: ((event: FakeWorkletMessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

/**
 * Stands in for the real AudioWorkletNode so tests can drive `port.onmessage`
 * directly instead of routing audio through jsdom's absent Web Audio implementation.
 * Captured via `capturedNode` on construction — PitchDetector only ever builds one
 * node per instance, so "the last one built" is unambiguous within a single test.
 * Captures the constructor's `options` argument (mirrors
 * `envelopeFollowerWorklet.test.ts`'s `FakeAudioWorkletNode`) so tests can assert on the
 * exact options `PitchDetector` passes — a CRITICAL regression class: without
 * `numberOfOutputs: 0`, an AudioWorkletNode with no live output connection is never
 * pulled by the render graph, so `process()` (and therefore every posted pitch message)
 * would never run in a real browser.
 */
class FakeAudioWorkletNode {
  readonly port: FakeAudioWorkletPort = { onmessage: null, postMessage: vi.fn() };
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  readonly options: AudioWorkletNodeOptions | undefined;

  constructor(_context: unknown, _name: unknown, options?: AudioWorkletNodeOptions) {
    this.options = options;
    recordCreatedNode(this);
  }
}
let capturedNode: FakeAudioWorkletNode | undefined;

/** Kept as a plain function (not a `this`-alias) to satisfy @typescript-eslint/no-this-alias. */
function recordCreatedNode(node: FakeAudioWorkletNode): void {
  capturedNode = node;
}

let onPitch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onPitch = vi.fn();
  mockDetectSpies.length = 0;
  capturedNode = undefined;
  mockCapabilities.isAudioWorkletSupported = true;
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Builds a PitchDetector wired to a fake worklet node (see FakeAudioWorkletNode). */
function createDetectorWithFakeWorklet(): {
  detector: PitchDetector;
  emit: (data: FakeWorkletMessage) => void;
  detectSpy: ReturnType<typeof vi.fn>;
} {
  const ctx = new AudioContext();
  const detector = new PitchDetector(ctx, onPitch);

  const node = capturedNode;
  if (!node) throw new Error("PitchDetector did not construct an AudioWorkletNode");
  const detectSpy = mockDetectSpies.at(-1);
  if (!detectSpy) throw new Error("PitchDetector did not construct an AMDF detector");

  return {
    detector,
    detectSpy,
    emit: (data: FakeWorkletMessage) => {
      node.port.onmessage?.({ data });
    },
  };
}

describe("PitchDetector (worklet path)", () => {
  it("runs no AMDF at all when the worklet reports silence", () => {
    const { detector, emit, detectSpy } = createDetectorWithFakeWorklet();
    detector.start();
    emit({ type: "silent" });
    expect(detectSpy).not.toHaveBeenCalled();
    expect(onPitch).toHaveBeenCalledWith(null);
  });

  it("detects once per worklet frame, not once per animation frame", () => {
    const { detector, emit, detectSpy } = createDetectorWithFakeWorklet();
    detector.start();
    emit({ type: "frame", samples: new Float32Array(PITCH_SOURCE_WINDOW) });
    emit({ type: "frame", samples: new Float32Array(PITCH_SOURCE_WINDOW) });
    expect(detectSpy).toHaveBeenCalledTimes(2);
  });

  it("feeds AMDF the decimated window, not the source window", () => {
    const { detector, emit, detectSpy } = createDetectorWithFakeWorklet();
    detector.start();
    emit({ type: "frame", samples: new Float32Array(PITCH_SOURCE_WINDOW) });
    expect(detectSpy.mock.calls[0]?.[0]).toHaveLength(PITCH_DECIMATED_WINDOW);
  });

  it("ignores frames after stop()", () => {
    const { detector, emit, detectSpy } = createDetectorWithFakeWorklet();
    detector.start();
    detector.stop();
    emit({ type: "frame", samples: new Float32Array(PITCH_SOURCE_WINDOW) });
    expect(detectSpy).not.toHaveBeenCalled();
  });

  it("forwards the AMDF-detected pitch from a worklet frame", () => {
    const { detector, emit } = createDetectorWithFakeWorklet();
    detector.start();
    emit({ type: "frame", samples: new Float32Array(PITCH_SOURCE_WINDOW) });
    expect(onPitch).toHaveBeenCalledWith(220);
  });

  it("posts the silence gate once, from the constructor", () => {
    createDetectorWithFakeWorklet();
    const node = capturedNode;
    if (!node) throw new Error("PitchDetector did not construct an AudioWorkletNode");
    expect(node.port.postMessage).toHaveBeenCalledWith({ command: "setGate", value: PITCH_SILENCE_RMS });
  });

  it("dispose() clears the message handler and disconnects the node", () => {
    const { detector, detectSpy } = createDetectorWithFakeWorklet();
    const node = capturedNode;
    if (!node) throw new Error("PitchDetector did not construct an AudioWorkletNode");
    detector.start();
    detector.dispose();
    expect(node.disconnect).toHaveBeenCalled();
    expect(node.port.onmessage).toBeNull();
    // Belt-and-braces: even if something re-armed onmessage, a disposed detector must
    // not still be "running", so a stray message would be dropped either way.
    node.port.onmessage?.({ data: { type: "frame", samples: new Float32Array(PITCH_SOURCE_WINDOW) } });
    expect(detectSpy).not.toHaveBeenCalled();
  });

  it("returns the worklet node as the connection point", () => {
    const { detector } = createDetectorWithFakeWorklet();
    const node = capturedNode;
    expect(detector.input).toBe(node);
  });

  it("constructs the AudioWorkletNode with numberOfOutputs:0 and explicit mono input pinning (CRITICAL regression)", () => {
    createDetectorWithFakeWorklet();
    const node = capturedNode;
    if (!node) throw new Error("PitchDetector did not construct an AudioWorkletNode");
    // numberOfOutputs:0 — pitch-tap-processor.js's process() never touches `outputs`, so this
    // node is a pure analysis tap; without this, the default numberOfOutputs===1 with nothing
    // ever connecting the output onward means the render graph never pulls this node, and
    // process() (and every posted pitch message) never runs in a real browser.
    // channelCount/channelCountMode:explicit pin the input to mono, matching the worklet's
    // own `inputs[0][0]`-only read — without pinning, a stereo source (e.g. the
    // createStereoGainNode callers feed into `.input`) would arrive as 2 channels and only
    // the left channel would ever be analysed, instead of a proper mono downmix.
    expect(node.options).toMatchObject({
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    });
  });
});

describe("PitchDetector.register", () => {
  it("adds the worklet module once per context, memoised across calls", async () => {
    const ctx = new AudioContext();
    await PitchDetector.register(ctx);
    await PitchDetector.register(ctx);
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledTimes(1);
  });

  it("propagates an addModule rejection to the caller instead of swallowing it", async () => {
    const ctx = new AudioContext();
    const failure = new Error("failed to load worklet module");
    vi.mocked(ctx.audioWorklet.addModule).mockRejectedValueOnce(failure);
    await expect(PitchDetector.register(ctx)).rejects.toThrow(failure);
  });

  it("resolves without calling addModule when AudioWorklet is unsupported", async () => {
    mockCapabilities.isAudioWorkletSupported = false;
    const ctx = new AudioContext();
    await expect(PitchDetector.register(ctx)).resolves.toBeUndefined();
    expect(ctx.audioWorklet.addModule).not.toHaveBeenCalled();
  });
});

describe("PitchDetector (fallback, no AudioWorklet support)", () => {
  beforeEach(() => {
    mockCapabilities.isAudioWorkletSupported = false;
    vi.useFakeTimers();
  });

  function createFallbackDetector(): {
    detector: PitchDetector;
    fillWith: (value: number) => void;
    detectSpy: ReturnType<typeof vi.fn>;
  } {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    vi.spyOn(ctx, "createAnalyser").mockReturnValue(analyser);

    let fillValue = 0;
    vi.mocked(analyser.getFloatTimeDomainData).mockImplementation((buf: Float32Array) => {
      buf.fill(fillValue);
    });

    const detector = new PitchDetector(ctx, onPitch);
    const detectSpy = mockDetectSpies.at(-1);
    if (!detectSpy) throw new Error("PitchDetector did not construct an AMDF detector");

    return {
      detector,
      detectSpy,
      fillWith: (value: number) => {
        fillValue = value;
      },
    };
  }

  it("polls on a fixed-rate interval, not requestAnimationFrame", () => {
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    const { detector, fillWith } = createFallbackDetector();
    fillWith(0.5);
    detector.start();

    vi.advanceTimersByTime(1000 / PITCH_DETECT_RATE_HZ);

    expect(onPitch).toHaveBeenCalledWith(220);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("gates on silence before running AMDF, same as the worklet path", () => {
    const { detector, fillWith, detectSpy } = createFallbackDetector();
    fillWith(0); // RMS 0, well under PITCH_SILENCE_RMS
    detector.start();

    vi.advanceTimersByTime(1000 / PITCH_DETECT_RATE_HZ);

    expect(detectSpy).not.toHaveBeenCalled();
    expect(onPitch).toHaveBeenCalledWith(null);
  });

  it("feeds AMDF a decimated window sized like the worklet path", () => {
    const { detector, fillWith, detectSpy } = createFallbackDetector();
    fillWith(0.5);
    detector.start();

    vi.advanceTimersByTime(1000 / PITCH_DETECT_RATE_HZ);

    expect(detectSpy.mock.calls[0]?.[0]).toHaveLength(PITCH_DECIMATED_WINDOW);
  });

  it("stop() clears the interval so no further polling happens", () => {
    const { detector, fillWith } = createFallbackDetector();
    fillWith(0.5);
    detector.start();
    detector.stop();
    onPitch.mockClear();

    vi.advanceTimersByTime(5000 / PITCH_DETECT_RATE_HZ);

    expect(onPitch).not.toHaveBeenCalled();
  });
});
