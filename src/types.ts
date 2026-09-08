
/**
 * The four tabs, two per layer. The loop layer's split is a rule, not a
 * grouping of what happened to exist: changes the SOUND but not the notes →
 * `sound`; changes the NOTES or the rhythm → `pattern`. Oscillator, filter,
 * envelopes, LFO, arpeggiator, the preset library and the faders are Sound;
 * chord progression, chord rhythm, bass pattern, drum grid and drum kit are
 * Pattern. `arrange` now means one thing only — ordering loops — and nothing
 * else may take that name.
 *
 * Pattern's three segments are a SECOND axis (`patternSegment` in the ui
 * slice), not three more view ids: the router validates exactly one query key,
 * and a segment is a within-tab position, not a route.
 */
export type ViewMode = (typeof LOOP_TABS)[number] | (typeof SONG_TABS)[number];

export type Layer = 'loop' | 'song';

/**
 * Pattern's three segments. A second axis alongside `ViewMode`, not three more
 * view ids: the URL carries the tab, and a segment is a position inside one
 * tab. Kept here rather than in store/types.ts because both the store and the
 * components read it, exactly as `ViewMode` is.
 *
 * The const array is the source of truth and the union derives from it, the
 * `PAD_MODES` pattern below. That is what gives `PATTERN_SEGMENTS` in
 * components/viewMeta.ts something to be checked against: that table is a LIST,
 * not a `Record<PatternSegment, …>` like `VIEW_META`, so the compiler cannot
 * see a segment it is missing — `SegmentHeader` would throw at render and
 * `PatternView` would show a blank tab. viewMeta.test.ts closes that by
 * comparing the table's ids to this array.
 */
export const PATTERN_SEGMENT_IDS = ['lead', 'accompaniment', 'beat'] as const;
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

export type ArrangementTrackType = 'chords' | 'drums' | 'bass' | 'lead';

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

export interface LeadNote {
  note: string;
  step: number; // 0-based step within the region
  durationSteps: number; // in 16th steps
  velocity?: number;
}

export interface ArrangementRegionData {
  // Chords data
  chords?: ChordItem[];
  chordRhythmId?: string;
  chordFeel?: number;
  chordOctave?: number;
  chordPresetId?: string;
  // Drums data
  drumPattern?: Record<string, boolean[]>;
  soundKit?: string;
  // Bass data
  bassPatternId?: string;
  bassFeel?: number;
  bassOctave?: number;
  bassPresetId?: string;
  // Lead / Synth data
  synthParams?: SynthParams;
  leadNotes?: LeadNote[];
}

export interface ArrangementRegion {
  id: string;
  trackType: ArrangementTrackType;
  name: string;
  startBar: number; // 0-based bar index
  lengthBars: number; // in bars (e.g. 2, 4, 8)
  color?: string; // semantic tag e.g. 'primary' | 'secondary' | 'accent' | 'warning' | 'info' | 'success'
  data: ArrangementRegionData;
}

export interface SongArrangement {
  totalBars: number;
  loopEnabled: boolean;
  loopStartBar: number;
  loopEndBar: number;
  regions: ArrangementRegion[];
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** The synth keyboard's input mode: how key presses are mapped to notes. */
export type KeyboardMode = 'chromatic' | 'scale-locked' | 'chord';

/** The bottom input dock's active surface. */
export type InputPanelMode = 'keyboard' | 'drums';

/**
 * Arpeggiator order and rate. Declared here rather than in audio/arpeggiator.ts
 * and audio/arpSchedule.ts because SynthParams needs them and this file imports
 * only the leaf module `utils/meter` and must stay acyclic. Both audio modules
 * re-export them, so their existing import paths keep working — the point is
 * that there is one definition instead of an inline copy here and a named
 * copy there that could drift.
 */
export type ArpMode = 'up' | 'down' | 'updown' | 'random';
export type ArpRate = '4n' | '8n' | '16n' | '32n';

export interface SynthParams {
  oscType: 'sawtooth' | 'square' | 'sine' | 'triangle';
  subOscVolume: number;
  noiseVolume: number;
  detune: number;
  filterType: FilterType;
  filterCutoff: number;
  filterResonance: number;
  filterEnvAmount: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterAttack: number;
  filterDecay: number;
  filterSustain: number;
  filterRelease: number;
  lfoRate: number;
  lfoDepth: number;
  lfoTarget: 'cutoff' | 'pitch' | 'volume';
  octave: number;
  // Required, not optional: INITIAL_SYNTH_PARAMS always sets all four and
  // sanitizeSynthParams always restores them, so the `?? 'up'` / `?? '16n'` /
  // `?? 1` / `?? false` that used to sit at 13 read sites were dead defaults
  // hiding the real contract.
  arpActive: boolean;
  arpMode: ArpMode;
  arpRate: ArpRate;
  arpOctaves: number;
  preset: string;
}

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

export interface SequencerTrack {
  id: string;
  name: string;
  instrument: string;
  color: string;
  /** DECIBELS, relative: unity is 0, the range is -60..+12. A LEVEL a fader
   *  owns, not a velocity: it becomes a per-instrument GainNode in the drum
   *  path, fed from engineSync via setDrumTrackGain. */
  volume: number;
  muted: boolean;
  steps: boolean[];
}

export interface ChordItem {
  id: string;
  root: string;
  quality: string;
  bars: number;
  notes: string[];
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

