import type { StateStorage } from 'zustand/middleware';

/**
 * How long a buffered write may sit before it is forced out. Used as the
 * requestIdleCallback timeout, and as the plain setTimeout delay where there
 * is no requestIdleCallback (Safari < 16.4, and every non-browser runtime).
 *
 * The pending buffer this feeds is per tab, in memory, with no cross-tab
 * merge: two tabs writing to the same storage key were already last-write-
 * wins with no `storage`-event reconciliation, but the losing window used to
 * be effectively instantaneous (one synchronous setItem). Buffering widens
 * that window to this timeout — a second tab that writes and closes inside
 * it can still be silently overwritten when this tab's delayed flush lands.
 */
export const IDLE_FLUSH_TIMEOUT_MS = 250;

export interface WriteScheduler {
  schedule: (flush: () => void) => number;
  cancel: (handle: number) => void;
}

// requestIdleCallback and cancelIdleCallback must be used as a PAIR — mixing an
// idle handle with clearTimeout silently fails to cancel — so the capability is
// probed once, for both.
const HAS_IDLE_CALLBACK =
  typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function';

export const idleWriteScheduler: WriteScheduler = {
  schedule: (flush) =>
    HAS_IDLE_CALLBACK
      ? requestIdleCallback(flush, { timeout: IDLE_FLUSH_TIMEOUT_MS })
      : (setTimeout(flush, IDLE_FLUSH_TIMEOUT_MS) as unknown as number),
  cancel: (handle) => {
    if (HAS_IDLE_CALLBACK) cancelIdleCallback(handle);
    else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

export interface CoalescedStorage extends StateStorage {
  /** Writes every buffered value through to the base storage, synchronously. */
  flush(): void;
  /** Drops every buffered value without writing it. */
  discard(): void;
  /** Names with a write still buffered. Test/diagnostic use only. */
  pendingNames(): string[];
}

/**
 * A write-coalescing `StateStorage`. `setItem` buffers the latest value per
 * name and schedules ONE flush; `getItem` reads the buffer first so hydration
 * and any read-your-writes caller still sees the newest value.
 *
 * Why: zustand's persist middleware has no throttle — on every set() it runs
 * `{...get()}`, `partialize` and `JSON.stringify` over the whole persisted
 * slice, then calls the storage's setItem, all above this adapter (see
 * `createJSONStorage` in zustand/middleware). This adapter sits below that
 * boundary and only removes the synchronous localStorage.setItem — the
 * serialize-the-whole-project cost still runs on every set() and is not
 * touched here. What this buys: during a knob drag that was 60-120 synchronous
 * localStorage writes per second blocking the main thread the audio scheduler
 * runs on; those collapse to one flush per IDLE_FLUSH_TIMEOUT_MS window. A
 * project with a large `loops` array dragging a knob still re-serializes that
 * array at pointer rate — cutting that cost means throttling persisted writes
 * upstream (partialize/subscribe), which is out of scope for a storage
 * adapter.
 *
 * Every base call is wrapped in try/catch on purpose: `localStorage` does not
 * merely return null when it is unavailable, it THROWS (Safari private mode,
 * blocked cookies, embedded webviews). A throwing write must still clear the
 * buffer, or the adapter would retry the same doomed value forever.
 */
export function createCoalescedStorage(
  base: StateStorage,
  scheduler: WriteScheduler = idleWriteScheduler,
): CoalescedStorage {
  const pending = new Map<string, string>();
  let handle: number | null = null;

  const cancelScheduled = (): void => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  };

  const flush = (): void => {
    cancelScheduled();
    if (pending.size === 0) return;
    // Drain BEFORE writing: a throwing setItem must not leave the entry
    // buffered for an endless retry.
    const drained = [...pending];
    pending.clear();
    for (const [name, value] of drained) {
      try {
        base.setItem(name, value);
      } catch {
        // ignore — see the docblock
      }
    }
  };

  return {
    getItem: (name) => {
      const buffered = pending.get(name);
      if (buffered !== undefined) return buffered;
      try {
        return base.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending.set(name, value);
      if (handle === null) handle = scheduler.schedule(flush);
    },
    removeItem: (name) => {
      pending.delete(name);
      if (pending.size === 0) cancelScheduled();
      try {
        base.removeItem(name);
      } catch {
        // ignore — see the docblock
      }
    },
    flush,
    discard: () => {
      pending.clear();
      cancelScheduled();
    },
    pendingNames: () => [...pending.keys()],
  };
}
