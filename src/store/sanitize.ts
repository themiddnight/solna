import { INITIAL_EFFECTS, INITIAL_SYNTH_PARAMS } from './initialState';
import { EFFECT_LIMITS, clampEffectValue, type EffectNumericKey } from '../audio/effectLimits';
import type {
  SynthParams,
  ChordItem,
  SequencerTrack,
  FilterType,
  PadInterval,
  PadMode,
  PadVoicing,
} from '../types';
import { PAD_INTERVALS, PAD_MODES, PAD_VOICINGS } from '../types';
import { BASS_PATTERNS, type BassStepChoice } from '@/data/bassPatterns';
import { DRUM_KITS, DRUM_TYPES } from '@/data/drumKits';
import { CHORD_RHYTHMS } from '@/data/chordRhythms';
import { SCALES } from '@/data/scales';
import { createDefaultLoop } from './loopSlice';
import { LEAD_OCTAVE_MAX, LEAD_OCTAVE_MIN } from './leadSlice';
import type { Loop } from './types';
import type { LeadNote } from '../audio/leadMelody';
import {
  isLeadStepResolutionId,
  type LeadStepResolutionId,
} from '../utils/stepResolution';
import { ROOTS } from '../utils/musicTheory';
import { asFaderDb } from './levelUnits';

// Type-guards for a parsed persisted payload AND for a parsed `.solna` file.
// Wrong-typed values survive JSON.parse and would flow straight into engine
// setters (`bpm: "fast"` -> NaN clock, a string volume -> setTargetAtTime(NaN)),
// so both readers go through this one module — see projectFile.ts.
const OSC_TYPES = new Set(['sawtooth', 'square', 'sine', 'triangle']);
export const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass']);
const LFO_TARGETS = new Set(['cutoff', 'pitch', 'volume']);
const ARP_MODES = new Set(['up', 'down', 'updown', 'random']);
const ARP_RATES = new Set(['4n', '8n', '16n', '32n']);

/**
 * A stored step-resolution id, or the fallback. Its own rule rather than an
 * inline ternary because BOTH readers need it: the loop body below and the
 * flat persisted key that store.ts sanitizes.
 */
export function asLeadStepResolution(
  value: unknown,
  fallback: LeadStepResolutionId,
): LeadStepResolutionId {
  return isLeadStepResolutionId(value) ? value : fallback;
}

/**
 * Synth params are written straight onto AudioParams, so a wrong-typed
 * persisted value (a string cutoff, a null attack) would land as
 * setValueAtTime(NaN) and silence the voice. Each field keeps its stored value
 * only when the type matches the factory default — and, for the enum fields,
 * only when the engine and arpeggiator actually understand it.
 */
export function sanitizeSynthParams(value: unknown): SynthParams {
  const fallback = INITIAL_SYNTH_PARAMS;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const out = { ...fallback } as Record<string, unknown>;

  for (const [key, def] of Object.entries(fallback)) {
    const stored = raw[key];
    if (typeof def === 'number') {
      out[key] = typeof stored === 'number' && Number.isFinite(stored) ? stored : def;
    } else if (typeof def === 'boolean') {
      out[key] = typeof stored === 'boolean' ? stored : def;
    } else if (typeof def === 'string') {
      out[key] = typeof stored === 'string' ? stored : def;
    }
  }

  if (!OSC_TYPES.has(out.oscType as string)) out.oscType = fallback.oscType;
  if (!FILTER_TYPES.has(out.filterType as string)) out.filterType = fallback.filterType;
  if (!LFO_TARGETS.has(out.lfoTarget as string)) out.lfoTarget = fallback.lfoTarget;
  if (!ARP_MODES.has(out.arpMode as string)) out.arpMode = fallback.arpMode;
  if (!ARP_RATES.has(out.arpRate as string)) out.arpRate = fallback.arpRate;

  return out as unknown as SynthParams;
}

