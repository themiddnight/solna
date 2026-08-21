import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Real DSP correctness (vocoded speech, external-carrier tone) is browser/owner-verified, not
// asserted numerically here — this mirrors VocoderEffect.test.ts's approach: assert the effect's
// own contract instead. There is no internal carrier anymore: no external carrier ⇒ the effect is
// silent (DEV-288 v1 revised — "no carrier = silent", not a never-silent internal drone).

import { createVocoderExtEffect, carrierPresent } from "../VocoderExtEffect";
import { EFFECT_TYPE } from "../../audioEffectTypes";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";
import { DEFAULT_VOCODER_OUTPUT_GAIN_DB } from "@/shared/audio/vocoderGain";

describe("carrierPresent (pure carrier-presence decision)", () => {
  it("external at/above the silence threshold is present (1)", () => {
    expect(carrierPresent(0.02, 0.008)).toBe(1);
  });

  it("external exactly at the threshold still counts as present (1)", () => {
    expect(carrierPresent(0.008, 0.008)).toBe(1);
  });

  it("external below the threshold is absent (0 → silent)", () => {
    expect(carrierPresent(0.001, 0.008)).toBe(0);
  });

  it("external silent (0) is absent (0 → silent)", () => {
    expect(carrierPresent(0, 0.008)).toBe(0);
  });
});

// createVocoderExtEffect tests (DEV-343 task 7): the carrier-presence watcher now runs on the
// envelope-follower AudioWorklet's metering message instead of an rAF + AnalyserNode RMS poll.
// Real follower construction is deferred behind an awaited EnvelopeFollowerWorklet.register()
// (mirroring PitchDetector's precondition), so idempotency tests that need to inspect the
// follower's wiring stub `AudioWorkletNode` globally and drain a bounded number of microtask
// turns, same idiom as PitchDetector.test.ts / DuckerEffect.test.ts.

interface FakeWorkletPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
}
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

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

