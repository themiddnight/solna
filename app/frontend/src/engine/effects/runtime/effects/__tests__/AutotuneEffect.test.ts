import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

// The node's `latency()` resolution is hoisted into its own mock fn (rather than inlined) so a
// single test can override its resolved value for one call via mockResolvedValueOnce — proving
// the resolved value actually flows through to getLatency(), not just that latency() was called.
const { latencyMock } = vi.hoisted(() => ({ latencyMock: vi.fn(async () => 0) }));

// Mock the Signalsmith Stretch worklet loader — construction-scope test only.
// DSP output (real pitch shifting) is browser/owner-verified, not unit-tested.
vi.mock("signalsmith-stretch", () => ({
  default: vi.fn(async () => ({
    start: vi.fn(),
    schedule: vi.fn(),
    configure: vi.fn(),
    latency: latencyMock,
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

import { createAutotuneEffect } from "../AutotuneEffect";
import { EFFECT_TYPE } from "../../audioEffectTypes";
import { DEFAULT_SCALE_MASK } from "../../../pitch/pitchConstants";
import { PitchDetector } from "../../../pitch/PitchDetector";

// PitchDetector construction is deferred behind an awaited PitchDetector.register(context)
// (DEV-343 task 5). Draining a bounded number of microtask turns settles that chain
// deterministically without real timers — same idiom as effectsIntegration.lifecycle.test.ts's
// local `flush` helper.
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

describe("createAutotuneEffect", () => {
  let rafMock: MockInstance;
  let cafMock: MockInstance;

  beforeEach(() => {
    // keep the smoothing/detector rAF loops from running during the test
    rafMock = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);
    cafMock = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("constructs synchronously with all 7 params at correct defaults/ranges", () => {
    const ctx = new AudioContext();
    const effect = createAutotuneEffect(ctx);
    expect(effect.type).toBe(EFFECT_TYPE.AUTOTUNE);

    const interval = effect.parameters.get("interval");
    expect(interval).toMatchObject({ value: 0, min: 0, max: 3, step: 1 });

    const retuneSpeed = effect.parameters.get("retuneSpeed");
    expect(retuneSpeed).toMatchObject({ value: 0, min: 0, max: 1, step: 0.01 });

    const blockMs = effect.parameters.get("blockMs");
    expect(blockMs).toMatchObject({ value: 50, min: 10, max: 160, step: 5, unit: "ms" });

    const formant = effect.parameters.get("formant");
    expect(formant).toMatchObject({ value: 1, min: 0, max: 1, step: 1 });

    const wetLevel = effect.parameters.get("wetLevel");
    expect(wetLevel).toMatchObject({ value: 1, min: 0, max: 1, unit: "%" });

    const keyRoot = effect.parameters.get("keyRoot");
    expect(keyRoot).toMatchObject({ value: 0, min: 0, max: 11, step: 1 });

    const scaleMask = effect.parameters.get("scaleMask");
    expect(scaleMask).toMatchObject({ value: DEFAULT_SCALE_MASK, min: 0, max: 4095, step: 1 });

    expect(effect.inputNode).toBeDefined();
    expect(effect.outputNode).toBeDefined();
    effect.cleanup();
  });

  it("stores a valid interval index", () => {
    const ctx = new AudioContext();
    const effect = createAutotuneEffect(ctx);
    effect.setParameter("interval", 2);
    expect(effect.getParameter("interval")).toBe(2);
    effect.cleanup();
  });

  it("clamps interval above max down to 3", () => {
    const ctx = new AudioContext();
    const effect = createAutotuneEffect(ctx);
    effect.setParameter("interval", 9);
    expect(effect.getParameter("interval")).toBe(3);
    effect.cleanup();
  });

  it("clamps and stores wetLevel for the wet/dry blend", () => {
    const ctx = new AudioContext();
    const effect = createAutotuneEffect(ctx);
    effect.setParameter("wetLevel", 0.5);
    expect(effect.getParameter("wetLevel")).toBe(0.5);
    effect.cleanup();
  });

  it("getLatency reflects the resolved node latency after registration settles", async () => {
    // Distinct from the 0 default so the post-await assertion can't pass merely because
    // refreshLatency() was never called (or its promise silently rejected) — it only passes if
    // the resolved value actually flows through state.latencyMs into getLatency().
    latencyMock.mockResolvedValueOnce(25);

    const ctx = new AudioContext();
    const effect = createAutotuneEffect(ctx);
    expect(effect.getLatency()).toBe(0); // pre-resolution default

    await flushMicrotasks(); // let the worklet construct and refreshLatency()'s node.latency() promise settle

    expect(effect.getLatency()).toBe(25); // resolved node.latency() flowed through — pins the real async wiring
    effect.cleanup();
  });

  it("cleanup does not throw", () => {
    const ctx = new AudioContext();
    const effect = createAutotuneEffect(ctx);
    expect(() => effect.cleanup()).not.toThrow();
  });

  it("disable() halts detection + smoothing; enable() resumes them without double-arming", async () => {
    // Mock start/stop to no-op so the detector's own internal rAF doesn't count toward rafMock;
    // only the smoothing loop's requestAnimationFrame is then observed.
    const startSpy = vi.spyOn(PitchDetector.prototype, "start").mockImplementation(() => undefined);
    const stopSpy = vi.spyOn(PitchDetector.prototype, "stop").mockImplementation(() => undefined);

    const ctx = new AudioContext();
    const effect = createAutotuneEffect(ctx);

    // Detector construction now happens behind an awaited PitchDetector.register(context)
    // (DEV-343 task 5) instead of synchronously in the factory, so it isn't armed the instant
    // createAutotuneEffect() returns. The smoothing rAF loop is unaffected — it's still armed
    // synchronously at construction.
    const rafAfterCreate = rafMock.mock.calls.length; // smoothing loop armed once
    expect(startSpy).not.toHaveBeenCalled(); // registration hasn't resolved yet

    await flushMicrotasks(); // let PitchDetector.register(context) resolve and the detector construct+start
    expect(startSpy).toHaveBeenCalledTimes(1); // detector armed once registration resolved

    effect.disable();
    expect(stopSpy).toHaveBeenCalledTimes(1); // detection stopped
    expect(cafMock).toHaveBeenCalled(); // smoothing rAF cancelled

    effect.enable();
    expect(startSpy).toHaveBeenCalledTimes(2); // detection restarted
    expect(rafMock.mock.calls.length).toBe(rafAfterCreate + 1); // smoothing loop re-armed once

    effect.enable(); // already running → must not re-arm the smoothing loop again
    expect(rafMock.mock.calls.length).toBe(rafAfterCreate + 1);

    effect.cleanup();
  });

  it("disable() called while registration is still pending is not silently undone once it resolves", async () => {
    const startSpy = vi.spyOn(PitchDetector.prototype, "start").mockImplementation(() => undefined);
    const stopSpy = vi.spyOn(PitchDetector.prototype, "stop").mockImplementation(() => undefined);

    const ctx = new AudioContext();
    const effect = createAutotuneEffect(ctx);

    // disable() before the detector has even been constructed — this is the realistic
    // "first pitch-owning effect in a fresh AudioContext" window, since register() is
    // memoised per context and settles after just one microtask.
    effect.disable();
    expect(stopSpy).not.toHaveBeenCalled(); // nothing to stop yet — the detector doesn't exist

    await flushMicrotasks(); // let PitchDetector.register(context) resolve

    // Regression: the resolution block must re-derive enabled-ness, not assume the effect is
    // still enabled just because it was when the async IIFE was created.
    expect(startSpy).not.toHaveBeenCalled();

    effect.cleanup();
  });
});
