import React, { useCallback } from "react";
import { Play } from "lucide-react";
import type { SequencerTrack } from "@/types";
import type { StepCell } from "@/components/sequencerGrid";
import { PowerToggle } from "@/components/ui/PowerToggle";
import { StepRow } from "@/components/ui/StepRow";
import { IconButton } from "@/components/ui/IconButton";
import { VolumeFader } from "@/components/ui/VolumeFader";

export interface TrackRowProps {
  track: SequencerTrack;
  cells: StepCell[];
  currentStep: number;
  isPlaying: boolean;
  onToggleStep: (trackId: string, stepIndex: number) => void;
  onToggleMute: (trackId: string) => void;
  onPreview: (track: SequencerTrack) => void;
  onVolumeChange: (trackId: string, db: number) => void;
}

/** Module-level so its identity never changes across renders. */
const IS_ON = (value: boolean) => value === true;

/**
 * One drum/synth lane. Memoized: the three callbacks are stable useCallbacks
 * in SequencerView and `cells` is memoized there, so a knob drag or a genre
 * change in the parent no longer rebuilds this row's 16 step buttons.
 * `currentStep` is a real prop, so a transport tick DOES still re-render
 * every row — the column highlight is per-step data each row needs.
 *
 * The step buttons render through ui/StepRow, which was written to generalize
 * exactly this markup (its class expression was byte-for-byte identical to the
 * copy that used to live here) but was never wired up to it. The two
 * differences that kept them apart — the pulse overlay and the per-step DOM id
 * — are now StepRow props.
 */
export const TrackRow = React.memo(
  function TrackRow({
    track,
    cells,
    currentStep,
    isPlaying,
    onToggleStep,
    onToggleMute,
    onPreview,
    onVolumeChange,
  }: TrackRowProps) {
    // Derived from track.id, so they are memoized on it: StepRow is not itself
    // memoized today, so this is not load-bearing yet — it is what makes
    // wrapping StepRow in React.memo later a one-line change instead of a
    // silent no-op.
    const handleStepClick = useCallback(
      (index: number) => onToggleStep(track.id, index),
      [track.id, onToggleStep],
    );
    const getButtonId = useCallback((index: number) => `step-${track.id}-${index}`, [track.id]);
    const handleVolume = useCallback(
      (db: number) => onVolumeChange(track.id, db),
      [track.id, onVolumeChange],
    );

    return (
      <div
        id={`sequencer-row-${track.id}`}
        // `overflow-clip`, not `overflow-hidden`: steps scrolling under the
        // sticky gutter would otherwise show through the row's rounded left
        // corners, and only a clip rect trims them to the card's own shape.
        // `hidden` would do that too, but it makes the row a scroll container,
        // and the gutter would then stick to the row instead of to the grid.
        className="flex items-center gap-2 bg-base-200 py-1.5 sm:py-2 pr-2 rounded-box border border-base-300 overflow-clip hover:border-primary/40 transition-colors"
      >
        {/* Track Info & Mute.
            `sticky left-0` pins the gutter to the left edge of SequencerGrid's
            `overflow-x-auto` while the 16 steps scroll under it — without it a
            phone shows five anonymous step buttons and no way to tell which
            lane they belong to. Everything else here exists to make that pin
            fully opaque, because any gap in it shows a step button sliding
            past: `bg-base-200` is the row's own colour, `self-stretch` with
            `-my-2 py-2` covers the row's whole height (its padding included —
            the active steps' glow spills into that), and `pl-2` takes over the
            row's left padding so nothing scrolls through the 8px beside it.
            Its width must stay in step with StepHeader's `pl-34 sm:pl-44`:
            gutter + the row's `gap-2`. The phone gutter is `w-32`, not the
            `w-36` it was: every 8px taken off it is 8px the sixteen steps
            share, and that is what buys them a square cell instead of a
            22x36 sliver. */}
        <div className="sticky left-0 z-10 self-stretch -my-1.5 sm:-my-2 py-1.5 sm:py-2 bg-base-200 w-32 sm:w-42 shrink-0 flex flex-col justify-center gap-0.5 sm:gap-1 pl-2 pr-2 border-r border-base-300">
          {/* Two rows, not one. The gutter's WIDTH is load-bearing — it must
              stay in step with StepHeader's `pl-34 sm:pl-44`, a constant the
              chord and bass step headers share — so the fader goes BELOW the
              name rather than beside it. Height is free; width is not. */}
          <div className="flex items-center justify-between">
            {/* `min-w-0` is what lets the name actually truncate: a flex item's
                floor is its content width until you say otherwise, so without it
                "Closed Hat" plus the two buttons simply overran the gutter and
                painted on top of the steps at the phone's narrower `w-36`. */}
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${track.color}`} />
              <span className="text-xs font-bold text-base-content truncate">
                {track.name}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Hidden below `sm`. The gutter is only 144px wide there, and
                  with both buttons in it the track name truncated to "Kick…" —
                  a lane you cannot name is worse than one you cannot audition
                  from here. Nothing is lost: every one of these tracks has a pad
                  in the input deck's Drums tab that triggers the same sound. */}
              <IconButton
                label="Preview Instrument"
                icon={<Play className="w-3.5 h-3.5" />}
                size="xs"
                className="hover:text-primary hidden sm:inline-flex"
                onClick={() => onPreview(track)}
              />
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
          <div className="flex items-center gap-1">
            {/* The same fader as everywhere else — taper, -inf detent and
                double-click-to-unity included, which matters most here: these
                are the eleven faders a user is most likely to nudge and want
                back. No visible readout: the gutter is 144px on a phone, so
                the level lives in the title. */}
            <VolumeFader
              id={`slider-track-${track.id}`}
              label={`${track.name} level`}
              valueDb={track.volume}
              onChangeDb={handleVolume}
              className="range range-xs range-primary w-full"
              showReadout={false}
            />
          </div>
        </div>

        {/* Step Buttons — the visible window of this row */}
        <StepRow<boolean>
          cells={cells}
          steps={track.steps}
          currentStep={currentStep}
          isPlaying={isPlaying}
          color={track.color}
          isActive={IS_ON}
          getButtonId={getButtonId}
          activeOverlay="pulse"
          rowClassName="flex-1 flex items-center gap-1.5"
          // Square, not the shared `h-9`: a drum cell is one hit, and eleven
          // lanes of tall slivers read as columns of bars rather than a grid.
          // `aspect-square` takes the height from whatever width the lane can
          // afford (~28px on a phone, ~30px on a tablet); `max-h-9` caps it at
          // the old height so a wide desktop grid does not grow 60px cells.
          stepClassName="aspect-square max-h-9"
          onStepClick={handleStepClick}
        />
      </div>
    );
  },
);
