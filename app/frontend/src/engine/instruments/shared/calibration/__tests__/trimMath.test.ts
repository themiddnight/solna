import { describe, it, expect } from "vitest";
import { toDbfs, toDecibels } from "@/shared/audio/gainUnits";
import { TARGET_DBFS, TOLERANCE_DB, computeTrimDb, isWithinTolerance } from "../trimMath";

describe("trimMath — computeTrimDb", () => {
  it("TARGET_DBFS matches spec §4.4 / epic AC#1", () => {
    expect(TARGET_DBFS).toBe(-18);
    expect(TOLERANCE_DB).toBe(3);
  });

  it("computes trim as TARGET - measured", () => {
    // measured quieter than target -> positive trim (boost)
    expect(computeTrimDb(toDbfs(-24))).toBeCloseTo(6, 5);
    // measured louder than target -> negative trim (attenuate)
    expect(computeTrimDb(toDbfs(-10))).toBeCloseTo(-8, 5);
    // measured exactly at target -> zero trim
    expect(computeTrimDb(toDbfs(-18))).toBeCloseTo(0, 5);
  });

  it("accepts a custom target for testing", () => {
    expect(computeTrimDb(toDbfs(-20), toDbfs(-14))).toBeCloseTo(6, 5);
  });

  it("clamps nothing itself — clamping to the pre-gain range is the caller's job (Task 8)", () => {
    // an instrument that would need +40dB trim is a calibration red flag, not silently clippable here
    expect(computeTrimDb(toDbfs(-58))).toBeCloseTo(40, 5);
  });
});

describe("trimMath — isWithinTolerance", () => {
  it("true when measured+trim lands within TARGET ± TOLERANCE_DB", () => {
    expect(isWithinTolerance(toDbfs(-18), toDecibels(0))).toBe(true);
    expect(isWithinTolerance(toDbfs(-20), toDecibels(2))).toBe(true); // -18, exact
    expect(isWithinTolerance(toDbfs(-24), toDecibels(3))).toBe(true); // -21, within 3dB
  });

  it("false when the applied trim doesn't land within tolerance", () => {
    expect(isWithinTolerance(toDbfs(-30), toDecibels(2))).toBe(false); // -28, way off
  });
});
