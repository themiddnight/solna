import { describe, expect, test } from 'bun:test';
import { createMidiActivityStore } from './midiActivity';

describe('MIDI activity store', () => {
  test('notifies only on active state transitions and stays active 250 ms after the last event', () => {
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const store = createMidiActivityStore(
      (callback) => {
        const id = ++nextTimer;
        timers.set(id, callback);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      (timer) => {
        timers.delete(timer as unknown as number);
      },
    );
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);

    store.trigger();
    expect(store.getSnapshot()).toBe(true);
    expect(notifications).toBe(1);

    store.trigger();
    expect(notifications).toBe(1);
    expect(timers.size).toBe(1);

    [...timers.values()][0]?.();
    expect(store.getSnapshot()).toBe(false);
    expect(notifications).toBe(2);

    unsubscribe();
  });

  test('replaces the expiry timer on repeated activity', () => {
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const store = createMidiActivityStore(
      (callback) => {
        const id = ++nextTimer;
        timers.set(id, callback);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      (timer) => timers.delete(timer as unknown as number),
    );

    store.trigger();
    const firstTimer = [...timers.entries()][0];
    store.trigger();
    expect(timers.has(firstTimer![0])).toBe(false);
    expect(timers.size).toBe(1);
  });
});
