import { useCallback, useState } from 'react';
import type React from 'react';
import { useAppStore } from '@/store/store';
import { LEAD_CELL_WIDTH, leadResizeLen } from './melodyGrid';

export interface LeadResizePreview {
  stepIndex: number;
  note: string;
  /** TICKS — the same unit as LeadNote.len, so the caller can drop it
   * straight into `previewed` with no second conversion. */
  len: number;
}

export interface LeadResizeDrag {
  stepIndex: number;
  note: string;
  startLen: number;
  maxLen: number;
  startX: number;
  pointerId: number;
  /** Set once the pointer has travelled past the slop. See leadResizeMoved. */
  moved: boolean;
  /**
   * Ticks per CELL, at the resolution active when the drag started. Cells
   * are what the pointer moves over (leadResizeLen's unit, pinned by the
   * plan); ticks are what a length IS (LeadNote.len's unit, since Task 4).
   * The conversion happens once, here, at the boundary — both the committed
   * length (leadResizeCommit) and the live preview (below) multiply by it,
   * so nothing downstream ever sees a cell count again.
   */
  stride: number;
}

/**
 * How far the pointer must travel before the gesture counts as a drag.
 *
 * The grab strip covers the right 8px of a 20px cell, so nearly half of every
 * drawn note is handle rather than note. Without a slop the strip would
 * swallow the click that should have erased the note, and the user would find
 * a large dead zone on every note they tried to remove.
 */
export const LEAD_RESIZE_SLOP_PX = 4;

export function leadResizeMoved(startX: number, clientX: number): boolean {
  return Math.abs(clientX - startX) >= LEAD_RESIZE_SLOP_PX;
}

/**
 * What a finished gesture does. A press on the handle that never became a
 * drag is a CLICK on the note, and a click on a note erases it — exactly as
 * it does anywhere else on the note, so the handle is not a hole in that rule.
 */
export type LeadResizeOutcome =
  | { kind: 'none' }
  | { kind: 'resize'; stepIndex: number; note: string; len: number }
  | { kind: 'erase'; stepIndex: number; note: string };

/**
 * Only a real `pointerup` does anything. `pointercancel` means the PLATFORM
 * aborted the gesture — a touch-scroll takeover, another gesture interrupting
 * — not that the user released, so acting on it would silently rewrite a note
 * the user never chose to change.
 *
 * Pure, exported and unit-tested for the same reason leadResizeLen and
 * resolveLeadCellSpan are: logic embedded in a pointer handler cannot be
 * exercised at all here (no DOM, no testing-library), and a source-text
 * assertion about the handler passes just as happily when the guard sits on
 * the wrong branch.
 */
export function leadResizeCommit(
  drag: LeadResizeDrag | null,
  eventType: string,
  clientX: number,
): LeadResizeOutcome {
  if (!drag || eventType !== 'pointerup') return { kind: 'none' };
  if (!drag.moved) return { kind: 'erase', stepIndex: drag.stepIndex, note: drag.note };
  return {
    kind: 'resize',
    stepIndex: drag.stepIndex,
    note: drag.note,
    len:
      leadResizeLen(drag.startLen, clientX - drag.startX, LEAD_CELL_WIDTH, drag.maxLen) *
      drag.stride,
  };
}

/**
 * Whether a freshly computed preview is the one already on screen.
 *
 * A pointermove fires per frame, but a preview only CHANGES once the pointer
 * has crossed a whole cell — at 20px, five to twelve moves out of every
 * twelve resolve to the same length. Returning the previous object for those
 * keeps the state from bumping, which is what keeps `previewed` memoized,
 * leadCellKinds unrecomputed and every cell of the grid un-rendered.
 *
 * Pure and exported for the same reason leadResizeCommit is: the gesture it
 * guards cannot be exercised here at all (no DOM), so the comparison has to
 * be testable on its own or it has no coverage.
 */
export function leadPreviewUnchanged(
  prev: LeadResizePreview | null,
  next: LeadResizePreview,
): boolean {
  return (
    prev !== null &&
    prev.len === next.len &&
    prev.stepIndex === next.stepIndex &&
    prev.note === next.note
  );
}

