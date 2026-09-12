import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { loadLoop } from './loadLoop';
import { createDefaultLoop } from './loopSlice';
import { loopStatePatch } from './loop';
import { scopedLoopId } from './playbackScope';
import { useAppStore } from './store';
import { isSongLayer } from '../types';
import { stepDurationSec } from '../utils/musicTheory';
import { enterSongIndex, startSongModeSync } from './songMode';
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

  test('enterSongIndex resolves the active loop to its list index, defaulting to 0', () => {
    expect(enterSongIndex([{ id: 'a' }, { id: 'b' }], 'b')).toBe(1);
    expect(enterSongIndex([{ id: 'a' }], 'missing')).toBe(0);
  });
});

function makeFakeClock() {
  const cbs: Array<(step: number, beat: number, time: number) => void> = [];
  // Registration IDENTITY, not just the live count: a subscription dropped and
  // re-added inside ONE tick leaves `count` exactly where it was, and that
  // re-registration is the whole hazard — the real engine keeps its listeners
  // in a Set and dispatches them in insertion order, so a re-added listener
  // moves to the back.
  let registrations = 0;
  return {
    get count() {
      return cbs.length;
    },
    get registrations() {
      return registrations;
    },
    get current() {
      return cbs[0] ?? null;
    },
    subscribe: (cb: (step: number, beat: number, time: number) => void) => {
      cbs.push(cb);
      registrations += 1;
      return () => {
        const i = cbs.indexOf(cb);
        if (i >= 0) cbs.splice(i, 1);
      };
    },
    tick: (step: number, time = 0) => {
      // Iterate a copy, but re-check membership before each call. The real
      // engine keeps its listeners in a Set and dispatches with forEach, where
      // a listener unsubscribed by an EARLIER listener in the same dispatch is
      // never called — and the ending path does exactly that (softStopAll
      // re-enters reconcile, which tears the advance subscription down). A
      // plain copy would call it anyway and quietly make the fake more
      // forgiving than the thing it stands in for.
      for (const cb of [...cbs]) {
        if (!cbs.includes(cb)) continue;
        cb(step, step, time);
      }
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
    // ARRANGED, not assumed. Every coordinator test below ticks the fake clock
    // at 16-step bar multiples (32, 64, 96) because songAdvanceDecision reads
    // getMeter(cur.meterId).stepsPerBar LIVE from the store. bun shares one
    // process and one store singleton across test files, and several siblings
    // drive setMeter('12/8') without restoring it — under a 24-step bar not one
    // of those ticks lands on a boundary and seven tests here fail for a reason
    // that has nothing to do with song mode.
    meterId: '4/4',
    sequencerPlayer: 'stopped',
    chordsPlayer: 'stopped',
    leadPlayer: 'stopped',
    songLoopIndex: null,
    playbackScope: { kind: 'none' },
  });
};

beforeEach(resetState);
afterEach(resetState);


/**
 * Tracking for the live coordinators each test below starts. Every one of them
 * ends with its own stop(), which is the readable form — but a FAILING
 * assertion skips it, and a leaked coordinator keeps subscribing to the shared
 * store: its reconcile then hard-stops players, nulls the cursor and steals
 * clock subscriptions inside every later test's setState, in this file and (bun
 * shares the process) in every file after it. One real failure would cascade
 * into a dozen fake ones.
 *
 * Called INSIDE a describe, so its drain afterEach registers on that suite and
 * runs before the module-level afterEach(resetState) navigates the store one
 * last time.
 */
function trackLiveSyncs() {
  const liveSyncs: Array<() => void> = [];
  afterEach(() => {
    // stop() is idempotent (unsubStore is a no-op on a second call, stopClock
    // guards its null), so draining here never conflicts with a test's own.
    while (liveSyncs.length > 0) liveSyncs.pop()?.();
  });
  return {
    startSync: (deps: Parameters<typeof startSongModeSync>[0]) => {
      const stop = startSongModeSync(deps);
      liveSyncs.push(stop);
      return stop;
    },
  };
}


