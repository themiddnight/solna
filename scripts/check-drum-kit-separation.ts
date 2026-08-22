/**
 * Verifies that the 12 drum kits in DRUM_KITS are audibly distinguishable:
 *  1. Every kit overrides EVERY drum type (no type left at DEFAULT_DRUM_KIT values).
 *  2. Each listed parameter has enough spread (max >= factor * min) across merged kits.
 *
 * Run with: bun scripts/check-drum-kit-separation.ts
 * Exit code 1 if any check fails.
 */
import {
  DEFAULT_DRUM_KIT,
  DRUM_KITS,
  mergeDrumKit,
  type DrumKit,
} from '../src/audio/drumKits.ts';

const DRUM_TYPES: (keyof DrumKit)[] = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'];

let failures = 0;

function report(label: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!pass) failures += 1;
}

const kits = Object.entries(DRUM_KITS).map(([name, partial]) => ({
  name,
  kit: mergeDrumKit(partial),
}));

// --- Check 1: every kit overrides every drum type ---
for (const { name, kit } of kits) {
  for (const type of DRUM_TYPES) {
    const merged = kit[type] as Record<string, unknown>;
    const defaults = DEFAULT_DRUM_KIT[type] as Record<string, unknown>;
    const differingParams = Object.keys(merged).filter((key) => merged[key] !== defaults[key]);
    const pass = differingParams.length > 0;
    const detail = pass
      ? `differs in ${differingParams.length} of ${Object.keys(merged).length} params`
      : `NO override: ${type} equals DEFAULT_DRUM_KIT`;
    report(`kit "${name}" overrides ${type}`, pass, detail);
  }
}

// --- Check 2: spread requirements (min/max across merged kits) ---
function spread(label: string, pick: (kit: DrumKit) => number, factor: number) {
  const values = kits.map((k) => pick(k.kit));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const required = factor * min;
  report(
    `${label} spread`,
    max >= required,
    `max=${max}, min=${min}, required max >= ${factor}*min=${required.toFixed(3)}`,
  );
}

spread('hihat.filter', (k) => k.hihat.filter, 2.5);
spread('kick.decay', (k) => k.kick.decay, 3);
spread('kick.freqEnd', (k) => k.kick.freqEnd, 1.5);
spread('snare.noiseFilter', (k) => k.snare.noiseFilter, 2.8);
spread('snare.bodyFreqEnd', (k) => k.snare.bodyFreqEnd, 1.5);
spread('clap.filter', (k) => k.clap.filter, 1.8);
spread('openhat.filter', (k) => k.openhat.filter, 2.2);
spread('crash.filter', (k) => k.crash.filter, 1.5);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
