import { describe, expect, test } from 'bun:test';
import { SCALES } from '@/data/scales';
import { harmonyKey, scaleEntry, type ChordQuality } from '@/musicCore';
import { getBorrowedChords, resolveDegreeQuality, rootSemitone } from '@/utils/musicTheory';
import type { ChordItem } from '@/types';
import {
  BORROWED_FACTOR,
  QUALITY_BUCKET,
  QUALITY_BUCKET_WEIGHT,
  ROOT_MOTION_WEIGHT,
  START_FUNCTIONS,
  TONIC_BOOST,
  buildChainStates,
  eligibleStartStates,
  isStableQuality,
  resolveBars,
  transitionWeight,
  type ChainState,
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
