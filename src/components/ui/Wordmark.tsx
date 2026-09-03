import React from "react";

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
  /** Opens the Project Manager. The wordmark is the feature's only entry point. */
  onClick?: () => void;
  /** Unsaved changes: shows the corner dot on the mark. */
  dirty?: boolean;
}

/**
 * Brand wordmark AND the Project Manager button. A real <button> so keyboard
 * focus, Enter/Space and screen-reader semantics come for free. The mark image
 * stays 32px; the 44px tap target comes from the button's min size — below
 * `sm` the text is hidden and this is the whole target, so it is a
 * requirement, not polish. Typography mirrors murva's Wordmark.
 */
export const Wordmark: React.FC<WordmarkProps> = ({
  markOnly = false,
  className = "",
  textClassName = "",
  onClick,
  dirty = false,
}) => {
  return (
    <button
      type="button"
      aria-label="Open Project Manager"
      onClick={onClick}
      className={`inline-flex items-center gap-2 min-h-11 min-w-11 px-1.5 rounded-box cursor-pointer transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      <span className="indicator">
        {dirty && (
          <span
            role="status"
            aria-label="Unsaved changes"
            className="indicator-item status status-warning status-sm"
          />
        )}
        <img
          src="/assets/favicon.svg"
          alt=""
          className="h-8 w-8"
          draggable={false}
        />
      </span>
      {!markOnly && (
        <span
          className={`text-2xl font-normal text-primary leading-none ${textClassName}`}
          style={{ letterSpacing: "0.08em" }}
        >
          solna
        </span>
      )}
    </button>
  );
};
