export interface FrameScheduler {
  request: (fn: () => void) => number;
  cancel: (handle: number) => void;
}

// requestAnimationFrame / cancelAnimationFrame must be used as a pair, so the
// capability is probed once for both. Outside a browser (bun, SSR) a 16 ms
// timer stands in — it never runs synchronously, which is exactly what the
// leading-edge rule below relies on to keep one-shot changes immediate.
const HAS_RAF =
  typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';

export const rafScheduler: FrameScheduler = {
  request: (fn) =>
    HAS_RAF ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number),
  cancel: (handle) => {
    if (HAS_RAF) cancelAnimationFrame(handle);
    else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

export interface FrameCoalescer {
  push(key: string, apply: () => void): void;
  flush(): void;
  cancel(): void;
  pendingKeys(): string[];
}

/**
 * Caps a keyed stream of "latest value wins" work at one application per
 * animation frame, WITHOUT delaying one-shot changes.
 *
 * Leading edge: the first value for a key inside the current frame window is
 * applied synchronously. A key is only treated as continuous once a SECOND
 * value for it arrives before the armed frame drains — so a preset load, a
 * vibe apply or a bootstrap (one value per key) is never deferred, while a
 * knob drag (many values on one key) collapses to one apply per frame.
 *
 * Used by store/engineSync.ts, where each application is an
 * updateSynthParams / updateEffects call that re-targets every live voice with
 * ~15-20 timeline-locking AudioParam operations apiece.
 */
export function createFrameCoalescer(
  scheduler: FrameScheduler = rafScheduler,
): FrameCoalescer {
  const pending = new Map<string, () => void>();
  let appliedThisWindow = new Set<string>();
  let handle: number | null = null;

  const cancelFrame = (): void => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  };

  // Returns whether `apply` completed without throwing. A failing engine call
  // must not strand the queue, and — since it never actually reached the
  // engine — must not count as "applied" for this key either, or a
  // persistently throwing thunk would permanently defer every future value
  // for that key instead of retrying it immediately.
  const runThunk = (apply: () => void): boolean => {
    try {
      apply();
      return true;
    } catch {
      return false;
    }
  };

  const drain = (): void => {
    handle = null;
    const due = [...pending];
    pending.clear();
    const applied = new Set<string>();
    for (const [key, apply] of due) {
      if (runThunk(apply)) applied.add(key);
    }
    appliedThisWindow = applied;
    // Re-arm only while work is still flowing, so an idle coalescer schedules
    // nothing at all.
    if (due.length > 0) handle = scheduler.request(drain);
  };

  return {
    push: (key, apply) => {
      if (handle === null) {
        const ok = runThunk(apply);
        appliedThisWindow = ok ? new Set([key]) : new Set();
        handle = scheduler.request(drain);
        return;
      }
      if (!appliedThisWindow.has(key)) {
        if (runThunk(apply)) appliedThisWindow.add(key);
        return;
      }
      pending.set(key, apply);
    },
    flush: () => {
      cancelFrame();
      const due = [...pending.values()];
      pending.clear();
      appliedThisWindow = new Set();
      for (const apply of due) runThunk(apply);
    },
    cancel: () => {
      pending.clear();
      appliedThisWindow = new Set();
      cancelFrame();
    },
    pendingKeys: () => [...pending.keys()],
  };
}
