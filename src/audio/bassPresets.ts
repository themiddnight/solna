import type { SynthPresetItem } from './synthPresets';

export const FACTORY_BASS_PRESETS: SynthPresetItem[] = [
  {
    id: 'bass-deep-sine', name: 'Deep Sine Sub', category: 'Bass', isFactory: true,
    params: { oscType: 'sine', subOscVolume: 0.9, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 220, filterResonance: 1, filterEnvAmount: 0,
      attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.6,
      filterAttack: 0.01, filterDecay: 0.1, filterSustain: 1, filterRelease: 0.3,
      lfoRate: 4, lfoDepth: 0, lfoTarget: 'volume', octave: 0 },
  },
  {
    id: 'bass-round-pluck', name: 'Round Pluck', category: 'Bass', isFactory: true,
    params: { oscType: 'triangle', subOscVolume: 0.4, noiseVolume: 0, detune: 4,
      filterType: 'lowpass', filterCutoff: 400, filterResonance: 4, filterEnvAmount: 900,
      attack: 0.005, decay: 0.25, sustain: 0.4, release: 0.25,
      filterAttack: 0.005, filterDecay: 0.3, filterSustain: 0.1, filterRelease: 0.3,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0 },
  },
  {
    id: 'bass-punchy-square', name: 'Punchy Square', category: 'Bass', isFactory: true,
    params: { oscType: 'square', subOscVolume: 0.6, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 500, filterResonance: 2, filterEnvAmount: 300,
      attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.15,
      filterAttack: 0.005, filterDecay: 0.15, filterSustain: 0.2, filterRelease: 0.2,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0 },
  },
  {
    id: 'bass-saw-growl', name: 'Saw Growl', category: 'Bass', isFactory: true,
    params: { oscType: 'sawtooth', subOscVolume: 0.5, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 700, filterResonance: 6, filterEnvAmount: 500,
      attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3,
      filterAttack: 0.01, filterDecay: 0.25, filterSustain: 0.3, filterRelease: 0.3,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0 },
  },
  {
    id: 'bass-warm-tri', name: 'Warm Triangle', category: 'Bass', isFactory: true,
    params: { oscType: 'triangle', subOscVolume: 0.3, noiseVolume: 0, detune: 0,
      filterType: 'lowpass', filterCutoff: 350, filterResonance: 1, filterEnvAmount: 0,
      attack: 0.03, decay: 0.3, sustain: 0.8, release: 0.5,
      filterAttack: 0.03, filterDecay: 0.3, filterSustain: 1, filterRelease: 0.4,
      lfoRate: 0, lfoDepth: 0, lfoTarget: 'volume', octave: 0 },
  },
];
