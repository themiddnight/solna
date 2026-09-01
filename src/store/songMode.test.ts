import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { INITIAL_CHORDS } from './initialState';
import { loadLoop } from './loadLoop';
import { createDefaultLoop } from './loopSlice';
import { loopStatePatch } from './loop';
import { soloLoopId } from './playbackScope';
import { useAppStore } from './store';
import { isSongLayer } from '../types';
import {
  enterSongIndex,
  nextLoopIndex,
  loopLengthSteps,
  songAdvanceTarget,
  startSongModeSync,
} from './songMode';
import type { Loop } from './types';

function shortLoop(id: string, bars: number): Loop {
  return {
    ...createDefaultLoop(),
    id,
    name: `Loop ${id}`,
    chords: [{ id: `c-${id}`, root: 'C', quality: 'maj', bars, notes: ['C4'] }],
  };
}

describe('song mode pure helpers', () => {
  test('isSongLayer is true for both song-layer tabs', () => {
    expect(isSongLayer('arrange')).toBe(true);
    expect(isSongLayer('effects')).toBe(true);
    expect(isSongLayer('synth')).toBe(false);
  });

  test('loopLengthSteps multiplies bars by stepsPerBar', () => {
    expect(loopLengthSteps([{ bars: 2 }, { bars: 1 }], 16)).toBe(48);
    expect(loopLengthSteps([{ bars: 0 }], 16)).toBe(16);
    expect(loopLengthSteps(INITIAL_CHORDS, 16)).toBe(64);
  });

  test('nextLoopIndex wraps to 0 after the last loop', () => {
    expect(nextLoopIndex([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 0)).toBe(1);
    expect(nextLoopIndex([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2)).toBe(0);
  });

  test('enterSongIndex resolves the active loop to its list index, defaulting to 0', () => {
    expect(enterSongIndex([{ id: 'a' }, { id: 'b' }], 'b')).toBe(1);
    expect(enterSongIndex([{ id: 'a' }], 'missing')).toBe(0);
  });

  test('songAdvanceTarget returns the next loop id exactly on the boundary', () => {
    const loops = [shortLoop('a', 4), shortLoop('b', 2)];
    expect(songAdvanceTarget(loops, 0, 63, 16)).toBe(null);
    expect(songAdvanceTarget(loops, 0, 64, 16)).toBe('b');
    expect(songAdvanceTarget(loops, 1, 32, 16)).toBe('a'); // wraps
    expect(songAdvanceTarget(loops, 1, 31, 16)).toBe(null);
  });

  test('songAdvanceTarget multiplies loop length by repeatCount before advancing', () => {
    const loopA = { ...shortLoop('a', 2), repeatCount: 3 }; // 2 bars x 16 steps x 3 repeats = 96 steps
    const loopB = shortLoop('b', 1);
    const loops = [loopA, loopB];
    expect(songAdvanceTarget(loops, 0, 32, 16)).toBe(null); // After 1st rep
    expect(songAdvanceTarget(loops, 0, 64, 16)).toBe(null); // After 2nd rep
    expect(songAdvanceTarget(loops, 0, 95, 16)).toBe(null);
    expect(songAdvanceTarget(loops, 0, 96, 16)).toBe('b'); // After 3rd rep
  });

  test('songAdvanceTarget ignores step 0, loop mode and an out-of-range cursor', () => {
    const loops = [shortLoop('a', 4)];
    expect(songAdvanceTarget(loops, null, 64, 16)).toBe(null);
    expect(songAdvanceTarget(loops, 0, 0, 16)).toBe(null);
    expect(songAdvanceTarget(loops, 99, 64, 16)).toBe(null);
  });

  test('songAdvanceTarget does not reload the sole loop of a single-loop arrangement', () => {
    const loops = [shortLoop('a', 4)];
    // Wrapping onto itself would hard-stop and reset the clock every loop; the
    // single-loop song must just loop in place like loop mode.
    expect(songAdvanceTarget(loops, 0, 64, 16)).toBe(null);
  });

  test('songAdvanceTarget dwells an empty loop one bar then advances', () => {
    const empty: Loop = {
      ...createDefaultLoop(),
      id: 'empty',
      name: 'Empty',
      chords: [],
    };
    const loops = [empty, shortLoop('b', 1)];
    expect(songAdvanceTarget(loops, 0, 0, 16)).toBe(null); // step 0
    expect(songAdvanceTarget(loops, 0, 15, 16)).toBe(null); // mid-bar
    expect(songAdvanceTarget(loops, 0, 16, 16)).toBe('b'); // after one bar of silence
  });
});

function makeFakeClock() {
  const cbs: Array<(step: number, beat: number, time: number) => void> = [];
  return {
    get count() {
      return cbs.length;
    },
    subscribe: (cb: (step: number, beat: number, time: number) => void) => {
      cbs.push(cb);
      return () => {
        const i = cbs.indexOf(cb);
        if (i >= 0) cbs.splice(i, 1);
      };
    },
    tick: (step: number) => {
      for (const cb of [...cbs]) cb(step, step, 0);
    },
  };
}

const resetState = () => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    ...loopStatePatch(loop),
    activeTab: 'synth',
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    songLoopIndex: null,
    playbackScope: { kind: 'none' },
  });
};

