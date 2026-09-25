import { cx } from './cx';

interface WordmarkProps {
  /** Opens the app modal (R348). */
  onClick: () => void;
  /** Hide the "Solna" text and show the logo mark only. */
  markOnly?: boolean;
}

/**
 * The brand wordmark: a real <button> that opens the app modal (Settings |
 * About) on both frames (R348). It is no longer a dropdown trigger — the
 * project menu has its own chevron beside it — so a click is all it needs,
 * and Safari's refusal to focus a tapped button does not matter here.
 */
export function Wordmark({ onClick, markOnly = false }: WordmarkProps) {
  return (
    <button
      id="btn-app-modal"
      type="button"
      aria-label="Solna — settings and about"
      aria-haspopup="dialog"
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-2 min-h-11 min-w-11 px-1.5',
        'rounded-box cursor-pointer transition-colors hover:bg-base-200',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
      )}
    >
      {/* `loading="lazy"` isn't about viewport lazy-loading here (the mark is
          always above the fold) — it opts the image out of React 19's
          automatic `<link rel="preload">` resource hint, which would
          otherwise prepend a sibling tag before this button in server markup. */}
      <img src="/assets/favicon.svg" alt="" className="h-8 w-8" draggable={false} loading="lazy" />
      {!markOnly && (
        <span className="text-2xl font-normal text-primary leading-none" style={{ letterSpacing: '0.08em' }}>
          solna
        </span>
      )}
    </button>
  );
}
