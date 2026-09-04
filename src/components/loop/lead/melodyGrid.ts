import { getScaleNotesInOctave, ROOTS } from '../../../utils/musicTheory';
import { MAX_STEPS_PER_BAR } from '../../../utils/meter';
import type { LeadMelodyView } from '../../../store/types';
import type { LeadNote } from '../../../audio/leadMelody';

/** Number of octaves the melody grid's window shows. Fixed at 2 (spec default). */
export const LEAD_WINDOW_OCTAVES = 2;

/** Fixed cell width in px — the playhead's translateX stride. */
export const LEAD_CELL_WIDTH = 20;

/**
 * The pitch rows of the melody grid, from HIGHEST (index 0) to LOWEST. In
 * scale-locked view rows are the active scale's notes across the window; in
 * chromatic view all 12 semitones across the window. `lowestOctave` is the
 * lowest octave shown (leadMelodyOctave); the window spans octaveCount octaves.
 */
export function leadPitchRows(
  view: LeadMelodyView,
  root: string,
  scaleType: string,
  lowestOctave: number,
  octaveCount: number,
): string[] {
  const rows: string[] = [];
  for (let oct = lowestOctave + octaveCount - 1; oct >= lowestOctave; oct--) {
    const notes =
      view === 'chromatic'
        ? (ROOTS as readonly string[]).map((pc) => `${pc}${oct}`)
        : getScaleNotesInOctave(root, scaleType, oct);
    for (let i = notes.length - 1; i >= 0; i--) {
      rows.push(notes[i]);
    }
  }
  return rows;
}

/**
 * The flat stored index for a (bar, stepInBar) column. The melody is stored at
 * MAX_STEPS_PER_BAR per bar, so this never depends on the active meter.
 */
export function leadStoredIndex(barIndex: number, stepInBar: number): number {
  return barIndex * MAX_STEPS_PER_BAR + stepInBar;
}

/**
 * True when `note` is a "black key" pitch class (sharp/flat). Used to shade
 * chromatic rows darker like a piano keyboard; applies to scale-locked rows
 * too when a scale degree is itself a sharp/flat (e.g. F# in G major).
 */
export function isBlackKey(note: string): boolean {
  const pitchClass = note.replace(/\d+$/, '');
  return pitchClass.includes('#') || pitchClass.includes('b');
}

/** True when `note`'s pitch class is the active tonic (`scaleRoot`). */
export function isRootNote(note: string, root: string): boolean {
  return note.replace(/\d+$/, '') === root;
}

/**
 * How one grid cell renders inside a note's span. A ONE-step note is a lone
 * 'start' — 'end' only appears when the span is longer than one cell — so the
 * renderer rounds a cell's right corners when its kind is 'end' OR when it is
 * 'start' and the next cell is neither 'body' nor 'end'.
 */
export type LeadCellKind = 'none' | 'start' | 'body' | 'end';

/**
 * One LeadCellKind per column for every visible pitch row, keyed by note
 * name, so the render is a map lookup rather than a per-cell backward search.
 * Computed in a single pass over the note data — walk each note once and
 * paint its span — so the cost stays linear in notes, not in cells.
 *
 * `columns` is the ACTIVE window (loopLength x stepsPerBar); a span running
 * past the last column is truncated, never wrapped, which matches invariant 2.
 */
export function leadCellKinds(
  melody: readonly LeadNote[][],
  rows: readonly string[],
  columns: number,
  stepsPerBar: number,
): Map<string, LeadCellKind[]> {
  const map = new Map<string, LeadCellKind[]>();
  for (const note of rows) {
    map.set(note, new Array<LeadCellKind>(columns).fill('none'));
  }
  for (let col = 0; col < columns; col++) {
    const barIndex = Math.floor(col / stepsPerBar);
    const row = melody[leadStoredIndex(barIndex, col - barIndex * stepsPerBar)];
    if (!row) continue;
    for (const n of row) {
      const kinds = map.get(n.note);
      if (!kinds) continue;
      const span = Math.min(Math.max(1, n.len), columns - col);
      for (let k = 0; k < span; k++) {
        kinds[col + k] = k === 0 ? 'start' : k === span - 1 ? 'end' : 'body';
      }
    }
  }
  return map;
}

/**
 * Which span a cell belongs to, resolved back to the span's STORED start
 * index — not the cell's own column — plus the span's length and whether
 * this cell renders the span's right-edge grab handle. Kept pure and out of
 * the per-cell render callback: that callback runs inside JSX and can never
 * be exercised without a DOM, so the keyboard handler's span-start
 * resolution (the thing that lets Shift+Arrow work from any cell of a span,
 * not just its first) would otherwise have zero coverage.
 *
 * `startCol` is returned alongside `spanStartIdx` because the caller needs
 * it for `maxLen = columns - startCol` (loop end only, never the next note's
 * position — invariant 1) when starting a drag.
 */
export function resolveLeadCellSpan(
  rowKinds: readonly LeadCellKind[],
  col: number,
  stepsPerBar: number,
  note: string,
  previewed: readonly LeadNote[][],
): { spanStartIdx: number; spanLen: number; endsSpan: boolean; startCol: number } {
  const kind = rowKinds[col] ?? 'none';
  const startCol = kind === 'none' ? -1 : rowKinds.lastIndexOf('start', col);
  const startBar = startCol < 0 ? 0 : Math.floor(startCol / stepsPerBar);
  const spanStartIdx =
    startCol < 0 ? -1 : leadStoredIndex(startBar, startCol - startBar * stepsPerBar);
  const spanLen =
    startCol < 0 ? 0 : (previewed[spanStartIdx]?.find((n) => n.note === note)?.len ?? 1);
  const nextKind = rowKinds[col + 1] ?? 'none';
  const endsSpan =
    kind === 'end' || (kind === 'start' && nextKind !== 'body' && nextKind !== 'end');
  return { spanStartIdx, spanLen, endsSpan, startCol };
}

/**
 * The drag arithmetic, kept pure and out of the pointer handlers: the gesture
 * itself can never be tested (renderToString has no DOM), so everything that
 * can be a function is one. `maxLen` derives from the loop end ONLY, never
 * from the next note's position, because extending swallows (invariant 1).
 */
export function leadResizeLen(
  startLen: number,
  dxPx: number,
  cellWidth: number,
  maxLen: number,
): number {
  const raw = startLen + Math.round(dxPx / cellWidth);
  return Math.min(Math.max(1, maxLen), Math.max(1, raw));
}

/**
 * The classes that turn a run of per-cell buttons into one continuous bar:
 * the start rounds its left corners, body and end drop their left border
 * (box-sizing is border-box, so the cell keeps its column width and the
 * background stays continuous), and the last cell of the span rounds its
 * right corners. A one-step note is a lone 'start', so it is also the end of
 * its span — hence the `next` argument.
 */
export function leadSpanClasses(kind: LeadCellKind, next: LeadCellKind): string {
  if (kind === 'none') return '';
  const parts = ['bg-primary text-primary-content'];
  // A seam between two cells of one note is TWO borders, not one: the left of
  // the later cell and the right of the earlier one. Dropping only the left
  // left a visible grid line down the middle of every long note.
  const continuesLeft = kind === 'body' || kind === 'end';
  const continuesRight = next === 'body' || next === 'end';
  parts.push(continuesLeft ? 'border-l-0' : 'rounded-l-xs');
  parts.push(continuesRight ? 'border-r-0' : 'rounded-r-xs');
  return parts.join(' ');
}

