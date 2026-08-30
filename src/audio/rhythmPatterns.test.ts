import { describe, expect, test } from 'bun:test';
import { RHYTHM_PATTERNS, customRhythmPattern, equalPowerVelocityScale, feelToHoldScale, fullHoldDuration } from './rhythmPatterns';
import { getMeter } from '../utils/meter';
import type { MeterId } from '../utils/meter';

describe('feelToHoldScale', () => {
  test('neutral (0.5) keeps the hold at x1', () => {
    expect(feelToHoldScale(0.5)).toBeCloseTo(1, 5);
  });
  test('tight (0) halves the hold', () => {
    expect(feelToHoldScale(0)).toBeCloseTo(0.5, 5);
  });
  test('loose (1) doubles the hold', () => {
    expect(feelToHoldScale(1)).toBeCloseTo(2, 5);
  });
});

describe('fullHoldDuration', () => {
  test('caps a full-bar hold at the chord length when holdScale > 1', () => {
    // 2 bars × 2 s, holdScale 2 → 8 s unclamped, clamped to the 4 s chord.
    expect(fullHoldDuration(2, 2, 2)).toBeCloseTo(4, 5);
  });
  test('keeps the hold at chord length when holdScale is neutral', () => {
    expect(fullHoldDuration(2, 2, 1)).toBeCloseTo(4, 5);
  });
  test('shortens the hold when holdScale < 1', () => {
    expect(fullHoldDuration(2, 2, 0.5)).toBeCloseTo(2, 5);
  });
});

describe('equalPowerVelocityScale', () => {
  test('a single note keeps its full velocity', () => {
    expect(equalPowerVelocityScale(1)).toBeCloseTo(1, 5);
  });
  test('4 notes scale by 1/√4 = 0.5', () => {
    expect(equalPowerVelocityScale(4)).toBeCloseTo(0.5, 5);
  });
  test('7 notes scale by 1/√7', () => {
    expect(equalPowerVelocityScale(7)).toBeCloseTo(1 / Math.sqrt(7), 5);
  });
  test('zero notes fall back to 1 instead of Infinity', () => {
    expect(equalPowerVelocityScale(0)).toBeCloseTo(1, 5);
  });
});

/**
 * Every shipped pattern id and the meter it is authored in, written out rather
 * than derived, so adding or retagging a pattern is a visible diff here.
 */
const RHYTHM_METERS: [string, MeterId][] = [
  ['sustained', '4/4'],
  ['lofiSwing', '4/4'],
  ['eighthPads', '4/4'],
  ['offbeatStabs', '4/4'],
  ['syncopatedPush', '4/4'],
  ['popBallad8ths', '4/4'],
  ['tripletBallad', '4/4'],
  ['fourOnFloor', '4/4'],
  ['funkSyncopation', '4/4'],
  ['bossaComping', '4/4'],
  ['montunoClave', '4/4'],
  ['offbeatSkank', '4/4'],
  ['arpRollUp', '4/4'],
  ['arpDownEighths', '4/4'],
  ['bassPlusStrum', '4/4'],
  ['waltzOompah', '3/4'],
  ['jazzWaltzComp', '3/4'],
  ['waltzArpRoll', '3/4'],
  ['compoundEighthPads', '6/8'],
  ['afroBellComp', '6/8'],
  ['sixEightBallad', '6/8'],
];

