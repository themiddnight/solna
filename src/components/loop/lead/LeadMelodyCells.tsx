import React, { useCallback, useMemo } from 'react';
import { leadStoredIndexAt, type LeadNote } from '@/audio/leadMelody';
import type { StepCell } from '@/components/sequencerGrid';
import type { Meter } from '@/utils/meter';
import type { MelodyTrackId } from '@/store/melodyTracks';
import {
  LEAD_CELL_WIDTH,
  isBlackKey,
  isRootNote,
  leadCellEndsSpan,
  leadCellKinds,
  leadSpanClasses,
  resolveLeadCellSpan,
  type LeadCellKind,
} from './melodyGrid';
import { useLeadNoteResize } from './useLeadNoteResize';
import { leadClickShouldPreview } from './leadPaint';
import { useLeadNotePaint } from './useLeadNotePaint';

/** One row's kinds, as leadCellKinds returns them per pitch. */
type LeadRowKinds = readonly LeadCellKind[];

type LeadCellSpan = ReturnType<typeof resolveLeadCellSpan>;

type LeadCellPaint = ReturnType<typeof useLeadCellPaint>;

interface LeadMelodyCellsProps {
  trackId: MelodyTrackId;
  meter: Meter;
  loopLength: number;
  melody: readonly LeadNote[][];
  rows: readonly string[];
  rowLabels: readonly string[];
  outOfScale: readonly boolean[];
  root: string;
  onResize: (stepIndex: number, note: string, len: number) => void;
  stride: number;
  colsPerBar: number;
  cellsPerBar: StepCell[];
  /**
   * Audition a note the user just drew with the keyboard. Required, with no
   * default: a default would make a call site that forgot the prop render a
   * grid that draws correctly and never makes a sound — internally consistent,
   * visually plausible, and caught by no test.
   */
  onPreview: (note: string, lenTicks: number) => void;
}

/**
 * The paint controller and the two matrices derived from it, so the memoized
 * cell grid reads one answer instead of deriving its own.
 */
function useLeadCellPaint(
  trackId: MelodyTrackId,
  grid: Pick<LeadMelodyCellsProps, 'melody' | 'rows' | 'stride'> & {
    columns: number;
    stepsPerBar: number;
  },
) {
  const { melody, rows, columns, stepsPerBar, stride } = grid;
  const { preview, startResize } = useLeadNoteResize(trackId);
  // Column → stored index. Stored indices are bar-major at MAX_STEPS_PER_BAR,
  // so this is not the identity and a skipped-cell fill must go through it.
  const resolveStepIndex = useCallback(
    (col: number) => leadStoredIndexAt(col, stepsPerBar, stride),
    [stepsPerBar, stride],
  );
  const controller = useLeadNotePaint(trackId, resolveStepIndex);
  // The drag preview is applied here, in local render state — the store is
  // written once, on pointerup (see useLeadNoteResize).
  const previewed = useMemo(() => {
    if (!preview) return melody;
    return melody.map((row, i) =>
      i === preview.stepIndex
        ? row.map((n) => (n.note === preview.note ? { note: n.note, len: preview.len } : n))
        : row,
    );
  }, [melody, preview]);
  // One pass over the notes, not a per-cell backward search.
  const kinds = useMemo(
    () => leadCellKinds(previewed, rows, columns, stepsPerBar, stride),
    [previewed, rows, columns, stepsPerBar, stride],
  );

  return { controller, startResize, resolveStepIndex, previewed, kinds };
}

interface LeadMelodyRowProps {
  cells: LeadMelodyCellsProps;
  paint: LeadCellPaint;
  note: string;
  rowIndex: number;
}

/**
 * One pitch row: the row-wide answers computed once, then one cell per column.
 * Split from the matrix so neither the per-row strip (what is constant across
 * a row) nor the per-cell body (what changes column to column) has to hold the
 * other.
 */
function LeadMelodyRow({ cells, paint, note, rowIndex }: LeadMelodyRowProps) {
  const { root, stride, rowLabels, outOfScale } = cells;
  const { previewed, kinds } = paint;
  const stepsPerBar = cells.meter.stepsPerBar;
  const columns = cells.loopLength * cells.colsPerBar;
  const rowKinds: LeadRowKinds = kinds.get(note) ?? [];
  // Constant for the whole ROW — both of these strip the octave with a
  // regex, and the answer cannot change from column to column. Per cell
  // it was rows x columns allocations (~6,100 at 4 bars / 1-32 /
  // chromatic) for at most 24 distinct answers.
  const inactive = isRootNote(note, root)
    ? 'bg-primary/20'
    : isBlackKey(note)
      ? 'bg-roll-key-black'
      : 'bg-roll-key-white';
  // Lazily, and only from the handlers that read it: resolveLeadCellSpan
  // scans backward for the span start and searches the stored row, which
  // is the per-cell cost leadCellKinds' single pass exists to remove.
  // Calling it per cell put it straight back — ~3,072 scans per render.
  const spanAt = (col: number): LeadCellSpan =>
    resolveLeadCellSpan(rowKinds, col, stepsPerBar, stride, note, previewed);
  // Computed once per row by the parent, which needs the same string
  // for the note column beside this grid. Deriving it here as well made
  // it three calls a row and put spelling knowledge — and two more
  // props — inside a component that only draws cells.
  const rowLabel = rowLabels[rowIndex];
  // Constant for the whole row, like `inactive` above and for the same
  // reason: the parent already answered it once per row.
  const rowOutOfScale = outOfScale[rowIndex];

  return (
    <React.Fragment>
      {Array.from({ length: columns }, (_, col) => (
        <LeadMelodyCell
          key={`${note}-${col}`}
          cells={cells}
          paint={paint}
          note={note}
          col={col}
          columns={columns}
          label={rowLabel}
          inactive={inactive}
          outOfScale={rowOutOfScale}
          rowKinds={rowKinds}
          spanAt={spanAt}
        />
      ))}
    </React.Fragment>
  );
}

