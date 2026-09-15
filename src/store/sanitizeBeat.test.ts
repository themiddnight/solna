import { describe, expect, test } from 'bun:test';
import { BEAT_PRESETS } from '@/data/beatPresets';
import { MAX_STEPS_PER_BAR } from '@/utils/meter';
import { defaultBeatState } from './beatPresets';
import { createDefaultLoop } from './loopSlice';
import { parseProjectFile } from './projectFile';
import { factoryProjectContent, makeEnvelope } from './projectFormat';
import { readBeatState, sanitizeBeatMix, sanitizeBeatParams, sanitizeBeatPattern } from './sanitizeBeat';

const FACTORY_IDS = new Set(BEAT_PRESETS.map((preset) => preset.id));

describe('sanitizeBeatParams', () => {
  test('a complete valid patch passes through unchanged', () => {
    const valid = defaultBeatState().beatParams;
    expect(sanitizeBeatParams(valid, defaultBeatState().beatParams, FACTORY_IDS)).toEqual(valid);
  });

  test('one invalid nested frequency falls back without replacing valid sibling values', () => {
    const fallback = defaultBeatState().beatParams;
    const valid = structuredClone(fallback);
    valid.voices.kick.freqStart = Number.NaN;
    valid.voices.kick.freqEnd = 41.2;
    const out = sanitizeBeatParams(valid, fallback, FACTORY_IDS);
    expect(out.voices.kick.freqStart).toBe(fallback.voices.kick.freqStart);
    expect(out.voices.kick.freqEnd).toBe(41.2);
  });

  test('unknown voices are dropped', () => {
    const fallback = defaultBeatState().beatParams;
    const withUnknownVoice = {
      ...structuredClone(fallback),
      voices: { ...structuredClone(fallback.voices), tambourine: { gain: 1 } },
    };
    const out = sanitizeBeatParams(withUnknownVoice, fallback, FACTORY_IDS);
    expect(out.voices).not.toHaveProperty('tambourine');
    expect(Object.keys(out.voices).sort()).toEqual(Object.keys(fallback.voices).sort());
  });

  test('an unresolved base id becomes null without changing a valid complete patch', () => {
    const fallback = defaultBeatState().beatParams;
    const valid = structuredClone(fallback);
    valid.basePresetId = 'no-such-preset';
    const out = sanitizeBeatParams(valid, fallback, FACTORY_IDS);
    expect(out.basePresetId).toBeNull();
    expect(out.outputTrimDb).toBe(valid.outputTrimDb);
    expect(out.filter).toEqual(valid.filter);
    expect(out.voices).toEqual(valid.voices);
  });

  test('a known user-preset id supplied via knownPresetIds resolves', () => {
    const fallback = defaultBeatState().beatParams;
    const valid = structuredClone(fallback);
    valid.basePresetId = 'user-preset-1';
    const withUserIds = new Set([...FACTORY_IDS, 'user-preset-1']);
    expect(sanitizeBeatParams(valid, fallback, withUserIds).basePresetId).toBe('user-preset-1');
    expect(sanitizeBeatParams(valid, fallback, FACTORY_IDS).basePresetId).toBeNull();
  });
});

describe('sanitizeBeatPattern', () => {
  test('a complete valid pattern passes through unchanged', () => {
    const fallback = defaultBeatState().beatPattern;
    const valid = structuredClone(fallback);
    valid.rows.kick[0] = true;
    expect(sanitizeBeatPattern(valid, fallback)).toEqual(valid);
  });

  test('missing rows are silent', () => {
    const fallback = defaultBeatState().beatPattern;
    const partial = { rows: { kick: fallback.rows.kick.map((_, i) => i === 0) } };
    const out = sanitizeBeatPattern(partial, fallback);
    expect(out.rows.snare.every((step) => step === false)).toBe(true);
    expect(out.rows.snare).toHaveLength(MAX_STEPS_PER_BAR);
  });

  test('unknown voices are dropped', () => {
    const fallback = defaultBeatState().beatPattern;
    const withUnknown = { rows: { ...fallback.rows, tambourine: [true] } };
    const out = sanitizeBeatPattern(withUnknown, fallback);
    expect(out.rows).not.toHaveProperty('tambourine');
  });

  test('a narrower row is PADDED to the stored width, keeping its onsets', () => {
    const fallback = defaultBeatState().beatPattern;
    const width = fallback.rows.kick.length;
    // The pre-meter-model shape: a row written when rows shipped 16 wide.
    const narrow = [true, false, false, false, true, false, false, false];
    const short = { rows: { ...fallback.rows, kick: narrow } };
    const out = sanitizeBeatPattern(short, fallback);
    // Its own onsets survive at their own indices; the tail is SILENCE, never
    // an invented hit and never the fallback's row.
    expect(out.rows.kick.length).toBe(width);
    expect(out.rows.kick.slice(0, narrow.length)).toEqual(narrow);
    expect(out.rows.kick.slice(narrow.length).some(Boolean)).toBe(false);
    // Rejecting on length instead blanked the whole row, which silently threw
    // away the entire drum programming of every project written at 16 wide.
    expect(out.rows.kick.some(Boolean)).toBe(true);
    expect(fallback.rows.kick.some(Boolean)).toBe(true);
    // ...and every OTHER voice is untouched, so one bad row costs one voice.
    expect(out.rows.snare).toEqual(fallback.rows.snare);
  });
});

