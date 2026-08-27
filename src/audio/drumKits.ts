export interface KickParams {
  freqStart: number;
  freqEnd: number;
  pitchTime: number;
  decay: number;
  gain: number;
  clickFreq?: number;
  clickLevel?: number;
  clickDecay?: number;
}

export interface SnareParams {
  bodyFreqStart: number;
  bodyFreqEnd: number;
  bodyTime: number;
  bodyDecay: number;
  bodyGain: number;
  noiseFilter: number;
  noiseDecay: number;
  noiseGain: number;
  reverbSend: number;
}

export interface HatParams {
  filter: number;
  decay: number;
  gain: number;
}

export interface ClapParams {
  filter: number;
  decay: number;
  gain: number;
  reverbSend: number;
}

export interface TomParams {
  freqStart: number;
  freqEnd: number;
  pitchTime: number;
  decay: number;
  gain: number;
}

export interface CrashParams {
  filter: number;
  decay: number;
  gain: number;
  reverbSend: number;
}

export interface DrumKit {
  kick: KickParams;
  snare: SnareParams;
  hihat: HatParams;
  openhat: HatParams;
  clap: ClapParams;
  tom: TomParams;
  crash: CrashParams;
}

export const DEFAULT_DRUM_KIT: DrumKit = {
  kick: { freqStart: 150, freqEnd: 35, pitchTime: 0.12, decay: 0.35, gain: 0.9 },
  snare: { bodyFreqStart: 220, bodyFreqEnd: 90, bodyTime: 0.08, bodyDecay: 0.15, bodyGain: 0.5, noiseFilter: 1000, noiseDecay: 0.22, noiseGain: 0.6, reverbSend: 0.3 },
  hihat: { filter: 7500, decay: 0.05, gain: 0.4 },
  openhat: { filter: 6500, decay: 0.35, gain: 0.45 },
  clap: { filter: 1200, decay: 0.2, gain: 0.5, reverbSend: 0.3 },
  tom: { freqStart: 140, freqEnd: 65, pitchTime: 0.2, decay: 0.28, gain: 0.7 },
  crash: { filter: 5500, decay: 0.9, gain: 0.5, reverbSend: 0.4 },
};

