import { describe, expect, it } from "vitest";

import {
  DEFAULT_PERCUSSION_SET_ID,
  ORCHESTRAL_PERC_SET,
  PERCUSSION_SETS,
  SMALL_HAND_PERC_SET,
  WORLD_HAND_DRUMS_SET,
  getPercussionSetConfig,
  getPercussionSetInstruments,
} from "../percussionSets";

describe("percussion sets", () => {
  it("exposes the Congas & Bongos set as default and it is versilian-backed", () => {
    const set = getPercussionSetConfig(DEFAULT_PERCUSSION_SET_ID);
    expect(set.id).toBe(DEFAULT_PERCUSSION_SET_ID);
    expect(set.providerKey).toBe("versilian-percussion");
    expect(Object.keys(set.gmNoteToRegion).length).toBeGreaterThan(0);
  });

  it("falls back to the default set for an unknown id", () => {
    expect(getPercussionSetConfig("nope").id).toBe(DEFAULT_PERCUSSION_SET_ID);
  });

  it("derives a de-duplicated instrument list for lazy loading", () => {
    const set = PERCUSSION_SETS[DEFAULT_PERCUSSION_SET_ID]!;
    const instruments = getPercussionSetInstruments(set);
    expect(new Set(instruments).size).toBe(instruments.length);
    const referenced = new Set(
      Object.values(set.gmNoteToRegion).map((r) => r.instrument),
    );
    expect(new Set(instruments)).toEqual(referenced);
  });

  it.each([
    ["world_hand_drums", WORLD_HAND_DRUMS_SET],
    ["small_hand_perc", SMALL_HAND_PERC_SET],
    ["orchestral_perc", ORCHESTRAL_PERC_SET],
  ])("%s set is versilian-backed with a non-empty region map", (_id, set) => {
    expect(set.providerKey).toBe("versilian-percussion");
    expect(Object.keys(set.gmNoteToRegion).length).toBeGreaterThan(0);
    const referenced = new Set(Object.values(set.gmNoteToRegion).map((r) => r.instrument));
    expect(new Set(getPercussionSetInstruments(set))).toEqual(referenced);
  });

  it("keeps claves(75) in Small Hand Perc (kit hands it off here in Phase B)", () => {
    expect(SMALL_HAND_PERC_SET.gmNoteToRegion[75]).toBeDefined();
  });

  it.each([
    ["congas_bongos", PERCUSSION_SETS[DEFAULT_PERCUSSION_SET_ID]!],
    ["world_hand_drums", WORLD_HAND_DRUMS_SET],
    ["small_hand_perc", SMALL_HAND_PERC_SET],
    ["orchestral_perc", ORCHESTRAL_PERC_SET],
  ])("%s: every pad has a non-empty, unique label", (_id, set) => {
    const regions = Object.values(set.gmNoteToRegion);
    const labels = regions.map((region) => region.label);

    for (const label of labels) {
      expect(typeof label).toBe("string");
      expect(label.trim().length).toBeGreaterThan(0);
    }

    expect(new Set(labels).size).toBe(labels.length);
  });
});
