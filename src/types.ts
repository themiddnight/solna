export type ViewMode = 
  | 'perform'
  | 'synth'
  | 'drums'
  | 'sequencer'
  | 'arrange'
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

export type InstrumentType =
  | 'synth'
  | 'lead'
  | 'bass'
  | 'pad'
  | 'pluck'
  | 'piano'
  | 'drums'
  | 'chords'
  | 'audio';

export interface RegionNote {
  id: string;
  note: string; // e.g. "C4", "D#4", "G4"
  startStep: number; // in 16th steps within the region (0 to durationBeats * 4 - 1)
  durationSteps: number; // in 16th steps (e.g. 1 = 16th note, 2 = 8th, 4 = quarter)
  velocity?: number; // 0 to 1
}

export interface ArrangeRegion {
  id: string;
  name: string;
  startBeat: number; // in beats (4 beats = 1 bar)
  durationBeats: number; // in beats (e.g. 16 beats = 4 bars)
  color?: string;
  notes?: RegionNote[];
}

export interface ArrangeTrack {
  id: string;
  name: string;
  color: string;
  type: InstrumentType;
  synthParams?: SynthParams; // Custom sound design per track
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  regions: ArrangeRegion[];
}

export interface ChordItem {
  id: string;
  root: string;
  quality: string;
  bars: number;
  notes: string[];
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

export interface RoomUser {
  id: string;
  name: string;
  instrument: string;
  isHost: boolean;
  role?: string;
  isSpeaking?: boolean;
}

export interface ProjectState {
  id: string;
  title: string;
  bpm: number;
  scaleRoot: string;
  scaleType: string;
  timeSignature?: string;
  synthParams?: SynthParams;
  synth?: SynthParams;
  sequencerTracks: SequencerTrack[];
  arrangeTracks: ArrangeTrack[];
  chords: ChordItem[];
  effects: MasterEffects;
  masterVolume?: number;
}
