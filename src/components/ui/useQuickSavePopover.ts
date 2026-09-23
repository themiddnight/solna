import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Escape dismisses the popover. Exported because the key rule is the only part
 * of the dismissal that can be tested here — this runner has no DOM, so the
 * listener that calls it cannot be exercised.
 */
export function isDismissKey(e: Pick<KeyboardEvent, 'key'>): boolean {
  return e.key === 'Escape';
}

/**
 * Keeps the anchored panel inside the viewport horizontally (R328). `panel`
 * is the measured `left`/`right` of the rendered `dropdown-content` (its
 * natural position, anchored `dropdown-end` under the trigger); the return
 * value is the `translateX` (px) that pulls it back on screen. A panel wider
 * than the viewport cannot satisfy both edges, so it pins its left edge to
 * `margin` rather than split the overflow between the two.
 */
export function popupShift(
  panel: { left: number; right: number },
  viewportWidth: number,
  margin = 8,
): number {
  const width = panel.right - panel.left;
  if (width > viewportWidth - margin * 2) {
    return margin - panel.left;
  }
  if (panel.left < margin) {
    return margin - panel.left;
  }
  if (panel.right > viewportWidth - margin) {
    return viewportWidth - margin - panel.right;
  }
  return 0;
}

/**
 * The panel's viewport-relative position **before** any shift is applied to
 * it. `offsetLeft`/`offsetWidth` are box-model properties: unlike
 * `getBoundingClientRect()` they ignore `transform` entirely, so they read
 * the same natural position whether or not our own `translateX(shift)` is
 * currently applied, and whether or not daisyUI's `@starting-style`
 * `scale(.95)` open transition is still mid-flight. That makes measurement
 * idempotent — measuring twice in a row (or once before and once after
 * `shift` is applied) always yields the same natural rect, so `popupShift`
 * never flip-flops. This assumes `panel`'s offset parent is `wrapperLeft`'s
 * element (true here: daisyUI's `.dropdown` is `position: relative` and
 * `.dropdown-content` is `position: absolute`).
 */
export function panelNaturalRect(
  wrapperLeft: number,
  panel: { offsetLeft: number; offsetWidth: number },
): { left: number; right: number } {
  const left = wrapperLeft + panel.offsetLeft;
  return { left, right: left + panel.offsetWidth };
}

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
