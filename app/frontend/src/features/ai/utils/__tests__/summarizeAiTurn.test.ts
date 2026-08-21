import { describe, it, expect } from "vitest";
import type { NoteEditOp } from "@jam-band/shared";
import { summarizeEditOps, summarizeGeneratedNotes } from "../summarizeAiTurn";

describe("summarizeEditOps", () => {
  it("counts add/modify/remove ops into a short summary", () => {
    const ops: NoteEditOp[] = [
      { op: "add", note: { pitch: 60, start: 0, duration: 1, velocity: 100 } },
      { op: "add", note: { pitch: 62, start: 1, duration: 1, velocity: 100 } },
      { op: "modify", target: 0, set: { velocity: 90 } },
      { op: "remove", target: 3 },
    ];

    expect(summarizeEditOps(ops)).toBe("added 2, modified 1, removed 1");
  });

  it("reports no changes for an empty op list", () => {
    expect(summarizeEditOps([])).toBe("no changes");
  });

  it("omits zero-count categories", () => {
    const ops: NoteEditOp[] = [{ op: "remove", target: 0 }];
    expect(summarizeEditOps(ops)).toBe("removed 1");
  });
});

describe("summarizeGeneratedNotes", () => {
  it("reports the generated note count", () => {
    expect(
      summarizeGeneratedNotes([
        { pitch: 60, start: 0, duration: 1, velocity: 100 },
        { pitch: 62, start: 1, duration: 1, velocity: 100 },
      ]),
    ).toBe("generated 2 notes");
  });

  it("handles zero notes", () => {
    expect(summarizeGeneratedNotes([])).toBe("generated 0 notes");
  });
});
