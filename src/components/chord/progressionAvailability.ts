import type { ChordProgression } from '../../audio/data/chordProgressions';
import { SCALES } from '../../utils/musicTheory';

/**
 * A progression is only offered in a scale that has at least as many degrees
 * as it was authored against. Entries that fail are hidden rather than
 * resolved with wrapped degrees, which would silently produce a different
 * progression.
 *
 * An unknown scaleType is treated as seven degrees, matching SCALES' own
 * `|| SCALES['Major']` fallback.
 *
 * Lives in its own module so ChordView can import it without pulling the
 * lazily-loaded ChordPresetLibrary back into the main chunk.
 */
export function isProgressionAvailable(p: ChordProgression, scaleType: string): boolean {
  return (SCALES[scaleType]?.intervals.length ?? 7) >= p.minScaleLength;
}
