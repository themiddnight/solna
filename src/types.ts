import type { MeterId } from './utils/meter';

/**
 * The six Instant Vibe genres. Declared here rather than in
 * audio/data/chordProgressions.ts (which re-exports it) because
 * `VibeVariation` in this file needs it while chordProgressions.ts already
 * imports `ChordItem` from here — declaring it there would make the two files
 * import each other. This file imports only the leaf module `utils/meter` and
 * must stay acyclic.
 */
export type VibeGenre = 'lofi' | 'synthwave' | 'edm' | 'ambient' | 'boombap' | 'zen';

export type ViewMode =
  | 'arrange'
  | 'synth'
  | 'sequencer'
  | 'chords'
  | 'effects'
  | 'arrange';

export type Layer = 'loop' | 'song';

export const LOOP_TABS: readonly ViewMode[] = ['synth', 'sequencer', 'chords'];
export const SONG_TABS: readonly ViewMode[] = ['arrange', 'effects'];

export function isSongLayer(tab: ViewMode): boolean {
  return tab === 'arrange' || tab === 'effects';
}

export function layerForTab(tab: ViewMode): Layer {
  return isSongLayer(tab) ? 'song' : 'loop';
}

export type ArrangementTrackType = 'chords' | 'drums' | 'bass' | 'lead';

export interface LeadNote {
  note: string;
  step: number; // 0-based step within the region
  durationSteps: number; // in 16th steps
  velocity?: number;
}

export interface ArrangementRegionData {
  // Chords data
  chords?: ChordItem[];
  chordRhythmId?: string;
  chordFeel?: number;
  chordOctave?: number;
  chordPresetId?: string;
  // Drums data
  drumPattern?: Record<string, boolean[]>;
  soundKit?: string;
  // Bass data
  bassPatternId?: string;
  bassFeel?: number;
  bassOctave?: number;
  bassPresetId?: string;
  // Lead / Synth data
  synthParams?: SynthParams;
  leadNotes?: LeadNote[];
}

export interface ArrangementRegion {
  id: string;
  trackType: ArrangementTrackType;
  name: string;
  startBar: number; // 0-based bar index
  lengthBars: number; // in bars (e.g. 2, 4, 8)
  color?: string; // semantic tag e.g. 'primary' | 'secondary' | 'accent' | 'warning' | 'info' | 'success'
  data: ArrangementRegionData;
}

export interface SongArrangement {
  totalBars: number;
  loopEnabled: boolean;
  loopStartBar: number;
  loopEndBar: number;
  regions: ArrangementRegion[];
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** The synth keyboard's input mode: how key presses are mapped to notes. */
export type KeyboardMode = 'chromatic' | 'scale-locked' | 'chord';

/** The bottom input dock's active surface. */
export type InputPanelMode = 'keyboard' | 'drums';

/**
 * Arpeggiator order and rate. Declared here rather than in audio/arpeggiator.ts
 * and audio/arpSchedule.ts because SynthParams needs them and this file imports
 * only the leaf module `utils/meter` and must stay acyclic. Both audio modules
 * re-export them, so their existing import paths keep working — the point is
 * that there is one definition instead of an inline copy here and a named
 * copy there that could drift.
 */
export type ArpMode = 'up' | 'down' | 'updown' | 'random';
export type ArpRate = '4n' | '8n' | '16n' | '32n';

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
  // Required, not optional: INITIAL_SYNTH_PARAMS always sets all four and
  // sanitizeSynthParams always restores them, so the `?? 'up'` / `?? '16n'` /
  // `?? 1` / `?? false` that used to sit at 13 read sites were dead defaults
  // hiding the real contract.
  arpActive: boolean;
  arpMode: ArpMode;
  arpRate: ArpRate;
  arpOctaves: number;
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
  distortionWet: number;
  distortionBypass?: boolean;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  eqBypass?: boolean;
  compressorThreshold: number;
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
  /**
   * The time signature this vibe is written in. Applying the vibe sets the
   * transport meter to it, so the vibe always resolves patterns of the right
   * meter. All six current vibes are 4/4; authoring non-4/4 vibes is Stage 2.
   */
  meter: MeterId;
  scaleRoot: string;
  scaleType: string;

  // Beat & Drum Kit
  soundKit: string;
  drumPattern: Record<string, number[]>;
  /**
   * Library reference into VIBE_DRUM_PATTERNS naming the authored base
   * pattern. Unlike `progressionId`, a reroll does NOT repoint this: the dice
   * decorates the authored pattern in place, overwriting only `drumPattern`'s
   * `hihat`/`openhat`/`tom`/`crash` rows (see `rollDecoration` in
   * store/vibeVariation.ts), so `drumPatternId` and `drumPattern` can
   * legitimately disagree after a reroll.
   */
  drumPatternId: string;
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
  /** Library reference into ALL_FACTORY_PRESETS for the comp voice. */
  chordPresetId: string;

  // Bass
  bassPatternId: string;
  bassFeel: number; // 0.0 (tight) to 1.0 (loose/swung)
  bassOctave: number;
  /** Library reference into ALL_FACTORY_PRESETS; must resolve to category 'Bass'. */
  bassPresetId: string;

  // Lead / Melody Synthesizer (preset reference only — arp is the user's, not the vibe's)
  /** Library reference into ALL_FACTORY_PRESETS for the lead voice. */
  synthPresetId: string;

  // Master Effects
  effects: Partial<MasterEffects>;
  /** Library reference into VIBE_EFFECT_CHAINS. `effects` is its resolved output. */
  effectChainId: string;

  /**
   * Vibe Variation rule for the dice button. Optional, so a vibe without one
   * simply has no dice — but all six ship one, which an invariant test pins.
   */
  variation?: VibeVariation;
}
