import React from 'react';
import type { FeedbackEntry, FeedbackTone } from '@/store/feedback';
import { useLiveStore } from './useLiveStore';

/** Literal strings, so Tailwind's scanner generates all four. */
const TONE_CLASS: Record<FeedbackTone, string> = {
  info: 'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
  error: 'alert-error',
};

/**
 * The React key for one feedback entry. `seq` is folded in so a replacement
 * under the same `key` (same slot, new content) remounts rather than updates
 * — the fade-in replays and the entry is re-announced to a screen reader,
 * instead of the DOM node quietly swapping its text.
 */
export function feedbackEntryKey(entry: Pick<FeedbackEntry, 'key' | 'seq'>): string {
  return `${entry.key}:${entry.seq}`;
}

/** Where the host hangs off its zero-height slot: above it, or below it. */
const EDGE_CLASS = {
  // Desktop: above the input dock's toggle strip, which `pb-9` on <main> reserves.
  bottom: 'bottom-10 flex-col',
  // Mobile: under the top bar; newest nearest the edge, so the column runs upward.
  top: 'top-2 flex-col-reverse',
} as const;

function FeedbackItem({
  entry,
  onAction,
}: {
  entry: FeedbackEntry;
  onAction: (key: string) => void;
}) {
  return (
    <div
      className={`alert alert-soft ${TONE_CLASS[entry.tone]} pointer-events-auto w-auto max-w-md py-1.5 px-3 text-xs shadow-lg animate-fade-in`}
    >
      <div className="flex flex-col items-start gap-0.5">
        <span className="font-semibold">{entry.message}</span>
        {entry.detail && <span className="opacity-80">{entry.detail}</span>}
      </div>
      {entry.action && (
        <button id={entry.action.id} type="button" className="btn btn-xs" onClick={() => onAction(entry.key)}>
          {entry.action.label}
        </button>
      )}
    </div>
  );
}

/**
 * The one place toasts and snackbars render (R330): one per frame, in a
 * zero-height `relative z-55` slot — above drawers, because a drawer action
 * (a synth preset load) raises a toast (R331). The desktop frame's slot sits in
 * `ShellBody` between `<main>` and the input dock; the mobile frame's directly
 * under `MobileTopBar`. The messages live in the store, so a layout switch keeps
 * them.
 *
 * One positioned flex column holds two `aria-live` regions as ordinary
 * in-flow (`contents`) children, always rendered empty or not so both exist
 * before their first message: `role="status"` (polite) for everything but
 * errors, `role="alert"` (assertive, its own region rather than nested
 * inside the polite one — nesting announced an error twice) for errors.
 * Both stay inside the one column rather than each getting its own
 * `absolute` layer, so an error and a pending snackbar never paint on top of
 * each other. Not the daisyUI `toast` class: that is `position: fixed` and
 * would ignore the slot.
 *
 * `useLiveStore`, not `useAppStore`: a `renderToString` test sets `feedback`
 * before rendering (.claude/rules/testing.md, R257).
 */
export const FeedbackHost = React.memo(function FeedbackHost({ edge }: { edge: 'top' | 'bottom' }) {
  const entries = useLiveStore((s) => s.feedback);
  const runAction = useLiveStore((s) => s.runFeedbackAction);
  const errors = entries.filter((e) => e.tone === 'error');
  const rest = entries.filter((e) => e.tone !== 'error');
  return (
    <div className="relative z-55 h-0 shrink-0">
      {/*
       * One positioned flex column; the two live regions below are ordinary
       * in-flow children of it (`contents`: no box of their own), so every
       * entry — whichever region announces it — is a direct flex item of
       * this single column and none can paint over another (an error region
       * absolutely positioned a second time here once covered a pending
       * Undo snackbar's button).
       */}
      <div
        className={`absolute inset-x-0 ${EDGE_CLASS[edge]} flex items-center gap-1.5 px-3 pointer-events-none`}
      >
        <div id="feedback-host" role="status" aria-live="polite" className="contents">
          {rest.map((entry) => (
            <FeedbackItem key={feedbackEntryKey(entry)} entry={entry} onAction={runAction} />
          ))}
        </div>
        {/*
         * Errors get their own always-present assertive region instead of a
         * `role="alert"` nested inside the polite region above: nesting
         * announced an error twice — once for the alert's own insertion,
         * once for the polite region's content-changed mutation.
         */}
        <div id="feedback-host-errors" role="alert" aria-live="assertive" className="contents">
          {errors.map((entry) => (
            <FeedbackItem key={feedbackEntryKey(entry)} entry={entry} onAction={runAction} />
          ))}
        </div>
      </div>
    </div>
  );
});
