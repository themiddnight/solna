import { describe, test, expect } from 'bun:test';
import {
  sequencerStepAction,
  type SequencerArming,
} from './useSequencerPlayback';

const BAR = 16;

describe('sequencer stepper', () => {
  test('arms on the next bar line, then plays every step', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 7, arming, BAR)).toBe('idle');
    expect(arming.armed).toBe(false);
    expect(sequencerStepAction('playing', 16, arming, BAR)).toBe('play');
    expect(sequencerStepAction('playing', 17, arming, BAR)).toBe('play');
  });

  test('a live "stopped" read silences the rest of the clock tick', () => {
    // Critical-3, drum side: the soft stop fires at the bar line and marks
    // the player stopped from inside the clock callback, but the
    // subscription stays live until React commits and one clockTick
    // dispatches several steps synchronously. Reading a stale 'stopping'
    // from a ref let one extra drum step through after the cut.
    const arming: SequencerArming = { armed: true };
    expect(sequencerStepAction('stopping', 16, arming, BAR)).toBe('soft-stop');
    expect(sequencerStepAction('stopping', 17, arming, BAR)).toBe('play'); // stale ref
    expect(sequencerStepAction('stopped', 17, arming, BAR)).toBe('idle'); // live read
  });

  test('a stopped player never arms', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('stopped', 0, arming, BAR)).toBe('idle');
    expect(arming.armed).toBe(false);
  });
});

const WALTZ_BAR = 12;

describe('sequencer stepper in a non-4/4 meter', () => {
  test('arms on a 12-step bar line, not a 16-step one', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 16, arming, WALTZ_BAR)).toBe('idle');
    expect(arming.armed).toBe(false);
    expect(sequencerStepAction('playing', 24, arming, WALTZ_BAR)).toBe('play');
  });

  test('soft-stops on a 12-step bar line', () => {
    const arming: SequencerArming = { armed: true };
    expect(sequencerStepAction('stopping', 16, arming, WALTZ_BAR)).toBe('play');
    expect(sequencerStepAction('stopping', 24, arming, WALTZ_BAR)).toBe('soft-stop');
  });

  test('an odd 14-step bar still lands every bar line exactly', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 13, arming, 14)).toBe('idle');
    expect(sequencerStepAction('playing', 14, arming, 14)).toBe('play');
    expect(sequencerStepAction('playing', 28, arming, 14)).toBe('play');
  });

  test('the default parameter still means a 16-step bar', () => {
    const arming: SequencerArming = { armed: false };
    expect(sequencerStepAction('playing', 8, arming)).toBe('idle');
    expect(sequencerStepAction('playing', BAR, arming)).toBe('play');
  });
});
