import { beatIndexAt, isBeatBoundary, type Meter } from '../utils/meter';

/**
 * Pure view-model for the sequencer grid, kept out of SequencerView.tsx so it
 * can be tested without rendering React — this repo has no DOM/testing-library
 * setup and every component's testable logic is exported like this.
 */

/**
 * The machine-computed half of the old header string. The name itself now
 * lives in VIEW_META, so this returns only what belongs in the badge.
 */
export function sequencerMeterBadge(meter: Meter): string {
  return `${meter.stepsPerBar}-Step · ${meter.label}`;
}

export interface StepCell {
  /** 0-based step index within the bar. */
  index: number;
  /** 1-based number shown in the step header. */
  label: number;
  /** First step of an accent group — the old `i % 4 === 0`. */
  isBeatStart: boolean;
  /** Which accent group this step belongs to. */
  beatIndex: number;
  /** Alternating group shading — the old `Math.floor(stepIdx / 4) % 2 === 0`. */
  isAltBeatGroup: boolean;
}

export function stepCells(meter: Meter): StepCell[] {
  const cells: StepCell[] = [];
  for (let index = 0; index < meter.stepsPerBar; index++) {
    const beatIndex = beatIndexAt(index, meter.accentGroups);
    cells.push({
      index,
      label: index + 1,
      isBeatStart: isBeatBoundary(index, meter.accentGroups),
      beatIndex,
      isAltBeatGroup: beatIndex % 2 === 0,
    });
  }
  return cells;
}
