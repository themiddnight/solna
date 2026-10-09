/**
 * The resolved song as a `.solna` file carries it: the app writes it into
 * every file it saves, so a consumer reads the notes straight from the file
 * and needs no copy of the app's pattern tables.
 *
 * This file imports ONLY `./contract`, on purpose. A consumer copies the two
 * files verbatim and compiles them under its own, stricter config.
 *
 * The embedded song is `SolnaSong` minus `name` and `formatVersion` (the file
 * envelope already carries both), with two tables in place of repetition:
 *
 *   patches               every distinct synth patch once; a part holds an index
 *   { distinct, order }   every distinct pass of a part once; `order` holds one
 *                         index per repeat, so `order.length === repeatCount`
 *
 * and tuples in place of the three small records:
 *
 *   chord  [startBeat, durationBeats, symbol]
 *   note   [midi, startBeat, durationBeats, velocity]
 *   hit    [voice, startBeat, velocity]          voice indexes `drumVoices`
 *
 * `SHAPE` below is the format's one definition: the type is derived from it,
 * and `unpackSong` runs it. `packSong` assigns the contract's types into that
 * type and `unpackSong` assigns it back, so a patch leaf or an enum member
 * added to `contract.ts` and not to `SHAPE` (or the reverse) fails to compile.
 *
 * Trust: the app never reads the embedded song back. It rewrites it from the
 * project content on every save, so a consumer may take it as what the app
 * plays, once `unpackSong` has accepted it.
 */
import type { SolnaDrumHit, SolnaNote, SolnaSong, SolnaSongLoop, SolnaSynthPart } from './contract';
import { SOLNA_INTEROP_CONTRACT_VERSION } from './contract';

/** Top-level key in the `.solna` envelope, beside `content`. */
export const SOLNA_EMBEDDED_SONG_KEY = 'resolvedSong';

/** Bump when a reader of the current version could no longer read the embedded shape. */
export const SOLNA_EMBEDDED_SONG_VERSION = 1;

/**
 * Size caps, so a small file cannot unpack into a huge song. A song over a
 * cap is not an error: `unpackSong` answers `null` and the consumer falls
 * back to the full reader.
 *
 * - Repeats: the app clamps a loop's repeat count to 1..32 on every read.
 * - Loops and events: the app caps neither, so these are set from a real
 *   project with headroom. A 22-loop, 33-pass song measured 5,012 notes and
 *   hits, about 150 per pass. 1,024 loops is 46 times that song; 1,000,000
 *   events is 200 times it, several hours of music at that density.
 */
export const SOLNA_EMBEDDED_MAX_REPEAT_COUNT = 32;
export const SOLNA_EMBEDDED_MAX_LOOPS = 1024;
export const SOLNA_EMBEDDED_MAX_EVENTS = 1_000_000;

const MAX_ENV2_ROUTES = 2;

// --- Parsers: each takes hostile input and returns a fresh typed value or INVALID ---

const INVALID: unique symbol = Symbol('invalid');
type Parser<T> = (raw: unknown) => T | typeof INVALID;
type Parsed<P> = P extends Parser<infer T> ? T : never;

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);
const isArray = (raw: unknown): raw is unknown[] => Array.isArray(raw);

const numberIn =
  (min: number, max: number): Parser<number> =>
  (raw) =>
    typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max ? raw : INVALID;
const integerIn =
  (min: number, max: number): Parser<number> =>
  (raw) =>
    typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : INVALID;

const finite = numberIn(-Infinity, Infinity);
const nonNegative = numberIn(0, Infinity);
const positive = numberIn(Number.MIN_VALUE, Infinity);
const unit = numberIn(0, 1);
const index = integerIn(0, Number.MAX_SAFE_INTEGER);
const midiNote = integerIn(0, 127);
const flag: Parser<boolean> = (raw) => (typeof raw === 'boolean' ? raw : INVALID);
const text: Parser<string> = (raw) => (typeof raw === 'string' ? raw : INVALID);
/** A number that must be exactly `value`, typed as a plain number. */
const only = (value: number): Parser<number> => integerIn(value, value);

