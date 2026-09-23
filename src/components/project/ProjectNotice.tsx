import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useLiveStore } from '../ui/useLiveStore';

/**
 * The persistent banner for `projectNotice` (R329, §5.6 split): a storage
 * problem the app cannot resolve on its own — an unavailable IndexedDB/
 * localStorage backend, a write that hit quota, or a `.solna` opened with
 * unrecognised references. Every one-shot result of a user's own action
 * (a parse failure, a Drive error, an export outcome) is a toast through
 * `showFeedback` instead; this banner is for what nothing the user does next
 * makes go away on its own — the next content change or autosave retries it.
 *
 * In flow beside `UpdateBanner` (`ShellBody`), never floating: unlike a toast
 * it needs no auto-dismiss timer, because a stuck storage backend does not
 * fix itself in a few seconds. Dismissing clears the store field; the notice
 * is session-only and never persisted.
 *
 * Reads the store through `useLiveStore`: under `renderToString` a plain
 * `useAppStore` selector would serve the store's creation-time value and the
 * notice would be untestable (and, worse, invisible for the whole first render
 * of a session that booted with a message already set).
 */
export function ProjectNotice() {
  const notice = useLiveStore((s) => s.projectNotice);
  const setProjectNotice = useLiveStore((s) => s.setProjectNotice);
  if (notice === null) return null;

  return (
    <div
      id="project-notice"
      role="status"
      className="shrink-0 flex items-center gap-2 px-2 sm:px-3 py-1.5 bg-base-200 border-t border-warning/40 text-xs select-none"
    >
      <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0">{notice}</span>
      <button
        id="btn-dismiss-project-notice"
        type="button"
        onClick={() => setProjectNotice(null)}
        className="btn btn-xs btn-square btn-ghost shrink-0"
        aria-label="Dismiss project notice"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