describe('RHYTHM_PATTERNS meter tags', () => {
  test('every pattern is present, in order, with the meter it was written in', () => {
    expect(RHYTHM_PATTERNS.map((p) => [p.id, p.meter])).toEqual(RHYTHM_METERS);
  });

  test("no hit falls outside its own pattern's bar", () => {
    for (const p of RHYTHM_PATTERNS) {
      const bar = getMeter(p.meter).stepsPerBar;
      for (const hit of p.hits) {
        expect(hit.step, `${p.id} hit step`).toBeGreaterThanOrEqual(0);
        expect(hit.step, `${p.id} hit step`).toBeLessThan(bar);
      }
    }
  });

  test('no hold rings past its own bar line', () => {
    for (const p of RHYTHM_PATTERNS) {
      const bar = getMeter(p.meter).stepsPerBar;
      for (const hit of p.hits) {
        expect(hit.step + (hit.holdSteps ?? 1), `${p.id} hold at step ${hit.step}`).toBeLessThanOrEqual(bar);
      }
    }
  });

  test('the three 3/4 patterns accent the [4,4,4] beat set, not [6,6]', () => {
    const onsets = (id: string) =>
      RHYTHM_PATTERNS.find((p) => p.id === id)!.hits.map((h) => h.step);
    expect(onsets('waltzOompah')).toEqual([0, 4, 8]);
    expect(onsets('waltzArpRoll')).toEqual([0, 4, 8]);
    expect(onsets('jazzWaltzComp')).toEqual([0, 6, 10]);
    // The jazz waltz leans away from beat one; if step 6 were the loudest hit
    // this would read as a 6/8 downbeat instead of a 3/4 anticipation.
    const jazz = RHYTHM_PATTERNS.find((p) => p.id === 'jazzWaltzComp')!;
    expect(jazz.hits[0].velocity!).toBeGreaterThan(jazz.hits[1].velocity!);
    expect(jazz.hits[1].velocity!).toBeGreaterThan(jazz.hits[2].velocity!);
  });
});

describe('the 6/8 chord rhythms group in twos, not threes', () => {
  const byId = (id: string) => RHYTHM_PATTERNS.find((p) => p.id === id)!;

  test('compoundEighthPads plays all six eighths but accents only the two beats', () => {
    const p = byId('compoundEighthPads');
    expect(p.hits.map((h) => h.step)).toEqual([0, 2, 4, 6, 8, 10]);
    // The step set alone is meter-blind — 3/4 has the same six eighths. The
    // accents are what make it 6/8: loud at 0 and 6, not at 0, 4 and 8.
    const accented = p.hits.filter((h) => h.velocity! >= 0.85).map((h) => h.step);
    expect(accented).toEqual([0, 6]);
  });

  test('afroBellComp is the one-bar 6/8 bell cell', () => {
    expect(byId('afroBellComp').hits.map((h) => h.step)).toEqual([0, 4, 6, 10]);
  });

  test('sixEightBallad is exactly one held chord per dotted-quarter beat', () => {
    const p = byId('sixEightBallad');
    expect(p.hits.map((h) => h.step)).toEqual([0, 6]);
    expect(p.hits.map((h) => h.holdSteps)).toEqual([6, 6]);
  });

  test('no 6/8 pattern accents the 3/4 beat set, and no 3/4 pattern accents the 6/8 one', () => {
    const strongOnsets = (id: string) =>
      byId(id).hits.filter((h) => (h.velocity ?? 1) >= 0.85).map((h) => h.step);
    for (const id of ['compoundEighthPads', 'afroBellComp', 'sixEightBallad']) {
      expect(strongOnsets(id), id).not.toEqual([0, 4, 8]);
    }
    for (const id of ['waltzOompah', 'waltzArpRoll']) {
      expect(strongOnsets(id), id).not.toEqual([0, 6]);
    }
  });
});

const FOUR_FOUR: MeterId = '4/4';

const FOUR_ON_FLOOR = [
  true, false, false, false,
  true, false, false, false,
  true, false, false, false,
  true, false, false, false,
];

describe('customRhythmPattern — boolean grid to RhythmPattern', () => {
  test('every true step becomes one block hit at that step', () => {
    const pattern = customRhythmPattern(FOUR_ON_FLOOR, 16, FOUR_FOUR);
    expect(pattern.id).toBe('custom');
    expect(pattern.name).toBe('Custom');
    expect(pattern.meter).toBe('4/4');
    expect(pattern.hits).toEqual([
      { step: 0, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 4, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 8, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 12, type: 'block', velocity: 1, holdSteps: 1 },
    ]);
  });

  test('all-false grid yields no hits', () => {
    expect(customRhythmPattern(new Array(16).fill(false), 16, FOUR_FOUR).hits).toEqual([]);
  });

  test('steps at or past stepsPerBar are ignored even if the array is longer', () => {
    const grid = [true, true, true, true, true];
    expect(customRhythmPattern(grid, 4, FOUR_FOUR).hits).toEqual([
      { step: 0, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 1, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 2, type: 'block', velocity: 1, holdSteps: 1 },
      { step: 3, type: 'block', velocity: 1, holdSteps: 1 },
    ]);
  });
});
