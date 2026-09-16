import { SCALES, type ScaleDefinition } from '@/data/scales';

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

/** The SCALES entry a scale type names, with the same fallback. */
export function scaleEntry(scaleType: string): ScaleDefinition {
  return SCALES[resolveScaleKey(scaleType)];
}