describe('sanitizeBeatMix', () => {
  test('a complete valid mix passes through unchanged', () => {
    const fallback = defaultBeatState().beatMix;
    const valid = structuredClone(fallback);
    valid.voices.kick = { levelDb: -3, muted: true };
    expect(sanitizeBeatMix(valid, fallback)).toEqual(valid);
  });

  test('missing mix entries are unity/unmuted', () => {
    const fallback = defaultBeatState().beatMix;
    const partial = { levelDb: -2, muted: false, voices: { kick: { levelDb: -3, muted: true } } };
    const out = sanitizeBeatMix(partial, fallback);
    expect(out.voices.snare).toEqual({ levelDb: 0, muted: false });
    expect(out.voices.kick).toEqual({ levelDb: -3, muted: true });
  });
});

describe('readBeatState', () => {
  test('the new shape, when all three keys are present, is read field by field', () => {
    const fallback = defaultBeatState();
    const stored = structuredClone(fallback);
    stored.beatMix.voices.kick.levelDb = -3;
    const out = readBeatState(stored, fallback);
    expect(out).toEqual(stored);
  });

  test('every legacy kit name still resolves to a preset that exists', () => {
    // The compat table is a frozen literal, so it cannot follow a preset id
    // that gets retired or renamed in `beatPresets.ts` — this is the guard
    // that turns that into a red test instead of legacy loops silently
    // reading back as `basePresetId: null` with somebody else's patch.
    const LEGACY_NAMES = [
      'Retro Drive', 'Club Standard', 'Trap Beat', '808 Vintage', 'Chrome Pulse',
      'Velocity Breaks', 'Sub Weight', 'Warehouse', 'Tight Pocket',
      'Acoustic Studio', 'Warm Riddim', 'Lo-Fi Vinyl', 'Dusty Break',
    ];
    for (const soundKit of LEGACY_NAMES) {
      const out = readBeatState({ soundKit }, defaultBeatState());
      expect(out.beatParams.basePresetId, soundKit).not.toBeNull();
    }
  });

  test('a body carrying only SOME of the three keys keeps the ones it carries', () => {
    // The two-of-three case: a hand-edited `.solna`, a minimizing serializer
    // that drops a default-valued key, or a foreign writer against the
    // interop marker. Dispatching on the presence of all three sent this into
    // the legacy branch, which found no legacy key either and threw away the
    // two fields the body DID carry.
    const fallback = defaultBeatState();
    const carried = structuredClone(fallback);
    carried.beatParams.outputTrimDb = -4.5;
    carried.beatPattern.rows.kick = carried.beatPattern.rows.kick.map((_, i) => i === 3);
    const twoOfThree = { beatParams: carried.beatParams, beatPattern: carried.beatPattern };

    const out = readBeatState(twoOfThree, fallback);

    expect(out.beatParams.outputTrimDb).toBe(-4.5);
    expect(out.beatPattern.rows.kick[3]).toBe(true);
    // ...and only the absent key falls back.
    expect(out.beatMix).toEqual(fallback.beatMix);
  });

  test('legacy input converts soundKit, drumFilter*, masterSequencerVolume, drumMuted and sequencerTracks', () => {
    const steps = new Array(MAX_STEPS_PER_BAR).fill(false).map((_, i) => i % 4 === 0);
    const legacy = {
      soundKit: 'Club Standard',
      drumFilterCutoff: 2400,
      drumFilterResonance: 1.5,
      drumFilterType: 'bandpass',
      masterSequencerVolume: -4,
      drumMuted: true,
      sequencerTracks: [{ instrument: 'kick', steps, volume: -2, muted: false }],
    };
    const out = readBeatState(legacy, defaultBeatState());
    expect(out.beatParams.basePresetId).toBe('club-standard');
    expect(out.beatParams.filter.cutoff).toBe(2400);
    expect(out.beatParams.filter.resonance).toBe(1.5);
    expect(out.beatParams.filter.type).toBe('bandpass');
    expect(out.beatPattern.rows.kick).toEqual(steps);
    expect(out.beatMix.voices.kick.levelDb).toBe(-2);
    expect(out.beatMix.voices.kick.muted).toBe(false);
    expect(out.beatMix.levelDb).toBe(-4);
    expect(out.beatMix.muted).toBe(true);
    // A voice the legacy body never named comes back silent in the pattern
    // and unity/unmuted in the mix, not the fallback's.
    expect(out.beatPattern.rows.snare.every((step) => step === false)).toBe(true);
    expect(out.beatMix.voices.snare).toEqual({ levelDb: 0, muted: false });
  });

  test('an unresolvable legacy kit name keeps the fallback patch with basePresetId null', () => {
    const legacy = { soundKit: 'Nonexistent Kit', sequencerTracks: [] };
    const fallback = defaultBeatState();
    const out = readBeatState(legacy, fallback);
    expect(out.beatParams.basePresetId).toBeNull();
    expect(out.beatParams.voices).toEqual(fallback.beatParams.voices);
    expect(out.beatParams.outputTrimDb).toBe(fallback.beatParams.outputTrimDb);
    // KEEPS the fallback's VALUES, never its OBJECTS. The fallback is the
    // caller's live patch, so aliasing it would let two loops read back
    // sharing one voices map and edit each other.
    expect(out.beatParams.voices).not.toBe(fallback.beatParams.voices);
    expect(out.beatParams.voices.kick).not.toBe(fallback.beatParams.voices.kick);
    out.beatParams.voices.kick.decay = 0.123;
    expect(fallback.beatParams.voices.kick.decay).not.toBe(0.123);
  });

  test('legacy sequencerTracks entries naming an unknown instrument are dropped', () => {
    const steps = new Array(MAX_STEPS_PER_BAR).fill(true);
    const legacy = {
      soundKit: 'Retro Drive',
      sequencerTracks: [{ instrument: 'tambourine', steps, volume: 0, muted: false }],
    };
    const out = readBeatState(legacy, defaultBeatState());
    expect(out.beatPattern.rows).not.toHaveProperty('tambourine');
    expect(out.beatPattern.rows.kick.every((step) => step === false)).toBe(true);
  });

  test('does not mutate its input', () => {
    const legacy = {
      soundKit: 'Retro Drive',
      sequencerTracks: [{ instrument: 'kick', steps: new Array(MAX_STEPS_PER_BAR).fill(false), volume: 0, muted: false }],
    };
    const snapshot = structuredClone(legacy);
    readBeatState(legacy, defaultBeatState());
    expect(legacy).toEqual(snapshot);
  });
});

