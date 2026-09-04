import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leadResizeCommit, useLeadNoteResize, type LeadResizeDrag } from './useLeadNoteResize';
import { LEAD_CELL_WIDTH } from './melodyGrid';

const source = readFileSync(
  join(process.cwd(), 'src/components/loop/lead/useLeadNoteResize.ts'),
  'utf8',
);

/** A drag started on a len-2 note at x=100, with room to grow to 8. */
const drag: LeadResizeDrag = {
  stepIndex: 4,
  note: 'C4',
  startLen: 2,
  maxLen: 8,
  startX: 100,
  pointerId: 1,
};

describe('leadResizeCommit', () => {
  test('a pointerup commits the note the drag started on, at the dragged length', () => {
    expect(leadResizeCommit(drag, 'pointerup', 100 + 3 * LEAD_CELL_WIDTH)).toEqual({
      stepIndex: 4,
      note: 'C4',
      len: 5,
    });
  });

  test('a pointercancel commits NOTHING — the platform aborted, the user did not release', () => {
    expect(leadResizeCommit(drag, 'pointercancel', 100 + 3 * LEAD_CELL_WIDTH)).toBeNull();
  });

  test('an already-torn-down drag commits nothing, whatever the event says', () => {
    expect(leadResizeCommit(null, 'pointerup', 999)).toBeNull();
  });

  test('a drag that never moved commits the length it started at, not a no-op', () => {
    // Releasing without moving still writes: the note keeps its length, and
    // the store write is idempotent. What must NOT happen is len drifting.
    expect(leadResizeCommit(drag, 'pointerup', 100)?.len).toBe(2);
  });

  test('the committed length goes through leadResizeLen, so both clamps apply', () => {
    expect(leadResizeCommit(drag, 'pointerup', 100 - 40 * LEAD_CELL_WIDTH)?.len).toBe(1);
    expect(leadResizeCommit(drag, 'pointerup', 100 + 40 * LEAD_CELL_WIDTH)?.len).toBe(8);
  });

  test('a half-cell drag rounds to the nearest step', () => {
    expect(leadResizeCommit(drag, 'pointerup', 100 + 0.6 * LEAD_CELL_WIDTH)?.len).toBe(3);
    expect(leadResizeCommit(drag, 'pointerup', 100 + 0.4 * LEAD_CELL_WIDTH)?.len).toBe(2);
  });
});

describe('useLeadNoteResize', () => {
  test('is a hook the grid can call', () => {
    expect(typeof useLeadNoteResize).toBe('function');
  });

  // The gesture itself has no coverage here by construction — renderToString
  // gives no DOM to dispatch a PointerEvent against — so what is left are
  // contracts about the plumbing that carries it. Everything decidable was
  // moved into leadResizeCommit above and is tested for real.
  test('captures the pointer and never lets the gesture reach the cell click', () => {
    expect(source).toContain('setPointerCapture');
    expect(source).toContain('stopPropagation');
  });

  test('commits to the store EXACTLY once — a write per pointermove would re-render every mounted tab', () => {
    expect(source.match(/setLeadNoteLength\(/g) ?? []).toHaveLength(1);
    expect(source).toContain('setPreview');
  });

  test('the commit decision is delegated to the pure predicate, not inlined', () => {
    expect(source).toContain('leadResizeCommit(drag, ev.type, ev.clientX)');
  });

  test('pointercancel is wired to the same teardown as pointerup', () => {
    expect(source).toContain("addEventListener('pointercancel', onEnd)");
  });
});
