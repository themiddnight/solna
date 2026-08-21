import { describe, it, expect } from "vitest";
import { defaultSynthState, DEFAULT_SYNTH_GAIN_DB } from "../constants";

describe("synthesizer constants — DEV-300 volume-to-dB migration", () => {
  it("DEFAULT_SYNTH_GAIN_DB is the rounded dB-equivalent of the old 0.5 linear default", () => {
    // 20*log10(0.5) ≈ -6.0206dB; locked decision: round to -6, not -6.02
    expect(DEFAULT_SYNTH_GAIN_DB).toBe(-6);
  });

  it("defaultSynthState.volume now holds a dB value, not the old linear 0.5", () => {
    expect(defaultSynthState.volume).toBe(DEFAULT_SYNTH_GAIN_DB);
    expect(defaultSynthState.volume).not.toBe(0.5);
  });

  it("defaultSynthState.volume is within the epic's pre-gain range (-24..+24 dB)", () => {
    expect(defaultSynthState.volume).toBeGreaterThanOrEqual(-24);
    expect(defaultSynthState.volume).toBeLessThanOrEqual(24);
  });
});
