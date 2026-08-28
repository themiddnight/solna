import type { StoreApi } from 'zustand';
import { INITIAL_SYNTH_PARAMS } from './initialState';
import { FACTORY_BASS_PRESETS } from '../audio/bassPresets';
import type { AppStore, SynthSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Synth slice: the three param sets (main synth, chord mode, bass module) plus
 * which param set the synth page's knobs control.
 */
export function createSynthSlice(set: Set): SynthSlice {
  return {
    synthParams: INITIAL_SYNTH_PARAMS,
    chordSynthParams: INITIAL_SYNTH_PARAMS,
    bassSynthParams: { ...INITIAL_SYNTH_PARAMS, ...FACTORY_BASS_PRESETS[0].params },
    controlTarget: 'synth',
    synthVolume: 1.0,
    synthMuted: false,

    // Setters backing the SynthView control panel (previously App.tsx
    // setState wrappers with the same semantics).
    setSynthParams: (synthParams) => set({ synthParams }),
    setChordSynthParams: (chordSynthParams) => set({ chordSynthParams }),
    setBassSynthParams: (bassSynthParams) => set({ bassSynthParams }),
    setControlTarget: (controlTarget) => set({ controlTarget }),
    setSynthVolume: (synthVolume) => set({ synthVolume }),
    toggleSynthMuted: () => set((state) => ({ synthMuted: !state.synthMuted })),
  };
}
