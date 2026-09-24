import {
  resizeHold,
  type TouchGestureSession,
  type TouchGestureTarget,
} from '@/components/touchGestureSession';
import type { SpanResizePointer, SpanResizeStart } from '@/components/ui/useSpanResize';

/** What one head's resize gesture needs to identify — stable by reference. */
export interface PatternSpanIdentity {
  column: number;
}

/** The column a finger went down on, as the cell renderer knows it at
 * pointerdown. Nothing writes during the gesture, so it cannot go stale. */
export type PatternTouchCell =
  | { column: number; covered: false }
  | { column: number; covered: true; length: number; maxLength: number };

/** Everything the lane adapter calls out to; the hook reads each through a ref. */
export interface PatternTouchDeps {
  onActivate: (column: number) => void;
  onResize: (column: number, length: number) => void;
  /** The lane's per-column, reference-stable identity, so previewFor matches. */
  identityFor: (column: number) => PatternSpanIdentity;
  /** One column's measured width in px. */
  columnWidthPx: () => number;
  startResize: (pointer: SpanResizePointer, input: SpanResizeStart<PatternSpanIdentity>) => void;
  cancelResize: () => void;
}

/** The fields the lane's pointerdown handlers read; a React pointer event qualifies. */
interface PatternPointerLike {
  pointerId: number;
  pointerType: string;
  button: number;
  clientX: number;
  clientY: number;
}

export interface PatternTouchHandlers {
  /** The empty button's and the head wrapper's pointerdown. */
  onCellPointerDown: (event: PatternPointerLike, cell: PatternTouchCell) => void;
  /** The resize handle's pointerdown; `startDrag` is the mouse/pen drag. */
  onHandlePointerDown: (event: PatternPointerLike, startDrag: () => void) => void;
}

interface PatternClickFilter {
  /** Every pointerdown in the lane, seen in the capture phase. */
  pointerDown: (pointerType: string) => void;
  /** Whether a click may activate. */
  allowClick: (detail: number) => boolean;
}

const noop = (): void => undefined;

/**
 * What a tap and a hold mean on the custom Chord/Bass lane (R343). A tap
 * activates the column — what a click does, so on the Chord lane a tap on an
 * event removes it. A long-press on an event resizes it; an unmoved lift is
 * the span's "click", pointed at a no-op so it keeps the event. A long-press
 * on an empty column has nothing to drag: the hold is null, and the shared
 * lift rule activates the column on the lift.
 */
export function createPatternTouchTarget(deps: PatternTouchDeps): TouchGestureTarget<PatternTouchCell> {
  return {
    tap: (cell) => deps.onActivate(cell.column),
    hold: (cell, pointer) => {
      if (!cell.covered) return null;
      return resizeHold(
        pointer,
        (p) =>
          deps.startResize(p, {
            identity: deps.identityFor(cell.column),
            startLength: cell.length,
            maxLength: cell.maxLength,
            pixelsPerStep: deps.columnWidthPx(),
            onCommit: (span, next) => deps.onResize(span.column, next),
            onClick: noop,
          }),
        () => deps.cancelResize(),
      );
    },
  };
}

/**
 * The lane's pointerdown routing. Only a primary touch opens the session;
 * mouse and pen keep activating on click. A touch on the handle does nothing
 * there and does not stop propagation, so it bubbles to the head wrapper:
 * on touch the whole event is one target.
 */
export function createPatternTouchHandlers(
  session: Pick<TouchGestureSession<PatternTouchCell>, 'down'>,
): PatternTouchHandlers {
  return {
    onCellPointerDown: (event, cell) => {
      if (event.pointerType !== 'touch' || event.button !== 0) return;
      session.down({ pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }, cell);
    },
    onHandlePointerDown: (event, startDrag) => {
      if (event.pointerType === 'touch') return;
      startDrag();
    },
  };
}

/**
 * The session performs a tap on pointerup, so the click a browser synthesizes
 * after a finger tap must not activate a second time. A touch pointerdown
 * sets the flag and the next non-touch pointerdown clears it. A click with
 * `detail === 0` — keyboard, assistive technology, programmatic — always
 * passes.
 */
export function createPatternClickFilter(): PatternClickFilter {
  let afterTouch = false;
  return {
    pointerDown: (pointerType) => {
      afterTouch = pointerType === 'touch';
    },
    allowClick: (detail) => detail === 0 || !afterTouch,
  };
}
