import React from "react";
import { ChevronDown } from "lucide-react";

interface WordmarkProps {
  /** Hide the "Solna" text and show the logo mark only. */
  markOnly?: boolean;
  className?: string;
  /** Overridden by ProjectMenu, which names the control it wraps. */
  ariaLabel?: string;
  /** Show a dropdown chevron after the text — the ProjectMenu trigger's hint. */
  chevron?: boolean;
  /**
   * `interactive` (default true): false renders a static brand image — no
   * button role, no focus, no hover — for a frame where the mark is not the
   * project menu.
   */
  interactive?: boolean;
}

/** The 44px box both renderings share. */
const WORDMARK_BOX = 'inline-flex items-center gap-2 min-h-11 min-w-11 px-1.5';

/**
 * The brand wordmark, and — through ProjectMenu — the project menu's trigger.
 * Deliberately NOT a <button>: it is rendered inside daisyUI's `dropdown`,
 * whose open state is driven by `:focus-within`, and a nested button would
 * swallow the focus the dropdown needs.
 */
export function Wordmark({
  markOnly = false,
  className = "",
  ariaLabel,
  chevron = false,
  interactive = true,
}: WordmarkProps) {
  const content = (
    <>
      <img
        src="/assets/favicon.svg"
        alt=""
        className="h-8 w-8"
        draggable={false}
      />
      {!markOnly && (
        <span
          className="text-2xl font-normal text-primary leading-none"
          style={{ letterSpacing: "0.08em" }}
        >
          solna
        </span>
      )}
      {chevron && (
        <ChevronDown className="w-4 h-4 text-base-content/60" aria-hidden="true" />
      )}
    </>
  );

  // Two returns rather than one element with conditional `tabIndex`/`role`:
  // jsx-a11y reads the conditional as a tabIndex on a non-interactive element,
  // and the static brand image genuinely has neither focus nor a button role.
  if (!interactive) {
    return (
      <span
        role="img"
        aria-label="Solna"
        className={`${WORDMARK_BOX} ${className}`}
      >
        {content}
      </span>
    );
  }

  return (
    <span
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      className={`${WORDMARK_BOX} rounded-box cursor-pointer transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      {content}
    </span>
  );
}
