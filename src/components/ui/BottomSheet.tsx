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
  /**
   * `false` for a sheet whose frame must stay interactive while it is open —
   * the transport sheet, whose Play/Stop sit on the bar below it (R326).
   */
  modal?: boolean;
  /** The dialog's id, for a trigger's `aria-controls`; also names the title for `aria-labelledby`. */
  id?: string;
  /** Extra classes on the box (`modal-box`, or the non-modal dialog itself); the sheets differ only in their `space-y`. */
  boxClassName?: string;
  /**
   * Rendered inside the dialog, after the box. For fixed overlays: the box's
   * `translate` would make itself their containing block and clip them.
   */
  afterBox?: ReactNode;
  children: ReactNode;
}

/**
 * The non-modal sheet's own chrome: no daisyUI `modal` (a `fixed inset-0`
 * layer that would catch every tap on the page) and no `modal-box` (hidden and
 * scaled unless inside an open `.modal`). It anchors to the top edge of its
 * nearest positioned ancestor — the caller renders it inside the bar it opens
 * from — so it needs no offset of its own and no safe-area padding: the frame's
 * one inset consumer stays below it (R321). `z-40` is the frame-bar step of
 * R331, the bar it belongs to; `max-h-[60dvh]` keeps a landscape phone's top
 * bar in view.
 */
const NON_MODAL_SHEET =
  'absolute bottom-full inset-x-0 z-40 m-0 w-full max-w-none max-h-[60dvh] overflow-y-auto overscroll-contain bg-base-100 text-base-content border-t border-base-300 rounded-t-box shadow-2xl p-4';

function SheetHeader({ title, titleId, onClose }: { title: ReactNode; titleId?: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h3 id={titleId} className="font-bold text-lg flex items-center gap-2">{title}</h3>
      <IconButton label="Close" icon={<X className="w-4 h-4" />} className="min-h-11 min-w-11" onClick={onClose} />
    </div>
  );
}

/**
 * The mobile-only bottom sheet (R326), always full width. Modal by default:
 * `<dialog>` `modal modal-bottom`, `showModal()`. It shares `MODAL_BOX` with
 * `Modal` (so the `fieldClasses` chrome guard still finds the literal only in
 * `Modal.tsx`) and `useNativeDialog` for the open sync and the native `close`
 * listener — the two effects `Modal` used to carry for its own
 * `placement="bottom"` case before the two overlays split (ADR-0044).
 *
 * `modal={false}` opens with `show()`: no backdrop, not in the top layer, no
 * feedback hold, and the page stays interactive around it. It closes on its
 * trigger, its close button and Escape — never on an outside tap.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  modal = true,
  id,
  boxClassName,
  afterBox,
  children,
}: BottomSheetProps) {
  const ref = useNativeDialog(open, onClose, modal);
  const titleId = id === undefined ? undefined : `${id}-title`;

  if (!modal) {
    return (
      <dialog ref={ref} id={id} aria-labelledby={titleId} className={cx(NON_MODAL_SHEET, boxClassName)}>
        <SheetHeader title={title} titleId={titleId} onClose={onClose} />
        {children}
        {afterBox}
      </dialog>
    );
  }

  return (
    <dialog ref={ref} id={id} aria-labelledby={titleId} className="modal modal-bottom">
      <div
        className={cx(MODAL_BOX, 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]', boxClassName)}
      >
        <SheetHeader title={title} titleId={titleId} onClose={onClose} />
        {children}
      </div>
      {afterBox}
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
