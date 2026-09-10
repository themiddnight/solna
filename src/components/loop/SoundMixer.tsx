import React from 'react';
import { SlidersVertical } from 'lucide-react';
import { useAppStore } from '@/store/store';
import { isAnyPlayerActive } from '@/store/transportSlice';
import { SYNTH_TARGET_STYLES } from '@/utils/synthControl';
import { SectionCard } from '../ui/SectionCard';
import { ChannelStrip, layerVolumeSliderId } from '../ui/ChannelStrip';
import { PowerToggle } from '../ui/PowerToggle';
import { SourceMeter } from '../ui/SourceMeter';
import {
  MIX_GROUP_IDS,
  MIX_GROUP_LABELS,
  MIX_LAYERS,
  type MixGroupId,
  type MixLayer,
  type MixLayerId,
} from '../mixLayers';
import { FIELD_LABEL, GROUP_LABEL } from '../ui/fieldClasses';
import { formatDb } from '@/utils/gainUnits';

/**
 * A mix layer plus the two things only THIS surface has: the slice actions it
 * writes through, and the slider class its ChannelStrip wears.
 *
 * `Record<MixLayerId, …>` rather than a second six-row array: the compiler
 * then refuses a layer that has a label and a store field but no way to write
 * it, which two parallel arrays joined by position could not.
 */
const MIXER_WRITERS: Record<MixLayerId, {
  setVolumeKey:
    | 'setSynthVolume' | 'setFxVolume' | 'setChordVolume' | 'setBassVolume' | 'setPadVolume'
    | 'setMasterSequencerVolume';
  toggleKey:
    | 'toggleSynthMuted' | 'toggleFxMuted' | 'toggleChordMuted' | 'toggleBassMuted' | 'togglePadMuted'
    | 'toggleDrumMuted';
  sliderClassName: string;
}> = {
  synth: { setVolumeKey: 'setSynthVolume', toggleKey: 'toggleSynthMuted', sliderClassName: SYNTH_TARGET_STYLES.synth.slider },
  // FX has no SynthControlTarget entry — there is no Target-selector row for
  // it — so its slider class is spelled out here, following the same
  // module-token pattern chord/bass/pad's SYNTH_TARGET_STYLES entries use.
  fx: { setVolumeKey: 'setFxVolume', toggleKey: 'toggleFxMuted', sliderClassName: 'range range-xs text-module-fx [--range-thumb:var(--color-module-fx-content)]' },
  chord: { setVolumeKey: 'setChordVolume', toggleKey: 'toggleChordMuted', sliderClassName: SYNTH_TARGET_STYLES.chord.slider },
  bass: { setVolumeKey: 'setBassVolume', toggleKey: 'toggleBassMuted', sliderClassName: SYNTH_TARGET_STYLES.bass.slider },
  pad: { setVolumeKey: 'setPadVolume', toggleKey: 'togglePadMuted', sliderClassName: SYNTH_TARGET_STYLES.pad.slider },
  // The drum bus has no SynthControlTarget entry — it is not a synth voice —
  // so its slider class is a literal.
  drum: { setVolumeKey: 'setMasterSequencerVolume', toggleKey: 'toggleDrumMuted', sliderClassName: 'range range-xs range-accent' },
};

export type MixerChannel = MixLayer & (typeof MIXER_WRITERS)[MixLayerId];

/**
 * The five layers, in canonical order, bound to the LIVE slice fields — the
 * levels the engine is using right now.
 *
 * The layers themselves come from components/mixLayers.ts, which an Arrange
 * loop card reads too; only the writer columns are added here. Nothing on this
 * surface may call setLoopMix: that would write the same fields twice, and on
 * whichever loop it was handed. store/loopSync.ts's mirroring `set` carries
 * every one of these ten fields into loops[activeLoopId] in the same update.
 *
 * Two of these ten controls are new rather than moved: synthMuted and
 * drumMuted have existed in the store and been honoured by the audio path
 * (engineSync.ts's SOURCE_BUSES) since before this file, with no UI anywhere
 * except the Arrange loop cards.
 */
export const MIXER_CHANNELS: ReadonlyArray<MixerChannel> = MIX_LAYERS
  .map((layer) => ({
    ...layer,
    ...MIXER_WRITERS[layer.idPrefix],
  }));

/**
 * The rows under each heading, bucketed ONCE at module scope: the table never
 * changes at runtime, and this component re-renders on every transport change.
 *
 * A group with no rows is dropped rather than drawn — a heading over nothing is
 * a bug that looks like a design, and MIX_GROUP_IDS can legitimately gain an id
 * before any layer names it.
 */
const MIXER_GROUPS: ReadonlyArray<{ id: MixGroupId; label: string; channels: MixerChannel[] }> =
  MIX_GROUP_IDS.map((id) => ({
    id,
    label: MIX_GROUP_LABELS[id],
    channels: MIXER_CHANNELS.filter((c) => c.group === id),
  })).filter((group) => group.channels.length > 0);

/**
 * One row = one layer. The store subscriptions live HERE, not in SoundMixer:
 * every view stays mounted, so ten selectors at the top of the mixer would
 * re-render all five rows on any one of the ten fields. Per row, a fader drag
 * re-renders that row alone — which is the same direct-write behaviour the
 * ChannelStrip call sites this replaces already had.
 */
