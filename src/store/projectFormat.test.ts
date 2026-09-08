import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import {
  PROJECT_CONTENT_KEYS,
  PROJECT_DB_LEVEL_KEYS,
  PROJECT_FORMAT_VERSION,
  PROJECT_LOOP_KEYS,
  applyProjectContent,
  buildProjectContent,
  factoryProjectContent,
  makeEnvelope,
} from './projectFormat';
import { parseProjectFile } from './projectFile';
import { DEFAULT_LEAD_GATE } from '../audio/leadMelody';
import { LOOP_FLAT_KEYS } from './loop';
import { createDefaultLoop } from './loopSlice';
import { INITIAL_EFFECTS } from './initialState';
import { DEFAULT_BPM } from './transportSlice';
import type { Loop } from './types';
import { defaultPadState } from './initialState';

// A Loop literal typed against the interface: adding a field to `Loop`
// without listing it in PROJECT_LOOP_KEYS fails the pinned test below.
const loopA: Loop = { ...createDefaultLoop(), id: 'loop-a', name: 'A' };
const loopB: Loop = { ...createDefaultLoop(), id: 'loop-b', name: 'B', bpm: undefined } as Loop;

const liveState = {
  bpm: 97,
  meterId: '6/8' as const,
  masterVolume: 0.6,
  effects: { ...INITIAL_EFFECTS, reverbWet: 0.4 },
  loops: [loopA, loopB],
  // excluded keys, present on purpose
  controlTarget: 'bass',
  activeLoopId: 'loop-b',
  metronomeActive: true,
  selectedVibeId: 'cyber-dance',
  customSynthPresets: [{ id: 'p' }],
  customChordProgressions: [{ id: 'c' }],
};

describe('buildProjectContent', () => {
  test('carries every content key and nothing else', () => {
    const content = buildProjectContent(liveState as never);
    expect(Object.keys(content).sort()).toEqual([...PROJECT_CONTENT_KEYS].sort());
    expect(content.bpm).toBe(97);
    expect(content.loops).toHaveLength(2);
  });

  test('excluded keys are ABSENT from the output (catches a stray ...state spread)', () => {
    const content = buildProjectContent(liveState as never) as unknown as Record<string, unknown>;
    for (const key of [
      'controlTarget',
      'activeLoopId',
      'metronomeActive',
      'selectedVibeId',
      'customSynthPresets',
      'customChordProgressions',
    ]) {
      expect(key in content).toBe(false);
    }
  });
});

describe('pinned key sets', () => {
  test('the per-loop content keys are exactly LOOP_FLAT_KEYS + id + name + repeatCount', () => {
    expect([...PROJECT_LOOP_KEYS].sort()).toEqual(
      [...LOOP_FLAT_KEYS, 'id', 'name', 'repeatCount'].sort(),
    );
    // Every key of a real Loop is listed, and every listed key is on a real Loop.
    const keysOnLoop = Object.keys(createDefaultLoop()).sort();
    expect(keysOnLoop).toEqual([...PROJECT_LOOP_KEYS].sort());
  });
});

describe('applyProjectContent (the reset rules)', () => {
  test('resets selectedVibeId and points activeLoopId at loops[0]', () => {
    const patch = applyProjectContent(buildProjectContent(liveState as never));
    expect(patch.selectedVibeId).toBeNull();
    expect(patch.activeLoopId).toBe('loop-a');
  });

  test('installs loops[0] into the flat per-loop keys in the same patch', () => {
    const patch = applyProjectContent(buildProjectContent(liveState as never)) as unknown as Record<string, unknown>;
    for (const key of LOOP_FLAT_KEYS) {
      expect(patch[key]).toEqual((loopA as unknown as Record<string, unknown>)[key]);
    }
  });

  test('never touches controlTarget or metronomeActive', () => {
    const patch = applyProjectContent(buildProjectContent(liveState as never)) as unknown as Record<string, unknown>;
    expect('controlTarget' in patch).toBe(false);
    expect('metronomeActive' in patch).toBe(false);
  });
});

