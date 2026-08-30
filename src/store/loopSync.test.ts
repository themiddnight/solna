import { afterEach, describe, expect, test } from 'bun:test';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { loadLoop } from './loadLoop';
import { startLoopSync } from './loopSync';
import { useAppStore } from './store';

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

describe('loop live-write sync', () => {
  test('a flat per-loop edit reaches loops[activeLoopId]', () => {
    const stop = startLoopSync();
    try {
      const id = useAppStore.getState().activeLoopId;
      useAppStore.getState().setScaleRoot('D');
      const loop = useAppStore.getState().loops.find((r) => r.id === id)!;
      expect(loop.scaleRoot).toBe('D');
    } finally {
      stop();
    }
  });

  test('syncs into the CURRENT active loop after a loadLoop switch', () => {
    const stop = startLoopSync();
    try {
      const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B', scaleRoot: 'C' };
      useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
      loadLoop('loop-b');
      useAppStore.getState().setScaleRoot('E');
      const loop = useAppStore.getState().loops.find((r) => r.id === 'loop-b')!;
      expect(loop.scaleRoot).toBe('E');
      const loopA = useAppStore.getState().loops.find((r) => r.id === 'loop-default-1')!;
      expect(loopA.scaleRoot).toBe('A');
    } finally {
      stop();
    }
  });

  test('an activeLoopId-only change does not rewrite the loop', () => {
    const stop = startLoopSync();
    try {
      const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B', scaleRoot: 'C' };
      useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
      loadLoop('loop-b');
      useAppStore.getState().setActiveLoop('loop-default-1');
      const found = useAppStore.getState().loops.find((r) => r.id === 'loop-b')!;
      expect(found.scaleRoot).toBe('C');
    } finally {
      stop();
    }
  });

  test('nested edits (synthParams) sync by reference change', () => {
    const stop = startLoopSync();
    try {
      const id = useAppStore.getState().activeLoopId;
      useAppStore.getState().setSynthParams({ ...useAppStore.getState().synthParams, detune: 42 });
      const loop = useAppStore.getState().loops.find((r) => r.id === id)!;
      expect(loop.synthParams.detune).toBe(42);
    } finally {
      stop();
    }
  });
});