describe('song mode coordinator: entering and advancing', () => {
  const { startSync } = trackLiveSyncs();

  test('entering song mode keeps the active loop and subscribes the clock', () => {
    const loopB = { ...createDefaultLoop(), id: 'loop-b', name: 'Loop B' };
    useAppStore.setState({ loops: [createDefaultLoop(), loopB], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSync({ subscribeClock: clock.subscribe });

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

  test('advances to the next loop at each boundary', async () => {
    const loopB = {
      ...createDefaultLoop(),
      id: 'loop-b',
      name: 'Loop B',
      chords: [{ id: 'c1', root: 'C', quality: 'maj', bars: 2, notes: ['C4'] }],
    };
    const loopC = { ...createDefaultLoop(), id: 'loop-c', name: 'Loop C' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB, loopC],
      activeLoopId: 'loop-default-1',
    });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().playAll();
    expect(useAppStore.getState().songLoopIndex).toBe(0);
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });

    // The advance is queued from inside the clock dispatch and re-anchors the
    // shared grid on the boundary, so each loop's boundary is measured from 0.
    // First loop is 4 bars x 16 = 64 steps; the advance fires on the LAST step.
    clock.tick(63);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().activeLoopId).toBe('loop-b');
    expect(useAppStore.getState().songLoopIndex).toBe(1);
    // Nothing stops on the seamless path, so no 'stop-all' is dispatched and
    // the scope survives by construction — every card button would re-enable
    // mid-song if it decayed to 'none' here.
    expect(useAppStore.getState().playbackScope).toEqual({ kind: 'song' });

    // Second loop is 2 bars x 16 = 32 steps, and each advance re-anchors the
    // grid, so 64 + 32 = 96 is loop B's own boundary; the advance fires one
    // step before it, at 95: on to loop C. It used to wrap to the top here —
    // the arrangement now ENDS instead, which 'the arrangement STOPS at its
    // end instead of wrapping' below owns.
    clock.tick(95);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().activeLoopId).toBe('loop-c');
    expect(useAppStore.getState().songLoopIndex).toBe(2);
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
    const stop = startSync({ subscribeClock: clock.subscribe });
    try {
      useAppStore.getState().playAll();
      resetClock.mockClear();

      // The advance fires one step early and adds one step's duration back to
      // `time` to recover the boundary instant.
      const stepDuration = stepDurationSec(useAppStore.getState().bpm);
      clock.tick(63, 12.75 - stepDuration);
      await new Promise((r) => setTimeout(r, 0));

      expect(useAppStore.getState().activeLoopId).toBe('loop-b');
      expect(resetClock.mock.calls.at(-1)).toEqual([12.75]);
    } finally {
      resetClock.mockRestore();
      stop();
    }
  });

});

describe('song mode coordinator: leaving and re-entering', () => {
  const { startSync } = trackLiveSyncs();

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
    const stop = startSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().playAll();
    clock.tick(63);
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
    const stop = startSync({ subscribeClock: clock.subscribe });
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
    // Three loops, so the advance below lands on a MIDDLE slot: two would put
    // the cursor on the last one, where the song now ends rather than moving.
    const loopC = { ...createDefaultLoop(), id: 'loop-c', name: 'Loop C' };
    useAppStore.setState({
      loops: [createDefaultLoop(), loopB, loopC],
      activeLoopId: 'loop-b',
    });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSync({ subscribeClock: clock.subscribe });
    useAppStore.getState().playAll();
    // Enters at the active loop (index 1), not the top.
    expect(useAppStore.getState().songLoopIndex).toBe(1);
    clock.tick(63);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().activeLoopId).toBe('loop-c');
    expect(useAppStore.getState().songLoopIndex).toBe(2);
    useAppStore.getState().setActiveTab('sound');
    expect(useAppStore.getState().songLoopIndex).toBe(null);

    useAppStore.getState().setActiveTab('arrange');
    // Re-entry is a user pressing Play All again, which is what this always
    // modelled; play('sequencer') sets no scope and no longer enters song mode.
    useAppStore.getState().playAll();
    // At the active loop's index (2), not back at the top.
    expect(useAppStore.getState().songLoopIndex).toBe(2);
    expect(useAppStore.getState().activeLoopId).toBe('loop-c');
    stop();
  });

});

