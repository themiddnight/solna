// Rhythm pattern library for chord-mode accompaniment.
// Patterns are one bar long (16 sixteenth-note steps) and loop per bar for
// multi-bar chords. Hits are scheduled against the shared engine clock.

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
    name: 'Sustained',
    style: 'Ambient',
    description: 'Full-bar held chord',
    hits: [block(0, 1, 16)],
  },
  {
    id: 'lofiSwing',
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
    name: '4-on-the-Floor Stabs',
    style: 'Electronic',
    description: 'Short stabs on every quarter note',
    hits: [block(0, 1, 0.8), block(4, 0.85, 0.8), block(8, 0.9, 0.8), block(12, 0.85, 0.8)],
  },
  {
    id: 'funkSyncopation',
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
    name: 'Offbeat Skank',
    style: 'Reggae',
    description: 'Chords on the offbeat 8ths',
    hits: [block(2, 0.85, 0.8), block(6, 0.85, 0.8), block(10, 0.85, 0.8), block(14, 0.85, 0.8)],
  },
  {
    id: 'arpRollUp',
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
    name: 'Bass + Strum',
    style: 'Pop',
    description: 'Root note an octave down on beat 1, upper strum on beat 3',
    hits: [
      { step: 0, type: 'block', note: 0, octaveShift: -1, velocity: 0.9, holdSteps: 8 },
      strum(8, 'up', 0.85, 2, 35),
    ],
  },];

// Patterns grouped by style, computed once at module load for the style-grouped select UI.
export const RHYTHM_STYLE_GROUPS: { style: string; patterns: RhythmPattern[] }[] = (() => {
  const byStyle = new Map<string, RhythmPattern[]>();
  for (const p of RHYTHM_PATTERNS) {
    const list = byStyle.get(p.style);
    if (list) list.push(p);
    else byStyle.set(p.style, [p]);
  }
  return Array.from(byStyle, ([style, patterns]) => ({ style, patterns }));
})();
/**
 * Maps the 0–1 "feel" slider to a hold-duration multiplier.
 * 0.5 (center) = x1 neutral; 0 = x0.5 tight; 1 = x2 loose.
 * Exponential so each slider half feels symmetric to the ear.
 */
export function feelToHoldScale(feel: number): number {
  return 2 ** (2 * (feel - 0.5));
}

/** Full-bar hold duration, capped so a held chord never spills past its own length. */
export function fullHoldDuration(totalBars: number, barDur: number, holdScale: number): number {
  return Math.min(totalBars * barDur * holdScale, totalBars * barDur);
}
