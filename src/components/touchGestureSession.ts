import type { SpanResizePointer } from '@/components/ui/useSpanResize';
import {
  TOUCH_LONG_PRESS_MS,
  TOUCH_SLOP_PX,
  touchGestureReduce,
  touchGestureStart,
  type TouchGestureEvent,
  type TouchGestureState,
} from './touchGesture';

/** One finger's position, as the grid's pointer handlers and window listeners read it. */
export interface TouchGesturePointer {
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** What a long-press does with the finger until it lifts. */
export interface TouchHold {
  move: (p: TouchGesturePointer) => void;
  /** The lift: the gesture completed. */
  end: () => void;
  /** An abort (a second finger, pointercancel, unmount): write nothing more. */
  cancel: () => void;
}

/** What a tap and a hold mean on one grid. Each grid's adapter supplies this. */
export interface TouchGestureTarget<TCell extends { covered: boolean }> {
  tap: (cell: TCell, pointerId: number) => void;
  /** A long-press took the finger. `pointer.clientX` is where the finger is
   * now, so a resize starts under it. Null: there is nothing to drag from
   * this cell; the session stays open, inert, and the lift rule decides. */
  hold: (cell: TCell, pointer: SpanResizePointer) => TouchHold | null;
}

/** The clock and timer the session cannot own; tests pass fakes. */
export interface TouchGestureDeps {
  now: () => number;
  /** Run `fn` once after `ms`; returns a canceller. */
  schedule: (ms: number, fn: () => void) => () => void;
}

export interface TouchGestureSession<TCell> {
  down: (p: TouchGesturePointer, cell: TCell) => void;
  move: (p: TouchGesturePointer) => void;
  /** True when the pointer was this session's; false lets a caller's mouse stroke close. */
  end: (p: TouchGesturePointer, type: 'pointerup' | 'pointercancel') => boolean;
  /** A live hold owns the finger: the grid blocks scrolling. */
  holding: () => boolean;
  /** A touch gesture is open: the grid swallows contextmenu. */
  isOpen: () => boolean;
  /** Unmount: drop everything, write nothing more. */
  dispose: () => void;
}

interface OpenTouch<TCell> {
  pointerId: number;
  cell: TCell;
  gesture: TouchGestureState;
  /** classifying: the reducer decides. inert: a long-press with nothing to
   * drag. holding: a live hold owns the finger. */
  mode: 'classifying' | 'inert' | 'holding';
  hold: TouchHold | null;
  lastX: number;
  cancelTimer: () => void;
}

const noop = (): void => undefined;

/**
 * One finger's gesture on a pattern grid (R343), and nothing about what the
 * grid does with it. Nothing is written on pointerdown: a tap reaches
 * `target.tap` on pointerup, a swipe or a cancel writes nothing, and a
 * long-press hands the finger to `target.hold`. A second finger cancels
 * whatever the first was doing and is itself ignored.
 */
export function createTouchGestureSession<TCell extends { covered: boolean }>(
  target: TouchGestureTarget<TCell>,
  deps: TouchGestureDeps,
): TouchGestureSession<TCell> {
  let current: OpenTouch<TCell> | null = null;

  const close = (): void => {
    current?.cancelTimer();
    current = null;
  };

  const abort = (): void => {
    current?.hold?.cancel();
    close();
  };

  // The lift rule after a long-press: add on an empty cell, leave a covered one alone.
  const liftAfterHold = (t: OpenTouch<TCell>): void => {
    if (!t.cell.covered) target.tap(t.cell, t.pointerId);
  };

  const startHold = (t: OpenTouch<TCell>): void => {
    const hold = target.hold(t.cell, { pointerId: t.pointerId, clientX: t.lastX });
    t.hold = hold;
    t.mode = hold ? 'holding' : 'inert';
  };

  const classify = (t: OpenTouch<TCell>, event: TouchGestureEvent): void => {
    t.gesture = touchGestureReduce(t.gesture, event);
    if (t.gesture.phase === 'long-press') startHold(t);
    else if (t.gesture.phase !== 'pending') close();
  };

  const release = (t: OpenTouch<TCell>, p: TouchGesturePointer): void => {
    if (t.mode === 'holding') {
      t.hold?.end();
      return;
    }
    if (t.mode === 'inert') {
      liftAfterHold(t);
      return;
    }
    const verdict = touchGestureReduce(t.gesture, {
      type: 'up',
      t: deps.now(),
      x: p.clientX,
      y: p.clientY,
    }).phase;
    // A lift at the hold threshold before the timer ran counts as the hold,
    // but never opens one: a resize started now would add its window
    // pointerup listener during the very dispatch it needed to hear.
    if (verdict === 'tap') target.tap(t.cell, t.pointerId);
    else if (verdict === 'long-press') liftAfterHold(t);
  };

  const pastSlop = (t: OpenTouch<TCell>, p: TouchGesturePointer): boolean =>
    Math.hypot(p.clientX - t.gesture.downX, p.clientY - t.gesture.downY) >= TOUCH_SLOP_PX;

  return {
    down: (p, cell) => {
      if (current) {
        abort();
        return;
      }
      const t: OpenTouch<TCell> = {
        pointerId: p.pointerId,
        cell,
        gesture: touchGestureStart(deps.now(), p.clientX, p.clientY),
        mode: 'classifying',
        hold: null,
        lastX: p.clientX,
        cancelTimer: noop,
      };
      current = t;
      t.cancelTimer = deps.schedule(TOUCH_LONG_PRESS_MS, () => {
        if (current === t && t.mode === 'classifying') classify(t, { type: 'timer' });
      });
    },
    move: (p) => {
      const t = current;
      if (!t || p.pointerId !== t.pointerId) return;
      t.lastX = p.clientX;
      if (t.mode === 'classifying') {
        classify(t, { type: 'move', t: deps.now(), x: p.clientX, y: p.clientY });
      } else if (t.mode === 'holding') {
        t.hold?.move(p);
      } else if (pastSlop(t, p)) {
        // Inert: the finger is leaving; give it back to the browser.
        close();
      }
    },
    end: (p, type) => {
      const t = current;
      if (!t || p.pointerId !== t.pointerId) return false;
      if (type === 'pointercancel') {
        abort();
      } else {
        release(t, p);
        close();
      }
      return true;
    },
    holding: () => current?.mode === 'holding',
    isOpen: () => current !== null,
    dispose: abort,
  };
}

/**
 * The hold for "long-press a note or event, then resize": `start` opens the
 * grid's span resize from the finger's position. The resize's own window
 * listeners drive the preview and commit once on pointerup (R125), so this
 * hold's move and end do nothing; an abort reaches the grid's cancel.
 */
export function resizeHold(
  pointer: SpanResizePointer,
  start: (pointer: SpanResizePointer) => void,
  cancel: () => void,
): TouchHold {
  start(pointer);
  return { move: noop, end: noop, cancel };
}
