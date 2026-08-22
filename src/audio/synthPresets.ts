import { SynthParams } from '../types';
import { FACTORY_BASS_PRESETS } from './bassPresets';

export interface SynthPresetItem {
  id: string;
  name: string;
  category: 'Lead' | 'Bass' | 'Pad' | 'Keys' | 'Pluck' | 'Brass' | 'FX' | 'User';
  params: Partial<SynthParams>;
  isFactory?: boolean;
  createdAt?: number;
  author?: string;
  description?: string;
}

export const FACTORY_PRESETS: SynthPresetItem[] = [
  {
    id: 'factory-cosmic-lead',
    name: 'Cosmic Lead',
    category: 'Lead',
    isFactory: true,
    description: 'Bright soaring lead with detuned oscillators and a resonant filter sweep',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.2,
      noiseVolume: 0.05,
      detune: 5,
      filterType: 'lowpass',
      filterCutoff: 2800,
      filterResonance: 3.5,
      filterEnvAmount: 1500,
      attack: 0.02,
      decay: 0.3,
      sustain: 0.7,
      release: 0.4,
      filterAttack: 0.02,
      filterDecay: 0.3,
      filterSustain: 0.25,
      filterRelease: 0.4,
      lfoRate: 4,
      lfoDepth: 0.15,
      lfoTarget: 'cutoff',
      octave: 0,
    },
  },
  {
    id: 'factory-808-deep-bass',
    name: '808 Deep Bass',
    category: 'Bass',
    isFactory: true,
    description: 'Sub-heavy pure sine bass with punchy envelope decay',
    params: {
      oscType: 'sine',
      subOscVolume: 0.8,
      noiseVolume: 0.0,
      detune: 0,
      filterType: 'lowpass',
      filterCutoff: 450,
      filterResonance: 1.5,
      filterEnvAmount: 300,
      attack: 0.005,
      decay: 0.5,
      sustain: 0.4,
      release: 0.35,
      filterAttack: 0.005,
      filterDecay: 0.5,
      filterSustain: 0,
      filterRelease: 0.35,
      lfoRate: 1,
      lfoDepth: 0.0,
      lfoTarget: 'pitch',
      octave: -1,
    },
  },
  {
    id: 'factory-warm-polypad',
    name: 'Warm PolyPad',
    category: 'Pad',
    isFactory: true,
    description: 'Lush ambient triangle pad whose filter slowly opens and settles',
    params: {
      oscType: 'triangle',
      subOscVolume: 0.3,
      noiseVolume: 0.02,
      detune: 10,
      filterType: 'lowpass',
      filterCutoff: 1400,
      filterResonance: 2.0,
      filterEnvAmount: 600,
      attack: 0.4,
      decay: 0.8,
      sustain: 0.85,
      release: 1.2,
      filterAttack: 0.6,
      filterDecay: 0.8,
      filterSustain: 0.5,
      filterRelease: 1.2,
      lfoRate: 0.5,
      lfoDepth: 0.25,
      lfoTarget: 'cutoff',
      octave: 0,
    },
  },
  {
    id: 'factory-acid-synth',
    name: 'Acid Synth',
    category: 'Bass',
    isFactory: true,
    description: 'High resonance TB-303 style squelch with fast snappy envelope',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.4,
      noiseVolume: 0.0,
      detune: 0,
      filterType: 'lowpass',
      filterCutoff: 1200,
      filterResonance: 12.0,
      filterEnvAmount: 3500,
      attack: 0.005,
      decay: 0.2,
      sustain: 0.15,
      release: 0.2,
      filterAttack: 0.005,
      filterDecay: 0.25,
      filterSustain: 0,
      filterRelease: 0.2,
      lfoRate: 6,
      lfoDepth: 0.4,
      lfoTarget: 'cutoff',
      octave: -1,
    },
  },
  {
    id: 'factory-dream-keys',
    name: 'Dream Keys',
    category: 'Keys',
    isFactory: true,
    description: 'Soft chime-like electric keyboard tones with delicate vibrato',
    params: {
      oscType: 'sine',
      subOscVolume: 0.1,
      noiseVolume: 0.01,
      detune: 4,
      filterType: 'lowpass',
      filterCutoff: 3200,
      filterResonance: 1.2,
      filterEnvAmount: 800,
      attack: 0.01,
      decay: 0.6,
      sustain: 0.4,
      release: 0.6,
      filterAttack: 0.01,
      filterDecay: 0.6,
      filterSustain: 0.3,
      filterRelease: 0.6,
      lfoRate: 2.5,
      lfoDepth: 0.1,
      lfoTarget: 'pitch',
      octave: 0,
    },
  },
  {
    id: 'factory-pluck',
    name: 'Neon Pluck',
    category: 'Pluck',
    isFactory: true,
    description: 'Crisp square-wave pluck with instant attack and fast decay',
    params: {
      oscType: 'square',
      subOscVolume: 0.2,
      noiseVolume: 0.05,
      detune: 8,
      filterType: 'lowpass',
      filterCutoff: 4000,
      filterResonance: 4.0,
      filterEnvAmount: 2800,
      attack: 0.005,
      decay: 0.15,
      sustain: 0.05,
      release: 0.25,
      filterAttack: 0.005,
      filterDecay: 0.15,
      filterSustain: 0,
      filterRelease: 0.25,
      lfoRate: 0.5,
      lfoDepth: 0.0,
      lfoTarget: 'cutoff',
      octave: 0,
    },
  },
  {
    id: 'factory-vintage-brass',
    name: 'Vintage Brass',
    category: 'Brass',
    isFactory: true,
    description: 'Analog synth brass with a swelling filter and tremolo modulation',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.35,
      noiseVolume: 0.03,
      detune: 12,
      filterType: 'lowpass',
      filterCutoff: 2100,
      filterResonance: 2.8,
      filterEnvAmount: 1800,
      attack: 0.08,
      decay: 0.4,
      sustain: 0.6,
      release: 0.5,
      filterAttack: 0.12,
      filterDecay: 0.4,
      filterSustain: 0.45,
      filterRelease: 0.5,
      lfoRate: 5,
      lfoDepth: 0.15,
      lfoTarget: 'volume',
      octave: 0,
    },
  },
  {
    id: 'factory-cyber-drone',
    name: 'Cyber Drone',
    category: 'FX',
    isFactory: true,
    description: 'Cinematic sweeping bandpass drone with slow undulating LFO',
    params: {
      oscType: 'square',
      subOscVolume: 0.6,
      noiseVolume: 0.1,
      detune: 18,
      filterType: 'bandpass',
      filterCutoff: 1100,
      filterResonance: 6.0,
      filterEnvAmount: 400,
      attack: 0.8,
      decay: 1.5,
      sustain: 0.9,
      release: 2.0,
      filterAttack: 1.0,
      filterDecay: 1.5,
      filterSustain: 0.6,
      filterRelease: 2.0,
      lfoRate: 0.2,
      lfoDepth: 0.4,
      lfoTarget: 'cutoff',
      octave: -1,
    },
  },
  {
    id: 'factory-string-ensemble',
    name: 'String Ensemble',
    category: 'Pad',
    isFactory: true,
    description: 'Slow-attack detuned saw pad that blooms open like bowed strings',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.25,
      noiseVolume: 0.02,
      detune: 14,
      filterType: 'lowpass',
      filterCutoff: 1900,
      filterResonance: 2.2,
      filterEnvAmount: 700,
      attack: 0.35,
      decay: 0.9,
      sustain: 0.8,
      release: 1.5,
      filterAttack: 0.5,
      filterDecay: 1.4,
      filterSustain: 0.5,
      filterRelease: 1.5,
      lfoRate: 0.6,
      lfoDepth: 0.2,
      lfoTarget: 'cutoff',
      octave: 0,
    },
  },
  {
    id: 'factory-wobble-bass',
    name: 'Wobble Bass',
    category: 'Bass',
    isFactory: true,
    description: 'Dubstep-style wobble driven by a fast LFO on the filter cutoff',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.5,
      noiseVolume: 0.0,
      detune: 0,
      filterType: 'lowpass',
      filterCutoff: 800,
      filterResonance: 6.0,
      filterEnvAmount: 300,
      attack: 0.005,
      decay: 0.3,
      sustain: 0.5,
      release: 0.3,
      filterAttack: 0.005,
      filterDecay: 0.3,
      filterSustain: 0.1,
      filterRelease: 0.3,
      lfoRate: 4.0,
      lfoDepth: 0.5,
      lfoTarget: 'cutoff',
      octave: -2,
    },
  },
  {
    id: 'factory-glocken-bell',
    name: 'Glocken Bell',
    category: 'Keys',
    isFactory: true,
    description: 'Pure bell tone with a long crystalline decay, one octave up',
    params: {
      oscType: 'sine',
      subOscVolume: 0.05,
      noiseVolume: 0.0,
      detune: 2,
      filterType: 'lowpass',
      filterCutoff: 5000,
      filterResonance: 1.0,
      filterEnvAmount: 500,
      attack: 0.002,
      decay: 1.8,
      sustain: 0.05,
      release: 1.2,
      filterAttack: 0.002,
      filterDecay: 1.0,
      filterSustain: 0,
      filterRelease: 1.2,
      lfoRate: 0.3,
      lfoDepth: 0.0,
      lfoTarget: 'cutoff',
      octave: 1,
    },
  },
  {
    id: 'factory-vocal-lead',
    name: 'Vocal Lead',
    category: 'Lead',
    isFactory: true,
    description: 'Expressive lead with a formant-like filter swell and vibrato',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.2,
      noiseVolume: 0.03,
      detune: 6,
      filterType: 'lowpass',
      filterCutoff: 3200,
      filterResonance: 5.0,
      filterEnvAmount: 1600,
      attack: 0.15,
      decay: 0.4,
      sustain: 0.65,
      release: 0.5,
      filterAttack: 0.15,
      filterDecay: 0.5,
      filterSustain: 0.2,
      filterRelease: 0.5,
      lfoRate: 5.0,
      lfoDepth: 0.12,
      lfoTarget: 'pitch',
      octave: 0,
    },
  },
  {
    id: 'factory-stab-brass',
    name: 'Stab Brass',
    category: 'Brass',
    isFactory: true,
    description: 'Punchy house stab with a lightning-fast filter snap',
    params: {
      oscType: 'square',
      subOscVolume: 0.4,
      noiseVolume: 0.02,
      detune: 10,
      filterType: 'lowpass',
      filterCutoff: 2600,
      filterResonance: 3.0,
      filterEnvAmount: 2400,
      attack: 0.005,
      decay: 0.35,
      sustain: 0.2,
      release: 0.3,
      filterAttack: 0.005,
      filterDecay: 0.25,
      filterSustain: 0,
      filterRelease: 0.3,
      lfoRate: 0.5,
      lfoDepth: 0.0,
      lfoTarget: 'volume',
      octave: 0,
    },
  },
  {
    id: 'factory-dark-sub-pad',
    name: 'Dark Sub Pad',
    category: 'Pad',
    isFactory: true,
    description: 'Deep sub-heavy pad that stays dark and open underneath',
    params: {
      oscType: 'triangle',
      subOscVolume: 0.7,
      noiseVolume: 0.01,
      detune: 8,
      filterType: 'lowpass',
      filterCutoff: 700,
      filterResonance: 1.8,
      filterEnvAmount: 300,
      attack: 0.5,
      decay: 1.2,
      sustain: 0.85,
      release: 2.0,
      filterAttack: 0.6,
      filterDecay: 1.5,
      filterSustain: 0.7,
      filterRelease: 2.0,
      lfoRate: 0.15,
      lfoDepth: 0.15,
      lfoTarget: 'cutoff',
      octave: -1,
    },
  },
  {
    id: 'factory-laser-fx',
    name: 'Laser FX',
    category: 'FX',
    isFactory: true,
    description: 'Sci-fi zaps: highpass sweep with aggressive pitch LFO wobble',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.0,
      noiseVolume: 0.05,
      detune: 0,
      filterType: 'highpass',
      filterCutoff: 1200,
      filterResonance: 8.0,
      filterEnvAmount: 2500,
      attack: 0.3,
      decay: 0.4,
      sustain: 0.6,
      release: 1.0,
      filterAttack: 0.3,
      filterDecay: 0.5,
      filterSustain: 0.4,
      filterRelease: 1.0,
      lfoRate: 8.0,
      lfoDepth: 0.5,
      lfoTarget: 'pitch',
      octave: 1,
    },
  },
  {
    id: 'factory-mellow-epiano',
    name: 'Mellow E-Piano',
    category: 'Keys',
    isFactory: true,
    description: 'Soft electric piano with gentle tremolo and a rounded filter',
    params: {
      oscType: 'sine',
      subOscVolume: 0.15,
      noiseVolume: 0.01,
      detune: 3,
      filterType: 'lowpass',
      filterCutoff: 2800,
      filterResonance: 1.5,
      filterEnvAmount: 400,
      attack: 0.02,
      decay: 0.9,
      sustain: 0.35,
      release: 0.8,
      filterAttack: 0.02,
      filterDecay: 0.9,
      filterSustain: 0.2,
      filterRelease: 0.8,
      lfoRate: 4.5,
      lfoDepth: 0.08,
      lfoTarget: 'volume',
      octave: 0,
    },
  },
];

