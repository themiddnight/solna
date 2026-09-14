/**
 * The factory synth preset library — 32 complete subtractive patches.
 *
 * RE-AUTHORED, not padded. Every entry used to be a `Partial<SynthParams>`
 * over the old one-oscillator flat shape, merged onto whatever the track was
 * already holding. That is gone: each entry now states a COMPLETE
 * `EnginePatch<'subtractive'>`, so applying one installs the whole sound and
 * inherits nothing. Translating a recognisable patch into the two-oscillator
 * topology meant deciding, per entry, what OSC 2 is for (a detune partner, an
 * octave partial, a fifth, a bell overtone), whether the utility sub or noise
 * belongs in it, where ENV2 goes, whether the LFO is note- or
 * transport-triggered, whether the voice is mono with glide or poly with
 * unison, and what the patch's own output calibration is.
 *
 * Ids are the contract. The five bass patches use a `bass-` prefix where the
 * others use `factory-`; that inconsistency is deliberately NOT fixed here —
 * `bassPresetId` values are written into all eight vibe specs, so renaming
 * them would mix a content edit into a data rewrite.
 *
 * NEVER read this array positionally for a default. `SYNTH_PRESETS[0]` is the
 * init patch today and that is an accident of ordering, not a promise: every
 * default is resolved by id through `TRACK_SYNTH_PRESET_IDS` /
 * `SUBTRACTIVE_INIT_PRESET_ID` in store/initialState.ts.
 *
 * OUTPUT CALIBRATION LIVES IN THE PATCH. `common.outputGainDb` replaced the
 * preset-ID trim lookup (design doc, "Domain model"), so a patch a user edits
 * or saves stays self-contained.
 *
 * THE VALUES BELOW ARE MEASURED, NOT AUTHORED. They were first written as a
 * mix-role ladder — bass at -3..-7, leads and keys at -6..-9, pads and FX at
 * -9..-12 — and every one of them has since been replaced by
 * `TARGET_DBFS - measuredDbfs` from `bun run calibration:generate`, rounded to
 * a whole dB (the acceptance band is +/-3, so the rounding is noise). The
 * ladder was wrong in both directions and by a lot: Cyber Drone was guessed at
 * -12 and measures as needing +10, Deep Sine Sub was guessed at -4 and needs
 * -13. A patch's level is a fact about its oscillators, envelopes and filter,
 * and no amount of reasoning about mix role predicted it.
 *
 * So: DO NOT hand-edit one of these to taste. `bun run check:levels` reads the
 * committed measurement in `src/data/trimTable.ts` and fails if
 * `measuredDbfs + outputGainDb` leaves the band, which is the gate that keeps
 * that true. If a patch sounds wrong at its measured level, the thing to change
 * is the patch; then regenerate, and take the number the render gives back.
 *
 * A `src/data/` leaf: no runtime import (only `import type`), no function
 * declaration, no `new`, no impure global. -96 below is `SYNTH_GAIN_FLOOR_DB`
 * from `src/utils/synthPatch.ts`, spelled out rather than imported — a data
 * leaf may not import a runtime value. Keep the two in sync by eye.
 */
import type { EnginePatch, SynthEngineId } from '@/types/synth';

export type SynthPresetCategory =
  | 'Bass'
  | 'Lead'
  | 'Pad'
  | 'Keys'
  | 'Pluck'
  | 'Brass'
  | 'FX'
  | 'User';

export interface SynthPresetCategoryMeta {
  id: SynthPresetCategory;
  label: string;
  shortLabel: string;
  badgeClass: string;
  description: string;
}

export const SYNTH_CATEGORIES: SynthPresetCategoryMeta[] = [
  {
    id: 'Bass',
    label: 'Bass',
    shortLabel: 'Bass',
    badgeClass: 'badge badge-accent',
    description: 'Sub-basses, 808s, reese, acid, and bassline tones',
  },
  {
    id: 'Lead',
    label: 'Lead',
    shortLabel: 'Lead',
    badgeClass: 'badge badge-secondary',
    description: 'Cutting leads, vocal sweeps, and melodic solo synthesizers',
  },
  {
    id: 'Pad',
    label: 'Pad',
    shortLabel: 'Pad',
    badgeClass: 'badge badge-primary',
    description: 'Lush ambient textures, string ensembles, and warm backdrops',
  },
  {
    id: 'Keys',
    label: 'Keys',
    shortLabel: 'Keys',
    badgeClass: 'badge badge-accent badge-outline',
    description: 'Electric pianos, bells, chimes, and organ keyboards',
  },
  {
    id: 'Pluck',
    label: 'Pluck',
    shortLabel: 'Pluck',
    badgeClass: 'badge badge-primary badge-outline',
    description: 'Snappy transients, percussive mallets, and short plucks',
  },
  {
    id: 'Brass',
    label: 'Brass',
    shortLabel: 'Brass',
    badgeClass: 'badge badge-primary badge-soft',
    description: 'Analog synth horns, power stabs, and fanfare swells',
  },
  {
    id: 'FX',
    label: 'FX',
    shortLabel: 'FX',
    badgeClass: 'badge badge-secondary badge-soft',
    description: 'Atmospheric drones, sweeps, noise risers, and sci-fi zaps',
  },
  {
    id: 'User',
    label: 'Custom / User',
    shortLabel: 'Custom',
    badgeClass: 'badge badge-success badge-outline',
    description: 'Custom user patches saved to browser storage',
  },
];

