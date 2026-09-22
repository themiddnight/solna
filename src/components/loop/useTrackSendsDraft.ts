import { useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/store/store';
import { previewTrackSends } from '@/store/trackSendsPreview';
import type { SourceBusId } from '@/store/sourceBuses';
import type { SendEffect, TrackSendLevels } from '@/types';
import { useDraftGestureForceRender } from '@/components/useDraftGestureForceRender';

export interface UseTrackSendsDraft {
  /** The draft while a gesture is open, the committed row otherwise. */
  sends: TrackSendLevels;
  /** Per effect: draft + preview straight to the engine — no store write. */
  onChangeFor: Record<SendEffect, (value: number) => void>;
  /** Ends the gesture by writing the draft through `setTrackSends`, once. */
  onCommit: () => void;
  /** Ends the gesture by discarding the draft and previewing the committed row. */
  onCancel: () => void;
}

interface DraftState {
  draft: TrackSendLevels;
  committed: TrackSendLevels;
  dragging: boolean;
}

/**
 * The pure state machine behind `useTrackSendsDraft`, isolated from React —
 * the `createEffectsDraftMachine` split, for the same reason: `renderToString`
 * cannot carry hook state across calls. The dragged value stays here (R016,
 * R272); the persisted row is written once, on release (R212).
 */
export function createTrackSendsDraftMachine(committed: TrackSendLevels, source: SourceBusId) {
  const state: DraftState = { draft: committed, committed, dragging: false };

  /** Called once per render with the latest committed row. */
  function sync(next: TrackSendLevels): void {
    state.committed = next;
    if (!state.dragging) state.draft = next;
  }

  function onChange(effect: SendEffect, value: number): void {
    state.dragging = true;
    state.draft = { ...state.draft, [effect]: value };
    previewTrackSends(source, state.draft);
  }

  /** Writes only if a gesture is open: a release with no move is not an edit. */
  function commit(setTrackSends: (source: SourceBusId, sends: TrackSendLevels) => void): void {
    if (!state.dragging) return;
    state.dragging = false;
    state.committed = state.draft;
    setTrackSends(source, state.draft);
  }

  function cancel(): void {
    state.dragging = false;
    state.draft = state.committed;
    // Pull the engine back off the abandoned draft.
    previewTrackSends(source, state.committed);
  }

  /** Unmount teardown: only a gesture still open has anything to undo. */
  function cancelIfDragging(): void {
    if (state.dragging) cancel();
  }

  return {
    sync,
    onChange,
    commit,
    cancel,
    cancelIfDragging,
    getDraft: (): TrackSendLevels => state.draft,
  };
}

/** One Mixer row's three send knobs: local draft, engine preview, one store write on release. */
export function useTrackSendsDraft(source: SourceBusId): UseTrackSendsDraft {
  // The stored row by reference, never a fresh object (R274/R275): a knob
  // release re-renders this row alone.
  const committed = useAppStore((s) => s.trackSends[source]);
  const setTrackSends = useAppStore((s) => s.setTrackSends);

  const machineRef = useRef<ReturnType<typeof createTrackSendsDraftMachine> | null>(null);
  if (!machineRef.current) {
    machineRef.current = createTrackSendsDraftMachine(committed, source);
  }
  const machine = machineRef.current;
  machine.sync(committed);

  const forceRender = useDraftGestureForceRender(machine);

  const onChangeFor = useMemo(() => {
    const handler = (effect: SendEffect) => (value: number) => {
      machine.onChange(effect, value);
      forceRender();
    };
    return { reverb: handler('reverb'), delay: handler('delay'), distortion: handler('distortion') };
  }, [machine, forceRender]);
  const onCommit = useCallback(() => {
    machine.commit(setTrackSends);
    forceRender();
  }, [machine, setTrackSends, forceRender]);
  const onCancel = useCallback(() => {
    machine.cancel();
    forceRender();
  }, [machine, forceRender]);

  return { sends: machine.getDraft(), onChangeFor, onCommit, onCancel };
}
