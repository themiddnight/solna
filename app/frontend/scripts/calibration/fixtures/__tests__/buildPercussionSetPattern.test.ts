import { describe, it, expect } from "vitest";
import { buildPercussionSetPattern, PERCUSSION_SET_PATTERN_DURATION_SEC } from "../buildPercussionSetPattern";
import type { PercussionSetConfig } from "@/engine/instruments/percussion/types";

const makeSet = (gmNotes: number[]): PercussionSetConfig => ({
  id: "test_set",
  label: "Test Set",
  icon: "drum",
  controlType: "drumpad" as PercussionSetConfig["controlType"],
  providerKey: "versilian-percussion",
  gmNoteToRegion: Object.fromEntries(
    gmNotes.map((note) => [note, { instrument: "Test/Instrument", note, label: `Pad ${note}` }]),
  ),
});

describe("buildPercussionSetPattern", () => {
  it("only ever plays notes that exist in the set's gmNoteToRegion", () => {
    const set = makeSet([60, 61, 62]);
    const pattern = buildPercussionSetPattern(set);
    expect(pattern.every((event) => [60, 61, 62].includes(Number(event.note)))).toBe(true);
  });

  it("cycles through every pad, not just the first one", () => {
    const set = makeSet([90, 91, 92, 93, 94]);
    const pattern = buildPercussionSetPattern(set);
    const notesUsed = new Set(pattern.map((event) => event.note));
    expect(notesUsed).toEqual(new Set([90, 91, 92, 93, 94]));
  });

  it("fills the full pattern duration with velocity-127 hits", () => {
    const set = makeSet([100]);
    const pattern = buildPercussionSetPattern(set);
    expect(pattern.length).toBeGreaterThan(0);
    expect(pattern.every((event) => event.velocity === 127)).toBe(true);
    expect(pattern[pattern.length - 1]?.time).toBeLessThan(PERCUSSION_SET_PATTERN_DURATION_SEC);
  });

  it("throws for a set with no pads rather than silently producing an empty pattern", () => {
    expect(() => buildPercussionSetPattern(makeSet([]))).toThrow(/no pads/);
  });
});
