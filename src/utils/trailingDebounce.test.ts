import { describe, expect, test } from 'bun:test';
import { createTrailingDebounce, type DebounceScheduler } from './trailingDebounce';

/** A scheduler the test drives by hand — no timers, no sleeping. */
function manualTimers() {
  let next = 1;
  const queued = new Map<number, () => void>();
  const scheduler: DebounceScheduler = {
    schedule: (fn) => {
      const handle = next++;
      queued.set(handle, fn);
      return handle;
    },
    cancel: (handle) => {
      queued.delete(handle);
    },
  };
  const fire = () => {
    const due = [...queued.values()];
    queued.clear();
    due.forEach((fn) => fn());
  };
  return { scheduler, fire, armed: () => queued.size };
}

describe('createTrailingDebounce', () => {
  test('a single push commits nothing until the delay elapses', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.push(1);
    expect(committed).toEqual([]);
    expect(d.isPending()).toBe(true);

    timers.fire();
    expect(committed).toEqual([1]);
    expect(d.isPending()).toBe(false);
  });

  test('a whole sweep commits ONCE, with the final value', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    for (let i = 1; i <= 100; i++) d.push(i / 10);

    expect(committed).toEqual([]);
    expect(timers.armed()).toBe(1); // the timer was RESTARTED, not stacked
    timers.fire();
    expect(committed).toEqual([10]);
  });

  test('the timer restarts on every push, so the commit trails the LAST one', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.push(1);
    d.push(2);
    timers.fire();
    expect(committed).toEqual([2]);

    d.push(3);
    timers.fire();
    expect(committed).toEqual([2, 3]);
  });

  test('flush() commits the pending value immediately and disarms', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.push(4.5);
    d.flush();

    expect(committed).toEqual([4.5]);
    expect(timers.armed()).toBe(0);
    timers.fire();
    expect(committed).toEqual([4.5]); // no double commit
  });

  test('flush() with nothing pending commits nothing', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.flush();

    expect(committed).toEqual([]);
  });

  test('cancel() drops the pending value', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.push(9);
    d.cancel();
    timers.fire();

    expect(committed).toEqual([]);
    expect(d.isPending()).toBe(false);
  });

  test('a value of 0 is still a real pending value', () => {
    const timers = manualTimers();
    const committed: number[] = [];
    const d = createTrailingDebounce<number>((v) => committed.push(v), 180, timers.scheduler);

    d.push(0);
    expect(d.isPending()).toBe(true);
    timers.fire();
    expect(committed).toEqual([0]);
  });

  test('a throwing commit clears the pending state instead of stranding it', () => {
    const timers = manualTimers();
    let calls = 0;
    const d = createTrailingDebounce<number>(
      () => {
        calls++;
        throw new Error('convolver rejected the buffer');
      },
      180,
      timers.scheduler,
    );

    d.push(1);
    expect(() => timers.fire()).not.toThrow();
    expect(d.isPending()).toBe(false);

    d.push(2);
    timers.fire();
    expect(calls).toBe(2);
  });
});