// The MasterEffects payload: plain-object check (a partial effects object
// with valid fields is preserved as-is; anything else falls back to the
// factory defaults), every numeric field clamped through the SAME table the
// engine uses (audio/effectLimits.ts) so the two can no longer drift — the
// old code clamped only reverbDecay and compressorThreshold and let a
// persisted delayFeedback of 1.2 through to a runaway feedback loop. The
// ternary can hand back the SHARED INITIAL_EFFECTS constant — clone before
// writing so the module constant is never mutated. Fields removed from
// MasterEffects must not resurrect from old persisted payloads.
export function sanitizeEffectsValue(effects: unknown): unknown {
  let result =
    typeof effects === 'object' && effects !== null && !Array.isArray(effects)
      ? effects
      : INITIAL_EFFECTS;

  if (result && typeof result === 'object') {
    if (result === INITIAL_EFFECTS) result = { ...INITIAL_EFFECTS };
    const fxWritable = result as Record<string, unknown>;
    for (const key of Object.keys(EFFECT_LIMITS) as EffectNumericKey[]) {
      fxWritable[key] = clampEffectValue(key, fxWritable[key]);
    }
  }

  if (result && typeof result === 'object') {
    // The two dynamics toggles are the only BOOLEAN fields with a meaningful
    // default, so they follow the same rule every other key here does —
    // missing or the wrong type gets the default, a real boolean passes
    // through. Persisted JSON is untrusted input, so a truthy STRING must
    // never insert a node into the master chain; it falls back to the
    // default like any other malformed value rather than being coerced.
    //
    // `=== true` alone was the bug: it reads a missing key as `false`, which
    // matched the default only while BOTH stages defaulted off. DEV-383
    // defaults `limiterEnabled` to `true`, so a .solna body or persist
    // payload written before DEV-385 — carrying neither key — would have
    // loaded limiter-OFF while a brand-new project of the same content
    // loaded limiter-ON. Reading the default from INITIAL_EFFECTS is what
    // keeps the two agreeing without a `formatVersion` bump: an old body
    // still sanitizes to the object a new one would.
    //
    // The key list is DERIVED from INITIAL_EFFECTS rather than written out,
    // matching the numeric loop directly above (which derives its keys from
    // EFFECT_LIMITS). A hand-written `['compressorEnabled', 'limiterEnabled']`
    // would reproduce this exact bug the day a third stage's `*Enabled` field
    // is added to MasterEffects and not to the literal — no type error, no
    // failing test, just a stage that silently reads as off.
    const flags = result as Record<string, unknown>;
    for (const [key, fallback] of Object.entries(INITIAL_EFFECTS)) {
      if (typeof fallback !== 'boolean') continue;
      if (typeof flags[key] !== 'boolean') flags[key] = fallback;
    }
  }

  if (result && typeof result === 'object') {
    // Fields removed from MasterEffects must not resurrect from old payloads.
    // `compressorRatio` has LEFT this list: DEV-385 makes the name real.
    // `compressorBypass` stays dead — DEV-385 deliberately spells the toggle
    // `compressorEnabled` instead, so this delete is still correct.
    const fx = result as Record<string, unknown>;
    for (const key of ['chorusRate', 'chorusDepth', 'chorusWet', 'compressorBypass', 'delayTime', 'distortionDrive']) {
      delete fx[key];
    }
  }

  return result;
}

export function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** For a persisted field whose absence is meaningful (no project, no baseline). */
export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function isPatternMode(value: unknown): value is 'preset' | 'custom' {
  return value === 'preset' || value === 'custom';
}

export function asPatternMode(value: unknown, fallback: 'preset' | 'custom'): 'preset' | 'custom' {
  return isPatternMode(value) ? value : fallback;
}

/**
 * The two shapes every "is this value a member of a known set" check in this
 * file takes. They were ten hand-written one-liners differing only by which
 * Set they closed over; a factory each means the semantics — a non-string is
 * never a member, and a non-member gets the fallback rather than being
 * deleted — are stated once instead of ten times.
 *
 * `memberOr` takes its type parameter at CONSTRUCTION, not per call: inferring
 * it from `fallback` would narrow the return type to the literal a caller
 * happened to pass (`asPadMode(v, 'up')` returning `'up'` rather than
 * `PadMode`), which reads as a stricter guarantee than the check makes.
 */
