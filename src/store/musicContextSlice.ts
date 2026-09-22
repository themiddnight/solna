import type { StoreApi } from 'zustand';
import type { AppStore, MusicContextSlice } from './types';
import type { LoopContent } from './loop';
import { remapLeadMelodyByScale, transposeLeadMelodyByRoot } from '../audio/leadMelody';
import { MELODY_TRACKS, type MelodyTrack } from './melodyTracks';

type Set = StoreApi<AppStore>['setState'];

/**
 * The whole write a key change makes: the new root and/or type, plus every
 * melody track in `MELODY_TRACKS` moved to follow it. The root is applied
 * first (a transpose under the OLD type), then the type (a remap under the NEW
 * root) — exactly the sequence `setScaleRoot` then `setScaleType` produces.
 * Pure, so a caller that writes a key alongside other fields (a vibe) can fold
 * it into one atomic `set()`.
 */
export function keyChangePatch(
  state: Pick<AppStore, 'scaleRoot' | 'scaleType' | MelodyTrack['steps']>,
  next: { scaleRoot?: string; scaleType?: string },
): Partial<AppStore> {
  const root = next.scaleRoot ?? state.scaleRoot;
  const type = next.scaleType ?? state.scaleType;
  const patch: Record<string, unknown> = {};
  if (next.scaleRoot !== undefined) patch.scaleRoot = root;
  if (next.scaleType !== undefined) patch.scaleType = type;
  for (const track of MELODY_TRACKS) {
    let steps = state[track.steps];
    if (root !== state.scaleRoot) steps = transposeLeadMelodyByRoot(steps, state.scaleRoot, root);
    if (type !== state.scaleType) steps = remapLeadMelodyByScale(steps, root, state.scaleType, type);
    patch[track.steps] = steps;
  }
  return patch as Partial<AppStore>;
}

/**
 * Music context slice: the global key/scale plus the id of the Instant Vibe
 * that was last loaded. `selectedVibeId` is persisted so the vibe bar's
 * highlight survives a reload; it is written by applyVibeToStore, not
 * by the key/scale setters, so editing the key by hand does not clear it.
 * Every melody track in `MELODY_TRACKS` follows a key change (keyChangePatch);
 * the loop-copy `key` group deliberately transposes none (see `impliesKeyCopy`).
 */
export function createMusicContextSlice(set: Set, defaults: LoopContent): MusicContextSlice {
  return {
    scaleRoot: defaults.scaleRoot,
    scaleType: defaults.scaleType,
    selectedVibeId: null,

    setScaleRoot: (scaleRoot) => set((state) => keyChangePatch(state, { scaleRoot })),
    setScaleType: (scaleType) => set((state) => keyChangePatch(state, { scaleType })),
    setSelectedVibeId: (selectedVibeId) => set({ selectedVibeId }),
  };
}
