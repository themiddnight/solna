import { describe, expect, test } from 'bun:test';
import { parseProjectFile, serializeProject, unknownLibraryReferences } from './projectFile';
import { PROJECT_FORMAT_VERSION, factoryProjectContent, makeEnvelope } from './projectFormat';
import { createDefaultLoop } from './loopSlice';
import { LOOP_FLAT_KEYS } from './loop';

const body = { ...makeEnvelope('Round Trip', 1_700_000_000_000), content: factoryProjectContent() };

describe('serializeProject / parseProjectFile round trip', () => {
  test('every envelope field and every content key survives', () => {
    const result = parseProjectFile(serializeProject(body));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.id).toBe(body.id);
    expect(result.body.name).toBe('Round Trip');
    expect(result.body.createdAt).toBe(body.createdAt);
    expect(result.body.updatedAt).toBe(body.updatedAt);
    expect(result.body.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(result.body.content.bpm).toBe(120);
    expect(result.body.content.loops).toHaveLength(1);
    for (const key of LOOP_FLAT_KEYS) {
      expect(result.body.content.loops[0][key]).toEqual(body.content.loops[0][key]);
    }
    expect(result.warnings).toEqual([]);
  });

  test('the file is plain JSON a text editor can read', () => {
    expect(JSON.parse(serializeProject(body)).content.bpm).toBe(120);
  });
});

describe('parseProjectFile rejections (table-driven)', () => {
  const cases: Array<[string, string, 'malformed' | 'newer-version']> = [
    ['bad JSON', '{ not json', 'malformed'],
    ['empty file', '', 'malformed'],
    ['array root', '[]', 'malformed'],
    ['null root', 'null', 'malformed'],
    ['missing id', JSON.stringify({ ...body, id: undefined }), 'malformed'],
    ['numeric name', JSON.stringify({ ...body, name: 7 }), 'malformed'],
    ['string createdAt', JSON.stringify({ ...body, createdAt: 'yesterday' }), 'malformed'],
    ['missing content', JSON.stringify({ ...body, content: undefined }), 'malformed'],
    ['formatVersion missing', JSON.stringify({ ...body, formatVersion: undefined }), 'malformed'],
    ['formatVersion from the future', JSON.stringify({ ...body, formatVersion: PROJECT_FORMAT_VERSION + 1 }), 'newer-version'],
  ];
  for (const [label, text, error] of cases) {
    test(label, () => {
      const result = parseProjectFile(text);
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error).toBe(error);
        expect(result.message.length).toBeGreaterThan(0);
      }
    });
  }

  test('the newer-version message is the spec copy', () => {
    const result = parseProjectFile(JSON.stringify({ ...body, formatVersion: 99 }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toBe('This project was saved by a newer version of Solna.');
    }
  });
});

describe('parseProjectFile sanitises wrong-typed content instead of refusing', () => {
  test('bpm string, effects string, loops string all fall back', () => {
    const text = JSON.stringify({ ...body, content: { bpm: 'fast', effects: 'wet', loops: 'many' } });
    const result = parseProjectFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.content.bpm).toBe(120);
    expect(result.body.content.masterVolume).toBe(0); // DEFAULT_FADER_DB (unity 0 dB)
    expect(result.body.content.meterId).toBe('4/4');
    expect(typeof result.body.content.effects.reverbWet).toBe('number');
    expect(result.body.content.loops).toHaveLength(1);
  });

  // A file arrives from somebody else's device: an array of the RIGHT shape
  // holding the WRONG elements must not reach the store either.
  test('a loop whose chords are numbers imports with the default progression', () => {
    const loop = { ...createDefaultLoop(), chords: [1, 2, 3] };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.content.loops[0].chords).toEqual(createDefaultLoop().chords);
  });

  test('an empty loops array becomes one default loop', () => {
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [] } }));
    expect(result.ok && result.body.content.loops).toHaveLength(1);
  });

  // DEV-386 fix round 2: a .solna body is an external contract, not this
  // app's own localStorage — a malformed sequencerTracks[].volume here is
  // ordinary untrusted input, and the old, unguarded isSequencerTrack let it
  // straight through to faderDbToGain, which fails SAFE TO SILENCE. Both
  // cases are asserted through the real import path (parseProjectFile), not
  // by calling a sanitize helper directly.
  test('an out-of-range sequencer track volume imports at its default, not clamped or silenced', () => {
    const track = { ...createDefaultLoop().sequencerTracks[0], volume: 999 };
    const loop = { ...createDefaultLoop(), sequencerTracks: [track] };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // DEFAULT_FADER_DB (unity): 999's UNIT is unknown, not just its
    // magnitude, so it is not clamped to FADER_MAX_DB — and not silenced.
    expect(result.body.content.loops[0].sequencerTracks[0].volume).toBe(0);
  });

  test('a non-numeric sequencer track volume imports at unity, not silence', () => {
    const track = { ...createDefaultLoop().sequencerTracks[0], volume: 'loud' };
    const loop = { ...createDefaultLoop(), sequencerTracks: [track] };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // asFaderDb's fallback for a non-finite/wrong-typed value is
    // DEFAULT_FADER_DB (0 dB, unity) — the safe direction. Before this fix,
    // an unclamped garbage value reached faderDbToGain, which maps anything
    // non-finite to a LINEAR gain of exactly 0: a muted drum track, silently.
    expect(result.body.content.loops[0].sequencerTracks[0].volume).toBe(0);
  });

  // sanitizeLoops now validates these three against their own libraries
  // (DRUM_KITS / BASS_PATTERNS / CHORD_RHYTHMS), so an unknown id/name falls
  // back to the default loop's value INSIDE sanitizeContent, before
  // unknownLibraryReferences ever sees it — the import still succeeds, but
  // nothing "unknown" survives to import verbatim or to warn about.
  test('unknown soundKit / bassPatternId / chordRhythmId fall back to the default loop, with no warning', () => {
    const fallback = createDefaultLoop();
    const loop = {
      ...fallback,
      soundKit: 'Kit From The Future',
      bassPatternId: 'bp-ghost',
      chordRhythmId: 'cr-ghost',
    };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.content.loops[0].soundKit).toBe(fallback.soundKit);
    expect(result.body.content.loops[0].bassPatternId).toBe(fallback.bassPatternId);
    expect(result.body.content.loops[0].chordRhythmId).toBe(fallback.chordRhythmId);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('unknownLibraryReferences', () => {
  test('is empty for factory content and lists each unknown id once', () => {
    expect(unknownLibraryReferences(factoryProjectContent())).toEqual([]);
    const content = factoryProjectContent();
    content.loops = [
      { ...createDefaultLoop(), id: 'x', soundKit: 'Nope' },
      { ...createDefaultLoop(), id: 'y', soundKit: 'Nope' },
    ];
    expect(unknownLibraryReferences(content)).toEqual(['drum kit "Nope"']);
  });
});

// migrateProjectBody (the identity function DEV-388 first replaced the
// version chain with) and its module were deleted in the final review fix
// wave: nothing in production imported it, and the three validation cases
// its docblock explained are already stated at projectFormat.ts:29-38.
