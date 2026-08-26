import { describe, test, expect } from 'bun:test';
import {
  chordStepAction,
  createChordArming,
  resetChordArming,
  type ChordArming,
} from './useChordPlayback';

const BAR = 16;

/** Run the scheduler's decision for a span of steps, applying the same
 *  bookkeeping the clock callback applies when it plays a chord. */
function run(
  state: 'playing' | 'stopping' | 'stopped',
  from: number,
  to: number,
  arming: ChordArming,
  bars = 1,
): number[] {
  const played: number[] = [];
  for (let step = from; step < to; step++) {
    const action = chordStepAction(state, step, arming, BAR);
    if (action !== 'play') continue;
    played.push(step);
    arming.nextBarStep = step + bars * BAR;
    arming.chordIndex++;
  }
  return played;
}

describe('chord scheduler arming', () => {
  test('enters on the next bar line and then plays one chord per bar', () => {
    const arming = createChordArming();
    expect(run('playing', 5, 48, arming)).toEqual([16, 32]);
  });

  test('a stop that is never observed strands the scheduler ahead of a reset clock', () => {
    // Characterisation of the Critical-2 regression. The Instant Vibe swap
    // drives engineSync's play flags through 0, which calls
    // audioEngine.resetClock() and rewinds the shared grid to step 0. If the
    // stop is not observed (React batches it away), nextBarStep still holds
    // an absolute step number from before the swap, so every step of the new
    // vibe is swallowed until the clock counts back up — as long a silence as
    // the user had already been playing.
    const arming = createChordArming();
    run('playing', 0, 48, arming); // ~3 bars of playback
    expect(arming.nextBarStep).toBe(48);
    expect(run('playing', 0, 48, arming)).toEqual([]); // clock reset to 0: silence

    // Observing the stop is what makes the new vibe enter on the very first
    // bar line of the reset grid, from the top of the progression.
    resetChordArming(arming);
    expect(run('playing', 0, 48, arming)).toEqual([0, 16, 32]);
    expect(arming.chordIndex).toBe(3);
  });

  test('resetChordArming rewinds the progression, not just the gate', () => {
    const arming: ChordArming = { armed: true, chordIndex: 7, nextBarStep: 960 };
    resetChordArming(arming);
    expect(arming).toEqual({ armed: false, chordIndex: 0, nextBarStep: 0 });
  });
});

describe('chord scheduler stop timing', () => {
  test('a live "stopped" read silences the rest of the clock tick', () => {
    // Critical-3: one clockTick dispatches several steps synchronously
    // (0.1s lookahead vs a 0.0625s step at 240 BPM). The soft stop fires at
    // step 16 and marks the player stopped, but React has not committed, so
    // the old code re-read a stale 'stopping' from a ref and let a whole new
    // chord through a sixteenth after the cut.
    const arming: ChordArming = { armed: true, chordIndex: 1, nextBarStep: 16 };
    expect(chordStepAction('stopping', 16, arming, BAR)).toBe('soft-stop');
    // stale ref (what the bug read) would have played:
    expect(chordStepAction('stopping', 17, { ...arming }, BAR)).toBe('play');
    // live store read (what the fix reads) stays quiet:
    expect(chordStepAction('stopped', 17, arming, BAR)).toBe('idle');
  });

  test('a stopped player never arms, whatever the step', () => {
    const arming = createChordArming();
    expect(chordStepAction('stopped', 0, arming, BAR)).toBe('idle');
    expect(arming.armed).toBe(false);
  });

  test('a soft stop only lands on a bar line', () => {
    const arming: ChordArming = { armed: true, chordIndex: 1, nextBarStep: 32 };
    expect(chordStepAction('stopping', 20, arming, BAR)).toBe('idle');
    expect(chordStepAction('stopping', 32, arming, BAR)).toBe('soft-stop');
  });
});
