// Rhythm pattern library for chord-mode accompaniment.
// Patterns are one bar long (16 sixteenth-note steps) and loop per bar for
// multi-bar chords. Hits are scheduled against the shared engine clock.

import { groupByStyle } from './groupByStyle';
import type { MeterId } from '../utils/meter';

export type RhythmHitType = 'block' | 'strum';

export interface RhythmHit {
  /** 16th-note position within the bar (0–15) */
  step: number;
  /** block = all notes at once; strum = cascade through the chord notes */
  type: RhythmHitType;
  /** 0–1 multiplier over masterChordVelocity (default 1) */
  velocity?: number;
  /** How many 16th steps the note holds (default 1) */
  holdSteps?: number;
  /** Strum only: 'down' = low to high, 'up' = high to low */
  direction?: 'up' | 'down';
  /** Strum only: ms between successive notes (default 30) */
  spreadMs?: number;
  /** If set, play only this index of the chord notes (e.g. 0 = root) */
  note?: number;
  /** Shift that single note by octaves (e.g. -1 for a bass root) */
  octaveShift?: number;
}

export interface RhythmPattern {
  id: string;
  name: string;
  style: string;
  description?: string;
  /**
   * The meter this pattern was AUTHORED in. Optional so inline test literals
   * stay valid; every shipped entry declares it and an invariant test enforces
   * that. Consumers resolve it with `getMeter(pattern.meter)`, which falls back
   * to 4/4. Adaptation to a different active meter happens at PLAYBACK time
   * (utils/eventAdapt.ts) — the user picks these by id and never edits them, so
   * the library stays pure and needs no migration.
   */
  meter?: MeterId;
  hits: RhythmHit[];
}

const block = (step: number, velocity = 1, holdSteps = 1): RhythmHit => ({
  step,
  type: 'block',
  velocity,
  holdSteps,
});

const strum = (
  step: number,
  direction: 'up' | 'down',
  velocity = 1,
  holdSteps = 2,
  spreadMs = 30
): RhythmHit => ({
  step,
  type: 'strum',
  velocity,
  holdSteps,
  direction,
  spreadMs,
});

