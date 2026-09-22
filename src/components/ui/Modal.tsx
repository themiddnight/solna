import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { syncDialogOpen } from './syncDialogOpen';

type ModalSize = 'sm' | 'md' | 'lg';

/** `lg` is `max-w-2xl` because that is the width the two wide dialogs use. */
const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
};

/** The box chrome every dialog in the app shares; the guard test regexes for it. */
export const MODAL_BOX = 'modal-box bg-base-100 border border-base-300 shadow-2xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: ModalSize;
  /** Rules the header off from the body — MidiSettingsModal's `border-b pb-4`. */
  headerDivider?: boolean;
  /** Extra classes on `modal-box`; the dialogs differ only in their `space-y`. */
  boxClassName?: string;
  /** `bottom`: a full-width sheet anchored to the bottom edge (daisyUI `modal-bottom`). */
  placement?: 'middle' | 'bottom';
  /**
   * Rendered inside the dialog, after the box. For fixed overlays: the box's
   * `translate` would make itself their containing block and clip them.
   */
  afterBox?: ReactNode;
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  headerDivider = false,
  boxClassName,
  placement = 'middle',
  afterBox,
  children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);

  useEffect(() => {
    // Written before the sync so the `close` listener below can tell our own
    // close() apart from a user's Escape.
    openRef.current = open;
    syncDialogOpen(ref.current, open);
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Listen natively rather than through React's onClose: Escape, the backdrop
    // form and the header button all end in the same `close` event, which is
    // the single path the spec asks for and the one the platform's own focus
    // restoration already assumes. The openRef guard stops the close() we issue
    // ourselves (when the parent sets open=false) from calling back into the
    // parent a second time.
    const handleClose = () => {
      if (openRef.current) onClose();
    };
    el.addEventListener('close', handleClose);
    return () => el.removeEventListener('close', handleClose);
  }, [onClose]);

  // A sheet is full width by construction (daisyUI's `modal-bottom` stretches
  // the box), so a max-width would fight it; the extra bottom padding keeps the
  // last row clear of the home indicator.
  const sheet = placement === 'bottom';

  return (
    <dialog ref={ref} className={cx('modal', sheet && 'modal-bottom')}>
      <div
        className={cx(
          MODAL_BOX,
          !sheet && SIZE_CLASS[size],
          sheet && 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]',
          boxClassName,
        )}
      >
        <div className={cx('flex items-center justify-between', headerDivider && 'border-b border-base-300 pb-4')}>
          <h3 className="font-bold text-lg flex items-center gap-2">{title}</h3>
          <IconButton
            label="Close"
            icon={<X className="w-4 h-4" />}
            className={sheet ? 'min-h-11 min-w-11' : undefined}
            onClick={onClose}
          />
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
