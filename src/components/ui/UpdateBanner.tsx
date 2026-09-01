import React from "react";
import { RefreshCw, X } from "lucide-react";

interface UpdateBannerProps {
  /** Whether a newer version is installed and waiting for the page to yield. */
  open: boolean;
  /** Takes the waiting version. Reloads the page, so playback stops. */
  onReload: () => void;
  /** Hides the banner; the update still applies on the next cold start. */
  onDismiss: () => void;
}

/**
 * The "a new version is ready" prompt.
 *
 * Presentational and fully controlled — `useServiceWorkerUpdate` owns the
 * service-worker state — so this renders under `renderToString` with no DOM
 * and no worker.
 *
 * Sits above the transport bar rather than over it, and says out loud that
 * reloading stops the sound: the whole reason this app prompts instead of
 * updating itself is that a silent reload would cut a loop off mid-bar.
 */
export const UpdateBanner: React.FC<UpdateBannerProps> = ({
  open,
  onReload,
  onDismiss,
}) => {
  if (!open) return null;

  return (
    <div
      id="banner-update-ready"
      role="status"
      className="shrink-0 flex items-center gap-2 px-2 sm:px-3 py-1.5 bg-base-200 border-t border-primary/40 text-xs select-none"
    >
      <RefreshCw className="w-3.5 h-3.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-bold">New version ready.</span>{' '}
        <span className="text-base-content/60">Reloading stops playback.</span>
      </div>
      <button
        id="btn-apply-update"
        type="button"
        onClick={onReload}
        className="btn btn-xs btn-primary font-bold shrink-0"
      >
        Reload
      </button>
      <button
        id="btn-dismiss-update"
        type="button"
        onClick={onDismiss}
        className="btn btn-xs btn-square btn-ghost shrink-0"
        aria-label="Dismiss update notice"
        title="Later — the update applies next time you open solna"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
