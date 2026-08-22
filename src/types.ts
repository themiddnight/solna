export type ViewMode = 
  | 'synth'
  | 'sequencer'
  | 'chords'
  | 'effects';

export interface SynthParams {
  oscType: 'sawtooth' | 'square' | 'sine' | 'triangle';
  subOscVolume: number;
  noiseVolume: number;
  detune: number;
  filterType: 'lowpass' | 'highpass' | 'bandpass';
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
  portamento?: number;
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
  solo?: boolean;
  steps: boolean[];
  velocities?: number[];
}

export interface ChordItem {
  id: string;
  root: string;
  quality: string;
  bars: number;
  notes: string[];
  bassNote?: string | null; // bass override note name ('E4'); null/absent = auto root
}

export interface MasterEffects {
  reverbWet: number;
  reverbDecay: number;
  delayWet: number;
  delayTime: string;
  delayFeedback: number;
  distortionDrive?: number;
  distortionWet: number;
  chorusRate?: number;
  chorusDepth?: number;
  chorusWet?: number;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  compressorThreshold: number;
  compressorRatio?: number;
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
