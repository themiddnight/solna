import type { StoreApi } from 'zustand';
import { INITIAL_SYNTH_PARAMS } from './initialState';
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
import type { AppStore, SynthSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Synth slice: the three param sets (main synth, chord mode, bass module) plus
 * which param set the synth page's knobs control.
 */
export function createSynthSlice(set: Set, _get: Get): SynthSlice {
  return {
    synthParams: INITIAL_SYNTH_PARAMS,
    chordSynthParams: INITIAL_SYNTH_PARAMS,
    bassSynthParams: { ...INITIAL_SYNTH_PARAMS, ...FACTORY_BASS_PRESETS[0].params },
    controlTarget: 'synth',

    // Mirrors handleApplySynthPreset in App.tsx (shallow merge into synthParams).
    applySynthPreset: (preset) =>
      set((state) => ({ synthParams: { ...state.synthParams, ...preset } })),
  };
}
