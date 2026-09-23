import React from 'react';
import { SlidersVertical } from 'lucide-react';
import { useAppStore } from '@/store/store';
import { isAnyPlayerActive } from '@/store/transportSlice';
import { SectionCard } from '../ui/SectionCard';
import { VolumeKnob } from '../ui/VolumeFader';
import { Knob } from '../ui/Knob';
import { PowerToggle } from '../ui/PowerToggle';
import { SourceMeter } from '../ui/SourceMeter';
import { useLiveStore } from '../ui/useLiveStore';
import { useTrackSendsDraft } from './useTrackSendsDraft';
import {
  MIX_GROUP_IDS,
  MIX_GROUP_LABELS,
  MIX_LAYERS,
  type MixGroupId,
  type MixLayer,
  type MixLayerId,
} from '../mixLayers';
import { FIELD_LABEL, GROUP_LABEL } from '../ui/fieldClasses';
import { formatPercent } from '@/utils/gainUnits';
import { SEND_EFFECTS, type SendEffect } from '@/types';

/**
 * A mix layer plus what only THIS surface has: the slice actions it writes
 * through.
 *
 * `Record<MixLayerId, …>` rather than a second six-row array: the compiler
 * then refuses a layer that has a label and a store field but no way to write
 * it, which two parallel arrays joined by position could not.
 */
