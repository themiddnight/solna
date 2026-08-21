import { SynthParams } from '../types';

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
    description: 'Bright soaring lead with detuned oscillators and resonant lowpass cutoff',
    params: {
      oscType: 'sawtooth',
      subOscVolume: 0.2,
      noiseVolume: 0.05,
      detune: 5,
      filterType: 'lowpass',
      filterCutoff: 2800,
      filterResonance: 3.5,
      filterEnvAmount: 1200,
      attack: 0.02,
      decay: 0.3,
      sustain: 0.7,
      release: 0.4,
      filterAttack: 0.02,
      filterDecay: 0.3,
      filterSustain: 0,
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
      filterEnvAmount: 200,
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
    description: 'Lush ambient triangle pad with slow attack and cutoff modulation',
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
      filterAttack: 0.4,
      filterDecay: 0.8,
      filterSustain: 0,
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
      filterDecay: 0.2,
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
      filterSustain: 0,
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
    description: 'Analog synth brass with medium swell attack and tremolo modulation',
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
      filterAttack: 0.08,
      filterDecay: 0.4,
      filterSustain: 0,
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
      filterAttack: 0.8,
      filterDecay: 1.5,
      filterSustain: 0,
      filterRelease: 2.0,
      lfoRate: 0.2,
      lfoDepth: 0.4,
      lfoTarget: 'cutoff',
      octave: -1,
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
