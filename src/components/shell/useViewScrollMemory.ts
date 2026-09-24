import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { segmentForFocus, type MixLayerId } from '@/store/focusTrack';
import type { PatternSegment, ViewMode } from '@/types';
import { useLiveStore } from '../ui/useLiveStore';

/**
 * Which visible view the frame's one scroll container is showing: the active
 * tab, plus the Pattern segment when the tab is Pattern (R342). Every view
 * stays mounted (R014) and shares the container, so this is what a scroll
 * position belongs to.
 */
export type ViewScrollKey = Exclude<ViewMode, 'pattern'> | `pattern:${PatternSegment}`;

export function viewScrollKey(tab: ViewMode, focus: MixLayerId): ViewScrollKey {
  return tab === 'pattern' ? `pattern:${segmentForFocus(focus)}` : tab;
}

/**
 * The save/restore bookkeeping, kept pure so it is testable without a DOM.
 *
 * - `record(top)` stores a scroll event's `scrollTop` against the current view,
 *   unless the memory is settling after a switch.
 * - `switchTo(key)` makes `key` current and returns where it should be
 *   restored to: its saved position, or 0 on a first visit. It starts a
 *   settling window, because the switch makes the browser clamp the old
 *   `scrollTop` to the new view's height and fire a scroll event for that
 *   clamp (and for the restore itself) a frame later; that value belongs to
 *   neither view.
 * - `settle()` ends the window; the hook calls it on the next animation frame,
 *   which runs after that frame's scroll events have been dispatched.
 */
export interface ViewScrollMemory {
  record(top: number): void;
  switchTo(key: ViewScrollKey): number;
  settle(): void;
  readonly current: ViewScrollKey;
}

export function createViewScrollMemory(initial: ViewScrollKey): ViewScrollMemory {
  const positions = new Map<ViewScrollKey, number>();
  let current = initial;
  let settling = false;
  return {
    record(top) {
      if (!settling) positions.set(current, top);
    },
    switchTo(key) {
      current = key;
      settling = true;
      return positions.get(key) ?? 0;
    },
    settle() {
      settling = false;
    },
    get current() {
      return current;
    },
  };
}

export interface UseViewScrollMemory {
  scrollRef: RefObject<HTMLElement | null>;
}

/**
 * Remembers the scroll position per visible view and restores it before paint
 * on a switch, so a short view never shows the long one's clamped position.
 * The positions live in a memory the hook owns, never in a slice, and are not
 * persisted (R016);
 * a layout switch remounts the frame and starts the memory afresh.
 */
export function useViewScrollMemory(): UseViewScrollMemory {
  const key = useLiveStore((s) => viewScrollKey(s.activeTab, s.focusTrack));
  const scrollRef = useRef<HTMLElement | null>(null);
  const [memory] = useState(() => createViewScrollMemory(key));

  // The outgoing view's position comes from here, never from the switch: by
  // the time a layout effect runs the DOM has switched and the old value may
  // already be clamped.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => memory.record(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [memory]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || memory.current === key) return;
    el.scrollTop = memory.switchTo(key);
    const frame = requestAnimationFrame(() => memory.settle());
    return () => {
      cancelAnimationFrame(frame);
      memory.settle();
    };
  }, [memory, key]);

  return { scrollRef };
}
