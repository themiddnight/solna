/**
 * GraphicEQEffect runtime tests — real factory code against the shared jsdom
 * AudioContext mock (src/test/setup.ts). The factory's wiring, defaults,
 * clamping and setValueAtTime dispatch all run for real; only the Web Audio
 * platform itself is faked (node creation captured at the infra boundary).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EFFECT_TYPE } from "../../audioEffectTypes";
import { createGraphicEQEffect } from "../GraphicEQEffect";

/** Fake biquad filter nodes captured in creation order — mirrors the real
 *  factory's creation sequence: lowCut(0), band1..band5(1-5), highCut(6).
 *  The captured object IS the node handed to the factory, so its mutations
 *  (type/value assignments) are visible to the tests. */
interface CapturedFilter {
  type: string;
  frequency: { value: number; setValueAtTime: ReturnType<typeof vi.fn> };
  Q: { value: number; setValueAtTime: ReturnType<typeof vi.fn> };
  gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

/** Fake gain nodes captured in creation order — mirrors the real factory's
 *  creation sequence: inputGain(0), wetGain(1), dryGain(2), outputGain(3). */
interface CapturedGain {
  gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  channelCount: number;
  channelCountMode: ChannelCountMode;
  channelInterpretation: ChannelInterpretation;
}

describe("createGraphicEQEffect", () => {
  let ctx: AudioContext;
  let filters: CapturedFilter[];
  let gains: CapturedGain[];

  beforeEach(() => {
    ctx = new AudioContext();
    filters = [];
    gains = [];
    vi.spyOn(ctx, "createBiquadFilter").mockImplementation(() => {
      const node: CapturedFilter = {
        type: "lowpass",
        frequency: { value: 0, setValueAtTime: vi.fn() },
        Q: { value: 0, setValueAtTime: vi.fn() },
        gain: { value: 0, setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      filters.push(node);
      return node as unknown as BiquadFilterNode;
    });
    vi.spyOn(ctx, "createGain").mockImplementation(() => {
      const node: CapturedGain = {
        gain: { value: 0, setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        channelCount: 1,
        channelCountMode: "max",
        channelInterpretation: "speakers",
      };
      gains.push(node);
      return node as unknown as GainNode;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs with type/name/enabled/bypass and a graphiceq_ default id", () => {
    const fx = createGraphicEQEffect(ctx);
    expect(fx.type).toBe(EFFECT_TYPE.GRAPHICEQ);
    expect(fx.name).toBe("Graphic EQ");
    expect(fx.enabled).toBe(true);
    expect(fx.bypass).toBe(false);
    expect(fx.id).toMatch(/^graphiceq_\d+$/);
    expect(createGraphicEQEffect(ctx, "my-eq").id).toBe("my-eq");
  });

  it("creates the 7 biquad filters with the documented defaults", () => {
    createGraphicEQEffect(ctx);
    expect(filters).toHaveLength(7);
    // length asserted above — non-null assertions are safe here
    const [lowCut, b1, b2, b3, b4, b5, highCut] = filters as [
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
    ];
    expect(lowCut.type).toBe("highpass");
    expect(lowCut.frequency.value).toBe(20);
    expect(lowCut.Q.value).toBeCloseTo(0.707, 3);
    for (const [band, freq] of [
      [b1, 100],
      [b2, 500],
      [b3, 2000],
      [b4, 5000],
      [b5, 10000],
    ] as const) {
      expect(band.type).toBe("peaking");
      expect(band.frequency.value).toBe(freq);
      expect(band.Q.value).toBe(1);
      expect(band.gain.value).toBe(0);
    }
    expect(highCut.type).toBe("lowpass");
    expect(highCut.frequency.value).toBe(20000);
    expect(highCut.Q.value).toBeCloseTo(0.707, 3);
  });

  it("wires the wet chain lowCut→band1..5→highCut→wetGain and dry path in parallel", () => {
    createGraphicEQEffect(ctx);
    const [lowCut, b1, b2, b3, b4, b5, highCut] = filters as [
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
    ];
    const [inputGain, wetGain, dryGain, outputGain] = gains as [
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
    ];
    expect(inputGain.connect).toHaveBeenCalledWith(lowCut);
    expect(lowCut.connect).toHaveBeenCalledWith(b1);
    expect(b1.connect).toHaveBeenCalledWith(b2);
    expect(b2.connect).toHaveBeenCalledWith(b3);
    expect(b3.connect).toHaveBeenCalledWith(b4);
    expect(b4.connect).toHaveBeenCalledWith(b5);
    expect(b5.connect).toHaveBeenCalledWith(highCut);
    expect(highCut.connect).toHaveBeenCalledWith(wetGain);
    expect(inputGain.connect).toHaveBeenCalledWith(dryGain);
    expect(wetGain.connect).toHaveBeenCalledWith(outputGain);
    expect(dryGain.connect).toHaveBeenCalledWith(outputGain);
  });

  it("creates stereo gain nodes and starts 100% wet / 0% dry", () => {
    createGraphicEQEffect(ctx);
    for (const g of gains) {
      expect(g.channelCount).toBe(2);
      expect(g.channelCountMode).toBe("explicit");
      expect(g.channelInterpretation).toBe("speakers");
    }
    const [, wetGain, dryGain] = gains as [
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
    ];
    expect(wetGain.gain.value).toBe(1);
    expect(dryGain.gain.value).toBe(0);
  });

  it("registers the 19 parameters with names/ranges/curves", () => {
    const fx = createGraphicEQEffect(ctx);
    // ACTUAL behavior (pinned): 19 params, not 20 — lowCut/lowCutQ, 5 bands ×
    // (freq+Q+vol), highCut/highCutQ = 2 + 15 + 2.
    expect(fx.parameters.size).toBe(19);
    expect(fx.parameters.get("lowCut")).toMatchObject({ name: "Low Cut", value: 20, min: 20, max: 500, unit: "Hz", curve: "logarithmic" });
    expect(fx.parameters.get("highCut")).toMatchObject({ name: "High Cut", value: 20000, min: 1000, max: 20000, unit: "Hz", curve: "logarithmic" });
    for (const key of ["p1Freq", "p2Freq", "p3Freq", "p4Freq", "p5Freq"] as const) {
      expect(fx.parameters.get(key)?.curve).toBe("logarithmic");
    }
    expect(fx.parameters.get("p1Q")).toMatchObject({ name: "P1 Q", min: 0.1, max: 10 });
    expect(fx.parameters.get("p5Vol")).toMatchObject({ name: "P5 Vol", min: -24, max: 24, unit: "dB" });
    expect(fx.parameters.get("lowCutQ")).toMatchObject({ name: "Low Cut Q", value: 0.707, min: 0.1, max: 10 });
  });

  it("process() connects the input to inputNode and returns outputNode", () => {
    const fx = createGraphicEQEffect(ctx);
    const input = ctx.createGain();
    const out = fx.process(input);
    expect(input.connect).toHaveBeenCalledWith(fx.inputNode);
    expect(out).toBe(fx.outputNode);
  });

  it("clamps setParameter to the declared min/max before storing", () => {
    const fx = createGraphicEQEffect(ctx);
    fx.setParameter("lowCut", 999);
    expect(fx.getParameter("lowCut")).toBe(500);
    fx.setParameter("p1Vol", 99);
    expect(fx.getParameter("p1Vol")).toBe(24);
    fx.setParameter("p1Vol", -99);
    expect(fx.getParameter("p1Vol")).toBe(-24);
    fx.setParameter("p5Q", 0.01);
    expect(fx.getParameter("p5Q")).toBe(0.1);
  });

  it("dispatches each parameter to setValueAtTime on the owning node", () => {
    const fx = createGraphicEQEffect(ctx);
    const [lowCut, b1, b2, b3, b4, b5, highCut] = filters as [
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
      CapturedFilter,
    ];
    const cases: Array<[string, number, CapturedFilter, "frequency" | "Q" | "gain"]> = [
      ["lowCut", 300, lowCut, "frequency"],
      ["lowCutQ", 2, lowCut, "Q"],
      ["p1Freq", 150, b1, "frequency"],
      ["p2Freq", 650, b2, "frequency"],
      ["p3Freq", 2500, b3, "frequency"],
      ["p4Freq", 6000, b4, "frequency"],
      ["p5Freq", 12000, b5, "frequency"],
      ["highCut", 15000, highCut, "frequency"],
      ["highCutQ", 3, highCut, "Q"],
      ["p1Q", 1.5, b1, "Q"],
      ["p2Q", 1.5, b2, "Q"],
      ["p3Q", 1.5, b3, "Q"],
      ["p4Q", 1.5, b4, "Q"],
      ["p5Q", 1.5, b5, "Q"],
      ["p1Vol", -3, b1, "gain"],
      ["p2Vol", -3, b2, "gain"],
      ["p3Vol", -3, b3, "gain"],
      ["p4Vol", -3, b4, "gain"],
      ["p5Vol", -3, b5, "gain"],
    ];
    for (const [name, value, node, paramKey] of cases) {
      expect(node[paramKey].setValueAtTime).not.toHaveBeenCalled();
      fx.setParameter(name, value);
      expect(node[paramKey].setValueAtTime).toHaveBeenCalledWith(value, ctx.currentTime);
    }
  });

  it("ignores unknown parameter names without throwing", () => {
    const fx = createGraphicEQEffect(ctx);
    expect(() => fx.setParameter("bogus", 1)).not.toThrow();
    expect(fx.getParameter("bogus")).toBeUndefined();
    const lowCut = filters[0];
    if (!lowCut) throw new Error("expected the lowCut filter to be created");
    expect(lowCut.frequency.setValueAtTime).not.toHaveBeenCalled();
  });

  it("getParameter returns the stored value", () => {
    const fx = createGraphicEQEffect(ctx);
    expect(fx.getParameter("lowCut")).toBe(20);
    expect(fx.getParameter("p3Freq")).toBe(2000);
  });

  it("enable() routes 100% wet, disable() routes 100% dry", () => {
    const fx = createGraphicEQEffect(ctx);
    const [, wetGain, dryGain] = gains as [
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
    ];
    fx.disable();
    expect(wetGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, ctx.currentTime);
    expect(dryGain.gain.setValueAtTime).toHaveBeenLastCalledWith(1, ctx.currentTime);
    expect(fx.enabled).toBe(false);
    fx.enable();
    expect(wetGain.gain.setValueAtTime).toHaveBeenLastCalledWith(1, ctx.currentTime);
    expect(dryGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, ctx.currentTime);
    expect(fx.enabled).toBe(true);
  });

  it("cleanup() disconnects every node it created", () => {
    const fx = createGraphicEQEffect(ctx);
    fx.cleanup();
    for (const node of [...filters, ...gains]) {
      expect(node.disconnect).toHaveBeenCalled();
    }
  });

  it("cleanup() is safe to call twice (disconnect throws are swallowed)", () => {
    const fx = createGraphicEQEffect(ctx);
    fx.cleanup();
    expect(() => fx.cleanup()).not.toThrow();
  });
});
