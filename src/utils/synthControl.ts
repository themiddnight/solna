import type { SynthParams } from '../types';

export type SynthControlTarget = 'synth' | 'chord' | 'bass';

export interface SynthParamChannel {
  params: SynthParams;
  setParams: (params: SynthParams) => void;
}

export function resolveSynthControlChannel(
  target: SynthControlTarget,
  channels: { synth: SynthParamChannel; chord: SynthParamChannel; bass: SynthParamChannel }
): SynthParamChannel {
  switch (target) {
    case 'chord':
      return channels.chord;
    case 'bass':
      return channels.bass;
    default:
      return channels.synth;
  }
}
