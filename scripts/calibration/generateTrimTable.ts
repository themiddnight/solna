/**
 * Batch calibration orchestrator. For every drum KIT (13 kits, each measured as a
 * whole via its fixed reference backbeat — `DRUM_KIT_BAR` in renderOffline.ts, not
 * per voice; see the comment on `DRUM_TRIMS` in src/data/trimTable.ts) and every
 * synth preset: render the pattern through the offline harness, measure short-term
 * LUFS, compute the trim, hash the loudness-relevant config, and write the result
 * into the committed `src/data/trimTable.ts`.
 *
 * MANUAL / ON-DEMAND ONLY. It never runs in CI: rendering plus ffmpeg is minutes,
 * where the lock test that guards its output is milliseconds. See README.md.
 *
 * Partial-failure policy: a render/measure failure on one voice does NOT abort the
 * run — a render that already cost minutes is worth finishing so every OTHER
 * failure surfaces in the same pass, rather than one at a time across repeated
 * multi-minute runs. But the table is written ONLY if the whole catalogue
 * succeeded: writing a table missing the failed entries would be indistinguishable
 * from a human having deliberately removed them, which is exactly what Task 12's
 * checks must not be fooled by. A run with any failures exits non-zero having
 * left `src/data/trimTable.ts` untouched; fix the failure(s) and re-run the whole
 * command.
 *
 * Run: bun run calibration:generate
 */
import { DRUM_KITS } from '@/data/drumKits';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { FADER_MAX_DB } from '@/utils/gainUnits';
import { TARGET_DBFS, computeTrimDb } from '@/utils/trimMath';
import { resolveFfmpegPath } from './ffmpegPath.ts';
import { drumLoudnessHash, presetLoudnessHash } from './loudnessConfig.ts';
import { measureDrumKit, measurePreset } from './renderOffline.ts';
import { TRIM_TABLE_PATH, writeTrimTable, type GeneratedTrimEntry } from './writeTrimTable.ts';

/**
 * A trim bigger than the fader itself can give is a voicing problem, not a trim.
 * Flagged for a human, never auto-clamped: clamping would silently break the
 * ±3 dB guarantee the lock test then asserts from these same numbers.
 */
const REVIEW_LIMIT_DB = FADER_MAX_DB;

// Fail fast and loudly, with an install instruction, rather than sixty renders in.
try {
  const ffmpeg = resolveFfmpegPath();
  console.log(`Using ffmpeg at ${ffmpeg}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const drums: Record<string, GeneratedTrimEntry> = {};
const presets: Record<string, GeneratedTrimEntry> = {};
const flagged: string[] = [];
const failed: string[] = [];

const kitNames = Object.keys(DRUM_KITS);
const total = kitNames.length + SYNTH_PRESETS.length;
let done = 0;

function flagIfOutOfRange(label: string, trimDb: number) {
  if (Math.abs(trimDb) > REVIEW_LIMIT_DB) {
    flagged.push(`${label}: needs ${trimDb.toFixed(1)} dB, past the +/-${REVIEW_LIMIT_DB} dB fader range`);
  }
}

console.log(`Calibrating ${total} voices toward ${TARGET_DBFS} dBFS...`);

for (const kitName of kitNames) {
  done += 1;
  const label = kitName;
  process.stdout.write(`[${done}/${total}] ${label}... `);
  // One kit's failure must not abort a run that already cost minutes; it is
  // reported at the end alongside the out-of-range flags instead. The table is
  // written only if nothing failed (see the policy note above).
  try {
    // measureDrumKit renders and compensates for CALIBRATION_HEADROOM_DB
    // internally (see its comment in renderOffline.ts) — the level it returns
    // is already the true, unclipped one.
    const measuredDbfs = await measureDrumKit(kitName);
    const trimDb = computeTrimDb(measuredDbfs);
    flagIfOutOfRange(label, trimDb);
    drums[kitName] = { measuredDbfs, trimDb, configHash: drumLoudnessHash(kitName) };
    console.log(`${measuredDbfs.toFixed(1)} dBFS -> trim ${trimDb.toFixed(1)} dB`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAILED: ${message}`);
    failed.push(`${label}: ${message}`);
  }
}

for (const preset of SYNTH_PRESETS) {
  done += 1;
  process.stdout.write(`[${done}/${total}] ${preset.id}... `);
  try {
    const measuredDbfs = await measurePreset(preset);
    const trimDb = computeTrimDb(measuredDbfs);
    flagIfOutOfRange(preset.id, trimDb);
    presets[preset.id] = { measuredDbfs, trimDb, configHash: presetLoudnessHash(preset) };
    console.log(`${measuredDbfs.toFixed(1)} dBFS -> trim ${trimDb.toFixed(1)} dB`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAILED: ${message}`);
    failed.push(`${preset.id}: ${message}`);
  }
}

if (flagged.length > 0) {
  console.error(`\n${flagged.length} entry(ies) need a human decision (NOT auto-clamped):`);
  for (const line of flagged) console.error(`  - ${line}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} entry(ies) failed to render or measure:`);
  for (const line of failed) console.error(`  - ${line}`);
  console.error(
    `\nRefusing to write ${TRIM_TABLE_PATH}: a table silently missing these entries would read as ` +
      "if a human had deliberately removed them, which is exactly what Task 12's checks must not be " +
      'fooled by. Fix the failure(s) above and re-run the whole command.',
  );
  process.exit(1);
}

writeTrimTable(drums, presets);
console.log(`\nWrote ${Object.keys(presets).length} preset and ${kitNames.length} kit blocks to ${TRIM_TABLE_PATH}`);
console.log('Review the diff before committing — see scripts/calibration/README.md.');

// An OfflineAudioContext render, plus the engine's idle/teardown timers, keep the
// Bun process alive after all work is done; without this the command hangs.
process.exit(0);
