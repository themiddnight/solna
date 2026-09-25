/**
 * The scale library: each scale's display name, category, the tonal scale
 * name its intervals and spelling come from, its spelling tonality, and — for
 * scales with fewer than seven degrees — the 7-note parent whose harmony it
 * borrows.
 *
 * Authored content, not a system registry: adding a scale is an edit to this
 * table and nothing else, which is the test that decides what belongs in
 * src/data/. ROOTS stays in musicCore — it is a spelling convention
 * inseparable from the functions that enforce it, not a library.
 *
 * Intervals are NOT stated here: `tonal` is their one source, and
 * src/musicCore/scale.ts derives them once at load (a name tonal does not
 * know throws there). scales.test.ts pins the legacy scales' intervals so a
 * saved project keeps sounding as it did. Per-degree chord qualities are not
 * stated either — utils/musicTheory.ts's resolveDegreeQuality derives them.
 * There are no overrides: an override field is the shortcut people reach for
 * instead of fixing the derivation. A specific chord at a specific degree
 * belongs in a CHORD_PROGRESSIONS step's explicit `quality`.
 */
export interface ScaleDefinition {
  name: string;
  category: 'Major / Minor' | 'Modal' | 'Pentatonic & Blues' | 'World & Exotic';
  /** tonal's scale name, e.g. 'harmonic minor'. `Scale.get('C ' + tonal)` spells and measures this scale. */
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
    tonal: 'major',
    tonality: 'major',
  },
  'Natural Minor': {
    name: 'Natural Minor (Aeolian)',
    category: 'Major / Minor',
    tonal: 'aeolian',
    tonality: 'minor',
  },
  'Harmonic Minor': {
    name: 'Harmonic Minor',
    category: 'Major / Minor',
    tonal: 'harmonic minor',
    tonality: 'minor',
  },
  'Dorian': {
    name: 'Dorian (Funk / Modal)',
    category: 'Modal',
    tonal: 'dorian',
    tonality: 'minor',
  },
  'Mixolydian': {
    name: 'Mixolydian (Blues / Rock)',
    category: 'Modal',
    tonal: 'mixolydian',
    tonality: 'major',
  },
  'Lydian': {
    name: 'Lydian (Bright / Dreamy)',
    category: 'Modal',
    tonal: 'lydian',
    tonality: 'major',
  },
  'Phrygian': {
    name: 'Phrygian (Flamenco / Dark)',
    category: 'Modal',
    tonal: 'phrygian',
    tonality: 'minor',
  },
  'Minor Pentatonic': {
    name: 'Minor Pentatonic',
    category: 'Pentatonic & Blues',
    tonal: 'minor pentatonic',
    parent: 'Natural Minor',
    tonality: 'minor',
  },
  'Major Pentatonic': {
    name: 'Major Pentatonic',
    category: 'Pentatonic & Blues',
    tonal: 'major pentatonic',
    parent: 'Major',
    tonality: 'major',
  },
  'Blues': {
    name: 'Blues Scale',
    category: 'Pentatonic & Blues',
    tonal: 'blues',
    parent: 'Natural Minor',
    tonality: 'minor',
  },
  'Hirajoshi': {
    name: 'Hirajoshi (Japanese)',
    category: 'World & Exotic',
    // 1, 2, b3, 5, b6 — step pattern 2-1-4-1-4, two half-steps and two major
    // thirds. Burrows/Wikipedia spelling, the one the koto references use.
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
