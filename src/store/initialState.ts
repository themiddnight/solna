import type { SynthParams, SequencerTrack, ChordItem, MasterEffects } from '../types';

// Moved verbatim from src/App.tsx — the app's original useState initial values.

export const INITIAL_SYNTH_PARAMS: SynthParams = {
  oscType: 'sawtooth',
  subOscVolume: 0.3,
  noiseVolume: 0.02,
  detune: 6,
  filterType: 'lowpass',
  filterCutoff: 2400,
  filterResonance: 3.0,
  filterEnvAmount: 1200,
  attack: 0.02,
  decay: 0.4,
  sustain: 0.6,
  release: 0.5,
  filterAttack: 0.02,
  filterDecay: 0.4,
  filterSustain: 0,
  filterRelease: 0.5,
  lfoRate: 3.5,
  lfoDepth: 0.2,
  lfoTarget: 'cutoff',
  octave: 0,
  arpActive: false,
  arpMode: 'up',
  arpRate: '16n',
  arpOctaves: 1,
  preset: 'Cosmic Lead',
};

export const INITIAL_SEQUENCER_TRACKS: SequencerTrack[] = [
  {
    id: 'track-kick',
    name: 'Kick 808',
    instrument: 'kick',
    steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.9,
    muted: false,
    color: 'bg-error',
  },
  {
    id: 'track-snare',
    name: 'Snare Snap',
    instrument: 'snare',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.85,
    muted: false,
    color: 'bg-warning',
  },
  {
    id: 'track-hihat',
    name: 'Closed Hat',
    instrument: 'hihat',
    steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, false, false, false, false, false, false, false, false],
    volume: 0.75,
    muted: false,
    color: 'bg-success',
  },
  {
    id: 'track-openhat',
    name: 'Open Hat',
    instrument: 'openhat',
    steps: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.8,
    muted: false,
    color: 'bg-accent',
  },
  {
    id: 'track-clap',
    name: 'Hand Clap',
    instrument: 'clap',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: 0.85,
    muted: false,
    color: 'bg-secondary',
  },
];

export const INITIAL_CHORDS: ChordItem[] = [
  { id: 'chord-1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] },
  { id: 'chord-2', root: 'F', quality: 'maj7', bars: 1, notes: ['F3', 'A3', 'C4', 'E4'] },
  { id: 'chord-3', root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] },
  { id: 'chord-4', root: 'G', quality: '7', bars: 1, notes: ['G3', 'B3', 'D4', 'F4'] },
];

// The ONLY source of truth for the audible effect defaults. setupMasterChain()
// seeds every wet send and EQ gain at zero; these values reach the graph via
// applyEngineSnapshot() on the first user click and are clamped through
// audio/effectLimits.ts on the way in.
//
// NOTE: reverbDecay (2.0) and compressorThreshold (-12) deliberately equal the
// engine's setupMasterChain hardcodes so the default sound is unchanged now
// that these knobs are live (Task 14). Persisted values from older sessions
// take effect and are clamped in sanitizePersistedState.
export const INITIAL_EFFECTS: MasterEffects = {
  reverbWet: 0.25,
  reverbDecay: 2.0,
  delayWet: 0.2,
  delayFeedback: 0.35,
  distortionWet: 0.1,
  eqLow: 2,
  eqMid: 0,
  eqHigh: 3,
  compressorThreshold: -12,
};
