import { audioEngine } from '@/audio/engine';
import type { MasterEffects } from '@/types';

/**
 * TRANSIENT Effects Rack audio: what a knob sounds like while it is being
 * dragged, before anything is committed.
 *
 * It lives in `src/store/` and not in a component for the reason every
 * engine call does — layering rule 4 forbids a view importing `audio/engine`
 * — and it is the ONLY non-test route `useEffectsDraft` has to transient
 * Effects Rack audio. Same shape as `store/synthPatchPreview.ts`: a direct,
 * synchronous push, not frame-coalesced — `audioEngine.updateEffects` only
 * writes a handful of cheap `AudioParam`s (gain/EQ/dynamics values), the same
 * class of write the synth-patch preview and `writeLeadSynth`'s per-CC push
 * already accept doing uncoalesced.
 *
 * `Omit<MasterEffects, 'reverbDecay'>` is `updateEffects`'s own signature,
 * not narrowed further here: decay is a STRUCTURAL rebuild (a multi-megabyte
 * impulse re-partitioned on the `ConvolverNode`), never a live per-frame
 * preview even in the pre-existing, store-write-driven flow this hook
 * replaces — `engineSync.ts`'s own `decayCommit` debounces it to gesture-end
 * for exactly that reason, off a SEPARATE `effects.reverbDecay` subscription
 * that still fires once `useEffectsDraft.onCommit` writes the store. A
 * drafted `reverbDecay` therefore still shows on the knob (draft state
 * covers that) but does not rebuild the convolver mid-drag, matching what
 * the debounce already enforced before this hook existed.
 */
export function previewEffects(effects: MasterEffects): void {
  audioEngine.updateEffects(effects);
}
