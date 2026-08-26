# Vibe Drums from a Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the six Instant Vibes' inline `drumPattern` blocks into a new drum-pattern library keyed by id and add `drumPatternId` to `InstantVibe`, without changing the sound by a single bit.

**Architecture:** This is phase 3 of the "Vibe as References" spec and a pure refactor. A new zero-import module `src/audio/data/vibeDrumPatterns.ts` holds the six authored skeletons keyed by a library id, plus a `drumPatternById(id)` resolver that returns a **fresh deep copy** on every call. `src/store/instantVibes.ts` then stops inlining the rows: each vibe declares `drumPatternId: 'x'` and sets `drumPattern: drumPatternById('x')!`, exactly mirroring how phase 1 left `progressionId` beside a `resolveProgression(...)`-built `chords`. A before-snapshot fixture (`ORIGINAL_VIBE_DRUM_PATTERNS`), landed one task *before* the migration, is what proves the sound is byte-identical afterwards.

**Tech Stack:** TypeScript, Bun (`bun test`), Vite + React 18, Zustand store, raw Web Audio API. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-vibe-as-references-design.md` (phase 3 of the "Four phases" section; "Invariants to enforce with tests" items 3 and 4; "Codebase constraints")

## Settled decisions — do not re-open

These were decided during this phase's own planning, which is where the spec's "One
explicitly open question" says they belong. Do not offer alternatives while executing.

1. **The new library stays separate from `GENRE_PRESETS`** (`src/audio/data/genrePresets.ts`).
   Measured: no vibe's drum pattern matches its own genre entry best (Jaccard over hit
   cells — `synthwave-80s` is closest to Trap at 81%, not Synthwave at 58%;
   `ambient-chill` peaks at 26% against anything; nothing matches at 100%). Merging
   would force a sound change on one side or the other, violating the spec's
   non-regression invariant. **`GENRE_PRESETS` is not touched by this plan at all.**
2. **The skeleton/decoration split is unchanged.** `kick`/`snare`/`clap` stay authored;
   `hihat`/`openhat`/`tom`/`crash` stay the `DecorationLayer` set. This plan does not
   touch `src/store/vibeVariation.ts` or any `variation` data.
3. **`applyInstantVibeToStore` is not modified.** Its `hardStopAll` →
   `stopSource('chord', 0.02)` / `stopSource('bass', 0.02)` ordering carries two real
   bug fixes (`d8df714`, `c4a253a`).
4. **Mirror phase 1's shape.** `InstantVibe` keeps BOTH `drumPattern` and the new
   `drumPatternId`, exactly as it already keeps both `chords` and `progressionId`.
5. **`soundKit` stays a separate field**, untouched — a pattern is rhythm, a kit is timbre.

## Global Constraints

- `src/types.ts` is a zero-import leaf — it must stay that way.
- Three layers enforced by eslint `no-restricted-imports`: `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; `src/store/` → `src/audio/` **is** allowed. `src/components/` must not import `audio/engine`.
- Tests are pure-logic `bun:test`. No DOM, no testing-library — none may be added.
- `@typescript-eslint/no-unused-vars` is an **error**, not a warning: never leave a symbol behind after replacing it.
- `toMatchObject` is not in bun:test's TypeScript types — `bun run lint` fails on it. Do not use it.
- Gate per task: `bun test` and `bun run lint`. Gate at the end of each task's commit and at the end of the plan: `bun run verify` (test + lint + check:keys + check:drums + build), plus `bun run eslint` run **separately** — it is NOT part of `verify`. eslint baseline is **6 pre-existing complexity warnings, 0 errors**; do not add a seventh.
- Do not touch: `src/store/vibeVariation.ts`, `src/audio/data/genrePresets.ts`, `applyInstantVibeToStore`, any `variation` data, `soundKit`.

> Note on the gate command: `package.json` has **no `test` script**, so `bun run test`
> fails with "Script not found". The test command in this repo is `bun test` (a Bun
> builtin). Every step below uses `bun test`.

## File Structure

