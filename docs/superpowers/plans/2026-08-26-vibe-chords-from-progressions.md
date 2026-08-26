# Vibe Chords From Progressions — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Instant Vibe's chords stop being an inline `ChordItem[]` literal and become a `progressionId` resolved through `resolveProgression` — with **no change to what any vibe sounds like**, with one sanctioned exception: `ambient-chill` is first corrected from 2 bars/chord to 4 bars/chord (Task 1) so it matches the `ambient` genre's own bar-floor rule, before the no-sound-change refactor begins. Four vibes (`lofi-chill`, `cyber-dance`, `ambient-chill`, `hiphop-groove`) get a new `CHORD_PROGRESSIONS` entry authored to reproduce their (corrected, for `ambient-chill`) current chords exactly; two (`synthwave-80s`, `asian-zen`) already have a matching entry (`cine-epic-ostinato`, `zen-bamboo-vamp`) and need only the id.

**Architecture:** `InstantVibe` gains a `progressionId: string` field (`src/types.ts`). Each vibe's `chords: ChordItem[]` field stays on the type — it becomes the *resolved* output of `progressionId`, computed once at module-eval time in `src/store/instantVibes.ts` via `resolveProgression(progressionById(id)!, vibe.scaleRoot, vibe.scaleType, vibe.chordOctave)`, the same pattern the Vibe Variation resolver already uses. `applyInstantVibeToStore` is untouched: it still reads `vibe.chords` directly (`store.setChords(vibe.chords)`), so the swap happens ahead of the call, not inside it. No second apply path, no engine call, no persist version bump.

**Tech Stack:** Bun (test runner + scripts), Vite, React 18, Zustand (`subscribeWithSelector` + `persist`), raw Web Audio API, `tonal` for note/interval/chord math, Tailwind v4 + daisyUI v5 CSS-first.

**Spec:** `docs/superpowers/specs/2026-08-26-vibe-as-references-design.md` (Phase 1 of 4 — "Chords -> `progressionId`"). Phases 2–4 (synth presets, drum patterns, effect chains) are out of scope.

## Global Constraints

