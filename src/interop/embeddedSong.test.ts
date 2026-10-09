import { describe, expect, test } from 'bun:test';
import type { SolnaSong, SolnaSynthPatch } from './contract';
import { SOLNA_INTEROP_CONTRACT_VERSION } from './contract';
import { embedSong } from './embeddedSong';
import { interopFixtureBody } from './fixtures/interopFixture';
import {
  SOLNA_EMBEDDED_MAX_EVENTS,
  SOLNA_EMBEDDED_MAX_LOOPS,
  SOLNA_EMBEDDED_MAX_REPEAT_COUNT,
  SOLNA_EMBEDDED_SONG_KEY,
  SOLNA_EMBEDDED_SONG_VERSION,
  packSong,
  readEmbeddedSong,
  unpackSong,
  type SolnaEmbeddedSong,
} from './index';
import { SOLNA_REFERENCE_PATCH } from './referencePatch';
import { resolveSong } from './resolveSong';

/* eslint-disable @typescript-eslint/no-explicit-any -- tampering reaches into a packed song the way a hostile file would */
type Loose = any;

const fixtureSong = (): SolnaSong => {
  const body = interopFixtureBody();
  return resolveSong(body, body.formatVersion, []);
};

/** The fixture with the reference patch on every lead part: every leaf, both ENV2 routes and the LFO route. */
const referenceSong = (): SolnaSong => {
  const song = fixtureSong();
  const reference: SolnaSynthPatch = SOLNA_REFERENCE_PATCH;
  for (const loop of song.loops) loop.synths.lead.patch = structuredClone(reference);
  return song;
};

const envelopeOf = (song: SolnaSong): { name: string; formatVersion: number } => ({
  name: song.name,
  formatVersion: song.formatVersion,
});

/** Through JSON text, the way a consumer meets it. */
const onDisk = (song: SolnaSong): Loose => JSON.parse(JSON.stringify(packSong(song)));

describe('packSong / unpackSong', () => {
  test.each([
    ['the interop fixture', fixtureSong],
    ['a song around the reference patch', referenceSong],
  ])('round-trips %s', (_label, build) => {
    const song = build();
    expect(unpackSong(onDisk(song), envelopeOf(song))).toEqual(song);
  });

  test('takes name and formatVersion from the envelope, not from the embedded part', () => {
    const song = fixtureSong();
    const packed = onDisk(song);
    expect(packed.name).toBeUndefined();
    expect(packed.formatVersion).toBeUndefined();
    const renamed = unpackSong(packed, { name: 'Renamed', formatVersion: 3 });
    expect([renamed?.name, renamed?.formatVersion]).toEqual(['Renamed', 3]);
  });

  test('stores each distinct patch and each distinct pass once', () => {
    const song = referenceSong();
    const packed: SolnaEmbeddedSong = packSong(song);
    const distinctPatches = new Set(
      song.loops.flatMap((loop) => Object.values(loop.synths).map((part) => JSON.stringify(part.patch))),
    );
    expect(packed.patches).toHaveLength(distinctPatches.size);
    expect(distinctPatches.size).toBeLessThan(song.loops.length * song.synthTracks.length);

    const verse = packed.loops[0];
    expect(verse?.repeatCount).toBe(2);
    expect(verse?.beat.hits.distinct).toHaveLength(1);
    expect(verse?.beat.hits.order).toEqual([0, 0]);
    expect(verse?.synths.lead?.notes.order).toEqual([0, 0]);
  });
});

type Tamper = (packed: Loose) => unknown;

const leadNote = (packed: Loose): Loose => packed.loops[0].synths.lead.notes.distinct[0][0];
const firstPatch = (packed: Loose): Loose => packed.patches[0];

