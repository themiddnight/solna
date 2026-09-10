/**
 * The eight Instant Vibes, as pure references.
 *
 * WHY AN ALWAYS-MOUNTED COMPONENT MAY IMPORT THIS EAGERLY: every file in
 * src/data/ imports nothing at runtime — the eslint block on src/data/**
 * enforces it — so `import { VIBES } from '@/data/vibes'` pulls in this file
 * and nothing else. Its transitive graph is empty by construction.
 *
 * That is the whole reason store/vibeChips.ts could be deleted rather than
 * re-justified. That file existed because the old table resolved its chords,
 * drum grid and effect chain at MODULE-EVALUATION time, which dragged
 * synthPresets, chordProgressions, drumGrids and effectChains into the
 * eagerly-parsed main chunk for a bar that renders eight names and eight
 * emoji. If a resolver call ever appears below, that cost comes straight back
 * and the chip duplication has to come back with it. DO NOT ADD ONE.
 *
 * A VibeSpec writes every library id EXACTLY ONCE. `chords`, `drumPattern`
 * and `effects` are not fields here — `resolveVibe` in store/vibes.ts produces
 * them from the ids below, in the vibe's own key, scale and octave. Writing an
 * id twice used to be the documented failure mode: a typo in the second copy
 * made `!` hand back `undefined` and threw at apply time.
 *
 * No presentational field belongs here: `color`, `bgGradient`, `borderColor`
 * and `textColor` are forbidden on a vibe. The chip's look comes from theme
 * tokens in InstantVibesBar.
 */
import type {
  FilterType,
  PadInterval,
  PadMode,
  PadVoicing,
} from '@/types';
import type { MeterId } from '@/utils/meter';

/**
 * What the dice may reroll, per vibe.
 *
 * Every pool is written out explicitly. It used to be derived — `progressions`
 * was pinned to the complete genre-and-scale-length filter over
 * CHORD_PROGRESSIONS — which meant adding one progression to the shared
 * library silently changed what two unrelated vibes could roll, and a test then
 * demanded those vibes be edited to match. A pool is a taste decision about ONE
 * vibe, so it lives on that vibe.
 *
 * The accepted cost: a pool can go stale as the library grows. The mitigation
 * is `bun run report:library`, which lists unreferenced entries and always
 * exits 0 — an unused library entry is a fact about the content, not a defect.
 *
 * A ONE-MEMBER ARRAY IS LEGITIMATE. It says "this axis is deliberately fixed"
 * in the same shape as every other axis. Note that `pickDistinct` falls back to
 * the current value when it is the sole member, so such an axis stops rerolling
 * — which is what a one-member pool means.
 */
export interface VibeRandomRule {
  /** Roots that suit the vibe. The dice picks one. Always contains scaleRoot. */
  keys: string[];
  /** Inclusive [min, max] integer BPM. Always contains the vibe's own bpm. */
  bpm: [number, number];
  /**
   * Ids into CHORD_PROGRESSIONS. Always contains the vibe's own progressionId.
   * Two invariants hold for every member: `minScaleLength <=
   * SCALES[scaleType].intervals.length`, and `referenceScale === scaleType`.
   */
  progressions: string[];
  /** Ids into CHORD_RHYTHMS. Always contains the vibe's own chordRhythmId. */
  chordRhythms: string[];
  /** Ids into BASS_PATTERNS. Always contains the vibe's own bassPatternId. */
  bassPatterns: string[];
  /**
   * Ids into DRUM_GRIDS. Always contains the vibe's own drumGridId.
   *
   * The same shape as the three pools above, and that is the point: the drum
   * axis used to be the one axis with bespoke machinery — a decoration rule
   * that rewrote four rows of the authored grid from a density catalogue — and
   * it is now the fourth id pool. A reroll REPOINTS the grid; it does not
   * decorate one.
   *
   * A member may be in a different meter from the vibe. Trim-or-loop is the
   * project's rule for that everywhere else, so the dice is not made stricter
   * than the menus. Two pools use the permission on purpose; the rest are
   * authored same-meter.
   */
  drumGrids: string[];
}