function oneOf<T extends string | number>(...members: T[]): Parser<T> {
  return (raw) => {
    for (const member of members) if (member === raw) return member;
    return INVALID;
  };
}

function nullable<T>(parser: Parser<T>): Parser<T | null> {
  return (raw) => (raw === null ? null : parser(raw));
}

function arrayOf<T>(item: Parser<T>, maxLength = Infinity): Parser<T[]> {
  return (raw) => {
    if (!isArray(raw) || raw.length > maxLength) return INVALID;
    const out: T[] = [];
    for (const element of raw) {
      const value = item(element);
      if (value === INVALID) return INVALID;
      out.push(value);
    }
    return out;
  };
}

function recordOf<T>(item: Parser<T>): Parser<Record<string, T>> {
  return (raw) => {
    if (!isRecord(raw)) return INVALID;
    const entries: Array<[string, T]> = [];
    for (const [key, element] of Object.entries(raw)) {
      const value = item(element);
      if (value === INVALID) return INVALID;
      entries.push([key, value]);
    }
    // `fromEntries` defines own properties, so a key named `__proto__` stays a key.
    return Object.fromEntries(entries);
  };
}

/** The first alternative that accepts the input: a union of shapes. */
function firstOf<T extends unknown[]>(...alternatives: { [K in keyof T]: Parser<T[K]> }): Parser<T[number]>;
function firstOf(...alternatives: Array<Parser<unknown>>): Parser<unknown> {
  return (raw) => {
    for (const alternative of alternatives) {
      const value = alternative(raw);
      if (value !== INVALID) return value;
    }
    return INVALID;
  };
}

/** An array of exactly these elements, in this order. */
function tuple<T extends unknown[]>(...items: { [K in keyof T]: Parser<T[K]> }): Parser<T>;
function tuple(...items: Array<Parser<unknown>>): Parser<unknown[]> {
  return (raw) => {
    if (!isArray(raw) || raw.length !== items.length) return INVALID;
    const out: unknown[] = [];
    for (const [position, item] of items.entries()) {
      const value = item(raw[position]);
      if (value === INVALID) return INVALID;
      out.push(value);
    }
    return out;
  };
}

/** An object with every one of these fields. A field the description does not name is not copied. */
function object<T>(fields: { [K in keyof T]: Parser<T[K]> }): Parser<T>;
function object(fields: Record<string, Parser<unknown>>): Parser<Record<string, unknown>> {
  const described = Object.entries(fields);
  return (raw) => {
    if (!isRecord(raw)) return INVALID;
    const entries: Array<[string, unknown]> = [];
    for (const [key, field] of described) {
      const value = field(raw[key]);
      if (value === INVALID) return INVALID;
      entries.push([key, value]);
    }
    return Object.fromEntries(entries);
  };
}

// --- The synth patch: `SolnaSynthPatch`, leaf for leaf ---

const oscillator = object({
  enabled: flag,
  waveform: oneOf('sawtooth', 'square', 'triangle', 'sine'),
  octave: finite,
  semitone: finite,
  fineCents: finite,
  levelDb: finite,
});

const adsr = object({ attack: finite, decay: finite, sustain: finite, release: finite });

const modRouteIn = <T extends string, U extends string>(targets: Parser<T>, routeUnit: U): Parser<{ target: T; unit: U; amount: number }> =>
  object({ target: targets, unit: oneOf(routeUnit), amount: finite });

const modRoute = firstOf(
  modRouteIn(oneOf('pitch-all', 'osc1-pitch', 'osc2-pitch', 'filter-cutoff'), 'semitones'),
  modRouteIn(oneOf('osc1-level', 'osc2-level', 'amplitude'), 'db'),
  modRouteIn(oneOf('filter-resonance'), 'normalized'),
  modRouteIn(oneOf('pan'), 'pan'),
);

