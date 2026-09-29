# Markov Chord Dice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Roll split button in the Chord progression card that replaces the active loop's progression with a constrained first-order Markov roll in the loop's key and scale, with a single-level Undo.

**Architecture:** A pure generator (`loop/chord/markovProgression.ts`: states from the harmony scale plus optional borrowed chords, root-motion transition weights, rejection sampling against five loop constraints, injected `rng`) feeds a colocated hook (`loop/chord/useProgressionDice.ts`: options state, `planRoll` / `performRoll`, the Undo offer through the lifted `useLoopUndo`). The roll writes through the library-apply path (`setChords` with fresh ids, then `clearReharmonizeBadge()`); Undo restores a `ChordsSnapshot` through a new `restoreChordsSnapshot` action in `chordsSlice`. The UI is a daisyUI `join` split button whose caret opens a `ui/Popup`.

**Tech Stack:** Bun (test runner, scripts), Vite + React, TypeScript, zustand, daisyUI v5 + Tailwind, lucide-react icons.

**Spec:** docs/superpowers/specs/2026-09-29-markov-chord-dice-design.md

## Global Constraints

- Branch `feat/markov-chord-progression`; one commit per task, never push, never commit to `main`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests are `bun:test` only. No DOM and no testing-library (`.claude/rules/testing.md`); render tests use `renderToString`, and a plain `useAppStore` selector under `renderToString` serves creation-time state (R257).
- A test that writes shared store state resets it in `beforeEach` and `afterEach` (R356); a test that raises a snackbar dismisses it.
- ESLint: 0 errors, 0 warnings (R005, R264). `max-lines-per-function` is 100 **including test `describe` callbacks**, `max-lines` 750, `complexity` 20 (a warning is a failure here). No `../../` imports; use `@/`.
- `src/components/` never imports `@/audio/engine` (R038); `@/audio/rng` (`mulberry32`) is allowed in tests.
- Chord-side code reads `scaleEntry(harmonyKey(scaleType))` (R358); every generated root is `ROOTS`-spelled (R064).
- Knip: `bun run check:dead-code` is clean after every task. `bun run check:dead-code:production` (the file graph) is clean from Task 6 on: Tasks 1, 2 and 5 add files that only their tests import until Task 6 wires them into `ChordView`.
- ADR and rules text carries no version numbers, file counts or live line numbers (CLAUDE.md, R001). This plan may cite line ranges.
- Every warning seen (build, tsc, ESLint, tests, browser console) is fixed or suppressed at the narrowest scope with a reason, and named in the task's summary.
- daisyUI v5 classes only; every class used below was checked against the v5 docs (`join`, `join-item`, `btn`, `btn-xs`, `btn-sm`, `btn-soft`, `btn-secondary`, `btn-primary`, `btn-ghost`, `btn-active`, `toggle`, `toggle-sm`, `toggle-secondary`, `fieldset`, `fieldset-legend`, `label`, `dropdown*` via `ui/Popup`). Re-check any class you add that is not on this list.
- Fixed ids and copy: `#btn-roll-progression` (`aria-label="Roll progression"`, visible "Roll" from `sm`), `#btn-roll-progression-options` (`aria-haspopup="dialog"`, `aria-expanded`), `#btn-roll-progression-apply`, `#chk-roll-borrowed`, `btn-roll-chords-<keep|2|3|4|6|8>`, `btn-roll-bars-<1|2|4>`, Undo key and button id `btn-undo-roll-progression`, snackbar message `Rolled <roman>`, ADR `0058`, rules `R361`–`R363`.
- Weights, verbatim from the spec: M by ascending interval 0→0, 1→0.3, 2→0.7, 3→0.5, 4→0.4, 5→1.0, 6→0.1, 7→0.6, 8→0.6, 9→0.8, 10→0.6, 11→0.3; Q 1.0 stable / 0.25 diminished / 0.15 augmented; borrowed factor 0.15; diatonic tonic boost 1.3; start T(0)=0.35, S(5)=0.2, D(7)=0.15, subtonic(10)=0.15; closure `M ≥ 0.4`.

### Deviations from the spec (each argued in its task)

1. **Attempt budget 500, not 50** (Task 2). Measured over 2 000 rolls per configuration with the code below, 50 attempts left 5.7–6.5% of Lydian Augmented / Whole Tone rolls with Borrowed on (3–4 chords) failing the tonic or closure constraint, and ~1% of Locrian 3-chord rolls; 500 left none. A roll costs well under a millisecond either way.
2. **Undo guard extended** (Task 3, requested addition): `ChordsSnapshot` also carries `scaleRoot`, `scaleType` and `meterId`, and `restoreChordsSnapshot` writes only when all four guards match.
3. **Aug-tonic start** (Task 1/2): the spec says S/D/subtonic cover Lydian Augmented and Whole Tone. They do not with Borrowed off (no stable chord at semitone 5, 7 or 10), so those rolls always take the spec's own gap-fill, "start on the tonic". The tests pin that behaviour instead of the spec's claim.
4. **Q is a total `Record<ChordQuality, QualityBucket>`** (Task 1): a compile-time totality over every registry token, not only a test over emitted qualities. Tokens never emitted (sus, sixth, add9, extensions) sit in `stable` so the record is total.
5. **UI in its own file** `loop/chord/RollProgressionButton.tsx` (Task 6), rendered from `ProgressionActions`, so the popup body renders from plain props in a test without the R257 trap. The Chords / Bars option lists live there, not in the generator.
6. **R281 amended** (Task 7) to list "a progression roll" among the badge-clearing writers, since a roll clears the badge (R362).
7. **Architecture doc paths** (Task 4): `docs/architecture/structure/01-ui.md` names `song/useLoopUndo.ts` three times; the move updates them.

## Review Focus

1. **Undo after the key, scale or meter changed** — a user rolls, then changes key (or scale type, or meter) and presses Undo within the snackbar window: nothing is put back, rather than old-key chords landing in the new key or holds clamped for another bar length (addition to the spec; Task 3 store test, Task 5 end-to-end test).
2. **Two rolls in a row, then Undo** — Undo restores the progression before the SECOND roll, and only one Undo snackbar is pending (Task 5).
3. **One-chord loop, Chords = Keep** — the roll gives one chord with the same bars that differs from the current chord (Task 2).
4. **Scales whose tonic is diminished or augmented** (Locrian, Locrian #2, Diminished, Lydian Augmented, Whole Tone) — a roll never throws, starts on an eligible chord (or on the tonic when the scale has none), and still holds the tonic and closure constraints (Task 2).
5. **Empty loop, Chords = Keep** — the roll produces four chords of one bar (Task 1 `resolveBars`, Task 5 `planRoll`).

Also pinned, outside the five: Borrowed on with 7ths on keeps the borrowed list's own quality (Task 1).

---

### Task 1: Markov states, weights and `resolveBars`

**Files:**
- Create: `src/components/loop/chord/markovProgression.ts`
- Test: `src/components/loop/chord/markovProgression.test.ts`

**Interfaces:**
- Consumes: `harmonyKey`, `scaleEntry`, `type ChordQuality` from `@/musicCore`; `getBorrowedChords(root: string, scaleType: string): BorrowedChord[]`, `getDiatonicChordForDegree(degreeIndex: number, root: string, scaleType: string, use7ths?: boolean): { root: string; quality: ChordQuality; degreeName: string }`, `rootSemitone(root: string): number` from `@/utils/musicTheory`; `type ChordItem` from `@/types`.
- Produces:
  - `type RollChordCount = 'keep' | 2 | 3 | 4 | 6 | 8`; `type RollBarsPerChord = 1 | 2 | 4`
  - `ROOT_MOTION_WEIGHT: readonly number[]`, `QUALITY_BUCKET_WEIGHT: Readonly<Record<QualityBucket, number>>`, `QUALITY_BUCKET: Readonly<Record<ChordQuality, QualityBucket>>`, `BORROWED_FACTOR = 0.15`, `TONIC_BOOST = 1.3`, `START_FUNCTIONS: readonly { semi: number; weight: number }[]`
  - `interface ChainState { root: string; quality: ChordQuality; semi: number; borrowed: boolean; degree: number | null; roman: string }`
  - `isStableQuality(quality: ChordQuality): boolean`
  - `buildChainStates(scaleRoot: string, scaleType: string, use7ths: boolean, allowBorrowed: boolean): ChainState[]` (index 0 is always the diatonic tonic)
  - `transitionWeight(a: ChainState, b: ChainState): number`
  - `eligibleStartStates(states: readonly ChainState[]): ChainState[]`
  - `resolveBars(chordCount: RollChordCount, barsPerChord: RollBarsPerChord, current: readonly ChordItem[]): number[]`

- [ ] **Step 1: Write the failing test**

Create `src/components/loop/chord/markovProgression.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/loop/chord/markovProgression.test.ts`
Expected: FAIL — `Cannot find module './markovProgression'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/loop/chord/markovProgression.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/loop/chord/markovProgression.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Type-check, lint, dead-code**

Run: `bun run lint && bunx eslint src/components/loop/chord/markovProgression.ts src/components/loop/chord/markovProgression.test.ts && bun run check:dead-code`
Expected: no output from tsc, ESLint and Knip (0 errors, 0 warnings).

- [ ] **Step 6: Commit**

```bash
git add src/components/loop/chord/markovProgression.ts src/components/loop/chord/markovProgression.test.ts
git commit -m "feat(chord): add the Markov progression states and weights" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `generateProgression` — start draw, chain walk, constraints, fallback

**Files:**
- Modify: `src/components/loop/chord/markovProgression.ts` (append after `resolveBars`)
- Test: `src/components/loop/chord/markovProgression.test.ts` (replace the import block, append helpers and four `describe`s)

**Interfaces:**
- Consumes: everything Task 1 produces; `mulberry32(seed: number): () => number` from `@/audio/rng` (tests only).
- Produces:
  - `CLOSURE_MIN_WEIGHT = 0.4`
  - `interface ProgressionInput { scaleRoot: string; scaleType: string; use7ths: boolean; allowBorrowed: boolean; bars: readonly number[]; current: readonly ChordItem[] }`
  - `interface ProgressionResult { chords: ChordItem[]; roman: string }` — chords carry ids `roll-<i>` and no `bassNote`; `roman` joins the numerals with `–` (en dash).
  - `generateProgression(input: ProgressionInput, rng: () => number): ProgressionResult` — never throws, never empty (empty `bars` → one chord of one bar).

Why 500 attempts (deviation 1): the exhaustive test below fails with 50 — at seed `0xd1ce`, Lydian Augmented and Whole Tone with Borrowed on and six chords break both the tonic and the closure constraint. Measured over 2 000 rolls per configuration: at 50 attempts, up to 6.5% of those rolls broke a constraint; at 500, none did.

- [ ] **Step 1: Write the failing tests**

In `src/components/loop/chord/markovProgression.test.ts`, replace the whole import block (from the first `import` through `} from './markovProgression';`) with:

```ts
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
```

Then append to the end of the file:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/loop/chord/markovProgression.test.ts`
Expected: FAIL — an import error naming a missing export (`generateProgression` or `CLOSURE_MIN_WEIGHT`).

- [ ] **Step 3: Write the implementation**

Append to the end of `src/components/loop/chord/markovProgression.ts`:

```ts
/** Rejection-sampling budget per roll. */
const MAX_ROLL_ATTEMPTS = 500;
/** Constraint 2: the last→first motion must weigh at least this much in M. */
export const CLOSURE_MIN_WEIGHT = 0.4;

export interface ProgressionInput {
  scaleRoot: string;
  scaleType: string;
  use7ths: boolean;
  allowBorrowed: boolean;
  /** One entry per chord to generate; its length is the chord count. */
  bars: readonly number[];
  /** The progression being replaced, for the "differs from current" constraint. */
  current: readonly ChordItem[];
}

export interface ProgressionResult {
  /** Placeholder ids (`roll-<i>`), no `bassNote`; the caller re-ids them. */
  chords: ChordItem[];
  /** The states' numerals joined with an en dash, e.g. `I–V–vi–IV`. */
  roman: string;
}

/**
 * One draw in proportion to `weightOf`. Never throws: an all-zero row returns
 * the first item, and float rounding past the end lands on the last item
 * that has weight.
 */
function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, rng: () => number): T {
  const weights = items.map(weightOf);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return items[0];
  let remaining = rng() * total;
  let lastWeighted = items[0];
  for (let i = 0; i < items.length; i += 1) {
    if (weights[i] <= 0) continue;
    lastWeighted = items[i];
    remaining -= weights[i];
    if (remaining < 0) return items[i];
  }
  return lastWeighted;
}

