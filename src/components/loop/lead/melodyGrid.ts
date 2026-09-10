import { getScaleNotesInOctave, isNoteInScale, ROOTS, stepDurationSec } from '@/utils/musicTheory';
import { spellNoteInKey } from '@/utils/noteSpelling';
import type { LeadMelodyView } from '@/store/types';
import { leadStoredIndexAt, type LeadNote } from '@/audio/leadMelody';
import { wrapColumn } from '@/audio/leadLiveRecord';
import {
  TICKS_PER_SIXTEENTH,
  clampColumn,
  columnsPerBar,
  leadNoteCells,
} from '@/utils/stepResolution';
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
  borrowedNotes?: ReadonlySet<string>,
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
  // Chromatic already draws all twelve, so a borrowed row is a scale-locked
  // concept only and passing a set there is a no-op rather than an error.
  if (view === 'chromatic' || !borrowedNotes?.size) return rows;
  return mergeBorrowedRows(rows, borrowedNotes);
}

/**
 * A row name's absolute semitone: the key the merged list sorts by, and the
 * measure a borrowed row is bounded against. Rows are ROOTS-spelled by
 * contract (see leadRowLabel), so the pitch class is a plain ROOTS index;
 * anything that is not parses to NaN and is dropped rather than sorted to an
 * arbitrary position.
 */