const lfoRate = firstOf(
  object({ mode: oneOf('hz'), hz: finite }),
  object({
    mode: oneOf('sync'),
    division: object({ value: oneOf(1, 2, 4, 8, 16, 32), modifier: oneOf('straight', 'dotted', 'triplet') }),
  }),
);

const patch = object({
  common: object({
    voiceMode: oneOf('mono', 'poly'),
    glideSeconds: finite,
    unisonVoices: finite,
    unisonDetuneCents: finite,
    stereoWidth: finite,
    velocityToAmplitude: finite,
    outputGainDb: finite,
  }),
  synth: object({
    oscillators: tuple(oscillator, oscillator),
    utility: object({
      subEnabled: flag,
      subOctave: oneOf(-1, -2),
      subLevelDb: finite,
      noiseEnabled: flag,
      noiseColor: oneOf('white', 'pink', 'brown'),
      noiseLevelDb: finite,
    }),
    filter: object({
      type: oneOf('lowpass', 'bandpass', 'highpass', 'notch'),
      cutoffHz: finite,
      resonance: finite,
      driveDb: finite,
      keyTrack: finite,
    }),
    ampEnvelope: adsr,
    modEnvelope: adsr,
    env2Routes: arrayOf(modRoute, MAX_ENV2_ROUTES),
    lfo: object({
      waveform: oneOf('sine', 'triangle', 'sawtooth', 'square', 'sample-and-hold'),
      depth: finite,
      phaseDegrees: finite,
      triggerMode: oneOf('transport', 'note'),
      rate: lfoRate,
      route: nullable(modRoute),
    }),
  }),
});

// --- The embedded song ---

/** Every distinct pass of a part once, and which of them each repeat plays. */
interface Passes<T> {
  distinct: T[][];
  order: number[];
}

const passesOf = <T>(event: Parser<T>): Parser<Passes<T>> =>
  object({ distinct: arrayOf(arrayOf(event)), order: arrayOf(index) });

const note = tuple(midiNote, nonNegative, nonNegative, unit);
const hit = tuple(index, nonNegative, unit);
const chord = tuple(nonNegative, nonNegative, text);

const SHAPE = object({
  version: only(SOLNA_EMBEDDED_SONG_VERSION),
  contractVersion: only(SOLNA_INTEROP_CONTRACT_VERSION),
  bpm: positive,
  meter: object({ id: text, numerator: positive, denominator: positive, beatsPerBar: positive }),
  masterVolumeDb: finite,
  synthTracks: arrayOf(object({ id: text, label: text })),
  drumVoices: arrayOf(object({ id: text, label: text, gmNote: midiNote })),
  patches: arrayOf(patch),
  loops: arrayOf(
    object({
      index,
      name: text,
      startBeat: nonNegative,
      passBeats: positive,
      repeatCount: integerIn(1, SOLNA_EMBEDDED_MAX_REPEAT_COUNT),
      key: object({ root: text, scaleName: text }),
      chords: arrayOf(chord),
      synths: recordOf(object({ muted: flag, volumeDb: finite, patch: index, notes: passesOf(note) })),
      beat: object({ muted: flag, volumeDb: finite, hits: passesOf(hit) }),
    }),
    SOLNA_EMBEDDED_MAX_LOOPS,
  ),
});

export type SolnaEmbeddedSong = Parsed<typeof SHAPE>;
type EmbeddedLoop = SolnaEmbeddedSong['loops'][number];

// --- Pack ---

/** Stores each distinct value once (by its JSON text) and answers its row. */
function createTable<T>(): { rows: T[]; rowOf: (value: T) => number } {
  const rows: T[] = [];
  const known = new Map<string, number>();
  return {
    rows,
    rowOf: (value) => {
      const key = JSON.stringify(value);
      const existing = known.get(key);
      if (existing !== undefined) return existing;
      known.set(key, rows.length);
      rows.push(value);
      return rows.length - 1;
    },
  };
}

