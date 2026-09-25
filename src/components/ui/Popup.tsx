import type { ReactNode, RefObject } from 'react';
import { cx } from './cx';
import { usePopup } from './usePopup';

interface PopupProps {
  open: boolean;
  /** Closes the popup. Must be stable (`useCallback`): the dismissal listeners re-subscribe when it changes. */
  onClose: () => void;
  /** The trigger the caller renders; it must not carry `tabindex` (daisyUI disables pointer events on one while open). */
  trigger: ReactNode;
  /** Which trigger edge the panel hangs from. */
  align: 'start' | 'end';
  panelClassName?: string;
  /** Focused when the popup opens. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * The one popup shell (R328): a controlled daisyUI `dropdown` anchored to its
 * trigger, `dropdown-open` while open, its `z-50` panel (R331) mounted only
 * while open and shifted back inside the viewport. Closes on Escape, an
 * outside pointerdown and focus leaving it; see `usePopup`.
 */
export function Popup({ open, onClose, trigger, align, panelClassName, initialFocusRef, children }: PopupProps) {
  const { wrapperRef, panelRef, shift } = usePopup({ open, onClose, initialFocusRef });
  return (
    <div
      ref={wrapperRef}
      className={cx('dropdown', align === 'end' ? 'dropdown-end' : 'dropdown-start', open && 'dropdown-open')}
    >
      {trigger}
      {open && (
        <div
          ref={panelRef}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          className={cx('dropdown-content z-50', panelClassName)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
