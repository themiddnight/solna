import { useEffect, useRef } from 'react';
import type React from 'react';
import type { TouchGestureDeps, TouchGesturePointer } from './touchGestureSession';

/** `window` and the grid element in the app; bare EventTargets in tests. */
type ListenerTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * What the listeners forward to. A TouchGestureSession fits as it is; Lead
 * passes its paint handlers, whose `end` closes the mouse stroke when the
 * touch session does not own the pointer.
 */
export interface TouchGestureListeners {
  move: (p: TouchGesturePointer) => void;
  end: (p: TouchGesturePointer, type: 'pointerup' | 'pointercancel') => void;
  holding: () => boolean;
  isOpen: () => boolean;
  dispose: () => void;
}

const pointerOf = (event: Event): TouchGesturePointer => {
  const ev = event as Event & TouchGesturePointer;
  return { pointerId: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY };
};

/** The real clock and timer for a touch session in the browser. */
export const browserTouchClock: TouchGestureDeps = {
  now: () => performance.now(),
  schedule: (ms, fn) => {
    const id = window.setTimeout(fn, ms);
    return () => window.clearTimeout(id);
  },
};

/**
 * The five listeners a touch grid needs for its whole life, with no React in
 * it. The window's pointer events reach the session wherever the finger goes.
 * The element's `touchmove` is NON-PASSIVE and lifetime on purpose: a browser
 * decides whether a touch sequence may be cancelled when it begins, so a
 * listener added at pointerdown is too late to stop the pan under a
 * long-press. It calls preventDefault only while a hold owns the finger, so
 * a swipe still scrolls natively. `contextmenu` is swallowed while a gesture
 * is open (the Android long-press menu).
 *
 * The returned detach removes all five and disposes the session: an unmount
 * mid-gesture (a layout switch, R316) cancels the timer and any live hold
 * and writes nothing.
 */
export function attachTouchGestureListeners(
  element: ListenerTarget | null,
  windowTarget: ListenerTarget,
  listeners: TouchGestureListeners,
): () => void {
  const onMove = (ev: Event): void => listeners.move(pointerOf(ev));
  const onUp = (ev: Event): void => listeners.end(pointerOf(ev), 'pointerup');
  const onCancel = (ev: Event): void => listeners.end(pointerOf(ev), 'pointercancel');
  const onTouchMove = (ev: Event): void => {
    if (ev.cancelable && listeners.holding()) ev.preventDefault();
  };
  const onContextMenu = (ev: Event): void => {
    if (listeners.isOpen()) ev.preventDefault();
  };
  windowTarget.addEventListener('pointermove', onMove);
  windowTarget.addEventListener('pointerup', onUp);
  windowTarget.addEventListener('pointercancel', onCancel);
  element?.addEventListener('touchmove', onTouchMove, { passive: false });
  element?.addEventListener('contextmenu', onContextMenu);
  return () => {
    windowTarget.removeEventListener('pointermove', onMove);
    windowTarget.removeEventListener('pointerup', onUp);
    windowTarget.removeEventListener('pointercancel', onCancel);
    element?.removeEventListener('touchmove', onTouchMove);
    element?.removeEventListener('contextmenu', onContextMenu);
    listeners.dispose();
  };
}

/**
 * Attaches the touch listeners once, for the component's whole life. It
 * keeps the ref and the listeners it was first given; the caller builds the
 * listeners object once, so there is nothing newer to read.
 */
export function useTouchGestureListeners(
  elementRef: React.RefObject<HTMLElement | null>,
  listeners: TouchGestureListeners,
): void {
  const first = useRef({ elementRef, listeners });
  useEffect(() => {
    const { elementRef: ref, listeners: forward } = first.current;
    return attachTouchGestureListeners(ref.current, window, forward);
  }, []);
}
