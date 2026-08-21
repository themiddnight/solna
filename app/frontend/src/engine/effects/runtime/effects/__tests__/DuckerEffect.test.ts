import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeDuckGain, createDuckerEffect } from "../DuckerEffect";

describe("computeDuckGain", () => {
  it("no reduction when key below threshold", () => {
    expect(computeDuckGain(-40, -30, 12)).toBeCloseTo(1, 5); // (keyDb, threshold, amountDb)
  });
  it("reduces by overshoot up to amount", () => {
    // key -24, threshold -30 → over 6dB → gain = 10^(-6/20)
    expect(computeDuckGain(-24, -30, 12)).toBeCloseTo(10 ** (-6 / 20), 5);
  });
  it("clamps reduction to amount", () => {
    // over 30dB but amount 12 → gain = 10^(-12/20)
    expect(computeDuckGain(0, -30, 12)).toBeCloseTo(10 ** (-12 / 20), 5);
  });
  it("silence key (-Infinity) → unity", () => {
    expect(computeDuckGain(-Infinity, -30, 12)).toBe(1);
  });
  it("exactly at threshold → unity (over === 0 is not > 0)", () => {
    expect(computeDuckGain(-30, -30, 12)).toBe(1);
  });
});

// DuckerEffect runtime tests (DEV-343 task 7): the ducker's envelope now runs on the
// envelope-follower AudioWorklet instead of an rAF loop. Since real construction is
// deferred behind an awaited EnvelopeFollowerWorklet.register(context) (mirroring
// PitchDetector's precondition — see DuckerEffect.ts's JSDoc), tests that need to
// inspect/drive the worklet stub `AudioWorkletNode` globally and drain a bounded number
// of microtask turns, same idiom as PitchDetector.test.ts / AutotuneEffect.test.ts /
// VocoderEffect.test.ts.