export interface VibeSpec {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  bpm: number;
  /**
   * The time signature this vibe is written in. Applying the vibe sets the
   * transport meter to it, so the vibe always resolves patterns of the right
   * meter.
   */
  meter: MeterId;
  scaleRoot: string;
  scaleType: string;

  // Beat & Drum Kit
  soundKit: string;
  /**
   * Library reference into DRUM_GRIDS — any of the 30, not a vibe-only subset:
   * the sequencer's genre grids and the vibes' own grids are one library.
   * A reroll REPOINTS this, the same way it repoints `progressionId`: the dice
   * draws from `random.drumGrids` and the resolved vibe's `drumGridId` always
   * names the grid actually playing.
   */
  drumGridId: string;
  drumFilterCutoff?: number;
  drumFilterResonance?: number;
  drumFilterType?: FilterType;

  // Chords
  /** Library reference into CHORD_PROGRESSIONS. */
  progressionId: string;
  chordRhythmId: string;
  chordFeel: number; // 0.0 (tight) to 1.0 (loose/swung)
  chordOctave: number;
  /** Library reference into SYNTH_PRESETS for the comp voice. */
  chordPresetId: string;

  // Bass
  bassPatternId: string;
  bassFeel: number; // 0.0 (tight) to 1.0 (loose/swung)
  bassOctave: number;
  /** Library reference into SYNTH_PRESETS; must resolve to category 'Bass'. */
  bassPresetId: string;

  /**
   * The pad layer, when the genre uses one.
   *
   * OPTIONAL here and required on `Loop`, deliberately: a vibe *chooses*
   * whether to bring a pad, while a loop *always has* pad state.
   */
  pad?: {
    volume: number;
    /** Library reference into SYNTH_PRESETS; must resolve to category 'Pad'. */
    presetId: string;
    mode: PadMode;
    octave: number;
    voicing: PadVoicing;
    droneDegree: number;
    droneIntervals: readonly PadInterval[];
  };

  // Lead / Melody Synthesizer (preset reference only — arp is the user's)
  /** Library reference into SYNTH_PRESETS for the lead voice. */
  synthPresetId: string;

  /**
   * Library reference into SYNTH_PRESETS for the FX voice; must resolve to
   * category 'FX'.
   *
   * REQUIRED, unlike `pad`. That field is optional because a vibe *chooses*
   * whether to bring a pad; FX is a track every loop has, the way lead is, so a
   * vibe that declined to voice it would leave the FX track on whatever the
   * PREVIOUS vibe set — which is the one thing the "every library id, exactly
   * once and completely" rule exists to prevent.
   */
  fxPresetId: string;

  /** Library reference into EFFECT_CHAINS. */
  effectChainId: string;

  /** What the dice may reroll. Optional — a vibe without one shows no dice. */
  random?: VibeRandomRule;
}

