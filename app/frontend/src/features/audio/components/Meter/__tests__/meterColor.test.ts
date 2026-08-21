import { describe, it, expect } from "vitest";
import { meterColorForZone } from "../meterColor";

describe("meterColorForZone", () => {
  it("returns a distinct color per zone", () => {
    expect(meterColorForZone("tooQuiet")).not.toBe(meterColorForZone("good"));
    expect(meterColorForZone("good")).not.toBe(meterColorForZone("hot"));
    expect(meterColorForZone("hot")).not.toBe(meterColorForZone("over"));
  });
});
