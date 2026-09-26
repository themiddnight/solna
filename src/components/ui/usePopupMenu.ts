import { useCallback, useState } from 'react';

export interface UsePopupMenu<T> {
  /** Whether the menu is open; never while disabled. */
  open: boolean;
  toggle: () => void;
  close: () => void;
  /** Closes the menu and runs the pick (both land in one render). */
  pick: (value: T) => void;
}

/** Whether a menu is open: what the user opened, and never while it is disabled. */
export function settledMenuOpen(isOpen: boolean, disabled: boolean): boolean {
  return isOpen && !disabled;
}

/**
 * The open state of a menu built on `ui/Popup` (the dock chips, the project
 * menu). Picking a row closes the menu, then runs the row's action, so any
 * dialog the action opens takes focus after `Popup` has handed it back to
 * the trigger.
 */
export function usePopupMenu<T>(onPick: (value: T) => void, disabled = false): UsePopupMenu<T> {
  const [isOpen, setOpen] = useState(false);
  const open = settledMenuOpen(isOpen, disabled);
  // "Adjusting state during render", not an effect: a menu disabled while
  // open is shut in its state, not just masked, so re-enabling it never
  // springs it back open. Guarded, so it runs once.
  if (isOpen !== open) setOpen(open);

  const toggle = useCallback(() => setOpen((wasOpen) => !wasOpen), []);
  const close = useCallback(() => setOpen(false), []);
  const pick = useCallback(
    (value: T) => {
      setOpen(false);
      onPick(value);
    },
    [onPick],
  );

  return { open, toggle, close, pick };
}
