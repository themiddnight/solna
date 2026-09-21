/**
 * Beat validation and legacy conversion.
 *
 * This is the ONE place a legacy field name (`soundKit`, `drumFilterCutoff`,
 * `drumFilterResonance`, `drumFilterType`, `masterSequencerVolume`,
 * `drumMuted`, `sequencerTracks`) may appear in production source —
 * `sanitizeBeat.test.ts` and the guard test that enforces this allowlist are
 * the only other two. Every legacy read stays inside `readBeatState` and its
 * private helpers; nothing downstream (`sanitize.ts`, a store slice, a
 * component) ever sees one of those names again.
 *
 * Every sanitizer here follows the "validate, don't migrate" rule the rest of
 * `sanitize.ts` follows: out of range, wrong type or missing takes the
 * fallback; an in-range value passes through untouched. Each of the eight
 * differently-shaped voice families is spelled out field by field, never
 * walked as a mapped type, so one bad nested number can never take a valid
 * sibling down with it.
 */
import { BEAT_PRESETS, BEAT_VOICE_IDS, DEFAULT_BEAT_PRESET_ID } from '@/data/beatPresets';
import type {
  BeatBellParams,
  BeatClapParams,
  BeatCrashParams,
  BeatFilterParams,
  BeatHatParams,
  BeatKickParams,
  BeatMix,
  BeatParams,
  BeatPattern,
  BeatPatch,
  BeatPreset,
  BeatRideParams,
  BeatSnareParams,
  BeatTomParams,
  BeatVoiceId,
  BeatVoiceMix,
  BeatVoices,
  BeatFilterType,
} from '@/types';
import { padStepRow } from '@/utils/patternAdapt';
import { beatParamsFromPreset, beatPatchOf } from './beatPresets';
import { asFaderDb } from './levelUnits';
import { asBoolean, clampFinite, isPlainObject } from './sanitize';

