import { describe, expect, test } from 'bun:test';
import {
  loopPlayButton,
  playbackScopeReducer,
  SCOPE_NONE,
  SCOPE_SONG,
  soloLoopId,
  type PlaybackScope,
  type PlaybackScopeAction,
} from './playbackScope';

const SOLO_A: PlaybackScope = { kind: 'solo', loopId: 'A' };

const PLAY_ALL: PlaybackScopeAction = { type: 'play-all' };
const STOP_ALL: PlaybackScopeAction = { type: 'stop-all' };
const LAYER: PlaybackScopeAction = { type: 'layer-change' };
const TOGGLE_A: PlaybackScopeAction = { type: 'toggle-loop', loopId: 'A' };
const TOGGLE_B: PlaybackScopeAction = { type: 'toggle-loop', loopId: 'B' };

// Every cell of the transition table, as data.
const TABLE: Array<[PlaybackScope, PlaybackScopeAction, PlaybackScope]> = [
  [SCOPE_NONE, PLAY_ALL, { kind: 'song' }],
  [SCOPE_NONE, STOP_ALL, { kind: 'none' }],
  [SCOPE_NONE, TOGGLE_A, { kind: 'solo', loopId: 'A' }],
  [SCOPE_NONE, TOGGLE_B, { kind: 'solo', loopId: 'B' }],
  [SCOPE_NONE, LAYER, { kind: 'none' }],

  [SCOPE_SONG, PLAY_ALL, { kind: 'song' }],
  [SCOPE_SONG, STOP_ALL, { kind: 'none' }],
  [SCOPE_SONG, TOGGLE_A, { kind: 'song' }],
  [SCOPE_SONG, TOGGLE_B, { kind: 'song' }],
  [SCOPE_SONG, LAYER, { kind: 'none' }],

  [SOLO_A, PLAY_ALL, { kind: 'song' }],
  [SOLO_A, STOP_ALL, { kind: 'none' }],
  [SOLO_A, TOGGLE_A, { kind: 'none' }],
  [SOLO_A, TOGGLE_B, { kind: 'solo', loopId: 'A' }],
  [SOLO_A, LAYER, { kind: 'none' }],
];

describe('playbackScopeReducer', () => {
  for (const [from, action, expected] of TABLE) {
    const label = from.kind === 'solo' ? `solo(${from.loopId})` : from.kind;
    const act = action.type === 'toggle-loop' ? `toggle-loop(${action.loopId})` : action.type;
    test(`${label} + ${act} -> ${expected.kind === 'solo' ? `solo(${expected.loopId})` : expected.kind}`, () => {
      expect(playbackScopeReducer(from, action)).toEqual(expected);
    });
  }

  // The bug, stated as an invariant: no action can leave a solo id behind
  // under a song, and none can produce a solo the user did not ask for.
  test('play-all takes over from a solo — a solo id can never survive it', () => {
    expect(playbackScopeReducer(SOLO_A, PLAY_ALL)).toEqual({ kind: 'song' });
    expect(soloLoopId(playbackScopeReducer(SOLO_A, PLAY_ALL))).toBe(null);
  });

  test('no-op transitions return the identical object (songMode compares by ===)', () => {
    expect(playbackScopeReducer(SCOPE_NONE, STOP_ALL)).toBe(SCOPE_NONE);
    expect(playbackScopeReducer(SCOPE_NONE, LAYER)).toBe(SCOPE_NONE);
    expect(playbackScopeReducer(SCOPE_SONG, PLAY_ALL)).toBe(SCOPE_SONG);
    expect(playbackScopeReducer(SOLO_A, TOGGLE_B)).toBe(SOLO_A);
  });
});

describe('loopPlayButton', () => {
  test('unscoped: every card offers Play', () => {
    expect(loopPlayButton(SCOPE_NONE, 'A')).toEqual({ disabled: false });
  });
  test('song scope disables every card button', () => {
    expect(loopPlayButton(SCOPE_SONG, 'A')).toEqual({ disabled: true });
    expect(loopPlayButton(SCOPE_SONG, 'B')).toEqual({ disabled: true });
  });
  test('solo: the soloing card is enabled, the others are disabled', () => {
    expect(loopPlayButton(SOLO_A, 'A')).toEqual({ disabled: false });
    expect(loopPlayButton(SOLO_A, 'B')).toEqual({ disabled: true });
  });
});
