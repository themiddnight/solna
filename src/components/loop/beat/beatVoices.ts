import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import type { KnobColor } from '@/components/ui/Knob';
import type { BeatVoiceId } from '@/types';

/** What a voice is CALLED and what colour names it. Presentation only: nothing
 *  here reaches the engine, and nothing here is ever stored in a loop. */
export interface BeatVoiceMeta {
  label: string;
  /** A `--drum-*` namespace token, held above the AA floor by `check:contrast`. */
  color: string;
  /** The same voice colour as a `Knob` tint, so a knob reads as belonging to the
   *  row it sits in rather than to the section. Written out beside `color`
   *  rather than derived as `` `text-drum-${id}` ``: Tailwind v4 scans source
   *  statically, so a class assembled at runtime is never emitted. */
  knobColor: KnobColor;
}

/**
 * The one Beat voice presentation registry — label and colour per voice,
 * derived at render time and stored nowhere.
 *
 * WHY IT IS HERE AND NOT IN `src/data/`. A label and a Tailwind class are UI
 * facts, and the design's ownership boundary puts the Beat editor's registries
 * under `components/loop/beat/` for exactly that reason ("the control schema
 * lives outside `src/data/` because it is a UI registry, not factory
 * content"). It is also not a `src/data/` leaf by that folder's own test —
 * adding a voice here is never an edit to this table alone: it needs an entry
 * in `BEAT_VOICE_IDS`, a `--drum-*` token in BOTH themes, and a `triggerDrum`
 * case. This is the same rule `METERS` and `VIEW_META` follow: a registry
 * lives where the code that reads it lives.
 *
 * WHY IT EXISTS AT ALL. These two fields used to be a stored drum track's own
 * `name` and `color` — PERSISTED per loop, in every project file, once per voice per
 * loop. Two loops could therefore disagree about what a kick is called, a
 * renamed voice reached only the loops written after it, and a colour a theme
 * no longer had survived in storage. Derived, they cannot drift.
 *
 * `beatVoices.test.ts` is deliberately absent: the only assertions worth
 * making about this table — one entry per canonical voice, in roster order,
 * every colour a `bg-drum-*` token — are made from the Beat UI's own tests,
 * where a missing entry is a row that renders without a name.
 */
export const BEAT_VOICE_META: Record<BeatVoiceId, BeatVoiceMeta> = {
  kick: { label: 'Kick', color: 'bg-drum-kick', knobColor: 'text-drum-kick' },
  snare: { label: 'Snare Snap', color: 'bg-drum-snare', knobColor: 'text-drum-snare' },
  rimshot: { label: 'Rim Shot', color: 'bg-drum-rimshot', knobColor: 'text-drum-rimshot' },
  clap: { label: 'Hand Clap', color: 'bg-drum-clap', knobColor: 'text-drum-clap' },
  hihat: { label: 'Closed Hat', color: 'bg-drum-hihat', knobColor: 'text-drum-hihat' },
  openhat: { label: 'Open Hat', color: 'bg-drum-openhat', knobColor: 'text-drum-openhat' },
  hitom: { label: 'Hi Tom', color: 'bg-drum-hitom', knobColor: 'text-drum-hitom' },
  lowtom: { label: 'Low Tom', color: 'bg-drum-lowtom', knobColor: 'text-drum-lowtom' },
  ride: { label: 'Ride', color: 'bg-drum-ride', knobColor: 'text-drum-ride' },
  crash: { label: 'Crash', color: 'bg-drum-crash', knobColor: 'text-drum-crash' },
  bell: { label: 'Bell', color: 'bg-drum-bell', knobColor: 'text-drum-bell' },
};

/** The voices in canonical order, paired with their presentation metadata —
 *  what a list of rows iterates. Order is `BEAT_VOICE_IDS`', never this
 *  object's key order, so the grid and the engine walk the same roster. */
export const BEAT_VOICE_ROWS: readonly (BeatVoiceMeta & { id: BeatVoiceId })[] =
  BEAT_VOICE_IDS.map((id) => ({ id, ...BEAT_VOICE_META[id] }));
