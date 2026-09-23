import { useCallback, useEffect } from 'react';
import { useAppStore } from '@/store/store';
import { useTimedToast } from '../ui/useTimedToast';

/** How long a loop delete or a batch key change stays undoable. */
const LOOP_UNDO_MS = 5000;

export interface UseLoopUndo<T> {
  /** The pending Undo, or null when there is none. */
  pending: T | null;
  /** Makes `undo` the pending one, replacing any other and restarting the window. */
  offer: (undo: T) => void;
  /** Runs `restore` on the pending Undo and dismisses it; a no-op when none is pending. */
  undo: () => void;
}

/**
 * One single-level, timed Arrange Undo (loop delete, batch key change).
 * ArrangeView stays mounted across a project install, and loop ids collide
 * across projects, so an install dismisses a pending Undo — off a store
 * subscription rather than a selector, so the view never re-renders for it.
 * `restore` must be stable (a module-level function).
 */
export function useLoopUndo<T>(restore: (undo: T) => void): UseLoopUndo<T> {
  const { toast, show, dismiss } = useTimedToast<T>();

  useEffect(() => useAppStore.subscribe((s) => s.projectInstallCount, dismiss), [dismiss]);

  const offer = useCallback((next: T) => show(next, LOOP_UNDO_MS), [show]);

  const undo = useCallback(() => {
    if (!toast) return;
    restore(toast);
    dismiss();
  }, [toast, restore, dismiss]);

  return { pending: toast, offer, undo };
}
