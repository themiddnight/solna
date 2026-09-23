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

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: ModalSize;
  /** Rules the header off from the body — MidiSettingsModal's `border-b pb-4`. */
  headerDivider?: boolean;
  /** Extra classes on `modal-box`; the dialogs differ only in their `space-y`. */
  boxClassName?: string;
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  headerDivider = false,
  boxClassName,
  children,
}: ModalProps) {
  const ref = useNativeDialog(open, onClose);

  return (
    <dialog ref={ref} className="modal">
      <div className={cx(MODAL_BOX, SIZE_CLASS[size], boxClassName)}>
        <div className={cx('flex items-center justify-between', headerDivider && 'border-b border-base-300 pb-4')}>
          <h3 className="font-bold text-lg flex items-center gap-2">{title}</h3>
          <IconButton label="Close" icon={<X className="w-4 h-4" />} onClick={onClose} />
        </div>
        {children}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
