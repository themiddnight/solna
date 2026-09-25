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
      <img src="/assets/favicon.svg" alt="" className="h-8 w-8" draggable={false} />
      {!markOnly && (
        <span className="text-2xl font-normal text-primary leading-none" style={{ letterSpacing: '0.08em' }}>
          solna
        </span>
      )}
    </button>
  );
}
