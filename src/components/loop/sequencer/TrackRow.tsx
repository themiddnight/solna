import React from "react";
import { Play } from "lucide-react";
import type { SequencerTrack } from "../../../types";
import type { StepCell } from "../../sequencerGrid";
import { PowerToggle } from "../../ui/PowerToggle";

export interface TrackRowProps {
  track: SequencerTrack;
  cells: StepCell[];
  currentStep: number;
  isPlaying: boolean;
  onToggleStep: (trackId: string, stepIndex: number) => void;
  onToggleMute: (trackId: string) => void;
  onPreview: (track: SequencerTrack) => void;
}

/**
 * One drum/synth lane. Memoized: the three callbacks are stable useCallbacks
 * in SequencerView and `cells` is memoized there, so a knob drag or a genre
 * change in the parent no longer rebuilds this row's 16 step buttons.
 * `currentStep` is a real prop, so a transport tick DOES still re-render
 * every row — the column highlight is per-step data each row needs.
 */
export const TrackRow: React.FC<TrackRowProps> = React.memo(
  ({ track, cells, currentStep, isPlaying, onToggleStep, onToggleMute, onPreview }) => (
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
      <div className="flex-1 flex items-center gap-1.5">
        {cells.map((cell) => {
          const isActive = track.steps[cell.index] === true;
          const isCurrent = currentStep === cell.index && isPlaying;

          return (
            <button
              key={cell.index}
              id={`step-${track.id}-${cell.index}`}
              onClick={() => onToggleStep(track.id, cell.index)}
              className={`flex-1 h-9 rounded-field transition-all cursor-pointer relative ${
                isActive
                  ? `${track.color} shadow-md shadow-primary/20 scale-[0.96]`
                  : cell.isAltBeatGroup
                    ? "bg-base-100 hover:bg-base-300 border border-base-300/50"
                    : "bg-base-200 hover:bg-base-300 border border-base-300/40"
              } ${isCurrent ? "ring-2 ring-primary brightness-125" : ""}`}
            >
              {isActive && (
                <div className="absolute inset-0 bg-base-content/10 rounded-field animate-pulse" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  ),
);
