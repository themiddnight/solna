import type { ChordQuality } from './musicCore';

/**
 * The four tabs, two per layer. The loop layer's split is a rule, not a
 * grouping of what happened to exist: changes the SOUND but not the notes →
 * `sound`; changes the NOTES or the rhythm → `pattern`. Oscillator, filter,
 * envelopes, LFO, arpeggiator, the preset library and the faders are Sound;
 * chord progression, chord rhythm, bass pattern, drum grid and drum kit are
 * Pattern. `arrange` now means one thing only — ordering loops — and nothing
 * else may take that name.
 *
 * Pattern's four segments are DERIVED from `focusTrack` (`segmentForFocus`,
 * store/focusTrack.ts), not three more view ids: the router validates exactly
 * one query key, and a segment is a within-tab position, not a route.
 */
export type ViewMode = (typeof LOOP_TABS)[number] | (typeof SONG_TABS)[number];

export type Layer = 'loop' | 'song';

/**
 * Pattern's four segments. DERIVED from `focusTrack`, not stored:
 * `segmentForFocus` (store/focusTrack.ts) maps the six focus ids onto these
 * four. A segment is still a position inside one tab rather than a route — the
 * URL carries the tab and nothing else — but it is no longer an axis of its
 * own that could disagree with the Sound view's target. Kept here rather than
 * in store/types.ts because both the store and the components read it,
 * exactly as `ViewMode` is.
 *
 * The const array is the source of truth and the union derives from it, the
 * `PAD_MODES` pattern below. That is what gives `PATTERN_SEGMENTS` in
 * components/viewMeta.ts something to be checked against: that table is a LIST,
 * not a `Record<PatternSegment, …>` like `VIEW_META`, so the compiler cannot
 * see a segment it is missing — `SegmentHeader` would throw at render and
 * `PatternView` would show a blank tab. viewMeta.test.ts closes that by
 * comparing the table's ids to this array.
 */
export const PATTERN_SEGMENT_IDS = ['lead', 'fx', 'accompaniment', 'beat'] as const;
export type PatternSegment = (typeof PATTERN_SEGMENT_IDS)[number];

/**
 * The two tabs of each layer, and — through `ViewMode` above — the roster of
 * every view id there is.
 *
 * `as const` and the union derived from THEM, not the reverse: a tab that
 * exists in `ViewMode` but in neither list is a tab the router refuses and the
 * nav gives no button, which is a broken view with no type error anywhere.
 * Deriving the union makes that shape unwritable, the same `PAD_MODES` rule
 * `PATTERN_SEGMENT_IDS` above follows.
 */
export const LOOP_TABS = ['sound', 'pattern'] as const;
export const SONG_TABS = ['arrange', 'master'] as const;

/**
 * Derived from `SONG_TABS`, never a second literal. A hand-written
 * `tab === 'arrange' || tab === 'master'` was a third copy of the split, and
 * the one no test would have caught: a tab added to `SONG_TABS` gets a nav
 * button and a valid route in the same edit, but `layerForTab` would still
 * call it a LOOP tab — so `LoopPage` would render nothing for it, the master
 * Play would run `soloLoop` instead of `playAll`, and `soloNav` would clear
 * the track solo on the way in.
 *
 * A module-scope Set rather than `SONG_TABS.includes(tab)`: `layerForTab` runs
 * on every store `set()` (soloNav's root subscription reads it) and in the
 * render body of Header, TransportBar and SoundView, so the derivation is kept
 * and the linear scan is not.
 */
const SONG_TAB_SET: ReadonlySet<string> = new Set(SONG_TABS);

export function isSongLayer(tab: ViewMode): boolean {
  return SONG_TAB_SET.has(tab);
}

export function layerForTab(tab: ViewMode): Layer {
  return isSongLayer(tab) ? 'song' : 'loop';
}

/**
 * The pad layer's two articulations. `pad` follows the chords; `drone` does not.
 *
 * The const array is the source of truth and the union derives from it, like
 * PAD_INTERVALS below: sanitize builds its validation Set from this array, so a
 * mode added here is accepted by `asPadMode` in the same edit. Hand-written
 * Sets have no such link — a value the UI offers and the store holds would come
 * back reverted on every reopen, with no type error and no failing build.
 */
export const PAD_MODES = ['pad', 'drone'] as const;
export type PadMode = (typeof PAD_MODES)[number];

/** How a chord is reduced before the pad plays it. Dormant in drone mode. */
export const PAD_VOICINGS = ['triad', 'open5', 'root'] as const;
export type PadVoicing = (typeof PAD_VOICINGS)[number];

/**
 * Intervals a drone may stack over its degree's root, in scale-degree-free
 * interval numbers: 1 = unison, 4 = perfect fourth, 5 = perfect fifth,
 * 8 = octave, 12 = perfect twelfth (an octave plus a fifth, 19 semitones).
 *
 * A literal union, not an enum: this file must keep importing nothing but the
 * leaf `utils/meter`, and these values are persisted verbatim in `.solna`
 * bodies, so the numbers are the contract.
 */
export type PadInterval = 1 | 4 | 5 | 8 | 12;

