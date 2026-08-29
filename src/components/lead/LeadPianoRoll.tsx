import React, { useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/store';
import { getMeter } from '../../utils/meter';
import { clampLeadLoopLength, loopLengthDivisors } from '../../audio/leadMelody';
import {
  LEAD_CELL_WIDTH,
  LEAD_WINDOW_OCTAVES,
  hasOutOfScaleNote,
  leadPitchRows,
  leadStoredIndex,
} from './pianoRoll';
import type { LeadMelodyView } from '../../store/types';

export interface LeadPianoRollProps {
  currentStep: number;
  isPlaying: boolean;
}

// Memoized grid: props are stable across clock ticks, so the cells never
// re-render when only the playhead moves.
const LeadPianoGrid = React.memo(function LeadPianoGrid({
  stepsPerBar,
  loopLength,
  melody,
  rows,
  root,
  scaleType,
  view,
  onToggle,
}: {
  stepsPerBar: number;
  loopLength: number;
  melody: readonly string[][];
  rows: readonly string[];
  root: string;
  scaleType: string;
  view: LeadMelodyView;
  onToggle: (stepIndex: number, note: string) => void;
}) {
  const columns = loopLength * stepsPerBar;
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${columns}, ${LEAD_CELL_WIDTH}px)` }}
    >
      {rows.map((note) => (
        <React.Fragment key={note}>
          {Array.from({ length: columns }, (_, col) => {
            const barIndex = Math.floor(col / stepsPerBar);
            const stepInBar = col - barIndex * stepsPerBar;
            const idx = leadStoredIndex(barIndex, stepInBar);
            const active = melody[idx]?.includes(note) ?? false;
            return (
              <button
                key={`${note}-${col}`}
                type="button"
                aria-label={note}
                aria-pressed={active}
                onClick={() => onToggle(idx, note)}
                className={`h-5 border border-base-300 ${
                  active ? 'bg-primary text-primary-content' : 'bg-base-200 hover:bg-base-300'
                }`}
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
            return (
              <div
                key={`oos-${col}`}
                className={`h-5 border border-base-300 ${
                  outOfScale ? 'bg-warning' : 'bg-base-200'
                }`}
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
  const toggleLeadNote = useAppStore((s) => s.toggleLeadNote);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const chords = useAppStore((s) => s.chords);

  const stepsPerBar = getMeter(meterId).stepsPerBar;
  const totalBars = chords.reduce((sum, c) => sum + (c.bars || 1), 0);
  const divisors = loopLengthDivisors(totalBars);

  const rows = useMemo(
    () =>
      leadPitchRows(
        leadMelodyView,
        scaleRoot,
        scaleType,
        leadMelodyOctave,
        LEAD_WINDOW_OCTAVES,
      ),
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
          </div>
        </div>

        <div className="relative overflow-x-auto">
          <LeadPianoGrid
            stepsPerBar={stepsPerBar}
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
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary"
              style={{ transform: `translateX(${currentStep * LEAD_CELL_WIDTH}px)` }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
