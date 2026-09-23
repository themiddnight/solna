import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { MODAL_BOX } from './Modal';
import { useNativeDialog } from './useNativeDialog';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Extra classes on `modal-box`; the dialogs differ only in their `space-y`. */
  boxClassName?: string;
  /**
   * Rendered inside the dialog, after the box. For fixed overlays: the box's
   * `translate` would make itself their containing block and clip them.
   */
  afterBox?: ReactNode;
  children: ReactNode;
}

/**
 * The mobile-only bottom sheet (R326): `<dialog>` `modal modal-bottom`,
 * `showModal()`, always full width. It shares `MODAL_BOX` with `Modal` (so the
 * `fieldClasses` chrome guard still finds the literal only in `Modal.tsx`) and
 * `useNativeDialog` for the open sync and the native `close` listener — the
 * two effects `Modal` used to carry for its own `placement="bottom"` case
 * before the two overlays split (ADR-0044).
 */
export function BottomSheet({ open, onClose, title, boxClassName, afterBox, children }: BottomSheetProps) {
  const ref = useNativeDialog(open, onClose);

  return (
    <dialog ref={ref} className="modal modal-bottom">
      <div
        className={cx(MODAL_BOX, 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]', boxClassName)}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg flex items-center gap-2">{title}</h3>
          <IconButton label="Close" icon={<X className="w-4 h-4" />} className="min-h-11 min-w-11" onClick={onClose} />
        </div>
        {children}
      </div>
      {afterBox}
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