/**
 * The controlled tag vocabulary, in the six facets the design doc names:
 * tonal character, articulation, movement, register, voice behaviour, and
 * synthesis technique. Engine is a SEPARATE axis and never appears here.
 *
 * Four of these are not taste, they are facts about the patch, and
 * `synthPresets.test.ts` checks each against the data it labels:
 * `mono`/`poly` follow `common.voiceMode` (exactly one, always), `unison`
 * follows `unisonVoices > 1`, `sub-osc` follows `utility.subEnabled`, `noise`
 * follows `utility.noiseEnabled`, and `static` means the LFO reaches nothing
 * — zero depth or no route. A tag that disagrees with its patch is worse than
 * a missing one: the browser's filter then returns the wrong presets.
 *
 * The same test rejects a tag no preset uses, so the vocabulary cannot grow a
 * chip that selects nothing.
 */
export const SYNTH_TAGS = [
  // Tonal character
  'warm',
  'bright',
  'dark',
  'gritty',
  'glassy',
  // Articulation
  'plucked',
  'sustained',
  'percussive',
  'swelling',
  'one-shot',
  // Movement
  'static',
  'vibrato',
  'tremolo',
  'wobble',
  'evolving',
  'sweeping',
  // Register
  'sub',
  'low',
  'mid',
  'high',
  // Voice behaviour
  'mono',
  'poly',
  'unison',
  'glide',
  // Synthesis technique
  'detuned',
  'noise',
  'sub-osc',
  'filter-env',
  'pitch-env',
  'resonant',
] as const;

export type SynthTag = (typeof SYNTH_TAGS)[number];

/**
 * One library entry. `engine` and `patch` are the discriminated pair: a
 * future engine adds a member to `EnginePatchMap` and entries carrying it,
 * never an optional field on this interface.
 *
 * `createdAt` is written by `presetsSlice` on save and is absent on factory
 * entries. Nothing in src/ reads it today, but it is persisted user data
 * inside `customSynthPresets` — dropping the write would silently strip the
 * only chronology existing saved presets have, for the cost of one number.
 */
export interface SynthPreset<E extends SynthEngineId = SynthEngineId> {
  id: string;
  name: string;
  category: SynthPresetCategory;
  engine: E;
  patch: EnginePatch<E>;
  tags: SynthTag[];
  description: string;
  isFactory: boolean;
  createdAt?: number;
}

