import type { ChordItem } from '../types';
import { deriveChordNotes } from '../utils/musicTheory';

/**
 * A verbatim snapshot of every Instant Vibe's `chords` array, captured before
 * Task 6 of the vibe-chords-from-progressions plan replaced each vibe's
 * inline chords with `progressionId` + `resolveProgression`. Deliberately
 * duplicates the id/root/quality/bars/octave literals that used to live in
 * `instantVibes.ts` (via a local `snapshotChord`, not an import of anything
 * from that file) so this fixture cannot silently track a later change to
 * the vibes it is meant to be checked against — it is a snapshot, not a
 * re-derivation.
 */
function snapshotChord(id: string, root: string, quality: string, bars: number, octave: number): ChordItem {
  return deriveChordNotes({ id, root, quality, bars, notes: [] }, octave);
}

export const ORIGINAL_VIBE_CHORDS: Record<string, ChordItem[]> = {
  'lofi-chill': [
    snapshotChord('c1', 'C', 'maj7', 1, 4),
    snapshotChord('c2', 'A', 'min7', 1, 4),
    snapshotChord('c3', 'D', 'min7', 1, 4),
    snapshotChord('c4', 'G', '7', 1, 4),
  ],
  'synthwave-80s': [
    snapshotChord('sw1', 'A', 'min', 1, 4),
    snapshotChord('sw2', 'F', 'maj', 1, 4),
    snapshotChord('sw3', 'C', 'maj', 1, 4),
    snapshotChord('sw4', 'G', 'maj', 1, 4),
  ],
  'cyber-dance': [
    snapshotChord('cy1', 'F', 'min', 1, 4),
    snapshotChord('cy2', 'D#', 'maj', 1, 4),
    snapshotChord('cy3', 'C#', 'maj', 1, 4),
    snapshotChord('cy4', 'C', 'min', 1, 4),
  ],
  'ambient-chill': [
    snapshotChord('am1', 'D', 'maj7', 4, 4),
    snapshotChord('am2', 'E', 'maj', 4, 4),
    snapshotChord('am3', 'F#', 'min7', 4, 4),
    snapshotChord('am4', 'G#', 'm7b5', 4, 4),
  ],
  'hiphop-groove': [
    snapshotChord('bb1', 'E', 'min7', 1, 4),
    snapshotChord('bb2', 'A', '7', 1, 4),
    snapshotChord('bb3', 'D', 'maj7', 1, 4),
    snapshotChord('bb4', 'G', 'maj7', 1, 4),
  ],
  'asian-zen': [
    snapshotChord('zn1', 'G', 'min', 2, 4),
    snapshotChord('zn2', 'D', 'sus4', 2, 4),
    snapshotChord('zn3', 'G', 'min', 2, 4),
    snapshotChord('zn4', 'D#', 'maj', 2, 4),
  ],
};
