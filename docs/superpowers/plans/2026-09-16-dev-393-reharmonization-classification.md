# DEV-393 — Reharmonization Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `snapProgressionToScale` decides which chord qualities survive a key/scale snap and
which get regenerated from the target scale's own diatonic chord by reading DEV-394's
chord-quality registry, never by testing `quality` for the substrings `'7'`/`'9'`.

**Architecture:** Add one derived, registry-backed classifier —
`shouldPreserveQualityOnSnap(quality): boolean` — to Music Core's `chordQuality.ts`, exported
through the barrel. Rewire `snapProgressionToScale` (`src/utils/musicTheory.ts`) to call it
instead of `chord.quality.includes('7') || chord.quality.includes('9')`, and to decide the
regenerate branch's triad-vs-seventh lookup from a small quality-shape set built off the file's
own existing `SEVENTH_QUALITY_BY_INTERVALS` table (no new cross-layer dependency: this set is
built and consumed entirely inside `musicTheory.ts`, same as the existing `MINOR_THIRD_QUALITIES`
pattern it sits beside). No call site changes: `snapProgressionToScale`'s signature is untouched,
so `progressionHarmonize.ts`, `useChordView.ts` and `ChordPresetLibrary.tsx` need no edits.

**Tech Stack:** TypeScript, Bun test runner, existing `src/musicCore/` (DEV-394) and
`src/utils/musicTheory.ts` (post-DEV-392) modules.

**Spec:** This issue's own acceptance criteria (given in the dispatch prompt; no separate spec
file exists yet — DEV-395's contract doc and the epic roadmap
`docs/superpowers/plans/2026-09-16-dev-391-music-domain-architecture-epic-plan.md` §4 are
background, not authoritative specs for this child).

## Global Constraints

- No chord family may be detected with `includes('7')`, `includes('9')`, or any other
  token-spelling substring heuristic anywhere in the reharmonization path.
- Classification must read `src/musicCore/chordQuality.ts`'s `reharmonizationCategory` field
  (or a function derived from it) — not a hand-written quality list living outside the registry.
- Root-snapping (nearest-degree search, tie resolved by taking the first/lowest-indexed
  equidistant degree) is unchanged; this issue only changes which quality a landed chord gets.
- Canonical sharp spelling (DEV-380) is unaffected — nothing in this issue's scope touches
  `src/utils/noteSpelling.ts` or any `key`/spelling parameter.
- `src/musicCore/` may not import from `src/utils/` (layering, per CLAUDE.md's four-layer rule)
  — the new classifier lives entirely in `chordQuality.ts` using only registry data already
  there; it does not read `musicTheory.ts`'s internal interval tables.
- `bun run verify` must pass before this plan is considered done.

---

## Key research finding — read this before Task 1

The registry's `reharmonizationCategory` values (all 20 already assigned by DEV-394, unchanged
by this plan) split cleanly along **whether `resolveDegreeQuality` (`src/utils/musicTheory.ts`)
can itself emit that shape at some degree of some scale** — not along "does the token look like a
seventh chord". `resolveDegreeQuality`'s output set is exactly eleven qualities (pinned by
`chordQuality.test.ts`'s `'every quality resolveDegreeQuality can emit is registered'` test):
`maj`, `min`, `dim`, `aug` (families `triad`, `diminished-half-diminished`, `altered`) and `maj7`,
`7`, `min7`, `m7b5`, `dim7`, `minMaj7`, `maj7#5` (families `seventh`,
`diminished-half-diminished`, `altered`). Those four families — `triad`, `seventh`,
`diminished-half-diminished`, `altered` — **regenerate**: the target scale can always produce its
own version of that shape at the landing degree, so a snap asks for it rather than freezing what
the chord had before. The other four families — `sixth`, `added-tone`, `extension`, `suspended`
(covering `6`, `min6`, `add9`, `9`, `maj9`, `min9`, `sus2`, `sus4`, `7sus4`) — **preserve**: no
interval tuple in `resolveDegreeQuality`'s tables ever resolves to one of these, so there is no
diatonic version to regenerate to, and the snap keeps the quality the user picked and only moves
its root.

This directly overturns part of the issue's own working hypothesis: `minMaj7` and `maj7#5` are
`altered`-family, which is a **regenerate** category. Today's code already regenerates them (by
accident, via the `includes('7')` branch) — under the registry-driven policy this is **correct,
not a bug**, and this plan's tests pin it as unchanged behavior rather than "fixing" it into
preservation. The chordQuality.ts docblock on `ReharmonizationCategory` says the same thing in
its own words and was reworded during DEV-394's review specifically to head this off — read it
again once Task 1 starts.

**Verified real bugs (behavior WILL change), found by tracing all 20 tokens through the current
code by hand:**

