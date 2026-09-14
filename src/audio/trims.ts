/**
 * The application side of the calibration table. Layering rule 2 lets src/audio/
 * read src/data/, which is what keeps this one hop and puts no lookup in the
 * store.
 *
 * It never rewrites an authored number. `DRUM_KITS`'s `gain`/`clickLevel`/
 * `bodyGain`/`noiseGain` stay exactly as authored, so the diff of a retune stays
 * readable; the measured trim multiplies on top.
 *
 * DRUM KITS ONLY. There was a `synthTrimGainFor(presetName)` here, resolving a
 * preset's measured trim through a name -> id index built at module load. It is
 * gone with the engine-discriminated patch: a patch carries its own
 * `common.outputGainDb`, so a preset a user edits, saves or exports stays
 * calibrated, where a name lookup silently gave a renamed or user-authored patch
 * somebody else's trim. The drum half is unchanged because a kit is still chosen
 * by name and has no patch to carry a number in.
 */
import { DRUM_TRIMS } from '@/data/trimTable';
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