/** Render order for the interval toggles, and the validation set for sanitize. */
export const PAD_INTERVALS: readonly PadInterval[] = [1, 4, 5, 8, 12];

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** The synth keyboard's input mode: how key presses are mapped to notes. */
export type KeyboardMode = 'chromatic' | 'scale-locked' | 'chord';

/** The bottom input dock's active surface. */
export type InputPanelMode = 'keyboard' | 'drums';

/**
 * Arpeggiator order and rate. Declared here rather than in audio/arpeggiator.ts
 * and audio/arpSchedule.ts because both of those modules need them and this
 * file imports only the leaf module `utils/meter`, so it must stay acyclic.
 * Both audio modules re-export them, so their existing import paths keep
 * working — the point is that there is one definition instead of an inline
 * copy here and a named copy there that could drift. `ArpSettings`
 * (`src/types/synth.ts`) deliberately inlines its own literal unions instead,
 * so that module stays independent of this one.
 */
export type ArpMode = 'up' | 'down' | 'updown' | 'random';
export type ArpRate = '4n' | '8n' | '16n' | '32n';

export interface DrumPad {
  id: string;
  name: string;
  note: string;
  color: string;
  shortcut: string;
  volume: number;
  pitch: number;
  decay: number;
}

export interface ChordItem {
  id: string;
  root: string;
  quality: ChordQuality;
  bars: number;
  bassNote?: string | null; // bass override note name ('E4'); null/absent = auto root
}

export interface CustomChordProgressionItem {
  id: string;
  name: string;
  category: string;
  description: string;
  roman: string;
  chords: ChordItem[];
  createdAt: number;
}

export interface MasterEffects {
  reverbWet: number;
  reverbDecay: number;
  reverbBypass?: boolean;
  delayWet: number;
  delayFeedback: number;
  delayBypass?: boolean;
  distortionWet: number;
  distortionBypass?: boolean;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  eqBypass?: boolean;

  /**
   * The two master dynamics stages (DEV-385). They are REQUIRED booleans named
   * `*Enabled`, not the optional `*Bypass?` the parallel sends use, for three
   * reasons that are all load-bearing:
   *
   *  1. `*Bypass?` reads absent-as-active. These default OFF, so an optional
   *     flag could not express the default without every payload carrying it.
   *  2. `*Bypass` means "force the wet send to 0" (see engine.updateEffects). A
   *     series stage cannot be bypassed that way — wet 0 on a compressor is
   *     silence, not passthrough — so these drive a real graph rewire instead,
   *     and a different name keeps that difference visible at the call site.
   *  3. `compressorBypass` is a DEAD legacy key that sanitizeEffectsValue
   *     deletes from old payloads. Reusing the name would make the sanitizer
   *     delete the live field.
   *
   * knee is deliberately NOT here: it stays a fixed engine constant (30 for the
   * compressor, 0 for the limiter — the hard knee is what makes the limiter a
   * limiter), so the stored surface is only what the UI actually offers.
   */
  compressorEnabled: boolean;
  compressorThreshold: number;
  compressorRatio: number;
  /** Seconds. */
  compressorAttack: number;
  /** Seconds. */
  compressorRelease: number;
  limiterEnabled: boolean;
  limiterThreshold: number;
  limiterRatio: number;
  /** Seconds. */
  limiterAttack: number;
  /** Seconds. */
  limiterRelease: number;
}

/**
 * ============================ The Beat instrument ============================
 *
 * Beat is the loop's rhythmic instrument. Its three sibling fields — `BeatParams`
 * (sound), `BeatPattern` (events) and `BeatMix` (levels) — are stored separately
 * so a sound edit can never replace the pattern or the mix object.
 *
 * These replaced an engine-facing kit shape whose voices were PARTIAL — a voice
 * could omit a field and a merge against one shared default table supplied it.
 * Every field here is REQUIRED and finite instead, because a patch a user can
 * edit, save and export must not depend on a default table it does not carry:
 * a kick with no click is `clickLevel: 0`, not three missing keys.
 */
/**
 * The eleven voices. A literal union rather than a union derived from a const
 * array, which is the pattern `PAD_MODES` sets, because the array a consumer
 * iterates cannot live here: it belongs to the factory catalogue, and
 * `src/data/beatPresets.ts` is a leaf that may import no sibling — so it
 * declares `BEAT_VOICE_IDS` itself. Two lists and no more:
 * `beatPresets.test.ts` asserts that array is exactly this union, in this
 * order, so neither can drift without the other.
 */
export type BeatVoiceId =
  | 'kick' | 'snare' | 'rimshot' | 'clap' | 'hihat' | 'openhat'
  | 'hitom' | 'lowtom' | 'ride' | 'crash' | 'bell';

/** Kick: a pitch-swept body plus a beater click that is always stated. */
export interface BeatKickParams {
  freqStart: number;
  freqEnd: number;
  pitchTime: number;
  decay: number;
  gain: number;
  /** Hz. Inert while `clickLevel` is 0, and kept anyway: it is where the click
   *  lands the moment a user raises the level, so it must be a real value. */
  clickFreq: number;
  /** 0..1. Zero IS "no click" — the disabled state, not a missing field. */
  clickLevel: number;
  clickDecay: number;
  /** Level into the drum reverb send, 0..1. The BODY only — the click stays dry. */
  reverbSend: number;
}

