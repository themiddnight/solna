import { describe, expect, test } from 'bun:test';
import { SCALES } from '@/data/scales';
import { mulberry32 } from '@/audio/rng';
import { harmonyKey, scaleEntry, type ChordQuality } from '@/musicCore';
import { getBorrowedChords, resolveDegreeQuality, rootSemitone } from '@/utils/musicTheory';
import type { ChordItem } from '@/types';
import {
  BORROWED_FACTOR,
  CLOSURE_MIN_WEIGHT,
  QUALITY_BUCKET,
  QUALITY_BUCKET_WEIGHT,
  ROOT_MOTION_WEIGHT,
  START_FUNCTIONS,
  TONIC_BOOST,
  buildChainStates,
  eligibleStartStates,
  generateProgression,
  isStableQuality,
  resolveBars,
  transitionWeight,
  type ChainState,
  type ProgressionInput,
  type ProgressionResult,
  type RollBarsPerChord,
  type RollChordCount,
} from './markovProgression';

const SCALE_KEYS = Object.keys(SCALES);

const chord = (root: string, quality: ChordQuality, bars = 1): ChordItem => ({
  id: `${root}-${quality}`,
  root,
  quality,
  bars,
});

const I_V_VI_IV: ChordItem[] = [chord('C', 'maj'), chord('G', 'maj'), chord('A', 'min'), chord('F', 'maj')];

describe('resolveBars', () => {
  test('keep copies each current chord’s bars', () => {
    expect(resolveBars('keep', 4, [chord('C', 'maj', 2), chord('F', 'maj', 1)])).toEqual([2, 1]);
  });

  test('keep on an empty loop rolls four chords of one bar', () => {
    expect(resolveBars('keep', 2, [])).toEqual([1, 1, 1, 1]);
  });

  test('a count gives that many chords of barsPerChord bars', () => {
    const counts: readonly Exclude<RollChordCount, 'keep'>[] = [2, 3, 4, 6, 8];
    const barChoices: readonly RollBarsPerChord[] = [1, 2, 4];
    for (const count of counts) {
      for (const bars of barChoices) {
        expect(resolveBars(count, bars, I_V_VI_IV)).toEqual(new Array<number>(count).fill(bars));
      }
    }
  });
});

