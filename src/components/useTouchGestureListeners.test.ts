import { describe, expect, test } from 'bun:test';
import { attachTouchGestureListeners } from './useTouchGestureListeners';

function rig(withElement = true) {
  const element = new EventTarget();
  const win = new EventTarget();
  const calls: string[] = [];
  const state = { holding: false, open: false };
  const detach = attachTouchGestureListeners(withElement ? element : null, win, {
    move: (p) => {
      calls.push(`move ${p.pointerId} ${p.clientX} ${p.clientY}`);
    },
    end: (p, type) => {
      calls.push(`end ${p.pointerId} ${type}`);
    },
    holding: () => state.holding,
    isOpen: () => state.open,
    dispose: () => {
      calls.push('dispose');
    },
  });
  const pointer = (type: string): Event =>
    Object.assign(new Event(type), { pointerId: 3, clientX: 10, clientY: 20 });
  /** Dispatch on the element; answers whether the default was prevented. */
  const onElement = (type: string, cancelable = true): boolean => {
    const ev = new Event(type, { cancelable });
    element.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  return { win, calls, state, detach, pointer, onElement };
}

describe('attachTouchGestureListeners', () => {
  test('forwards window pointermove, pointerup and pointercancel', () => {
    const r = rig();
    r.win.dispatchEvent(r.pointer('pointermove'));
    r.win.dispatchEvent(r.pointer('pointerup'));
    r.win.dispatchEvent(r.pointer('pointercancel'));
    expect(r.calls).toEqual(['move 3 10 20', 'end 3 pointerup', 'end 3 pointercancel']);
  });

  test('prevents a touchmove only while holding and only when it is cancelable', () => {
    const r = rig();
    expect(r.onElement('touchmove')).toBe(false);
    r.state.holding = true;
    expect(r.onElement('touchmove')).toBe(true);
    expect(r.onElement('touchmove', false)).toBe(false);
  });

  test('prevents contextmenu only while a gesture is open', () => {
    const r = rig();
    expect(r.onElement('contextmenu')).toBe(false);
    r.state.open = true;
    expect(r.onElement('contextmenu')).toBe(true);
  });

  test('detach removes every listener and disposes the session once', () => {
    const r = rig();
    r.state.holding = true;
    r.state.open = true;
    r.detach();
    expect(r.calls).toEqual(['dispose']);
    r.win.dispatchEvent(r.pointer('pointermove'));
    r.win.dispatchEvent(r.pointer('pointerup'));
    r.win.dispatchEvent(r.pointer('pointercancel'));
    expect(r.onElement('touchmove')).toBe(false);
    expect(r.onElement('contextmenu')).toBe(false);
    expect(r.calls).toEqual(['dispose']);
  });

  test('with no element, the window listeners still attach and detach', () => {
    const r = rig(false);
    r.win.dispatchEvent(r.pointer('pointerup'));
    r.detach();
    r.win.dispatchEvent(r.pointer('pointerup'));
    expect(r.calls).toEqual(['end 3 pointerup', 'dispose']);
  });
});
