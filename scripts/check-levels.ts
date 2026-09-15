/**
 * Verifies the committed calibration trim table still describes today's defaults:
 *  1. every Beat preset and every synth preset has an entry;
 *  2. no entry names a preset that no longer exists;
 *  3. no entry's loudness-affecting config has drifted since it was calibrated;
 *  4. every entry's measurement plus the gain actually applied on top of it — a
 *     Beat patch's own `outputTrimDb`, a synth preset's own `common.outputGainDb` — lands within
 *     TOLERANCE_DB of TARGET_DBFS.
 *
 * Reads the table and hashes data. It NEVER renders audio and never spawns ffmpeg:
 * that is `bun run calibration:generate`, which is manual and takes minutes.
 *
 * Run with: bun run check:levels
 * Exit code 1 if any check fails.
 */
import { TARGET_DBFS, TOLERANCE_DB } from './calibration/trimMath.ts';
import {
  findDriftedEntries,
  findMissingEntries,
  findOrphanEntries,
  findOutOfToleranceEntries,
  type LevelFinding,
} from './calibration/levelChecks.ts';

let failures = 0;

function report(label: string, findings: LevelFinding[]) {
  const pass = findings.length === 0;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (pass) return;
  failures += 1;
  for (const finding of findings) console.log(`        ${finding.id}: ${finding.detail}`);
}

console.log(`Calibration target ${TARGET_DBFS} dBFS, tolerance +/-${TOLERANCE_DB} dB.\n`);
report('every Beat and synth preset has a committed entry', findMissingEntries());
report('no entry outlives the preset it names', findOrphanEntries());
report('no loudness-affecting default has drifted since calibration', findDriftedEntries());
report('every measurement plus its applied gain lands within tolerance', findOutOfToleranceEntries());

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
