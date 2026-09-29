import { harmonyKey, scaleEntry, type ChordQuality } from '@/musicCore';
import { getBorrowedChords, getDiatonicChordForDegree, rootSemitone } from '@/utils/musicTheory';
import type { ChordItem } from '@/types';

/**
 * The Roll dice's generator (ADR-0058): a first-order Markov chain over root
 * motion, sampled against five hard constraints with rejection. Pure — no
 * React, no store — and its randomness is the injected `rng` (R361), so a
 * seeded test replays any roll exactly.
 */

/** The options popup's Chords choices; `keep` keeps the current count and each chord's bars. */
export type RollChordCount = 'keep' | 2 | 3 | 4 | 6 | 8;
/** The options popup's Bars per chord choices, read only when the count is not `keep`. */
export type RollBarsPerChord = 1 | 2 | 4;

/**
 * M: root-motion weight by ASCENDING semitone interval, indexed by
 * `(b.semi − a.semi) mod 12`. Index 0 is 0, so a chord never moves to its own
 * root. Starting values; the listening review in CONTRIBUTING.md tunes them.
 */
export const ROOT_MOTION_WEIGHT: readonly number[] = [
  0, 0.3, 0.7, 0.5, 0.4, 1.0, 0.1, 0.6, 0.6, 0.8, 0.6, 0.3,
];

type QualityBucket = 'stable' | 'diminished' | 'augmented';

/** Q, per bucket. */
export const QUALITY_BUCKET_WEIGHT: Readonly<Record<QualityBucket, number>> = {
  stable: 1,
  diminished: 0.25,
  augmented: 0.15,
};

/**
 * Every registry token's Q bucket, keyed on the TOKEN, never on the
 * registry's reharmonization category: category `altered` holds `aug` and
 * also `minMaj7`, the 7ths tonic of Harmonic and Melodic Minor, so weighting
 * by category would suppress a tonic. A `Record` over `ChordQuality` makes a
 * new registry token a compile error here until someone buckets it. The
 * suspended, sixth, added-tone and extension tokens are never emitted by a
 * degree or a borrowed list; they sit in `stable` only so the record is total.
 */
export const QUALITY_BUCKET: Readonly<Record<ChordQuality, QualityBucket>> = {
  maj: 'stable',
  min: 'stable',
  maj7: 'stable',
  min7: 'stable',
  '7': 'stable',
  minMaj7: 'stable',
  dim: 'diminished',
  m7b5: 'diminished',
  dim7: 'diminished',
  aug: 'augmented',
  'maj7#5': 'augmented',
  sus2: 'stable',
  sus4: 'stable',
  '7sus4': 'stable',
  '9': 'stable',
  maj9: 'stable',
  min9: 'stable',
  add9: 'stable',
  '6': 'stable',
  min6: 'stable',
};

/** A borrowed chord's weight factor, in transitions and within a start function. */
export const BORROWED_FACTOR = 0.15;
/** The diatonic tonic's pull as a transition target. */
export const TONIC_BOOST = 1.3;

/** Start functions by root semitone above the tonic: T, S, D, subtonic. */
export const START_FUNCTIONS: readonly { semi: number; weight: number }[] = [
  { semi: 0, weight: 0.35 },
  { semi: 5, weight: 0.2 },
  { semi: 7, weight: 0.15 },
  { semi: 10, weight: 0.15 },
];


/** One Markov state: a chord the roll may choose. */
export interface ChainState {
  root: string;
  quality: ChordQuality;
  /** Root semitone above the tonic, 0..11. */
  semi: number;
  borrowed: boolean;
  /** The diatonic degree index, or null for a borrowed chord. */
  degree: number | null;
  /** `degreeToRoman`'s numeral (via `getDiatonicChordForDegree`), or the borrowed list's `label`. */
  roman: string;
}

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** Is `quality` outside the diminished and augmented buckets? Only such a chord may start a roll. */
export function isStableQuality(quality: ChordQuality): boolean {
  return QUALITY_BUCKET[quality] === 'stable';
}

/**
 * The chain's states: one per degree of the HARMONY scale (R358), each with
 * the degree's own quality as a triad or a 7th; then, when `allowBorrowed`,
 * one per `getBorrowedChords` entry with that list's own quality (the 7ths
 * choice never reaches it), minus any that repeat a diatonic root+quality.
 * Index 0 is always the diatonic tonic.
 */
export function buildChainStates(
  scaleRoot: string,
  scaleType: string,
  use7ths: boolean,
  allowBorrowed: boolean,
): ChainState[] {
  const harmony = scaleEntry(harmonyKey(scaleType));
  const diatonic: ChainState[] = harmony.intervals.map((semi, degree) => {
    const chord = getDiatonicChordForDegree(degree, scaleRoot, scaleType, use7ths);
    return { root: chord.root, quality: chord.quality, semi, borrowed: false, degree, roman: chord.degreeName };
  });
  if (!allowBorrowed) return diatonic;
  const tonic = rootSemitone(scaleRoot);
  const borrowed: ChainState[] = getBorrowedChords(scaleRoot, scaleType)
    .filter((b) => !diatonic.some((d) => d.root === b.root && d.quality === b.quality))
    .map((b) => ({
      root: b.root,
      quality: b.quality,
      semi: mod12(rootSemitone(b.root) - tonic),
      borrowed: true,
      degree: null,
      roman: b.label,
    }));
  return [...diatonic, ...borrowed];
}

/** Q × the borrowed factor: a state's weight inside its start function. */
function startWeight(state: ChainState): number {
  return QUALITY_BUCKET_WEIGHT[QUALITY_BUCKET[state.quality]] * (state.borrowed ? BORROWED_FACTOR : 1);
}

/** `w(a→b)`; 0 for a self-transition. */
export function transitionWeight(a: ChainState, b: ChainState): number {
  if (a === b) return 0;
  const tonicBoost = b.semi === 0 && !b.borrowed ? TONIC_BOOST : 1;
  return ROOT_MOTION_WEIGHT[mod12(b.semi - a.semi)] * startWeight(b) * tonicBoost;
}

/** The start functions that have at least one stable state, each with those states. */
function eligibleStartFunctions(states: readonly ChainState[]): { weight: number; states: ChainState[] }[] {
  return START_FUNCTIONS.map(({ semi, weight }) => ({
    weight,
    states: states.filter((s) => s.semi === semi && isStableQuality(s.quality)),
  })).filter((f) => f.states.length > 0);
}

/**
 * Every state a roll may start on. Empty when no start function is eligible
 * (Lydian Augmented and Whole Tone without borrowed chords), in which case a
 * roll starts on the tonic, `states[0]`.
 */
export function eligibleStartStates(states: readonly ChainState[]): ChainState[] {
  return eligibleStartFunctions(states).flatMap((f) => f.states);
}

/**
 * The bars of each chord to roll. `keep` keeps the current chords' bars
 * (4 × 1 bar for an empty loop); a count gives that many chords of
 * `barsPerChord` bars each.
 */
export function resolveBars(
  chordCount: RollChordCount,
  barsPerChord: RollBarsPerChord,
  current: readonly ChordItem[],
): number[] {
  if (chordCount === 'keep') return current.length > 0 ? current.map((c) => c.bars) : [1, 1, 1, 1];
  return new Array<number>(chordCount).fill(barsPerChord);
}