describe('song mode coordinator: the playback-scope rows', () => {
  const { startSync } = trackLiveSyncs();

  // §6's table, one test per row, asserted on PLAYER STATE — the spec's test
  // obligations require that rather than assertions on the scope alone.
  test('row 1 — loop layer playing loop L, cross to the song layer: continues', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'sound', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSync({ subscribeClock: clock.subscribe });
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
    const stop = startSync({ subscribeClock: clock.subscribe });
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
    const stop = startSync({ subscribeClock: clock.subscribe });
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
    const stop = startSync({ subscribeClock: clock.subscribe });
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

});

describe('song mode coordinator: scope and cursor reconciliation', () => {
  const { startSync } = trackLiveSyncs();

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
    const stop = startSync({ subscribeClock: clock.subscribe });

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
    const stop = startSync({ subscribeClock: clock.subscribe });
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
    const stop = startSync({ subscribeClock: clock.subscribe });
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

});

describe('song mode coordinator: solo-loop isolation', () => {
  const { startSync } = trackLiveSyncs();

  test('boundary song→loop while playing hard-stops the players and drops the cursor', () => {
    useAppStore.setState({ loops: [createDefaultLoop()], activeLoopId: 'loop-default-1' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSync({ subscribeClock: clock.subscribe });
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
    const stop = startSync({ subscribeClock: clock.subscribe });
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
    const stop = startSync({ subscribeClock: clock.subscribe });

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
    clock.tick(63);
    await new Promise((r) => setTimeout(r, 0)); // songMode defers loadLoop to a microtask
    expect(useAppStore.getState().activeLoopId).toBe('loop-b');
    stop();
  });

});

describe('song mode coordinator: Play All again, and reaching the end', () => {
  const { startSync } = trackLiveSyncs();

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
    const stop = startSync({ subscribeClock: clock.subscribe });

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

    clock.tick(63); // the advance fires one step before loop-b's boundary
    await new Promise((r) => setTimeout(r, 0)); // songMode defers loadLoop to a microtask
    const s = useAppStore.getState();
    expect(s.activeLoopId).toBe('loop-c'); // advanced past the loop that was auditioning
    expect(s.songLoopIndex).toBe(2);
    stop();
  });

  test('the arrangement STOPS at its end instead of wrapping to the top', async () => {
    const loopA = shortLoop('a', 4); // 64 steps
    const loopB = shortLoop('b', 2); // 32 steps
    useAppStore.setState({ loops: [loopA, loopB], activeLoopId: 'a' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().playAll();
    expect(clock.count).toBe(1);

    // End of loop A: advance to B, still playing. The advance fires one step
    // before the boundary (the `time` here is not asserted).
    clock.tick(63);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().activeLoopId).toBe('b');
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');

    // End of loop B: the song is over.
    clock.tick(32, 9.25);

    const s = useAppStore.getState();
    // A SOFT stop: 'stopping' is the terminal state here because no playback
    // hook is mounted in a store test to carry it to 'stopped' at the bar
    // line. In the app those hooks release with the preset's own release time
    // and then hard-stop themselves.
    expect(s.sequencerPlayer).toBe('stopping');
    expect(s.chordsPlayer).toBe('stopping');
    expect(s.leadPlayer).toBe('stopping');
    // No `song` scope survives the ending, and no advance subscription either.
    expect(s.playbackScope).toEqual({ kind: 'none' });
    expect(s.songLoopIndex).toBe(null);
    expect(clock.count).toBe(0);

    // The cursor is back at the top, so the next Play starts the song there.
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().activeLoopId).toBe('a');
    stop();
  });

});

describe('song mode coordinator: single-loop endings', () => {
  const { startSync } = trackLiveSyncs();

  test('a single-loop arrangement ends too, after its repeats', async () => {
    // Audition play is the feature for "loop one thing forever"; song mode is
    // a piece with an ending, at every arrangement size.
    useAppStore.setState({
      loops: [{ ...shortLoop('a', 2), repeatCount: 2 }], // 2 bars x 2 repeats = 64 steps
      activeLoopId: 'a',
    });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    // The rewind is what asserting on activeLoopId CANNOT see here: the sole
    // loop is also loops[0], so 'a' is the answer whether the ending skipped
    // the rewind or performed one. resetClock is the seamless path's own
    // signature (loadLoop calls it on every atBoundary load and on nothing
    // else), so spying it is what makes "nothing is reloaded" a real claim.
    const resetClock = spyOn(audioEngine, 'resetClock');
    const stop = startSync({ subscribeClock: clock.subscribe });
    try {
      useAppStore.getState().playAll();
      resetClock.mockClear();
      clock.tick(32, 2.0); // end of repeat 1 — keeps going
      expect(useAppStore.getState().sequencerPlayer).toBe('playing');

      clock.tick(64, 4.0); // end of repeat 2 — the song is over
      // Flush the microtask a rewind would have been deferred into.
      await new Promise((r) => setTimeout(r, 0));

      const s = useAppStore.getState();
      expect(s.sequencerPlayer).toBe('stopping');
      expect(s.playbackScope).toEqual({ kind: 'none' });
      expect(clock.count).toBe(0);
      // The sole loop is already the first one, so nothing is reloaded and the
      // cursor is where it was.
      expect(s.activeLoopId).toBe('a');
      expect(resetClock).not.toHaveBeenCalled();
    } finally {
      resetClock.mockRestore();
      stop();
    }
  });

  test('after the song ends, Play starts it again from the top', async () => {
    const loopA = shortLoop('a', 4); // 64 steps
    const loopB = shortLoop('b', 2); // 32 steps
    useAppStore.setState({ loops: [loopA, loopB], activeLoopId: 'a' });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().playAll();
    clock.tick(64, 4.5);
    await new Promise((r) => setTimeout(r, 0));
    clock.tick(32, 9.25);
    await new Promise((r) => setTimeout(r, 0));

    // Stand in for the playback hooks, which are what carry 'stopping' to
    // 'stopped' at the bar line in the app and are not mounted here.
    useAppStore.getState().hardStopAll();

    useAppStore.getState().playAll();

    const s = useAppStore.getState();
    expect(s.songLoopIndex).toBe(0);
    expect(s.activeLoopId).toBe('a');
    expect(s.sequencerPlayer).toBe('playing');
    expect(clock.count).toBe(1);
    stop();
  });

});

describe('song mode coordinator: KNOWN ISSUE — advance-subscription ordering', () => {
  const { startSync } = trackLiveSyncs();

  // The two tests below CHARACTERIZE a known issue rather than pin a decision:
  // they record behaviour that is wrong, so that it stops being invisible. The
  // ending's soft stop has to reach the playback hooks on the boundary step
  // itself, which holds only while songMode's clock listener was registered
  // before theirs (the engine dispatches an insertion-ordered Set). Neither
  // path below preserves that. The audible symptom is NOT simply "one extra
  // bar" for every song — see the KNOWN ISSUE comment on the `end` branch in
  // songMode.ts for why a multi-loop song loses only its drums for that bar
  // (everything else gets retroactively cancelled by the rewind) while a
  // single-loop song, which never rewinds, loses the whole band — but the
  // ORDERING defect both tests pin is the same regardless. See that same
  // comment for the two fixes, both of which are out of this task's reach.
  // WHEN ONE LANDS, THESE TWO TESTS FLIP: each expectation below carries the
  // value it should become.
  test('KNOWN ISSUE: a mid-song loop switch re-registers the advance subscription', () => {
    useAppStore.setState({
      loops: [shortLoop('a', 4), shortLoop('b', 2), shortLoop('c', 2)],
      activeLoopId: 'a',
    });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSync({ subscribeClock: clock.subscribe });

    useAppStore.getState().playAll();
    const first = clock.current;
    expect(clock.registrations).toBe(1);

    // A plain user action: pick a different loop to work on from Arrange while
    // the arrangement runs. loadLoop's default path makes three set()s in one
    // tick — hardStopAll, the content patch, restartPlayersPatch — and
    // restartAfterStop keeps a `song` scope, so the song simply carries on.
    loadLoop('b');

    const s = useAppStore.getState();
    expect(s.playbackScope).toEqual({ kind: 'song' });
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.songLoopIndex).toBe(1);
    // Still exactly one listener, so nothing here is leaked...
    expect(clock.count).toBe(1);
    // ...but it is a NEW registration: the middle "song layer, not playing"
    // state reached reconcile's `else` and dropped the old one. The playback
    // hooks keep theirs through all three set()s (their clock effects are keyed
    // on isPlaying and the rendered state goes 'playing' -> 'playing'), so in
    // the app songMode's callback now runs after all three.
    expect(clock.registrations).toBe(2); // must become 1
    expect(clock.current).not.toBe(first); // must become toBe(first)
    stop();
  });

  test('KNOWN ISSUE: the takeover subscribes the advance after the players are already running', () => {
    useAppStore.setState({
      loops: [shortLoop('a', 4), shortLoop('b', 2)],
      activeLoopId: 'a',
    });
    useAppStore.setState({ activeTab: 'arrange', songLoopIndex: null });
    const clock = makeFakeClock();
    const stop = startSync({ subscribeClock: clock.subscribe });

    // Audition loop A from its card on Arrange (or arrive from the Loop layer
    // still playing it — spec §6 row 1). The players run under a `loop` scope,
    // which takes no advance subscription...
    useAppStore.getState().soloLoop('a');
    expect(useAppStore.getState().sequencerPlayer).toBe('playing');
    expect(clock.count).toBe(0);

    // Stand in for a playback hook's own clock effect: it subscribes the
    // moment the player it watches goes to 'playing', which just happened
    // above, so a mounted hook in the app already holds this listener by now.
    const hookStub = () => {};
    clock.subscribe(hookStub);

    // ...and then the master Play's one-click takeover. playAll only lifts
    // 'stopped' players, so NO player transitions here: React never re-runs the
    // hooks' clock effects, their listeners stay exactly where they were, and
    // this — songMode's FIRST registration — lands behind them. This path
    // predates the ending; the `else` in reconcile has nothing to do with it,
    // which is why fixing that alone would not be a fix.
    useAppStore.getState().playAll();

    const s = useAppStore.getState();
    expect(s.playbackScope).toEqual({ kind: 'song' });
    expect(s.sequencerPlayer).toBe('playing');
    expect(s.songLoopIndex).toBe(0);
    expect(clock.count).toBe(2);
    expect(clock.registrations).toBe(2);
    // The defect's mechanism, not just a healthy value: `current` is the
    // FIRST still-subscribed listener (subscribe only ever appends), so it
    // staying the hook stand-in — rather than becoming songMode's own
    // callback — is what "lands behind them" above means concretely. Must
    // become something other than hookStub once a fix lands.
    expect(clock.current).toBe(hookStub);
    stop();
  });

});

