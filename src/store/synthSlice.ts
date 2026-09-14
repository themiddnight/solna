import type { StoreApi } from 'zustand';
import { defaultTrackArp, defaultTrackSynth } from './initialState';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
import type { AppStore, SynthSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Synth slice: the three patches (main synth, chord mode, bass module) and
 * the three Arp settings beside them.
 * Which of them the Sound page's knobs control is no longer a field here — it
 * is derived from the ui slice's `focusTrack` through
 * `controlTargetForFocus` (store/focusTrack.ts).
 */
export function createSynthSlice(set: Set): SynthSlice {
  return {
    synthParams: defaultTrackSynth('synth'),
    chordSynthParams: defaultTrackSynth('chord'),
    bassSynthParams: defaultTrackSynth('bass'),
    synthArpSettings: defaultTrackArp('synth'),
    chordArpSettings: defaultTrackArp('chord'),
    bassArpSettings: defaultTrackArp('bass'),
    synthVolume: DEFAULT_BUS_TRIM_DB,
    synthMuted: false,

    // Setters backing the SoundView control panel (previously App.tsx
    // setState wrappers with the same semantics).
    setSynthParams: (synthParams) => set({ synthParams }),
    setChordSynthParams: (chordSynthParams) => set({ chordSynthParams }),
    setBassSynthParams: (bassSynthParams) => set({ bassSynthParams }),
    // Arp writes its own field. A setter that touched both would make an Arp
    // toggle re-push the patch to every sounding voice on the bus.
    setSynthArpSettings: (synthArpSettings) => set({ synthArpSettings }),
    setChordArpSettings: (chordArpSettings) => set({ chordArpSettings }),
    setBassArpSettings: (bassArpSettings) => set({ bassArpSettings }),
    setSynthVolume: (synthVolume) => set({ synthVolume }),
    toggleSynthMuted: () => set((state) => ({ synthMuted: !state.synthMuted })),
  };
}
