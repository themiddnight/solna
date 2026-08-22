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
  // Unknown runtime values (e.g. a persisted target predating this union) fall back to synth
  return channels[target] ?? channels.synth;
}
