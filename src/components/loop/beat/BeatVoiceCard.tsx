import React from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { Knob } from '@/components/ui/Knob';
import { ModuleHeader } from '@/components/ui/ModuleHeader';
import { PanelCard } from '@/components/ui/PanelCard';
import { TOOLBAR_BUTTON_IDLE } from '@/components/ui/Toolbar';
import { BEAT_CONTROL_SCHEMA, readBeatParam } from './beatControlSchema';
import type { BeatControl } from './beatControlSchema';
import type { BeatVoiceMeta } from './beatVoices';
import type { SoundDepth } from '../useSoundDepth';
import type { BeatVoiceId, BeatVoices } from '@/types';

/**
 * The knob lane: a WRAPPING FLEX ROW, not a column grid.
 *
 * A grid gave every voice the same columns whatever it held, so a sparse voice
 * paid for the densest voice's width and the rows sat far apart. Flex packs
 * each knob at its own fixed footprint and breaks when it runs out — the lane
 * is then as tall as the voice needs and no taller, at every width, with no
 * breakpoint to keep in step with the schema. The fixed `w-14` on each knob is
 * what keeps the wrapped rows aligned: a dial under a caption and over a
 * readout is otherwise as wide as its longest string.
 *
 * The argument gets STRONGER inside a card. Knob counts per voice differ by a
 * factor of several, so a fixed column count makes the sparsest voice pay the
 * densest voice's width in a column that is now a fraction of the viewport
 * rather than all of it.
 *
 * `flex` is NOT in here: a lane that toggles between `flex` and `hidden` with
 * two display utilities on one element resolves by stylesheet order rather
 * than by class order — which is a coin toss, not a contract.
 */
const KNOB_LANE = 'flex-wrap justify-center gap-1';

/**
 * The `+N` chip's shell. Styled like the synth's `ModuleChip` rather than
 * imported from it: that one takes a `ProModuleColor`, the six synth
 * signal-stage tints, and every Beat voice uses a `text-drum-*` tint instead.
 * Widening a synth-owned union to admit drum tokens would couple two features
 * permanently for the sake of a badge.
 */
const VOICE_CHIP = 'badge badge-sm badge-outline text-[9px] font-semibold';

/**
 * Preview and Reset, at the size the synth rack's own header control wears.
 *
 * They used to be `btn-square min-h-11 min-w-11` — a 44px touch target, which
 * made the header row twice the height of the text run beside it and, across
 * eleven cards, is what made this grid read as a different family from the
 * synth rack. The rack's header is one line: a title run on the left, a chip
 * or a `btn-xs` control on the right, and the module's own controls in the
 * body. Matching it means matching the button size, because the button is what
 * sets the row's height.
 *
 * THE COST, on the record: the touch target drops from 44px to the `btn-xs`
 * box. `min-h-11` was never a repo-wide rule — only `Wordmark` guards one —
 * but Preview is the most-pressed control on this card, so this is a deliberate
 * trade of touch comfort for one visual grammar across the Sound tab, not an
 * oversight. Restoring 44px means restoring the two-height header with it.
 */
const VOICE_ACTION = `btn btn-xs btn-square ${TOOLBAR_BUTTON_IDLE}`;

export interface BeatVoiceCardProps {
  voice: BeatVoiceId;
  meta: BeatVoiceMeta;
  /** This voice's 1-based place in the canonical roster, drawn in the header's
   *  badge the way the synth rack numbers its stages. Passed in rather than
   *  looked up here so the number can only ever be the grid's own iteration
   *  order — a card cannot disagree with the list that rendered it. */
  ordinal: number;
  /** The DRAFT voices — a gesture in flight shows here before it commits. */
  voices: BeatVoices;
  /** `simple` is the voice's Primary set; `pro` is Primary then More in the
   *  SAME lane, because at that depth they are one set. */
  depth: SoundDepth;
  /** The grid's own raw callback, unbound to a voice — the card calls it with
   *  its own `voice` prop. Passing the same function reference to all eleven
   *  cards (rather than a per-row closure built in `BeatVoiceGrid`'s `.map()`)
   *  is what lets `React.memo` below actually bail on the cards a drag didn't
   *  touch. */
  onPreview: (voice: BeatVoiceId) => void;
  /** This voice's mixer mute. The per-voice mute drives the voice's gain node
   *  to 0 (`engineSync.pushBeatVoiceGains`), so Preview is genuinely silent
   *  while it is set — and the control that sets it lives on another tab, so
   *  the button has to name the reason rather than just doing nothing. */
  muted: boolean;
  /** Writes one parameter into the draft and previews it. Same raw-callback
   *  reasoning as `onPreview`. */
  onDraft: (voice: BeatVoiceId, key: string, value: number) => void;
  onCommit: () => void;
  onCancel: () => void;
  onReset: (voice: BeatVoiceId) => void;
  /** True when the loop's base preset cannot be resolved: a voice reset copies
   *  FROM that preset, so there is nothing for it to do. */
  resetDisabled: boolean;
}

