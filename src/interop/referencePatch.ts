import type { EnginePatch } from '@/types/synth';

/**
 * A patch with every leaf present and every optional slot filled: both ENV2
 * routes and the LFO route. A consumer walks it to prove its own mapping
 * covers the whole patch shape, so a leaf added to `EnginePatch` fails that
 * consumer's test on its next bundle update instead of being dropped silently.
 *
 * Typed as the app's own patch, not the contract's: this file stops compiling
 * the day `EnginePatch` gains a required field it does not set.
 */
export const SOLNA_REFERENCE_PATCH: EnginePatch<'subtractive'> = {
  common: {
    voiceMode: 'poly',
    glideSeconds: 0.05,
    unisonVoices: 3,
    unisonDetuneCents: 12,
    stereoWidth: 0.5,
    velocityToAmplitude: 0.6,
    outputGainDb: -3,
  },
  synth: {
    oscillators: [
      { enabled: true, waveform: 'sawtooth', octave: 0, semitone: 0, fineCents: 0, levelDb: -6 },
      { enabled: true, waveform: 'square', octave: -1, semitone: 7, fineCents: 5, levelDb: -9 },
    ],
    utility: {
      subEnabled: true,
      subOctave: -2,
      subLevelDb: -12,
      noiseEnabled: true,
      noiseColor: 'pink',
      noiseLevelDb: -24,
    },
    filter: { type: 'lowpass', cutoffHz: 1200, resonance: 0.3, driveDb: 3, keyTrack: 0.5 },
    ampEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
    modEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 0.5 },
    env2Routes: [
      { target: 'filter-cutoff', unit: 'semitones', amount: 12 },
      { target: 'osc2-level', unit: 'db', amount: -3 },
    ],
    lfo: {
      waveform: 'triangle',
      depth: 0.5,
      phaseDegrees: 90,
      triggerMode: 'note',
      rate: { mode: 'sync', division: { value: 8, modifier: 'dotted' } },
      route: { target: 'pan', unit: 'pan', amount: 0.4 },
    },
  },
};
