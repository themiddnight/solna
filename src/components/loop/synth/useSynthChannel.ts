import { useAppStore } from "@/store/store";
import { synthTargetForFocus } from "@/store/focusTrack";
import type { MixLayerId } from "@/store/focusTrack";
import { resolveSynthControlChannel } from "@/utils/synthControl";
import type { SynthChannel, SynthChannels } from "@/utils/synthControl";

export type { SynthChannel, SynthChannels };

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
  return resolveSynthControlChannel(synthTargetForFocus(focus) ?? 'synth', channels);
}

/**
 * The focused track's complete channel: its `ActiveSynth`, its `ArpSettings`,
 * and the writer for each.
 *
 * The focus is a PARAMETER, not a store read. `SoundSynthSection` already holds
 * the focus its header and its target row are drawn from; reading a second copy
 * here would let the two disagree — and under `renderToString` they actually
 * do, because a plain `useAppStore` selector serves creation-time state while
 * the section's own focus comes through `useLiveStore` (see
 * .claude/rules/testing.md). The panel would then edit Lead while the row above
 * it said Chord.
 *
 * Four values per bus rather than the pre-cutover pair, because the patch and
 * the Arp are separate objects with separate writers — see `SynthChannel` in
 * `utils/synthControl.ts` for why they must not be merged.
 *
 * The twenty selectors are spelled out rather than read through
 * `SYNTH_PARAM_FIELD` and its two sibling tables: those index the store by a
 * target chosen at RUNTIME, which is what the preset browser needs, while a
 * hook must call the same selectors in the same order on every render. Indexing
 * the store inside a selector expression would still work, but it would make
 * the hook's subscription list depend on the focus, which is exactly the shape
 * the rules of hooks exist to forbid.
 */
export function useSynthChannel(focus: MixLayerId): SynthChannel {
  const synthParams = useAppStore((s) => s.synthParams);
  const chordSynthParams = useAppStore((s) => s.chordSynthParams);
  const bassSynthParams = useAppStore((s) => s.bassSynthParams);
  const padSynthParams = useAppStore((s) => s.padSynthParams);
  const fxSynthParams = useAppStore((s) => s.fxSynthParams);

  const synthArpSettings = useAppStore((s) => s.synthArpSettings);
  const chordArpSettings = useAppStore((s) => s.chordArpSettings);
  const bassArpSettings = useAppStore((s) => s.bassArpSettings);
  const padArpSettings = useAppStore((s) => s.padArpSettings);
  const fxArpSettings = useAppStore((s) => s.fxArpSettings);

  const setSynthParams = useAppStore((s) => s.setSynthParams);
  const setChordSynthParams = useAppStore((s) => s.setChordSynthParams);
  const setBassSynthParams = useAppStore((s) => s.setBassSynthParams);
  const setPadSynthParams = useAppStore((s) => s.setPadSynthParams);
  const setFxSynthParams = useAppStore((s) => s.setFxSynthParams);

  const setSynthArpSettings = useAppStore((s) => s.setSynthArpSettings);
  const setChordArpSettings = useAppStore((s) => s.setChordArpSettings);
  const setBassArpSettings = useAppStore((s) => s.setBassArpSettings);
  const setPadArpSettings = useAppStore((s) => s.setPadArpSettings);
  const setFxArpSettings = useAppStore((s) => s.setFxArpSettings);

  return synthChannelForFocus(focus, {
    synth: {
      activeSynth: synthParams,
      arpSettings: synthArpSettings,
      setActiveSynth: setSynthParams,
      setArpSettings: setSynthArpSettings,
    },
    chord: {
      activeSynth: chordSynthParams,
      arpSettings: chordArpSettings,
      setActiveSynth: setChordSynthParams,
      setArpSettings: setChordArpSettings,
    },
    bass: {
      activeSynth: bassSynthParams,
      arpSettings: bassArpSettings,
      setActiveSynth: setBassSynthParams,
      setArpSettings: setBassArpSettings,
    },
    pad: {
      activeSynth: padSynthParams,
      arpSettings: padArpSettings,
      setActiveSynth: setPadSynthParams,
      setArpSettings: setPadArpSettings,
    },
    fx: {
      activeSynth: fxSynthParams,
      arpSettings: fxArpSettings,
      setActiveSynth: setFxSynthParams,
      setArpSettings: setFxArpSettings,
    },
  });
}
