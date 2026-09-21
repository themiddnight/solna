import { describe, expect, test } from 'bun:test';
import { scheduleTimeout } from './useTimedToast';

/** Records every timer armed and cleared, so the test sees replacement directly. */
function withFakeTimers() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const pending = new Map<number, () => void>();
  let nextId = 1;
  globalThis.setTimeout = ((fn: () => void) => {
    const id = nextId++;
    pending.set(id, fn);
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    pending.delete(id);
  }) as unknown as typeof clearTimeout;
  return {
    pending,
    fireAll: () => { for (const fn of [...pending.values()]) fn(); },
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

describe('scheduleTimeout', () => {
  test('a second schedule clears the first timer', () => {
    const timers = withFakeTimers();
    try {
      const ref = { current: null as ReturnType<typeof setTimeout> | null };
      const fired: string[] = [];
      scheduleTimeout(ref, () => fired.push('first'), 3000);
      scheduleTimeout(ref, () => fired.push('second'), 5000);
      expect(timers.pending.size).toBe(1);
      timers.fireAll();
      expect(fired).toEqual(['second']);
    } finally {
      timers.restore();
    }
  });

  test('the ref holds the pending timer id', () => {
    const timers = withFakeTimers();
    try {
      const ref = { current: null as ReturnType<typeof setTimeout> | null };
      scheduleTimeout(ref, () => {}, 100);
      expect(timers.pending.has(ref.current as unknown as number)).toBe(true);
    } finally {
      timers.restore();
    }
  });
});