describe('provenance is preserved verbatim', () => {
  test('unknown preset names, pattern ids and kit names round-trip byte-identical', () => {
    const ghost: Loop = {
      ...createDefaultLoop(),
      id: 'g',
      synthParams: { ...createDefaultLoop().synthParams, preset: 'Ghost Lead' },
      chordSynthParams: { ...createDefaultLoop().chordSynthParams, preset: 'Ghost Pad' },
      bassSynthParams: { ...createDefaultLoop().bassSynthParams, preset: 'Ghost Bass' },
      chordRhythmId: 'rhythm-that-does-not-exist',
      bassPatternId: 'bass-that-does-not-exist',
      soundKit: 'Kit From The Future',
    };
    const content = buildProjectContent({ ...liveState, loops: [ghost] } as never);
    const patch = applyProjectContent(content);
    expect(patch.synthParams.preset).toBe('Ghost Lead');
    expect(patch.chordSynthParams.preset).toBe('Ghost Pad');
    expect(patch.bassSynthParams.preset).toBe('Ghost Bass');
    expect(patch.chordRhythmId).toBe('rhythm-that-does-not-exist');
    expect(patch.bassPatternId).toBe('bass-that-does-not-exist');
    expect(patch.soundKit).toBe('Kit From The Future');
  });
});

