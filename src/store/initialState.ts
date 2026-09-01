import type { SynthParams, SequencerTrack, ChordItem, MasterEffects, SongArrangement } from '../types';

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
// that these knobs are live. Persisted values from older sessions take
// effect and are clamped in sanitizePersistedState.
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

export const INITIAL_ARRANGEMENT: SongArrangement = {
  totalBars: 16,
  loopEnabled: true,
  loopStartBar: 0,
  loopEndBar: 16,
  regions: [
    // Chords Track
    {
      id: 'reg-chord-intro',
      trackType: 'chords',
      name: 'Intro Chords',
      startBar: 0,
      lengthBars: 4,
      color: 'primary',
      data: {
        chords: INITIAL_CHORDS,
        chordRhythmId: 'sustained',
        chordFeel: 0.1,
        chordOctave: 0,
      },
    },
    {
      id: 'reg-chord-verse',
      trackType: 'chords',
      name: 'Verse Chords',
      startBar: 4,
      lengthBars: 4,
      color: 'primary',
      data: {
        chords: INITIAL_CHORDS,
        chordRhythmId: 'lofi-rhodes-push',
        chordFeel: 0.3,
        chordOctave: 0,
      },
    },
    {
      id: 'reg-chord-chorus',
      trackType: 'chords',
      name: 'Chorus Chords',
      startBar: 8,
      lengthBars: 4,
      color: 'primary',
      data: {
        chords: INITIAL_CHORDS,
        chordRhythmId: 'syncopated-groove',
        chordFeel: 0.4,
        chordOctave: 0,
      },
    },
    {
      id: 'reg-chord-outro',
      trackType: 'chords',
      name: 'Outro Chords',
      startBar: 12,
      lengthBars: 4,
      color: 'primary',
      data: {
        chords: INITIAL_CHORDS,
        chordRhythmId: 'sustained',
        chordFeel: 0.1,
        chordOctave: 0,
      },
    },

    // Bass Track
    {
      id: 'reg-bass-verse',
      trackType: 'bass',
      name: 'Verse Bass',
      startBar: 4,
      lengthBars: 4,
      color: 'accent',
      data: {
        bassPatternId: 'root-and-octave-pump',
        bassFeel: 0.3,
        bassOctave: 0,
      },
    },
    {
      id: 'reg-bass-chorus',
      trackType: 'bass',
      name: 'Driving Bass',
      startBar: 8,
      lengthBars: 4,
      color: 'accent',
      data: {
        bassPatternId: 'funky-sixteenths',
        bassFeel: 0.4,
        bassOctave: 0,
      },
    },
    {
      id: 'reg-bass-outro',
      trackType: 'bass',
      name: 'Outro Sub',
      startBar: 12,
      lengthBars: 4,
      color: 'accent',
      data: {
        bassPatternId: 'whole-note-root',
        bassFeel: 0.1,
        bassOctave: 0,
      },
    },

    // Drums Track
    {
      id: 'reg-drum-verse',
      trackType: 'drums',
      name: 'Verse Beat',
      startBar: 4,
      lengthBars: 4,
      color: 'warning',
      data: {
        soundKit: 'Retro Drive',
        drumPattern: {
          kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
          snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
          hihat: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
          openhat: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
          clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        },
      },
    },
    {
      id: 'reg-drum-chorus',
      trackType: 'drums',
      name: 'Chorus Beat',
      startBar: 8,
      lengthBars: 4,
      color: 'warning',
      data: {
        soundKit: 'Retro Drive',
        drumPattern: {
          kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
          snare: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
          hihat: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
          openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
          clap: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        },
      },
    },

    // Lead Track
    {
      id: 'reg-lead-chorus',
      trackType: 'lead',
      name: 'Chorus Hook',
      startBar: 8,
      lengthBars: 4,
      color: 'secondary',
      data: {
        leadNotes: [
          { note: 'E4', step: 0, durationSteps: 3, velocity: 0.85 },
          { note: 'G4', step: 4, durationSteps: 3, velocity: 0.85 },
          { note: 'A4', step: 8, durationSteps: 6, velocity: 0.9 },
          { note: 'C5', step: 16, durationSteps: 3, velocity: 0.85 },
          { note: 'D5', step: 20, durationSteps: 3, velocity: 0.85 },
          { note: 'E5', step: 24, durationSteps: 6, velocity: 0.95 },
          { note: 'D5', step: 32, durationSteps: 3, velocity: 0.8 },
          { note: 'C5', step: 36, durationSteps: 3, velocity: 0.8 },
          { note: 'A4', step: 40, durationSteps: 6, velocity: 0.85 },
          { note: 'G4', step: 48, durationSteps: 3, velocity: 0.8 },
          { note: 'E4', step: 52, durationSteps: 3, velocity: 0.8 },
          { note: 'A4', step: 56, durationSteps: 8, velocity: 0.9 },
        ],
      },
    },
  ],
};