- **Create** `src/audio/data/vibeDrumPatterns.ts` — the library: `VIBE_DRUM_PATTERNS: Record<string, Record<string, number[]>>` plus `drumPatternById(id): Record<string, number[]> | undefined`. Zero imports; lives under `src/audio/` so both `store/` and future `audio/` consumers may read it.
- **Create** `src/audio/data/vibeDrumPatterns.test.ts` — shape invariants for the library itself (6 ids, 7 rows, 16 steps, 0/1 cells, unknown id, copy semantics).
- **Create** `src/store/instantVibesDrumsFixture.ts` — `ORIGINAL_VIBE_DRUM_PATTERNS`, a verbatim before-snapshot of what each vibe ships today. Imports **nothing**.
- **Create** `src/store/instantVibesDrums.test.ts` — first pins the fixture against today's `INSTANT_VIBES` (task 2), then pins the migrated vibes against the fixture (task 3).
- **Modify** `src/types.ts` — add `drumPatternId: string` to `InstantVibe`, beside the existing `drumPattern` field.
- **Modify** `src/store/instantVibes.ts:142-150, 217-225, 295-303, 370-378, 444-452, 521-529` — replace six inline `drumPattern: { ... }` blocks with `drumPatternId` + a `drumPatternById(...)` call.

## The six library ids

| vibe id | library id |
|---|---|
| `lofi-chill` | `lofi-half-time-brush` |
| `synthwave-80s` | `synthwave-four-on-floor` |
| `cyber-dance` | `edm-offbeat-pump` |
| `ambient-chill` | `ambient-sparse-drift` |
| `hiphop-groove` | `boombap-swung-break` |
| `asian-zen` | `zen-bamboo-pulse` |

---

### Task 1: The vibe drum-pattern library

**Files:**
- Create: `src/audio/data/vibeDrumPatterns.ts`
- Test: `src/audio/data/vibeDrumPatterns.test.ts`

**Interfaces:**
- Consumes: nothing. This module imports nothing at all — it is a data leaf under `src/audio/`.
- Produces:
  - `export const VIBE_DRUM_PATTERNS: Record<string, Record<string, number[]>>` — exactly 6 keys: `lofi-half-time-brush`, `synthwave-four-on-floor`, `edm-offbeat-pump`, `ambient-sparse-drift`, `boombap-swung-break`, `zen-bamboo-pulse`. Each value has exactly the 7 rows `kick, snare, hihat, openhat, clap, tom, crash`, each a 16-entry array of literal `0`/`1` numbers.
  - `export function drumPatternById(id: string): Record<string, number[]> | undefined` — returns a **fresh deep copy** on every call, `undefined` for an unknown id.

**Why the copy is not optional:** `rollDecoration` (`src/store/vibeVariation.ts:110`) does a
shallow `{ ...authored }`, so the skeleton rows (`kick`, `snare`, `clap`) survive that
spread as the *same array references*. Returning the module's own arrays would push live
references to module state into the store, where any in-place edit would silently rewrite
the library for the rest of the session. `resolveProgression` — the phase 1 precedent —
likewise returns freshly built objects every call.

- [ ] **Step 1: Write the failing test file**

Create `src/audio/data/vibeDrumPatterns.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { VIBE_DRUM_PATTERNS, drumPatternById } from './vibeDrumPatterns';

const LIBRARY_IDS = [
  'lofi-half-time-brush',
  'synthwave-four-on-floor',
  'edm-offbeat-pump',
  'ambient-sparse-drift',
  'boombap-swung-break',
  'zen-bamboo-pulse',
];

const ROWS = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'];

describe('VIBE_DRUM_PATTERNS shape', () => {
  test('holds exactly the six vibe pattern ids', () => {
    expect(Object.keys(VIBE_DRUM_PATTERNS).sort()).toEqual([...LIBRARY_IDS].sort());
  });

  test('every pattern has exactly the seven drum rows, no more and no fewer', () => {
    for (const id of LIBRARY_IDS) {
      expect(Object.keys(VIBE_DRUM_PATTERNS[id]).sort()).toEqual([...ROWS].sort());
    }
  });

  test('every row is exactly 16 steps of literal 0 or 1', () => {
    for (const id of LIBRARY_IDS) {
      for (const row of ROWS) {
        const steps = VIBE_DRUM_PATTERNS[id][row];
        expect(steps.length).toBe(16);
        for (const cell of steps) {
          expect(cell === 0 || cell === 1).toBe(true);
        }
      }
    }
  });
});

describe('drumPatternById', () => {
  test('resolves every library id to a pattern equal to the table entry', () => {
    for (const id of LIBRARY_IDS) {
      expect(drumPatternById(id)).toEqual(VIBE_DRUM_PATTERNS[id]);
    }
  });

  test('returns undefined for an unknown id', () => {
    expect(drumPatternById('no-such-pattern')).toBeUndefined();
    expect(drumPatternById('')).toBeUndefined();
  });

  test('returns a fresh deep copy, so mutating the result cannot reach module state', () => {
    const first = drumPatternById('lofi-half-time-brush')!;
    first.kick[0] = 0;
    first.snare = [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9];

    const second = drumPatternById('lofi-half-time-brush')!;
    expect(second.kick[0]).toBe(1);
    expect(second.snare).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
    expect(VIBE_DRUM_PATTERNS['lofi-half-time-brush'].kick[0]).toBe(1);
  });

  test('never hands back the same array instance twice', () => {
    const first = drumPatternById('zen-bamboo-pulse')!;
    const second = drumPatternById('zen-bamboo-pulse')!;
    expect(first).not.toBe(second);
    expect(first.hihat).not.toBe(second.hihat);
    expect(first.hihat).not.toBe(VIBE_DRUM_PATTERNS['zen-bamboo-pulse'].hihat);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/data/vibeDrumPatterns.test.ts`
