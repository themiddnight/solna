import React from "react";
import type { StepCell } from "../../sequencerGrid";

export interface StepHeaderProps {
  cells: StepCell[];
  currentStep: number;
  isPlaying: boolean;
}

/**
 * Step-number strip above the sequencer lanes. Memoized so the header is the
 * only thing that reconciles when nothing but the transport moved.
 */
export const StepHeader: React.FC<StepHeaderProps> = React.memo(
  ({ cells, currentStep, isPlaying }) => (
    <div className="flex items-center gap-2 mb-2 pl-44 min-w-[700px]">
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
