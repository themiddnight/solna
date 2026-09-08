import type { LoopMixPatch } from '@/store/types';
import type { PowerToggleTone } from './ui/PowerToggle';

/**
 * `volumeKey`/`muteKey` index `LoopMixPatch` — the ten fields a loop's mix
 * override touches — so a renamed or removed store field fails here rather
 * than leaving a table self-consistent but wrong.
 */
type MixVolumeKey = {
  [K in keyof LoopMixPatch]: LoopMixPatch[K] extends number ? K : never;
}[keyof LoopMixPatch];
type MixMuteKey = {
  [K in keyof LoopMixPatch]: LoopMixPatch[K] extends boolean ? K : never;
}[keyof LoopMixPatch];

/**
 * DOM id prefix and lookup key for a layer. These track the STORE fields
 * (`drumMuted`), not the labels — which is why the drum bus is `drum` here and
 * "Beat" on screen.
 */
export const MIX_LAYER_IDS = ['synth', 'chord', 'bass', 'pad', 'drum'] as const;

export type MixLayerId = (typeof MIX_LAYER_IDS)[number];

export interface MixLayer {
  idPrefix: MixLayerId;
  label: string;
  volumeKey: MixVolumeKey;
  muteKey: MixMuteKey;
  tone: PowerToggleTone;
  /** Icon tint. Typed as ChannelStrip's `accentClass` (KnobColor) accepts it. */
  accentClass: 'text-primary' | 'text-module-chord' | 'text-module-bass' | 'text-module-pad' | 'text-accent';
  /**
   * Which frame of the Sound mixer the row sits in. A column rather than an
   * index range at the render site: `MIXER_CHANNELS.slice(1, 4)` reads the
   * accompaniment three off positions, so a sixth layer inserted anywhere but
   * the end silently drops a row off the screen with the order test still
   * green.
   */
  group: 'lead' | 'accompaniment' | 'beat';
}

/**
 * The five mix layers, in canonical order — the ONE description of what they
 * are called, what store fields they name and what colour they wear.
 *
 * Two surfaces render them and they write different things: the Sound mixer
 * (loop/SoundMixer.tsx) drives the LIVE slice through the ordinary slice
 * actions, and an Arrange loop card (song/SortableLoopCard.tsx) writes a
 * per-loop `LoopMixPatch` override through `setLoopMix`, on whichever loop the
 * card is for. Those two WRITERS must stay separate — nothing here may call
 * `setLoopMix`, and the card may not call the slice actions — but the writers
 * were never the reason the two tables each spelled out five labels, five
 * tones and five store keys. They had already drifted: the card's slider wore
 * a bare `text-module-chord` where the mixer's wore the same class plus its
 * `--range-thumb` override, so one mixer's thumbs were a different colour from
 * the other's.
 *
 * Beat sits last so the strip reads pitched layers first, rhythm after — the
 * same story the header tabs tell.
 */
export const MIX_LAYERS: ReadonlyArray<MixLayer> = [
  { idPrefix: 'synth', label: 'Lead', volumeKey: 'synthVolume', muteKey: 'synthMuted', tone: 'primary', accentClass: 'text-primary', group: 'lead' },
  { idPrefix: 'chord', label: 'Chord', volumeKey: 'chordVolume', muteKey: 'chordMuted', tone: 'module-chord', accentClass: 'text-module-chord', group: 'accompaniment' },
  { idPrefix: 'bass', label: 'Bass', volumeKey: 'bassVolume', muteKey: 'bassMuted', tone: 'module-bass', accentClass: 'text-module-bass', group: 'accompaniment' },
  { idPrefix: 'pad', label: 'Pad', volumeKey: 'padVolume', muteKey: 'padMuted', tone: 'module-pad', accentClass: 'text-module-pad', group: 'accompaniment' },
  // `accent`, deliberately NOT the `primary` the old standalone "Drum Level"
  // strip wore: primary is Lead's tone, and the two rows now sit in one grid
  // where they must not read as the same layer.
  { idPrefix: 'drum', label: 'Beat', volumeKey: 'masterSequencerVolume', muteKey: 'drumMuted', tone: 'accent', accentClass: 'text-accent', group: 'beat' },
];

/** The layers of one mixer frame, in table order. */
export function mixLayersInGroup(group: MixLayer['group']): ReadonlyArray<MixLayer> {
  return MIX_LAYERS.filter((layer) => layer.group === group);
}