interface LeadMelodyCellProps {
  cells: LeadMelodyCellsProps;
  paint: LeadCellPaint;
  note: string;
  col: number;
  columns: number;
  label: string;
  inactive: string;
  outOfScale: boolean;
  rowKinds: LeadRowKinds;
  spanAt: (col: number) => LeadCellSpan;
}

/**
 * One cell: what it is, how it is painted, and the four gestures it accepts —
 * click to toggle, drag to paint, drag the right edge to resize, and
 * Shift+Arrow to nudge the length from the keyboard.
 */
function LeadMelodyCell({
  cells,
  paint,
  note,
  col,
  columns,
  label,
  inactive,
  outOfScale,
  rowKinds,
  spanAt,
}: LeadMelodyCellProps) {
  const { controller, resolveStepIndex, startResize } = paint;
  const { stride, colsPerBar, cellsPerBar, onResize, onPreview } = cells;
  const barIndex = Math.floor(col / colsPerBar);
  const stepInBar = col - barIndex * colsPerBar;
  // The same conversion the paint controller's gap-fill uses, from
  // the same callback: two copies of column -> stored index is two
  // things to keep in step when the meter or the stride moves.
  const idx = resolveStepIndex(col);
  const kind = rowKinds[col] ?? 'none';
  const nextKind = rowKinds[col + 1] ?? 'none';
  const span = leadSpanClasses(kind, nextKind, outOfScale);
  // The same two kinds leadSpanClasses already needed answer this,
  // so the grab handle costs nothing beyond a lookup the row loop
  // has made anyway.
  const endsSpan = leadCellEndsSpan(kind, nextKind);
  const cell = cellsPerBar[stepInBar];

  const sep =
    barIndex > 0 && stepInBar === 0
      ? 'border-l-2 border-l-base-content/50'
      : cell.isBeatStart && stepInBar > 0
        ? 'border-l border-l-base-content/30'
        : '';

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={kind !== 'none'}
      onClick={(e) => {
        controller.onCellClick(e, idx, note);
        // leadClickShouldPreview holds the ADD-half-only,
        // keyboard-only gate as one tested predicate rather than
        // a copy of that logic inline here.
        if (leadClickShouldPreview(e.detail, kind)) {
          // A toggled-in note is written with `len: stride`
          // (leadSlice) — one drawn cell — so that is the length
          // the audition sounds.
          onPreview(note, stride);
        }
      }}
      onPointerDown={(e) => controller.onCellPointerDown(e, idx, col, note, kind !== 'none')}
      onPointerEnter={(e) => controller.onCellPointerEnter(e, idx, col, note)}
      onKeyDown={(e) => {
        if (
          !e.shiftKey ||
          e.ctrlKey ||
          e.altKey ||
          e.metaKey ||
          (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')
        )
          return;
        if (kind === 'none') return;
        // The keyboard equivalent of the drag: required, not
        // optional — a pointer-only editing affordance is an
        // accessibility regression with jsx-a11y at error.
        e.preventDefault();
        // leadResizeLen counts CELLS, because that is what the
        // pointer moves over; the write counts TICKS, because
        // that is what a length IS. The conversion happens once,
        // here, at the boundary.
        const { spanStartIdx, spanCells } = spanAt(col);
        const count = spanCells + (e.key === 'ArrowRight' ? 1 : -1);
        onResize(spanStartIdx, note, count * stride);
      }}
      className={`relative h-5 border border-base-300 ${span || inactive} ${
        kind === 'none' || kind === 'start' ? sep : ''
      }`}
    >
      {endsSpan && (
        <span
          aria-hidden="true"
          onPointerDown={(e) => {
            const { spanStartIdx, spanCells, startCol } = spanAt(col);
            startResize(e, spanStartIdx, note, spanCells, columns - startCol, stride);
          }}
          // touch-none: without it a touch drag the browser
          // turns into a scroll fires pointercancel, which now
          // correctly discards — so the gesture would silently
          // do nothing on a touch device.
          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none"
        />
      )}
    </button>
  );
}

/**
 * The cell matrix: one row per pitch, one column per drawn column, memoized
 * because the props are stable across clock ticks, so the cells never re-render
 * when only the playhead moves.
 */
export const LeadMelodyCells = React.memo(function LeadMelodyCells(props: LeadMelodyCellsProps) {
  const { trackId, loopLength, rows, colsPerBar } = props;
  const stepsPerBar = props.meter.stepsPerBar;
  const columns = loopLength * colsPerBar;
  const paint = useLeadCellPaint(trackId, { ...props, columns, stepsPerBar });

  return (
    <div
      className="grid shrink-0"
      style={{ gridTemplateColumns: `repeat(${columns}, ${LEAD_CELL_WIDTH}px)` }}
    >
      {rows.map((note, rowIndex) => (
        <LeadMelodyRow key={note} cells={props} paint={paint} note={note} rowIndex={rowIndex} />
      ))}
    </div>
  );
});
