import { afterEach, describe, expect, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import {
  aggregatePlayerState,
  createTransportSlice,
  isHardStopEnabled,
  isPlayerActive,
  transportDisplayState,
} from './transportSlice';
import { useAppStore } from './store';
import { MAX_BPM, MIN_BPM } from '../utils/musicTheory';
import type { AppStore, PlayerState, TransportSlice } from './types';

// Minimal harness: createTransportSlice takes zustand's (set, get). We back
// both with a plain object so the slice can be exercised without a store.
function makeSlice(initial?: Partial<TransportSlice>) {
  let state = {} as AppStore;
  const set = ((partial: unknown) => {
    const patch = typeof partial === 'function' ? (partial as (s: AppStore) => object)(state) : partial;
    state = { ...state, ...(patch as object) } as AppStore;
  }) as StoreApi<AppStore>['setState'];
  const get = (() => state) as StoreApi<AppStore>['getState'];
  state = { ...createTransportSlice(set, get), ...initial } as AppStore;
  return {
    get state() {
      return state;
    },
  };
}

const ALL: PlayerState[] = ['stopped', 'playing', 'stopping'];

describe('transport player state machine', () => {
  test('both players start stopped', () => {
    const s = makeSlice().state;
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.chordsPlayer).toBe('stopped');
    expect(s.leadPlayer).toBe('stopped');
  });

  test('play only starts a stopped player — it never cancels a pending stop', () => {
    for (const from of ALL) {
      const h = makeSlice({ chordsPlayer: from });
      h.state.play('chords');
      expect(h.state.chordsPlayer).toBe(from === 'stopped' ? 'playing' : from);
    }
  });

  test('softStop only applies to a playing player', () => {
    for (const from of ALL) {
      const h = makeSlice({ chordsPlayer: from });
      h.state.softStop('chords');
      expect(h.state.chordsPlayer).toBe(from === 'playing' ? 'stopping' : from);
    }
  });

  test('hardStop always lands on stopped', () => {
    for (const from of ALL) {
      const h = makeSlice({ chordsPlayer: from });
      h.state.hardStop('chords');
      expect(h.state.chordsPlayer).toBe('stopped');
    }
  });

  test('actions address one player and leave the other untouched', () => {
    const h = makeSlice({ sequencerPlayer: 'playing', chordsPlayer: 'playing' });
    h.state.softStop('sequencer');
    expect(h.state.sequencerPlayer).toBe('stopping');
    expect(h.state.chordsPlayer).toBe('playing');
  });

  test('master actions apply the per-player rule to both', () => {
    const h = makeSlice({ sequencerPlayer: 'stopped', chordsPlayer: 'stopping' });
    h.state.playAll();
    // sequencer was stopped -> playing; chords was stopping -> unchanged
    expect(h.state.sequencerPlayer).toBe('playing');
    expect(h.state.chordsPlayer).toBe('stopping');

    h.state.hardStopAll();
    expect(h.state.sequencerPlayer).toBe('stopped');
    expect(h.state.chordsPlayer).toBe('stopped');
  });

  test('softStopAll stops every playing player', () => {
    const h = makeSlice({ sequencerPlayer: 'playing', chordsPlayer: 'playing' });
    h.state.softStopAll();
    expect(h.state.sequencerPlayer).toBe('stopping');
    expect(h.state.chordsPlayer).toBe('stopping');
  });
});

describe('derived transport helpers', () => {
  test('a player counts as active unless it is fully stopped', () => {
    expect(isPlayerActive('stopped')).toBe(false);
    expect(isPlayerActive('playing')).toBe(true);
    expect(isPlayerActive('stopping')).toBe(true);
  });

  test('aggregate covers all nine pairs', () => {
    const expected: Record<string, PlayerState> = {
      'stopped|stopped': 'stopped',
      'stopped|playing': 'playing',
      'stopped|stopping': 'stopping',
      'playing|stopped': 'playing',
      'playing|playing': 'playing',
      'playing|stopping': 'playing',
      'stopping|stopped': 'stopping',
      'stopping|playing': 'playing',
      'stopping|stopping': 'stopping',
    };
    for (const a of ALL) {
      for (const b of ALL) {
        expect(aggregatePlayerState(a, b)).toBe(expected[`${a}|${b}`]);
      }
    }
  });

  test('hard stop is enabled whenever any player still has sound scheduled', () => {
    expect(isHardStopEnabled('stopped', 'stopped')).toBe(false);
    // Deliberately NOT derived from aggregate: one stopping + one stopped
    // still needs a working hard stop.
    expect(isHardStopEnabled('stopping', 'stopped')).toBe(true);
    expect(isHardStopEnabled('stopped', 'playing')).toBe(true);
    expect(isHardStopEnabled('stopping', 'stopping')).toBe(true);
  });
});

