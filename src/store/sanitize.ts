import { INITIAL_EFFECTS, TRACK_ARP_DEFAULTS, TRACK_SYNTH_DEFAULTS } from './initialState';
import { sanitizeActiveSynth, sanitizeArpSettings, validateActiveSynth } from './sanitizeSynth';
import { SYNTH_CATEGORIES, SYNTH_TAGS } from '@/data/synthPresets';
import type { SynthPreset, SynthPresetCategory, SynthTag } from '@/data/synthPresets';
import type { ActiveSynth, ArpSettings } from '@/types/synth';
import type { SynthControlTarget } from '@/utils/synthControl';
import { EFFECT_LIMITS, clampEffectValue, type EffectNumericKey } from '../audio/effectLimits';
import type {
  ChordItem,
  CustomChordProgressionItem,
  PadInterval,
  PadMode,
  PadVoicing,
} from '../types';
import { PAD_INTERVALS, PAD_MODES, PAD_VOICINGS } from '../types';
import { BASS_PATTERNS, type BassStepChoice } from '@/data/bassPatterns';
import { CHORD_RHYTHMS } from '@/data/chordRhythms';
import { SCALES } from '@/data/scales';
import { createDefaultLoop } from './loopSlice';
import { readBeatState, type BeatState } from './sanitizeBeat';
import { MAX_CUSTOM_PATTERN_BARS, normalizeCustomPattern, progressionBars } from './loop';
import { resizePatternBars } from '../utils/customPattern';
import { DEFAULT_METER_ID, getMeter, MAX_STEPS_PER_BAR, type MeterId } from '../utils/meter';
import { clampLoopLength } from '../utils/patternTimeline';
import { LEAD_OCTAVE_MAX, LEAD_OCTAVE_MIN } from './leadSlice';
import { getChordQualityEntry, pitchClassOfNote } from '@/musicCore';
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
/**
 * A stored step-resolution id, or the fallback. Its own rule rather than an
 * inline ternary because BOTH readers need it: the loop body below and the
 * flat persisted key that store.ts sanitizes.
 */
function asLeadStepResolution(
  value: unknown,
  fallback: LeadStepResolutionId,
): LeadStepResolutionId {
  return isLeadStepResolutionId(value) ? value : fallback;
}

/**
 * One track's patch, validated against the complete `ActiveSynth` shape.
 *
 * Delegates to `sanitizeActiveSynth` (store/sanitizeSynth.ts) and does NOT
 * re-state the engine's enums here: a patch has four of them and a second copy
 * of any one would accept a value the voice cannot build the day the two
 * disagree. This wrapper exists only to name the per-target FALLBACK, which
 * `sanitizeSynth.ts` has no business knowing.
 *
 * Whole-value, never a partial merge: an incompatible legacy flat
 * `SynthParams` body has no valid engine tag, so it falls back to the target's
 * complete default rather than being widened field by field. That is the
 * recorded decision behind "there are no migration chains" — a flat body is
 * not an old version of this shape, it is an invalid one.
 */
export function sanitizeTrackSynth(value: unknown, target: SynthControlTarget): ActiveSynth {
  return sanitizeActiveSynth(value, TRACK_SYNTH_DEFAULTS[target]).value;
}

const PRESET_CATEGORIES = new Set<string>(SYNTH_CATEGORIES.map((c) => c.id));
const KNOWN_TAGS = new Set<string>(SYNTH_TAGS);

/**
 * The user's saved presets, read back out of `localStorage`.
 *
 * DROPS rather than repairs. Every other sanitizer here substitutes a default,
 * because the track it guards must end up holding something playable; a preset
 * library is a list, and a list can be one item shorter. Substituting would
 * leave an entry sitting in the browser under the name the user gave it while
 * sounding like the init patch — the one outcome that reads as the app having
 * silently edited their work.
 *
 * The legacy flat `Partial<SynthParams>` entries saved before the engine
 * cutover carry no `engine` and no `patch`, so they fail `validateActiveSynth`
 * and are dropped here. That is the recorded "no migration chains" decision
 * applied to this key: a flat body is not an old version of a patch, it is an
 * invalid one, and under the no-real-users precondition guessing at units is
 * worse than losing a browser-local patch.
 *
 * Unknown tags are filtered out of a surviving entry rather than invalidating
 * it: a tag is a filter label, and dropping a whole sound over one is a trade
 * nobody would choose.
 */