/**
 * The conversion, through the REAL `.solna` import path.
 *
 * It lives in this file and not in `projectFile.test.ts` because the legacy
 * field names may appear in exactly three files — `sanitizeBeat.ts`, this
 * test, and `beatLegacyBoundary.test.ts`, which is what holds that line. The
 * suite that owns the conversion is the honest home for the test that proves
 * the conversion is actually wired into the reader, rather than sitting
 * correct and unreachable.
 */
describe('a pre-Beat `.solna` body, read through parseProjectFile', () => {
  const body = { ...makeEnvelope('Legacy', 1_700_000_000_000), content: factoryProjectContent() };
  const contentWith = (loop: Record<string, unknown>) =>
    JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } });

  // The other read shape: a body written before the Beat instrument existed
  // carries `soundKit` and `sequencerTracks` instead. `readBeatState`
  // (sanitizeBeat.ts) is the one place that conversion may live, and this is
  // the path that proves it is wired into the import.
  test('a legacy body converts its kit, its rows and its per-voice mix', () => {
    const loop = createDefaultLoop() as unknown as Record<string, unknown>;
    delete loop.beatParams;
    delete loop.beatPattern;
    delete loop.beatMix;
    loop.soundKit = 'Club Standard';
    loop.masterSequencerVolume = -3;
    loop.drumMuted = true;
    loop.sequencerTracks = [
      {
        id: 'track-kick',
        name: 'Kick',
        instrument: 'kick',
        steps: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false).map((_, i) => i === 8),
        volume: -6,
        muted: true,
        color: 'bg-drum-kick',
      },
    ];

    const result = parseProjectFile(contentWith(loop));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = result.body.content.loops[0];
    expect(read.beatParams.basePresetId).toBe('club-standard');
    expect(read.beatPattern.rows.kick[8]).toBe(true);
    expect(read.beatPattern.rows.snare.every((hit) => !hit)).toBe(true);
    expect(read.beatMix.voices.kick).toEqual({ levelDb: -6, muted: true });
    expect(read.beatMix.levelDb).toBe(-3);
    expect(read.beatMix.muted).toBe(true);
  });
});
