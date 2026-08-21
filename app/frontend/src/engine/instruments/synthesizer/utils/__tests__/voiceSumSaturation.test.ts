import { describe, it, expect } from "vitest";
import {
  computeVoiceSumGain,
  softClipSample,
  buildSoftClipCurve,
  lookupSoftClipCurve,
  SATURATION_DRIVE,
} from "../voiceSumSaturation";
import { gainToDb, toLinearGain } from "@/shared/audio/gainUnits";

describe("computeVoiceSumGain", () => {
  it("returns unity gain for a single voice (AC 2: single note unchanged)", () => {
    expect(computeVoiceSumGain(1)).toBe(1);
  });

  it("returns exactly 1/√N for the default exponent, matching the VocoderCarrier.ts:94 precedent", () => {
    expect(computeVoiceSumGain(4)).toBeCloseTo(1 / Math.sqrt(4), 10);
    expect(computeVoiceSumGain(9)).toBeCloseTo(1 / Math.sqrt(9), 10);
  });

  it("floors voice count at 1 — never divides by zero or produces gain > 1", () => {
    expect(computeVoiceSumGain(0)).toBe(1);
    expect(computeVoiceSumGain(-1)).toBe(1);
  });

  it("honors a custom exponent for tuning experiments", () => {
    expect(computeVoiceSumGain(4, 0.25)).toBeCloseTo(Math.pow(4, -0.25), 10);
  });
});

describe("softClipSample", () => {
  it("has unity slope at zero regardless of drive (AC 2 guarantee) — probed via a tiny input", () => {
    const epsilon = 1e-6;
    expect(softClipSample(epsilon, SATURATION_DRIVE) / epsilon).toBeCloseTo(1, 3);
    expect(softClipSample(epsilon, 3)).toBeCloseTo(epsilon, 8);
  });

  it("is near-identity for typical single-note peak levels (no audible coloration)", () => {
    // -10 dBFS ≈ 0.316 linear — a plausible single-note headroom point pre-calibration (DEV-311).
    const x = 0.316;
    const deviationDb = 20 * Math.log10(softClipSample(x, SATURATION_DRIVE) / x);
    expect(Math.abs(deviationDb)).toBeLessThan(0.5); // inaudible coloration
  });

  it("documents (does not gate) the growing coloration at higher, still-realistic single-note levels (DEV-299 final-review Finding 2)", () => {
    // The test above only checks a comfortably-safe -10dBFS (0.316) input. But the synth's real
    // output volume knob (gainRef, user-adjustable, pre-saturator) plus a resonant filter can
    // realistically push a single-note peak into the 0.5-1.0 range, where the shipped curve's
    // actual deviation is meaningfully larger. This test MEASURES and LOCKS that known behavior —
    // it is deliberately NOT asserting inaudibility with a tight tolerance (that would misrepresent
    // a real finding as a non-issue); whether the coloration at these levels is acceptable is a
    // judgment call for the plan's by-ear verification pass (Task 5, Steps 2-3), not this test.
    const deviationDbAt = (x: number): number => 20 * Math.log10(softClipSample(x, SATURATION_DRIVE) / x);

    const deviationAt05 = deviationDbAt(0.5);
    const deviationAt07 = deviationDbAt(0.7);

    // Measured at SATURATION_DRIVE=1.2: ≈-0.96dB at x=0.5, ≈-1.76dB at x=0.7 (always attenuating,
    // never boosting, since f(x) <= x for tanh/drive with drive > 0). Loose bounds with margin —
    // not a tight pass/fail gate — so this fails loudly only if a future drive-constant change
    // makes the coloration substantially worse than what's documented here.
    expect(Math.abs(deviationAt05)).toBeLessThan(1.5);
    expect(Math.abs(deviationAt07)).toBeLessThan(3);
  });

  it("compresses the top end for drive > 0 (f(1) < 1)", () => {
    expect(softClipSample(1, SATURATION_DRIVE)).toBeLessThan(1);
    expect(softClipSample(1, SATURATION_DRIVE)).toBeGreaterThan(0.5); // gentle, not a hard clip
  });

  it("is the identity function when drive is 0 or negative (no-op guard)", () => {
    expect(softClipSample(0.7, 0)).toBe(0.7);
    expect(softClipSample(0.7, -1)).toBe(0.7);
  });

  it("is monotonically non-decreasing across the input range", () => {
    const samples = Array.from({ length: 21 }, (_, i) => -1 + i * 0.1);
    for (let i = 1; i < samples.length; i++) {
      expect(softClipSample(samples[i]!, SATURATION_DRIVE)).toBeGreaterThanOrEqual(
        softClipSample(samples[i - 1]!, SATURATION_DRIVE),
      );
    }
  });
});

describe("buildSoftClipCurve + lookupSoftClipCurve", () => {
  it("builds a curve whose sampled lookup matches softClipSample closely (quantization tolerance only)", () => {
    const curve = buildSoftClipCurve(SATURATION_DRIVE);
    for (const x of [-1, -0.5, -0.1, 0, 0.1, 0.5, 1]) {
      expect(lookupSoftClipCurve(curve, x)).toBeCloseTo(softClipSample(x, SATURATION_DRIVE), 2);
    }
  });

  it("clamps out-of-range input to the curve's endpoint value, matching WaveShaperNode semantics", () => {
    const curve = buildSoftClipCurve(SATURATION_DRIVE);
    expect(lookupSoftClipCurve(curve, 5)).toBeCloseTo(lookupSoftClipCurve(curve, 1), 5);
    expect(lookupSoftClipCurve(curve, -5)).toBeCloseTo(lookupSoftClipCurve(curve, -1), 5);
  });

  it("defaults to SATURATION_CURVE_SIZE samples", () => {
    expect(buildSoftClipCurve(SATURATION_DRIVE).length).toBe(2048);
  });
});

