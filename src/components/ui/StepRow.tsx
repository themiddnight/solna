import React from "react";
import type { StepCell } from "../sequencerGrid";

export interface StepRowProps<T> {
  /** Machine-computed cell metadata (index, beat grouping) from stepCells(). */
  cells: StepCell[];
  /** One value per visible step; length should match cells.length. */
  steps: readonly T[];
  /** The currently sounding step index (a step that is not playing is ignored). */
  currentStep: number;
  /** Whether the owning player is running (gates the playhead ring). */
  isPlaying: boolean;
  /**
   * Classes applied to ACTIVE steps. The caller owns the module colour here —
   * chord passes `bg-module-chord text-module-chord-content`, bass passes
   * `bg-module-bass text-module-bass-content` — so the primitive stays
   * theme-agnostic and never names a colour itself.
   */
  color: string;
  /** Whether a step value counts as "on" (filled). */
  isActive: (value: T) => boolean;
  /** Optional short label for active steps (e.g. bass tone letters). */
  getLabel?: (value: T) => React.ReactNode;
  /** Fired on click with the 0-based step index. The parent cycles the value. */
  onStepClick: (index: number) => void;
}

/**
 * A theme-agnostic step grid row. The step-button class conventions mirror
 * TrackRow (daisyUI role classes only; active steps wear the caller's module
 * colour), the only difference being the per-step VALUE is generic — so a
 * boolean hit grid and a chord-tone-choice grid share one implementation.
 */
export function StepRow<T>({
  cells,
  steps,
  currentStep,
  isPlaying,
  color,
  isActive,
  getLabel,
  onStepClick,
}: StepRowProps<T>) {
  return (
    <div className="flex items-center gap-1.5">
      {cells.map((cell) => {
        const value = steps[cell.index];
        const active = value !== undefined && isActive(value);
        const isCurrent = isPlaying && currentStep === cell.index;
        return (
          <button
            key={cell.index}
            onClick={() => onStepClick(cell.index)}
            className={`flex-1 h-9 rounded-field transition-all cursor-pointer relative ${
              active
                ? `${color} shadow-md shadow-primary/20 scale-[0.96]`
                : cell.isAltBeatGroup
                  ? "bg-base-100 hover:bg-base-300 border border-base-300/50"
                  : "bg-base-200 hover:bg-base-300 border border-base-300/40"
            } ${isCurrent ? "ring-2 ring-primary brightness-125" : ""}`}
          >
            {active && getLabel ? (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold leading-none pointer-events-none select-none">
                {getLabel(value)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
