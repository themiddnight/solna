import type { ChordItem } from '@/types';
import { snapProgressionToScale, transposeProgression } from '@/utils/musicTheory';

/**
 * The two pure rules behind ChordView's auto-harmonize effect.
 *
 * They live beside the hook that runs them rather than inside ChordView: the
 * component is a view, and these are decisions about what a key change MEANS.
 * ChordView re-exports both, because the repo convention is that a component
 * exports its testable helpers and ChordView is where they are read from.
 */

/**
 * Whether a run of the auto-harmonize effect should clear a stale "Auto-
 * Reharmonized" badge left over from an earlier run.
 *
 * `chordsReplaced` means "this render's chord array is not the one the last run
 * saw" — an Instant Vibe, a library preset or a template just wrote it. Those
 * chords were built in the key that arrived with them, so no key delta this
 * effect can observe is a delta they need. It is checked first for that reason.
 *
 * `chordsReplaced` alone is not enough: it is also true for the Re-harmonize
 * button and for manual chord edits (add / delete / reorder), both of which
 * replace the `chords` array reference but leave the key untouched — clearing
 * on `chordsReplaced` alone wipes the badge those actions just set. An
 * Instant Vibe swap sets root, scale and chords together, so requiring the
 * key to have actually changed is what distinguishes it from those cases.
 *
 * Known residual (not a regression, not chased here): a vibe whose key
 * happens to equal the current key still leaves a stale badge, because there
 * is no key delta to observe.
 */
export function shouldClearReharmonizeIndicator(
  from: { root: string; scaleType: string },
  to: { root: string; scaleType: string },
  chordsReplaced: boolean,
): boolean {
  return chordsReplaced && (from.root !== to.root || from.scaleType !== to.scaleType);
}

/**
 * As one pure function so it is testable without a DOM (repo convention:
 * components export their testable helpers).
 *
 * Transpose-then-snap is the only correct order for a combined change: snapping
 * first would measure the chords against a root they are not yet in.
 */
export function applyKeyScaleChange(
  chords: ChordItem[],
  from: { root: string; scaleType: string },
  to: { root: string; scaleType: string },
  octave: number,
  chordsReplaced: boolean,
): ChordItem[] | null {
  if (chordsReplaced || chords.length === 0) return null;

  const rootChanged = from.root !== to.root;
  const scaleChanged = from.scaleType !== to.scaleType;
  if (!rootChanged && !scaleChanged) return null;

  let next = chords;
  if (rootChanged) next = transposeProgression(next, from.root, to.root, octave);
  if (scaleChanged) next = snapProgressionToScale(next, to.root, to.scaleType, octave);
  return next;
}