/** What one full loop's Beat state reads back as. */
export interface BeatState {
  beatParams: BeatParams;
  beatPattern: BeatPattern;
  beatMix: BeatMix;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

/** Every factory preset id — what an app-persistence caller supplies plus its
 *  own already-sanitized user-preset ids, and what a project-file caller
 *  supplies on its own (see `sanitizeBeatParams`'s doc comment). */
const FACTORY_BEAT_PRESET_IDS: ReadonlySet<string> = new Set(BEAT_PRESETS.map((preset) => preset.id));

const BEAT_VOICE_ID_SET: ReadonlySet<string> = new Set(BEAT_VOICE_IDS);

/**
 * The thirteen `DRUM_KITS` display names that were ever written to a project,
 * paired with the preset id each became. FROZEN: this is a record of what is
 * already on disk, so an entry is only ever added, never edited.
 */
const LEGACY_KIT_NAMES: readonly (readonly [string, string])[] = [
  ['Retro Drive', 'retro-drive'],
  ['Club Standard', 'club-standard'],
  ['Trap Beat', 'trap-beat'],
  ['808 Vintage', '808-vintage'],
  ['Chrome Pulse', 'chrome-pulse'],
  ['Velocity Breaks', 'velocity-breaks'],
  ['Sub Weight', 'sub-weight'],
  ['Warehouse', 'warehouse'],
  ['Tight Pocket', 'tight-pocket'],
  ['Acoustic Studio', 'acoustic-studio'],
  ['Warm Riddim', 'warm-riddim'],
  ['Lo-Fi Vinyl', 'lo-fi-vinyl'],
  ['Dusty Break', 'dusty-break'],
];

/**
 * A legacy `DRUM_KITS` display name resolved to its stable preset id.
 *
 * SPELLED OUT, not derived from `BEAT_PRESETS[].name`. This table describes
 * names that were written to disk in the past and can therefore never change;
 * the `name` field describes the label on screen today, which is renameable by
 * definition — that is the whole reason ids replaced names as the key. Deriving
 * one from the other made a display rename silently drop every legacy loop
 * built on that kit back to `basePresetId: null` plus the caller's fallback
 * patch: a different kit, no error, and no failing test.
 */
const LEGACY_KIT_NAME_TO_PRESET_ID: ReadonlyMap<string, string> = new Map(
  LEGACY_KIT_NAMES.map(([name, id]) => [name, id]),
);

const HZ_MIN = 20;
const HZ_MAX = 20000;
const TIME_MIN = 0;
const TIME_MAX = 2;
const DECAY_MIN = 0;
const DECAY_MAX = 10;
const GAIN_MIN = 0;
const GAIN_MAX = 2;
const UNIT_MIN = 0;
const UNIT_MAX = 1;

function hz(value: unknown, fallback: number): number {
  return clampFinite(value, HZ_MIN, HZ_MAX, fallback);
}
function time(value: unknown, fallback: number): number {
  return clampFinite(value, TIME_MIN, TIME_MAX, fallback);
}
function decayTime(value: unknown, fallback: number): number {
  return clampFinite(value, DECAY_MIN, DECAY_MAX, fallback);
}
function gain(value: unknown, fallback: number): number {
  return clampFinite(value, GAIN_MIN, GAIN_MAX, fallback);
}
function unit(value: unknown, fallback: number): number {
  return clampFinite(value, UNIT_MIN, UNIT_MAX, fallback);
}

function sanitizeBeatFilter(value: unknown, fallback: BeatFilterParams): BeatFilterParams {
  const row = asRecord(value);
  const type: BeatFilterType =
    row.type === 'lowpass' || row.type === 'highpass' || row.type === 'bandpass'
      ? row.type
      : fallback.type;
  return {
    type,
    cutoff: clampFinite(row.cutoff, 50, 12000, fallback.cutoff),
    resonance: clampFinite(row.resonance, 0.1, 20, fallback.resonance),
  };
}

function sanitizeKickParams(value: unknown, fallback: BeatKickParams): BeatKickParams {
  const row = asRecord(value);
  return {
    freqStart: hz(row.freqStart, fallback.freqStart),
    freqEnd: hz(row.freqEnd, fallback.freqEnd),
    pitchTime: time(row.pitchTime, fallback.pitchTime),
    decay: decayTime(row.decay, fallback.decay),
    gain: gain(row.gain, fallback.gain),
    clickFreq: hz(row.clickFreq, fallback.clickFreq),
    clickLevel: unit(row.clickLevel, fallback.clickLevel),
    clickDecay: time(row.clickDecay, fallback.clickDecay),
    reverbSend: unit(row.reverbSend, fallback.reverbSend),
  };
}

/** Shared by `snare` and `rimshot` — the same two-partial body plus noise
 *  block, voiced apart per `BeatVoices`' own doc comment. */
function sanitizeSnareParams(value: unknown, fallback: BeatSnareParams): BeatSnareParams {
  const row = asRecord(value);
  return {
    bodyFreqStart: hz(row.bodyFreqStart, fallback.bodyFreqStart),
    bodyFreqEnd: hz(row.bodyFreqEnd, fallback.bodyFreqEnd),
    bodyTime: time(row.bodyTime, fallback.bodyTime),
    bodyDecay: decayTime(row.bodyDecay, fallback.bodyDecay),
    bodyGain: gain(row.bodyGain, fallback.bodyGain),
    bodyFreqStart2: hz(row.bodyFreqStart2, fallback.bodyFreqStart2),
    bodyFreqEnd2: hz(row.bodyFreqEnd2, fallback.bodyFreqEnd2),
    bodyGain2: gain(row.bodyGain2, fallback.bodyGain2),
    noiseFilter: hz(row.noiseFilter, fallback.noiseFilter),
    noiseDecay: decayTime(row.noiseDecay, fallback.noiseDecay),
    noiseGain: gain(row.noiseGain, fallback.noiseGain),
    reverbSend: unit(row.reverbSend, fallback.reverbSend),
  };
}

/** Shared by `hihat` and `openhat`. */
function sanitizeHatParams(value: unknown, fallback: BeatHatParams): BeatHatParams {
  const row = asRecord(value);
  return {
    filter: hz(row.filter, fallback.filter),
    topCut: hz(row.topCut, fallback.topCut),
    decay: decayTime(row.decay, fallback.decay),
    gain: gain(row.gain, fallback.gain),
    metal: unit(row.metal, fallback.metal),
  };
}

function sanitizeClapParams(value: unknown, fallback: BeatClapParams): BeatClapParams {
  const row = asRecord(value);
  return {
    filter: hz(row.filter, fallback.filter),
    decay: decayTime(row.decay, fallback.decay),
    gain: gain(row.gain, fallback.gain),
    reverbSend: unit(row.reverbSend, fallback.reverbSend),
  };
}

/** Shared by `hitom` and `lowtom`. */
function sanitizeTomParams(value: unknown, fallback: BeatTomParams): BeatTomParams {
  const row = asRecord(value);
  return {
    freqStart: hz(row.freqStart, fallback.freqStart),
    freqEnd: hz(row.freqEnd, fallback.freqEnd),
    pitchTime: time(row.pitchTime, fallback.pitchTime),
    decay: decayTime(row.decay, fallback.decay),
    gain: gain(row.gain, fallback.gain),
    reverbSend: unit(row.reverbSend, fallback.reverbSend),
  };
}

function sanitizeRideParams(value: unknown, fallback: BeatRideParams): BeatRideParams {
  const row = asRecord(value);
  return {
    tone: hz(row.tone, fallback.tone),
    ping: unit(row.ping, fallback.ping),
    pingFilter: hz(row.pingFilter, fallback.pingFilter),
    pingDecay: decayTime(row.pingDecay, fallback.pingDecay),
    washFilter: hz(row.washFilter, fallback.washFilter),
    washDecay: decayTime(row.washDecay, fallback.washDecay),
    bodyFilter: hz(row.bodyFilter, fallback.bodyFilter),
    metal: unit(row.metal, fallback.metal),
    gain: gain(row.gain, fallback.gain),
    reverbSend: unit(row.reverbSend, fallback.reverbSend),
  };
}

function sanitizeCrashParams(value: unknown, fallback: BeatCrashParams): BeatCrashParams {
  const row = asRecord(value);
  return {
    filter: hz(row.filter, fallback.filter),
    decay: decayTime(row.decay, fallback.decay),
    gain: gain(row.gain, fallback.gain),
    reverbSend: unit(row.reverbSend, fallback.reverbSend),
    metal: unit(row.metal, fallback.metal),
  };
}

function sanitizeBellParams(value: unknown, fallback: BeatBellParams): BeatBellParams {
  const row = asRecord(value);
  return {
    freq1: hz(row.freq1, fallback.freq1),
    freq2: hz(row.freq2, fallback.freq2),
    filter: hz(row.filter, fallback.filter),
    decay: decayTime(row.decay, fallback.decay),
    gain: gain(row.gain, fallback.gain),
    reverbSend: unit(row.reverbSend, fallback.reverbSend),
  };
}

/** Every voice enumerated by hand, deliberately: the eight parameter families
 *  are differently shaped, so a mapped-type loop would need a cast at every
 *  read, trading a compile error for a runtime hole. */
function sanitizeBeatVoices(value: unknown, fallback: BeatVoices): BeatVoices {
  const row = asRecord(value);
  return {
    kick: sanitizeKickParams(row.kick, fallback.kick),
    snare: sanitizeSnareParams(row.snare, fallback.snare),
    rimshot: sanitizeSnareParams(row.rimshot, fallback.rimshot),
    clap: sanitizeClapParams(row.clap, fallback.clap),
    hihat: sanitizeHatParams(row.hihat, fallback.hihat),
    openhat: sanitizeHatParams(row.openhat, fallback.openhat),
    hitom: sanitizeTomParams(row.hitom, fallback.hitom),
    lowtom: sanitizeTomParams(row.lowtom, fallback.lowtom),
    ride: sanitizeRideParams(row.ride, fallback.ride),
    crash: sanitizeCrashParams(row.crash, fallback.crash),
    bell: sanitizeBellParams(row.bell, fallback.bell),
  };
}

/**
 * `knownPresetIds` contains the factory ids plus, when reading app
 * persistence, that caller's own already-sanitized user-preset ids — a
 * project-file caller supplies factory ids only. Either way an id this set
 * does not contain resolves to `null`: the patch stays exactly as stored, the
 * provenance just becomes unresolvable.
 */
export function sanitizeBeatParams(
  value: unknown,
  fallback: BeatParams,
  knownPresetIds: ReadonlySet<string>,
): BeatParams {
  const row = asRecord(value);
  return {
    basePresetId:
      typeof row.basePresetId === 'string' && knownPresetIds.has(row.basePresetId)
        ? row.basePresetId
        : null,
    outputTrimDb: clampFinite(row.outputTrimDb, -24, 24, fallback.outputTrimDb),
    filter: sanitizeBeatFilter(row.filter, fallback.filter),
    voices: sanitizeBeatVoices(row.voices, fallback.voices),
  };
}

/** A whole row: a non-boolean element rejects the whole row rather than
 *  repairing it cell by cell — a stored row is one voice's entire bar, not
 *  eleven independent booleans.
 *
 *  WIDTH IS PADDED, NEVER REJECTED. A row narrower than the stored width is
 *  not corrupt, it is OLD: rows shipped 16 wide until the meter model raised
 *  `MAX_STEPS_PER_BAR`, so rejecting on length blanked the entire drum
 *  programming of every project written before that — silently, with the
 *  sound and the per-voice mix converting correctly around it. It is also the
 *  rule the other lanes already follow ("the read path pads a lane's width and
 *  never cuts it"), and the reason `padStepRow` exists. Padding adds SILENCE,
 *  so a short row gains no hit it did not state. */
function sanitizeBeatPatternRow(value: unknown, width: number): boolean[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((step) => typeof step === 'boolean')) return null;
  return padStepRow(value as boolean[], width);
}

