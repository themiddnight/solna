import type { ChordProgression } from '@/data/chordProgressions';
import { harmonyKey, scaleEntry } from '@/musicCore';

/**
 * A progression is only offered in a scale whose chord-hosting scale (R358)
 * has at least as many degrees as it was authored against. Whole Tone has six
 * notes, but its chords sit on Lydian Augmented's seven, so a seven-degree
 * progression plays there without a wrap. Entries that fail are hidden rather
 * than resolved with wrapped degrees, which would silently produce a
 * different progression.
 *
 * An unknown scaleType resolves to Major (seven degrees) via `@/musicCore`'s
 * `harmonyKey`, which applies the one scale fallback.
 *
 * Lives in its own module so ChordView can import it without pulling the
 * lazily-loaded ChordPresetLibrary back into the main chunk.
 */
export function isProgressionAvailable(p: ChordProgression, scaleType: string): boolean {
  return scaleEntry(harmonyKey(scaleType)).intervals.length >= p.minScaleLength;
}
