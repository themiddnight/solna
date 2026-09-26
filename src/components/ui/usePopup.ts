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
  /** Read through a latest-ref: an inline arrow is fine, and a new one never re-runs an effect. */
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * The newest `value`, readable from a listener without that listener's effect
 * depending on it. Written in a layout effect, never during render, so it is
 * current before any passive effect or event reads it.
 */
function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Escape and a pointerdown outside the wrapper close the popup. Escape stops
 * propagating here: the page is full of shortcut keys on `window`. It stays
 * in the bubble phase, so a focused control inside the panel sees it first.
 * The pointerdown listens in the capture phase: an outside handler that
 * stops propagation (a span-resize handle, say) cannot keep the popup open.
 */
function useDismiss(
  open: boolean,
  onCloseRef: RefObject<() => void>,
  wrapperRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isDismissKey(e)) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    const onPointerDown = (e: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (!isOutside(e.target as Node | null, (node) => wrapper?.contains(node) ?? false)) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
    };
  }, [open, onCloseRef, wrapperRef]);
}

/**
 * On open, focus moves to `initialFocusRef`; on close it goes back to what
 * had it before (the trigger). The panel is a plain `dropdown-content`, not
 * a <dialog>, so the platform does none of this. Focus leaving the wrapper
 * (Tab away) closes the popup and keeps focus where Tab sent it — pulling it
 * back to the trigger would fight the browser's own focus move. The effect
 * never depends on `onClose`: a re-subscription would hand focus back to the
 * trigger and refocus the input on every parent re-render.
 */
function useFocusHandoff(
  open: boolean,
  onCloseRef: RefObject<() => void>,
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
      onCloseRef.current();
    };
    wrapper.addEventListener('focusout', onFocusOut);
    return () => {
      wrapper.removeEventListener('focusout', onFocusOut);
      returnTo?.focus();
    };
  }, [open, onCloseRef, wrapperRef, initialFocusRef]);
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
  const onCloseRef = useLatest(onClose);
  useDismiss(open, onCloseRef, wrapperRef);
  useFocusHandoff(open, onCloseRef, wrapperRef, initialFocusRef);
  const shift = usePanelShift(open, wrapperRef, panelRef);
  return { wrapperRef, panelRef, shift };
}
