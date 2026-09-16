import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { MasterEffects } from '@/types';

export interface EffectsDraft {
  /** The effects to render: the live drag preview while a gesture is open,
   *  the committed effects otherwise. */
  effects: MasterEffects;
  /** Merges `updates` into the draft — no store write. */
  onPatch: (updates: Partial<MasterEffects>) => void;
  /** Ends the gesture by writing the draft through `setEffects`. */
  onCommit: () => void;
  /** Ends the gesture by discarding the draft and reverting to committed. */
  onCancel: () => void;
}

interface DraftState {
  draft: MasterEffects;
  committed: MasterEffects;
  dragging: boolean;
}

/**
 * The pure state machine behind `useEffectsDraft`, isolated from React — same
 * split as `createBeatParamDraftMachine`/`useBeatParamDraft` and
 * `createSynthPatchDraftMachine`/`useSynthPatchDraft`, for the same reason:
 * `renderToString` cannot carry hook state across two separate calls.
 *
 * Simpler than the synth machine on purpose: the Effects Rack has no direct
 * engine call of its own to preview through (confirmed by grepping
 * `EffectsRackView.tsx` for `audioEngine`/`audio/engine` — none), so a knob
 * drag only needs to move local draft state for the live readout; the engine
 * push already happens through `engineSync.ts`'s subscription and frame
 * coalescer once `onCommit` writes the store.
 */
export function createEffectsDraftMachine(committedEffects: MasterEffects) {
  const state: DraftState = {
    draft: committedEffects,
    committed: committedEffects,
    dragging: false,
  };

  /** Called once per render with the latest committed effects. */
  function sync(nextCommitted: MasterEffects): void {
    state.committed = nextCommitted;
    if (!state.dragging) {
      state.draft = nextCommitted;
    }
  }

  function onPatch(updates: Partial<MasterEffects>): void {
    state.dragging = true;
    state.draft = { ...state.draft, ...updates };
  }

  /** `setEffects` is passed in at call time so the hook can always supply the
   *  latest closure without recreating this machine. */
  function commit(setEffects: (effects: MasterEffects) => void): void {
    state.dragging = false;
    state.committed = state.draft;
    setEffects(state.draft);
  }

  function cancel(): void {
    state.dragging = false;
    state.draft = state.committed;
  }

  /** Unmount teardown: only a gesture still open has anything to undo. */
  function cancelIfDragging(): void {
    if (state.dragging) cancel();
  }

  return {
    sync,
    onPatch,
    commit,
    cancel,
    cancelIfDragging,
    getDraft: (): MasterEffects => state.draft,
  };
}

/**
 * Transient Effects Rack editing: previews to local draft state on every
 * `onPatch`, writes `setEffects` exactly once on `onCommit`, and never
 * touches the store in between — modeled on `useBeatParamDraft`'s skeleton,
 * not its code (a flat `Partial<MasterEffects>` merge has no loop-identity
 * axis to track, unlike Beat's per-loop patch).
 */
export function useEffectsDraft(
  committedEffects: MasterEffects,
  setEffects: (next: MasterEffects) => void,
): EffectsDraft {
  const setEffectsRef = useRef(setEffects);
  setEffectsRef.current = setEffects;

  const machineRef = useRef<ReturnType<typeof createEffectsDraftMachine> | null>(null);
  if (!machineRef.current) {
    machineRef.current = createEffectsDraftMachine(committedEffects);
  }
  const machine = machineRef.current;
  machine.sync(committedEffects);

  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // The ONE effect here, and it is an unmount teardown only — never a render
  // path (see useBeatParamDraft's identical note).
  useEffect(() => () => machine.cancelIfDragging(), [machine]);

  const onPatch = useCallback(
    (updates: Partial<MasterEffects>) => {
      machine.onPatch(updates);
      forceRender();
    },
    [machine],
  );
  const onCommit = useCallback(() => {
    machine.commit((effects) => setEffectsRef.current(effects));
    forceRender();
  }, [machine]);
  const onCancel = useCallback(() => {
    machine.cancel();
    forceRender();
  }, [machine]);

  return {
    effects: machine.getDraft(),
    onPatch,
    onCommit,
    onCancel,
  };
}
