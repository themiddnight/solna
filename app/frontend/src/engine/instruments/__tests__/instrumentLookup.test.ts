 
import { describe, expect, it } from "vitest";

import { InstrumentCategory } from "../shared/constants";
import {
  getInstrumentCategoryById,
  getInstrumentLabelById,
} from "../utils/instrumentLookup";

describe("instrumentLookup", () => {
  it("recognizes DrumAbuse ids as DrumBeat instruments", () => {
    expect(getInstrumentCategoryById("drumabuse:roland-tr-909")).toBe(
      InstrumentCategory.DrumBeat,
    );
  });

  it("returns machine labels for DrumAbuse ids without the provider prefix", () => {
    expect(getInstrumentLabelById("drumabuse:roland-tr-909")).toBe(
      "Roland TR-909",
    );
  });
});
