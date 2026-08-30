import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { loadLoop, LOAD_LOOP_RELEASE } from './loadLoop';
import { useAppStore } from './store';
import type { Loop } from './types';

// loadLoop mutates the shared singleton store (loops, the flat per-loop
// slices, activeLoopId, the player states). bun runs every test file in one
// process without isolation, so a leftover scaleRoot/player state from a
// sibling file (e.g. an Instant Vibe apply) would bleed into the FIRST test
// here, and our own mutations would bleed out. Restore the default baseline
// before AND after each test so the suite stays order-independent.
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
  });
};

beforeEach(resetStore);
afterEach(resetStore);

describe('loadLoop', () => {
  test('swaps the flat slices to the target loop and updates activeLoopId', () => {
    const loopB: Loop = {
      ...createDefaultLoop(),
      id: 'loop-b',
      name: 'Loop B',
      scaleRoot: 'C',
      chordFeel: 0.1,
      drumMuted: true,
    };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    expect(useAppStore.getState().scaleRoot).toBe('A');

    loadLoop('loop-b');

    const after = useAppStore.getState();
    expect(after.activeLoopId).toBe('loop-b');
    expect(after.scaleRoot).toBe('C');
    expect(after.chordFeel).toBe(0.1);
    expect(after.drumMuted).toBe(true);
    expect(after.loops).toHaveLength(2);
    // The target loop in loops[] is the source of truth and stays untouched.
    expect(after.loops.find((r) => r.id === 'loop-b')?.scaleRoot).toBe('C');
  });

  test('restarts exactly the players that were active before the swap', () => {
    const loopB: Loop = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped' });
    useAppStore.getState().play('sequencer');
    useAppStore.getState().play('chords');

    loadLoop('loop-b');

    const after = useAppStore.getState();
    expect(after.sequencerPlayer).toBe('playing');
    expect(after.chordsPlayer).toBe('playing');
    expect(after.leadPlayer).toBe('stopped');
  });

  test('cuts the chord and bass sources during the swap', () => {
    const stopSource = spyOn(audioEngine, 'stopSource');
    try {
      useAppStore.setState({
        loops: [createDefaultLoop(), { ...createDefaultLoop(), id: 'loop-b', name: 'B' }],
        activeLoopId: 'loop-default-1',
      });
      loadLoop('loop-b');
      expect(stopSource).toHaveBeenCalledWith('chord', LOAD_LOOP_RELEASE);
      expect(stopSource).toHaveBeenCalledWith('bass', LOAD_LOOP_RELEASE);
    } finally {
      stopSource.mockRestore();
    }
  });

  test('is a safe no-op for an unknown id', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1', scaleRoot: 'A' });
    loadLoop('loop-missing');
    expect(useAppStore.getState().scaleRoot).toBe('A');
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
  });
});