/**
 * One voice, as one compartment of the instrument, wearing the synth rack's
 * own header grammar: `[n] * Name` on the left, and on the right the `+N` chip
 * where a deeper depth has more to show, then Preview and Reset. Below it, one
 * wrapping lane of knobs.
 *
 * THE SHELL IS BEAT'S OWN, not `loop/synth/proControls`' `ProModule`. That one
 * is typed on `ProModuleColor` — the synth's signal-stage tints — which
 * excludes every `text-drum-*` tint a Beat voice uses. Both are a `PanelCard
 * inset` plus a `ModuleHeader`, and two near-identical shells in two features
 * are cheaper to read and cheaper to change than one shared component with a
 * union widened to serve both. RULE OF THREE: a third consumer promotes the
 * shell into `ui/`; the second does not.
 *
 * `inset` is the recessed compartment idiom and is correct here — these cards
 * sit inside `BeatSoundSection`'s own `SectionCard`.
 *
 * The header's left cell is the CANONICAL one — `badge`/`icon`/`title`, not
 * the bespoke `children` slot this card used to pass. It went bespoke to seat
 * a 44px Preview button beside the voice name, which is a button inside a
 * sentence and a row twice the height of the text in it. Moving both actions
 * to the right cell at `btn-xs` (see `VOICE_ACTION`) leaves a plain text run
 * on the left, which is what `MODULE_TITLE` is for — so the shared piece here
 * is `ModuleHeader` itself, used as intended, rather than a new component. The
 * numbering is the same idea as the rack's five stages: eleven compartments in
 * a fixed order read faster when the order is written down.
 *
 * There is no accordion and no per-card More button. The section-level depth
 * switch is the one disclosure model on this surface; a second one on top of
 * it was two models in one screen.
 */
/**
 * Custom comparator, not the default shallow compare `React.memo` would use
 * otherwise: `voices` is the WHOLE eleven-voice record, and `BeatSoundSection`
 * spreads a fresh top-level object into it on every drag frame
 * (`withVoiceParam`) — only the dragged voice's own nested object gets a new
 * reference, the other ten keep theirs. Comparing `prev.voices === next.voices`
 * would therefore find every card "changed" on every frame and the memo would
 * bail on nothing; comparing this card's own slice (`voices[voice]`) is what
 * actually lets the other ten cards skip re-rendering.
 */
export function arePropsEqual(prev: BeatVoiceCardProps, next: BeatVoiceCardProps): boolean {
  return (
    prev.voice === next.voice &&
    prev.meta === next.meta &&
    prev.ordinal === next.ordinal &&
    prev.voices[prev.voice] === next.voices[next.voice] &&
    prev.depth === next.depth &&
    prev.onPreview === next.onPreview &&
    prev.onDraft === next.onDraft &&
    prev.onCommit === next.onCommit &&
    prev.onCancel === next.onCancel &&
    prev.onReset === next.onReset &&
    prev.muted === next.muted &&
    prev.resetDisabled === next.resetDisabled
  );
}

export const BeatVoiceCard = React.memo(function BeatVoiceCard({
  voice,
  meta,
  ordinal,
  voices,
  depth,
  onPreview,
  onDraft,
  onCommit,
  onCancel,
  onReset,
  muted,
  resetDisabled,
}: BeatVoiceCardProps) {
  const { primary, more } = BEAT_CONTROL_SCHEMA[voice];
  const controls = depth === 'pro' ? [...primary, ...more] : primary;
  // Derived from the schema, never a second hand-written list: a re-sorted or
  // re-partitioned schema can then never leave the chip claiming a number
  // nothing renders.
  const hiddenCount = depth === 'simple' ? more.length : 0;

  const knob = (control: BeatControl) => (
    <Knob
      key={control.key}
      id={`knob-beat-${voice}-${control.key}`}
      size="sm"
      // The voice's OWN colour, not the section's: eleven cards of identical
      // secondary knobs read as one undifferentiated field, and the chip in
      // the header already names each card by colour.
      color={meta.knobColor}
      className="w-14 shrink-0"
      label={control.label}
      // Contains the visible label, per WCAG 2.5.3 — eleven cards draw the
      // same "Decay" caption and a screen-reader user must be able to tell
      // them apart.
      ariaLabel={`${meta.label} ${control.label}`}
      value={readBeatParam(voices, voice, control.key)}
      min={control.min}
      max={control.max}
      step={control.step}
      scale={control.scale}
      format={control.format}
      onChange={(value) => onDraft(voice, control.key, value)}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );

  return (
    <PanelCard inset className="min-w-0">
      <div id={`beat-voice-card-${voice}`} className="card-body p-3 gap-2.5">
        <ModuleHeader
          badge={ordinal}
          icon={<span className={`w-1.5 h-1.5 rounded-full ${meta.color}`} aria-hidden="true" />}
          title={meta.label}
          right={
            <div className="flex items-center gap-1 shrink-0">
              {hiddenCount > 0 && (
                <span
                  id={`beat-voice-chip-${voice}`}
                  className={`${VOICE_CHIP} ${meta.knobColor}`}
                  title={`+${hiddenCount} more knob${hiddenCount === 1 ? '' : 's'} at All depth`}
                >
                  {`+${hiddenCount}`}
                </span>
              )}
              <button
                id={`btn-beat-preview-${voice}`}
                type="button"
                disabled={muted}
                className={VOICE_ACTION}
                title={muted ? `${meta.label} is muted in the mixer` : `Preview ${meta.label}`}
                aria-label={`Preview ${meta.label}`}
                onClick={() => onPreview(voice)}
              >
                <Play className="w-3 h-3" />
              </button>
              <button
                id={`btn-beat-reset-${voice}`}
                disabled={resetDisabled}
                type="button"
                className={VOICE_ACTION}
                title={resetDisabled ? 'This patch has no preset to reset to' : `Reset ${meta.label}`}
                aria-label={`Reset ${meta.label}`}
                onClick={() => onReset(voice)}
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          }
        />

        <div className={`flex ${KNOB_LANE}`}>{controls.map(knob)}</div>
      </div>
    </PanelCard>
  );
}, arePropsEqual);
