import type { StoreApi } from 'zustand';
import { loadLoop } from './loadLoop';
import { buildLoopCopyPatch } from './loopCopy';
import type { AppStore, LoopSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * applyLoopCopy lives here and not in loopSlice.ts because it must call
 * loadLoop, and loadLoop.ts imports ./store, which imports ./loopSlice.
 * Adding that import to loopSlice.ts closes a cycle whose entry order
 * decides whether the app boots: any file importing loopSlice.ts first
 * (loopSlice.test.ts, loadLoop.test.ts, the two Arrange test files) re-enters
 * store.ts mid-evaluation, store.ts calls createLoopSlice() at module scope,
 * and every module-level const below loopSlice.ts's import block is still in
 * its temporal dead zone — it dies on DEFAULT_LOOP_ID. This file declares no
 * module-level const, only a hoisted function, so no entry order can trip it.
 *
 * The two branches mirror setLoopMix's shape; this is not a new idiom, it is
 * the existing one applied to a bigger patch.
 */
export function createLoopCopySlice(set: Set, get: Get): Pick<LoopSlice, 'applyLoopCopy'> {
  return {
    applyLoopCopy: (targetId, sourceId, selected) => {
      const state = get();
      if (targetId === sourceId || selected.length === 0) return;
      const source = state.loops.find((loop) => loop.id === sourceId);
      const target = state.loops.find((loop) => loop.id === targetId);
      if (!source || !target) return;

      const patch = buildLoopCopyPatch(source, target, selected);
      const loops = state.loops.map((loop) =>
        loop.id === targetId ? { ...loop, ...patch } : loop,
      );

      // Non-active target: loops[] only. No flat-slice write, no engine
      // contact, nothing audible — a loop you are not on is edited for later
      // use, exactly as setLoopMix treats it. loopMirrorPartial returns null
      // for a partial carrying `loops` alone with no per-loop flat key, so
      // the mirror never reaches in and overwrites the edited loop with the
      // ACTIVE loop's flat state.
      if (targetId !== state.activeLoopId) {
        set({ loops });
        return;
      }

      // Active target. The loops[] write MUST land before loadLoop: loadLoop
      // reads the loop out of the store and copies it into the flat slices,
      // so loading first would load the pre-copy content and then mirror it
      // back over the patch. Calling loadLoop with the already-active id is
      // intended — the id has not moved, the CONTENT behind it has, and
      // loadLoop's default path (capture -> hardStopAll -> cut the queued
      // accompaniment -> write the flat slices -> commitRestartAfterStop) is
      // exactly the protocol for that. Reimplementing any part of it here
      // would create a second place that has to stay correct.
      set({ loops });
      loadLoop(targetId);
    },
  };
}