Expected: FAIL — the module `./vibeDrumPatterns` does not resolve.

- [ ] **Step 3: Create the library module with the six patterns**

Create `src/audio/data/vibeDrumPatterns.ts`. The rows are copied verbatim from the six
inline blocks in `src/store/instantVibes.ts` — do not retype or "tidy" a single cell:

```ts
// The vibe drum-pattern library: the six Instant Vibes' authored drum
// skeletons, keyed by a library id, so a vibe references a rhythm instead of
// inlining one — the same reference-and-resolve shape CHORD_PROGRESSIONS
// already gives a vibe's chords.
//
// Deliberately NOT merged with GENRE_PRESETS (./genrePresets.ts). Measured:
// no vibe's pattern matches its own genre entry best (Jaccard over hit cells —
// synthwave-80s is closest to Trap at 81%, not Synthwave at 58%; ambient-chill
// peaks at 26% against anything; nothing matches at 100%), and the two
// disagree on cell type (boolean vs number), row set (`bass` only on the
// sequencer side, `crash` only here) and consumer. Merging them would force a
// sound change on one side or the other, which this refactor forbids.
//
// Layering: this file lives under src/audio/ and imports nothing at all, so
// the eslint ban on audio/ -> store/ and audio/ -> components/ cannot be
// violated here. src/store/ may read it; that direction is allowed.

export const VIBE_DRUM_PATTERNS: Record<string, Record<string, number[]>> = {
  'lofi-half-time-brush': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    openhat: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'synthwave-four-on-floor': {
    kick:    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    openhat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'edm-offbeat-pump': {
    kick:    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    openhat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'ambient-sparse-drift': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'boombap-swung-break': {
    kick:    [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'zen-bamboo-pulse': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
};

/**
 * Look up an authored drum pattern by library id.
 *
 * Returns a FRESH deep copy on every call — never the module's own arrays.
 * That is load-bearing, not defensive habit: `rollDecoration`
 * (`src/store/vibeVariation.ts:110`) shallow-spreads the authored pattern with
 * `{ ...authored }`, so the skeleton rows (kick/snare/clap) survive as the
 * same array references and would otherwise flow into the store as live
 * handles on module state. `resolveProgression`, the phase 1 precedent, also
 * returns freshly built objects every call.
 */
export function drumPatternById(id: string): Record<string, number[]> | undefined {
  const pattern = VIBE_DRUM_PATTERNS[id];
  if (!pattern) return undefined;
  const copy: Record<string, number[]> = {};
  for (const [row, steps] of Object.entries(pattern)) {
    copy[row] = [...steps];
  }
  return copy;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/data/vibeDrumPatterns.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Run the type-checker and the full suite**

Run: `bun test && bun run lint`
Expected: whole suite green, `tsc --noEmit` silent.

- [ ] **Step 6: Run the full gate and eslint separately**

Run: `bun run verify && bun run eslint`
Expected: `verify` green; eslint reports exactly **6 problems (0 errors, 6 warnings)** — the pre-existing complexity baseline, unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/audio/data/vibeDrumPatterns.ts src/audio/data/vibeDrumPatterns.test.ts
git commit -m "feat(vibes): add the vibe drum-pattern library keyed by id"
```

---

### Task 2: The before-snapshot fixture

**Files:**
- Create: `src/store/instantVibesDrumsFixture.ts`
- Test: `src/store/instantVibesDrums.test.ts`

