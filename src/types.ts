
export type ViewMode =
  | 'arrange'
  | 'synth'
  | 'sequencer'
  | 'chords'
  | 'effects';

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

/**
 * The pad layer's two articulations. `pad` follows the chords; `drone` does not.
 *
 * The const array is the source of truth and the union derives from it, like
 * PAD_INTERVALS below: sanitize builds its validation Set from this array, so a
 * mode added here is accepted by `asPadMode` in the same edit. Hand-written
 * Sets have no such link — a value the UI offers and the store holds would come
 * back reverted on every reopen, with no type error and no failing build.
 */
export const PAD_MODES = ['pad', 'drone'] as const;
export type PadMode = (typeof PAD_MODES)[number];

/** How a chord is reduced before the pad plays it. Dormant in drone mode. */
export const PAD_VOICINGS = ['triad', 'open5', 'root'] as const;
export type PadVoicing = (typeof PAD_VOICINGS)[number];

/**
 * Intervals a drone may stack over its degree's root, in scale-degree-free
 * interval numbers: 1 = unison, 4 = perfect fourth, 5 = perfect fifth,
 * 8 = octave, 12 = perfect twelfth (an octave plus a fifth, 19 semitones).
 *
 * A literal union, not an enum: this file must keep importing nothing but the
 * leaf `utils/meter`, and these values are persisted verbatim in `.solna`
 * bodies, so the numbers are the contract.
 */
export type PadInterval = 1 | 4 | 5 | 8 | 12;

/** Render order for the interval toggles, and the validation set for sanitize. */
export const PAD_INTERVALS: readonly PadInterval[] = [1, 4, 5, 8, 12];

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