const REJECTED: Array<[string, Tamper]> = [
  ['not an object', () => 'resolvedSong'],
  ['an array', () => []],
  ['null', () => null],
  ['an unknown embedded version', (p) => void (p.version = SOLNA_EMBEDDED_SONG_VERSION + 1)],
  ['a contract version this reader was not built for', (p) => void (p.contractVersion = SOLNA_INTEROP_CONTRACT_VERSION + 1)],
  ['a wrong-typed number', (p) => void (p.bpm = '120')],
  ['a wrong-typed boolean', (p) => void (p.loops[0].beat.muted = 0)],
  ['a wrong-typed string', (p) => void (p.loops[0].name = 7)],
  ['a missing field', (p) => void delete p.masterVolumeDb],
  ['a non-finite number', (p) => void (p.loops[0].beat.volumeDb = Number.POSITIVE_INFINITY)],
  ['NaN', (p) => void (p.bpm = Number.NaN)],
  ['a patch index past the table', (p) => void (p.loops[0].synths.lead.patch = p.patches.length)],
  ['a negative patch index', (p) => void (p.loops[0].synths.lead.patch = -1)],
  ['a pass index past the distinct passes', (p) => void (p.loops[0].synths.lead.notes.order[1] = 9)],
  ['a drum voice index past the voice table', (p) => void (p.loops[0].beat.hits.distinct[0][0][0] = p.drumVoices.length)],
  ['fewer passes than repeats', (p) => void p.loops[0].synths.lead.notes.order.pop()],
  ['more passes than repeats', (p) => void p.loops[0].beat.hits.order.push(0)],
  ['a synth part missing for a track', (p) => void delete p.loops[0].synths.pad],
  ['a synth part for no track', (p) => void (p.loops[0].synths.extra = p.loops[0].synths.pad)],
  ['a repeated track id', (p) => void (p.synthTracks[1].id = p.synthTracks[0].id)],
  ['a fractional midi note', (p) => void (leadNote(p)[0] = 60.5)],
  ['a midi note above 127', (p) => void (leadNote(p)[0] = 128)],
  ['a midi note below 0', (p) => void (leadNote(p)[0] = -1)],
  ['a velocity above 1', (p) => void (leadNote(p)[3] = 1.5)],
  ['a velocity below 0', (p) => void (leadNote(p)[3] = -0.1)],
  ['a negative note start', (p) => void (leadNote(p)[1] = -1)],
  ['a negative note duration', (p) => void (leadNote(p)[2] = -1)],
  ['a note tuple of the wrong length', (p) => void leadNote(p).push(0)],
  ['a negative loop start', (p) => void (p.loops[0].startBeat = -4)],
  ['a negative chord start', (p) => void (p.loops[0].chords[0][0] = -1)],
  ['a zero-length pass', (p) => void (p.loops[0].passBeats = 0)],
  ['a repeat count above the cap', (p) => {
    const count = SOLNA_EMBEDDED_MAX_REPEAT_COUNT + 1;
    const loop = p.loops[0];
    loop.repeatCount = count;
    loop.beat.hits.order = new Array(count).fill(0);
    for (const part of Object.values<Loose>(loop.synths)) part.notes.order = new Array(count).fill(0);
  }],
  ['a fractional repeat count', (p) => void (p.loops[1].repeatCount = 1.5)],
  ['more loops than the cap', (p) => void (p.loops = new Array(SOLNA_EMBEDDED_MAX_LOOPS + 1).fill(p.loops[1]))],
  ['a patch missing a leaf', (p) => void delete firstPatch(p).synth.filter.keyTrack],
  ['a patch missing a group', (p) => void delete firstPatch(p).synth.lfo],
  ['a patch leaf of the wrong type', (p) => void (firstPatch(p).common.glideSeconds = '0.05')],
  ['an unknown waveform', (p) => void (firstPatch(p).synth.oscillators[0].waveform = 'supersaw')],
  ['an unknown voice mode', (p) => void (firstPatch(p).common.voiceMode = 'legato')],
  ['an unknown sub octave', (p) => void (firstPatch(p).synth.utility.subOctave = -3)],
  ['three oscillators', (p) => void firstPatch(p).synth.oscillators.push(firstPatch(p).synth.oscillators[0])],
  ['one oscillator', (p) => void firstPatch(p).synth.oscillators.pop()],
  ['three ENV2 routes', (p) => void firstPatch(p).synth.env2Routes.push(firstPatch(p).synth.env2Routes[0])],
  ['a mod route whose unit is not its target\'s', (p) => void (firstPatch(p).synth.env2Routes[0].unit = 'db')],
  ['an unknown mod target', (p) => void (firstPatch(p).synth.lfo.route.target = 'reverb')],
  ['an LFO route that is neither a route nor null', (p) => void (firstPatch(p).synth.lfo.route = false)],
  ['an unknown LFO rate mode', (p) => void (firstPatch(p).synth.lfo.rate = { mode: 'free', hz: 2 })],
  ['an unknown note division', (p) => void (firstPatch(p).synth.lfo.rate.division.value = 3)],
  ['a patch that is an array', (p) => void (p.patches[0] = [])],
];

