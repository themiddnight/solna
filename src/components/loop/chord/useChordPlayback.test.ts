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
  adaptBassPattern,
  adaptRhythmPattern,
  isFullHoldBass,
  isFullHoldRhythm,
  resolvePlaybackBassPattern,
  resolvePlaybackRhythmPattern,
} from './useChordPlayback';
import { RHYTHM_PATTERNS, type RhythmPattern } from '../../../audio/rhythmPatterns';
import { BASS_PATTERNS, type BassPattern, type BassStepChoice } from '../../../audio/bassPatterns';
import { useAppStore } from '../../../store/store';

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

const FOUR_ON_FLOOR: RhythmPattern = {
  id: 'test-four',
  name: 'Test Four',
  style: 'Test',
  meter: '4/4',
  hits: [
    { step: 0, type: 'block', holdSteps: 4 },
    { step: 4, type: 'block', holdSteps: 4 },
    { step: 8, type: 'block', holdSteps: 4 },
    { step: 12, type: 'block', holdSteps: 4 },
  ],
};

const WALKING: BassPattern = {
  id: 'test-walk',
  name: 'Test Walk',
  style: 'Test',
  meter: '4/4',
  steps: [
    { step: 0, note: 'root', holdSteps: 4 },
    { step: 4, note: 'third', holdSteps: 4 },
    { step: 8, note: 'fifth', holdSteps: 4 },
    { step: 12, note: 'seventh', holdSteps: 4 },
  ],
};

describe('adaptRhythmPattern', () => {
  test('a 4/4 pattern in a 16-step bar is returned untouched, same identity', () => {
    expect(adaptRhythmPattern(FOUR_ON_FLOOR, 16)).toBe(FOUR_ON_FLOOR);
  });

  test('into a 12-step bar it drops the step-12 hit and keeps its id', () => {
    const out = adaptRhythmPattern(FOUR_ON_FLOOR, 12);
    expect(out.id).toBe('test-four');
    expect(out.hits.map((h) => h.step)).toEqual([0, 4, 8]);
  });

  test('a hold is clamped so nothing rings past the bar line', () => {
    const long: RhythmPattern = {
      ...FOUR_ON_FLOOR,
      hits: [{ step: 8, type: 'block', holdSteps: 8 }],
    };
    expect(adaptRhythmPattern(long, 12).hits[0].holdSteps).toBe(4);
  });

  test('into a 20-step bar it loops from step 0', () => {
    const out = adaptRhythmPattern(FOUR_ON_FLOOR, 20);
    expect(out.hits.map((h) => h.step)).toEqual([0, 4, 8, 12, 16]);
  });

  test('a pattern with no declared meter is treated as 4/4', () => {
    const untagged: RhythmPattern = { ...FOUR_ON_FLOOR, meter: undefined };
    expect(adaptRhythmPattern(untagged, 12).hits.map((h) => h.step)).toEqual([0, 4, 8]);
  });
});

