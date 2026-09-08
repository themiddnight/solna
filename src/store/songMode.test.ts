import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { INITIAL_CHORDS } from './initialState';
import { loadLoop } from './loadLoop';
import { createDefaultLoop } from './loopSlice';
import { loopStatePatch } from './loop';
import { scopedLoopId } from './playbackScope';
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
    expect(isSongLayer('master')).toBe(true);
    expect(isSongLayer('sound')).toBe(false);
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
    // Wrapping onto itself would rewind the shared clock every loop; the
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
    tick: (step: number, time = 0) => {
      for (const cb of [...cbs]) cb(step, step, time);
    },
  };
}

const resetState = () => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    ...loopStatePatch(loop),
    activeTab: 'sound',
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

    // playAll(), not play('sequencer'): starting the song is what this models,
    // and only playAll establishes the `song` scope the advance requires.
    useAppStore.getState().playAll();

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

    // The advance is queued from inside the clock dispatch and re-anchors the
    // shared grid on the boundary, so each loop's boundary is measured from 0.
    // First loop is 4 bars x 16 = 64 steps.
    clock.tick(64);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().activeLoopId).toBe('loop-b');
    expect(useAppStore.getState().songLoopIndex).toBe(1);
    // Nothing stops on the seamless path, so no 'stop-all' is dispatched and
    // the scope survives by construction — every card button would re-enable
    // mid-song if it decayed to 'none' here.
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });

    // Second loop is 2 bars x 16 = 32 steps; 64 + 32 = 96 wraps to loop 0.
    clock.tick(96);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
    expect(useAppStore.getState().songLoopIndex).toBe(0);
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });
    stop();
  });

  test('the advance carries the boundary step\'s audio time down to the clock', async () => {
    // The seam is only seamless if the new grid is anchored on the boundary
    // instant. The default anchor is `now + 50ms`, which ignores how far ahead
    // the step was scheduled and lands the downbeat 25-42 ms early
    // (clock.test.ts measures it) — audible as a stumble between loops.
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const resetClock = spyOn(audioEngine, 'resetClock');
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    try {
      useAppStore.getState().playAll();
      resetClock.mockClear();

      clock.tick(64, 12.75);
      await new Promise((r) => setTimeout(r, 0));

      expect(useAppStore.getState().activeLoopId).toBe('loop-b');
      expect(resetClock.mock.calls.at(-1)).toEqual([12.75]);
    } finally {
      resetClock.mockRestore();
      stop();
    }
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
    useAppStore.getState().setActiveTab('sound');
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
    useAppStore.getState().setActiveTab('sound');
    expect(useAppStore.getState().songLoopIndex).toBe(null);

    useAppStore.getState().setActiveTab('arrange');
    // Re-entry is a user pressing Play All again, which is what this always
    // modelled; play('sequencer') sets no scope and no longer enters song mode.
    useAppStore.getState().playAll();
    expect(useAppStore.getState().songLoopIndex).toBe(0);
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
    stop();
  });

  // §6's table, one test per row, asserted on PLAYER STATE — the spec's test
  // obligations require that rather than assertions on the scope alone.
  test('row 1 — loop layer playing loop L, cross to the song layer: continues', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'sound', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    // The Loop layer's master Play is soloLoop(activeLoopId) — see Phase 1.
    useAppStore.getState().soloLoop('loop-default-1');
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');

    useAppStore.getState().setActiveTab('arrange');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.chordsPlayer).toBe('playing');
    expect(s.leadPlayer).toBe('playing');
    // Carried as the solo loop of L: no song cursor, no advance subscription.
    expect(scopedLoopId(s.playbackScope)).toBe('loop-default-1');
    expect(s.songLoopIndex).toBe(null);
    expect(clock.count).toBe(0);
    stop();
  });

  test('row 2 — song layer solo-looping L, open L to edit: continues', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().soloLoop('loop-default-1');
    // Opening the loop that is already auditioning: the card select reloads
    // the same id, which restartAfterStop keeps playing (Task 2).
    loadLoop('loop-default-1');

    useAppStore.getState().setActiveTab('sound');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(scopedLoopId(s.playbackScope)).toBe('loop-default-1');
    stop();
  });

  // Decided by loadLoop.ts's restartAfterStop(layer='song'), not by songMode:
  // the audition stops at the PICK, and the crossing then finds a `none` scope
  // the reducer answers with identity. A composition guard over Tasks 2+5, so
  // no mutation of songMode.ts alone turns it red.
  test('row 3 — song layer solo-looping L, open a DIFFERENT loop to edit: stops', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
    });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().soloLoop('loop-default-1');

    // The clickable path: pick loop B on Arrange, then walk into the editor.
    // The audition stops at the pick (Task 2's song-layer rule) and the
    // crossing then has nothing left to stop.
    loadLoop('loop-b');
    expect(useAppStore.getState().sequencerPlayer).toBe('stopped');

    useAppStore.getState().setActiveTab('sound');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    expect(s.playbackScope).toEqual({ kind: 'none' });
    expect(s.activeLoopId).toBe('loop-b');
    stop();
  });

  test('row 4 — song layer playing the song, open any loop to edit: stops', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    expect(clock.count).toBe(1);

    useAppStore.getState().setActiveTab('sound');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.songLoopIndex).toBe(null);
    expect(s.playbackScope).toEqual({ kind: 'none' });
    expect(clock.count).toBe(0);
    stop();
  });

  // The advance subscription requires a SONG scope, not merely "not a loop".
  // Running the arrangement under `none` would assert the opposite of this
  // phase's premise — that the song may play while nothing owns the transport
  // — and it breaks row 4 in the worst way: focus-loop returns identity on a
  // `none` scope, so crossing to a loop tab would leave every player running
  // with the cursor dropped and the current loop looping forever, unstoppable
  // by any of the four rows above.
  //
  // The state is CONSTRUCTED because production has no path into it: playAll
  // sets `song`, soloLoop sets `loop`, both internal stop-and-restarts go
  // through restartAfterStop, and play(module) — the one starter that sets no
  // scope — is allowlisted to transportSlice.ts alone (the source-scan guard
  // in playbackScope.test.ts).
  test('players running under a none scope on the song layer take no advance subscription', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
    });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });

    useAppStore.setState({ sequencerPlayer: 'playing', playbackScope: { kind: 'none' } });

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.songLoopIndex).toBe(null);
    expect(clock.count).toBe(0);
    // No subscription means no advance: the arrangement does not move.
    clock.tick(64);
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
    stop();
  });

  // The safety net, and the only place focus-loop's mismatch row is exercised
  // directly. Every UI path that moves activeLoopId now carries the scope with
  // it (loadLoop, addLoop, duplicateLoop, deleteLoop), so this state is
  // constructed rather than clicked: it pins what happens if a future writer
  // forgets.
  test('a scope that disagrees with the cursor is stopped on arrival at the loop layer', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
    });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().soloLoop('loop-default-1');

    useAppStore.setState({ activeLoopId: 'loop-b' });
    useAppStore.getState().setActiveTab('sound');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.playbackScope).toEqual({ kind: 'none' });
    stop();
  });

  // Also decided by loadLoop.ts's restartAfterStop (layer='loop', which
  // restarts and re-points the scope). What songMode contributes is the
  // absence of interference: its focus-loop dispatch must not cancel that
  // restart. Same caveat as row 3 — mutating songMode.ts alone leaves it green.
  test('switching the edited loop ON THE LOOP LAYER keeps playing, under the new loop', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB],
      activeLoopId: 'loop-default-1',
    });
    useAppStore.setState({ activeTab: 'sound', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSongModeSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().soloLoop('loop-default-1');

    // The header's loop selector on the loop layer: loadLoop re-points the
    // scope (Task 2), so reconcile's focus-loop dispatch is a no-op and
    // nothing stops.
    loadLoop('loop-b');

    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('playing');
    expect(scopedLoopId(s.playbackScope)).toBe('loop-b');
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
    useAppStore.getState().setActiveTab('sound');
    const s = useAppStore.getState();
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
    expect(s.songLoopIndex).toBe(null);
    expect(clock.count).toBe(0);
    stop();
  });

  test('a solo-loop scope keeps playback isolated and suppresses song advance', () => {
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

    // When the scope is loop, songLoopIndex remains null
    expect(useAppStore.getState().songLoopIndex).toBe(null);
    // Ticking past the loop length does not advance to loop B
    clock.tick(64);
    expect(useAppStore.getState().activeLoopId).toBe('loop-default-1');
    stop();
  });

  test('solo loop, stop, then Play All advances the arrangement — the solo loop cannot survive', async () => {
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
      kind: 'loop',
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
  test('reported bug repro: Play All, solo-loop a loop from its card, Play All again must resume and advance the song', async () => {
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
    //
    // The Stop first is not scaffolding: while `kind === 'song'` loopPlayButton
    // disables EVERY card's play button, so pressing one mid-arrangement is
    // unreachable by clicking, and the user's own steps go Stop -> card Play.
    // Before Phase 3 it happened to "work" anyway, because loadLoop let the
    // song scope decay to `none` — the laundering restartAfterStop closes:
    // loadLoop now keeps a song scope, so soloLoop correctly refuses to take
    // the transport away from a running arrangement.
    useAppStore.getState().hardStopAll();
    loadLoop('loop-b');
    useAppStore.getState().soloLoop('loop-b');
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'loop', loopId: 'loop-b' });

    // 3. "Every subsequent Play All plays that one loop solo" — must stop
    // happening: the master transport takes over, and the song keeps moving.
    useAppStore.getState().playAll();
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });
    expect(scopedLoopId(useAppStore.getState().playbackScope)).toBe(null);

    clock.tick(64); // loop-b is 4 bars x 16 steps, same as the default loop
    await new Promise((r) => setTimeout(r, 0)); // songMode defers loadLoop to a microtask
    const s = useAppStore.getState();
    expect(s.activeLoopId).toBe('loop-c'); // advanced past the loop that was auditioning
    expect(s.songLoopIndex).toBe(2);
    stop();
  });
});
