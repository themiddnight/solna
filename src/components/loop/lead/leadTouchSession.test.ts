import { describe, expect, test } from 'bun:test';
import { createSpanResizeSlot, type SpanResizePointer } from '@/components/ui/useSpanResize';
import {
  createLeadPaintController,
  createLeadPaintHandlers,
  type LeadPaintCommit,
} from './leadPaint';
import { createLeadTouchSession, type LeadTouchDeps } from './leadTouchSession';
import { LEAD_LONG_PRESS_MS } from './leadTouchGesture';
import { LEAD_CELL_SIZE } from './melodyGrid';
import { leadResizeCallbacks } from './useLeadNoteResize';

const ROWS = ['E4', 'D4', 'C4'];
const S = LEAD_CELL_SIZE;

/** The matrix sits at the client origin; this is a cell's centre. */
const centre = (col: number, row: number) => ({ x: col * S + S / 2, y: row * S + S / 2 });

function rig(clipLeft = 0) {
  const commits: LeadPaintCommit[] = [];
  const controller = createLeadPaintController((c) => commits.push(c), (col) => col);
  let clock = 0;
  let timer: (() => void) | null = null;
  const log = {
    resizes: [] as Array<{ pointer: SpanResizePointer; col: number; note: string }>,
    cancels: 0,
  };
  const deps: LeadTouchDeps = {
    now: () => clock,
    schedule: (_ms, fn) => {
      timer = fn;
      return () => {
        if (timer === fn) timer = null;
      };
    },
    measure: () => ({ left: 0, top: 0, clipLeft, clipRight: 16 * S, columns: 16, rowCount: ROWS.length }),
    rowNote: (row) => ROWS[row],
    resolveStepIndex: (col) => col,
    startNoteResize: (pointer, col, note) => {
      log.resizes.push({ pointer, col, note });
    },
    cancelNoteResize: () => {
      log.cancels += 1;
    },
  };
  const session = createLeadTouchSession(controller, deps);
  const at = (col: number, row: number, pointerId = 7, dx = 0) => ({
    pointerId,
    clientX: centre(col, row).x + dx,
    clientY: centre(col, row).y,
  });
  return {
    session,
    commits,
    log,
    at,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Let the long-press timer fire, LEAD_LONG_PRESS_MS after now. */
    hold: () => {
      clock += LEAD_LONG_PRESS_MS;
      timer?.();
    },
    down: (col: number, row: number, covered: boolean, pointerId = 7) =>
      session.down(at(col, row, pointerId), { stepIndex: col, col, note: ROWS[row], covered }),
  };
}

describe('touch tap', () => {
  test('a tap on an empty cell adds one note, on pointerup and not before', () => {
    const r = rig();
    r.down(2, 2, false);
    expect(r.commits).toEqual([]);
    r.advance(120);
    expect(r.session.end(r.at(2, 2, 7, 2), 'pointerup')).toBe(true);
    expect(r.commits).toEqual([{ stepIndex: 2, note: 'C4', mode: 'draw' }]);
    expect(r.session.isOpen()).toBe(false);
  });

  test('a tap on a note removes it', () => {
    const r = rig();
    r.down(2, 2, true);
    r.advance(120);
    r.session.end(r.at(2, 2), 'pointerup');
    expect(r.commits).toEqual([{ stepIndex: 2, note: 'C4', mode: 'erase' }]);
  });

  test('end answers false for a pointer it does not own, so the mouse stroke can close', () => {
    const r = rig();
    expect(r.session.end(r.at(2, 2, 99), 'pointerup')).toBe(false);
  });
});

describe('touch swipe and cancel', () => {
  test('a swipe past the slop writes nothing, and the timer after it does nothing', () => {
    const r = rig();
    r.down(2, 2, false);
    r.advance(50);
    r.session.move(r.at(2, 2, 7, 10));
    expect(r.session.isOpen()).toBe(false);
    r.hold();
    r.session.end(r.at(2, 2, 7, 10), 'pointerup');
    expect(r.commits).toEqual([]);
  });

  test('pointercancel (the browser took the pan) writes nothing', () => {
    const r = rig();
    r.down(2, 2, true);
    r.session.end(r.at(2, 2), 'pointercancel');
    r.hold();
    expect(r.commits).toEqual([]);
    expect(r.log.resizes).toEqual([]);
  });

  test('scroll is blocked only once the hold has taken the gesture', () => {
    const r = rig();
    r.down(2, 2, false);
    expect(r.session.isOpen()).toBe(true);
    expect(r.session.holding()).toBe(false);
    r.hold();
    expect(r.session.holding()).toBe(true);
    r.session.end(r.at(2, 2), 'pointerup');
    expect(r.session.holding()).toBe(false);
  });
});

