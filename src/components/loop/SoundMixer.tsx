import React from 'react';
import { useAppStore } from '@/store/store';
import { SYNTH_TARGET_STYLES } from '@/utils/synthControl';
import type { LoopMixPatch } from '@/store/types';
import { PanelCard } from '../ui/PanelCard';
import { ChannelStrip } from '../ui/ChannelStrip';
import { PowerToggle, type PowerToggleTone } from '../ui/PowerToggle';
import { SECTION_HEADER } from '../ui/fieldClasses';
import { GroupFrame } from '../ui/GroupFrame';

// volumeKey/muteKey index LoopMixPatch — the same ten-field type
// SortableLoopCard.tsx's twin table (LOOP_MIX_CHANNELS) indexes — so a
// renamed or removed store field fails here rather than leaving this table
// self-consistent but wrong. setVolumeKey/toggleKey stay hand-written unions:
// LoopMixPatch carries no setters, only the ten live values a loop's mix
// override touches.
type MixVolumeKey = {
  [K in keyof LoopMixPatch]: LoopMixPatch[K] extends number ? K : never;
}[keyof LoopMixPatch];
type MixMuteKey = {
  [K in keyof LoopMixPatch]: LoopMixPatch[K] extends boolean ? K : never;
}[keyof LoopMixPatch];

export interface MixerChannel {
  idPrefix: string;
  label: string;
  volumeKey: MixVolumeKey;
  setVolumeKey:
    | 'setSynthVolume' | 'setChordVolume' | 'setBassVolume' | 'setPadVolume'
    | 'setMasterSequencerVolume';
  muteKey: MixMuteKey;
  toggleKey:
    | 'toggleSynthMuted' | 'toggleChordMuted' | 'toggleBassMuted' | 'togglePadMuted'
    | 'toggleDrumMuted';
  tone: PowerToggleTone;
  /** Icon tint. Typed as ChannelStrip's `accentClass` (KnobColor) accepts it. */
  accentClass: 'text-primary' | 'text-module-chord' | 'text-module-bass' | 'text-module-pad' | 'text-accent';
  sliderClassName: string;
}

/**
 * The five layers, in the canonical order, bound to the LIVE slice fields —
 * the levels the engine is using right now.
 *
 * This deliberately mirrors LOOP_MIX_CHANNELS in song/SortableLoopCard.tsx:
 * same five layers, same order, same labels and tones. The two are NOT
 * interchangeable and must never be merged. That one writes a per-loop
 * LoopMixPatch — an arrangement override stored on a loop; this one writes the
 * live store root through the ordinary slice actions, and store/loopSync.ts's
 * mirroring `set` carries every one of these ten fields into
 * loops[activeLoopId] in the same update. Nothing here may call setLoopMix:
 * that would write the same fields twice, and on whichever loop it was handed.
 *
 * Two of these ten controls are new rather than moved: synthMuted and
 * drumMuted have existed in the store and been honoured by the audio path
 * (engineSync.ts's LAYER_BUSES) since before this file, with no UI anywhere
 * except the Arrange loop cards.
 */
export const MIXER_CHANNELS: ReadonlyArray<MixerChannel> = [
  {
    idPrefix: 'synth', label: 'Lead',
    volumeKey: 'synthVolume', setVolumeKey: 'setSynthVolume',
    muteKey: 'synthMuted', toggleKey: 'toggleSynthMuted',
    tone: 'primary',
    accentClass: SYNTH_TARGET_STYLES.synth.accent,
    sliderClassName: SYNTH_TARGET_STYLES.synth.slider,
  },
  {
    idPrefix: 'chord', label: 'Chord',
    volumeKey: 'chordVolume', setVolumeKey: 'setChordVolume',
    muteKey: 'chordMuted', toggleKey: 'toggleChordMuted',
    tone: 'module-chord',
    accentClass: SYNTH_TARGET_STYLES.chord.accent,
    sliderClassName: SYNTH_TARGET_STYLES.chord.slider,
  },
  {
    idPrefix: 'bass', label: 'Bass',
    volumeKey: 'bassVolume', setVolumeKey: 'setBassVolume',
    muteKey: 'bassMuted', toggleKey: 'toggleBassMuted',
    tone: 'module-bass',
    accentClass: SYNTH_TARGET_STYLES.bass.accent,
    sliderClassName: SYNTH_TARGET_STYLES.bass.slider,
  },
  {
    idPrefix: 'pad', label: 'Pad',
    volumeKey: 'padVolume', setVolumeKey: 'setPadVolume',
    muteKey: 'padMuted', toggleKey: 'togglePadMuted',
    tone: 'module-pad',
    accentClass: SYNTH_TARGET_STYLES.pad.accent,
    sliderClassName: SYNTH_TARGET_STYLES.pad.slider,
  },
  {
    // The drum bus has no SynthControlTarget entry — it is not a synth voice —
    // so its two classes are literals here. `accent` matches the tone
    // SortableLoopCard gives the same row, and is deliberately NOT the
    // `primary` the old standalone "Drum Level" strip wore: primary is Lead's
    // tone, and the two rows now sit in one grid where they must not read as
    // the same layer.
    idPrefix: 'drum', label: 'Beat',
    volumeKey: 'masterSequencerVolume', setVolumeKey: 'setMasterSequencerVolume',
    muteKey: 'drumMuted', toggleKey: 'toggleDrumMuted',
    tone: 'accent',
    accentClass: 'text-accent',
    sliderClassName: 'range range-xs range-accent',
  },
];

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
        <div className="flex flex-col gap-2">
          <MixerRow channel={MIXER_CHANNELS[0]} />
          {/* Indices, not a filter: SoundMixer.test.tsx pins MIXER_CHANNELS'
              order and length, so [0] is Lead, [1..3] are the accompaniment
              three and [4] is Beat. A filter would silently drop a row that got
              renamed; a bad index fails the suite. */}
          <GroupFrame label="Accompaniment" className="flex flex-col gap-2">
            {MIXER_CHANNELS.slice(1, 4).map((channel) => (
              <MixerRow key={channel.idPrefix} channel={channel} />
            ))}
          </GroupFrame>
          <MixerRow channel={MIXER_CHANNELS[4]} />
        </div>
      </div>
    </PanelCard>
  );
});
