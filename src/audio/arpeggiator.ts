import { Note, transpose } from 'tonal';

export type { ArpMode } from '../types';
import type { ArpMode } from '../types';

/**
 * Expand the currently held notes into the note order the arpeggiator plays.
 *
 * Held notes are sorted by pitch, stacked across `octaves`, then arranged by
 * `mode`. Returns an empty array only when nothing playable is held, so the
 * clock subscriber can treat "empty" as "nothing to do".
 */
export function buildArpSequence(
  heldNotes: Iterable<string>,
  mode: ArpMode,
  octaves: number,
): string[] {
  const notesArray = Array.from(heldNotes).sort((a, b) => {
    const midiA = Note.midi(a) ?? 0;
    const midiB = Note.midi(b) ?? 0;
    return midiA - midiB;
  });

  // `octaves` is a required number (SynthParams.arpOctaves); only the clamp is
  // load-bearing — a 0 or negative value would produce an empty sequence.
  const octCount = Math.max(1, octaves);
  const expanded: string[] = [];
  for (let oct = 0; oct < octCount; oct++) {
    // tonal takes interval notation, not "N oct": one octave up is a perfect
    // 8th, two is a perfect 15th, so octave N is a perfect (7N + 1)th.
    const interval = `${7 * oct + 1}P`;
    for (const noteStr of notesArray) {
      const transposed = transpose(noteStr, interval);
      if (transposed) expanded.push(transposed);
    }
  }
  if (expanded.length === 0) return [];

  if (mode === 'down') return [...expanded].reverse();

  if (mode === 'updown') {
    const rev = [...expanded].reverse();
    if (expanded.length > 2) {
      rev.shift();
      rev.pop();
    }
    return [...expanded, ...rev];
  }

  if (mode === 'random') return [...expanded].sort(() => Math.random() - 0.5);

  return [...expanded];
}
