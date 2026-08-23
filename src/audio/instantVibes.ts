import { SynthParams, MasterEffects, ChordItem, FilterType } from '../types';
import { useAppStore } from '../store/store';
import { deriveChordNotes } from '../utils/musicTheory';
import { audioEngine } from './engine';
import { INITIAL_SYNTH_PARAMS } from '../store/initialState';

export interface InstantVibe {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  color: string;
  bgGradient: string;
  borderColor: string;
  textColor: string;
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
}

function makeVibeChord(id: string, root: string, quality: string, bars = 1, octave = 4): ChordItem {
  return deriveChordNotes({ id, root, quality, bars, notes: [] }, octave);
}

function buildSynthParams(presetName: string, overrides?: Partial<SynthParams>): SynthParams {
  return {
    ...INITIAL_SYNTH_PARAMS,
    ...overrides,
    preset: presetName,
  };
}

export function applyInstantVibeToStore(vibe: InstantVibe) {
  const store = useAppStore.getState();

  // 1. Context & BPM
  store.setBpm(vibe.bpm);
  store.setScaleRoot(vibe.scaleRoot);
  store.setScaleType(vibe.scaleType);
  store.setProjectTitle(vibe.projectTitle);

  // 2. Drums & Sequencer (Pattern + Sound Kit + Drum Filter)
  store.setSoundKit(vibe.soundKit);
  const boolPattern: Record<string, boolean[]> = {};
  for (const [k, arr] of Object.entries(vibe.drumPattern)) {
    boolPattern[k] = arr.map((val) => val === 1);
  }
  store.applyDrumPattern(boolPattern);

  if (vibe.drumFilterCutoff !== undefined) {
    store.setDrumFilterCutoff(vibe.drumFilterCutoff);
  }
  if (vibe.drumFilterResonance !== undefined) {
    store.setDrumFilterResonance(vibe.drumFilterResonance);
  }
  if (vibe.drumFilterType !== undefined) {
    store.setDrumFilterType(vibe.drumFilterType);
  }

  // 3. Chords & Rhythm Pattern & Feel (Tight/Loose) & Sound Preset
  store.setChords(vibe.chords);
  store.setChordRhythmId(vibe.chordRhythmId);
  store.setChordFeel(vibe.chordFeel);
  store.setChordOctave(vibe.chordOctave);

  const finalChordSynthParams = buildSynthParams(vibe.chordPresetName, vibe.chordSynthParams);
  store.setChordSynthParams(finalChordSynthParams);

  // 4. Bass Pattern & Feel (Tight/Loose) & Sound Preset
  store.setBassPatternId(vibe.bassPatternId);
  store.setBassFeel(vibe.bassFeel);
  store.setBassOctave(vibe.bassOctave);

  const finalBassSynthParams = buildSynthParams(vibe.bassPresetName, vibe.bassSynthParams);
  store.setBassSynthParams(finalBassSynthParams);

  // 5. Main Synth Sound Preset & Arpeggiator
  const finalSynthParams = buildSynthParams(vibe.synthPresetName, vibe.synthParams);
  store.setSynthParams(finalSynthParams);

  // 6. Master Effects
  store.setEffects({
    ...store.effects,
    ...vibe.effects,
  });

  // 7. Audio Engine initialization & clock sync (in browser environment)
  if (typeof window !== 'undefined') {
    audioEngine.init();
    audioEngine.setClockBpm(vibe.bpm);
    audioEngine.updateSynthParams(finalSynthParams, 'synth');
    audioEngine.updateSynthParams(finalChordSynthParams, 'chord');
    audioEngine.updateSynthParams(finalBassSynthParams, 'bass');
    if (vibe.drumFilterCutoff !== undefined) {
      audioEngine.setDrumFilter(
        vibe.drumFilterCutoff,
        vibe.drumFilterResonance ?? 1.0,
        vibe.drumFilterType ?? 'lowpass'
      );
    }
  }
}

