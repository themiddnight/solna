import { useCallback, useMemo, useState } from 'react';
import type React from 'react';
import { useAppStore } from '@/store/store';
import { type MelodyTrackId } from '@/store/melodyTracks';
import { MELODY_ACTIONS } from '@/store/leadSlice';
import { useSpanResize } from '@/components/ui/useSpanResize';
import { LEAD_CELL_WIDTH } from './melodyGrid';

export interface LeadResizePreview {
  stepIndex: number;
  note: string;
  /** TICKS — the same unit as LeadNote.len, so the caller can drop it
   * straight into `previewed` with no second conversion. */
  len: number;
}

/**
 * What a Lead gesture resizes: one note of one step. The shared hook never
 * looks inside it, which is exactly what lets Chord/Bass hand it a step
 * instead of a note.
 */
export interface LeadResizeIdentity {
  stepIndex: number;
  note: string;
}

/**
 * One gesture's Lead-specific state: the note it grabbed, and the
 * ticks-per-cell stride active when it started.
 *
 * The stride is what this adapter owns. The shared hook counts CELLS,
 * because cells are what the pointer moves over; a length IS ticks (since
 * Task 4), so the conversion lives at this boundary, and it is needed for
 * the PREVIEW as well as the commit — which is why the identity has to be
 * kept here at all: `previewFor` answers about one identity, and only the
 * feature knows which one a live gesture is on.
 */
interface LeadResizeGesture {
  identity: LeadResizeIdentity;
  stride: number;
}

/**
 * Cells → ticks, the one place a cell count may become a length. A function
 * rather than an inline multiply because the arithmetic of the gesture
 * cannot be exercised here (no DOM): this is the last of it, and it is
 * testable.
 */
export function leadTicksFromCells(cells: number, stride: number): number {
  return cells * stride;
}

/**
 * The Lead adapter over the shared span-resize hook: it supplies the note
 * identity, the cell width, and the ticks-per-cell stride, and reads the
 * live preview back in ticks. All pointer timing — the window listeners, the
 * slop, the preview state and the click-versus-drag ruling — is
 * useSpanResize's, which is the same code Chord/Bass and the patterns will
 * drag with.
 *
 * The preview length lives in LOCAL state and is committed to the store
 * exactly ONCE, on pointerup: all four tab views stay mounted, so a write
 * per pointermove would re-render every view and re-serialise the persisted
 * slice on every frame of the gesture.
 */
export function useLeadNoteResize(trackId: MelodyTrackId): {
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
  const actions = MELODY_ACTIONS[trackId];
  const { previewFor, startResize: startSpanResize } = useSpanResize<LeadResizeIdentity>();
  const [gesture, setGesture] = useState<LeadResizeGesture | null>(null);

  const startResize = useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      stepIndex: number,
      note: string,
      startLen: number,
      maxLen: number,
      stride: number,
    ) => {
      const identity: LeadResizeIdentity = { stepIndex, note };
      setGesture({ identity, stride });
      startSpanResize(e, {
        identity,
        startLength: startLen,
        maxLength: maxLen,
        pixelsPerStep: LEAD_CELL_WIDTH,
        // Whether the gesture commits — and what it commits — was already
        // ruled on by the shared hook's pure outcome predicate; a callback
        // here only carries the answer out.
        onCommit: (target, cells) => {
          useAppStore.getState()[actions.setNoteLength](
            target.stepIndex,
            target.note,
            leadTicksFromCells(cells, stride),
          );
        },
        onClick: (target) => {
          useAppStore.getState()[actions.paintNote](target.stepIndex, target.note, 'erase');
        },
      });
    },
    [actions, startSpanResize],
  );

  const preview = useMemo<LeadResizePreview | null>(() => {
    if (!gesture) return null;
    const cells = previewFor(gesture.identity);
    if (cells === null) return null;
    return {
      stepIndex: gesture.identity.stepIndex,
      note: gesture.identity.note,
      len: leadTicksFromCells(cells, gesture.stride),
    };
  }, [gesture, previewFor]);

  return { preview, startResize };
}