/** Unknown voice keys in a stored `rows` object are dropped by construction —
 *  only `BEAT_VOICE_IDS` is ever read. A missing or invalid row is silent,
 *  never the fallback's row: a row is an event list, and a corrupt one has no
 *  safer reading than "nothing plays". */
export function sanitizeBeatPattern(value: unknown, fallback: BeatPattern): BeatPattern {
  const row = asRecord(value);
  const rowsInput = asRecord(row.rows);
  const rows = {} as Record<BeatVoiceId, boolean[]>;
  for (const voice of BEAT_VOICE_IDS) {
    const width = fallback.rows[voice].length;
    rows[voice] = sanitizeBeatPatternRow(rowsInput[voice], width) ?? new Array<boolean>(width).fill(false);
  }
  return { rows };
}

/** A missing or invalid per-voice mix entry reads as unity/unmuted — the same
 *  defaults `asFaderDb`/`asBoolean` fall back to with no fallback argument —
 *  never the caller's `fallback`, so a voice a stored mix never named (an
 *  older save, a newly added voice) starts audible rather than silent. */
export function sanitizeBeatMix(value: unknown, fallback: BeatMix): BeatMix {
  const row = asRecord(value);
  const voicesInput = asRecord(row.voices);
  const voices = {} as Record<BeatVoiceId, BeatVoiceMix>;
  for (const voice of BEAT_VOICE_IDS) {
    const entry = asRecord(voicesInput[voice]);
    voices[voice] = { levelDb: asFaderDb(entry.levelDb), muted: asBoolean(entry.muted) };
  }
  return {
    levelDb: asFaderDb(row.levelDb, fallback.levelDb),
    muted: asBoolean(row.muted),
    voices,
  };
}

