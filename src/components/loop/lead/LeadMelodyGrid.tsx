import React, { useCallback, useEffect, useMemo } from 'react';
import { Circle, ClipboardPaste, Copy, RotateCcw } from 'lucide-react';
import { useAppStore } from '@/store/store';
import { TOOLBAR_BUTTON_IDLE, ToolbarButton, ToolbarCluster, ToolbarGroup, ToolbarLane } from '@/components/ui/Toolbar';
import { GROUP_LABEL, SECTION_HEADER } from '@/components/ui/fieldClasses';
import { PanelCard } from '@/components/ui/PanelCard';
import { ModuleHeader } from '@/components/ui/ModuleHeader';
import { SoloButton } from '@/components/ui/SoloButton';
import { loopBars } from '@/store/loop';
import { getMeter, type Meter } from '@/utils/meter';
import { type StepCell } from '@/components/sequencerGrid';
import {
  clampLeadCursor,
  clampLeadLoopLength,
  leadCursorBar,
  leadStoredIndexAt,
  loopLengthDivisors,
  type LeadNote,
} from '@/audio/leadMelody';
import { previewSequencerNote } from '@/audio/playback/presetPreview';
import {
  LEAD_CELL_WIDTH,
  LEAD_WINDOW_OCTAVES,
  isBlackKey,
  isRootNote,
  leadCellEndsSpan,
  leadCellKinds,
  leadColumnCells,
  leadCursorKeyTarget,
  leadNotesInWindow,
  leadOutOfScaleRows,
  leadPitchRows,
  leadPreviewHoldSec,
  leadRowLabel,
  leadRowLabelTone,
  leadSpanClasses,
  resolveLeadCellSpan,
} from './melodyGrid';
import {
  LEAD_STEP_RESOLUTION_IDS,
  columnsPerBar,
  strideFor,
} from '@/utils/stepResolution';
import { useLeadMarkerColumn } from './useLeadMarker';
import { useLeadPlayback } from './useLeadPlayback';
import { useLeadStepPublisher } from './useLeadStepPublisher';
import { useLeadNoteResize } from './useLeadNoteResize';
import { leadPaintClickIsKeyboard } from './leadPaint';
import { useLeadNotePaint } from './useLeadNotePaint';
import { Slider } from '@/components/ui/Slider';
import { melodyTrack, type MelodyTrackId } from '@/store/melodyTracks';

/**
 * Action names MELODY_TRACKS' row does not carry: the table (melodyTracks.ts)
 * declares STATE field names only, and this file also needs the SETTER names
 * for the toolbar controls and the bar clipboard. Kept local rather than added
 * to the table for the same reason leadSlice.ts's own `ACTIONS` map is
 * private to it: both sides are typo-checked literals, and a templated
 * `set${id}Gate` would trade that compile-time check for a runtime one.
 */
const GRID_ACTIONS: Record<
  MelodyTrackId,
  {
    setSteps: 'setLeadMelodySteps' | 'setFxMelodySteps';
    setLoopLength: 'setLeadLoopLength' | 'setFxLoopLength';
    setLoopLengthPreserve: 'setLeadLoopLengthPreserve' | 'setFxLoopLengthPreserve';
    setStepResolution: 'setLeadStepResolution' | 'setFxStepResolution';
    setView: 'setLeadMelodyView' | 'setFxMelodyView';
    setOctave: 'setLeadMelodyOctave' | 'setFxMelodyOctave';
    setGate: 'setLeadGate' | 'setFxGate';
    setCursor: 'setLeadCursor' | 'setFxCursor';
    copyBar: 'copySelectedLeadBar' | 'copySelectedFxBar';
    pasteBar: 'pasteIntoSelectedLeadBar' | 'pasteIntoSelectedFxBar';
    setNoteLength: 'setLeadNoteLength' | 'setFxNoteLength';
  }
