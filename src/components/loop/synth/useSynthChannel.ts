import { useAppStore } from "../../../store/store";
import { resolveSynthControlChannel, SYNTH_TARGET_STYLES } from "../../../utils/synthControl";
import type { SynthParams } from "../../../types";

export interface SynthChannel {
  params: SynthParams;
  onChangeParams: (next: SynthParams) => void;
  tintClass: string;
}

/**
 * The three values every Pro-Mode module panel needs, derived from the store
 * exactly as SynthView derives them at its own top level.
 *
 * Each panel calls this itself rather than taking props, so the five panels
 * are independent leaves: SynthView's own re-renders (preset stepping, save
 * toasts, library open/close, the lead melody grid's per-step state) no longer
 * reconcile hundreds of lines of knob JSX, and a panel only re-renders when
 * the channel it is pointed at actually changes.
 */
export function useSynthChannel(): SynthChannel {
  const controlTarget = useAppStore((s) => s.controlTarget);
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const setSynthParams = useAppStore((s) => s.setSynthParams);
  const setChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const setBassSynthParams = useAppStore((s) => s.setBassSynthParams);

  const channel = resolveSynthControlChannel(controlTarget, {
    synth: { params: synthParams, setParams: setSynthParams },
    chord: { params: chordSynthParams, setParams: setChordSynthParams },
    bass: { params: bassSynthParams, setParams: setBassSynthParams },
  });

  const tintClass = [
    SYNTH_TARGET_STYLES[controlTarget].ring,
    SYNTH_TARGET_STYLES[controlTarget].tint,
  ]
    .filter(Boolean)
    .join(" ");

  return { params: channel.params, onChangeParams: channel.setParams, tintClass };
}
