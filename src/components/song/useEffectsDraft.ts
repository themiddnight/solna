import { useCallback, useRef } from 'react';
import { previewEffects } from '@/store/effectsPreview';
import { useDraftGestureForceRender } from '@/components/useDraftGestureForceRender';
import type { MasterEffects } from '@/types';

export interface EffectsDraft {
  /** The effects to render: the live drag preview while a gesture is open,
   *  the committed effects otherwise. */
  effects: MasterEffects;
  /** Merges `updates` into the draft and previews it straight to the engine —
   *  no store write. */
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
 * `EffectsRackView` itself has no direct engine call of its own (confirmed by
 * grepping it for `audioEngine`/`audio/engine` — none): every wet/EQ/dynamics
 * knob previously reached the engine only by writing the store, which
 * `engineSync.ts`'s `effects` subscription then pushed to
 * `audioEngine.updateEffects`, coalesced to one call per animation frame
 * (`engineSync.ts:352`'s own comment: "the wet amount ... stays continuous,
 * so the knob is still audibly live"). That store write WAS this surface's
 * preview mechanism — there was never a component-level engine call to miss.
 * Once `onPatch` stopped writing the store, that path went with it and a
 * drag produced no sound until release. `previewEffects` (`store/effectsPreview.ts`)
 * restores it: same direct, synchronous push `createSynthPatchDraftMachine`
 * makes for the synth side, called on every `onPatch` rather than relying on
 * a store write to trigger it.
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
    previewEffects(state.draft);
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
    // Pull the engine back off the abandoned draft — without this the last
    // previewed value keeps sounding until some other write reaches it.
    previewEffects(state.committed);
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
 * Transient Effects Rack editing: previews straight to the engine and to
 * local draft state on every `onPatch`, writes `setEffects` exactly once on
 * `onCommit`, and never touches the store in between — modeled on
 * `useBeatParamDraft`'s skeleton, not its code (a flat `Partial<MasterEffects>`
 * merge has no loop-identity axis to track, unlike Beat's per-loop patch).
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

  const forceRender = useDraftGestureForceRender(machine);

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
