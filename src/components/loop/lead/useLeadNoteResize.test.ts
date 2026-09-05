import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEAD_RESIZE_SLOP_PX,
  leadResizeCommit,
  leadResizeMoved,
  leadPreviewUnchanged,
  useLeadNoteResize,
  type LeadResizeDrag,
} from './useLeadNoteResize';
import { LEAD_CELL_WIDTH } from './melodyGrid';

const source = readFileSync(
  join(process.cwd(), 'src/components/loop/lead/useLeadNoteResize.ts'),
  'utf8',
);

/** A drag started on a len-2 note at x=100, with room to grow to 8. Stride 1
 * (1/32) so cells and ticks coincide — the case that was already passing
 * before the cells→ticks conversion existed. */
const drag: LeadResizeDrag = {
  stepIndex: 4,
  note: 'C4',
  startLen: 2,
  maxLen: 8,
  startX: 100,
  pointerId: 1,
  moved: true,
  stride: 1,
};

/** The same gesture, one resolution coarser (1/16, stride 2) — the case that
 * was silently under-writing by half before this fix. */
const dragAtStride2: LeadResizeDrag = { ...drag, stride: 2 };

/** The same gesture, released without ever travelling past the slop. */
const press: LeadResizeDrag = { ...drag, moved: false };

describe('leadResizeMoved', () => {
  test('a press only becomes a drag once it travels past the slop', () => {
    expect(leadResizeMoved(100, 100 + LEAD_RESIZE_SLOP_PX - 1)).toBe(false);
    expect(leadResizeMoved(100, 100 + LEAD_RESIZE_SLOP_PX)).toBe(true);
    expect(leadResizeMoved(100, 100 - LEAD_RESIZE_SLOP_PX)).toBe(true);
  });
});

