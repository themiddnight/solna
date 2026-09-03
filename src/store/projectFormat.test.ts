import { describe, expect, test } from 'bun:test';
import {
  PROJECT_CONTENT_KEYS,
  PROJECT_LOOP_KEYS,
  applyProjectContent,
  buildProjectContent,
  factoryProjectContent,
  makeEnvelope,
} from './projectFormat';
import { LOOP_FLAT_KEYS } from './loop';
import { createDefaultLoop } from './loopSlice';
import { INITIAL_EFFECTS } from './initialState';
import type { Loop } from './types';

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
    expect(c.bpm).toBe(120);
    expect(c.meterId).toBe('4/4');
    expect(c.masterVolume).toBe(0.85);
    expect(c.effects).toEqual(INITIAL_EFFECTS);
    expect(c.effects).not.toBe(INITIAL_EFFECTS);
    expect(c.loops).toHaveLength(1);
  });

  test('makeEnvelope mints a fresh id per call and stamps both timestamps', () => {
    const a = makeEnvelope('One', 1000);
    const b = makeEnvelope('One', 1000);
    expect(a.id).not.toBe(b.id);
    expect(a.formatVersion).toBe(1);
    expect(a.name).toBe('One');
    expect(a.createdAt).toBe(1000);
    expect(a.updatedAt).toBe(1000);
  });
});