/** Message shape mirroring envelope-follower-processor.js's postMessage payloads. */
interface FakeLevelMessage {
  type: "level";
  keyDb: number;
  reduction: number;
}
interface FakeWorkletPort {
  onmessage: ((event: { data: FakeLevelMessage }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}

/**
 * Stands in for the real AudioWorkletNode so tests can drive `port.onmessage` directly
 * instead of routing audio through jsdom's absent Web Audio implementation. Captured via
 * `capturedNode` on construction — each test gets a fresh AudioContext (see beforeEach),
 * and every ducker built in this file constructs exactly one follower worklet node, so
 * "the last one built" is unambiguous within a single test.
 */
class FakeAudioWorkletNode {
  readonly port: FakeWorkletPort = { onmessage: null, postMessage: vi.fn() };
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  constructor() {
    recordCreatedNode(this);
  }
}
let capturedNode: FakeAudioWorkletNode | undefined;

/** Kept as a plain function (not a `this`-alias) to satisfy @typescript-eslint/no-this-alias. */
function recordCreatedNode(node: FakeAudioWorkletNode): void {
  capturedNode = node;
}

/** Drains a bounded number of microtask turns so the awaited
 *  EnvelopeFollowerWorklet.register(context) chain inside createDuckerEffect() settles
 *  deterministically without real timers — same idiom as VocoderEffect.test.ts /
 *  AutotuneEffect.test.ts's local `flushMicrotasks` helper. */
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

describe("DuckerEffect runtime", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    capturedNode = undefined;
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
    ctx = new AudioContext();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("constructs with type 'ducker' and the aux/monitor edge methods", () => {
    const fx = createDuckerEffect(ctx, "d1");
    expect(fx.type).toBe("ducker");
    expect(typeof fx.connectAuxInput).toBe("function");
    expect(typeof fx.disconnectAuxInput).toBe("function");
    expect(typeof fx.getReduction).toBe("function");
    expect(typeof fx.getKeyLevelDb).toBe("function");
    fx.cleanup();
  });

  it("starts at unity (no reduction) before any key is connected", () => {
    const fx = createDuckerEffect(ctx, "d2");
    expect(fx.getReduction?.()).toBeCloseTo(0, 5);
    fx.cleanup();
  });

  it("keeps duckGain.gain.value at unity while the worklet registers, then zeroes it only once wired in (CRITICAL 1 + fail-open regression)", async () => {
    // Two things must both be true, and a fix-round-1 regression got the first one
    // wrong: registering the worklet is a real audioWorklet.addModule(...) network
    // fetch (nothing pre-registers this module), so between construction and that fetch
    // resolving, duckGain must stay at unity (fail OPEN — transparent passthrough) —
    // NOT drop to 0 (fail CLOSED — the ducker's entire wet path silent) for the
    // duration of every single load. Only once the worklet is actually about to be
    // wired in should duckGain drop to 0, immediately before
    // `follower.output.connect(duckGain.gain)` — per the Web Audio spec, a connected
    // AudioParam's computed value is `intrinsic value + sum of connected audio-rate
    // signals` (NOT a replacement), so leaving duckGain at 1 past that point would make
    // the ducker +6dB instead of transparent, and never actually duck.
    //
    // jsdom can't simulate that additive AudioParam behavior end-to-end (its mock is a
    // bare stub with no signal-summing), so this asserts the actual fix's SHAPE instead:
    // duckGain.gain.value observed synchronously (unity) vs. after registration settles
    // (zero).
    //
    // NOTE: the global MockAudioParam (src/test/setup.ts) defaults every AudioParam's
    // `.value` to 0 — real Web Audio's GainNode.gain default is 1 — so a bare
    // `expect(duckGain.gain.value).toBe(1)` synchronously would pass for the WRONG
    // reason (the mock's own default, not DuckerEffect.ts leaving it alone) even with a
    // regression that zeroes it too early. To make this test non-vacuous, duckGain's
    // mock node is forced to the REAL default (1) the instant it's created
    // (intercepting createGain), so only DuckerEffect.ts's own code can move it.
    const originalCreateGain = ctx.createGain.bind(ctx);
    let createGainCallIndex = 0;
    let duckGainNode: GainNode | undefined;
    const createGainSpy = vi.spyOn(ctx, "createGain").mockImplementation(() => {
      const node = originalCreateGain();
      // Gain nodes are created in order: inputGain(0), duckGain(1), wetGain(2), dryGain(3),
      // outputGain(4).
      if (createGainCallIndex === 1) {
        node.gain.value = 1;
        duckGainNode = node;
      }
      createGainCallIndex++;
      return node;
    });

    const fx = createDuckerEffect(ctx, "d-gain-transparent");
    try {
      if (!duckGainNode) throw new Error("expected duckGain (2nd createGain() call) to be captured");
      // Registration hasn't resolved yet — must be transparent, not silent.
      expect(duckGainNode.gain.value).toBe(1);

      await flushMicrotasks(); // let EnvelopeFollowerWorklet.register(context) resolve and the follower construct+connect

      // Now that the worklet is wired in, duckGain IS zeroed.
      expect(duckGainNode.gain.value).toBe(0);
    } finally {
      createGainSpy.mockRestore();
      fx.cleanup();
    }
  });

  it("getKeyLevelDb reads -Infinity with no signal (silent/no key connected)", () => {
    const fx = createDuckerEffect(ctx, "d3");
    expect(fx.getKeyLevelDb?.()).toBe(-Infinity);
    fx.cleanup();
  });

  it("connectAuxInput('control') then disconnectAuxInput() falls back to unity gain", () => {
    const fx = createDuckerEffect(ctx, "d4");
    const keySource = ctx.createGain();
    fx.connectAuxInput?.(keySource, "control");
    fx.disconnectAuxInput?.();
    expect(fx.getReduction?.()).toBeCloseTo(0, 5);
    fx.cleanup();
  });

  it("ignores a non-control aux role", () => {
    const fx = createDuckerEffect(ctx, "d5");
    const heardSource = ctx.createGain();
    // 'heard' isn't meaningful for Ducker (control-role only) — should be a no-op,
    // not throw, and not affect the reduction monitor.
    expect(() => fx.connectAuxInput?.(heardSource, "heard")).not.toThrow();
    expect(fx.getReduction?.()).toBeCloseTo(0, 5);
    fx.cleanup();
  });

  it("registers threshold/amount/attack/release/hold/wetLevel params and clamps them", () => {
    const fx = createDuckerEffect(ctx, "d6");
    fx.setParameter("threshold", -999);
    expect(fx.getParameter("threshold")).toBe(-60);
    fx.setParameter("amount", 999);
    expect(fx.getParameter("amount")).toBe(40);
    fx.setParameter("attack", 0);
    expect(fx.getParameter("attack")).toBe(0.001);
    fx.setParameter("release", 999);
    expect(fx.getParameter("release")).toBe(1.5);
    fx.setParameter("hold", -1);
    expect(fx.getParameter("hold")).toBe(0);
    fx.setParameter("wetLevel", 0.5);
    expect(fx.getParameter("wetLevel")).toBe(0.5);
    fx.cleanup();
  });

  it("cleanup is idempotent-safe to call after disconnectAuxInput", () => {
    const fx = createDuckerEffect(ctx, "d7");
    const keySource = ctx.createGain();
    fx.connectAuxInput?.(keySource, "control");
    fx.disconnectAuxInput?.();
    expect(() => fx.cleanup()).not.toThrow();
  });

  it("connectAuxInput called twice with the same node is idempotent (no double-connect)", async () => {
    const fx = createDuckerEffect(ctx, "d-idempotent");
    await flushMicrotasks(); // let the follower worklet construct
    const keySource = ctx.createGain();
    const connectSpy = vi.spyOn(keySource, "connect");

    fx.connectAuxInput?.(keySource, "control");
    expect(connectSpy).toHaveBeenCalledTimes(1);
    fx.connectAuxInput?.(keySource, "control"); // same node again — must not re-connect
    expect(connectSpy).toHaveBeenCalledTimes(1);

    fx.cleanup();
  });

  it("computeDuckGain, and the worklet-fed reduction/key-level readouts, match gainUnits (DEV-296)", async () => {
    // computeDuckGain is a standalone exported pure function per the audit — import it directly.
    // (keyDb, thresholdDb, amountDb): 6dB over threshold, amount headroom 12dB -> reductionDb=6.
    expect(computeDuckGain(6, 0, 12)).toBeCloseTo(0.5012, 3); // -6dB reduction -> ~0.501 linear
    expect(computeDuckGain(0, 0, 12)).toBeCloseTo(1, 10);

    // getReduction()/getKeyLevelDb() now read the worklet's last {type:"level"} message
    // (DEV-343 task 7) instead of computing live — drive the captured FakeAudioWorkletNode's
    // port.onmessage directly, mirroring PitchDetector.test.ts's stubbing pattern.
    const fx = createDuckerEffect(ctx, "d-reduction");
    await flushMicrotasks(); // let the follower worklet construct

    const node = capturedNode;
    if (!node) throw new Error("expected the follower's AudioWorkletNode to be constructed");

    fx.setParameter("threshold", -30);
    fx.setParameter("amount", 12);

    // RMS(1) -> 0 dBFS key level; over=30dB clamped to amount=12dB -> target gain = 10^(-12/20)
    const expectedTargetGain = computeDuckGain(0, -30, 12);
    node.port.onmessage?.({ data: { type: "level", keyDb: 0, reduction: expectedTargetGain } });

    expect(fx.getKeyLevelDb?.()).toBe(0);
    const expectedReductionDb = 20 * Math.log10(expectedTargetGain);
    expect(fx.getReduction?.()).toBeCloseTo(expectedReductionDb, 3);

    fx.cleanup();
  });
});
