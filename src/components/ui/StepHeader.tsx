import React from "react";
import type { StepCell } from "../sequencerGrid";
import { useCurrentStep, type StepPlayerId } from "../playbackStep";

/**
 * The drum grid's own container. The left padding clears TrackRow's label
 * gutter and MUST stay in step with it, or the numbers drift off the columns
 * they label: gutter + the row's `gap-2` (8px), i.e. `pl-34` for the phone's
 * `w-32` gutter and `pl-44` for the `sm:w-42` one. The min-widths are
 * SequencerGrid's, repeated because the strip is that grid's sibling, not its
 * child — both must be the same width for the columns to line up, and the
 * `pr-2` is TrackRow's own right padding, without which the strip is 8px
 * wider than the buttons and every number leans left of its column. So must
 * the
 * GAP: these cells are `flex-1` in a flex row of their own, so a gap that
 * differs from StepRow's `gap-1.5` puts the numbers on a different column
 * pitch and the drift compounds across the sixteen of them — it was `gap-2`,
 * which walked the last number 7px off the button it labels.
 */
const DRUM_HEADER_CLASS =
  'flex items-center gap-1.5 mb-2 pl-34 sm:pl-44 pr-2 min-w-[660px] sm:min-w-[700px]';

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
export const StepHeader = React.memo(
  function StepHeader({ cells, currentStep, isPlaying, className = DRUM_HEADER_CLASS }: StepHeaderProps) {
    return (
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
    );
  },
);

/**
 * A StepHeader that reads the transport position itself, mirroring
 * `PlayingStepRow`. The chord and bass grids have no owner above them holding
 * the step — ChordModulePanel must not re-render 8x/sec just to move a number
 * strip, which is the whole reason the row subscribes at the leaf.
 */
export function PlayingStepHeader({ player, ...rest }: Omit<StepHeaderProps, 'currentStep'> & { player: StepPlayerId }) {
  const currentStep = useCurrentStep(player);
  return <StepHeader {...rest} currentStep={currentStep} />;
}
