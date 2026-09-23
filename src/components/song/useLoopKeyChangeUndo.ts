import { useCallback, useState } from 'react';
import { useAppStore } from '@/store/store';
import type { KeyChangeOptions } from '@/store/keyChange';
import type { BatchKeyTarget, LoopKeyChangeUndo } from '@/store/loopKeyChange';
import { useLoopUndo } from './useLoopUndo';

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

const restoreKeyChange = (undo: LoopKeyChangeUndo) => useAppStore.getState().undoLoopKeyChange(undo);

/**
 * Batch key change from Arrange: the dialog's open state, the apply, and a
 * single-level timed Undo (useLoopUndo) — a new batch replaces a pending Undo.
 */
export function useLoopKeyChangeUndo(): UseLoopKeyChangeUndo {
  const [keyChangeOpen, setKeyChangeOpen] = useState(false);
  const { pending, offer, undo } = useLoopUndo(restoreKeyChange);

  const onApplyKeyChange = useCallback(
    (ids: string[], target: BatchKeyTarget, opts: KeyChangeOptions) => {
      const next = useAppStore.getState().applyLoopKeyChange(ids, target, opts);
      if (next) offer(next);
    },
    [offer],
  );

  return {
    keyChangeOpen,
    openKeyChange: () => setKeyChangeOpen(true),
    closeKeyChange: () => setKeyChangeOpen(false),
    onApplyKeyChange,
    keyChangeUndo: pending,
    onUndoKeyChange: undo,
  };
}
