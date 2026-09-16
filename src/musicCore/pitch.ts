import { chromaOfNote, octaveOfNote } from './tonalAdapter';
import { ROOTS } from './chordQuality';

/**
 * Shifts `note`'s pitch class by `semitones`, keeping whatever octave it was
 * written with (or none, if it had none) — the operation slash-bass
 * transposition needs so a chord's bass never jumps a register on a key
 * change (see `src/utils/musicTheory.ts`'s `transposeProgression`).
 *
 * `null` when `note`'s pitch class does not parse — a Music Core core
 * function's typed-failure contract (see this plan's Global Constraints):
 * never a silent substitution. The caller decides what "unchanged" or
 * "default" means for its own domain.
 */
export function transposePitchClassPreservingOctave(note: string, semitones: number): string | null {
  const chroma = chromaOfNote(note);
  if (!Number.isFinite(chroma)) return null;
  const shiftedPc = ROOTS[((chroma + semitones) % 12 + 12) % 12];
  const octave = octaveOfNote(note);
  return octave === null ? shiftedPc : `${shiftedPc}${octave}`;
}