/** Snare and rimshot: the same two-partial body plus noise block, voiced apart. */
export interface BeatSnareParams {
  bodyFreqStart: number;
  bodyFreqEnd: number;
  bodyTime: number;
  bodyDecay: number;
  bodyGain: number;
  bodyFreqStart2: number;
  bodyFreqEnd2: number;
  bodyGain2: number;
  noiseFilter: number;
  noiseDecay: number;
  noiseGain: number;
  reverbSend: number;
}

/** Closed and open hat: a band (`filter` floor, `topCut` ceiling) over a
 *  bank/noise crossfade. */
export interface BeatHatParams {
  filter: number;
  topCut: number;
  decay: number;
  gain: number;
  /** 0..1 crossfade: 0 is pure noise, 1 is pure metallic bank. */
  metal: number;
}

export interface BeatClapParams {
  filter: number;
  decay: number;
  gain: number;
  reverbSend: number;
}

export interface BeatTomParams {
  freqStart: number;
  freqEnd: number;
  pitchTime: number;
  decay: number;
  gain: number;
  reverbSend: number;
}

export interface BeatRideParams {
  tone: number;
  ping: number;
  pingFilter: number;
  pingDecay: number;
  washFilter: number;
  washDecay: number;
  bodyFilter: number;
  metal: number;
  gain: number;
  reverbSend: number;
}

export interface BeatCrashParams {
  filter: number;
  decay: number;
  gain: number;
  reverbSend: number;
  metal: number;
}

export interface BeatBellParams {
  freq1: number;
  freq2: number;
  filter: number;
  decay: number;
  gain: number;
  reverbSend: number;
}

/**
 * One member per `BeatVoiceId`, written out in canonical order rather than as a
 * `Record<BeatVoiceId, …>`: the eight parameter families are differently shaped,
 * so a mapped type would need a cast at every read.
 */
export interface BeatVoices {
  kick: BeatKickParams;
  snare: BeatSnareParams;
  rimshot: BeatSnareParams;
  clap: BeatClapParams;
  hihat: BeatHatParams;
  openhat: BeatHatParams;
  hitom: BeatTomParams;
  lowtom: BeatTomParams;
  ride: BeatRideParams;
  crash: BeatCrashParams;
  bell: BeatBellParams;
}

/** The Beat-wide bus filter. `cutoff` is Hz; it drives both the dry and the send
 *  filter, exactly as the loop's `drumFilter*` fields do today. */
export interface BeatFilterParams {
  type: FilterType;
  cutoff: number;
  resonance: number;
}

/**
 * A complete Beat sound, with no reference to where it came from.
 *
 * `outputTrimDb` is measured calibration metadata and is NOT user-editable. It
 * lives in the patch — the `common.outputGainDb` precedent — so a patch a user
 * edits, saves or exports stays calibrated, where a name-keyed lookup silently
 * gave a renamed or user-authored patch somebody else's trim.
 */
export interface BeatPatch {
  outputTrimDb: number;
  filter: BeatFilterParams;
  voices: BeatVoices;
}

/**
 * What one loop holds. The patch plus the id it was copied from: `basePresetId`
 * is display and reset provenance, never a DSP input, and it survives editing so
 * `Edited` can be derived by comparing the patch with its base. An unresolvable
 * base is `null` — the sound stays exactly as stored and the UI says so.
 */
export interface BeatParams extends BeatPatch {
  basePresetId: string | null;
}

/** Fixed-width boolean rows, one per voice. Width is the widest meter's bar. */
export interface BeatPattern {
  rows: Record<BeatVoiceId, boolean[]>;
}

/** A user-owned dB fader and mute, per voice. Distinct from the voice `gain`
 *  inside `BeatPatch`, which is preset voicing a reset restores. */
export interface BeatVoiceMix {
  levelDb: number;
  muted: boolean;
}

export interface BeatMix {
  levelDb: number;
  muted: boolean;
  voices: Record<BeatVoiceId, BeatVoiceMix>;
}

/** A named template a patch is copied FROM. User presets carry the same shape. */
export interface BeatPreset {
  id: string;
  name: string;
  origin: 'factory' | 'user';
  patch: BeatPatch;
}

/**
 * What a factory Beat preset is modelled on. Required, not optional, for the
 * reason that field records: an optional field makes omission the default and
 * silence indistinguishable from "nobody looked". It sits on the FACTORY entry
 * type only — a user preset has no referent, and `BeatPatch` is pure engine
 * params either way.
 *
 * NOT exported: `FactoryBeatPreset` below is the shape every consumer names,
 * and an exported alias nothing imports is a second public name for one idea.
 */
interface BeatPresetReference {
  referent: string;
  source: string;
  reachable: string;
}

export interface FactoryBeatPreset extends BeatPreset {
  origin: 'factory';
  reference: BeatPresetReference;
}
