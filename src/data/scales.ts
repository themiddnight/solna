/**
 * The scale library: 11 hand-authored scales, each with its interval set, the
 * tonal scale name that spells it, its spelling tonality, and — for scales
 * with fewer than seven degrees — the 7-note parent whose harmony it borrows.
 *
 * Authored content, not a system registry: adding a scale is an edit to this
 * table and nothing else, which is the test that decides what belongs in
 * src/data/. ROOTS stays in utils/musicTheory.ts — it is a spelling convention
 * inseparable from the three functions that enforce it, not a library.
 *
 * `intervals` is content: a reader who knows the scale can check [0, 2, 3, 7, 8]
 * by eye, and scales.test.ts pins it against `tonal`. Per-degree chord
 * qualities are NOT content — a reviewer cannot check `['min','dim','maj',
 * 'sus4','maj']` by reading it — so they are derived by
 * utils/musicTheory.ts's resolveDegreeQuality and are not stated here. There
 * are no overrides: an override field is the shortcut people reach for instead
 * of fixing the derivation. A specific chord at a specific degree belongs in a
 * CHORD_PROGRESSIONS step's explicit `quality`.
 */
export interface ScaleDefinition {
  name: string;
  category: 'Major / Minor' | 'Modal' | 'Pentatonic & Blues' | 'World & Exotic';
  intervals: number[]; // semitone intervals from root [0, 2, 4, 5, 7, 9, 11]
  /** tonal's scale name, e.g. 'harmonic minor'. `Scale.get('C ' + tonal)` spells this scale. */
  tonal: string;
  /** SCALES key of the 7-note scale whose harmony this scale borrows. 7-note scales omit it. */
  parent?: string;
  /** Which tonic-spelling convention this scale writes its key with. */
  tonality: 'major' | 'minor';
}

export const SCALES: Record<string, ScaleDefinition> = {
  'Major': {
    name: 'Major (Ionian)',
    category: 'Major / Minor',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    tonal: 'major',
    tonality: 'major',
  },
  'Natural Minor': {
    name: 'Natural Minor (Aeolian)',
    category: 'Major / Minor',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    tonal: 'aeolian',
    tonality: 'minor',
  },
  'Harmonic Minor': {
    name: 'Harmonic Minor',
    category: 'Major / Minor',
    intervals: [0, 2, 3, 5, 7, 8, 11],
    tonal: 'harmonic minor',
    tonality: 'minor',
  },
  'Dorian': {
    name: 'Dorian (Funk / Modal)',
    category: 'Modal',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    tonal: 'dorian',
    tonality: 'minor',
  },
  'Mixolydian': {
    name: 'Mixolydian (Blues / Rock)',
    category: 'Modal',
    intervals: [0, 2, 4, 5, 7, 9, 10],
    tonal: 'mixolydian',
    tonality: 'major',
  },
  'Lydian': {
    name: 'Lydian (Bright / Dreamy)',
    category: 'Modal',
    intervals: [0, 2, 4, 6, 7, 9, 11],
    tonal: 'lydian',
    tonality: 'major',
  },
  'Phrygian': {
    name: 'Phrygian (Flamenco / Dark)',
    category: 'Modal',
    intervals: [0, 1, 3, 5, 7, 8, 10],
    tonal: 'phrygian',
    tonality: 'minor',
  },
  'Minor Pentatonic': {
    name: 'Minor Pentatonic',
    category: 'Pentatonic & Blues',
    intervals: [0, 3, 5, 7, 10],
    tonal: 'minor pentatonic',
    parent: 'Natural Minor',
    tonality: 'minor',
  },
  'Major Pentatonic': {
    name: 'Major Pentatonic',
    category: 'Pentatonic & Blues',
    intervals: [0, 2, 4, 7, 9],
    tonal: 'major pentatonic',
    parent: 'Major',
    tonality: 'major',
  },
  'Blues': {
    name: 'Blues Scale',
    category: 'Pentatonic & Blues',
    intervals: [0, 3, 5, 6, 7, 10],
    tonal: 'blues',
    parent: 'Natural Minor',
    tonality: 'minor',
  },
  'Hirajoshi': {
    name: 'Hirajoshi (Japanese)',
    category: 'World & Exotic',
    // 1, 2, b3, 5, b6 — step pattern 2-1-4-1-4, two half-steps and two major
    // thirds. Burrows/Wikipedia spelling, the one the koto references use.
    intervals: [0, 2, 3, 7, 8],
    tonal: 'hirajoshi',
    parent: 'Natural Minor',
    tonality: 'minor',
    // Parent is Natural Minor: Hirajoshi is a strict subset of it at degrees
    // 1, 2, 3, 5, 6. Stacking scale-steps on a scale with two major-third gaps
    // does not give tertian chords (degree 0 would be {0, 3, 8}), so the
    // harmony comes from the parent — and reaching outside the five notes is
    // what a five-note scale with two major-third gaps does, not a defect.
    // Degree 3 was a hand-written sus4/7sus4 deviation; it is now min/min7.
  },
};
