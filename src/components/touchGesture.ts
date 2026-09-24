/**
 * Touch gestures on a pattern grid, decided with no DOM, no React and no
 * timers: the caller feeds timestamps and positions, this answers what the
 * finger meant. Mouse and pen never come here. One classifier for every grid
 * that takes touch — the Lead/FX pitch matrix and the custom Chord/Bass lane
 * (R343) — so the two cannot drift.
 *
 * The table: a lift before TOUCH_LONG_PRESS_MS inside the slop is a TAP;
 * TOUCH_SLOP_PX of travel before that is a SCROLL (the browser's, nothing is
 * written); reaching TOUCH_LONG_PRESS_MS inside the slop is a LONG-PRESS,
 * after which the session — not this reducer — owns the finger.
 */

/** How long a still finger must stay down to become a long-press. */
export const TOUCH_LONG_PRESS_MS = 300;

/** How far a finger may drift before the gesture is a scroll. */
export const TOUCH_SLOP_PX = 8;

type TouchGesturePhase = 'pending' | 'tap' | 'long-press' | 'scroll' | 'cancelled';

export interface TouchGestureState {
  phase: TouchGesturePhase;
  downAt: number;
  downX: number;
  downY: number;
}

interface TouchGestureSample {
  type: 'move' | 'up';
  t: number;
  x: number;
  y: number;
}

/** `timer` is the scheduled TOUCH_LONG_PRESS_MS callback; it carries no time
 * because firing at all is the proof that the hold elapsed. */
export type TouchGestureEvent = TouchGestureSample | { type: 'timer' } | { type: 'cancel' };

export function touchGestureStart(t: number, x: number, y: number): TouchGestureState {
  return { phase: 'pending', downAt: t, downX: x, downY: y };
}

/**
 * One step of the classifier. Order matters: cancel, then TIME, then
 * distance. Time goes first because a gesture is only still pending if it
 * stayed inside the slop until now — so a late timer, or a move or lift that
 * arrives after the hold was due, still counts as the hold.
 */
export function touchGestureReduce(state: TouchGestureState, event: TouchGestureEvent): TouchGestureState {
  if (state.phase !== 'pending') return state;
  if (event.type === 'cancel') return { ...state, phase: 'cancelled' };
  if (event.type === 'timer') return { ...state, phase: 'long-press' };
  if (event.t - state.downAt >= TOUCH_LONG_PRESS_MS) return { ...state, phase: 'long-press' };
  if (Math.hypot(event.x - state.downX, event.y - state.downY) >= TOUCH_SLOP_PX) {
    return { ...state, phase: 'scroll' };
  }
  return event.type === 'up' ? { ...state, phase: 'tap' } : state;
}