const memberTest =
  (set: ReadonlySet<string>) =>
  (value: unknown): boolean =>
    typeof value === 'string' && set.has(value);

const memberOr =
  <T extends string>(isMember: (value: unknown) => boolean) =>
  (value: unknown, fallback: T): T =>
    isMember(value) ? (value as T) : fallback;

export const asFilterType = memberOr<FilterType>(memberTest(FILTER_TYPES));

// Five persisted ids/labels that each name a real library entry, not just a
// string: the deleted migrateDrumVoices step used to carry a rename
// ('909 Modern' -> 'Club Standard'), so a session written before that rename
// landed can hold a soundKit the current DRUM_KITS table no longer has, and
// nothing short of a membership check catches it — a bare `typeof ===
// 'string'` lets it through to resolve to nothing and silently play the
// default kit. Same reasoning for a stale scale/root/rhythm/bass-pattern id.
// Built from the tables themselves (never re-typed), so a table edit updates
// the allowed set with no second place to touch.
const ROOT_SET = new Set<string>(ROOTS);
const SCALE_TYPE_SET = new Set(Object.keys(SCALES));
const CHORD_RHYTHM_ID_SET = new Set(CHORD_RHYTHMS.map((p) => p.id));
const BASS_PATTERN_ID_SET = new Set(BASS_PATTERNS.map((p) => p.id));
const SOUND_KIT_SET = new Set(Object.keys(DRUM_KITS));

export const isRootNote = memberTest(ROOT_SET);
export const isScaleType = memberTest(SCALE_TYPE_SET);
export const isChordRhythmId = memberTest(CHORD_RHYTHM_ID_SET);
export const isBassPatternId = memberTest(BASS_PATTERN_ID_SET);
const isSoundKit = memberTest(SOUND_KIT_SET);

export const asRootNote = memberOr<string>(isRootNote);
export const asScaleType = memberOr<string>(isScaleType);
export const asChordRhythmId = memberOr<string>(isChordRhythmId);
export const asBassPatternId = memberOr<string>(isBassPatternId);
export const asSoundKit = memberOr<string>(isSoundKit);

// Built from the const arrays the unions derive from, never re-typed here: a
// hand-written set has no link to the union, so a value the UI offers and the
// store holds would come back reverted on every reopen with no type error.
const PAD_MODE_SET = new Set<string>(PAD_MODES);
const PAD_VOICING_SET = new Set<string>(PAD_VOICINGS);
const PAD_INTERVAL_SET = new Set<number>(PAD_INTERVALS);

export const asPadMode = memberOr<PadMode>(memberTest(PAD_MODE_SET));
export const asPadVoicing = memberOr<PadVoicing>(memberTest(PAD_VOICING_SET));

/**
 * The ONE normalisation of a drone selection: filter to union members,
 * de-duplicate, sort ascending. Both the padSlice setters and the two readers
 * (persist payload and `.solna` body) go through it, so a selection stored by
 * an edit and one restored from disk are byte-identical.
 *
 * The sort is load-bearing: projectDirty fingerprints the content set, and an
 * unsorted array gives one selection two `projectDirty` fingerprints — an
 * unsaved-changes badge no edit caused.
 */
