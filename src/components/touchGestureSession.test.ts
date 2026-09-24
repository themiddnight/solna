import { describe, expect, test } from 'bun:test';
import { createSpanResizeSlot, type SpanResizePointer } from '@/components/ui/useSpanResize';
import { TOUCH_LONG_PRESS_MS, TOUCH_SLOP_PX } from './touchGesture';
import { createTouchGestureSession, resizeHold, type TouchGestureTarget } from './touchGestureSession';

interface Cell {
  name: string;
  covered: boolean;
}
const EMPTY: Cell = { name: 'empty', covered: false };
const NOTE: Cell = { name: 'note', covered: true };

/** A session over a logging target. `liveHold: false` makes every hold null. */
function rig(liveHold = true) {
  const log: string[] = [];
  let clock = 0;
  let timer: (() => void) | null = null;
  const scheduled: Array<() => void> = [];
  const target: TouchGestureTarget<Cell> = {
    tap: (cell, pointerId) => {
      log.push(`tap ${cell.name} ${pointerId}`);
    },
    hold: (cell, pointer) => {
      log.push(`hold ${cell.name} ${pointer.pointerId} x=${pointer.clientX}`);
      if (!liveHold) return null;
      return {
        move: (p) => {
          log.push(`hold.move x=${p.clientX}`);
        },
        end: () => {
          log.push('hold.end');
        },
        cancel: () => {
          log.push('hold.cancel');
        },
      };
    },
  };
  const session = createTouchGestureSession(target, {
    now: () => clock,
    schedule: (_ms, fn) => {
      timer = fn;
      scheduled.push(fn);
      return () => {
        if (timer === fn) timer = null;
      };
    },
  });
  const at = (dx = 0, dy = 0, pointerId = 7) => ({ pointerId, clientX: 100 + dx, clientY: 100 + dy });
  return {
    session,
    log,
    at,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Let the live long-press timer fire, TOUCH_LONG_PRESS_MS after now. */
    hold: () => {
      clock += TOUCH_LONG_PRESS_MS;
      timer?.();
    },
    /** Whether a long-press timer is still scheduled (its canceller not run). */
    timerPending: () => timer !== null,
    /** The i-th scheduled callback, even after its canceller ran: a timer the browser fires late. */
    fireLate: (i: number) => {
      scheduled[i]?.();
    },
    down: (cell: Cell, pointerId = 7) => session.down(at(0, 0, pointerId), cell),
  };
}

describe('a tap', () => {
  test('calls tap on pointerup only, never on down', () => {
    const r = rig();
    r.down(EMPTY);
    expect(r.log).toEqual([]);
    r.advance(120);
    expect(r.session.end(r.at(2), 'pointerup')).toBe(true);
    expect(r.log).toEqual(['tap empty 7']);
    expect(r.session.isOpen()).toBe(false);
    expect(r.timerPending()).toBe(false);
  });

  test('a tap on a covered cell is a tap too', () => {
    const r = rig();
    r.down(NOTE);
    r.advance(120);
    r.session.end(r.at(), 'pointerup');
    expect(r.log).toEqual(['tap note 7']);
  });

  test('end answers false for a pointer the session does not own', () => {
    const r = rig();
    expect(r.session.end(r.at(), 'pointerup')).toBe(false);
    r.down(EMPTY);
    expect(r.session.end(r.at(0, 0, 9), 'pointerup')).toBe(false);
    expect(r.session.isOpen()).toBe(true);
    expect(r.log).toEqual([]);
  });
});

