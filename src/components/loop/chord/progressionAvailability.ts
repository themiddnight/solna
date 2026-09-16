import type { ChordProgression } from '@/data/chordProgressions';
import { scaleEntry } from '@/musicCore';

/**
 * A progression is only offered in a scale that has at least as many degrees
 * as it was authored against. Entries that fail are hidden rather than
 * resolved with wrapped degrees, which would silently produce a different
 * progression.
 *
 * An unknown scaleType resolves to Major (seven degrees) via `@/musicCore`'s
 * `scaleEntry`, the one place that fallback is decided.
 *
 * Lives in its own module so ChordView can import it without pulling the
 * lazily-loaded ChordPresetLibrary back into the main chunk.
 */
export function isProgressionAvailable(p: ChordProgression, scaleType: string): boolean {
  return scaleEntry(scaleType).intervals.length >= p.minScaleLength;
}