describe('touch long-press', () => {
  test('on an empty cell: the pressed cell fills at the hold, then the stroke follows the finger', () => {
    const r = rig();
    r.down(2, 2, false);
    r.hold();
    expect(r.commits).toEqual([{ stepIndex: 2, note: 'C4', mode: 'draw' }]);
    r.session.move(r.at(3, 2));
    r.session.move(r.at(5, 2)); // skipped column 4 is filled along the row
    r.session.end(r.at(5, 2), 'pointerup');
    r.session.move(r.at(6, 2)); // after the lift: nothing
    expect(r.commits.map((c) => c.stepIndex)).toEqual([2, 3, 4, 5]);
    expect(r.commits.every((c) => c.mode === 'draw' && c.note === 'C4')).toBe(true);
  });

  test("on a note: it starts a resize from the finger's position and paints nothing", () => {
    const r = rig();
    r.down(2, 2, true);
    r.advance(100);
    r.session.move(r.at(2, 2, 7, 3)); // inside the slop
    r.hold();
    expect(r.log.resizes).toEqual([
      { pointer: { pointerId: 7, clientX: centre(2, 2).x + 3 }, col: 2, note: 'C4' },
    ]);
    r.session.end(r.at(2, 2, 7, 60), 'pointerup');
    expect(r.commits).toEqual([]);
  });

  test('a stroke dragged under the sticky note column paints nothing there', () => {
    const r = rig(2 * S); // columns 0 and 1 are hidden under the note column
    r.down(2, 2, false);
    r.hold();
    r.session.move(r.at(1, 2));
    r.session.move(r.at(0, 2));
    expect(r.commits.map((c) => c.stepIndex)).toEqual([2]);
  });

  test('a lift at the hold threshold before the timer runs still counts as a hold', () => {
    const empty = rig();
    empty.down(2, 2, false);
    empty.advance(LEAD_LONG_PRESS_MS);
    empty.session.end(empty.at(2, 2), 'pointerup');
    expect(empty.commits).toEqual([{ stepIndex: 2, note: 'C4', mode: 'draw' }]);

    const note = rig();
    note.down(2, 2, true);
    note.advance(LEAD_LONG_PRESS_MS);
    note.session.end(note.at(2, 2), 'pointerup');
    expect(note.commits).toEqual([]);
    expect(note.log.resizes).toEqual([]);
  });
});

describe('touch interruptions', () => {
  test('a second finger cancels a pending touch, and is itself ignored', () => {
    const r = rig();
    r.down(2, 2, false, 7);
    r.down(5, 2, false, 8);
    expect(r.session.end(r.at(2, 2, 7), 'pointerup')).toBe(false);
    expect(r.session.end(r.at(5, 2, 8), 'pointerup')).toBe(false);
    expect(r.commits).toEqual([]);
  });

  test('a second finger during a stroke ends it; the cells already painted stay', () => {
    const r = rig();
    r.down(2, 2, false);
    r.hold();
    r.session.move(r.at(3, 2));
    r.down(8, 0, false, 8);
    r.session.move(r.at(4, 2));
    expect(r.commits.map((c) => c.stepIndex)).toEqual([2, 3]);
  });

  test('a second finger or a pointercancel during a resize aborts it', () => {
    const r = rig();
    r.down(2, 2, true);
    r.hold();
    r.down(8, 0, false, 8);
    expect(r.log.cancels).toBe(1);

    const c = rig();
    c.down(2, 2, true);
    c.hold();
    c.session.end(c.at(2, 2), 'pointercancel');
    expect(c.log.cancels).toBe(1);
  });

  test('dispose (unmount) mid-hold cancels the timer and writes nothing', () => {
    const r = rig();
    r.down(2, 2, false);
    r.session.dispose();
    r.hold();
    expect(r.commits).toEqual([]);
    expect(r.session.isOpen()).toBe(false);

    const p = rig();
    p.down(2, 2, false);
    p.hold();
    p.session.dispose();
    p.session.move(p.at(3, 2));
    expect(p.commits.map((c) => c.stepIndex)).toEqual([2]);
    expect(p.session.holding()).toBe(false);
  });
});

/**
 * A 1-step C4 note at column 2, touched on its resize handle, with the real
 * handlers, session, span-resize slot and Lead resize writes wired the way
 * LeadMelodyCells wires them (a long-press resize passes clickErases false).
 */
