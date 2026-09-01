import React from "react";
import type { StepCell } from "../sequencerGrid";
import { useCurrentStep, type StepPlayerId } from "../playbackStep";

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
  /**
   * Stable DOM id per step button. TrackRow has stamped
   * `step-${track.id}-${index}` on its buttons since before this primitive
   * existed; nothing queries it today, but it is a reasonable convention to
   * preserve and the sequencer rows are the one grid a user can address by
   * track.
   */
  getButtonId?: (index: number) => string;
  /**
   * What an ACTIVE step draws on top of its fill.
   *
   * `'label'` (default) is the `getLabel` badge the chord and bass grids use.
   * `'pulse'` is the sequencer's `bg-base-content/10 animate-pulse` overlay —
   * the one difference that kept TrackRow off this primitive.
   */
  activeOverlay?: 'label' | 'pulse';
  /**
   * Classes on the row container. Defaults to the chord/bass grids' own
   * wrapper; the sequencer's row sits inside a flex header and needs `flex-1`.
   */
  rowClassName?: string;
  /** Fired on click with the 0-based step index. The parent cycles the value. */
  onStepClick: (index: number) => void;
}

/**
 * A theme-agnostic step grid row — the single implementation of a step button
 * app-wide. The chord on/off grid, the bass tone-choice grid and the
 * sequencer's drum/synth lanes all render through this; the per-step VALUE is
 * generic, the active fill colour is the caller's module token, and the active
 * overlay is either a short label or the sequencer's pulse.
 */
export function StepRow<T>({
  cells,
  steps,
  currentStep,
  isPlaying,
  color,
  isActive,
  getLabel,
  getButtonId,
  activeOverlay = 'label',
  rowClassName = 'flex items-center gap-1.5',
  onStepClick,
}: StepRowProps<T>) {
  return (
    <div className={rowClassName}>
      {cells.map((cell) => {
        const value = steps[cell.index];
        const active = value !== undefined && isActive(value);
        const isCurrent = isPlaying && currentStep === cell.index;
        return (
          <button
            key={cell.index}
            id={getButtonId?.(cell.index)}
            onClick={() => onStepClick(cell.index)}
            className={`flex-1 h-9 rounded-field transition-all cursor-pointer relative ${
              active
                ? `${color} shadow-md shadow-primary/20 scale-[0.96]`
                : cell.isAltBeatGroup
                  ? "bg-base-100 hover:bg-base-300 border border-base-300/50"
                  : "bg-base-200 hover:bg-base-300 border border-base-300/40"
            } ${isCurrent ? "ring-2 ring-primary brightness-125" : ""}`}
          >
            {active && activeOverlay === 'pulse' ? (
              <div className="absolute inset-0 bg-base-content/10 rounded-field animate-pulse" />
            ) : active && getLabel ? (
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

/**
 * A StepRow that reads the transport position itself.
 *
 * The playhead used to arrive as a prop from ChordView, so the whole 1342-line
 * view re-rendered 8x/sec to deliver a value that is only rendered in the
 * 'custom' pattern modes. Subscribing here confines the per-step re-render to
 * this row.
 */
export function PlayingStepRow<T>({
  player,
  ...rest
}: Omit<StepRowProps<T>, 'currentStep'> & { player: StepPlayerId }) {
  const currentStep = useCurrentStep(player);
  return <StepRow<T> {...rest} currentStep={currentStep} />;
}
