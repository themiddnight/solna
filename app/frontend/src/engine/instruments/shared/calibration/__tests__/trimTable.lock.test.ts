import { describe, it, expect } from "vitest";

import { getAllInstrumentDescriptors } from "../../instrumentCatalog";
import { hashInstrumentConfig } from "../configFingerprint";
import { isWithinTolerance } from "../trimMath";
import { CALIBRATION_TRIM_TABLE } from "../trimTable.data";

describe("calibration trim table — CI locking test (DEV-311, epic AC#1)", () => {
  it("every catalog instrument has a committed calibration entry", () => {
    const missing = getAllInstrumentDescriptors()
      .map((descriptor) => descriptor.id)
      .filter((instrumentId) => !CALIBRATION_TRIM_TABLE[instrumentId]);

    expect(missing, `Missing calibration for: ${missing.join(", ")}. Run bun run calibration:generate.`).toEqual([]);
  });

  it("every committed entry's measured+trim lands within TARGET ±3dB (epic AC#1)", () => {
    const outOfTolerance = Object.values(CALIBRATION_TRIM_TABLE)
      .filter((entry) => !isWithinTolerance(entry.measuredDbfs, entry.trimDb))
      .map((entry) => entry.instrumentId);

    expect(outOfTolerance, `Out of ±3dB tolerance: ${outOfTolerance.join(", ")}`).toEqual([]);
  });

  it("no committed instrument's config has drifted since it was last calibrated (soundfont swap / envelope edit guard)", () => {
    const drifted = getAllInstrumentDescriptors()
      .filter((descriptor) => {
        const entry = CALIBRATION_TRIM_TABLE[descriptor.id];
        if (!entry) return false; // caught by the "missing" test above
        const currentHash = hashInstrumentConfig({
          instrumentId: descriptor.id,
          loudnessRelevantConfig: { providerKey: descriptor.providerKey, providerConfig: descriptor.providerConfig },
        });
        return currentHash !== entry.configHash;
      })
      .map((descriptor) => descriptor.id);

    expect(
      drifted,
      `Config changed since last calibration for: ${drifted.join(", ")}. Re-run bun run calibration:generate.`,
    ).toEqual([]);
  });
});
