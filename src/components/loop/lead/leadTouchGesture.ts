/**
 * Touch gestures on the melody grid, decided with no DOM, no React and no
 * timers: the caller feeds timestamps and positions, this answers what the
 * finger meant. Mouse and pen never come here — they paint on pointerdown.
 *
 * The table (R343): a lift before LEAD_LONG_PRESS_MS inside the slop is a
 * TAP; LEAD_TOUCH_SLOP_PX of travel before that is a SCROLL (the browser's,
 * nothing is written); reaching LEAD_LONG_PRESS_MS inside the slop is a
 * LONG-PRESS, after which the session — not this reducer — owns the finger.
 */

/** How long a still finger must stay down to become a long-press. */
export const LEAD_LONG_PRESS_MS = 300;

/** How far a finger may drift before the gesture is a scroll. */
export const LEAD_TOUCH_SLOP_PX = 8;

type LeadTouchPhase = 'pending' | 'tap' | 'long-press' | 'scroll' | 'cancelled';

export interface LeadTouchState {
  phase: LeadTouchPhase;
  downAt: number;
  downX: number;
  downY: number;
}

interface LeadTouchPointerEvent {
  type: 'move' | 'up';
  t: number;
  x: number;
  y: number;
}

/** `timer` is the scheduled LEAD_LONG_PRESS_MS callback; it carries no time
 * because firing at all is the proof that the hold elapsed. */
export type LeadTouchEvent = LeadTouchPointerEvent | { type: 'timer' } | { type: 'cancel' };

export function leadTouchStart(t: number, x: number, y: number): LeadTouchState {
  return { phase: 'pending', downAt: t, downX: x, downY: y };
}

/**
 * One step of the classifier. Order matters: cancel, then TIME, then
 * distance. Time goes first because a gesture is only still pending if it
 * stayed inside the slop until now — so a late timer, or a move or lift that
 * arrives after the hold was due, still counts as the hold.
 */
export function leadTouchReduce(state: LeadTouchState, event: LeadTouchEvent): LeadTouchState {
  if (state.phase !== 'pending') return state;
  if (event.type === 'cancel') return { ...state, phase: 'cancelled' };
  if (event.type === 'timer') return { ...state, phase: 'long-press' };
  if (event.t - state.downAt >= LEAD_LONG_PRESS_MS) return { ...state, phase: 'long-press' };
  if (Math.hypot(event.x - state.downX, event.y - state.downY) >= LEAD_TOUCH_SLOP_PX) {
    return { ...state, phase: 'scroll' };
  }
  return event.type === 'up' ? { ...state, phase: 'tap' } : state;
}
