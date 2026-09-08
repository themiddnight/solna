/**
 * Proves the AC end to end rather than by arithmetic: re-renders representative
 * drum KITS (DEV-387: a trim is per kit, not per voice — see the comment on
 * `DRUM_TRIMS` in src/data/trimTable.ts) and synth presets WITH the committed
 * trim applied, and measures the result again, asserting each lands within
 * TOLERANCE_DB of TARGET_DBFS.
 *
 * `check:levels` asserts the same guarantee from the recorded numbers in
 * milliseconds; this is the occasional confirmation that those numbers describe
 * real audio. Manual: it renders and shells out to ffmpeg.
 *
 * The +/-3 dB assertion below has enormous margin by design, not by accident:
 * the last measured worst deviation across all thirteen kits was -0.20 dB, with
 * every kit inside +/-0.2 dB of -18 dBFS. Read a PASS here as "the harness and
 * the table still agree with real audio", not as a precision measurement — a
 * FAIL means something is badly wrong, not that a patch drifted a fraction of
 * a dB.
 *
 * Not a `bun test` file, for the same reason as renderOffline.smoke.ts: it
 * renders through an OfflineAudioContext, which — together with two engine
 * idle/teardown timers (`markActivity()`'s 30s arm and voice teardown's own) —
 * holds the Bun process open. Hence the explicit process.exit() below; without
 * it, this hangs after finishing its work.
 *
 * Run: bun run calibration:verify
 */
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { TARGET_DBFS, TOLERANCE_DB } from '@/utils/trimMath';
import { measureDrumKit, measurePreset } from './renderOffline.ts';

/** A spread of measured levels and one deliberately extreme case: Trap Beat and
 *  Tight Pocket sit at the low and high ends of the committed kit range
 *  (-15.6 / -21.7 dBFS uncalibrated), and factory-cyber-drone is the one flagged
 *  entry — +13.3 dB, past the +/-12 dB fader range — so this also proves that
 *  entry lands on target once its (honoured, unclamped) trim is applied. */
const SAMPLE_KITS = ['Retro Drive', '808 Vintage', 'Trap Beat', 'Tight Pocket'];
const SAMPLE_PRESETS = ['factory-cosmic-lead', 'factory-cyber-drone'];

let failures = 0;
let worstDeviationDb = 0;

function report(label: string, measured: number) {
  const deviation = measured - TARGET_DBFS;
  if (Math.abs(deviation) > Math.abs(worstDeviationDb)) worstDeviationDb = deviation;
  const pass = Math.abs(deviation) <= TOLERANCE_DB;
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${label}  (${measured.toFixed(2)} dBFS, target ${TARGET_DBFS} +/-${TOLERANCE_DB})`,
  );
  if (!pass) failures += 1;
}

// measureDrumKit/measurePreset render, measure and (for kits only — see the
// asymmetry noted on measurePreset in renderOffline.ts) compensate for
// CALIBRATION_HEADROOM_DB internally, so this file never holds a raw
// attenuated value.
for (const kitName of SAMPLE_KITS) {
  report(`${kitName} (whole kit) with its trim applied`, await measureDrumKit(kitName, true));
}

for (const id of SAMPLE_PRESETS) {
  const preset = SYNTH_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`No such preset: ${id}`);
  report(`${id} with its trim applied`, await measurePreset(preset, true));
}

console.log(`\nWorst deviation from target: ${worstDeviationDb.toFixed(2)} dB.`);
console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
