import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/store/store';
import type { KeyChangeOptions } from '@/store/keyChange';
import type { BatchKeyTarget, LoopKeyChangeUndo } from '@/store/loopKeyChange';
import { useTimedToast } from '@/components/ui/useTimedToast';
import { LOOP_UNDO_MS } from './loopUndo';

export interface UseLoopKeyChangeUndo {
  keyChangeOpen: boolean;
  openKeyChange: () => void;
  closeKeyChange: () => void;
  onApplyKeyChange: (ids: string[], target: BatchKeyTarget, opts: KeyChangeOptions) => void;
  keyChangeUndo: LoopKeyChangeUndo | null;
  onUndoKeyChange: () => void;
}

export function keyChangeToastMessage(undo: LoopKeyChangeUndo): string {
  const n = undo.snapshots.length;
  return `Key changed on ${n} loop${n === 1 ? '' : 's'}`;
}

/**
 * Batch key change from Arrange: the dialog's open state, the apply, and a
 * single-level timed Undo — the useLoopDeleteUndo pattern. A new batch replaces
 * a pending Undo; a project install dismisses it (loop ids collide across
 * projects, so an Undo there would write into the wrong loops).
 */
export function useLoopKeyChangeUndo(): UseLoopKeyChangeUndo {
  const [keyChangeOpen, setKeyChangeOpen] = useState(false);
  const { toast, show, dismiss } = useTimedToast<LoopKeyChangeUndo>();

  useEffect(() => useAppStore.subscribe((s) => s.projectInstallCount, dismiss), [dismiss]);

  const onApplyKeyChange = useCallback(
    (ids: string[], target: BatchKeyTarget, opts: KeyChangeOptions) => {
      const undo = useAppStore.getState().applyLoopKeyChange(ids, target, opts);
      if (undo) show(undo, LOOP_UNDO_MS);
    },
    [show],
  );

  const onUndoKeyChange = useCallback(() => {
    if (!toast) return;
    useAppStore.getState().undoLoopKeyChange(toast);
    dismiss();
  }, [toast, dismiss]);

  return {
    keyChangeOpen,
    openKeyChange: () => setKeyChangeOpen(true),
    closeKeyChange: () => setKeyChangeOpen(false),
    onApplyKeyChange,
    keyChangeUndo: toast,
    onUndoKeyChange,
  };
}
