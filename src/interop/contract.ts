/**
 * The resolved-song contract: what `readSolnaSong` hands a consumer outside
 * this app.
 *
 * This file imports NOTHING, on purpose. A consumer copies it verbatim as its
 * type declaration for the built bundle, so every shape it names is declared
 * here — including the synth patch, which restates `EnginePatch<'subtractive'>`
 * (src/types/synth.ts). `conformance.test.ts` fails to compile when the two
 * drift apart.
 *
 * Units: every time is in quarter-note beats, every pitch is a MIDI note
 * number, every level is the app's own fader dB, velocity is linear 0..1.
 *
 * Bump `SOLNA_INTEROP_CONTRACT_VERSION` for any change a consumer could read
 * differently: a renamed or removed field, a changed unit, a changed guarantee.
 * Adding an optional field is not a bump.
 */
export const SOLNA_INTEROP_CONTRACT_VERSION = 1;

export type SolnaReadResult =
  | { ok: true; song: SolnaSong; warnings: SolnaWarning[] }
  | { ok: false; reason: 'malformed' | 'newer-version'; formatVersion?: number };

/** A reader-side substitution, e.g. an unknown pattern id replaced by the default. */
export interface SolnaWarning {
  code: string;
  loopIndex?: number;
  trackId?: string;
  detail: string;
}

export interface SolnaSong {
  contractVersion: number;
  /** The `formatVersion` the file itself carries. */
  formatVersion: number;
  name: string;
  bpm: number;
  meter: { id: string; numerator: number; denominator: number; beatsPerBar: number };
  masterVolumeDb: number;
  /** Synth tracks in the app's display order. Not assumed to be five. */
  synthTracks: Array<{ id: string; label: string }>;
  drumVoices: SolnaDrumVoice[];
  loops: SolnaSongLoop[];
}

export interface SolnaDrumVoice {
  id: string;
  label: string;
  /** General MIDI percussion key, as the app's own MIDI export writes it. */
  gmNote: number;
}

export interface SolnaSongLoop {
  index: number;
  name: string;
  /** Position of the loop's first pass in the song, quarter-note beats. */
  startBeat: number;
  /** One pass. A loop with no chords still dwells one bar. */
  passBeats: number;
  repeatCount: number;
  /** `scaleName` is Tonal's scale name, e.g. `aeolian`. */
  key: { root: string; scaleName: string };
  /** Pass-relative; `symbol` is a Tonal chord symbol, e.g. `Am7`. */
  chords: Array<{ startBeat: number; durationBeats: number; symbol: string }>;
  /** Keyed by `synthTracks[].id`. */
  synths: Record<string, SolnaSynthPart>;
  beat: { muted: boolean; volumeDb: number; passes: SolnaDrumHit[][] };
}

export interface SolnaSynthPart {
  muted: boolean;
  volumeDb: number;
  patch: SolnaSynthPatch;
  /** One entry per repeat, pass-relative. A muted part still lists what it would play. */
  passes: SolnaNote[][];
}

export interface SolnaNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
  /** Linear 0..1. */
  velocity: number;
}

export interface SolnaDrumHit {
  voiceId: string;
  startBeat: number;
  /** Linear 0..1. */
  velocity: number;
}

// --- The synth patch, restated from src/types/synth.ts ---
// `@public`: nothing in this app names these parts on their own, but a consumer's mapping does.

/** @public */
export type SolnaOscillatorWaveform = 'sawtooth' | 'square' | 'triangle' | 'sine';

/** @public */
export interface SolnaOscillatorParams {
  enabled: boolean;
  waveform: SolnaOscillatorWaveform;
  octave: number;
  semitone: number;
  fineCents: number;
  levelDb: number;
}

/** @public */
export interface SolnaUtilitySourceParams {
  subEnabled: boolean;
  subOctave: -1 | -2;
  subLevelDb: number;
  noiseEnabled: boolean;
  noiseColor: 'white' | 'pink' | 'brown';
  noiseLevelDb: number;
}

/** @public */
export interface SolnaFilterParams {
  type: 'lowpass' | 'bandpass' | 'highpass' | 'notch';
  cutoffHz: number;
  resonance: number;
  driveDb: number;
  keyTrack: number;
}

/** @public */
export interface SolnaAdsrParams {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/** `amount` is signed, in the unit its target implies. @public */
export type SolnaModRoute =
  | { target: 'pitch-all' | 'osc1-pitch' | 'osc2-pitch' | 'filter-cutoff'; unit: 'semitones'; amount: number }
  | { target: 'osc1-level' | 'osc2-level' | 'amplitude'; unit: 'db'; amount: number }
  | { target: 'filter-resonance'; unit: 'normalized'; amount: number }
  | { target: 'pan'; unit: 'pan'; amount: number };

/** `value` is the whole-note fraction: 4 is a quarter note, 8 an eighth. @public */
export interface SolnaNoteDivision {
  value: 1 | 2 | 4 | 8 | 16 | 32;
  modifier: 'straight' | 'dotted' | 'triplet';
}

/** @public */
export type SolnaLfoRate = { mode: 'hz'; hz: number } | { mode: 'sync'; division: SolnaNoteDivision };

/** @public */
export interface SolnaLfoParams {
  waveform: 'sine' | 'triangle' | 'sawtooth' | 'square' | 'sample-and-hold';
  depth: number;
  phaseDegrees: number;
  triggerMode: 'transport' | 'note';
  rate: SolnaLfoRate;
  route: SolnaModRoute | null;
}

export interface SolnaSynthPatch {
  common: {
    voiceMode: 'mono' | 'poly';
    glideSeconds: number;
    unisonVoices: number;
    unisonDetuneCents: number;
    stereoWidth: number;
    velocityToAmplitude: number;
    outputGainDb: number;
  };
  synth: {
    oscillators: [SolnaOscillatorParams, SolnaOscillatorParams];
    utility: SolnaUtilitySourceParams;
    filter: SolnaFilterParams;
    ampEnvelope: SolnaAdsrParams;
    modEnvelope: SolnaAdsrParams;
    /** At most two slots, in slot order. */
    env2Routes: SolnaModRoute[];
    lfo: SolnaLfoParams;
  };
}
