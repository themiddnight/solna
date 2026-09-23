import { applyBeatParams } from '@/audio/beatAdapter';
import { audioEngine } from '@/audio/engine';
import { createFrameCoalescer } from '@/utils/frameCoalescer';
import type { BeatParams } from '@/types';

/**
 * TRANSIENT Beat audio: what a knob sounds like while it is being dragged,
 * before anything is committed.
 *
 * It lives in `src/store/` and not in a component for the reason every engine
 * call does — layering rule 4 forbids a view importing `audio/engine` — and it
 * is the ONLY non-test route to transient Beat audio, so a view has exactly
 * one door and cannot invent a second.
 *
 * It writes NO Zustand. A drag that wrote committed state would re-serialise
 * the loop on every pointer move (persist serialises on every `set()`), and a
 * cancelled drag would have nothing to go back to. The committed write happens
 * once, on pointerup, through the Beat slice — not here.
 *
 * ONE coalescer, owned here, keyed on a single key: a drag is "latest value
 * wins", and `setDrumKit` re-reads a whole patch. Leading-edge, so the first
 * value of a gesture is not delayed by a frame; a repeat inside the same frame
 * collapses to the last one.
 *
 * It starts no clock and holds no subscription — a preview is a value pushed
 * at the engine, not a player.
 */
const frames = createFrameCoalescer();

/** The single coalescer key: one Beat patch is in flight at a time. */
const PREVIEW_KEY = 'beat-params';

/** Hear `params` now, without committing them. */
export function previewBeatParams(params: BeatParams): void {
  frames.push(PREVIEW_KEY, () => applyBeatParams(audioEngine, params));
}

/**
 * Disarm a preview frame without pushing anything.
 *
 * What `commit` needs and `restoreBeatParams` cannot be: the committed write
 * reaches the engine through `engineSync`'s `beatParams` subscription, so the
 * commit path must NOT push a patch itself — it must only make sure the frame
 * the drag armed cannot drain afterwards. A trailing thunk that drained after
 * an intervening `beatParams` write (a preset pick, a vibe preview,
 * `resetBeatParams`) would re-apply the abandoned draft and leave the engine on
 * a patch the store does not hold.
 */
export function cancelBeatPreview(): void {
  frames.cancel();
}

/**
 * Put the committed patch back, immediately.
 *
 * `cancel()` FIRST, and it is the load-bearing half: a preview the frame was
 * still holding would otherwise drain AFTER the restore and leave the engine
 * playing a patch the user abandoned, with the store and the DSP disagreeing
 * and nothing on screen to explain it. The restore itself is never coalesced —
 * a cancelled gesture must be silent on the same tick as the pointer event.
 */
export function restoreBeatParams(params: BeatParams): void {
  frames.cancel();
  applyBeatParams(audioEngine, params);
}
