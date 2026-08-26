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
