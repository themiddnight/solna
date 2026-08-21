import { describe, expect, it } from "vitest";
import { InstrumentCategory, isDrumpadCategory } from "../constants";

describe("Percussions category", () => {
  it("exists as a distinct category value", () => {
    expect(InstrumentCategory.Percussions).toBe("percussions");
  });

  it("is a drumpad category (played on pads, not a keyboard)", () => {
    expect(isDrumpadCategory(InstrumentCategory.Percussions)).toBe(true);
  });
});
