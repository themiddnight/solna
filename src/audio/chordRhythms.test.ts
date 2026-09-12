import { describe, expect, test } from 'bun:test';
import {
  adaptBassPattern,
  adaptRhythmPattern,
  customRhythmPattern,
  equalPowerVelocityScale,
  feelToHoldScale,
  fullHoldDuration,
  isFullHoldBass,
  isFullHoldRhythm,
  resolvePlaybackBassPattern,
  resolvePlaybackRhythmPattern,
} from './chordRhythms';
import { CHORD_RHYTHMS, type RhythmPattern } from '@/data/chordRhythms';
import { BASS_PATTERNS, type BassPattern, type BassStepChoice } from '@/data/bassPatterns';
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

describe('CHORD_RHYTHMS meter tags', () => {
  test('every pattern is present, in order, with the meter it was written in', () => {
    expect(CHORD_RHYTHMS.map((p) => [p.id, p.meter])).toEqual(RHYTHM_METERS);
  });

  test("no hit falls outside its own pattern's bar", () => {
    for (const p of CHORD_RHYTHMS) {
      const bar = getMeter(p.meter).stepsPerBar;
      for (const hit of p.hits) {
        expect(hit.step, `${p.id} hit step`).toBeGreaterThanOrEqual(0);
        expect(hit.step, `${p.id} hit step`).toBeLessThan(bar);
      }
    }
  });

  test('no hold rings past its own bar line', () => {
    for (const p of CHORD_RHYTHMS) {
      const bar = getMeter(p.meter).stepsPerBar;
      for (const hit of p.hits) {
        expect(hit.step + (hit.holdSteps ?? 1), `${p.id} hold at step ${hit.step}`).toBeLessThanOrEqual(bar);
      }
    }
  });

  test('the three 3/4 patterns accent the [4,4,4] beat set, not [6,6]', () => {
    const onsets = (id: string) =>
      CHORD_RHYTHMS.find((p) => p.id === id)!.hits.map((h) => h.step);
    expect(onsets('waltzOompah')).toEqual([0, 4, 8]);
    expect(onsets('waltzArpRoll')).toEqual([0, 4, 8]);
    expect(onsets('jazzWaltzComp')).toEqual([0, 6, 10]);
    // The jazz waltz leans away from beat one; if step 6 were the loudest hit
    // this would read as a 6/8 downbeat instead of a 3/4 anticipation.
    const jazz = CHORD_RHYTHMS.find((p) => p.id === 'jazzWaltzComp')!;
    expect(jazz.hits[0].velocity!).toBeGreaterThan(jazz.hits[1].velocity!);
    expect(jazz.hits[1].velocity!).toBeGreaterThan(jazz.hits[2].velocity!);
  });
});

describe('the 6/8 chord rhythms group in twos, not threes', () => {
  const byId = (id: string) => CHORD_RHYTHMS.find((p) => p.id === id)!;

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

const FOUR_ON_FLOOR_RHYTHM: RhythmPattern = {
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
    expect(adaptRhythmPattern(FOUR_ON_FLOOR_RHYTHM, 16)).toBe(FOUR_ON_FLOOR_RHYTHM);
  });

  test('into a 12-step bar it drops the step-12 hit and keeps its id', () => {
    const out = adaptRhythmPattern(FOUR_ON_FLOOR_RHYTHM, 12);
    expect(out.id).toBe('test-four');
    expect(out.hits.map((h) => h.step)).toEqual([0, 4, 8]);
  });

  test('a hold is clamped so nothing rings past the bar line', () => {
    const long: RhythmPattern = {
      ...FOUR_ON_FLOOR_RHYTHM,
      hits: [{ step: 8, type: 'block', holdSteps: 8 }],
    };
    expect(adaptRhythmPattern(long, 12).hits[0].holdSteps).toBe(4);
  });

  test('into a 20-step bar it loops from step 0', () => {
    const out = adaptRhythmPattern(FOUR_ON_FLOOR_RHYTHM, 20);
    expect(out.hits.map((h) => h.step)).toEqual([0, 4, 8, 12, 16]);
  });

  test('a pattern with no declared meter is treated as 4/4', () => {
    const untagged: RhythmPattern = { ...FOUR_ON_FLOOR_RHYTHM, meter: undefined };
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
    const sustained = CHORD_RHYTHMS.find((p) => p.id === 'sustained')!;
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
