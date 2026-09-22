import type { StoreApi } from 'zustand';
import type { AppStore, SynthSlice } from './types';
import type { LoopContent } from './loop';

type Set = StoreApi<AppStore>['setState'];

/**
 * Synth slice: the three patches (main synth, chord mode, bass module) and
 * the three Arp settings beside them.
 * Which of them the Sound page's knobs control is no longer a field here — it
 * is derived from the ui slice's `focusTrack` through
 * `controlTargetForFocus` (store/focusTrack.ts).
 */
export function createSynthSlice(set: Set, defaults: LoopContent): SynthSlice {
  return {
    synthParams: defaults.synthParams,
    chordSynthParams: defaults.chordSynthParams,
    bassSynthParams: defaults.bassSynthParams,
    synthArpSettings: defaults.synthArpSettings,
    chordArpSettings: defaults.chordArpSettings,
    bassArpSettings: defaults.bassArpSettings,
    synthVolume: defaults.synthVolume,
    synthMuted: defaults.synthMuted,

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
