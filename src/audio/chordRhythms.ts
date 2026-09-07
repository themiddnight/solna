// Grouping and hold maths over CHORD_RHYTHMS. Everything here computes; the
// table itself is in data/chordRhythms.ts, and the two used to share a file —
// which meant a review of "I retuned a pattern" and a review of "I changed the
// hold maths" looked identical in a diff list.

import { groupByStyle } from './groupByStyle';
import { CHORD_RHYTHMS, type RhythmHit, type RhythmPattern } from '@/data/chordRhythms';
import type { MeterId } from '../utils/meter';

// Rhythms grouped by style, computed once at module load for the style-grouped
// select UI.
export const CHORD_RHYTHM_STYLE_GROUPS = groupByStyle(CHORD_RHYTHMS);

/**
 * Maps the 0–1 "feel" slider to a hold-duration multiplier.
 * 0.5 (center) = x1 neutral; 0 = x0.5 tight; 1 = x2 loose.
 * Exponential so each slider half feels symmetric to the ear.
 */
export function feelToHoldScale(feel: number): number {
  return 2 ** (2 * (feel - 0.5));
}

/** Equal-power per-voice gain scale: keeps dense chords at roughly constant loudness. */
export function equalPowerVelocityScale(noteCount: number): number {
  return 1 / Math.sqrt(Math.max(1, noteCount));
}

/** Full-bar hold duration, capped so a held chord never spills past its own length. */
export function fullHoldDuration(totalBars: number, barDur: number, holdScale: number): number {
  return Math.min(totalBars * barDur * holdScale, totalBars * barDur);
}

/**
 * Synthesize a RhythmPattern from the user's custom chord grid. Every true step
 * is one block hit (no strum); the pattern is authored at the ACTIVE meter, so
 * the meter is stamped on it and `adaptRhythmPattern` returns it unchanged in
 * that meter. Never full-hold: holdSteps is always 1, so `isFullHoldRhythm`
 * resolves false even for a one-hit grid.
 */
export function customRhythmPattern(
  grid: readonly boolean[],
  stepsPerBar: number,
  meter: MeterId,
): RhythmPattern {
  const hits: RhythmHit[] = [];
  const length = Math.min(grid.length, stepsPerBar);
  for (let step = 0; step < length; step++) {
    if (grid[step] === true) {
      hits.push({ step, type: 'block' as const, velocity: 1, holdSteps: 1 });
    }
  }
  return { id: 'custom', name: 'Custom', style: 'Custom', meter, hits };
}