describe('adaptBassPattern', () => {
  test('a 4/4 pattern in a 16-step bar is returned untouched, same identity', () => {
    expect(adaptBassPattern(WALKING, 16)).toBe(WALKING);
  });

  test('into a 12-step bar it drops the step-12 note and keeps its id', () => {
    const out = adaptBassPattern(WALKING, 12);
    expect(out.id).toBe('test-walk');
    expect(out.steps.map((s) => s.step)).toEqual([0, 4, 8]);
    expect(out.steps.map((s) => s.note)).toEqual(['root', 'third', 'fifth']);
  });

  test('into a 24-step bar it loops once and a half', () => {
    const out = adaptBassPattern(WALKING, 24);
    expect(out.steps.map((s) => s.step)).toEqual([0, 4, 8, 12, 16, 20]);
    expect(out.steps[4].note).toBe('root');
  });

  test('every surviving note ends at or before the bar line', () => {
    for (const bar of [12, 14, 20, 24]) {
      for (const s of adaptBassPattern(WALKING, bar).steps) {
        expect(s.step + (s.holdSteps ?? 1)).toBeLessThanOrEqual(bar);
      }
    }
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

describe('isFullHoldRhythm / isFullHoldBass measure the hold against the ACTIVE bar', () => {
  const oneHitAt = (holdSteps: number): RhythmPattern => ({
    id: 'probe-rhythm',
    name: 'Probe',
    style: 'Test',
    meter: '4/4',
    hits: [{ step: 0, type: 'block', velocity: 1, holdSteps }],
  });

  const oneStepAt = (holdSteps: number): BassPattern => ({
    id: 'probe-bass',
    name: 'Probe',
    style: 'Test',
    meter: '4/4',
    steps: [{ step: 0, note: 'root', holdSteps }],
  });

  test('a 16-step hold is a full hold in a 16-step bar — the 4/4 behaviour, unchanged', () => {
    expect(isFullHoldRhythm(oneHitAt(16), 16)).toBe(true);
    expect(isFullHoldBass(oneStepAt(16), 16)).toBe(true);
  });

  test('a 16-step hold is NOT a full hold in a 24-step 12/8 bar — it covers two thirds of it', () => {
    expect(isFullHoldRhythm(oneHitAt(16), 24)).toBe(false);
    expect(isFullHoldBass(oneStepAt(16), 24)).toBe(false);
  });

  test('a 12-step hold IS a full hold in a 12-step 3/4 or 6/8 bar', () => {
    expect(isFullHoldRhythm(oneHitAt(12), 12)).toBe(true);
    expect(isFullHoldBass(oneStepAt(12), 12)).toBe(true);
  });

  test('a hold longer than the bar still counts — adaptStepEvents clamps it, this only classifies', () => {
    expect(isFullHoldRhythm(oneHitAt(16), 12)).toBe(true);
    expect(isFullHoldBass(oneStepAt(16), 12)).toBe(true);
  });

  test('the two id short-circuits survive: they are full holds in every meter', () => {
    const sustained = RHYTHM_PATTERNS.find((p) => p.id === 'sustained')!;
    const wholeNote = BASS_PATTERNS.find((p) => p.id === 'whole-note-root')!;
    for (const stepsPerBar of [12, 14, 16, 20, 24]) {
      expect(isFullHoldRhythm(sustained, stepsPerBar)).toBe(true);
      expect(isFullHoldBass(wholeNote, stepsPerBar)).toBe(true);
    }
  });

  test('a multi-hit pattern is never a full hold, whatever its holds are', () => {
    const twoHits: RhythmPattern = {
      id: 'probe-two',
      name: 'Probe Two',
      style: 'Test',
      meter: '4/4',
      hits: [
        { step: 0, type: 'block', velocity: 1, holdSteps: 16 },
        { step: 8, type: 'block', velocity: 1, holdSteps: 16 },
      ],
    };
    expect(isFullHoldRhythm(twoHits, 16)).toBe(false);
  });
});

describe('playback pattern resolution honours the mode', () => {
  test('preset mode resolves the library pattern by id', () => {
    const pattern = resolvePlaybackRhythmPattern('preset', 'offbeatStabs', [true], 16, '4/4');
    expect(pattern.id).toBe('offbeatStabs');
    const bass = resolvePlaybackBassPattern('preset', 'classic-walk', ['root'], 16, '4/4');
    expect(bass.id).toBe('classic-walk');
  });

  test('custom mode synthesizes a grid into a custom pattern', () => {
    const grid = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    const pattern = resolvePlaybackRhythmPattern('custom', 'offbeatStabs', grid, 16, '4/4');
    expect(pattern.id).toBe('custom');
    expect(pattern.hits).toHaveLength(4);
  });

  test('bass custom mode maps choices to steps with no approach tokens', () => {
    const choices: BassStepChoice[] = [
      'root', 'rest', 'third', 'rest', 'fifth', 'rest', 'seventh', 'rest',
      'octave', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest',
    ];
    const pattern = resolvePlaybackBassPattern('custom', 'classic-walk', choices, 16, '4/4');
    expect(pattern.id).toBe('custom');
    expect(pattern.steps.map((s) => s.note)).toEqual(['root', 'third', 'fifth', 'seventh', 'root']);
  });
});

describe('custom patterns flow through the playback pipeline', () => {
  test('a custom rhythm pattern is never a full-hold and adapts to other meters', () => {
    const grid = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    const custom = resolvePlaybackRhythmPattern('custom', 'sustained', grid, 16, '4/4');
    expect(isFullHoldRhythm(custom, 16)).toBe(false);
    const adapted = adaptRhythmPattern(custom, 24);
    expect(adapted.hits.map((h) => h.step)).toEqual([0, 4, 8, 12, 16, 20]);
  });

  test('a custom bass pattern is never a full-hold and is returned unchanged in 4/4', () => {
    const choices: BassStepChoice[] = ['root', ...new Array<BassStepChoice>(15).fill('rest')];
    const custom = resolvePlaybackBassPattern('custom', 'whole-note-root', choices, 16, '4/4');
    expect(isFullHoldBass(custom, 16)).toBe(false);
    expect(adaptBassPattern(custom, 16)).toBe(custom);
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
