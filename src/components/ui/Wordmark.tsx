import React from "react";
import { ChevronDown } from "lucide-react";

interface WordmarkProps {
  /** Hide the "Solna" text and show the logo mark only. */
  markOnly?: boolean;
  className?: string;
  /**
   * Extra classes on the wordmark TEXT only. `markOnly` drops the text from the
   * DOM outright, which a media query cannot undo — this is the hook a caller
   * uses to hide it at one width and show it at another (the navbar passes
   * `hidden sm:inline`, which is what keeps its phone layout down to two rows).
   */
  textClassName?: string;
  /** Overridden by ProjectMenu, which names the control it wraps. */
  ariaLabel?: string;
  /** Show a dropdown chevron after the text — the ProjectMenu trigger's hint. */
  chevron?: boolean;
}

/**
 * The brand wordmark, and — through ProjectMenu — the project menu's trigger.
 * Deliberately NOT a <button>: it is rendered inside daisyUI's `dropdown`,
 * whose open state is driven by `:focus-within`, and a nested button would
 * swallow the focus the dropdown needs.
 */
export function Wordmark({
  markOnly = false,
  className = "",
  textClassName = "",
  ariaLabel,
  chevron = false,
}: WordmarkProps) {
  return (
    <span
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-2 min-h-11 min-w-11 px-1.5 rounded-box cursor-pointer transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      <img
        src="/assets/favicon.svg"
        alt=""
        className="h-8 w-8"
        draggable={false}
      />
      {!markOnly && (
        <span
          className={`text-2xl font-normal text-primary leading-none ${textClassName}`}
          style={{ letterSpacing: "0.08em" }}
        >
          solna
        </span>
      )}
      {chevron && (
        <ChevronDown className="w-4 h-4 text-base-content/60" aria-hidden="true" />
      )}
    </span>
  );
}