export const DRUM_KITS: Record<string, Partial<DrumKit>> = {
  'Retro Drive': {
    kick: { freqStart: 130, freqEnd: 42, pitchTime: 0.07, decay: 0.2, gain: 0.85 },
    snare: { bodyFreqStart: 210, bodyFreqEnd: 175, bodyTime: 0.08, bodyDecay: 0.18, bodyGain: 0.5, noiseFilter: 1600, noiseDecay: 0.2, noiseGain: 0.6, reverbSend: 0.4 },
    hihat: { filter: 7200, decay: 0.04, gain: 0.35 },
    openhat: { filter: 6500, decay: 0.3, gain: 0.4 },
    clap: { filter: 1400, decay: 0.32, gain: 0.65, reverbSend: 0.45 },
    tom: { freqStart: 150, freqEnd: 85, pitchTime: 0.18, decay: 0.22, gain: 0.65 },
    crash: { filter: 6000, decay: 0.9, gain: 0.55, reverbSend: 0.4 },
  },
  '909 Modern': {
    kick: { freqStart: 95, freqEnd: 50, pitchTime: 0.06, decay: 0.28, gain: 0.95, clickFreq: 1200, clickLevel: 0.25, clickDecay: 0.015 },
    snare: { bodyFreqStart: 240, bodyFreqEnd: 180, bodyTime: 0.08, bodyDecay: 0.15, bodyGain: 0.5, noiseFilter: 1700, noiseDecay: 0.2, noiseGain: 0.65, reverbSend: 0.3 },
    hihat: { filter: 8500, decay: 0.035, gain: 0.35 },
    openhat: { filter: 7000, decay: 0.25, gain: 0.4 },
    clap: { filter: 1600, decay: 0.28, gain: 0.6, reverbSend: 0.25 },
    tom: { freqStart: 160, freqEnd: 88, pitchTime: 0.12, decay: 0.2, gain: 0.65 },
    crash: { filter: 6200, decay: 0.85, gain: 0.5, reverbSend: 0.3 },
  },
  'Trap Beat': {
    kick: { freqStart: 150, freqEnd: 42, pitchTime: 0.3, decay: 0.65, gain: 1.0 },
    snare: { bodyFreqStart: 230, bodyFreqEnd: 170, bodyTime: 0.08, bodyDecay: 0.12, bodyGain: 0.35, noiseFilter: 1900, noiseDecay: 0.22, noiseGain: 0.7, reverbSend: 0.15 },
    hihat: { filter: 7600, decay: 0.04, gain: 0.35 },
    openhat: { filter: 7000, decay: 0.3, gain: 0.4 },
    clap: { filter: 1500, decay: 0.22, gain: 0.5, reverbSend: 0.2 },
    tom: { freqStart: 130, freqEnd: 75, pitchTime: 0.25, decay: 0.3, gain: 0.7 },
    crash: { filter: 5800, decay: 1.1, gain: 0.55, reverbSend: 0.3 },
  },
  '808 Vintage': {
    kick: { freqStart: 120, freqEnd: 48, pitchTime: 0.1, decay: 0.45, gain: 0.9 },
    snare: { bodyFreqStart: 190, bodyFreqEnd: 160, bodyTime: 0.08, bodyDecay: 0.18, bodyGain: 0.45, noiseFilter: 900, noiseDecay: 0.18, noiseGain: 0.55, reverbSend: 0.2 },
    hihat: { filter: 5000, decay: 0.045, gain: 0.32 },
    openhat: { filter: 4600, decay: 0.3, gain: 0.35 },
    clap: { filter: 1100, decay: 0.25, gain: 0.55, reverbSend: 0.2 },
    tom: { freqStart: 140, freqEnd: 80, pitchTime: 0.15, decay: 0.25, gain: 0.65 },
    crash: { filter: 5000, decay: 0.9, gain: 0.5, reverbSend: 0.25 },
  },
  'Chrome Pulse': {
    kick: { freqStart: 160, freqEnd: 40, pitchTime: 0.06, decay: 0.35, gain: 1.0, clickFreq: 1200, clickLevel: 0.35, clickDecay: 0.02 },
    snare: { bodyFreqStart: 260, bodyFreqEnd: 200, bodyTime: 0.08, bodyDecay: 0.1, bodyGain: 0.4, noiseFilter: 2200, noiseDecay: 0.3, noiseGain: 0.75, reverbSend: 0.45 },
    hihat: { filter: 9500, decay: 0.03, gain: 0.32 },
    openhat: { filter: 8800, decay: 0.3, gain: 0.35 },
    clap: { filter: 1800, decay: 0.3, gain: 0.6, reverbSend: 0.45 },
    tom: { freqStart: 180, freqEnd: 110, pitchTime: 0.1, decay: 0.22, gain: 0.65 },
    crash: { filter: 6800, decay: 1.1, gain: 0.6, reverbSend: 0.5 },
  },
  'Velocity Breaks': {
    kick: { freqStart: 150, freqEnd: 42, pitchTime: 0.05, decay: 0.16, gain: 0.95 },
    snare: { bodyFreqStart: 250, bodyFreqEnd: 190, bodyTime: 0.08, bodyDecay: 0.08, bodyGain: 0.4, noiseFilter: 1800, noiseDecay: 0.16, noiseGain: 0.7, reverbSend: 0.2 },
    hihat: { filter: 8200, decay: 0.03, gain: 0.3 },
    openhat: { filter: 7500, decay: 0.25, gain: 0.35 },
    clap: { filter: 1500, decay: 0.15, gain: 0.5, reverbSend: 0.15 },
    tom: { freqStart: 170, freqEnd: 95, pitchTime: 0.1, decay: 0.16, gain: 0.6 },
    crash: { filter: 6000, decay: 0.7, gain: 0.5, reverbSend: 0.2 },
  },
  'Sub Weight': {
    kick: { freqStart: 120, freqEnd: 38, pitchTime: 0.35, decay: 0.6, gain: 1.0 },
    snare: { bodyFreqStart: 200, bodyFreqEnd: 155, bodyTime: 0.08, bodyDecay: 0.15, bodyGain: 0.5, noiseFilter: 1300, noiseDecay: 0.35, noiseGain: 0.8, reverbSend: 0.5 },
    hihat: { filter: 8000, decay: 0.04, gain: 0.35 },
    openhat: { filter: 6800, decay: 0.3, gain: 0.35 },
    clap: { filter: 1500, decay: 0.35, gain: 0.6, reverbSend: 0.4 },
    tom: { freqStart: 120, freqEnd: 72, pitchTime: 0.3, decay: 0.4, gain: 0.7 },
    crash: { filter: 5600, decay: 1.2, gain: 0.6, reverbSend: 0.5 },
  },
  'Warehouse': {
    kick: { freqStart: 110, freqEnd: 38, pitchTime: 0.05, decay: 0.3, gain: 1.0, clickFreq: 1500, clickLevel: 0.3, clickDecay: 0.012 },
    snare: { bodyFreqStart: 220, bodyFreqEnd: 165, bodyTime: 0.08, bodyDecay: 0.12, bodyGain: 0.4, noiseFilter: 1500, noiseDecay: 0.15, noiseGain: 0.6, reverbSend: 0.35 },
    hihat: { filter: 9000, decay: 0.03, gain: 0.3 },
    openhat: { filter: 8000, decay: 0.25, gain: 0.35 },
    clap: { filter: 1600, decay: 0.3, gain: 0.55, reverbSend: 0.25 },
    tom: { freqStart: 170, freqEnd: 92, pitchTime: 0.1, decay: 0.18, gain: 0.65 },
    crash: { filter: 6400, decay: 0.8, gain: 0.5, reverbSend: 0.3 },
  },
  'Tight Pocket': {
    kick: { freqStart: 110, freqEnd: 55, pitchTime: 0.05, decay: 0.14, gain: 0.85 },
    snare: { bodyFreqStart: 230, bodyFreqEnd: 170, bodyTime: 0.08, bodyDecay: 0.08, bodyGain: 0.45, noiseFilter: 1400, noiseDecay: 0.12, noiseGain: 0.6, reverbSend: 0.15 },
    hihat: { filter: 6200, decay: 0.035, gain: 0.35 },
    openhat: { filter: 5600, decay: 0.18, gain: 0.4 },
    clap: { filter: 1200, decay: 0.18, gain: 0.55, reverbSend: 0.15 },
    tom: { freqStart: 160, freqEnd: 90, pitchTime: 0.1, decay: 0.18, gain: 0.65 },
    crash: { filter: 5500, decay: 0.7, gain: 0.5, reverbSend: 0.15 },
  },
  'Acoustic Studio': {
    kick: { freqStart: 160, freqEnd: 62, pitchTime: 0.09, decay: 0.3, gain: 0.9, clickFreq: 2000, clickLevel: 0.2, clickDecay: 0.01 },
    snare: { bodyFreqStart: 280, bodyFreqEnd: 220, bodyTime: 0.08, bodyDecay: 0.2, bodyGain: 0.5, noiseFilter: 1200, noiseDecay: 0.25, noiseGain: 0.6, reverbSend: 0.3 },
    hihat: { filter: 6800, decay: 0.06, gain: 0.38 },
    openhat: { filter: 6200, decay: 0.35, gain: 0.45 },
    clap: { filter: 2800, decay: 0.3, gain: 0.6, reverbSend: 0.35 },
    tom: { freqStart: 180, freqEnd: 100, pitchTime: 0.25, decay: 0.45, gain: 0.75 },
    crash: { filter: 5200, decay: 1.7, gain: 0.6, reverbSend: 0.45 },
  },
  'Warm Riddim': {
    kick: { freqStart: 120, freqEnd: 55, pitchTime: 0.14, decay: 0.25, gain: 0.8 },
    snare: { bodyFreqStart: 180, bodyFreqEnd: 150, bodyTime: 0.08, bodyDecay: 0.15, bodyGain: 0.45, noiseFilter: 800, noiseDecay: 0.15, noiseGain: 0.4, reverbSend: 0.35 },
    hihat: { filter: 4500, decay: 0.05, gain: 0.3 },
    openhat: { filter: 4200, decay: 0.3, gain: 0.35 },
    clap: { filter: 1000, decay: 0.3, gain: 0.5, reverbSend: 0.35 },
    tom: { freqStart: 130, freqEnd: 75, pitchTime: 0.2, decay: 0.35, gain: 0.6 },
    crash: { filter: 4800, decay: 1.4, gain: 0.5, reverbSend: 0.4 },
  },
  'Lo-Fi Vinyl': {
    kick: { freqStart: 105, freqEnd: 42, pitchTime: 0.12, decay: 0.3, gain: 0.8 },
    snare: { bodyFreqStart: 170, bodyFreqEnd: 145, bodyTime: 0.08, bodyDecay: 0.14, bodyGain: 0.4, noiseFilter: 700, noiseDecay: 0.15, noiseGain: 0.35, reverbSend: 0.25 },
    hihat: { filter: 3500, decay: 0.04, gain: 0.25 },
    openhat: { filter: 3500, decay: 0.25, gain: 0.28 },
    clap: { filter: 900, decay: 0.25, gain: 0.45, reverbSend: 0.2 },
    tom: { freqStart: 120, freqEnd: 70, pitchTime: 0.2, decay: 0.3, gain: 0.55 },
    crash: { filter: 4500, decay: 1.0, gain: 0.45, reverbSend: 0.3 },
  },
};

