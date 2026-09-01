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

  test('a song advance never stops a player and never cuts a bus', () => {
    // The whole point of the seamless path: a hard stop is what made both
    // playback hooks cut 'chord', 'bass' and 'synth' to 20 ms, so the advance
    // must not produce one.
    const stopSource = spyOn(audioEngine, 'stopSource');
    const drop = spyOn(audioEngine, 'dropVoicesScheduledFrom');
    const resetClock = spyOn(audioEngine, 'resetClock');
    try {
      useAppStore.setState({
        loops: [createDefaultLoop(), { ...createDefaultLoop(), id: 'loop-b', name: 'B' }],
        activeLoopId: 'loop-default-1',
        songLoopIndex: 0,
        sequencerPlayer: 'playing',
        chordsPlayer: 'playing',
        leadPlayer: 'playing',
        playbackScope: { kind: 'song' },
      });
      stopSource.mockClear();
      resetClock.mockClear();

      loadLoop('loop-b', { atBoundary: 42.5 });

      const s = useAppStore.getState();
      expect(s.activeLoopId).toBe('loop-b');
      expect([s.sequencerPlayer, s.chordsPlayer, s.leadPlayer]).toEqual([
        'playing', 'playing', 'playing',
      ]);
      // The scope survives because nothing dispatched 'stop-all', not because
      // it was captured and restored.
      expect(s.playbackScope).toEqual({ kind: 'song' });
      expect(stopSource).not.toHaveBeenCalled();
      expect(drop.mock.calls).toEqual([
        ['chord', 42.5], ['bass', 42.5], ['synth', 42.5],
      ]);
      expect(resetClock.mock.calls.at(-1)).toEqual([42.5]);
    } finally {
      stopSource.mockRestore();
      drop.mockRestore();
      resetClock.mockRestore();
    }
  });

  test('is a safe no-op for an unknown id', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1', scaleRoot: 'A' });
    loadLoop('loop-missing');
    expect(useAppStore.getState().scaleRoot).toBe('A');
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
  });
});
