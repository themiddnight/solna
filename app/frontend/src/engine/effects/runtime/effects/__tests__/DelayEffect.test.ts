/**
 * DelayEffect runtime tests — real factory code against the shared jsdom
 * AudioContext mock (src/test/setup.ts). Covers construction defaults, the
 * feedback-loop wiring, parameter clamping and the equal-power wet/dry law
 * (applyWetDry) that DelayEffect is the sole wrapper using with a stored
 * wetLevel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EFFECT_TYPE } from "../../audioEffectTypes";
import { createDelayEffect } from "../DelayEffect";

/** Fake gain nodes captured in creation order — mirrors the real factory's
 *  creation sequence: inputGain(0), feedbackGain(1), wetGain(2), dryGain(3),
 *  outputGain(4). The captured object IS the node handed to the factory, so
 *  its mutations (gain.value assignments) are visible to the tests. */
interface CapturedGain {
  gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

/** Fake delay node — the factory writes delayTime.value before the params map
 *  is built, so the captured object must be the same object it mutates. */
interface CapturedDelay {
  delayTime: { value: number; setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

describe("createDelayEffect", () => {
  let ctx: AudioContext;
  let gains: CapturedGain[];
  let delayNode: CapturedDelay | undefined;

  beforeEach(() => {
    ctx = new AudioContext();
    gains = [];
    delayNode = undefined;
    vi.spyOn(ctx, "createGain").mockImplementation(() => {
      const node: CapturedGain = {
        gain: { value: 0, setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(node);
      return node as unknown as GainNode;
    });
    vi.spyOn(ctx, "createDelay").mockImplementation(() => {
      const node: CapturedDelay = {
        delayTime: { value: 0, setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      delayNode = node;
      return node as unknown as DelayNode;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs with type/name/enabled/bypass and a delay_ default id", () => {
    const fx = createDelayEffect(ctx);
    expect(fx.type).toBe(EFFECT_TYPE.DELAY);
    expect(fx.name).toBe("Delay");
    expect(fx.enabled).toBe(true);
    expect(fx.bypass).toBe(false);
    expect(fx.id).toMatch(/^delay_\d+$/);
    expect(createDelayEffect(ctx, "my-delay").id).toBe("my-delay");
  });

  it("starts at the documented defaults (0.25s / 30% feedback / 30% wet / 70% dry)", () => {
    createDelayEffect(ctx);
    const delay = delayNode;
    if (!delay) throw new Error("expected createDelay to be called once");
    expect(delay.delayTime.value).toBe(0.25);
    const [inputGain, feedbackGain, wetGain, dryGain] = gains as [
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
    ];
    expect(feedbackGain.gain.value).toBe(0.3);
    expect(wetGain.gain.value).toBe(0.3);
    expect(dryGain.gain.value).toBe(0.7);
    expect(inputGain.gain.value).toBe(0); // untouched by the factory
  });

  it("wires the feedback-loop network: input→delay/dry, delay→feedback→delay, delay→wet, wet/dry→output", () => {
    createDelayEffect(ctx);
    const delay = delayNode;
    if (!delay) throw new Error("expected createDelay to be called once");
    const [inputGain, feedbackGain, wetGain, dryGain, outputGain] = gains as [
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
    ];
    expect(inputGain.connect).toHaveBeenCalledWith(delay);
    expect(inputGain.connect).toHaveBeenCalledWith(dryGain);
    expect(delay.connect).toHaveBeenCalledWith(feedbackGain);
    expect(feedbackGain.connect).toHaveBeenCalledWith(delay);
    expect(delay.connect).toHaveBeenCalledWith(wetGain);
    expect(wetGain.connect).toHaveBeenCalledWith(outputGain);
    expect(dryGain.connect).toHaveBeenCalledWith(outputGain);
  });

  it("registers delayTime/feedback/wetLevel with the declared ranges", () => {
    const fx = createDelayEffect(ctx);
    expect(fx.parameters.size).toBe(3);
    expect(fx.parameters.get("delayTime")).toMatchObject({ name: "Delay Time", value: 0.25, min: 0.01, max: 1.0, unit: "s" });
    expect(fx.parameters.get("feedback")).toMatchObject({ name: "Feedback", value: 0.3, min: 0, max: 0.95, unit: "%" });
    expect(fx.parameters.get("wetLevel")).toMatchObject({ name: "Wet Level", value: 0.3, min: 0, max: 1, unit: "%" });
  });

  it("process() connects the input to inputNode and returns outputNode", () => {
    const fx = createDelayEffect(ctx);
    const input = ctx.createGain();
    const out = fx.process(input);
    expect(input.connect).toHaveBeenCalledWith(fx.inputNode);
    expect(out).toBe(fx.outputNode);
  });

  it("clamps setParameter to the declared min/max before storing", () => {
    const fx = createDelayEffect(ctx);
    fx.setParameter("delayTime", 99);
    expect(fx.getParameter("delayTime")).toBe(1.0);
    fx.setParameter("feedback", -5);
    expect(fx.getParameter("feedback")).toBe(0);
    fx.setParameter("feedback", 5);
    expect(fx.getParameter("feedback")).toBe(0.95);
    fx.setParameter("wetLevel", -1);
    expect(fx.getParameter("wetLevel")).toBe(0);
  });

  it("routes delayTime/feedback to setValueAtTime and wetLevel through the equal-power law", () => {
    const fx = createDelayEffect(ctx);
    const delay = delayNode;
    if (!delay) throw new Error("expected createDelay to be called once");
    const [, feedbackGain, wetGain, dryGain] = gains as [
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
    ];

    fx.setParameter("delayTime", 0.5);
    expect(delay.delayTime.setValueAtTime).toHaveBeenCalledWith(0.5, ctx.currentTime);

    fx.setParameter("feedback", 0.6);
    expect(feedbackGain.gain.setValueAtTime).toHaveBeenCalledWith(0.6, ctx.currentTime);

    // wet 0.5 → equal-power split: sin(π/4) = cos(π/4) ≈ 0.7071
    fx.setParameter("wetLevel", 0.5);
    expect(wetGain.gain.setValueAtTime).toHaveBeenLastCalledWith(Math.sin(Math.PI / 4), ctx.currentTime);
    expect(dryGain.gain.setValueAtTime).toHaveBeenLastCalledWith(Math.cos(Math.PI / 4), ctx.currentTime);
    expect(fx.getParameter("wetLevel")).toBe(0.5);
  });

  it("enable() re-applies the stored wet level, disable() goes full dry", () => {
    const fx = createDelayEffect(ctx);
    const [, , wetGain, dryGain] = gains as [
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
      CapturedGain,
    ];

    // default wetLevel 0.3 → equal-power: sin(0.3π/2) ≈ 0.4540, cos ≈ 0.8910
    fx.enable();
    expect(wetGain.gain.setValueAtTime).toHaveBeenLastCalledWith(Math.sin((0.3 * Math.PI) / 2), ctx.currentTime);
    expect(dryGain.gain.setValueAtTime).toHaveBeenLastCalledWith(Math.cos((0.3 * Math.PI) / 2), ctx.currentTime);
    expect(fx.enabled).toBe(true);

    fx.disable();
    expect(wetGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, ctx.currentTime);
    expect(dryGain.gain.setValueAtTime).toHaveBeenLastCalledWith(1, ctx.currentTime);
    expect(fx.enabled).toBe(false);
  });

  it("ignores unknown parameter names without throwing", () => {
    const fx = createDelayEffect(ctx);
    expect(() => fx.setParameter("bogus", 1)).not.toThrow();
    expect(fx.getParameter("bogus")).toBeUndefined();
  });

  it("getParameter returns the stored value", () => {
    const fx = createDelayEffect(ctx);
    expect(fx.getParameter("delayTime")).toBe(0.25);
    expect(fx.getParameter("wetLevel")).toBe(0.3);
  });

  it("cleanup() disconnects every node it created and is safe to call twice", () => {
    const fx = createDelayEffect(ctx);
    fx.cleanup();
    for (const node of [...gains, delayNode]) {
      if (node) expect(node.disconnect).toHaveBeenCalled();
    }
    expect(() => fx.cleanup()).not.toThrow();
  });
});
