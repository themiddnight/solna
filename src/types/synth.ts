/**
 * Engine-discriminated synth domain types (design:
 * docs/superpowers/specs/2026-09-14-synth-engine-and-presets-design.md,
 * "Domain model" and "Subtractive patch contract").
 *
 * This module is the only synth patch shape there is — the flat `SynthParams`
 * that `src/types.ts` used to own is gone. It stays deliberately independent
 * of that file — no import either direction, so re-exporting from
 * `src/types.ts` never creates a cycle. `ArpMode`/`ArpRate` still live there
 * for the arpeggiator scheduler; `ArpSettings` below inlines its own literal
 * unions rather than reusing those names, so the two modules never export
 * colliding names.
 *
 * This file is pure types: no runtime value, no import from audio/, store/
 * or components/, so it sits wherever the layering rules need it.
 */

/** Single member today by design — no placeholder FM/wavetable entries. */
export type SynthEngineId = 'subtractive';

export type OscillatorWaveform = 'sawtooth' | 'square' | 'triangle' | 'sine';

/**
 * Enabled state represents silence; nothing here stores `-Infinity` as a
 * level. `octave` and `semitone` are integer tuning offsets, `fineCents` a
 * continuous trim.
 */
export interface OscillatorParams {
  enabled: boolean;
  waveform: OscillatorWaveform;
  octave: number;
  semitone: number;
  fineCents: number;
  levelDb: number;
}

export type NoiseColor = 'white' | 'pink' | 'brown';

/**
 * The utility source: a fixed-waveform sine sub an octave or two below the
 * oscillators, plus a colored-noise generator. Neither is a full
 * `OscillatorParams` — the sub has no waveform choice and the noise has no
 * pitch — so this is its own shape rather than a third oscillator slot.
 */
export interface UtilitySourceParams {
  subEnabled: boolean;
  /** The sub is always a sine wave, fixed one or two octaves down. */
  subOctave: -1 | -2;
  subLevelDb: number;
  noiseEnabled: boolean;
  noiseColor: NoiseColor;
  noiseLevelDb: number;
}

export type FilterType = 'lowpass' | 'bandpass' | 'highpass' | 'notch';

/**
 * `resonance` is a unitless 0..1 synth control, not the Web Audio `Q` the v1
 * `BiquadFilterNode` adapter maps it onto. `keyTrack` is 0..1.
 */
export interface FilterParams {
  type: FilterType;
  cutoffHz: number;
  resonance: number;
  driveDb: number;
  keyTrack: number;
}

/** Attack/decay/release in seconds, sustain 0..1. Shared by both envelopes. */
export interface AdsrParams {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/**
 * The nine modulation destinations. Grouped by the unit their route amount
 * is expressed in (see `ModRoute` below): semitones for pitch and cutoff, dB
 * for levels and amplitude, a normalized delta for resonance, -1..1 for pan.
 */
export type ModTarget =
  | 'pitch-all'
  | 'osc1-pitch'
  | 'osc2-pitch'
  | 'osc1-level'
  | 'osc2-level'
  | 'filter-cutoff'
  | 'filter-resonance'
  | 'amplitude'
  | 'pan';

/**
 * Target-discriminated so a route's `amount` carries its documented unit at
 * the type level instead of relying on a caller to remember which target
 * means which unit. `amount` is signed in every family.
 */
export type ModRoute =
  | { target: 'pitch-all' | 'osc1-pitch' | 'osc2-pitch' | 'filter-cutoff'; unit: 'semitones'; amount: number }
  | { target: 'osc1-level' | 'osc2-level' | 'amplitude'; unit: 'db'; amount: number }
  | { target: 'filter-resonance'; unit: 'normalized'; amount: number }
  | { target: 'pan'; unit: 'pan'; amount: number };

export type LfoWaveform = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'sample-and-hold';

/**
 * Transport-triggered LFO is one shared, phase-locked instance per synth
 * channel; note-triggered is per voice and starts at `phaseDegrees`. See the
 * design doc's "Engine and voice lifecycle" section — this module only
 * names the two modes, it does not implement either.
 */
export type LfoTriggerMode = 'transport' | 'note';

/** The whole-note fraction a synced rate divides into: quarter, eighth, etc. */
export type NoteDivisionValue = 1 | 2 | 4 | 8 | 16 | 32;

/** Straight is the plain division; dotted lengthens it by half, triplet shortens it by a third. */
export type NoteDivisionModifier = 'straight' | 'dotted' | 'triplet';

export interface NoteDivision {
  value: NoteDivisionValue;
  modifier: NoteDivisionModifier;
}

export type LfoRate = { mode: 'hz'; hz: number } | { mode: 'sync'; division: NoteDivision };

/** One route slot — the LFO's whole modulation output is `depth * route.amount`. */
export interface LfoParams {
  waveform: LfoWaveform;
  depth: number;
  phaseDegrees: number;
  triggerMode: LfoTriggerMode;
  rate: LfoRate;
  route: ModRoute | null;
}

/**
 * ENV1 is permanently wired to amplitude and is not represented as a route;
 * `env2Routes` is capped at two slots by the validator (Task 2), not by this
 * type — a fixed-length tuple would make "no routes assigned yet" unrepresentable.
 */
export interface SubtractiveParams {
  oscillators: [OscillatorParams, OscillatorParams];
  utility: UtilitySourceParams;
  filter: FilterParams;
  ampEnvelope: AdsrParams;
  modEnvelope: AdsrParams;
  env2Routes: ModRoute[];
  lfo: LfoParams;
}

export type VoiceMode = 'mono' | 'poly';

/**
 * Settings that apply to a complete voice regardless of synthesis method.
 * Deliberately excludes analog drift — there is no such parameter in this
 * design. `unisonDetuneCents` is the Pro UI's "Spread"; `stereoWidth` is
 * both Pro's and Simple's "Width" — both names are pinned and must not
 * drift under a synonym.
 */
export interface CommonVoiceParams {
  voiceMode: VoiceMode;
  glideSeconds: number;
  unisonVoices: number;
  unisonDetuneCents: number;
  stereoWidth: number;
  velocityToAmplitude: number;
  outputGainDb: number;
}

export interface EnginePatchMap {
  subtractive: SubtractiveParams;
}

export interface EnginePatch<E extends SynthEngineId = SynthEngineId> {
  common: CommonVoiceParams;
  synth: EnginePatchMap[E];
}

export interface ActiveSynth<E extends SynthEngineId = SynthEngineId> {
  engine: E;
  patch: EnginePatch<E>;
  /** Display provenance only — never a DSP input. */
  sourcePresetId: string | null;
}

/**
 * Arp is performance state, not patch state — deliberately NOT part of
 * `EnginePatch`/`ActiveSynth`. It is stored in its own per-track store field
 * beside the patch (`fxArpSettings`, `chordArpSettings`, …), so installing a
 * preset replaces the patch and leaves the performance alone. Its own literal
 * unions (rather than the `ArpMode`/`ArpRate` in `src/types.ts`, which the
 * arpeggiator scheduler owns) keep this module independent of that file.
 */
export interface ArpSettings {
  active: boolean;
  mode: 'up' | 'down' | 'updown' | 'random';
  rate: '4n' | '8n' | '16n' | '32n';
  octaves: number;
}
