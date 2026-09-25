import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { isDismissKey, isOutside, panelNaturalRect, popupShift } from './popupGeometry';

export interface UsePopup {
  /** The `dropdown` wrapper: the trigger and the panel both sit inside it. */
  wrapperRef: RefObject<HTMLDivElement | null>;
  /** The `dropdown-content` panel, mounted only while open. */
  panelRef: RefObject<HTMLDivElement | null>;
  /** Horizontal `translateX` (px) that keeps the panel inside the viewport. */
  shift: number;
}

interface PopupOptions {
  open: boolean;
  /** Must be stable: every listener below re-subscribes when it changes. */
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Escape and a pointerdown outside the wrapper close the popup. Escape stops
 * propagating here: the page is full of shortcut keys on `window`.
 */
function useDismiss(open: boolean, onClose: () => void, wrapperRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isDismissKey(e)) return;
      e.stopPropagation();
      onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (!isOutside(e.target as Node | null, (node) => wrapper?.contains(node) ?? false)) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onClose, wrapperRef]);
}

/**
 * On open, focus moves to `initialFocusRef`; on close it goes back to what
 * had it before (the trigger). The panel is a plain `dropdown-content`, not
 * a <dialog>, so the platform does none of this. Focus leaving the wrapper
 * (Tab away) closes the popup and keeps focus where Tab sent it — pulling it
 * back to the trigger would fight the browser's own focus move.
 */
function useFocusHandoff(
  open: boolean,
  onClose: () => void,
  wrapperRef: RefObject<HTMLDivElement | null>,
  initialFocusRef: RefObject<HTMLElement | null> | undefined,
): void {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!open || !wrapper) return;
    let returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef?.current?.focus();
    const onFocusOut = (e: FocusEvent) => {
      if (!isOutside(e.relatedTarget as Node | null, (node) => wrapper.contains(node))) return;
      returnTo = null;
      onClose();
    };
    wrapper.addEventListener('focusout', onFocusOut);
    return () => {
      wrapper.removeEventListener('focusout', onFocusOut);
      returnTo?.focus();
    };
  }, [open, onClose, wrapperRef, initialFocusRef]);
}

/** Measures the panel on open and on resize and returns the shift that keeps it on screen (R328). */
function usePanelShift(
  open: boolean,
  wrapperRef: RefObject<HTMLDivElement | null>,
  panelRef: RefObject<HTMLDivElement | null>,
): number {
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      // The panel unmounts while closed; reset so a reopen never paints one
      // frame at a stale shift before `measure()` runs.
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
  }, [open, wrapperRef, panelRef]);
  return shift;
}

/**
 * `ui/Popup`'s platform glue (R328): dismissal, focus handoff and the
 * viewport shift, split into one small hook each.
 */
export function usePopup({ open, onClose, initialFocusRef }: PopupOptions): UsePopup {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(open, onClose, wrapperRef);
  useFocusHandoff(open, onClose, wrapperRef, initialFocusRef);
  const shift = usePanelShift(open, wrapperRef, panelRef);
  return { wrapperRef, panelRef, shift };
}