function drawStart(states: readonly ChainState[], rng: () => number): ChainState {
  const functions = eligibleStartFunctions(states);
  if (functions.length === 0) return states[0];
  const chosen = pickWeighted(functions, (f) => f.weight, rng);
  return pickWeighted(chosen.states, startWeight, rng);
}

function walk(states: readonly ChainState[], length: number, rng: () => number): ChainState[] {
  const sequence = [drawStart(states, rng)];
  while (sequence.length < length) {
    const previous = sequence[sequence.length - 1];
    sequence.push(pickWeighted(states, (next) => transitionWeight(previous, next), rng));
  }
  return sequence;
}

const sameChord = (a: { root: string; quality: string }, b: { root: string; quality: string }): boolean =>
  a.root === b.root && a.quality === b.quality;

/** Constraints 1 and 2: no immediate repeat (wrap included) and a closing last→first motion. */
function loopsCleanly(sequence: readonly ChainState[]): boolean {
  const n = sequence.length;
  if (n < 2) return true;
  const repeats = sequence.some((s, i) => sameChord(s, sequence[(i + 1) % n]));
  const closure = ROOT_MOTION_WEIGHT[mod12(sequence[0].semi - sequence[n - 1].semi)];
  return !repeats && closure >= CLOSURE_MIN_WEIGHT;
}

/** Constraint 4: at most ceil(n/4) borrowed chords, never two adjacent (wrap included). */
function borrowedSparse(sequence: readonly ChainState[]): boolean {
  const n = sequence.length;
  const count = sequence.filter((s) => s.borrowed).length;
  if (count > Math.ceil(n / 4)) return false;
  if (n < 2) return true;
  return !sequence.some((s, i) => s.borrowed && sequence[(i + 1) % n].borrowed);
}

/** Constraints 1–4. */
function passesStructure(sequence: readonly ChainState[]): boolean {
  const hasTonic = sequence.length < 3 || sequence.some((s) => s.degree === 0);
  return loopsCleanly(sequence) && hasTonic && borrowedSparse(sequence);
}

/** Constraint 5: the root+quality sequence differs from `current`. */
function differsFrom(sequence: readonly ChainState[], current: readonly ChordItem[]): boolean {
  return sequence.length !== current.length || sequence.some((s, i) => !sameChord(s, current[i]));
}

function toResult(sequence: readonly ChainState[], bars: readonly number[]): ProgressionResult {
  return {
    chords: sequence.map((s, i) => ({ id: `roll-${i}`, root: s.root, quality: s.quality, bars: bars[i] })),
    roman: sequence.map((s) => s.roman).join('–'),
  };
}

/**
 * A new progression in the key: draw a start, walk the chain, and keep the
 * first attempt that passes all five constraints. After MAX_ROLL_ATTEMPTS
 * it falls back to the latest attempt that passed constraints 1–4, else the
 * last attempt. Never throws and never returns an empty progression: empty
 * `bars` roll one chord of one bar.
 */
