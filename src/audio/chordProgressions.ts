// Lookups and resolution over CHORD_PROGRESSIONS.
//
// Layering: this file is under src/audio/, which eslint restricts only from
// store/ and components/. Importing utils/musicTheory.ts, types.ts and
// data/chordProgressions.ts is allowed and deliberate — deriveChordNotes is the
// single source of truth for ChordItem.notes and must not be re-implemented
// here, and that runtime import is exactly why this half could not move into
// src/data/ with the table.

import type { ChordItem } from '../types';
import { deriveChordNotes, getDiatonicChordForDegree } from '../utils/musicTheory';
import { CHORD_PROGRESSIONS, type ChordProgression } from '@/data/chordProgressions';

const PROGRESSIONS_BY_ID = new Map(CHORD_PROGRESSIONS.map((p) => [p.id, p]));

export function progressionById(id: string): ChordProgression | undefined {
  return PROGRESSIONS_BY_ID.get(id);
}

/**
 * Degrees -> concrete chords in a key. An omitted step quality takes the
 * scale's triad; deriveChordNotes owns `notes`. Returns exactly one chord per
 * step, with ids unique within the returned array.
 *
 * Deliberately does NOT enforce minScaleLength: degrees wrap, per the field's
 * documented semantics, so filtering is the caller's job
 * (ChordPresetLibrary.isProgressionAvailable, and B2's dice pools).
 */
export function resolveProgression(
  progression: ChordProgression,
  scaleRoot: string,
  scaleType: string,
  octave = 4,
): ChordItem[] {
  return progression.steps.map((progressionStep, i) => {
    const diatonic = getDiatonicChordForDegree(progressionStep.degree, scaleRoot, scaleType, false);
    const quality = progressionStep.quality ?? diatonic.quality;
    return deriveChordNotes(
      {
        id: `${progression.id}-${i}`,
        root: diatonic.root,
        quality,
        bars: progressionStep.bars,
        notes: [],
      },
      octave,
    );
  });
}