const STORAGE_KEY = 'murva_synth_custom_presets_v1';

export function getCustomPresets(): SynthPresetItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.warn('Failed to load synth presets from localStorage:', err);
  }
  return [];
}

export function saveCustomPreset(
  name: string,
  params: SynthParams,
  category: SynthPresetItem['category'] = 'User',
  description = ''
): SynthPresetItem {
  const current = getCustomPresets();
  const id = `user-preset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  
  // Extract pure sound params
  const { preset, ...pureParams } = params;
  const newPreset: SynthPresetItem = {
    id,
    name: name.trim() || 'Untitled Preset',
    category,
    isFactory: false,
    createdAt: Date.now(),
    description: description.trim() || 'Custom user preset',
    params: { ...pureParams },
  };

  const updated = [newPreset, ...current];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save preset to localStorage:', err);
  }
  return newPreset;
}

export function updateCustomPreset(
  id: string,
  updates: Partial<SynthPresetItem>
): SynthPresetItem[] {
  const current = getCustomPresets();
  const updated = current.map((p) => (p.id === id ? { ...p, ...updates } : p));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to update preset in localStorage:', err);
  }
  return updated;
}

export function deleteCustomPreset(id: string): SynthPresetItem[] {
  const current = getCustomPresets();
  const updated = current.filter((p) => p.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to delete preset from localStorage:', err);
  }
  return updated;
}

export const ALL_FACTORY_PRESETS: SynthPresetItem[] = [
  ...FACTORY_PRESETS,
  ...FACTORY_BASS_PRESETS,
];

export function getAllSynthPresets(custom: SynthPresetItem[]): SynthPresetItem[] {
  return [...custom, ...ALL_FACTORY_PRESETS];
}

export function findPresetByName(name: string, presets: SynthPresetItem[]): SynthPresetItem | undefined {
  if (!name) return undefined;
  return presets.find((p) => p.name === name);
}