describe('a swipe and a cancel', () => {
  test('a swipe calls nothing, and the timer after it does nothing', () => {
    const r = rig();
    r.down(NOTE);
    r.advance(50);
    r.session.move(r.at(TOUCH_SLOP_PX));
    expect(r.session.isOpen()).toBe(false);
    expect(r.timerPending()).toBe(false);
    r.fireLate(0);
    expect(r.session.end(r.at(TOUCH_SLOP_PX), 'pointerup')).toBe(false);
    expect(r.log).toEqual([]);
  });

  test('pointercancel writes nothing', () => {
    const r = rig();
    r.down(EMPTY);
    r.advance(50);
    expect(r.session.end(r.at(), 'pointercancel')).toBe(true);
    expect(r.session.isOpen()).toBe(false);
    expect(r.log).toEqual([]);
  });

  test('a timer from a closed gesture does nothing to the next one', () => {
    const r = rig();
    r.down(EMPTY);
    r.session.move(r.at(TOUCH_SLOP_PX));
    r.down(NOTE, 8);
    r.fireLate(0);
    expect(r.log).toEqual([]);
    expect(r.session.holding()).toBe(false);
    r.hold();
    expect(r.log).toEqual(['hold note 8 x=100']);
  });
});

describe('a long-press with a live hold', () => {
  test('calls hold with the latest clientX', () => {
    const r = rig();
    r.down(NOTE);
    r.advance(100);
    r.session.move(r.at(5));
    expect(r.session.holding()).toBe(false);
    r.hold();
    expect(r.log).toEqual(['hold note 7 x=105']);
    expect(r.session.holding()).toBe(true);
    expect(r.session.isOpen()).toBe(true);
  });

  test('the hold receives move and end, and holding() is true only while it is live', () => {
    const r = rig();
    r.down(EMPTY);
    r.hold();
    r.session.move(r.at(40));
    r.session.move(r.at(60, 0, 9));
    expect(r.session.end(r.at(40), 'pointerup')).toBe(true);
    expect(r.log).toEqual(['hold empty 7 x=100', 'hold.move x=140', 'hold.end']);
    expect(r.session.holding()).toBe(false);
    expect(r.session.isOpen()).toBe(false);
  });
});

describe('a long-press whose hold is null (inert)', () => {
  test('stays open without blocking the pan, and a lift taps an empty cell', () => {
    const r = rig(false);
    r.down(EMPTY);
    r.hold();
    expect(r.session.holding()).toBe(false);
    expect(r.session.isOpen()).toBe(true);
    expect(r.session.end(r.at(3), 'pointerup')).toBe(true);
    expect(r.log).toEqual(['hold empty 7 x=100', 'tap empty 7']);
    expect(r.session.isOpen()).toBe(false);
  });

  test('a lift on a covered cell does nothing', () => {
    const r = rig(false);
    r.down(NOTE);
    r.hold();
    r.session.end(r.at(), 'pointerup');
    expect(r.log).toEqual(['hold note 7 x=100']);
  });

  test('a move past the slop closes it and writes nothing', () => {
    const r = rig(false);
    r.down(EMPTY);
    r.hold();
    r.session.move(r.at(TOUCH_SLOP_PX - 1));
    expect(r.session.isOpen()).toBe(true);
    r.session.move(r.at(TOUCH_SLOP_PX));
    expect(r.session.isOpen()).toBe(false);
    expect(r.session.end(r.at(TOUCH_SLOP_PX), 'pointerup')).toBe(false);
    expect(r.log).toEqual(['hold empty 7 x=100']);
  });
});

describe('a lift at the hold threshold before the timer runs', () => {
  test('taps an empty cell and never opens a hold', () => {
    const r = rig();
    r.down(EMPTY);
    r.advance(TOUCH_LONG_PRESS_MS);
    r.session.end(r.at(), 'pointerup');
    expect(r.log).toEqual(['tap empty 7']);
  });

  test('does nothing on a covered cell', () => {
    const r = rig();
    r.down(NOTE);
    r.advance(TOUCH_LONG_PRESS_MS);
    r.session.end(r.at(), 'pointerup');
    expect(r.log).toEqual([]);
  });
});