> = {
  lead: {
    setSteps: 'setLeadMelodySteps',
    setLoopLength: 'setLeadLoopLength',
    setLoopLengthPreserve: 'setLeadLoopLengthPreserve',
    setStepResolution: 'setLeadStepResolution',
    setView: 'setLeadMelodyView',
    setOctave: 'setLeadMelodyOctave',
    setGate: 'setLeadGate',
    setCursor: 'setLeadCursor',
    copyBar: 'copySelectedLeadBar',
    pasteBar: 'pasteIntoSelectedLeadBar',
    setNoteLength: 'setLeadNoteLength',
  },
  fx: {
    setSteps: 'setFxMelodySteps',
    setLoopLength: 'setFxLoopLength',
    setLoopLengthPreserve: 'setFxLoopLengthPreserve',
    setStepResolution: 'setFxStepResolution',
    setView: 'setFxMelodyView',
    setOctave: 'setFxMelodyOctave',
    setGate: 'setFxGate',
    setCursor: 'setFxCursor',
    copyBar: 'copySelectedFxBar',
    pasteBar: 'pasteIntoSelectedFxBar',
    setNoteLength: 'setFxNoteLength',
  },
};

/** Fixed width (px) of the note-name column, shared by the header spacer. */
const LABEL_WIDTH = 44;

interface LeadMarkerViewProps {
  column: number;
}

/**
 * The one marker. Not two: the selection cursor and the playback playhead
 * both meant "this column", so they are drawn once, the way a DAW does —
 * except that this marker is also the column pointer recording writes at.
 *
 * Split out with an explicit prop so the geometry stays unit-testable:
 * renderToString cannot force a playing store state (zustand v5 serves
 * selector(api.getInitialState()) as the server snapshot — see
 * ui/BottomInputDock.tsx:9-21).
 *
 * It spans the header strips as well as the body, so it is offset by the
 * note-name column's width and strides by LEAD_CELL_WIDTH — the same
 * constant the header buttons size themselves with.
 */
export function LeadMarkerView({ column }: LeadMarkerViewProps) {
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 bg-primary/20 ring-1 ring-inset ring-primary"
      style={{
        width: LEAD_CELL_WIDTH,
        left: LABEL_WIDTH,
        transform: `translateX(${column * LEAD_CELL_WIDTH}px)`,
      }}
    />
  );
}

interface LeadMarkerProps {
  trackId: MelodyTrackId;
  columns: number;
}

/**
 * The marker, subscribed. The subscription lives HERE and not in
 * LeadMelodyGrid for exactly the reason the grid itself lives here and not in
 * the view that renders it (see the note on LeadMelodyGrid): a published step
 * arrives 8-32 times a second, and read from the grid's body it re-rendered
 * the whole toolbar — two selects, a Slider, eight buttons and 14-24 pitch
 * labels — to move one translateX. This component draws one div and nothing
 * else, so that is all a step now costs.
 */
export function LeadMarker({ trackId, columns }: LeadMarkerProps) {
  const column = useLeadMarkerColumn(trackId, columns);
  return <LeadMarkerView column={column} />;
}

