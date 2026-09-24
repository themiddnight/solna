/**
 * Lead-only touch geometry: which melody-grid cell sits under a client point.
 * It is arithmetic over square LEAD_CELL_SIZE cells, which only this grid
 * has. The tap/swipe/long-press classifier every grid shares is
 * `@/components/touchGesture` (R343).
 */

import { LEAD_CELL_SIZE } from './melodyGrid';

/**
 * Where the matrix is on screen, read once when a long-press starts painting.
 * Scrolling is blocked for the rest of that gesture, so it cannot go stale.
 * clipLeft is the right edge of the sticky note-name column and clipRight
 * the scroller's right edge: cells outside that band are hidden.
 */
export interface LeadGridGeometry {
  left: number;
  top: number;
  clipLeft: number;
  clipRight: number;
  columns: number;
  rowCount: number;
}

/**
 * The cell under a client point, or null. Arithmetic rather than
 * elementFromPoint: a touch pointer is captured to its pointerdown target,
 * so no pointerenter reaches other cells, and this form needs no DOM to
 * test and no per-cell attributes. It relies on square LEAD_CELL_SIZE
 * cells, which the grid guarantees.
 */
export function leadCellAtPoint(
  g: LeadGridGeometry,
  x: number,
  y: number,
): { col: number; row: number } | null {
  if (x < g.clipLeft || x >= g.clipRight) return null;
  const col = Math.floor((x - g.left) / LEAD_CELL_SIZE);
  const row = Math.floor((y - g.top) / LEAD_CELL_SIZE);
  if (col < 0 || col >= g.columns || row < 0 || row >= g.rowCount) return null;
  return { col, row };
}