/**
 * Does this row carry the LEGACY Beat shape?
 *
 * The question is asked of the old keys, not the new ones. Requiring all three
 * of `beatParams`/`beatPattern`/`beatMix` to be present made the read
 * all-or-nothing: a body carrying two of them — a hand-edited `.solna`, a
 * minimizing serializer that drops a default-valued key, a foreign writer
 * against the `PROJECT_FORMAT_VERSION` interop marker — fell into the legacy
 * branch, found none of the legacy keys either, and threw away the two current
 * fields it DID carry. Every other sanitizer in this codebase validates a body
 * key by key; so does the new-shape branch, one field at a time, each with its
 * own fallback. Dispatching on the legacy keys is what lets it.
 */
function hasLegacyBeatShape(row: Record<string, unknown>): boolean {
  return (
    'soundKit' in row ||
    'sequencerTracks' in row ||
    'drumFilterType' in row ||
    'drumFilterCutoff' in row ||
    'drumFilterResonance' in row ||
    'masterSequencerVolume' in row ||
    'drumMuted' in row
  );
}

/**
 * `soundKit` (a `DRUM_KITS` display name) resolved to a stable preset id, with
 * that preset's full patch as the base — legacy per-voice params lived on the
 * kit, not the loop, so they carry over whole. Only the loop-level filter
 * fields (`drumFilterCutoff`/`drumFilterResonance`/`drumFilterType`) were ever
 * per-loop, so only they are read back as overrides. An unresolvable kit name
 * (or a non-string `soundKit`) keeps `fallback`'s own patch instead of
 * guessing a preset, and reports its provenance honestly as `null`.
 */
