# Vibe Variation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **PREREQUISITE — Project B1 lands first.** This plan consumes `CHORD_PROGRESSIONS`, `ChordProgression`, `progressionById`, `resolveProgression`, `VIBE_GENRE_SCALES` and `VibeGenre` from B1 (`docs/superpowers/specs/2026-08-26-progression-library-degrees-design.md`), plus `Hirajoshi` in `SCALES` and `asian-zen.scaleType === 'Hirajoshi'`. Do **not** start Task 4 until B1 is merged and `bun run verify` is green on it. Tasks 1–3 touch none of B1's surface and may be done in parallel with B1 if needed; Tasks 4–8 may not.

**Goal:** Add a dice button to the loaded Instant Vibe chip that rerolls the vibe into a different piece of music in the same genre — new key, progression, comp rhythm, bass pattern, BPM and drum decoration — while the genre's scale type, timbre and effects stay fixed, and the UI says what changed.

**Architecture:** One new pure module (`src/store/vibeVariation.ts`) holds the density catalogue, the injected-randomness draw, the resolver and the toast formatter. The resolver returns a whole `InstantVibe`, which the caller hands to the **unmodified** `applyInstantVibeToStore`. There is therefore no second apply path: the synchronous `audioEngine.stopSource('chord'|'bass', 0.02)` cut and the bar-grid rewind are inherited, not re-implemented. No new store slice, no new store state, no engine call, no persist version bump.

**Tech Stack:** Bun (test runner + scripts), Vite, React 18, Zustand (`subscribeWithSelector` + `persist`), raw Web Audio API, `tonal` for theory, Tailwind v4 + daisyUI v5 (CSS-first, no `tailwind.config.*`), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-08-26-vibe-variation-engine-design.md`

## Global Constraints

- **Layering (enforced by eslint `no-restricted-imports`):** `src/audio/` must not import `store/` or `components/`. `src/store/` must not import `components/`. `src/components/` must not import `audio/engine` — only the `audio/playback/playbackEngine.ts` bridge. **`src/store/` importing `src/audio/` IS allowed** (`engineSync.ts` already does it), which is what lets `vibeVariation.ts` read `CHORD_PROGRESSIONS`, `RHYTHM_PATTERNS` and `BASS_PATTERNS`.
- **Never call engine setters from a component.** Store-state → engine sync lives in `src/store/engineSync.ts`; event-driven playback goes through `playbackEngine.ts`. This plan adds **no** engine call anywhere.
- **Theme tokens only.** `scripts/themeTokenGuard.ts` bans raw hex, Tailwind palette classes (`indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), `text-white`/`bg-black`, the `dark:` variant, `rgb()`/`rgba()` literals, and dead utilities (`py-0.2`, `scale-102`, `z-60`, `xs:`). Its `ALLOWLIST` is empty and must stay empty.
- **Look up daisyUI v5 docs before writing any daisyUI class.** A class that does not exist in v5 emits no CSS and fails silently; the theme guard does not catch invented names. Every daisyUI class in this plan was checked against the v5 docs before it was written: `join`, `join-item` (Join); `btn`, `btn-xs`, `btn-primary`, `btn-soft`, `btn-square`, `btn-ghost` (Button); `toast`, `toast-top`, `toast-end` (Toast); `alert`, `alert-soft`, `alert-info`, `alert-success` (Alert). All exist. Do not add one that is not on this list without repeating the lookup.
- **Tests are pure-logic `bun:test`.** No DOM or testing-library setup; components export their testable helpers and tests import those. `renderToString` cannot observe `useAppStore.setState` under zustand v5 (`getServerSnapshot` reads `getInitialState()`) — `InstantVibesBar.test.tsx` documents this, so do not try to assert rerolled markup through it.
- **Gate:** `bun run verify` (test + lint + check:keys + check:drums + build). Run `bun run eslint` separately — `verify` does not include it, and this work adds cross-layer imports.
- Theory lives in `src/utils/musicTheory.ts` (pure). `SCALES` is hand-authored; **Pentatonic, Blues and Hirajoshi have 5–6 degrees — never assume 7.** Loop `SCALES[scaleType].intervals.length`.
- `deriveChordNotes()` is the single source of truth for `ChordItem.notes`. This plan never builds a `notes` array by hand — `resolveProgression` does it.
- **A reroll routes through `applyInstantVibeToStore` unmodified.** That function is where `hardStopAll()`, the synchronous `audioEngine.stopSource('chord', 0.02)` / `stopSource('bass', 0.02)` cut, and the selective restart live. Adding a second apply path would reintroduce the overlapping-audio bug fixed in commit `c4a253a`. `src/store/instantVibes.ts`'s `applyInstantVibeToStore` body is **not modified by any task in this plan**.
- **Randomness is injected.** `Math.random` appears in exactly one place in this feature: the `createDraw(Math.random)` call inside `rerollVibe`. Every function below it takes a `VibeDraw`. No `Math.random()` in `vibeVariation.ts`, and none in any test.
- Drum rows are 16 steps (`STEPS_PER_BAR` is 16). Hard-stop release is `0.02` seconds (`VIBE_SWAP_RELEASE`).
- The app has no users. Persisted vibe ids and store shapes are not compatibility constraints, but the `InstantVibe` **ids** still must not be renamed — `resolveSelectedVibeId` and the Instant Vibes id/label drift (`cyber-dance` → "Cyber EDM" etc.) are load-bearing.

## B1 symbols this plan consumes, named exactly as B1 defines them

| symbol | module | used by |
| --- | --- | --- |
| `VibeGenre` | declared in `src/types.ts`, re-exported from `src/audio/data/chordProgressions.ts` | Task 3 (`VibeVariation.genre`) |
| `ChordProgression` | `src/audio/data/chordProgressions.ts` | Tasks 4, 5 |
| `CHORD_PROGRESSIONS` | `src/audio/data/chordProgressions.ts` | Tasks 4, 5 |
| `progressionById(id: string): ChordProgression \| undefined` | `src/audio/data/chordProgressions.ts` | Task 5 |
| `resolveProgression(progression, scaleRoot, scaleType, octave?): ChordItem[]` | `src/audio/data/chordProgressions.ts` | Task 5 |
| `VIBE_GENRE_SCALES: Record<VibeGenre, string>` | `src/audio/data/chordProgressions.ts` | Task 4 |
| `ChordProgression.genres: VibeGenre[]` / `.minScaleLength: number` / `.roman: string` / `.name: string` | same | Tasks 4, 5, 6 |
| `SCALES` with a `'Hirajoshi'` key (5 intervals) | `src/utils/musicTheory.ts` | Task 4 |
| `asian-zen.scaleType === 'Hirajoshi'` | `src/store/instantVibes.ts` (B1 edits it) | Task 4 |

B2 uses **neither** `transposeProgression` nor `snapProgressionToScale`. A reroll re-resolves the chosen progression from its degrees directly in the drawn key, so it is structurally immune to the auto-harmonize bug. The one external way that immunity can be undone is `ChordView`'s effect, which B1's `chordsReplaced` identity guard closes; B2 adds nothing there.

---

### Task 1: The drum density catalogue

The fixed catalogue of one-bar decoration rows the dice picks between. Pure data plus its invariants. Nothing consumes it yet.

**Files:**
- Modify: `src/types.ts` (append `DecorationLayer` and `DensityName`)
- Create: `src/store/vibeVariation.ts`
- Test: `src/store/vibeVariation.test.ts` (create)

**Interfaces:**
- Consumes: `INSTANT_VIBES` from `src/store/instantVibes.ts` (test only).
- Produces: `DecorationLayer`, `DensityName` (types), `DRUM_DENSITIES`, `DECORATION_ORDER`, `LAYER_LABELS`.

- [ ] **Step 1: Write the failing test**

Create `src/store/vibeVariation.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { INSTANT_VIBES } from './instantVibes';
import { DECORATION_ORDER, DRUM_DENSITIES, LAYER_LABELS } from './vibeVariation';

function vibe(id: string) {
  const found = INSTANT_VIBES.find((v) => v.id === id);
  if (!found) throw new Error(`no vibe ${id}`);
  return found;
}

describe('DRUM_DENSITIES', () => {
  test('every row is one bar of sixteenths and holds only 0 or 1', () => {
    for (const [name, row] of Object.entries(DRUM_DENSITIES)) {
      expect(row.length).toBe(16);
      for (const step of row) {
        expect(step === 0 || step === 1).toBe(true);
      }
      // guards against a row authored as a nested array by mistake
      expect(Array.isArray(row[0])).toBe(false);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test('`off` is silent — it is the fallback that keeps a filtered pool non-empty', () => {
    expect(DRUM_DENSITIES.off.some((s) => s === 1)).toBe(false);
  });

  // Spec invariant 6b. Read from INSTANT_VIBES rather than a copied literal so
  // an edit to either side fails: if these two drift, the reroll toast names a
  // pattern the user is not hearing.
  test('the two genre-named rows equal the authored hats they are named after', () => {
    expect(DRUM_DENSITIES.lofi16ths).toEqual(vibe('lofi-chill').drumPattern.hihat);
    expect(DRUM_DENSITIES.swung16ths).toEqual(vibe('hiphop-groove').drumPattern.hihat);
  });
});

describe('decoration layer metadata', () => {
  test('the draw order is fixed and covers exactly the four decoration layers', () => {
    expect(DECORATION_ORDER).toEqual(['hihat', 'openhat', 'tom', 'crash']);
  });

  test('every layer has a toast label', () => {
    expect(DECORATION_ORDER.map((l) => LAYER_LABELS[l])).toEqual(['hats', 'open', 'tom', 'crash']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: FAIL — `Cannot find module './vibeVariation'`.

- [ ] **Step 3: Add the two type names**

Append to `src/types.ts`:

```ts
/**
 * Drum layers the Vibe Variation dice may rewrite. `kick`, `snare` and `clap`
 * are the genre's skeleton and are deliberately not assignable here, so no
 * draw can move the pulse or the backbeat.
 */
