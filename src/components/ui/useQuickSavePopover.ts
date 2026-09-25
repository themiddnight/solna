import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { isDismissKey, panelNaturalRect, popupShift } from "./popupGeometry";

export interface UseQuickSavePopover {
  wrapperRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Horizontal `translateX` (px) that keeps the panel inside the viewport. */
  shift: number;
}

/**
 * The popover's platform glue: focus in/out, Escape, an outside pointerdown
 * and the horizontal viewport shift — everything `QuickSavePopover.tsx`
 * needs refs and state for, kept out of that component's own body per the
 * colocated-hook convention (R265).
 */
export function useQuickSavePopover(open: boolean, onClose: () => void): UseQuickSavePopover {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    if (!open) return;
    // Recorded before focus moves. The panel is a plain `dropdown-content`,
    // not a <dialog>, so the platform does nothing for it: without this the
    // user is dropped at the top of the document when the popover closes,
    // several tab stops away from the trigger they opened it with.
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isDismissKey(e)) return;
      // The popover overlays a page full of shortcut-bound keys; stopping
      // here keeps Escape from also reaching a transport or keyboard handler.
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    // A dropdown, not a <dialog> with a backdrop: nothing else closes it, so
    // a tap outside the trigger/panel pair has to.
    const onPointerDown = (e: PointerEvent) => {
      if (wrapperRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!open) {
      // The panel unmounts with it (`{open && <QuickSavePanel />}`); reset so
      // a reopen never paints one frame at a stale shift before `measure()`
      // below re-runs (harmless given `panelNaturalRect`'s immunity to the
      // previously applied transform, but keeps `shift` truthful at rest).
      setShift(0);
      return;
    }
    const measure = () => {
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!wrapperRect || !panel) return;
      const natural = panelNaturalRect(wrapperRect.left, {
        offsetLeft: panel.offsetLeft,
        offsetWidth: panel.offsetWidth,
      });
      setShift(popupShift(natural, window.innerWidth));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  return { wrapperRef, panelRef, inputRef, shift };
}
