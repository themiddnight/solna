// The shared chord-progression library, in degree form. ChordPresetLibrary and
// (from project B2) the vibe dice both read CHORD_PROGRESSIONS; nothing stores
// a progression as absolute semitones any more.
//
// Layering: this file is under src/audio/, which eslint restricts only from
// store/ and components/. Importing utils/musicTheory.ts and types.ts is
// allowed and deliberate — deriveChordNotes is the single source of truth for
// ChordItem.notes and must not be re-implemented here.

import type { ChordItem } from '../../types';
import { deriveChordNotes, getDiatonicChordForDegree } from '../../utils/musicTheory';

// Declared in src/types.ts, re-exported here so this stays the import site the
// shared B1/B2 interface pins.
export type { VibeGenre } from '../../types';
import type { VibeGenre } from '../../types';

export type ProgressionCategory =
  | 'Pop & EDM'
  | 'Jazz & Neo-Soul'
  | 'Lofi & R&B'
  | 'Rock & Blues'
  | 'Anime & J-Pop'
  | 'Cinematic & Modal'
  | 'Classical & Baroque'
  | 'Ambient & Zen';

export interface ProgressionStep {
  /** 0-based scale degree; wraps modulo the scale's own length. */
  degree: number;
  /**
   * Overrides the diatonic quality. **Omitted means the scale's own TRIAD for
   * that degree**, never the seventh — ProgressionStep has no use7ths flag, and
   * the two readings are silently different music. Genres whose identity is
   * extended harmony (lo-fi, boom bap) write their qualities out.
   */
  quality?: string;
  /** Bars this chord is held. 1 for lofi/boom bap, 2 for EDM, 4+ for ambient. */
  bars: number;
}

export interface ChordProgression {
  /** Stable identifier. Referenced by VibeVariation.progressionIds in B2. */
  id: string;
  name: string;
  /** Display-ready roman-numeral summary; true in `referenceScale`. B2 prints
   *  this verbatim in its reroll toast, so it must match the steps. */
  roman: string;
  description: string;
  /** Library chip in ChordPresetLibrary. */
  category: ProgressionCategory;
  /** The key of SCALES the degrees and qualities were authored against. */
  referenceScale: string;
  /** Which vibes may draw this progression. Empty = library-only. A tag is
   *  only valid when referenceScale === VIBE_GENRE_SCALES[tag]. */
  genres: VibeGenre[];
  /** Shortest scale this is valid in: SCALES[referenceScale].intervals.length.
   *  5 works in pentatonic and Hirajoshi; 7 needs a full diatonic scale. */
  minScaleLength: number;
  steps: ProgressionStep[];
}

/** Each genre's anchor scale. Scale type is genre identity and never varies. */
export const VIBE_GENRE_SCALES: Record<VibeGenre, string> = {
  lofi: 'Major',
  synthwave: 'Natural Minor',
  edm: 'Natural Minor',
  ambient: 'Lydian',
  boombap: 'Dorian',
  zen: 'Hirajoshi',
};

const step = (degree: number, bars = 1, quality?: string): ProgressionStep =>
  quality === undefined ? { degree, bars } : { degree, quality, bars };

