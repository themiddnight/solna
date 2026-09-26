import type { ReactNode, RefObject } from 'react';
import { cx } from './cx';
import { usePopup } from './usePopup';

interface PopupProps {
  open: boolean;
  /** Closes the popup. Any function will do; `usePopup` reads the latest one. */
  onClose: () => void;
  /** The trigger the caller renders; it must not carry `tabindex` (daisyUI disables pointer events on one while open). */
  trigger: ReactNode;
  /** Which trigger edge the panel hangs from. */
  align: 'start' | 'end';
  /** Which side of the trigger the panel opens on; `top` is daisyUI `dropdown-top`. */
  side?: 'bottom' | 'top';
  /** Extra wrapper classes (e.g. `flex`, so a trigger in a `join` keeps the group's height). */
  className?: string;
  panelClassName?: string;
  /** Focused when the popup opens. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * The one popup shell (R328): a controlled daisyUI `dropdown` anchored to its
 * trigger, `dropdown-open` while open, its `z-50` panel (R331) mounted only
 * while open, opening below the trigger or above it (`side="top"`), and
 * shifted back inside the viewport. Closes on Escape, an outside pointerdown
 * and focus leaving it; see `usePopup`. The panel is `tabIndex={-1}`: a
 * pointerdown on its padding keeps focus inside the wrapper instead of
 * dropping it to <body>, and it stays out of the tab order.
 */
export function Popup({
  open,
  onClose,
  trigger,
  align,
  side = 'bottom',
  className,
  panelClassName,
  initialFocusRef,
  children,
}: PopupProps) {
  const { wrapperRef, panelRef, shift } = usePopup({ open, onClose, initialFocusRef });
  return (
    <div
      ref={wrapperRef}
      className={cx(
        'dropdown',
        align === 'end' ? 'dropdown-end' : 'dropdown-start',
        side === 'top' && 'dropdown-top',
        open && 'dropdown-open',
        className,
      )}
    >
      {trigger}
      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          className={cx('dropdown-content z-50 outline-none', panelClassName)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
