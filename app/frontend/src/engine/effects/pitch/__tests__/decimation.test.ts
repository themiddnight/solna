import { describe, it, expect } from "vitest";
import { decimateByThree, computeRms } from "../decimation";
import { PITCH_DECIMATED_WINDOW, PITCH_SOURCE_WINDOW } from "../pitchConstants";

function sine(freq: number, sampleRate: number, length: number): Float32Array {
  const b = new Float32Array(length);
  for (let i = 0; i < length; i++) b[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return b;
}

describe("decimateByThree", () => {
  it("writes exactly one third as many samples", () => {
    const out = new Float32Array(PITCH_DECIMATED_WINDOW);
    decimateByThree(sine(220, 48000, PITCH_SOURCE_WINDOW), out);
    expect(out.length).toBe(PITCH_SOURCE_WINDOW / 3);
  });

  it("preserves an in-band tone's amplitude within 3 dB", () => {
    const out = new Float32Array(PITCH_DECIMATED_WINDOW);
    decimateByThree(sine(220, 48000, PITCH_SOURCE_WINDOW), out);
    const ratio = computeRms(out) / computeRms(sine(220, 16000, PITCH_DECIMATED_WINDOW));
    expect(20 * Math.log10(ratio)).toBeGreaterThan(-3);
    expect(20 * Math.log10(ratio)).toBeLessThan(3);
  });

  it("attenuates a tone above the new Nyquist by at least 20 dB, so it cannot alias down", () => {
    // 10 kHz at 48 kHz would fold to 6 kHz after a naive /3 decimation.
    const out = new Float32Array(PITCH_DECIMATED_WINDOW);
    decimateByThree(sine(10000, 48000, PITCH_SOURCE_WINDOW), out);
    const attenuationDb = 20 * Math.log10(computeRms(out) / computeRms(sine(10000, 48000, PITCH_SOURCE_WINDOW)));
    expect(attenuationDb).toBeLessThan(-20);
  });

  it("allocates nothing — the same output buffer is reused", () => {
    const out = new Float32Array(PITCH_DECIMATED_WINDOW);
    const before = out;
    decimateByThree(sine(220, 48000, PITCH_SOURCE_WINDOW), out);
    expect(out).toBe(before);
  });
});

describe("computeRms", () => {
  it("is zero for silence", () => {
    expect(computeRms(new Float32Array(128))).toBe(0);
  });

  it("is ~0.707 for a full-scale sine", () => {
    expect(computeRms(sine(100, 16000, 1600))).toBeCloseTo(Math.SQRT1_2, 2);
  });
});
