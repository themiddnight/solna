import { getScaleNotesInOctave, ROOTS } from '../../../utils/musicTheory';
import type { LeadMelodyView } from '../../../store/types';
import { leadStoredIndexAt, type LeadNote } from '../../../audio/leadMelody';
import { wrapColumn } from '@/audio/leadLiveRecord';
import { TICKS_PER_SIXTEENTH, columnsPerBar } from '@/utils/stepResolution';
import { beatIndexAt, isBeatBoundary, type Meter } from '@/utils/meter';
import type { StepCell } from '@/components/sequencerGrid';

// Declared in audio/leadStepRecord so the store can read it as well: step
// entry follows the window when a recorded note falls outside it, and
// store/ may not import components/.
export { LEAD_WINDOW_OCTAVES } from '@/audio/leadStepRecord';

/** Fixed cell width in px — the marker's translateX stride. */
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
 * How many CELLS a tick-counted note draws. The same expression
 * resolveLeadStepTriggers rounds holdSec with, deliberately: what sounds
 * must be what is drawn, or a note that showed as two cells while sounding
 * for five ticks reintroduces exactly the invisible state that silent
 * dormancy was chosen to avoid.
 */
export function leadNoteCells(len: number, stride: number): number {
  const cell = stride > 0 ? stride : 1;
  return Math.max(1, Math.ceil(len / cell));
}

/**
 * One header descriptor per COLUMN rather than per 16th. `stepCells` in
 * sequencerGrid.ts answers the same question for a grid whose column IS a
 * 16th, which the lead's no longer is; the accent grouping still comes from
 * the meter, so a beat starts on the column whose tick starts an accent
 * group and nowhere else.
 */
export function leadColumnCells(meter: Meter, stride: number): StepCell[] {
  const cells: StepCell[] = [];
  const columns = columnsPerBar(meter.stepsPerBar, stride);
  for (let index = 0; index < columns; index++) {
    const tick = index * stride;
    const sixteenth = Math.floor(tick / TICKS_PER_SIXTEENTH);
    const onSixteenth = tick % TICKS_PER_SIXTEENTH === 0;
    const beatIndex = beatIndexAt(sixteenth, meter.accentGroups);
    cells.push({
      index,
      label: index + 1,
      isBeatStart: onSixteenth && isBeatBoundary(sixteenth, meter.accentGroups),
      beatIndex,
      isAltBeatGroup: beatIndex % 2 === 0,
    });
  }
  return cells;
}

/**
 * One LeadCellKind per column for every visible pitch row, keyed by note
 * name, so the render is a map lookup rather than a per-cell backward search.
 * Computed in a single pass over the note data — walk each note once and
 * paint its span — so the cost stays linear in notes, not in cells.
 *
 * `columns` is the ACTIVE window (loopLength x columnsPerBar); a span
 * running past the last column is truncated, never wrapped, which matches
 * invariant 2. A note the current resolution cannot reach is never looked
 * up, so it draws nothing — dormant, not lost.
 */
export function leadCellKinds(
  melody: readonly LeadNote[][],
  rows: readonly string[],
  columns: number,
  stepsPerBar: number,
  stride: number,
): Map<string, LeadCellKind[]> {
  const map = new Map<string, LeadCellKind[]>();
  for (const note of rows) {
    map.set(note, new Array<LeadCellKind>(columns).fill('none'));
  }
  for (let col = 0; col < columns; col++) {
    const row = melody[leadStoredIndexAt(col, stepsPerBar, stride)];
    if (!row) continue;
    for (const n of row) {
      const kinds = map.get(n.note);
      if (!kinds) continue;
      const span = Math.min(leadNoteCells(n.len, stride), columns - col);
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
  stride: number,
  note: string,
  previewed: readonly LeadNote[][],
): { spanStartIdx: number; spanLen: number; spanCells: number; endsSpan: boolean; startCol: number } {
  const kind = rowKinds[col] ?? 'none';
  const startCol = kind === 'none' ? -1 : rowKinds.lastIndexOf('start', col);
  const spanStartIdx = startCol < 0 ? -1 : leadStoredIndexAt(startCol, stepsPerBar, stride);
  const spanLen =
    startCol < 0 ? 0 : (previewed[spanStartIdx]?.find((n) => n.note === note)?.len ?? stride);
  const nextKind = rowKinds[col + 1] ?? 'none';
  const endsSpan =
    kind === 'end' || (kind === 'start' && nextKind !== 'body' && nextKind !== 'end');
  // Both units, because the caller needs both: the drag handle counts
  // CELLS, and the write it eventually makes counts TICKS.
  return { spanStartIdx, spanLen, spanCells: leadNoteCells(spanLen, stride), endsSpan, startCol };
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


/**
 * Where an arrow key moves the selection cursor, or null when the key is not
 * one this widget handles. Shift jumps a whole bar. A jump that overshoots
 * lands on the edge rather than being refused — refusing would make the last
 * partial bar unreachable by keyboard.
 *
 * Every number here is a COLUMN: `col`, `colsPerBar` and `columns` all live
 * in the active window's coordinate space, never in 16ths. The two only
 * coincide at 1/16, which is why this parameter is not called stepsPerBar —
 * at 1/8 a 4/4 bar is eight columns, and a shift jump of sixteen would
 * cross two bars.
 */
export function leadCursorKeyTarget(
  col: number,
  key: string,
  shiftKey: boolean,
  colsPerBar: number,
  columns: number,
): number | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const jump = shiftKey ? colsPerBar : 1;
  const next = col + (key === 'ArrowRight' ? jump : -jump);
  return Math.min(columns - 1, Math.max(0, next));
}

/**
 * The one column the grid marks: the clock while playing, the cursor while
 * stopped. Kept as a pure function of both sources rather than as one stored
 * value, because the running step lives outside zustand on purpose — holding
 * it in React state re-rendered whole views 8-16 times a second, including
 * views on hidden tabs (see the note at the top of components/playbackStep.ts),
 * and writing it into leadCursor would add the persist serialiser to that.
 */
export function leadMarkerColumn(
  isPlaying: boolean,
  currentStep: number,
  cursor: number,
  columns: number,
): number {
  // Playing, the source is a column the publisher already converted through
  // clockStepToGridColumn (the ONE named conversion). Converting it a
  // second time here would multiply by the stride twice; it only needs the
  // wrap, which is why that wrap has its own name.
  if (isPlaying) return wrapColumn(currentStep, columns);
  // Stopped, the source is the user-placed cursor, not a clock quantity, so
  // it clamps to the visible edge rather than wrapping — landing on column 0
  // via modulo would look like the user chose column 0, which they didn't.
  if (!Number.isFinite(cursor)) return 0;
  return Math.min(Math.max(0, columns - 1), Math.max(0, Math.round(cursor)));
}