function handleRig() {
  const commits: LeadPaintCommit[] = [];
  const writes: string[] = [];
  const spanStarts: number[] = [];
  const controller = createLeadPaintController((c) => commits.push(c), (col) => col);
  const target = new EventTarget();
  const slot = createSpanResizeSlot<{ stepIndex: number; note: string }>(() => target);
  let clock = 0;
  let timer: (() => void) | null = null;
  const session = createLeadTouchSession(controller, {
    now: () => clock,
    schedule: (_ms, fn) => {
      timer = fn;
      return () => {
        if (timer === fn) timer = null;
      };
    },
    measure: () => ({ left: 0, top: 0, clipLeft: 0, clipRight: 16 * S, columns: 16, rowCount: ROWS.length }),
    rowNote: (row) => ROWS[row],
    resolveStepIndex: (col) => col,
    startNoteResize: (pointer, col, note) => {
      spanStarts.push(pointer.pointerId);
      slot.start(
        pointer,
        {
          identity: { stepIndex: col, note },
          startLength: 1,
          maxLength: 16 - col,
          pixelsPerStep: S,
          ...leadResizeCallbacks(
            {
              setNoteLength: (i, n, len) => writes.push(`len ${i} ${n} ${len}`),
              erase: (i, n) => writes.push(`erase ${i} ${n}`),
            },
            1,
            false,
          ),
        },
        () => {},
      );
    },
    cancelNoteResize: () => slot.cancel(),
  });
  const handlers = createLeadPaintHandlers(controller, () => {}, session);
  // The handle's centre-right: inside its 16px grab area, which on a 28px
  // cell covers the cell's centre.
  const x = 2 * S + S - 6;
  const y = centre(2, 2).y;
  const pointer = (dx = 0) => ({ pointerId: 7, button: 0, pointerType: 'touch', clientX: x + dx, clientY: y });
  const windowEvent = (type: string, dx: number): Event =>
    Object.assign(new Event(type), { pointerId: 7, clientX: x + dx, clientY: y });
  return {
    session,
    commits,
    writes,
    spanStarts,
    advance: (ms: number) => {
      clock += ms;
    },
    hold: () => {
      clock += LEAD_LONG_PRESS_MS;
      timer?.();
    },
    /** One pointerdown as the DOM delivers it: the handle, then — unless
     * the handle started its own drag and stopped propagation — the cell. */
    down: () => {
      let handleDragged = false;
      handlers.onHandlePointerDown(pointer(), () => {
        handleDragged = true;
      });
      if (!handleDragged) handlers.onCellPointerDown(pointer(), 2, 2, 'C4', true);
      return handleDragged;
    },
    /** A window event reaches the grid's lifetime listener, then the resize's. */
    move: (dx: number) => {
      handlers.onWindowPointerMove(pointer(dx));
      target.dispatchEvent(windowEvent('pointermove', dx));
    },
    up: (dx = 0) => {
      handlers.onWindowPointerEnd(pointer(dx), 'pointerup');
      target.dispatchEvent(windowEvent('pointerup', dx));
    },
  };
}

describe("touch on a note's resize handle", () => {
  test('opens the touch session, not a span resize', () => {
    const r = handleRig();
    expect(r.down()).toBe(false);
    expect(r.session.isOpen()).toBe(true);
    expect(r.spanStarts).toEqual([]);
    expect(r.commits).toEqual([]);
  });

  test('a long-press and an unmoved lift keeps a 1-step note', () => {
    const r = handleRig();
    r.down();
    r.hold();
    expect(r.spanStarts).toEqual([7]);
    r.up();
    expect(r.writes).toEqual([]);
    expect(r.commits).toEqual([]);
  });

  test('a long-press then a drag resizes the note once, on the lift', () => {
    const r = handleRig();
    r.down();
    r.hold();
    r.move(2 * S);
    expect(r.writes).toEqual([]);
    r.up(2 * S);
    expect(r.writes).toEqual(['len 2 C4 3']);
    expect(r.commits).toEqual([]);
  });

  test('a tap removes the note', () => {
    const r = handleRig();
    r.down();
    r.advance(120);
    r.up();
    expect(r.commits).toEqual([{ stepIndex: 2, note: 'C4', mode: 'erase' }]);
    expect(r.writes).toEqual([]);
  });

  test('a swipe writes nothing: the browser scrolls it', () => {
    const r = handleRig();
    r.down();
    r.advance(50);
    r.move(12);
    r.hold();
    r.up(12);
    expect(r.commits).toEqual([]);
    expect(r.writes).toEqual([]);
    expect(r.spanStarts).toEqual([]);
  });
});
