// Grouping and hold maths over CHORD_RHYTHMS. Everything here computes; the
// table itself is in data/chordRhythms.ts, and the two used to share a file —
// which meant a review of "I retuned a pattern" and a review of "I changed the
// hold maths" looked identical in a diff list.

import { groupByStyle } from './groupByStyle';
import { CHORD_RHYTHMS, type RhythmHit, type RhythmPattern } from '@/data/chordRhythms';
import { BASS_PATTERNS, type BassPattern, type BassStepChoice } from '@/data/bassPatterns';
import { customBassPattern } from './bassPatterns';
import { adaptStepEvents } from '../utils/eventAdapt';
import { getMeter, type MeterId } from '../utils/meter';

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

/**
 * Patterns that hold one voice across the whole chord instead of re-striking.
 *
 * `stepsPerBar` is the ACTIVE bar length, not the constant 16: in 12/8 a bar is
 * 24 steps, and a 16-step hold there covers two thirds of a bar, not all of it.
 * Exported so the pure-logic tests can reach them without React.
 */
export function isFullHoldRhythm(pattern: RhythmPattern, stepsPerBar: number): boolean {
  return (
    pattern.id === "sustained" ||
    (pattern.hits.length === 1 &&
      pattern.hits[0].step === 0 &&
      (pattern.hits[0].holdSteps ?? 1) >= stepsPerBar)
  );
}

export function isFullHoldBass(pattern: BassPattern, stepsPerBar: number): boolean {
  return (
    pattern.id === "whole-note-root" ||
    (pattern.steps.length === 1 &&
      pattern.steps[0].step === 0 &&
      (pattern.steps[0].holdSteps ?? 1) >= stepsPerBar)
  );
}

function resolveRhythmPattern(id: string): RhythmPattern {
  return CHORD_RHYTHMS.find((p) => p.id === id) ?? CHORD_RHYTHMS[0];
}

function resolveBassPattern(id: string): BassPattern {
  return BASS_PATTERNS.find((p) => p.id === id) ?? BASS_PATTERNS[0];
}

/**
 * Mode-aware pattern resolution for playback. Custom grids are synthesized at
 * the ACTIVE meter, so the returned pattern is stamped with `meterId` and
 * `adaptRhythmPattern`/`adaptBassPattern` return it unchanged there.
 */
export function resolvePlaybackRhythmPattern(
  mode: 'preset' | 'custom',
  rhythmId: string,
  customGrid: readonly boolean[],
  stepsPerBar: number,
  meterId: MeterId,
): RhythmPattern {
  return mode === 'custom'
    ? customRhythmPattern(customGrid, stepsPerBar, meterId)
    : resolveRhythmPattern(rhythmId);
}

export function resolvePlaybackBassPattern(
  mode: 'preset' | 'custom',
  patternId: string,
  customGrid: readonly BassStepChoice[],
  stepsPerBar: number,
  meterId: MeterId,
): BassPattern {
  return mode === 'custom'
    ? customBassPattern(customGrid, stepsPerBar, meterId)
    : resolveBassPattern(patternId);
}

/**
 * Playback-time adaptation. Chord and bass rhythms are picked by id and never
 * edited by the user, so the library stays byte-identical on disk and a meter
 * change re-adapts on the next chord — no migration, no lossy write-back.
 * (The drum grid is the opposite case: it is user-editable, so preset
 * adaptation there is materialised at APPLY time in the sequencer slice.)
 *
 * Returns the SAME object when no adaptation is needed, so the identity checks
 * and id comparisons downstream (isFullHoldRhythm/isFullHoldBass) are unaffected
 * in 4/4.
 */
export function adaptRhythmPattern(pattern: RhythmPattern, stepsPerBar: number): RhythmPattern {
  const sourceSteps = getMeter(pattern.meter).stepsPerBar;
  if (sourceSteps === stepsPerBar) return pattern;
  return { ...pattern, hits: adaptStepEvents(pattern.hits, sourceSteps, stepsPerBar) };
}

export function adaptBassPattern(pattern: BassPattern, stepsPerBar: number): BassPattern {
  const sourceSteps = getMeter(pattern.meter).stepsPerBar;
  if (sourceSteps === stepsPerBar) return pattern;
  return { ...pattern, steps: adaptStepEvents(pattern.steps, sourceSteps, stepsPerBar) };
}
