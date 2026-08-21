/**
 * Batch calibration orchestrator (DEV-311 Task 9). For every catalog instrument: render its
 * assigned family's pattern through the offline harness, measure short-term LUFS, compute the
 * trim, hash its loudness-relevant config, and write the result into the committed
 * `trimTable.data.ts`. Manual/on-demand only — never runs in CI (see scripts/calibration/README.md).
 *
 * Run: `bun run --cwd app/frontend calibration:generate` (starts its own dev server).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getAllInstrumentDescriptors } from "../../src/engine/instruments/shared/instrumentCatalog";
import { hashInstrumentConfig } from "../../src/engine/instruments/shared/calibration/configFingerprint";
import { computeTrimDb } from "../../src/engine/instruments/shared/calibration/trimMath";
import type { CalibrationTrimTableEntry } from "../../src/engine/instruments/shared/calibration/trimTable.types";
import { INSTRUMENT_GAIN_MAX_DB, INSTRUMENT_GAIN_MIN_DB, InstrumentCategory } from "../../src/engine/instruments/shared/constants";

import { assignFamily } from "./fixtures/assignFamily";
import { measureLoudness } from "./measureLoudness";
import { createCalibrationRenderSession } from "./renderInstrumentOffline";

const OUT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/engine/instruments/shared/calibration/trimTable.data.ts",
);

/** `InstrumentCategory` value ("melodic") -> its enum member name ("Melodic"), so the generated
 * file can emit `InstrumentCategory.Melodic` instead of a bare string literal — `Dbfs`/`Decibels`
 * and `InstrumentCategory` are nominal (branded/enum) types that a raw JSON literal can't satisfy
 * without an `as` cast, which TR-27 reserves for genuine boundary crossings, not codegen output. */
const CATEGORY_ENUM_KEY_BY_VALUE = new Map(
  Object.entries(InstrumentCategory).map(([key, value]) => [value, key]),
);

function formatEntry(entry: CalibrationTrimTableEntry): string {
  const categoryKey = CATEGORY_ENUM_KEY_BY_VALUE.get(entry.category);
  if (!categoryKey) throw new Error(`Unreachable: unknown InstrumentCategory value "${entry.category}"`);

  return `  ${JSON.stringify(entry.instrumentId)}: {
    instrumentId: ${JSON.stringify(entry.instrumentId)},
    category: InstrumentCategory.${categoryKey},
    family: ${JSON.stringify(entry.family)},
    measuredDbfs: toDbfs(${entry.measuredDbfs}),
    trimDb: toDecibels(${entry.trimDb}),
    configHash: ${JSON.stringify(entry.configHash)},
    measuredAt: ${JSON.stringify(entry.measuredAt)},
  }`;
}

function writeTrimTable(entries: Record<string, CalibrationTrimTableEntry>): void {
  const body = `// GENERATED FILE — do not hand-edit. Run: bun run --cwd app/frontend calibration:generate
// See app/frontend/scripts/calibration/README.md for how to re-run the harness.
import { toDbfs, toDecibels } from "@/shared/audio/gainUnits";
import { InstrumentCategory } from "../constants";
import type { CalibrationTrimTable } from "./trimTable.types";

export const CALIBRATION_TRIM_TABLE: CalibrationTrimTable = {
${Object.values(entries).map(formatEntry).join(",\n")}
};
`;
  writeFileSync(OUT_PATH, body);
}

async function main(): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "murva-calibration-"));
  const descriptors = getAllInstrumentDescriptors();
  const entries: Record<string, CalibrationTrimTableEntry> = {};
  const flagged: string[] = [];
  const failed: string[] = [];

  console.log(`Calibrating ${descriptors.length} instruments...`);

  // One Chromium instance for the whole batch — a cold browser launch dominates
  // per-instrument cost, so reusing it across ~180 renders is what makes this tractable.
  const session = await createCalibrationRenderSession();
  try {
    for (const [index, descriptor] of descriptors.entries()) {
      const family = assignFamily(descriptor.category, descriptor.id);
      process.stdout.write(`[${index + 1}/${descriptors.length}] ${descriptor.id} (${family})... `);

      // One instrument's render/measure failure (e.g. a genuinely silent/edge-case sample) must
      // not abort a run that's already taken several minutes of progress on the rest of the
      // catalog — flagged for manual review below instead, same as an out-of-range trim.
      try {
        const wavBuffer = await session.render(descriptor.id, family);
        const wavPath = join(tmpDir, `${descriptor.id}.wav`);
        writeFileSync(wavPath, wavBuffer);
        const measuredDbfs = await measureLoudness(wavPath);
        const trimDb = computeTrimDb(measuredDbfs);

        if (trimDb < INSTRUMENT_GAIN_MIN_DB || trimDb > INSTRUMENT_GAIN_MAX_DB) {
          flagged.push(
            `${descriptor.id}: needs ${trimDb.toFixed(1)}dB trim, outside [${INSTRUMENT_GAIN_MIN_DB},${INSTRUMENT_GAIN_MAX_DB}] range`,
          );
        }

        entries[descriptor.id] = {
          instrumentId: descriptor.id,
          category: descriptor.category,
          family,
          measuredDbfs,
          trimDb,
          configHash: hashInstrumentConfig({
            instrumentId: descriptor.id,
            loudnessRelevantConfig: { providerKey: descriptor.providerKey, providerConfig: descriptor.providerConfig },
          }),
          measuredAt: new Date().toISOString(),
        };
        console.log(`${measuredDbfs.toFixed(1)}dBFS -> trim ${trimDb.toFixed(1)}dB`);

        // Persisted after every instrument, not just at the end, so a mid-run interruption
        // (this batch takes long enough on a loaded machine to realistically hit one) loses at
        // most the in-flight instrument, not the whole run.
        writeTrimTable(entries);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`FAILED: ${message}`);
        failed.push(`${descriptor.id}: ${message}`);
      }
    }
  } finally {
    await session.close();
  }

  if (flagged.length > 0) {
    console.error(
      `\n⚠️  ${flagged.length} instrument(s) outside the [${INSTRUMENT_GAIN_MIN_DB},${INSTRUMENT_GAIN_MAX_DB}]dB pre-gain range (needs manual review, NOT auto-clamped):`,
    );
    flagged.forEach((line) => console.error(`  - ${line}`));
  }

  if (failed.length > 0) {
    console.error(`\n❌ ${failed.length} instrument(s) failed to render/measure (no entry written, needs investigation):`);
    failed.forEach((line) => console.error(`  - ${line}`));
  }

  console.log(`\nWrote ${Object.keys(entries).length}/${descriptors.length} entries to ${OUT_PATH}`);
}

await main();
