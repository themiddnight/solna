import { describe, expect, test } from 'bun:test';
import {
  adaptBassPattern,
  adaptRhythmPattern,
  cycleHoldScale,
  cycleStepAt,
  equalPowerVelocityScale,
  feelToHoldScale,
  fullHoldDuration,
  isFullHoldBass,
  isFullHoldBassCycle,
  isFullHoldRhythm,
  isFullHoldRhythmCycle,
  resolvePlaybackBassCycle,
  resolvePlaybackRhythmCycle,
  type PlaybackPatternCycle,
} from './chordRhythms';
import { CHORD_RHYTHMS, type RhythmPattern } from '@/data/chordRhythms';
import { BASS_PATTERNS, type BassPattern, type BassStepChoice } from '@/data/bassPatterns';
import { getMeter, MAX_STEPS_PER_BAR } from '../utils/timeSignature';
import type { MeterId } from '../utils/timeSignature';

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

describe('cycleStepAt folds an absolute step onto a cycle', () => {
  test('is the identity inside the cycle and wraps at its seam', () => {
    expect(cycleStepAt(0, 32)).toBe(0);
    expect(cycleStepAt(31, 32)).toBe(31);
    expect(cycleStepAt(32, 32)).toBe(0);
    expect(cycleStepAt(52, 32)).toBe(20);
  });

  test('folds a negative step forward instead of reporting a negative column', () => {
    expect(cycleStepAt(-1, 32)).toBe(31);
    expect(cycleStepAt(-33, 32)).toBe(31);
  });

  test('a one-step cycle is always its own start', () => {
    expect(cycleStepAt(7, 1)).toBe(0);
  });
});

describe('cycleHoldScale — Feel moves a drawn span without extending it', () => {
  test('a custom cycle is capped at x1, so Feel can only tighten', () => {
    expect(cycleHoldScale(true, 0.5)).toBe(1);
    expect(cycleHoldScale(true, 0.9)).toBe(1);
    expect(cycleHoldScale(true, 0.9)).toBe(Math.min(1, feelToHoldScale(0.9)));
    expect(cycleHoldScale(true, 0.3)).toBeCloseTo(feelToHoldScale(0.3), 5);
  });

  test('a preset cycle keeps the whole x0.5..x2 Feel range', () => {
    expect(cycleHoldScale(false, 1)).toBeCloseTo(2, 5);
    expect(cycleHoldScale(false, 0)).toBeCloseTo(0.5, 5);
  });
});

/**
 * A custom lane row written the way the store stores it: bar-major at
 * `MAX_STEPS_PER_BAR`, with a parallel hold array. Two bars of it, in every
 * fixture below, so a cycle the active meter cannot reach is expressible.
 */
function booleanRow(): { values: boolean[]; holds: number[] } {
  return {
    values: new Array<boolean>(2 * MAX_STEPS_PER_BAR).fill(false),
    holds: new Array<number>(2 * MAX_STEPS_PER_BAR).fill(1),
  };
}

function bassRow(): { values: BassStepChoice[]; holds: number[] } {
  return {
    values: new Array<BassStepChoice>(2 * MAX_STEPS_PER_BAR).fill('rest'),
    holds: new Array<number>(2 * MAX_STEPS_PER_BAR).fill(1),
  };
}

/** Four one-bar chords in columns — the four boundaries a two-bar cycle folds. */
const ONE_BAR_CHORDS = [16, 16, 16, 16];

