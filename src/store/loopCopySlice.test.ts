import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { SCOPE_NONE } from './playbackScope';
import { useAppStore } from './store';
import type { Loop } from './types';

// applyLoopCopy's active branch runs loadLoop, which mutates the shared
// singleton store (loops, the flat per-loop slices, activeLoopId, the player
// states). bun runs every test file in one process without isolation, so
// restore the default baseline before AND after each test.
const resetStore = () => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    ...loopStatePatch(loop),
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    songLoopIndex: null,
    activeTab: 'sound',
    playbackScope: SCOPE_NONE,
  });
};

beforeEach(resetStore);
afterEach(resetStore);

/** Target 'loop-target' in A Natural Minor; source 'loop-source' in C Major. */
function seedTwoLoops(activeId: string) {
  const target: Loop = { ...createDefaultLoop(), id: 'loop-target', name: 'Verse' };
  const source: Loop = {
    ...createDefaultLoop(),
    id: 'loop-source',
    name: 'Chorus',
    scaleRoot: 'C',
    scaleType: 'Major',
    chordFeel: 0.9,
    chordOctave: 5,
    bassOctave: 3,
    synthVolume: -3,
  };
  source.sequencerTracks[0].steps[1] = true;
  const active = activeId === target.id ? target : source;
  useAppStore.setState({ loops: [target, source], activeLoopId: activeId, ...loopStatePatch(active) });
  return { target, source };
}

describe('applyLoopCopy — target is NOT the active loop', () => {
  test('the patch lands in loops[] and no flat per-loop field moves', () => {
    seedTwoLoops('loop-source');
    const flatBefore = loopStatePatch(useAppStore.getState());

    useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', ['chord-pattern', 'key']);

    const after = useAppStore.getState();
    const patched = after.loops.find((loop) => loop.id === 'loop-target')!;
    expect(patched.chordFeel).toBe(0.9);
    expect(patched.chordOctave).toBe(5);
    expect(patched.scaleRoot).toBe('C');
    expect(patched.scaleType).toBe('Major');
    // Not selected, so untouched on the target.
    expect(patched.bassOctave).toBe(2);
    expect(patched.synthVolume).toBe(-6);
    // The whole point of this branch: editing a loop you are not on makes no
    // sound, so every flat field is byte-for-byte what it was.
    expect(loopStatePatch(after)).toEqual(flatBefore);
    expect(after.activeLoopId).toBe('loop-source');
  });

  test('neither label field moves in either direction', () => {
    seedTwoLoops('loop-source');
    useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', ['chord-pattern', 'mix']);
    const after = useAppStore.getState();
    expect(after.loops.find((loop) => loop.id === 'loop-target')!.name).toBe('Verse');
    expect(after.loops.find((loop) => loop.id === 'loop-source')!.name).toBe('Chorus');
  });

  test('an empty selection writes nothing at all', () => {
    seedTwoLoops('loop-source');
    const loopsBefore = useAppStore.getState().loops;
    useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', []);
    expect(useAppStore.getState().loops).toBe(loopsBefore);
  });

  test('copying a loop into itself is a no-op, not a restart', () => {
    seedTwoLoops('loop-source');
    const loopsBefore = useAppStore.getState().loops;
    useAppStore.getState().applyLoopCopy('loop-source', 'loop-source', ['mix']);
    expect(useAppStore.getState().loops).toBe(loopsBefore);
  });
});

describe('applyLoopCopy — target IS the active loop', () => {
  test('the flat slices and loops[] agree on every copied key afterwards', () => {
    seedTwoLoops('loop-target');
    expect(useAppStore.getState().scaleRoot).toBe('A');

    useAppStore
      .getState()
      .applyLoopCopy('loop-target', 'loop-source', ['chord-pattern', 'key', 'drums-pattern']);

    const after = useAppStore.getState();
    const patched = after.loops.find((loop) => loop.id === 'loop-target')!;
    // loops[] took the patch...
    expect(patched.scaleRoot).toBe('C');
    expect(patched.chordFeel).toBe(0.9);
    expect(patched.sequencerTracks[0].steps[1]).toBe(true);
    // ...and loadLoop mirrored it into the flat slices the engine reads.
    expect(after.scaleRoot).toBe('C');
    expect(after.chordFeel).toBe(0.9);
    expect(after.sequencerTracks[0].steps[1]).toBe(true);
    expect(loopStatePatch(after)).toEqual(loopStatePatch(patched));
    expect(after.activeLoopId).toBe('loop-target');
  });

  test('the copy survives the loadLoop round trip — the write order, asserted', () => {
    seedTwoLoops('loop-target');
    // Written the other way round (loadLoop first, loops[] second) this
    // reads back the PRE-copy value: loadLoop copies the stored loop into
    // the flat slices, so the patch would be loaded over and then mirrored
    // back. 0.5 is the default chordFeel; 0.9 is the source's.
    useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', ['chord-pattern']);
    expect(useAppStore.getState().chordFeel).toBe(0.9);
    expect(useAppStore.getState().loops.find((loop) => loop.id === 'loop-target')!.chordFeel).toBe(0.9);
  });

  test('the deep clone holds across the store write', () => {
    const { source } = seedTwoLoops('loop-target');
    useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', ['drums-pattern']);
    const stored = useAppStore.getState().loops.find((loop) => loop.id === 'loop-target')!;
    expect(stored.sequencerTracks).not.toBe(source.sequencerTracks);
    expect(stored.sequencerTracks[0]).not.toBe(source.sequencerTracks[0]);
  });

  test('neither label field moves on the active branch either', () => {
    seedTwoLoops('loop-target');
    useAppStore.getState().applyLoopCopy('loop-target', 'loop-source', ['chord-pattern', 'mix']);
    const after = useAppStore.getState();
    expect(after.loops.find((loop) => loop.id === 'loop-target')!.name).toBe('Verse');
    expect(after.loops.find((loop) => loop.id === 'loop-source')!.name).toBe('Chorus');
  });
});
