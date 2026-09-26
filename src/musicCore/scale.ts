import { SCALES, type ScaleDefinition } from '@/data/scales';
import { scaleSemitonesForTonal } from './tonalAdapter';

/**
 * A SCALES entry plus the intervals its `tonal` name derives. SCALES states no
 * intervals: `tonal` is their one source, and src/data/scales.test.ts pins the
 * legacy scales' intervals so a saved project keeps sounding as it did.
 */
export type ResolvedScale = ScaleDefinition & { readonly intervals: readonly number[] };

function resolveScale(definition: ScaleDefinition): ResolvedScale {
  return Object.freeze({
    ...definition,
    intervals: Object.freeze(scaleSemitonesForTonal(definition.tonal)),
  });
}

/**
 * Every SCALES entry, resolved once at module load. A `tonal` name that does
 * not resolve throws here, so a bad library entry fails the first import
 * rather than playing silence.
 */
export const SCALE_LIBRARY: Readonly<Record<string, ResolvedScale>> = Object.freeze(
  Object.fromEntries(Object.entries(SCALES).map(([key, definition]) => [key, resolveScale(definition)])),
);

/**
 * The ONE place an unrecognised scale type falls back to Major.
 *
 * Moved from `src/utils/scaleLookup.ts` (DEV-392): this issue's own audit found
 * `src/utils/musicTheory.ts` still inlining the same `SCALES[t] || SCALES['Major']`
 * pattern at six call sites despite this resolver already existing, plus a fourth,
 * uncoordinated copy (a hardcoded Major interval array) in `src/audio/bassPatterns.ts`.
 * Living under `src/musicCore/` — rather than `src/utils/` — is what lets
 * `src/audio/bassPatterns.ts` and every future non-`utils/` consumer reach it through
 * the same `@/musicCore` barrel as every other pitch/scale primitive, with no direct
 * dependency on `src/utils/`.
 */
export function resolveScaleKey(scaleType: string): string {
  return Object.hasOwn(SCALES, scaleType) ? scaleType : 'Major';
}

/** The resolved library entry a scale type names, with the same fallback. */
export function scaleEntry(scaleType: string): ResolvedScale {
  return SCALE_LIBRARY[resolveScaleKey(scaleType)];
}

/**
 * The SCALES key whose degrees host this scale's chords: its `harmony` when it
 * names one, else the resolved key itself. An unknown type falls back to Major
 * first, through resolveScaleKey.
 *
 * Chord-side code (qualities, Roman numerals, diatonic and borrowed chords,
 * progressions, Chord mode, pad drone, bass steps) reads
 * `scaleEntry(harmonyKey(scaleType))`. Note-side code (scale notes, scale
 * lock, melody rows, arp, remap, spelling) reads `scaleEntry(scaleType)` (R358).
 */
export function harmonyKey(scaleType: string): string {
  const key = resolveScaleKey(scaleType);
  return SCALES[key].harmony ?? key;
}
