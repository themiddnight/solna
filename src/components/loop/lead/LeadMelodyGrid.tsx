import React, { useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../../store/store';
import { loopBars } from '../../../store/loop';
import { getMeter, type Meter } from '../../../utils/meter';
import { type StepCell } from '../../sequencerGrid';
import {
  clampLeadCursor,
  clampLeadLoopLength,
  leadCursorBar,
  leadStoredIndexAt,
  loopLengthDivisors,
  type LeadNote,
} from '../../../audio/leadMelody';
import { previewSequencerNote } from '../../../audio/playback/presetPreview';
import {
  LEAD_CELL_WIDTH,
  LEAD_WINDOW_OCTAVES,
  isBlackKey,
  isRootNote,
  leadCellEndsSpan,
  leadCellKinds,
  leadColumnCells,
  leadCursorKeyTarget,
  leadPitchRows,
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
import { useLeadNotePaint } from './useLeadNotePaint';
import { Slider } from '@/components/ui/Slider';

/** Fixed width (px) of the note-name column, shared by the header spacer. */
const LABEL_WIDTH = 44;

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
export const LeadMarkerView: React.FC<{ column: number }> = ({ column }) => (
  <div
    className="pointer-events-none absolute top-0 bottom-0 bg-primary/20 ring-1 ring-inset ring-primary"
    style={{
      width: LEAD_CELL_WIDTH,
      left: LABEL_WIDTH,
      transform: `translateX(${column * LEAD_CELL_WIDTH}px)`,
    }}
  />
);

/**
 * The marker, subscribed. The subscription lives HERE and not in
 * LeadMelodyGrid for exactly the reason the grid itself lives here and not in
 * SynthView (see the note on LeadMelodyGrid): a published step arrives 8-32
 * times a second, and read from the grid's body it re-rendered the whole
 * toolbar — two selects, a Slider, eight buttons and 14-24 pitch labels —
 * to move one translateX. This component draws one div and nothing else, so
 * that is all a step now costs.
 */
export const LeadMarker: React.FC<{ columns: number }> = ({ columns }) => {
  const column = useLeadMarkerColumn(columns);
  return <LeadMarkerView column={column} />;
};

// Memoized: props are stable across clock ticks, so the cells never re-render
// when only the playhead moves.
const LeadMelodyCells = React.memo(function LeadMelodyCells({
  meter,
  loopLength,
  melody,
  rows,
  root,
  onResize,
  stride,
  colsPerBar,
  cellsPerBar,
}: {
  meter: Meter;
  loopLength: number;
  melody: readonly LeadNote[][];
  rows: readonly string[];
  root: string;
  onResize: (stepIndex: number, note: string, len: number) => void;
  stride: number;
  colsPerBar: number;
  cellsPerBar: StepCell[];
}) {
  const stepsPerBar = meter.stepsPerBar;
  const columns = loopLength * colsPerBar;
  const { preview, startResize } = useLeadNoteResize();
  // Column → stored index. Stored indices are bar-major at MAX_STEPS_PER_BAR,
  // so this is not the identity and a skipped-cell fill must go through it.
  const resolveStepIndex = useCallback(
    (col: number) => leadStoredIndexAt(col, stepsPerBar, stride),
    [stepsPerBar, stride],
  );
  const paint = useLeadNotePaint(resolveStepIndex);
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
      {rows.map((note) => {
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
              const span = leadSpanClasses(kind, nextKind);
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
                  aria-label={note}
                  aria-pressed={kind !== 'none'}
                  onClick={(e) => paint.onCellClick(e, idx, note)}
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

export const LeadMelodyGrid: React.FC = () => {
  // Mounted here, not in SynthView: the step used to arrive as a prop, so all
  // 174 JSX nodes of the 1208-line SynthView reconciled 8x/sec to move one
  // translateX. LeadMelodyGrid is rendered exactly once (SynthView.tsx, in
  // both simple and pro mode), which is what lets either of these subscribe
  // the shared clock at all.
  //
  // Two hooks, two gates, on purpose. useLeadPlayback schedules NOTES and
  // owns the hard stop, so it runs while the lead plays. useLeadStepPublisher
  // moves the MARKER, which also has to track somebody else's clock while Rec
  // is armed, because that column is the recorder's write head. Its
  // `isPlaying` return is not what the marker uses; useLeadMarkerColumn reads
  // the same wider gate the publisher does — from inside LeadMarker, so the
  // published step re-renders one div rather than this whole body.
  useLeadPlayback();
  useLeadStepPublisher();
  const meterId = useAppStore((s) => s.meterId);
  const leadMelodySteps = useAppStore((s) => s.leadMelodySteps);
  const leadLoopLength = useAppStore((s) => s.leadLoopLength);
  const leadStepResolution = useAppStore((s) => s.leadStepResolution);
  const setLeadStepResolution = useAppStore((s) => s.setLeadStepResolution);
  const leadMelodyView = useAppStore((s) => s.leadMelodyView);
  const leadMelodyOctave = useAppStore((s) => s.leadMelodyOctave);
  const setLeadMelodyView = useAppStore((s) => s.setLeadMelodyView);
  const setLeadMelodyOctave = useAppStore((s) => s.setLeadMelodyOctave);
  const setLeadLoopLength = useAppStore((s) => s.setLeadLoopLength);
  const setLeadLoopLengthPreserve = useAppStore((s) => s.setLeadLoopLengthPreserve);
  const setLeadMelodySteps = useAppStore((s) => s.setLeadMelodySteps);
  const leadGate = useAppStore((s) => s.leadGate);
  const setLeadGate = useAppStore((s) => s.setLeadGate);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const chords = useAppStore((s) => s.chords);
  const synthParams = useAppStore((s) => s.synthParams);

  const meter = getMeter(meterId);
  const stepsPerBar = meter.stepsPerBar;
  const totalBars = loopBars(chords);
  const divisors = loopLengthDivisors(totalBars);
  const stride = strideFor(leadStepResolution);
  const colsPerBar = columnsPerBar(stepsPerBar, stride);
  const cellsPerBar = useMemo(() => leadColumnCells(meter, stride), [meter, stride]);

  const rows = useMemo(
    () =>
      leadPitchRows(leadMelodyView, scaleRoot, scaleType, leadMelodyOctave, LEAD_WINDOW_OCTAVES),
    [leadMelodyView, scaleRoot, scaleType, leadMelodyOctave],
  );

  // Clamp loopLength down when the progression no longer divides it. Uses the
  // non-destructive setter: resizing here would trim the melody grid, so
  // deleting a chord on the Chord tab would permanently delete the drawn notes
  // in the bars that fell out of the loop (they stay dormant and return if the
  // loop length is raised again).
  useEffect(() => {
    const clamped = clampLeadLoopLength(leadLoopLength, totalBars);
    if (clamped !== leadLoopLength) setLeadLoopLengthPreserve(clamped);
  }, [totalBars, leadLoopLength, setLeadLoopLengthPreserve]);

  const leadCursor = useAppStore((s) => s.leadCursor);
  const setLeadCursor = useAppStore((s) => s.setLeadCursor);
  const copySelectedLeadBar = useAppStore((s) => s.copySelectedLeadBar);
  const pasteIntoSelectedLeadBar = useAppStore((s) => s.pasteIntoSelectedLeadBar);
  const hasClipboard = useAppStore((s) => s.leadBarClipboard !== null);
  const leadRecording = useAppStore((s) => s.leadRecording);
  const setLeadRecording = useAppStore((s) => s.setLeadRecording);

  const setLeadNoteLength = useAppStore((s) => s.setLeadNoteLength);
  const onResize = useCallback(
    (stepIndex: number, note: string, len: number) => setLeadNoteLength(stepIndex, note, len),
    [setLeadNoteLength],
  );

  const clearMelody = useCallback(
    () => setLeadMelodySteps(leadMelodySteps.map(() => [] as LeadNote[])),
    [leadMelodySteps, setLeadMelodySteps],
  );

  // previewSequencerNote, not synthPlaybackNoteOn: hearing a cell you clicked
  // is not performing a note, so the note-input bus must not see it — and it
  // runs on the 'preview' bus, so its release cannot cut a key the player is
  // holding at the same pitch. It calls audioEngine.init() itself.
  const previewNote = useCallback(
    (note: string) => {
      previewSequencerNote(note, synthParams, undefined, {
        holdSec: 0.22,
        releaseSec: synthParams.release,
      });
    },
    [synthParams],
  );

  const columns = leadLoopLength * colsPerBar;
  // Clamped again HERE, not only on write: a meter or loop-length change can
  // narrow the window under a cursor that was legal when it was set.
  const cursor = clampLeadCursor(leadCursor, leadLoopLength, stepsPerBar, stride);
  const selectedBar = leadCursorBar(cursor, stepsPerBar, stride);

  return (
    <div className="card bg-panel border border-base-300 shadow-xl">
      <div className="card-body p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span className="text-xs font-bold text-base-content">Lead Melody</span>

          <div className="flex items-center gap-1.5">
            <div className="join">
              {(['scale-locked', 'chromatic'] as const).map((m) => (
                <button
                  key={m}
                  id={`btn-lead-view-${m}`}
                  type="button"
                  onClick={() => setLeadMelodyView(m)}
                  className={`btn btn-xs join-item text-[11px] font-semibold ${
                    leadMelodyView === m
                      ? 'btn-primary'
                      : 'btn-ghost border border-base-300 text-base-content/60'
                  }`}
                >
                  {m === 'scale-locked' ? 'Scale' : 'Chromatic'}
                </button>
              ))}
            </div>

            <button
              id="btn-lead-octave-down"
              type="button"
              onClick={() => setLeadMelodyOctave(leadMelodyOctave - 1)}
              className="btn btn-xs btn-square btn-ghost border border-base-300"
              title="Octave window down"
            >
              -
            </button>
            <span className="text-xs font-mono">{leadMelodyOctave}</span>
            <button
              id="btn-lead-octave-up"
              type="button"
              onClick={() => setLeadMelodyOctave(leadMelodyOctave + 1)}
              className="btn btn-xs btn-square btn-ghost border border-base-300"
              title="Octave window up"
            >
              +
            </button>

            <select
              id="select-lead-loop-length"
              value={leadLoopLength}
              onChange={(e) => setLeadLoopLength(Number(e.target.value))}
              className="select select-xs select-ghost"
              title="Melody loop length (bars)"
            >
              {divisors.map((d) => (
                <option key={d} value={d}>
                  {d} bar{d === 1 ? '' : 's'}
                </option>
              ))}
            </select>

            <select
              id="select-lead-step-resolution"
              value={leadStepResolution}
              onChange={(e) => setLeadStepResolution(e.target.value as typeof leadStepResolution)}
              className="select select-xs select-ghost"
              title="Melody grid resolution — a finer grid reveals more columns and never moves a note"
            >
              {LEAD_STEP_RESOLUTION_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>

            <span className="text-[10px] font-mono text-base-content/60 whitespace-nowrap">
              {`Gate ${Math.round(leadGate * 100)}%`}
            </span>
            <Slider
              id="range-lead-gate"
              value={Math.round(leadGate * 100)}
              min={5}
              max={100}
              step={5}
              onChange={(percent) => setLeadGate(percent / 100)}
              className="range range-primary range-xs w-20"
              title="How much of each note's final step sounds. Applies when the arp is off."
            />

            <button
              id="btn-lead-record"
              type="button"
              onClick={() => setLeadRecording(!leadRecording)}
              aria-pressed={leadRecording}
              className={
                leadRecording
                  ? 'btn btn-xs btn-error'
                  : 'btn btn-xs btn-ghost border border-base-300 text-base-content/70'
              }
              title={
                leadRecording
                  ? 'Stop recording played notes into the grid'
                  : `Record played notes into bar ${selectedBar + 1}, from the selected step`
              }
            >
              Rec
            </button>
            <button
              id="btn-lead-copy-bar"
              type="button"
              onClick={copySelectedLeadBar}
              className="btn btn-xs btn-ghost border border-base-300 text-base-content/70"
              title={`Copy bar ${selectedBar + 1}`}
            >
              Copy
            </button>
            <button
              id="btn-lead-paste-bar"
              type="button"
              onClick={pasteIntoSelectedLeadBar}
              disabled={!hasClipboard}
              className="btn btn-xs btn-ghost border border-base-300 text-base-content/70"
              title={`Paste over bar ${selectedBar + 1}`}
            >
              Paste
            </button>
            <button
              id="btn-lead-clear"
              type="button"
              onClick={clearMelody}
              className="btn btn-xs btn-ghost border border-base-300 text-base-content/70"
              title="Clear melody"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="overflow-x-auto bg-base-200 p-3 rounded">
          <div className="w-fit mx-auto relative">
            <LeadMelodyHeaders
              cursor={cursor}
              selectedBar={selectedBar}
              onSelectColumn={setLeadCursor}
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
                {rows.map((note) => (
                  <button
                    key={note}
                    type="button"
                    onClick={() => previewNote(note)}
                    title={`Preview ${note}`}
                    className="h-5 flex items-center justify-end pr-2 text-[10px] font-mono leading-none text-base-content/60 hover:text-base-content cursor-pointer"
                  >
                    {note}
                  </button>
                ))}
              </div>

              <div className="shrink-0">
                <LeadMelodyCells
                  meter={meter}
                  loopLength={leadLoopLength}
                  melody={leadMelodySteps}
                  rows={rows}
                  root={scaleRoot}
                  onResize={onResize}
                  stride={stride}
                  colsPerBar={colsPerBar}
                  cellsPerBar={cellsPerBar}
                />
              </div>
            </div>

            {/* Last child of the w-fit container, so it spans the ruler and
                the grid body as one column. */}
            <LeadMarker columns={columns} />
          </div>
        </div>
      </div>
    </div>
  );
};
