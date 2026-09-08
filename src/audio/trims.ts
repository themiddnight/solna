/**
 * The application side of the calibration table. Layering rule 2 lets src/audio/
 * read src/data/, which is what keeps this one hop and puts no lookup in the
 * store.
 *
 * It never rewrites an authored number. `DRUM_KITS`'s `gain`/`clickLevel`/
 * `bodyGain`/`noiseGain` and every preset's params stay exactly as authored, so the
 * diff of a retune stays readable; the measured trim multiplies on top.
 */
import { DRUM_TRIMS, PRESET_TRIMS } from '@/data/trimTable';
import { SYNTH_PRESETS } from '@/data/synthPresets';
import { dbToGain, toDecibels } from '@/utils/gainUnits';

/** Unity. What an uncalibrated voice gets — never a guess, never a clamp. */
export const NEUTRAL_TRIM_GAIN = 1;

/**
 * One gain for the whole kit, not one per voice: `DRUM_TRIMS` is keyed by kit name
 * (see the comment on it in src/data/trimTable.ts — a drum kit's voices are not
 * independent, so calibration must preserve the kit's own internal balance rather
 * than flatten it). Resolved once per kit change, not per hit: `triggerDrum` is on
 * the hot path and a single field read is cheaper than a lookup plus a dB
 * conversion on every trigger.
 */
export function drumTrimGainFor(kitName: string | undefined): number {
  const entry = kitName === undefined ? undefined : DRUM_TRIMS[kitName];
  return entry ? dbToGain(toDecibels(entry.trimDb)) : NEUTRAL_TRIM_GAIN;
}

/**
 * `PRESET_TRIMS` is keyed by preset ID (shared contract), but the engine only ever
 * sees `params.preset`, which `applyPreset` sets to the preset NAME. This index is
 * that bridge, built once at module load over the factory library only.
 *
 * Consequence, bounded and deliberate: a USER preset whose name happens to match a
 * factory patch's name inherits that patch's trim. A user preset with any other
 * name gets NEUTRAL_TRIM_GAIN, which is the correct answer for a patch nobody
 * measured. `src/audio/trims.test.ts` asserts factory names are unique, which is
 * what makes the index single-valued.
 */
const TRIM_GAIN_BY_PRESET_NAME: Record<string, number> = Object.fromEntries(
  SYNTH_PRESETS.flatMap((preset) => {
    const entry = PRESET_TRIMS[preset.id];
    return entry ? [[preset.name, dbToGain(toDecibels(entry.trimDb))] as const] : [];
  }),
);

export function synthTrimGainFor(presetName: string | undefined): number {
  if (presetName === undefined) return NEUTRAL_TRIM_GAIN;
  return TRIM_GAIN_BY_PRESET_NAME[presetName] ?? NEUTRAL_TRIM_GAIN;
}
