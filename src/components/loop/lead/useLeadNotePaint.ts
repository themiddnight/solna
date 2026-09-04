import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/store';
import {
  createLeadPaintController,
  createLeadPaintHandlers,
  type LeadPaintHandlers,
} from './leadPaint';

/**
 * Wires the paint state machine to the DOM. Everything decidable lives in
 * leadPaint.ts; this file only forwards events and owns the two window
 * listeners that close a stroke.
 *
 * Each committed cell is written to the store on its own, rather than
 * batched to pointerup like the resize drag: a stroke visits at most one new
 * cell per pointermove, which is exactly the rate the user could have clicked
 * at, and the alternative — previewing locally and committing at the end —
 * would mean reimplementing the covering-note rules outside the slice that
 * owns them.
 */
export function useLeadNotePaint(resolveStepIndex: (col: number) => number): LeadPaintHandlers {
  const ref = useRef<LeadPaintHandlers | null>(null);
  const controllerRef = useRef<ReturnType<typeof createLeadPaintController> | null>(null);
  // The controller is built once, but the column-to-stored-index mapping moves
  // with the meter — so it reads the CURRENT one on every gap it fills rather
  // than the one that happened to be live when the grid first mounted.
  const resolveRef = useRef(resolveStepIndex);
  resolveRef.current = resolveStepIndex;

  if (!ref.current) {
    const controller = createLeadPaintController(
      ({ stepIndex, note, mode }) => {
        useAppStore.getState().paintLeadNote(stepIndex, note, mode);
      },
      (col) => resolveRef.current(col),
    );
    controllerRef.current = controller;
    ref.current = createLeadPaintHandlers(controller, (stepIndex, note) => {
      useAppStore.getState().toggleLeadNote(stepIndex, note);
    });
  }

  useEffect(() => {
    // Attached for the component's whole life, not per gesture. A release can
    // land anywhere — outside the grid, outside the window — and an end() with
    // no stroke open is already a no-op, so there is nothing to gain by adding
    // and removing these around each drag, and a listener that has to be torn
    // down is a listener that can be lost (see useLeadNoteResize).
    const onEnd = (ev: PointerEvent): void => controllerRef.current?.end(ev.pointerId);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, []);

  return ref.current;
}