export const RHYTHM_PATTERNS: RhythmPattern[] = [
  {
    id: 'sustained',
    meter: '4/4',
    name: 'Sustained',
    style: 'Ambient',
    description: 'Full-bar held chord',
    hits: [block(0, 1, 16)],
  },
  {
    id: 'lofiSwing',
    meter: '4/4',
    name: 'Lo-Fi Swung Strum',
    style: 'Lo-Fi',
    description: 'Relaxed swung strums on beats with soft offbeat pushes',
    hits: [
      strum(0, 'down', 0.85, 4, 30),
      strum(6, 'up', 0.65, 2.5, 25),
      strum(8, 'down', 0.75, 3.5, 30),
      strum(14, 'up', 0.6, 2, 25),
    ],
  },
  {
    id: 'eighthPads',
    meter: '4/4',
    name: '8th-Note Driving Pads',
    style: 'Synthwave',
    description: 'Driving synthwave pulses on every 8th note',
    hits: [
      block(0, 0.95, 1.8),
      block(2, 0.75, 1.8),
      block(4, 0.85, 1.8),
      block(6, 0.75, 1.8),
      block(8, 0.9, 1.8),
      block(10, 0.75, 1.8),
      block(12, 0.85, 1.8),
      block(14, 0.75, 1.8),
    ],
  },
  {
    id: 'offbeatStabs',
    meter: '4/4',
    name: 'Offbeat EDM Stabs',
    style: 'Electronic',
    description: 'Punchy offbeat chord stabs that cut through heavy bass',
    hits: [
      block(2, 0.9, 1.2),
      block(6, 0.9, 1.2),
      block(10, 0.9, 1.2),
      block(14, 0.9, 1.2),
    ],
  },
  {
    id: 'syncopatedPush',
    meter: '4/4',
    name: 'Syncopated Soul Push',
    style: 'Funk',
    description: 'Neo-soul & boom bap syncopated groove with dynamic accents',
    hits: [
      block(0, 0.9, 3),
      block(4, 0.65, 2),
      block(7, 0.85, 2.5),
      block(11, 0.6, 2),
      block(14, 0.8, 2),
    ],
  },
  {
    id: 'popBallad8ths',
    meter: '4/4',
    name: 'Pop Ballad 8ths',
    style: 'Pop',
    description: 'Block chords on every 8th note with downbeat accents',
    hits: [
      block(0, 1, 1.5),
      block(2, 0.7, 1.5),
      block(4, 0.9, 1.5),
      block(6, 0.7, 1.5),
      block(8, 0.9, 1.5),
      block(10, 0.7, 1.5),
      block(12, 0.9, 1.5),
      block(14, 0.7, 1.5),
    ],
  },
  {
    id: 'tripletBallad',
    meter: '4/4',
    name: 'Triplet Ballad',
    style: 'Pop',
    description: 'Swinging 8th-triplet feel',
    hits: [
      block(0, 1, 2),
      block(3, 0.65, 2),
      block(6, 0.75, 2),
      block(8, 0.9, 2),
      block(11, 0.65, 2),
      block(14, 0.75, 2),
    ],
  },
  {
    id: 'fourOnFloor',
    meter: '4/4',
    name: '4-on-the-Floor Stabs',
    style: 'Electronic',
    description: 'Short stabs on every quarter note',
    hits: [block(0, 1, 0.8), block(4, 0.85, 0.8), block(8, 0.9, 0.8), block(12, 0.85, 0.8)],
  },
  {
    id: 'funkSyncopation',
    meter: '4/4',
    name: 'Funk Syncopation',
    style: 'Funk',
    description: 'Syncopated 16th comping with velocity accents',
    hits: [
      block(0, 0.9, 1),
      block(3, 0.55, 0.6),
      block(6, 0.8, 0.6),
      block(10, 0.6, 0.6),
      block(11, 0.5, 0.5),
      block(14, 0.85, 0.7),
    ],
  },
  {
    id: 'bossaComping',
    meter: '4/4',
    name: 'Bossa Nova Comping',
    style: 'Latin',
    description: 'Syncopated bossa comping in the Gilberto/clave tradition',
    hits: [
      block(0, 0.7, 1),
      block(4, 0.8, 1),
      block(6, 0.6, 0.8),
      block(8, 0.7, 1),
      block(10, 0.6, 0.8),
      block(14, 0.8, 0.8),
    ],
  },
  {
    id: 'montunoClave',
    meter: '4/4',
    name: 'Montuno / Clave 3-2',
    style: 'Latin',
    description: 'Son clave 3-2 driven montuno hits',
    hits: [
      block(0, 0.9, 1),
      block(3, 0.6, 0.8),
      block(6, 0.7, 0.8),
      block(8, 0.8, 1),
      block(12, 0.7, 0.8),
    ],
  },
  {
    id: 'offbeatSkank',
    meter: '4/4',
    name: 'Offbeat Skank',
    style: 'Reggae',
    description: 'Chords on the offbeat 8ths',
    hits: [block(2, 0.85, 0.8), block(6, 0.85, 0.8), block(10, 0.85, 0.8), block(14, 0.85, 0.8)],
  },
  {
    id: 'arpRollUp',
    meter: '4/4',
    name: 'Arp Roll Up (Harp)',
    style: 'Harp',
    description: 'Fast upward rolls on every quarter note',
    hits: [
      strum(0, 'up', 0.9, 2, 40),
      strum(4, 'up', 0.8, 2, 40),
      strum(8, 'up', 0.85, 2, 40),
      strum(12, 'up', 0.8, 2, 40),
    ],
  },
  {
    id: 'arpDownEighths',
    meter: '4/4',
    name: 'Arp Down 8ths',
    style: 'Harp',
    description: 'Downward cascades on every 8th note',
    hits: [
      strum(0, 'down', 0.8, 1.5, 25),
      strum(2, 'down', 0.7, 1.5, 25),
      strum(4, 'down', 0.75, 1.5, 25),
      strum(6, 'down', 0.7, 1.5, 25),
      strum(8, 'down', 0.75, 1.5, 25),
      strum(10, 'down', 0.7, 1.5, 25),
      strum(12, 'down', 0.75, 1.5, 25),
      strum(14, 'down', 0.7, 1.5, 25),
    ],
  },
  {
    id: 'bassPlusStrum',
    meter: '4/4',
    name: 'Bass + Strum',
    style: 'Pop',
    description: 'Root note an octave down on beat 1, upper strum on beat 3',
    hits: [
      { step: 0, type: 'block', note: 0, octaveShift: -1, velocity: 0.9, holdSteps: 8 },
      strum(8, 'up', 0.85, 2, 35),
    ],
  },
  // --- 3/4, accentGroups [4,4,4]: three quarter-note beats at steps 0, 4, 8 ---
  {
    id: 'waltzOompah',
    meter: '3/4',
    name: 'Waltz Oom-Pah-Pah',
    style: 'Waltz',
    description: 'Low root on beat 1, chord on beats 2 and 3 — the literal waltz',
    hits: [
      { step: 0, type: 'block', note: 0, octaveShift: -1, velocity: 0.9, holdSteps: 4 },
      block(4, 0.7, 3),
      block(8, 0.65, 3),
    ],
  },
  {
    id: 'jazzWaltzComp',
    meter: '3/4',
    name: 'Jazz Waltz Comp',
    style: 'Waltz',
    description: 'Beat 1 then the and-of-2 and and-of-3 — the jazz waltz anticipation',
    hits: [block(0, 0.85, 2), block(6, 0.7, 2), block(10, 0.6, 2)],
  },
  {
    id: 'waltzArpRoll',
    meter: '3/4',
    name: 'Waltz Harp Roll',
    style: 'Waltz',
    description: 'Upward roll on each of the three beats',
    hits: [
      strum(0, 'up', 0.9, 3, 40),
      strum(4, 'up', 0.75, 3, 40),
      strum(8, 'up', 0.8, 3, 40),
    ],
  },
  // --- 6/8, accentGroups [6,6]: TWO dotted-quarter beats at steps 0 and 6 ---
  // Same twelve steps as 3/4 above; the difference is entirely where the weight
  // lands. Nothing below may accent 0/4/8, or it reads as a waltz.
  {
    id: 'compoundEighthPads',
    meter: '6/8',
    name: '6/8 Compound Pads',
    style: '6/8',
    description: 'All six eighths, accented in twos of three — the compound pulse',
    hits: [
      block(0, 0.95, 2),
      block(2, 0.7, 2),
      block(4, 0.7, 2),
      block(6, 0.85, 2),
      block(8, 0.7, 2),
      block(10, 0.7, 2),
    ],
  },
  {
    id: 'afroBellComp',
    meter: '6/8',
    name: 'Afro 6/8 Bell Comp',
    style: '6/8',
    description: 'Chord stabs on the Afro-Cuban 6/8 bell cell',
    hits: [block(0, 0.9, 2), block(4, 0.7, 1.5), block(6, 0.85, 2), block(10, 0.7, 2)],
  },
  {
    id: 'sixEightBallad',
    meter: '6/8',
    name: '6/8 Ballad',
    style: '6/8',
    description: 'One held chord per dotted-quarter beat',
    hits: [block(0, 0.9, 6), block(6, 0.8, 6)],
  },
];

// Patterns grouped by style, computed once at module load for the style-grouped select UI.
export const RHYTHM_STYLE_GROUPS = groupByStyle(RHYTHM_PATTERNS);
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
