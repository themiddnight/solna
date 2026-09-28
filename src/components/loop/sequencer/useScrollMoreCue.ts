import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** The three numbers "is there more to the right" is decided from. */
export interface HorizontalScrollMetrics {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/**
 * Whether content sits off-screen to the right. One pixel of slack: a zoomed
 * or high-DPI page reports a fractional `scrollLeft` at the scroll end, and a
 * cue that never quite hides would say "more" where there is none.
 */
export function hasMoreToRight({ scrollLeft, clientWidth, scrollWidth }: HorizontalScrollMetrics): boolean {
  return scrollWidth - (scrollLeft + clientWidth) > 1;
}

/**
 * The right-edge fade over the Beat grid (UX F-03). It fades from the card's
 * surface token so the last visible column dissolves rather than being cut,
 * which is what tells a phone user the grid continues. `pointer-events-none`
 * in both states: the cells under the fade stay tappable. Opacity, not
 * unmounting, so the cue eases out at the scroll end.
 */
export function scrollMoreCueClass(visible: boolean): string {
  return `pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-box bg-linear-to-l from-base-100 to-transparent transition-opacity ${
    visible ? 'opacity-100' : 'opacity-0'
  }`;
}

/** What `useScrollMoreCue` hands the grid (R266: a named return type). */
export interface UseScrollMoreCue<T extends HTMLElement> {
  /** Attach to the horizontal scroll container. */
  ref: RefObject<T | null>;
  /** Content sits off-screen to the right. */
  moreToRight: boolean;
  /** The container's `onScroll`. */
  onScroll: () => void;
}

/**
 * Tracks whether a horizontal scroll container has more content to its right.
 * The boolean is local `useState` (R016/R272): it changes only at the two
 * edges, and React drops a same-value set, so a scroll does not re-render the
 * grid per frame. Re-measured on scroll and on resize (a rotated phone).
 */
export function useScrollMoreCue<T extends HTMLElement>(): UseScrollMoreCue<T> {
  const ref = useRef<T>(null);
  const [moreToRight, setMoreToRight] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setMoreToRight(hasMoreToRight(el));
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, moreToRight, onScroll: measure };
}
