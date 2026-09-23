/**
 * The feedback slice: every toast and snackbar the app shows (R329, R330).
 *
 * SESSION state — absent from `partializeAppState`, never persisted (the
 * `exportJob` precedent). A slice rather than a context because the store
 * raises messages itself and must not import `components/`; low-frequency, so
 * R016 allows it. `FeedbackHost` reads it through `useLiveStore`.
 *
 * Timers live in this closure, one per key, armed through the injected
 * `schedule`. Expiry removes by `(key, seq)`, so a replaced entry's old timer
 * can never remove its replacement.
 *
 * While any dialog holds (`holdFeedback`, taken only by `useNativeDialog`), no
 * timer runs: a toast cannot rise above a modal backdrop, so it waits instead
 * of expiring unseen. When the last hold is released every queued entry gets a
 * fresh full-duration timer.
 */
import {
  enqueueFeedback,
  feedbackDurationMs,
  removeFeedback,
  type FeedbackEntry,
  type FeedbackRequest,
} from './feedback';

/** Arms `fn` after `ms`; returns its cancel. */
export type FeedbackSchedule = (fn: () => void, ms: number) => () => void;

export interface FeedbackSlice {
  /** Oldest first; the host puts the newest nearest its edge. */
  feedback: readonly FeedbackEntry[];
  /** Open dialogs holding the timers; see `holdFeedback`. */
  feedbackHolds: number;
  showFeedback: (req: FeedbackRequest) => void;
  dismissFeedback: (key: string) => void;
  /** A snackbar's button: runs the action, then dismisses that showing. */
  runFeedbackAction: (key: string) => void;
  /** Stops every timer until the returned release; releasing twice is a no-op. */
  holdFeedback: () => () => void;
}

const timeoutSchedule: FeedbackSchedule = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

type Set = (partial: Partial<FeedbackSlice>) => void;
type Get = () => FeedbackSlice;

export function createFeedbackSlice(
  set: Set,
  get: Get,
  deps: { schedule: FeedbackSchedule } = { schedule: timeoutSchedule },
): FeedbackSlice {
  const timers = new Map<string, () => void>();
  let seq = 0;

  const cancel = (key: string) => {
    timers.get(key)?.();
    timers.delete(key);
  };

  const remove = (key: string, showing?: number) => {
    const list = get().feedback;
    const next = removeFeedback(list, key, showing);
    if (next !== list) set({ feedback: next });
  };

  const arm = (entry: FeedbackEntry) => {
    cancel(entry.key);
    const stop = deps.schedule(() => {
      // Only this timer's own entry may clear the map slot: a replacement has
      // already put its own cancel there.
      if (timers.get(entry.key) === stop) timers.delete(entry.key);
      remove(entry.key, entry.seq);
    }, feedbackDurationMs(entry));
    timers.set(entry.key, stop);
  };

  return {
    feedback: [],
    feedbackHolds: 0,

    showFeedback: (req) => {
      seq += 1;
      const entry: FeedbackEntry = { ...req, seq };
      const list = get().feedback;
      const next = enqueueFeedback(list, entry);
      // An entry pushed past the limit leaves with its timer.
      for (const old of list) {
        if (!next.some((e) => e.key === old.key)) cancel(old.key);
      }
      set({ feedback: next });
      if (get().feedbackHolds === 0) arm(entry);
    },

    dismissFeedback: (key) => {
      cancel(key);
      remove(key);
    },

    runFeedbackAction: (key) => {
      const entry = get().feedback.find((e) => e.key === key);
      if (!entry?.action) return;
      entry.action.run();
      // By (key, seq): an action that raises a new message under the same key
      // keeps it, and keeps its timer.
      if (get().feedback.some((e) => e.key === key && e.seq === entry.seq)) {
        cancel(key);
        remove(key, entry.seq);
      }
    },

    holdFeedback: () => {
      set({ feedbackHolds: get().feedbackHolds + 1 });
      for (const key of [...timers.keys()]) cancel(key);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const holds = get().feedbackHolds - 1;
        set({ feedbackHolds: holds });
        if (holds === 0) for (const entry of get().feedback) arm(entry);
      };
    },
  };
}