export function normalizePadIntervals(values: Iterable<unknown>): PadInterval[] {
  const seen = new Set<PadInterval>();
  for (const v of values) {
    if (typeof v === 'number' && PAD_INTERVAL_SET.has(v)) seen.add(v as PadInterval);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * An empty result is a legal selection (a silent drone), so only a non-array
 * falls back to the default; anything array-shaped is normalised.
 */
export function asPadIntervals(value: unknown, fallback: PadInterval[]): PadInterval[] {
  if (!Array.isArray(value)) return fallback;
  return normalizePadIntervals(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function asPositiveInteger(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}

/**
 * The ONE answer to "is this a stored lead melody", and it is a coercion
 * rather than a type guard: the most of a stored melody that can honestly be
 * kept. A note whose `len` is missing, fractional or below 1 has that one
 * field repaired (rounded, floored at one step) instead of costing the user
 * every other note in the melody — the spec's rule, and the same choice
 * `leadGate` makes through clampFinite one line below in sanitizeLoops. An
 * object entry with no usable `note` is dropped: there is no pitch to invent.
 *
 * The SHAPE, unlike `len`, stays all-or-nothing: `undefined` means "not a
 * melody at all" and the caller falls back to its default. That is what keeps
 * the v1 `string[][]` matrix refused whole — a bare string entry fails the
 * `typeof entry !== 'object'` check above and the whole value returns
 * `undefined`, rather than being coerced into rows of empty arrays wearing a
 * valid face. An explicit fallback to the default melody is the honest
 * result for a shape this function does not recognise; a blanked melody that
 * LOOKS like a deliberate empty one is not.
 */
export function asLeadNoteMatrix(value: unknown): LeadNote[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: LeadNote[][] = [];
  for (const row of value) {
    if (!Array.isArray(row)) return undefined;
    const notes: LeadNote[] = [];
    for (const entry of row) {
      // A non-object entry is not a broken note, it is a different shape
      // entirely (a v1 string, a number): the whole value is refused rather
      // than quietly coerced into rows of empty arrays.
      if (typeof entry !== 'object' || entry === null) return undefined;
      const { note, len } = entry as LeadNote;
      if (typeof note !== 'string') continue;
      notes.push({
        note,
        len: typeof len === 'number' && Number.isFinite(len) ? Math.max(1, Math.round(len)) : 1,
      });
    }
    out.push(notes);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((n) => typeof n === 'string');
}

/**
 * An array is kept only when EVERY element passes. All-or-nothing on purpose:
 * a per-element drop would silently shorten a chord progression or a drum
 * pattern into something the user never wrote, and the caller's fallback (the
 * default loop's value) is the honest answer to a corrupt array.
 */
function asCheckedArray<T>(value: unknown, isElement: (v: unknown) => boolean, fallback: T[]): T[] {
  return Array.isArray(value) && value.every(isElement) ? (value as T[]) : fallback;
}

/**
 * A chord is read by deriveChordNotes and played straight out of `notes`, so
 * every field the chord path dereferences must be the right type — a missing
 * `notes` array is a crash in the chord scheduler, not a wrong sound.
 * Exported so `store.ts` can apply the same element check to the flat
 * top-level `chords` key (a pre-loop-wrap shape sanitizeLoops never sees).
 */
export function isChordItem(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.root === 'string' &&
    typeof value.quality === 'string' &&
    typeof value.bars === 'number' &&
    Number.isFinite(value.bars) &&
    value.bars > 0 &&
    isStringArray(value.notes)
  );
}

// `instrument` must name a real drum voice, not just be a string: a value
// outside DRUM_TYPES (an old `tom` row from before the v6 rename, a typo, a
// hand-edited file) matches no `triggerDrum` case and would otherwise sit in
// the array as a silently dead row. This is a plain validation rule, not a
// version check — it rejects a bad instrument name from ANY source, on both
// the persist and `.solna` read paths that share this function.
const DRUM_INSTRUMENT_SET = new Set<string>(DRUM_TYPES);

/** The engine reads `instrument` and indexes `steps`; the rest is presentation. */
function isSequencerTrack(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.instrument === 'string' &&
    DRUM_INSTRUMENT_SET.has(value.instrument) &&
    Array.isArray(value.steps) &&
    value.steps.every((s) => typeof s === 'boolean')
  );
}

/**
 * `sequencerTracks` is a SET keyed by `instrument`, not a sequence — dropping
 * one invalid row loses one voice and shifts nothing else, unlike
 * `chords`/`customChordRhythm` where a per-element drop would rewrite the
 * music (see `asCheckedArray`'s docblock, which is why THAT function stays
 * all-or-nothing and this one does not reuse it). So this filters per-row: a
 * row naming an instrument outside the drum-voice roster (a pre-rename
 * `tom`, a typo, a hand-edited file) is DROPPED, never defaulted — inventing
 * a track for a name nobody recognises has no meaning, and a short roster is
 * already an outcome this app accepts (DEV-388 deleted the version-gated
 * auto-completion that used to backfill a short roster to the full
 * eleven-voice kit). An EMPTY roster is not a short one, though: nothing in
 * the UI can add a track back (`replaceDrumPattern` only maps over tracks
 * that already exist), so a loop whose every row was stale would otherwise
 * be permanently drumless with no recovery. `value` not being an array at
 * all is the same failure (no set to filter) and both fall back to
 * `fallback` whole. Exported so `store.ts`'s `sanitizeFlatSequencerTracks`
 * (the flat top-level key, a pre-loop-wrap shape this function never sees)
 * applies the same rule.
 */
export function sanitizeSequencerTracks(
  value: unknown,
  fallback: SequencerTrack[],
): SequencerTrack[] {
  if (!Array.isArray(value)) return fallback;
  const filtered = (value as unknown[]).filter(isSequencerTrack).map((track) => {
    const t = track as SequencerTrack;
    return { ...t, volume: asFaderDb(t.volume) };
  });
  return filtered.length > 0 ? filtered : fallback;
}

// Exhaustive by construction: a new BassStepChoice member fails to compile
// here until it is listed, so the guard cannot drift from the union.
const BASS_STEP_CHOICES: Record<BassStepChoice, true> = {
  rest: true, root: true, third: true, fifth: true, seventh: true, octave: true,
};

// Exported for the same reason as isChordItem: store.ts's flat `customBassPattern` key.
export function isBassStepChoice(value: unknown): boolean {
  return typeof value === 'string' && Object.hasOwn(BASS_STEP_CHOICES, value);
}

/**
 * A string field, trimmed, or '' for anything else — including a
 * whitespace-only string. Pulled out of sanitizeLoops (rather than inlined as
 * a typeof+ternary at each of its three call sites) so the trim doesn't add
 * three more branches to a function eslint's `complexity` rule already
 * measures near its ceiling.
 */
function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * One row's tempName resolution, pulled out of sanitizeLoops so its
 * if/else-plus-while lives in a function of its own rather than adding
 * three branches to one eslint's `complexity` rule already measures near its
 * ceiling. Behaviour is exactly what sanitizeLoops inlined before this split:
 * an explicit, trimmed, not-yet-used tempName wins; otherwise the next free
 * `untitled-N` ordinal is claimed, skipping any number an explicit tempName
 * elsewhere in this same array — already processed or still ahead — or an
 * earlier positional fallback already claimed.
 */
function resolveTempName(
  rawTempName: unknown,
  explicitTempNames: ReadonlySet<string>,
  usedTempNames: ReadonlySet<string>,
  nextOrdinal: number,
): { tempName: string; nextOrdinal: number } {
  const explicitTempName = trimmedString(rawTempName);
  if (explicitTempName.length > 0 && !usedTempNames.has(explicitTempName)) {
    return { tempName: explicitTempName, nextOrdinal };
  }
  let ordinal = nextOrdinal;
  while (explicitTempNames.has(`untitled-${ordinal}`) || usedTempNames.has(`untitled-${ordinal}`)) {
    ordinal++;
  }
  return { tempName: `untitled-${ordinal}`, nextOrdinal: ordinal + 1 };
}

/**
 * Validates a persisted `loops` array. Each loop is rebuilt through the
 * same per-field guards/clamps the flat payload used (synth params, finite
 * clamps, string/enum checks), with createDefaultLoop() as the fallback for
 * missing or wrong-typed fields. Rows that are not plain objects are dropped;
 * an empty result means "no valid loops" and the caller falls back to the
 * default single loop.
 *
 * The array fields are checked ELEMENT-WISE, not just for Array.isArray: this
 * is also the import path for a `.solna` file that came from somebody else's
 * device (projectFile.ts), so `{"chords": [1, 2, 3]}` must never reach the
 * chord scheduler.
 */
export function sanitizeLoops(value: unknown): Loop[] | undefined {
  if (!Array.isArray(value)) return undefined;
  // Every EXPLICIT tempName the raw array already carries, gathered up front.
  // The positional fallback below picks an `untitled-N` ordinal one row at a
  // time and must never land on a number some OTHER row in this same array
  // claims explicitly — whether that row was already processed or still lies
  // ahead — or two loops read back indistinguishable everywhere loopLabel is
  // used (the Arrange card, the LoopSelector dropdown, LoopCopyDialog's aria-labels).
  // Trimmed before the length check and before it goes in the set: a
  // whitespace-only tempName (`"   "`) is not a name at all — `tempName`'s
  // whole contract is 'the APP's label, never empty', and a non-empty-but-
  // blank string is truthy in JS, so an untrimmed check would accept it
  // verbatim and hand every render site (the Arrange card, the LoopSelector
  // dropdown, TransportBar, every card aria-label) invisible text with no
  // in-app way to fix it.
  const explicitTempNames = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const t = trimmedString((raw as Record<string, unknown>).tempName);
    if (t.length > 0) explicitTempNames.add(t);
  }
  // Names already handed to an EARLIER row in this same pass — explicit or
  // positional. tempName's whole contract is to distinguish loops, so a
  // second row explicitly carrying a name the first row already claimed
  // (e.g. two hand-edited rows both saying `tempName: "untitled-2"`) must
  // fall through to the positional fallback rather than being taken at
  // face value twice.
  const usedTempNames = new Set<string>();
  let nextOrdinal = 1;
  const loops: Loop[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const fallback = createDefaultLoop();
    // `tempName` is read off the RAW row, not off `r`: its fallback is
    // POSITIONAL, and createDefaultLoop()'s constant `untitled-1` would
    // otherwise satisfy the guard for every row in the array and hand them all
    // the same label. Every other field's fallback is a constant, so every
    // other field reads `r`.
    const rawLoop = raw as Record<string, unknown>;
    const r = { ...fallback, ...rawLoop } as Record<string, unknown>;
    const resolved = resolveTempName(rawLoop.tempName, explicitTempNames, usedTempNames, nextOrdinal);
    const tempName = resolved.tempName;
    nextOrdinal = resolved.nextOrdinal;
    usedTempNames.add(tempName); // claim it: no later row, explicit or positional, may reuse it
    loops.push({
      id: typeof r.id === 'string' && r.id.length > 0 ? r.id : `loop-${loops.length}`,
      // Trimmed for the same reason tempName is above: renameFromDraft
      // (SortableLoopCard.tsx) never lets a user save a whitespace-only name
      // in the first place, so an untrimmed sanitize would accept from an
      // imported file the one blank-but-truthy `name` a rename can't produce
      // — and `loopLabel`'s `name || tempName` falls back to tempName only
      // when name is empty, never when it is merely blank.
      name: trimmedString(r.name),
      tempName,
      repeatCount: clampFinite(asPositiveInteger(r.repeatCount, fallback.repeatCount ?? 1), 1, 32, 1),
      scaleRoot: asRootNote(r.scaleRoot, fallback.scaleRoot),
      scaleType: asScaleType(r.scaleType, fallback.scaleType),
      synthParams: sanitizeSynthParams(r.synthParams),
      chordSynthParams: sanitizeSynthParams(r.chordSynthParams),
      bassSynthParams: sanitizeSynthParams(r.bassSynthParams),
      chords: asCheckedArray<ChordItem>(r.chords, isChordItem, fallback.chords),
      chordRhythmId: asChordRhythmId(r.chordRhythmId, fallback.chordRhythmId),
      chordRhythmMode: asPatternMode(r.chordRhythmMode, fallback.chordRhythmMode),
      customChordRhythm: asCheckedArray<boolean>(r.customChordRhythm, (v) => typeof v === 'boolean', fallback.customChordRhythm),
      chordFeel: clampFinite(r.chordFeel, 0, 1, fallback.chordFeel),
      chordOctave: clampFinite(r.chordOctave, 0, 8, fallback.chordOctave),
      bassPatternId: asBassPatternId(r.bassPatternId, fallback.bassPatternId),
      bassPatternMode: asPatternMode(r.bassPatternMode, fallback.bassPatternMode),
      customBassPattern: asCheckedArray<BassStepChoice>(r.customBassPattern, isBassStepChoice, fallback.customBassPattern),
      bassFeel: clampFinite(r.bassFeel, 0, 1, fallback.bassFeel),
      bassOctave: clampFinite(r.bassOctave, 0, 8, fallback.bassOctave),
      padSynthParams: sanitizeSynthParams(r.padSynthParams),
      padMode: asPadMode(r.padMode, fallback.padMode),
      padOctave: clampFinite(r.padOctave, 0, 8, fallback.padOctave),
      padVoicing: asPadVoicing(r.padVoicing, fallback.padVoicing),
      padDroneDegree: clampFinite(r.padDroneDegree, 0, 127, fallback.padDroneDegree),
      padDroneIntervals: asPadIntervals(r.padDroneIntervals, fallback.padDroneIntervals),
      padVolume: asFaderDb(r.padVolume, fallback.padVolume),
      padMuted: asBoolean(r.padMuted),
      leadMelodySteps: asLeadNoteMatrix(r.leadMelodySteps) ?? fallback.leadMelodySteps,
      leadLoopLength: asPositiveInteger(r.leadLoopLength, fallback.leadLoopLength),
      leadStepResolution: asLeadStepResolution(
        r.leadStepResolution,
        fallback.leadStepResolution,
      ),
      leadMelodyView: r.leadMelodyView === 'chromatic' ? 'chromatic' : 'scale-locked',
      leadMelodyOctave: clampFinite(
        r.leadMelodyOctave, LEAD_OCTAVE_MIN, LEAD_OCTAVE_MAX, fallback.leadMelodyOctave,
      ),
      leadGate: clampFinite(r.leadGate, 0.05, 1, fallback.leadGate),
      // `sanitizeLoops` is ONE function reached from BOTH untrusted-input
      // paths — projectFile.ts's `.solna` import and store.ts's
      // `sanitizePersistedState` on rehydrate — so `sanitizeSequencerTracks`
      // (per-row filter, then a volume clamp per surviving row so an
      // unclamped number never reaches faderDbToGain, which fails safe to
      // SILENCE) is a single shared site, not a second copy.
      sequencerTracks: sanitizeSequencerTracks(r.sequencerTracks, fallback.sequencerTracks),
      soundKit: asSoundKit(r.soundKit, fallback.soundKit),
      drumFilterCutoff: clampFinite(r.drumFilterCutoff, 50, 12000, fallback.drumFilterCutoff),
      drumFilterResonance: clampFinite(r.drumFilterResonance, 0.1, 20, fallback.drumFilterResonance),
      drumFilterType: asFilterType(r.drumFilterType, fallback.drumFilterType),
      synthVolume: asFaderDb(r.synthVolume, fallback.synthVolume),
      synthMuted: asBoolean(r.synthMuted),
      chordVolume: asFaderDb(r.chordVolume, fallback.chordVolume),
      chordMuted: asBoolean(r.chordMuted),
      bassVolume: asFaderDb(r.bassVolume, fallback.bassVolume),
      bassMuted: asBoolean(r.bassMuted),
      masterSequencerVolume: asFaderDb(r.masterSequencerVolume, fallback.masterSequencerVolume),
      drumMuted: asBoolean(r.drumMuted),
    });
  }
  return loops.length > 0 ? loops : undefined;
}
