import React from 'react';
import { useAppStore } from '@/store/store';
import { SYNTH_TARGET_STYLES } from '@/utils/synthControl';
import { PanelCard } from '../ui/PanelCard';
import { ChannelStrip } from '../ui/ChannelStrip';
import { PowerToggle } from '../ui/PowerToggle';
import { MIX_LAYERS, type MixLayer, type MixLayerId } from '../mixLayers';
import { SECTION_HEADER } from '../ui/fieldClasses';
import { GroupFrame } from '../ui/GroupFrame';

/**
 * A mix layer plus the two things only THIS surface has: the slice actions it
 * writes through, and the slider class its ChannelStrip wears.
 *
 * `Record<MixLayerId, …>` rather than a second five-row array: the compiler
 * then refuses a sixth layer that has a label and a store field but no way to
 * write it, which two parallel arrays joined by position could not.
 */
const MIXER_WRITERS: Record<MixLayerId, {
  setVolumeKey:
    | 'setSynthVolume' | 'setChordVolume' | 'setBassVolume' | 'setPadVolume'
    | 'setMasterSequencerVolume';
  toggleKey:
    | 'toggleSynthMuted' | 'toggleChordMuted' | 'toggleBassMuted' | 'togglePadMuted'
    | 'toggleDrumMuted';
  sliderClassName: string;
}> = {
  synth: { setVolumeKey: 'setSynthVolume', toggleKey: 'toggleSynthMuted', sliderClassName: SYNTH_TARGET_STYLES.synth.slider },
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
export const MIXER_CHANNELS: ReadonlyArray<MixerChannel> = MIX_LAYERS.map((layer) => ({
  ...layer,
  ...MIXER_WRITERS[layer.idPrefix],
}));

const MIXER_LEAD = MIXER_CHANNELS.filter((c) => c.group === 'lead');
const MIXER_ACCOMPANIMENT = MIXER_CHANNELS.filter((c) => c.group === 'accompaniment');
const MIXER_BEAT = MIXER_CHANNELS.filter((c) => c.group === 'beat');

/**
 * One row = one layer. The store subscriptions live HERE, not in SoundMixer:
 * every view stays mounted, so ten selectors at the top of the mixer would
 * re-render all five rows on any one of the ten fields. Per row, a fader drag
 * re-renders that row alone — which is the same direct-write behaviour the
 * ChannelStrip call sites this replaces already had.
 */
function MixerRow({ channel }: { channel: MixerChannel }) {
  const volume = useAppStore((s) => s[channel.volumeKey]);
  const setVolume = useAppStore((s) => s[channel.setVolumeKey]);
  const muted = useAppStore((s) => s[channel.muteKey]);
  const toggleMuted = useAppStore((s) => s[channel.toggleKey]);

  return (
    <div className="flex items-center gap-2">
      <PowerToggle
        id={`btn-mix-mute-${channel.idPrefix}`}
        on={!muted}
        onToggle={toggleMuted}
        name={channel.label}
        tone={channel.tone}
        size="xs"
        verb={{ on: 'Unmute', off: 'Mute' }}
      />
      <div className="flex-1 min-w-40">
        <ChannelStrip
          idPrefix={channel.idPrefix}
          label={channel.label}
          volumeDb={volume}
          accentClass={channel.accentClass}
          sliderClassName={channel.sliderClassName}
          onVolumeDbChange={setVolume}
        />
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
  return (
    <PanelCard>
      <div className="card-body p-3 sm:p-4 gap-3">
        <span className={SECTION_HEADER}>Mixer</span>
        {/* Grouped by the layer's own `group` column, not by index range: a
            sixth layer inserted anywhere but the end would fall outside
            `slice(1, 4)` and simply not render, with the order test still
            green. Every layer names its frame, so every layer reaches one. */}
        <div className="flex flex-col gap-2">
          {MIXER_LEAD.map((channel) => (
            <MixerRow key={channel.idPrefix} channel={channel} />
          ))}
          <GroupFrame label="Accompaniment" className="flex flex-col gap-2">
            {MIXER_ACCOMPANIMENT.map((channel) => (
              <MixerRow key={channel.idPrefix} channel={channel} />
            ))}
          </GroupFrame>
          {MIXER_BEAT.map((channel) => (
            <MixerRow key={channel.idPrefix} channel={channel} />
          ))}
        </div>
      </div>
    </PanelCard>
  );
});