**Interfaces:**
- Consumes: `INSTANT_VIBES` from `./instantVibes` (in the **test** only — the fixture itself imports nothing).
- Produces: `export const ORIGINAL_VIBE_DRUM_PATTERNS: Record<string, Record<string, number[]>>` — keyed by **vibe id** (`lofi-chill`, `synthwave-80s`, `cyber-dance`, `ambient-chill`, `hiphop-groove`, `asian-zen`), each value the vibe's 7-row × 16-step pattern as shipped today.

**Why this task must land before task 3:** the fixture is only a proof of
non-regression if it is captured *before* the migration. Landing it first means the test
in this task compares the hand-copied snapshot against the still-inline vibe data, so a
transcription error fails here — and after task 3 the same fixture becomes an
independent witness rather than a re-derivation of whatever the library happens to
contain. This is exactly how phase 1 sequenced `instantVibesChordsFixture.ts`. For the
same reason the fixture file imports **nothing** from `instantVibes.ts`.

- [ ] **Step 1: Write the failing fixture test**

Create `src/store/instantVibesDrums.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { INSTANT_VIBES } from './instantVibes';
import { ORIGINAL_VIBE_DRUM_PATTERNS } from './instantVibesDrumsFixture';

const VIBE_IDS = ['lofi-chill', 'synthwave-80s', 'cyber-dance', 'ambient-chill', 'hiphop-groove', 'asian-zen'];

const ROWS = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'];

describe('ORIGINAL_VIBE_DRUM_PATTERNS fixture', () => {
  test('captures exactly the six vibes', () => {
    expect(Object.keys(ORIGINAL_VIBE_DRUM_PATTERNS).sort()).toEqual([...VIBE_IDS].sort());
  });

  test('matches the drum pattern every vibe in INSTANT_VIBES ships', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(vibe).toBeDefined();
      expect(vibe.drumPattern).toEqual(ORIGINAL_VIBE_DRUM_PATTERNS[id]);
    }
  });

  test('every captured pattern is seven rows of sixteen 0/1 steps', () => {
    for (const id of VIBE_IDS) {
      const pattern = ORIGINAL_VIBE_DRUM_PATTERNS[id];
      expect(Object.keys(pattern).sort()).toEqual([...ROWS].sort());
      for (const row of ROWS) {
        expect(pattern[row].length).toBe(16);
        for (const cell of pattern[row]) {
          expect(cell === 0 || cell === 1).toBe(true);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/instantVibesDrums.test.ts`
Expected: FAIL — the module `./instantVibesDrumsFixture` does not resolve.

- [ ] **Step 3: Create the fixture**

Create `src/store/instantVibesDrumsFixture.ts`:

```ts
/**
 * A verbatim snapshot of every Instant Vibe's `drumPattern`, captured before
 * task 3 of the vibe-drums-from-library plan replaced each vibe's inline rows
 * with `drumPatternId` + `drumPatternById`. Deliberately duplicates the step
 * literals that used to live in `instantVibes.ts` and imports nothing from
 * that file — or from the new library — so this fixture cannot silently track
 * a later change to the data it is meant to be checked against. It is a
 * snapshot, not a re-derivation, and that independence is the whole proof.
 *
 * Keyed by vibe id, not by library pattern id: the point of comparison is
 * "what this vibe sounded like before", so the library's own naming must not
 * leak in here.
 */
export const ORIGINAL_VIBE_DRUM_PATTERNS: Record<string, Record<string, number[]>> = {
  'lofi-chill': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    openhat: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'synthwave-80s': {
    kick:    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    openhat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'cyber-dance': {
    kick:    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    openhat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'ambient-chill': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'hiphop-groove': {
    kick:    [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  'asian-zen': {
    kick:    [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat:   [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    clap:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    tom:     [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    crash:   [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/instantVibesDrums.test.ts`
Expected: PASS — 3 tests, 0 failures. A failure here means a transcription error in the fixture; fix the fixture, never the vibes.

- [ ] **Step 5: Run the type-checker and the full suite**

Run: `bun test && bun run lint`
Expected: whole suite green, `tsc --noEmit` silent.

- [ ] **Step 6: Run the full gate and eslint separately**

Run: `bun run verify && bun run eslint`
Expected: `verify` green; eslint reports exactly **6 problems (0 errors, 6 warnings)**.

- [ ] **Step 7: Commit**

