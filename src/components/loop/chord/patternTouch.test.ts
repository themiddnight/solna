import { describe, expect, test } from 'bun:test';
import { TOUCH_LONG_PRESS_MS } from '@/components/touchGesture';
import { createTouchGestureSession } from '@/components/touchGestureSession';
import { createSpanResizeSlot } from '@/components/ui/useSpanResize';
import {
  createPatternClickFilter,
  createPatternTouchHandlers,
  createPatternTouchTarget,
  type PatternSpanIdentity,
  type PatternTouchCell,
} from './patternTouch';

const COLUMN_PX = 28;
const EMPTY: PatternTouchCell = { column: 3, covered: false };
const EVENT: PatternTouchCell = { column: 16, covered: true, length: 2, maxLength: 8 };

/**
 * The lane's real target and session over the real span-resize slot, which
 * listens on a plain EventTarget standing in for window. Wired the way
 * usePatternTouch wires them.
 */
function rig() {
  const writes: string[] = [];
  const spanStarts: Array<{ identity: PatternSpanIdentity; startLength: number; maxLength: number; pixelsPerStep: number }> = [];
  const identities = new Map<number, PatternSpanIdentity>();
  const identityFor = (column: number): PatternSpanIdentity => {
    let identity = identities.get(column);
    if (!identity) {
      identity = { column };
      identities.set(column, identity);
    }
    return identity;
  };
  const win = new EventTarget();
  const slot = createSpanResizeSlot<PatternSpanIdentity>(() => win);
  let clock = 0;
  let timer: (() => void) | null = null;
  const target = createPatternTouchTarget({
    onActivate: (column) => writes.push(`activate ${column}`),
    onResize: (column, length) => writes.push(`resize ${column} ${length}`),
    identityFor,
    columnWidthPx: () => COLUMN_PX,
    startResize: (pointer, input) => {
      const { identity, startLength, maxLength, pixelsPerStep } = input;
      spanStarts.push({ identity, startLength, maxLength, pixelsPerStep });
      slot.start(pointer, input, () => {});
    },
    cancelResize: () => slot.cancel(),
  });
  const session = createTouchGestureSession(target, {
    now: () => clock,
    schedule: (_ms, fn) => {
      timer = fn;
      return () => {
        if (timer === fn) timer = null;
      };
    },
  });
  const X = 500;
  const Y = 40;
  const p = (dx = 0, pointerId = 7) => ({ pointerId, clientX: X + dx, clientY: Y });
  const windowEvent = (type: string, dx: number): Event =>
    Object.assign(new Event(type), { pointerId: 7, clientX: X + dx, clientY: Y });
  return {
    session,
    writes,
    spanStarts,
    identityFor,
    p,
    advance: (ms: number) => {
      clock += ms;
    },
    hold: () => {
      clock += TOUCH_LONG_PRESS_MS;
      timer?.();
    },
    down: (cell: PatternTouchCell, pointerId = 7) => session.down(p(0, pointerId), cell),
    /** A window event reaches the lane's lifetime listener, then the resize's. */
    move: (dx: number) => {
      session.move(p(dx));
      win.dispatchEvent(windowEvent('pointermove', dx));
    },
    up: (dx = 0) => {
      session.end(p(dx), 'pointerup');
      win.dispatchEvent(windowEvent('pointerup', dx));
    },
    cancel: () => {
      session.end(p(), 'pointercancel');
      win.dispatchEvent(windowEvent('pointercancel', 0));
    },
  };
}

describe('lane touch: tap and swipe', () => {
  test('a tap on an empty column activates it once, on the lift', () => {
    const r = rig();
    r.down(EMPTY);
    expect(r.writes).toEqual([]);
    r.advance(100);
    r.up(2);
    expect(r.writes).toEqual(['activate 3']);
  });

  test('a tap on an event activates its column once, on the lift', () => {
    const r = rig();
    r.down(EVENT);
    r.advance(100);
    r.up();
    expect(r.writes).toEqual(['activate 16']);
    expect(r.spanStarts).toEqual([]);
  });

  test('a swipe writes nothing and starts no resize', () => {
    const r = rig();
    r.down(EVENT);
    r.move(10);
    r.up(10);
    r.hold();
    expect(r.writes).toEqual([]);
    expect(r.spanStarts).toEqual([]);
  });
});