function noteSemitone(note: string): number {
  const match = /^([A-G]#?)(-?\d+)$/.exec(note);
  if (!match) return Number.NaN;
  const pitchClass = (ROOTS as readonly string[]).indexOf(match[1]);
  return pitchClass < 0 ? Number.NaN : pitchClass + Number(match[2]) * 12;
}

/**
 * Scale rows plus the out-of-scale notes that are actually drawn, ordered
 * highest first.
 *
 * The window a borrowed row must fall inside is **the span the scale rows
 * cover**, not the octave suffix: a scale's degrees spill into the next octave
 * label (D major at octave 4 runs D4..C#5), so bounding by suffix would admit
 * a C4 that sits below the grid's own lowest row and place it above one.
 *
 * The whole list is re-sorted by semitone rather than each note being spliced
 * into its octave band. That is not a behaviour change for the base list: the
 * bands the loop above concatenates are already globally descending, because a
 * band's top sits at most eleven semitones above its root and the next band's
 * root is twelve below.
 */
function mergeBorrowedRows(rows: readonly string[], borrowed: ReadonlySet<string>): string[] {
  if (!rows.length) return [...rows];
  const highest = noteSemitone(rows[0]);
  const lowest = noteSemitone(rows[rows.length - 1]);
  const seen = new Set(rows);
  const merged = [...rows];
  for (const note of borrowed) {
    if (seen.has(note)) continue;
    const semitone = noteSemitone(note);
    if (!(semitone >= lowest && semitone <= highest)) continue;
    seen.add(note);
    merged.push(note);
  }
  if (merged.length === rows.length) return merged;
  return merged.sort((a, b) => noteSemitone(b) - noteSemitone(a));
}

/**
 * The LABEL for a pitch row — and only the label.
 *
 * `leadPitchRows` returns identities: LeadMelodyGrid uses those exact strings
 * as `kinds.get(note)` map keys, as `previewNote(note)` arguments, and as the
 * values written into `LeadNote.note`, which is persisted. `isRootNote`
 * compares them against a sharp ROOTS value, so a flat row name also loses the
 * tonic highlight. Spelling therefore lands here and nowhere else.
 *
 * Chromatic rows stay sharp: the chromatic view is a key-agnostic ladder of
 * twelve semitones, not a reading of the key.
 */
export function leadRowLabel(
  note: string,
  view: LeadMelodyView,
  root: string,
  scaleType: string,
): string {
  return view === 'chromatic' ? note : spellNoteInKey(note, root, scaleType);
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

/**
 * One flag per row: does the active scale contain this row's pitch class?
 *
 * Answered for the whole list at once, and by the grid's PARENT, because both
 * things that read it — the note-name column and the cell grid — need the same
 * answer and `isNoteInScale` builds a tonal note behind each call. Per cell it
 * would be rows x columns calls for at most one answer per row.
 *
 * It is a question about the row, not about the view: in chromatic view it
 * flags the semitones the key leaves out, and in scale-locked view it flags
 * exactly the borrowed rows leadPitchRows merged in.
 */
export function leadOutOfScaleRows(
  rows: readonly string[],
  root: string,
  scaleType: string,
): boolean[] {
  return rows.map((note) => !isNoteInScale(note, root, scaleType));
}

/**
 * The colour half of a row label's classes. A borrowed row names the same
 * accent role its notes are drawn in (leadSpanClasses), so the label and the
 * cells state the same thing — the row is outside the key.
 */
export function leadRowLabelTone(outOfScale: boolean): string {
  return outOfScale
    ? 'text-accent/80 hover:text-accent'
    : 'text-base-content/60 hover:text-base-content';
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

// How many CELLS a tick-counted note draws. Declared in utils/stepResolution
// so audio/ can round holdSec with the SAME expression the renderer measures
// the span with — what sounds must be what is drawn, and a rule kept in two
// expressions agreeing by comment is how a note comes to show two cells while
// sounding for five ticks. Re-exported here because this is where the grid
// reaches for it.
export { leadNoteCells };

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
 * The set of note names a window actually DRAWS — the same walk leadCellKinds
 * makes, answering the question one step earlier: which rows must exist.
 *
 * It shares that walk's coordinate space on purpose. A note the resolution
 * cannot reach or one past the last column is dormant, never looked up and
 * never drawn, so it must not conjure a borrowed row either: an empty row
 * whose note is invisible reads as a bug, not as preservation.
 */
export function leadNotesInWindow(
  melody: readonly LeadNote[][],
  columns: number,
  stepsPerBar: number,
  stride: number,
): Set<string> {
  const notes = new Set<string>();
  for (let col = 0; col < columns; col++) {
    const row = melody[leadStoredIndexAt(col, stepsPerBar, stride)];
    if (!row) continue;
    for (const n of row) notes.add(n.note);
  }
  return notes;
}

/**
 * Whether this cell draws the span's right-edge grab handle. A one-cell note
 * is a lone 'start', so it ends its own span — hence the `next` argument, the
 * same one leadSpanClasses needs. Its own function because the renderer
 * answers it for EVERY cell from the two kinds it already has, while
 * resolveLeadCellSpan answers it as a by-product of a much more expensive
 * lookup; one definition, so the two can never drift apart.
 */
export function leadCellEndsSpan(kind: LeadCellKind, next: LeadCellKind): boolean {
  return kind === 'end' || (kind === 'start' && next !== 'body' && next !== 'end');
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
 *
 * This walks BACKWARD from `col` and searches the stored row, so it is the
 * one thing leadCellKinds' single pass exists to keep out of the per-cell
 * render path: call it lazily, from the gesture handlers that read it, never
 * once per drawn cell.
 */
export function resolveLeadCellSpan(
  rowKinds: readonly LeadCellKind[],
  col: number,
  stepsPerBar: number,
  stride: number,
  note: string,
  previewed: readonly LeadNote[][],
): { spanStartIdx: number; spanCells: number; endsSpan: boolean; startCol: number } {
  const kind = rowKinds[col] ?? 'none';
  const startCol = kind === 'none' ? -1 : rowKinds.lastIndexOf('start', col);
  const spanStartIdx = startCol < 0 ? -1 : leadStoredIndexAt(startCol, stepsPerBar, stride);
  // TICKS — what a length IS. Only ever leaves here as a CELL count, which is
  // what the drag handle and the keyboard step both count in.
  const spanLen =
    startCol < 0 ? 0 : (previewed[spanStartIdx]?.find((n) => n.note === note)?.len ?? stride);
  return {
    spanStartIdx,
    spanCells: leadNoteCells(spanLen, stride),
    endsSpan: leadCellEndsSpan(kind, rowKinds[col + 1] ?? 'none'),
    startCol,
  };
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
export function leadSpanClasses(
  kind: LeadCellKind,
  next: LeadCellKind,
  outOfScale = false,
): string {
  if (kind === 'none') return '';
  const parts = [
    outOfScale ? 'bg-accent text-accent-content' : 'bg-primary text-primary-content',
  ];
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
  return clampColumn(next, columns);
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
  return clampColumn(cursor, columns);
}

/**
 * How long a melody-grid preview holds, in seconds.
 *
 * Two lengths, both musical, replacing the fixed 0.22 s gate this grid used to
 * pass: that constant was silent for any patch whose attack exceeded it, so the
 * only way to pick a safe value was to measure it against the slowest patch in
 * the library — a hidden dependency on the preset table, re-broken by every
 * preset added. Measured, before this: the 1.2 s attack of the riser four of
 * the eight vibes put on the FX track was still around -67 dBFS when note-off
 * cancelled it, so that grid's first note made no sound at all and nothing on
 * screen explained why. Every vibe hands FX a patch slower than 0.22 s, so
 * that was the common case, not an edge one.
 *
 * - No `lenTicks` — a ROW-LABEL preview, which asks "what pitch is this row"
 *   and nothing more. One beat, `60 / bpm`, i.e. four 16ths: the shortest
 *   length that is a musical unit rather than an arbitrary one, and one that
 *   gets longer at slower tempos, which is the direction that helps.
 * - With `lenTicks` — a CELL's own length, rounded to whole cells through the
 *   active stride by leadNoteCells. That is the same expression the scheduler's
 *   holdSec and the renderer's span already share, so a preview lasts exactly
 *   what the grid draws and what playback will sound.
 *
 * This does not make every patch audible at every tempo, and is not meant to: a
 * 1.2 s attack still only reaches part-way through a 0.43 s beat at 140 BPM.
 * The point is that the length is a stated musical rule a reader can predict
 * rather than a constant that happened to work for the patches someone tried.
 *
 * A bpm that is not a positive finite number would make `60 / bpm` Infinity or
 * NaN, and a note-off scheduled at Infinity never fires — a drone on the
 * preview bus that the returned handle cannot cut either, since it stops the
 * source rather than the schedule. Store bpm is sanitized, so this answers 0
 * instead of throwing: a preview that does not sound is a bug a user can
 * report, a preview that never stops is one they cannot escape.
 */
export function leadPreviewHoldSec(bpm: number, stride: number, lenTicks?: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 0;
  const sixteenthSec = stepDurationSec(bpm);
  if (lenTicks === undefined) return 4 * sixteenthSec;
  return leadNoteCells(lenTicks, stride) * stride * (sixteenthSec / TICKS_PER_SIXTEENTH);
}
