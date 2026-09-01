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
}

/**
 * Brand wordmark — the Solna sunrise mark paired with the "Solna" wordmark
 * text. Typography (font-normal weight, wide tracking, primary color) mirrors
 * murva's Wordmark, since Solna is murva's sibling app and shares its font
 * stack (Figtree/Anuphan) — sized down from murva's text-2xl/3xl to fit
 * Solna's compact navbar instead of growing it.
 */
export const Wordmark: React.FC<WordmarkProps> = ({
  markOnly = false,
  className = "",
  textClassName = "",
}) => {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img
        src="/assets/favicon.svg"
        alt="Solna logo"
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
    </span>
  );
};
