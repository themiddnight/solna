/**
 * The scale library: 11 hand-authored scales, each with its interval set and a
 * per-degree triad and seventh quality.
 *
 * Authored content, not a system registry: adding a scale is an edit to this
 * table and nothing else, which is the test that decides what belongs in
 * src/data/. ROOTS stays in utils/musicTheory.ts — it is a spelling convention
 * inseparable from the three functions that enforce it, not a library.
 *
 * The qualities are hand-written per degree rather than derived from interval
 * distances. Deriving them is real work with a visible output change (see the
 * spec's "Music theory rework", out of scope) — until then the arrays are the
 * contract and musicTheory.test.ts pins them.
 */
export interface ScaleDefinition {
  name: string;
  category: 'Major / Minor' | 'Modal' | 'Pentatonic & Blues' | 'World & Exotic';
  intervals: number[]; // semitone intervals from root [0, 2, 4, 5, 7, 9, 11]
  triadQualities: string[]; // chord quality for each scale degree: e.g. ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim']
  seventhQualities: string[]; // 7th chord quality: e.g. ['maj7', 'min7', 'min7', 'maj7', '7', 'min7', 'm7b5']
}

export const SCALES: Record<string, ScaleDefinition> = {
  'Major': {
    name: 'Major (Ionian)',
    category: 'Major / Minor',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    triadQualities: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
    seventhQualities: ['maj7', 'min7', 'min7', 'maj7', '7', 'min7', 'm7b5'],
  },
  'Natural Minor': {
    name: 'Natural Minor (Aeolian)',
    category: 'Major / Minor',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    triadQualities: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'],
    seventhQualities: ['min7', 'm7b5', 'maj7', 'min7', 'min7', 'maj7', '7'],
  },
  'Harmonic Minor': {
    name: 'Harmonic Minor',
    category: 'Major / Minor',
    intervals: [0, 2, 3, 5, 7, 8, 11],
    triadQualities: ['min', 'dim', 'aug', 'min', 'maj', 'maj', 'dim'],
    seventhQualities: ['minMaj7', 'm7b5', 'maj7#5', 'min7', '7', 'maj7', 'dim7'],
  },
  'Dorian': {
    name: 'Dorian (Funk / Modal)',
    category: 'Modal',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    triadQualities: ['min', 'min', 'maj', 'maj', 'min', 'dim', 'maj'],
    seventhQualities: ['min7', 'min7', 'maj7', '7', 'min7', 'm7b5', 'maj7'],
  },
  'Mixolydian': {
    name: 'Mixolydian (Blues / Rock)',
    category: 'Modal',
    intervals: [0, 2, 4, 5, 7, 9, 10],
    triadQualities: ['maj', 'min', 'dim', 'maj', 'min', 'min', 'maj'],
    seventhQualities: ['7', 'min7', 'm7b5', 'maj7', 'min7', 'min7', 'maj7'],
  },
  'Lydian': {
    name: 'Lydian (Bright / Dreamy)',
    category: 'Modal',
    intervals: [0, 2, 4, 6, 7, 9, 11],
    triadQualities: ['maj', 'maj', 'min', 'dim', 'maj', 'min', 'min'],
    seventhQualities: ['maj7', '7', 'min7', 'm7b5', 'maj7', 'min7', 'min7'],
  },
  'Phrygian': {
    name: 'Phrygian (Flamenco / Dark)',
    category: 'Modal',
    intervals: [0, 1, 3, 5, 7, 8, 10],
    triadQualities: ['min', 'maj', 'maj', 'min', 'dim', 'maj', 'min'],
    seventhQualities: ['min7', 'maj7', '7', 'min7', 'm7b5', 'maj7', 'min7'],
  },
  'Minor Pentatonic': {
    name: 'Minor Pentatonic',
    category: 'Pentatonic & Blues',
    intervals: [0, 3, 5, 7, 10],
    triadQualities: ['min', 'maj', 'min', 'min', 'maj'],
    seventhQualities: ['min7', 'maj7', 'min7', 'min7', '7'],
  },
  'Major Pentatonic': {
    name: 'Major Pentatonic',
    category: 'Pentatonic & Blues',
    intervals: [0, 2, 4, 7, 9],
    triadQualities: ['maj', 'min', 'min', 'maj', 'min'],
    seventhQualities: ['maj7', 'min7', 'min7', '7', 'min7'],
  },
  'Blues': {
    name: 'Blues Scale',
    category: 'Pentatonic & Blues',
    intervals: [0, 3, 5, 6, 7, 10],
    triadQualities: ['min', 'maj', 'dim', 'dim', 'min', 'maj'],
    seventhQualities: ['7', 'maj7', 'dim7', 'dim7', '7', '7'],
  },
  'Hirajoshi': {
    name: 'Hirajoshi (Japanese)',
    category: 'World & Exotic',
    // 1, 2, b3, 5, b6 — step pattern 2-1-4-1-4, two half-steps and two major
    // thirds. Burrows/Wikipedia spelling, the one the koto references use.
    intervals: [0, 2, 3, 7, 8],
    // Stacking scale-steps on a scale with two major-third gaps does not give
    // tertian chords (degree 0 would be {0,3,8}). The repo's pentatonics solve
    // this by inheriting the parent 7-note scale's qualities; Hirajoshi is
    // natural minor at degrees 1, 2, 3, 5, 6 -> i, ii°, bIII, v, bVI.
    // One deliberate deviation: degree 3 is sus4/7sus4, not min/min7. The
    // parent's minor third reaches a semitone Hirajoshi does not contain,
    // while root-4th-5th (degrees 3, 4, 0) is entirely inside the five notes
    // and is the canonical open-fourth koto sound.
    triadQualities: ['min', 'dim', 'maj', 'sus4', 'maj'],
    seventhQualities: ['min7', 'm7b5', 'maj7', '7sus4', 'maj7'],
  },
};
