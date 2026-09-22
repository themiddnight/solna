import type { StoreApi } from 'zustand';
import {
  cloneLoop,
  fallbackActiveLoopId,
  loopStatePatch,
  newLoopId,
  nextDuplicateLabel,
  nextUntitledName,
} from './loop';
import { createDefaultLoopContent } from './loopDefaults';
import { rescopeToLoop, scopedLoopId, SCOPE_NONE } from './playbackScope';
import { stopAllPlayersPatch } from './transportSlice';
import type { AppStore, DeletedLoop, Loop, LoopSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export const DEFAULT_LOOP_ID = 'loop-default-1';

/** The loop every fresh project starts with: slot identity plus default content. */
export function createDefaultLoop(): Loop {
  return {
    id: DEFAULT_LOOP_ID,
    name: '',
    tempName: 'untitled-1',
    repeatCount: 1,
    ...createDefaultLoopContent(),
  };
}

/**
 * Song mode's cursor is the ACTIVE loop's index in `loops`, or null outside
 * song mode. Re-derived from the new list after any change that can shift it,
 * so a delete or a reorder can't leave it pointing at the wrong loop or out of
 * range (which would freeze the song advance).
 */
function songCursor(
  loops: Loop[],
  activeLoopId: string,
  songLoopIndex: number | null
): number | null {
  return songLoopIndex !== null ? Math.max(0, loops.findIndex((r) => r.id === activeLoopId)) : null;
}

/** Appends a fresh copy of the active loop, moving the cursor and the scope onto it. */
function insertNewLoop(set: Set, get: Get): string {
  const state = get();
  const source = state.loops.find((r) => r.id === state.activeLoopId) ?? state.loops[0];
  const loop: Loop = {
    ...cloneLoop(source),
    id: newLoopId(),
    // Add is a fresh slot: no name, and a number of its own.
    name: '',
    tempName: nextUntitledName(state.loops),
  };
  // The scope moves with the cursor: the new loop is a copy of the active
  // one, so the audio is unchanged and must keep playing — but under an id
  // that names the loop now in focus. Left behind, the scope would point
  // at the old loop and the master Play would render enabled and do
  // nothing (soloLoop early-returns on an unchanged scope reference).
  // rescopeToLoop leaves `song` and `none` alone.
  set({
    loops: [...state.loops, loop],
    activeLoopId: loop.id,
    playbackScope: rescopeToLoop(state.playbackScope, loop.id),
  });
  return loop.id;
}

/**
 * Deep clone inserted immediately after the original. When the clone is
 * auto-activated (original was active) the content matches the flat slices,
 * so no loadLoop is needed; otherwise the caller must load the clone and gets
 * the clone's id back, while an auto-activated clone returns null.
 */
function insertLoopClone(set: Set, get: Get, id: string): string | null {
  const state = get();
  const index = state.loops.findIndex((r) => r.id === id);
  if (index === -1) return null;
  const source = state.loops[index];
  const clone: Loop = {
    ...cloneLoop(source),
    id: newLoopId(),
    // Derived, not fresh: the label increments the one on screen.
    ...nextDuplicateLabel(state.loops, source),
  };
  const cloneActive = id === state.activeLoopId;
  const loops = [
    ...state.loops.slice(0, index + 1),
    clone,
    ...state.loops.slice(index + 1),
  ];
  // Same rule as addLoop: only the auto-activated branch moves the cursor,
  // so only it moves the scope.
  set(
    cloneActive
      ? {
          loops,
          activeLoopId: clone.id,
          playbackScope: rescopeToLoop(state.playbackScope, clone.id),
        }
      : { loops },
  );
  return cloneActive ? null : clone.id;
}

/**
 * A project always has ≥ 1 loop, so deleting the last one (or an unknown id)
 * returns null and writes nothing. Otherwise the removed loop comes back as a
 * `DeletedLoop` — the snapshot, its index and whether it was active — which is
 * everything `restoreLoop` needs to undo the delete.
 *
 * Deleting the ACTIVE loop is atomic on its own: the removal, the new
 * `activeLoopId` and the fallback loop's per-loop fields land in ONE set(),
 * the same shape `projectSlice.reconcileActiveLoop` writes, so no subscriber
 * ever sees `activeLoopId` naming a loop whose content the flat slices do not
 * hold, and no caller has to follow up with `loadLoop`. `loopMirrorPartial`
 * skips its mirror when `activeLoopId` changes, so the fallback's fields are
 * never written back into the wrong loop. Nothing here hard-stops, and this
 * pure-state write touches no audio: `deleteLoopLive` (loadLoop.ts) is what the
 * UI calls, and it wraps this write in the seam a song advance crosses — the
 * deleted loop's voices cut, the clock reset — so a running song keeps running
 * on the fallback from its step 0. Only a loop audition scoped to the deleted
 * loop stops, through `stopPatch` below.
 */
function removeLoop(set: Set, get: Get, id: string): DeletedLoop | null {
  const state = get();
  if (state.loops.length <= 1) return null;
  const index = state.loops.findIndex((r) => r.id === id);
  if (index === -1) return null;
  const wasActive = id === state.activeLoopId;
  const loops = state.loops.filter((r) => r.id !== id);
  // Deleting the loop that is sounding stops playback: after this the
  // loop that was sounding is not the loop in focus, because it is not
  // anywhere. Folded into the same set() as the removal so no subscriber
  // ever sees a scope naming a loop that `loops` no longer contains — the
  // one scope value focus-loop cannot heal, since it would compare the
  // focused id against a ghost. A `song` scope is deliberately untouched:
  // an arrangement one slot shorter is still an arrangement, which is why
  // the cursor below is re-derived rather than dropped.
  const stopPatch =
    scopedLoopId(state.playbackScope) === id
      ? { playbackScope: SCOPE_NONE, ...stopAllPlayersPatch(state) }
      : {};
  const deleted: DeletedLoop = { loop: state.loops[index], index, wasActive };
  if (!wasActive) {
    set({
      loops,
      songLoopIndex: songCursor(loops, state.activeLoopId, state.songLoopIndex),
      ...stopPatch,
    });
    return deleted;
  }
  const fallback = fallbackActiveLoopId(state.loops, id) ?? loops[0].id;
  const fallbackLoop = loops.find((l) => l.id === fallback) ?? loops[0];
  set({
    loops,
    activeLoopId: fallbackLoop.id,
    ...loopStatePatch(fallbackLoop),
    songLoopIndex: songCursor(loops, fallbackLoop.id, state.songLoopIndex),
    ...stopPatch,
  });
  return deleted;
}

/**
 * Undo for `removeLoop`: re-inserts the snapshot at its old index (clamped to
 * the list as it is now) and NEVER activates it — the flat slices keep
 * describing the active loop, so the state is consistent with no follow-up.
 * A caller that wants the restored loop active again goes through
 * `undoLoopDelete` (loadLoop.ts), which re-activates it without stopping a
 * running transport. Restoring a loop that is already present is a
 * no-op, so a double Undo cannot duplicate an id.
 */
function reinsertLoop(set: Set, deleted: DeletedLoop): void {
  set((s) => {
    if (s.loops.some((l) => l.id === deleted.loop.id)) return {};
    const i = Math.max(0, Math.min(deleted.index, s.loops.length));
    const loops = [...s.loops.slice(0, i), deleted.loop, ...s.loops.slice(i)];
    return { loops, songLoopIndex: songCursor(loops, s.activeLoopId, s.songLoopIndex) };
  });
}

/**
 * `setLoopTempName`'s write, pure. A blank/whitespace name returns `{}`:
 * tempName's contract is "the app's label, never empty" (see the setter).
 */
export function loopTempNamePatch(
  state: Pick<AppStore, 'loops'>,
  id: string,
  tempName: string,
): Partial<Pick<AppStore, 'loops'>> {
  const trimmed = tempName.trim();
  if (!trimmed) return {};
  return { loops: state.loops.map((r) => (r.id === id ? { ...r, tempName: trimmed } : r)) };
}

export function createLoopSlice(set: Set, get: Get): Omit<LoopSlice, 'applyLoopCopy' | 'applyLoopKeyChange' | 'undoLoopKeyChange'> {
  return {
    loops: [createDefaultLoop()],
    activeLoopId: DEFAULT_LOOP_ID,

    // A new loop is a copy of the active loop (default), appended. Content
    // is identical to what the flat slices already hold, so no loadLoop call
    // is needed — the cursor and the scope move, nothing else.
    addLoop: () => insertNewLoop(set, get),

    duplicateLoop: (id) => insertLoopClone(set, get, id),

    deleteLoop: (id) => removeLoop(set, get, id),

    restoreLoop: (deleted) => reinsertLoop(set, deleted),

    reorderLoops: (id, direction) =>
      set((state) => {
        const index = state.loops.findIndex((r) => r.id === id);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= state.loops.length) return {};
        const loops = [...state.loops];
        const [moved] = loops.splice(index, 1);
        loops.splice(target, 0, moved);
        return {
          loops,
          // activeLoopId is unchanged by a reorder; only its list index
          // shifts, so re-derive the song cursor onto its new position (kept
          // null in loop mode).
          songLoopIndex: songCursor(loops, state.activeLoopId, state.songLoopIndex),
        };
      }),

    reorderLoopsArray: (loops) =>
      set((state) => ({
        loops,
        songLoopIndex: songCursor(loops, state.activeLoopId, state.songLoopIndex),
      })),

    setLoopName: (id, name) =>
      set((state) => ({
        loops: state.loops.map((r) => (r.id === id ? { ...r, name } : r)),
      })),

    setLoopTempName: (id, tempName) => {
      // tempName's own contract (types.ts) is "the app's label, never empty",
      // and loopLabel's `name || tempName` has no third tier to fall back to —
      // sanitizeLoops enforces this on load, but this is a live setter, so it
      // must enforce it here too. A blank/whitespace call is a no-op rather
      // than writing '' and letting the label go blank at every render site
      // that consolidated onto loopLabel specifically to avoid that.
      if (!tempName.trim()) return;
      set((state) => loopTempNamePatch(state, id, tempName));
    },

    setLoopRepeatCount: (id, repeatCount) =>
      set((state) => ({
        loops: state.loops.map((r) =>
          r.id === id ? { ...r, repeatCount: Math.max(1, Math.min(32, Math.round(repeatCount))) } : r
        ),
      })),

    setLoopMix: (id, patch) =>
      set((state) => {
        const loops = state.loops.map((r) => (r.id === id ? { ...r, ...patch } : r));
        // Mirror onto the flat slices only when the edited loop is the active
        // (sounding) one, so the engine follows live (engineSync reads the flat
        // fields) and loopSync writes the same values back idempotently. A
        // non-active loop is edited for later use only.
        if (id !== state.activeLoopId) return { loops };
        return { loops, ...patch };
      }),
  };
}
