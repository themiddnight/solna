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
