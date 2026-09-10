import type { StoreApi } from 'zustand';
import { INITIAL_BASS_SYNTH_PARAMS, INITIAL_SYNTH_PARAMS } from './initialState';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
import type { AppStore, SynthSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Synth slice: the three param sets (main synth, chord mode, bass module).
 * Which of them the Sound page's knobs control is no longer a field here — it
 * is derived from the ui slice's `focusTrack` through
 * `controlTargetForFocus` (store/focusTrack.ts).
 */
export function createSynthSlice(set: Set): SynthSlice {
  return {
    synthParams: INITIAL_SYNTH_PARAMS,
    chordSynthParams: INITIAL_SYNTH_PARAMS,
    bassSynthParams: INITIAL_BASS_SYNTH_PARAMS,
    synthVolume: DEFAULT_BUS_TRIM_DB,
    synthMuted: false,

    // Setters backing the SoundView control panel (previously App.tsx
    // setState wrappers with the same semantics).
    setSynthParams: (synthParams) => set({ synthParams }),
    setChordSynthParams: (chordSynthParams) => set({ chordSynthParams }),
    setBassSynthParams: (bassSynthParams) => set({ bassSynthParams }),
    setSynthVolume: (synthVolume) => set({ synthVolume }),
    toggleSynthMuted: () => set((state) => ({ synthMuted: !state.synthMuted })),
  };
}
