import type { SpanResizePointer } from '@/components/ui/useSpanResize';
import type { LeadPaintController } from './leadPaint';
import {
  TOUCH_LONG_PRESS_MS,
  touchGestureReduce,
  touchGestureStart,
  type TouchGestureEvent,
  type TouchGestureState,
} from '@/components/touchGesture';
import { leadCellAtPoint, type LeadGridGeometry } from './leadTouchGesture';

interface LeadTouchPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** The cell a finger went down on, as the cell handler already knows it. */
interface LeadTouchCell {
  stepIndex: number;
  col: number;
  note: string;
  covered: boolean;
}

/** Everything the session cannot decide by itself; the hook supplies the DOM halves. */
export interface LeadTouchDeps {
  now: () => number;
  /** Run `fn` once after `ms`; returns a canceller. */
  schedule: (ms: number, fn: () => void) => () => void;
  /** The matrix's on-screen geometry, or null when it is not mounted. */
  measure: () => LeadGridGeometry | null;
  /** A matrix row's note, or undefined past the last row. */
  rowNote: (row: number) => string | undefined;
  /** Column → stored index, the same resolver the paint controller fills gaps with. */
  resolveStepIndex: (col: number) => number;
  /** Start resizing the note covering (col, note), keeping it on an unmoved lift. */
  startNoteResize: (pointer: SpanResizePointer, col: number, note: string) => void;
  /** Abandon that resize: no commit (R125). */
  cancelNoteResize: () => void;
}

export interface LeadTouchSession {
  down: (p: LeadTouchPointer, cell: LeadTouchCell) => void;
  move: (p: LeadTouchPointer) => void;
  /** True when the pointer was this session's; false lets the mouse stroke close. */
  end: (p: LeadTouchPointer, type: 'pointerup' | 'pointercancel') => boolean;
  /** A long-press owns the finger: the grid blocks scrolling. */
  holding: () => boolean;
  /** A touch gesture is open: the grid swallows contextmenu. */
  isOpen: () => boolean;
  /** Unmount: drop everything, write nothing more. */
  dispose: () => void;
}

interface OpenTouch {
  pointerId: number;
  cell: LeadTouchCell;
  gesture: TouchGestureState;
  mode: 'classifying' | 'painting' | 'resizing';
  lastX: number;
  geometry: LeadGridGeometry | null;
  cancelTimer: () => void;
}

const noop = (): void => undefined;

/**
 * One finger's gesture on the melody grid (R343). Nothing is written on
 * pointerdown: a tap edits its cell on pointerup through the paint
 * controller, a swipe or a cancel writes nothing, and a long-press starts
 * the controller's draw stroke (empty cell) or the shared span resize (note).
 * A second finger cancels whatever the first was doing.
 */
export function createLeadTouchSession(
  controller: LeadPaintController,
  deps: LeadTouchDeps,
): LeadTouchSession {
  let current: OpenTouch | null = null;

  const close = (): void => {
    current?.cancelTimer();
    current = null;
  };

  const abort = (): void => {
    if (current?.mode === 'painting') controller.end(current.pointerId);
    if (current?.mode === 'resizing') deps.cancelNoteResize();
    close();
  };

  const hold = (t: OpenTouch): void => {
    const { stepIndex, col, note, covered } = t.cell;
    if (covered) {
      t.mode = 'resizing';
      deps.startNoteResize({ pointerId: t.pointerId, clientX: t.lastX }, col, note);
      return;
    }
    t.mode = 'painting';
    t.geometry = deps.measure();
    // Draw mode, and the pressed cell fills now: the user sees the hold took.
    controller.begin(t.pointerId, stepIndex, col, note, false);
  };

  const classify = (t: OpenTouch, event: TouchGestureEvent): void => {
    t.gesture = touchGestureReduce(t.gesture, event);
    if (t.gesture.phase === 'long-press') hold(t);
    else if (t.gesture.phase !== 'pending') close();
  };

  const release = (t: OpenTouch, p: LeadTouchPointer): void => {
    if (t.mode === 'painting') {
      controller.end(t.pointerId);
      return;
    }
    // Resizing: useSpanResize's own pointerup listener commits.
    if (t.mode !== 'classifying') return;
    const verdict = touchGestureReduce(t.gesture, {
      type: 'up',
      t: deps.now(),
      x: p.clientX,
      y: p.clientY,
    }).phase;
    const { stepIndex, col, note, covered } = t.cell;
    // A tap edits its cell. A lift at the hold threshold before the timer
    // ran is a hold: it draws on an empty cell and leaves a note alone.
    if (verdict === 'tap' || (verdict === 'long-press' && !covered)) {
      controller.begin(t.pointerId, stepIndex, col, note, covered);
      controller.end(t.pointerId);
    }
  };

  return {
    down: (p, cell) => {
      if (current) {
        abort();
        return;
      }
      const t: OpenTouch = {
        pointerId: p.pointerId,
        cell,
        gesture: touchGestureStart(deps.now(), p.clientX, p.clientY),
        mode: 'classifying',
        lastX: p.clientX,
        geometry: null,
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
        return;
      }
      if (t.mode !== 'painting' || !t.geometry) return;
      const hit = leadCellAtPoint(t.geometry, p.clientX, p.clientY);
      const note = hit ? deps.rowNote(hit.row) : undefined;
      if (!hit || note === undefined) return;
      controller.visit(t.pointerId, deps.resolveStepIndex(hit.col), hit.col, note);
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
    holding: () => current !== null && current.mode !== 'classifying',
    isOpen: () => current !== null,
    dispose: abort,
  };
}