describe('factoryProjectContent / makeEnvelope', () => {
  test('factory content is the store defaults with one default loop', () => {
    const c = factoryProjectContent();
    expect(c.bpm).toBe(DEFAULT_BPM);
    expect(c.meterId).toBe('4/4');
    expect(c.masterVolume).toBe(0); // DEFAULT_FADER_DB (unity 0 dB)
    expect(c.effects).toEqual(INITIAL_EFFECTS);
    expect(c.effects).not.toBe(INITIAL_EFFECTS);
    expect(c.loops).toHaveLength(1);
  });

  test('makeEnvelope mints a fresh id per call and stamps both timestamps', () => {
    const a = makeEnvelope('One', 1000);
    const b = makeEnvelope('One', 1000);
    expect(a.id).not.toBe(b.id);
    expect(a.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(a.name).toBe('One');
    expect(a.createdAt).toBe(1000);
    expect(a.updatedAt).toBe(1000);
  });
});

// migrateProjectBody and projectFormatMigrate.ts were deleted in the DEV-388
// final review fix wave: it was a pure identity function with no production
// caller, and the validation it explained is already stated in this file's
// PROJECT_FORMAT_VERSION docblock above and pinned by the source-text tests
// around it.

/**
 * A formatVersion-1 file exactly as an older build wrote it: string melody
 * rows, no leadGate, a linear-gain masterVolume. Built from createDefaultLoop
 * so every other field is valid and the only things under test are validation
 * outcomes — no version-based behaviour is left to test.
 */
function legacyV1ProjectFile(): string {
  const loop = { ...createDefaultLoop(), id: 'loop-1', name: 'Loop 1' } as unknown as Record<string, unknown>;
  loop.leadMelodySteps = [['C4', 'E4'], [], ['G4']];
  delete loop.leadGate;
  return JSON.stringify({
    formatVersion: 1,
    id: 'project-legacy',
    name: 'Legacy',
    createdAt: 1,
    updatedAt: 2,
    content: {
      bpm: 118,
      meterId: '4/4',
      masterVolume: 0.85,
      effects: INITIAL_EFFECTS,
      loops: [loop],
    },
  });
}

describe('a formatVersion-1 .solna file through the real import path', () => {
  test('parseProjectFile validates by range/shape, not by version, and keeps the rest', () => {
    const result = parseProjectFile(legacyV1ProjectFile());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('parseProjectFile refused a valid v1 file');

    const loop: Loop = result.body.content.loops[0];
    expect(result.body.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    // masterVolume was a linear 0.85 — in range for dB too, so it passes
    // through UNCHANGED. Under the new rule that is correct: nothing can tell
    // a pre-conversion linear value from a dB one, so nothing tries.
    expect(result.body.content.masterVolume).toBe(0.85);
    // The v1 melody is a DIFFERENT SHAPE (string[][]), which asLeadNoteMatrix
    // has always rejected outright — a shape rejection, not a version one —
    // so it still comes back blank via createDefaultLoop's own default.
    expect(loop.leadMelodySteps).toEqual(createDefaultLoop().leadMelodySteps);
    expect(loop.leadGate).toBe(DEFAULT_LEAD_GATE);
    expect(loop.name).toBe('Loop 1');
    expect(result.body.content.bpm).toBe(118);
  });
});

// THE THIRD OF THE THREE. A NEW project ships an audible pad — that is the
// point of shipping the layer. Together with the two migration tests above,
// this pins the deliberate asymmetry: collapsing defaultPadState() and the
// migrations' `padMuted: true` override into one constant turns exactly one of
// the three red.
test('a factory project ships the pad audible', () => {
  const content = factoryProjectContent();
  expect(content.loops[0].padMuted).toBe(false);
  expect(defaultPadState().padMuted).toBe(false);
});

/**
 * The dB level contract is prose, and prose rots. It is pinned here the only
 * way prose can be: the test reads projectFormat.ts's own source and asserts
 * the contract block still names the boundary version, the mixed-unit versions
 * below it, the unit, the range, the silence encoding and every key it covers.
 * Reading a source file from a test is
 * established in this repo — src/data/dataLayerPurity.test.ts lints fixture
 * sources through eslint's own API for the same reason.
 */
describe('the dB level contract in the format docblock', () => {
  const source = readFileSync(new URL('./projectFormat.ts', import.meta.url), 'utf8');
  // Anchored on the section's OWN heading line (hence the `m` flag), not on a
  // phrase appearing anywhere in the file. A lazy
  // /\/\*\*[^]*?dB LEVEL CONTRACT[^]*?\*\// matches leftmost-first: it would
  // start at the file's very first docblock and swallow every comment in
  // between, so an assertion like toContain('-60') could be satisfied by
  // unrelated prose several blocks away.
  const block = source.match(/^ \* dB LEVEL CONTRACT[^]*?\*\//m)?.[0] ?? '';

  test('the contract block exists', () => {
    expect(block.length).toBeGreaterThan(0);
  });

  test('names PROJECT_FORMAT_VERSION as the current, directly-read version', () => {
    expect(block).toContain('PROJECT_FORMAT_VERSION');
    expect(PROJECT_FORMAT_VERSION).toBe(10);
  });

  test('it states the unit, the unity, the range and the silence encoding', () => {
    expect(block).toContain('decibels');
    expect(block).toContain('0 dB is unity');
    expect(block).toContain('-60');
    expect(block).toContain('+12');
    expect(block).toContain('JSON.stringify(-Infinity)');
  });

  test('it states validation-by-range, not a version-based reset or conversion', () => {
    // The rule the DEV-388 follow-up landed: a value in range is legal dB
    // regardless of which version wrote it, because nothing distinguishes a
    // pre-conversion linear reading from a post-conversion dB one — so
    // nothing here tries to any more.
    expect(block).toContain('NO version-based reset or conversion');
    expect(block).toContain('asFaderDb');
    expect(block).toContain('0.7');
  });

  test('every key it lists is named in the contract block', () => {
    for (const key of PROJECT_DB_LEVEL_KEYS) {
      expect(block).toContain(key);
    }
  });

  test('it lists flat keys only — the per-track fader is contract prose, not an entry', () => {
    // The list is iterated by sanitizePersistedState (store.ts), so an entry has
    // to be a real top-level key. 'sequencerTracks[].volume' used to sit in here
    // as prose, which is what stopped the constant being usable as code at all;
    // it is still covered by the contract, and still validated, one level down.
    for (const key of PROJECT_DB_LEVEL_KEYS) {
      expect(key, key).not.toContain('[');
    }
    expect(block).toContain('sequencerTracks[].volume');
  });

  test('every per-loop level key it names is a real per-loop key', () => {
    const perLoop = PROJECT_DB_LEVEL_KEYS.filter((key) => key !== 'masterVolume');
    for (const key of perLoop) {
      expect(LOOP_FLAT_KEYS as readonly string[]).toContain(key);
    }
    expect(PROJECT_CONTENT_KEYS as readonly string[]).toContain('masterVolume');
  });
});
