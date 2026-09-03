import { describe, expect, test } from 'bun:test';
import { parseProjectFile, serializeProject, unknownLibraryReferences } from './projectFile';
import { migrateProjectBody } from './projectFormatMigrate';
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
    expect(result.body.content.masterVolume).toBe(0.85);
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

  test('unknown soundKit / bassPatternId / chordRhythmId import successfully, verbatim, with a warning', () => {
    const loop = {
      ...createDefaultLoop(),
      soundKit: 'Kit From The Future',
      bassPatternId: 'bp-ghost',
      chordRhythmId: 'cr-ghost',
    };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.content.loops[0].soundKit).toBe('Kit From The Future');
    expect(result.body.content.loops[0].bassPatternId).toBe('bp-ghost');
    expect(result.body.content.loops[0].chordRhythmId).toBe('cr-ghost');
    expect(result.warnings).toHaveLength(3);
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

describe('migrateProjectBody', () => {
  test('is the identity at v1 and does not mutate its input', () => {
    const raw = { formatVersion: 1, id: 'a' };
    const out = migrateProjectBody(raw, 1);
    expect(out).toEqual(raw);
    expect(out).not.toBe(raw);
  });
});
