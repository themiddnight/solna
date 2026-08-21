import { describe, it, expect } from "vitest";
import { EFFECT_TYPE, type EffectType } from "@/engine/effects/model";

describe("EFFECT_TYPE", () => {
  it("maps enum-style keys to canonical string literals", () => {
    expect(EFFECT_TYPE.REVERB).toBe<EffectType>("reverb");
    expect(EFFECT_TYPE.PINGPONGDELAY).toBe<EffectType>("pingpongdelay");
  });
  it("covers all 20 effect types", () => {
    expect(Object.values(EFFECT_TYPE)).toHaveLength(20);
  });
});
