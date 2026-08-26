import { describe, expect, test } from 'bun:test';
import type { StoreApi } from 'zustand';
import {
  aggregatePlayerState,
  createTransportSlice,
  isHardStopEnabled,
  isPlayerActive,
} from './transportSlice';
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
