import { describe, expect, test } from 'bun:test';
import { isSoftStopBoundary, shouldHardStopNow } from './playerStop';
import type { PlayerState } from '../store/types';

const ALL: PlayerState[] = ['stopped', 'playing', 'stopping'];

describe('shouldHardStopNow', () => {
  test('fires on any active -> stopped transition', () => {
    expect(shouldHardStopNow('playing', 'stopped', false)).toBe(true);
    expect(shouldHardStopNow('stopping', 'stopped', false)).toBe(true);
  });

  test('does not fire when nothing was playing', () => {
    expect(shouldHardStopNow('stopped', 'stopped', false)).toBe(false);
  });

  test('does not fire on transitions that keep the player active', () => {
    expect(shouldHardStopNow('stopped', 'playing', false)).toBe(false);
    expect(shouldHardStopNow('playing', 'stopping', false)).toBe(false);
  });

  // The soft path also lands on 'stopped'. Without this guard the hard-stop
  // effect would fire a second, immediate stopSource and clip the tail that
  // the soft stop deliberately left ringing.
  test('a pending soft stop suppresses the hard stop', () => {
    expect(shouldHardStopNow('stopping', 'stopped', true)).toBe(false);
    expect(shouldHardStopNow('playing', 'stopped', true)).toBe(false);
  });
});

describe('isSoftStopBoundary', () => {
  test('only a stopping player stops, and only on a bar line', () => {
    expect(isSoftStopBoundary('stopping', 0, 16)).toBe(true);
    expect(isSoftStopBoundary('stopping', 32, 16)).toBe(true);
    expect(isSoftStopBoundary('stopping', 15, 16)).toBe(false);
    expect(isSoftStopBoundary('stopping', 1, 16)).toBe(false);
  });

  test('players that are not stopping never trigger a boundary stop', () => {
    for (const state of ALL.filter((s) => s !== 'stopping')) {
      expect(isSoftStopBoundary(state, 0, 16)).toBe(false);
    }
  });
});
