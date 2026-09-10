import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useLiveStore } from '../ui/useLiveStore';

/**
 * The only surface for `projectNotice` — the spec's "the notice is the only
 * signal" for a malformed `.solna`, a download that could not be written, a
 * store that is unavailable, and an autosave that failed. The project manager's
 * modal used to be that surface; it is gone, so this is it.
 *
 * Reads the store through `useLiveStore`: under `renderToString` a plain
 * `useAppStore` selector would serve the store's creation-time value and the
 * notice would be untestable (and, worse, invisible for the whole first render
 * of a session that booted with a message already set).
 *
 * A toast, not a dialog: every message it carries is informational and nothing
 * it reports can be resolved by a click — an unavailable store and a failed
 * autosave both re-attempt on the next content change, not on a confirmation —
 * so it must never block the keys or the transport, which is exactly why the
 * old `confirm()`-style alert was replaced in the first place. Dismissing
 * clears the store field; the notice is session-only state and is never
 * persisted.
 */
export function ProjectNotice() {
  const notice = useLiveStore((s) => s.projectNotice);
  const setProjectNotice = useLiveStore((s) => s.setProjectNotice);
  if (notice === null) return null;

  return (
    <div
      id="project-notice"
      role="status"
      className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 w-max max-w-[92vw] alert alert-info shadow-lg text-sm select-none"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{notice}</span>
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
