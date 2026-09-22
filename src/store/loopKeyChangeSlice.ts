import type { StoreApi } from 'zustand';
import { changeKeyAcrossLoops, keyFieldsOf } from './loopKeyChange';
import type { AppStore, LoopSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Batch key change. Each action is ONE set(): non-active loops land in
 * loops[]; the active loop's new key fields ride as flat values in the same
 * partial, so engineSync and the grids follow immediately — the same path a
 * Header key change takes, never crossLoopSeam. loopMirrorPartial builds on
 * partial.loops and rewrites loops[active] from the post-write flat state,
 * which holds the same values, so the two cannot disagree. The next song loop
 * reads loops[] when songMode calls loadLoop at its boundary.
 */
export function createLoopKeyChangeSlice(
  set: Set,
  get: Get,
): Pick<LoopSlice, 'applyLoopKeyChange' | 'undoLoopKeyChange'> {
  return {
    applyLoopKeyChange: (ids, target, opts) => {
      const state = get();
      const { loops, changed } = changeKeyAcrossLoops(state.loops, ids, target, opts);
      if (changed.length === 0) return null;
      const active = changed.some((s) => s.loopId === state.activeLoopId)
        ? loops.find((l) => l.id === state.activeLoopId)
        : undefined;
      if (!active) {
        set({ loops });
      } else {
        const chordsMoved = active.chords !== state.chords;
        set({
          loops,
          ...keyFieldsOf(active),
          ...(chordsMoved ? { reharmonizedIndicator: true } : {}),
        });
      }
      return { snapshots: changed };
    },

    undoLoopKeyChange: (undo) => {
      const state = get();
      const byId = new Map(undo.snapshots.map((s) => [s.loopId, s.content]));
      const loops = state.loops.map((loop) => {
        const content = byId.get(loop.id);
        return content ? { ...loop, ...content } : loop;
      });
      const activeContent = byId.get(state.activeLoopId);
      set(
        activeContent
          ? { loops, ...activeContent, reharmonizedIndicator: false }
          : { loops },
      );
    },
  };
}