// Memoized: props are stable across clock ticks, so the cells never re-render
// when only the playhead moves.
const LeadMelodyCells = React.memo(function LeadMelodyCells({
  trackId,
  meter,
  loopLength,
  melody,
  rows,
  rowLabels,
  outOfScale,
  root,
  onResize,
  stride,
  colsPerBar,
  cellsPerBar,
  onPreview,
}: {
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
}) {
  const stepsPerBar = meter.stepsPerBar;
  const columns = loopLength * colsPerBar;
  const { preview, startResize } = useLeadNoteResize(trackId);
  // Column → stored index. Stored indices are bar-major at MAX_STEPS_PER_BAR,
  // so this is not the identity and a skipped-cell fill must go through it.
  const resolveStepIndex = useCallback(
    (col: number) => leadStoredIndexAt(col, stepsPerBar, stride),
    [stepsPerBar, stride],
  );
  const paint = useLeadNotePaint(trackId, resolveStepIndex);
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

  return (
    <div
      className="grid shrink-0"
      style={{ gridTemplateColumns: `repeat(${columns}, ${LEAD_CELL_WIDTH}px)` }}
    >
      {rows.map((note, rowIndex) => {
        const rowKinds = kinds.get(note) ?? [];
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
        const spanAt = (col: number): ReturnType<typeof resolveLeadCellSpan> =>
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
          <React.Fragment key={note}>
            {Array.from({ length: columns }, (_, col) => {
              const barIndex = Math.floor(col / colsPerBar);
              const stepInBar = col - barIndex * colsPerBar;
              // The same conversion the paint controller's gap-fill uses, from
              // the same callback: two copies of column -> stored index is two
              // things to keep in step when the meter or the stride moves.
              const idx = resolveStepIndex(col);
              const kind = rowKinds[col] ?? 'none';
              const nextKind = rowKinds[col + 1] ?? 'none';
              const span = leadSpanClasses(kind, nextKind, rowOutOfScale);
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
                  key={`${note}-${col}`}
                  type="button"
                  aria-label={rowLabel}
                  aria-pressed={kind !== 'none'}
                  onClick={(e) => {
                    paint.onCellClick(e, idx, note);
                    // Only the ADD half auditions, and only from the keyboard.
                    // onCellClick toggles, so `kind === 'none'` before the
                    // click is exactly the case where the cell holds a note
                    // after it — "hear what you drew". The erase half stays
                    // silent: auditioning a note as it is removed says the
                    // opposite of what just happened. Pointer clicks never
                    // reach here at all (leadPaintClickIsKeyboard), so a paint
                    // drag cannot machine-gun the shared preview bus.
                    if (leadPaintClickIsKeyboard(e.detail) && kind === 'none') {
                      // A toggled-in note is written with `len: stride`
                      // (leadSlice) — one drawn cell — so that is the length
                      // the audition sounds.
                      onPreview(note, stride);
                    }
                  }}
                  onPointerDown={(e) =>
                    paint.onCellPointerDown(e, idx, col, note, kind !== 'none')
                  }
                  onPointerEnter={(e) => paint.onCellPointerEnter(e, idx, col, note)}
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
                    const cells = spanCells + (e.key === 'ArrowRight' ? 1 : -1);
                    onResize(spanStartIdx, note, cells * stride);
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
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
});


// Memoized for the same reason as LeadMelodyCells above: LeadMelodyGrid
// re-renders once per 16th note to move the playhead, and these two strips
// rebuild `columns` divs each — 128 of them for a 4-bar loop in 4/4 — every
// time. stepsPerBar and columns are numbers, and cellsPerBar is useMemo'd on
// the shared METERS[id] object, so the shallow prop comparison is meaningful.
export const LeadMelodyHeaders = React.memo(function LeadMelodyHeaders({
  columns,
  cellsPerBar,
  cursor,
  selectedBar,
  onSelectColumn,
  columnsPerBar,
}: {
  columns: number;
  cellsPerBar: StepCell[];
  cursor: number;
  selectedBar: number;
  onSelectColumn: (col: number) => void;
  columnsPerBar: number;
}) {
  // Arrows move the cursor AND the focus together. Leaving focus behind would
  // put the ring on one column while the selection sat on another.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, col: number): void => {
    const next = leadCursorKeyTarget(col, e.key, e.shiftKey, columnsPerBar, columns);
    if (next === null) return;
    e.preventDefault();
    onSelectColumn(next);
    const strip = e.currentTarget.parentElement;
    (strip?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <>
      {/* Both strips are h-5 — one grid row cell tall — so a bar and a beat
          are pointer targets rather than 8px bands. The widths stay
          LEAD_CELL_WIDTH, the same constant the marker's translateX strides
          by: a marker that drifts from its own ruler is worse than two
          honest markers. */}
      {/* Bar-number header — the whole bar's width selects that bar. */}
      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
        <div className="flex shrink-0">
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / columnsPerBar);
            const stepInBar = col % columnsPerBar;
            return (
              <button
                key={col}
                type="button"
                aria-label={`Bar ${barIndex + 1}`}
                aria-pressed={barIndex === selectedBar}
                onClick={() => onSelectColumn(barIndex * columnsPerBar)}
                onKeyDown={(e) => onKeyDown(e, col)}
                // bg-primary/20 text-primary now means "the selected bar for
                // copy/paste" — it is a live selection tint, not a second
                // marker. It sits under the DEV-377 marker on purpose: the
                // marker is "this column", this strip is "this bar".
                className={`h-5 flex items-center justify-center text-[8px] leading-none font-bold ${
                  barIndex === selectedBar
                    ? 'bg-primary/20 text-primary'
                    : 'text-base-content/60'
                }`}
                style={{ width: LEAD_CELL_WIDTH }}
              >
                {stepInBar === 0 ? barIndex + 1 : '\u00a0'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Beat-number header — one column each, and the cursor lives here. */}
      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
        <div className="flex shrink-0">
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / columnsPerBar);
            const stepInBar = col % columnsPerBar;
            const cell = cellsPerBar[stepInBar];
            return (
              <button
                key={col}
                type="button"
                aria-label={`Bar ${barIndex + 1} step ${stepInBar + 1}`}
                aria-pressed={col === cursor}
                onClick={() => onSelectColumn(col)}
                onKeyDown={(e) => onKeyDown(e, col)}
                // aria-pressed stays: it is the button's SELECTION state, and
                // DEV-371's contract does not change. Only the band goes —
                // the marker is the one thing that says "this column" now.
                className="h-5 flex items-center justify-center text-[9px] leading-none text-base-content/50"
                style={{ width: LEAD_CELL_WIDTH }}
              >
                {cell.isBeatStart ? cell.beatIndex + 1 : '\u00a0'}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
});

export interface LeadMelodyGridProps {
  /**
   * REQUIRED, with no default. A default of 'lead' would make a call site
   * that forgot the prop render a second copy of the lead grid — visually
   * plausible, silently wrong, and caught by no test, because both instances
   * would be internally consistent.
   */
  trackId: MelodyTrackId;
}

// Mounted here, not in the view that renders it: the step used to arrive as
// a prop, so all 174 JSX nodes of the then-1208-line synth view reconciled
// 8x/sec to move one translateX. LeadMelodyGrid is mounted once PER TRACK
// (PatternView.tsx, the Lead and FX segments), which
// is what lets each instance's hooks subscribe the shared clock at all: two
// mounted grids are two players, each holding its own subscription, which is
// exactly what "the clock runs iff a player holds a subscription" permits.
//
// Two hooks, two gates, on purpose. useLeadPlayback schedules NOTES and
// owns the hard stop, so it runs while the track's player plays.
// useLeadStepPublisher moves the MARKER, which for the lead track also has to
// track somebody else's clock while Rec is armed, because that column is the
// recorder's write head — the fx track has no recorder, so its marker
// follows its own player and nothing else. Its `isPlaying` return is not what
// the marker uses; useLeadMarkerColumn reads the same wider gate the
// publisher does — from inside LeadMarker, so the published step re-renders
// one div rather than this whole body.
export function LeadMelodyGrid({ trackId }: LeadMelodyGridProps) {
  const track = melodyTrack(trackId);
  const actions = GRID_ACTIONS[trackId];
  useLeadPlayback(trackId);
  useLeadStepPublisher(trackId);
  const meterId = useAppStore((s) => s.meterId);
  const melodySteps = useAppStore((s) => s[track.steps]);
  const melodyLoopLength = useAppStore((s) => s[track.loopLength]);
  const melodyStepResolution = useAppStore((s) => s[track.stepResolution]);
  const setMelodyStepResolution = useAppStore((s) => s[actions.setStepResolution]);
  const melodyView = useAppStore((s) => s[track.view]);
  const melodyOctave = useAppStore((s) => s[track.octave]);
  const setMelodyView = useAppStore((s) => s[actions.setView]);
  const setMelodyOctave = useAppStore((s) => s[actions.setOctave]);
  const setMelodyLoopLength = useAppStore((s) => s[actions.setLoopLength]);
  const setMelodyLoopLengthPreserve = useAppStore((s) => s[actions.setLoopLengthPreserve]);
  const setMelodySteps = useAppStore((s) => s[actions.setSteps]);
  const melodyGate = useAppStore((s) => s[track.gate]);
  const setMelodyGate = useAppStore((s) => s[actions.setGate]);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const chords = useAppStore((s) => s.chords);
  const synthParams = useAppStore((s) => s[track.synthParams]);

  const meter = getMeter(meterId);
  const stepsPerBar = meter.stepsPerBar;
  const totalBars = loopBars(chords);
  const divisors = loopLengthDivisors(totalBars);
  const stride = strideFor(melodyStepResolution);
  const colsPerBar = columnsPerBar(stepsPerBar, stride);
  const cellsPerBar = useMemo(() => leadColumnCells(meter, stride), [meter, stride]);

  const columns = melodyLoopLength * colsPerBar;

  // The rows a scale-locked view would otherwise drop. A note outside the key
  // is never deleted — it just had no row to be drawn on, so switching to
  // scale-locked hid it. Borrowing the row back is derived, not stored: erase
  // the last note on a borrowed row and the row goes with it, exactly as an
  // in-scale row keeps its place because the scale still names it.
  const borrowedNotes = useMemo(
    () => leadNotesInWindow(melodySteps, columns, stepsPerBar, stride),
    [melodySteps, columns, stepsPerBar, stride],
  );

  const rows = useMemo(
    () =>
      leadPitchRows(
        melodyView,
        scaleRoot,
        scaleType,
        melodyOctave,
        LEAD_WINDOW_OCTAVES,
        borrowedNotes,
      ),
    [melodyView, scaleRoot, scaleType, melodyOctave, borrowedNotes],
  );

  // Memoized beside rowLabels and for the same reason: both readers — the note
  // column here and the cell grid below — need one answer per row, and
  // isNoteInScale builds a tonal note behind every call.
  const outOfScale = useMemo(
    () => leadOutOfScaleRows(rows, scaleRoot, scaleType),
    [rows, scaleRoot, scaleType],
  );

  // One label per row, computed here because both the note column and the cell
  // grid render it. Each call rebuilds a tonal Scale behind the spelling cache,
  // so a per-cell — or even a twice-per-row — derivation is work the row count
  // already bounds.
  const rowLabels = useMemo(
    () => rows.map((note) => leadRowLabel(note, melodyView, scaleRoot, scaleType)),
    [rows, melodyView, scaleRoot, scaleType],
  );

  // Clamp loopLength down when the progression no longer divides it. Uses the
  // non-destructive setter: resizing here would trim the melody grid, so
  // deleting a chord on the Chord tab would permanently delete the drawn notes
  // in the bars that fell out of the loop (they stay dormant and return if the
  // loop length is raised again).
  useEffect(() => {
    const clamped = clampLeadLoopLength(melodyLoopLength, totalBars);
    if (clamped !== melodyLoopLength) setMelodyLoopLengthPreserve(clamped);
  }, [totalBars, melodyLoopLength, setMelodyLoopLengthPreserve]);

  const melodyCursor = useAppStore((s) => s[track.cursor]);
  const setMelodyCursor = useAppStore((s) => s[actions.setCursor]);
  const copySelectedLeadBar = useAppStore((s) => s[actions.copyBar]);
  const pasteIntoSelectedLeadBar = useAppStore((s) => s[actions.pasteBar]);
  const hasClipboard = useAppStore((s) => s[track.clipboard] !== null);
  const leadRecording = useAppStore((s) => s.leadRecording);
  const setLeadRecording = useAppStore((s) => s.setLeadRecording);

  const setMelodyNoteLength = useAppStore((s) => s[actions.setNoteLength]);
  const onResize = useCallback(
    (stepIndex: number, note: string, len: number) => setMelodyNoteLength(stepIndex, note, len),
    [setMelodyNoteLength],
  );

  const clearMelody = useCallback(
    () => setMelodySteps(melodySteps.map(() => [] as LeadNote[])),
    [melodySteps, setMelodySteps],
  );

  // previewSequencerNote, not synthPlaybackNoteOn: hearing a cell you clicked
  // is not performing a note, so the note-input bus must not see it — and it
  // runs on the 'preview' bus, so its release cannot cut a key the player is
  // holding at the same pitch. It calls audioEngine.init() itself.
  //
  // The length comes from leadPreviewHoldSec, not from a constant: a fixed gate
  // is silent for any patch whose attack outruns it, so its only safe value is
  // a measurement against the slowest patch in the library — a hidden
  // dependency on the preset table. `lenTicks` omitted means a row label, which
  // sounds one beat; passed, it means a cell, which sounds what it draws.
  //
  // bpm is read off getState() rather than subscribed to. This grid already
  // re-renders once per 16th to move the playhead, and a preview is a click:
  // the value at click time is the only one that can matter, and a subscription
  // here would add a re-render of every mounted melody grid per tempo change
  // for a value nothing renders.
  const previewNote = useCallback(
    (note: string, lenTicks?: number) => {
      previewSequencerNote(note, synthParams, undefined, {
        holdSec: leadPreviewHoldSec(useAppStore.getState().bpm, stride, lenTicks),
        releaseSec: synthParams.release,
      });
    },
    [synthParams, stride],
  );

  // Clamped again HERE, not only on write: a meter or loop-length change can
  // narrow the window under a cursor that was legal when it was set.
  const cursor = clampLeadCursor(melodyCursor, melodyLoopLength, stepsPerBar, stride);
  const selectedBar = leadCursorBar(cursor, stepsPerBar, stride);

  return (
    // `PanelCard`, not a hand-written copy of its shell: the Beat segment beside
    // this one renders the real component, and the copy that was here differed
    // by a shadow step (`shadow-xl` against PANEL_CARD's `shadow-md`), so two
    // segments one tab-click apart sat at different weights.
    <PanelCard>
      <div className="card-body p-4">
        {/* `Melody`, not `Lead Melody`: the segment row's own `Lead` chip sits
            directly above, so the card names what it HOLDS and the chip names
            which segment — the same split that lets the tab header say
            `Pattern` and nothing more. FX names itself instead, since its own
            segment chip says `FX` and "FX Melody" would be as redundant as
            "Lead Lead Melody".
            Solo rides here rather than in that tab header, because the header
            belongs to the tab now and this button silences one track. It is
            the rule the three Accompaniment module cards already follow. */}
        <ModuleHeader className="mb-3" right={<SoloButton track={track.solo} />}>
          {/* `children`, not `title`: ModuleHeader's title cell is the
              mixed-case MODULE_TITLE the numbered synth stages wear, and a
              segment's content card is a SECTION — uppercase — like the drum
              grid's and the progression card's. */}
          <span className={SECTION_HEADER}>{track.id === 'fx' ? 'FX' : 'Melody'}</span>
        </ModuleHeader>

        {/* Settings lane. Everything here picks what the grid SHOWS or how it
            sounds back, and none of it is a thing you tap twice in a row — the
            actions live in their own lane under the grid (see ui/Toolbar).
            View mode leads, then each setting behind a GROUP_LABEL naming what
            it adjusts: a bare `4` and a bare `1/16` are only legible to someone
            who already knows this grid. */}
        <ToolbarLane className="mb-3 justify-between">
          <ToolbarGroup>
            <div className="join">
              {(['scale-locked', 'chromatic'] as const).map((m) => (
                <button
                  key={m}
                  id={`btn-${trackId}-view-${m}`}
                  type="button"
                  onClick={() => setMelodyView(m)}
                  className={`btn btn-xs join-item text-[11px] font-semibold ${
                    melodyView === m
                      ? 'btn-primary'
                      : TOOLBAR_BUTTON_IDLE
                  }`}
                >
                  {m === 'scale-locked' ? 'Scale' : 'Chromatic'}
                </button>
              ))}
            </div>
          </ToolbarGroup>

          <ToolbarCluster>
            <ToolbarGroup>
              <span className={GROUP_LABEL}>Octave</span>
              <button
                id={`btn-${trackId}-octave-down`}
                type="button"
                onClick={() => setMelodyOctave(melodyOctave - 1)}
                className="btn btn-xs btn-square btn-ghost border border-base-300"
                title="Octave window down"
              >
                -
              </button>
              <span className="text-xs tabular-nums">{melodyOctave}</span>
              <button
                id={`btn-${trackId}-octave-up`}
                type="button"
                onClick={() => setMelodyOctave(melodyOctave + 1)}
                className="btn btn-xs btn-square btn-ghost border border-base-300"
                title="Octave window up"
              >
                +
              </button>
            </ToolbarGroup>

            <ToolbarGroup>
              <span className={GROUP_LABEL}>Length</span>
              <select
                id={`select-${trackId}-loop-length`}
                value={melodyLoopLength}
                onChange={(e) => setMelodyLoopLength(Number(e.target.value))}
                className="select select-xs select-ghost"
                title="Melody loop length (bars)"
              >
                {divisors.map((d) => (
                  <option key={d} value={d}>
                    {d} bar{d === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </ToolbarGroup>

            <ToolbarGroup>
              <span className={GROUP_LABEL}>Step</span>
              <select
                id={`select-${trackId}-step-resolution`}
                value={melodyStepResolution}
                onChange={(e) => setMelodyStepResolution(e.target.value as typeof melodyStepResolution)}
                className="select select-xs select-ghost"
                title="Melody grid resolution — a finer grid reveals more columns and never moves a note"
              >
                {LEAD_STEP_RESOLUTION_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </ToolbarGroup>

            <ToolbarGroup>
              <span className={GROUP_LABEL}>Gate</span>
              <Slider
                id={`range-${trackId}-gate`}
                value={Math.round(melodyGate * 100)}
                min={5}
                max={100}
                step={5}
                onChange={(percent) => setMelodyGate(percent / 100)}
                className="range range-primary range-xs w-20"
                title="How much of each note's final step sounds. Applies when the arp is off."
              />
              <span className="text-[10px] tabular-nums text-base-content/60 whitespace-nowrap">
                {`${Math.round(melodyGate * 100)}%`}
              </span>
            </ToolbarGroup>
          </ToolbarCluster>
        </ToolbarLane>

        <div className="overflow-x-auto bg-base-200 p-3 rounded">
          <div className="w-fit mx-auto relative">
            <LeadMelodyHeaders
              cursor={cursor}
              selectedBar={selectedBar}
              onSelectColumn={setMelodyCursor}
              columns={columns}
              cellsPerBar={cellsPerBar}
              columnsPerBar={colsPerBar}
            />

            {/* Body: note column + cells + marker */}
            <div className="flex">
              <div
                className="sticky left-0 z-10 shrink-0 bg-panel"
                style={{ width: LABEL_WIDTH }}
              >
                {rows.map((note, rowIndex) => (
                  <button
                    key={note}
                    type="button"
                    onClick={() => previewNote(note)}
                    title={`Preview ${rowLabels[rowIndex]}`}
                    className={`h-5 flex items-center justify-end pr-2 text-[10px] leading-none cursor-pointer ${leadRowLabelTone(outOfScale[rowIndex])}`}
                  >
                    {rowLabels[rowIndex]}
                  </button>
                ))}
              </div>

              <div className="shrink-0">
                <LeadMelodyCells
                  trackId={trackId}
                  meter={meter}
                  loopLength={melodyLoopLength}
                  melody={melodySteps}
                  rows={rows}
                  rowLabels={rowLabels}
                  outOfScale={outOfScale}
                  root={scaleRoot}
                  onResize={onResize}
                  stride={stride}
                  colsPerBar={colsPerBar}
                  cellsPerBar={cellsPerBar}
                  onPreview={previewNote}
                />
              </div>
            </div>

            {/* Last child of the w-fit container, so it spans the ruler and
                the grid body as one column. */}
            <LeadMarker trackId={trackId} columns={columns} />
          </div>
        </div>

        {/* Action lane. Below the grid on purpose: it sits next to the bottom
            input dock, which is where the hands are when Rec matters, and the
            eye reads grid-then-act rather than doubling back.
            Rec holds the left alone because it is the only MODE here — it arms
            a state and stays armed — while copy/paste/clear are one-shot
            commands; splitting them by kind also buys Clear the most distance
            from the button beside it. Clear keeps its own group so the lane's
            wider gap sets it apart from Paste, and it must not wear red as
            well: an armed Rec already owns that.
            FX has no recorder (scope decision at the top of this plan) — its
            left group renders empty rather than not at all, so `justify-between`
            still has two children and the actions cluster stays pinned right,
            exactly where it sits on the lead grid. */}
        <ToolbarLane className="mt-3 justify-between">
          <ToolbarGroup>
            {trackId === 'lead' && (
              <ToolbarButton
                id={`btn-${trackId}-record`}
                icon={<Circle className="w-3 h-3" />}
                label="Rec"
                onClick={() => setLeadRecording(!leadRecording)}
                pressed={leadRecording}
                title={
                  leadRecording
                    ? 'Stop recording played notes into the grid'
                    : `Record played notes into bar ${selectedBar + 1}, from the selected step`
                }
              />
            )}
          </ToolbarGroup>

          <ToolbarCluster>
            <ToolbarGroup>
              <ToolbarButton
                id={`btn-${trackId}-copy-bar`}
                icon={<Copy className="w-3 h-3" />}
                label="Copy"
                onClick={copySelectedLeadBar}
                title={`Copy bar ${selectedBar + 1}`}
              />
              <ToolbarButton
                id={`btn-${trackId}-paste-bar`}
                icon={<ClipboardPaste className="w-3 h-3" />}
                label="Paste"
                onClick={pasteIntoSelectedLeadBar}
                disabled={!hasClipboard}
                title={`Paste over bar ${selectedBar + 1}`}
              />
            </ToolbarGroup>

            <ToolbarGroup>
              <ToolbarButton
                id={`btn-${trackId}-clear`}
                icon={<RotateCcw className="w-3 h-3" />}
                label="Clear"
                onClick={clearMelody}
                title="Clear melody"
              />
            </ToolbarGroup>
          </ToolbarCluster>
        </ToolbarLane>
      </div>
    </PanelCard>
  );
}