export type DecorationLayer = 'hihat' | 'openhat' | 'tom' | 'crash';

/** A named row in DRUM_DENSITIES. Named, not generated: the UI reports it. */
export type DensityName =
  | 'off' | 'downbeat' | 'halves' | 'backbeat' | 'quarters'
  | 'offbeat8ths' | 'and2and4' | 'eighths' | 'swung16ths' | 'lofi16ths'
  | 'sixteenths' | 'pickup' | 'lateFill' | 'fillTail' | 'midBar';
```

- [ ] **Step 4: Write the catalogue**

Create `src/store/vibeVariation.ts`:

```ts
import type { DecorationLayer, DensityName } from '../types';

/**
 * One bar of sixteenths, step 0 = beat 1. Every row is either a regular
 * subdivision of the bar or a fixed one-bar figure in a genre's idiom. None is
 * generated: a per-step coin flip produces rows with no relationship to the
 * pulse, which is exactly what this catalogue exists to prevent.
 */
export const DRUM_DENSITIES: Record<DensityName, number[]> = {
  off:          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  downbeat:     [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  halves:       [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  backbeat:     [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  quarters:     [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  offbeat8ths:  [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  and2and4:     [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  eighths:      [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  // Verified byte-for-byte against hiphop-groove's authored hihat row.
  swung16ths:   [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
  // Verified byte-for-byte against lofi-chill's authored hihat row.
  lofi16ths:    [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
  sixteenths:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  pickup:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  midBar:       [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  lateFill:     [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
  fillTail:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
};

/**
 * The order layers are drawn in and printed in. Fixed so a scripted draw can
 * name an exact combination and the toast reads the same way every time.
 */
export const DECORATION_ORDER: DecorationLayer[] = ['hihat', 'openhat', 'tom', 'crash'];

/** Short names for the toast's drum segment. */
export const LAYER_LABELS: Record<DecorationLayer, string> = {
  hihat: 'hats',
  openhat: 'open',
  tom: 'tom',
  crash: 'crash',
};
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/store/vibeVariation.ts src/store/vibeVariation.test.ts
git commit -m "feat(vibes): add the drum decoration density catalogue"
```

---

### Task 2: The injected draw

The only randomness boundary in the feature. `createDraw(random)` wraps an injected `() => number`; every consumer takes the resulting `VibeDraw`. The test fixtures created here are what make every later task deterministic.

**Files:**
- Modify: `src/store/vibeVariation.ts`
- Test: `src/store/vibeVariation.test.ts` (add a describe block)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `VibeDraw`, `createDraw(random: () => number): VibeDraw`, and the test-only fixtures `firstDraw`, `lastDraw`, `scriptedDraw(indices: number[])` exported from `src/store/vibeVariationFixtures.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/store/vibeVariation.test.ts`:

```ts
import { createDraw } from './vibeVariation';
import { firstDraw, lastDraw, scriptedDraw } from './vibeVariationFixtures';

describe('createDraw', () => {
  // Three exact cases, not statistics: the bottom of the range, the middle,
  // and the value just under 1 that a naive `* length` would round past the end.
  const stub = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  test('pick maps [0, 1) onto the whole index range', () => {
    expect(createDraw(stub([0])).pick(['a', 'b', 'c'])).toBe('a');
    expect(createDraw(stub([0.5])).pick(['a', 'b', 'c'])).toBe('b');
    expect(createDraw(stub([0.999999])).pick(['a', 'b', 'c'])).toBe('c');
  });

  test('pick throws on an empty list — an empty pool is an authoring bug', () => {
    expect(() => createDraw(stub([0])).pick([])).toThrow();
  });

  test('int is inclusive at both ends', () => {
    expect(createDraw(stub([0])).int(126, 130)).toBe(126);
    expect(createDraw(stub([0.5])).int(126, 130)).toBe(128);
    expect(createDraw(stub([0.999999])).int(126, 130)).toBe(130);
  });

  test('int returns min when min equals max', () => {
    expect(createDraw(stub([0.999999])).int(84, 84)).toBe(84);
  });

  test('pickDistinct never returns current when the pool has two or more members', () => {
    for (const r of [0, 0.34, 0.5, 0.999999]) {
      expect(createDraw(stub([r])).pickDistinct(['a', 'b', 'c'], 'b')).not.toBe('b');
    }
  });

  test('pickDistinct falls back to current only when it is the sole member', () => {
    expect(createDraw(stub([0])).pickDistinct(['a'], 'a')).toBe('a');
  });

  test('pickDistinct with a current outside the pool is a plain pick', () => {
    expect(createDraw(stub([0])).pickDistinct(['a', 'b'], 'z')).toBe('a');
    expect(createDraw(stub([0.999999])).pickDistinct(['a', 'b'], 'z')).toBe('b');
  });
});

describe('draw fixtures', () => {
  test('firstDraw takes the first eligible item and the bottom of a range', () => {
    expect(firstDraw.pick(['a', 'b', 'c'])).toBe('a');
    expect(firstDraw.pickDistinct(['a', 'b', 'c'], 'a')).toBe('b');
    expect(firstDraw.int(70, 90)).toBe(70);
  });

  test('lastDraw takes the last eligible item and the top of a range', () => {
    expect(lastDraw.pick(['a', 'b', 'c'])).toBe('c');
    expect(lastDraw.pickDistinct(['a', 'b', 'c'], 'c')).toBe('b');
    expect(lastDraw.int(70, 90)).toBe(90);
  });

  test('scriptedDraw consumes one index per call, in call order', () => {
    const d = scriptedDraw([2, 0, 1]);
    expect(d.pick(['a', 'b', 'c'])).toBe('c');
    expect(d.pick(['a', 'b', 'c'])).toBe('a');
    expect(d.pick(['a', 'b', 'c'])).toBe('b');
  });

  test('scriptedDraw indexes the eligible list, so pickDistinct skips current', () => {
    // eligible for current 'b' is ['a', 'c']; index 1 is therefore 'c'
    expect(scriptedDraw([1]).pickDistinct(['a', 'b', 'c'], 'b')).toBe('c');
  });

  test('scriptedDraw int walks the range from min', () => {
    expect(scriptedDraw([3]).int(80, 90)).toBe(83);
  });

  test('scriptedDraw throws when the script runs out — a silent wrap would hide a draw-order change', () => {
    const d = scriptedDraw([0]);
    d.pick(['a']);
    expect(() => d.pick(['a'])).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: FAIL — `createDraw` is not exported and `./vibeVariationFixtures` does not exist.

- [ ] **Step 3: Write the draw**

Append to `src/store/vibeVariation.ts`:

```ts
/**
 * The randomness boundary. Every function that varies a vibe takes one of
 * these; none of them calls Math.random. That is what makes the draw policy
 * testable by enumeration instead of by chance.
 */
export interface VibeDraw {
  /** Uniform choice. Throws on an empty list — an empty pool is an authoring bug. */
  pick<T>(items: T[]): T;
  /**
   * Uniform choice excluding `current`. Falls back to `current` only when it is
   * the sole member of `items`.
   */
  pickDistinct<T>(items: T[], current: T): T;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
}

export function createDraw(random: () => number): VibeDraw {
  const pick = <T,>(items: T[]): T => {
    if (items.length === 0) {
      throw new Error('VibeDraw.pick: empty pool');
    }
    // Math.min guards the random() === 1 edge some RNGs allow.
    const index = Math.min(items.length - 1, Math.floor(random() * items.length));
    return items[index];
  };

  return {
    pick,
    pickDistinct: <T,>(items: T[], current: T): T => {
      const eligible = items.filter((item) => item !== current);
      return eligible.length === 0 ? current : pick(eligible);
    },
    int: (min: number, max: number): number =>
      min + Math.min(max - min, Math.floor(random() * (max - min + 1))),
  };
}
```

- [ ] **Step 4: Write the fixtures**

Create `src/store/vibeVariationFixtures.ts`:

```ts
import type { VibeDraw } from './vibeVariation';

/**
 * Deterministic VibeDraw implementations for tests. They live in their own
 * module rather than in a test file so several test files can share them
 * without importing each other. Nothing in src/ ships them to the app.
 */

/** Always the first eligible item; `int` returns `min`. */
export const firstDraw: VibeDraw = {
  pick: <T,>(items: T[]): T => {
    if (items.length === 0) throw new Error('firstDraw.pick: empty pool');
    return items[0];
  },
  pickDistinct: <T,>(items: T[], current: T): T => {
    const eligible = items.filter((item) => item !== current);
    return eligible.length === 0 ? current : eligible[0];
  },
  int: (min: number): number => min,
};

/** Always the last eligible item; `int` returns `max`. */
export const lastDraw: VibeDraw = {
  pick: <T,>(items: T[]): T => {
    if (items.length === 0) throw new Error('lastDraw.pick: empty pool');
    return items[items.length - 1];
  },
  pickDistinct: <T,>(items: T[], current: T): T => {
    const eligible = items.filter((item) => item !== current);
    return eligible.length === 0 ? current : eligible[eligible.length - 1];
  },
  int: (_min: number, max: number): number => max,
};

/**
 * Consumes a fixed list of indices, one per call, in call order. Indices
 * address the *eligible* list, so `pickDistinct` is scripted the same way as
 * `pick`. `int` treats the index as an offset from `min`.
 *
 * It throws when the script runs out rather than wrapping: a silent wrap would
 * let a change to the resolver's draw order pass a test that pins an exact
 * InstantVibe.
 */
export function scriptedDraw(indices: number[]): VibeDraw {
  let cursor = 0;
  const next = (limit: number): number => {
    if (cursor >= indices.length) {
      throw new Error(`scriptedDraw: script exhausted after ${indices.length} draws`);
    }
    const index = indices[cursor];
    cursor += 1;
    if (index < 0 || index >= limit) {
      throw new Error(`scriptedDraw: index ${index} out of range for ${limit} candidates`);
    }
    return index;
  };

  return {
    pick: <T,>(items: T[]): T => {
      if (items.length === 0) throw new Error('scriptedDraw.pick: empty pool');
      return items[next(items.length)];
    },
    pickDistinct: <T,>(items: T[], current: T): T => {
      const eligible = items.filter((item) => item !== current);
      return eligible.length === 0 ? current : eligible[next(eligible.length)];
    },
    int: (min: number, max: number): number => min + next(max - min + 1),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/vibeVariation.ts src/store/vibeVariationFixtures.ts src/store/vibeVariation.test.ts
git commit -m "feat(vibes): add the injected VibeDraw and its deterministic fixtures"
```

---

### Task 3: Move `InstantVibe` into `src/types.ts` and declare the variation types

Type-only refactor. `InstantVibe` joins `SynthParams`, `ChordItem` and `MasterEffects` in `src/types.ts` so `vibeVariation.ts` can take an `InstantVibe` while `instantVibes.ts` takes `DrumDecorationRule` — without the two modules importing each other. No re-export shim is kept; the app has no users and there are three importers.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store/instantVibes.ts:1-43` (the import line and the `InstantVibe` interface)
- Modify: `src/components/InstantVibesBar.tsx:3` (the import)
- Modify: `src/components/InstantVibesBar.test.tsx` (only if it imports the type)

**Interfaces:**
- Consumes: `VibeGenre` from `src/types.ts` — **B1 declares it there** (cross-check ruling R3) and re-exports it from `src/audio/data/chordProgressions.ts`. Do not re-declare it.
- Produces: `InstantVibe`, `DrumDecorationRule`, `VibeVariation` in `src/types.ts`; `InstantVibe.variation?: VibeVariation`.

- [ ] **Step 1: Confirm B1 has landed**

```bash
grep -n "export type VibeGenre" src/types.ts
grep -n "VibeGenre" src/audio/data/chordProgressions.ts | head -3
grep -n "scaleType: 'Hirajoshi'" src/store/instantVibes.ts
```

Expected: `VibeGenre` is declared in `src/types.ts`, re-exported from `chordProgressions.ts`, and `asian-zen` is on `Hirajoshi`. If any line is missing, stop — B1 is not merged and Tasks 3–8 cannot proceed.

- [ ] **Step 2: Add the variation types**

Append to `src/types.ts`, after the `DensityName` declaration from Task 1:

```ts
export interface DrumDecorationRule {
  /**
   * Layers the dice may rewrite. Authoritative: a layer absent here is never
   * rewritten even if `densities` has an entry for it. `kick`, `snare` and
   * `clap` are not assignable to DecorationLayer, so they can never be listed.
   */
  layers: DecorationLayer[];
  /**
   * Named density choices the dice picks between, per layer. Must contain an
   * entry for every layer in `layers` and no others — which is why this is
   * Partial: the total form would demand an entry for a layer the vibe
   * deliberately leaves out. The exact-match half is an invariant test.
   */
  densities: Partial<Record<DecorationLayer, DensityName[]>>;
}

export interface VibeVariation {
  /** Which progressions in CHORD_PROGRESSIONS this vibe may draw. */
  genre: VibeGenre;
  /** Roots that suit the genre. The dice picks one. Always contains the vibe's own. */
  keyPool: string[];
  /** Inclusive [min, max] integer BPM. Always contains the vibe's own. */
  bpmRange: [number, number];
  /** Ids into CHORD_PROGRESSIONS. */
  progressionIds: string[];
  /** Ids into RHYTHM_PATTERNS. Always contains the vibe's own chordRhythmId. */
  rhythmIds: string[];
  /** Ids into BASS_PATTERNS. Always contains the vibe's own bassPatternId. */
  bassPatternIds: string[];
  drumDecoration: DrumDecorationRule;
}
```

- [ ] **Step 3: Move the `InstantVibe` interface**

Cut the whole `export interface InstantVibe { ... }` block from `src/store/instantVibes.ts:7-43` and paste it into `src/types.ts` after `VibeVariation`, adding one field at the end of the interface:

```ts
  /** Master Effects */
  effects: Partial<MasterEffects>;

  /**
   * Vibe Variation rule for the dice button. Optional, so a vibe without one
   * simply has no dice — but all six ship one, which an invariant test pins.
   */
  variation?: VibeVariation;
}
```

`src/types.ts` stays a leaf module: every type `InstantVibe` references (`SynthParams`, `MasterEffects`, `ChordItem`, `FilterType`, `VibeGenre`) is already declared in that same file.

- [ ] **Step 4: Update the three importers**

`src/store/instantVibes.ts:1` becomes:

```ts
import { SynthParams, ChordItem, InstantVibe } from '../types';
```

`FilterType` and `MasterEffects` were referenced only by the moved interface. `buildSynthParams` still returns `SynthParams` and `makeVibeChord` still returns `ChordItem`, so those two stay. Confirm before deleting:

```bash
grep -n "FilterType\|MasterEffects\|SynthParams\|ChordItem" src/store/instantVibes.ts
```

Drop from the import any name that now appears only on that import line — `tsc --noEmit` in Step 5 will fail on an unused one only if `noUnusedLocals` is on, so check by hand.

`src/components/InstantVibesBar.tsx:3` becomes:

```ts
import { INSTANT_VIBES, applyInstantVibeToStore } from '../store/instantVibes';
import type { InstantVibe } from '../types';
```

Then:

```bash
grep -rn "InstantVibe" src --include=*.ts --include=*.tsx | grep -v "INSTANT_VIBES\|InstantVibesBar\|applyInstantVibeToStore"
```

Every remaining hit must import the type from `../types`, not from `./instantVibes`.

- [ ] **Step 5: Run the gate**

```bash
bun run verify && bun run eslint
```

Expected: PASS. A type move has no runtime behaviour to test; `tsc --noEmit` inside `verify` is the check, and every existing `instantVibes` / `InstantVibesBar` test still passes unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/store/instantVibes.ts src/components/InstantVibesBar.tsx src/components/InstantVibesBar.test.tsx
git commit -m "refactor(types): move InstantVibe to types.ts and declare the variation types"
```

---

### Task 4: Author the variation data for all six vibes

Data only. Every pool comes from the spec's tables; `progressionIds` is **derived** from B1's library by the genre-and-scale-length rule and pinned by a test that recomputes the filter, so it cannot drift when B1 adds a progression.

**Files:**
- Modify: `src/store/instantVibes.ts` (add a `variation` block to each of the six vibes)
- Test: `src/store/vibeVariation.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `VibeVariation` / `DrumDecorationRule` (Task 3), `DRUM_DENSITIES` / `DECORATION_ORDER` (Task 1), `CHORD_PROGRESSIONS`, `VIBE_GENRE_SCALES`, `ChordProgression` (B1), `RHYTHM_PATTERNS`, `BASS_PATTERNS`, `ROOTS`, `SCALES`.
- Produces: `INSTANT_VIBES[n].variation` for all six vibes.

- [ ] **Step 1: Write the failing test**

Append to `src/store/vibeVariation.test.ts`:

```ts
import { BASS_PATTERNS } from '../audio/bassPatterns';
import { RHYTHM_PATTERNS } from '../audio/rhythmPatterns';
import { CHORD_PROGRESSIONS, VIBE_GENRE_SCALES } from '../audio/data/chordProgressions';
import { ROOTS, SCALES } from '../utils/musicTheory';
import type { DecorationLayer } from '../types';

const COLLISION_FILTERED: DecorationLayer[] = ['openhat', 'tom'];

function scaleLength(scaleType: string): number {
  return SCALES[scaleType]?.intervals.length ?? 7;
}

describe('authored variation data', () => {
  test('every vibe ships a variation rule', () => {
    for (const v of INSTANT_VIBES) {
      expect(v.variation).toBeDefined();
    }
  });

  test('the dice can always land back on the vibe as authored', () => {
    for (const v of INSTANT_VIBES) {
      const r = v.variation!;
      expect(r.keyPool).toContain(v.scaleRoot);
      expect(r.bpmRange[0]).toBeLessThanOrEqual(r.bpmRange[1]);
      expect(v.bpm).toBeGreaterThanOrEqual(r.bpmRange[0]);
      expect(v.bpm).toBeLessThanOrEqual(r.bpmRange[1]);
      expect(r.rhythmIds).toContain(v.chordRhythmId);
      expect(r.bassPatternIds).toContain(v.bassPatternId);
    }
  });

  test('every id in every pool resolves', () => {
    for (const v of INSTANT_VIBES) {
      const r = v.variation!;
      for (const root of r.keyPool) expect(ROOTS).toContain(root);
      for (const id of r.rhythmIds) {
        expect(RHYTHM_PATTERNS.some((p) => p.id === id)).toBe(true);
      }
      for (const id of r.bassPatternIds) {
        expect(BASS_PATTERNS.some((p) => p.id === id)).toBe(true);
      }
      for (const id of r.progressionIds) {
        const p = CHORD_PROGRESSIONS.find((c) => c.id === id);
        expect(p).toBeDefined();
        expect(p!.genres).toContain(r.genre);
        expect(p!.minScaleLength).toBeLessThanOrEqual(scaleLength(v.scaleType));
      }
    }
  });

  test('every pool is non-empty and free of duplicates', () => {
    for (const v of INSTANT_VIBES) {
      const r = v.variation!;
      const pools = [r.keyPool, r.rhythmIds, r.bassPatternIds, r.progressionIds];
      for (const pool of pools) {
        expect(pool.length).toBeGreaterThan(0);
        expect(new Set(pool).size).toBe(pool.length);
      }
    }
  });

  test('the vibe genre and its scale type agree with B1 VIBE_GENRE_SCALES', () => {
    for (const v of INSTANT_VIBES) {
      expect(v.scaleType).toBe(VIBE_GENRE_SCALES[v.variation!.genre]);
    }
  });

  // This is what catches drift when B1 adds or retags a progression: the field
  // is data, but its value is the output of a rule, so the rule is recomputed.
  test('progressionIds equals the full genre-and-scale-length filter', () => {
    for (const v of INSTANT_VIBES) {
      const r = v.variation!;
      const expected = CHORD_PROGRESSIONS.filter(
        (p) => p.genres.includes(r.genre) && p.minScaleLength <= scaleLength(v.scaleType),
      ).map((p) => p.id);
      expect([...r.progressionIds].sort()).toEqual([...expected].sort());
      expect(r.progressionIds.length).toBeGreaterThanOrEqual(4);
    }
  });

  test('densities has an entry for every layer in layers and no others', () => {
    for (const v of INSTANT_VIBES) {
      const { layers, densities } = v.variation!.drumDecoration;
      expect([...Object.keys(densities)].sort()).toEqual([...layers].sort());
      for (const layer of layers) {
        const pool = densities[layer]!;
        expect(pool.length).toBeGreaterThan(0);
        expect(new Set(pool).size).toBe(pool.length);
        for (const name of pool) expect(DRUM_DENSITIES[name]).toBeDefined();
      }
    }
  });

  test('after the kick-collision filter, openhat and tom still have a candidate', () => {
    for (const v of INSTANT_VIBES) {
      const { layers, densities } = v.variation!.drumDecoration;
      const kick = v.drumPattern.kick;
      for (const layer of layers) {
        if (!COLLISION_FILTERED.includes(layer)) continue;
        const survivors = densities[layer]!.filter(
          (name) => !DRUM_DENSITIES[name].some((hit, i) => hit === 1 && kick[i] === 1),
        );
        expect(survivors.length).toBeGreaterThan(0);
      }
    }
  });

  // Pins the one measured cost of the collision filter, so a later kick edit
  // that quietly empties more of the pool shows up as a failing count.
  test('the filter removes exactly one candidate across all authored data', () => {
    let removed = 0;
    for (const v of INSTANT_VIBES) {
      const { layers, densities } = v.variation!.drumDecoration;
      const kick = v.drumPattern.kick;
      for (const layer of layers) {
        if (!COLLISION_FILTERED.includes(layer)) continue;
        removed += densities[layer]!.filter((name) =>
          DRUM_DENSITIES[name].some((hit, i) => hit === 1 && kick[i] === 1),
        ).length;
      }
    }
    // hiphop-groove's kick hits step 6, which is `and2and4`'s first hit.
    expect(removed).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: FAIL — `v.variation` is `undefined` for every vibe.

- [ ] **Step 3: Derive `progressionIds` from the library B1 shipped**

Do not hand-guess the ids. Print them:

The script lives in the repo, not `/tmp`: Bun resolves relative imports against the script's own directory, so a `/tmp` copy cannot see `src/`.

```bash
cat > scripts/tmp-derive-progression-ids.ts <<'EOF'
import { CHORD_PROGRESSIONS } from '../src/audio/data/chordProgressions';
import { INSTANT_VIBES } from '../src/store/instantVibes';
import { SCALES } from '../src/utils/musicTheory';

const GENRE: Record<string, string> = {
  'lofi-chill': 'lofi',
  'synthwave-80s': 'synthwave',
  'cyber-dance': 'edm',
  'ambient-chill': 'ambient',
  'hiphop-groove': 'boombap',
  'asian-zen': 'zen',
};

for (const v of INSTANT_VIBES) {
  const len = SCALES[v.scaleType]?.intervals.length ?? 7;
  const ids = CHORD_PROGRESSIONS.filter(
    (p) => p.genres.includes(GENRE[v.id] as never) && p.minScaleLength <= len,
  ).map((p) => p.id);
  console.log(`${v.id} (${GENRE[v.id]}, ${v.scaleType}, ${len} degrees): ${ids.length}`);
  console.log(`  ${JSON.stringify(ids)}`);
}
EOF
bun run scripts/tmp-derive-progression-ids.ts
```

Expected: four or more ids for every vibe (cross-check ruling R4). If any vibe prints fewer than four, stop — B1 did not ship the agreed coverage and Task 4 cannot be completed honestly. Paste each printed array verbatim into the matching `progressionIds` in Step 4.

- [ ] **Step 4: Author the six variation blocks**

Add a `variation` property to each vibe in `src/store/instantVibes.ts`, immediately after its `effects` block. `<paste from Step 3>` is the array Step 3 printed for that vibe.

```ts
    // lofi-chill
    variation: {
      genre: 'lofi',
      // The jazz/soul record keys lo-fi samples from. Full lower-to-middle
      // span: its bass is filtered at 260 Hz, so a deep half-audible sub is
      // the genre's texture rather than a fault.
      keyPool: ['C', 'D', 'D#', 'F', 'G', 'A'],
      bpmRange: [78, 88],
      progressionIds: [/* <paste from Step 3> */],
      rhythmIds: ['lofiSwing', 'syncopatedPush', 'bassPlusStrum'],
      bassPatternIds: ['dilla-sub', 'walking-groove', 'half-time-legato'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['lofi16ths', 'eighths', 'swung16ths'],
          openhat: ['off', 'and2and4', 'pickup'],
          tom: ['off', 'pickup', 'fillTail'],
          crash: ['off', 'downbeat'],
        },
      },
    },
```

```ts
    // synthwave-80s
    variation: {
      genre: 'synthwave',
      // Starts at D so the Saw Growl sub-osc (0.6, one octave down) stays above
      // ~37 Hz; stops at A so the Neon Pluck stack at octave 4 keeps headroom
      // under the arp's two octaves.
      keyPool: ['D', 'E', 'F', 'F#', 'G', 'A'],
      bpmRange: [108, 118],
      progressionIds: [/* <paste from Step 3> */],
      rhythmIds: ['eighthPads', 'fourOnFloor', 'popBallad8ths'],
      bassPatternIds: ['driving-eighths', 'offbeat-sub', 'root-fifth-walk'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['sixteenths', 'eighths', 'offbeat8ths'],
          openhat: ['off', 'offbeat8ths', 'pickup'],
          tom: ['off', 'fillTail', 'lateFill'],
          crash: ['off', 'downbeat'],
        },
      },
    },
```

```ts
    // cyber-dance
    variation: {
      genre: 'edm',
      // The club-minor band. Starts at D#, one step above synthwave, because
      // the Punchy Square carries more sub weight (0.7).
      keyPool: ['D#', 'E', 'F', 'F#', 'G', 'A'],
      bpmRange: [126, 130],
      progressionIds: [/* <paste from Step 3> */],
      rhythmIds: ['offbeatStabs', 'fourOnFloor', 'eighthPads'],
      bassPatternIds: ['offbeat-sub', 'driving-eighths', 'funk-octaves'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['offbeat8ths', 'sixteenths', 'eighths'],
          openhat: ['off', 'offbeat8ths', 'pickup'],
          tom: ['off', 'lateFill', 'fillTail'],
          crash: ['off', 'downbeat'],
        },
      },
    },
```

```ts
    // ambient-chill
    variation: {
      genre: 'ambient',
      // Avoids C, C# and D# entirely so a multi-bar drone through a 5.8 s
      // reverb tail keeps a pitched fundamental above ~73 Hz.
      keyPool: ['D', 'E', 'F', 'F#', 'G', 'A'],
      bpmRange: [62, 80],
      progressionIds: [/* <paste from Step 3> */],
      rhythmIds: ['sustained', 'arpRollUp', 'arpDownEighths'],
      bassPatternIds: ['whole-note-root', 'half-time-legato'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['off', 'backbeat', 'halves'],
          openhat: ['off', 'pickup', 'midBar'],
          tom: ['off', 'midBar'],
          crash: ['off', 'downbeat'],
        },
      },
    },
```

```ts
    // hiphop-groove
    variation: {
      genre: 'boombap',
      // Lower half only, so the walking line's upper notes stay under ~200 Hz
      // where the Round Pluck's 420 Hz cutoff still shapes them.
      keyPool: ['C', 'D', 'D#', 'E', 'F', 'G'],
      bpmRange: [85, 95],
      progressionIds: [/* <paste from Step 3> */],
      rhythmIds: ['syncopatedPush', 'lofiSwing', 'funkSyncopation'],
      bassPatternIds: ['walking-groove', 'dilla-sub', 'classic-walk'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['swung16ths', 'eighths', 'lofi16ths'],
          // `and2and4` is authored here because the research calls for open
          // hats on the "and", but this kick hits step 6 and the collision
          // filter drops it at draw time, leaving `off` and `pickup`.
          openhat: ['off', 'pickup', 'and2and4'],
          tom: ['off', 'fillTail', 'pickup'],
          crash: ['off', 'downbeat'],
        },
      },
    },
```

```ts
    // asian-zen
    variation: {
      genre: 'zen',
      // Koto-register roots — the instrument is conventionally tuned from
      // around D. Avoids the chromatic extremes where the Glocken Bell
      // partials either muddy or thin out.
      keyPool: ['D', 'E', 'F#', 'G', 'A'],
      // The one unsourced range: no production guide gave a tempo band for the
      // genre, so it is the authored 78 +/- 6.
      bpmRange: [70, 84],
      progressionIds: [/* <paste from Step 3> */],
      rhythmIds: ['sustained', 'arpRollUp', 'arpDownEighths'],
      bassPatternIds: ['whole-note-root', 'half-time-legato'],
      drumDecoration: {
        layers: ['hihat', 'openhat', 'tom', 'crash'],
        densities: {
          hihat: ['quarters', 'eighths', 'halves'],
          openhat: ['off', 'pickup', 'midBar'],
          tom: ['off', 'midBar', 'pickup'],
          crash: ['off', 'downbeat'],
        },
      },
    },
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test src/store/vibeVariation.test.ts && rm -f scripts/tmp-derive-progression-ids.ts
```

Expected: PASS. If "the filter removes exactly one candidate" fails with a number above 1, a `densities` pool collides with a kick that was not measured — re-check that pool against the vibe's authored `drumPattern.kick` rather than raising the expected count.

- [ ] **Step 6: Commit**

```bash
git add src/store/instantVibes.ts src/store/vibeVariation.test.ts
git commit -m "feat(vibes): author the variation rule for all six Instant Vibes"
```

---

### Task 5: The resolver

Turns an authored vibe plus a draw into a whole new `InstantVibe`. Six fields change; everything else is copied. This is the task that makes the reroll indistinguishable from a chip click downstream.

**Files:**
- Modify: `src/store/vibeVariation.ts`
- Test: `src/store/vibeVariation.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `VibeDraw` (Task 2), `DRUM_DENSITIES` / `DECORATION_ORDER` (Task 1), `InstantVibe` / `DecorationLayer` / `DensityName` (Task 3), `progressionById` and `resolveProgression` (B1).
- Produces: `VariationSummary`, `eligibleDensities(layer, candidates, kick): DensityName[]`, `resolveVibeVariation(vibe, current, draw): { vibe: InstantVibe; summary: VariationSummary }`.

**Draw order is part of the contract** — a scripted draw depends on it: `scaleRoot`, `bpm`, `chordRhythmId`, `bassPatternId`, progression, then the decoration layers in `DECORATION_ORDER`.

- [ ] **Step 1: Write the failing test**

Append to `src/store/vibeVariation.test.ts`:

```ts
import { eligibleDensities, resolveVibeVariation } from './vibeVariation';
import { getScaleNotes } from '../utils/musicTheory';
import { progressionById } from '../audio/data/chordProgressions';

function authoredCurrent(v: (typeof INSTANT_VIBES)[number]) {
  return {
    scaleRoot: v.scaleRoot,
    chordRhythmId: v.chordRhythmId,
    bassPatternId: v.bassPatternId,
  };
}

/**
 * Every combination the resolver can produce for one vibe, by exhaustive
 * enumeration — every pool is a small finite list, so no sampling is needed.
 * Memoised: seven tests iterate the same product and recomputing it each time
 * would run resolveProgression tens of thousands of times for no extra cover.
 */
const drawCache = new Map<string, ReturnType<typeof resolveVibeVariation>[]>();

function allDraws(v: (typeof INSTANT_VIBES)[number]) {
  const cached = drawCache.get(v.id);
  if (cached) return cached;
  const r = v.variation!;
  const cur = authoredCurrent(v);
  const keys = r.keyPool.filter((k) => k !== cur.scaleRoot);
  const rhythms = r.rhythmIds.filter((k) => k !== cur.chordRhythmId);
  const basses = r.bassPatternIds.filter((k) => k !== cur.bassPatternId);
  const out: ReturnType<typeof resolveVibeVariation>[] = [];
  for (let ki = 0; ki < keys.length; ki++) {
    for (let bi = 0; bi < r.bpmRange[1] - r.bpmRange[0] + 1; bi++) {
      for (let ri = 0; ri < rhythms.length; ri++) {
        for (let si = 0; si < basses.length; si++) {
          for (let pi = 0; pi < r.progressionIds.length; pi++) {
            const drumIdx = DECORATION_ORDER.filter((l) =>
              r.drumDecoration.layers.includes(l),
            ).map(() => 0);
            out.push(
              resolveVibeVariation(v, cur, scriptedDraw([ki, bi, ri, si, pi, ...drumIdx])),
            );
          }
        }
      }
    }
  }
  drawCache.set(v.id, out);
  return out;
}

describe('eligibleDensities', () => {
  test('openhat and tom drop every candidate that doubles a kick step', () => {
    const kick = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]; // hiphop-groove
    expect(eligibleDensities('openhat', ['off', 'pickup', 'and2and4'], kick)).toEqual([
      'off',
      'pickup',
    ]);
    expect(eligibleDensities('tom', ['off', 'midBar'], kick)).toEqual(['off']);
  });

  test('hihat and crash are exempt — closed hats double the kick by design', () => {
    const kick = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]; // lofi-chill
    expect(eligibleDensities('hihat', ['lofi16ths', 'eighths', 'swung16ths'], kick)).toEqual([
      'lofi16ths',
      'eighths',
      'swung16ths',
    ]);
    expect(eligibleDensities('crash', ['off', 'downbeat'], kick)).toEqual(['off', 'downbeat']);
  });
});

describe('resolveVibeVariation', () => {
  test('genre identity is copied verbatim under every draw', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out } of allDraws(v)) {
        expect(out.scaleType).toBe(v.scaleType);
        expect(out.id).toBe(v.id);
        expect(out.name).toBe(v.name);
        expect(out.emoji).toBe(v.emoji);
        expect(out.tagline).toBe(v.tagline);
        expect(out.projectTitle).toBe(v.projectTitle);
        expect(out.chordOctave).toBe(v.chordOctave);
        expect(out.bassOctave).toBe(v.bassOctave);
        expect(out.chordFeel).toBe(v.chordFeel);
        expect(out.bassFeel).toBe(v.bassFeel);
        expect(out.soundKit).toBe(v.soundKit);
        expect(out.synthParams).toEqual(v.synthParams);
        expect(out.chordSynthParams).toEqual(v.chordSynthParams);
        expect(out.bassSynthParams).toEqual(v.bassSynthParams);
        expect(out.effects).toEqual(v.effects);
      }
    }
  });

  test('the drum skeleton is never rerolled', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out } of allDraws(v)) {
        expect(out.drumPattern.kick).toEqual(v.drumPattern.kick);
        expect(out.drumPattern.snare).toEqual(v.drumPattern.snare);
        if (v.drumPattern.clap) expect(out.drumPattern.clap).toEqual(v.drumPattern.clap);
      }
    }
  });

  test('no drawn openhat or tom row shares a step with the authored kick', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out } of allDraws(v)) {
        for (const layer of ['openhat', 'tom'] as const) {
          if (!v.variation!.drumDecoration.layers.includes(layer)) continue;
          const row = out.drumPattern[layer];
          for (let i = 0; i < 16; i++) {
            expect(row[i] === 1 && v.drumPattern.kick[i] === 1).toBe(false);
          }
        }
      }
    }
  });

  test('key, comp rhythm and bass pattern always move off the current value', () => {
    for (const v of INSTANT_VIBES) {
      const cur = authoredCurrent(v);
      for (const { vibe: out } of allDraws(v)) {
        expect(out.scaleRoot).not.toBe(cur.scaleRoot);
        expect(out.chordRhythmId).not.toBe(cur.chordRhythmId);
        expect(out.bassPatternId).not.toBe(cur.bassPatternId);
      }
    }
  });

  test('bpm stays inside the range', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out } of allDraws(v)) {
        expect(out.bpm).toBeGreaterThanOrEqual(v.variation!.bpmRange[0]);
        expect(out.bpm).toBeLessThanOrEqual(v.variation!.bpmRange[1]);
      }
    }
  });

  test('chords are resolved in the drawn key and never collapse', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out, summary } of allDraws(v)) {
        const scaleNotes = getScaleNotes(out.scaleRoot, v.scaleType);
        for (const chord of out.chords) {
          expect(scaleNotes).toContain(chord.root);
          expect(chord.notes.length).toBeGreaterThan(0);
        }
        const source = progressionById(summary.progressionId)!;
        expect(out.chords.length).toBe(source.steps.length);
        expect(new Set(out.chords.map((c) => c.id)).size).toBe(out.chords.length);
      }
    }
  });

  test('the summary reports what was actually written', () => {
    for (const v of INSTANT_VIBES) {
      for (const { vibe: out, summary } of allDraws(v)) {
        expect(summary.vibeName).toBe(v.name);
        expect(summary.scaleRoot).toBe(out.scaleRoot);
        expect(summary.scaleType).toBe(out.scaleType);
        expect(summary.bpm).toBe(out.bpm);
        expect(summary.rhythmName).toBe(
          RHYTHM_PATTERNS.find((p) => p.id === out.chordRhythmId)!.name,
        );
        expect(summary.bassPatternName).toBe(
          BASS_PATTERNS.find((p) => p.id === out.bassPatternId)!.name,
        );
        for (const { layer, density } of summary.drums) {
          expect(out.drumPattern[layer]).toEqual(DRUM_DENSITIES[density]);
        }
        expect(summary.drums.map((d) => d.layer)).toEqual(
          DECORATION_ORDER.filter((l) => v.variation!.drumDecoration.layers.includes(l)),
        );
      }
    }
  });

  test('a scripted draw produces one exact, nameable vibe', () => {
    const lofi = INSTANT_VIBES.find((v) => v.id === 'lofi-chill')!;
    const r = lofi.variation!;
    // eligible keys exclude 'C': ['D','D#','F','G','A'] -> index 2 is 'F'
    // bpm offset 3 from 78 -> 81
    // eligible rhythms exclude 'lofiSwing': ['syncopatedPush','bassPlusStrum'] -> 0
    // eligible basses exclude 'dilla-sub': ['walking-groove','half-time-legato'] -> 0
    // progression index 0; then hihat/openhat/tom/crash all index 0
    const { vibe: out, summary } = resolveVibeVariation(
      lofi,
      authoredCurrent(lofi),
      scriptedDraw([2, 3, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(out.scaleRoot).toBe('F');
    expect(out.bpm).toBe(81);
    expect(out.chordRhythmId).toBe('syncopatedPush');
    expect(out.bassPatternId).toBe('walking-groove');
    expect(summary.progressionName).toBe(progressionById(r.progressionIds[0])!.name);
    expect(summary.progressionRoman).toBe(progressionById(r.progressionIds[0])!.roman);
    expect(out.drumPattern.hihat).toEqual(DRUM_DENSITIES.lofi16ths);
    expect(out.drumPattern.openhat).toEqual(DRUM_DENSITIES.off);
    expect(out.drumPattern.tom).toEqual(DRUM_DENSITIES.off);
    expect(out.drumPattern.crash).toEqual(DRUM_DENSITIES.off);
  });

  test('the catalogue rows are copied, not aliased into the vibe', () => {
    const lofi = INSTANT_VIBES.find((v) => v.id === 'lofi-chill')!;
    const { vibe: out } = resolveVibeVariation(
      lofi,
      authoredCurrent(lofi),
      scriptedDraw([0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(out.drumPattern.hihat).not.toBe(DRUM_DENSITIES.lofi16ths);
  });

  test('a vibe with no variation rule throws rather than silently doing nothing', () => {
    const bare = { ...INSTANT_VIBES[0], variation: undefined };
    expect(() => resolveVibeVariation(bare, authoredCurrent(bare), firstDraw)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: FAIL — `resolveVibeVariation` and `eligibleDensities` are not exported.

- [ ] **Step 3: Write the resolver**

Append to `src/store/vibeVariation.ts`:

```ts
import { progressionById, resolveProgression } from '../audio/data/chordProgressions';
import { BASS_PATTERNS } from '../audio/bassPatterns';
import { RHYTHM_PATTERNS } from '../audio/rhythmPatterns';
import type { DrumDecorationRule, InstantVibe } from '../types';

/** What the reroll changed, in the form the toast prints it. */
export interface VariationSummary {
  vibeName: string;
  scaleRoot: string;
  scaleType: string;
  bpm: number;
  /** The id that was drawn. Unambiguous where two entries share a shape. */
  progressionId: string;
  progressionName: string;
  progressionRoman: string;
  rhythmName: string;
  bassPatternName: string;
  drums: Array<{ layer: DecorationLayer; density: DensityName }>;
}

/**
 * Layers whose candidates are filtered against the authored kick. An open
 * hi-hat's decay smears the kick's attack and a tom occupies the kick's
 * register, so neither may double it. `hihat` and `crash` are deliberately
 * exempt: closed hats are short and quiet and routinely double the kick, and a
 * crash on a kick downbeat is the standard accent, not a clash.
 */
const COLLISION_FILTERED: DecorationLayer[] = ['openhat', 'tom'];

function collidesWithKick(row: number[], kick: number[]): boolean {
  return row.some((hit, i) => hit === 1 && kick[i] === 1);
}

/**
 * The candidates a layer may actually be drawn from. Can never return an empty
 * list for a well-authored vibe: `off` is a member of every filtered pool and
 * collides with nothing. An invariant test pins that for all six vibes.
 */
export function eligibleDensities(
  layer: DecorationLayer,
  candidates: DensityName[],
  kick: number[],
): DensityName[] {
  if (!COLLISION_FILTERED.includes(layer)) return candidates;
  return candidates.filter((name) => !collidesWithKick(DRUM_DENSITIES[name], kick));
}

function rollDecoration(
  authored: Record<string, number[]>,
  rule: DrumDecorationRule,
  draw: VibeDraw,
): { drumPattern: Record<string, number[]>; drums: VariationSummary['drums'] } {
  const drumPattern: Record<string, number[]> = { ...authored };
  const drums: VariationSummary['drums'] = [];
  const kick = authored.kick ?? [];

  for (const layer of DECORATION_ORDER) {
    if (!rule.layers.includes(layer)) continue;
    const candidates = rule.densities[layer];
    if (!candidates || candidates.length === 0) {
      throw new Error(`DrumDecorationRule: layer "${layer}" is listed with no densities`);
    }
    const eligible = eligibleDensities(layer, candidates, kick);
    if (eligible.length === 0) {
      throw new Error(`DrumDecorationRule: every "${layer}" candidate collides with the kick`);
    }
    const density = draw.pick(eligible);
    // Copy: the catalogue row is shared module state and must not be aliased
    // into a vibe that later flows into the store.
    drumPattern[layer] = [...DRUM_DENSITIES[density]];
    drums.push({ layer, density });
  }

  return { drumPattern, drums };
}

/**
 * Rerolls a vibe into a different piece of music in the same genre.
 *
 * Starts from the AUTHORED vibe every time — never from the current store — so
 * rerolls never compound, and overwrites exactly six fields: scaleRoot, bpm,
 * chordRhythmId, bassPatternId, chords and the decoration rows of drumPattern.
 * `scaleType` is copied, never drawn: it is the genre anchor.
 *
 * Draw order is part of the contract, because a scripted draw depends on it:
 * scaleRoot, bpm, chordRhythmId, bassPatternId, progression, then the layers
 * of DECORATION_ORDER that the rule lists.
 *
 * The returned value is a whole InstantVibe, so the caller applies it through
 * the existing applyInstantVibeToStore. There is deliberately no second apply
 * path: that is what keeps the hard-stop-on-swap fix from regressing.
 */
export function resolveVibeVariation(
  vibe: InstantVibe,
  current: { scaleRoot: string; chordRhythmId: string; bassPatternId: string },
  draw: VibeDraw,
): { vibe: InstantVibe; summary: VariationSummary } {
  const rule = vibe.variation;
  if (!rule) {
    throw new Error(`Vibe "${vibe.id}" has no variation rule and cannot be rerolled`);
  }

  const scaleRoot = draw.pickDistinct(rule.keyPool, current.scaleRoot);
  const bpm = draw.int(rule.bpmRange[0], rule.bpmRange[1]);
  const chordRhythmId = draw.pickDistinct(rule.rhythmIds, current.chordRhythmId);
  const bassPatternId = draw.pickDistinct(rule.bassPatternIds, current.bassPatternId);

  const progressionId = draw.pick(rule.progressionIds);
  const progression = progressionById(progressionId);
  if (!progression) {
    throw new Error(`Vibe "${vibe.id}" lists unknown progression "${progressionId}"`);
  }
  // Resolved from degrees straight into the drawn key. B2 never transposes, so
  // it cannot hit the auto-harmonize collapse bug at all.
  const chords = resolveProgression(progression, scaleRoot, vibe.scaleType, vibe.chordOctave);

  const { drumPattern, drums } = rollDecoration(vibe.drumPattern, rule.drumDecoration, draw);

  return {
    vibe: { ...vibe, scaleRoot, bpm, chordRhythmId, bassPatternId, chords, drumPattern },
    summary: {
      vibeName: vibe.name,
      scaleRoot,
      scaleType: vibe.scaleType,
      bpm,
      progressionId: progression.id,
      progressionName: progression.name,
      progressionRoman: progression.roman,
      rhythmName: RHYTHM_PATTERNS.find((p) => p.id === chordRhythmId)?.name ?? chordRhythmId,
      bassPatternName: BASS_PATTERNS.find((p) => p.id === bassPatternId)?.name ?? bassPatternId,
      drums,
    },
  };
}
```

> `VariationSummary` gains `vibeName`, which the spec's field list omits. The spec pins `formatVariationSummary(summary)` as taking no second argument, yet its headline prints the vibe's name — carrying it on the summary is the smaller of the two changes.

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: PASS. The enumeration tests run the full product of candidates per vibe; if one is slow, that is expected — it is a few thousand pure calls, not sampling.

- [ ] **Step 5: Check the layering**

```bash
bun run eslint
```

Expected: PASS. `src/store/vibeVariation.ts` importing `src/audio/data/`, `src/audio/rhythmPatterns.ts` and `src/audio/bassPatterns.ts` is the allowed direction; it must import nothing from `src/components/`.

- [ ] **Step 6: Commit**

```bash
git add src/store/vibeVariation.ts src/store/vibeVariation.test.ts
git commit -m "feat(vibes): resolve a vibe variation from an injected draw"
```

---

### Task 6: The toast formatter

A pure string builder, so the two toast lines are testable without a DOM.

**Files:**
- Modify: `src/store/vibeVariation.ts`
- Test: `src/store/vibeVariation.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `VariationSummary` (Task 5), `LAYER_LABELS` (Task 1).
- Produces: `RerollToast`, `formatVariationSummary(summary: VariationSummary): RerollToast`.

- [ ] **Step 1: Write the failing test**

Append to `src/store/vibeVariation.test.ts`:

```ts
import { formatVariationSummary } from './vibeVariation';
import type { VariationSummary } from './vibeVariation';

const BASE: VariationSummary = {
  vibeName: 'Lo-Fi Chill',
  scaleRoot: 'F',
  scaleType: 'Major',
  bpm: 81,
  progressionId: 'lofi-rainy-window',
  progressionName: 'Rainy Window',
  progressionRoman: 'vim9 – IVmaj7 – ii9 – V7',
  rhythmName: 'Syncopated Soul Push',
  bassPatternName: 'Soulful Walking Bass',
  drums: [],
};

describe('formatVariationSummary', () => {
  test('the headline names the vibe, the key and the tempo', () => {
    const { headline } = formatVariationSummary({
      ...BASE,
      drums: [{ layer: 'hihat', density: 'eighths' }],
    });
    expect(headline).toBe('🎲 Lo-Fi Chill — F Major · 81 BPM');
  });

  test('the detail is four dot-joined segments in a fixed order', () => {
    const { detail } = formatVariationSummary({
      ...BASE,
      drums: [
        { layer: 'hihat', density: 'eighths' },
        { layer: 'crash', density: 'downbeat' },
      ],
    });
    expect(detail).toBe(
      'vim9 – IVmaj7 – ii9 – V7 · Syncopated Soul Push · Soulful Walking Bass · ' +
        'drums: hats eighths, crash downbeat',
    );
  });

  test('layers drawn as off are omitted, in DECORATION_ORDER', () => {
    const { detail } = formatVariationSummary({
      ...BASE,
      drums: [
        { layer: 'hihat', density: 'swung16ths' },
        { layer: 'openhat', density: 'off' },
        { layer: 'tom', density: 'fillTail' },
        { layer: 'crash', density: 'off' },
      ],
    });
    expect(detail.endsWith('drums: hats swung16ths, tom fillTail')).toBe(true);
  });

  test('an all-off draw reads `drums: bare` rather than an empty segment', () => {
    const { detail } = formatVariationSummary({
      ...BASE,
      drums: [
        { layer: 'hihat', density: 'off' },
        { layer: 'openhat', density: 'off' },
        { layer: 'tom', density: 'off' },
        { layer: 'crash', density: 'off' },
      ],
    });
    expect(detail).toBe(
      'vim9 – IVmaj7 – ii9 – V7 · Syncopated Soul Push · Soulful Walking Bass · drums: bare',
    );
  });

  test('the roman numeral is printed verbatim, not reformatted', () => {
    const { detail } = formatVariationSummary({ ...BASE, progressionRoman: 'i – VII – VI – VII' });
    expect(detail.startsWith('i – VII – VI – VII · ')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: FAIL — `formatVariationSummary` is not exported.

- [ ] **Step 3: Write the formatter**

Append to `src/store/vibeVariation.ts`:

```ts
/** The two lines of the reroll toast, kept apart so the UI can hide one. */
export interface RerollToast {
  headline: string;
  detail: string;
}

/**
 * Pure, so the exact strings are testable without a DOM — the repo has no
 * testing-library setup and this is the convention every other component
 * helper follows.
 */
export function formatVariationSummary(summary: VariationSummary): RerollToast {
  const active = summary.drums.filter((d) => d.density !== 'off');
  const drumSegment =
    active.length === 0
      ? 'drums: bare'
      : `drums: ${active.map((d) => `${LAYER_LABELS[d.layer]} ${d.density}`).join(', ')}`;

  return {
    headline: `🎲 ${summary.vibeName} — ${summary.scaleRoot} ${summary.scaleType} · ${summary.bpm} BPM`,
    detail: [
      summary.progressionRoman,
      summary.rhythmName,
      summary.bassPatternName,
      drumSegment,
    ].join(' · '),
  };
}
```

`summary.drums` is already in `DECORATION_ORDER`, so the filter preserves that order without re-sorting.

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/vibeVariation.ts src/store/vibeVariation.test.ts
git commit -m "feat(vibes): format the reroll summary into the two toast lines"
```

---

### Task 7: `rerollVibe` — the one place `Math.random` is called

Mirrors the existing `selectVibe`. Reads `current` from the store, draws, and hands the resolved vibe to the **unmodified** `applyInstantVibeToStore`. It makes no engine call of its own.

**Files:**
- Modify: `src/components/InstantVibesBar.tsx` (add the exported helper only; no markup yet)
- Test: `src/components/InstantVibesBar.test.tsx` (add a describe block)

**Interfaces:**
- Consumes: `resolveVibeVariation`, `formatVariationSummary`, `createDraw`, `RerollToast` (Tasks 2, 5, 6); `applyInstantVibeToStore` (unchanged); `useAppStore`.
- Produces: `rerollVibe(vibe: InstantVibe, deps: { onToast: (toast: RerollToast) => void }): void`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/InstantVibesBar.test.tsx`:

```ts
import { startEngineSync, stopEngineSync } from '../store/engineSync';
import { rerollVibe } from './InstantVibesBar';

const swallow = { onToast: () => {} };

describe('rerollVibe', () => {
  test('a reroll changes the music but never the genre anchor', () => {
    const vibe = INSTANT_VIBES[0];
    applyInstantVibeToStore(vibe);
    const before = useAppStore.getState();
    const authored = {
      scaleRoot: before.scaleRoot,
      chordRhythmId: before.chordRhythmId,
      bassPatternId: before.bassPatternId,
    };

    rerollVibe(vibe, swallow);

    const after = useAppStore.getState();
    expect(after.scaleType).toBe(vibe.scaleType);
    expect(after.scaleRoot).not.toBe(authored.scaleRoot);
    expect(after.chordRhythmId).not.toBe(authored.chordRhythmId);
    expect(after.bassPatternId).not.toBe(authored.bassPatternId);
    expect(after.chords.length).toBeGreaterThan(0);
    expect(after.projectTitle).toBe(vibe.projectTitle);
  });

  test('the toast carries both lines', () => {
    let received: { headline: string; detail: string } | null = null;
    rerollVibe(INSTANT_VIBES[0], { onToast: (t) => { received = t; } });
    expect(received).not.toBeNull();
    expect(received!.headline.startsWith('🎲 ')).toBe(true);
    expect(received!.detail.includes(' · drums: ')).toBe(true);
  });

  // Non-regression: the atomic-swap fix lives in applyInstantVibeToStore and a
  // reroll must inherit it rather than re-implement it.
  test('a reroll cuts the chord and bass sources synchronously', () => {
    const stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {}).mockClear();
    useAppStore.setState({ sequencerPlayer: 'playing', chordsPlayer: 'playing' });

    rerollVibe(INSTANT_VIBES[0], swallow);

    expect(stopSource).toHaveBeenCalledWith('chord', 0.02);
    expect(stopSource).toHaveBeenCalledWith('bass', 0.02);
    const after = useAppStore.getState();
    expect(after.sequencerPlayer).toBe('playing');
    expect(after.chordsPlayer).toBe('playing');
    stopSource.mockRestore();
  });

  test('a reroll while stopped leaves both players stopped', () => {
    useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped' });
    rerollVibe(INSTANT_VIBES[0], swallow);
    const after = useAppStore.getState();
    expect(after.sequencerPlayer).toBe('stopped');
    expect(after.chordsPlayer).toBe('stopped');
  });

  /**
   * A reroll rewinds the shared bar grid, and that is INTENDED.
   *
   * applyInstantVibeToStore calls hardStopAll(), which takes engineSync's
   * transport flags to 0, then restarts the players that were running, which
   * takes them back up — and zustand's subscription is synchronous and not
   * React-batched, so the `flags !== 0 && prevFlags === 0` branch really runs.
   * The user tested this on the chip click and reported it as good ("every
   * press starts playing anew, the old sound doesn't hang over"). A reroll is
   * the same gesture. Pinned here so a refactor cannot silently drop it.
   */
  test('a reroll rewinds the shared bar grid — intended, not a regression', () => {
    spyOn(audioEngine, 'init').mockImplementation(() => {});
    useAppStore.setState({ sequencerPlayer: 'playing', chordsPlayer: 'playing' });
    startEngineSync();
    const resetClock = spyOn(audioEngine, 'resetClock').mockImplementation(() => {}).mockClear();

    rerollVibe(INSTANT_VIBES[0], swallow);

    // Tear the subscription down BEFORE asserting: a failing expect would
    // otherwise leak a live engineSync into every later test in the file.
    const calls = resetClock.mock.calls.length;
    stopEngineSync();
    expect(calls).toBe(1);
  });

  test('the chip stays highlighted after a reroll', () => {
    rerollVibe(INSTANT_VIBES[0], swallow);
    expect(resolveSelectedVibeId(useAppStore.getState().projectTitle)).toBe(INSTANT_VIBES[0].id);
  });
});
```

Add `applyInstantVibeToStore` to the existing `import { INSTANT_VIBES } from '../store/instantVibes';` line at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/components/InstantVibesBar.test.tsx
```

Expected: FAIL — `rerollVibe` is not exported.

- [ ] **Step 3: Write `rerollVibe`**

Add to `src/components/InstantVibesBar.tsx`, directly after `selectVibe`:

```ts
/**
 * Rerolls the loaded vibe into a different piece of music in the same genre.
 *
 * The ONLY place this feature calls Math.random: everything below
 * resolveVibeVariation takes the VibeDraw this creates, which is what makes the
 * draw policy testable by enumeration.
 *
 * Applies through the same applyInstantVibeToStore a chip click uses. That is
 * deliberate and load-bearing: the synchronous
 * audioEngine.stopSource('chord'|'bass', 0.02) cut, the selective restart and
 * the bar-grid rewind all live in there, and a second apply path would have to
 * keep them in sync. This function makes no engine call of its own.
 */
export function rerollVibe(
  vibe: InstantVibe,
  deps: { onToast: (toast: RerollToast) => void }
): void {
  const { scaleRoot, chordRhythmId, bassPatternId } = useAppStore.getState();
  const result = resolveVibeVariation(
    vibe,
    { scaleRoot, chordRhythmId, bassPatternId },
    createDraw(Math.random),
  );
  applyInstantVibeToStore(result.vibe);
  deps.onToast(formatVariationSummary(result.summary));
}
```

Add the import:

```ts
import {
  createDraw,
  formatVariationSummary,
  resolveVibeVariation,
  type RerollToast,
} from '../store/vibeVariation';
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test src/components/InstantVibesBar.test.tsx
```

Expected: PASS. If the bar-grid test reports 0 calls, check that `startEngineSync()` runs **after** the players are set to `playing` — the subscription seeds `prevFlags` at subscribe time, and seeding it at 0 would make the very first `play` fire the branch instead.

- [ ] **Step 5: Confirm the apply path was not forked**

```bash
git diff --stat src/store/instantVibes.ts
```

Expected: empty. `applyInstantVibeToStore` must not be modified by this task, and no task in this plan modifies it.

- [ ] **Step 6: Commit**

```bash
git add src/components/InstantVibesBar.tsx src/components/InstantVibesBar.test.tsx
git commit -m "feat(vibes): add rerollVibe on top of the unmodified vibe apply path"
```

---

### Task 8: The dice control, the live chip readout and the reroll toast

The only markup change. The dice is the second half of a daisyUI `join` on the loaded chip; the loaded chip stops printing its authored BPM and starts printing the store's live key and tempo.

**Files:**
- Modify: `src/components/InstantVibesBar.tsx`
- Test: `bun run check:theme` plus hand verification (`renderToString` cannot observe `setState` under zustand v5, so the markup is not unit-asserted)

**Interfaces:**
- Consumes: `rerollVibe`, `RerollToast` (Task 7); `useAppStore`.
- Produces: no new export.

- [ ] **Step 1: Replace the toast state with a discriminated union**

In `InstantVibesBar`, replace `const [feedbackToast, setFeedbackToast] = useState<string | null>(null);` with:

```tsx
  type VibeToast =
    | { kind: 'load'; text: string }
    | { kind: 'reroll'; headline: string; detail: string };

  const [toast, setToast] = useState<VibeToast | null>(null);
  const [rollingVibeId, setRollingVibeId] = useState<string | null>(null);
  const bpm = useAppStore((s) => s.bpm);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
```

and replace the `handleSelectVibe` body's toast wiring:

```tsx
  const handleSelectVibe = (vibe: InstantVibe) => {
    selectVibe(vibe, { onToast: (text) => setToast({ kind: 'load', text }) });
    setTimeout(() => setToast(null), 3000);
  };

  const handleReroll = (vibe: InstantVibe) => {
    setRollingVibeId(vibe.id);
    rerollVibe(vibe, { onToast: (t) => setToast({ kind: 'reroll', ...t }) });
    // 400 ms of spin, then the icon settles; the toast holds longer because
    // its second line has more to read than the load toast's one.
    setTimeout(() => setRollingVibeId(null), 400);
    setTimeout(() => setToast(null), 4000);
  };
```

- [ ] **Step 2: Join the dice onto the loaded chip**

Replace the body of the `INSTANT_VIBES.map(...)` callback with:

```tsx
              const isSelected = selectedVibeId === vibe.id;

              const chip = (
                <button
                  id={`btn-vibe-${vibe.id}`}
                  onClick={() => handleSelectVibe(vibe)}
                  title={`${vibe.name} (${vibe.bpm} BPM · ${vibe.scaleRoot} ${vibe.scaleType})`}
                  className={`btn btn-xs group gap-1.5 font-semibold whitespace-nowrap shrink-0 normal-case ${
                    isSelected ? 'join-item btn-primary' : 'btn-soft'
                  }`}
                >
                  <span className="text-xs leading-none">{vibe.emoji}</span>
                  <span className="font-medium">{vibe.name}</span>
                  <span className="text-[9px] font-mono opacity-70">
                    {/* The loaded chip is the always-visible readout of what is
                        actually loaded: after a reroll the authored BPM is no
                        longer true, and there is no undo to fall back on. */}
                    {isSelected ? `${scaleRoot} · ${bpm}` : vibe.bpm}
                  </span>
                </button>
              );

              if (!isSelected || !vibe.variation) {
                return <React.Fragment key={vibe.id}>{chip}</React.Fragment>;
              }

              return (
                <div key={vibe.id} className="join shrink-0">
                  {chip}
                  <button
                    id={`btn-vibe-reroll-${vibe.id}`}
                    onClick={() => handleReroll(vibe)}
                    title={`Reroll ${vibe.name}`}
                    aria-label={`Reroll ${vibe.name}`}
                    className="join-item btn btn-xs btn-primary btn-square"
                  >
                    <Dices
                      className={`w-3.5 h-3.5 ${
                        rollingVibeId === vibe.id ? 'animate-spin motion-reduce:animate-none' : ''
                      }`}
                    />
                  </button>
                </div>
              );
```

Add `Dices` to the lucide import: `import { Sparkles, Check, ChevronDown, ChevronUp, Dices } from 'lucide-react';`

Attaching the dice to the chip makes its target unambiguous — it can only mean "reroll this" — and costs no horizontal space in a row that already scrolls.

- [ ] **Step 3: Render the two toast kinds**

Replace the `{feedbackToast && (...)}` block with:

```tsx
          {toast && (
            <div className="toast toast-top toast-end animate-fade-in">
              {toast.kind === 'load' ? (
                <div className="alert alert-success alert-soft py-1 px-2 text-[10px] gap-1">
                  <Check className="w-3 h-3" />
                  <span className="hidden md:inline">{toast.text}</span>
                  <span className="md:hidden">Loaded</span>
                </div>
              ) : (
                // A different colour role from the load toast, so a reroll and
                // a load are visually distinct at a glance.
                <div className="alert alert-info alert-soft py-1 px-2 text-[10px] gap-1">
                  <div className="hidden md:flex flex-col items-start gap-0.5">
                    <span className="font-semibold">{toast.headline}</span>
                    <span className="opacity-80">{toast.detail}</span>
                  </div>
                  <span className="md:hidden">🎲 Rerolled</span>
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 4: Run the theme guard and the gate**

```bash
bun run check:theme && bun run verify && bun run eslint
```

Expected: PASS, with `ALLOWLIST` still empty. Every daisyUI class used here (`join`, `join-item`, `btn`, `btn-xs`, `btn-primary`, `btn-soft`, `btn-square`, `btn-ghost`, `toast`, `toast-top`, `toast-end`, `alert`, `alert-soft`, `alert-info`, `alert-success`) is on the verified v5 list in Global Constraints; the rest (`animate-spin`, `motion-reduce:animate-none`, `w-3.5`, `flex-col`, `gap-0.5`) are core Tailwind.

- [ ] **Step 5: Verify by hand**

```bash
bun run dev
```

1. Fresh load with no vibe selected: no dice anywhere.
2. Click Lo-Fi Chill: the chip goes primary, prints `C · 84`, and a dice button appears joined to its right edge with no gap.
3. Click the dice: the icon spins briefly, an `alert-info` toast shows two lines, and the chip's readout changes to the new key and BPM. The chip stays highlighted.
4. Press Play on both players, then press the dice repeatedly: audio swaps cleanly on every press with no overlapping chords or bass, and both players re-enter together on a bar line.
5. Press the dice ten times on Cyber EDM: the key, comp rhythm and bass pattern change every single time. BPM may repeat — that is accepted.
6. Click the chip again: the authored vibe returns exactly (`F · 128` for Cyber EDM), discarding every reroll.
7. Switch to another vibe: the dice moves to the newly loaded chip and disappears from the old one.
8. Narrow the window below `md`: the toast collapses to `🎲 Rerolled`.

- [ ] **Step 6: Commit**

```bash
git add src/components/InstantVibesBar.tsx
git commit -m "feat(vibes): add the dice control, live chip readout and reroll toast"
```

---

## Done criteria

- `bun run verify` and `bun run eslint` both pass.
- `git diff main --stat -- src/store/instantVibes.ts` shows only the six `variation` blocks and the `InstantVibe` interface move — `applyInstantVibeToStore`'s body is byte-identical.
- `grep -rn "Math.random" src/store/vibeVariation.ts src/store/vibeVariationFixtures.ts src/store/vibeVariation.test.ts` returns nothing, and `grep -rn "Math.random" src/components/InstantVibesBar.tsx` returns exactly one hit, inside `rerollVibe`.
- `scripts/themeTokenGuard.ts`'s `ALLOWLIST` is still empty.
- The store version is still 3 and `partializeAppState` is unchanged — the reroll introduces no persisted state.
- Every row of the hand-verification matrix in Task 8 Step 5 behaves as described.

## Assumptions about B1 this plan depends on

If any of these is false when B1 merges, the named task fails loudly rather than silently producing wrong music.

1. `VibeGenre` is declared in `src/types.ts` and re-exported from `src/audio/data/chordProgressions.ts` (ruling R3). — Task 3 Step 1 checks it.
2. `progressionById` and `VIBE_GENRE_SCALES` are exported from `src/audio/data/chordProgressions.ts`. — Tasks 4 and 5.
3. Every `VibeGenre` has **at least four** tagged progressions passing the vibe's scale-length filter (ruling R4). — Task 4 Step 3 stops if fewer.
4. `resolveProgression` returns exactly `steps.length` chords, with ids unique within the array, and never collapses two steps onto one chord — including on 5-degree Hirajoshi. — Task 5 asserts both.
5. `SCALES` has a `'Hirajoshi'` key with 5 intervals and `asian-zen.scaleType === 'Hirajoshi'`. — Task 3 Step 1 checks it; Task 4's `minScaleLength <= 5` filter assumes it.
6. `resolveProgression`'s `octave` parameter accepts the vibe's `chordOctave` (4 for all six vibes).
7. `ChordProgression.roman` is display-ready — Task 6 prints it verbatim.
8. `ChordView`'s auto-reharmonize effect does not act when chords arrive together with a key change, via B1's `chordsReplaced` identity guard. Without it, every reroll's chords are transformed a second time from the old root. B2 adds nothing here and has no fallback.
