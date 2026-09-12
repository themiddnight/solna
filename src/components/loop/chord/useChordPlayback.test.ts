import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  activeStepsPerBar,
  chordStepAction,
  createChordArming,
  resetChordArming,
  rewindChordOnClockReset,
  type ChordArming,
} from './useChordPlayback';
import { useAppStore } from '@/store/store';

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
    const arming: ChordArming = { armed: true, chordIndex: 7, nextBarStep: 960, lastStep: 123 };
    resetChordArming(arming);
    expect(arming).toEqual({ armed: false, chordIndex: 0, nextBarStep: 0, lastStep: 0 });
  });

  test('rewindChordOnClockReset rewinds only when the clock steps backwards', () => {
    const arming = createChordArming();
    // Forward steps are just recorded.
    rewindChordOnClockReset(arming, 60);
    rewindChordOnClockReset(arming, 61);
    expect(arming.lastStep).toBe(61);
    expect(arming.armed).toBe(false);

    // A step behind the previous one means resetClock rewound the grid: the
    // absolute nextBarStep must not survive into the new clock.
    arming.armed = true;
    arming.chordIndex = 5;
    arming.nextBarStep = 80;
    rewindChordOnClockReset(arming, 0);
    expect(arming).toEqual({ armed: false, chordIndex: 0, nextBarStep: 0, lastStep: 0 });
  });

  test('a seamless song advance lands on the NEW loop\'s first chord', () => {
    // loadLoop's atBoundary path never stops a player, so the rewind is the
    // ONLY thing that re-arms the progression. Without it chordIndex keeps
    // counting from the outgoing loop and `chordIndex % chords.length` picks a
    // chord in the middle of the incoming one whenever the two loops hold a
    // different number of chords — 4 chords played, 3 in the new loop, 4 % 3 = 1.
    const arming: ChordArming = { armed: true, chordIndex: 4, nextBarStep: 64, lastStep: 63 };

    rewindChordOnClockReset(arming, 0);
    expect(chordStepAction('playing', 0, arming, 16)).toBe('play');
    expect(arming.chordIndex % 3).toBe(0);
  });
});

describe('chord scheduler stop timing', () => {
  test('a live "stopped" read silences the rest of the clock tick', () => {
    // Critical-3: one clockTick dispatches several steps synchronously
    // (0.1s lookahead vs a 0.0625s step at 240 BPM). The soft stop fires at
    // step 16 and marks the player stopped, but React has not committed, so
    // the old code re-read a stale 'stopping' from a ref and let a whole new
    // chord through a sixteenth after the cut.
    const arming: ChordArming = { armed: true, chordIndex: 1, nextBarStep: 16, lastStep: 15 };
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
    const arming: ChordArming = { armed: true, chordIndex: 1, nextBarStep: 32, lastStep: 19 };
    expect(chordStepAction('stopping', 20, arming, BAR)).toBe('idle');
    expect(chordStepAction('stopping', 32, arming, BAR)).toBe('soft-stop');
  });
});

describe('activeStepsPerBar', () => {
  // This function is exported and pure-testable; only the clock callback's
  // use of it (which needs the DOM harness this repo deliberately does not
  // have) is out of reach. Uses the real shared store singleton the way
  // transportSlice.test.ts does.
  test('reflects a live store meterId change, not a value captured at import time', () => {
    const original = useAppStore.getState().meterId;
    try {
      useAppStore.getState().setMeter('4/4');
      expect(activeStepsPerBar()).toBe(16);

      useAppStore.getState().setMeter('6/8');
      expect(activeStepsPerBar()).toBe(12);

      useAppStore.getState().setMeter('12/8');
      expect(activeStepsPerBar()).toBe(24);

      useAppStore.getState().setMeter('7/8');
      expect(activeStepsPerBar()).toBe(14);

      useAppStore.getState().setMeter('4/4');
      expect(activeStepsPerBar()).toBe(16);
    } finally {
      useAppStore.getState().setMeter(original);
    }
  });
});

describe('useChordPlayback shares the one HARD_STOP_RELEASE', () => {
  test('declares no local copy and still uses the shared constant', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/loop/chord/useChordPlayback.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/^const HARD_STOP_RELEASE/m);
    expect(source).toContain('HARD_STOP_RELEASE');
  });
});

describe('useChordPlayback stops only its own voices, not the whole bus', () => {
  test('uses playbackStopOwnedVoices, not the whole-bus playbackStopSource', () => {
    // A whole-bus stop on 'chord'/'bass'/'pad' would cut a keyboard or arp
    // note sharing that bus — the same bug per-voice provenance fixed for
    // lead/FX. This player's own hits carry owner 'sequencer' (chordPlayback.ts),
    // so both its hard-stop and soft-stop paths must go through the
    // owner-scoped wrapper instead of the whole-bus one.
    const source = readFileSync(
      join(process.cwd(), 'src/components/loop/chord/useChordPlayback.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\bplaybackStopSource\(/);
    expect(source.match(/\bplaybackStopOwnedVoices\(/g)?.length).toBe(2);
  });
});
