import { describe, expect, it } from "vitest";
import { mapGmNoteToAcousticDrumPiece } from "../acousticDrumMapping";

describe("acoustic drum kit range (DEV-284)", () => {
  it("no longer maps claves(75) — it lives in percussions now", () => {
    expect(mapGmNoteToAcousticDrumPiece(75)).toBeNull();
  });
  it("still maps the real-kit range 35–57 + 59", () => {
    for (const n of [35, 36, 38, 42, 46, 49, 51, 54, 56, 57, 59]) {
      expect(mapGmNoteToAcousticDrumPiece(n)).not.toBeNull();
    }
  });
  it("does not map percussion notes 58 or 60–81", () => {
    for (const n of [58, 60, 63, 75, 81]) {
      expect(mapGmNoteToAcousticDrumPiece(n)).toBeNull();
    }
  });
});