```bash
git add src/store/instantVibesDrumsFixture.ts src/store/instantVibesDrums.test.ts
git commit -m "test(vibes): snapshot the six vibes' drum patterns before the library migration"
```

---

### Task 3: Migrate the vibes onto `drumPatternId`

**Files:**
- Modify: `src/types.ts` (the `InstantVibe` interface, at the `drumPattern` field)
- Modify: `src/store/instantVibes.ts:142-150, 217-225, 295-303, 370-378, 444-452, 521-529` (plus the import block at the top)
- Test: `src/store/instantVibesDrums.test.ts` (extend the file created in task 2)

**Interfaces:**
- Consumes: `drumPatternById` from `../audio/data/vibeDrumPatterns` (task 1); `ORIGINAL_VIBE_DRUM_PATTERNS` from `./instantVibesDrumsFixture` (task 2).
- Produces: `InstantVibe.drumPatternId: string` — a library reference into `VIBE_DRUM_PATTERNS`; `drumPattern` stays and is its resolved output, exactly as `chords` is `progressionId`'s.

**Import direction:** `src/store/instantVibes.ts` must import `drumPatternById` from
`../audio/data/vibeDrumPatterns`. `store/` → `audio/` **is** an allowed direction under
the eslint `no-restricted-imports` layering rule and that file already does it twice
(`../audio/engine`, `../audio/data/chordProgressions`).

- [ ] **Step 1: Write the failing migration tests**

Append to `src/store/instantVibesDrums.test.ts` — and add `drumPatternById` to that
file's imports so the top of the file reads:

```ts
import { describe, expect, test } from 'bun:test';
import { INSTANT_VIBES } from './instantVibes';
import { ORIGINAL_VIBE_DRUM_PATTERNS } from './instantVibesDrumsFixture';
import { drumPatternById } from '../audio/data/vibeDrumPatterns';
```

Then append these two describe blocks at the end of the file:

```ts
describe('InstantVibe.drumPatternId reproduces the fixture exactly', () => {
  test('every vibe has a drumPatternId that resolves to a real library pattern', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(typeof vibe.drumPatternId).toBe('string');
      expect(vibe.drumPatternId.length).toBeGreaterThan(0);
      expect(drumPatternById(vibe.drumPatternId)).toBeDefined();
    }
  });

  test('resolving drumPatternId reproduces the captured pattern byte-for-byte', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(drumPatternById(vibe.drumPatternId)).toEqual(ORIGINAL_VIBE_DRUM_PATTERNS[id]);
    }
  });

  test('vibe.drumPattern is itself the resolved library pattern, not a separate literal', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(vibe.drumPattern).toEqual(drumPatternById(vibe.drumPatternId)!);
    }
  });

  test('the six vibes map onto six distinct library ids', () => {
    const referenced = INSTANT_VIBES.map((v) => v.drumPatternId);
    expect(new Set(referenced).size).toBe(6);
    expect([...referenced].sort()).toEqual([
      'ambient-sparse-drift',
      'boombap-swung-break',
      'edm-offbeat-pump',
      'lofi-half-time-brush',
      'synthwave-four-on-floor',
      'zen-bamboo-pulse',
    ]);
  });
});

describe('a vibe does not share array instances with the library', () => {
  test('mutating a vibe row cannot rewrite VIBE_DRUM_PATTERNS', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      const fresh = drumPatternById(vibe.drumPatternId)!;
      expect(vibe.drumPattern.kick).not.toBe(fresh.kick);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/instantVibesDrums.test.ts`
Expected: FAIL — `drumPatternId` does not exist on `InstantVibe`, so the resolution tests fail (and `bun run lint` would report `Property 'drumPatternId' does not exist`).

- [ ] **Step 3: Add `drumPatternId` to the `InstantVibe` interface**

In `src/types.ts`, in the `// Beat & Drum Kit` block of `interface InstantVibe`, replace:

```ts
  soundKit: string;
  drumPattern: Record<string, number[]>;
```

with:

```ts
  soundKit: string;
  drumPattern: Record<string, number[]>;
  /** Library reference into VIBE_DRUM_PATTERNS. `drumPattern` is its resolved output. */
  drumPatternId: string;
```

`src/types.ts` stays a zero-import leaf — this adds no import.

- [ ] **Step 4: Import the resolver in `instantVibes.ts`**

In `src/store/instantVibes.ts`, below the existing `chordProgressions` import, add:

```ts
import { drumPatternById } from '../audio/data/vibeDrumPatterns';
```

- [ ] **Step 5: Replace the `lofi-chill` inline block**

In `src/store/instantVibes.ts` (currently lines 142-150), replace:

```ts
    drumPattern: {
      kick:  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
      openhat: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      clap:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      tom:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
      crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
```

with:

```ts
    drumPatternId: 'lofi-half-time-brush',
    drumPattern: drumPatternById('lofi-half-time-brush')!,
```

- [ ] **Step 6: Replace the `synthwave-80s` inline block**

Replace:

```ts
    drumPattern: {
      kick:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      openhat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      clap:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      tom:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
      crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
```

with:

```ts
    drumPatternId: 'synthwave-four-on-floor',
    drumPattern: drumPatternById('synthwave-four-on-floor')!,
```

- [ ] **Step 7: Replace the `cyber-dance` inline block**

Replace:

```ts
    drumPattern: {
      kick:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      openhat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      clap:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      tom:   [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
      crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
```

with:

```ts
    drumPatternId: 'edm-offbeat-pump',
    drumPattern: drumPatternById('edm-offbeat-pump')!,
```

- [ ] **Step 8: Replace the `ambient-chill` inline block**

Replace:

```ts
    drumPattern: {
      kick:  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      clap:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      tom:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
```

with:

```ts
    drumPatternId: 'ambient-sparse-drift',
    drumPattern: drumPatternById('ambient-sparse-drift')!,
```

- [ ] **Step 9: Replace the `hiphop-groove` inline block**

Replace:

```ts
    drumPattern: {
      kick:  [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
      openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      clap:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      tom:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
```

with:

```ts
    drumPatternId: 'boombap-swung-break',
    drumPattern: drumPatternById('boombap-swung-break')!,
```

- [ ] **Step 10: Replace the `asian-zen` inline block**

Replace:

```ts
    drumPattern: {
      kick:  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hihat: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
      openhat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      clap:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      tom:   [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      crash: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
```

with:

```ts
    drumPatternId: 'zen-bamboo-pulse',
    drumPattern: drumPatternById('zen-bamboo-pulse')!,
```

- [ ] **Step 11: Confirm no inline drum rows remain**

Run: `grep -n "drumPattern" src/store/instantVibes.ts`
Expected: exactly 13 hits — the `Object.entries(vibe.drumPattern)` line around line 81, plus one `drumPatternId:` and one `drumPattern: drumPatternById(...)` line per vibe. No `kick:` / `snare:` step arrays anywhere in the file:

Run: `grep -c "kick:" src/store/instantVibes.ts`
Expected: `0`.

- [ ] **Step 12: Run the migration tests to verify they pass**

Run: `bun test src/store/instantVibesDrums.test.ts`
Expected: PASS — 8 tests, 0 failures. The fixture tests from task 2 still pass unchanged, which is the byte-for-byte non-regression proof.

- [ ] **Step 13: Run the whole suite and the type-checker**

Run: `bun test && bun run lint`
Expected: everything green — in particular `instantVibes.test.ts`, `vibeVariation.test.ts` and `instantVibesProgressions.test.ts` pass untouched, and `tsc --noEmit` is silent (no leftover unused import; `@typescript-eslint/no-unused-vars` is an error).

- [ ] **Step 14: Run the full gate and eslint separately**

Run: `bun run verify && bun run eslint`
Expected: `verify` green; eslint reports exactly **6 problems (0 errors, 6 warnings)** — the pre-existing complexity baseline, no seventh.

- [ ] **Step 15: Commit**

```bash
git add src/types.ts src/store/instantVibes.ts src/store/instantVibesDrums.test.ts
git commit -m "refactor(vibes): resolve every vibe's drum pattern from a library id"
```

---

## Done when

- `src/store/instantVibes.ts` contains no drum step arrays; each of the six vibes carries a `drumPatternId` and a `drumPatternById(...)`-resolved `drumPattern`.
- `bun run verify` is green and `bun run eslint` reports exactly 6 warnings, 0 errors.
- `ORIGINAL_VIBE_DRUM_PATTERNS` still equals every vibe's live `drumPattern`, so no vibe's rhythm changed by a single cell.
- `src/store/vibeVariation.ts`, `src/audio/data/genrePresets.ts`, `applyInstantVibeToStore`, all `variation` data and every `soundKit` are byte-identical to their state before this plan.
