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
      role={entry.tone === 'error' ? 'alert' : undefined}
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
 * Always rendered, empty or not, so the `aria-live` region exists before its
 * first message and screen readers announce it. Not the daisyUI `toast` class:
 * that is `position: fixed` and would ignore the slot.
 *
 * `useLiveStore`, not `useAppStore`: a `renderToString` test sets `feedback`
 * before rendering (.claude/rules/testing.md, R257).
 */
export const FeedbackHost = React.memo(function FeedbackHost({ edge }: { edge: 'top' | 'bottom' }) {
  const entries = useLiveStore((s) => s.feedback);
  const runAction = useLiveStore((s) => s.runFeedbackAction);
  return (
    <div className="relative z-55 h-0 shrink-0">
      <div
        id="feedback-host"
        role="status"
        aria-live="polite"
        className={`absolute inset-x-0 ${EDGE_CLASS[edge]} flex items-center gap-1.5 px-3 pointer-events-none`}
      >
        {entries.map((entry) => (
          <FeedbackItem key={entry.key} entry={entry} onAction={runAction} />
        ))}
      </div>
    </div>
  );
});