const MIXER_WRITERS: Record<MixLayerId, {
  setVolumeKey:
    | 'setSynthVolume' | 'setFxVolume' | 'setChordVolume' | 'setBassVolume' | 'setPadVolume'
    | 'setBeatLevel';
  toggleKey:
    | 'toggleSynthMuted' | 'toggleFxMuted' | 'toggleChordMuted' | 'toggleBassMuted' | 'togglePadMuted'
    | 'toggleBeatMuted';
}> = {
  synth: { setVolumeKey: 'setSynthVolume', toggleKey: 'toggleSynthMuted' },
  fx: { setVolumeKey: 'setFxVolume', toggleKey: 'toggleFxMuted' },
  chord: { setVolumeKey: 'setChordVolume', toggleKey: 'toggleChordMuted' },
  bass: { setVolumeKey: 'setBassVolume', toggleKey: 'toggleBassMuted' },
  pad: { setVolumeKey: 'setPadVolume', toggleKey: 'togglePadMuted' },
  drum: { setVolumeKey: 'setBeatLevel', toggleKey: 'toggleBeatMuted' },
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
 * Two of these controls are new rather than moved: the Lead and Beat mutes
 * have existed in the store and been honoured by the audio path
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
 * Every class is `md:`-prefixed and a test holds that: below the breakpoint all
 * of these must be inert, leaving one column in MIX_GROUP_IDS order — which is
 * what keeps Beat last on a phone.
 */
export const MIXER_GROUP_PLACEMENT: Record<MixGroupId, string> = {
  lead: 'md:col-start-1 md:row-start-1',
  accompaniment: 'md:col-start-2 md:row-start-1 md:row-span-2',
  beat: 'md:col-start-1 md:row-start-2',
};

/** The level knob's element id. */
const layerVolumeSliderId = (idPrefix: string) => `slider-${idPrefix}-layer-volume`;

/** Each send knob's short label and the accessible name's tail. */
const SEND_KNOB_TEXT: Record<SendEffect, { label: string; aria: string }> = {
  reverb: { label: 'Rev', aria: 'reverb send' },
  delay: { label: 'Dly', aria: 'delay send' },
  distortion: { label: 'Dist', aria: 'distortion send' },
};

/**
 * One row's sends into the shared master reverb, delay and distortion
 * (DEV-423): post-fader, per loop. The master wet knobs on the Master tab
 * still set each effect's overall amount. All logic is in the hook; the value
 * being dragged never reaches the store until release.
 */
function TrackSendKnobs({ channel }: { channel: MixerChannel }) {
  const { sends, onChangeFor, onCommit, onCancel } = useTrackSendsDraft(channel.engineSource);
  return (
    <div className="flex gap-3">
      {SEND_EFFECTS.map((effect) => (
        <Knob
          key={effect}
          id={`knob-send-${channel.idPrefix}-${effect}`}
          value={sends[effect]}
          onChange={onChangeFor[effect]}
          onCommit={onCommit}
          onCancel={onCancel}
          min={0}
          max={1}
          step={0.01}
          size="md"
          color={channel.accentClass}
          label={SEND_KNOB_TEXT[effect].label}
          ariaLabel={`${channel.label} ${SEND_KNOB_TEXT[effect].aria}`}
          format={formatPercent}
        />
      ))}
    </div>
  );
}

/**
 * One row = one layer. The store subscriptions live HERE, not in SoundMixer:
 * every view stays mounted, so ten selectors at the top of the mixer would
 * re-render all five rows on any one of the ten fields. Per row, a level-knob
 * drag re-renders that row alone.
 */
function MixerRow({ channel, isPlaying }: { channel: MixerChannel; isPlaying: boolean }) {
  // The row's own two values, read through the layer's accessors rather than
  // by indexing a key name: five rows read a flat loop field and the Beat row
  // reads `beatMix`, and both selectors return a PRIMITIVE either way, so the
  // row still re-renders only when its own number or boolean changes.
  const volume = useAppStore((s) => channel.readLevelDb(s));
  const setVolume = useAppStore((s) => s[channel.setVolumeKey]);
  const muted = useAppStore((s) => channel.readMuted(s));
  const toggleMuted = useAppStore((s) => s[channel.toggleKey]);
  const focusTrack = useLiveStore((s) => s.focusTrack);
  const setFocusTrack = useLiveStore((s) => s.setFocusTrack);

  return (
    /* The row is a COLUMN: the field label on its own line, then one control
       line carrying the toggle and the knobs, then the meter. */
    <div className="flex flex-col gap-1">
      {/* The row's own name is the focus control: clicking it points every
          Sound-page knob at this layer. A button rather than a click handler
          on the row body, because the row body already contains knobs and a
          mute toggle and a click that lands on either must not also navigate. */}
      <div className="flex items-center gap-1.5">
        <button
          id={`btn-mix-focus-${channel.idPrefix}`}
          type="button"
          aria-current={focusTrack === channel.idPrefix ? 'true' : undefined}
          onClick={() => setFocusTrack(channel.idPrefix)}
          className={`${FIELD_LABEL} text-left hover:text-base-content ${
            focusTrack === channel.idPrefix ? 'text-base-content font-bold' : ''
          }`}
          title={`Work on ${channel.label}`}
        >
          {channel.label}
        </button>
      </div>
      {/* One control line: the mute toggle, then the level knob and the three
          send knobs as two groups split by a rule — level | sends. All four
          are `md` knobs, so a phone gets a thumb-sized target for each. */}
      <div className="flex items-center gap-3">
        {/* `iconOnly`, because the row's label above already says "Lead" — and
            a square button is one width for every layer, so every row's knobs
            start at the same x. The state still reaches assistive tech:
            PowerToggle sets `aria-pressed` and an `aria-label` of "Lead On". */}
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
        <VolumeKnob
          id={layerVolumeSliderId(channel.idPrefix)}
          valueDb={volume}
          onChangeDb={setVolume}
          color={channel.accentClass}
          label="Vol"
          ariaLabel={`${channel.label} Vol level`}
        />
        <div aria-hidden="true" className="self-stretch w-px bg-base-300" />
        <TrackSendKnobs channel={channel} />
      </div>
      {/* Post-fader (see ui/SourceMeter): the bar shows what the level knob
          above it just did, full width so a phone reads it at a glance. */}
      <SourceMeter
        source={channel.engineSource}
        label={channel.label}
        isPlaying={isPlaying}
        className="h-4 min-w-0"
      />
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
            second layout to keep in step. `md:items-start` so the shorter column
            keeps its rows at the top instead of a group stretching to match its
            neighbour's height. */}
        <div className="grid gap-2 md:grid-cols-2 md:gap-x-6 md:items-start">
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