describe('buildChainStates', () => {
  test('C Major triads: seven diatonic states, tonic first, numerals from degreeToRoman', () => {
    const states = buildChainStates('C', 'Major', false, false);
    expect(states.map((s) => `${s.roman}:${s.root}${s.quality}:${s.semi}`)).toEqual([
      'I:Cmaj:0', 'ii:Dmin:2', 'iii:Emin:4', 'IV:Fmaj:5', 'V:Gmaj:7', 'vi:Amin:9', 'vii:Bdim:11',
    ]);
    expect(states.every((s) => !s.borrowed)).toBe(true);
    expect(states.map((s) => s.degree)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('borrowed ON with 7ths ON: diatonic states are 7ths, borrowed ones keep the list’s own quality', () => {
    const states = buildChainStates('C', 'Major', true, true);
    const borrowed = states.filter((s) => s.borrowed);
    expect(states.filter((s) => !s.borrowed).map((s) => s.quality)).toEqual([
      'maj7', 'min7', 'min7', 'maj7', '7', 'min7', 'm7b5',
    ]);
    expect(borrowed.map((s) => `${s.roman}:${s.root}${s.quality}:${s.semi}`)).toEqual(
      getBorrowedChords('C', 'Major').map(
        (b) => `${b.label}:${b.root}${b.quality}:${rootSemitone(b.root)}`,
      ),
    );
    expect(borrowed.every((s) => s.degree === null)).toBe(true);
  });

  test('a harmony scale builds on its harmony: Whole Tone rolls Lydian Augmented’s chords', () => {
    expect(buildChainStates('C', 'Whole Tone', false, false)).toEqual(
      buildChainStates('C', 'Lydian Augmented', false, false),
    );
  });

  test('no borrowed state repeats a diatonic root+quality, for every scale and 7ths choice', () => {
    for (const scaleType of SCALE_KEYS) {
      for (const use7ths of [false, true]) {
        const states = buildChainStates('D', scaleType, use7ths, true);
        const keys = states.map((s) => `${s.root}|${s.quality}`);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });
});

describe('eligibleStartStates', () => {
  const romans = (scaleType: string, allowBorrowed: boolean) =>
    eligibleStartStates(buildChainStates('C', scaleType, false, allowBorrowed)).map((s) => s.roman);

  test('C Major: I, IV and V; borrowed adds iv and ♭VII', () => {
    expect(romans('Major', false)).toEqual(['I', 'IV', 'V']);
    expect(romans('Major', true)).toEqual(['I', 'IV', 'iv', 'V', '♭VII']);
  });

  test('a dim tonic is skipped: Locrian starts on iv or ♭vii, never i°', () => {
    expect(romans('Locrian', false)).toEqual(['iv', 'bvii']);
  });

  test('an aug tonic with no stable S, D or subtonic leaves the set empty (the roll starts on the tonic)', () => {
    expect(romans('Lydian Augmented', false)).toEqual([]);
    expect(romans('Whole Tone', false)).toEqual([]);
    expect(romans('Lydian Augmented', true)).toEqual(['iv', '♭VII']);
  });
});

describe('Q mapping', () => {
  test('every quality a degree or a borrowed list can emit lands in its expected bucket', () => {
    const emitted = new Set<ChordQuality>();
    for (const scaleType of SCALE_KEYS) {
      const degrees = scaleEntry(harmonyKey(scaleType)).intervals.length;
      for (let d = 0; d < degrees; d += 1) {
        emitted.add(resolveDegreeQuality(scaleType, d, false));
        emitted.add(resolveDegreeQuality(scaleType, d, true));
      }
      for (const b of getBorrowedChords('C', scaleType)) emitted.add(b.quality);
    }
    const expected: Record<string, 'stable' | 'diminished' | 'augmented'> = {
      maj: 'stable', min: 'stable', maj7: 'stable', min7: 'stable', '7': 'stable', minMaj7: 'stable',
      dim: 'diminished', m7b5: 'diminished', dim7: 'diminished',
      aug: 'augmented', 'maj7#5': 'augmented',
    };
    expect([...emitted].sort()).toEqual(Object.keys(expected).sort());
    for (const quality of emitted) expect(QUALITY_BUCKET[quality]).toBe(expected[quality]);
  });

  test('minMaj7 (a 7ths tonic of Harmonic and Melodic Minor) is stable, not augmented', () => {
    expect(isStableQuality('minMaj7')).toBe(true);
    expect(isStableQuality('aug')).toBe(false);
    expect(isStableQuality('m7b5')).toBe(false);
  });
});

describe('transitionWeight', () => {
  const states = buildChainStates('C', 'Major', false, true);
  const find = (roman: string): ChainState => states.find((s) => s.roman === roman)!;

  test('M × Q × borrowed factor × tonic boost', () => {
    expect(transitionWeight(find('V'), find('I'))).toBeCloseTo(ROOT_MOTION_WEIGHT[5] * TONIC_BOOST);
    expect(transitionWeight(find('I'), find('V'))).toBeCloseTo(ROOT_MOTION_WEIGHT[7]);
    expect(transitionWeight(find('I'), find('vii'))).toBeCloseTo(
      ROOT_MOTION_WEIGHT[11] * QUALITY_BUCKET_WEIGHT.diminished,
    );
    expect(transitionWeight(find('I'), find('♭VII'))).toBeCloseTo(ROOT_MOTION_WEIGHT[10] * BORROWED_FACTOR);
  });

  test('a self-transition and a same-root move weigh 0', () => {
    expect(transitionWeight(find('IV'), find('IV'))).toBe(0);
    expect(transitionWeight(find('IV'), find('iv'))).toBe(0);
  });

  test('start functions are T, S, D and the subtonic, weighted 0.35 / 0.2 / 0.15 / 0.15', () => {
    expect(START_FUNCTIONS).toEqual([
      { semi: 0, weight: 0.35 },
      { semi: 5, weight: 0.2 },
      { semi: 7, weight: 0.15 },
      { semi: 10, weight: 0.15 },
    ]);
  });
});

const LENGTHS = [1, 2, 3, 4, 6, 8] as const;
const SEEDS = [1, 7, 42, 0xd1ce, 0x5eed] as const;
const mod12 = (n: number) => ((n % 12) + 12) % 12;

function input(overrides: Partial<ProgressionInput>): ProgressionInput {
  return {
    scaleRoot: 'C',
    scaleType: 'Major',
    use7ths: false,
    allowBorrowed: false,
    bars: [1, 1, 1, 1],
    current: [],
    ...overrides,
  };
}

/** The state each rolled chord came from; fails the test when a chord is not a state. */
function statesOf(result: ProgressionResult, states: readonly ChainState[]): ChainState[] {
  return result.chords.map((c) => {
    const state = states.find((s) => s.root === c.root && s.quality === c.quality);
    expect(state).toBeDefined();
    return state!;
  });
}

/** Constraints 1–4, re-stated here independently of the generator's own checks. */
function structuralViolations(sequence: readonly ChainState[]): string[] {
  const n = sequence.length;
  const out: string[] = [];
  for (let i = 0; n >= 2 && i < n; i += 1) {
    const next = sequence[(i + 1) % n];
    if (sequence[i].root === next.root && sequence[i].quality === next.quality) out.push(`repeat at ${i}`);
    if (sequence[i].borrowed && next.borrowed) out.push(`adjacent borrowed at ${i}`);
  }
  if (n >= 2 && ROOT_MOTION_WEIGHT[mod12(sequence[0].semi - sequence[n - 1].semi)] < CLOSURE_MIN_WEIGHT) {
    out.push('weak closure');
  }
  if (n >= 3 && !sequence.some((s) => s.degree === 0)) out.push('no tonic');
  if (sequence.filter((s) => s.borrowed).length > Math.ceil(n / 4)) out.push('too many borrowed');
  return out;
}

describe('generateProgression — every scale, 7ths, borrowed, length and seed', () => {
  test('never throws; shape, states, start, borrowed and constraints 1–4 hold', () => {
    const failures: string[] = [];
    for (const scaleType of SCALE_KEYS) {
      for (const use7ths of [false, true]) {
        for (const allowBorrowed of [false, true]) {
          const states = buildChainStates('E', scaleType, use7ths, allowBorrowed);
          const starts = eligibleStartStates(states);
          for (const length of LENGTHS) {
            const bars = Array.from({ length }, (_, i) => (i % 3) + 1);
            for (const seed of SEEDS) {
              const label = `${scaleType} 7ths=${use7ths} borrowed=${allowBorrowed} n=${length} seed=${seed}`;
              const result = generateProgression(
                input({ scaleRoot: 'E', scaleType, use7ths, allowBorrowed, bars, current: [] }),
                mulberry32(seed),
              );
              expect(result.chords.map((c) => c.bars)).toEqual(bars);
              const sequence = statesOf(result, states);
              const first = sequence[0];
              const startOk = starts.length > 0 ? starts.includes(first) : first === states[0];
              if (!startOk) failures.push(`${label}: start ${first.roman}`);
              if (!allowBorrowed && sequence.some((s) => s.borrowed)) failures.push(`${label}: borrowed`);
              for (const v of structuralViolations(sequence)) failures.push(`${label}: ${v}`);
              expect(result.roman).toBe(sequence.map((s) => s.roman).join('–'));
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('generateProgression — scales whose tonic is diminished or augmented', () => {
  const TONIC_EDGE_SCALES = ['Locrian', 'Locrian #2', 'Diminished', 'Lydian Augmented', 'Whole Tone'];

  test('never throws, starts on an eligible chord (or the tonic when none is) and keeps constraints 1–4', () => {
    const failures: string[] = [];
    for (const scaleType of TONIC_EDGE_SCALES) {
      for (const use7ths of [false, true]) {
        for (const allowBorrowed of [false, true]) {
          const states = buildChainStates('C', scaleType, use7ths, allowBorrowed);
          const starts = eligibleStartStates(states);
          for (const length of [3, 4, 6, 8]) {
            for (let seed = 1; seed <= 60; seed += 1) {
              const result = generateProgression(
                input({ scaleType, use7ths, allowBorrowed, bars: new Array<number>(length).fill(1) }),
                mulberry32(seed),
              );
              const sequence = statesOf(result, states);
              const label = `${scaleType} 7ths=${use7ths} borrowed=${allowBorrowed} n=${length} seed=${seed}`;
              const startOk = starts.length > 0 ? starts.includes(sequence[0]) : sequence[0] === states[0];
              if (!startOk) failures.push(`${label}: start ${sequence[0].roman}`);
              for (const v of structuralViolations(sequence)) failures.push(`${label}: ${v}`);
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('generateProgression — differs from the current progression', () => {
  test('a one-chord loop rolled with Keep gives one chord of the same bars, never the current chord', () => {
    const current = [chord('C', 'maj', 2)];
    for (let seed = 1; seed <= 100; seed += 1) {
      const result = generateProgression(
        input({ bars: resolveBars('keep', 1, current), current }),
        mulberry32(seed),
      );
      expect(result.chords).toHaveLength(1);
      expect(result.chords[0].bars).toBe(2);
      expect(`${result.chords[0].root}${result.chords[0].quality}`).not.toBe('Cmaj');
    }
  });

  test('empty bars still roll one chord (never an empty progression)', () => {
    const result = generateProgression(input({ bars: [] }), mulberry32(3));
    expect(result.chords).toHaveLength(1);
    expect(result.chords[0].bars).toBe(1);
  });

  test('chords carry placeholder ids and no bassNote', () => {
    const result = generateProgression(input({}), mulberry32(9));
    expect(result.chords.map((c) => c.id)).toEqual(['roll-0', 'roll-1', 'roll-2', 'roll-3']);
    expect(result.chords.every((c) => !('bassNote' in c))).toBe(true);
  });

  test('the same seed replays the same roll', () => {
    const a = generateProgression(input({ current: I_V_VI_IV }), mulberry32(0xd1ce));
    const b = generateProgression(input({ current: I_V_VI_IV }), mulberry32(0xd1ce));
    expect(a).toEqual(b);
  });
});

describe('generateProgression — statistics (C Major, triads, no borrowed, 4 chords, 500 rolls)', () => {
  // Measured at seed 0xd1ce when these bounds were set: 193 distinct, a
  // tonic-start share of 0.622 and a differ share of 1.0. The bounds leave room
  // for the listening review to retune the weights without editing this test.
  test('varied, mostly tonic-led but not always, and always new', () => {
    const rng = mulberry32(0xd1ce);
    const seen = new Set<string>();
    let tonicStarts = 0;
    let differs = 0;
    for (let i = 0; i < 500; i += 1) {
      const { chords, roman } = generateProgression(input({ current: I_V_VI_IV }), rng);
      seen.add(roman);
      if (chords[0].root === 'C' && chords[0].quality === 'maj') tonicStarts += 1;
      if (chords.some((c, j) => c.root !== I_V_VI_IV[j].root || c.quality !== I_V_VI_IV[j].quality)) differs += 1;
    }
    expect(seen.size).toBeGreaterThanOrEqual(150);
    expect(tonicStarts / 500).toBeGreaterThanOrEqual(0.4);
    expect(tonicStarts / 500).toBeLessThanOrEqual(0.75);
    expect(differs / 500).toBeGreaterThanOrEqual(0.99);
  });
});
