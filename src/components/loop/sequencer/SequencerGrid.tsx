import React from 'react';
import { useAppStore } from '../../../store/store';
import { useSequencerPlayback } from '../../useSequencerPlayback';
import { useCurrentStep } from '../../playbackStep';
import { StepHeader } from '../../ui/StepHeader';
import { TrackRow } from './TrackRow';
import type { StepCell } from '../../sequencerGrid';
import type { SequencerTrack } from '../../../types';

export interface SequencerGridProps {
  tracks: SequencerTrack[];
  cells: StepCell[];
  onToggleStep: (trackId: string, stepIndex: number) => void;
  onToggleMute: (trackId: string) => void;
  onPreview: (track: SequencerTrack) => void;
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
export const SequencerGrid: React.FC<SequencerGridProps> = ({
  tracks,
  cells,
  onToggleStep,
  onToggleMute,
  onPreview,
}) => {
  useSequencerPlayback();
  const currentStep = useCurrentStep('sequencer');
  const isPlaying = useAppStore((s) => s.sequencerPlayer !== 'stopped');

  return (
    <div className="overflow-x-auto">
      {/* Step Indicator Header — one cell per step of the active bar */}
      <StepHeader cells={cells} currentStep={currentStep} isPlaying={isPlaying} />

      {/* Track Lanes. The min-width keeps a step button ~24px wide rather than
          letting 16 of them squeeze to nothing on a phone; the row scrolls
          instead, and TrackRow's gutter stays pinned while it does. Any change
          here must be mirrored in StepHeader's DRUM_HEADER_CLASS. */}
      <div className="space-y-2 min-w-[600px] sm:min-w-[700px]">
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
          />
        ))}
      </div>
    </div>
  );
};