function convertLegacyBeatParams(row: Record<string, unknown>, fallback: BeatParams): BeatParams {
  const soundKit = row.soundKit;
  const presetId = typeof soundKit === 'string' ? LEGACY_KIT_NAME_TO_PRESET_ID.get(soundKit) : undefined;
  const base = presetId ? beatParamsFromPreset(presetId) : fallback;
  return {
    basePresetId: presetId ?? null,
    outputTrimDb: base.outputTrimDb,
    filter: sanitizeBeatFilter(
      { type: row.drumFilterType, cutoff: row.drumFilterCutoff, resonance: row.drumFilterResonance },
      base.filter,
    ),
    // A fresh copy, never `base.voices` by reference. `beatParamsFromPreset`
    // already clones, but the unresolved-kit branch takes `fallback` — the
    // CALLER's live patch — and handing that object straight back would make
    // two loops share one voices map: an edit to either would reach both.
    voices: structuredClone(base.voices),
  };
}

/**
 * Legacy `sequencerTracks` split into its two Task-1 siblings: a row's
 * `steps` become that voice's `beatPattern` row, its `volume`/`muted` become
 * that voice's `beatMix` entry. A track naming a voice `BEAT_VOICE_IDS` does
 * not have is dropped silently — the same "unknown voices are dropped" rule
 * `sanitizeBeatPattern`/`sanitizeBeatMix` apply to the new shape.
 */
function convertLegacySequencerTracks(
  row: Record<string, unknown>,
  fallback: BeatState,
): { beatPattern: BeatPattern; beatMix: BeatMix } {
  const rows = {} as Record<BeatVoiceId, boolean[]>;
  const voices = {} as Record<BeatVoiceId, BeatVoiceMix>;
  for (const voice of BEAT_VOICE_IDS) {
    rows[voice] = new Array<boolean>(fallback.beatPattern.rows[voice].length).fill(false);
    voices[voice] = { levelDb: asFaderDb(undefined), muted: false };
  }

  const tracks = Array.isArray(row.sequencerTracks) ? row.sequencerTracks : [];
  for (const track of tracks) {
    if (!isPlainObject(track)) continue;
    const instrument = track.instrument;
    if (typeof instrument !== 'string' || !BEAT_VOICE_ID_SET.has(instrument)) continue;
    const voice = instrument as BeatVoiceId;
    const width = fallback.beatPattern.rows[voice].length;
    const steps = sanitizeBeatPatternRow(track.steps, width);
    if (steps) rows[voice] = steps;
    voices[voice] = { levelDb: asFaderDb(track.volume), muted: asBoolean(track.muted) };
  }

  return {
    beatPattern: { rows },
    beatMix: {
      levelDb: asFaderDb(row.masterSequencerVolume, fallback.beatMix.levelDb),
      muted: asBoolean(row.drumMuted),
      voices,
    },
  };
}

/**
 * The ids a stored `basePresetId` may resolve to on the LOCAL slot read: every
 * factory preset plus the user's own library. A `.solna` import deliberately
 * does NOT get this — see `readBeatState`.
 *
 * Takes the ALREADY SANITIZED library, because an id that failed validation is
 * not an id this app has: `sanitizePersistedState` runs
 * `sanitizeCustomBeatPresets` at hydration, long before any slot is read.
 */
