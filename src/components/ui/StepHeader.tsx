import React from "react";
import type { StepCell } from "../sequencerGrid";
import { useCurrentStep, type StepPlayerId } from "../playbackStep";

/**
 * The drum grid's own container. The left padding clears TrackRow's label
 * gutter and MUST stay in step with it, or the numbers drift off the columns
 * they label: `pl-2` (8px) + gutter + `gap-2` (8px), i.e. `pl-38` for the
 * phone's `w-36` gutter and `pl-44` for the `sm:w-42` one. The min-widths are
 * SequencerGrid's, repeated because the strip is that grid's sibling, not its
 * child — both must be the same width for the columns to line up.
 */
const DRUM_HEADER_CLASS =
  'flex items-center gap-2 mb-2 pl-38 sm:pl-44 min-w-[600px] sm:min-w-[700px]';

export interface StepHeaderProps {
  cells: StepCell[];
  currentStep: number;
  isPlaying: boolean;
  /**
   * Container classes, REPLACING the drum grid's default — a grid with no
   * label gutter must not inherit `pl-44`. Pass `STEP_ROW_CLASS` (plus any
   * margin) so the numbers share the buttons' column pitch.
   */
  className?: string;
}

/**
 * Step-number strip above the sequencer lanes. Memoized so the header is the
 * only thing that reconciles when nothing but the transport moved.
 */
export const StepHeader: React.FC<StepHeaderProps> = React.memo(
  ({ cells, currentStep, isPlaying, className = DRUM_HEADER_CLASS }) => (
    <div className={className}>
      {cells.map((cell) => {
        const isCurrent = currentStep === cell.index && isPlaying;
        return (
          <div
            key={cell.index}
            className={`flex-1 text-center tabular-nums text-[10px] py-1 rounded transition-all ${
              isCurrent
                ? "bg-primary text-primary-content font-bold shadow-md shadow-primary/50"
                : cell.isBeatStart
                  ? "text-accent font-bold bg-base-300/40"
                  : "text-base-content/50"
            }`}
          >
            {cell.label}
          </div>
        );
      })}
    </div>
  ),
);

/**
 * A StepHeader that reads the transport position itself, mirroring
 * `PlayingStepRow`. The chord and bass grids have no owner above them holding
 * the step — ChordModulePanel must not re-render 8x/sec just to move a number
 * strip, which is the whole reason the row subscribes at the leaf.
 */
export const PlayingStepHeader: React.FC<
  Omit<StepHeaderProps, 'currentStep'> & { player: StepPlayerId }
> = ({ player, ...rest }) => {
  const currentStep = useCurrentStep(player);
  return <StepHeader {...rest} currentStep={currentStep} />;
};