export function generateProgression(input: ProgressionInput, rng: () => number): ProgressionResult {
  const bars = input.bars.length > 0 ? input.bars : [1];
  const states = buildChainStates(input.scaleRoot, input.scaleType, input.use7ths, input.allowBorrowed);
  let structural: ChainState[] | null = null;
  let latest: ChainState[] = [];
  for (let attempt = 0; attempt < MAX_ROLL_ATTEMPTS; attempt += 1) {
    latest = walk(states, bars.length, rng);
    if (!passesStructure(latest)) continue;
    structural = latest;
    if (differsFrom(latest, input.current)) return toResult(latest, bars);
  }
  return toResult(structural ?? latest, bars);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/components/loop/chord/markovProgression.test.ts`
Expected: PASS, 22 tests (about 48 000 `expect()` calls, well under a second).

- [ ] **Step 5: Confirm the statistical thresholds empirically before trusting them**

The spec's thresholds are provisional. Measure them with a throwaway script (nothing is written to the repo); run from the repo root:

```bash
bun -e "
import { mulberry32 } from './src/audio/rng';
import { generateProgression } from './src/components/loop/chord/markovProgression';
const current = [['C','maj'],['G','maj'],['A','min'],['F','maj']].map(([root, quality], i) => ({ id: String(i), root, quality, bars: 1 }));
for (const seed of [0xd1ce, 1, 2, 3, 42]) {
  const rng = mulberry32(seed); const seen = new Set(); let tonic = 0; let differ = 0;
  for (let i = 0; i < 500; i += 1) {
    const r = generateProgression({ scaleRoot: 'C', scaleType: 'Major', use7ths: false, allowBorrowed: false, bars: [1, 1, 1, 1], current }, rng);
    seen.add(r.roman);
    if (r.chords[0].root === 'C' && r.chords[0].quality === 'maj') tonic += 1;
    if (r.chords.some((c, j) => c.root !== current[j].root || c.quality !== current[j].quality)) differ += 1;
  }
  console.log(seed.toString(16), seen.size, tonic / 500, differ / 500);
}"
```

Expected output (measured when this plan was written, with the code above):

```
d1ce 193 0.622 1
1 181 0.612 1
2 177 0.646 1
3 177 0.662 1
2a 184 0.626 1
```

Pinning rule: the test runs seed `0xd1ce` only. Set `distinct ≥` about 20% below the measured value (193 → 150), keep the spec's tonic-start band `[0.40, 0.75]` because the measured 0.622 sits inside it, and set `differ ≥ 0.99` (measured 1.0; constraint 5 makes anything lower a bug). If your measured values differ from the table, your generator diverges from this plan's code: find out why before changing a threshold. Note for the listening review, recorded in ADR-0058: rejection raises the tonic-start share well above the tonic's start weight (T 0.35 of 0.85 total, ~41%) to about 0.62–0.66, because tonic-led attempts satisfy constraint 3 more often. A rolled share of ~0.50 needs T ≈ 0.2 (measured 0.47–0.51 over seeds 0xd1ce, 1, 2, 3, 42).

- [ ] **Step 6: Type-check, lint, dead-code**

Run: `bun run lint && bunx eslint src/components/loop/chord/ && bun run check:dead-code`
Expected: no output (0 errors, 0 warnings, no Knip findings).

- [ ] **Step 7: Commit**

```bash
git add src/components/loop/chord/markovProgression.ts src/components/loop/chord/markovProgression.test.ts
git commit -m "feat(chord): generate progressions by constrained Markov sampling" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `ChordsSnapshot` and `restoreChordsSnapshot`

**Files:**
- Modify: `src/store/types.ts:133` (insert `ChordsSnapshot` above `export interface ChordsSlice`) and `:160` (add the action after `setChords`)
- Modify: `src/store/chordsSlice.ts:13` (import), `:64` (insert `chordsSnapshotOf` + guard above the slice docblock), `:84` (add the action after `setChords`)
- Test: `src/store/chordsSlice.test.ts` (new; there is no slice test today — `store.test.ts` covers the factory's defaults only)

**Interfaces:**
- Consumes: `AppStore`, `ChordsSlice` (`src/store/types.ts`); `MeterId` and `BassStepChoice` are already imported in `types.ts`.
- Produces:
  - `interface ChordsSnapshot { loopId: string; scaleRoot: string; scaleType: string; meterId: MeterId; chords: ChordItem[]; customChordRhythm: boolean[]; customChordHoldSteps: number[]; customChordLoopLength: number; customBassPattern: BassStepChoice[]; customBassHoldSteps: number[]; customBassLoopLength: number }` (exported from `@/store/types`)
  - `chordsSnapshotOf(state: Pick<AppStore, 'activeLoopId' | 'scaleRoot' | 'scaleType' | 'meterId' | 'chords' | <six custom-lane keys>>): ChordsSnapshot` (exported from `@/store/chordsSlice`)
  - store action `restoreChordsSnapshot(snapshot: ChordsSnapshot): void` — one `set()`, verbatim, only when `activeLoopId`, `scaleRoot`, `scaleType` and `meterId` all equal the snapshot's; otherwise returns the unchanged state, which notifies nobody (the loop mirror in `loopSync.ts` sees no changed field and zustand skips an identical state).

Addition to the spec: the spec guards on `loopId` only. The three extra guards stop an Undo from writing old-key chords into a new key, or holds clamped against one meter's bar under another.

- [ ] **Step 1: Write the failing test**

Create `src/store/chordsSlice.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { BassStepChoice } from '@/data/bassPatterns';
import type { ChordItem } from '@/types';
import { MAX_STEPS_PER_BAR } from '@/utils/timeSignature';
import { chordsSnapshotOf } from './chordsSlice';
import { loopStatePatch } from './loop';
import { createDefaultLoop } from './loopSlice';
import { useAppStore } from './store';
import type { ChordsSnapshot } from './types';

const reset = () => {
  const loop = createDefaultLoop();
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    meterId: '4/4',
    ...loopStatePatch(loop),
  });
};
beforeEach(reset);
afterEach(reset);

const count = (fn: () => void): number => {
  let n = 0;
  const stop = useAppStore.subscribe(() => {
    n += 1;
  });
  fn();
  stop();
  return n;
};

const ROLLED: ChordItem[] = [
  { id: 'r0', root: 'C', quality: 'maj', bars: 2 },
  { id: 'r1', root: 'G', quality: 'maj', bars: 1 },
];

/** Overwrites all seven restorable fields with values no snapshot of the default loop holds. */
function scribble(): void {
  useAppStore.setState({
    chords: ROLLED,
    customChordRhythm: new Array<boolean>(3 * MAX_STEPS_PER_BAR).fill(true),
    customChordHoldSteps: new Array<number>(3 * MAX_STEPS_PER_BAR).fill(2),
    customChordLoopLength: 3,
    customBassPattern: new Array<BassStepChoice>(3 * MAX_STEPS_PER_BAR).fill('root'),
    customBassHoldSteps: new Array<number>(3 * MAX_STEPS_PER_BAR).fill(2),
    customBassLoopLength: 3,
  });
}

const RESTORED_KEYS = [
  'chords',
  'customChordRhythm',
  'customChordHoldSteps',
  'customChordLoopLength',
  'customBassPattern',
  'customBassHoldSteps',
  'customBassLoopLength',
] as const;

function restorable(snapshot: ChordsSnapshot | ReturnType<typeof useAppStore.getState>) {
  return Object.fromEntries(RESTORED_KEYS.map((key) => [key, snapshot[key]]));
}

describe('chordsSnapshotOf', () => {
  test('captures the loop, key, scale, meter, chords and the six custom-lane fields', () => {
    const s = useAppStore.getState();
    const snapshot = chordsSnapshotOf(s);
    expect(snapshot.loopId).toBe(s.activeLoopId);
    expect(snapshot.scaleRoot).toBe(s.scaleRoot);
    expect(snapshot.scaleType).toBe(s.scaleType);
    expect(snapshot.meterId).toBe(s.meterId);
    expect(restorable(snapshot)).toEqual(restorable(s));
  });
});

describe('restoreChordsSnapshot', () => {
  test('puts all seven fields back exactly, in one notification', () => {
    const snapshot = chordsSnapshotOf(useAppStore.getState());
    scribble();
    const n = count(() => useAppStore.getState().restoreChordsSnapshot(snapshot));
    expect(n).toBe(1);
    expect(restorable(useAppStore.getState())).toEqual(restorable(snapshot));
  });

  test('mirrors the restore into the active loop in loops[]', () => {
    const snapshot = chordsSnapshotOf(useAppStore.getState());
    scribble();
    useAppStore.getState().restoreChordsSnapshot(snapshot);
    const s = useAppStore.getState();
    expect(s.loops.find((l) => l.id === s.activeLoopId)?.chords).toBe(snapshot.chords);
  });

  test('is a no-op, with no notification, once the active loop changed', () => {
    const snapshot = { ...chordsSnapshotOf(useAppStore.getState()), loopId: 'loop-elsewhere' };
    scribble();
    const n = count(() => useAppStore.getState().restoreChordsSnapshot(snapshot));
    expect(n).toBe(0);
    expect(useAppStore.getState().chords).toBe(ROLLED);
  });

  // Addition to the spec: old-key chords must not land in a new key, and holds
  // clamped against one bar length must not land under another.
  test('is a no-op once the key root, scale type or meter changed', () => {
    const snapshot = chordsSnapshotOf(useAppStore.getState());
    const changes = [{ scaleRoot: 'D' }, { scaleType: 'Dorian' }, { meterId: '3/4' as const }];
    for (const change of changes) {
      reset();
      scribble();
      useAppStore.setState(change);
      const n = count(() => useAppStore.getState().restoreChordsSnapshot(snapshot));
      expect(n).toBe(0);
      expect(useAppStore.getState().chords).toBe(ROLLED);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/chordsSlice.test.ts`
Expected: FAIL — an import error naming the missing export `chordsSnapshotOf`.

- [ ] **Step 3: Add the type**

In `src/store/types.ts`, directly above `export interface ChordsSlice {`, insert:

```ts
/**
 * A progression roll's Undo payload (R363): the chords AND the six custom-lane
 * fields `chordsPatch` re-clamps, because a roll that moves chord boundaries
 * rewrites them. `loopId`, `scaleRoot`, `scaleType` and `meterId` are the
 * guard: `restoreChordsSnapshot` writes only while all four still match.
 */
export interface ChordsSnapshot {
  loopId: string;
  scaleRoot: string;
  scaleType: string;
  meterId: MeterId;
  chords: ChordItem[];
  customChordRhythm: boolean[];
  customChordHoldSteps: number[];
  customChordLoopLength: number;
  customBassPattern: BassStepChoice[];
  customBassHoldSteps: number[];
  customBassLoopLength: number;
}
```

and inside `ChordsSlice`, directly after `setChords: (chords: ChordItem[]) => void;`, insert:

```ts
  /**
   * Puts a roll's snapshot back verbatim, in one `set()` — only while the
   * active loop, key, scale and meter all equal the snapshot's; otherwise a
   * no-op that notifies nobody.
   */
  restoreChordsSnapshot: (snapshot: ChordsSnapshot) => void;
```

- [ ] **Step 4: Add the snapshot helper and the action**

In `src/store/chordsSlice.ts`, change the types import to:

```ts
import type { AppStore, ChordsSlice, ChordsSnapshot } from './types';
```

Between `chordsPatch` and the docblock that opens `Chords slice. \`setChordOctave\` writes only the octave`, insert:

```ts
type SnapshotSource = Pick<
  AppStore,
  | 'activeLoopId'
  | 'scaleRoot'
  | 'scaleType'
  | 'meterId'
  | 'chords'
  | 'customChordRhythm'
  | 'customChordHoldSteps'
  | 'customChordLoopLength'
  | 'customBassPattern'
  | 'customBassHoldSteps'
  | 'customBassLoopLength'
>;

/**
 * The Undo snapshot a progression roll takes before it writes (R363). The
 * arrays are shared, not copied: persisted values are replaced, never
 * mutated in place (R210), so a later edit cannot reach into the snapshot.
 */
export function chordsSnapshotOf(state: SnapshotSource): ChordsSnapshot {
  return {
    loopId: state.activeLoopId,
    scaleRoot: state.scaleRoot,
    scaleType: state.scaleType,
    meterId: state.meterId,
    chords: state.chords,
    customChordRhythm: state.customChordRhythm,
    customChordHoldSteps: state.customChordHoldSteps,
    customChordLoopLength: state.customChordLoopLength,
    customBassPattern: state.customBassPattern,
    customBassHoldSteps: state.customBassHoldSteps,
    customBassLoopLength: state.customBassLoopLength,
  };
}

/**
 * A snapshot restores only onto the loop, key, scale and meter it was taken
 * in: after a key or scale change its chords would be in the old key, and
 * after a meter change its holds were clamped against another bar length.
 */
function snapshotApplies(state: SnapshotSource, snapshot: ChordsSnapshot): boolean {
  return (
    state.activeLoopId === snapshot.loopId &&
    state.scaleRoot === snapshot.scaleRoot &&
    state.scaleType === snapshot.scaleType &&
    state.meterId === snapshot.meterId
  );
}
```

In `createChordsSlice`, directly after `setChords: (chords) => set((state) => chordsPatch(state, chords)),`, insert:

```ts
    // Verbatim, never through chordsPatch: the lanes were already clamped
    // against these chords when the snapshot was taken. Returning `state`
    // unchanged is a true no-op — zustand skips an identical state and the
    // loop mirror sees no changed field.
    restoreChordsSnapshot: (snapshot) =>
      set((state) =>
        snapshotApplies(state, snapshot)
          ? {
              chords: snapshot.chords,
              customChordRhythm: snapshot.customChordRhythm,
              customChordHoldSteps: snapshot.customChordHoldSteps,
              customChordLoopLength: snapshot.customChordLoopLength,
              customBassPattern: snapshot.customBassPattern,
              customBassHoldSteps: snapshot.customBassHoldSteps,
              customBassLoopLength: snapshot.customBassLoopLength,
            }
          : state,
      ),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/store/chordsSlice.test.ts src/store/store.test.ts`
Expected: PASS (5 tests in the new file; `store.test.ts` unchanged and green — its two direct `createChordsSlice` calls need no edit, the factory signature is unchanged).

- [ ] **Step 6: Type-check, lint, dead-code**

Run: `bun run lint && bunx eslint src/store/types.ts src/store/chordsSlice.ts src/store/chordsSlice.test.ts && bun run check:dead-code`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/store/types.ts src/store/chordsSlice.ts src/store/chordsSlice.test.ts
git commit -m "feat(store): restore a chords snapshot for the roll undo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lift `useLoopUndo` to the `src/components/` root (pure move)

**Files:**
- Move: `src/components/song/useLoopUndo.ts` → `src/components/useLoopUndo.ts`
- Move: `src/components/song/useLoopUndo.test.ts` → `src/components/useLoopUndo.test.ts`
- Modify: `src/components/song/ArrangeView.tsx:35`, `src/components/song/useLoopKeyChangeUndo.ts:5`, `src/components/song/ArrangeView.test.tsx:11`
- Modify: `docs/architecture/structure/01-ui.md` (three `song/useLoopUndo.ts` path mentions)

**Interfaces:**
- Consumes: nothing new.
- Produces: the same exports at `@/components/useLoopUndo`: `useLoopUndo<T>(restore: (payload: T) => void, key: string, messageOf: (payload: T) => string): UseLoopUndo<T>`, `buildLoopUndoRequest<T>(restore, key, messageOf, payload): FeedbackRequest`, `subscribeLoopUndoDismissOnInstall(key: string): () => void`, `interface UseLoopUndo<T> { offer: (payload: T) => void }`.

Why: R276 — the chord view (Task 5) becomes the second area using it, so it lifts to the shared hook location `.claude/rules/components.md` names. No behaviour change; the file's own imports are already `@/`-absolute, so its body does not change.

- [ ] **Step 1: Move the test first (it becomes the failing test)**

```bash
git mv src/components/song/useLoopUndo.test.ts src/components/useLoopUndo.test.ts
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/components/useLoopUndo.test.ts`
Expected: FAIL — `Cannot find module './useLoopUndo'`.

- [ ] **Step 3: Move the hook and update the importers**

```bash
git mv src/components/song/useLoopUndo.ts src/components/useLoopUndo.ts
sed -i '' "s#import { useLoopUndo } from './useLoopUndo';#import { useLoopUndo } from '@/components/useLoopUndo';#" src/components/song/ArrangeView.tsx src/components/song/useLoopKeyChangeUndo.ts
sed -i '' "s#import { subscribeLoopUndoDismissOnInstall } from './useLoopUndo';#import { subscribeLoopUndoDismissOnInstall } from '@/components/useLoopUndo';#" src/components/song/ArrangeView.test.tsx
sed -i '' 's#`song/useLoopUndo.ts`#`useLoopUndo.ts`#g' docs/architecture/structure/01-ui.md
```

(`sed -i ''` is the macOS form; on GNU sed drop the `''`.) Resulting import lines:

```ts
// src/components/song/ArrangeView.tsx and src/components/song/useLoopKeyChangeUndo.ts
import { useLoopUndo } from '@/components/useLoopUndo';
// src/components/song/ArrangeView.test.tsx
import { subscribeLoopUndoDismissOnInstall } from '@/components/useLoopUndo';
```

Confirm nothing still points at the old path: `grep -rn "song/useLoopUndo\|from './useLoopUndo'" src docs/architecture` prints only `src/components/useLoopUndo.test.ts`'s own `./useLoopUndo` import.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/components/useLoopUndo.test.ts src/components/song/ArrangeView.test.tsx`
Expected: PASS (28 tests across the two files).

- [ ] **Step 5: Type-check, lint, both Knip scans**

Run: `bun run lint && bun run eslint && bun run check:dead-code && bun run check:dead-code:production`
Expected: no findings (this task adds no file, so the production scan is clean here too).

- [ ] **Step 6: Commit**

```bash
git add src/components/useLoopUndo.ts src/components/useLoopUndo.test.ts src/components/song/ArrangeView.tsx src/components/song/ArrangeView.test.tsx src/components/song/useLoopKeyChangeUndo.ts docs/architecture/structure/01-ui.md
git commit -m "refactor(components): lift useLoopUndo to the components root" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git mv` already staged the deletions of the old paths.)

---

### Task 5: `useProgressionDice` — `planRoll`, `performRoll`, the Undo offer

**Files:**
- Create: `src/components/loop/chord/useProgressionDice.ts`
- Test: `src/components/loop/chord/useProgressionDice.test.ts`
- Modify: `src/components/useLoopUndo.ts` (docblocks name the third consumer)

**Interfaces:**
- Consumes: `generateProgression`, `resolveBars`, `type RollChordCount`, `type RollBarsPerChord` (Task 1–2); `chordsSnapshotOf`, `ChordsSnapshot`, store action `restoreChordsSnapshot` (Task 3); `useLoopUndo`, `buildLoopUndoRequest` from `@/components/useLoopUndo` (Task 4); `getBorrowedChords` from `@/utils/musicTheory`; store `setChords`, `showFeedback`, `runFeedbackAction`, `dismissFeedback`, `feedback`.
- Produces:
  - `ROLL_UNDO_KEY = 'btn-undo-roll-progression'`
  - `interface RollOptions { chordCount: RollChordCount; barsPerChord: RollBarsPerChord; allowBorrowed: boolean; use7ths: boolean }`
  - `interface RollUndo { snapshot: ChordsSnapshot; roman: string }`
  - `interface RollPlan { chords: ChordItem[]; roman: string; snapshot: ChordsSnapshot }`
  - `planRoll(state: Parameters<typeof chordsSnapshotOf>[0], options: RollOptions, rng: () => number, now: number): RollPlan` — pure; ids `roll-chord-<now>-<i>`
  - `restoreRoll(undo: RollUndo): void`; `rollUndoMessage(undo: RollUndo): string` → `Rolled <roman>` (module-level, `useLoopUndo`'s stability contract)
  - `performRoll(options: RollOptions, rng: () => number, now: number, clearReharmonizeBadge: () => void, offer: (undo: RollUndo) => void): RollPlan` — `setChords`, then `clearReharmonizeBadge()`, then `offer` (R362)
  - `interface UseProgressionDice { chordCount; setChordCount(count: RollChordCount): void; barsPerChord; setBarsPerChord(bars: RollBarsPerChord): void; allowBorrowed: boolean; setAllowBorrowed(allow: boolean): void; borrowedAvailable: boolean; optionsOpen: boolean; toggleOptions(): void; closeOptions(): void; roll(): void; rollFromOptions(): void }`
  - `useProgressionDice(use7ths: boolean, clearReharmonizeBadge: () => void): UseProgressionDice`

The testable core is `planRoll` (pure) and `performRoll` (store, no React); the hook only adds local option state, the popup's open state, `Math.random` / `Date.now()` and `useLoopUndo`'s `offer`. The test's `offerUndo` is exactly `useLoopUndo`'s `offer` body, so the Undo path is exercised end to end through the real feedback slice.

- [ ] **Step 1: Write the failing test**

Create `src/components/loop/chord/useProgressionDice.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { mulberry32 } from '@/audio/rng';
import { buildLoopUndoRequest } from '@/components/useLoopUndo';
import { chordsSnapshotOf } from '@/store/chordsSlice';
import { loopStatePatch } from '@/store/loop';
import { createDefaultLoop } from '@/store/loopSlice';
import { useAppStore } from '@/store/store';
import type { ChordItem } from '@/types';
import {
  ROLL_UNDO_KEY,
  performRoll,
  planRoll,
  restoreRoll,
  rollUndoMessage,
  useProgressionDice,
  type RollOptions,
  type RollUndo,
  type UseProgressionDice,
} from './useProgressionDice';

const KEEP: RollOptions = { chordCount: 'keep', barsPerChord: 1, allowBorrowed: false, use7ths: false };

const reset = () => {
  const loop = createDefaultLoop();
  useAppStore.getState().dismissFeedback(ROLL_UNDO_KEY);
  useAppStore.setState({
    loops: [loop],
    activeLoopId: loop.id,
    meterId: '4/4',
    reharmonizedIndicator: false,
    ...loopStatePatch(loop),
  });
};
beforeEach(reset);
afterEach(reset);

/** The hook's own offer, minus the React lifetime: `useLoopUndo`'s `offer` is exactly this call. */
const offerUndo = (undo: RollUndo) =>
  useAppStore
    .getState()
    .showFeedback(buildLoopUndoRequest(restoreRoll, ROLL_UNDO_KEY, rollUndoMessage, undo));

const pendingUndos = () => useAppStore.getState().feedback.filter((e) => e.key === ROLL_UNDO_KEY);

const lanes = () => {
  const { chords, customChordRhythm, customChordHoldSteps, customChordLoopLength, customBassPattern, customBassHoldSteps, customBassLoopLength } =
    useAppStore.getState();
  return { chords, customChordRhythm, customChordHoldSteps, customChordLoopLength, customBassPattern, customBassHoldSteps, customBassLoopLength };
};

describe('planRoll', () => {
  test('an empty loop rolled with Keep gets four chords of one bar', () => {
    const state = { ...useAppStore.getState(), chords: [] as ChordItem[] };
    const plan = planRoll(state, KEEP, mulberry32(1), 1000);
    expect(plan.chords.map((c) => c.bars)).toEqual([1, 1, 1, 1]);
  });

  test('Keep keeps the count and each chord’s bars; a count overrides both', () => {
    const state = useAppStore.getState();
    const kept = planRoll(state, KEEP, mulberry32(2), 1000);
    expect(kept.chords.map((c) => c.bars)).toEqual(state.chords.map((c) => c.bars));
    const six = planRoll(state, { ...KEEP, chordCount: 6, barsPerChord: 2 }, mulberry32(2), 1000);
    expect(six.chords.map((c) => c.bars)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  test('re-ids with the library-apply pattern and snapshots the state it read', () => {
    const state = useAppStore.getState();
    const plan = planRoll(state, KEEP, mulberry32(3), 1234);
    expect(plan.chords.map((c) => c.id)).toEqual(state.chords.map((_, i) => `roll-chord-1234-${i}`));
    expect(plan.snapshot).toEqual(chordsSnapshotOf(state));
  });
});

describe('performRoll', () => {
  test('writes the chords, clears the badge, then offers an Undo named after the roll', () => {
    const calls: string[] = [];
    const offered: RollUndo[] = [];
    const plan = performRoll(KEEP, mulberry32(4), 1000, () => calls.push('clear'), (undo) => {
      calls.push('offer');
      offered.push(undo);
    });
    expect(calls).toEqual(['clear', 'offer']);
    expect(offered).toEqual([{ snapshot: plan.snapshot, roman: plan.roman }]);
    expect(useAppStore.getState().chords).toEqual(plan.chords);
    expect(rollUndoMessage({ snapshot: plan.snapshot, roman: 'I–V–vi–IV' })).toBe('Rolled I–V–vi–IV');
  });

  test('Undo restores the exact pre-roll chords and custom lanes', () => {
    const before = lanes();
    performRoll({ ...KEEP, chordCount: 3, barsPerChord: 2 }, mulberry32(5), 1000, () => {}, offerUndo);
    expect(lanes()).not.toEqual(before);
    useAppStore.getState().runFeedbackAction(ROLL_UNDO_KEY);
    expect(lanes()).toEqual(before);
  });

  test('two rolls in a row: one pending Undo, and it restores the state before the SECOND roll', () => {
    performRoll(KEEP, mulberry32(6), 1000, () => {}, offerUndo);
    const afterFirst = lanes();
    performRoll({ ...KEEP, chordCount: 6 }, mulberry32(7), 2000, () => {}, offerUndo);
    expect(pendingUndos()).toHaveLength(1);
    useAppStore.getState().runFeedbackAction(ROLL_UNDO_KEY);
    expect(lanes()).toEqual(afterFirst);
  });

  test('Undo after a key change puts nothing back (old-key chords never land in the new key)', () => {
    performRoll(KEEP, mulberry32(8), 1000, () => {}, offerUndo);
    const rolled = useAppStore.getState().chords;
    useAppStore.setState({ scaleRoot: 'D' });
    useAppStore.getState().runFeedbackAction(ROLL_UNDO_KEY);
    expect(useAppStore.getState().chords).toBe(rolled);
  });
});

describe('useProgressionDice', () => {
  let dice: UseProgressionDice | null = null;
  let cleared = 0;
  function Probe() {
    dice = useProgressionDice(false, () => {
      cleared += 1;
    });
    return null;
  }

  test('defaults: Keep, 1 bar, borrowed off, popup closed', () => {
    renderToString(createElement(Probe));
    expect(dice!.chordCount).toBe('keep');
    expect(dice!.barsPerChord).toBe(1);
    expect(dice!.allowBorrowed).toBe(false);
    expect(dice!.optionsOpen).toBe(false);
    expect(dice!.borrowedAvailable).toBe(true);
  });

  test('roll() rolls the live store, clears the badge and raises the Undo snackbar', () => {
    renderToString(createElement(Probe));
    const before = useAppStore.getState().chords;
    cleared = 0;
    dice!.roll();
    const after = useAppStore.getState().chords;
    expect(after).not.toBe(before);
    expect(after.map((c) => c.bars)).toEqual(before.map((c) => c.bars));
    expect(cleared).toBe(1);
    const [entry] = pendingUndos();
    expect(entry.message.startsWith('Rolled ')).toBe(true);
    expect(entry.action?.id).toBe('btn-undo-roll-progression');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/loop/chord/useProgressionDice.test.ts`
Expected: FAIL — `Cannot find module './useProgressionDice'`.

- [ ] **Step 3: Write the hook**

Create `src/components/loop/chord/useProgressionDice.ts`:

```ts
import { useMemo, useState } from 'react';
import { chordsSnapshotOf } from '@/store/chordsSlice';
import { useAppStore } from '@/store/store';
import type { ChordsSnapshot } from '@/store/types';
import type { ChordItem } from '@/types';
import { getBorrowedChords } from '@/utils/musicTheory';
import { useLoopUndo } from '@/components/useLoopUndo';
import {
  generateProgression,
  resolveBars,
  type RollBarsPerChord,
  type RollChordCount,
} from './markovProgression';

/** The Undo snackbar's feedback key, which is also its button's DOM id. */
export const ROLL_UNDO_KEY = 'btn-undo-roll-progression';

export interface RollOptions {
  chordCount: RollChordCount;
  barsPerChord: RollBarsPerChord;
  allowBorrowed: boolean;
  /** Quick Add's 7ths toggle (`use7thsInQuickAdd`); borrowed chords ignore it. */
  use7ths: boolean;
}

/** The Undo offer's payload: what to put back, and the roll it names. */
export interface RollUndo {
  snapshot: ChordsSnapshot;
  roman: string;
}

export interface RollPlan {
  /** Re-idded `roll-chord-<now>-<i>`, the library-apply pattern. */
  chords: ChordItem[];
  roman: string;
  /** Taken BEFORE the write, from the same state the roll read. */
  snapshot: ChordsSnapshot;
}

type RollSource = Parameters<typeof chordsSnapshotOf>[0];

/**
 * The roll, pure: generate from `state`'s key and chords, re-id the result,
 * and snapshot what it will replace. No store, no clock, no randomness of
 * its own — `rng` and `now` come in.
 */
export function planRoll(state: RollSource, options: RollOptions, rng: () => number, now: number): RollPlan {
  const generated = generateProgression(
    {
      scaleRoot: state.scaleRoot,
      scaleType: state.scaleType,
      use7ths: options.use7ths,
      allowBorrowed: options.allowBorrowed,
      bars: resolveBars(options.chordCount, options.barsPerChord, state.chords),
      current: state.chords,
    },
    rng,
  );
  return {
    chords: generated.chords.map((c, i) => ({ ...c, id: `roll-chord-${now}-${i}` })),
    roman: generated.roman,
    snapshot: chordsSnapshotOf(state),
  };
}

/** Module-level, per `useLoopUndo`'s stability contract. */
export const restoreRoll = (undo: RollUndo): void =>
  useAppStore.getState().restoreChordsSnapshot(undo.snapshot);

/** Module-level, per `useLoopUndo`'s stability contract. */
export const rollUndoMessage = (undo: RollUndo): string => `Rolled ${undo.roman}`;

/**
 * One roll against the live store, through the library-apply path (R362):
 * `setChords` with fresh ids, then `clearReharmonizeBadge()`, then the Undo
 * offer. Outside React so a test drives it without a render.
 */
export function performRoll(
  options: RollOptions,
  rng: () => number,
  now: number,
  clearReharmonizeBadge: () => void,
  offer: (undo: RollUndo) => void,
): RollPlan {
  const store = useAppStore.getState();
  const plan = planRoll(store, options, rng, now);
  store.setChords(plan.chords);
  clearReharmonizeBadge();
  offer({ snapshot: plan.snapshot, roman: plan.roman });
  return plan;
}

export interface UseProgressionDice {
  chordCount: RollChordCount;
  setChordCount: (count: RollChordCount) => void;
  barsPerChord: RollBarsPerChord;
  setBarsPerChord: (bars: RollBarsPerChord) => void;
  allowBorrowed: boolean;
  setAllowBorrowed: (allow: boolean) => void;
  /** False when the scale's borrowed list is empty; the toggle is then disabled. */
  borrowedAvailable: boolean;
  optionsOpen: boolean;
  toggleOptions: () => void;
  closeOptions: () => void;
  /** Rolls with the current options. */
  roll: () => void;
  /** The popup's own Roll: closes it, then rolls. */
  rollFromOptions: () => void;
}

/**
 * The Roll dice's state and action. The options are local state: they last
 * the session because views stay mounted (R014), reset on a layout switch
 * (R316) and a reload, and are never persisted. `use7ths` is Quick Add's
 * toggle, local to `useProgressionEditor`, hence a parameter.
 */
export function useProgressionDice(use7ths: boolean, clearReharmonizeBadge: () => void): UseProgressionDice {
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const [chordCount, setChordCount] = useState<RollChordCount>('keep');
  const [barsPerChord, setBarsPerChord] = useState<RollBarsPerChord>(1);
  const [allowBorrowed, setAllowBorrowed] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const borrowedAvailable = useMemo(
    () => getBorrowedChords(scaleRoot, scaleType).length > 0,
    [scaleRoot, scaleType],
  );
  const { offer } = useLoopUndo(restoreRoll, ROLL_UNDO_KEY, rollUndoMessage);

  const roll = () => {
    const options = { chordCount, barsPerChord, allowBorrowed: allowBorrowed && borrowedAvailable, use7ths };
    performRoll(options, Math.random, Date.now(), clearReharmonizeBadge, offer);
  };

  return {
    chordCount,
    setChordCount,
    barsPerChord,
    setBarsPerChord,
    allowBorrowed,
    setAllowBorrowed,
    borrowedAvailable,
    optionsOpen,
    toggleOptions: () => setOptionsOpen((open) => !open),
    closeOptions: () => setOptionsOpen(false),
    roll,
    rollFromOptions: () => {
      setOptionsOpen(false);
      roll();
    },
  };
}
```

In `src/components/useLoopUndo.ts`, replace the id list in `buildLoopUndoRequest`'s docblock:

```ts
 * testable without a store or a clock. `key` doubles as the Undo button's DOM
 * id (`btn-undo-loop-delete`, `btn-undo-key-change`, `btn-undo-roll-progression`).
 */
```

and replace `useLoopUndo`'s docblock with:

```ts
/**
 * One single-level, timed Undo snackbar (Arrange's loop delete and batch key
 * change, the chord view's progression roll), raised through the shared
 * feedback host (§5.6). Its views stay mounted across a project install, and
 * loop ids collide across projects, so an install dismisses a pending Undo —
 * off a store subscription rather than a selector, so the view never
 * re-renders for it. `restore` and `messageOf` must be stable (module-level
 * functions).
 */
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/loop/chord/useProgressionDice.test.ts src/components/useLoopUndo.test.ts`
Expected: PASS (9 tests in the new file).

- [ ] **Step 5: Type-check, lint, dead-code**

Run: `bun run lint && bunx eslint src/components/loop/chord/ src/components/useLoopUndo.ts && bun run check:dead-code`
Expected: no output. (`check:dead-code:production` would still report `useProgressionDice.ts` and `markovProgression.ts` as unused files until Task 6 wires them; that is expected here.)

- [ ] **Step 6: Commit**

```bash
git add src/components/loop/chord/useProgressionDice.ts src/components/loop/chord/useProgressionDice.test.ts src/components/useLoopUndo.ts
git commit -m "feat(chord): add the progression dice hook with undo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Roll split button and its options popup

**Files:**
- Create: `src/components/loop/chord/RollProgressionButton.tsx`
- Test: `src/components/loop/chord/RollProgressionButton.test.tsx`
- Modify: `src/components/loop/chord/ProgressionCard.tsx:13` (imports), `:200-262` (`ProgressionActionsProps` / `ProgressionActions`), `:337-368` (`ProgressionCardProps` / `ProgressionCard`)
- Modify: `src/components/loop/ChordView.tsx:28` (import), `:141` (call the hook), `:174` (pass `dice`)
- Test: `src/components/loop/ChordView.test.tsx` (one test in `describe('ChordView accompaniment layout')`, before the `auto-reharmonize label` test at `:171`)

**Interfaces:**
- Consumes: `UseProgressionDice`, `useProgressionDice` (Task 5); `type RollChordCount`, `type RollBarsPerChord` (Task 1); `Popup` (`@/components/ui/Popup`: `open`, `onClose`, `trigger`, `align`, `className`, `panelClassName`, `children`); `HINT_TEXT` (`@/components/ui/fieldClasses`).
- Produces: `RollProgressionButton({ dice }: { dice: UseProgressionDice })`, `RollOptionsPanel({ dice }: { dice: UseProgressionDice })`; `ProgressionActionsProps.dice` and `ProgressionCardProps.dice: UseProgressionDice`.

The render test feeds a plain `UseProgressionDice` object, so no store read is involved and R257 cannot bite; the `ChordView` test only checks placement, which needs no test-set state. The Popup wrapper gets `className="flex"` so the caret keeps the `join`'s height (the `DockMenu` precedent); `join-item` styles apply through that wrapper (daisyUI v5: "Even if join-item is not a direct child of the group, it still gets the style"). The panel body is `role="dialog"` with an `aria-label`, matching the trigger's `aria-haspopup="dialog"` (the `QuickSavePopover` precedent).

- [ ] **Step 1: Write the failing tests**

Create `src/components/loop/chord/RollProgressionButton.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { RollOptionsPanel, RollProgressionButton } from './RollProgressionButton';
import type { UseProgressionDice } from './useProgressionDice';

// Plain props, no store: the renderToString trap (R257) cannot reach these
// renders, because nothing here reads useAppStore.
function dice(overrides: Partial<UseProgressionDice> = {}): UseProgressionDice {
  return {
    chordCount: 'keep',
    setChordCount: () => {},
    barsPerChord: 1,
    setBarsPerChord: () => {},
    allowBorrowed: false,
    setAllowBorrowed: () => {},
    borrowedAvailable: true,
    optionsOpen: false,
    toggleOptions: () => {},
    closeOptions: () => {},
    roll: () => {},
    rollFromOptions: () => {},
    ...overrides,
  };
}

/** The opening tag of the element whose attributes contain `marker`. */
function openTag(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1);
}

describe('RollProgressionButton', () => {
  test('a join of the Roll button and the options caret, panel closed', () => {
    const html = renderToString(<RollProgressionButton dice={dice()} />);
    expect(html.startsWith('<div class="join">')).toBe(true);
    const roll = openTag(html, 'id="btn-roll-progression"');
    expect(roll).toContain('aria-label="Roll progression"');
    expect(roll).toContain('btn btn-xs btn-secondary btn-soft join-item gap-1');
    expect(html).toContain('<span class="hidden sm:inline">Roll</span>');
    const caret = openTag(html, 'id="btn-roll-progression-options"');
    expect(caret).toContain('aria-haspopup="dialog"');
    expect(caret).toContain('aria-expanded="false"');
    expect(caret).toContain('join-item');
    expect(html).not.toContain('role="dialog"');
  });

  test('open: aria-expanded flips and the options panel mounts', () => {
    const html = renderToString(<RollProgressionButton dice={dice({ optionsOpen: true })} />);
    expect(openTag(html, 'id="btn-roll-progression-options"')).toContain('aria-expanded="true"');
    expect(html).toContain('<div role="dialog" aria-label="Roll options"');
  });
});

describe('RollOptionsPanel', () => {
  test('Chords offers Keep, 2, 3, 4, 6, 8 with Keep pressed; Bars per chord is hidden while Keep', () => {
    const html = renderToString(<RollOptionsPanel dice={dice()} />);
    for (const id of ['keep', '2', '3', '4', '6', '8']) expect(html).toContain(`id="btn-roll-chords-${id}"`);
    expect(openTag(html, 'id="btn-roll-chords-keep"')).toContain('aria-pressed="true"');
    expect(openTag(html, 'id="btn-roll-chords-keep"')).toContain('btn btn-xs join-item btn-active btn-primary');
    expect(openTag(html, 'id="btn-roll-chords-4"')).toContain('aria-pressed="false"');
    expect(html).not.toContain('Bars per chord');
  });

  test('a chord count shows Bars per chord with the current choice pressed', () => {
    const html = renderToString(<RollOptionsPanel dice={dice({ chordCount: 4, barsPerChord: 2 })} />);
    expect(html).toContain('Bars per chord');
    expect(openTag(html, 'id="btn-roll-bars-2"')).toContain('aria-pressed="true"');
    expect(openTag(html, 'id="btn-roll-bars-1"')).toContain('aria-pressed="false"');
  });

  test('Borrowed is a toggle; with no borrowed chords it is disabled and says why', () => {
    const on = renderToString(<RollOptionsPanel dice={dice({ allowBorrowed: true })} />);
    expect(openTag(on, 'id="chk-roll-borrowed"')).toContain('toggle toggle-sm toggle-secondary');
    expect(openTag(on, 'id="chk-roll-borrowed"')).toContain('checked=""');
    const none = renderToString(<RollOptionsPanel dice={dice({ allowBorrowed: true, borrowedAvailable: false })} />);
    expect(openTag(none, 'id="chk-roll-borrowed"')).toContain('disabled=""');
    expect(openTag(none, 'id="chk-roll-borrowed"')).not.toContain('checked=""');
    expect(none).toContain('This scale has no borrowed chords.');
  });

  test('notes that 7ths follow Quick Add, and offers its own Roll', () => {
    const html = renderToString(<RollOptionsPanel dice={dice()} />);
    expect(html).toContain('7ths follow Quick Add.');
    expect(html).toContain('id="btn-roll-progression-apply"');
  });
});
```

In `src/components/loop/ChordView.test.tsx`, inside `describe('ChordView accompaniment layout', …)`, directly before `test('the auto-reharmonize label reflects the live flag', () => {`, insert:

```tsx
  test('the Roll split button sits with the progression actions, after Re-harmonize', () => {
    const progression = html.indexOf('>Chord Progression<');
    const chordCard = html.indexOf('card bg-panel tint-chord');
    const reharmonize = html.indexOf('id="btn-reharmonize-chord-progression"');
    expect(progression).toBeGreaterThan(-1);
    expect(reharmonize).toBeGreaterThan(-1);
    for (const id of ['id="btn-roll-progression"', 'id="btn-roll-progression-options"']) {
      const at = html.indexOf(id);
      expect(at).toBeGreaterThan(reharmonize);
      expect(at).toBeLessThan(chordCard);
    }
  });

```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/loop/chord/RollProgressionButton.test.tsx src/components/loop/ChordView.test.tsx`
Expected: FAIL — `Cannot find module './RollProgressionButton'`, and the ChordView test fails on `expect(at).toBeGreaterThan(reharmonize)` (`-1`).

- [ ] **Step 3: Write the split button**

Create `src/components/loop/chord/RollProgressionButton.tsx`:

```tsx
import { ChevronDown, Dices } from 'lucide-react';
import { Popup } from '@/components/ui/Popup';
import { HINT_TEXT } from '@/components/ui/fieldClasses';
import type { RollBarsPerChord, RollChordCount } from './markovProgression';
import type { UseProgressionDice } from './useProgressionDice';

const CHORD_COUNT_OPTIONS: readonly RollChordCount[] = ['keep', 2, 3, 4, 6, 8];
const BARS_PER_CHORD_OPTIONS: readonly RollBarsPerChord[] = [1, 2, 4];

/** Both halves of the split button: the Re-harmonize family's colour, one `join`. */
const ROLL_BUTTON = 'btn btn-xs btn-secondary btn-soft join-item';

const ROLL_PANEL =
  'mt-1 w-64 max-w-[calc(100vw-1rem)] p-3 bg-base-100 border border-base-300 rounded-box shadow-xl';

/** Selected-vs-not, spelled the way `ui/SegmentedControl` spells it. */
function optionClass(active: boolean): string {
  return `btn btn-xs join-item ${active ? 'btn-active btn-primary' : 'btn-ghost'}`;
}

interface OptionRowProps<T extends string | number> {
  idPrefix: string;
  legend: string;
  options: readonly T[];
  value: T;
  labelOf: (option: T) => string;
  onPick: (option: T) => void;
}

/** One segmented choice: a `join` of pressed/unpressed buttons under a fieldset legend. */
function OptionRow<T extends string | number>({ idPrefix, legend, options, value, labelOf, onPick }: OptionRowProps<T>) {
  return (
    <fieldset className="fieldset p-0">
      <legend className="fieldset-legend text-xs pt-0">{legend}</legend>
      <div className="join">
        {options.map((option) => (
          <button
            key={option}
            id={`${idPrefix}-${option}`}
            type="button"
            aria-pressed={option === value}
            onClick={() => onPick(option)}
            className={optionClass(option === value)}
          >
            {labelOf(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The options popup's body: Chords, Bars per chord (hidden while Keep),
 * Borrowed, and a Roll that rolls with them. Exported for its render test.
 */
export function RollOptionsPanel({ dice }: { dice: UseProgressionDice }) {
  return (
    <div role="dialog" aria-label="Roll options" className="flex flex-col gap-3">
      <OptionRow
        idPrefix="btn-roll-chords"
        legend="Chords"
        options={CHORD_COUNT_OPTIONS}
        value={dice.chordCount}
        labelOf={(count) => (count === 'keep' ? 'Keep' : String(count))}
        onPick={dice.setChordCount}
      />
      {dice.chordCount !== 'keep' && (
        <OptionRow
          idPrefix="btn-roll-bars"
          legend="Bars per chord"
          options={BARS_PER_CHORD_OPTIONS}
          value={dice.barsPerChord}
          labelOf={String}
          onPick={dice.setBarsPerChord}
        />
      )}
      <label className="label gap-2 text-xs">
        <input
          id="chk-roll-borrowed"
          type="checkbox"
          className="toggle toggle-sm toggle-secondary"
          checked={dice.allowBorrowed && dice.borrowedAvailable}
          disabled={!dice.borrowedAvailable}
          onChange={(e) => dice.setAllowBorrowed(e.target.checked)}
        />
        Borrowed chords
      </label>
      {!dice.borrowedAvailable && (
        <p className="text-xs text-base-content/60">This scale has no borrowed chords.</p>
      )}
      <p className={`${HINT_TEXT} text-xs text-base-content/60`}>7ths follow Quick Add.</p>
      <button
        id="btn-roll-progression-apply"
        type="button"
        onClick={dice.rollFromOptions}
        className="btn btn-sm btn-secondary gap-1"
      >
        <Dices className="w-3.5 h-3.5" aria-hidden="true" />
        Roll
      </button>
    </div>
  );
}

/**
 * The Roll split button: the main half rolls with the current options, the
 * caret opens them in a `ui/Popup` (overlay kind popup, R325). Icon only
 * below `sm`, like its neighbours. The Popup wrapper is `flex` so the caret
 * keeps the join's height.
 */
export function RollProgressionButton({ dice }: { dice: UseProgressionDice }) {
  return (
    <div className="join">
      <button
        id="btn-roll-progression"
        type="button"
        onClick={dice.roll}
        aria-label="Roll progression"
        title="Roll a new progression in this key"
        className={`${ROLL_BUTTON} gap-1`}
      >
        <Dices className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Roll</span>
      </button>
      <Popup
        open={dice.optionsOpen}
        onClose={dice.closeOptions}
        align="end"
        className="flex"
        panelClassName={ROLL_PANEL}
        trigger={
          <button
            id="btn-roll-progression-options"
            type="button"
            onClick={dice.toggleOptions}
            aria-label="Roll options"
            aria-haspopup="dialog"
            aria-expanded={dice.optionsOpen}
            className={`${ROLL_BUTTON} px-1`}
          >
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        }
      >
        <RollOptionsPanel dice={dice} />
      </Popup>
    </div>
  );
}
```

- [ ] **Step 4: Render it from `ProgressionActions` and wire it through `ChordView`**

In `src/components/loop/chord/ProgressionCard.tsx`:

After `import { chordStartBars } from './chordStartBars';` add:

```tsx
import { RollProgressionButton } from './RollProgressionButton';
import type { UseProgressionDice } from './useProgressionDice';
```

In `interface ProgressionActionsProps`, after `onToggleAutoReharmonize: () => void;` add:

```tsx
  /** The Roll split button's state and actions, from `useProgressionDice` in ChordView. */
  dice: UseProgressionDice;
```

In `ProgressionActions`' destructuring, add `dice,` between `onToggleAutoReharmonize,` and `pasteButton,`. Directly after the Re-harmonize `</button>` (the one whose label is `<span className="hidden sm:inline">Re-harmonize</span>`) and before the Auto-Reharmonize toggle comment, insert:

```tsx

      {/* Roll a new progression in the key (ADR-0058); the caret holds its options. */}
      <RollProgressionButton dice={dice} />
```

In `export interface ProgressionCardProps`, after `previews: HeldChordPreview;` add `dice: UseProgressionDice;`. In `ProgressionCard`'s destructuring add `dice,` between `previews,` and `pasteButton,`, and in its `<ProgressionActions …>` add `dice={dice}` directly before `pasteButton={pasteButton}`.

In `src/components/loop/ChordView.tsx`:

After `} from './chord/useChordView';` add:

```tsx
import { useProgressionDice } from './chord/useProgressionDice';
```

After `const editor = useProgressionEditor(state, harmonize.clearReharmonizeBadge);` add:

```tsx
  const dice = useProgressionDice(editor.use7thsInQuickAdd, harmonize.clearReharmonizeBadge);
```

and in `<ProgressionCard …>` add `dice={dice}` directly after `previews={chordPreview}`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/components/loop/chord/RollProgressionButton.test.tsx src/components/loop/ChordView.test.tsx`
Expected: PASS (6 + 24 tests).

- [ ] **Step 6: Type-check, lint, both Knip scans**

Run: `bun run lint && bun run eslint && bun run check:dead-code && bun run check:dead-code:production`
Expected: no findings. The production scan is clean from here on: `ChordView` now reaches `useProgressionDice.ts`, `markovProgression.ts` and `RollProgressionButton.tsx`.

- [ ] **Step 7: Check it in the browser**

Start the preview from `.claude/launch.json` (config `solna-dev`: `bun run dev`, port 3000) and open `http://localhost:3000`. Go to the Loop layer → Pattern → Accompaniment; the progression card is on top. Record the decisive observations in `work/browser-evidence.md` (overwrite it; objective, selectors, observed state, conclusion). Check, with focused selector/text queries rather than full snapshots:

1. `#btn-roll-progression` sits after Re-harmonize as a joined pair with `#btn-roll-progression-options`, same height. Click Roll: the chords change, the count and each chord's bars stay (Keep), and a snackbar reads `Rolled …` with an Undo button `#btn-undo-roll-progression`.
2. Click Undo inside the window: the exact previous chords come back. Roll twice, then Undo: the chords from after the first roll come back.
3. Open the caret: the popup shows Chords (Keep pressed), no Bars row; choose 4: the Bars row appears; choose 2 bars, press the popup's Roll: the popup closes, focus returns to the caret, and the loop now has 4 chords × 2 bars (the loop length and the pattern bar options follow, as for a library apply). Escape and an outside click close the popup.
4. Borrowed on in C Major: over a few rolls a borrowed chord (♭VII, ♭VI, iv …) appears, never two in a row. Toggle Quick Add's 7ths: diatonic chords roll as 7ths, borrowed ones stay triads.
5. Start playback, then roll: the chords swap live with no stop or click.
6. Roll, change the key in the header, then press Undo: nothing changes.
7. Resize to 375px wide (mobile frame): Roll is icon-only, the caret stays joined, the popup opens inside the viewport, and the "7ths follow Quick Add." hint is hidden.
8. The browser console shows no new error or warning.

Fix anything that fails before committing, with a test first where the failure is testable.

- [ ] **Step 8: Commit**

```bash
git add src/components/loop/chord/RollProgressionButton.tsx src/components/loop/chord/RollProgressionButton.test.tsx src/components/loop/chord/ProgressionCard.tsx src/components/loop/ChordView.tsx src/components/loop/ChordView.test.tsx
git commit -m "feat(chord): add the Roll split button to the progression card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: ADR-0058, rules R361–R363, and the completion gate

**Files:**
- Create: `docs/decisions/0058-markov-chord-dice.md`
- Modify: `docs/decisions/README.md` (index row after `0057`)
- Modify: `.claude/rules/music-domain.md` (R281 line and its source line, a new `## Progression dice` section after `## Key change`, three `## Prohibited` items)

**Interfaces:**
- Consumes: the decisions and names of Tasks 1–6.
- Produces: ADR-0058; rules R361, R362, R363 (mirrored in the ADR's "Rules this implies").

No `paths:` change: `music-domain.md` already covers `src/components/loop/chord/**` and `src/store/chordsSlice.ts`. No CLAUDE.md change: no new rules file. Per CLAUDE.md, the ADR and rules name no version numbers, counts of live files or line numbers.

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0058-markov-chord-dice.md`:

```markdown
# ADR-0058: Markov chord dice

**Status:** Accepted — 2026-09-29. No issue.

## Context

The chord view could fill a progression from the library or one chord at a time from the Quick Add
palette, but it had no way to propose a whole new progression in the loop's key. A roll has to work
in every `SCALES` key: seven-degree modes, the five- and six-degree scales with a `parent`, the
harmony scales of ADR-0057, and the scales whose tonic is diminished (Locrian, Locrian #2,
Diminished) or augmented (Lydian Augmented, Whole Tone). It has to loop cleanly, because a
progression in Solna always repeats, and it has to be undoable, because it replaces the user's
chords and the custom chord and bass lanes that `chordsPatch` re-clamps against them.

## Decision

- **A Roll split button** in the progression card (`ProgressionActions` →
  `loop/chord/RollProgressionButton.tsx`) replaces the active loop's progression. Its caret opens a
  `ui/Popup` with Chords (Keep | 2 | 3 | 4 | 6 | 8), Bars per chord (1 | 2 | 4, hidden while Keep)
  and a Borrowed toggle. The options are local state in `loop/chord/useProgressionDice.ts`,
  never persisted. The 7ths choice is Quick Add's own toggle.
- **The generator** is `loop/chord/markovProgression.ts`: pure, no React and no store, with its
  randomness injected as `rng` (the call site passes `Math.random`; tests pass a seeded
  `mulberry32`). It is a first-order Markov chain over **root motion**:
  - States are the degrees of the harmony scale (`scaleEntry(harmonyKey(scaleType))`, R358), each
    with the degree's own quality as a triad or a 7th, plus, when Borrowed is on, the scale's
    `getBorrowedChords()` list with that list's own quality.
  - `w(a→b) = M[(b.semi − a.semi) mod 12] × Q[b.quality] × (b borrowed ? 0.15 : 1) × (b is the
    diatonic tonic ? 1.3 : 1)`. `M` favours a fourth up, then a sixth, a second and a fifth; `Q`
    is 1 for the major and minor families, 0.25 for diminished and half-diminished, 0.15 for
    augmented. `Q` is keyed on quality **tokens**, not on the registry's reharmonization category:
    category `altered` holds `aug` and also `minMaj7`, the 7ths tonic of Harmonic and Melodic
    Minor. The token map is a `Record` over `ChordQuality`, so a new registry token does not
    compile until it is bucketed.
  - The start is drawn by function (T, S, D, subtonic) among states of stable quality; a scale with
    none of those starts on its tonic.
  - **Rejection sampling** against five hard constraints: no immediate repeat (wrap included); a
    closing last→first motion with `M ≥ 0.4`; the tonic present from three chords up; at most
    `ceil(n/4)` borrowed chords, never adjacent; and a result that differs from the current
    progression. After the attempt budget it falls back to the latest attempt that passed the
    first four, else the last attempt. It never throws and never returns an empty progression.
  - The attempt budget is 500, not the 50 the design first named: measured over 2 000 rolls, 50
    left up to 6.5% of rolls in Lydian Augmented and Whole Tone with Borrowed on without a tonic or
    a closing motion; 500 left none.
- **A roll writes through the library-apply path**: `setChords` with fresh ids, then
  `clearReharmonizeBadge()`. Playback, the custom lanes, the loop length and the badge therefore
  behave exactly as they do for a library apply.
- **Undo** is a single-level snackbar through `useLoopUndo` (lifted from `song/` to the
  `src/components/` root now that two areas use it), key `btn-undo-roll-progression`, message
  `Rolled <roman>`. Its payload is a `ChordsSnapshot`: `chords` plus the six custom-lane fields,
  and the `loopId`, `scaleRoot`, `scaleType` and `meterId` it was taken under.
  `restoreChordsSnapshot` writes the seven fields back in one `set()` only while all four still
  match; otherwise it is a no-op. The key, scale and meter guard goes beyond the design, which
  guarded the loop only: without it an Undo after a key change would put old-key chords into the
  new key, and one after a meter change would put back holds clamped against another bar length.

Rejected:

- **Per-tonality degree matrices** (a Major table, a minor table). They are wrong for modes such as
  Lydian, Mixolydian and Harmonic Major, whose degrees move differently, and every table needs its
  own borrowed row. Root motion is the same fact in every scale.
- **Learning the chain from the chord library.** The library is sparse and biased to Major and
  minor, and a chain learned from it reproduces its entries verbatim.
- **An unconstrained Markov walk.** It neither closes the loop nor reliably reaches the tonic.

## Consequences

- The weights are starting values; the listening review in `CONTRIBUTING.md` tunes them. The
  constraints, not the weights, carry the guarantees, and the seeded tests pin the constraints.
- Rejection skews the start: the tonic leads about 62–66% of C Major four-chord rolls, not the
  ~41% its start weight (0.35 of 0.85) alone would give, because tonic-led attempts pass the tonic constraint more
  often. A later tuning of the start weights has to measure the rolled share, not read the table.
- A roll's numerals come from `degreeToRoman` (ASCII `b`) and the borrowed labels (`♭`), so the
  snackbar mixes the two glyphs, as the in-scale palette and borrowed badges already do.
- Undo restores the snapshot regardless of edits made after the roll, as long as the loop, key,
  scale and meter are unchanged.
- Out of scope: second-order chains, genre weights, a user seed, chord lock, a start-chord picker
  and persisting the options.

## Rules this implies

- **R361** — The progression generator is pure (no React, no store) and takes its randomness as an
  injected `rng`.
- **R362** — A roll writes through the library-apply path: `setChords` with fresh ids, then
  `clearReharmonizeBadge()`.
- **R363** — A roll's Undo snapshot holds the six custom-lane fields beside `chords`; it is restored
  in one `set()` and only onto the loop, key, scale and meter it was taken under.

## Sources

Spec: [`docs/superpowers/specs/2026-09-29-markov-chord-dice-design.md`](../superpowers/specs/2026-09-29-markov-chord-dice-design.md)
(commit `f58d399e`). Plan: `docs/superpowers/plans/2026-09-29-markov-chord-dice.md`.
```

- [ ] **Step 2: Add the index row**

In `docs/decisions/README.md`, directly after the `| [0057](0057-harmony-scales.md) | Harmony scales | … |` row, add:

```markdown
| [0058](0058-markov-chord-dice.md) | Markov chord dice | A Roll split button replaces the progression with a first-order Markov chain over root motion in the harmony scale, rejection-sampled against five loop constraints; the generator is pure with an injected `rng`; a roll writes like a library apply; a single-level Undo restores the chords and custom lanes only on the same loop, key, scale and meter; adds R361–R363. |
```

- [ ] **Step 3: Add the rules**

In `.claude/rules/music-domain.md`, replace the R281 bullet and the source line under it (end of `## Key change`):

```markdown
- The badge clears only where chords are replaced wholesale: a vibe's single write, `applyLoopCopy` with `chord-progression`, library apply, toggle off, the `reharmonizeNav.ts` subscription (loop change, project install), and `undoLoopKeyChange` restoring the active loop. <!-- R281 -->

([ADR-0032](../../docs/decisions/0032-key-change-as-loop-content-operation.md))
```

with:

```markdown
- The badge clears only where chords are replaced wholesale: a vibe's single write, `applyLoopCopy` with `chord-progression`, library apply, a progression roll, toggle off, the `reharmonizeNav.ts` subscription (loop change, project install), and `undoLoopKeyChange` restoring the active loop. <!-- R281 -->

([ADR-0032](../../docs/decisions/0032-key-change-as-loop-content-operation.md), [ADR-0058](../../docs/decisions/0058-markov-chord-dice.md))

## Progression dice

- The progression generator (`loop/chord/markovProgression.ts`) is pure — no React, no store — and takes its randomness as an injected `rng`; the call site passes `Math.random`, a test a seeded `mulberry32`. <!-- R361 -->
- A roll writes through the library-apply path: `setChords` with fresh ids, then `clearReharmonizeBadge()`. <!-- R362 -->
- A roll's Undo snapshot (`ChordsSnapshot`) holds the six custom-lane fields beside `chords`; `restoreChordsSnapshot` restores them in one `set()` and only while the active loop, `scaleRoot`, `scaleType` and `meterId` equal the snapshot's. <!-- R363 -->

([ADR-0058](../../docs/decisions/0058-markov-chord-dice.md))
```

and append to `## Prohibited`, after the R281 item:

```markdown
- `Math.random`, React or a store read inside the progression generator <!-- R361 -->
- A roll that writes chords other than through `setChords` with fresh ids, or skips `clearReharmonizeBadge()` <!-- R362 -->
- A roll Undo that restores `chords` without the six custom-lane fields, over more than one `set()`, or onto another loop, key, scale or meter <!-- R363 -->
```

- [ ] **Step 4: Check the ids and the no-version rule**

Run: `grep -rn "R36[1-3]" .claude/rules docs/decisions | wc -l` — expected `10` (six lines in `music-domain.md`, three in the ADR's rule list, one README row). Then run `grep -nE "v[0-9]+\.[0-9]+|line [0-9]+" docs/decisions/0058-markov-chord-dice.md` — expected: no output.

- [ ] **Step 5: Run the completion gate**

Run: `bun run verify`
Expected: exit 0 — every test passes (`0 fail`), tsc and ESLint print nothing, `check:keys`, `check:drums`, `check:contrast`, `check:levels` pass, both Knip scans print nothing, and `vite build` finishes. Then run `bun run eslint` on its own and confirm 0 errors and 0 warnings. Read the build and test output for any warning; fix or narrowly suppress each one with a reason, and list each decision in the summary.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0058-markov-chord-dice.md docs/decisions/README.md .claude/rules/music-domain.md
git commit -m "docs(decisions): record the Markov chord dice (ADR-0058, R361-R363)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** Goal/success criteria → Tasks 2, 5, 6, 7 (verify). User-facing behaviour: Roll, structure (Keep / counts / bars, empty loop) → Tasks 1, 5, 6; quality (7ths from Quick Add, borrowed with its own quality, disabled toggle + hint) → Tasks 1, 5, 6; automatic start → Tasks 1–2; Undo → Tasks 3, 5; playback and length side effects → library-apply path, Task 5 (`setChords`) and the Task 6 browser check; local, unpersisted options → Task 5. Architecture table → Tasks 1–6 (UI split into its own file, deviation 5). Algorithm (states, weights, M, Q, start, constraints, sampling, output) → Tasks 1–2 (budget, deviation 1). Undo section → Tasks 3, 5 (guard, deviation 2). UI → Task 6. Testing → Tasks 1–6. Docs → Task 7. Out of scope → nothing built.
- **Names used across tasks:** `generateProgression`, `resolveBars`, `buildChainStates`, `eligibleStartStates`, `transitionWeight`, `isStableQuality`, `ChainState`, `ProgressionInput`, `ProgressionResult`, `RollChordCount`, `RollBarsPerChord`, `ChordsSnapshot`, `chordsSnapshotOf`, `restoreChordsSnapshot`, `planRoll`, `performRoll`, `restoreRoll`, `rollUndoMessage`, `ROLL_UNDO_KEY`, `RollOptions`, `RollUndo`, `RollPlan`, `useProgressionDice`, `UseProgressionDice`, `RollProgressionButton`, `RollOptionsPanel`.
- **Review Focus tests:** 1 → Task 3 `is a no-op once the key root, scale type or meter changed` + Task 5 `Undo after a key change puts nothing back`; 2 → Task 5 `two rolls in a row`; 3 → Task 2 `a one-chord loop rolled with Keep`; 4 → Task 2 `scales whose tonic is diminished or augmented`; 5 → Task 1 `keep on an empty loop` + Task 5 `an empty loop rolled with Keep`.
- **Validation.** Every code block above was run in a scratch worktree of this branch before the plan was written: each task's tests fail before and pass after its implementation, and the final state passed `bun run verify` (all tests, tsc, ESLint 0/0, both Knip scans, build) with no warnings.