export const CHORD_PROGRESSIONS: ChordProgression[] = [
  {
    id: 'pop-i-v-vi-iv',
    name: 'Classic 4-Chord Pop Anthem',
    roman: 'I – V – vi – IV',
    description:
      'The definitive major-scale pop progression creating an instantly uplifting and catchy flow.',
    category: 'Pop & EDM',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(4), step(5), step(3)],
  },
  {
    id: 'pop-vi-iv-i-v',
    name: 'Emotional Minor Synthwave',
    roman: 'vi – IV – I – V',
    description:
      'Moody, heroic, and emotional minor opening used widely in synthwave, EDM, and cinematic anthems.',
    category: 'Pop & EDM',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(5), step(3), step(0), step(4)],
  },
  {
    id: 'pop-doowop',
    name: 'Classic 50s Doo-Wop Cadence',
    roman: 'I – vi – IV – V',
    description:
      'Timeless vintage progression with warm, romantic, and circular harmonic resolution.',
    category: 'Pop & EDM',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(5), step(3), step(4)],
  },
  {
    id: 'pop-future-bass',
    name: 'Future Bass / Euphoric EDM Lift',
    roman: 'IVmaj7 – V7 – iiim7 – vim7',
    description:
      'Lush 7th chord cadence creating unstoppable momentum and euphoric drops.',
    category: 'Pop & EDM',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(3, 1, 'maj7'), step(4, 1, '7'), step(2, 1, 'min7'), step(5, 1, 'min7')],
  },
  {
    id: 'pop-club-house',
    name: 'Club Dance & House Groove',
    roman: 'i – VI – VII – v',
    description:
      'Driving natural minor cadence standard in modern deep house and electronic dance music.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    // Both synthwave and edm anchor on Natural Minor, so this entry is legal in
    // both pools, and it is the fourth edm progression the dice needs. Its bars
    // stay 1 because the migration proof compares them verbatim — which is why
    // the edm convention test asks for uniform bars rather than always-2.
    genres: ['synthwave', 'edm'],
    minScaleLength: 7,
    steps: [step(0, 1, 'min7'), step(5, 1, 'maj7'), step(6, 1, '7'), step(4, 1, 'min7')],
  },
  {
    id: 'jazz-ii-v-i-vi',
    name: 'Jazz ii-V-I-VI Turnaround',
    roman: 'ii7 – V7 – Imaj7 – VI7',
    description:
      'The quintessential jazz standard backbone featuring a secondary dominant turnaround.',
    category: 'Jazz & Neo-Soul',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(1, 1, 'min7'), step(4, 1, '7'), step(0, 1, 'maj7'), step(5, 1, '7')],
  },
  {
    id: 'jazz-neosoul-butter',
    name: 'Neo-Soul Butter Flow',
    roman: 'Imaj9 – viim7b5 – III7 – vim9',
    description:
      'Complex soulful harmony with half-diminished 7b5 leading into a dominant resolution.',
    category: 'Jazz & Neo-Soul',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(0, 1, 'maj9'), step(6, 1, 'm7b5'), step(2, 1, '7'), step(5, 1, 'min9')],
  },
  {
    id: 'jazz-chromatic-mediants',
    name: 'Chromatic Mediants / Giant Step Cycle',
    roman: 'Imaj7 – bVImaj7 – bIImaj7 – V7',
    description:
      'Chromatic third root movements providing a vibrant, otherworldly modal jazz coloration.',
    category: 'Jazz & Neo-Soul',
    referenceScale: 'Phrygian',
    genres: [],
    minScaleLength: 7,
    steps: [
      step(0, 1, 'maj7'),
      step(5, 1, 'maj7'),
      step(1, 1, 'maj7'),
      step(4, 1, '7sus4'),
    ],
  },
  {
    id: 'lofi-coffeehouse',
    name: 'Lofi Extended 9th Coffeehouse',
    roman: 'ii9 – V13 – Imaj9 – IVmaj7',
    description:
      'Warm, relaxed extended 9th and 13th chords tailored for mellow beats and study sessions.',
    category: 'Lofi & R&B',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(1, 1, 'min9'), step(4, 1, '7'), step(0, 1, 'maj9'), step(3, 1, 'maj7')],
  },
  {
    id: 'lofi-trapsoul',
    name: 'Contemporary R&B / Trap-Soul Flow',
    roman: 'i9 – iv7 – VII9 – IIImaj7',
    description:
      'Sultry, atmospheric minor progression standard in contemporary R&B and downtempo production.',
    category: 'Lofi & R&B',
    referenceScale: 'Natural Minor',
    genres: [],
    minScaleLength: 7,
    steps: [step(0, 1, 'min9'), step(3, 1, 'min7'), step(6, 1, '9'), step(2, 1, 'maj7')],
  },
  {
    id: 'lofi-bedroom-pop',
    name: 'Melancholy Bedroom Pop',
    roman: 'Imaj7 – IVmaj7 – ii7 – V7',
    description:
      'Intimate, nostalgic daydream feel with soft major-7th oscillations and tender resolutions.',
    category: 'Lofi & R&B',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(0, 1, 'maj7'), step(3, 1, 'maj7'), step(1, 1, 'min7'), step(4, 1, '7')],
  },
  {
    id: 'jpop-royal-road',
    name: 'Royal Road / Oudo Cadence (王道進行)',
    roman: 'IVmaj7 – V7 – iiim7 – vim7',
    description:
      'The golden standard harmonic sequence of Asian pop and modern dynamic anime theme tracks.',
    category: 'Anime & J-Pop',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(3, 1, 'maj7'), step(4, 1, '7'), step(2, 1, 'min7'), step(5, 1, 'min7')],
  },
  {
    id: 'jpop-marusa',
    name: 'City Pop / Marusa Groove (丸サ進行)',
    roman: 'IVmaj7 – III7 – vim7 – I7',
    description:
      'Infectious groove with secondary dominant transition standard in vintage City Pop and Funk.',
    category: 'Anime & J-Pop',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(3, 1, 'maj7'), step(2, 1, '7'), step(5, 1, 'min7'), step(0, 1, '7')],
  },
  {
    id: 'jpop-heroic',
    name: 'Heroic Anthem / J-Rock Drive',
    roman: 'vi – IV – V – I',
    description:
      'High-energy, heroic minor-to-major resolution celebrating triumph and determination.',
    category: 'Anime & J-Pop',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(5), step(3), step(4), step(0)],
  },
  {
    id: 'blues-12bar',
    name: '12-Bar Blues Standard',
    roman: 'I7 – IV7 – I7 – V7 – IV7 – I7',
    description:
      'The foundational public domain 12-bar blues form loaded with dominant 7th grit.',
    category: 'Rock & Blues',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [
      step(0, 2, '7'),
      step(3, 1, '7'),
      step(0, 1, '7'),
      step(4, 1, '7'),
      step(3, 1, '7'),
      step(0, 2, '7'),
    ],
  },
  {
    id: 'rock-mixolydian',
    name: 'Mixolydian Rock Anthem',
    roman: 'I – bVII – IV – I',
    description:
      'Modal rock swagger featuring the flattened seventh chord for a gritty, driving feel.',
    category: 'Rock & Blues',
    referenceScale: 'Mixolydian',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(6), step(3), step(0)],
  },
  {
    id: 'rock-andalusian',
    name: 'Andalusian / Flamenco Descent',
    roman: 'i – bVII – bVI – V',
    description:
      'Dramatic descending Phrygian bassline cadence rooted in historic Spanish folk and acoustic rock.',
    category: 'Rock & Blues',
    referenceScale: 'Natural Minor',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(6), step(5), step(4, 1, '7')],
  },
  {
    id: 'cine-epic-ostinato',
    name: 'Epic Cinematic Ostinato',
    roman: 'i – bVI – III – bVII',
    description:
      'Monumental cinematic progression built for soaring blockbuster film scores and orchestral trailers.',
    category: 'Cinematic & Modal',
    referenceScale: 'Natural Minor',
    genres: ['synthwave'],
    minScaleLength: 7,
    steps: [step(0), step(5), step(2), step(6)],
  },
  {
    id: 'cine-dorian-voyage',
    name: 'Dorian Space Voyage',
    roman: 'i7 – IV7 – i7 – IV7',
    description:
      'Floating, futuristic vamp utilizing natural 6th modal harmonization for electronic soundscapes.',
    category: 'Cinematic & Modal',
    referenceScale: 'Dorian',
    genres: ['boombap'],
    minScaleLength: 7,
    steps: [step(0, 1, 'min7'), step(3, 1, '7'), step(0, 1, 'min7'), step(3, 1, '7')],
  },
  {
    id: 'cine-lydian-dream',
    name: 'Lydian Dreamscape',
    roman: 'Imaj7 – II – Imaj7 – II',
    description:
      'Magical raised-4th harmony evoking wonder, airborne flight, and majestic adventure.',
    category: 'Cinematic & Modal',
    referenceScale: 'Lydian',
    genres: [],
    minScaleLength: 7,
    steps: [step(0, 1, 'maj7'), step(1), step(0, 1, 'maj7'), step(1)],
  },
  {
    id: 'baroque-canon',
    name: 'Baroque Canon Cadence',
    roman: 'I – V – vi – iii – IV – I – IV – V',
    description:
      'The golden traditional baroque harmonic sequence celebrated across 300 years of music history.',
    category: 'Classical & Baroque',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(4), step(5), step(2), step(3), step(0), step(3), step(4)],
  },
  {
    id: 'baroque-passacaglia',
    name: 'Passacaglia / Circle of Fifths Descent',
    roman: 'i – iv – VII – III – VI – iio – V – i',
    description:
      'Hypnotic circular resolution driving classical drama, emotional tension, and resolve.',
    category: 'Classical & Baroque',
    referenceScale: 'Natural Minor',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(3), step(6), step(2), step(5), step(1), step(4, 1, '7'), step(0)],
  },

  // --- Ambient: Lydian is the signature ambient scale. Modal vamps, pedal
  // tones, 4-32 bars per chord, and no V-I cadence anywhere — including across
  // the loop point, which is why none of these contains degree 4 at all.
  {
    id: 'ambient-still-water',
    name: 'Still Water Pedal',
    roman: 'Imaj7 – vim7',
    description:
      'Two chords over eight bars each: a tonic pedal that breathes rather than moves.',
    category: 'Ambient & Zen',
    referenceScale: 'Lydian',
    genres: ['ambient'],
    minScaleLength: 7,
    steps: [step(0, 8, 'maj7'), step(5, 8, 'min7')],
  },
  {
    id: 'ambient-lydian-drift',
    name: 'Lydian Drift',
    roman: 'Imaj7 – II – iiim7 – II',
    description:
      'The raised fourth heard as a major II chord, drifting back and forth without ever resolving.',
    category: 'Ambient & Zen',
    referenceScale: 'Lydian',
    genres: ['ambient'],
    minScaleLength: 7,
    steps: [step(0, 4, 'maj7'), step(1, 4), step(2, 4, 'min7'), step(1, 4)],
  },
  {
    id: 'ambient-open-fourths',
    name: 'Open-Fourth Vamp',
    roman: 'Isus2 – IIsus2',
    description:
      'Suspended, thirdless voicings that leave the mode ambiguous and the texture wide open.',
    category: 'Ambient & Zen',
    referenceScale: 'Lydian',
    genres: ['ambient'],
    minScaleLength: 7,
    steps: [step(0, 4, 'sus2'), step(1, 4, 'sus2')],
  },
  {
    id: 'ambient-glass-horizon',
    name: 'Glass Horizon',
    roman: 'vim7 – Imaj7 – iiim7 – IIsus2',
    description:
      'Opens away from the tonic, so the key arrives late and the loop never settles on a downbeat.',
    category: 'Ambient & Zen',
    referenceScale: 'Lydian',
    genres: ['ambient'],
    minScaleLength: 7,
    steps: [step(5, 4, 'min7'), step(0, 4, 'maj7'), step(2, 4, 'min7'), step(1, 4, 'sus2')],
  },

  // --- EDM: the three shapes the research names for 126-130 BPM, all two bars
  // per chord so the drop has room to breathe.
  {
    id: 'edm-cyber-drop',
    name: 'Cyber Drop Loop',
    roman: 'i – VII – VI – VII',
    description:
      'The workhorse main-stage loop: a minor tonic rocking between its two flat neighbours.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['edm'],
    minScaleLength: 7,
    steps: [step(0, 2), step(6, 2), step(5, 2), step(6, 2)],
  },
  {
    id: 'edm-neon-rise',
    name: 'Neon Rise',
    roman: 'i – VI – III – VII',
    description:
      'Descending-then-lifting minor cycle that carries a build without needing a key change.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['edm'],
    minScaleLength: 7,
    steps: [step(0, 2), step(5, 2), step(2, 2), step(6, 2)],
  },
  {
    id: 'edm-arena-sweep',
    name: 'Arena Sweep',
    roman: 'i – III – VII – VI',
    description:
      'Bright relative-major lift on the second chord, then a long fall back to the tonic.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['edm'],
    minScaleLength: 7,
    steps: [step(0, 2), step(2, 2), step(6, 2), step(5, 2)],
  },

  // --- Synthwave: almost exclusively minor, with occasional modal borrowing
  // for brightness.
  {
    id: 'synthwave-midnight-drive',
    name: 'Midnight Drive',
    roman: 'i – iv – VI – V',
    description:
      'A major V borrowed over the natural-minor scale — the one bright chord in an otherwise dark loop.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['synthwave'],
    minScaleLength: 7,
    steps: [step(0), step(3), step(5), step(4, 1, 'maj')],
  },
  {
    id: 'synthwave-neon-horizon',
    name: 'Neon Horizon',
    roman: 'i – VII – III – VI',
    description:
      'Strictly diatonic minor cycle with a chord per bar, built for arpeggiated pads.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['synthwave'],
    minScaleLength: 7,
    steps: [step(0), step(6), step(2), step(5)],
  },

  // --- Lo-Fi: sevenths and ninths are the default, not decoration.
  {
    id: 'lofi-rainy-window',
    name: 'Rainy Window',
    roman: 'vim9 – IVmaj7 – ii9 – V7',
    description:
      'Starts on the relative minor ninth and walks a soft ii-V home; smooth voice leading throughout.',
    category: 'Lofi & R&B',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(5, 1, 'min9'), step(3, 1, 'maj7'), step(1, 1, 'min9'), step(4, 1, '7')],
  },
  {
    id: 'lofi-tape-loop',
    name: 'Tape Loop',
    roman: 'Imaj9 – vim7 – ii9 – V9',
    description:
      'A turnaround that closes on a dominant ninth, so the loop point never quite resolves.',
    category: 'Lofi & R&B',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(0, 1, 'maj9'), step(5, 1, 'min7'), step(1, 1, 'min9'), step(4, 1, '9')],
  },

  // --- Boom Bap: Dorian, min7 / maj7 and 9/11/13 extensions, ii-V-i.
  {
    id: 'boombap-dusty-ii-v',
    name: 'Dusty ii–V–i',
    roman: 'iim7 – V7 – im9',
    description:
      'A three-chord ii-V-i that lands on a two-bar minor ninth — room for the sample to sit.',
    category: 'Lofi & R&B',
    referenceScale: 'Dorian',
    genres: ['boombap'],
    minScaleLength: 7,
    steps: [step(1, 1, 'min7'), step(4, 1, '7'), step(0, 2, 'min9')],
  },
  {
    id: 'boombap-crate-dig',
    name: 'Crate Dig',
    roman: 'im9 – VIImaj7 – IIImaj7 – IV7',
    description:
      'Two major sevenths lifted out of the mode, then the Dorian major IV that gives the style its colour.',
    category: 'Lofi & R&B',
    referenceScale: 'Dorian',
    genres: ['boombap'],
    minScaleLength: 7,
    steps: [step(0, 1, 'min9'), step(6, 1, 'maj7'), step(2, 1, 'maj7'), step(3, 1, '7')],
  },
  {
    id: 'boombap-head-nod',
    name: 'Head Nod',
    roman: 'im7 – IV7 – im7 – iim7',
    description:
      'Two-chord vamp with a turn onto the ii, the flattest, most loopable shape in the style.',
    category: 'Lofi & R&B',
    referenceScale: 'Dorian',
    genres: ['boombap'],
    minScaleLength: 7,
    steps: [step(0, 1, 'min7'), step(3, 1, '7'), step(0, 1, 'min7'), step(1, 1, 'min7')],
  },

  // --- Zen: Hirajoshi. Only degrees 0, 3 and 4 give triads that stay entirely
  // inside the five notes, so the vamp below is built from exactly those.
  {
    id: 'zen-bamboo-vamp',
    name: 'Bamboo Vamp',
    roman: 'i – IV – i – V',
    description:
      'Open-fourth koto sound over a minor tonic; every note it plays is inside the scale.',
    category: 'Ambient & Zen',
    referenceScale: 'Hirajoshi',
    genres: ['zen'],
    minScaleLength: 5,
    steps: [step(0, 2), step(3, 2), step(0, 2), step(4, 2)],
  },
  {
    id: 'zen-moonlit-koto',
    name: 'Moonlit Koto',
    roman: 'i – V – IV – III',
    description:
      'Descends through the half-step that gives Hirajoshi its melancholy, ending on the bright III.',
    category: 'Ambient & Zen',
    referenceScale: 'Hirajoshi',
    genres: ['zen'],
    minScaleLength: 5,
    steps: [step(0, 2), step(4, 2), step(3, 2), step(2, 2)],
  },
  {
    id: 'zen-still-pond',
    name: 'Still Pond',
    roman: 'im7 – Vmaj7',
    description:
      'Two four-bar chords, held long enough for the decay to become the arrangement.',
    category: 'Ambient & Zen',
    referenceScale: 'Hirajoshi',
    genres: ['zen'],
    minScaleLength: 5,
    steps: [step(0, 4, 'min7'), step(4, 4, 'maj7')],
  },
  {
    id: 'zen-temple-bell',
    name: 'Temple Bell',
    roman: 'i – III – V – IV',
    description:
      'Rises through both major thirds before the open fourth settles it — not a rotation of the vamp.',
    category: 'Ambient & Zen',
    referenceScale: 'Hirajoshi',
    genres: ['zen'],
    minScaleLength: 5,
    steps: [step(0, 2), step(2, 2), step(4, 2), step(3, 2)],
  },
  {
    id: 'lofi-morning-turnaround',
    name: 'Morning Brew Turnaround',
    roman: 'Imaj7 – vim7 – iim7 – V7',
    description:
      'Warm extended-seventh turnaround built for lo-fi\'s laid-back morning loop, closing the fourth bar on a dominant seventh that resets cleanly into the top.',
    category: 'Lofi & R&B',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(0, 1, 'maj7'), step(5, 1, 'min7'), step(1, 1, 'min7'), step(4, 1, '7')],
  },
  {
    id: 'edm-cyber-vamp',
    name: 'Cyber Vamp',
    roman: 'i – VII – VI – v',
    description:
      'A minor tonic rocking between its two flat neighbours before dipping to the minor v, one bar per chord for a tight festival-drop loop.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['edm'],
    minScaleLength: 7,
    steps: [step(0), step(6), step(5), step(4)],
  },
  {
    id: 'ambient-lydian-halo',
    name: 'Lydian Halo',
    roman: 'Imaj7 – II – iiim7 – #ivm7b5',
    description:
      'A Lydian float that lifts through the major II before settling on the raised-4th half-diminished, four bars per chord for a slow-breathing pad loop.',
    category: 'Ambient & Zen',
    referenceScale: 'Lydian',
    genres: ['ambient'],
    minScaleLength: 7,
    steps: [step(0, 4, 'maj7'), step(1, 4), step(2, 4, 'min7'), step(3, 4, 'm7b5')],
  },
  {
    id: 'boombap-soul-piano',
    name: 'Soul Piano Loop',
    roman: 'im7 – IV7 – VIImaj7 – IIImaj7',
    description:
      'A Dorian loop built for a mellow keys sample: minor seventh tonic, dominant modal IV, then two major sevenths on the way back home.',
    category: 'Lofi & R&B',
    referenceScale: 'Dorian',
    genres: ['boombap'],
    minScaleLength: 7,
    steps: [step(0, 1, 'min7'), step(3, 1, '7'), step(6, 1, 'maj7'), step(2, 1, 'maj7')],
  },
];

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
