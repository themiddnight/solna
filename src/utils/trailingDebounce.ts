export interface DebounceScheduler {
  schedule: (fn: () => void, delayMs: number) => number;
  cancel: (handle: number) => void;
}

export const timerDebounceScheduler: DebounceScheduler = {
  schedule: (fn, delayMs) => setTimeout(fn, delayMs) as unknown as number,
  cancel: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
};

export interface TrailingDebounce<T> {
  /** Records `value` and (re)starts the delay. Nothing is committed yet. */
  push(value: T): void;
  /** Commits the pending value now, if any, and clears the timer. */
  flush(): void;
  /** Drops the pending value and clears the timer. */
  cancel(): void;
  /** Whether a value is waiting to be committed. */
  isPending(): boolean;
}

/**
 * Classic trailing debounce: `push` records the latest value and RESTARTS the
 * delay, so a continuous gesture commits exactly once, with its final value.
 * The scheduler is injectable so tests drive it synchronously.
 *
 * Used for the reverb Decay knob, whose commit rebuilds a multi-megabyte
 * impulse response and re-partitions the ConvolverNode.
 */
export function createTrailingDebounce<T>(
  commit: (value: T) => void,
  delayMs: number,
  scheduler: DebounceScheduler = timerDebounceScheduler,
): TrailingDebounce<T> {
  // A box, not a bare `T | null`, so 0 / '' / false are legitimate values.
  let pending: { value: T } | null = null;
  let handle: number | null = null;

  const disarm = (): void => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  };

  const commitNow = (): void => {
    handle = null;
    const box = pending;
    // Clear BEFORE committing: a throwing commit must not leave the value
    // pending for an endless retry.
    pending = null;
    if (!box) return;
    try {
      commit(box.value);
    } catch {
      // ignore — the next push supersedes it
    }
  };

  return {
    push: (value) => {
      pending = { value };
      disarm();
      handle = scheduler.schedule(commitNow, delayMs);
    },
    flush: () => {
      disarm();
      commitNow();
    },
    cancel: () => {
      pending = null;
      disarm();
    },
    isPending: () => pending !== null,
  };
}
