import { useRef } from 'react';
import type React from 'react';
import { createTouchGestureSession, type TouchGestureSession } from '@/components/touchGestureSession';
import { browserTouchClock, useTouchGestureListeners } from '@/components/useTouchGestureListeners';
import {
  createPatternClickFilter,
  createPatternTouchHandlers,
  createPatternTouchTarget,
  type PatternTouchCell,
  type PatternTouchDeps,
  type PatternTouchHandlers,
} from './patternTouch';

/** What the lane's cells and its grid element wire to. */
export interface UsePatternTouch extends PatternTouchHandlers {
  /** The grid's onPointerDownCapture: tells the click filter which pointer pressed last. */
  onGridPointerDownCapture: (event: { pointerType: string }) => void;
  /** Whether a click may activate: always for detail 0, never right after a touch. */
  allowClick: (detail: number) => boolean;
}

/**
 * Touch on the custom Chord/Bass lane (R343). Every decision lives in
 * patternTouch.ts and the shared session; this builds them once and attaches
 * the shared listeners. Both panels pass fresh callbacks on every render, so
 * the target reads them through a ref.
 */
export function usePatternTouch(
  gridRef: React.RefObject<HTMLDivElement | null>,
  deps: PatternTouchDeps,
): UsePatternTouch {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const built = useRef<{ session: TouchGestureSession<PatternTouchCell>; wiring: UsePatternTouch } | null>(null);

  if (!built.current) {
    const target = createPatternTouchTarget({
      onActivate: (column) => depsRef.current.onActivate(column),
      onResize: (column, length) => depsRef.current.onResize(column, length),
      identityFor: (column) => depsRef.current.identityFor(column),
      columnWidthPx: () => depsRef.current.columnWidthPx(),
      startResize: (pointer, input) => depsRef.current.startResize(pointer, input),
      cancelResize: () => depsRef.current.cancelResize(),
    });
    const session = createTouchGestureSession(target, browserTouchClock);
    const filter = createPatternClickFilter();
    built.current = {
      session,
      wiring: {
        ...createPatternTouchHandlers(session),
        onGridPointerDownCapture: (event) => filter.pointerDown(event.pointerType),
        allowClick: (detail) => filter.allowClick(detail),
      },
    };
  }

  useTouchGestureListeners(gridRef, built.current.session);
  return built.current.wiring;
}
