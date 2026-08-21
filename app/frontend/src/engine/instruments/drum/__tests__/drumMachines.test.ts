import { describe, expect, it } from "vitest";
import { DRUM_ABUSE_GROUP_BY_ID, DRUM_BEAT_INSTRUMENTS, STUDIO_HD_GROUP } from "../constants";

const idOf = (v: string) => v.replace("drumabuse:", "");

describe("curated DrumAbuse list (DEV-294)", () => {
  const values = DRUM_BEAT_INSTRUMENTS.map((i) => i.value);

  it("drops the removed/duplicate machines", () => {
    expect(values).not.toContain("drumabuse:linn-lm-2");
    expect(values).not.toContain("drumabuse:korg-ddd-5");
  });

  it("includes representative curated machines", () => {
    for (const id of ["roland-tr-909", "oberheim-dmx", "simmons-sds-5", "casio-vl-1"]) {
      expect(values).toContain(`drumabuse:${id}`);
    }
  });

  it("has no duplicate values", () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it("every DrumAbuse entry has a character group", () => {
    const drumAbuseIds = values
      .filter((v) => v.startsWith("drumabuse:"))
      .map(idOf);
    for (const id of drumAbuseIds) {
      expect(DRUM_ABUSE_GROUP_BY_ID[id]).toBeDefined();
    }
  });

  it("has exactly the curated DrumAbuse group map entries reflected in the instrument list", () => {
    const drumAbuseIds = new Set(
      values.filter((v) => v.startsWith("drumabuse:")).map(idOf),
    );
    expect(drumAbuseIds.size).toBe(Object.keys(DRUM_ABUSE_GROUP_BY_ID).length);
    for (const id of Object.keys(DRUM_ABUSE_GROUP_BY_ID)) {
      expect(drumAbuseIds.has(id)).toBe(true);
    }
  });

  it("exposes STUDIO_HD_GROUP as a distinct group label", () => {
    expect(typeof STUDIO_HD_GROUP).toBe("string");
    expect(Object.values(DRUM_ABUSE_GROUP_BY_ID)).not.toContain(STUDIO_HD_GROUP);
  });
});
