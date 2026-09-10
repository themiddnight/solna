import { useAppStore } from "@/store/store";
import { synthTargetForFocus } from "@/store/focusTrack";
import type { MixLayerId } from "@/store/focusTrack";
import { resolveSynthControlChannel } from "@/utils/synthControl";
import type { SynthParamChannels } from "@/utils/synthControl";
import type { SynthParams } from "@/types";

export interface SynthChannel {
  params: SynthParams;
  onChangeParams: (next: SynthParams) => void;
}

/** Alias, so the panels and `resolveSynthControlChannel` cannot disagree. */
export type SynthChannels = SynthParamChannels;

/**
 * `focus` -> the channel the synth panels write to. Exported and pure so the
 * test exercises THIS, not a second copy of it: the drum branch's Lead
 * fallback is the whole point of the function and a mirrored helper could
 * never catch it drifting.
 *
 * `synthTargetForFocus` (store/focusTrack.ts) refuses to answer for a drum
 * focus — it returns `null` — so the `?? 'synth'` here is the fallback, spelled
 * at the one call site that needs it rather than baked into the projection.
 * Lead is safe in that branch only because SoundView renders no synth surface
 * at all when the focus is `drum`: the whole Synth section is unmounted, so no
 * panel that reads this is on screen and nothing can write through it. That
 * gate is asserted in SoundView.test.tsx ("no Synth section on a drum focus");
 * if it is ever removed, this fallback becomes the invisible Lead-patch edit
 * the spec's trap describes.
 */
export function synthChannelForFocus(focus: MixLayerId, channels: SynthChannels): SynthChannel {
  const channel = resolveSynthControlChannel(synthTargetForFocus(focus) ?? 'synth', channels);
  return { params: channel.params, onChangeParams: channel.setParams };
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
  const focusTrack = useAppStore((s) => s.focusTrack);
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

  return synthChannelForFocus(focusTrack, {
    synth: { params: synthParams, setParams: setSynthParams },
    chord: { params: chordSynthParams, setParams: setChordSynthParams },
    bass: { params: bassSynthParams, setParams: setBassSynthParams },
    pad: { params: padSynthParams, setParams: setPadSynthParams },
    fx: { params: fxSynthParams, setParams: setFxSynthParams },
  });
}
