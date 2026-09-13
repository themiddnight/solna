import type { BassStepChoice } from '@/data/bassPatterns';

/**
 * The bass editor's vocabulary: which interval a click writes.
 *
 * A TOOL is not a stored value — `'erase'` is the gesture that clears a step,
 * and the lane stores `'rest'` for it. `bassToolValue` is that translation and
 * the only place it happens, so the palette, the click handler and the test
 * that pins them all read one answer.
 *
 * The click CYCLE this replaced (rest → root → third → … on repeated clicks)
 * is gone deliberately: with spans, one click no longer means "the next value",
 * and walking a cycle made the interval a cell lands on depend on how many
 * times it had already been clicked.
 */
export type BassPatternTool = 'root' | 'third' | 'fifth' | 'seventh' | 'octave' | 'erase';

/** The stored value a tool writes. Erase writes the lane's own empty value. */
export function bassToolValue(tool: BassPatternTool): BassStepChoice {
  return tool === 'erase' ? 'rest' : tool;
}

/** One button of the note toolbar: the tool, its visible letter, its full name. */
export interface BassToolChoice {
  tool: BassPatternTool;
  /** The button's face — "R", "3", "Erase". */
  label: string;
  /** The tool named in full, for the accessible label and the tooltip. */
  name: string;
}

/**
 * The palette, in the order it renders — the intervals of a chord under the
 * root, then the gesture that clears the step. One table because the labels and
 * the names must not be able to disagree: `label` is what a span head shows for
 * the very same note (`bassStepLabel`), and `name` is what a screen reader
 * reads off the button.
 */
export const BASS_TOOLS: readonly BassToolChoice[] = [
  { tool: 'root', label: 'R', name: 'Root' },
  { tool: 'third', label: '3', name: 'Third' },
  { tool: 'fifth', label: '5', name: 'Fifth' },
  { tool: 'seventh', label: '7', name: 'Seventh' },
  { tool: 'octave', label: '8', name: 'Octave' },
  { tool: 'erase', label: 'Erase', name: 'Erase note' },
];

/**
 * The short label shown on an active bass span for a STORED choice — the
 * palette's own letters, and exhaustive over the choices the lane can hold: no
 * default branch, so a new `BassStepChoice` fails the type check here rather
 * than drawing a blank block.
 */
export function bassStepLabel(choice: BassStepChoice): string {
  switch (choice) {
    case 'root': return 'R';
    case 'third': return '3';
    case 'fifth': return '5';
    case 'seventh': return '7';
    case 'octave': return '8';
    case 'rest': return '';
  }
}
