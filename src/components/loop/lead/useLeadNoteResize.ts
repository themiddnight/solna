import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import { useAppStore } from '@/store/store';
import { LEAD_CELL_WIDTH, leadResizeLen } from './melodyGrid';

export interface LeadResizePreview {
  stepIndex: number;
  note: string;
  len: number;
}

export interface LeadResizeDrag {
  stepIndex: number;
  note: string;
  startLen: number;
  maxLen: number;
  startX: number;
  pointerId: number;
}

/**
 * What a finished gesture commits, or null for "commit nothing".
 *
 * Pure, exported and unit-tested for the same reason leadResizeLen and
 * resolveLeadCellSpan are: logic embedded in a pointer handler cannot be
 * exercised at all here (no DOM, no testing-library), and a source-text
 * assertion about the handler passes just as happily when the guard sits on
 * the wrong branch.
 *
 * Only a real `pointerup` commits. `pointercancel` means the PLATFORM aborted
 * the gesture — a touch-scroll takeover, another gesture interrupting — not
 * that the user released, so committing on it would silently rewrite a note
 * the user never chose to change.
 */
export function leadResizeCommit(
  drag: LeadResizeDrag | null,
  eventType: string,
  clientX: number,
): LeadResizePreview | null {
  if (!drag || eventType !== 'pointerup') return null;
  return {
    stepIndex: drag.stepIndex,
    note: drag.note,
    len: leadResizeLen(drag.startLen, clientX - drag.startX, LEAD_CELL_WIDTH, drag.maxLen),
  };
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
  ) => void;
} {
  const [preview, setPreview] = useState<LeadResizePreview | null>(null);
  const dragRef = useRef<LeadResizeDrag | null>(null);

  const startResize = useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      stepIndex: number,
      note: string,
      startLen: number,
      maxLen: number,
    ) => {
      // Never let the gesture reach the cell's onClick, or the drag would
      // toggle the note off the moment it starts.
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = { stepIndex, note, startLen, maxLen, startX: e.clientX, pointerId: e.pointerId };
      setPreview({ stepIndex, note, len: startLen });

      const lenAt = (clientX: number, drag: LeadResizeDrag): number =>
        leadResizeLen(drag.startLen, clientX - drag.startX, LEAD_CELL_WIDTH, drag.maxLen);

      const onMove = (ev: PointerEvent): void => {
        const drag = dragRef.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        setPreview({ stepIndex: drag.stepIndex, note: drag.note, len: lenAt(ev.clientX, drag) });
      };
      const onEnd = (ev: PointerEvent): void => {
        const drag = dragRef.current;
        if (drag && ev.pointerId !== drag.pointerId) return;
        dragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        setPreview(null);
        // Whether this gesture commits — and what it commits — is
        // leadResizeCommit's decision, so it can be tested for real.
        const commit = leadResizeCommit(drag, ev.type, ev.clientX);
        if (!commit) return;
        useAppStore.getState().setLeadNoteLength(commit.stepIndex, commit.note, commit.len);
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
