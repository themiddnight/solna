import React, { useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../../store/store';
import { loopBars } from '../../../store/loop';
import { getMeter, type Meter } from '../../../utils/meter';
import { stepCells, type StepCell } from '../../sequencerGrid';
import { clampLeadLoopLength, loopLengthDivisors, type LeadNote } from '../../../audio/leadMelody';
import {
  initSynthPlayback,
  synthPlaybackNoteOff,
  synthPlaybackNoteOn,
} from '../../../audio/playback/synthPlayback';
import {
  LEAD_CELL_WIDTH,
  LEAD_WINDOW_OCTAVES,
  isBlackKey,
  isRootNote,
  leadCellKinds,
  leadPitchRows,
  leadSpanClasses,
  leadStoredIndex,
  resolveLeadCellSpan,
} from './melodyGrid';
import { useCurrentStep } from '../../playbackStep';
import { useLeadPlayback } from './useLeadPlayback';
import { useLeadNoteResize } from './useLeadNoteResize';
import { useLeadNotePaint } from './useLeadNotePaint';
import { Slider } from '@/components/ui/Slider';

/** Fixed width (px) of the note-name column, shared by the header spacer. */
const LABEL_WIDTH = 44;

/**
 * The moving column. Split out with an explicit prop so the geometry stays
 * unit-testable: LeadMelodyGrid owns useLeadPlayback now, and renderToString
 * cannot force a playing store state (zustand v5 serves
 * selector(api.getInitialState()) as the server snapshot — see
 * ui/BottomInputDock.tsx:9-21).
 */
export const LeadPlayhead: React.FC<{ currentStep: number }> = ({ currentStep }) => (
  <div
    className="pointer-events-none absolute top-0 bottom-0 bg-primary/20 ring-1 ring-inset ring-primary"
    style={{
      width: LEAD_CELL_WIDTH,
      transform: `translateX(${currentStep * LEAD_CELL_WIDTH}px)`,
    }}
  />
);

// Memoized: props are stable across clock ticks, so the cells never re-render
// when only the playhead moves.
const LeadMelodyCells = React.memo(function LeadMelodyCells({
  meter,
  loopLength,
  melody,
  rows,
  root,
  onResize,
}: {
  meter: Meter;
  loopLength: number;
  melody: readonly LeadNote[][];
  rows: readonly string[];
  root: string;
  onResize: (stepIndex: number, note: string, len: number) => void;
}) {
  const stepsPerBar = meter.stepsPerBar;
  const columns = loopLength * stepsPerBar;
  const cellsPerBar = stepCells(meter);
  const { preview, startResize } = useLeadNoteResize();
  // Column → stored index. Stored indices are bar-major at MAX_STEPS_PER_BAR,
  // so this is not the identity and a skipped-cell fill must go through it.
  const resolveStepIndex = useCallback(
    (col: number) => leadStoredIndex(Math.floor(col / stepsPerBar), col % stepsPerBar),
    [stepsPerBar],
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
    () => leadCellKinds(previewed, rows, columns, stepsPerBar),
    [previewed, rows, columns, stepsPerBar],
  );

  return (
    <div
      className="grid shrink-0"
      style={{ gridTemplateColumns: `repeat(${columns}, ${LEAD_CELL_WIDTH}px)` }}
    >
      {rows.map((note) => {
        const rowKinds = kinds.get(note) ?? [];
        return (
          <React.Fragment key={note}>
            {Array.from({ length: columns }, (_, col) => {
              const barIndex = Math.floor(col / stepsPerBar);
              const stepInBar = col - barIndex * stepsPerBar;
              const idx = leadStoredIndex(barIndex, stepInBar);
              const kind = rowKinds[col] ?? 'none';
              const span = leadSpanClasses(kind, rowKinds[col + 1] ?? 'none');
              const cell = cellsPerBar[stepInBar];

              const inactive = isRootNote(note, root)
                ? 'bg-primary/20'
                : isBlackKey(note)
                  ? 'bg-roll-key-black'
                  : 'bg-roll-key-white';

              const sep =
                barIndex > 0 && stepInBar === 0
                  ? 'border-l-2 border-l-base-content/50'
                  : cell.isBeatStart && stepInBar > 0
                    ? 'border-l border-l-base-content/30'
                    : '';

              const { spanStartIdx, spanLen, endsSpan, startCol } = resolveLeadCellSpan(
                rowKinds,
                col,
                stepsPerBar,
                note,
                previewed,
              );

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
                    onResize(spanStartIdx, note, spanLen + (e.key === 'ArrowRight' ? 1 : -1));
                  }}
                  className={`relative h-5 border border-base-300 ${span || inactive} ${
                    kind === 'none' || kind === 'start' ? sep : ''
                  }`}
                >
                  {endsSpan && (
                    <span
                      aria-hidden="true"
                      onPointerDown={(e) =>
                        startResize(e, spanStartIdx, note, spanLen, columns - startCol)
                      }
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
  stepsPerBar,
  columns,
  cellsPerBar,
}: {
  stepsPerBar: number;
  columns: number;
  cellsPerBar: StepCell[];
}) {
  return (
    <>
      {/* Bar-number header */}
      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
        <div className="flex shrink-0">
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / stepsPerBar);
            const stepInBar = col - barIndex * stepsPerBar;
            return (
              <div
                key={col}
                className="text-[8px] leading-none text-center font-bold text-base-content/60"
                style={{ width: LEAD_CELL_WIDTH }}
              >
                {stepInBar === 0 ? barIndex + 1 : ''}
              </div>
            );
          })}
        </div>
      </div>

      {/* Beat-number header */}
      <div className="flex">
        <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
        <div className="flex shrink-0">
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / stepsPerBar);
            const stepInBar = col - barIndex * stepsPerBar;
            const cell = cellsPerBar[stepInBar];
            return (
              <div
                key={col}
                className="text-[9px] leading-none text-center text-base-content/50"
                style={{ width: LEAD_CELL_WIDTH }}
              >
                {cell.isBeatStart ? cell.beatIndex + 1 : ''}
              </div>
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
  // both simple and pro mode), which is the requirement — useLeadPlayback
  // subscribes the clock and owns the hard stop.
  const { isPlaying } = useLeadPlayback();
  const currentStep = useCurrentStep('lead');
  const meterId = useAppStore((s) => s.meterId);
  const leadMelodySteps = useAppStore((s) => s.leadMelodySteps);
  const leadLoopLength = useAppStore((s) => s.leadLoopLength);
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
  const cellsPerBar = useMemo(() => stepCells(meter), [meter]);

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

  const setLeadNoteLength = useAppStore((s) => s.setLeadNoteLength);
  const onResize = useCallback(
    (stepIndex: number, note: string, len: number) => setLeadNoteLength(stepIndex, note, len),
    [setLeadNoteLength],
  );

  const clearMelody = useCallback(
    () => setLeadMelodySteps(leadMelodySteps.map(() => [] as LeadNote[])),
    [leadMelodySteps, setLeadMelodySteps],
  );

  const previewNote = useCallback(
    (note: string) => {
      initSynthPlayback();
      synthPlaybackNoteOn(note, synthParams, 0.8);
      window.setTimeout(() => synthPlaybackNoteOff(note, synthParams.release), 220);
    },
    [synthParams],
  );

  const columns = leadLoopLength * stepsPerBar;

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
          <div className="w-fit mx-auto">
            <LeadMelodyHeaders
              stepsPerBar={stepsPerBar}
              columns={columns}
              cellsPerBar={cellsPerBar}
            />

            {/* Body: note column + cells + playhead */}
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

              <div className="relative shrink-0">
                <LeadMelodyCells
                  meter={meter}
                  loopLength={leadLoopLength}
                  melody={leadMelodySteps}
                  rows={rows}
                  root={scaleRoot}
                  onResize={onResize}
                />
                {isPlaying && <LeadPlayhead currentStep={currentStep} />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