describe('unpackSong on a tampered embedded song', () => {
  test('the untampered song is accepted, so each row below is rejected for its own reason', () => {
    const song = referenceSong();
    expect(unpackSong(onDisk(song), envelopeOf(song))).not.toBeNull();
    expect(firstPatch(onDisk(song)).synth.env2Routes).toHaveLength(2);
    expect(firstPatch(onDisk(song)).synth.lfo.route).not.toBeNull();
    expect(firstPatch(onDisk(song)).synth.lfo.rate.mode).toBe('sync');
  });

  test.each(REJECTED)('rejects %s', (_label, tamper) => {
    const song = referenceSong();
    const packed = onDisk(song);
    const replaced = tamper(packed);
    expect(unpackSong(replaced === undefined ? packed : replaced, envelopeOf(song))).toBeNull();
  });

  /** One pass of `hitsPerPass` hits, repeated to the cap in every loop: few bytes, many events. */
  const repeated = (hitsPerPass: number, loopCount: number): Loose => {
    const packed = onDisk(fixtureSong());
    const loop = packed.loops[1];
    loop.repeatCount = SOLNA_EMBEDDED_MAX_REPEAT_COUNT;
    for (const part of Object.values<Loose>(loop.synths)) {
      part.notes = { distinct: [[]], order: new Array(SOLNA_EMBEDDED_MAX_REPEAT_COUNT).fill(0) };
    }
    loop.beat.hits = {
      distinct: [new Array(hitsPerPass).fill([0, 0, 1])],
      order: new Array(SOLNA_EMBEDDED_MAX_REPEAT_COUNT).fill(0),
    };
    packed.loops = new Array(loopCount).fill(loop);
    return packed;
  };
  const eventsPerLoop = 1000 * SOLNA_EMBEDDED_MAX_REPEAT_COUNT;
  const loopsAtCap = Math.floor(SOLNA_EMBEDDED_MAX_EVENTS / eventsPerLoop);

  test('accepts a song at the event cap', () => {
    const song = unpackSong(repeated(1000, loopsAtCap), { name: 'x', formatVersion: 1 });
    expect(song?.loops).toHaveLength(loopsAtCap);
    expect(song?.loops[0]?.beat.passes).toHaveLength(SOLNA_EMBEDDED_MAX_REPEAT_COUNT);
  });

  test('rejects an expansion bomb: repeats that multiply past the event cap', () => {
    expect(unpackSong(repeated(1000, loopsAtCap + 1), { name: 'x', formatVersion: 1 })).toBeNull();
  });
});

describe('embedSong / readEmbeddedSong', () => {
  const awkward = 'a } "quoted" $& $1 $` \\ {';

  test('adds the embedded song as the last member, on one line, and leaves the rest of the text alone', () => {
    const body = interopFixtureBody();
    const pretty = JSON.stringify(body, null, 2);
    const song = resolveSong(body, body.formatVersion, []);
    const text = embedSong(pretty, song);
    const lines = text.split('\n');
    expect(text.startsWith(pretty.slice(0, pretty.lastIndexOf('}')).trimEnd())).toBe(true);
    expect(lines.at(-1)).toBe('}');
    expect(lines.at(-2)).toBe(`  "${SOLNA_EMBEDDED_SONG_KEY}": ${JSON.stringify(packSong(song))}`);
    expect(Object.keys(JSON.parse(text)).at(-1)).toBe(SOLNA_EMBEDDED_SONG_KEY);
    const withoutSong = JSON.parse(text);
    delete withoutSong[SOLNA_EMBEDDED_SONG_KEY];
    expect(withoutSong).toEqual(JSON.parse(pretty));
  });

  test('reads back the song it embedded', () => {
    const body = interopFixtureBody();
    const song = resolveSong(body, body.formatVersion, []);
    expect(readEmbeddedSong(embedSong(JSON.stringify(body, null, 2), song))).toEqual(song);
  });

  test('survives names containing }, quotes and $', () => {
    const body = interopFixtureBody();
    body.name = awkward;
    body.content.loops[0].name = awkward;
    const song = resolveSong(body, body.formatVersion, []);
    const text = embedSong(JSON.stringify(body, null, 2), song);
    expect(JSON.parse(text).name).toBe(awkward);
    expect(JSON.parse(text).content.loops[0].name).toBe(awkward);
    expect(readEmbeddedSong(text)).toEqual(song);
    expect(readEmbeddedSong(text)?.loops[0]?.name).toBe(awkward);
  });

  test('embeds into an envelope with no members', () => {
    const song = fixtureSong();
    expect(JSON.parse(embedSong('{}', song))).toEqual({ [SOLNA_EMBEDDED_SONG_KEY]: packSong(song) });
  });

  test('returns text that is not a JSON object unchanged', () => {
    const song = fixtureSong();
    for (const text of ['', '[]', 'not json', '{"a":1} trailing']) expect(embedSong(text, song)).toBe(text);
  });

  test.each([
    ['text that is not JSON', 'not json'],
    ['a JSON array', '[]'],
    ['an envelope without the key', JSON.stringify(interopFixtureBody())],
    ['an envelope without a name', JSON.stringify({ formatVersion: 1, [SOLNA_EMBEDDED_SONG_KEY]: packSong(fixtureSong()) })],
    ['a fractional formatVersion', JSON.stringify({ name: 'x', formatVersion: 1.5, [SOLNA_EMBEDDED_SONG_KEY]: packSong(fixtureSong()) })],
    ['an embedded part that is not a song', JSON.stringify({ name: 'x', formatVersion: 1, [SOLNA_EMBEDDED_SONG_KEY]: { version: 1 } })],
  ])('reads %s as no embedded song, without throwing', (_label, text) => {
    expect(readEmbeddedSong(text)).toBeNull();
  });
});
