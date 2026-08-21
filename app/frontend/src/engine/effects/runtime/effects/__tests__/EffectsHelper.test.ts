import { describe, it, expect } from "vitest";
import { equalPowerGains } from "../EffectsHelper";

describe("equalPowerGains (equal-power dry/wet law)", () => {
  it("wet=0 → full dry", () => {
    expect(equalPowerGains(0)).toEqual({ wet: 0, dry: 1 });
  });

  it("wet=1 → full wet", () => {
    const g = equalPowerGains(1);
    expect(g.wet).toBeCloseTo(1, 6);
    expect(g.dry).toBeCloseTo(0, 6);
  });

  it("wet=0.5 → equal power (~0.707 each, sum of squares = 1)", () => {
    const g = equalPowerGains(0.5);
    expect(g.wet).toBeCloseTo(Math.SQRT1_2, 6);
    expect(g.dry).toBeCloseTo(Math.SQRT1_2, 6);
    expect(g.wet ** 2 + g.dry ** 2).toBeCloseTo(1, 6);
  });

  it("clamps out-of-range input", () => {
    expect(equalPowerGains(-1)).toEqual({ wet: 0, dry: 1 });
    const hi = equalPowerGains(2);
    expect(hi.wet).toBeCloseTo(1, 6);
  });
});
