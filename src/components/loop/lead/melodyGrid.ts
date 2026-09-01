import { getScaleNotesInOctave, ROOTS } from '../../../utils/musicTheory';
import { MAX_STEPS_PER_BAR } from '../../../utils/meter';
import type { LeadMelodyView } from '../../../store/types';

/** Number of octaves the piano-roll window shows. Fixed at 2 (spec default). */
export const LEAD_WINDOW_OCTAVES = 2;

/** Fixed cell width in px — the playhead's translateX stride. */
export const LEAD_CELL_WIDTH = 20;

/**
 * The pitch rows of the piano-roll, from HIGHEST (index 0) to LOWEST. In
 * scale-locked view rows are the active scale's notes across the window; in
 * chromatic view all 12 semitones across the window. `lowestOctave` is the
 * lowest octave shown (leadMelodyOctave); the window spans octaveCount octaves.
 */
export function leadPitchRows(
  view: LeadMelodyView,
  root: string,
  scaleType: string,
  lowestOctave: number,
  octaveCount: number,
): string[] {
  const rows: string[] = [];
  for (let oct = lowestOctave + octaveCount - 1; oct >= lowestOctave; oct--) {
    const notes =
      view === 'chromatic'
        ? (ROOTS as readonly string[]).map((pc) => `${pc}${oct}`)
        : getScaleNotesInOctave(root, scaleType, oct);
    for (let i = notes.length - 1; i >= 0; i--) {
      rows.push(notes[i]);
    }
  }
  return rows;
}

/**
 * The flat stored index for a (bar, stepInBar) column. The melody is stored at
 * MAX_STEPS_PER_BAR per bar, so this never depends on the active meter.
 */
export function leadStoredIndex(barIndex: number, stepInBar: number): number {
  return barIndex * MAX_STEPS_PER_BAR + stepInBar;
}

/**
 * True when `note` is a "black key" pitch class (sharp/flat). Used to shade
 * chromatic rows darker like a piano keyboard; applies to scale-locked rows
 * too when a scale degree is itself a sharp/flat (e.g. F# in G major).
 */
export function isBlackKey(note: string): boolean {
  const pitchClass = note.replace(/\d+$/, '');
  return pitchClass.includes('#') || pitchClass.includes('b');
}

/** True when `note`'s pitch class is the active tonic (`scaleRoot`). */
export function isRootNote(note: string, root: string): boolean {
  return note.replace(/\d+$/, '') === root;
}
