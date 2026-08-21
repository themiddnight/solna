import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture carrier + detector instances so we can assert what the effect asks of them.
// DSP correctness (vocoded speech, silence, triad harmony) is browser/owner-verified,
// NOT asserted numerically here — EXCEPT the rectifier curve, whose exact shape is the
// DC-leak fix and IS asserted below.
interface FakeCarrier {
  output: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  setFrequencies: ReturnType<typeof vi.fn>;
  setWave: ReturnType<typeof vi.fn>;
  setUnison: ReturnType<typeof vi.fn>;
  setSpread: ReturnType<typeof vi.fn>;
  setOctaveMix: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}
interface FakeDetector {
  input: { connect: ReturnType<typeof vi.fn> };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

const { carriers, detectors } = vi.hoisted(() => ({
  carriers: [] as FakeCarrier[],
  detectors: [] as FakeDetector[],
}));

vi.mock("../../../pitch/VocoderCarrier", () => ({
  VocoderCarrier: class {
    output = { connect: vi.fn(), disconnect: vi.fn() };
    setFrequencies = vi.fn();
    setWave = vi.fn();
    setUnison = vi.fn();
    setSpread = vi.fn();
    setOctaveMix = vi.fn();
    dispose = vi.fn();
    constructor() {
      carriers.push(this);
    }
  },
}));

vi.mock("../../../pitch/PitchDetector", () => ({
  PitchDetector: class {
    // Detector construction is deferred behind an awaited PitchDetector.register(context)
    // (DEV-343 task 5) — mock it as an already-resolved promise so it settles after a bounded
    // number of microtask turns (see flushMicrotasks below), same as the real implementation.
    static register = vi.fn().mockResolvedValue(undefined);
    input = { connect: vi.fn() };
    start = vi.fn();
    stop = vi.fn();
    dispose = vi.fn();
    constructor() {
      detectors.push(this);
    }
  },
}));

// Drains a bounded number of microtask turns so the awaited PitchDetector.register(context)
// chain inside createVocoderEffect() settles deterministically without real timers — same
// idiom as effectsIntegration.lifecycle.test.ts's local `flush` helper.
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

import { createVocoderEffect, makeVocoderRectifierCurve, degreesFromMask } from "../VocoderEffect";
import { EFFECT_TYPE } from "../../audioEffectTypes";
import { DEFAULT_SCALE_MASK } from "../../../pitch/pitchConstants";
import { dbToGain, toDecibels } from "@/shared/audio/gainUnits";
import { DEFAULT_VOCODER_OUTPUT_GAIN_DB } from "@/shared/audio/vocoderGain";

describe("makeVocoderRectifierCurve (DC-leak regression)", () => {
  it("is odd-length (257) so the midpoint sample lands exactly on input=0", () => {
    const curve = makeVocoderRectifierCurve();
    // An even-length curve (the shipped 256 bug) has no sample at exact zero: silence
    // interpolates to ~0.004 DC that leaks through every VCA. 257 puts index 128 at 0.
    expect(curve.length).toBe(257);
  });

  it("maps silence (input 0) to EXACT zero — curve[128] === 0", () => {
    const curve = makeVocoderRectifierCurve();
    expect(curve[128]).toBe(0);
  });

  it("is a full-wave rectifier: endpoints map to +1", () => {
    const curve = makeVocoderRectifierCurve();
    expect(curve[0]).toBeCloseTo(1, 5);
    expect(curve[256]).toBeCloseTo(1, 5);
  });
});

describe("degreesFromMask (Voices bitmask)", () => {
  it("maps bit 1->degree 1 (root)", () => {
    expect(degreesFromMask(1)).toEqual([1]);
  });

  it("maps bits 1|2|4 -> root/3rd/5th triad", () => {
    expect(degreesFromMask(7)).toEqual([1, 3, 5]);
  });

  it("maps bit 8 -> octave (degree 8)", () => {
    expect(degreesFromMask(8)).toEqual([8]);
  });

  it("returns an empty list for mask 0", () => {
    expect(degreesFromMask(0)).toEqual([]);
  });
});

describe("createVocoderEffect", () => {
  beforeEach(() => {
    carriers.length = 0;
    detectors.length = 0;
    // Keep the level-watch + detector rAF loops from actually running during tests.
    vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(globalThis, "cancelAnimationFrame").mockReturnValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("constructs a wet-by-default vocoder of the right effect type", () => {
    const ctx = new AudioContext();
    const effect = createVocoderEffect(ctx);
    expect(effect.type).toBe(EFFECT_TYPE.VOCODER);
    expect(effect.inputNode).toBeDefined();
    expect(effect.outputNode).toBeDefined();
    expect(effect.wetGainNode).toBeDefined();
    expect(effect.dryGainNode).toBeDefined();
    effect.cleanup();
  });

  it("exposes every param with the owner-locked default values", () => {
    const ctx = new AudioContext();
    const effect = createVocoderEffect(ctx);
    const expectedDefaults: Record<string, number> = {
      carrierMode: 1,
      degrees: 1,
      carrierWave: 0,
      unison: 3,
      spreadCents: 16,
      octaveMix: 0.5,
      bandQ: 8,
      bandCount: 16,
      melSpacing: 0,
      noiseCrossHz: 8000,
      noiseHighAmount: 0,
      uvNoiseAmount: 0.2,
      sibilancePassthrough: 0.3,
      sibilanceHz: 5000,
      envHz: 50,
      tiltDbOct: 4,
      outputGain: DEFAULT_VOCODER_OUTPUT_GAIN_DB, // 18 dB (DEV-309), was 8 (linear ×)
      wetLevel: 1,
      keyRoot: 0,
      scaleMask: DEFAULT_SCALE_MASK,
    };
    for (const [key, value] of Object.entries(expectedDefaults)) {
      expect(effect.getParameter(key)).toBe(value);
    }
    effect.cleanup();
  });

  it("carrierMode is a 0/1 (drone/follow) toggle — no chord mode", () => {
    const ctx = new AudioContext();
    const effect = createVocoderEffect(ctx);
    expect(effect.parameters.get("carrierMode")).toMatchObject({ min: 0, max: 1, step: 1 });
    effect.cleanup();
  });

  it("setParameter('degrees', 7) asks the carrier for 3 voices (root+3rd+5th)", () => {
    const ctx = new AudioContext();
    const effect = createVocoderEffect(ctx);
    const carrier = carriers[0];
    expect(carrier).toBeDefined();
    if (!carrier) return;
    carrier.setFrequencies.mockClear();

    effect.setParameter("degrees", 7);

    expect(carrier.setFrequencies).toHaveBeenCalled();
    const lastCall = carrier.setFrequencies.mock.calls.at(-1);
    expect(lastCall?.[0]).toHaveLength(3);
    effect.cleanup();
  });

  it("setParameter('carrierMode', 0) stops the detector (drone) and updates the param", async () => {
    const ctx = new AudioContext();
    const effect = createVocoderEffect(ctx);
    // Detector construction is deferred behind an awaited PitchDetector.register(context)
    // (DEV-343 task 5), so it doesn't exist the instant createVocoderEffect() returns.
    await flushMicrotasks();
    const detector = detectors[0];
    expect(detector).toBeDefined();
    if (!detector) return;
    detector.stop.mockClear();

    effect.setParameter("carrierMode", 0);

    expect(effect.getParameter("carrierMode")).toBe(0);
    expect(detector.stop).toHaveBeenCalled();
    effect.cleanup();
  });

  it("disable() called while registration is still pending is not silently undone once it resolves", async () => {
    const ctx = new AudioContext();
    const effect = createVocoderEffect(ctx);

    // disable() before the detector has even been constructed — this is the realistic
    // "first pitch-owning effect in a fresh AudioContext" window, since register() is
    // memoised per context and settles after just one microtask. Default carrierMode is
    // FOLLOW, so without the fix the resolution block would start the detector anyway.
    effect.disable();

    await flushMicrotasks(); // let PitchDetector.register(context) resolve

    const detector = detectors[0];
    expect(detector).toBeDefined();
    if (!detector) return;
    // Regression: the resolution block must re-derive enabled-ness (not just carrierMode), or
    // a disabled vocoder ends up running full-cost AMDF detection anyway.
    expect(detector.start).not.toHaveBeenCalled();

    effect.cleanup();
  });

  it("clamps out-of-range params to [min, max]", () => {
    const ctx = new AudioContext();
    const effect = createVocoderEffect(ctx);
    effect.setParameter("bandCount", 999);
    expect(effect.getParameter("bandCount")).toBe(32);
    effect.setParameter("unison", 0);
    expect(effect.getParameter("unison")).toBe(1);
    effect.cleanup();
  });

  it("builds one modulator + one envelope + one osc carrier + one noise carrier biquad per band (>= 48 for 16 bands)", () => {
    const ctx = new AudioContext();
    const createBP = vi.spyOn(ctx, "createBiquadFilter");
    const effect = createVocoderEffect(ctx);
    // Per band: modBP + envLP + oscBP + noiseBP = 4 biquads -> 16 bands * 4 = 64, plus the
    // sibilance HP = 65 total (assertion just checks >= 48 for the 16-band default).
    expect(createBP.mock.calls.length).toBeGreaterThanOrEqual(48);
    effect.cleanup();
  });

  it("cleanup() disconnects without throwing", () => {
    const ctx = new AudioContext();
    const effect = createVocoderEffect(ctx);
    expect(() => effect.cleanup()).not.toThrow();
  });

  it("initializes makeupGain from the shared dB default, not a bare 8 (DEV-309)", () => {
    const ctx = new AudioContext();
    const effect = createVocoderEffect(ctx);
    const makeupGainValue = effect.getMakeupGainValueForTest!();
    expect(makeupGainValue).toBeCloseTo(dbToGain(toDecibels(DEFAULT_VOCODER_OUTPUT_GAIN_DB)), 5);
    // Sanity: still close to the old 8x behavior (within ~0.1 linear, since 18dB rounds from 18.0618dB)
    expect(Math.abs(makeupGainValue - 8)).toBeLessThan(0.1);
    effect.cleanup();
  });

  it('setParameter("outputGain", dbValue) converts dB to linear before writing to the GainNode (DEV-309)', () => {
    // The global MockAudioParam (src/test/setup.ts) stubs setTargetAtTime without mutating
    // `.value`, so reading makeupGain.gain.value after the call would always report the init
    // value, never the computed number. Instead, spy on createGain (same pattern as
    // CompressorEffect.test.ts) to capture the makeupGain node and assert on the argument
    // actually passed to setTargetAtTime.
    // NOTE: the plan's example used setParameter("outputGain", 0), but under the OLD [1,12]
    // range 0 clamps to 1 — indistinguishable from 0dB->unity after conversion. 6dB is used
    // here because it cleanly separates raw-linear (6) from dB-converted (~1.9953) behavior.
    const ctx = new AudioContext();
    const createGainSpy = vi.spyOn(ctx, "createGain");
    const effect = createVocoderEffect(ctx);
    // makeupGain is the 7th createGain call (index 6): inputGain, wetGain, dryGain, outputGain,
    // noiseGain, sibGain, makeupGain (VocoderCarrier/PitchDetector are mocked, create no gains).
    const makeupGainResult = createGainSpy.mock.results[6];
    if (makeupGainResult?.type !== "return") {
      throw new Error("expected a createGain() return at index 6 (makeupGain)");
    }
    const makeupGainNode = makeupGainResult.value;

    effect.setParameter("outputGain", 6); // 6dB trim -> ~1.9953 linear

    const appliedGain = vi.mocked(makeupGainNode.gain.setTargetAtTime).mock.calls.at(-1)?.[0];
    expect(appliedGain).toBeCloseTo(dbToGain(toDecibels(6)), 3);

    createGainSpy.mockRestore();
    effect.cleanup();
  });

  it("per-band HF tilt gain matches the canonical gainUnits formula (DEV-296)", () => {
    // applyCarrierMix's tilt math (`10 ** ((tiltDbOct * Math.log2(freq/500)) / 20)`) was migrated
    // to `dbToGain(toDecibels(...))` — this was missed by the original migration sweep because it
    // uses `**` instead of `Math.pow`. Assert the gain actually written to a real GainNode's `.gain`
    // is unchanged. The global MockAudioParam (src/test/setup.ts) stubs setTargetAtTime without
    // mutating `.value`, so spy on createGain (same pattern as CompressorEffect.test.ts's
    // makeupGain assertion) to capture band 0's oscillator-carrier gain node and read the argument
    // passed to setTargetAtTime instead of the node's `.value`.
    const ctx = new AudioContext();
    const createGainSpy = vi.spyOn(ctx, "createGain");
    const effect = createVocoderEffect(ctx);
    // createVocoderEffect creates gain nodes in order: inputGain, wetGain, dryGain, outputGain
    // (VocoderCarrier/PitchDetector are mocked above, so they create none), noiseGain, sibGain,
    // makeupGain -> index 6, then buildBands()'s band 0: gOsc(7), gNoise(8), vca(9). Band 0's
    // freq is VOCODER_FREQ_LOW (100 Hz, see bandFreqs), so gOsc(index 7) is the band-0
    // oscillator-carrier gain node.
    const gOscResult = createGainSpy.mock.results[7];
    if (gOscResult?.type !== "return") {
      throw new Error("expected a createGain() return at index 7 (band 0 gOsc)");
    }
    const gOscNode = gOscResult.value;

    // buildBands() calls applyCarrierMix() once at construction (default tiltDbOct=4, band 0
    // freq=100Hz, noise crossover far above 100Hz so nMix=0 -> gOsc gets the full tilt value).
    const appliedTilt = vi.mocked(gOscNode.gain.setTargetAtTime).mock.calls.at(-1)?.[0];
    // Independently computed expected value (not via gainUnits, to avoid a circular check):
    // 10 ** ((4 * Math.log2(100/500)) / 20) ≈ 0.343253
    expect(appliedTilt).toBeCloseTo(0.343253, 5);

    createGainSpy.mockRestore();
    effect.cleanup();
  });
});