/**
 * Pointer plumbing for the note-resize drag; the arithmetic stays in
 * leadResizeLen. The preview length lives in LOCAL component state and is
 * committed to the store exactly ONCE, on pointerup. That is required by
 * CLAUDE.md, not a preference: all four tab views stay mounted, so a store
 * write per pointermove would re-render every view and re-serialise the
 * persisted slice on every frame of the gesture.
 */
export function useLeadNoteResize(): {
  preview: LeadResizePreview | null;
  startResize: (
    e: React.PointerEvent<HTMLElement>,
    stepIndex: number,
    note: string,
    startLen: number,
    maxLen: number,
    stride: number,
  ) => void;
} {
  const [preview, setPreview] = useState<LeadResizePreview | null>(null);

  const startResize = useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      stepIndex: number,
      note: string,
      startLen: number,
      maxLen: number,
      stride: number,
    ) => {
      // Never let the gesture reach the cell's onClick, or the drag would
      // toggle the note off the moment it starts.
      e.stopPropagation();
      e.preventDefault();
      // Each gesture owns its OWN drag object — no shared ref. A second
      // pointer-down before the first gesture ended used to overwrite a
      // shared dragRef, after which the first gesture's onEnd bailed on the
      // pointerId check and never removed its own listeners: one dead
      // pointermove handler on window per orphaned gesture, for the rest of
      // the session. Closing over the drag means every handler tests the
      // pointerId it was created for and tears down the listeners it added,
      // which is the same principle useLeadNotePaint states in its comment.
      const drag: LeadResizeDrag = {
        stepIndex,
        note,
        startLen,
        maxLen,
        startX: e.clientX,
        pointerId: e.pointerId,
        moved: false,
        stride,
      };
      setPreview({ stepIndex, note, len: startLen * stride });

      const lenAt = (clientX: number, drag: LeadResizeDrag): number =>
        leadResizeLen(drag.startLen, clientX - drag.startX, LEAD_CELL_WIDTH, drag.maxLen);

      const onMove = (ev: PointerEvent): void => {
        if (ev.pointerId !== drag.pointerId) return;
        // Sticky: a gesture that has travelled stays a drag even if it comes
        // back to where it started, so a wobble out and back is not an erase.
        if (!drag.moved && leadResizeMoved(drag.startX, ev.clientX)) drag.moved = true;
        const next = {
          stepIndex: drag.stepIndex,
          note: drag.note,
          len: lenAt(ev.clientX, drag) * drag.stride,
        };
        // Bail out INSIDE the updater: a new object every move would bump the
        // state on every frame, and the grid would re-render for moves that
        // resolve to the very same cell-quantised length.
        setPreview((prev) => (leadPreviewUnchanged(prev, next) ? prev : next));
      };
      const detach = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        setPreview(null);
      };
      const onEnd = (ev: PointerEvent): void => {
        if (ev.pointerId !== drag.pointerId) return;
        detach();
        // Whether this gesture commits — and what it commits — is
        // leadResizeCommit's decision, so it can be tested for real.
        const outcome = leadResizeCommit(drag, ev.type, ev.clientX);
        if (outcome.kind === 'resize') {
          useAppStore.getState().setLeadNoteLength(outcome.stepIndex, outcome.note, outcome.len);
        } else if (outcome.kind === 'erase') {
          useAppStore.getState().paintLeadNote(outcome.stepIndex, outcome.note, 'erase');
        }
      };
      // WINDOW, not the grab strip, and no setPointerCapture. The strip is
      // rendered only on the cell that ENDS the span ({endsSpan && ...} in
      // LeadMelodyGrid), so the first preview growth relocates it: React
      // unmounts the very element the gesture started on, taking its pointer
      // capture and its listeners with it. The drag then died after one cell,
      // pointerup never reached onEnd, and nothing was ever committed — the
      // note only LOOKED longer, from a preview that was never cleared, while
      // the store still held len 1 and the audio never changed. Listening on
      // window is immune to the handle unmounting; pointerId keeps a second
      // touch from steering someone else's drag.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [],
  );

  return { preview, startResize };
}
