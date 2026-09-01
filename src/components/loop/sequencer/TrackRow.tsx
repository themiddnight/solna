import React, { useCallback } from "react";
import { Play } from "lucide-react";
import type { SequencerTrack } from "../../../types";
import type { StepCell } from "../../sequencerGrid";
import { PowerToggle } from "../../ui/PowerToggle";
import { StepRow } from "../../ui/StepRow";

export interface TrackRowProps {
  track: SequencerTrack;
  cells: StepCell[];
  currentStep: number;
  isPlaying: boolean;
  onToggleStep: (trackId: string, stepIndex: number) => void;
  onToggleMute: (trackId: string) => void;
  onPreview: (track: SequencerTrack) => void;
}

/** Module-level so its identity never changes across renders. */
const IS_ON = (value: boolean) => value === true;

/**
 * One drum/synth lane. Memoized: the three callbacks are stable useCallbacks
 * in SequencerView and `cells` is memoized there, so a knob drag or a genre
 * change in the parent no longer rebuilds this row's 16 step buttons.
 * `currentStep` is a real prop, so a transport tick DOES still re-render
 * every row — the column highlight is per-step data each row needs.
 *
 * The step buttons render through ui/StepRow, which was written to generalize
 * exactly this markup (its class expression was byte-for-byte identical to the
 * copy that used to live here) but was never wired up to it. The two
 * differences that kept them apart — the pulse overlay and the per-step DOM id
 * — are now StepRow props.
 */
export const TrackRow: React.FC<TrackRowProps> = React.memo(
  ({ track, cells, currentStep, isPlaying, onToggleStep, onToggleMute, onPreview }) => {
    // Derived from track.id, so they are memoized on it: StepRow is not itself
    // memoized today, so this is not load-bearing yet — it is what makes
    // wrapping StepRow in React.memo later a one-line change instead of a
    // silent no-op.
    const handleStepClick = useCallback(
      (index: number) => onToggleStep(track.id, index),
      [track.id, onToggleStep],
    );
    const getButtonId = useCallback((index: number) => `step-${track.id}-${index}`, [track.id]);

    return (
      <div
        id={`sequencer-row-${track.id}`}
        className="flex items-center gap-2 bg-base-200 p-2 rounded-box border border-base-300 hover:border-primary/40 transition-colors"
      >
        {/* Track Info & Mute */}
        <div className="w-40 flex items-center justify-between pr-2 border-r border-base-300">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${track.color}`} />
            <span className="text-xs font-bold text-base-content truncate">
              {track.name}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onPreview(track)}
              className="btn btn-ghost btn-xs btn-square hover:text-primary"
              title="Preview Instrument"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
            <PowerToggle
              id={`btn-mute-${track.id}`}
              on={!track.muted}
              onToggle={() => onToggleMute(track.id)}
              name={track.name}
              tone="primary"
              iconOnly
              size="xs"
              verb={{ on: 'Unmute', off: 'Mute' }}
            />
          </div>
        </div>

        {/* Step Buttons — the visible window of this row */}
        <StepRow<boolean>
          cells={cells}
          steps={track.steps}
          currentStep={currentStep}
          isPlaying={isPlaying}
          color={track.color}
          isActive={IS_ON}
          getButtonId={getButtonId}
          activeOverlay="pulse"
          rowClassName="flex-1 flex items-center gap-1.5"
          onStepClick={handleStepClick}
        />
      </div>
    );
  },
);
