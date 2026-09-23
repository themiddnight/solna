/**
 * Transient feedback — toasts and snackbars (R329, R330) — as pure list
 * operations. The slice (`feedbackSlice.ts`) owns the timers; everything here
 * is a function of its arguments, so replacement, the visible limit and the
 * stale-timer rule are testable without a clock.
 */

export type FeedbackTone = 'info' | 'success' | 'warning' | 'error';

interface FeedbackAction {
  /** The button's DOM id — a snackbar's action is addressed like any other control. */
  id: string;
  label: string;
  run: () => void;
}

export interface FeedbackRequest {
  /** Same key replaces: a vibe reroll replaces its load toast, one pending Undo per kind. */
  key: string;
  message: string;
  detail?: string;
  tone: FeedbackTone;
  /** Present ⇒ a snackbar (at most one action). */
  action?: FeedbackAction;
  durationMs?: number;
}

export interface FeedbackEntry extends FeedbackRequest {
  /** Which showing of `key` this is — a timer armed for an older one must not remove it. */
  seq: number;
}

/** How many entries the host shows at once; the oldest drops. */
const FEEDBACK_LIMIT = 3;

/**
 * Appends `entry` as the newest, first removing any entry with the same key,
 * then drops the oldest beyond `limit`. The list is ordered oldest first.
 */
export function enqueueFeedback(
  list: readonly FeedbackEntry[],
  entry: FeedbackEntry,
  limit: number = FEEDBACK_LIMIT,
): readonly FeedbackEntry[] {
  const next = [...list.filter((e) => e.key !== entry.key), entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Removes the entry under `key` — only if it is still showing `seq`, when one
 * is given. An expiry passes its seq, so a timer armed for a replaced entry is
 * a no-op against its replacement. Returns `list` itself when nothing matched.
 */
export function removeFeedback(
  list: readonly FeedbackEntry[],
  key: string,
  seq?: number,
): readonly FeedbackEntry[] {
  const next = list.filter((e) => e.key !== key || (seq !== undefined && e.seq !== seq));
  return next.length === list.length ? list : next;
}

/** A toast 3 s, an error toast 8 s (it may need reading), a snackbar 5 s — unless the request names its own. */
export function feedbackDurationMs(req: FeedbackRequest): number {
  if (req.durationMs !== undefined) return req.durationMs;
  if (req.action) return 5000;
  return req.tone === 'error' ? 8000 : 3000;
}