describe("createVocoderExtEffect", () => {
  beforeEach(() => {
    capturedNode = undefined;
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("constructs a vocoderext effect exposing the aux edge", () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    expect(effect.type).toBe(EFFECT_TYPE.VOCODEREXT);
    expect(effect.type).toBe("vocoderext");
    expect(typeof effect.connectAuxInput).toBe("function");
    expect(typeof effect.disconnectAuxInput).toBe("function");
    expect(effect.inputNode).toBeDefined();
    expect(effect.outputNode).toBeDefined();
    expect(effect.wetGainNode).toBeDefined();
    expect(effect.dryGainNode).toBeDefined();
    effect.cleanup();
  });

  it("is silent (carrier absent) before any aux is connected", () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    expect(effect.getCarrierPresenceForTest?.()).toBe(0);
    effect.cleanup();
  });

  it("connectAuxInput(node, 'heard') links the external carrier into the follower worklet", async () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    await flushMicrotasks(); // let the follower worklet construct
    const auxNode = ctx.createGain();
    const connectSpy = vi.spyOn(auxNode, "connect");

    expect(() => effect.connectAuxInput?.(auxNode, "heard")).not.toThrow();

    const node = capturedNode;
    if (!node) throw new Error("expected the follower's AudioWorkletNode to be constructed");
    // auxNode fans out to both the carrier bus (externalGain) and the follower's key input.
    expect(connectSpy).toHaveBeenCalledWith(node);

    effect.cleanup();
  });

  it("ignores a non-'heard' aux role (e.g. 'control') without throwing or engaging the follower", async () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    await flushMicrotasks();
    const auxNode = ctx.createGain();
    const connectSpy = vi.spyOn(auxNode, "connect");

    expect(() => effect.connectAuxInput?.(auxNode, "control")).not.toThrow();
    expect(connectSpy).not.toHaveBeenCalled();
    expect(effect.getCarrierPresenceForTest?.()).toBe(0);

    effect.cleanup();
  });

  it("connectAuxInput called twice with the same node does not double-connect the follower", async () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    await flushMicrotasks();
    const auxNode = ctx.createGain();
    const connectSpy = vi.spyOn(auxNode, "connect");

    effect.connectAuxInput?.(auxNode, "heard");
    connectSpy.mockClear();
    effect.connectAuxInput?.(auxNode, "heard"); // same node again — must not re-link

    expect(connectSpy).not.toHaveBeenCalled();
    effect.cleanup();
  });

  it("disconnectAuxInput() goes silent (presence 0) after a 'heard' link", async () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    await flushMicrotasks();
    const auxNode = ctx.createGain();
    const disconnectSpy = vi.spyOn(auxNode, "disconnect");

    effect.connectAuxInput?.(auxNode, "heard");
    effect.disconnectAuxInput?.();

    expect(effect.getCarrierPresenceForTest?.()).toBe(0);
    expect(disconnectSpy).toHaveBeenCalled();
    effect.cleanup();
  });

  it("disconnectAuxInput() is safe to call with no aux ever connected", () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    expect(() => effect.disconnectAuxInput?.()).not.toThrow();
    expect(effect.getCarrierPresenceForTest?.()).toBe(0);
    effect.cleanup();
  });

  it("the follower's metering message drives carrierPresent()/carrierPresenceGain (DEV-343 task 7)", async () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    await flushMicrotasks();
    const auxNode = ctx.createGain();
    effect.connectAuxInput?.(auxNode, "heard");

    const node = capturedNode;
    if (!node) throw new Error("expected the follower's AudioWorkletNode to be constructed");

    // -6 dBFS is well above CARRIER_SILENCE_RMS (0.008 ≈ -41.9 dBFS) -> present.
    node.port.onmessage?.({ data: { type: "level", keyDb: -6, reduction: 1 } });
    expect(effect.getCarrierPresenceForTest?.()).toBe(1);

    // -Infinity (silence) -> absent.
    node.port.onmessage?.({ data: { type: "level", keyDb: -Infinity, reduction: 1 } });
    expect(effect.getCarrierPresenceForTest?.()).toBe(0);

    effect.cleanup();
  });

  it("registers the kept params (no carrier-pitch params) and clamps them", () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    const expectedDefaults: Record<string, number> = {
      bandQ: 8,
      bandCount: 16,
      melSpacing: 0,
      noiseHighAmount: 0,
      sibilancePassthrough: 0.3,
      envHz: 50,
      tiltDbOct: 4,
      outputGain: DEFAULT_VOCODER_OUTPUT_GAIN_DB, // 18 dB (DEV-309), was 8 (linear ×)
      wetLevel: 1,
    };
    for (const [key, value] of Object.entries(expectedDefaults)) {
      expect(effect.getParameter(key)).toBe(value);
    }
    // No carrier-generation params (external aux replaces the internal pitch-tracked carrier).
    expect(effect.parameters.has("carrierMode")).toBe(false);
    expect(effect.parameters.has("degrees")).toBe(false);
    expect(effect.parameters.has("keyRoot")).toBe(false);

    effect.setParameter("bandCount", 999);
    expect(effect.getParameter("bandCount")).toBe(32);
    effect.setParameter("bandQ", -5);
    expect(effect.getParameter("bandQ")).toBe(2);
    effect.setParameter("wetLevel", 0.5);
    expect(effect.getParameter("wetLevel")).toBe(0.5);
    effect.cleanup();
  });

  it("builds one modulator biquad + one carrier biquad per band (>= 32 for 16 bands)", () => {
    const ctx = new AudioContext();
    const createBP = vi.spyOn(ctx, "createBiquadFilter");
    const effect = createVocoderExtEffect(ctx);
    // Per band: modBP + carrierBP = 2 biquads -> 16 bands * 2 = 32, plus the sibilance HP = 33.
    expect(createBP.mock.calls.length).toBeGreaterThanOrEqual(32);
    effect.cleanup();
  });

  it("bandCount change rebuilds bands without throwing", () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    expect(() => effect.setParameter("bandCount", 24)).not.toThrow();
    expect(effect.getParameter("bandCount")).toBe(24);
    effect.cleanup();
  });

  it("melSpacing change rebuilds bands without throwing", () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    expect(() => effect.setParameter("melSpacing", 1)).not.toThrow();
    expect(effect.getParameter("melSpacing")).toBe(1);
    effect.cleanup();
  });

  it("disable() then enable() restores the wetLevel mix", () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    expect(() => effect.disable()).not.toThrow();
    expect(() => effect.enable()).not.toThrow();
    effect.cleanup();
  });

  it("cleanup() disconnects everything (incl. a connected aux) without throwing", () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    const auxNode = ctx.createGain();
    effect.connectAuxInput?.(auxNode, "heard");
    expect(() => effect.cleanup()).not.toThrow();
  });

  it("initializes makeupGain from the shared dB default, not a bare 8 (DEV-309)", () => {
    const ctx = new AudioContext();
    const effect = createVocoderExtEffect(ctx);
    const makeupGainValue = effect.getMakeupGainValueForTest!();
    expect(makeupGainValue).toBeCloseTo(dbToGain(toDecibels(DEFAULT_VOCODER_OUTPUT_GAIN_DB)), 5);
    effect.cleanup();
  });

  it('setParameter("outputGain", dbValue) converts dB to linear before writing to the GainNode (DEV-309)', () => {
    // Same rationale as VocoderEffect.test.ts's equivalent: assert on the setTargetAtTime
    // argument (the jsdom AudioParam mock doesn't mutate `.value`), and use 6dB not 0dB so the
    // old [1,12] clamp can't mask raw-linear vs dB-converted behavior.
    const ctx = new AudioContext();
    const createGainSpy = vi.spyOn(ctx, "createGain");
    const effect = createVocoderExtEffect(ctx);
    // makeupGain is the 10th createGain call (index 9): inputGain, wetGain, dryGain, outputGain,
    // carrierPresenceGain, carrierBus, externalGain, noiseGain, sibGain, makeupGain.
    const makeupGainResult = createGainSpy.mock.results[9];
    if (makeupGainResult?.type !== "return") {
      throw new Error("expected a createGain() return at index 9 (makeupGain)");
    }
    const makeupGainNode = makeupGainResult.value;

    effect.setParameter("outputGain", 6); // 6dB trim -> ~1.9953 linear

    const appliedGain = vi.mocked(makeupGainNode.gain.setTargetAtTime).mock.calls.at(-1)?.[0];
    expect(appliedGain).toBeCloseTo(dbToGain(toDecibels(6)), 3);

    createGainSpy.mockRestore();
    effect.cleanup();
  });

  it("per-band HF tilt gain matches the canonical gainUnits formula (DEV-296)", () => {
    // The local tiltGain() helper (`10 ** ((tiltDbOct * Math.log2(freq/500)) / 20)`) was migrated
    // to `dbToGain(toDecibels(...))` — this was missed by the original migration sweep because it
    // uses `**` instead of `Math.pow`. buildBands() sets `makeup.gain.value = tiltGain(...)` as a
    // direct property assignment (not setTargetAtTime), so the mock GainNode's `.value` reflects
    // it directly — no need to spy on a ramp method here (cf. VocoderEffect.test.ts's
    // setTargetAtTime-based assertion for the equivalent site in the sibling file).
    const ctx = new AudioContext();
    const createGainSpy = vi.spyOn(ctx, "createGain");
    const effect = createVocoderExtEffect(ctx);
    // createVocoderExtEffect creates gain nodes in order: inputGain, wetGain, dryGain,
    // outputGain, carrierPresenceGain, carrierBus, externalGain, noiseGain, sibGain, makeupGain
    // -> index 9, then buildBands()'s band 0: vca(10), makeup(11). Band 0's freq is
    // VOCODER_FREQ_LOW (100 Hz, see bandFreqs), so makeup(index 11) is the band-0 makeup node.
    // (The follower's silent sink gain node is created AFTER buildBands() completes, so it
    // doesn't shift these indices — see VocoderExtEffect.ts's placement comment.)
    const makeupResult = createGainSpy.mock.results[11];
    if (makeupResult?.type !== "return") {
      throw new Error("expected a createGain() return at index 11 (band 0 makeup)");
    }
    const makeupNode = makeupResult.value;

    // Independently computed expected value (not via gainUnits, to avoid a circular check):
    // 10 ** ((4 * Math.log2(100/500)) / 20) ≈ 0.343253 (default tiltDbOct=4)
    expect(makeupNode.gain.value).toBeCloseTo(0.343253, 5);

    createGainSpy.mockRestore();
    effect.cleanup();
  });
});
