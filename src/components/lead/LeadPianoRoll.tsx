import React, { useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/store';
import { getMeter, type Meter } from '../../utils/meter';
import { stepCells } from '../sequencerGrid';
import { clampLeadLoopLength, loopLengthDivisors } from '../../audio/leadMelody';
import {
  initSynthPlayback,
  synthPlaybackNoteOff,
  synthPlaybackNoteOn,
} from '../../audio/playback/synthPlayback';
import {
  LEAD_CELL_WIDTH,
  LEAD_WINDOW_OCTAVES,
  hasOutOfScaleNote,
  isBlackKey,
  isRootNote,
  leadPitchRows,
  leadStoredIndex,
} from './pianoRoll';
import type { LeadMelodyView } from '../../store/types';

export interface LeadPianoRollProps {
  currentStep: number;
  isPlaying: boolean;
}

/** Fixed width (px) of the note-name column, shared by the header spacer. */
const LABEL_WIDTH = 44;

// Memoized: props are stable across clock ticks, so the cells never re-render
// when only the playhead moves.
const LeadPianoCells = React.memo(function LeadPianoCells({
  meter,
  loopLength,
  melody,
  rows,
  root,
  scaleType,
  view,
  onToggle,
}: {
  meter: Meter;
  loopLength: number;
  melody: readonly string[][];
  rows: readonly string[];
  root: string;
  scaleType: string;
  view: LeadMelodyView;
  onToggle: (stepIndex: number, note: string) => void;
}) {
  const stepsPerBar = meter.stepsPerBar;
  const columns = loopLength * stepsPerBar;
  const cellsPerBar = stepCells(meter);

  return (
    <div
      className="grid shrink-0"
      style={{ gridTemplateColumns: `repeat(${columns}, ${LEAD_CELL_WIDTH}px)` }}
    >
      {rows.map((note) => (
        <React.Fragment key={note}>
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / stepsPerBar);
            const stepInBar = col - barIndex * stepsPerBar;
            const idx = leadStoredIndex(barIndex, stepInBar);
            const active = melody[idx]?.includes(note) ?? false;
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

            return (
              <button
                key={`${note}-${col}`}
                type="button"
                aria-label={note}
                aria-pressed={active}
                onClick={() => onToggle(idx, note)}
                className={`h-5 border border-base-300 ${
                  active ? 'bg-primary text-primary-content' : inactive
                } ${sep}`}
              />
            );
          })}
        </React.Fragment>
      ))}
      {view === 'scale-locked' && (
        <React.Fragment key="out-of-scale">
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / stepsPerBar);
            const stepInBar = col - barIndex * stepsPerBar;
            const idx = leadStoredIndex(barIndex, stepInBar);
            const outOfScale = hasOutOfScaleNote(melody[idx] ?? [], root, scaleType);
            const sep =
              barIndex > 0 && stepInBar === 0
                ? 'border-l-2 border-l-base-content/50'
                : '';
            return (
              <div
                key={`oos-${col}`}
                className={`h-5 border border-base-300 ${
                  outOfScale ? 'bg-warning' : 'bg-base-200'
                } ${sep}`}
              />
            );
          })}
        </React.Fragment>
      )}
    </div>
  );
});

export const LeadPianoRoll: React.FC<LeadPianoRollProps> = ({ currentStep, isPlaying }) => {
  const meterId = useAppStore((s) => s.meterId);
  const leadMelodySteps = useAppStore((s) => s.leadMelodySteps);
  const leadLoopLength = useAppStore((s) => s.leadLoopLength);
  const leadMelodyView = useAppStore((s) => s.leadMelodyView);
  const leadMelodyOctave = useAppStore((s) => s.leadMelodyOctave);
  const setLeadMelodyView = useAppStore((s) => s.setLeadMelodyView);
  const setLeadMelodyOctave = useAppStore((s) => s.setLeadMelodyOctave);
  const setLeadLoopLength = useAppStore((s) => s.setLeadLoopLength);
  const setLeadMelodySteps = useAppStore((s) => s.setLeadMelodySteps);
  const toggleLeadNote = useAppStore((s) => s.toggleLeadNote);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const chords = useAppStore((s) => s.chords);
  const synthParams = useAppStore((s) => s.synthParams);

  const meter = getMeter(meterId);
  const stepsPerBar = meter.stepsPerBar;
  const totalBars = chords.reduce((sum, c) => sum + (c.bars || 1), 0);
  const divisors = loopLengthDivisors(totalBars);
  const cellsPerBar = useMemo(() => stepCells(meter), [meter]);

  const rows = useMemo(
    () =>
      leadPitchRows(leadMelodyView, scaleRoot, scaleType, leadMelodyOctave, LEAD_WINDOW_OCTAVES),
    [leadMelodyView, scaleRoot, scaleType, leadMelodyOctave],
  );

  // Clamp loopLength down when the progression no longer divides it.
  useEffect(() => {
    const clamped = clampLeadLoopLength(leadLoopLength, totalBars);
    if (clamped !== leadLoopLength) setLeadLoopLength(clamped);
  }, [totalBars, leadLoopLength, setLeadLoopLength]);

  const onToggle = useCallback(
    (stepIndex: number, note: string) => toggleLeadNote(stepIndex, note),
    [toggleLeadNote],
  );

  const clearMelody = useCallback(
    () => setLeadMelodySteps(leadMelodySteps.map(() => [] as string[])),
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
              onClick={() => setLeadMelodyOctave(Math.max(1, leadMelodyOctave - 1))}
              className="btn btn-xs btn-square btn-ghost border border-base-300"
              title="Octave window down"
            >
              -
            </button>
            <span className="text-xs font-mono">{leadMelodyOctave}</span>
            <button
              id="btn-lead-octave-up"
              type="button"
              onClick={() => setLeadMelodyOctave(Math.min(6, leadMelodyOctave + 1))}
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

        <div className="overflow-x-auto">
          <div className="w-fit mx-auto">
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
                {leadMelodyView === 'scale-locked' && (
                  <div className="h-5 flex items-center justify-end pr-2 text-[10px] leading-none text-warning">
                    ♯
                  </div>
                )}
              </div>

              <div className="relative shrink-0">
                <LeadPianoCells
                  meter={meter}
                  loopLength={leadLoopLength}
                  melody={leadMelodySteps}
                  rows={rows}
                  root={scaleRoot}
                  scaleType={scaleType}
                  view={leadMelodyView}
                  onToggle={onToggle}
                />
                {isPlaying && (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 bg-primary/20 ring-1 ring-inset ring-primary"
                    style={{
                      width: LEAD_CELL_WIDTH,
                      transform: `translateX(${currentStep * LEAD_CELL_WIDTH}px)`,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