function MixerRow({ channel, isPlaying }: { channel: MixerChannel; isPlaying: boolean }) {
  const volume = useAppStore((s) => s[channel.volumeKey]);
  const setVolume = useAppStore((s) => s[channel.setVolumeKey]);
  const muted = useAppStore((s) => s[channel.muteKey]);
  const toggleMuted = useAppStore((s) => s[channel.toggleKey]);

  return (
    /* The row is a COLUMN: the field label on its own line, then one control
       line carrying the toggle, the fader and the meter.

       The label used to be ChannelStrip's, which put it inside the fader's own
       box-plus-label stack — so the toggle beside that stack centred against 48
       px while the fader box centred against its own 32, and every toggle sat 8
       px above the control it operates. Lifting the label out makes the three
       controls siblings on one line, and they align by construction rather than
       by a margin someone has to keep in step with the label's height. */
    <div className="flex flex-col gap-1">
      <label className={FIELD_LABEL} htmlFor={layerVolumeSliderId(channel.idPrefix)}>
        {channel.label} <span className="tabular-nums">({formatDb(volume)})</span>
      </label>
      {/* `items-start` + an `h-8` box around the toggle, rather than
          `items-center`: below `sm` the fader and the meter stack, and centring
          would drop the toggle to the middle of that stack — beside the gap
          between them. Anchoring to the top of a 32px box puts it level with the
          fader in both layouts, because the fader box is `h-8` too. */}
      <div className="flex items-start gap-2">
        {/* `iconOnly`, because the row's label above already says "Lead" and
            what its level is — and because a square button is one width for
            every layer, where "Lead On" / "Chord On" / "Pad Off" are three, and
            three widths start each row's fader at a different x. The state
            still reaches assistive tech: PowerToggle sets `aria-pressed` and an
            `aria-label` of "Lead On", and the tooltip says what a click does. */}
        <div className="flex items-center h-8 shrink-0">
          <PowerToggle
            id={`btn-mix-mute-${channel.idPrefix}`}
            on={!muted}
            onToggle={toggleMuted}
            name={channel.label}
            tone={channel.tone}
            size="xs"
            iconOnly
            verb={{ on: 'Unmute', off: 'Mute' }}
          />
        </div>
        {/* Below `sm` the meter drops under the fader — the two cannot sit side
            by side in a phone's width without squeezing the fader to
            uselessness, and the fader is the control while the meter is only
            the readout. */}
        <div className="flex-1 min-w-0 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex-2 min-w-0">
            {/* `showReadout={false}` because the row label above already
                prints `formatDb(volume)`. It defaults to true, so leaving it
                off rendered every layer's dB twice — once in the label, once
                inside the fader box. */}
            <ChannelStrip
              idPrefix={channel.idPrefix}
              volumeDb={volume}
              accentClass={channel.accentClass}
              sliderClassName={channel.sliderClassName}
              showReadout={false}
              onVolumeDbChange={setVolume}
            />
          </div>
          {/* h-8 matches the fader box it sits beside. The reading is post-fader
              (see ui/SourceMeter), so this bar shows what the fader to its left
              just did. */}
          <SourceMeter
            source={channel.engineSource}
            label={channel.label}
            isPlaying={isPlaying}
            className="h-8 flex-1 min-w-0"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The one mixer. Every layer's level and mute in one place, on Sound, because
 * a fader changes how something sounds and not what it plays — and because a
 * balance you cannot see all of at once is not a balance.
 */
export const SoundMixer = React.memo(function SoundMixer() {
  // The one subscription that belongs at this level rather than per row: it is
  // the SAME boolean for all five meters, it changes twice per transport
  // toggle, and a per-row copy would be five selectors computing one answer.
  // Derived from every registered player's state, table-driven the way
  // TransportBar derives it — the meters only need to know whether anything is sounding, so the tiers park on
  // `offscreen` and no analyser is read at all while stopped.
  const isPlaying = useAppStore(isAnyPlayerActive);

  return (
    <SectionCard icon={SlidersVertical} title="Mixer">
        {/* One labelled rule per group, not a box around one of them.

            Every group gets a heading, including the two that hold a single row
            — `Lead` over the Lead row reads as a repeat until you notice that
            the alternative is worse: a rule that appears only around the middle
            group makes the reader work out whether the rows above and below it
            are a group at all, and gives a sixth layer nowhere to land. The
            headings are the same three ids MIX_LAYERS' `group` column names, so
            a new layer arrives under a heading by construction.

            Grouped by that column and never by index range: `slice(1, 4)` reads
            the accompaniment three off positions, and a layer inserted anywhere
            but the end would silently drop off the screen with the order test
            still green. */}
        <div className="flex flex-col gap-2">
          {MIXER_GROUPS.map((group) => (
            <React.Fragment key={group.id}>
              {/* `my-0`: daisyUI's divider carries its own vertical margin, and
                  this column already spaces its children with `gap-2`. */}
              <div className={`divider divider-start my-0 ${GROUP_LABEL}`}>{group.label}</div>
              {group.channels.map((channel) => (
                <MixerRow key={channel.idPrefix} channel={channel} isPlaying={isPlaying} />
              ))}
            </React.Fragment>
          ))}
        </div>
    </SectionCard>
  );
});
