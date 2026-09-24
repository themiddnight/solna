import { describe, expect, test } from 'bun:test';
import { leadCellAtPoint, type LeadGridGeometry } from './leadTouchGesture';
import { LEAD_CELL_SIZE } from './melodyGrid';

describe('leadCellAtPoint', () => {
  const S = LEAD_CELL_SIZE;
  const grid: LeadGridGeometry = {
    left: 100,
    top: 50,
    clipLeft: 100,
    clipRight: 100 + 16 * S,
    columns: 16,
    rowCount: 3,
  };

  test('maps a point to the cell under it, both axes by the one size', () => {
    expect(leadCellAtPoint(grid, 100, 50)).toEqual({ col: 0, row: 0 });
    expect(leadCellAtPoint(grid, 100 + S - 0.01, 50 + S - 0.01)).toEqual({ col: 0, row: 0 });
    expect(leadCellAtPoint(grid, 100 + S, 50 + S)).toEqual({ col: 1, row: 1 });
    expect(leadCellAtPoint(grid, 100 + 15 * S + 1, 50 + 2 * S + 1)).toEqual({ col: 15, row: 2 });
  });

  test('outside the matrix is no cell', () => {
    expect(leadCellAtPoint(grid, 100, 49)).toBeNull();
    expect(leadCellAtPoint(grid, 100, 50 + 3 * S)).toBeNull();
    expect(leadCellAtPoint(grid, 99, 60)).toBeNull();
  });

  test('left of the sticky note column, or right of the scroller, is no cell', () => {
    // Scrolled: the matrix starts off-screen left, and its first columns
    // sit under the sticky note-name column that ends at clipLeft.
    const scrolled: LeadGridGeometry = { ...grid, left: 100 - 4 * S, clipLeft: 144, clipRight: 400 };
    expect(leadCellAtPoint(scrolled, 143, 60)).toBeNull();
    expect(leadCellAtPoint(scrolled, 144, 60)).toEqual({ col: Math.floor((144 - (100 - 4 * S)) / S), row: 0 });
    expect(leadCellAtPoint(scrolled, 400, 60)).toBeNull();
  });
});