describe('interruptions', () => {
  test('a second finger aborts a pending gesture and is itself ignored', () => {
    const r = rig();
    r.down(EMPTY);
    r.down(EMPTY, 8);
    expect(r.session.isOpen()).toBe(false);
    expect(r.timerPending()).toBe(false);
    expect(r.session.end(r.at(0, 0, 8), 'pointerup')).toBe(false);
    expect(r.session.end(r.at(), 'pointerup')).toBe(false);
    expect(r.log).toEqual([]);
  });

  test('a second finger aborts a live hold through its cancel', () => {
    const r = rig();
    r.down(NOTE);
    r.hold();
    r.down(EMPTY, 8);
    expect(r.log).toEqual(['hold note 7 x=100', 'hold.cancel']);
    expect(r.session.holding()).toBe(false);
    expect(r.session.isOpen()).toBe(false);
  });

  test('pointercancel during a live hold cancels it and never ends it', () => {
    const r = rig();
    r.down(EMPTY);
    r.hold();
    r.session.end(r.at(), 'pointercancel');
    expect(r.log).toEqual(['hold empty 7 x=100', 'hold.cancel']);
  });

  test('dispose cancels the timer and writes nothing', () => {
    const r = rig();
    r.down(EMPTY);
    r.session.dispose();
    expect(r.timerPending()).toBe(false);
    expect(r.session.isOpen()).toBe(false);
    r.fireLate(0);
    expect(r.log).toEqual([]);
  });

  test('dispose cancels a live hold', () => {
    const r = rig();
    r.down(NOTE);
    r.hold();
    r.session.dispose();
    expect(r.log).toEqual(['hold note 7 x=100', 'hold.cancel']);
  });
});

describe('resizeHold', () => {
  test('calls start once with the pointer; move and end call nothing; cancel reaches the canceller', () => {
    const calls: string[] = [];
    const pointer: SpanResizePointer = { pointerId: 4, clientX: 50 };
    const hold = resizeHold(
      pointer,
      (p) => calls.push(`start ${p.pointerId} ${p.clientX}`),
      () => calls.push('cancel'),
    );
    expect(calls).toEqual(['start 4 50']);
    hold.move({ pointerId: 4, clientX: 90, clientY: 0 });
    hold.end();
    expect(calls).toEqual(['start 4 50']);
    hold.cancel();
    expect(calls).toEqual(['start 4 50', 'cancel']);
  });

  /** A resizeHold over the real span-resize slot, listening on a plain EventTarget. */
  function slotRig() {
    const win = new EventTarget();
    const slot = createSpanResizeSlot<{ id: string }>(() => win);
    const writes: string[] = [];
    const hold = resizeHold(
      { pointerId: 4, clientX: 100 },
      (p) =>
        slot.start(
          p,
          {
            identity: { id: 'span' },
            startLength: 1,
            maxLength: 8,
            pixelsPerStep: 20,
            onCommit: (_identity, length) => writes.push(`commit ${length}`),
            onClick: () => writes.push('click'),
          },
          () => {},
        ),
      () => slot.cancel(),
    );
    const send = (type: string, x: number): void => {
      win.dispatchEvent(Object.assign(new Event(type), { pointerId: 4, clientX: x }));
    };
    return { hold, writes, send };
  }

  test('with the real slot, a moved lift commits once', () => {
    const s = slotRig();
    s.send('pointermove', 140);
    s.send('pointerup', 140);
    s.send('pointerup', 140);
    expect(s.writes).toEqual(['commit 3']);
  });

  test("with the real slot, an unmoved lift commits nothing: it is the slot's click, which each adapter points at a no-op", () => {
    const s = slotRig();
    s.send('pointerup', 100);
    expect(s.writes).toEqual(['click']);
  });

  test('with the real slot, a cancel commits nothing', () => {
    const s = slotRig();
    s.send('pointermove', 140);
    s.hold.cancel();
    s.send('pointerup', 140);
    expect(s.writes).toEqual([]);
  });
});
