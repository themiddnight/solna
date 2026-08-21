import { describe, it, expect } from "vitest";
import { getCalibratedTrimDb } from "../getCalibratedTrimDb";
import { CALIBRATION_TRIM_TABLE } from "../trimTable.data";

describe("getCalibratedTrimDb", () => {
  it("returns undefined for an unknown instrument (caller must fall back to a flat default)", () => {
    expect(getCalibratedTrimDb("not-a-real-instrument-id")).toBeUndefined();
  });

  it("returns the committed trimDb for every instrument present in the table", () => {
    for (const [instrumentId, entry] of Object.entries(CALIBRATION_TRIM_TABLE)) {
      expect(getCalibratedTrimDb(instrumentId)).toBe(entry.trimDb);
    }
  });
});
