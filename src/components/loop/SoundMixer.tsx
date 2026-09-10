import React from 'react';
import { SlidersVertical } from 'lucide-react';
import { useAppStore } from '@/store/store';
import { isAnyPlayerActive } from '@/store/transportSlice';
import { SYNTH_TARGET_STYLES } from '@/utils/synthControl';
import { SectionCard } from '../ui/SectionCard';
import { ChannelStrip, layerVolumeSliderId } from '../ui/ChannelStrip';
import { PowerToggle } from '../ui/PowerToggle';
import { SourceMeter } from '../ui/SourceMeter';
import { useLiveStore } from '../ui/useLiveStore';
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
 * Where each group sits on the wide-screen grid — a `Record<MixGroupId, …>` for
 * the same reason MIXER_WRITERS is one: a group added to MIX_GROUP_IDS with
 * nowhere to sit is then a compile error, rather than a `<div>` that falls into
 * grid auto-flow and lands in whichever cell the placed groups left over.
 *
 * Two columns of three rows, not one column of six: Lead and FX (two rows) plus
 * Beat (one) on the left, Accompaniment (three) on the right. Beat joins the
 * melody column because that is the pairing that balances — the other two leave
 * a 5/1 or a 2/4 split and a column of dead space beside the long one.
 *
 * Accompaniment spans both rows so Beat starts directly under FX. Without the
 * span, row 1 would be as tall as the taller of the two groups in it and Beat
 * would float below a gap the size of the difference.
 *
 * Every class is `lg:`-prefixed and a test holds that: below the breakpoint all
 * of these must be inert, leaving one column in MIX_GROUP_IDS order — which is
 * what keeps Beat last on a phone.
 */
export const MIXER_GROUP_PLACEMENT: Record<MixGroupId, string> = {
  lead: 'lg:col-start-1 lg:row-start-1',
  accompaniment: 'lg:col-start-2 lg:row-start-1 lg:row-span-2',
  beat: 'lg:col-start-1 lg:row-start-2',
};

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
  const focusTrack = useLiveStore((s) => s.focusTrack);
  const setFocusTrack = useLiveStore((s) => s.setFocusTrack);

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
      {/* The row's own name is the focus control: clicking it points every
          Sound-page knob at this layer. A button rather than a click handler
          on the row body, because the row body already contains a fader and a
          mute toggle and a click that lands on either must not also navigate.
          The `htmlFor` moves onto a sibling `<label className="sr-only">` so
          the fader keeps an accessible name. */}
      <div className="flex items-center gap-1.5">
        <button
          id={`btn-mix-focus-${channel.idPrefix}`}
          aria-current={focusTrack === channel.idPrefix ? 'true' : undefined}
          type="button"
          onClick={() => setFocusTrack(channel.idPrefix)}
          className={`${FIELD_LABEL} text-left hover:text-base-content ${
            focusTrack === channel.idPrefix ? 'text-base-content font-bold' : ''
          }`}
          title={`Work on ${channel.label}`}
        >
          {channel.label} <span className="tabular-nums">({formatDb(volume)})</span>
        </button>
        <label className="sr-only" htmlFor={layerVolumeSliderId(channel.idPrefix)}>
          {channel.label} level
        </label>
      </div>
      {/* `items-start` + an `h-8` box around the toggle, rather than
          `items-center`: the fader and the meter stack, and centring would drop
          the toggle to the middle of that stack — beside the gap between them.
          Anchoring to the top of a 32px box puts it level with the fader,
          because the fader box is `h-8` too. */}
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
        {/* The meter sits UNDER the fader at every width, not beside it above
            `sm`. Side by side, the two split one row's width between a control
            and a readout, and the fader — the thing you actually drag — got the
            worse half of it on a phone. Stacked, the fader is full width at
            every size, and the width the meter gives back is what pays for the
            two-column grid this surface lays out at `lg`. */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="min-w-0">
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
          {/* `h-4`, not the `h-8` this wore while it sat beside the fader: that
              height existed to give a ~6px bar a 32px box to centre in, so that
              it lined up with the fader's own `h-8`. Under the fader there is
              nothing to line up with, and 32px of mostly-empty box would spend
              on padding the row height the stack just took. The reading is
              post-fader (see ui/SourceMeter), so this bar shows what the fader
              above it just did. */}
          <SourceMeter
            source={channel.engineSource}
            label={channel.label}
            isPlaying={isPlaying}
            className="h-4 min-w-0"
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
        {/* A grid rather than a flex column: the wide layout has to place groups
            on named cells (MIXER_GROUP_PLACEMENT), and the narrow one is a plain
            single column — which a one-column grid already is, so there is no
            second layout to keep in step. `lg:items-start` so the shorter column
            keeps its rows at the top instead of a group stretching to match its
            neighbour's height. */}
        <div className="grid gap-2 lg:grid-cols-2 lg:gap-x-6 lg:items-start">
          {MIXER_GROUPS.map((group) => (
            /* A real box per group, no longer a Fragment: it is the thing the
               grid places, and its heading has to travel to that cell with its
               rows. The inner `gap-2` reproduces what the flat column's own gap
               used to give these same children. */
            <div key={group.id} className={`flex flex-col gap-2 ${MIXER_GROUP_PLACEMENT[group.id]}`}>
              {/* `my-0`: daisyUI's divider carries its own vertical margin, and
                  this column already spaces its children with `gap-2`. */}
              <div className={`divider divider-start my-0 ${GROUP_LABEL}`}>{group.label}</div>
              {group.channels.map((channel) => (
                <MixerRow key={channel.idPrefix} channel={channel} isPlaying={isPlaying} />
              ))}
            </div>
          ))}
        </div>
    </SectionCard>
  );
});
