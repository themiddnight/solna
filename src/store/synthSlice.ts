import type { StoreApi } from 'zustand';
import { INITIAL_BASS_SYNTH_PARAMS, INITIAL_SYNTH_PARAMS } from './initialState';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
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
    bassSynthParams: INITIAL_BASS_SYNTH_PARAMS,
    controlTarget: 'synth',
    synthVolume: DEFAULT_BUS_TRIM_DB,
    synthMuted: false,

    // Setters backing the SoundView control panel (previously App.tsx
    // setState wrappers with the same semantics).
    setSynthParams: (synthParams) => set({ synthParams }),
    setChordSynthParams: (chordSynthParams) => set({ chordSynthParams }),
    setBassSynthParams: (bassSynthParams) => set({ bassSynthParams }),
    setControlTarget: (controlTarget) => set({ controlTarget }),
    setSynthVolume: (synthVolume) => set({ synthVolume }),
    toggleSynthMuted: () => set((state) => ({ synthMuted: !state.synthMuted })),
  };
}
