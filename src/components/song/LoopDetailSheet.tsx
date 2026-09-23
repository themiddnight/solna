import { useCallback, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, Music, Trash2 } from 'lucide-react';
import { BottomSheet } from '../ui/BottomSheet';
import { MenuRowButton } from '../ui/MenuRowButton';
import { LoopCardMetaRow, LoopCardMixer } from './loopCardBody';
import type { SortableLoopCardProps } from './SortableLoopCard';

export interface UseLoopDetailSheet {
  open: boolean;
  /** False until the first open: a closed sheet costs nothing per card. */
  mounted: boolean;
  show: () => void;
  close: () => void;
}

/** The mobile detail sheet's open state, local to its card. */
export function useLoopDetailSheet(): UseLoopDetailSheet {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const show = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);
  // Stable: `BottomSheet` re-binds its `close` listener whenever this changes, and
  // the card re-renders on every step while its loop plays.
  const close = useCallback(() => setOpen(false), []);
  return { open, mounted, show, close };
}

/**
 * Below `md` a loop card is one row; everything else it holds on a wider
 * screen — key, repeat, progression, the mixer and the card commands — lives
 * in this bottom sheet. A command that leaves the Arrange view, or opens a
 * dialog of its own, closes the sheet first; the two reorder rows keep it open
 * so a loop can be nudged several places. Rename stays in the row: closing the
 * dialog hands focus back to its opener, which would blur the rename input
 * straight after it mounted.
 */
export function LoopDetailSheet({
  card,
  activeChordIndex,
  open,
  onClose,
}: {
  card: SortableLoopCardProps;
  activeChordIndex: number;
  open: boolean;
  onClose: () => void;
}) {
  const {
    loop,
    index,
    totalLoops,
    label,
    isPlaying,
    onSetRepeat,
    onSetMix,
    onEdit,
    onReorder,
    onDuplicate,
    onCopyInto,
    onDelete,
  } = card;
  const closeThen = (run: (id: string) => void) => () => {
    onClose();
    run(loop.id);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={label} boxClassName="flex flex-col gap-3">
      <LoopCardMetaRow
        loop={loop}
        label={label}
        isPlaying={isPlaying}
        activeChordIndex={activeChordIndex}
        onSetRepeat={onSetRepeat}
        idScope="sheet-"
      />
      <LoopCardMixer loop={loop} onSetMix={onSetMix} idScope="sheet-" />
      <div className="flex flex-col">
        <MenuRowButton
          id={`btn-sheet-loop-edit-${loop.id}`}
          icon={<Music className="w-4 h-4" />}
          label="Edit loop"
          onClick={closeThen(onEdit)}
        />
        <MenuRowButton
          id={`btn-sheet-loop-up-${loop.id}`}
          icon={<ArrowUp className="w-4 h-4" />}
          label="Move up"
          disabled={index === 0}
          onClick={() => onReorder(loop.id, -1)}
        />
        <MenuRowButton
          id={`btn-sheet-loop-down-${loop.id}`}
          icon={<ArrowDown className="w-4 h-4" />}
          label="Move down"
          disabled={index === totalLoops - 1}
          onClick={() => onReorder(loop.id, 1)}
        />
        <MenuRowButton
          id={`btn-sheet-loop-duplicate-${loop.id}`}
          icon={<Copy className="w-4 h-4" />}
          label="Duplicate loop"
          onClick={closeThen(onDuplicate)}
        />
        <MenuRowButton
          id={`btn-sheet-loop-copy-into-${loop.id}`}
          icon={<ClipboardPaste className="w-4 h-4" />}
          label="Copy parts from another loop"
          disabled={totalLoops <= 1}
          onClick={closeThen(onCopyInto)}
        />
        <MenuRowButton
          id={`btn-sheet-loop-delete-${loop.id}`}
          icon={<Trash2 className="w-4 h-4" />}
          label="Delete loop"
          disabled={totalLoops <= 1}
          className="text-error"
          onClick={closeThen(onDelete)}
        />
      </div>
    </BottomSheet>
  );
}