describe('lane touch: long-press on an empty column', () => {
  test('then a lift activates it', () => {
    const r = rig();
    r.down(EMPTY);
    r.hold();
    expect(r.session.holding()).toBe(false);
    expect(r.session.isOpen()).toBe(true);
    r.up();
    expect(r.writes).toEqual(['activate 3']);
  });

  test('then a drag writes nothing and gives the finger back', () => {
    const r = rig();
    r.down(EMPTY);
    r.hold();
    r.move(40);
    expect(r.session.isOpen()).toBe(false);
    r.up(40);
    expect(r.writes).toEqual([]);
    expect(r.spanStarts).toEqual([]);
  });
});

describe('lane touch: long-press on an event', () => {
  test("starts a span resize with the event's identity, length, maxLength and the measured step", () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    expect(r.spanStarts).toHaveLength(1);
    expect(r.spanStarts[0]?.identity).toBe(r.identityFor(16));
    expect(r.spanStarts[0]).toEqual({ identity: { column: 16 }, startLength: 2, maxLength: 8, pixelsPerStep: COLUMN_PX });
    expect(r.session.holding()).toBe(true);
  });

  test('a drag then a lift resizes once, on the lift', () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    r.move(2 * COLUMN_PX);
    expect(r.writes).toEqual([]);
    r.up(2 * COLUMN_PX);
    expect(r.writes).toEqual(['resize 16 4']);
  });

  test('an unmoved lift neither resizes nor activates', () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    r.up();
    expect(r.writes).toEqual([]);
  });

  test('a second finger during the resize writes nothing', () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    r.move(COLUMN_PX);
    r.down(EMPTY, 9);
    r.up(COLUMN_PX);
    expect(r.writes).toEqual([]);
  });

  test('a pointercancel during the resize writes nothing', () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    r.move(COLUMN_PX);
    r.cancel();
    expect(r.writes).toEqual([]);
  });

  test('dispose mid-resize cancels it and writes nothing', () => {
    const r = rig();
    r.down(EVENT);
    r.hold();
    r.move(COLUMN_PX);
    r.session.dispose();
    r.up(COLUMN_PX);
    expect(r.writes).toEqual([]);
  });
});

describe('the handle and the head wrapper, in DOM order', () => {
  function domRig() {
    const downs: string[] = [];
    const handlers = createPatternTouchHandlers({
      down: (p, cell) => {
        downs.push(`down ${p.pointerId} ${cell.column}`);
      },
    });
    const pointer = (pointerType: string, button = 0) => ({ pointerId: 4, pointerType, button, clientX: 10, clientY: 10 });
    /** A pointerdown on the handle: its own handler, then — unless its drag
     * started, which stops propagation — the head wrapper's. */
    const pressHandle = (pointerType: string): boolean => {
      let dragged = false;
      handlers.onHandlePointerDown(pointer(pointerType), () => {
        dragged = true;
      });
      if (!dragged) handlers.onCellPointerDown(pointer(pointerType), EVENT);
      return dragged;
    };
    return { downs, handlers, pointer, pressHandle };
  }

  test('a touch on the handle opens the session and starts no span resize', () => {
    const d = domRig();
    expect(d.pressHandle('touch')).toBe(false);
    expect(d.downs).toEqual(['down 4 16']);
  });

  test('mouse and pen on the handle start the drag at once', () => {
    const d = domRig();
    expect(d.pressHandle('mouse')).toBe(true);
    expect(d.pressHandle('pen')).toBe(true);
    expect(d.downs).toEqual([]);
  });

  test('a mouse, or a non-primary touch, on a cell opens no session', () => {
    const d = domRig();
    d.handlers.onCellPointerDown(d.pointer('mouse'), EMPTY);
    d.handlers.onCellPointerDown(d.pointer('pen'), EMPTY);
    d.handlers.onCellPointerDown(d.pointer('touch', 2), EMPTY);
    expect(d.downs).toEqual([]);
  });
});

describe('the click filter', () => {
  test('with no pointerdown seen, every click passes', () => {
    const f = createPatternClickFilter();
    expect(f.allowClick(1)).toBe(true);
    expect(f.allowClick(0)).toBe(true);
  });

  test('after a touch pointerdown, a detail-1 click is dropped and a detail-0 click passes', () => {
    const f = createPatternClickFilter();
    f.pointerDown('touch');
    expect(f.allowClick(1)).toBe(false);
    expect(f.allowClick(0)).toBe(true);
  });

  test('a mouse pointerdown clears the flag, so a mouse click activates', () => {
    const f = createPatternClickFilter();
    f.pointerDown('touch');
    f.pointerDown('mouse');
    expect(f.allowClick(1)).toBe(true);
  });
});
