import { useCallback, useEffect } from 'react';
import { useAppStore } from '@/store/store';
import type { FeedbackRequest } from '@/store/feedback';

export interface UseLoopUndo<T> {
  /** Offers `payload` as an Undo snackbar, replacing any other pending one and restarting its window. */
  offer: (payload: T) => void;
}

/**
 * Builds the Undo snackbar's `FeedbackRequest` for one payload — pure, so the
 * closure `run` takes over `payload` (this call's, never a later offer's) is
 * testable without a store or a clock. `key` doubles as the Undo button's DOM
 * id (`btn-undo-loop-delete`, `btn-undo-key-change`).
 */
export function buildLoopUndoRequest<T>(
  restore: (payload: T) => void,
  key: string,
  messageOf: (payload: T) => string,
  payload: T,
): FeedbackRequest {
  return {
    key,
    message: messageOf(payload),
    tone: 'info',
    action: { id: key, label: 'Undo', run: () => restore(payload) },
  };
}

/**
 * One single-level, timed Arrange Undo snackbar (loop delete, batch key
 * change), raised through the shared feedback host (§5.6). ArrangeView stays
 * mounted across a project install, and loop ids collide across projects, so
 * an install dismisses a pending Undo — off a store subscription rather than
 * a selector, so the view never re-renders for it. `restore` and `messageOf`
 * must be stable (module-level functions).
 */
export function useLoopUndo<T>(
  restore: (payload: T) => void,
  key: string,
  messageOf: (payload: T) => string,
): UseLoopUndo<T> {
  useEffect(
    () =>
      useAppStore.subscribe(
        (s) => s.projectInstallCount,
        () => useAppStore.getState().dismissFeedback(key),
      ),
    [key],
  );

  const offer = useCallback(
    (payload: T) =>
      useAppStore.getState().showFeedback(buildLoopUndoRequest(restore, key, messageOf, payload)),
    [restore, key, messageOf],
  );

  return { offer };
}