export const INSTANT_VIBES: InstantVibe[] = [
  {
    id: 'lofi-chill',
    name: 'Lo-Fi Chill',
    tagline: 'Warm dusty beats & relaxing jazz chords',
    emoji: '☕',
    color: '#F59E0B',
    bgGradient: 'from-amber-950/40 via-stone-900/40 to-amber-950/20',
    borderColor: 'border-amber-500/40',
    textColor: 'text-amber-300',
    bpm: 84,
    scaleRoot: 'C',
    scaleType: 'Major',
    projectTitle: 'Lo-Fi Midnight Coffee',

    // Beat: 808 Vintage with warm lowpass filter
    soundKit: '808 Vintage',
    drumFilterCutoff: 6200,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPattern: {
      Kick:  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      Snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      HiHat: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
      OpenHat: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      Clap:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      Tom:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
      Crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },

    // Chords: Dream Keys, relaxed swung feel
    chords: [
      makeVibeChord('c1', 'C', 'maj7', 1, 4),
      makeVibeChord('c2', 'A', 'min7', 1, 4),
      makeVibeChord('c3', 'D', 'min7', 1, 4),
      makeVibeChord('c4', 'G', '7', 1, 4),
    ],
    chordRhythmId: 'lofiSwing',
    chordFeel: 0.78, // Loose swing
    chordOctave: 4,
    chordPresetName: 'Dream Keys',
    chordSynthParams: {
      oscType: 'sine',
      subOscVolume: 0.2,
      noiseVolume: 0.03,
      detune: 8,
      filterType: 'lowpass',
      filterCutoff: 2200,
      filterResonance: 1.2,
      filterEnvAmount: 400,
      attack: 0.04,
      decay: 0.8,
      sustain: 0.6,
      release: 0.7,
      lfoDepth: 0.15,
      lfoRate: 1.5,
      lfoTarget: 'pitch',
      arpActive: false,
    },

    // Bass: Deep sub with Dilla loose swing
    bassPatternId: 'dilla-sub',
    bassFeel: 0.75, // Loose pocket
    bassOctave: 2,
    bassPresetName: 'Deep Sine Sub',
    bassSynthParams: {
      oscType: 'sine',
      subOscVolume: 0.9,
      noiseVolume: 0,
      detune: 0,
      filterType: 'lowpass',
      filterCutoff: 260,
      filterResonance: 1.1,
      attack: 0.01,
      decay: 0.35,
      sustain: 0.85,
      release: 0.6,
    },

    // Main Synth: Warm Keys / Whistle
    synthPresetName: 'Dream Keys',
    synthParams: {
      oscType: 'sine',
      subOscVolume: 0.15,
      filterCutoff: 2600,
      filterResonance: 1.3,
      attack: 0.05,
      decay: 0.8,
      sustain: 0.6,
      release: 0.7,
      detune: 8,
      lfoDepth: 0.18,
      lfoRate: 2.0,
      arpActive: false,
    },

    effects: {
      reverbWet: 0.35,
      reverbDecay: 2.4,
      delayWet: 0.22,
      delayTime: '8n',
      delayFeedback: 0.28,
      chorusWet: 0.35,
      chorusRate: 1.2,
      chorusDepth: 0.4,
      compressorThreshold: -18,
      eqLow: 3,
      eqMid: 1,
      eqHigh: -2,
    },
  },
  {
    id: 'synthwave-80s',
    name: 'Synthwave 80s',
    tagline: 'Neon night driving with retro analog synth & pumping bass',
    emoji: '🏎️',
    color: '#EC4899',
    bgGradient: 'from-pink-950/40 via-purple-950/40 to-cyan-950/20',
    borderColor: 'border-pink-500/40',
    textColor: 'text-pink-300',
    bpm: 118,
    scaleRoot: 'A',
    scaleType: 'Natural Minor',
    projectTitle: 'Neon Highway 1984',

    // Beat: Retro Drive, tight 80s gate
    soundKit: 'Retro Drive',
    drumFilterCutoff: 12000,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPattern: {
      Kick:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      Snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      HiHat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      OpenHat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      Clap:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      Tom:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
      Crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },

    // Chords: Neon Polysynth, grid-tight 8th pads
    chords: [
      makeVibeChord('sw1', 'A', 'min', 1, 4),
      makeVibeChord('sw2', 'F', 'maj', 1, 4),
      makeVibeChord('sw3', 'C', 'maj', 1, 4),
      makeVibeChord('sw4', 'G', 'maj', 1, 4),
    ],
    chordRhythmId: 'eighthPads',
    chordFeel: 0.12, // Strict tight sequencer grid
    chordOctave: 4,
    chordPresetName: 'Neon Pluck',
    chordSynthParams: {
      oscType: 'sawtooth',
      subOscVolume: 0.3,
      detune: 14,
      filterType: 'lowpass',
      filterCutoff: 3400,
      filterResonance: 2.2,
      filterEnvAmount: 900,
      attack: 0.02,
      decay: 0.5,
      sustain: 0.7,
      release: 0.45,
      filterAttack: 0.02,
      filterDecay: 0.4,
      filterSustain: 0.3,
      filterRelease: 0.4,
      arpActive: false,
    },

    // Bass: Saw Growl / Motorik driving 8ths
    bassPatternId: 'driving-eighths',
    bassFeel: 0.10, // Grid tight
    bassOctave: 2,
    bassPresetName: 'Saw Growl',
    bassSynthParams: {
      oscType: 'sawtooth',
      subOscVolume: 0.6,
      detune: 2,
      filterType: 'lowpass',
      filterCutoff: 650,
      filterResonance: 5.0,
      filterEnvAmount: 600,
      attack: 0.005,
      decay: 0.18,
      sustain: 0.55,
      release: 0.25,
    },

    // Main Synth: Arpeggiator active
    synthPresetName: 'Neon Pluck',
    synthParams: {
      oscType: 'sawtooth',
      filterCutoff: 4200,
      filterResonance: 2.8,
      attack: 0.015,
      decay: 0.4,
      sustain: 0.7,
      release: 0.35,
      detune: 16,
      lfoDepth: 0.2,
      lfoRate: 4.0,
      lfoTarget: 'cutoff',
      arpActive: true,
      arpMode: 'updown',
      arpRate: '16n',
      arpOctaves: 2,
    },

    effects: {
      reverbWet: 0.48,
      reverbDecay: 3.6,
      delayWet: 0.28,
      delayTime: '8n',
      delayFeedback: 0.35,
      chorusWet: 0.45,
      chorusRate: 1.5,
      chorusDepth: 0.55,
      distortionWet: 0.18,
      compressorThreshold: -15,
      eqLow: 2,
      eqMid: 1,
      eqHigh: 4,
    },
  },
  {
    id: 'cyber-dance',
    name: 'Cyber EDM',
    tagline: 'High-energy 128 BPM festival drop with punchy kicks & arps',
    emoji: '⚡',
    color: '#06B6D4',
    bgGradient: 'from-cyan-950/40 via-blue-950/40 to-purple-950/20',
    borderColor: 'border-cyan-500/40',
    textColor: 'text-cyan-300',
    bpm: 128,
    scaleRoot: 'F',
    scaleType: 'Natural Minor',
    projectTitle: 'Cyberpunk Odyssey',

    // Beat: Hyperpop 2000 club drums
    soundKit: 'Hyperpop 2000',
    drumFilterCutoff: 14000,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPattern: {
      Kick:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      Snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      HiHat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      OpenHat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      Clap:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      Tom:   [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
      Crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },

    // Chords: Upbeat EDM stabs, laser-tight
    chords: [
      makeVibeChord('cy1', 'F', 'min', 1, 4),
      makeVibeChord('cy2', 'D#', 'maj', 1, 4),
      makeVibeChord('cy3', 'C#', 'maj', 1, 4),
      makeVibeChord('cy4', 'C', 'min', 1, 4),
    ],
    chordRhythmId: 'offbeatStabs',
    chordFeel: 0.05, // Laser tight
    chordOctave: 4,
    chordPresetName: 'Hyper Saw Lead',
    chordSynthParams: {
      oscType: 'sawtooth',
      subOscVolume: 0.25,
      detune: 18,
      filterType: 'lowpass',
      filterCutoff: 4800,
      filterResonance: 3.0,
      filterEnvAmount: 1400,
      attack: 0.005,
      decay: 0.25,
      sustain: 0.35,
      release: 0.2,
      arpActive: false,
    },

    // Bass: Punchy Square / Offbeat pumping sub
    bassPatternId: 'offbeat-sub',
    bassFeel: 0.05, // Grid locked
    bassOctave: 2,
    bassPresetName: 'Punchy Square',
    bassSynthParams: {
      oscType: 'square',
      subOscVolume: 0.7,
      detune: 0,
      filterType: 'lowpass',
      filterCutoff: 520,
      filterResonance: 2.5,
      filterEnvAmount: 450,
      attack: 0.005,
      decay: 0.16,
      sustain: 0.45,
      release: 0.15,
    },

    // Main Synth: Cyber Pluck Arp
    synthPresetName: 'Cyber Drone',
    synthParams: {
      oscType: 'square',
      filterCutoff: 5000,
      filterResonance: 3.5,
      attack: 0.005,
      decay: 0.28,
      sustain: 0.2,
      release: 0.2,
      detune: 12,
      arpActive: true,
      arpMode: 'up',
      arpRate: '16n',
      arpOctaves: 2,
    },

    effects: {
      reverbWet: 0.36,
      reverbDecay: 2.8,
      delayWet: 0.32,
      delayTime: '16n',
      delayFeedback: 0.42,
      distortionWet: 0.22,
      compressorThreshold: -14,
      eqLow: 3,
      eqMid: 0,
      eqHigh: 4,
    },
  },
  {
    id: 'ambient-chill',
    name: 'Deep Ambient',
    tagline: 'Floating ethereal pads, lush reverbs & meditative chords',
    emoji: '🌌',
    color: '#A855F7',
    bgGradient: 'from-purple-950/40 via-indigo-950/40 to-slate-950/20',
    borderColor: 'border-purple-500/40',
    textColor: 'text-purple-300',
    bpm: 72,
    scaleRoot: 'D',
    scaleType: 'Lydian',
    projectTitle: 'Cosmic Floating',

    // Beat: Minimal Glitch, soft and spacious
    soundKit: 'Minimal Glitch',
    drumFilterCutoff: 4800,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPattern: {
      Kick:  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      Snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      HiHat: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      OpenHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      Clap:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      Tom:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      Crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },

    // Chords: Celestial Shimmer, very loose and floating
    chords: [
      makeVibeChord('am1', 'D', 'maj7', 2, 4),
      makeVibeChord('am2', 'E', 'maj', 2, 4),
      makeVibeChord('am3', 'F#', 'min7', 2, 4),
      makeVibeChord('am4', 'G#', 'm7b5', 2, 4),
    ],
    chordRhythmId: 'sustained',
    chordFeel: 0.88, // Very loose, floating
    chordOctave: 4,
    chordPresetName: 'Celestial Shimmer',
    chordSynthParams: {
      oscType: 'sine',
      subOscVolume: 0.3,
      detune: 8,
      filterType: 'lowpass',
      filterCutoff: 1900,
      filterResonance: 0.9,
      attack: 0.7,
      decay: 1.6,
      sustain: 0.9,
      release: 2.8,
      lfoDepth: 0.25,
      lfoRate: 0.4,
      lfoTarget: 'cutoff',
      arpActive: false,
    },

    // Bass: Drone sub, organic long sustain
    bassPatternId: 'whole-note-root',
    bassFeel: 0.85,
    bassOctave: 2,
    bassPresetName: 'Deep Sine Sub',
    bassSynthParams: {
      oscType: 'sine',
      subOscVolume: 0.8,
      filterType: 'lowpass',
      filterCutoff: 210,
      filterResonance: 1.0,
      attack: 0.15,
      decay: 0.8,
      sustain: 0.9,
      release: 1.8,
    },

    // Main Synth: Ethereal Bell Pad
    synthPresetName: 'Celestial Shimmer',
    synthParams: {
      oscType: 'sine',
      filterCutoff: 2200,
      filterResonance: 0.9,
      attack: 0.6,
      decay: 1.4,
      sustain: 0.9,
      release: 2.6,
      detune: 7,
      lfoDepth: 0.25,
      lfoRate: 0.3,
      arpActive: false,
    },

    effects: {
      reverbWet: 0.68,
      reverbDecay: 5.8,
      delayWet: 0.48,
      delayTime: '4n',
      delayFeedback: 0.58,
      chorusWet: 0.55,
      chorusRate: 0.6,
      chorusDepth: 0.65,
      compressorThreshold: -20,
      eqLow: 2,
      eqMid: -1,
      eqHigh: 2,
    },
  },
  {
    id: 'hiphop-groove',
    name: 'Boom Bap',
    tagline: 'Crisp swing drums, soulful minor keys & groovy bass',
    emoji: '🎙️',
    color: '#10B981',
    bgGradient: 'from-emerald-950/40 via-zinc-900/40 to-emerald-950/20',
    borderColor: 'border-emerald-500/40',
    textColor: 'text-emerald-300',
    bpm: 92,
    scaleRoot: 'E',
    scaleType: 'Dorian',
    projectTitle: 'Soulful Golden Era',

    // Beat: 808 Vintage / Boom bap swing
    soundKit: '808 Vintage',
    drumFilterCutoff: 7800,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPattern: {
      Kick:  [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
      Snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      HiHat: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
      OpenHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      Clap:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      Tom:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      Crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },

    // Chords: Mellow E-Piano with syncopated push
    chords: [
      makeVibeChord('bb1', 'E', 'min7', 1, 4),
      makeVibeChord('bb2', 'A', '7', 1, 4),
      makeVibeChord('bb3', 'D', 'maj7', 1, 4),
      makeVibeChord('bb4', 'G', 'maj7', 1, 4),
    ],
    chordRhythmId: 'syncopatedPush',
    chordFeel: 0.76, // Loose swing pocket
    chordOctave: 4,
    chordPresetName: 'Mellow E-Piano',
    chordSynthParams: {
      oscType: 'triangle',
      subOscVolume: 0.3,
      detune: 10,
      filterType: 'lowpass',
      filterCutoff: 3000,
      filterResonance: 1.6,
      filterEnvAmount: 600,
      attack: 0.02,
      decay: 0.7,
      sustain: 0.5,
      release: 0.55,
      lfoDepth: 0.15,
      lfoRate: 3.5,
      lfoTarget: 'volume',
      arpActive: false,
    },

    // Bass: Round Pluck walking bassline
    bassPatternId: 'walking-groove',
    bassFeel: 0.72, // Swung walking feel
    bassOctave: 2,
    bassPresetName: 'Round Pluck',
    bassSynthParams: {
      oscType: 'triangle',
      subOscVolume: 0.5,
      detune: 4,
      filterType: 'lowpass',
      filterCutoff: 420,
      filterResonance: 3.5,
      filterEnvAmount: 750,
      attack: 0.005,
      decay: 0.28,
      sustain: 0.45,
      release: 0.28,
    },

    // Main Synth: Mellow E-Piano Solo
    synthPresetName: 'Mellow E-Piano',
    synthParams: {
      oscType: 'triangle',
      filterCutoff: 3200,
      filterResonance: 1.5,
      attack: 0.02,
      decay: 0.6,
      sustain: 0.5,
      release: 0.5,
      detune: 10,
      arpActive: false,
    },

    effects: {
      reverbWet: 0.30,
      reverbDecay: 2.0,
      delayWet: 0.20,
      delayTime: '8n',
      delayFeedback: 0.22,
      compressorThreshold: -16,
      eqLow: 3,
      eqMid: 1,
      eqHigh: 0,
    },
  },
  {
    id: 'asian-zen',
    name: 'Zen Garden',
    tagline: 'Peaceful pentatonic bells, bamboo flute sounds & soothing flow',
    emoji: '🎋',
    color: '#38BDF8',
    bgGradient: 'from-sky-950/40 via-teal-950/40 to-slate-950/20',
    borderColor: 'border-sky-500/40',
    textColor: 'text-sky-300',
    bpm: 78,
    scaleRoot: 'G',
    scaleType: 'Pentatonic Major',
    projectTitle: 'Bamboo Garden Serenade',

    // Beat: Minimal Glitch bamboo acoustic clicks
    soundKit: 'Minimal Glitch',
    drumFilterCutoff: 6500,
    drumFilterResonance: 1.0,
    drumFilterType: 'lowpass',
    drumPattern: {
      Kick:  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      Snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      HiHat: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
      OpenHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      Clap:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      Tom:   [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      Crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },

    // Chords: Glocken Bell & peaceful sustained pads
    chords: [
      makeVibeChord('zn1', 'G', 'maj', 2, 4),
      makeVibeChord('zn2', 'C', 'maj', 2, 4),
      makeVibeChord('zn3', 'D', 'maj', 2, 4),
      makeVibeChord('zn4', 'E', 'min', 2, 4),
    ],
    chordRhythmId: 'sustained',
    chordFeel: 0.65, // Peaceful organic breath
    chordOctave: 4,
    chordPresetName: 'Glocken Bell',
    chordSynthParams: {
      oscType: 'triangle',
      subOscVolume: 0.2,
      detune: 6,
      filterType: 'lowpass',
      filterCutoff: 3400,
      filterResonance: 2.0,
      attack: 0.02,
      decay: 1.4,
      sustain: 0.4,
      release: 1.6,
      arpActive: false,
    },

    // Bass: Warm Triangle drone
    bassPatternId: 'whole-note-root',
    bassFeel: 0.60,
    bassOctave: 2,
    bassPresetName: 'Warm Triangle',
    bassSynthParams: {
      oscType: 'triangle',
      subOscVolume: 0.4,
      filterType: 'lowpass',
      filterCutoff: 380,
      filterResonance: 1.2,
      attack: 0.04,
      decay: 0.5,
      sustain: 0.8,
      release: 0.8,
    },

    // Main Synth: Pentatonic Bell Arp
    synthPresetName: 'Glocken Bell',
    synthParams: {
      oscType: 'triangle',
      filterCutoff: 3800,
      filterResonance: 2.2,
      attack: 0.01,
      decay: 1.1,
      sustain: 0.35,
      release: 1.4,
      detune: 6,
      arpActive: true,
      arpMode: 'up',
      arpRate: '8n',
      arpOctaves: 2,
    },

    effects: {
      reverbWet: 0.58,
      reverbDecay: 4.4,
      delayWet: 0.42,
      delayTime: '4n',
      delayFeedback: 0.46,
      chorusWet: 0.35,
      chorusRate: 0.8,
      chorusDepth: 0.45,
      compressorThreshold: -18,
      eqLow: 1,
      eqMid: 0,
      eqHigh: 3,
    },
  },
];