describe('resolvePlaybackRhythmCycle', () => {
  test('a preset resolves to one active bar, which is its whole cycle', () => {
    const cycle = resolvePlaybackRhythmCycle('preset', 'offbeatStabs', [], [], 1, 16, '4/4', ONE_BAR_CHORDS);
    expect(cycle.cycleSteps).toBe(16);
    expect(cycle.custom).toBe(false);
    expect(cycle.pattern.id).toBe('offbeatStabs');
  });

  test('a preset is adapted to the active meter, so its one bar is the active bar', () => {
    // waltzOompah is authored 3/4 (hits at 0/4/8) and 12/8 is a 24-step bar:
    // one authored bar plus the loop the adaptation already did, nothing more.
    const cycle = resolvePlaybackRhythmCycle('preset', 'waltzOompah', [], [], 1, 24, '12/8', [24, 24, 24, 24]);
    expect(cycle.cycleSteps).toBe(24);
    expect(cycle.pattern.hits.map((hit) => hit.step)).toEqual([0, 4, 8, 12, 16, 20]);
  });

  test('a preset in its own meter is the library entry itself, untouched', () => {
    const cycle = resolvePlaybackRhythmCycle('preset', 'offbeatStabs', [], [], 1, 16, '4/4', ONE_BAR_CHORDS);
    expect(cycle.pattern).toBe(CHORD_RHYTHMS.find((p) => p.id === 'offbeatStabs')!);
  });

  test('a custom cycle spans every selected bar and copies each onset hold', () => {
    const { values, holds } = booleanRow();
    values[24 + 4] = true; // bar one, column 20 of the cycle
    holds[24 + 4] = 4;

    const cycle = resolvePlaybackRhythmCycle('custom', 'sustained', values, holds, 2, 16, '4/4', ONE_BAR_CHORDS);

    expect(cycle.cycleSteps).toBe(32);
    expect(cycle.custom).toBe(true);
    expect(cycle.pattern.hits).toContainEqual({
      step: 20, type: 'block', velocity: 1, holdSteps: 4,
    });
  });

  test('a hold reaching past the next folded boundary is clamped to it, not copied', () => {
    const { values, holds } = booleanRow();
    values[24 + 4] = true;
    holds[24 + 4] = 20; // 12 steps reach the boundary at column 32

    const cycle = resolvePlaybackRhythmCycle('custom', 'sustained', values, holds, 2, 16, '4/4', ONE_BAR_CHORDS);

    expect(cycle.pattern.hits).toEqual([
      { step: 20, type: 'block', velocity: 1, holdSteps: 12 },
    ]);
  });

  test('a slot the active meter cannot reach stays dormant, and the wider meter brings it back', () => {
    const { values, holds } = booleanRow();
    values[20] = true; // dormant in 4/4 — column 20 is bar one's step 4 there
    holds[20] = 6;

    const narrow = resolvePlaybackRhythmCycle('custom', 'sustained', values, holds, 2, 16, '4/4', ONE_BAR_CHORDS);
    expect(narrow.pattern.hits).toEqual([]);

    const wide = resolvePlaybackRhythmCycle('custom', 'sustained', values, holds, 2, 24, '12/8', [48, 48]);
    expect(wide.cycleSteps).toBe(48);
    expect(wide.pattern.hits).toEqual([
      { step: 20, type: 'block', velocity: 1, holdSteps: 6 },
    ]);
  });
});

describe('resolvePlaybackBassCycle', () => {
  test('a preset bass cycle is one active bar of the library pattern', () => {
    const cycle = resolvePlaybackBassCycle('preset', 'classic-walk', [], [], 1, 16, '4/4', ONE_BAR_CHORDS);
    expect(cycle.cycleSteps).toBe(16);
    expect(cycle.custom).toBe(false);
    expect(cycle.pattern.id).toBe('classic-walk');
  });

  test('retains octave -> root + octaveShift 1 and copies holds across the cycle', () => {
    const { values, holds } = bassRow();
    values[24 + 4] = 'octave';
    holds[24 + 4] = 4;

    const cycle = resolvePlaybackBassCycle('custom', 'whole-note-root', values, holds, 2, 16, '4/4', ONE_BAR_CHORDS);

    expect(cycle.cycleSteps).toBe(32);
    expect(cycle.custom).toBe(true);
    expect(cycle.pattern.steps).toContainEqual({ step: 20, note: 'root', octaveShift: 1, holdSteps: 4 });
  });
});

describe('the whole-chord full-hold fast path is preset-only', () => {
  test('a preset full hold still satisfies the cycle predicate', () => {
    const sustained = CHORD_RHYTHMS.find((p) => p.id === 'sustained')!;
    const cycle: PlaybackPatternCycle<RhythmPattern> = {
      pattern: adaptRhythmPattern(sustained, 16),
      cycleSteps: 16,
      custom: false,
    };
    expect(isFullHoldRhythmCycle(cycle)).toBe(true);
  });

  test('a custom chord onset holding the whole cycle does not — it retriggers at the seam', () => {
    const { values, holds } = booleanRow();
    values[0] = true;
    holds[0] = 16;

    const cycle = resolvePlaybackRhythmCycle('custom', 'sustained', values, holds, 1, 16, '4/4', ONE_BAR_CHORDS);

    // The raw predicate would say yes on a one-bar cycle; the cycle-aware
    // wrapper is what makes a custom span release and retrigger at the seam.
    expect(isFullHoldRhythm(cycle.pattern, cycle.cycleSteps)).toBe(true);
    expect(isFullHoldRhythmCycle(cycle)).toBe(false);
  });

  test('a custom bass note holding the whole cycle does not either', () => {
    const { values, holds } = bassRow();
    values[0] = 'root';
    holds[0] = 16;

    const cycle = resolvePlaybackBassCycle('custom', 'whole-note-root', values, holds, 1, 16, '4/4', ONE_BAR_CHORDS);

    expect(isFullHoldBass(cycle.pattern, cycle.cycleSteps)).toBe(true);
    expect(isFullHoldBassCycle(cycle)).toBe(false);
  });
});
