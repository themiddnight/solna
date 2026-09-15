import React, { useCallback } from "react";
import { Play } from "lucide-react";
import type { BeatVoiceId, BeatVoiceMix } from "@/types";
import type { StepCell } from "@/components/sequencerGrid";
import { BEAT_VOICE_META } from "@/components/loop/beat/beatVoices";
import { PowerToggle } from "@/components/ui/PowerToggle";
import { StepRow } from "@/components/ui/StepRow";
import { IconButton } from "@/components/ui/IconButton";
import { VolumeFader } from "@/components/ui/VolumeFader";

/**
 * A voice id, its own stored row and its own mix entry — the three things a
 * Beat lane is, kept apart. The per-track bundle these replaced held
 * a voice's steps together with the volume and mute its fader owns and with a
 * persisted display name and colour; those last two are looked up in
 * `BEAT_VOICE_META` now, so no loop stores what a kick is called.
 */
export interface TrackRowProps {
  voiceId: BeatVoiceId;
  /** The STORED row. `cells` is what decides how much of it is drawn. */
  steps: boolean[];
  mix: BeatVoiceMix;
  cells: StepCell[];
  currentStep: number;
  isPlaying: boolean;
  onToggleStep: (voice: BeatVoiceId, stepIndex: number) => void;
  onToggleMute: (voice: BeatVoiceId) => void;
  onPreview: (voice: BeatVoiceId) => void;
  onVolumeChange: (voice: BeatVoiceId, db: number) => void;
}

/** Module-level so its identity never changes across renders. */
const IS_ON = (value: boolean) => value === true;

/**
 * One drum voice's lane. Memoized: the three callbacks are stable useCallbacks
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
    voiceId,
    steps,
    mix,
    cells,
    currentStep,
    isPlaying,
    onToggleStep,
    onToggleMute,
    onPreview,
    onVolumeChange,
  }: TrackRowProps) {
    // The label and the dot colour are DERIVED here, at render time, from the
    // one registry — never props, and never fields a loop persisted.
    const { label, color } = BEAT_VOICE_META[voiceId];

    // Derived from voiceId, so they are memoized on it: StepRow is not itself
    // memoized today, so this is not load-bearing yet — it is what makes
    // wrapping StepRow in React.memo later a one-line change instead of a
    // silent no-op.
    const handleStepClick = useCallback(
      (index: number) => onToggleStep(voiceId, index),
      [voiceId, onToggleStep],
    );
    const getButtonId = useCallback((index: number) => `step-${voiceId}-${index}`, [voiceId]);
    const handleVolume = useCallback(
      (db: number) => onVolumeChange(voiceId, db),
      [voiceId, onVolumeChange],
    );

    return (
      <div
        id={`sequencer-row-${voiceId}`}
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
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />
              <span className="text-xs font-bold text-base-content truncate">
                {label}
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
                onClick={() => onPreview(voiceId)}
              />
              <PowerToggle
                id={`btn-mute-${voiceId}`}
                on={!mix.muted}
                onToggle={() => onToggleMute(voiceId)}
                name={label}
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
              id={`slider-track-${voiceId}`}
              label={`${label} level`}
              valueDb={mix.levelDb}
              onChangeDb={handleVolume}
              className="range range-xs range-primary w-full"
              showReadout={false}
            />
          </div>
        </div>

        {/* Step Buttons — the visible window of this row */}
        <StepRow<boolean>
          cells={cells}
          steps={steps}
          currentStep={currentStep}
          isPlaying={isPlaying}
          color={color}
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