describe('leadResizeCommit', () => {
  test('a pointerup resizes the note the drag started on, at the dragged length', () => {
    expect(leadResizeCommit(drag, 'pointerup', 100 + 3 * LEAD_CELL_WIDTH)).toEqual({
      kind: 'resize',
      stepIndex: 4,
      note: 'C4',
      len: 5,
    });
  });

  test('a pointercancel does NOTHING — the platform aborted, the user did not release', () => {
    expect(leadResizeCommit(drag, 'pointercancel', 100 + 3 * LEAD_CELL_WIDTH)).toEqual({
      kind: 'none',
    });
  });

  test('an already-torn-down drag does nothing, whatever the event says', () => {
    expect(leadResizeCommit(null, 'pointerup', 999)).toEqual({ kind: 'none' });
  });

  test('a press that never moved ERASES the note, so the handle is not a dead zone', () => {
    // The handle covers the right 8px of a 20px cell. If a click there did
    // nothing, nearly half of every drawn note would refuse to be removed.
    expect(leadResizeCommit(press, 'pointerup', 100)).toEqual({
      kind: 'erase',
      stepIndex: 4,
      note: 'C4',
    });
  });

  test('a press that never moved erases even if the pointer drifted a pixel', () => {
    expect(leadResizeCommit(press, 'pointerup', 100 + 1).kind).toBe('erase');
  });

  test('the resized length goes through leadResizeLen, so both clamps apply', () => {
    const shrunk = leadResizeCommit(drag, 'pointerup', 100 - 40 * LEAD_CELL_WIDTH);
    const grown = leadResizeCommit(drag, 'pointerup', 100 + 40 * LEAD_CELL_WIDTH);
    expect(shrunk).toEqual({ kind: 'resize', stepIndex: 4, note: 'C4', len: 1 });
    expect(grown).toEqual({ kind: 'resize', stepIndex: 4, note: 'C4', len: 8 });
  });

  test('the committed length is TICKS, not cells — a 3-cell drag at stride 2 writes 6', () => {
    // leadResizeLen resolves 3 cells (startLen 2 + 1 cell of travel); the
    // write must be 3 * stride = 6 ticks, not 3. Proves the boundary
    // conversion this task adds, not just the stride-1 identity case.
    expect(leadResizeCommit(dragAtStride2, 'pointerup', 100 + 1 * LEAD_CELL_WIDTH)).toEqual({
      kind: 'resize',
      stepIndex: 4,
      note: 'C4',
      len: 6,
    });
  });

  test('a half-cell drag rounds to the nearest step', () => {
    expect(leadResizeCommit(drag, 'pointerup', 100 + 0.6 * LEAD_CELL_WIDTH)).toEqual({
      kind: 'resize',
      stepIndex: 4,
      note: 'C4',
      len: 3,
    });
    expect(leadResizeCommit(drag, 'pointerup', 100 + 0.4 * LEAD_CELL_WIDTH)).toEqual({
      kind: 'resize',
      stepIndex: 4,
      note: 'C4',
      len: 2,
    });
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
  test('never lets the gesture reach the cell underneath, and listens on window', () => {
    // NOT setPointerCapture: the handle is rendered only on the cell that ends
    // the span, so the first preview growth unmounts the captured element and
    // the drag dies after one cell. (An earlier version of this test asserted
    // the source CONTAINED 'setPointerCapture' — and stayed green off the
    // comment that says it was removed.)
    expect(source).not.toMatch(/^(?!.*\/\/).*setPointerCapture/m);
    expect(source).toContain('stopPropagation');
    expect(source).toContain("window.addEventListener('pointermove'");
  });

  test('writes to the store EXACTLY once — a write per pointermove would re-render every mounted tab', () => {
    expect(source.match(/setLeadNoteLength\(/g) ?? []).toHaveLength(1);
    expect(source.match(/paintLeadNote\(/g) ?? []).toHaveLength(1);
    expect(source).toContain('setPreview');
  });

  test('the commit decision is delegated to the pure predicate, not inlined', () => {
    expect(source).toContain('leadResizeCommit(drag, ev.type, ev.clientX)');
  });

  test('pointercancel is wired to the same teardown as pointerup', () => {
    expect(source).toContain("addEventListener('pointercancel', onEnd)");
  });

  // The live preview cannot be exercised without a DOM (renderToString gives
  // none), so its cells→ticks conversion is pinned at the source: both the
  // initial preview (on startResize) and every subsequent one (on pointer
  // move) must multiply by the drag's stride, the same way the committed
  // length does in leadResizeCommit above — one boundary, applied everywhere
  // a cell count would otherwise leak into a ticks-typed field.
  test('the preview converts cells to ticks too, not only the commit', () => {
    expect(source).toContain('len: startLen * stride');
    expect(source).toContain('len: lenAt(ev.clientX, drag) * drag.stride');
  });

  test('a repeated preview is dropped inside the updater, not after the state bumped', () => {
    // The bail-out has to be the value setPreview RETURNS, not a guard read
    // from a ref: React only skips the re-render when the updater hands back
    // the identical object.
    expect(source).toContain('setPreview((prev) => (leadPreviewUnchanged(prev, next) ? prev : next))');
  });

  test('each gesture owns its own drag — no shared ref to orphan listeners with', () => {
    // A shared dragRef let a second pointer-down overwrite the first
    // gesture's drag, after which the first gesture's onEnd bailed on the
    // pointerId check and never removed its own window listeners. detachRef
    // was the patch for that; closing over the drag removes the cause.
    // Non-comment lines only — the history above is allowed to name them.
    expect(source).not.toMatch(/^(?!.*\/\/).*dragRef/m);
    expect(source).not.toContain('detachRef');
    expect(source).not.toContain('useRef');
    expect(source).toContain('const drag: LeadResizeDrag = {');
  });
});

describe('leadPreviewUnchanged', () => {
  const preview = { stepIndex: 4, note: 'C4', len: 6 };

  test('the very first preview of a gesture always counts as a change', () => {
    expect(leadPreviewUnchanged(null, preview)).toBe(false);
  });

  test('the same length on the same note of the same step is not a change', () => {
    // At a 20px cell most pointermoves resolve to the length already drawn.
    // Each one that got through re-ran leadCellKinds and re-rendered every
    // cell of the grid for no visible difference.
    expect(leadPreviewUnchanged({ ...preview }, preview)).toBe(true);
  });

  test('any of the three fields moving is a change', () => {
    expect(leadPreviewUnchanged({ ...preview, len: 8 }, preview)).toBe(false);
    expect(leadPreviewUnchanged({ ...preview, stepIndex: 5 }, preview)).toBe(false);
    expect(leadPreviewUnchanged({ ...preview, note: 'D4' }, preview)).toBe(false);
  });
});
