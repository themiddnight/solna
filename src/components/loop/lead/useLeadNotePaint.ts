import { useEffect, useRef } from 'react';
import type React from 'react';
import { useAppStore } from '@/store/store';
import { type MelodyTrackId } from '@/store/melodyTracks';
import { MELODY_ACTIONS } from '@/store/leadSlice';
import type { SpanResizePointer } from '@/components/ui/useSpanResize';
import {
  createLeadPaintController,
  createLeadPaintHandlers,
  type LeadPaintHandlers,
} from './leadPaint';
import { createLeadTouchSession, type LeadTouchDeps } from './leadTouchSession';
import type { LeadGridGeometry } from './leadTouchGesture';

/** What the touch path needs from the cell matrix — read through a ref, so
 * every callback sees the current render's rows, spans and resize. */
interface LeadTouchWiring {
  matrixRef: React.RefObject<HTMLDivElement | null>;
  rows: readonly string[];
  columns: number;
  startNoteResize: (pointer: SpanResizePointer, col: number, note: string) => void;
  cancelNoteResize: () => void;
}

/** The matrix's on-screen box, clipped to what the scroller shows right of
 * the sticky note column (markup: data-lead-scroller, data-lead-labels). */
function measureLeadGrid(matrix: HTMLElement, columns: number, rowCount: number): LeadGridGeometry {
  const box = matrix.getBoundingClientRect();
  const scroller = matrix.closest('[data-lead-scroller]');
  const labels = scroller?.querySelector('[data-lead-labels]');
  return {
    left: box.left,
    top: box.top,
    clipLeft: labels ? labels.getBoundingClientRect().right : box.left,
    clipRight: scroller ? scroller.getBoundingClientRect().right : box.right,
    columns,
    rowCount,
  };
}

function leadTouchDeps(
  wiringRef: React.RefObject<LeadTouchWiring>,
  resolveRef: React.RefObject<(col: number) => number>,
): LeadTouchDeps {
  return {
    now: () => performance.now(),
    schedule: (ms, fn) => {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    },
    measure: () => {
      const { matrixRef, columns, rows } = wiringRef.current;
      return matrixRef.current ? measureLeadGrid(matrixRef.current, columns, rows.length) : null;
    },
    rowNote: (row) => wiringRef.current.rows[row],
    resolveStepIndex: (col) => resolveRef.current(col),
    startNoteResize: (pointer, col, note) => wiringRef.current.startNoteResize(pointer, col, note),
    cancelNoteResize: () => wiringRef.current.cancelNoteResize(),
  };
}

/**
 * Wires the paint state machine and the touch session to the DOM. Every
 * decision lives in leadPaint.ts and leadTouchSession.ts; this file forwards
 * events and owns the listeners, all of them for the component's whole life.
 *
 * Each committed cell is written to the store on its own, rather than
 * batched to pointerup like the resize drag: a stroke visits at most one new
 * cell per pointermove, which is exactly the rate the user could have clicked
 * at, and the alternative — previewing locally and committing at the end —
 * would mean reimplementing the covering-note rules outside the slice that
 * owns them. A resize, touch or mouse, still commits once, on pointerup.
 *
 * The matrix's touchmove listener is NON-PASSIVE and lifetime on purpose: a
 * browser decides whether a touch sequence may be cancelled when it begins,
 * so a listener added at pointerdown is too late to stop the pan under a
 * long-press. It calls preventDefault only while a hold owns the finger, so a
 * swipe still scrolls natively.
 */
export function useLeadNotePaint(
  trackId: MelodyTrackId,
  resolveStepIndex: (col: number) => number,
  wiring: LeadTouchWiring,
): LeadPaintHandlers {
  const actions = MELODY_ACTIONS[trackId];
  const ref = useRef<LeadPaintHandlers | null>(null);
  // The controller is built once, but the column-to-stored-index mapping
  // moves with the meter — so it reads the CURRENT one on every gap it fills.
  const resolveRef = useRef(resolveStepIndex);
  resolveRef.current = resolveStepIndex;
  const wiringRef = useRef(wiring);
  wiringRef.current = wiring;

  if (!ref.current) {
    const controller = createLeadPaintController(
      ({ stepIndex, note, mode }) => {
        useAppStore.getState()[actions.paintNote](stepIndex, note, mode);
      },
      (col) => resolveRef.current(col),
    );
    const touch = createLeadTouchSession(controller, leadTouchDeps(wiringRef, resolveRef));
    ref.current = createLeadPaintHandlers(
      controller,
      (stepIndex, note) => {
        useAppStore.getState()[actions.toggleNote](stepIndex, note);
      },
      touch,
    );
  }

  useEffect(() => {
    const handlers = ref.current;
    const matrix = wiringRef.current.matrixRef.current;
    const onMove = (ev: PointerEvent): void => handlers?.onWindowPointerMove(ev);
    const onUp = (ev: PointerEvent): void => handlers?.onWindowPointerEnd(ev, 'pointerup');
    const onCancel = (ev: PointerEvent): void => handlers?.onWindowPointerEnd(ev, 'pointercancel');
    const onTouchMove = (ev: TouchEvent): void => {
      if (ev.cancelable && handlers?.touchHolding()) ev.preventDefault();
    };
    const onContextMenu = (ev: MouseEvent): void => {
      if (handlers?.touchOpen()) ev.preventDefault();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    matrix?.addEventListener('touchmove', onTouchMove, { passive: false });
    matrix?.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      matrix?.removeEventListener('touchmove', onTouchMove);
      matrix?.removeEventListener('contextmenu', onContextMenu);
      // Unmount mid-gesture (a layout switch): cancel the timer, write nothing.
      handlers?.dispose();
    };
  }, []);

  return ref.current;
}
