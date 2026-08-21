import { describe, it, expect, vi, beforeAll } from "vitest";

// Tone.js v15's Compressor wraps a real DynamicsCompressorNode via standardized-audio-context,
// which registers native nodes in an internal WeakMap keyed by the context that created them.
// jsdom's shared AudioContext mock (src/test/setup.ts) doesn't produce nodes that satisfy that
// registry, so connecting Tone's compressor.output to a raw mock GainNode throws
// ("A value with the given key could not be found"). No sibling effect test exercises a real
// Tone-native node graph either (AutotuneEffect/VocoderEffect mock out their audio-producing
// dependencies entirely) — so we do the same here: mock Tone's Compressor with a lightweight
// fake that mirrors the shape CompressorEffect.ts relies on (input/output nodes, threshold/
// ratio/attack/release/knee Params, reduction getter). This still exercises CompressorEffect's
// own param-registration/clamp logic and the new getReduction/getInputLevelDb methods, which is
// what this task's interface actually needs verified — real DSP behavior (audible compression)
// is browser/owner-verified, not unit-tested, matching the pattern in VocoderEffect.test.ts.
vi.mock("tone", () => {
  class FakeParam {
    value: number;
    setValueAtTime = vi.fn();
    constructor(value: number) {
      this.value = value;
    }
  }
  class FakeCompressor {
    input = { connect: vi.fn(), disconnect: vi.fn() };
    output = { connect: vi.fn(), disconnect: vi.fn() };
    threshold: FakeParam;
    ratio: FakeParam;
    attack: FakeParam;
    release: FakeParam;
    knee: FakeParam;
    reduction = -3;
    dispose = vi.fn();
    constructor(opts: { threshold: number; ratio: number; attack: number; release: number }) {
      this.threshold = new FakeParam(opts.threshold);
      this.ratio = new FakeParam(opts.ratio);
      this.attack = new FakeParam(opts.attack);
      this.release = new FakeParam(opts.release);
      this.knee = new FakeParam(30);
    }
  }
  return { Compressor: FakeCompressor };
});

import { createCompressorEffect } from "../CompressorEffect";

describe("CompressorEffect runtime", () => {
  let ctx: AudioContext;
  beforeAll(() => {
    ctx = new AudioContext();
  });

  it("registers knee and makeupGain params and clamps them", () => {
    const fx = createCompressorEffect(ctx, "c1");
    fx.setParameter("knee", 999);
    expect(fx.getParameter("knee")).toBe(40);
    fx.setParameter("makeupGain", -5);
    expect(fx.getParameter("makeupGain")).toBe(0);
    fx.setParameter("makeupGain", 6);
    expect(fx.getParameter("makeupGain")).toBe(6);
    fx.cleanup();
  });

  it("getReduction reads the compressor's real reduction value", () => {
    const fx = createCompressorEffect(ctx, "c2");
    expect(fx.getReduction?.()).toBe(-3); // FakeCompressor.reduction fixture
    fx.cleanup();
  });

  it("getInputLevelDb computes real RMS-to-dBFS from analyser samples", () => {
    const createAnalyserSpy = vi.spyOn(ctx, "createAnalyser");
    const fx = createCompressorEffect(ctx, "c-level");
    const analyserResult = createAnalyserSpy.mock.results[0];
    if (analyserResult?.type !== "return") throw new Error("expected createAnalyser() return");
    const analyserNode = analyserResult.value as AnalyserNode;

    vi.spyOn(analyserNode, "getFloatTimeDomainData").mockImplementation((buf: Float32Array) => {
      buf.fill(0.5); // known non-silent sample
    });

    // rms(0.5) = 0.5 -> gainToDbfs(toLinearGain(0.5)) ~= -6.02 dBFS
    expect(fx.getInputLevelDb?.()).toBeCloseTo(-6.02, 1);

    fx.cleanup();
    createAnalyserSpy.mockRestore();
  });

  it("getInputLevelDb reuses buffer across multiple calls (Task 11: perf/DEV-298)", () => {
    // Verify that calling getInputLevelDb() twice reuses the same Float32Array buffer,
    // not allocating a new one per call. This is a regression test for per-frame allocation waste.
    const createAnalyserSpy = vi.spyOn(ctx, "createAnalyser");
    const fx = createCompressorEffect(ctx, "c-buffer-reuse");

    // Narrow the spy result to get the analyser node (same pattern as existing tests)
    const analyserResult = createAnalyserSpy.mock.results[0];
    if (analyserResult?.type !== "return") {
      throw new Error("expected a createAnalyser() return");
    }
    const analyserNode = analyserResult.value as AnalyserNode;

    // Spy on getFloatTimeDomainData to capture the buffers passed to it
    const buffers: Float32Array[] = [];
    const getFloatTimeDomainDataSpy = vi.spyOn(analyserNode, "getFloatTimeDomainData").mockImplementation((buf: Float32Array) => {
      buffers.push(buf);
    });

    // Call getInputLevelDb twice
    fx.getInputLevelDb?.();
    fx.getInputLevelDb?.();

    // Both calls should pass the same buffer reference (reused, not allocated per-call)
    expect(buffers.length).toBe(2);
    expect(buffers[0]).toBe(buffers[1]);

    fx.cleanup();
    createAnalyserSpy.mockRestore();
    getFloatTimeDomainDataSpy.mockRestore();
  });

  it("makeup gain trim matches the canonical gainUnits formulas (DEV-296)", () => {
    // The global MockAudioParam (src/test/setup.ts) stubs setValueAtTime without mutating
    // `.value`, so reading `makeupGain.gain.value` after the call would always report the
    // node's initial value (1), never the computed number — that would make this test pass
    // by coincidence regardless of the math underneath. Instead, spy on createGain (same
    // pattern as MetronomeSoundService.test.ts) to capture the makeupGain node and assert on
    // the actual argument passed to setValueAtTime.
    const createGainSpy = vi.spyOn(ctx, "createGain");
    const fx = createCompressorEffect(ctx, "c3");
    // createCompressorEffect creates gain nodes in order: inputGain, wetGain, dryGain,
    // outputGain, makeupGain -> the 5th call (index 4) is the makeup gain node.
    // Narrow the MockResult union instead of casting through it — vitest's `type: "throw"`
    // member types `value` as `any`, so `results[4]?.value as GainNode` is an assertion FROM
    // `any` (TR-27), even though the explicit annotation hides it from no-unsafe-assignment.
    const makeupGainResult = createGainSpy.mock.results[4];
    if (makeupGainResult?.type !== "return") {
      throw new Error("expected a createGain() return at index 4 (makeupGain)");
    }
    const makeupGainNode = makeupGainResult.value;

    fx.setParameter("makeupGain", 6);

    // 6 dB makeup gain -> ~1.9953 linear, same as gainUnits.dbToGain(toDecibels(6))
    const appliedGain = vi.mocked(makeupGainNode.gain.setValueAtTime).mock.calls.at(-1)?.[0];
    expect(appliedGain).toBeCloseTo(1.9953, 3);

    createGainSpy.mockRestore();
    fx.cleanup();
  });
});
