import type { ChordItem } from '../types';
import type { ChordQuality } from '@/musicCore';

/**
 * A golden snapshot of every Instant Vibe's `chords` array, originally
 * captured before the vibe-chords-from-progressions plan replaced
 * each vibe's inline chords with `progressionId` + `resolveProgression`. That
 * migration is long done; this fixture's ongoing job is to pin the resolved
 * output so `instantVibesProgressions.test.ts` fails loudly if a library
 * entry (CHORD_PROGRESSIONS) or a vibe's `progressionId`/key/scale
 * changes the sound. Deliberately duplicates the id/root/quality/bars
 * literals that used to live in `instantVibes.ts` (via a local
 * `snapshotChord`, not an import of anything from that file or the library)
 * so this fixture cannot silently track a later change to the vibes or the
 * library it is meant to be checked against — it is a snapshot, not a
 * re-derivation, and that independence is the whole proof.
 *
 * If the test goes red: figure out whether the library/vibe edit was
 * intentional. If yes — the sound was meant to change — update this fixture
 * to match the new output. If no — someone changed a shared library entry
 * (or a vibe's reference into it) without meaning to change this vibe's
 * chords — revert the library/vibe change instead.
 */
function snapshotChord(id: string, root: string, quality: ChordQuality, bars: number): ChordItem {
  return { id, root, quality, bars };
}

export const ORIGINAL_VIBE_CHORDS: Record<string, ChordItem[]> = {
  'lofi-chill': [
    snapshotChord('c1', 'C', 'maj7', 1),
    snapshotChord('c2', 'A', 'min7', 1),
    snapshotChord('c3', 'D', 'min7', 1),
    snapshotChord('c4', 'G', '7', 1),
  ],
  'synthwave-80s': [
    snapshotChord('sw1', 'A', 'min', 1),
    snapshotChord('sw2', 'F', 'maj', 1),
    snapshotChord('sw3', 'C', 'maj', 1),
    snapshotChord('sw4', 'G', 'maj', 1),
  ],
  'cyber-edm': [
    snapshotChord('cy1', 'F', 'min', 1),
    snapshotChord('cy2', 'D#', 'maj', 1),
    snapshotChord('cy3', 'C#', 'maj', 1),
    snapshotChord('cy4', 'C', 'min', 1),
  ],
  'deep-ambient': [
    snapshotChord('am1', 'D', 'maj7', 4),
    snapshotChord('am2', 'E', 'maj', 4),
    snapshotChord('am3', 'F#', 'min7', 4),
    snapshotChord('am4', 'G#', 'm7b5', 4),
  ],
  'boom-bap': [
    snapshotChord('bb1', 'E', 'min7', 1),
    snapshotChord('bb2', 'A', '7', 1),
    snapshotChord('bb3', 'D', 'maj7', 1),
    snapshotChord('bb4', 'G', 'maj7', 1),
  ],
  'zen-garden': [
    snapshotChord('zn1', 'G', 'min', 2),
    snapshotChord('zn2', 'D', 'min', 2),
    snapshotChord('zn3', 'G', 'min', 2),
    snapshotChord('zn4', 'D#', 'maj', 2),
  ],
  'lofi-waltz': [
    snapshotChord('lw1', 'D', 'min9', 1),
    snapshotChord('lw2', 'A#', 'maj7', 1),
    snapshotChord('lw3', 'G', 'min9', 1),
    snapshotChord('lw4', 'C', '7', 1),
  ],
  'afro-six-eight': [
    snapshotChord('af1', 'D', 'min7', 1),
    snapshotChord('af2', 'G', '7', 1),
    snapshotChord('af3', 'D', 'min7', 1),
    snapshotChord('af4', 'G', '7', 1),
  ],
};