export function sanitizeCustomSynthPresets(value: unknown): SynthPreset[] {
  if (!Array.isArray(value)) return [];
  const kept: SynthPreset[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== 'string' || entry.id === '') continue;
    if (typeof entry.name !== 'string' || entry.name === '') continue;
    // `sourcePresetId` is supplied here rather than read: a preset entry has
    // no provenance field of its own — it IS the source — and the shared
    // validator rejects an `undefined` one.
    const { value: activeSynth } = validateActiveSynth({
      engine: entry.engine,
      patch: entry.patch,
      sourcePresetId: null,
    });
    if (!activeSynth) continue;
    const category = PRESET_CATEGORIES.has(entry.category as string)
      ? (entry.category as SynthPresetCategory)
      : 'User';
    kept.push({
      id: entry.id,
      name: entry.name,
      category,
      engine: activeSynth.engine,
      patch: activeSynth.patch,
      tags: Array.isArray(entry.tags)
        ? (entry.tags.filter((t) => typeof t === 'string' && KNOWN_TAGS.has(t)) as SynthTag[])
        : [],
      description: typeof entry.description === 'string' ? entry.description : '',
      // A factory entry cannot be stored here: the library is code, and an
      // entry claiming `isFactory` would sort into a category group it is not
      // in and offer no delete button.
      isFactory: false,
      ...(typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
        ? { createdAt: entry.createdAt }
        : {}),
    });
  }
  return kept;
}