function packPasses<E, T>(passes: E[][], toTuple: (event: E) => T): Passes<T> {
  const table = createTable<T[]>();
  const order = passes.map((pass) => table.rowOf(pass.map(toTuple)));
  return { distinct: table.rows, order };
}

/** Pure. Throws only on a song that breaks its own contract (a hit naming a voice `drumVoices` lacks). */
export function packSong(song: SolnaSong): SolnaEmbeddedSong {
  const patches = createTable<SolnaEmbeddedSong['patches'][number]>();
  const voiceRows = new Map(song.drumVoices.map((voice, row) => [voice.id, row]));
  const voiceRow = (voiceId: string): number => {
    const row = voiceRows.get(voiceId);
    if (row === undefined) throw new Error(`Drum hit names a voice the song does not list: ${voiceId}`);
    return row;
  };

  return {
    version: SOLNA_EMBEDDED_SONG_VERSION,
    contractVersion: song.contractVersion,
    bpm: song.bpm,
    meter: song.meter,
    masterVolumeDb: song.masterVolumeDb,
    synthTracks: song.synthTracks,
    drumVoices: song.drumVoices,
    loops: song.loops.map(
      (loop): EmbeddedLoop => ({
        index: loop.index,
        name: loop.name,
        startBeat: loop.startBeat,
        passBeats: loop.passBeats,
        repeatCount: loop.repeatCount,
        key: loop.key,
        chords: loop.chords.map((entry) => [entry.startBeat, entry.durationBeats, entry.symbol]),
        synths: Object.fromEntries(
          Object.entries(loop.synths).map(([trackId, part]) => [
            trackId,
            {
              muted: part.muted,
              volumeDb: part.volumeDb,
              patch: patches.rowOf(part.patch),
              notes: packPasses(part.passes, (played) => [
                played.midi,
                played.startBeat,
                played.durationBeats,
                played.velocity,
              ]),
            },
          ]),
        ),
        beat: {
          muted: loop.beat.muted,
          volumeDb: loop.beat.volumeDb,
          hits: packPasses(loop.beat.passes, (played) => [voiceRow(played.voiceId), played.startBeat, played.velocity]),
        },
      }),
    ),
    // After `loops`: the table is complete only once every part has asked for its row.
    patches: patches.rows,
  };
}

// --- Unpack ---

/** Every element converted, or `null` as soon as one cannot be. */
function all<A, B>(items: readonly A[], convert: (item: A) => B | null): B[] | null {
  const out: B[] = [];
  for (const item of items) {
    const converted = convert(item);
    if (converted === null) return null;
    out.push(converted);
  }
  return out;
}

/** One entry per repeat. Repeats that play the same pass share one array. */
function unpackPasses<E, T>(
  passes: Passes<E>,
  repeatCount: number,
  toEvent: (packed: E) => T | null,
): T[][] | null {
  if (passes.order.length !== repeatCount) return null;
  const distinct = all(passes.distinct, (pass) => all(pass, toEvent));
  if (distinct === null) return null;
  return all(passes.order, (row) => distinct[row] ?? null);
}