beforeEach(resetState);
afterEach(resetState);

describe('song mode coordinator', () => {
  test('entering song mode keeps the active loop and subscribes the clock', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().play('sequencer');

    const s = useAppStore.getState();
    // The song cursor starts at the ACTIVE loop's index — no auto-load of
    // loops[0] and no restart; the sounding loop keeps sounding.
    expect(s.songLoopIndex).toBe(0);
    expect(s.activeLoopId).toBe('loop-default-1');
    expect(clock.count).toBe(1);
    stop();
  });

  test('advances to the next loop at the boundary and wraps to the top', async () => {
    const loopB = {
      ...createDefaultLoop(),
      id: 'loop-b',
      name: 'Loop B',
      chords: [{ id: 'c1', root: 'C', quality: 'maj', bars: 2, notes: ['C4'] }],
    };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().playAll();
    expect(useAppStore.getState().songLoopIndex).toBe(0);
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });

    // The advance runs synchronously inside the clock dispatch: loadLoop's
    // hard-stop + restart resets the shared clock, so each loop's boundary is
    // measured from 0. First loop is 4 bars x 16 = 64 steps.
    clock.tick(64);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().activeLoopId).toBe('loop-b');
    expect(useAppStore.getState().songLoopIndex).toBe(1);
    // The arrangement boundary crosses through loadLoop's internal hard stop,
    // which must not decay the scope back to 'none' — every card button
    // would re-enable mid-song otherwise.
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });

    // Second loop is 2 bars x 16 = 32 steps; 64 + 32 = 96 wraps to loop 0.
    clock.tick(96);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
    expect(useAppStore.getState().songLoopIndex).toBe(0);
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });
    stop();
  });

  test('a user-initiated Stop still clears the song scope after a boundary crossing', async () => {
    const loopB = {
      ...createDefaultLoop(),
      id: 'loop-b',
      name: 'Loop B',
      chords: [{ id: 'c1', root: 'C', quality: 'maj', bars: 2, notes: ['C4'] }],
    };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().playAll();
    clock.tick(64);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });

    useAppStore.getState().hardStopAll();
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'none' });
    stop();
  });

  test('leaving the song layer hard-stops the players, drops the cursor and unsubscribes the clock', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    expect(clock.count).toBe(1);

    // Crossing to the loop layer is a hard stop — the players do NOT keep
    // looping (SP3's "detach but keep looping" rule is gone).
    useAppStore.getState().setActiveTab('synth');
    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    expect(s.songLoopIndex).toBe(null);
    expect(clock.count).toBe(0);
    stop();
  });

  test('re-entering song mode re-enters at the active loop', async () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-b' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    // Enters at the active loop (index 1), not the top.
    expect(useAppStore.getState().songLoopIndex).toBe(1);
    clock.tick(64);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
    expect(useAppStore.getState().songLoopIndex).toBe(0);
    useAppStore.getState().setActiveTab('synth');
    expect(useAppStore.getState().songLoopIndex).toBe(null);

    useAppStore.getState().setActiveTab('arrange');
    useAppStore.getState().play('sequencer');
    expect(useAppStore.getState().songLoopIndex).toBe(0);
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
    stop();
  });

  test('boundary loop→song while playing hard-stops the players and re-enters from the active loop', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'synth', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');

    // Cross the loop/song boundary: nothing keeps looping across the layer edge.
    useAppStore.getState().setActiveTab('arrange');
    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    // The song cursor is re-established from the active loop, never carried over.
    expect(s.songLoopIndex).toBe(0);
    stop();
  });

  test('boundary song→loop while playing hard-stops the players and drops the cursor', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    expect(clock.count).toBe(1);

    // Crossing out of the song layer hard-stops and drops the cursor (SP3's
    // "detach but keep looping" rule is gone).
    useAppStore.getState().setActiveTab('synth');
    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    expect(s.songLoopIndex).toBe(null);
    expect(clock.count).toBe(0);
    stop();
  });

  test('a solo scope keeps playback isolated and suppresses song advance', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      activeTab: 'arrange',
      songLoopIndex: null,
    });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().soloLoop('loop-default-1');

    // When the scope is solo, songLoopIndex remains null
    expect(useAppStore.getState().songLoopIndex).toBe(null);
    // Ticking past the loop length does not advance to loop B
    clock.tick(64);
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
    stop();
  });

  test('solo, stop, then Play All advances the arrangement — the solo cannot survive', async () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
      activeTab: 'arrange',
      songLoopIndex: null,
    });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    // 2. Play one loop from its card.
    useAppStore.getState().soloLoop('loop-default-1');
    expect(useAppStore.getState().playbackScope).toEqual({
      kind: 'solo',
      loopId: 'loop-default-1',
    });

    useAppStore.getState().hardStopAll();
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'none' });

    // 3. Every later Play All must run the arrangement, with no refresh.
    useAppStore.getState().playAll();
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });
    expect(useAppStore.getState().songLoopIndex).toBe(0);
    clock.tick(64);
    await new Promise((r) => setTimeout(r, 0)); // songMode defers loadLoop to a microtask
    expect(useAppStore.getState().activeLoopId).toBe('loop-b');
    stop();
  });

  // Reported bug: "press Play All, it works. Play one loop from its card.
  // Every Play All after that plays just that loop, solo, until refresh."
  // Runs the user's own three steps in order, against the real reducer and
  // a real (fake) clock, rather than a shortcut that starts mid-sequence.
  test('reported bug repro: Play All, solo a loop from its card, Play All again must resume and advance the song', async () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    const loopC = {
      ...createDefaultLoop(),
      id: 'loop-c',
      name: 'Loop C',
      chords: [{ id: 'c-c', root: 'C', quality: 'maj', bars: 2, notes: ['C4'] }],
    };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB, loopC],
      activeLoopId: 'loop-default-1',
      activeTab: 'arrange',
      songLoopIndex: null,
    });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    // 1. "Refresh the page, press Play All first thing" — works from a clean state.
    useAppStore.getState().playAll();
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });

    // 2. "Play any single loop from its card once" — drive ArrangeView's own
    // handler shape exactly: loadLoop (restarts playback) then soloLoop
    // (which owns the scope AND drops the song cursor in one set()).
    loadLoop('loop-b');
    useAppStore.getState().soloLoop('loop-b');
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'solo', loopId: 'loop-b' });

    // 3. "Every subsequent Play All plays that one loop solo" — must stop
    // happening: the master transport takes over, and the song keeps moving.
    useAppStore.getState().playAll();
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });
    expect(soloLoopId(useAppStore.getState().playbackScope)).toBe(null);

    clock.tick(64); // loop-b is 4 bars x 16 steps, same as the default loop
    await new Promise((r) => setTimeout(r, 0)); // songMode defers loadLoop to a microtask
    const s = useAppStore.getState();
    expect(s.activeLoopId).toBe('loop-c'); // advanced past the loop that was soloing
    expect(s.songLoopIndex).toBe(2);
    stop();
  });
});
