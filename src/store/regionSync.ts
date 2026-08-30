import React from 'react';
import { REGION_FLAT_KEYS, regionStatePatch } from './region';
import { useAppStore } from './store';

/**
 * Live-write sync-back: one subscribeWithSelector subscription over the 31
 * per-region flat fields writes the active region's copy in regions[] on every
 * change. regions[] is always authoritative and persist always serializes the
 * latest edits — the "edits always sync back" half of the editing model.
 *
 * The equalityFn compares the 31 fields by reference (a new synthParams object
 * counts as a change; a playhead write does not), so the listener only runs
 * when an actual per-region field changed or the active id moved.
 */
export function startRegionSync(): () => void {
  return useAppStore.subscribe(
    (state) => ({ activeRegionId: state.activeRegionId, patch: regionStatePatch(state) }),
    (next, prev) => {
      // loadRegion owns the activeRegionId change and has already loaded the
      // target region's fields into the flat slices; syncing here would only
      // rewrite the just-loaded region with itself.
      if (next.activeRegionId !== prev.activeRegionId) return;
      const patch = next.patch;
      useAppStore.setState((s) => ({
        regions: s.regions.map((r) => (r.id === s.activeRegionId ? { ...r, ...patch } : r)),
      }));
    },
    {
      equalityFn: (a, b) => {
        if (a.activeRegionId !== b.activeRegionId) return false;
        for (const key of REGION_FLAT_KEYS) {
          if (a.patch[key] !== b.patch[key]) return false;
        }
        return true;
      },
    }
  );
}

/** React binding, mounted once at the app root (App.tsx). */
export function useRegionSync(): void {
  React.useEffect(() => startRegionSync(), []);
}
