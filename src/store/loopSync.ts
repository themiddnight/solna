import React from 'react';
import { LOOP_FLAT_KEYS, loopStatePatch } from './loop';
import { useAppStore } from './store';

/**
 * Live-write sync-back: one subscribeWithSelector subscription over the 31
 * per-loop flat fields writes the active loop's copy in loops[] on every
 * change. loops[] is always authoritative and persist always serializes the
 * latest edits — the "edits always sync back" half of the editing model.
 *
 * The equalityFn compares the 31 fields by reference (a new synthParams object
 * counts as a change; a playhead write does not), so the listener only runs
 * when an actual per-loop field changed or the active id moved.
 */
export function startLoopSync(): () => void {
  return useAppStore.subscribe(
    (state) => ({ activeLoopId: state.activeLoopId, patch: loopStatePatch(state) }),
    (next, prev) => {
      // loadLoop owns the activeLoopId change and has already loaded the
      // target loop's fields into the flat slices; syncing here would only
      // rewrite the just-loaded loop with itself.
      if (next.activeLoopId !== prev.activeLoopId) return;
      const patch = next.patch;
      useAppStore.setState((s) => ({
        loops: s.loops.map((r) => (r.id === s.activeLoopId ? { ...r, ...patch } : r)),
      }));
    },
    {
      equalityFn: (a, b) => {
        if (a.activeLoopId !== b.activeLoopId) return false;
        for (const key of LOOP_FLAT_KEYS) {
          if (a.patch[key] !== b.patch[key]) return false;
        }
        return true;
      },
    }
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useLoopSync(): void {
  React.useEffect(() => startLoopSync(), []);
}
