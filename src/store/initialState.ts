import type { SynthParams, SequencerTrack, ChordItem, MasterEffects, SongArrangement } from '../types';
import { applyPreset, presetById } from '../audio/presetRegistry';
import type { PadState } from './types';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { DEFAULT_BUS_TRIM_DB, DEFAULT_FADER_DB } from './levelUnits';

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

/**
 * One empty bar at the widest storable width. Spread at each use site, never
 * shared: two tracks holding the same array would toggle together.
 */
const SILENT_BAR: boolean[] = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);

export const INITIAL_SEQUENCER_TRACKS: SequencerTrack[] = [
  // Every track starts at unity. Until DEV-386 these were 0.7 .. 0.9 LINEAR and
  // nothing read them; the field is a real gain node now, so unity is what keeps
  // a factory kit sounding the way it always has.
  {
    id: 'track-kick',
    name: 'Kick 808',
    instrument: 'kick',
    steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-kick',
  },
  {
    id: 'track-snare',
    name: 'Snare Snap',
    instrument: 'snare',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-snare',
  },
  {
    id: 'track-rimshot',
    name: 'Rim Shot',
    instrument: 'rimshot',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-rimshot',
  },
  {
    id: 'track-clap',
    name: 'Hand Clap',
    instrument: 'clap',
    steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-clap',
  },
  {
    id: 'track-hihat',
    name: 'Closed Hat',
    instrument: 'hihat',
    steps: [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, false, false, false, false, false, false, false, false],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-hihat',
  },
  {
    id: 'track-openhat',
    name: 'Open Hat',
    instrument: 'openhat',
    steps: [false, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false, false, false, false, false],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-openhat',
  },
  {
    id: 'track-hitom',
    name: 'Hi Tom',
    instrument: 'hitom',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-hitom',
  },
  {
    id: 'track-lowtom',
    name: 'Low Tom',
    instrument: 'lowtom',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-lowtom',
  },
  {
    id: 'track-ride',
    name: 'Ride',
    instrument: 'ride',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-ride',
  },
  {
    id: 'track-crash',
    name: 'Crash',
    instrument: 'crash',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-crash',
  },
  {
    id: 'track-bell',
    name: 'Bell',
    instrument: 'bell',
    steps: [...SILENT_BAR],
    volume: DEFAULT_FADER_DB,
    muted: false,
    color: 'bg-drum-bell',
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
// NOTE: reverbDecay (2.0) deliberately equals the engine's setupMasterChain
// hardcode so the default sound is unchanged now that the knob is live.
//
// The eight NUMERIC dynamics values equal the engine's historical hardcodes
// for a different reason: they are never heard until a module is switched
// on, so these numbers are what "on" has always meant, not what a fresh
// project sounds like. `compressorEnabled` stays `false` (DEV-385): a
// user must opt into compression shaping the mix.
//
// `limiterEnabled` defaults to `true`, reversing DEV-385's off-by-default
// for this one stage. DEV-385's reason for defaulting both off was honest
// metering — an always-on limiter caps the signal near -3 dBFS, so a meter
// behind it could never show what the user actually made. That reason does
// not hold for the limiter here: the master analysers
// (`rewireMasterDynamics` in audio/engine.ts) are observe-only sends off
// masterGain, wired BEFORE both dynamics stages, so the meter reads the
// pre-limiter mix and the `over` zone stays reachable whether the limiter
// is engaged or not.
// The second reason this is safe: the five source buses default to -6 dB,
// calibrated so a fresh project peaks around -2.75 dBFS. The limiter's
// -3 dB threshold therefore only catches occasional peaks at those
// defaults rather than compressing continuously — a limiter that engaged
// on every dense groove would be the hidden mix-bus compressor DEV-385
// removed. Raise the bus defaults later and re-check this still holds.
export const INITIAL_EFFECTS: MasterEffects = {
  reverbWet: 0.25,
  reverbDecay: 2.0,
  delayWet: 0.2,
  delayFeedback: 0.35,
  distortionWet: 0.1,
  eqLow: 2,
  eqMid: 0,
  eqHigh: 3,
  compressorEnabled: false,
  compressorThreshold: -12,
  compressorRatio: 4,
  compressorAttack: 0.003,
  compressorRelease: 0.25,
  limiterEnabled: true,
  limiterThreshold: -3,
  limiterRatio: 20,
  limiterAttack: 0.003,
  limiterRelease: 0.15,
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

/**
 * The Bass-category factory preset a fresh bass module starts from.
 *
 * Resolved by ID, never by index. This was `FACTORY_BASS_PRESETS[0]` in
 * synthSlice.ts and loopSlice.ts until the preset arrays merged, at which point
 * index 0 became `factory-cosmic-lead` and both defaults silently turned into a
 * lead patch — with store.test.ts agreeing, because it asserted against the
 * same index expression. store.test.ts now pins this id and initialState.test.ts
 * pins that it resolves; reverting either to an index turns both red.
 */
export const DEFAULT_BASS_PRESET_ID = 'bass-deep-sine';

const DEFAULT_BASS_PRESET = presetById(DEFAULT_BASS_PRESET_ID);

/**
 * The shared synth defaults with the bass preset laid over them.
 *
 * Deliberately NOT `applyPreset(...)`: applyPreset also stamps
 * `preset: preset.name`, and today's default carries no `preset` field. Using
 * it here would change a persisted default value, which this refactor forbids.
 *
 * Falls back to the bare defaults if the id ever stops resolving —
 * initialState.test.ts is what makes that fallback loud instead of silent.
 */
export const INITIAL_BASS_SYNTH_PARAMS: SynthParams = DEFAULT_BASS_PRESET
  ? { ...INITIAL_SYNTH_PARAMS, ...DEFAULT_BASS_PRESET.params }
  : INITIAL_SYNTH_PARAMS;

/** The Pad-category factory preset a fresh pad starts from. */
export const PAD_DEFAULT_PRESET_ID = 'factory-warm-polypad';

const PAD_DEFAULT_PRESET = presetById(PAD_DEFAULT_PRESET_ID);

/**
 * Built the same way `createDefaultLoop` builds `bassSynthParams`: the shared
 * synth defaults with a factory preset laid over them. Falls back to the bare
 * defaults if the id ever stops resolving — initialState.test.ts is what makes
 * that fallback loud instead of silent.
 */
export const INITIAL_PAD_SYNTH_PARAMS: SynthParams = PAD_DEFAULT_PRESET
  ? applyPreset(INITIAL_SYNTH_PARAMS, PAD_DEFAULT_PRESET)
  : INITIAL_SYNTH_PARAMS;

/**
 * Every pad key with its NEW-project value. Both migration chains call this
 * and then override `padMuted` to `true`, because a project saved before the
 * pad existed must reopen sounding the way it sounded when it was closed.
 *
 * Do NOT collapse that override into these defaults. Doing so gives every
 * pre-existing project a voice its author never wrote, and nothing in the UI
 * or the build would show it — three tests pin the distinction (see
 * initialState.test.ts, migrate.test.ts and projectFormat.test.ts).
 *
 * A factory, not a constant: `padDroneIntervals` is an array, and a shared one
 * seeded into the live store would let a single in-place sort or push poison
 * every default.
 */
export function defaultPadState(): PadState {
  return {
    padSynthParams: INITIAL_PAD_SYNTH_PARAMS,
    padMode: 'pad',
    padOctave: 3,
    padVoicing: 'triad',
    padDroneDegree: 0,
    padDroneIntervals: [1, 5, 8],
    padVolume: DEFAULT_BUS_TRIM_DB,
    padMuted: false,
  };
}
