import { audioEngine } from '@/audio/engine';
import type { ActiveSynth } from '@/types/synth';
import type { SynthControlTarget } from '@/utils/synthControl';

/**
 * TRANSIENT synth-patch audio: what a Pro-panel knob sounds like while it is
 * being dragged, before anything is committed.
 *
 * It lives in `src/store/` and not in a component for the reason every engine
 * call does — layering rule 4 forbids a view importing `audio/engine` — and
 * it is the ONLY non-test route `useSynthPatchDraft` has to transient synth
 * audio.
 *
 * Unlike `store/beatPreview.ts` this is NOT frame-coalesced: it is the same
 * direct, synchronous push `writeLeadSynth` in `midiInput.ts` already makes
 * per CC message, because a Pro-panel drag deserves the same "no
 * frame-of-latency" treatment a CC sweep gets on a held note. Writing the
 * store instead would ALSO reach the engine — `engineSync.ts`'s own
 * `pushSynthPatch` subscription pushes every committed patch too, coalesced
 * to one call per frame — so this function's only job is closing that one
 * frame of latency during a live drag, exactly as `writeLeadSynth`'s own
 * comment on the same tradeoff explains.
 *
 * `source` is a `SynthControlTarget`, not the bare `string`
 * `audioEngine.updateSynthPatch` accepts: Lead, Chord, Bass, Pad and FX all
 * share the SAME Pro-panel component (`SubtractiveProPanel`), so previewing
 * without naming which bus is being dragged would push every edit onto
 * whichever bus a caller forgot to pass — silently retuning Lead's sounding
 * voices while the user drags Chord's filter, with nothing failing.
 */
export function previewSynthPatch(
  previous: ActiveSynth,
  next: ActiveSynth,
  source: SynthControlTarget,
): void {
  audioEngine.updateSynthPatch(previous, next, source);
}
