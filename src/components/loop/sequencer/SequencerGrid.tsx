import React from 'react';
import { useAppStore } from '@/store/store';
import { useSequencerPlayback } from '@/components/useSequencerPlayback';
import { useCurrentStep } from '@/components/playbackStep';
import { StepHeader } from '@/components/ui/StepHeader';
import { TrackRow } from './TrackRow';
import type { StepCell } from '@/components/sequencerGrid';
import type { SequencerTrack } from '@/types';

export interface SequencerGridProps {
  tracks: SequencerTrack[];
  cells: StepCell[];
  onToggleStep: (trackId: string, stepIndex: number) => void;
  onToggleMute: (trackId: string) => void;
  onPreview: (track: SequencerTrack) => void;
  onVolumeChange: (trackId: string, db: number) => void;
}

/**
 * Owns the sequencer's step subscription so the rest of SequencerView does not
 * re-render 8-16 times a second — including while the Sequencer tab is hidden,
 * which App.tsx keeps mounted by design.
 *
 * `useSequencerPlayback` must be mounted EXACTLY once (it subscribes the clock
 * and owns the soft stop); SequencerView renders this child exactly once.
 *
 * TrackRow's memo contract (TrackRow.tsx) is unchanged on purpose: currentStep
 * is still a real prop, so a transport tick still re-renders every row — the
 * column highlight is per-step data each row needs. What this component
 * removes is everything ABOVE the grid re-rendering with them.
 */
export function SequencerGrid({
  tracks,
  cells,
  onToggleStep,
  onToggleMute,
  onPreview,
  onVolumeChange,
}: SequencerGridProps) {
  useSequencerPlayback();
  const currentStep = useCurrentStep('sequencer');
  const isPlaying = useAppStore((s) => s.sequencerPlayer !== 'stopped');

  return (
    <div className="overflow-x-auto">
      {/* Step Indicator Header — one cell per step of the active bar */}
      <StepHeader cells={cells} currentStep={currentStep} isPlaying={isPlaying} />

      {/* Track Lanes. The min-width is what makes a step button SQUARE: the
          buttons are `aspect-square`, so their height follows the width this
          floor leaves them once the gutter and the fifteen gaps are paid for
          (~27px on a phone at 660, ~26px on a tablet at 700). Below it the row
          scrolls and TrackRow's gutter stays pinned. Any change here must be
          mirrored in StepHeader's DRUM_HEADER_CLASS. */}
      <div className="space-y-1.5 sm:space-y-2 min-w-[660px] sm:min-w-[700px]">
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            cells={cells}
            currentStep={currentStep}
            isPlaying={isPlaying}
            onToggleStep={onToggleStep}
            onToggleMute={onToggleMute}
            onPreview={onPreview}
            onVolumeChange={onVolumeChange}
          />
        ))}
      </div>
    </div>
  );
}
