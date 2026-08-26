import { describe, expect, test } from 'bun:test';
import { registerFirstGesture } from './App';

/**
 * A minimal EventTarget stand-in: no DOM, just enough of the
 * add/removeEventListener contract for `registerFirstGesture` to operate on
 * and for these tests to introspect and dispatch synchronously.
 */
class FakeEventTarget {
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, handler: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: () => void): void {
    this.listeners.get(type)?.delete(handler);
  }

  dispatch(type: string): void {
    // Snapshot first: a handler may remove listeners (including itself) as
    // part of running, and mutating a Set while iterating it is unsafe.
    const handlers = [...(this.listeners.get(type) ?? [])];
    handlers.forEach((handler) => handler());
  }

  totalListenerCount(): number {
    let total = 0;
    this.listeners.forEach((set) => (total += set.size));
    return total;
  }
}

describe('registerFirstGesture', () => {
  (['click', 'keydown', 'pointerdown'] as const).forEach((eventType) => {
    test(`${eventType} alone triggers the callback exactly once`, () => {
      const target = new FakeEventTarget();
      let calls = 0;
      registerFirstGesture(target, () => {
        calls += 1;
      });

      target.dispatch(eventType);
      target.dispatch(eventType);

      expect(calls).toBe(1);
    });
  });

  test('two different gestures in the same tick only fire the callback once', () => {
    const target = new FakeEventTarget();
    let calls = 0;
    registerFirstGesture(target, () => {
      calls += 1;
    });

    target.dispatch('click');
    target.dispatch('keydown');
    target.dispatch('pointerdown');

    expect(calls).toBe(1);
  });

  test('all listeners are removed once the first gesture fires', () => {
    const target = new FakeEventTarget();

    registerFirstGesture(target, () => {});
    expect(target.totalListenerCount()).toBe(3);

    target.dispatch('keydown');
    expect(target.totalListenerCount()).toBe(0);
  });

  test('the returned cleanup function removes every listener without firing the callback', () => {
    const target = new FakeEventTarget();
    let calls = 0;
    const cleanup = registerFirstGesture(target, () => {
      calls += 1;
    });

    cleanup();

    expect(target.totalListenerCount()).toBe(0);
    expect(calls).toBe(0);

    // Confirms the listeners were truly removed, not merely inert.
    target.dispatch('click');
    target.dispatch('keydown');
    target.dispatch('pointerdown');
    expect(calls).toBe(0);
  });
});
