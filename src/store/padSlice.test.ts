import { describe, expect, test } from 'bun:test';
import { LOOP_FLAT_KEYS } from './loop';
import { createDefaultLoop } from './loopSlice';
import { asPadIntervals, asPadMode, asPadVoicing, normalizePadIntervals } from './sanitize';
import { PAD_MODES, PAD_VOICINGS } from '../types';
import { useAppStore } from './store';

const PAD_KEYS = [
  'padSynthParams',
  'padMode',
  'padOctave',
  'padVoicing',
  'padDroneDegree',
  'padDroneIntervals',
  'padVolume',
  'padMuted',
] as const;

describe('pad state is per-loop', () => {
  // loopStatePatch writes every LOOP_FLAT_KEYS entry unconditionally, with no
  // guard and no ??. A pad key that is in the slice but missing from this list
  // would never round-trip through a loop switch; one that is in the list but
  // missing from createDefaultLoop would write undefined over the slice
  // default the first time a loop is activated.
  test('every pad key is in LOOP_FLAT_KEYS', () => {
    for (const key of PAD_KEYS) expect(LOOP_FLAT_KEYS).toContain(key);
  });

  test('createDefaultLoop supplies every pad key', () => {
    const loop = createDefaultLoop() as unknown as Record<string, unknown>;
    for (const key of PAD_KEYS) expect(loop[key]).toBeDefined();
  });

  test('the store hydrates with the pad audible', () => {
    // Read the fresh default, not the live singleton: `useAppStore` is a
    // process-wide store bun test shares across every file in this process,
    // so reading `.getState()` here would assert on whatever the LAST test
    // to touch `padMuted` anywhere left behind, not on hydration.
    expect(createDefaultLoop().padMuted).toBe(false);
  });
});

describe('pad actions', () => {
  test('togglePadDroneInterval adds and removes, keeping ascending order', () => {
    const s = useAppStore.getState();
    s.setPadDroneIntervals([1, 5]);
    useAppStore.getState().togglePadDroneInterval(4);
    expect(useAppStore.getState().padDroneIntervals).toEqual([1, 4, 5]);
    useAppStore.getState().togglePadDroneInterval(1);
    expect(useAppStore.getState().padDroneIntervals).toEqual([4, 5]);
  });

  test('unchecking the last interval is allowed and means a silent drone', () => {
    useAppStore.getState().setPadDroneIntervals([8]);
    useAppStore.getState().togglePadDroneInterval(8);
    expect(useAppStore.getState().padDroneIntervals).toEqual([]);
  });

  test('togglePadMuted flips', () => {
    const before = useAppStore.getState().padMuted;
    useAppStore.getState().togglePadMuted();
    expect(useAppStore.getState().padMuted).toBe(!before);
    useAppStore.getState().togglePadMuted();
  });
});

describe('pad sanitizers', () => {
  // The sort is not cosmetic. [5,1] and [1,5] are the same selection, and
  // without it that one selection has two on-disk spellings, so an unchanged
  // drone round-trips through a load as a change.
  test('asPadIntervals filters, de-duplicates and sorts ascending', () => {
    expect(asPadIntervals([5, 1, 5, 99, 'x', 4], [1])).toEqual([1, 4, 5]);
  });

  test('asPadIntervals accepts an empty array as a real selection', () => {
    expect(asPadIntervals([], [1, 5, 8])).toEqual([]);
  });

  test('asPadIntervals falls back when the value is not an array', () => {
    expect(asPadIntervals('nope', [1, 5, 8])).toEqual([1, 5, 8]);
    expect(asPadIntervals(undefined, [1, 5, 8])).toEqual([1, 5, 8]);
  });

  // The setters share this helper with the two readers, so an edit and a
  // reopen can never disagree about the stored order.
  test('normalizePadIntervals is what the store setter writes', () => {
    expect(normalizePadIntervals([5, 1, 5, 99, 'x', 4])).toEqual([1, 4, 5]);
    useAppStore.getState().setPadDroneIntervals([8, 1, 8, 5]);
    expect(useAppStore.getState().padDroneIntervals).toEqual([1, 5, 8]);
  });

  // Derived from the const arrays in types.ts, not re-typed here: a member
  // added there must be accepted without touching sanitize.
  test('every declared mode and voicing survives sanitize', () => {
    for (const m of PAD_MODES) expect(asPadMode(m, 'pad')).toBe(m);
    for (const v of PAD_VOICINGS) expect(asPadVoicing(v, 'triad')).toBe(v);
  });

  test('asPadMode and asPadVoicing reject unknown values', () => {
    expect(asPadMode('drone', 'pad')).toBe('drone');
    expect(asPadMode('wobble', 'pad')).toBe('pad');
    expect(asPadVoicing('open5', 'triad')).toBe('open5');
    expect(asPadVoicing(7, 'triad')).toBe('triad');
  });
});
