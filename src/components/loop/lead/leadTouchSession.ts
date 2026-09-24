import {
  createTouchGestureSession,
  resizeHold,
  type TouchGestureDeps,
  type TouchGestureSession,
  type TouchHold,
} from '@/components/touchGestureSession';
import type { SpanResizePointer } from '@/components/ui/useSpanResize';
import type { LeadPaintController } from './leadPaint';
import { leadCellAtPoint, type LeadGridGeometry } from './leadTouchGesture';

/** The cell a finger went down on, as the cell handler already knows it. */
interface LeadTouchCell {
  stepIndex: number;
  col: number;
  note: string;
  covered: boolean;
}

/** Everything the session cannot decide by itself; the hook supplies the DOM halves. */
export interface LeadTouchDeps extends TouchGestureDeps {
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

export type LeadTouchSession = TouchGestureSession<LeadTouchCell>;

/**
 * A long-press on an empty cell: draw mode, and the pressed cell fills now,
 * so the user sees the hold took. The matrix box is read once, here: scrolling
 * is blocked for the rest of the gesture, so it cannot go stale. Ending or
 * cancelling both close the stroke; cells already committed stay, as in a
 * mouse stroke.
 */
function leadPaintHold(
  controller: LeadPaintController,
  deps: LeadTouchDeps,
  cell: LeadTouchCell,
  pointerId: number,
): TouchHold {
  const geometry = deps.measure();
  controller.begin(pointerId, cell.stepIndex, cell.col, cell.note, false);
  const endStroke = (): void => controller.end(pointerId);
  return {
    move: (p) => {
      if (!geometry) return;
      const hit = leadCellAtPoint(geometry, p.clientX, p.clientY);
      const note = hit ? deps.rowNote(hit.row) : undefined;
      if (!hit || note === undefined) return;
      controller.visit(pointerId, deps.resolveStepIndex(hit.col), hit.col, note);
    },
    end: endStroke,
    cancel: endStroke,
  };
}

/**
 * The melody grid's touch adapter (R343): what a tap and a hold mean here.
 * The finger's lifecycle — tap on pointerup, swipe and cancel write nothing,
 * a second finger aborts — is the shared session's. A tap is a one-cell
 * stroke: it draws on an empty cell and erases on a note. A hold paints from
 * an empty cell, or resizes the note under it with `clickErases: false`, so
 * an unmoved lift keeps the note.
 */
export function createLeadTouchSession(
  controller: LeadPaintController,
  deps: LeadTouchDeps,
): LeadTouchSession {
  return createTouchGestureSession<LeadTouchCell>(
    {
      tap: ({ stepIndex, col, note, covered }, pointerId) => {
        controller.begin(pointerId, stepIndex, col, note, covered);
        controller.end(pointerId);
      },
      hold: (cell, pointer) =>
        cell.covered
          ? resizeHold(
              pointer,
              (p) => deps.startNoteResize(p, cell.col, cell.note),
              () => deps.cancelNoteResize(),
            )
          : leadPaintHold(controller, deps, cell, pointer.pointerId),
    },
    deps,
  );
}
