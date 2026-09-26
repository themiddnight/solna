/**
 * The scale library: each scale's display name, one-line description,
 * category, the tonal scale name its intervals and spelling come from, its
 * spelling tonality, and either the 7-note parent a shorter scale borrows its
 * chord qualities from, or the 7-note harmony scale whose chords a scale uses
 * wholesale.
 *
 * Authored content, not a system registry: adding a scale is an edit to this
 * table and nothing else, which is the test that decides what belongs in
 * src/data/. Names, descriptions and order follow murva's scale list.
 *
 * Intervals are NOT stated here: `tonal` is their one source, and
 * src/musicCore/scale.ts derives them once at load (a name tonal does not
 * know throws there). scales.test.ts pins the legacy scales' intervals so a
 * saved project keeps sounding as it did. Per-degree chord qualities are not
 * stated either — utils/musicTheory.ts's resolveDegreeQuality derives them.
 * There are no overrides: an override field is the shortcut people reach for
 * instead of fixing the derivation. A specific chord at a specific degree
 * belongs in a CHORD_PROGRESSIONS step's explicit `quality`.
 *
 * Keys are persisted identities (`scaleType`) and never renamed; the header's
 * short label renders the key itself, so a key is readable ASCII. Key order is
 * display order, grouped contiguously by category in SCALE_CATEGORIES order.
 */
export type ScaleCategory = 'Diatonic' | 'Modes' | 'Pentatonic' | 'Blues' | 'World';

/** Display order of the categories; every category holds at least one scale. */
export const SCALE_CATEGORIES: readonly ScaleCategory[] = ['Diatonic', 'Modes', 'Pentatonic', 'Blues', 'World'];

export interface ScaleDefinition {
  /** Display name, e.g. 'Minor (Natural)'. */
  name: string;
  /** The compact header trigger's label, e.g. 'MinPent': unique, at most 7 characters. */
  abbr: string;
  /** One line of mood and genres, e.g. 'Minor but hopeful · jazz, funk, soul'. */
  description: string;
  category: ScaleCategory;
  /** tonal's scale name, e.g. 'harmonic minor'. `Scale.get('C ' + tonal)` spells and measures this scale. */
  tonal: string;
  /** Which tonic-spelling convention this scale writes its key with. */
  tonality: 'major' | 'minor';
  /**
   * SCALES key of the 7-note scale whose chord qualities this scale's own
   * degrees borrow, degree by degree (the pentatonics, the blues). 7-note
   * scales omit it. Exclusive with `harmony`.
   */
  parent?: string;
  /**
   * SCALES key of a 7-note scale whose chords this scale uses wholesale,
   * because its own degrees host none (a bebop's passing tone, whole tone's
   * missing thirds). That scale sets neither `parent` nor `harmony`. Exclusive
   * with `parent`. Chord-side code reads it through musicCore's `harmonyKey`
   * (R358); note-side code never does.
   */
  harmony?: string;
}