export function beatPresetIdsWithLibrary(custom: readonly BeatPreset[]): ReadonlySet<string> {
  const ids = new Set<string>(FACTORY_BEAT_PRESET_IDS);
  for (const preset of custom) ids.add(preset.id);
  return ids;
}

/**
 * A preset has no base of its own, so nothing is ever resolvable here — see
 * `sanitizeCustomBeatPresets`, which drops the field the moment it is read.
 */
const NO_BEAT_PRESET_IDS: ReadonlySet<string> = new Set<string>();

/**
 * The user's saved Beat presets, read back out of `localStorage`.
 *
 * DROPS an entry rather than repairing it whole, exactly as
 * `sanitizeCustomSynthPresets` does and for the same reason: a library is a
 * list and a list can be one item shorter, while an entry sitting under the
 * user's own name sounding like the factory default reads as the app having
 * silently edited their work. So a missing id, a blank name or a body that is
 * not an object at all takes the whole entry out.
 *
 * WITHIN a surviving entry the rule inverts and validation is per FIELD, which
 * is the design's own failure rule ("invalid imported values fall back per
 * field rather than resetting a whole patch"): one unreadable number takes the
 * default preset's value for that number and its ten sibling voices survive.
 *
 * `basePresetId` is read and DISCARDED. A preset IS a source, so an entry
 * claiming a base would make every sound derived from it point at the factory
 * patch behind it; `origin` is stated as `'user'` for the same reason rather
 * than being read back from the payload.
 */
export function sanitizeCustomBeatPresets(value: unknown): BeatPreset[] {
  if (!Array.isArray(value)) return [];
  const fallback = beatParamsFromPreset(DEFAULT_BEAT_PRESET_ID);
  const kept: BeatPreset[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    if (typeof raw.id !== 'string' || raw.id === '') continue;
    if (typeof raw.name !== 'string' || raw.name === '') continue;
    if (!isPlainObject(raw.patch)) continue;
    const params = sanitizeBeatParams(raw.patch, fallback, NO_BEAT_PRESET_IDS);
    const patch: BeatPatch = beatPatchOf(params);
    kept.push({ id: raw.id, name: raw.name, origin: 'user', patch });
  }
  return kept;
}

/**
 * The one reader both untrusted-input paths call: app persistence and
 * project-file parsing alike, exactly as `sanitizeLoops` is for everything
 * else. New shape first — the three Beat keys present means a body already in
 * the current shape, validated field by field with no repair. Otherwise this
 * reads a legacy loop's `soundKit`/`drumFilter*`/`masterSequencerVolume`/
 * `drumMuted`/`sequencerTracks` and converts. `knownPresetIds` defaults to the
 * FACTORY set, which is what an imported `.solna` gets: a file written on
 * another machine may legitimately name a preset from a library this browser
 * does not have, and there is nothing to check it against. The LOCAL slot read passes `beatPresetIdsWithLibrary(...)`
 * instead — same machine, so the user's own library is right there and a base
 * pointing into it is resolvable rather than dangling.
 */
export function readBeatState(
  value: unknown,
  fallback: BeatState,
  knownPresetIds: ReadonlySet<string> = FACTORY_BEAT_PRESET_IDS,
): BeatState {
  const row = asRecord(value);
  if (!hasLegacyBeatShape(row)) {
    // Each of the three read independently: a missing key falls back on its
    // own and costs the other two nothing.
    return {
      beatParams: sanitizeBeatParams(row.beatParams, fallback.beatParams, knownPresetIds),
      beatPattern: sanitizeBeatPattern(row.beatPattern, fallback.beatPattern),
      beatMix: sanitizeBeatMix(row.beatMix, fallback.beatMix),
    };
  }
  const beatParams = convertLegacyBeatParams(row, fallback.beatParams);
  const { beatPattern, beatMix } = convertLegacySequencerTracks(row, fallback);
  return { beatParams, beatPattern, beatMix };
}
