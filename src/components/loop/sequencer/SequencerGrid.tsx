import React from 'react';
import { useAppStore } from '@/store/store';
import { useSegmentGatedStep } from '@/components/playbackStep';
import { StepHeader } from '@/components/ui/StepHeader';
import { TrackRow } from './TrackRow';
import { BEAT_VOICE_ROWS } from '@/components/loop/beat/beatVoices';
import type { StepCell } from '@/components/sequencerGrid';
import type { BeatMix, BeatPattern, BeatVoiceId } from '@/types';

export interface SequencerGridProps {
  pattern: BeatPattern;
  mix: BeatMix;
  cells: StepCell[];
  onToggleStep: (voice: BeatVoiceId, stepIndex: number) => void;
  onToggleMute: (voice: BeatVoiceId) => void;
  onPreview: (voice: BeatVoiceId) => void;
  onVolumeChange: (voice: BeatVoiceId, db: number) => void;
}

/**
 * Owns the sequencer's step subscription so the rest of SequencerView does not
 * re-render 8-16 times a second — including while the Sequencer tab is hidden,
 * which App.tsx keeps mounted by design.
 *
 * The Beat lane's controller is NOT mounted here: `useSequencerPlayback` lives
 * in `PlaybackHost` (components/playback/), mounted once in App.tsx, so the
 * lane sounds whether or not this grid is mounted.
 *
 * TrackRow's memo contract (TrackRow.tsx) is unchanged on purpose: currentStep
 * is still a real prop, so a transport tick still re-renders every row — the
 * column highlight is per-step data each row needs. What this component
 * removes is everything ABOVE the grid re-rendering with them.
 *
 * The step subscription is also gated on Pattern-segment focus
 * (`useSegmentGatedStep`, `'beat'`): every Pattern segment stays mounted, so
 * without the gate this grid kept re-rendering at the clock's rate even while
 * Lead, FX or Accompaniment was the segment on screen. The Beat audio is
 * unaffected: `useSequencerPlayback`, in `PlaybackHost`,
 * schedules it unconditionally, whatever segment is focused.
 */
export function SequencerGrid({
  pattern,
  mix,
  cells,
  onToggleStep,
  onToggleMute,
  onPreview,
  onVolumeChange,
}: SequencerGridProps) {
  const currentStep = useSegmentGatedStep('sequencer', 'beat');
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
      <div className="min-w-[660px] sm:min-w-[700px] rounded-box border border-base-300 overflow-clip divide-y divide-base-300">
        {/* One row per CANONICAL voice, in the roster's order — not per stored
            row. The roster is the same list `planBeatStep` walks, so what the
            grid draws and what the clock plays can never be two different
            rosters. */}
        {BEAT_VOICE_ROWS.map((voice) => (
          <TrackRow
            key={voice.id}
            voiceId={voice.id}
            steps={pattern.rows[voice.id]}
            mix={mix.voices[voice.id]}
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
