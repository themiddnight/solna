import { useAppStore } from "@/store/store";
import { resolveSynthControlChannel } from "@/utils/synthControl";
import type { SynthParams } from "@/types";

export interface SynthChannel {
  params: SynthParams;
  onChangeParams: (next: SynthParams) => void;
}

/**
 * No `tintClass` here any more. The five panels each wore the active target's
 * tint, which painted one fact six times inside a single card once they became
 * compartments of the Synth section; the section itself carries it now, and
 * SoundView computes it there. See docs/design.md §6.5.
 */

/**
 * The three values every Pro-Mode module panel needs, derived from the store
 * exactly as SoundView derives them at its own top level.
 *
 * Each panel calls this itself rather than taking props, so the five panels
 * are independent leaves: SoundView's own re-renders (preset stepping, save
 * toasts, library open/close, the lead melody grid's per-step state) no longer
 * reconcile hundreds of lines of knob JSX, and a panel only re-renders when
 * the channel it is pointed at actually changes.
 */
export function useSynthChannel(): SynthChannel {
  const controlTarget = useAppStore((s) => s.controlTarget);
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const padSynthParams = useAppStore((s) => s.padSynthParams);
  const fxSynthParams = useAppStore((s) => s.fxSynthParams);
  const setSynthParams = useAppStore((s) => s.setSynthParams);
  const setChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const setBassSynthParams = useAppStore((s) => s.setBassSynthParams);
  const setPadSynthParams = useAppStore((s) => s.setPadSynthParams);
  const setFxSynthParams = useAppStore((s) => s.setFxSynthParams);

  const channel = resolveSynthControlChannel(controlTarget, {
    synth: { params: synthParams, setParams: setSynthParams },
    chord: { params: chordSynthParams, setParams: setChordSynthParams },
    bass: { params: bassSynthParams, setParams: setBassSynthParams },
    pad: { params: padSynthParams, setParams: setPadSynthParams },
    fx: { params: fxSynthParams, setParams: setFxSynthParams },
  });

  return { params: channel.params, onChangeParams: channel.setParams };
}