export const SCALES: Record<string, ScaleDefinition> = {
  'Major': {
    name: 'Major',
    abbr: 'Maj',
    description: 'Bright and uplifting · pop, rock, folk',
    category: 'Diatonic',
    tonal: 'major',
    tonality: 'major',
  },
  'Natural Minor': {
    name: 'Minor (Natural)',
    abbr: 'Min',
    description: 'Dark and emotional · rock, pop, classical',
    category: 'Diatonic',
    tonal: 'aeolian',
    tonality: 'minor',
  },
  'Harmonic Minor': {
    name: 'Harmonic Minor',
    abbr: 'HarmMin',
    description: 'Dramatic with an exotic pull · classical, metal',
    category: 'Diatonic',
    tonal: 'harmonic minor',
    tonality: 'minor',
  },
  'Melodic Minor': {
    name: 'Melodic Minor',
    abbr: 'MelMin',
    description: 'Smooth and bittersweet · jazz, cinematic',
    category: 'Diatonic',
    tonal: 'melodic minor',
    tonality: 'minor',
  },
  'Harmonic Major': {
    name: 'Harmonic Major',
    abbr: 'HarmMaj',
    description: 'Warm with a classical color · orchestral, jazz',
    category: 'Diatonic',
    tonal: 'harmonic major',
    tonality: 'major',
  },
  'Dorian': {
    name: 'Dorian',
    abbr: 'Dor',
    description: 'Minor but hopeful · jazz, funk, soul',
    category: 'Modes',
    tonal: 'dorian',
    tonality: 'minor',
  },
  'Phrygian': {
    name: 'Phrygian',
    abbr: 'Phryg',
    description: 'Dark and tense · metal, flamenco',
    category: 'Modes',
    tonal: 'phrygian',
    tonality: 'minor',
  },
  'Lydian': {
    name: 'Lydian',
    abbr: 'Lyd',
    description: 'Dreamy and ethereal · film scores, ambient',
    category: 'Modes',
    tonal: 'lydian',
    tonality: 'major',
  },
  'Mixolydian': {
    name: 'Mixolydian',
    abbr: 'Mixo',
    description: 'Bright but bluesy · rock, blues, country',
    category: 'Modes',
    tonal: 'mixolydian',
    tonality: 'major',
  },
  'Locrian': {
    name: 'Locrian',
    abbr: 'Loc',
    description: 'Tense and unresolved · experimental, horror',
    category: 'Modes',
    tonal: 'locrian',
    tonality: 'minor',
  },
  'Dorian b2': {
    name: 'Dorian ♭2',
    abbr: 'Dor♭2',
    description: 'Dark and exotic · ethnic fusion, jazz',
    category: 'Modes',
    tonal: 'dorian b2',
    tonality: 'minor',
  },
  'Lydian Dominant': {
    name: 'Lydian Dominant',
    abbr: 'LydDom',
    description: 'Bright with a bluesy edge · jazz, funk, fusion',
    category: 'Modes',
    tonal: 'lydian dominant',
    tonality: 'major',
  },
  'Lydian Augmented': {
    name: 'Lydian Augmented',
    abbr: 'Lyd♯5',
    description: 'Mysterious and floating · cinematic, jazz',
    category: 'Modes',
    tonal: 'lydian augmented',
    tonality: 'major',
  },
  'Mixolydian b6': {
    name: 'Mixolydian ♭6',
    abbr: 'Mixo♭6',
    description: 'Bittersweet and moody · film, fusion',
    category: 'Modes',
    tonal: 'mixolydian b6',
    tonality: 'major',
  },
  'Locrian #2': {
    name: 'Locrian ♯2',
    abbr: 'Loc♯2',
    description: 'Tense but usable in jazz · modern, fusion',
    category: 'Modes',
    tonal: 'locrian #2',
    tonality: 'minor',
  },
  'Phrygian Dominant': {
    name: 'Phrygian Dominant',
    abbr: 'PhrDom',
    description: 'Intense and passionate · flamenco, metal, cinematic',
    category: 'Modes',
    tonal: 'phrygian dominant',
    tonality: 'major',
  },
  'Major Pentatonic': {
    name: 'Major Pentatonic',
    abbr: 'MajPent',
    description: 'Open and positive · pop, country, rock',
    category: 'Pentatonic',
    tonal: 'major pentatonic',
    tonality: 'major',
    parent: 'Major',
  },
  'Minor Pentatonic': {
    name: 'Minor Pentatonic',
    abbr: 'MinPent',
    description: 'Soulful and versatile · blues, rock, R&B',
    category: 'Pentatonic',
    tonal: 'minor pentatonic',
    tonality: 'minor',
    parent: 'Natural Minor',
  },
  'Egyptian': {
    name: 'Egyptian',
    abbr: 'Egypt',
    description: 'Ancient and mysterious · world, experimental',
    category: 'Pentatonic',
    tonal: 'egyptian',
    // No third at all (C D F G Bb), so the tonality is a spelling choice:
    // minor, the key signature of its Dorian parent.
    tonality: 'minor',
    // Dorian, not Natural Minor: Natural Minor would put a diminished chord
    // on degree 2. Dorian gives min / min / maj / min / maj.
    parent: 'Dorian',
  },
  'Major Blues': {
    name: 'Major Blues',
    abbr: 'MajBlu',
    description: 'Cheerful with a bluesy bite · blues, rock',
    category: 'Blues',
    tonal: 'major blues',
    tonality: 'major',
    parent: 'Major',
  },
  'Blues': {
    name: 'Minor Blues',
    abbr: 'MinBlu',
    description: 'Gritty and soulful · blues, rock, jazz',
    category: 'Blues',
    tonal: 'blues',
    tonality: 'minor',
    parent: 'Natural Minor',
  },
  'Hirajoshi': {
    name: 'Hirajoshi (Japanese)',
    abbr: 'Hira',
    description: 'Sparse and contemplative · ambient, world',
    category: 'World',
    // 1, 2, b3, 5, b6 — step pattern 2-1-4-1-4, two half-steps and two major
    // thirds. Burrows/Wikipedia spelling, the one the koto references use.
    tonal: 'hirajoshi',
    tonality: 'minor',
    // Parent is Natural Minor: Hirajoshi is a strict subset of it at degrees
    // 1, 2, 3, 5, 6. Stacking scale-steps on a scale with two major-third gaps
    // does not give tertian chords (degree 0 would be {0, 3, 8}), so the
    // harmony comes from the parent — and reaching outside the five notes is
    // what a five-note scale with two major-third gaps does, not a defect.
    // Degree 3 was a hand-written sus4/7sus4 deviation; it is now min/min7.
    parent: 'Natural Minor',
  },
  'Pelog': {
    name: 'Pelog (Indonesian)',
    abbr: 'Pelog',
    description: 'Mystical and gamelan-like · world, experimental',
    category: 'World',
    tonal: 'pelog',
    tonality: 'minor',
    // Phrygian keeps pelog's b2; Natural Minor would not.
    parent: 'Phrygian',
  },
  'Vietnamese': {
    name: 'Vietnamese',
    abbr: 'Viet',
    description: 'Gentle and Southeast Asian · folk, world',
    category: 'World',
    tonal: 'vietnamese 1',
    tonality: 'minor',
    parent: 'Natural Minor',
  },
};
