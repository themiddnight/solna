// Chord progression templates + their type. Moved verbatim from ChordView.tsx
// (was lines 94–421). Lives in audio/data so ChordView and ChordPresetLibrary
// can both import it without the ChordView <-> ChordPresetLibrary cycle.

export interface ProgressionTemplate {
  name: string;
  category:
    | "Pop & EDM"
    | "Jazz & Neo-Soul"
    | "Lofi & R&B"
    | "Rock & Blues"
    | "Anime & J-Pop"
    | "Cinematic & Modal"
    | "Classical & Baroque";
  roman: string;
  description: string;
  // Semitone intervals relative to the chosen key's root (0 = Key root)
  // along with chord quality for key transposition
  relativeChords: Array<{ interval: number; quality: string; bars: number }>;
}

export const CHORD_PROGRESSION_TEMPLATES: ProgressionTemplate[] = [
  // Pop & EDM
  {
    name: "Classic 4-Chord Pop Anthem",
    category: "Pop & EDM",
    roman: "I – V – vi – IV",
    description:
      "The definitive major-scale pop progression creating an instantly uplifting and catchy flow.",
    relativeChords: [
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 7, quality: "maj", bars: 1 }, // V
      { interval: 9, quality: "min", bars: 1 }, // vi
      { interval: 5, quality: "maj", bars: 1 }, // IV
    ],
  },
  {
    name: "Emotional Minor Synthwave",
    category: "Pop & EDM",
    roman: "vi – IV – I – V",
    description:
      "Moody, heroic, and emotional minor opening used widely in synthwave, EDM, and cinematic anthems.",
    relativeChords: [
      { interval: 9, quality: "min", bars: 1 }, // vi
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 7, quality: "maj", bars: 1 }, // V
    ],
  },
  {
    name: "Classic 50s Doo-Wop Cadence",
    category: "Pop & EDM",
    roman: "I – vi – IV – V",
    description:
      "Timeless vintage progression with warm, romantic, and circular harmonic resolution.",
    relativeChords: [
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 9, quality: "min", bars: 1 }, // vi
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 7, quality: "maj", bars: 1 }, // V
    ],
  },
  {
    name: "Future Bass / Euphoric EDM Lift",
    category: "Pop & EDM",
    roman: "IVmaj7 – V7 – iiim7 – vim7",
    description:
      "Lush 7th chord cadence creating unstoppable momentum and euphoric drops.",
    relativeChords: [
      { interval: 5, quality: "maj7", bars: 1 }, // IVmaj7
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 4, quality: "min7", bars: 1 }, // iiim7
      { interval: 9, quality: "min7", bars: 1 }, // vim7
    ],
  },
  {
    name: "Club Dance & House Groove",
    category: "Pop & EDM",
    roman: "i – VI – VII – v",
    description:
      "Driving natural minor cadence standard in modern deep house and electronic dance music.",
    relativeChords: [
      { interval: 0, quality: "min7", bars: 1 }, // i
      { interval: 8, quality: "maj7", bars: 1 }, // VI
      { interval: 10, quality: "7", bars: 1 }, // VII
      { interval: 7, quality: "min7", bars: 1 }, // v
    ],
  },

  // Jazz & Neo-Soul
  {
    name: "Jazz ii-V-I-VI Turnaround",
    category: "Jazz & Neo-Soul",
    roman: "ii7 – V7 – Imaj7 – VI7",
    description:
      "The quintessential jazz standard backbone featuring a secondary dominant turnaround.",
    relativeChords: [
      { interval: 2, quality: "min7", bars: 1 }, // ii7
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 0, quality: "maj7", bars: 1 }, // Imaj7
      { interval: 9, quality: "7", bars: 1 }, // VI7
    ],
  },
  {
    name: "Neo-Soul Butter Flow",
    category: "Jazz & Neo-Soul",
    roman: "Imaj9 – viim7b5 – III7 – vim9",
    description:
      "Complex soulful harmony with half-diminished 7b5 leading into a dominant resolution.",
    relativeChords: [
      { interval: 0, quality: "maj9", bars: 1 }, // Imaj9
      { interval: 11, quality: "m7b5", bars: 1 }, // viim7b5
      { interval: 4, quality: "7", bars: 1 }, // III7
      { interval: 9, quality: "min9", bars: 1 }, // vim9
    ],
  },
  {
    name: "Chromatic Mediants / Giant Step Cycle",
    category: "Jazz & Neo-Soul",
    roman: "Imaj7 – bVImaj7 – bIImaj7 – V7",
    description:
      "Chromatic third root movements providing a vibrant, otherworldly modal jazz coloration.",
    relativeChords: [
      { interval: 0, quality: "maj7", bars: 1 }, // Imaj7
      { interval: 8, quality: "maj7", bars: 1 }, // bVImaj7
      { interval: 1, quality: "maj7", bars: 1 }, // bIImaj7
      { interval: 7, quality: "7sus4", bars: 1 }, // V7sus4
    ],
  },

  // Lofi & R&B
  {
    name: "Lofi Extended 9th Coffeehouse",
    category: "Lofi & R&B",
    roman: "ii9 – V13 – Imaj9 – IVmaj7",
    description:
      "Warm, relaxed extended 9th and 13th chords tailored for mellow beats and study sessions.",
    relativeChords: [
      { interval: 2, quality: "min9", bars: 1 }, // ii9
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 0, quality: "maj9", bars: 1 }, // Imaj9
      { interval: 5, quality: "maj7", bars: 1 }, // IVmaj7
    ],
  },
  {
    name: "Contemporary R&B / Trap-Soul Flow",
    category: "Lofi & R&B",
    roman: "i9 – iv7 – VII9 – IIImaj7",
    description:
      "Sultry, atmospheric minor progression standard in contemporary R&B and downtempo production.",
    relativeChords: [
      { interval: 0, quality: "min9", bars: 1 }, // i9
      { interval: 5, quality: "min7", bars: 1 }, // iv7
      { interval: 10, quality: "9", bars: 1 }, // VII9
      { interval: 3, quality: "maj7", bars: 1 }, // IIImaj7
    ],
  },
  {
    name: "Melancholy Bedroom Pop",
    category: "Lofi & R&B",
    roman: "Imaj7 – IVmaj7 – ii7 – V7",
    description:
      "Intimate, nostalgic daydream feel with soft major-7th oscillations and tender resolutions.",
    relativeChords: [
      { interval: 0, quality: "maj7", bars: 1 }, // Imaj7
      { interval: 5, quality: "maj7", bars: 1 }, // IVmaj7
      { interval: 2, quality: "min7", bars: 1 }, // ii7
      { interval: 7, quality: "7", bars: 1 }, // V7
    ],
  },

  // Anime & J-Pop
  {
    name: "Royal Road / Oudo Cadence (王道進行)",
    category: "Anime & J-Pop",
    roman: "IVmaj7 – V7 – iiim7 – vim7",
    description:
      "The golden standard harmonic sequence of Asian pop and modern dynamic anime theme tracks.",
    relativeChords: [
      { interval: 5, quality: "maj7", bars: 1 }, // IVmaj7
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 4, quality: "min7", bars: 1 }, // iiim7
      { interval: 9, quality: "min7", bars: 1 }, // vim7
    ],
  },
  {
    name: "City Pop / Marusa Groove (丸サ進行)",
    category: "Anime & J-Pop",
    roman: "IVmaj7 – III7 – vim7 – I7",
    description:
      "Infectious groove with secondary dominant transition standard in vintage City Pop and Funk.",
    relativeChords: [
      { interval: 5, quality: "maj7", bars: 1 }, // IVmaj7
      { interval: 4, quality: "7", bars: 1 }, // III7 (secondary dominant)
      { interval: 9, quality: "min7", bars: 1 }, // vim7
      { interval: 0, quality: "7", bars: 1 }, // I7
    ],
  },
  {
    name: "Heroic Anthem / J-Rock Drive",
    category: "Anime & J-Pop",
    roman: "vi – IV – V – I",
    description:
      "High-energy, heroic minor-to-major resolution celebrating triumph and determination.",
    relativeChords: [
      { interval: 9, quality: "min", bars: 1 }, // vi
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 7, quality: "maj", bars: 1 }, // V
      { interval: 0, quality: "maj", bars: 1 }, // I
    ],
  },

  // Rock & Blues
  {
    name: "12-Bar Blues Standard",
    category: "Rock & Blues",
    roman: "I7 – IV7 – I7 – V7 – IV7 – I7",
    description:
      "The foundational public domain 12-bar blues form loaded with dominant 7th grit.",
    relativeChords: [
      { interval: 0, quality: "7", bars: 2 }, // I7
      { interval: 5, quality: "7", bars: 1 }, // IV7
      { interval: 0, quality: "7", bars: 1 }, // I7
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 5, quality: "7", bars: 1 }, // IV7
      { interval: 0, quality: "7", bars: 2 }, // I7
    ],
  },
  {
    name: "Mixolydian Rock Anthem",
    category: "Rock & Blues",
    roman: "I – bVII – IV – I",
    description:
      "Modal rock swagger featuring the flattened seventh chord for a gritty, driving feel.",
    relativeChords: [
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 10, quality: "maj", bars: 1 }, // bVII
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 0, quality: "maj", bars: 1 }, // I
    ],
  },
  {
    name: "Andalusian / Flamenco Descent",
    category: "Rock & Blues",
    roman: "i – bVII – bVI – V",
    description:
      "Dramatic descending Phrygian bassline cadence rooted in historic Spanish folk and acoustic rock.",
    relativeChords: [
      { interval: 0, quality: "min", bars: 1 }, // i
      { interval: 10, quality: "maj", bars: 1 }, // bVII
      { interval: 8, quality: "maj", bars: 1 }, // bVI
      { interval: 7, quality: "7", bars: 1 }, // V7
    ],
  },

  // Cinematic & Modal
  {
    name: "Epic Cinematic Ostinato",
    category: "Cinematic & Modal",
    roman: "i – bVI – III – bVII",
    description:
      "Monumental cinematic progression built for soaring blockbuster film scores and orchestral trailers.",
    relativeChords: [
      { interval: 0, quality: "min", bars: 1 }, // i
      { interval: 8, quality: "maj", bars: 1 }, // bVI
      { interval: 3, quality: "maj", bars: 1 }, // III
      { interval: 10, quality: "maj", bars: 1 }, // bVII
    ],
  },
  {
    name: "Dorian Space Voyage",
    category: "Cinematic & Modal",
    roman: "i7 – IV7 – i7 – IV7",
    description:
      "Floating, futuristic vamp utilizing natural 6th modal harmonization for electronic soundscapes.",
    relativeChords: [
      { interval: 0, quality: "min7", bars: 1 }, // i7
      { interval: 5, quality: "7", bars: 1 }, // IV7 (Major IV in Dorian)
      { interval: 0, quality: "min7", bars: 1 }, // i7
      { interval: 5, quality: "7", bars: 1 }, // IV7
    ],
  },
  {
    name: "Lydian Dreamscape",
    category: "Cinematic & Modal",
    roman: "Imaj7 – II – Imaj7 – II",
    description:
      "Magical raised-4th harmony evoking wonder, airborne flight, and majestic adventure.",
    relativeChords: [
      { interval: 0, quality: "maj7", bars: 1 }, // Imaj7
      { interval: 2, quality: "maj", bars: 1 }, // II (Major 2 in Lydian)
      { interval: 0, quality: "maj7", bars: 1 }, // Imaj7
      { interval: 2, quality: "maj", bars: 1 }, // II
    ],
  },

  // Classical & Baroque
  {
    name: "Baroque Canon Cadence",
    category: "Classical & Baroque",
    roman: "I – V – vi – iii – IV – I – IV – V",
    description:
      "The golden traditional baroque harmonic sequence celebrated across 300 years of music history.",
    relativeChords: [
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 7, quality: "maj", bars: 1 }, // V
      { interval: 9, quality: "min", bars: 1 }, // vi
      { interval: 4, quality: "min", bars: 1 }, // iii
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 0, quality: "maj", bars: 1 }, // I
      { interval: 5, quality: "maj", bars: 1 }, // IV
      { interval: 7, quality: "maj", bars: 1 }, // V
    ],
  },
  {
    name: "Passacaglia / Circle of Fifths Descent",
    category: "Classical & Baroque",
    roman: "i – iv – VII – III – VI – iio – V – i",
    description:
      "Hypnotic circular resolution driving classical drama, emotional tension, and resolve.",
    relativeChords: [
      { interval: 0, quality: "min", bars: 1 }, // i
      { interval: 5, quality: "min", bars: 1 }, // iv
      { interval: 10, quality: "maj", bars: 1 }, // VII
      { interval: 3, quality: "maj", bars: 1 }, // III
      { interval: 8, quality: "maj", bars: 1 }, // VI
      { interval: 2, quality: "dim", bars: 1 }, // iio
      { interval: 7, quality: "7", bars: 1 }, // V7
      { interval: 0, quality: "min", bars: 1 }, // i
    ],
  },
];