- **Layering (eslint `no-restricted-imports`):** `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; `src/store/` importing `src/audio/` **is** allowed and already used (`src/store/instantVibes.ts` imports `audioEngine` from `../audio/engine`). This plan adds one more such import: `progressionById` and `resolveProgression` from `../audio/data/chordProgressions`.
- **A genre tag is only valid when `referenceScale === VIBE_GENRE_SCALES[tag]`:** `lofi → Major`, `synthwave → Natural Minor`, `edm → Natural Minor`, `ambient → Lydian`, `boombap → Dorian`, `zen → Hirajoshi`.
- **`minScaleLength` must equal `SCALES[referenceScale].intervals.length`.** All four new entries use 7-degree scales (Major, Natural Minor, Lydian, Dorian), so `minScaleLength: 7` is correct for all four — this is not a default to copy for a 5- or 6-degree scale.
- **`deriveChordNotes()` stays the single source of truth for `ChordItem.notes`.** `resolveProgression` already calls through it; this plan never hand-builds a `notes` array except in the fixture file (Task 4), which deliberately duplicates the exact call the code used to make, not a new derivation.
- **Existing invariant suites must keep passing, and where this plan's data change breaks one, the plan says exactly how it is fixed (not left to the implementer):**
  - `src/audio/data/chordProgressions.migration.test.ts` — pins the 22 migrated progressions across all 12 roots. Unaffected: this plan only appends new entries after them.
  - `src/audio/data/chordProgressions.test.ts` — the genre-floor test (`>= 4` per genre) and **the exact-tagged-id-set test** (`idsFor(genre)`) . Adding a `lofi`/`edm`/`ambient`/`boombap`-tagged entry each appends one id to the end of that genre's expected array (new entries are appended to the end of `CHORD_PROGRESSIONS`, and `idsFor` filters in array order) — Task 2 updates this test inline.
  - `src/store/vibeVariation.test.ts`'s `'progressionIds equals the full genre-and-scale-length filter'` test (already committed on this branch) recomputes each vibe's dice pool from `CHORD_PROGRESSIONS` by genre + scale length. Tagging a new progression for `lofi`/`edm`/`ambient`/`boombap` therefore *breaks this test immediately after Task 2*, for `lofi-chill`, `cyber-dance`, `ambient-chill` and `hiphop-groove`, until their authored `variation.progressionIds` include the new id. Task 3 fixes this, and only this — no other vibe's pool changes.
  - `chordProgressions.test.ts`'s **ambient bar convention test** (`'ambient entries hold 4+ bars and avoid V-I...'`) requires every step of every `ambient`-tagged progression to hold `bars >= 4`. `ambient-chill`'s current chords hold 2 bars each, which contradicts this rule and every progression in `ambient-chill`'s own dice pool (all 4 or 8 bars/chord) — so the vibe, not the rule, is wrong. **Resolution: Task 1 corrects `ambient-chill`'s authored chords from `bars: 2` to `bars: 4` before any progression is authored, and commits that alone.** `ambient-lydian-halo` (Task 2) is then authored at 4 bars/chord from the start and ships `genres: ['ambient']` like every other new entry — no untagged, library-only workaround.
  - `chordProgressions.test.ts`'s **lofi/boombap "extension on every step" test** requires `step.quality` to match `/7|9|11|13/` on every step of a `lofi`- or `boombap`-tagged entry. Both new entries (`lofi-morning-turnaround`, `boombap-soul-piano`) satisfy this: every step carries an explicit seventh-chord quality.
  - `chordProgressions.test.ts`'s **EDM bar-uniformity test** requires all of one progression's steps to share one `bars` value, and at least 3 of the 4 `edm`-tagged progressions to be entirely 2-bar. `edm-cyber-vamp` is uniformly 1-bar (matching `cyber-dance`'s current chords) — the existing 3 two-bar entries (`edm-cyber-drop`, `edm-neon-rise`, `edm-arena-sweep`) still satisfy `>= 3`, so this is unaffected.
- **`getDiatonicChordForDegree(degree, root, scaleType, false)` (used inside `resolveProgression`) always computes the scale's **triad** for that degree, never a seventh** (`src/utils/musicTheory.ts:149-177`) — `resolveProgression` takes the final quality as `progressionStep.quality ?? diatonic.quality`. This means every step in this plan's four new entries that needs a seventh chord (all of them except `cyber-dance`'s and `ambient-chill`'s II chord) **must** carry an explicit `quality` override even where that override happens to equal the scale's own seventh-chord table entry — omitting it would silently downgrade the chord to a triad.
- **Instant Vibe ids and library ids already in use must never be renamed.** This plan adds new library ids only; it renames nothing.
- **Gate:** `bun run verify` (test + lint + check:keys + check:drums + build); `bun run eslint` run separately — not part of `verify` — whenever imports move (Task 6 adds one).
- **Tests are pure-logic `bun:test`** — no DOM, no testing-library, and none may be added.
- The app has no users, so persisted shapes and the store version are not compatibility constraints.

## Derived `steps` for the four new progressions

Computed from `SCALES.Major/'Natural Minor'/Dorian/Lydian` (`src/utils/musicTheory.ts:15-103`) and verified by hand against `getDiatonicChordForDegree`:

| vibe | progression id | referenceScale | root/type | `steps` |
| --- | --- | --- | --- | --- |
| `lofi-chill` | `lofi-morning-turnaround` | Major | C Major | `[step(0, 1, 'maj7'), step(5, 1, 'min7'), step(1, 1, 'min7'), step(4, 1, '7')]` → Cmaj7, Amin7, Dmin7, G7 |
| `cyber-dance` | `edm-cyber-vamp` | Natural Minor | F Natural Minor | `[step(0), step(6), step(5), step(4)]` → Fmin, D#maj, C#maj, Cmin (all triad defaults — no overrides needed) |
| `ambient-chill` | `ambient-lydian-halo` | Lydian | D Lydian | `[step(0, 4, 'maj7'), step(1, 4), step(2, 4, 'min7'), step(3, 4, 'm7b5')]` → Dmaj7, Emaj, F#min7, G#m7b5 (4 bars each, corrected by Task 1 from the vibe's old 2-bar chords) |
| `hiphop-groove` | `boombap-soul-piano` | Dorian | E Dorian | `[step(0, 1, 'min7'), step(3, 1, '7'), step(6, 1, 'maj7'), step(2, 1, 'maj7')]` → Emin7, A7, Dmaj7, Gmaj7 |

## File structure

```
src/types.ts                                    # InstantVibe gains progressionId: string
src/audio/data/chordProgressions.ts             # +4 CHORD_PROGRESSIONS entries
src/audio/data/chordProgressions.test.ts        # exact-tagged-id-set test updated
src/store/instantVibes.ts                       # Task 1: ambient-chill corrected to 4 bars/chord; +progressionId per vibe; chords via resolveProgression; 4 pools gain 1 id; makeVibeChord deleted
src/store/instantVibesChordsFixture.ts          # NEW — pre-refactor chords snapshot
src/store/instantVibesProgressions.test.ts      # NEW — equivalence proof + progressionId invariants
```

---

### Task 1: Correct `ambient-chill` to 4 bars per chord

`ambient-chill`'s four authored chords currently hold `bars: 2` each, which contradicts
the `ambient` genre's own bar-floor rule (every `ambient`-tagged `CHORD_PROGRESSIONS`
entry must hold `bars >= 4`, enforced by `chordProgressions.test.ts`'s `'ambient
entries hold 4+ bars and avoid V-I...'` test) and every progression already in
`ambient-chill`'s own dice pool (`ambient-still-water`, `ambient-lydian-drift`,
`ambient-open-fourths`, `ambient-glass-horizon` — all 4 or 8 bars/chord). The vibe was
authored wrong, not the rule: this task is the one sanctioned exception to Phase 1's
"no vibe's sound changes" rule, made first and committed by itself, so the fixture
`instantVibesChordsFixture.ts` captures later in this plan (Task 4) is captured from
the already-corrected chords and is an honest baseline for proving the refactor itself
(Tasks 2-6) changes nothing further. This doubles `ambient-chill`'s total progression
length from 8 bars to 16 bars — that is intended, not a bug to fix later.