export const VIBES: VibeSpec[] = [
  {
    id: 'lofi-chill',
    name: 'Lo-Fi Chill',
    tagline: 'Warm dusty beats & relaxing jazz chords',
    emoji: '☕',
    bpm: 84,
    meter: '4/4',
    scaleRoot: 'C',
    scaleType: 'Major',
    progressionId: 'lofi-morning-turnaround',

    // Beat: Dusty Break with warm lowpass filter
    soundKit: 'Dusty Break',
    drumFilterCutoff: 6200,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumGridId: 'lofi-half-time-brush',

    // Chords: Dream Keys, relaxed swung feel
    chordRhythmId: 'lofiSwing',
    chordFeel: 0.78, // Loose swing
    chordOctave: 4,
    chordPresetId: 'factory-mellow-epiano',

    // Bass: Deep sub with Dilla loose swing
    bassPatternId: 'dilla-sub',
    bassFeel: 0.75, // Loose pocket
    bassOctave: 2,
    bassPresetId: 'bass-deep-sine',

    // Main Synth: Warm Keys / Whistle
    synthPresetId: 'factory-dream-keys',

    // FX: the tape-hiss riser under the turnaround.
    fxPresetId: 'factory-noise-riser-fx',

    // Pad: glue under the e-piano, not a foreground voice.
    pad: { volume: 0.30, presetId: 'factory-warm-polypad', mode: 'pad', octave: 3, voicing: 'open5', droneDegree: 0, droneIntervals: [1, 5, 8] },

    effectChainId: 'lofi-tape-room',

    // lofi-chill
    random: {
      // The jazz/soul record keys lo-fi samples from. Full lower-to-middle
      // span: its bass is filtered at 260 Hz, so a deep half-audible sub is
      // the genre's texture rather than a fault.
      keys: ['C', 'D', 'D#', 'F', 'G', 'A'],
      bpm: [78, 88],
      // Mirrors lofi-waltz's progressions pool exactly (same 7 entries), by
      // intent — both are jazz/lo-fi vibes drawing on the same songbook.
      // Diverging is allowed; do it deliberately, to both, not by accident.
      progressions: ['jazz-ii-v-i-vi', 'jazz-neosoul-butter', 'lofi-coffeehouse', 'lofi-bedroom-pop', 'lofi-rainy-window', 'lofi-tape-loop', 'lofi-morning-turnaround'],
      chordRhythms: ['lofiSwing', 'syncopatedPush', 'bassPlusStrum'],
      bassPatterns: ['dilla-sub', 'walking-groove', 'half-time-legato'],
      // Its own grid, the corrected genre entry, and the two hip-hop
      // transcriptions closest to it. All 4/4.
      drumGrids: ['lofi-half-time-brush', 'lofi-hip-hop', 'lofi-ghost-kick', 'boombap-8th-hat'],
    },
  },
  {
    id: 'synthwave-80s',
    name: 'Synthwave 80s',
    tagline: 'Neon night driving with retro analog synth & pumping bass',
    emoji: '🏎️',
    bpm: 118,
    meter: '4/4',
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    progressionId: 'cine-epic-ostinato',

    // Beat: Retro Drive, tight 80s gate
    soundKit: 'Retro Drive',
    drumFilterCutoff: 12000,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumGridId: 'synthwave-four-on-floor',

    // Chords: Neon Polysynth, grid-tight 8th pads
    chordRhythmId: 'eighthPads',
    chordFeel: 0.12, // Strict tight sequencer grid
    chordOctave: 4,
    chordPresetId: 'factory-neon-poly-saw',

    // Bass: Saw Growl / Motorik driving 8ths
    bassPatternId: 'driving-eighths',
    bassFeel: 0.10, // Grid tight
    bassOctave: 2,
    bassPresetId: 'bass-saw-growl',

    // Main Synth: Hyper Saw Lead
    synthPresetId: 'factory-hyper-saw-lead',

    // FX: the laser zap that punctuates a neon night drive.
    fxPresetId: 'factory-laser-fx',

    // Pad: the sustained half of the genre's two-layer chord stack.
    pad: { volume: 0.65, presetId: 'factory-string-ensemble', mode: 'pad', octave: 3, voicing: 'triad', droneDegree: 0, droneIntervals: [1, 5, 8] },

    effectChainId: 'synthwave-neon-hall',

    // synthwave-80s
    random: {
      // Starts at D so the Saw Growl sub-osc (0.5, one octave down) stays above
      // ~37 Hz. The upper bound is a taste call, not an acoustic one: the pool
      // stops at A to keep every draw inside the darker half of the synthwave
      // key range. (It used to be justified by the lead arp's two octaves of
      // headroom; the arp is gone, and the bound was kept exactly as authored.)
      keys: ['D', 'E', 'F', 'F#', 'G', 'A'],
      bpm: [108, 118],
      progressions: ['pop-club-house', 'cine-epic-ostinato', 'synthwave-midnight-drive', 'synthwave-neon-horizon'],
      chordRhythms: ['eighthPads', 'fourOnFloor', 'popBallad8ths'],
      bassPatterns: ['driving-eighths', 'offbeat-sub', 'root-fifth-walk'],
      drumGrids: ['synthwave-four-on-floor', 'synthwave', 'synthwave-attack', 'techno-rolling'],
    },
  },
  {
    id: 'cyber-edm',
    name: 'Cyber EDM',
    tagline: 'High-energy 128 BPM festival drop with punchy kicks & stabs',
    emoji: '⚡',
    bpm: 128,
    meter: '4/4',
    scaleRoot: 'F',
    scaleType: 'Natural Minor',
    progressionId: 'edm-cyber-vamp',

    // Beat: Club Standard club drums
    // Repointed from the non-existent 'Hyperpop 2000' to the kit its own grid
    // (house) names. Slice 4 renamed this kit ('909 Modern' -> 'Club Standard');
    // this line moved with it.
    soundKit: 'Club Standard',
    drumFilterCutoff: 14000,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumGridId: 'house',

    // Chords: Upbeat EDM stabs, laser-tight
    chordRhythmId: 'offbeatStabs',
    chordFeel: 0.05, // Laser tight
    chordOctave: 4,
    chordPresetId: 'factory-trance-pluck',

    // Bass: Punchy Square / Offbeat pumping sub
    bassPatternId: 'offbeat-sub',
    bassFeel: 0.05, // Grid locked
    bassOctave: 2,
    bassPresetId: 'bass-punchy-square',

    // Main Synth: Cyber Pluck Lead
    synthPresetId: 'factory-pluck',

    // FX: the riser building into the festival drop.
    fxPresetId: 'factory-noise-riser-fx',

    // Pad: supersaw holding under the trance-pluck stabs.
    pad: { volume: 0.50, presetId: 'factory-neon-poly-saw', mode: 'pad', octave: 3, voicing: 'triad', droneDegree: 0, droneIntervals: [1, 5, 8] },

    effectChainId: 'edm-club-drive',

    // cyber-edm
    random: {
      // The club-minor band. Starts at D#, one step above synthwave, because
      // the Punchy Square carries more sub weight (0.7).
      keys: ['D#', 'E', 'F', 'F#', 'G', 'A'],
      bpm: [126, 130],
      progressions: ['pop-club-house', 'edm-cyber-drop', 'edm-neon-rise', 'edm-arena-sweep', 'edm-cyber-vamp'],
      chordRhythms: ['offbeatStabs', 'fourOnFloor', 'eighthPads'],
      bassPatterns: ['offbeat-sub', 'driving-eighths', 'funk-octaves'],
      // house is now this vibe's authored grid (edm-offbeat-pump was deleted).
      // The rest are the four-on-the-floor family it can move through without
      // stopping being dance music.
      drumGrids: ['house', 'techno', 'techno-rolling', 'dubstep-halftime'],
    },
  },
  {
    id: 'deep-ambient',
    name: 'Deep Ambient',
    tagline: 'Floating ethereal pads, lush reverbs & meditative chords',
    emoji: '🌌',
    bpm: 72,
    meter: '4/4',
    scaleRoot: 'D',
    scaleType: 'Lydian',
    progressionId: 'ambient-lydian-halo',

    // Beat: Acoustic Studio, soft and spacious
    // Repointed from the non-existent 'Minimal Glitch'. Follows its grid
    // (ambient-sparse-drift), which left Warehouse — the shortest decays in
    // the library — for the long crash and tom ambient wants.
    soundKit: 'Acoustic Studio',
    drumFilterCutoff: 4800,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumGridId: 'ambient-sparse-drift',

    // Chords: Celestial Shimmer, very loose and floating
    chordRhythmId: 'sustained',
    chordFeel: 0.88, // Very loose, floating
    chordOctave: 4,
    chordPresetId: 'factory-warm-polypad',

    // Bass: Drone sub, organic long sustain
    bassPatternId: 'whole-note-root',
    bassFeel: 0.85,
    bassOctave: 2,
    bassPresetId: 'bass-deep-sine',

    // Main Synth: Ethereal Bell Pad
    synthPresetId: 'factory-celestial-shimmer',

    // FX: a low cyber drone thickens the floating texture underneath.
    fxPresetId: 'factory-cyber-drone',

    // Pad: a pedal tone under the Lydian progression is the genre's gesture.
    pad: { volume: 0.55, presetId: 'factory-dark-sub-pad', mode: 'drone', octave: 2, voicing: 'triad', droneDegree: 0, droneIntervals: [1, 5, 8] },

    effectChainId: 'ambient-cathedral-wash',

    // deep-ambient
    random: {
      // Avoids C, C# and D# entirely so a multi-bar drone through a 5.8 s
      // reverb tail keeps a pitched fundamental above ~73 Hz.
      keys: ['D', 'E', 'F', 'F#', 'G', 'A'],
      bpm: [62, 80],
      progressions: ['ambient-still-water', 'ambient-lydian-drift', 'ambient-open-fourths', 'ambient-glass-horizon', 'ambient-lydian-halo'],
      chordRhythms: ['sustained', 'arpRollUp', 'arpDownEighths'],
      bassPatterns: ['whole-note-root', 'half-time-legato'],
      // Three sparse grids. dubstep-halftime is one kick and one snare a bar,
      // which is the sparsest thing in the library after ambient-sparse-drift.
      drumGrids: ['ambient-sparse-drift', 'dubstep-halftime', 'zen-bamboo-pulse'],
    },
  },
  {
    id: 'boom-bap',
    name: 'Boom Bap',
    tagline: 'Crisp swing drums, soulful minor keys & groovy bass',
    emoji: '🎙️',
    bpm: 92,
    meter: '4/4',
    scaleRoot: 'E',
    scaleType: 'Dorian',
    progressionId: 'boombap-soul-piano',

    // Beat: Dusty Break / Boom bap swing
    soundKit: 'Dusty Break',
    drumFilterCutoff: 7800,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumGridId: 'boombap-swung-break',

    // Chords: Mellow E-Piano with syncopated push
    chordRhythmId: 'syncopatedPush',
    chordFeel: 0.76, // Loose swing pocket
    chordOctave: 4,
    chordPresetId: 'factory-fm-tine-piano',

    // Bass: Round Pluck walking bassline
    bassPatternId: 'walking-groove',
    bassFeel: 0.72, // Swung walking feel
    bassOctave: 2,
    bassPresetId: 'bass-round-pluck',

    // Main Synth: Mellow E-Piano Solo
    synthPresetId: 'factory-mellow-epiano',

    // FX: the vinyl-crackle riser easing into a turnaround.
    fxPresetId: 'factory-noise-riser-fx',

    effectChainId: 'boombap-dry-room',

    // boom-bap
    random: {
      // Lower half only, so the walking line's upper notes stay under ~200 Hz
      // where the Round Pluck's 420 Hz cutoff still shapes them.
      keys: ['C', 'D', 'D#', 'E', 'F', 'G'],
      bpm: [85, 95],
      // Mirrors afro-six-eight's progressions pool exactly (same 5 entries),
      // by intent — both are Dorian-rooted grooves sharing a candidate list.
      // Diverging is allowed; do it deliberately, to both, not by accident.
      progressions: ['cine-dorian-voyage', 'boombap-dusty-ii-v', 'boombap-crate-dig', 'boombap-head-nod', 'boombap-soul-piano'],
      chordRhythms: ['syncopatedPush', 'lofiSwing', 'funkSyncopation'],
      bassPatterns: ['walking-groove', 'dilla-sub', 'classic-walk'],
      drumGrids: ['boombap-swung-break', 'boom-bap', 'boombap-8th-hat', 'funky-drummer'],
    },
  },
  {
    id: 'zen-garden',
    name: 'Zen Garden',
    tagline: 'Peaceful pentatonic bells, bamboo flute sounds & soothing flow',
    emoji: '🎋',
    bpm: 78,
    meter: '4/4',
    scaleRoot: 'G',
    scaleType: 'Hirajoshi',
    progressionId: 'zen-bamboo-vamp',

    // Beat: Acoustic Studio bamboo acoustic clicks
    soundKit: 'Acoustic Studio',
    drumFilterCutoff: 6500,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumGridId: 'zen-bamboo-pulse',

    // Chords: Glocken Bell & peaceful sustained pads
    // zen-bamboo-vamp resolved in G Hirajoshi: i - IV - i - V, two bars each.
    // Uses only degrees 0, 3 and 4, so every note is inside the five-note
    // scale. Same 8-bar length as the progression this replaces.
    chordRhythmId: 'sustained',
    chordFeel: 0.65, // Peaceful organic breath
    chordOctave: 4,
    chordPresetId: 'factory-koto-pluck',

    // Bass: Warm Triangle drone
    bassPatternId: 'whole-note-root',
    bassFeel: 0.60,
    bassOctave: 2,
    bassPresetId: 'bass-warm-tri',

    // Main Synth: Pentatonic Bell Lead
    synthPresetId: 'factory-glocken-bell',

    // FX: a soft cyber drone standing in for distant temple ambience.
    fxPresetId: 'factory-cyber-drone',

    // Pad: the sustained shō of gagaku, a direct ancestor of drone music.
    pad: { volume: 0.40, presetId: 'factory-warm-polypad', mode: 'drone', octave: 2, voicing: 'triad', droneDegree: 0, droneIntervals: [1, 5, 8] },

    effectChainId: 'zen-temple-air',

    // zen-garden
    random: {
      // Koto-register roots — the instrument is conventionally tuned from
      // around D. Avoids the chromatic extremes where the Glocken Bell
      // partials either muddy or thin out.
      keys: ['D', 'E', 'F#', 'G', 'A'],
      // The one unsourced range: no production guide gave a tempo band for the
      // genre, so it is the authored 78 +/- 6.
      bpm: [70, 84],
      progressions: ['zen-bamboo-vamp', 'zen-moonlit-koto', 'zen-still-pond', 'zen-temple-bell'],
      chordRhythms: ['sustained', 'arpRollUp', 'arpDownEighths'],
      bassPatterns: ['whole-note-root', 'half-time-legato'],
      drumGrids: ['zen-bamboo-pulse', 'ambient-sparse-drift', 'dubstep-halftime'],
    },
  },
  {
    id: 'lofi-waltz',
    name: 'Lo-Fi Waltz',
    tagline: 'Dusty three-four turns with jazz keys and a brushed kit',
    emoji: '🎠',
    bpm: 96,
    meter: '3/4',
    scaleRoot: 'F',
    scaleType: 'Major',
    progressionId: 'lofi-rainy-window',

    // Beat: brushed three-four, one kick per bar
    soundKit: 'Lo-Fi Vinyl',
    drumFilterCutoff: 6800,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumGridId: 'waltz-brush-three',

    // Chords: FM tines comping the literal oom-pah-pah
    chordRhythmId: 'waltzOompah',
    chordFeel: 0.72, // Loose, brushed
    chordOctave: 4,
    chordPresetId: 'factory-mellow-epiano',

    // Bass: rising root-5th-octave, one note per beat
    bassPatternId: 'waltz-root-fifth',
    bassFeel: 0.68,
    bassOctave: 2,
    bassPresetId: 'bass-warm-tri',

    // Main Synth: FM tine piano
    synthPresetId: 'factory-fm-tine-piano',

    // FX: the same tape-hiss riser as lofi-chill, its sibling vibe.
    fxPresetId: 'factory-noise-riser-fx',

    // Pad: same treatment as lofi-chill.
    pad: { volume: 0.30, presetId: 'factory-warm-polypad', mode: 'pad', octave: 3, voicing: 'open5', droneDegree: 0, droneIntervals: [1, 5, 8] },

    effectChainId: 'lofi-tape-room',

    // lofi-waltz
    random: {
      keys: ['C', 'D', 'F', 'G', 'A'],
      bpm: [88, 104],
      // Mirrors lofi-chill's progressions pool exactly (same 7 entries), by
      // intent — both are jazz/lo-fi vibes drawing on the same songbook.
      // Diverging is allowed; do it deliberately, to both, not by accident.
      progressions: ['jazz-ii-v-i-vi', 'jazz-neosoul-butter', 'lofi-coffeehouse', 'lofi-bedroom-pop', 'lofi-rainy-window', 'lofi-tape-loop', 'lofi-morning-turnaround'],
      chordRhythms: ['waltzOompah', 'jazzWaltzComp', 'waltzArpRoll'],
      bassPatterns: ['waltz-root-fifth', 'waltz-walking-three'],
      // Three twelve-step grids plus ONE cross-meter member. lofi-ghost-kick is
      // 4/4 and adaptStepRow trims it to this vibe's 12 steps — measured, it
      // lands as kick 0,8 / snare 4 / hihat 0,2,4,6,8,10, which is a real 3/4
      // lo-fi bar rather than a fragment.
      drumGrids: ['waltz-brush-three', 'waltz', 'afro-6-8', 'lofi-ghost-kick'],
    },
  },
  {
    id: 'afro-six-eight',
    name: 'Afro 6/8',
    tagline: 'Compound bell groove, modal Dorian vamp, two beats to the bar',
    emoji: '🪘',
    bpm: 132,
    meter: '6/8',
    scaleRoot: 'D',
    scaleType: 'Dorian',
    progressionId: 'cine-dorian-voyage',

    // Beat: two dotted-quarter beats, snare pushing off the last eighth of each
    soundKit: 'Acoustic Studio',
    drumFilterCutoff: 9000,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumGridId: 'afro-six-eight-bell',

    // Chords: tines on the one-bar 6/8 bell cell
    chordRhythmId: 'afroBellComp',
    chordFeel: 0.55,
    chordOctave: 4,
    chordPresetId: 'factory-fm-tine-piano',

    // Bass: both beats plus the octave push on the last eighth of beat two
    bassPatternId: 'afro-six-eight-tumbao',
    bassFeel: 0.5,
    bassOctave: 2,
    bassPresetId: 'bass-round-pluck',

    // Main Synth: bell lead, the voice the groove is named for
    synthPresetId: 'factory-glocken-bell',

    // FX: a low cyber drone under the bell groove, the same texture as
    // zen-garden's bell lead.
    fxPresetId: 'factory-cyber-drone',

    effectChainId: 'boombap-dry-room',

    // afro-six-eight
    random: {
      keys: ['C', 'D', 'E', 'F', 'G'],
      bpm: [126, 138],
      // Mirrors boom-bap's progressions pool exactly (same 5 entries), by
      // intent — both are Dorian-rooted grooves sharing a candidate list.
      // Diverging is allowed; do it deliberately, to both, not by accident.
      progressions: ['cine-dorian-voyage', 'boombap-dusty-ii-v', 'boombap-crate-dig', 'boombap-head-nod', 'boombap-soul-piano'],
      chordRhythms: ['afroBellComp', 'compoundEighthPads', 'sixEightBallad'],
      bassPatterns: ['afro-six-eight-tumbao', 'six-eight-root-pulse'],
      // Three twelve-step grids plus ONE cross-meter member. reggae-rockers is
      // 4/4 and trims to kick 0,4,8 / snare 8 / hihat 0,2,4,6,8,10 in this
      // vibe's 12 steps; its openhat 14 trims away entirely. Measured, not
      // assumed — trim takes the FIRST 12 steps.
      drumGrids: ['afro-six-eight-bell', 'afro-6-8', 'waltz', 'reggae-rockers'],
    },
  },
];