/**
 * "Offline render" locking test for DEV-299's DoD (see Decision 3 in the plan for why this is
 * numeric/analytic rather than a real OfflineAudioContext render — the codebase has neither
 * infrastructure nor a real DSP-capable test AudioContext).
 *
 * The two summing laws are exact, deterministic identities, not approximations:
 *   - Coherent sum (synth, phase-aligned voices): amplitude scales ×N  -> RMS scales ×N.
 *   - Incoherent sum (melodic/sampled, uncorrelated phase): independent powers add
 *     -> total power scales ×N -> RMS scales ×√N.
 * This locks that applying computeVoiceSumGain (1/√N) to the coherent amplitude ratio produces
 * the SAME growth law as the incoherent reference (N / √N = √N), which is why AC 1's ~3 dB
 * tolerance is met with room to spare BEFORE saturation even engages — saturation (Task 3) is a
 * headroom backstop for transient overshoot beyond this average-level model, not the primary
 * loudness corrector.
 */
describe("voice-sum fix — offline-render locking test (DEV-299 DoD, AC 1 + AC 2)", () => {
  const melodicRmsRatio = (voiceCount: number): number => Math.sqrt(voiceCount);
  const synthRawRmsRatio = (voiceCount: number): number => voiceCount; // pre-fix, coherent, ×N

  it("documents the pre-fix problem: raw coherent stacking is ~6dB hotter than melodic at a 4-note chord", () => {
    const rawDeltaDb = gainToDb(toLinearGain(synthRawRmsRatio(4))) - gainToDb(toLinearGain(1));
    const melodicDeltaDb = gainToDb(toLinearGain(melodicRmsRatio(4))) - gainToDb(toLinearGain(1));
    expect(rawDeltaDb - melodicDeltaDb).toBeCloseTo(6.02, 1); // matches spec §7's observed ~6dB gap
  });

  it("AC 1: after the voice-sum gain fix, the synth's 1-note-vs-4-note delta is within ~3dB of the melodic reference", () => {
    const voiceCount = 4;
    const fixedSynthRmsRatio = synthRawRmsRatio(voiceCount) * computeVoiceSumGain(voiceCount);
    const fixedDeltaDb = gainToDb(toLinearGain(fixedSynthRmsRatio)) - gainToDb(toLinearGain(1));
    const melodicDeltaDb = gainToDb(toLinearGain(melodicRmsRatio(voiceCount))) - gainToDb(toLinearGain(1));

    expect(Math.abs(fixedDeltaDb - melodicDeltaDb)).toBeLessThanOrEqual(3); // AC 1 tolerance
    // Exact match expected: N * (1/√N) = √N, algebraically identical to the melodic growth law.
    expect(fixedDeltaDb).toBeCloseTo(melodicDeltaDb, 5);
  });

  it("AC 1 holds at 2-note and 8-note chords too, not just the 4-note case", () => {
    for (const voiceCount of [2, 8]) {
      const fixedSynthRmsRatio = synthRawRmsRatio(voiceCount) * computeVoiceSumGain(voiceCount);
      const fixedDeltaDb = gainToDb(toLinearGain(fixedSynthRmsRatio)) - gainToDb(toLinearGain(1));
      const melodicDeltaDb = gainToDb(toLinearGain(melodicRmsRatio(voiceCount))) - gainToDb(toLinearGain(1));
      expect(Math.abs(fixedDeltaDb - melodicDeltaDb)).toBeLessThanOrEqual(3);
    }
  });

  it("AC 2: at a plausible single-note operating level, the shipped curve (sampled table, not the raw function) adds negligible coloration", () => {
    const curve = buildSoftClipCurve(SATURATION_DRIVE);
    const singleNotePeak = 0.316; // ≈ -10 dBFS, a plausible pre-calibration (DEV-311) headroom point
    const shaped = lookupSoftClipCurve(curve, singleNotePeak);
    const deviationDb = gainToDb(toLinearGain(shaped / singleNotePeak));
    expect(Math.abs(deviationDb)).toBeLessThan(0.5);
  });

  it("saturation provides additional headroom protection beyond the linear voice-sum fix for a hot, non-ideal 4-note chord", () => {
    // Models a chord that overshoots the ideal coherent assumption (e.g. transient constructive
    // interference beyond the steady-state ×N model) — input amplitude 1.4x the ceiling.
    const curve = buildSoftClipCurve(SATURATION_DRIVE);
    const overshootInput = 1.4;
    const shapedOutput = lookupSoftClipCurve(curve, overshootInput);
    const linearOutput = overshootInput; // what an unshaped signal would do
    expect(shapedOutput).toBeLessThan(linearOutput); // saturation is doing real work here
    expect(shapedOutput).toBeGreaterThan(0); // and it's not a hard mute/dropout
  });
});
