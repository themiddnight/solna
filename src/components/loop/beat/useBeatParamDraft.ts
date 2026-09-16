import { useCallback, useEffect, useReducer, useRef } from 'react';
import { cancelBeatPreview, previewBeatParams, restoreBeatParams } from '@/store/beatPreview';
import type { BeatParams } from '@/types';

export interface BeatParamDraft {
  /** The params to render: the live drag preview while a gesture is open, the
   *  committed params otherwise. */
  draft: BeatParams;
  /** Applies `updater` to the draft and previews it — no persisted write. */
  update: (updater: (params: BeatParams) => BeatParams) => void;
  /** Ends the gesture by writing the draft through `commitParams`. */
  commit: () => void;
  /** Ends the gesture by discarding the draft and restoring the committed sound. */
  cancel: () => void;
}

interface DraftState {
  draft: BeatParams;
  /** The last params `sync` was called with — what a cancel restores to and
   *  what a non-dragging sync adopts. */
  committed: BeatParams;
  loopId: string;
  /** Whether an uncommitted preview is in flight. */
  dragging: boolean;
}

/**
 * The pure state machine behind `useBeatParamDraft`, isolated from React.
 *
 * `sync` runs once per render with the CURRENT props, replacing this render
 * loop's dependence on `useEffect` (which never runs under `renderToString`,
 * and would run a render late even in the browser): a committed-prop change
 * lands immediately unless a gesture is open, and a change of
 * `activeLoopId` — a different loop's sound entirely — cancels an open
 * gesture rather than committing it into the wrong loop or previewing across
 * the switch, landing the ARRIVING loop's patch (see `sync`).
 *
 * Exported (not the hook's internal closures) so the commit-exactly-once,
 * cancel-on-loop-change and no-drag-no-replace rules are testable directly,
 * independent of whether a render can be re-run — `renderToString` cannot
 * carry hook state across two separate calls, so any of this logic wrapped
 * only in `useRef`/`useState` closures would be untestable in this repo's
 * DOM-less suite.
 */
export function createBeatParamDraftMachine(
  committedParams: BeatParams,
  activeLoopId: string,
) {
  const state: DraftState = {
    draft: committedParams,
    committed: committedParams,
    loopId: activeLoopId,
    dragging: false,
  };

  /** Called once per render with the latest props. */
  function sync(nextCommitted: BeatParams, nextLoopId: string): void {
    if (nextLoopId !== state.loopId) {
      state.loopId = nextLoopId;
      if (state.dragging) {
        state.dragging = false;
        // `nextCommitted`, never `state.committed`: by the time this render
        // runs, `engineSync`'s `beatParams` subscription has ALREADY installed
        // the arriving loop's patch (zustand notifies synchronously inside the
        // `set()` that changed the loop; React re-renders after the event).
        // Restoring the LEAVING loop's patch here would overwrite it and leave
        // the engine on the previous loop's kit, trim and filter until
        // `beatParams` next changed. Restoring the arriving loop's patch is
        // idempotent against that push and still cancels the abandoned
        // preview frame, which is the half only this call can do.
        restoreBeatParams(nextCommitted);
      }
      state.committed = nextCommitted;
      state.draft = nextCommitted;
      return;
    }
    state.committed = nextCommitted;
    if (!state.dragging) {
      state.draft = nextCommitted;
    }
  }

  function update(updater: (params: BeatParams) => BeatParams): void {
    state.dragging = true;
    state.draft = updater(state.draft);
    previewBeatParams(state.draft);
  }

  /** `commitParams` is passed in at call time so the hook can always supply
   *  the latest closure without recreating this machine. */
  function commit(commitParams: (params: BeatParams) => void): void {
    state.dragging = false;
    // Disarm the frame the drag armed BEFORE handing the patch on. The commit
    // reaches the engine through `engineSync`, so a thunk still sitting in the
    // coalescer is pure stale state: if any other `beatParams` write lands
    // before it drains, it re-applies the abandoned draft over the top of it.
    // `cancel()` has always treated this ordering as load-bearing; the commit
    // path was the half that did not.
    cancelBeatPreview();
    // The machine's own restore target moves WITH the commit, not one prop
    // round-trip later. Between here and the next `sync()`, `state.committed`
    // otherwise still held the pre-commit patch, so a `cancel()` arriving in
    // that window (a second knob's `pointercancel`, a touch-scroll interrupting
    // a fast two-knob sequence) pushed the PRE-commit patch at the engine.
    state.committed = state.draft;
    commitParams(state.draft);
  }

  function cancel(): void {
    state.dragging = false;
    state.draft = state.committed;
    restoreBeatParams(state.committed);
  }

  /** Unmount teardown: only a gesture still open has anything to undo. */
  function cancelIfDragging(): void {
    if (state.dragging) cancel();
  }

  return {
    sync,
    update,
    commit,
    cancel,
    cancelIfDragging,
    getDraft: () => state.draft,
  };
}

/**
 * Transient Beat-param editing for one control surface: previews on every
 * `update`, writes to the store exactly once on `commit`, and never touches
 * persisted state in between (pointer dragging previews without persisted
 * writes and commits exactly once — the constraint this whole task exists
 * to satisfy). A change of `activeLoopId` mid-gesture cancels it rather than
 * committing a value into a loop the user has since left.
 */
export function useBeatParamDraft(
  committedParams: BeatParams,
  activeLoopId: string,
  commitParams: (params: BeatParams) => void,
): BeatParamDraft {
  const commitParamsRef = useRef(commitParams);
  commitParamsRef.current = commitParams;

  const machineRef = useRef<ReturnType<typeof createBeatParamDraftMachine> | null>(null);
  if (!machineRef.current) {
    machineRef.current = createBeatParamDraftMachine(committedParams, activeLoopId);
  }
  const machine = machineRef.current;
  machine.sync(committedParams, activeLoopId);

  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // The ONE effect here, and it is an unmount teardown only — never a render
  // path. Both editor surfaces are conditionally mounted (`SoundView` drops
  // the whole Beat section on a synth target; `BeatSoundSection` drops the
  // voice grid below `minimal` depth), so a knob can be dragging when its own
  // subtree goes away: the `pointerup` then fires no React handler, nothing
  // commits and nothing cancels, and the engine is left playing an
  // uncommitted draft with the store showing the old patch and nothing on
  // screen to explain it. `useEffect` does not run under `renderToString`,
  // which is exactly right — a DOM-less render has no gesture to abandon.
  useEffect(() => () => machine.cancelIfDragging(), [machine]);

  // `useCallback`, not inline closures: `machine` and `forceRender` are both
  // stable for the lifetime of this hook instance (the former lives in a
  // `useRef` created once, the latter is `useReducer`'s dispatch), so these
  // three are genuinely stable across every render — which is what lets
  // `BeatVoiceCard`'s `React.memo` bail on a card whose own voice a drag
  // didn't touch. `commitParamsRef` is the indirection that keeps `commit`
  // from needing `commitParams` itself in its dependency array.
  const update = useCallback(
    (updater: (params: BeatParams) => BeatParams) => {
      machine.update(updater);
      forceRender();
    },
    [machine],
  );
  const commit = useCallback(() => {
    machine.commit((params) => commitParamsRef.current(params));
    forceRender();
  }, [machine]);
  const cancel = useCallback(() => {
    machine.cancel();
    forceRender();
  }, [machine]);

  return {
    draft: machine.getDraft(),
    update,
    commit,
    cancel,
  };
}
