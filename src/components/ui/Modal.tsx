import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { useNativeDialog } from './useNativeDialog';

type ModalSize = 'sm' | 'md' | 'lg';

/** `lg` is `max-w-2xl` because that is the width the two wide dialogs use. */
const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
};

/** The box chrome every dialog in the app shares; the guard test regexes for it. */
export const MODAL_BOX = 'modal-box bg-base-100 border border-base-300 shadow-2xl';

/**
 * Every titled overlay's box is a column (R339): the header pinned at the
 * top, the body the only thing that scrolls, an optional footer pinned at the
 * bottom. `overflow-hidden` replaces `modal-box`'s own `overflow-y: auto`, so
 * the title and its close button never scroll away.
 */
export const SURFACE_COLUMN = 'flex flex-col gap-4 overflow-hidden';

/** The pinned header row: the title and the close button. */
export const SURFACE_HEADER = 'flex shrink-0 items-center justify-between';

/**
 * The scroll container. `-m-1 p-1` gives a focus ring on the body's edge room
 * to draw instead of being clipped by the scroll box, without moving the content.
 */
export const SURFACE_BODY = 'min-h-0 flex-1 overflow-y-auto overscroll-contain -m-1 p-1';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: ModalSize;
  /** Rules the header off from the body — MidiSettingsModal's `border-b pb-4`. */
  headerDivider?: boolean;
  /** Extra classes on the scrolling body; the dialogs differ only in their `space-y`. */
  bodyClassName?: string;
  /** Pinned below the scrolling body: a dialog's `modal-action` row, the vibe picker's Play/Use row. */
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  headerDivider = false,
  bodyClassName,
  footer,
  children,
}: ModalProps) {
  const ref = useNativeDialog(open, onClose);

  return (
    <dialog ref={ref} className="modal">
      <div className={cx(MODAL_BOX, SIZE_CLASS[size], SURFACE_COLUMN)}>
        <div className={cx(SURFACE_HEADER, headerDivider && 'border-b border-base-300 pb-4')}>
          <h3 className="font-bold text-lg flex items-center gap-2">{title}</h3>
          <IconButton label="Close" icon={<X className="w-4 h-4" />} onClick={onClose} />
        </div>
        <div className={cx(SURFACE_BODY, bodyClassName)}>{children}</div>
        {/* The box's gap already spaces the footer off the body, so a `modal-action` drops its own top margin. */}
        {footer !== undefined && <div className="shrink-0 [&>.modal-action]:mt-0">{footer}</div>}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
