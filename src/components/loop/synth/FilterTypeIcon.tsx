import type { FilterType } from '@/types/synth';

/**
 * The four filter responses, drawn as the curve each one applies.
 *
 * Both halves of the naming are deliberate and the accessible name carries
 * BOTH: the SHORT code (LP/BP/HP/Notch) is the vocabulary the panel has always
 * shown and stays visible under the icon, and the words after it say what the
 * code means. A screen-reader user hearing "L P" alone would be guessing at an
 * abbreviation; a sighted user reading "Low-pass filter" four times in a 4-up
 * grid loses the row to text; and a name that REPLACED the code with the words
 * would break WCAG 2.5.3 (Label in Name), because a speech-input user saying
 * "L P" would not reach a button whose name never mentions it.
 */
export const FILTER_TYPE_LABELS: Record<FilterType, string> = {
  lowpass: 'LP, low-pass filter',
  bandpass: 'BP, band-pass filter',
  highpass: 'HP, high-pass filter',
  notch: 'Notch filter',
};

/** The code shown on the button itself. */
export const FILTER_TYPE_CODES: Record<FilterType, string> = {
  lowpass: 'LP',
  bandpass: 'BP',
  highpass: 'HP',
  notch: 'Notch',
};

/** The roster, in the approved prototype's order. */
export const FILTER_TYPES: readonly FilterType[] = ['lowpass', 'bandpass', 'highpass', 'notch'];

/** The response curve per type, on a 34x16 viewBox. */
const FILTER_PATHS: Record<FilterType, string> = {
  lowpass: 'M2 4 H13 C18 4 18 13 31 13',
  bandpass: 'M2 13 C8 13 9 4 17 4 C25 4 26 13 32 13',
  highpass: 'M2 13 C15 13 15 4 21 4 H32',
  notch: 'M2 4 H11 L17 13 L23 4 H32',
};

/** Decorative: the button around it carries the name (see `FilterTypeIcon`'s note). */
export function FilterTypeIcon({ type }: { type: FilterType }) {
  return (
    <svg
      viewBox="0 0 34 16"
      aria-hidden="true"
      className="w-7 h-3.5 overflow-visible fill-none stroke-current"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    >
      <path d={FILTER_PATHS[type]} />
    </svg>
  );
}
