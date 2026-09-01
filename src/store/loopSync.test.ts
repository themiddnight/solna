import { afterEach, describe, expect, test } from 'bun:test';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { loadLoop } from './loadLoop';
import { loopMirrorPartial } from './loopSync';
import { useAppStore } from './store';
import type { AppStore } from './types';

// These tests mutate the shared singleton store (loops, the flat per-loop
// slices, activeLoopId). bun runs every test file in one process without
// isolation, so a leftover scaleRoot/synthParams would bleed into
// loadLoop.test.ts (which asserts a pristine default store). Restore the
// default baseline after each test so the files stay order-independent.
afterEach(() => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    ...loopStatePatch(loop),
  });
});

describe('loopMirrorPartial', () => {
  const baseState = (): AppStore => useAppStore.getState();

  test('a partial with no per-loop field returns null', () => {
    expect(loopMirrorPartial(baseState(), { bpm: 128 })).toBeNull();
  });

  test('a per-loop field set to its CURRENT value returns null', () => {
    const state = baseState();
    expect(loopMirrorPartial(state, { scaleRoot: state.scaleRoot })).toBeNull();
  });

  test('a partial that moves activeLoopId returns null (loadLoop owns that write)', () => {
    const state = baseState();
    const other = { ...createDefaultLoop(), id: 'loop-other' };
    expect(
      loopMirrorPartial(
        { ...state, loops: [...state.loops, other] },
        { activeLoopId: 'loop-other', scaleRoot: 'F' },
      ),
    ).toBeNull();
  });

  test('a changed per-loop field patches the ACTIVE loop only', () => {
    const state = baseState();
    const other = { ...createDefaultLoop(), id: 'loop-other', scaleRoot: 'C' };
    const withTwo = { ...state, loops: [state.loops[0], other] } as AppStore;

    const mirror = loopMirrorPartial(withTwo, { scaleRoot: 'F' });

    expect(mirror).not.toBeNull();
    expect(mirror!.loops[0].scaleRoot).toBe('F');
    expect(mirror!.loops[1].scaleRoot).toBe('C');
    // Untouched loops keep their identity, so no consumer sees a fake change.
    expect(mirror!.loops[1]).toBe(other);
  });

  test('the mirror writes the FULL 31-field patch, not just the changed key', () => {
    const state = baseState();
    const stale = { ...state.loops[0], scaleType: 'Dorian', chordOctave: 1 };
    const withStale = { ...state, loops: [stale] } as AppStore;

    const mirror = loopMirrorPartial(withStale, { scaleRoot: 'F' })!;

    expect(mirror.loops[0].scaleRoot).toBe('F');
    expect(mirror.loops[0].scaleType).toBe(state.scaleType);
    expect(mirror.loops[0].chordOctave).toBe(state.chordOctave);
  });

  test('setLoopMix shape: the mirror maps over the PARTIAL loops, not the old array', () => {
    const state = baseState();
    const nextLoops = [{ ...state.loops[0], synthVolume: 0.25 }];

    const mirror = loopMirrorPartial(state, { loops: nextLoops, synthVolume: 0.25 })!;

    expect(mirror.loops[0].synthVolume).toBe(0.25);
    expect(mirror.loops).toHaveLength(1);
  });

  test('an activeLoopId with no matching loop returns null', () => {
    const state = baseState();
    expect(
      loopMirrorPartial({ ...state, activeLoopId: 'nope' } as AppStore, { scaleRoot: 'F' }),
    ).toBeNull();
  });
});

describe('loop live-write sync (now folded into set)', () => {
  test('a flat per-loop edit reaches loops[activeLoopId]', () => {
    const id = useAppStore.getState().activeLoopId;
    useAppStore.getState().setScaleRoot('D');
    const loop = useAppStore.getState().loops.find((r) => r.id === id)!;
    expect(loop.scaleRoot).toBe('D');
  });

  test('syncs into the CURRENT active loop after a loadLoop switch', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B', scaleRoot: 'C' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    loadLoop('loop-b');
    useAppStore.getState().setScaleRoot('E');
    const loop = useAppStore.getState().loops.find((r) => r.id === 'loop-b')!;
    expect(loop.scaleRoot).toBe('E');
    const loopA = useAppStore.getState().loops.find((r) => r.id === 'loop-default-1')!;
    expect(loopA.scaleRoot).toBe('A');
  });

  test('an activeLoopId-only change does not rewrite the loop', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B', scaleRoot: 'C' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    loadLoop('loop-b');
    useAppStore.getState().setActiveLoop('loop-default-1');
    const found = useAppStore.getState().loops.find((r) => r.id === 'loop-b')!;
    expect(found.scaleRoot).toBe('C');
  });

  test('nested edits (synthParams) sync by reference change', () => {
    const id = useAppStore.getState().activeLoopId;
    useAppStore.getState().setSynthParams({ ...useAppStore.getState().synthParams, detune: 42 });
    const loop = useAppStore.getState().loops.find((r) => r.id === id)!;
    expect(loop.synthParams.detune).toBe(42);
  });

  test('one edit produces ONE store notification, not two', () => {
    // The whole point of the fold: the mirror used to be a second, independent
    // setState, so every gesture tick notified subscribers (and persist) twice.
    let notifications = 0;
    const stop = useAppStore.subscribe(() => {
      notifications += 1;
    });
    try {
      useAppStore.getState().setScaleRoot('G');
    } finally {
      stop();
    }
    expect(notifications).toBe(1);
  });
});