| Quality | Category | Current (buggy) behavior | Corrected behavior |
|---|---|---|---|
| `add9` | added-tone | `'add9'.includes('9')` → enters seventh branch, not in the 4-item preserve list → collapses to a diatonic 7th chord | preserved verbatim |
| `9` | extension | same: `.includes('9')` true, not in the preserve list → diatonic 7th | preserved verbatim |
| `6` | sixth | no `'7'`/`'9'` substring → triad branch, not preserved → diatonic triad | preserved verbatim |
| `min6` | sixth | same as `6` | preserved verbatim |
| `sus2` | suspended | no `'7'`/`'9'` substring, and NOT in the 4-item preserve list (`sus4` is, `sus2` isn't) → diatonic triad | preserved verbatim |

**Verified NOT bugs, despite looking related (behavior stays identical — confirmed by tracing,
not assumed):**

| Quality | Category | Why unchanged |
|---|---|---|
| `maj9`, `min9` | extension | already in the old 4-item preserve list → already preserved |
| `sus4`, `7sus4` | suspended | already in the old 4-item preserve list → already preserved |
| `minMaj7`, `maj7#5` | altered | old code's `includes('7')` happens to land in the seventh-regenerate branch, which is the CORRECT branch for this family — same outcome, now for the right reason |
| `maj`, `min`, `dim`, `aug` | triad / diminished-half-diminished / altered | old code already sends these through the triad-regenerate branch (no `'7'`/`'9'` substring) — same outcome |
| `maj7`, `min7`, `7`, `m7b5`, `dim7` | seventh / diminished-half-diminished | old code already sends these through the seventh-regenerate branch — same outcome |

Net: **15 of 20 qualities are behaviorally unchanged; 5 (`add9`, `9`, `6`, `min6`, `sus2`) change
from "silently collapses" to "correctly preserved".**

**Factory content impact.** `src/data/chordProgressions.ts` progressions are stored in DEGREE
form and resolved by `resolveProgression` (`src/audio/chordProgressions.ts`), which calls
`getDiatonicChordForDegree` directly and never calls `snapProgressionToScale` — so a factory
progression's *initial* rendering in its own `referenceScale` is unaffected by this issue
regardless. `snapProgressionToScale` only runs later: when the user changes key/scale with
"Auto-Reharmonize" on (`progressionHarmonize.ts`'s `applyKeyScaleChange`, wired in
`useChordView.ts`), or clicks the explicit "Re-harmonize" button (`useChordView.ts`'s
`reharmonizeNow`), or edits a custom saved progression with auto-reharmonize on
(`ChordPresetLibrary.tsx`'s `resolveCustomChords`). Grepping every `step(degree, bars, quality)`
override in `chordProgressions.ts` for the 5 changed qualities finds exactly three affected
progressions, all via `sus2` or plain `9`:

- `lofi-trapsoul` ("Contemporary R&B / Trap-Soul Flow", `src/data/chordProgressions.ts:192-202`)
  — step 3 is `step(6, 1, '9')` (its `VII9`). Snapping this progression into a different scale
  with reharmonize on used to silently turn that `9` into a diatonic seventh at the landing
  degree; it will now stay a `9` chord at its new root. Reviewed: this is the fix working as
  intended — a "VII9" that becomes a plain seventh on every key change was never what the
  progression's own `roman` field (`'i9 – iv7 – VII9 – IIImaj7'`) promises.
- `ambient-open-fourths` ("Open-Fourth Vamp", `src/data/chordProgressions.ts:383-393`) — both
  steps are `sus2` (`Isus2 – IIsus2`, the progression's entire identity is thirdless suspended
  voicings). Reviewed: this progression's `sus2` chords used to silently become plain triads on
  any reharmonize, defeating the progression's stated purpose ("leave the mode ambiguous... wide
  open") the moment a user reharmonized it. Preservation is unambiguously the correct fix here.
- `ambient-glass-horizon` ("Glass Horizon", `src/data/chordProgressions.ts:395-405`) — one step,
  `step(1, 4, 'sus2')` (its closing `IIsus2`). Same reasoning as `ambient-open-fourths`: a
  reharmonize used to erase the one suspended chord in an otherwise plain progression; it will
  now survive.

No factory progression uses `add9`, `6` or `min6` as an authored override, so those two fixes
have no factory-content impact — they only affect the chord picker's user-authored qualities.

---

## Task 1: Export a registry-driven snap-preservation classifier from Music Core

**Files:**
- Modify: `src/musicCore/chordQuality.ts`
- Modify: `src/musicCore/index.ts`
- Test: `src/musicCore/chordQuality.test.ts`

**Interfaces:**
- Produces: `shouldPreserveQualityOnSnap(quality: ChordQuality): boolean`, exported from both
  `src/musicCore/chordQuality.ts` and the `src/musicCore/index.ts` barrel. Returns `true` for
  qualities in the `sixth`, `added-tone`, `extension` and `suspended` categories; `false` for
  `triad`, `seventh`, `diminished-half-diminished` and `altered`. Throws
  `Error` for an unregistered quality (same "stop, don't guess" contract as `resolveChordNotes`
  in the same file).
- `ReharmonizationCategory` itself stays **module-private** (not exported from
  `chordQuality.ts`, not re-exported from `index.ts`): nothing outside this file needs the raw
  category, only the derived boolean, and an exported type with no external reader is exactly the
  dead surface this file's own existing docblock warns against.

- [ ] **Step 1: Write the failing tests**

Add to `src/musicCore/chordQuality.test.ts`. First add `ChordQuality` type import alongside the
existing named imports (the file currently imports only values, not the type):

```ts
import { describe, expect, test } from 'bun:test';
import {
  CHORD_QUALITY_ALIASES,
  CHORD_QUALITY_GROUPS,
  CHORD_QUALITY_REGISTRY,
  formatChordQuality,
  getChordQualityEntry,
  isChordQuality,
  resolveChordNotes,
  shouldPreserveQualityOnSnap,
} from './chordQuality';
import type { ChordQuality } from './chordQuality';
```

Then append a new `describe` block at the end of the file:

```ts
describe('shouldPreserveQualityOnSnap', () => {
  // resolveDegreeQuality (src/utils/musicTheory.ts) can itself emit exactly
  // these eleven qualities at some degree of some scale — regenerating them
  // on a snap asks the target key for its OWN version of the same shape.
  const REGENERATE: ChordQuality[] = [
    'maj', 'min', 'dim', 'aug',
    'maj7', 'min7', '7', 'm7b5', 'dim7', 'minMaj7', 'maj7#5',
  ];
  // No interval tuple resolveDegreeQuality resolves ever names one of these —
  // there is no diatonic version to regenerate to, so a snap preserves them.
  const PRESERVE: ChordQuality[] = [
    'sus2', 'sus4', '7sus4', '9', 'maj9', 'min9', 'add9', '6', 'min6',
  ];

  test('regenerates every quality resolveDegreeQuality can itself emit', () => {
    for (const quality of REGENERATE) {
      expect(shouldPreserveQualityOnSnap(quality), quality).toBe(false);
    }
  });

  test('preserves every quality resolveDegreeQuality can never emit', () => {
    for (const quality of PRESERVE) {
      expect(shouldPreserveQualityOnSnap(quality), quality).toBe(true);
    }
  });

  test('covers every registered token exactly once between the two lists', () => {
    const registered = CHORD_QUALITY_REGISTRY.map((e) => e.token).sort();
    expect([...REGENERATE, ...PRESERVE].sort()).toEqual(registered);
  });

  test('altered 7th-shaped qualities (minMaj7, maj7#5) regenerate — NOT preserved', () => {
    // The one pairing the issue's own hypothesis got backwards: altered is a
    // regenerate category (resolveDegreeQuality can emit both), not a
    // preserve one. Named explicitly so a future reader does not "fix" this
    // back the other way.
    expect(shouldPreserveQualityOnSnap('minMaj7')).toBe(false);
    expect(shouldPreserveQualityOnSnap('maj7#5')).toBe(false);
  });

  test('throws for an unregistered quality, same contract as resolveChordNotes', () => {
    expect(() => shouldPreserveQualityOnSnap('not-a-real-quality' as ChordQuality)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/musicCore/chordQuality.test.ts -t "shouldPreserveQualityOnSnap"`
Expected: FAIL — `shouldPreserveQualityOnSnap is not a function` / import error, since it does
not exist yet.

- [ ] **Step 3: Implement the classifier**

In `src/musicCore/chordQuality.ts`, add the following directly after the `getChordQualityEntry`
function (after line 126, before `formatChordQuality`):

```ts
/**
 * The four categories a snap preserves verbatim rather than regenerating —
 * see shouldPreserveQualityOnSnap for why this specific split.
 */
const SNAP_PRESERVED_CATEGORIES: ReadonlySet<ReharmonizationCategory> = new Set([
  'sixth',
  'added-tone',
  'extension',
  'suspended',
]);

/**
 * Whether `snapProgressionToScale` (src/utils/musicTheory.ts) should keep `quality`
 * verbatim on a scale snap rather than regenerating the landing degree's own
 * diatonic quality.
 *
 * The split is read off `resolveDegreeQuality`'s ACTUAL output set, not off
 * family names by feel: `triad`, `seventh`, `diminished-half-diminished` and
 * `altered` are exactly the four families whose members `resolveDegreeQuality`
 * (src/utils/musicTheory.ts) can itself emit at some degree of some scale — a
 * snap regenerating one of them asks the target key for its OWN version of the
 * same shape, e.g. a min7 ii moved into a new key becomes that key's own ii7,
 * not a frozen min7. `sixth`, `added-tone`, `extension` and `suspended` name
 * colour no interval tuple in that function's tables ever resolves to — there
 * is no diatonic 6th, add9, extension or sus chord to regenerate TO at any
 * degree of any scale — so a snap keeps the quality the user picked and only
 * moves its root. This is why `dim`, `aug`, `dim7`, `m7b5`, `minMaj7` and
 * `maj7#5` all REGENERATE despite sounding like the more "special" qualities:
 * the scale itself produces every one of them at the right degree, and
 * freezing them would mean freezing chords the key change already has a
 * correct diatonic answer for.
 *
 * Throws for an unregistered quality, same "stop, don't guess" contract as
 * `resolveChordNotes` above — a caller holding a quality from outside this
 * module must validate or sanitize it first.
 */
export function shouldPreserveQualityOnSnap(quality: ChordQuality): boolean {
  const entry = getChordQualityEntry(quality);
  if (!entry) {
    throw new Error(`Unregistered chord quality: "${quality}"`);
  }
  return SNAP_PRESERVED_CATEGORIES.has(entry.reharmonizationCategory);
}
```

Then update the two stale docblocks that predate this function's existence, now that DEV-393 has
a real consumer:

Replace the `ReharmonizationCategory` type's docblock (lines 6-28) — specifically the final
paragraph starting "Note for whoever picks DEV-393 up" — with:

```ts
/**
 * The chord FAMILY a quality belongs to — a shape axis, not a policy by
 * itself. `shouldPreserveQualityOnSnap` below is the policy derived from it:
 * see that function's docblock for which families preserve a quality through
 * a scale snap and which regenerate the landing degree's own version, and why
 * the split does not track family names the way it looks like it should
 * (`diminished-half-diminished` and `altered` both REGENERATE, because
 * `resolveDegreeQuality` can itself emit every member of both).
 */
```

Replace the `ChordQualityEntry.reharmonizationCategory` field docblock (lines 50-56) with:

```ts
  /**
   * The chord family this quality belongs to. Read by
   * `shouldPreserveQualityOnSnap` below, this registry's only consumer of the
   * raw category — `ReharmonizationCategory` itself stays unexported, since
   * nothing outside this file needs the category, only the derived boolean.
   */
```

- [ ] **Step 4: Export from the barrel**

In `src/musicCore/index.ts`, add `shouldPreserveQualityOnSnap` to the `chordQuality` export list:

```ts
export {
  CHORD_QUALITY_ALIASES,
  CHORD_QUALITY_GROUPS,
  ROOTS,
  formatChordQuality,
  getChordQualityEntry,
  isChordQuality,
  resolveChordNotes,
  shouldPreserveQualityOnSnap,
} from './chordQuality';
export type { ChordQuality } from './chordQuality';
```

Update the file's top docblock, replacing the sentence "`ReharmonizationCategory` is likewise
absent, and is not exported from `chordQuality.ts` either — it types one field of
`ChordQualityEntry` and has no reader until DEV-393, so exporting it would be dead surface Knip is
right to flag." with:

```
 * `ReharmonizationCategory` itself is still not re-exported — DEV-393 (the
 * consumer this was reserved for) only needs the boolean
 * `shouldPreserveQualityOnSnap` derives from it, so the raw category type
 * stays module-private to `chordQuality.ts`.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/musicCore/chordQuality.test.ts`
Expected: PASS, all tests including the new `shouldPreserveQualityOnSnap` describe block.

- [ ] **Step 6: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/musicCore/chordQuality.ts src/musicCore/index.ts src/musicCore/chordQuality.test.ts
git commit -m "$(cat <<'EOF'
feat(musicCore): export shouldPreserveQualityOnSnap reharmonization classifier

DEV-394 built reharmonizationCategory on every registry entry with no
consumer. This is DEV-393's classifier: sixth/added-tone/extension/suspended
preserve a quality through a scale snap (resolveDegreeQuality can never
produce one), the other four families regenerate the landing degree's own
version (resolveDegreeQuality can produce all of them).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 2: Rewire `snapProgressionToScale` off the classifier, remove the substring heuristic

**Files:**
- Modify: `src/utils/musicTheory.ts:1-16` (imports), `:138-161` (new derived set),
  `:411-457` (`snapProgressionToScale` and its docblock)
- Test: `src/utils/musicTheory.test.ts`

**Interfaces:**
- Consumes: `shouldPreserveQualityOnSnap(quality: ChordQuality): boolean` from Task 1
  (`@/musicCore`).
- Produces: `snapProgressionToScale`'s public signature is unchanged —
  `(currentChords: ChordItem[], root: string, scaleType: string, octave = 4) => ChordItem[]` —
  so no caller (`progressionHarmonize.ts`, `useChordView.ts`, `ChordPresetLibrary.tsx`) needs any
  edit.

- [ ] **Step 1: Write the failing tests**

Add `CHORD_QUALITY_GROUPS` to the existing `@/musicCore` import at the top of
`src/utils/musicTheory.test.ts` (line 2):

```ts
import { CHORD_QUALITY_GROUPS, isChordQuality, type ChordQuality } from '@/musicCore';
```

Append a new `describe` block inside `describe('snapProgressionToScale', ...)`, right after the
existing four tests (after line 339, before the closing `});` at line 340):

```ts
  describe('quality classification on snap (DEV-393)', () => {
    // Every chord here is rooted at C and snapped onto C Major's own tonic
    // (degree 0) — root position never moves, so only the quality policy is
    // under test. Degree 0's own diatonic qualities are 'maj' (triad) and
    // 'maj7' (seventh), both different from every non-maj/maj7 input below,
    // so "changed to maj/maj7" unambiguously means REGENERATED and
    // "unchanged" unambiguously means PRESERVED.
    const REGENERATE_TO_TRIAD: ChordQuality[] = ['min', 'dim', 'aug'];
    const REGENERATE_TO_SEVENTH: ChordQuality[] = ['min7', '7', 'm7b5', 'dim7', 'minMaj7', 'maj7#5'];
    const PRESERVE: ChordQuality[] = ['sus2', 'sus4', '7sus4', '9', 'maj9', 'min9', 'add9', '6', 'min6'];

    test('a triad-shaped quality regenerates to the tonic triad, maj', () => {
      for (const quality of [...REGENERATE_TO_TRIAD, 'maj' as ChordQuality]) {
        const snapped = snapProgressionToScale([chord('c', 'C', quality)], 'C', 'Major', 4);
        expect(snapped[0].quality, quality).toBe('maj');
      }
    });

    test('a seventh-shaped quality regenerates to the tonic seventh, maj7', () => {
      for (const quality of [...REGENERATE_TO_SEVENTH, 'maj7' as ChordQuality]) {
        const snapped = snapProgressionToScale([chord('c', 'C', quality)], 'C', 'Major', 4);
        expect(snapped[0].quality, quality).toBe('maj7');
      }
    });

    test('a sixth / added-tone / extension / suspended quality survives the snap verbatim', () => {
      for (const quality of PRESERVE) {
        const snapped = snapProgressionToScale([chord('c', 'C', quality)], 'C', 'Major', 4);
        expect(snapped[0].quality, quality).toBe(quality);
      }
    });

    test('minMaj7 and maj7#5 regenerate — NOT preserved (see Task 1 finding)', () => {
      expect(
        snapProgressionToScale([chord('c', 'C', 'minMaj7')], 'C', 'Major', 4)[0].quality,
      ).toBe('maj7');
      expect(
        snapProgressionToScale([chord('c', 'C', 'maj7#5')], 'C', 'Major', 4)[0].quality,
      ).toBe('maj7');
    });

    test("exercises every one of the registry's 20 qualities, none skipped", () => {
      const covered = [
        ...REGENERATE_TO_TRIAD, 'maj',
        ...REGENERATE_TO_SEVENTH, 'maj7',
        ...PRESERVE,
      ].sort();
      const registered = CHORD_QUALITY_GROUPS.flatMap((g) => g.options.map((o) => o.value)).sort();
      expect(covered).toEqual(registered);
    });

    test('an equidistant root snap takes the lower-indexed scale degree (documented tie policy)', () => {
      // C# sits exactly one semitone from both C (degree 0) and D (degree 1)
      // of C Major — nearestDegrees returns both and snapProgressionToScale
      // takes the first, matching its own inline comment ("either neighbour
      // is an equally good landing spot"). Pinned here so the policy has a
      // test, not just a comment. Root-snapping itself is unchanged by
      // DEV-393; this only documents the existing behavior.
      const snapped = snapProgressionToScale([chord('c', 'C#', 'maj')], 'C', 'Major', 4);
      expect(snapped[0].root).toBe('C');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/utils/musicTheory.test.ts -t "quality classification on snap"`
Expected: FAIL on the preserve cases (`sus2`, `9`, `add9`, `6`, `min6` currently collapse instead
of surviving) and possibly on others depending on exact current wiring — confirm the failures
match exactly the 5 rows in the "Verified real bugs" table above, and no others.

- [ ] **Step 3: Add the derived seventh-shape set**

In `src/utils/musicTheory.ts`, insert directly after `MINOR_THIRD_QUALITIES` (after line 161,
before the `degreeQualityCache` comment on line 163):

```ts
// The app quality tokens whose OWN shape carries a seventh, read off the same
// table SEVENTH_QUALITY_BY_INTERVALS assigns — so a scale-produced quality and
// a registered quality can never disagree about whether it has one. This is
// what decides which of TRIAD_QUALITY_BY_INTERVALS / SEVENTH_QUALITY_BY_INTERVALS
// snapProgressionToScale's regenerate branch reads from, replacing the
// `quality.includes('7') || quality.includes('9')` substring test DEV-393
// removed. Only meaningful for a REGENERATE-category quality (see
// shouldPreserveQualityOnSnap in src/musicCore/chordQuality.ts) — every such
// quality is, by construction, one of the eleven names in these two tables.
const SEVENTH_SHAPED_QUALITIES: ReadonlySet<ChordQuality> = new Set(
  Object.values(SEVENTH_QUALITY_BY_INTERVALS),
);
```

- [ ] **Step 4: Import the classifier**

In `src/utils/musicTheory.ts`, add `shouldPreserveQualityOnSnap` to the existing `@/musicCore`
import block (lines 1-16):

```ts
import {
  CHORD_QUALITY_ALIASES,
  ROOTS,
  chromaOfNote,
  formatChordQuality,
  intervalDistance,
  midiToSharpName,
  noteMidi,
  resolveChordNotes,
  resolveScaleKey,
  scaleEntry,
  scaleNotesForTonal,
  shouldPreserveQualityOnSnap,
  transposeByInterval,
  transposePitchClassPreservingOctave,
  type ChordQuality,
} from '@/musicCore';
```

- [ ] **Step 5: Rewrite `snapProgressionToScale`**

Replace the function's docblock and body (currently lines 411-457) with:

```ts
/**
 * Snaps each chord to the nearest diatonic degree of the given key/scale.
 *
 * This is the operation a SCALE change needs. It measures the chords against
 * `root`, so it is only correct when they are already in that key — feeding it
 * chords from another key is the bug this split exists to remove. Two chords a
 * scale cannot distinguish still collapse onto one degree; that is inherent to
 * snapping and is why five-note scales lose the most.
 *
 * A chord's QUALITY is either regenerated to the landing degree's own diatonic
 * quality or preserved verbatim, decided by `shouldPreserveQualityOnSnap`
 * (src/musicCore/chordQuality.ts) reading the DEV-394 quality registry — never
 * by testing `quality` for the substrings `'7'`/`'9'`. See that function's
 * docblock for the exact policy and why it is not "7th chord vs triad".
 *
 * Root-snapping is unchanged: nearest scale degree by semitone distance,
 * measured around the octave (`nearestDegrees`); an equidistant tie takes the
 * lower-indexed degree, since a snap has no reason to prefer either neighbour.
 */
export function snapProgressionToScale(
  currentChords: ChordItem[],
  root: string,
  scaleType: string,
  octave = 4
): ChordItem[] {
  const newRootIndex = rootSemitone(root);
  const scale = scaleEntry(scaleType);

  return currentChords.map((chord, idx) => {
    // Find semitone distance of chord from previous context, or snap to nearest scale degree
    const currentRootIdx = rootSemitone(chord.root);
    const intervalFromNewRoot = (currentRootIdx - newRootIndex + 12) % 12;

    // Nearest degree, the same search parentDegreesFor runs. A snap has no tie
    // to resolve — either neighbour is an equally good landing spot — so it
    // takes the first.
    const bestDegree = nearestDegrees(scale.intervals, intervalFromNewRoot)[0];

    const preserveQuality = shouldPreserveQualityOnSnap(chord.quality);
    const use7ths = !preserveQuality && SEVENTH_SHAPED_QUALITIES.has(chord.quality);
    const diatonic = getDiatonicChordForDegree(bestDegree, root, scaleType, use7ths);

    // A preserve-category quality (sixth / added-tone / extension / suspended)
    // has no diatonic version at any degree of any scale, so the snap keeps it
    // verbatim and only the root moves. Every other quality IS one of
    // resolveDegreeQuality's own eleven emittable qualities, so the snap
    // regenerates the landing degree's own version instead of freezing the one
    // the chord had before the key changed.
    const targetQuality: ChordQuality = preserveQuality ? chord.quality : diatonic.quality;

    return {
      ...chord,
      id: chord.id || `chord-${Date.now()}-${idx}`,
      root: diatonic.root,
      quality: targetQuality,
      notes: generateBlockChordNotes(targetQuality, diatonic.root, octave),
    };
  });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/utils/musicTheory.test.ts`
Expected: PASS — every test in the file, including the four pre-existing golden tests in
`describe('snapProgressionToScale', ...)` (unchanged per the "Key research finding" analysis
above: none of `EXTENDED`'s or `A_MINOR_PROGRESSION`'s qualities were among the 5 that change)
and the new `describe('quality classification on snap (DEV-393)', ...)` block.

- [ ] **Step 7: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/utils/musicTheory.ts src/utils/musicTheory.test.ts
git commit -m "$(cat <<'EOF'
fix(chords): classify reharmonization by registry, not quality substrings

snapProgressionToScale used chord.quality.includes('7') || includes('9') to
decide whether a chord's quality survives a scale snap, with a 4-item
hand-written preserve list. That silently collapsed add9, plain 9, 6, min6
and sus2 into a diatonic triad/seventh on every reharmonize. Replaced with
shouldPreserveQualityOnSnap, reading DEV-394's chord-quality registry.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 3: Guard against substring-heuristic reintroduction and pin the three affected factory progressions

**Files:**
- Test: `src/utils/musicTheory.test.ts`

**Interfaces:**
- Consumes: `snapProgressionToScale` (Task 2), `CHORD_PROGRESSIONS` (`@/data/chordProgressions`),
  `progressionById`/`resolveProgression` (`@/audio/chordProgressions`) — read-only, no production
  code changes in this task.

- [ ] **Step 1: Write the failing guard test**

Add to `src/utils/musicTheory.test.ts`. First add the two imports it needs, near the top of the
file (below the existing `import { SCALES } from '@/data/scales';` line):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
```

Then add a new top-level `describe` block (after the `describe('snapProgressionToScale', ...)`
block closes):

```ts
describe('reharmonization reads no quality substring (DEV-393 guard)', () => {
  test('musicTheory.ts never calls .includes on a chord quality', () => {
    // Regression guard: the bug this issue fixes was exactly
    // `chord.quality.includes('7') || chord.quality.includes('9')`. Reading
    // the file's own source rather than re-testing behavior, because a
    // future rewrite could reproduce the same substring trap under a
    // different variable name while still passing every behavioral test
    // above by coincidence on the specific fixtures they use.
    const source = readFileSync(join(process.cwd(), 'src/utils/musicTheory.ts'), 'utf8');
    expect(source).not.toMatch(/\.quality\.includes\(/);
  });
});
```

- [ ] **Step 2: Run it to verify it passes immediately**

Run: `bun test src/utils/musicTheory.test.ts -t "reharmonization reads no quality substring"`
Expected: PASS already, since Task 2 already removed the only occurrence. (This test's value is
as a regression guard going forward, not as a red/green step against current code — confirm it
would have FAILED against the pre-Task-2 source by checking out the file at `HEAD~1` mentally:
the old line 441 literally contains `chord.quality.includes('7')`, which the regex matches.)

- [ ] **Step 3: Write the failing factory-progression regression tests**

Append a new `describe` block after the guard test:

```ts
describe('factory progressions affected by the classification fix (DEV-393)', () => {
  // The three progressions in src/data/chordProgressions.ts whose authored
  // quality overrides (sus2, plain 9) used to be silently destroyed by a
  // reharmonize and now survive it. See this plan's "Key research finding"
  // section for the by-hand review of why preserving each is correct.
  test('lofi-trapsoul: VII9 survives a reharmonize into a different scale', () => {
    const progression = progressionById('lofi-trapsoul')!;
    const resolved = resolveProgression(progression, 'A', 'Natural Minor', 4);
    const snapped = snapProgressionToScale(resolved, 'D', 'Dorian', 4);
    // Step index 2 is the VII9 step (step(6, 1, '9')).
    expect(snapped[2].quality).toBe('9');
  });

  test('ambient-open-fourths: both Isus2/IIsus2 steps survive a reharmonize', () => {
    const progression = progressionById('ambient-open-fourths')!;
    const resolved = resolveProgression(progression, 'C', 'Lydian', 4);
    const snapped = snapProgressionToScale(resolved, 'G', 'Major', 4);
    expect(snapped.map((c) => c.quality)).toEqual(['sus2', 'sus2']);
  });

  test('ambient-glass-horizon: the closing IIsus2 step survives a reharmonize', () => {
    const progression = progressionById('ambient-glass-horizon')!;
    const resolved = resolveProgression(progression, 'C', 'Lydian', 4);
    const snapped = snapProgressionToScale(resolved, 'G', 'Major', 4);
    // Step index 3 is the IIsus2 step (step(1, 4, 'sus2')).
    expect(snapped[3].quality).toBe('sus2');
  });
});
```

Add the two new imports these tests need to the top of the file:

```ts
import { progressionById, resolveProgression } from '@/audio/chordProgressions';
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun test src/utils/musicTheory.test.ts -t "factory progressions affected"`
Expected: FAIL against the pre-Task-2 code (which this repo no longer has checked out, since
Task 2 already landed) — so in practice this step is a sanity check that the assertions are
meaningful, not a literal red step. Run it now against the current (Task-2-complete) code instead
and confirm PASS; if it fails, the by-hand review above is wrong and needs correcting before
proceeding, not the test relaxed.

- [ ] **Step 5: Run the full file to verify everything passes**

Run: `bun test src/utils/musicTheory.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add src/utils/musicTheory.test.ts
git commit -m "$(cat <<'EOF'
test(chords): guard against quality-substring reintroduction, pin affected factory progressions

Source-scan guard against a future .quality.includes() reappearing in
musicTheory.ts, plus regression coverage for the three factory progressions
(lofi-trapsoul, ambient-open-fourths, ambient-glass-horizon) whose sus2/9
overrides used to be silently destroyed by a reharmonize.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 4: Document the classification policy in CLAUDE.md

**Files:**
- Modify: `/Users/Pathompong/Sites/Personal/solna/CLAUDE.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Insert the new paragraph**

In `CLAUDE.md`, find the paragraph beginning "**A per-degree chord quality is derived, and a note
name is spelled only where it is read.**" (it ends with the sentence "Nothing spelled is
persisted, so spelling never moves a persist `version` or a `.solna` `formatVersion`."). Insert a
new paragraph immediately after it, before the "**A vibe is pure data...**" paragraph:

```markdown
**A chord's reharmonization behavior is named on the registry, not sniffed from its token.**
`ChordQualityEntry.reharmonizationCategory` (`src/musicCore/chordQuality.ts`) states which of
eight shape families a quality belongs to — `triad`, `seventh`, `sixth`, `added-tone`,
`extension`, `suspended`, `diminished-half-diminished`, `altered` — and
`shouldPreserveQualityOnSnap` derives a binary policy from it: `sixth`, `added-tone`, `extension`
and `suspended` PRESERVE a chord's quality verbatim through `snapProgressionToScale`'s scale
snap, and the other four REGENERATE the landing degree's own diatonic quality instead. The split
is not "7th chord vs triad" and does not track family names by feel — it tracks
`resolveDegreeQuality`'s actual eleven-quality output set: `triad`, `seventh`,
`diminished-half-diminished` and `altered` are exactly the families whose members that function
CAN emit at some degree of some scale, so regenerating them asks the target key for its own
version of the same shape; `sixth`, `added-tone`, `extension` and `suspended` name colour no
scale degree's diatonic derivation can ever produce, so there is no diatonic version to
regenerate to and a snap keeps what the user picked. This is why `dim`, `aug`, `dim7`, `m7b5`,
`minMaj7` and `maj7#5` — the qualities that sound the most "special" — all regenerate rather than
preserve: the scale itself produces every one of them at the right degree, and freezing them
would mean freezing chords the key change already has a correct diatonic answer for.
`snapProgressionToScale` (`src/utils/musicTheory.ts`) reads no substring of a quality token —
`chord.quality.includes('7')`/`includes('9')` do not appear anywhere in the reharmonization path,
a regression a source-scan test in `musicTheory.test.ts` pins — and root-snapping stays
nearest-degree with a tie going to the lower-indexed scale degree (`nearestDegrees` takes `[0]`
of an equidistant set), unchanged by this.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: record DEV-393's reharmonization-classification policy in CLAUDE.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the completion gate**

Run: `bun run verify`
Expected: PASS — all tests, `bun run eslint` (zero findings), both Knip dead-code scans (zero
findings), and the production build.

- [ ] **Step 2: Confirm no other call site needs a change**

Run: `grep -rn "snapProgressionToScale" src --include="*.ts" --include="*.tsx" | grep -v test`
Expected: exactly the same four production call sites as before this plan started —
`src/utils/musicTheory.ts` (the definition), `src/components/loop/chord/progressionHarmonize.ts`,
`src/components/loop/chord/useChordView.ts`, `src/components/loop/ChordPresetLibrary.tsx` — none
touched by this plan's tasks, confirming live preview (the auto-harmonize effect and the
Re-harmonize button, both routed through `progressionHarmonize.ts`/`useChordView.ts`) and stored
progression editing (`ChordPresetLibrary.tsx`'s `resolveCustomChords`) share the exact same,
now-corrected `snapProgressionToScale` with no duplicate implementation anywhere to drift from it.

- [ ] **Step 3: Confirm noteSpelling.ts is untouched**

Run: `git diff main --stat -- src/utils/noteSpelling.ts`
Expected: empty output — no changes, confirming canonical-sharp spelling (DEV-380) stayed
out of scope as required.

No commit for this task — it is a verification-only checkpoint before opening a PR or handing the
branch off.

---

## Self-Review

**Spec coverage:**
- "No chord family detected with `includes('7')`/`includes('9')`" → Task 2 Step 5 removes it;
  Task 3 Step 1 adds a permanent regression guard.
- "Registry states/derives each quality's reharmonization behavior, wired into
  `snapProgressionToScale`" → Task 1 (registry → `shouldPreserveQualityOnSnap`) + Task 2 (wiring).
- "Explicit behavior for triads/sevenths/sixths/added tones/extensions/suspended/dim-half-dim/
  altered" → Task 2's exhaustive 20-quality test covers every category by construction (the
  "Key research finding" table enumerates all eight).
- "`add9`, `maj9`, `min9`, `7sus4`, `sus4`, `minMaj7`, `maj7#5` regression coverage, corrected
  behavior" → all seven are named individually across Task 1's and Task 2's tests (5 in
  `PRESERVE`/`REGENERATE_TO_SEVENTH` lists, `minMaj7`/`maj7#5` also get a dedicated named test in
  both tasks since they're the one place the issue's own hypothesis was wrong).
- "Root snapping unchanged, tie policy documented" → Task 2's tie test + updated docblock; Task 2
  Global Constraints states it explicitly; no root-snap code touched.
- "Canonical sharp identity / display spelling unaffected" → Task 5 Step 3 verifies
  `noteSpelling.ts` has zero diff.
- "Existing progression results change only where classification was wrong, reviewed by hand" →
  "Key research finding" section's by-hand trace of all 20 qualities + all `chordProgressions.ts`
  overrides, with the three affected progressions individually reviewed and pinned in Task 3.
- "All 20 registered qualities have explicit, tested classification" → Task 1's
  `chordQuality.test.ts` additions (module level) + Task 2's `musicTheory.test.ts` additions
  (integration level) both exhaustively cover all 20, cross-checked against
  `CHORD_QUALITY_REGISTRY`/`CHORD_QUALITY_GROUPS` rather than a hand-typed count.
- "Theory characterization test changes explicitly reviewed" → none of the four pre-existing
  `snapProgressionToScale` golden tests change (verified in the "Key research finding" section:
  none of their qualities are among the 5 that change) — this absence-of-change is itself
  reviewed and stated, not silently assumed.
- "Live preview and stored progression produce identical qualities/notes" → Task 5 Step 2 confirms
  a single shared implementation with no duplicate quality-classification logic anywhere else in
  the codebase (verified during research: `grep -rn "quality.includes"` finds exactly the one
  occurrence this plan removes).
- "`bun run verify` passes" → Task 5 Step 1.

**Placeholder scan:** no TBD/TODO, no "add appropriate handling" language, every test has
concrete assertions, every code block is complete and copy-pasteable, every referenced function
name is defined either in the current codebase (confirmed by reading it) or in an earlier task of
this plan.

**Type consistency:** `shouldPreserveQualityOnSnap(quality: ChordQuality): boolean` is defined
once in Task 1 and consumed with that exact name and signature in Task 2; no renaming across
tasks. `SEVENTH_SHAPED_QUALITIES` is defined and consumed only within Task 2 (module-private to
`musicTheory.ts`, never exported, matching how `MINOR_THIRD_QUALITIES` already behaves in the
same file).