**Files:**
- Modify: `src/store/instantVibes.ts:507-510` (`ambient-chill`'s `chords` array)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ambient-chill`'s corrected 4-bars-per-chord sound — consumed by Task 4's fixture capture as the baseline "today's chords".

- [ ] **Step 1: Confirm today's value**

```bash
grep -n "makeVibeChord('am" src/store/instantVibes.ts
```

Expected output:

```ts
      makeVibeChord('am1', 'D', 'maj7', 2, 4),
      makeVibeChord('am2', 'E', 'maj', 2, 4),
      makeVibeChord('am3', 'F#', 'min7', 2, 4),
      makeVibeChord('am4', 'G#', 'm7b5', 2, 4),
```

- [ ] **Step 2: Change `bars` from 2 to 4**

In `src/store/instantVibes.ts:507-510` (inside `ambient-chill`'s `chords: [...]` block):

Before:

```ts
    chords: [
      makeVibeChord('am1', 'D', 'maj7', 2, 4),
      makeVibeChord('am2', 'E', 'maj', 2, 4),
      makeVibeChord('am3', 'F#', 'min7', 2, 4),
      makeVibeChord('am4', 'G#', 'm7b5', 2, 4),
    ],
```

After:

```ts
    chords: [
      makeVibeChord('am1', 'D', 'maj7', 4, 4),
      makeVibeChord('am2', 'E', 'maj', 4, 4),
      makeVibeChord('am3', 'F#', 'min7', 4, 4),
      makeVibeChord('am4', 'G#', 'm7b5', 4, 4),
    ],
```

(The third argument to `makeVibeChord(id, root, quality, bars, octave)` is `bars`; the trailing `4` is `octave` and is unrelated — both happen to read `4` after this change, which is coincidental, not a mistake.)

- [ ] **Step 3: Run the existing vibe test suite to confirm nothing else broke**

```bash
bun test src/store/instantVibes.test.ts src/store/vibeVariation.test.ts
```

Expected: PASS. No existing test pins `ambient-chill.chords[i].bars` at 2 — the bar-floor invariant only constrains `CHORD_PROGRESSIONS` entries, not `InstantVibe.chords` directly, so this change trips no invariant yet (Task 1 only changes what the vibe *authors*; Task 4's fixture and Task 6's equivalence proof are what will pin the new value of 4 going forward).

- [ ] **Step 4: Commit**

```bash
git add src/store/instantVibes.ts
git commit -m "fix(vibes): correct ambient-chill to 4 bars per chord to match the ambient genre rule"
```

---

### Task 2: Author the four new chord progressions

**Files:**
- Modify: `src/audio/data/chordProgressions.ts:589` (append 4 entries before the closing `];` of `CHORD_PROGRESSIONS`)
- Modify: `src/audio/data/chordProgressions.test.ts:91-132` (the exact-tagged-id-set test)

**Interfaces:**
- Consumes: `step()`, `ChordProgression`, `VIBE_GENRE_SCALES` (all already in `chordProgressions.ts`).
- Produces: `progressionById('lofi-morning-turnaround')`, `progressionById('edm-cyber-vamp')`, `progressionById('ambient-lydian-halo')`, `progressionById('boombap-soul-piano')` — consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Append to `src/audio/data/chordProgressions.test.ts`, after the `resolveProgression` describe block:

```ts
describe('the four Phase 1 vibe-chord progressions', () => {
  test('lofi-morning-turnaround resolves to Cmaj7 Amin7 Dmin7 G7 in C Major', () => {
    const p = progressionById('lofi-morning-turnaround')!;
    expect(p).toBeDefined();
    expect(resolveProgression(p, 'C', 'Major', 4).map((c) => `${c.root}${c.quality}`)).toEqual([
      'Cmaj7', 'Amin7', 'Dmin7', 'G7',
    ]);
  });

  test('edm-cyber-vamp resolves to Fmin D#maj C#maj Cmin in F Natural Minor', () => {
    const p = progressionById('edm-cyber-vamp')!;
    expect(p).toBeDefined();
    expect(resolveProgression(p, 'F', 'Natural Minor', 4).map((c) => `${c.root}${c.quality}`)).toEqual([
      'Fmin', 'D#maj', 'C#maj', 'Cmin',
    ]);
  });

  test('ambient-lydian-halo resolves to Dmaj7 Emaj F#min7 G#m7b5 in D Lydian, 4 bars each', () => {
    const p = progressionById('ambient-lydian-halo')!;
    expect(p).toBeDefined();
    const chords = resolveProgression(p, 'D', 'Lydian', 4);
    expect(chords.map((c) => `${c.root}${c.quality}`)).toEqual([
      'Dmaj7', 'Emaj', 'F#min7', 'G#m7b5',
    ]);
    expect(chords.map((c) => c.bars)).toEqual([4, 4, 4, 4]);
  });

  test('boombap-soul-piano resolves to Emin7 A7 Dmaj7 Gmaj7 in E Dorian', () => {
    const p = progressionById('boombap-soul-piano')!;
    expect(p).toBeDefined();
    expect(resolveProgression(p, 'E', 'Dorian', 4).map((c) => `${c.root}${c.quality}`)).toEqual([
      'Emin7', 'A7', 'Dmaj7', 'Gmaj7',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/audio/data/chordProgressions.test.ts
```

Expected: FAIL — all four `progressionById(...)` calls return `undefined`, so `p` is `undefined` and the `toBeDefined()` assertions fail (the `!` non-null assertion does not throw at runtime; the subsequent `resolveProgression(undefined, ...)` calls throw instead).

- [ ] **Step 3: Add the four entries**

In `src/audio/data/chordProgressions.ts`, insert immediately before the closing `];` of `CHORD_PROGRESSIONS` (after `zen-temple-bell`):

```ts
  {
    id: 'lofi-morning-turnaround',
    name: 'Morning Brew Turnaround',
    roman: 'I – vi – ii – V',
    description:
      'Warm extended-seventh turnaround built for lo-fi\'s laid-back morning loop, closing the fourth bar on a dominant seventh that resets cleanly into the top.',
    category: 'Lofi & R&B',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(0, 1, 'maj7'), step(5, 1, 'min7'), step(1, 1, 'min7'), step(4, 1, '7')],
  },
  {
    id: 'edm-cyber-vamp',
    name: 'Cyber Vamp',
    roman: 'i – VII – VI – v',
    description:
      'A minor tonic rocking between its two flat neighbours before dipping to the minor v, one bar per chord for a tight festival-drop loop.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['edm'],
    minScaleLength: 7,
    steps: [step(0), step(6), step(5), step(4)],
  },
  {
    id: 'ambient-lydian-halo',
    name: 'Lydian Halo',
    roman: 'I – II – iii – #ivø7',
    description:
      'A Lydian float that lifts through the major II before settling on the raised-4th half-diminished, four bars per chord for a slow-breathing pad loop.',
    category: 'Ambient & Zen',
    referenceScale: 'Lydian',
    genres: ['ambient'],
    minScaleLength: 7,
    steps: [step(0, 4, 'maj7'), step(1, 4), step(2, 4, 'min7'), step(3, 4, 'm7b5')],
  },
  {
    id: 'boombap-soul-piano',
    name: 'Soul Piano Loop',
    roman: 'i – IV7 – VII – III',
    description:
      'A Dorian loop built for a mellow keys sample: minor seventh tonic, dominant modal IV, then two major sevenths on the way back home.',
    category: 'Lofi & R&B',
    referenceScale: 'Dorian',
    genres: ['boombap'],
    minScaleLength: 7,
    steps: [step(0, 1, 'min7'), step(3, 1, '7'), step(6, 1, 'maj7'), step(2, 1, 'maj7')],
  },
```

- [ ] **Step 4: Update the exact-tagged-id-set test**

In `src/audio/data/chordProgressions.test.ts`, replace the three affected arrays inside `'the exact tagged set per genre is authored, not inferred'`:

```ts
    expect(idsFor('lofi')).toEqual([
      'jazz-ii-v-i-vi',
      'jazz-neosoul-butter',
      'lofi-coffeehouse',
      'lofi-bedroom-pop',
      'lofi-rainy-window',
      'lofi-tape-loop',
      'lofi-morning-turnaround',
    ]);
    expect(idsFor('synthwave')).toEqual([
      'pop-club-house',
      'cine-epic-ostinato',
      'synthwave-midnight-drive',
      'synthwave-neon-horizon',
    ]);
    expect(idsFor('edm')).toEqual([
      'pop-club-house',
      'edm-cyber-drop',
      'edm-neon-rise',
      'edm-arena-sweep',
      'edm-cyber-vamp',
    ]);
    expect(idsFor('ambient')).toEqual([
      'ambient-still-water',
      'ambient-lydian-drift',
      'ambient-open-fourths',
      'ambient-glass-horizon',
      'ambient-lydian-halo',
    ]);
    expect(idsFor('boombap')).toEqual([
      'cine-dorian-voyage',
      'boombap-dusty-ii-v',
      'boombap-crate-dig',
      'boombap-head-nod',
      'boombap-soul-piano',
    ]);
    expect(idsFor('zen')).toEqual([
      'zen-bamboo-vamp',
      'zen-moonlit-koto',
      'zen-still-pond',
      'zen-temple-bell',
    ]);
```

(`synthwave` and `zen` arrays are unchanged — reproduced verbatim so the whole `test` body stays a single literal.)

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test src/audio/data/chordProgressions.test.ts src/audio/data/chordProgressions.migration.test.ts
```

Expected: PASS, all tests in both files green.

- [ ] **Step 6: Commit**

```bash
git add src/audio/data/chordProgressions.ts src/audio/data/chordProgressions.test.ts
git commit -m "feat(chords): add the four vibe-chord progressions Phase 1 needs"
```

---

### Task 3: Fix the vibe dice pools the new tags broke

Adding a `lofi`/`edm`/`ambient`/`boombap`-tagged progression in Task 2 makes `src/store/vibeVariation.test.ts`'s already-committed `'progressionIds equals the full genre-and-scale-length filter'` test fail for `lofi-chill`, `cyber-dance`, `ambient-chill` and `hiphop-groove` — it recomputes each vibe's dice pool from `CHORD_PROGRESSIONS` by genre and scale length and compares it to the authored `variation.progressionIds`. `synthwave-80s`/`asian-zen` are unaffected because Task 2 added no `synthwave`- or `zen`-tagged entry.

**Files:**
- Modify: `src/store/instantVibes.ts:218` (`lofi-chill.variation.progressionIds`)
- Modify: `src/store/instantVibes.ts:466` (`cyber-dance.variation.progressionIds`)
- Modify: `src/store/instantVibes.ts:584` (`ambient-chill.variation.progressionIds`)
- Modify: `src/store/instantVibes.ts:703` (`hiphop-groove.variation.progressionIds`)

**Interfaces:**
- Consumes: `lofi-morning-turnaround`, `edm-cyber-vamp`, `ambient-lydian-halo`, `boombap-soul-piano` (Task 2).
- Produces: nothing new — restores an existing invariant to green.

- [ ] **Step 1: Run the test to see it fail**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: FAIL — the `'progressionIds equals the full genre-and-scale-length filter'` test reports a mismatch for `lofi-chill`, `cyber-dance`, `ambient-chill` and `hiphop-groove`: each authored `progressionIds` array is missing the newly tagged id.

- [ ] **Step 2: Append the new id to each of the four pools**

`src/store/instantVibes.ts:218`, `lofi-chill`:

```ts
      progressionIds: ['jazz-ii-v-i-vi', 'jazz-neosoul-butter', 'lofi-coffeehouse', 'lofi-bedroom-pop', 'lofi-rainy-window', 'lofi-tape-loop', 'lofi-morning-turnaround'],
```

`src/store/instantVibes.ts:466`, `cyber-dance`:

```ts
      progressionIds: ['pop-club-house', 'edm-cyber-drop', 'edm-neon-rise', 'edm-arena-sweep', 'edm-cyber-vamp'],
```

`src/store/instantVibes.ts:584`, `ambient-chill`:

```ts
      progressionIds: ['ambient-still-water', 'ambient-lydian-drift', 'ambient-open-fourths', 'ambient-glass-horizon', 'ambient-lydian-halo'],
```

`src/store/instantVibes.ts:703`, `hiphop-groove`:

```ts
      progressionIds: ['cine-dorian-voyage', 'boombap-dusty-ii-v', 'boombap-crate-dig', 'boombap-head-nod', 'boombap-soul-piano'],
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
bun test src/store/vibeVariation.test.ts
```

Expected: PASS, all tests green (including the exhaustive `allDraws` tests, which now also enumerate the new progression as a possible draw for these four vibes).

- [ ] **Step 4: Commit**

```bash
git add src/store/instantVibes.ts
git commit -m "fix(vibes): add the four newly-tagged progressions to their dice pools"
```

---

### Task 4: Capture today's chords as an independent fixture

Captures the current `chords` array of all six vibes (including `ambient-chill`'s Task 1 correction, already committed) **before** Task 6 deletes them, in the same spirit as the migration proof's `ORIGINAL_TEMPLATES` (`src/audio/data/chordProgressions.migration.test.ts:25-70`): a snapshot that does not import anything from the file it is proving, so it cannot silently track a later change to that file.

**Files:**
- Create: `src/store/instantVibesChordsFixture.ts`
- Test: `src/store/instantVibesProgressions.test.ts` (create)

**Interfaces:**
- Consumes: `deriveChordNotes` from `src/utils/musicTheory.ts`, `ChordItem` from `src/types.ts`.
- Produces: `ORIGINAL_VIBE_CHORDS: Record<string, ChordItem[]>` — consumed by Task 5's equivalence test.

- [ ] **Step 1: Write the failing test**

Create `src/store/instantVibesProgressions.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { INSTANT_VIBES } from './instantVibes';
import { ORIGINAL_VIBE_CHORDS } from './instantVibesChordsFixture';

const VIBE_IDS = ['lofi-chill', 'synthwave-80s', 'cyber-dance', 'ambient-chill', 'hiphop-groove', 'asian-zen'];

describe('ORIGINAL_VIBE_CHORDS fixture', () => {
  test('captures exactly the six vibes, matching what INSTANT_VIBES ships today', () => {
    expect(Object.keys(ORIGINAL_VIBE_CHORDS).sort()).toEqual([...VIBE_IDS].sort());
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(vibe).toBeDefined();
      expect(ORIGINAL_VIBE_CHORDS[id]).toEqual(vibe.chords);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/instantVibesProgressions.test.ts
```

Expected: FAIL — `Cannot find module './instantVibesChordsFixture'`.

- [ ] **Step 3: Write the fixture**

Create `src/store/instantVibesChordsFixture.ts`:

```ts
import type { ChordItem } from '../types';
import { deriveChordNotes } from '../utils/musicTheory';

/**
 * A verbatim snapshot of every Instant Vibe's `chords` array, captured before
 * Task 6 of the vibe-chords-from-progressions plan replaced each vibe's
 * inline chords with `progressionId` + `resolveProgression`. Deliberately
 * duplicates the id/root/quality/bars/octave literals that used to live in
 * `instantVibes.ts` (via a local `snapshotChord`, not an import of anything
 * from that file) so this fixture cannot silently track a later change to
 * the vibes it is meant to be checked against — it is a snapshot, not a
 * re-derivation.
 */
function snapshotChord(id: string, root: string, quality: string, bars: number, octave: number): ChordItem {
  return deriveChordNotes({ id, root, quality, bars, notes: [] }, octave);
}

export const ORIGINAL_VIBE_CHORDS: Record<string, ChordItem[]> = {
  'lofi-chill': [
    snapshotChord('c1', 'C', 'maj7', 1, 4),
    snapshotChord('c2', 'A', 'min7', 1, 4),
    snapshotChord('c3', 'D', 'min7', 1, 4),
    snapshotChord('c4', 'G', '7', 1, 4),
  ],
  'synthwave-80s': [
    snapshotChord('sw1', 'A', 'min', 1, 4),
    snapshotChord('sw2', 'F', 'maj', 1, 4),
    snapshotChord('sw3', 'C', 'maj', 1, 4),
    snapshotChord('sw4', 'G', 'maj', 1, 4),
  ],
  'cyber-dance': [
    snapshotChord('cy1', 'F', 'min', 1, 4),
    snapshotChord('cy2', 'D#', 'maj', 1, 4),
    snapshotChord('cy3', 'C#', 'maj', 1, 4),
    snapshotChord('cy4', 'C', 'min', 1, 4),
  ],
  'ambient-chill': [
    snapshotChord('am1', 'D', 'maj7', 4, 4),
    snapshotChord('am2', 'E', 'maj', 4, 4),
    snapshotChord('am3', 'F#', 'min7', 4, 4),
    snapshotChord('am4', 'G#', 'm7b5', 4, 4),
  ],
  'hiphop-groove': [
    snapshotChord('bb1', 'E', 'min7', 1, 4),
    snapshotChord('bb2', 'A', '7', 1, 4),
    snapshotChord('bb3', 'D', 'maj7', 1, 4),
    snapshotChord('bb4', 'G', 'maj7', 1, 4),
  ],
  'asian-zen': [
    snapshotChord('zn1', 'G', 'min', 2, 4),
    snapshotChord('zn2', 'D', 'sus4', 2, 4),
    snapshotChord('zn3', 'G', 'min', 2, 4),
    snapshotChord('zn4', 'D#', 'maj', 2, 4),
  ],
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test src/store/instantVibesProgressions.test.ts
```

Expected: PASS — the fixture's six entries deep-equal `INSTANT_VIBES`'s current inline `chords` arrays (ids included; `ambient-chill`'s entry reflects Task 1's 4-bar correction, already committed, so this fixture captures the corrected sound, not the pre-Task-1 one).

- [ ] **Step 5: Commit**

```bash
git add src/store/instantVibesChordsFixture.ts src/store/instantVibesProgressions.test.ts
git commit -m "test(vibes): capture today's inline chords before replacing them with progressionId"
```

---

### Task 5: Add `progressionId` and prove it reproduces the fixture

**Files:**
- Modify: `src/types.ts` (append `progressionId: string;` to the `InstantVibe` interface, immediately after the `chords: ChordItem[];` field)
- Modify: `src/store/instantVibes.ts` (add `progressionId: '...'` to each of the six vibe literals; inline `chords` arrays are **not** touched yet — that is Task 6)
- Test: `src/store/instantVibesProgressions.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `ORIGINAL_VIBE_CHORDS` (Task 4), `progressionById`/`resolveProgression` from `src/audio/data/chordProgressions.ts` (already exported), the four new progression ids (Task 2), `cine-epic-ostinato`/`zen-bamboo-vamp` (pre-existing).
- Produces: `InstantVibe.progressionId: string` — consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Append to `src/store/instantVibesProgressions.test.ts`:

```ts
import { progressionById, resolveProgression } from '../audio/data/chordProgressions';

// Root/quality/bars/notes only — resolveProgression ids are
// `${progressionId}-${i}`, which never matches the fixture's hand-authored
// ids (`c1`, `sw1`, ...), and that difference is not part of what "the same
// chords" means here.
function withoutId(chords: { root: string; quality: string; bars: number; notes: string[] }[]) {
  return chords.map(({ root, quality, bars, notes }) => ({ root, quality, bars, notes }));
}

describe('InstantVibe.progressionId reproduces the fixture exactly', () => {
  test('every vibe has a progressionId that resolves to a real progression', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      expect(vibe.progressionId).toBeDefined();
      expect(progressionById(vibe.progressionId)).toBeDefined();
    }
  });

  test('resolving progressionId in the vibe\'s own key reproduces the captured chords byte-for-byte', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      const progression = progressionById(vibe.progressionId)!;
      const resolved = resolveProgression(progression, vibe.scaleRoot, vibe.scaleType, vibe.chordOctave);
      expect(withoutId(resolved)).toEqual(withoutId(ORIGINAL_VIBE_CHORDS[id]));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/instantVibesProgressions.test.ts
```

Expected: FAIL — `vibe.progressionId` is `undefined` for all six vibes, so `expect(vibe.progressionId).toBeDefined()` fails and `progressionById(undefined)` returns `undefined` in the second test.

- [ ] **Step 3: Add `progressionId` to the type**

In `src/types.ts`, inside the `InstantVibe` interface, immediately after the `chords: ChordItem[];` field:

```ts
  /** Library reference into CHORD_PROGRESSIONS. `chords` is its resolved output. */
  progressionId: string;
```

- [ ] **Step 4: Assign a `progressionId` to each of the six vibes**

In `src/store/instantVibes.ts`, add one line to each vibe literal, immediately after its `projectTitle` field (before `soundKit`):

`lofi-chill` (near line 116):
```ts
    progressionId: 'lofi-morning-turnaround',
```

`synthwave-80s` (near line 240):
```ts
    progressionId: 'cine-epic-ostinato',
```

`cyber-dance` (near line 368):
```ts
    progressionId: 'edm-cyber-vamp',
```

`ambient-chill` (near line 488):
```ts
    progressionId: 'ambient-lydian-halo',
```

`hiphop-groove` (near line 606):
```ts
    progressionId: 'boombap-soul-piano',
```

`asian-zen` (near line 728):
```ts
    progressionId: 'zen-bamboo-vamp',
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test src/store/instantVibesProgressions.test.ts
```

Expected: PASS — every `progressionId` resolves, and resolving it in the vibe's own key reproduces `ORIGINAL_VIBE_CHORDS` root/quality/bars/notes exactly.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/store/instantVibes.ts src/store/instantVibesProgressions.test.ts
git commit -m "feat(vibes): give every Instant Vibe a progressionId that reproduces its chords"
```

---

### Task 6: Replace the inline chords with the resolved reference

Pure wiring: the equivalence test from Task 5 already proves `resolveProgression(progressionById(vibe.progressionId)!, vibe.scaleRoot, vibe.scaleType, vibe.chordOctave)` reproduces today's sound. This task makes `vibe.chords` **be** that expression, so `applyInstantVibeToStore`'s `store.setChords(vibe.chords)` (`src/store/instantVibes.ts:74`, unmodified) now reads library-resolved data instead of a hand-typed literal.

**Files:**
- Modify: `src/store/instantVibes.ts:1-9` (imports and the now-dead `makeVibeChord` helper)
- Modify: `src/store/instantVibes.ts` (the six `chords: [...]` blocks)
- Test: `src/store/instantVibesProgressions.test.ts` (add one assertion)

**Interfaces:**
- Consumes: `progressionById`, `resolveProgression` (Task 2, already exported), `InstantVibe.progressionId` (Task 5).
- Produces: `InstantVibe.chords` is now computed, not authored — no new symbol for later tasks (there are none; this is the last task).

- [ ] **Step 1: Write the failing assertion**

Append to the `'InstantVibe.progressionId reproduces the fixture exactly'` describe block in `src/store/instantVibesProgressions.test.ts`:

```ts
  test('vibe.chords is itself the resolved progression, not a separate literal', () => {
    for (const id of VIBE_IDS) {
      const vibe = INSTANT_VIBES.find((v) => v.id === id)!;
      const progression = progressionById(vibe.progressionId)!;
      const resolved = resolveProgression(progression, vibe.scaleRoot, vibe.scaleType, vibe.chordOctave);
      expect(vibe.chords).toEqual(resolved);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/instantVibesProgressions.test.ts
```

Expected: FAIL — `vibe.chords` still has the hand-authored ids (`c1`, `sw1`, ...) while `resolved` has ids of the form `lofi-morning-turnaround-0`, so `toEqual` (which, unlike `withoutId(...)`, compares the `id` field too) fails.

- [ ] **Step 3: Replace imports and delete `makeVibeChord`**

`src/store/instantVibes.ts:1-9` becomes:

```ts
import { SynthParams, InstantVibe } from '../types';
import { audioEngine } from '../audio/engine';
import { useAppStore } from './store';
import { INITIAL_SYNTH_PARAMS } from './initialState';
import { progressionById, resolveProgression } from '../audio/data/chordProgressions';

function buildSynthParams(presetName: string, overrides?: Partial<SynthParams>): SynthParams {
  return {
    ...INITIAL_SYNTH_PARAMS,
    ...overrides,
    preset: presetName,
  };
}
```

(`ChordItem` and `deriveChordNotes` are dropped — `makeVibeChord` was their only user in this file.)

- [ ] **Step 4: Replace each vibe's `chords` block**

`lofi-chill` (currently lines 134-139):
```ts
    chords: resolveProgression(progressionById('lofi-morning-turnaround')!, 'C', 'Major', 4),
```

`synthwave-80s` (currently lines 258-263):
```ts
    chords: resolveProgression(progressionById('cine-epic-ostinato')!, 'A', 'Natural Minor', 4),
```

`cyber-dance` (currently lines 386-391):
```ts
    chords: resolveProgression(progressionById('edm-cyber-vamp')!, 'F', 'Natural Minor', 4),
```

`ambient-chill` (currently lines 506-511):
```ts
    chords: resolveProgression(progressionById('ambient-lydian-halo')!, 'D', 'Lydian', 4),
```

`hiphop-groove` (currently lines 624-629):
```ts
    chords: resolveProgression(progressionById('boombap-soul-piano')!, 'E', 'Dorian', 4),
```

`asian-zen` (currently lines 749-754, including the two comment lines directly above the array — keep the comment, drop the array literal):
```ts
    chords: resolveProgression(progressionById('zen-bamboo-vamp')!, 'G', 'Hirajoshi', 4),
```

Each call's root/scale/octave arguments are the vibe's own already-authored `scaleRoot`, `scaleType` and `chordOctave` (all `4` here) — written out explicitly rather than referencing the sibling fields, matching how every other field in these literals is a plain value.

- [ ] **Step 5: Run the full gate**

```bash
bun test src/store/instantVibes.test.ts src/store/instantVibesProgressions.test.ts src/store/vibeVariation.test.ts src/audio/data/chordProgressions.test.ts src/audio/data/chordProgressions.migration.test.ts
```

Expected: PASS. `vibe.chords` now equals `resolveProgression(...)` by construction, so the Task 6 assertion passes, and the Task 5 `withoutId(...)` equivalence assertion still passes (root/quality/bars/notes were never affected by the id difference in the first place).

- [ ] **Step 6: Run the project-wide gate**

```bash
bun run verify
bun run eslint
```

Expected: both PASS. `verify` catches any remaining reference to the deleted `makeVibeChord`/`ChordItem`/`deriveChordNotes` imports via `tsc --noEmit`; `eslint` confirms the new `src/store/instantVibes.ts -> src/audio/data/chordProgressions.ts` import obeys the layering rule (store/ -> audio/ is allowed).

- [ ] **Step 7: Commit**

```bash
git add src/store/instantVibes.ts src/store/instantVibesProgressions.test.ts
git commit -m "refactor(vibes): resolve every vibe's chords from progressionId instead of an inline literal"
```

---

## Self-review checklist

- Every vibe has a `progressionId` (Task 5) and its `chords` field is computed from it, not authored (Task 6) — matches the spec's target shape.
- The four new progressions' `steps` are shown in full in Task 2, not deferred to the implementer.
- The equivalence proof (Task 5) compares against `ORIGINAL_VIBE_CHORDS`, an independently captured fixture (Task 4) — never derived data against derived data.
- Every existing invariant this plan's data change could break is named and fixed: `chordProgressions.test.ts`'s exact-tagged-id-set test (Task 2, Step 4) and `vibeVariation.test.ts`'s progressionIds-equals-filter test (Task 3). The ambient bars>=4 conflict is resolved at the source: Task 1 corrects `ambient-chill` itself to 4 bars/chord first, so `ambient-lydian-halo` is authored and tagged `genres: ['ambient']` like every other new entry — no untagged, library-only workaround.
- `applyInstantVibeToStore` is never modified by any task — only what `INSTANT_VIBES` computes ahead of the call changes.
- No task references a symbol an earlier task did not define; no placeholders.