export const GENRE_TO_KIT: Record<string, string> = {
  'Synthwave': 'Retro Drive',
  'House': '909 Modern',
  'Trap': 'Trap Beat',
  'Boom Bap': '808 Vintage',
  'Cyberpunk': 'Chrome Pulse',
  'DnB': 'Velocity Breaks',
  'Dubstep': 'Sub Weight',
  'Techno': 'Warehouse',
  'Funk': 'Tight Pocket',
  'Rock': 'Acoustic Studio',
  'Reggae': 'Warm Riddim',
  'Lo-Fi Hip-Hop': 'Lo-Fi Vinyl',
  'Waltz': 'Acoustic Studio',
  'Afro 6/8': 'Warm Riddim',
};

export function mergeDrumKit(partial?: Partial<DrumKit>): DrumKit {
  return {
    kick: { ...DEFAULT_DRUM_KIT.kick, ...partial?.kick },
    snare: { ...DEFAULT_DRUM_KIT.snare, ...partial?.snare },
    hihat: { ...DEFAULT_DRUM_KIT.hihat, ...partial?.hihat },
    openhat: { ...DEFAULT_DRUM_KIT.openhat, ...partial?.openhat },
    clap: { ...DEFAULT_DRUM_KIT.clap, ...partial?.clap },
    tom: { ...DEFAULT_DRUM_KIT.tom, ...partial?.tom },
    crash: { ...DEFAULT_DRUM_KIT.crash, ...partial?.crash },
  };
}
