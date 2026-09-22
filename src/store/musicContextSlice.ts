import type { StoreApi } from 'zustand';
import type { AppStore, MusicContextSlice } from './types';
import type { LoopContent } from './loop';
import { changeKey, type KeyChangeTarget } from './keyChange';

type Set = StoreApi<AppStore>['setState'];

/**
 * A Header key change: changeKey over the active (flat) content, harmonizing
 * chords iff the session toggle is on, in ONE set() — the loopSync mirror
 * carries it into loops[active]. The badge is raised only when the chords
 * actually changed.
 */
function keyChangeWrite(state: AppStore, target: KeyChangeTarget): Partial<AppStore> {
  const patch = changeKey(state, target, { harmonizeChords: state.autoReharmonize });
  return 'chords' in patch ? { ...patch, reharmonizedIndicator: true } : patch;
}

/**
 * Music context slice: the global key/scale plus the id of the Instant Vibe
 * that was last loaded. `selectedVibeId` is persisted so the vibe bar's
 * highlight survives a reload; it is written by applyVibeToStore, not
 * by the key/scale setters, so editing the key by hand does not clear it.
 * Every melody track in `MELODY_TRACKS` follows a key change (changeKey);
 * the loop-copy `key` group deliberately transposes none (see `impliesKeyCopy`).
 */
export function createMusicContextSlice(set: Set, defaults: LoopContent): MusicContextSlice {
  return {
    scaleRoot: defaults.scaleRoot,
    scaleType: defaults.scaleType,
    selectedVibeId: null,
    autoReharmonize: true,
    reharmonizedIndicator: false,

    setScaleRoot: (root) => set((state) => keyChangeWrite(state, { root })),
    setScaleType: (scaleType) => set((state) => keyChangeWrite(state, { scaleType })),
    setSelectedVibeId: (selectedVibeId) => set({ selectedVibeId }),
    // Turning it ON rewrites nothing: it applies to FUTURE key changes only.
    // The Re-harmonize button is the deliberate snap.
    setAutoReharmonize: (on) =>
      set(on ? { autoReharmonize: true } : { autoReharmonize: false, reharmonizedIndicator: false }),
    setReharmonizedIndicator: (on) => set({ reharmonizedIndicator: on }),
  };
}
