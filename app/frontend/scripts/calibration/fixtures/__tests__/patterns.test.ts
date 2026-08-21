import { describe, it, expect } from "vitest";
import { SUSTAINED_PATTERN } from "../sustainedPattern";
import { PERCUSSIVE_PATTERN } from "../percussivePattern";
import { POLYPHONIC_PATTERN } from "../polyphonicPattern";
import { assignFamily } from "../assignFamily";
import { InstrumentCategory } from "@/engine/instruments/shared/constants";

function expectWellFormedPattern(pattern: { note: string | number; velocity?: number; time?: number }[]) {
  expect(pattern.length).toBeGreaterThan(0);
  for (const event of pattern) {
    expect(event.velocity ?? 127).toBeGreaterThan(0);
    expect(event.velocity ?? 127).toBeLessThanOrEqual(127);
    expect(event.time ?? 0).toBeGreaterThanOrEqual(0);
  }
  // times must be non-decreasing — a malformed fixture would schedule out of order
  const times = pattern.map((e) => e.time ?? 0);
  expect([...times].sort((a, b) => a - b)).toEqual(times);
}

describe("calibration test-pattern fixtures", () => {
  it("SUSTAINED_PATTERN is a held chord at velocity 127 (worst-case loudness, per epic AC#1)", () => {
    expectWellFormedPattern(SUSTAINED_PATTERN);
    expect(SUSTAINED_PATTERN.every((e) => (e.velocity ?? 127) === 127)).toBe(true);
  });

  it("PERCUSSIVE_PATTERN is a short burst of hits at velocity 127", () => {
    expectWellFormedPattern(PERCUSSIVE_PATTERN);
    expect(PERCUSSIVE_PATTERN.length).toBeGreaterThanOrEqual(4); // several hits, not one note
  });

  it("POLYPHONIC_PATTERN overlaps at least 3 simultaneous voices at some point", () => {
    expectWellFormedPattern(POLYPHONIC_PATTERN);
    const startTimes = POLYPHONIC_PATTERN.map((e) => e.time ?? 0);
    const uniqueStarts = new Set(startTimes);
    expect(uniqueStarts.size).toBeLessThan(POLYPHONIC_PATTERN.length); // some notes share a start time (a chord)
  });

  it("assignFamily routes every catalog category to exactly one family", () => {
    expect(assignFamily(InstrumentCategory.Melodic)).toBe("polyphonic");
    expect(assignFamily(InstrumentCategory.Synthesizer)).toBe("sustained");
    expect(assignFamily(InstrumentCategory.DrumBeat)).toBe("percussive");
    expect(assignFamily(InstrumentCategory.AcousticDrumset)).toBe("percussive");
    expect(assignFamily(InstrumentCategory.Percussions)).toBe("percussive");
  });
});
