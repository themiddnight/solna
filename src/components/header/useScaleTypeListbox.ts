import { useCallback, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useAppStore } from '@/store/store';
import { isOpenKey } from '@/components/ui/listboxKeys';

/**
 * Writes a committed scale type unless it is the current one — as a native
 * select, which fires no change for its current value. `setScaleType` runs
 * `changeKey` and a store `set()` even for an unchanged type.
 */
export function commitScaleType(current: string, next: string, write: (scaleType: string) => void): void {
  if (next !== current) write(next);
}

export interface UseScaleTypeListbox {
  scaleType: string;
  open: boolean;
  toggle: () => void;
  close: () => void;
  onTriggerKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  listboxRef: RefObject<HTMLDivElement | null>;
  /** Writes the scale (unless unchanged), then closes the popup if `closeOnCommit`. */
  onCommit: (value: string) => void;
}

/**
 * A scale-type popup's state: open/close, open keys and commit. The xl
 * trigger closes on a commit; the compact key/scale panel (`closeOnCommit`
 * false) stays open, as the <details> it replaced did: the root select sits
 * beside the list, and a key is often set in two picks.
 */
export function useScaleTypeListbox(closeOnCommit = true): UseScaleTypeListbox {
  const scaleType = useAppStore((s) => s.scaleType);
  const setScaleType = useAppStore((s) => s.setScaleType);
  const [open, setOpen] = useState(false);
  const listboxRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((wasOpen) => !wasOpen), []);
  const close = useCallback(() => setOpen(false), []);

  const onTriggerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (open || !isOpenKey(e.key)) return;
      // Enter would also synthesise a click on the button, toggling the popup
      // straight back shut; the page's shortcuts must not see the key either.
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    },
    [open],
  );

  const onCommit = useCallback(
    (value: string) => {
      commitScaleType(scaleType, value, setScaleType);
      if (closeOnCommit) setOpen(false);
    },
    [scaleType, setScaleType, closeOnCommit],
  );

  return { scaleType, open, toggle, close, onTriggerKeyDown, listboxRef, onCommit };
}