/** One track's Arp settings, whole-value, falling back to that track's default. */
export function sanitizeTrackArp(value: unknown, target: SynthControlTarget): ArpSettings {
  return sanitizeArpSettings(value, TRACK_ARP_DEFAULTS[target]);
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

function isPatternMode(value: unknown): value is 'preset' | 'custom' {
  return value === 'preset' || value === 'custom';
}

function asPatternMode(value: unknown, fallback: 'preset' | 'custom'): 'preset' | 'custom' {
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

// Four persisted ids that each name a real library entry, not just a string: a
// session written before a library rename landed can hold an id the current
// table no longer has, and nothing short of a membership check catches it — a
// bare `typeof === 'string'` lets it through to resolve to nothing and
// silently play the default. Built from the tables themselves (never
// re-typed), so a table edit updates the allowed set with no second place to
// touch.
const ROOT_SET = new Set<string>(ROOTS);
const SCALE_TYPE_SET = new Set(Object.keys(SCALES));
const CHORD_RHYTHM_ID_SET = new Set(CHORD_RHYTHMS.map((p) => p.id));
const BASS_PATTERN_ID_SET = new Set(BASS_PATTERNS.map((p) => p.id));

const isRootNote = memberTest(ROOT_SET);
const isScaleType = memberTest(SCALE_TYPE_SET);
const isChordRhythmId = memberTest(CHORD_RHYTHM_ID_SET);
const isBassPatternId = memberTest(BASS_PATTERN_ID_SET);

const asRootNote = memberOr<string>(isRootNote);
const asScaleType = memberOr<string>(isScaleType);
const asChordRhythmId = memberOr<string>(isChordRhythmId);
const asBassPatternId = memberOr<string>(isBassPatternId);

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
 * The sort is load-bearing, not cosmetic: [5, 1] and [1, 5] are the same
 * selection, and without it that one selection has two on-disk spellings — so
 * an unchanged drone round-trips through a load as a change.
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function asPositiveInteger(value: unknown, fallback: number): number {
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

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
 * `notes` is not part of the validated shape here because it is not part of
 * `ChordItem` — every reader derives a chord's pitches from `root`/`quality`
 * and an octave it already owns (Music Core's `resolveChordNotes`), so a
 * persisted body carrying a stray `notes` key (old data, a hand-edited file)
 * has it silently dropped rather than validated, checked or passed through.
 * That is deliberate, not an oversight: per this repo's "no migration
 * chains" rule, this is validation, not a migration step, and the fields
 * below are exactly the fields `ChordItem` has.
 *
 * `root` and `quality` are both checked against a closed set, not just
 * `typeof === 'string'`: `resolveChordNotes` (Music Core) throws on either an
 * unregistered quality or a root Tonal can't resolve, and this guard is what
 * stands between a stale/imported string and that throw. `isRootNote` reuses
 * the same `ROOT_SET` membership check every other persisted root field in
 * this file uses (`scaleRoot`, above), rather than re-deriving root validity a
 * second way. `ROOT_SET` is exactly the 12 canonical sharp-spelled names in
 * `ROOTS` — per DEV-380's canonical-identity contract, everything persisted is
 * `ROOTS`-spelled, so a flat-spelled root (e.g. `Db`) is rejected here even
 * though it is musically equivalent and would previously have resolved fine;
 * a valid chord's `root` must already be in its exact canonical spelling, not
 * merely a spelling Tonal could parse.
 *
 * A chord failing either check is rejected WHOLE by `asCheckedArray`'s
 * all-or-nothing rule (see its call site in sanitizeLoops) — one invalid
 * chord anywhere in a loop's `chords` array falls the WHOLE array back to the
 * default loop's chords, not just the offending element, matching every other
 * array of records in this file. This is a wider blast radius than the
 * pre-hardening behavior, where a bad quality simply rendered as a
 * wrong-but-non-crashing chord instead of discarding its siblings too.
 *
 * Quality is checked with `getChordQualityEntry(...)?.token === value.quality`,
 * NOT the bare `isChordQuality` guard: `isChordQuality`'s own docblock says
 * its case-insensitive narrow is unsound for anything that persists the value
 * or uses it as a lookup key, and this function admits the original-case
 * string straight into `ChordItem.quality`, typed as canonical `ChordQuality`.
 * A wrong-case-but-registered token (`'Min7'`) would pass `isChordQuality` yet
 * match no `<select>` option and no exact-token comparison downstream — the
 * token-equality check rejects anything not already in its exact canonical
 * spelling.
 *
 * `bassNote` is optional (`null`/absent means "auto root") but, when present,
 * is checked too: `bassPatterns.ts` reads it through Music Core's
 * `pitchClassOfNote(chord.bassNote ?? chord.root)`, octave stripped and
 * re-placed at the bass octave, so only the pitch class it resolves to ever
 * matters at playback time. That pitch class is checked against the same
 * `ROOT_SET` membership `root` uses — a malformed note (e.g. a double-sharp
 * `'C##4'`) resolves to a pitch class (`'C##'`) that is not a member and is
 * rejected here rather than reaching `midiAtOctave` unchecked.
 */
function isChordItem(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.root === 'string' &&
    isRootNote(value.root) &&
    typeof value.quality === 'string' &&
    getChordQualityEntry(value.quality)?.token === value.quality &&
    typeof value.bars === 'number' &&
    Number.isFinite(value.bars) &&
    value.bars > 0 &&
    (value.bassNote === undefined ||
      value.bassNote === null ||
      (typeof value.bassNote === 'string' && isRootNote(pitchClassOfNote(value.bassNote))))
  );
}

/**
 * The user's saved chord-progression library, read back out of `localStorage`
 * OR validated inline before an imported JSON file's entries ever reach
 * `saveCustomChordProgression` (see `ChordPresetLibrary.tsx`'s `handleImport`,
 * which calls this same function on the parsed file before saving anything —
 * the persisted-state read alone only protects a later reload, not the
 * same-session apply this import feeds into).
 *
 * DROPS rather than repairs, the same policy `sanitizeCustomSynthPresets`
 * documents above: a progression is a named library entry, and a chord
 * `resolveChordNotes` can no longer render (an unregistered quality, a root
 * Tonal can't resolve, a wrong-case quality) is not a progression to hand
 * back under the user's own name with the sound silently swapped for
 * something else. Every chord in an entry is checked with the same
 * `isChordItem` guard `sanitizeLoops` uses for a loop's own chords, so the
 * two paths a bad chord could reach `resolveChordNotes` through — a loop
 * body and this library — reject it the same way.
 */
export function sanitizeCustomChordProgressions(value: unknown): CustomChordProgressionItem[] {
  if (!Array.isArray(value)) return [];
  const kept: CustomChordProgressionItem[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    if (typeof raw.id !== 'string' || raw.id === '') continue;
    if (typeof raw.name !== 'string' || raw.name === '') continue;
    if (!Array.isArray(raw.chords) || raw.chords.length === 0 || !raw.chords.every(isChordItem)) continue;
    kept.push({
      id: raw.id,
      name: raw.name,
      category: typeof raw.category === 'string' ? raw.category : 'User',
      description: typeof raw.description === 'string' ? raw.description : '',
      roman: typeof raw.roman === 'string' ? raw.roman : '',
      chords: raw.chords as ChordItem[],
      createdAt:
        typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
          ? raw.createdAt
          : Date.now(),
    });
  }
  return kept;
}

// Exhaustive by construction: a new BassStepChoice member fails to compile
// here until it is listed, so the guard cannot drift from the union.
const BASS_STEP_CHOICES: Record<BassStepChoice, true> = {
  rest: true, root: true, third: true, fifth: true, seventh: true, octave: true,
};

// Shared with the flat `customBassPattern` sanitizer for the same reason as isChordItem.
function isBassStepChoice(value: unknown): boolean {
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
 * The three Beat fields, read through the ONE reader that accepts both the
 * current shape and a body written under the kit-name-only drum model
 * (sanitizeBeat.ts). They are read TOGETHER because an old body's pattern and
 * its mix both come out of one array; reading them independently would parse
 * that array twice.
 *
 * `raw` is the RAW row, never sanitizeLoops' `{ ...fallback, ...rawLoop }`:
 * that object always carries the three Beat keys off the default loop, and
 * `readBeatState` picks its read shape by whether they are PRESENT — so
 * handing it the merged row makes every legacy body look current and silently
 * drops the kit and the grid the user saved. Same reason `tempName` is read
 * off the raw row.
 */
function readLoopBeatState(
  raw: Record<string, unknown>,
  fallback: Loop,
  knownPresetIds?: ReadonlySet<string>,
): BeatState {
  return readBeatState(
    raw,
    {
      beatParams: fallback.beatParams,
      beatPattern: fallback.beatPattern,
      beatMix: fallback.beatMix,
    },
    knownPresetIds,
  );
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
 *
 * The Beat half of a loop is read by `readLoopBeatState` and nowhere else
 * here. That one call is where a body written under the kit-name-only drum
 * model is converted, and `sanitizeBeat.ts` behind it is the only file in the
 * app that still spells those old field names — `beatLegacyBoundary.test.ts`
 * is what keeps that true.
 *
 * `knownBeatPresetIds` is the set a loop's `beatParams.basePresetId` is
 * checked against, and it is OMITTED on the `.solna` import path (factory ids
 * only) and supplied on the local-slot read (factory plus the user's library).
 * See `readBeatState` for why the two paths differ.
 */
export function sanitizeLoops(value: unknown, meterId: MeterId = DEFAULT_METER_ID, knownBeatPresetIds?: ReadonlySet<string>): Loop[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const stepsPerBar = getMeter(meterId).stepsPerBar;
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
    loops.push(sanitizeCustomPatternSpans({
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
      synthParams: sanitizeTrackSynth(r.synthParams, 'synth'),
      chordSynthParams: sanitizeTrackSynth(r.chordSynthParams, 'chord'),
      bassSynthParams: sanitizeTrackSynth(r.bassSynthParams, 'bass'),
      synthArpSettings: sanitizeTrackArp(r.synthArpSettings, 'synth'),
      chordArpSettings: sanitizeTrackArp(r.chordArpSettings, 'chord'),
      bassArpSettings: sanitizeTrackArp(r.bassArpSettings, 'bass'),
      chords: asCheckedArray<ChordItem>(r.chords, isChordItem, fallback.chords),
      chordRhythmId: asChordRhythmId(r.chordRhythmId, fallback.chordRhythmId),
      chordRhythmMode: asPatternMode(r.chordRhythmMode, fallback.chordRhythmMode),
      customChordRhythm: asCheckedArray<boolean>(r.customChordRhythm, (v) => typeof v === 'boolean', fallback.customChordRhythm),
      customChordLoopLength: asPositiveInteger(r.customChordLoopLength, fallback.customChordLoopLength),
      customChordHoldSteps: asCheckedArray<number>(r.customChordHoldSteps, isPositiveInteger, fallback.customChordHoldSteps),
      chordFeel: clampFinite(r.chordFeel, 0, 1, fallback.chordFeel),
      chordOctave: clampFinite(r.chordOctave, 0, 8, fallback.chordOctave),
      bassPatternId: asBassPatternId(r.bassPatternId, fallback.bassPatternId),
      bassPatternMode: asPatternMode(r.bassPatternMode, fallback.bassPatternMode),
      customBassPattern: asCheckedArray<BassStepChoice>(r.customBassPattern, isBassStepChoice, fallback.customBassPattern),
      customBassLoopLength: asPositiveInteger(r.customBassLoopLength, fallback.customBassLoopLength),
      customBassHoldSteps: asCheckedArray<number>(r.customBassHoldSteps, isPositiveInteger, fallback.customBassHoldSteps),
      bassFeel: clampFinite(r.bassFeel, 0, 1, fallback.bassFeel),
      bassOctave: clampFinite(r.bassOctave, 0, 8, fallback.bassOctave),
      padSynthParams: sanitizeTrackSynth(r.padSynthParams, 'pad'),
      padArpSettings: sanitizeTrackArp(r.padArpSettings, 'pad'),
      fxSynthParams: sanitizeTrackSynth(r.fxSynthParams, 'fx'),
      fxArpSettings: sanitizeTrackArp(r.fxArpSettings, 'fx'),
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
      fxMelodySteps: asLeadNoteMatrix(r.fxMelodySteps) ?? fallback.fxMelodySteps,
      fxLoopLength: asPositiveInteger(r.fxLoopLength, fallback.fxLoopLength),
      fxStepResolution: asLeadStepResolution(r.fxStepResolution, fallback.fxStepResolution),
      fxMelodyView: r.fxMelodyView === 'chromatic' ? 'chromatic' : 'scale-locked',
      fxMelodyOctave: clampFinite(
        r.fxMelodyOctave, LEAD_OCTAVE_MIN, LEAD_OCTAVE_MAX, fallback.fxMelodyOctave,
      ),
      fxGate: clampFinite(r.fxGate, 0.05, 1, fallback.fxGate),
      // The RAW row, not `r` — see readLoopBeatState.
      ...readLoopBeatState(rawLoop, fallback, knownBeatPresetIds),
      synthVolume: asFaderDb(r.synthVolume, fallback.synthVolume),
      synthMuted: asBoolean(r.synthMuted),
      chordVolume: asFaderDb(r.chordVolume, fallback.chordVolume),
      chordMuted: asBoolean(r.chordMuted),
      bassVolume: asFaderDb(r.bassVolume, fallback.bassVolume),
      bassMuted: asBoolean(r.bassMuted),
      fxVolume: asFaderDb(r.fxVolume, fallback.fxVolume),
      fxMuted: asBoolean(r.fxMuted),
    }, stepsPerBar));
  }
  return loops.length > 0 ? loops : undefined;
}

/**
 * The two custom lanes as they should be READ, applied to every loop this
 * function returns.
 *
 * Three things happen and none of them is a version gate. A missing key has
 * already taken its default through the validation above, so a body written
 * before these fields existed arrives here at one bar of one-step holds; the
 * cycle is clamped to a divisor of the progression the loop actually carries;
 * and each lane's arrays are grown to `loopLength * MAX_STEPS_PER_BAR` slots —
 * never cut down, so a bar beyond the clamped cycle stays dormant and comes
 * back when the length is raised again (see `padPatternWidth`) — with every
 * hold re-clamped onto the boundaries that progression folds onto the cycle and
 * every onset a stretched hold covers deleted. A hold of 99 in a hand-edited
 * file therefore reads back as a legitimate one-cycle span rather than as a
 * span no renderer can draw.
 *
 * The caller supplies the active meter's bar length. A `.solna` project stores
 * `meterId` alongside its loops, so import can normalize only the columns that
 * meter exposes and leave the remaining fixed-width slots dormant. Callers
 * without an explicit meter use 4/4, the application's project default.
 */
function sanitizeCustomPatternSpans(loop: Loop, stepsPerBar: number): Loop {
  const { chords } = loop;

  const chordLength = clampLoopLength(loop.customChordLoopLength, progressionBars(chords));
  const chord = padPatternWidth(
    loop.customChordRhythm,
    loop.customChordHoldSteps,
    chordLength * MAX_STEPS_PER_BAR,
    false,
  );
  const chordSpans = normalizeCustomPattern({
    chords,
    values: chord.values,
    holds: chord.holds,
    loopLength: chordLength,
    stepsPerBar,
    empty: false,
  });

  const bassLength = clampLoopLength(loop.customBassLoopLength, progressionBars(chords));
  const bass = padPatternWidth(
    loop.customBassPattern,
    loop.customBassHoldSteps,
    bassLength * MAX_STEPS_PER_BAR,
    'rest',
  );
  const bassSpans = normalizeCustomPattern<BassStepChoice>({
    chords,
    values: bass.values,
    holds: bass.holds,
    loopLength: bassLength,
    stepsPerBar,
    empty: 'rest',
  });

  return {
    ...loop,
    customChordLoopLength: chordLength,
    customChordRhythm: chordSpans.values,
    customChordHoldSteps: chordSpans.holds,
    customBassLoopLength: bassLength,
    customBassPattern: bassSpans.values,
    customBassHoldSteps: bassSpans.holds,
  };
}

/**
 * A lane's arrays grown to `width` stored slots, and never cut down to it.
 *
 * `resizePatternBars` is the EXPLICIT selection path and trims, which is right
 * when the user asks for a shorter pattern. Reading a file back is not that
 * gesture: the design's rule is that a bar the clamped cycle cannot currently
 * reach stays DORMANT, so raising the length again brings its onsets back — and
 * that promise has to survive save -> load. `normalizePatternSpans` is already
 * dormant-safe (it walks only the columns the cycle exposes), so everything
 * past the clamped width arrives at it exactly as it was stored.
 *
 * The `MAX_CUSTOM_PATTERN_BARS` ceiling is the untrusted-input guard and the
 * only upper bound on this allocation: a crafted body can name a bar count no
 * project could hold, and `width` is derived from it. Within the ceiling a
 * longer stored lane is preserved whole; beyond it the read is defensive, which
 * is the same rule the bar count itself is capped by.
 */
function padPatternWidth<TValue>(
  values: readonly TValue[],
  holds: readonly number[],
  width: number,
  empty: TValue,
): { values: TValue[]; holds: number[] } {
  const cap = MAX_CUSTOM_PATTERN_BARS * MAX_STEPS_PER_BAR;
  const target = Math.min(width, cap);
  const retained = Math.min(values.length, cap);
  if (retained >= target) {
    return { values: values.slice(0, retained), holds: holds.slice(0, retained) };
  }
  return resizePatternBars(values, holds, target / MAX_STEPS_PER_BAR, empty);
}
