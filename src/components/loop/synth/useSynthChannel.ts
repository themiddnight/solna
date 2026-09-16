import { useAppStore } from "@/store/store";
import { synthTargetForFocus } from "@/store/focusTrack";
import type { MixLayerId } from "@/store/focusTrack";
import { resolveSynthControlChannel } from "@/utils/synthControl";
import type { SynthChannel, SynthChannels } from "@/utils/synthControl";
import {
  SYNTH_PARAM_FIELD,
  SYNTH_ARP_FIELD,
  SYNTH_SETTER_FIELD,
  SYNTH_ARP_SETTER_FIELD,
} from "@/store/sourceBuses";

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
 * The hook indexes the store by `target`, computed once per render via a
 * plain function call, rather than subscribing to all 5 tracks' fields and
 * picking one after the fact — that shape re-rendered every mounted
 * subscriber on any track's patch write, whether or not this one was even
 * focused. This is still exactly four `useAppStore` calls on every render —
 * the same pattern `synthPresetBrowser.ts` already uses to select a
 * runtime-chosen target — so there is no conditional hook count and no rules-
 * of-hooks violation: only a variable hook COUNT would be one.
 */
export function useSynthChannel(focus: MixLayerId): SynthChannel {
  const target = synthTargetForFocus(focus) ?? 'synth';

  const activeSynth = useAppStore((s) => s[SYNTH_PARAM_FIELD[target]]);
  const arpSettings = useAppStore((s) => s[SYNTH_ARP_FIELD[target]]);
  const setActiveSynth = useAppStore((s) => s[SYNTH_SETTER_FIELD[target]]);
  const setArpSettings = useAppStore((s) => s[SYNTH_ARP_SETTER_FIELD[target]]);

  return { activeSynth, arpSettings, setActiveSynth, setArpSettings };
}