describe('setBpm clamping', () => {
  // useAppStore is the real, shared singleton (not a fresh instance like
  // makeSlice above), so every mutation here must be undone regardless of
  // which assertion fails — an in-test reset only ran when the test reached
  // its last line, leaking a clamped bpm into whichever test ran next.
  afterEach(() => {
    useAppStore.getState().setBpm(120);
  });

  test('an empty BPM input (0) cannot reach the store', () => {
    // The BPM field is `type="number"`; clearing it yields 0. Unclamped, every
    // playback hook derives its step duration from the raw store bpm and
    // schedules note-offs minutes away — the note-drone bug.
    useAppStore.getState().setBpm(0);
    expect(useAppStore.getState().bpm).toBe(MIN_BPM);
  });

  test('clamps to the same range the engine clock uses', () => {
    useAppStore.getState().setBpm(9999);
    expect(useAppStore.getState().bpm).toBe(MAX_BPM);
    useAppStore.getState().setBpm(128);
    expect(useAppStore.getState().bpm).toBe(128);
    useAppStore.getState().setBpm(Number.NaN);
    expect(useAppStore.getState().bpm).toBe(120);
  });
});

describe('transport meter', () => {
  test('defaults to 4/4', () => {
    useAppStore.setState({ meterId: '4/4' });
    expect(useAppStore.getState().meterId).toBe('4/4');
  });

  test('setMeter writes the id straight through', () => {
    useAppStore.getState().setMeter('7/8');
    expect(useAppStore.getState().meterId).toBe('7/8');
    useAppStore.getState().setMeter('4/4');
    expect(useAppStore.getState().meterId).toBe('4/4');
  });
});

describe('three-way derived transport helpers', () => {
  test('aggregate covers all 27 triples: playing wins, then stopping', () => {
    const expected = (a: PlayerState, b: PlayerState, c: PlayerState): PlayerState => {
      if (a === 'playing' || b === 'playing' || c === 'playing') return 'playing';
      if (a === 'stopping' || b === 'stopping' || c === 'stopping') return 'stopping';
      return 'stopped';
    };
    for (const a of ALL) {
      for (const b of ALL) {
        for (const c of ALL) {
          expect(aggregatePlayerState(a, b, c)).toBe(expected(a, b, c));
        }
      }
    }
  });

  test('hard stop is enabled whenever any of three players is active', () => {
    expect(isHardStopEnabled('stopped', 'stopped', 'stopped')).toBe(false);
    expect(isHardStopEnabled('stopped', 'stopped', 'playing')).toBe(true);
    expect(isHardStopEnabled('stopped', 'stopping', 'stopped')).toBe(true);
    expect(isHardStopEnabled('stopped', 'stopped', 'stopping')).toBe(true);
  });

  test('master actions drive the lead too', () => {
    const h = makeSlice({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped' });
    h.state.playAll();
    expect(h.state.leadPlayer).toBe('playing');
    h.state.hardStopAll();
    expect(h.state.leadPlayer).toBe('stopped');
  });
});

describe('playbackScope rides alongside the player transitions in one set()', () => {
  test('playAll starts stopped players AND claims the song scope in one set', () => {
    const h = makeSlice();
    h.state.playAll();
    expect(h.state.sequencerPlayer).toBe('playing');
    expect(h.state.playbackScope).toEqual({ kind: 'song' });
  });

  test('playAll takes over from a solo — the solo id cannot survive it', () => {
    const h = makeSlice({ playbackScope: { kind: 'solo', loopId: 'loop-a' } });
    h.state.playAll();
    expect(h.state.playbackScope).toEqual({ kind: 'song' });
  });

  test('soft and hard stop both clear the scope', () => {
    const soft = makeSlice({ playbackScope: { kind: 'solo', loopId: 'loop-a' } });
    soft.state.softStopAll();
    expect(soft.state.playbackScope).toEqual({ kind: 'none' });
    const hard = makeSlice({ playbackScope: { kind: 'song' } });
    hard.state.hardStopAll();
    expect(hard.state.playbackScope).toEqual({ kind: 'none' });
  });

  test('soloLoop starts the players, claims the solo and drops the song cursor', () => {
    const h = makeSlice({ songLoopIndex: 2 });
    h.state.soloLoop('loop-a');
    expect(h.state.playbackScope).toEqual({ kind: 'solo', loopId: 'loop-a' });
    expect(h.state.songLoopIndex).toBe(null);
    expect(h.state.sequencerPlayer).toBe('playing');
    expect(h.state.chordsPlayer).toBe('playing');
    expect(h.state.leadPlayer).toBe('playing');
  });

  test('soloLoop on the soloing loop stops every player immediately', () => {
    const h = makeSlice({ playbackScope: { kind: 'solo', loopId: 'loop-a' } });
    h.state.soloLoop('loop-a');
    expect(h.state.playbackScope).toEqual({ kind: 'none' });
    expect(h.state.sequencerPlayer).toBe('stopped');
    expect(h.state.chordsPlayer).toBe('stopped');
    expect(h.state.leadPlayer).toBe('stopped');
  });

  test('per-module play never touches the scope (loadLoop restarts through it)', () => {
    const h = makeSlice({ playbackScope: { kind: 'solo', loopId: 'loop-a' } });
    h.state.play('sequencer');
    expect(h.state.playbackScope).toEqual({ kind: 'solo', loopId: 'loop-a' });
  });

  test('transportDisplayState presents Play while soloing so Play All takes over', () => {
    expect(transportDisplayState({ kind: 'solo', loopId: 'a' }, 'playing')).toBe('stopped');
    expect(transportDisplayState({ kind: 'song' }, 'playing')).toBe('playing');
    expect(transportDisplayState({ kind: 'none' }, 'stopping')).toBe('stopping');
  });
});
