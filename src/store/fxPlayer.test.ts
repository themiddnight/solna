import { describe, expect, test, beforeEach } from 'bun:test';
import { useAppStore } from './store';
import {
  NO_PLAYERS_ACTIVE,
  anyPlayerActive,
  captureActivePlayers,
} from './transportSlice';
import { PLAYER_IDS, type StepPlayerId } from '@/components/playbackStep';

describe('StepPlayerId', () => {
  test('is the four clock-driven publishers, fx among them', () => {
    expect([...PLAYER_IDS]).toEqual(['chords', 'lead', 'fx', 'sequencer']);
  });

  test('fx is assignable to StepPlayerId', () => {
    const id: StepPlayerId = 'fx';
    expect(PLAYER_IDS).toContain(id);
  });
});

describe('the fx transport player', () => {
  beforeEach(() => {
    useAppStore.setState({
      sequencerPlayer: 'stopped',
      chordsPlayer: 'stopped',
      leadPlayer: 'stopped',
      fxPlayer: 'stopped',
    });
  });

  test('starts stopped', () => {
    expect(useAppStore.getState().fxPlayer).toBe('stopped');
  });

  test('play("fx") writes fxPlayer, and hardStopAll clears it', () => {
    useAppStore.getState().play('fx');
    expect(useAppStore.getState().fxPlayer).toBe('playing');
    useAppStore.getState().hardStopAll();
    expect(useAppStore.getState().fxPlayer).toBe('stopped');
  });

  /**
   * captureActivePlayers and anyPlayerActive both walk the FIELD record rather
   * than three hand-listed names, which is what makes a fourth module reach
   * capture, restart and the any-active fold in one edit. This asserts the walk
   * really did widen — an OR-fold over a stale roster would keep compiling and
   * silently ignore fx.
   */
  test('an FX-only capture counts as active and names every module', () => {
    useAppStore.setState({ fxPlayer: 'playing' });
    const captured = captureActivePlayers(useAppStore.getState());
    expect(captured).toEqual({ sequencer: false, chords: false, lead: false, fx: true });
    expect(anyPlayerActive(captured)).toBe(true);
    expect(anyPlayerActive(NO_PLAYERS_ACTIVE)).toBe(false);
  });

  test('NO_PLAYERS_ACTIVE names fx', () => {
    expect(NO_PLAYERS_ACTIVE).toEqual({
      sequencer: false,
      chords: false,
      lead: false,
      fx: false,
    });
  });
});
