import { describe, expect, test } from 'bun:test';
import {
  loopBars,
  loopDwellSteps,
  loopLengthSteps,
  SONG_END,
  SONG_HOLD,
  songAdvanceDecision,
  type StructuralLoop,
} from './songStructure';

/** One chord per entry, `bars` wide. The fixture the old store tests built with
 *  `createDefaultLoop()` reduced to the fields this module actually reads. */
function structLoop(id: string, bars: number, repeatCount?: number): StructuralLoop {
  return { id, chords: [{ bars }], repeatCount };
}

describe('loopBars', () => {
  test('sums chord bars with a 1-bar default for bar-less chords', () => {
    expect(loopBars([])).toBe(0);
    expect(loopBars([{ bars: 2 }, { bars: 1 }, { bars: 4 }])).toBe(7);
    expect(loopBars([{ bars: 0 }])).toBe(1);
    expect(loopBars([{ bars: undefined }])).toBe(1);
  });
});

describe('loopLengthSteps', () => {
  test('multiplies bars by stepsPerBar', () => {
    expect(loopLengthSteps([{ bars: 2 }, { bars: 1 }], 16)).toBe(48);
    expect(loopLengthSteps([{ bars: 0 }], 16)).toBe(16);
    expect(loopLengthSteps([], 16)).toBe(0);
    expect(loopLengthSteps([{ bars: 2 }], 12)).toBe(24);
  });
});

describe('loopDwellSteps', () => {
  test('is the pass length when repeatCount is absent, 0 or 1', () => {
    expect(loopDwellSteps(structLoop('a', 4), 16)).toBe(64);
    expect(loopDwellSteps(structLoop('a', 4, 0), 16)).toBe(64);
    expect(loopDwellSteps(structLoop('a', 4, 1), 16)).toBe(64);
  });

  test('multiplies the pass length by repeatCount', () => {
    expect(loopDwellSteps(structLoop('a', 2, 3), 16)).toBe(96);
    expect(loopDwellSteps(structLoop('a', 1, 2), 16)).toBe(32);
    expect(loopDwellSteps({ id: 'a', chords: [{ bars: 1 }, { bars: 1 }], repeatCount: 2 }, 16)).toBe(64);
  });

  test('dwells a chordless loop one bar, not zero', () => {
    // The obvious simplification — loopLengthSteps x repeatCount — is wrong
    // here: loopLengthSteps is 0, so the renderer would schedule nothing and
    // the live arrangement would freeze. The app dwells it one bar.
    const empty: StructuralLoop = { id: 'empty', chords: [] };
    expect(loopDwellSteps(empty, 16)).toBe(16);
    expect(loopDwellSteps({ ...empty, repeatCount: 3 }, 16)).toBe(48);
    expect(loopDwellSteps({ id: 'z', chords: [{ bars: 0 }] }, 16)).toBe(16);
    expect(loopDwellSteps(empty, 24)).toBe(24);
  });

  test('floors a malformed repeatCount at one pass', () => {
    expect(loopDwellSteps(structLoop('a', 1, -2), 16)).toBe(16);
    expect(loopDwellSteps(structLoop('a', 1, 0.5), 16)).toBe(16);
  });
});

describe('songAdvanceDecision', () => {
  test('advances exactly on the boundary and holds everywhere else', () => {
    const loops = [structLoop('a', 4), structLoop('b', 2), structLoop('c', 1)];
    expect(songAdvanceDecision(loops, 0, 63, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision(loops, 0, 64, 16)).toEqual({ kind: 'advance', loopId: 'b' });
    expect(songAdvanceDecision(loops, 1, 31, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision(loops, 1, 32, 16)).toEqual({ kind: 'advance', loopId: 'c' });
  });

  test('ENDS the song after the last loop instead of wrapping', () => {
    const loops = [structLoop('a', 4), structLoop('b', 2)];
    expect(songAdvanceDecision(loops, 1, 32, 16)).toBe(SONG_END);
    expect(songAdvanceDecision(loops, 1, 31, 16)).toBe(SONG_HOLD);
  });

  test('ends a SINGLE-loop arrangement too', () => {
    expect(songAdvanceDecision([structLoop('a', 4)], 0, 64, 16)).toBe(SONG_END);
  });

  test('multiplies loop length by repeatCount before deciding', () => {
    const loops = [
      { ...structLoop('a', 2), repeatCount: 3 },
      { ...structLoop('b', 1), repeatCount: 2 },
    ];
    expect(songAdvanceDecision(loops, 0, 32, 16)).toBe(SONG_HOLD); // after rep 1
    expect(songAdvanceDecision(loops, 0, 64, 16)).toBe(SONG_HOLD); // after rep 2
    expect(songAdvanceDecision(loops, 0, 95, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision(loops, 0, 96, 16)).toEqual({ kind: 'advance', loopId: 'b' });
    expect(songAdvanceDecision(loops, 1, 16, 16)).toBe(SONG_HOLD); // after rep 1
    expect(songAdvanceDecision(loops, 1, 32, 16)).toBe(SONG_END); // after rep 2
  });

  test('holds on step 0, in loop mode and on an out-of-range cursor', () => {
    const loops = [structLoop('a', 4)];
    expect(songAdvanceDecision(loops, null, 64, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision(loops, 0, 0, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision(loops, 99, 64, 16)).toBe(SONG_HOLD);
    expect(songAdvanceDecision([], 0, 64, 16)).toBe(SONG_HOLD);
  });

  test('dwells an empty loop one bar then advances', () => {
    const loops = [{ id: 'empty', chords: [] } as StructuralLoop, structLoop('b', 1)];
    expect(songAdvanceDecision(loops, 0, 0, 16)).toBe(SONG_HOLD); // step 0
    expect(songAdvanceDecision(loops, 0, 15, 16)).toBe(SONG_HOLD); // mid-bar
    expect(songAdvanceDecision(loops, 0, 16, 16)).toEqual({ kind: 'advance', loopId: 'b' });
  });
});

describe('the dwell rule and the boundary rule agree', () => {
  /** The one test that stops the renderer's length rule and the arrangement's
   *  boundary rule from drifting: for every shape, the step `songAdvanceDecision`
   *  calls the boundary must be exactly `loopDwellSteps`. */
  const shapes: Array<[string, StructuralLoop]> = [
    ['4 bars, one pass', { id: 'a', chords: [{ bars: 4 }] }],
    ['4 bars, three passes', { id: 'a', chords: [{ bars: 4 }], repeatCount: 3 }],
    ['2+2 bars, two passes', { id: 'a', chords: [{ bars: 2 }, { bars: 2 }], repeatCount: 2 }],
    ['no chords', { id: 'a', chords: [] }],
    ['no chords, two passes', { id: 'a', chords: [], repeatCount: 2 }],
    ['a zero-bar chord', { id: 'a', chords: [{ bars: 0 }] }],
  ];

  for (const [name, loop] of shapes) {
    test(name, () => {
      const stepsPerBar = 16;
      const dwell = loopDwellSteps(loop, stepsPerBar);
      const loops = [loop, structLoop('next', 1)];
      expect(songAdvanceDecision(loops, 0, dwell, stepsPerBar)).toEqual({
        kind: 'advance',
        loopId: 'next',
      });
      expect(songAdvanceDecision(loops, 0, dwell - 1, stepsPerBar)).toBe(SONG_HOLD);
    });
  }
});
