/**
 * The six Instant Vibe genres. Declared here rather than in
 * audio/data/chordProgressions.ts (which re-exports it) because
 * `VibeVariation` in this file needs it while chordProgressions.ts already
 * imports `ChordItem` from here — declaring it there would make the two files
 * import each other. This file imports nothing and must stay a leaf.
 */
export type VibeGenre = 'lofi' | 'synthwave' | 'edm' | 'ambient' | 'boombap' | 'zen';

export type ViewMode =
  | 'synth'
  | 'sequencer'
  | 'chords'
  | 'effects';

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export interface SynthParams {
  oscType: 'sawtooth' | 'square' | 'sine' | 'triangle';
  subOscVolume: number;
  noiseVolume: number;
  detune: number;
  filterType: FilterType;
  filterCutoff: number;
  filterResonance: number;
  filterEnvAmount: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterAttack: number;
  filterDecay: number;
  filterSustain: number;
  filterRelease: number;
  lfoRate: number;
  lfoDepth: number;
  lfoTarget: 'cutoff' | 'pitch' | 'volume';
  octave: number;
  arpActive?: boolean;
  arpMode?: 'up' | 'down' | 'updown' | 'random';
  arpRate?: '4n' | '8n' | '16n' | '32n';
  arpOctaves?: number;
  preset: string;
}

export interface DrumPad {
  id: string;
  name: string;
  note: string;
  color: string;
  shortcut: string;
  volume: number;
  pitch: number;
  decay: number;
}

export interface SequencerTrack {
  id: string;
  name: string;
  instrument: string;
  color: string;
  volume: number;
  muted: boolean;
  steps: boolean[];
}

export interface ChordItem {
  id: string;
  root: string;
  quality: string;
  bars: number;
  notes: string[];
  bassNote?: string | null; // bass override note name ('E4'); null/absent = auto root
}

export interface CustomChordProgressionItem {
  id: string;
  name: string;
  category: string;
  description: string;
  roman: string;
  chords: ChordItem[];
  createdAt: number;
}

export interface MasterEffects {
  reverbWet: number;
  reverbDecay: number;
  reverbBypass?: boolean;
  delayWet: number;
  delayFeedback: number;
  delayBypass?: boolean;
  delayTime?: string | number;
  chorusWet?: number;
  chorusRate?: number;
  chorusDepth?: number;
  distortionWet: number;
  distortionBypass?: boolean;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  eqBypass?: boolean;
  compressorThreshold: number;
}



export interface ProjectState {
  id: string;
  title: string;
  bpm: number;
  scaleRoot: string;
  scaleType: string;
  synthParams?: SynthParams;
  sequencerTracks: SequencerTrack[];
  chords: ChordItem[];
  effects: MasterEffects;
  masterVolume?: number;
}

/**
 * Drum layers the Vibe Variation dice may rewrite. `kick`, `snare` and `clap`
 * are the genre's skeleton and are deliberately not assignable here, so no
 * draw can move the pulse or the backbeat.
 */
export type DecorationLayer = 'hihat' | 'openhat' | 'tom' | 'crash';

/** A named row in DRUM_DENSITIES. Named, not generated: the UI reports it. */
export type DensityName =
  | 'off' | 'downbeat' | 'halves' | 'backbeat' | 'quarters'
  | 'offbeat8ths' | 'and2and4' | 'eighths' | 'swung16ths' | 'lofi16ths'
  | 'sixteenths' | 'pickup' | 'lateFill' | 'fillTail' | 'midBar';

export interface DrumDecorationRule {
  /**
   * Layers the dice may rewrite. Authoritative: a layer absent here is never
   * rewritten even if `densities` has an entry for it. `kick`, `snare` and
   * `clap` are not assignable to DecorationLayer, so they can never be listed.
   */
  layers: DecorationLayer[];
  /**
   * Named density choices the dice picks between, per layer. Must contain an
   * entry for every layer in `layers` and no others — which is why this is
   * Partial: the total form would demand an entry for a layer the vibe
   * deliberately leaves out. The exact-match half is an invariant test.
   */
  densities: Partial<Record<DecorationLayer, DensityName[]>>;
}

export interface VibeVariation {
  /** Which progressions in CHORD_PROGRESSIONS this vibe may draw. */
  genre: VibeGenre;
  /** Roots that suit the genre. The dice picks one. Always contains the vibe's own. */
  keyPool: string[];
  /** Inclusive [min, max] integer BPM. Always contains the vibe's own. */
  bpmRange: [number, number];
  /** Ids into CHORD_PROGRESSIONS. */
  progressionIds: string[];
  /** Ids into RHYTHM_PATTERNS. Always contains the vibe's own chordRhythmId. */
  rhythmIds: string[];
  /** Ids into BASS_PATTERNS. Always contains the vibe's own bassPatternId. */
  bassPatternIds: string[];
  drumDecoration: DrumDecorationRule;
}

export interface InstantVibe {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  bpm: number;
  scaleRoot: string;
  scaleType: string;
  projectTitle: string;

  // Beat & Drum Kit
  soundKit: string;
  drumPattern: Record<string, number[]>;
  drumFilterCutoff?: number;
  drumFilterResonance?: number;
  drumFilterType?: FilterType;

  // Chords
  chords: ChordItem[];
  /** Library reference into CHORD_PROGRESSIONS. `chords` is its resolved output. */
  progressionId: string;
  chordRhythmId: string;
  chordFeel: number; // 0.0 (tight) to 1.0 (loose/swung)
  chordOctave: number;
  chordPresetName: string;
  chordSynthParams?: Partial<SynthParams>;

  // Bass
  bassPatternId: string;
  bassFeel: number; // 0.0 (tight) to 1.0 (loose/swung)
  bassOctave: number;
  bassPresetName: string;
  bassSynthParams?: Partial<SynthParams>;

  // Lead / Melody Synthesizer (with Arpeggiator setup)
  synthPresetName: string;
  synthParams?: Partial<SynthParams>;

  // Master Effects
  effects: Partial<MasterEffects>;

  /**
   * Vibe Variation rule for the dice button. Optional, so a vibe without one
   * simply has no dice — but all six ship one, which an invariant test pins.
   */
  variation?: VibeVariation;
}
