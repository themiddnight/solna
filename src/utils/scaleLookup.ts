import { SCALES, type ScaleDefinition } from '@/data/scales';

/**
 * The ONE place an unrecognised scale type falls back to Major.
 *
 * It lived in three copies — `SCALES[t] || SCALES['Major']`,
 * `SCALES[t] ? t : 'Major'` and `SCALES[t] ?? SCALES['Major']` — across two
 * modules, so `getDiatonicChordForDegree` normalised a degree against the
 * fallback entry and then handed the ORIGINAL type down to a resolver that
 * redid the fallback for itself. One rule, one home: changing it (to throw,
 * say, matching the derivation's no-silent-fallback stance) is now one edit.
 *
 * This module holds the rule and nothing else so that both `noteSpelling.ts`
 * and `musicTheory.ts` can read it. `noteSpelling` must not import
 * `musicTheory` back — that cycle would be load-bearing at module-evaluation
 * time — so the shared rule cannot live in either of them.
 */
export function resolveScaleKey(scaleType: string): string {
  return SCALES[scaleType] ? scaleType : 'Major';
}

/** The SCALES entry a scale type names, with the same fallback. */
export function scaleEntry(scaleType: string): ScaleDefinition {
  return SCALES[resolveScaleKey(scaleType)];
}
