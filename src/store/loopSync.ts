import type { StoreApi } from 'zustand';
import { LOOP_FLAT_KEYS, loopStatePatch } from './loop';
import type { AppStore, Loop } from './types';

/**
 * Live-write sync-back, folded into the store's own `set`.
 *
 * loops[] is always authoritative and persist always serializes the latest
 * edits — the "edits always sync back" half of the editing model. This used to
 * be a subscribeWithSelector subscription that issued a SECOND, independent
 * setState, which doubled the persist writes and the render waves per gesture
 * tick (a knob pointermove replaced the whole loops array, and dnd-kit's
 * SortableContext re-rendered every loop card through context). Emitting the
 * mirror inside the SAME set() produces exactly the same loops array with one
 * notification instead of two.
 */

/**
 * The `loops` patch that must accompany `partial`, or null when there is
 * nothing to mirror. Pure: `state` is the PRE-write state and `partial` the
 * already-resolved partial, so `{ ...state, ...partial }` is the post-write
 * value of every per-loop field.
 */
export function loopMirrorPartial(
  state: AppStore,
  partial: Partial<AppStore>,
): { loops: Loop[] } | null {
  // loadLoop owns the activeLoopId change and has already loaded the target
  // loop's fields into the flat slices; mirroring here would only rewrite the
  // just-loaded loop with itself.
  if ('activeLoopId' in partial && partial.activeLoopId !== state.activeLoopId) return null;

  const flat = partial as Record<string, unknown>;
  const current = state as unknown as Record<string, unknown>;
  let touched = false;
  for (const key of LOOP_FLAT_KEYS) {
    // Reference comparison, matching the old equalityFn: a new synthParams
    // object counts as a change, a playhead write does not.
    if (key in flat && flat[key] !== current[key]) {
      touched = true;
      break;
    }
  }
  if (!touched) return null;

  // setLoopMix writes `loops` AND the flat patch in one set(); the mirror must
  // build on the array that write produced, not on the pre-write one.
  const base = partial.loops ?? state.loops;
  const activeLoopId = state.activeLoopId;
  if (!base.some((loop) => loop.id === activeLoopId)) return null;

  const patch = loopStatePatch({ ...state, ...partial });
  return {
    loops: base.map((loop) => (loop.id === activeLoopId ? { ...loop, ...patch } : loop)),
  };
}

/**
 * Wraps the store creator's `set` so any write that changes a per-loop field
 * carries its loops[] mirror in the same state update. Every slice action goes
 * through this `set`; the four direct `useAppStore.setState` callers
 * (loadLoop, songMode, ArrangeView's audition write, the post-rehydrate
 * nudge) either move activeLoopId — which must not mirror — or touch no
 * per-loop field at all.
 */
export function createLoopMirroringSet(
  set: StoreApi<AppStore>['setState'],
  get: StoreApi<AppStore>['getState'],
): StoreApi<AppStore>['setState'] {
  const apply = set as unknown as (partial: unknown, replace?: boolean) => void;
  const wrapped = (
    partial: AppStore | Partial<AppStore> | ((state: AppStore) => AppStore | Partial<AppStore>),
    replace?: boolean,
  ): void => {
    // A full-state replace has no per-loop delta to derive; nothing in the app
    // uses it, and passing it through keeps the overload honest.
    if (replace === true) {
      apply(partial, true);
      return;
    }
    const state = get();
    const resolved = (
      typeof partial === 'function' ? partial(state) : partial
    ) as Partial<AppStore>;
    const mirror = loopMirrorPartial(state, resolved);
    apply(mirror ? { ...resolved, ...mirror } : resolved);
  };
  return wrapped as StoreApi<AppStore>['setState'];
}