export const SYNTH_PRESETS: SynthPreset<'subtractive'>[] = [
  {
    id: 'factory-subtractive-init',
    name: 'Init Saw',
    category: 'Lead',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'bright', 'sustained', 'static', 'mid'],
    description: 'The neutral starting point: one open sawtooth, no filter, no modulation',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.5,
        velocityToAmplitude: 0.5,
        outputGainDb: -10,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: 0 },
          { enabled: false, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -96 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 20_000, resonance: 0, driveDb: 0, keyTrack: 0 },
        ampEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.3 },
        modEnvelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.3 },
        env2Routes: [],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 2 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-cosmic-lead',
    name: 'Cosmic Lead',
    category: 'Lead',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'bright', 'detuned', 'sub-osc', 'resonant', 'filter-env', 'mid'],
    description: 'Bright soaring lead: a nine-cent detuned saw pair over a sub, opened by ENV2',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 2,
        unisonDetuneCents: 12,
        stereoWidth: 0.6,
        velocityToAmplitude: 0.6,
        outputGainDb: -9,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -9, levelDb: -3 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 9, levelDb: -4 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -14,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 2_800, resonance: 0.45, driveDb: 2, keyTrack: 0.35 },
        ampEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.4 },
        modEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.25, release: 0.4 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 24 }],
        lfo: {
          waveform: 'sine',
          depth: 0.15,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4 },
          route: { target: 'filter-cutoff', unit: 'semitones', amount: 7 },
        },
      },
    },
  },
  {
    id: 'factory-808-deep-bass',
    name: '808 Deep Bass',
    category: 'Bass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'dark', 'sub', 'sub-osc', 'percussive', 'pitch-env', 'static', 'low'],
    description: 'Sub-heavy sine 808 whose ENV2 drops the pitch an octave over the first 50 ms',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0.02,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0,
        velocityToAmplitude: 0.8,
        outputGainDb: -8,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -2 },
          { enabled: true, waveform: 'triangle', octave: 0, semitone: 0, fineCents: 0, levelDb: -20 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -6,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 180, resonance: 0.1, driveDb: 3, keyTrack: 0.2 },
        ampEnvelope: { attack: 0.004, decay: 0.9, sustain: 0.15, release: 0.5 },
        // The 808 signature: ENV2 jumps the pitch UP an octave at note-on and
        // the 50 ms decay walks it back down. Both routes share this contour,
        // so the click and the drop are the same gesture.
        modEnvelope: { attack: 0, decay: 0.05, sustain: 0, release: 0.05 },
        env2Routes: [
          { target: 'pitch-all', unit: 'semitones', amount: 12 },
          { target: 'filter-cutoff', unit: 'semitones', amount: 6 },
        ],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 3 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-warm-polypad',
    name: 'Warm PolyPad',
    category: 'Pad',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'warm', 'sustained', 'evolving', 'noise', 'detuned', 'filter-env'],
    description: 'Lush ambient triangle pad with a breath of pink noise, panning on the transport LFO',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 4,
        unisonDetuneCents: 18,
        stereoWidth: 1,
        velocityToAmplitude: 0.2,
        outputGainDb: -6,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'triangle', octave: 0, semitone: 0, fineCents: -4, levelDb: -5 },
          { enabled: true, waveform: 'triangle', octave: 1, semitone: 0, fineCents: 4, levelDb: -7 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: true,
          noiseColor: 'pink',
          noiseLevelDb: -28,
        },
        filter: { type: 'lowpass', cutoffHz: 1_500, resonance: 0.05, driveDb: 0, keyTrack: 0.1 },
        ampEnvelope: { attack: 1.2, decay: 1, sustain: 0.8, release: 2 },
        modEnvelope: { attack: 1.5, decay: 1.5, sustain: 0.6, release: 2 },
        env2Routes: [
          { target: 'filter-cutoff', unit: 'semitones', amount: 8 },
          { target: 'amplitude', unit: 'db', amount: -2 },
        ],
        lfo: {
          waveform: 'sine',
          depth: 0.2,
          phaseDegrees: 90,
          triggerMode: 'transport',
          rate: { mode: 'sync', division: { value: 2, modifier: 'straight' } },
          route: { target: 'pan', unit: 'pan', amount: 0.5 },
        },
      },
    },
  },
  {
    id: 'factory-acid-synth',
    name: 'Acid Synth',
    category: 'Bass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'glide', 'gritty', 'resonant', 'filter-env', 'plucked', 'static', 'low'],
    description: 'TB-303 squelch: a driven square-and-saw pair, a screaming resonant sweep, and note slide',
    patch: {
      common: {
        voiceMode: 'mono',
        // The slide is the instrument. A 303 line without portamento is just
        // a resonant bass.
        glideSeconds: 0.06,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0,
        velocityToAmplitude: 0.85,
        outputGainDb: -9,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'square', octave: 0, semitone: 0, fineCents: 0, levelDb: -3 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -7, levelDb: -9 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 320, resonance: 0.85, driveDb: 8, keyTrack: 0.8 },
        ampEnvelope: { attack: 0.003, decay: 0.18, sustain: 0.25, release: 0.12 },
        modEnvelope: { attack: 0.003, decay: 0.22, sustain: 0, release: 0.15 },
        env2Routes: [
          { target: 'filter-cutoff', unit: 'semitones', amount: 36 },
          { target: 'filter-resonance', unit: 'normalized', amount: 0.1 },
        ],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 5 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-dream-keys',
    name: 'Dream Keys',
    category: 'Keys',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'warm', 'glassy', 'vibrato', 'sustained', 'mid'],
    description: 'Soft chime keyboard: a sine body under an octave partial that fades first, with delicate vibrato',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.45,
        velocityToAmplitude: 0.65,
        outputGainDb: -7,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -4 },
          { enabled: true, waveform: 'triangle', octave: 1, semitone: 0, fineCents: 3, levelDb: -13 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 3_200, resonance: 0.15, driveDb: 0, keyTrack: 0.4 },
        ampEnvelope: { attack: 0.01, decay: 0.8, sustain: 0.45, release: 0.9 },
        // The chime overtone rings 6 dB louder at the strike and settles back
        // as the note sustains: that is what makes it read as a chime rather
        // than as a second note held alongside the first.
        modEnvelope: { attack: 0.01, decay: 0.6, sustain: 0, release: 0.6 },
        env2Routes: [
          { target: 'filter-cutoff', unit: 'semitones', amount: 12 },
          { target: 'osc2-level', unit: 'db', amount: 6 },
        ],
        lfo: {
          waveform: 'sine',
          depth: 0.18,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 5.5 },
          route: { target: 'pitch-all', unit: 'semitones', amount: 0.12 },
        },
      },
    },
  },
  {
    id: 'factory-pluck',
    name: 'Neon Pluck',
    category: 'Pluck',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'bright', 'plucked', 'percussive', 'resonant', 'filter-env', 'static', 'mid'],
    description: 'Crisp square pluck with a saw octave on top, instant attack and no sustain at all',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.35,
        velocityToAmplitude: 0.8,
        outputGainDb: 0,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'square', octave: 0, semitone: 0, fineCents: 0, levelDb: -4 },
          { enabled: true, waveform: 'sawtooth', octave: 1, semitone: 0, fineCents: 0, levelDb: -14 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 1_800, resonance: 0.55, driveDb: 2, keyTrack: 0.5 },
        ampEnvelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.12 },
        modEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 30 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-vintage-brass',
    name: 'Vintage Brass',
    category: 'Brass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'warm', 'swelling', 'tremolo', 'detuned', 'filter-env', 'mid'],
    description: 'Analog synth horns: two saws six cents apart, a slow filter swell, and a tremolo LFO',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 2,
        unisonDetuneCents: 10,
        stereoWidth: 0.5,
        velocityToAmplitude: 0.7,
        outputGainDb: -10,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -6, levelDb: -4 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 6, levelDb: -4 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 1_100, resonance: 0.2, driveDb: 4, keyTrack: 0.5 },
        // The brass "lip": ENV1 and ENV2 both take ~100 ms to arrive, so the
        // note brightens as it gets loud rather than before it.
        ampEnvelope: { attack: 0.09, decay: 0.35, sustain: 0.75, release: 0.25 },
        modEnvelope: { attack: 0.12, decay: 0.4, sustain: 0.5, release: 0.3 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 22 }],
        lfo: {
          waveform: 'triangle',
          depth: 0.12,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 5.2 },
          route: { target: 'amplitude', unit: 'db', amount: -3 },
        },
      },
    },
  },
  {
    id: 'factory-cyber-drone',
    name: 'Cyber Drone',
    category: 'FX',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'dark', 'sustained', 'evolving', 'noise', 'detuned', 'resonant'],
    description: 'Cinematic bandpass drone: a saw and a detuned fifth over brown noise, undulating on a whole-note LFO',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 2,
        unisonDetuneCents: 22,
        stereoWidth: 0.9,
        velocityToAmplitude: 0.15,
        outputGainDb: 10,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: -1, semitone: 0, fineCents: -9, levelDb: -6 },
          { enabled: true, waveform: 'square', octave: 0, semitone: 7, fineCents: 9, levelDb: -10 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: true,
          noiseColor: 'brown',
          noiseLevelDb: -30,
        },
        filter: { type: 'bandpass', cutoffHz: 700, resonance: 0.6, driveDb: 2, keyTrack: 0 },
        ampEnvelope: { attack: 1.6, decay: 2, sustain: 0.85, release: 2.4 },
        modEnvelope: { attack: 2, decay: 3, sustain: 0.5, release: 2 },
        env2Routes: [
          { target: 'filter-cutoff', unit: 'semitones', amount: 10 },
          { target: 'filter-resonance', unit: 'normalized', amount: 0.15 },
        ],
        lfo: {
          waveform: 'sine',
          depth: 0.5,
          phaseDegrees: 0,
          // Transport-locked, so a drone held across a bar line stays in phase
          // with the music instead of restarting per note.
          triggerMode: 'transport',
          rate: { mode: 'sync', division: { value: 1, modifier: 'straight' } },
          route: { target: 'filter-cutoff', unit: 'semitones', amount: 12 },
        },
      },
    },
  },
  {
    id: 'factory-string-ensemble',
    name: 'String Ensemble',
    category: 'Pad',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'warm', 'swelling', 'sustained', 'detuned', 'vibrato', 'mid'],
    description: 'Bowed-string bloom: a seven-cent saw pair, slow attack, and an ensemble vibrato',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 3,
        unisonDetuneCents: 16,
        stereoWidth: 0.85,
        velocityToAmplitude: 0.35,
        outputGainDb: -10,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -7, levelDb: -5 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 7, levelDb: -5 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 2_000, resonance: 0.12, driveDb: 1, keyTrack: 0.3 },
        ampEnvelope: { attack: 0.55, decay: 0.9, sustain: 0.85, release: 1.1 },
        modEnvelope: { attack: 0.7, decay: 1.2, sustain: 0.55, release: 1.2 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 14 }],
        lfo: {
          waveform: 'triangle',
          depth: 0.14,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4.6 },
          route: { target: 'pitch-all', unit: 'semitones', amount: 0.08 },
        },
      },
    },
  },
  {
    id: 'factory-wobble-bass',
    name: 'Wobble Bass',
    category: 'Bass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'glide', 'gritty', 'wobble', 'sub-osc', 'detuned', 'sustained', 'low'],
    description: 'Dubstep wobble: a wide-detuned saw pair driven hard, with an eighth-note filter LFO locked to the transport',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0.04,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.25,
        velocityToAmplitude: 0.6,
        outputGainDb: -14,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -12, levelDb: -3 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 12, levelDb: -3 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -10,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 420, resonance: 0.7, driveDb: 9, keyTrack: 0.3 },
        ampEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.9, release: 0.15 },
        modEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.2 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 12 }],
        lfo: {
          waveform: 'sine',
          depth: 1,
          phaseDegrees: 0,
          // The whole point of the patch: the wobble is a musical division,
          // not a free-running rate, so it stays in time when the BPM moves.
          triggerMode: 'transport',
          rate: { mode: 'sync', division: { value: 8, modifier: 'straight' } },
          route: { target: 'filter-cutoff', unit: 'semitones', amount: 30 },
        },
      },
    },
  },
  {
    id: 'factory-glocken-bell',
    name: 'Glocken Bell',
    category: 'Keys',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'bright', 'glassy', 'percussive', 'static', 'high'],
    description: 'Pure bell an octave up: a sine fundamental with a twelfth-above partial that dies first',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.55,
        velocityToAmplitude: 0.75,
        outputGainDb: -4,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sine', octave: 1, semitone: 0, fineCents: 0, levelDb: -5 },
          { enabled: true, waveform: 'sine', octave: 2, semitone: 7, fineCents: 0, levelDb: -20 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 6_000, resonance: 0.05, driveDb: 0, keyTrack: 0.6 },
        ampEnvelope: { attack: 0.001, decay: 2.2, sustain: 0, release: 2.4 },
        // A real bell loses its inharmonic partial long before its
        // fundamental. ENV2 is here for that alone — the filter is left out
        // of it so the decay stays linear rather than dulling.
        modEnvelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.5 },
        env2Routes: [{ target: 'osc2-level', unit: 'db', amount: 8 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 3 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-vocal-lead',
    name: 'Vocal Lead',
    category: 'Lead',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'glide', 'warm', 'vibrato', 'swelling', 'resonant', 'sustained', 'mid'],
    description: 'Expressive mono lead with a formant-like resonant bandpass, note slide, and hand vibrato',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0.05,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.4,
        velocityToAmplitude: 0.7,
        outputGainDb: 8,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -4 },
          { enabled: true, waveform: 'triangle', octave: 0, semitone: 0, fineCents: 5, levelDb: -8 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        // A bandpass with heavy key tracking is as close to a vowel as one
        // filter gets: the formant follows the note instead of sitting still.
        filter: { type: 'bandpass', cutoffHz: 900, resonance: 0.55, driveDb: 2, keyTrack: 0.7 },
        ampEnvelope: { attack: 0.06, decay: 0.4, sustain: 0.8, release: 0.35 },
        modEnvelope: { attack: 0.14, decay: 0.5, sustain: 0.35, release: 0.4 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 16 }],
        lfo: {
          waveform: 'sine',
          depth: 0.3,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 5.8 },
          route: { target: 'pitch-all', unit: 'semitones', amount: 0.25 },
        },
      },
    },
  },
  {
    id: 'factory-stab-brass',
    name: 'Stab Brass',
    category: 'Brass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'bright', 'percussive', 'detuned', 'filter-env', 'static', 'mid'],
    description: 'House stab: a saw and its fifth, snapped open by a 70 ms filter envelope and gone',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 2,
        unisonDetuneCents: 7,
        stereoWidth: 0.5,
        velocityToAmplitude: 0.9,
        outputGainDb: -3,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -4, levelDb: -4 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 7, fineCents: 4, levelDb: -8 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 1_400, resonance: 0.4, driveDb: 5, keyTrack: 0.4 },
        ampEnvelope: { attack: 0.004, decay: 0.12, sustain: 0.35, release: 0.1 },
        modEnvelope: { attack: 0.002, decay: 0.07, sustain: 0, release: 0.08 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 34 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-dark-sub-pad',
    name: 'Dark Sub Pad',
    category: 'Pad',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'dark', 'sub-osc', 'sustained', 'evolving', 'low'],
    description: 'Deep pad that lives under everything: octave-down triangle and sine with a sub, barely opening',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 2,
        unisonDetuneCents: 9,
        stereoWidth: 0.7,
        velocityToAmplitude: 0.2,
        outputGainDb: -6,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'triangle', octave: -1, semitone: 0, fineCents: -5, levelDb: -4 },
          { enabled: true, waveform: 'sine', octave: -1, semitone: 0, fineCents: 5, levelDb: -8 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -12,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 700, resonance: 0.08, driveDb: 0, keyTrack: 0.2 },
        ampEnvelope: { attack: 1.6, decay: 1.4, sustain: 0.85, release: 2.6 },
        modEnvelope: { attack: 2, decay: 2, sustain: 0.7, release: 2.4 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 6 }],
        lfo: {
          waveform: 'sine',
          depth: 0.25,
          // Half a cycle out of phase with Warm PolyPad's LFO, so the two
          // stacked pads breathe against each other rather than together.
          phaseDegrees: 180,
          triggerMode: 'transport',
          rate: { mode: 'sync', division: { value: 1, modifier: 'straight' } },
          route: { target: 'filter-cutoff', unit: 'semitones', amount: 4 },
        },
      },
    },
  },
  {
    id: 'factory-laser-fx',
    name: 'Laser Zap',
    category: 'FX',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'bright', 'one-shot', 'pitch-env', 'noise', 'percussive', 'static', 'high'],
    description: 'Sci-fi zap: three octaves of pitch collapse in 120 ms over a highpassed noise transient',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.3,
        velocityToAmplitude: 0.8,
        outputGainDb: 3,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -2 },
          { enabled: true, waveform: 'square', octave: 1, semitone: 0, fineCents: 0, levelDb: -10 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: true,
          noiseColor: 'white',
          noiseLevelDb: -26,
        },
        // Highpass, so the zap cuts through a mix instead of thumping under it.
        filter: { type: 'highpass', cutoffHz: 300, resonance: 0.4, driveDb: 3, keyTrack: 0 },
        ampEnvelope: { attack: 0, decay: 0.12, sustain: 0, release: 0.05 },
        modEnvelope: { attack: 0, decay: 0.12, sustain: 0, release: 0.05 },
        env2Routes: [{ target: 'pitch-all', unit: 'semitones', amount: 36 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-mellow-epiano',
    name: 'Mellow E-Piano',
    category: 'Keys',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'warm', 'tremolo', 'sustained', 'filter-env', 'mid'],
    description: 'Soft electric piano: a rounded sine body, a tine an octave up, and a continuous tremolo',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.6,
        velocityToAmplitude: 0.7,
        outputGainDb: -8,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -4 },
          { enabled: true, waveform: 'triangle', octave: 1, semitone: 0, fineCents: 2, levelDb: -16 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 2_200, resonance: 0.1, driveDb: 1, keyTrack: 0.45 },
        ampEnvelope: { attack: 0.006, decay: 1.1, sustain: 0.4, release: 0.6 },
        modEnvelope: { attack: 0.006, decay: 0.45, sustain: 0, release: 0.5 },
        env2Routes: [
          { target: 'filter-cutoff', unit: 'semitones', amount: 14 },
          { target: 'osc2-level', unit: 'db', amount: 6 },
        ],
        lfo: {
          waveform: 'triangle',
          depth: 0.22,
          phaseDegrees: 0,
          // A tremolo circuit runs whether or not a key is down, so this one
          // is transport-triggered: chords in a held voicing wobble together
          // instead of each note starting its own sweep.
          triggerMode: 'transport',
          rate: { mode: 'hz', hz: 5 },
          route: { target: 'amplitude', unit: 'db', amount: -4 },
        },
      },
    },
  },
  {
    id: 'factory-hyper-saw-lead',
    name: 'Hyper Saw Lead',
    category: 'Lead',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'bright', 'detuned', 'sub-osc', 'sustained', 'vibrato', 'high'],
    description: 'Six-voice supersaw with a sub underneath: the widest, brightest thing in the library',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        // Six unison voices per note is the sound. It is also six oscillator
        // pairs per key, which is why the output gain sits 5 dB under the
        // single-oscillator patches.
        unisonVoices: 6,
        unisonDetuneCents: 26,
        stereoWidth: 0.95,
        velocityToAmplitude: 0.65,
        outputGainDb: -12,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -10, levelDb: -4 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 10, levelDb: -4 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -16,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 5_200, resonance: 0.2, driveDb: 3, keyTrack: 0.4 },
        ampEnvelope: { attack: 0.008, decay: 0.35, sustain: 0.8, release: 0.28 },
        modEnvelope: { attack: 0.008, decay: 0.3, sustain: 0.3, release: 0.3 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 12 }],
        lfo: {
          waveform: 'sine',
          depth: 0.1,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 5 },
          route: { target: 'pitch-all', unit: 'semitones', amount: 0.08 },
        },
      },
    },
  },
  {
    id: 'factory-reese-sub-bass',
    name: 'Reese Sub Bass',
    category: 'Bass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'glide', 'warm', 'sub-osc', 'detuned', 'evolving', 'sustained', 'low'],
    description: 'Reese: two saws beating 36 cents apart over an octave-down sub, drifting on a whole-note LFO',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0.05,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.2,
        velocityToAmplitude: 0.6,
        outputGainDb: -12,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -18, levelDb: -3 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 18, levelDb: -3 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -9,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 520, resonance: 0.25, driveDb: 6, keyTrack: 0.35 },
        ampEnvelope: { attack: 0.02, decay: 0.4, sustain: 0.9, release: 0.3 },
        modEnvelope: { attack: 0.02, decay: 0.5, sustain: 0.5, release: 0.35 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 10 }],
        lfo: {
          waveform: 'triangle',
          depth: 0.3,
          phaseDegrees: 0,
          triggerMode: 'transport',
          rate: { mode: 'sync', division: { value: 1, modifier: 'straight' } },
          route: { target: 'filter-cutoff', unit: 'semitones', amount: 5 },
        },
      },
    },
  },
  {
    id: 'factory-celestial-shimmer',
    name: 'Celestial Shimmer',
    category: 'Pad',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'glassy', 'high', 'evolving', 'noise', 'sustained', 'swelling'],
    description: 'High-register dream pad: an octave-up triangle with a twelfth above it that fades in behind it',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 3,
        unisonDetuneCents: 14,
        stereoWidth: 1,
        velocityToAmplitude: 0.18,
        outputGainDb: -8,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'triangle', octave: 1, semitone: 0, fineCents: -6, levelDb: -6 },
          { enabled: true, waveform: 'sine', octave: 2, semitone: 7, fineCents: 6, levelDb: -12 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: true,
          noiseColor: 'pink',
          noiseLevelDb: -34,
        },
        filter: { type: 'lowpass', cutoffHz: 4_200, resonance: 0.1, driveDb: 0, keyTrack: 0.25 },
        // 0.6 s, the attack this patch has always had — NOT the two-plus
        // seconds a "dreamy pad" invites. `deep-ambient` uses this entry as its
        // LEAD, and a melody whose notes take two seconds to arrive does not
        // articulate: at that vibe's tempo a note would be over before it was
        // audible. The long numbers on this patch are the DECAY and the
        // RELEASE, which is where a bloom belongs on a voice that also has to
        // play a line.
        ampEnvelope: { attack: 0.6, decay: 1.6, sustain: 0.75, release: 3.2 },
        // The shimmer ARRIVES rather than being struck: ENV2 is slower than
        // ENV1, so the upper partial fades in behind a fundamental that is
        // already sounding.
        modEnvelope: { attack: 0.9, decay: 2.2, sustain: 0.5, release: 3 },
        env2Routes: [
          { target: 'filter-cutoff', unit: 'semitones', amount: 9 },
          { target: 'osc2-level', unit: 'db', amount: 4 },
        ],
        lfo: {
          waveform: 'triangle',
          depth: 0.35,
          phaseDegrees: 45,
          triggerMode: 'transport',
          rate: { mode: 'sync', division: { value: 2, modifier: 'dotted' } },
          route: { target: 'pan', unit: 'pan', amount: 0.6 },
        },
      },
    },
  },
  {
    id: 'factory-fm-tine-piano',
    name: 'FM Tine Piano',
    category: 'Keys',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'glassy', 'percussive', 'bright', 'filter-env', 'static', 'mid'],
    description: '80s digital tine: a sine body and a two-octave-plus-a-third partial that rings only at the strike',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.5,
        velocityToAmplitude: 0.85,
        outputGainDb: -6,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -4 },
          // Two octaves and a major third up is the tine partial an FM
          // operator ratio would produce; here it is simply tuned there.
          { enabled: true, waveform: 'sine', octave: 2, semitone: 4, fineCents: 0, levelDb: -14 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 5_200, resonance: 0.05, driveDb: 0, keyTrack: 0.55 },
        ampEnvelope: { attack: 0.002, decay: 1.3, sustain: 0.35, release: 0.7 },
        // 90 ms: the whole strike. Both routes share it, so the ping and the
        // brightness arrive and leave together.
        modEnvelope: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.2 },
        env2Routes: [
          { target: 'osc2-level', unit: 'db', amount: 10 },
          { target: 'filter-cutoff', unit: 'semitones', amount: 18 },
        ],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-trance-pluck',
    name: 'Trance Pluck',
    category: 'Pluck',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'bright', 'plucked', 'resonant', 'filter-env', 'detuned', 'static'],
    description: 'Ultra-fast saw pluck with an octave-down body and a resonant envelope bite that settles as it decays',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 2,
        unisonDetuneCents: 11,
        stereoWidth: 0.7,
        velocityToAmplitude: 0.8,
        outputGainDb: 2,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -6, levelDb: -4 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: -12, fineCents: 6, levelDb: -7 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 900, resonance: 0.75, driveDb: 4, keyTrack: 0.6 },
        ampEnvelope: { attack: 0.001, decay: 0.22, sustain: 0.05, release: 0.18 },
        modEnvelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.12 },
        // The NEGATIVE resonance route is the difference between a pluck and a
        // squeal: the peak is tamed exactly while the cutoff is at its
        // highest, then resonance returns as the note dies.
        env2Routes: [
          { target: 'filter-cutoff', unit: 'semitones', amount: 38 },
          { target: 'filter-resonance', unit: 'normalized', amount: -0.1 },
        ],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-noise-riser-fx',
    name: 'Noise Riser FX',
    category: 'FX',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'noise', 'one-shot', 'swelling', 'filter-env', 'bright', 'static', 'high'],
    description: 'Transition riser: white noise swelling for two seconds while a bandpass climbs four octaves, then nothing',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.8,
        velocityToAmplitude: 0.4,
        outputGainDb: 6,
      },
      synth: {
        oscillators: [
          // A thin pitched thread under the noise, so the riser still tracks
          // the note it was triggered from. It is 26 dB down: the noise is
          // the instrument.
          { enabled: true, waveform: 'sawtooth', octave: 1, semitone: 0, fineCents: 0, levelDb: -26 },
          { enabled: false, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -96 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: true,
          noiseColor: 'white',
          noiseLevelDb: -6,
        },
        filter: { type: 'bandpass', cutoffHz: 400, resonance: 0.5, driveDb: 0, keyTrack: 0 },
        // Attack IS the riser and sustain is zero, so the gesture ends by
        // itself: hold it under a build and it drops on its own.
        ampEnvelope: { attack: 1.8, decay: 0.3, sustain: 0, release: 0.2 },
        modEnvelope: { attack: 1.8, decay: 0.3, sustain: 0, release: 0.2 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 48 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-neon-poly-saw',
    name: 'Neon Poly Saw',
    category: 'Pad',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'unison', 'warm', 'detuned', 'sub-osc', 'sustained', 'filter-env', 'mid'],
    description: 'Juno-style poly saw for 80s chord beds: eight-cent detune, a square sub, and a quarter-note filter breath',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 2,
        unisonDetuneCents: 12,
        stereoWidth: 0.75,
        velocityToAmplitude: 0.45,
        outputGainDb: -8,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -8, levelDb: -5 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 8, levelDb: -5 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -14,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 2_600, resonance: 0.18, driveDb: 1, keyTrack: 0.35 },
        // Timed against its own vibe: at 118 BPM an eighth is ~254 ms, so the
        // attack lands well inside one and the release outlasts the gap —
        // consecutive stabs glue into a bed instead of chattering.
        ampEnvelope: { attack: 0.02, decay: 0.45, sustain: 0.7, release: 0.3 },
        modEnvelope: { attack: 0.02, decay: 0.5, sustain: 0.25, release: 0.35 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 16 }],
        lfo: {
          waveform: 'triangle',
          depth: 0.12,
          phaseDegrees: 0,
          triggerMode: 'transport',
          rate: { mode: 'sync', division: { value: 4, modifier: 'straight' } },
          route: { target: 'filter-cutoff', unit: 'semitones', amount: 3 },
        },
      },
    },
  },
  {
    id: 'factory-koto-pluck',
    name: 'Koto Pluck',
    category: 'Pluck',
    engine: 'subtractive',
    isFactory: true,
    tags: ['poly', 'warm', 'plucked', 'sub-osc', 'noise', 'filter-env', 'static', 'mid'],
    description: 'Silk-string pluck: a triangle and its octave over a sub, with a real noise pick transient and a long ring',
    patch: {
      common: {
        voiceMode: 'poly',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.45,
        velocityToAmplitude: 0.75,
        outputGainDb: -4,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'triangle', octave: 0, semitone: 0, fineCents: 0, levelDb: -4 },
          { enabled: true, waveform: 'triangle', octave: 0, semitone: 12, fineCents: 3, levelDb: -16 },
        ],
        utility: {
          // The old entry carried a `noiseVolume` the synth path never read,
          // so its "pick transient" was authored intent and silence. The
          // utility noise generator is real, so this one actually ticks.
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -16,
          noiseEnabled: true,
          noiseColor: 'white',
          noiseLevelDb: -34,
        },
        filter: { type: 'lowpass', cutoffHz: 1_600, resonance: 0.3, driveDb: 1, keyTrack: 0.5 },
        // Decay plus release covers most of a bar at 78 BPM (~3.1 s): the
        // ring is the character, and it is what separates this from the two
        // short plucks above.
        ampEnvelope: { attack: 0.003, decay: 1.6, sustain: 0.12, release: 1.1 },
        modEnvelope: { attack: 0.003, decay: 0.5, sustain: 0.08, release: 0.5 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 26 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-fx-down-sweep',
    name: 'Down Sweep',
    category: 'FX',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'one-shot', 'pitch-env', 'sweeping', 'dark', 'static', 'mid'],
    description: 'The reference falling sweep: a bare sine dropped four octaves by ENV2 over 1.4 seconds',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.4,
        velocityToAmplitude: 0.5,
        outputGainDb: -7,
      },
      synth: {
        // Deliberately ONE oscillator and no filter movement. This patch is an
        // acceptance fixture as well as a sound: the DSP tests read the pitch
        // contour off it, and a second source or a filter sweep would make the
        // measurement ambiguous. The design doc pins every value below.
        oscillators: [
          { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -3 },
          { enabled: false, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -96 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 12_000, resonance: 0.1, driveDb: 0, keyTrack: 0 },
        ampEnvelope: { attack: 0, decay: 1.4, sustain: 0, release: 0.15 },
        modEnvelope: { attack: 0, decay: 1.4, sustain: 0, release: 0.15 },
        // +48 with zero attack: the note starts four octaves ABOVE the key and
        // the decay walks it back down to it.
        env2Routes: [{ target: 'pitch-all', unit: 'semitones', amount: 48 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4 },
          route: null,
        },
      },
    },
  },
  {
    id: 'factory-fx-up-sweep',
    name: 'Up Sweep',
    category: 'FX',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'one-shot', 'pitch-env', 'sweeping', 'bright', 'static', 'high'],
    description: 'The rising counterpart: a triangle and a gritty saw starting three and a half octaves low and climbing back',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.45,
        velocityToAmplitude: 0.5,
        outputGainDb: 4,
      },
      synth: {
        // NOT the down-sweep with a sign flipped. A rising gesture reads as
        // brighter the higher it goes, so this one has a saw partner and a
        // softer onset; the down-sweep is a bare sine because it doubles as a
        // measurement fixture and this one does not.
        oscillators: [
          { enabled: true, waveform: 'triangle', octave: 0, semitone: 0, fineCents: 0, levelDb: -4 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 7, levelDb: -18 },
        ],
        utility: {
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 9_000, resonance: 0.15, driveDb: 2, keyTrack: 0 },
        ampEnvelope: { attack: 0.02, decay: 1.6, sustain: 0, release: 0.2 },
        modEnvelope: { attack: 0, decay: 1.6, sustain: 0, release: 0.2 },
        // NEGATIVE: ENV2 drops the pitch at note-on and the decay climbs back
        // to the key. The sign is the whole difference between the two sweeps.
        env2Routes: [{ target: 'pitch-all', unit: 'semitones', amount: -42 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 4 },
          route: null,
        },
      },
    },
  },
  {
    id: 'bass-deep-sine',
    name: 'Deep Sine Sub',
    category: 'Bass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'glide', 'dark', 'sub', 'sub-osc', 'sustained', 'static', 'low'],
    description: 'The plainest low end there is: one sine an octave down with a sub under it and almost no filter',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0.03,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0,
        velocityToAmplitude: 0.7,
        outputGainDb: -13,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -2 },
          { enabled: false, waveform: 'sine', octave: 0, semitone: 0, fineCents: 0, levelDb: -96 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -8,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 240, resonance: 0.08, driveDb: 2, keyTrack: 0.4 },
        ampEnvelope: { attack: 0.008, decay: 0.25, sustain: 0.9, release: 0.45 },
        // Four semitones of cutoff over 100 ms: just enough thump for the
        // note to have an edge without turning it into a pluck.
        modEnvelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.2 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 4 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 3 },
          route: null,
        },
      },
    },
  },
  {
    id: 'bass-round-pluck',
    name: 'Round Pluck',
    category: 'Bass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'glide', 'warm', 'plucked', 'sub-osc', 'detuned', 'filter-env', 'static', 'low'],
    description: 'Soft finger-bass pluck: a four-cent triangle pair over a sub, opened briefly and let go',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0.02,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.15,
        velocityToAmplitude: 0.75,
        outputGainDb: -4,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'triangle', octave: 0, semitone: 0, fineCents: -4, levelDb: -3 },
          { enabled: true, waveform: 'triangle', octave: 0, semitone: 0, fineCents: 4, levelDb: -9 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -14,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 420, resonance: 0.45, driveDb: 3, keyTrack: 0.55 },
        ampEnvelope: { attack: 0.004, decay: 0.28, sustain: 0.35, release: 0.22 },
        modEnvelope: { attack: 0.004, decay: 0.3, sustain: 0.08, release: 0.28 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 24 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 3 },
          route: null,
        },
      },
    },
  },
  {
    id: 'bass-punchy-square',
    name: 'Punchy Square',
    category: 'Bass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'glide', 'bright', 'percussive', 'sub-osc', 'filter-env', 'static', 'low'],
    description: 'Tight square bassline with a saw shadow eight cents flat and a 160 ms decay',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0.01,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.1,
        velocityToAmplitude: 0.8,
        outputGainDb: -9,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'square', octave: 0, semitone: 0, fineCents: 0, levelDb: -3 },
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: -8, levelDb: -11 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -11,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 560, resonance: 0.25, driveDb: 5, keyTrack: 0.5 },
        ampEnvelope: { attack: 0.003, decay: 0.16, sustain: 0.5, release: 0.13 },
        modEnvelope: { attack: 0.003, decay: 0.16, sustain: 0.2, release: 0.16 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 9 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 3 },
          route: null,
        },
      },
    },
  },
  {
    id: 'bass-saw-growl',
    name: 'Saw Growl',
    category: 'Bass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'glide', 'gritty', 'resonant', 'sub-osc', 'filter-env', 'sustained', 'static', 'low'],
    description: 'Driven saw bass with an octave-down partner and a resonant peak that growls under the note',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0.03,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.2,
        velocityToAmplitude: 0.7,
        outputGainDb: -9,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -3 },
          { enabled: true, waveform: 'sawtooth', octave: -1, semitone: 0, fineCents: 6, levelDb: -12 },
        ],
        utility: {
          subEnabled: true,
          subOctave: -1,
          subLevelDb: -13,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 760, resonance: 0.72, driveDb: 8, keyTrack: 0.5 },
        ampEnvelope: { attack: 0.01, decay: 0.22, sustain: 0.6, release: 0.28 },
        modEnvelope: { attack: 0.01, decay: 0.26, sustain: 0.3, release: 0.28 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 14 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 3 },
          route: null,
        },
      },
    },
  },
  {
    id: 'bass-warm-tri',
    name: 'Warm Triangle',
    category: 'Bass',
    engine: 'subtractive',
    isFactory: true,
    tags: ['mono', 'glide', 'warm', 'sustained', 'static', 'low'],
    description: 'The soft one: a triangle with a sine beside it, no sub, no bite — a bass that sits behind the mix',
    patch: {
      common: {
        voiceMode: 'mono',
        glideSeconds: 0.04,
        unisonVoices: 1,
        unisonDetuneCents: 0,
        stereoWidth: 0.1,
        velocityToAmplitude: 0.55,
        outputGainDb: -11,
      },
      synth: {
        oscillators: [
          { enabled: true, waveform: 'triangle', octave: 0, semitone: 0, fineCents: 0, levelDb: -2 },
          { enabled: true, waveform: 'sine', octave: 0, semitone: 0, fineCents: 3, levelDb: -10 },
        ],
        utility: {
          // The only sub-less bass in the set, on purpose: it is the entry for
          // a mix that already has low end and needs a note, not weight.
          subEnabled: false,
          subOctave: -1,
          subLevelDb: -96,
          noiseEnabled: false,
          noiseColor: 'white',
          noiseLevelDb: -96,
        },
        filter: { type: 'lowpass', cutoffHz: 380, resonance: 0.06, driveDb: 1, keyTrack: 0.3 },
        ampEnvelope: { attack: 0.03, decay: 0.32, sustain: 0.8, release: 0.5 },
        modEnvelope: { attack: 0.03, decay: 0.3, sustain: 0.2, release: 0.4 },
        env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 3 }],
        lfo: {
          waveform: 'sine',
          depth: 0,
          phaseDegrees: 0,
          triggerMode: 'note',
          rate: { mode: 'hz', hz: 3 },
          route: null,
        },
      },
    },
  },
];
