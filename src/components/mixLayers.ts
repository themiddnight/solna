import type { LoopMixPatch } from '@/store/types';
import type { SourceBusId } from '@/store/engineSync';
import type { PowerToggleTone } from './ui/PowerToggle';

/**
 * `volumeKey`/`muteKey` index `LoopMixPatch` — the twelve fields a loop's mix
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
export const MIX_LAYER_IDS = ['synth', 'fx', 'chord', 'bass', 'pad', 'drum'] as const;

export type MixLayerId = (typeof MIX_LAYER_IDS)[number];

/**
 * The mixer's groups, in the order they are shown. Pitched layers first,
 * rhythm after — the same story the header tabs tell.
 */
export const MIX_GROUP_IDS = ['lead', 'accompaniment', 'beat'] as const;

export type MixGroupId = (typeof MIX_GROUP_IDS)[number];

/**
 * The screen name of each group, as a `Record` rather than a second ordered
 * array: adding an id to MIX_GROUP_IDS without naming it is then a compile
 * error, instead of a divider rendering the word `undefined`.
 */
export const MIX_GROUP_LABELS: Record<MixGroupId, string> = {
  lead: 'Lead and FX',
  accompaniment: 'Accompaniment',
  beat: 'Beat',
};

export interface MixLayer {
  idPrefix: MixLayerId;
  label: string;
  volumeKey: MixVolumeKey;
  muteKey: MixMuteKey;
  tone: PowerToggleTone;
  /** Icon tint. Typed as ChannelStrip's `accentClass` (KnobColor) accepts it. */
  accentClass: 'text-primary' | 'text-module-chord' | 'text-module-bass' | 'text-module-pad' | 'text-module-fx' | 'text-accent';
  /**
   * Which group of the Sound mixer the row sits under. A column rather than an
   * index range at the render site: `MIXER_CHANNELS.slice(1, 4)` reads the
   * accompaniment three off positions, so a sixth layer inserted anywhere but
   * the end silently drops a row off the screen with the order test still
   * green. With the mixer rendering one divider per MIX_GROUP_IDS entry, this
   * column is also what puts a new layer under a heading at all — a layer
   * cannot name a group that has no divider, because the union is the same one.
   */
  group: MixGroupId;
  /**
   * The ENGINE's name for this layer's bus, which is not `idPrefix`: the store
   * calls the drum bus 'drum' and the engine calls it 'sequencer'. Typed as
   * engineSync's own union so a row naming a bus that does not exist is a
   * compile error rather than a meter that never moves.
   */
  engineSource: SourceBusId;
}

/**
 * The six mix layers, in canonical order — the ONE description of what they
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
  { idPrefix: 'synth', label: 'Lead', volumeKey: 'synthVolume', muteKey: 'synthMuted', engineSource: 'synth', tone: 'primary', accentClass: 'text-primary', group: 'lead' },
  // group: 'lead', not its own group — Lead and FX are two melody tracks
  // sharing one heading, the way the two of them already sit as bare chips
  // (not framed groups) in the Sound view's target row.
  { idPrefix: 'fx', label: 'FX', volumeKey: 'fxVolume', muteKey: 'fxMuted', engineSource: 'fx', tone: 'module-fx', accentClass: 'text-module-fx', group: 'lead' },
  { idPrefix: 'chord', label: 'Chord', volumeKey: 'chordVolume', muteKey: 'chordMuted', engineSource: 'chord', tone: 'module-chord', accentClass: 'text-module-chord', group: 'accompaniment' },
  { idPrefix: 'bass', label: 'Bass', volumeKey: 'bassVolume', muteKey: 'bassMuted', engineSource: 'bass', tone: 'module-bass', accentClass: 'text-module-bass', group: 'accompaniment' },
  { idPrefix: 'pad', label: 'Pad', volumeKey: 'padVolume', muteKey: 'padMuted', engineSource: 'pad', tone: 'module-pad', accentClass: 'text-module-pad', group: 'accompaniment' },
  // `accent`, deliberately NOT the `primary` the old standalone "Drum Level"
  // strip wore: primary is Lead's tone, and the two rows now sit in one grid
  // where they must not read as the same layer.
  { idPrefix: 'drum', label: 'Beat', volumeKey: 'masterSequencerVolume', muteKey: 'drumMuted', engineSource: 'sequencer', tone: 'accent', accentClass: 'text-accent', group: 'beat' },
];

