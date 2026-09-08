/**
 * Emits `src/data/trimTable.ts`. The output is a src/data/ LEAF, so it may hold
 * literals and type declarations and nothing else — no import (not even a sibling),
 * no `new`, no impure global, no declared function. `src/data/dataLayerPurity.test.ts`
 * lints that through eslint's own API, which is why this writer emits plain `number`
 * fields rather than `toDbfs(...)` calls the way murva's does.
 *
 * Numeric formatting: both `measuredDbfs` and `trimDb` are rounded to 2 decimal
 * places via `toFixed(2)` and re-parsed to a number before being embedded. Two
 * places is enough precision to be honest about an ffmpeg ebur128 reading (which
 * itself reports to 0.1 LUFS) while keeping a diff readable; going through
 * `toFixed` also guarantees `-18` and `-17.999999999999996` both render as the
 * same literal, which is what makes an unchanged table regenerate byte-identical.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface GeneratedTrimEntry {
  measuredDbfs: number;
  trimDb: number;
  configHash: string;
}

export const TRIM_TABLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/data/trimTable.ts',
);

const round = (value: number) => Number(value.toFixed(2));

const entryLiteral = (entry: GeneratedTrimEntry) =>
  `{ measuredDbfs: ${round(entry.measuredDbfs)}, trimDb: ${round(entry.trimDb)}, configHash: ${JSON.stringify(entry.configHash)} }`;

/** Same flat shape as PRESET_TRIMS now: DRUM_TRIMS is keyed by kit name, one entry
 *  per kit — see the comment on it in src/data/trimTable.ts. */
const renderEntries = (entries: Record<string, GeneratedTrimEntry>): string =>
  Object.keys(entries)
    .sort()
    .map((key) => `  ${JSON.stringify(key)}: ${entryLiteral(entries[key]!)},`)
    .join('\n');

export function renderTrimTableSource(
  drums: Record<string, GeneratedTrimEntry>,
  presets: Record<string, GeneratedTrimEntry>,
): string {
  const drumBody = renderEntries(drums);
  const presetBody = renderEntries(presets);

  return `/**
 * GENERATED FILE — do not hand-edit. Regenerate with \`bun run calibration:generate\`
 * (scripts/calibration/generateTrimTable.ts); hand edits are overwritten on the next run.
 * See scripts/calibration/README.md for when to re-run and what a flagged entry means.
 *
 * One measured trim per drum KIT (not per voice — a drum kit's voices are not
 * independent; see the comment on DRUM_TRIMS below) and per synth preset.
 * \`measuredDbfs\` is what the uncalibrated render measured at; \`trimDb\` is
 * TARGET_DBFS (-18) minus it; \`configHash\` fingerprints exactly the
 * loudness-affecting config, so \`bun run check:levels\` can tell a retune from a
 * re-run.
 */
export interface TrimEntry {
  /** The uncalibrated render's short-term LUFS median, in dBFS. */
  measuredDbfs: number;
  /** TARGET_DBFS - measuredDbfs. Applied as a linear gain by src/audio/trims.ts. */
  trimDb: number;
  /** sha256 over the loudness-affecting config, per scripts/calibration/loudnessConfig.ts. */
  configHash: string;
}

/** Kit name -> entry, measured from the kit's whole reference pattern (DEV-387). */
export const DRUM_TRIMS: Record<string, TrimEntry> = {
${drumBody}
};

/** Synth preset id -> entry. */
export const PRESET_TRIMS: Record<string, TrimEntry> = {
${presetBody}
};
`;
}

export function writeTrimTable(
  drums: Record<string, GeneratedTrimEntry>,
  presets: Record<string, GeneratedTrimEntry>,
): void {
  writeFileSync(TRIM_TABLE_PATH, renderTrimTableSource(drums, presets));
}