function unpackLoop(loop: EmbeddedLoop, song: SolnaEmbeddedSong): SolnaSongLoop | null {
  const synths = all(song.synthTracks, ({ id }): [string, SolnaSynthPart] | null => {
    const part = Object.prototype.hasOwnProperty.call(loop.synths, id) ? loop.synths[id] : undefined;
    const partPatch = part === undefined ? undefined : song.patches[part.patch];
    if (part === undefined || partPatch === undefined) return null;
    const passes = unpackPasses(
      part.notes,
      loop.repeatCount,
      ([midi, startBeat, durationBeats, velocity]): SolnaNote => ({ midi, startBeat, durationBeats, velocity }),
    );
    return passes === null ? null : [id, { muted: part.muted, volumeDb: part.volumeDb, patch: partPatch, passes }];
  });
  const hits = unpackPasses(loop.beat.hits, loop.repeatCount, ([voice, startBeat, velocity]): SolnaDrumHit | null => {
    const voiceId = song.drumVoices[voice]?.id;
    return voiceId === undefined ? null : { voiceId, startBeat, velocity };
  });
  // Same count plus every track found means the keys are exactly the track ids.
  if (synths === null || hits === null || Object.keys(loop.synths).length !== song.synthTracks.length) return null;

  return {
    index: loop.index,
    name: loop.name,
    startBeat: loop.startBeat,
    passBeats: loop.passBeats,
    repeatCount: loop.repeatCount,
    key: loop.key,
    chords: loop.chords.map(([startBeat, durationBeats, symbol]) => ({ startBeat, durationBeats, symbol })),
    synths: Object.fromEntries(synths),
    beat: { muted: loop.beat.muted, volumeDb: loop.beat.volumeDb, passes: hits },
  };
}

function eventCount(loops: readonly SolnaSongLoop[]): number {
  let count = 0;
  for (const loop of loops) {
    for (const pass of loop.beat.passes) count += pass.length;
    for (const part of Object.values(loop.synths)) for (const pass of part.passes) count += pass.length;
  }
  return count;
}

/**
 * The song an embedded part describes, or `null` when it is absent or is
 * anything this reader does not fully understand: another `version`, another
 * `contractVersion`, a wrong type, a number out of range, an index into
 * nothing, a song over the size caps. `null` means "no usable embedded song,
 * use the full reader" and is never an error. There is no partial result.
 *
 * `raw` is treated as hostile; `envelope` is the caller's own. The result is
 * READ-ONLY: repeats of one pass share an array, and parts with one patch
 * share the patch object.
 */
export function unpackSong(raw: unknown, envelope: { name: string; formatVersion: number }): SolnaSong | null {
  const song = SHAPE(raw);
  if (song === INVALID) return null;
  if (new Set(song.synthTracks.map((track) => track.id)).size !== song.synthTracks.length) return null;
  const loops = all(song.loops, (loop) => unpackLoop(loop, song));
  // Counted after unpacking, which is safe: shared passes mean nothing was multiplied yet.
  if (loops === null || eventCount(loops) > SOLNA_EMBEDDED_MAX_EVENTS) return null;

  return {
    contractVersion: song.contractVersion,
    formatVersion: envelope.formatVersion,
    name: envelope.name,
    bpm: song.bpm,
    meter: song.meter,
    masterVolumeDb: song.masterVolumeDb,
    synthTracks: song.synthTracks,
    drumVoices: song.drumVoices,
    loops,
  };
}

// --- The file envelope ---

/**
 * `fileText` with the song added as the last top-level member, minified on
 * one line; every other character of the file is left as it was. Text that is
 * not a JSON object's is returned unchanged.
 */
export function embedSong(fileText: string, song: SolnaSong): string {
  const body = fileText.trimEnd();
  const head = body.slice(0, -1).trimEnd();
  if (!body.endsWith('}') || !head.startsWith('{')) return fileText;
  const separator = head.length === 1 ? '' : ',';
  const member = `${JSON.stringify(SOLNA_EMBEDDED_SONG_KEY)}: ${JSON.stringify(packSong(song))}`;
  return `${head}${separator}\n  ${member}\n}${fileText.slice(body.length)}`;
}

/** The embedded song of a `.solna` file's text, or `null` (see `unpackSong`). Never throws. */
export function readEmbeddedSong(fileText: string): SolnaSong | null {
  let envelope: unknown;
  try {
    envelope = JSON.parse(fileText);
  } catch {
    return null;
  }
  if (!isRecord(envelope)) return null;
  const { name, formatVersion } = envelope;
  if (typeof name !== 'string' || typeof formatVersion !== 'number' || !Number.isInteger(formatVersion)) return null;
  return unpackSong(envelope[SOLNA_EMBEDDED_SONG_KEY], { name, formatVersion });
}
