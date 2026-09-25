# Scale Library (24 tonal-derived scales) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow `SCALES` from the legacy 11 to 24 scales with murva's names and one-line descriptions, derive every scale's intervals from `tonal` instead of hand-writing them, and group the two scale selects by category — without changing what any saved project sounds like.

**Architecture:** `src/data/scales.ts` stays pure content and drops `intervals`. `src/musicCore/tonalAdapter.ts` gains `scaleSemitonesForTonal`; `src/musicCore/scale.ts` builds a frozen `SCALE_LIBRARY` of `ResolvedScale` (definition + derived intervals) once at module load, and `scaleEntry()` returns from it. A golden pin in `src/data/scales.test.ts` holds the legacy 11 interval arrays verbatim. The UI shares one `ui/ScaleTypeOptions` component that renders one `<optgroup>` per category.

**Tech Stack:** Bun (test runner, scripts), TypeScript, React (`renderToString` tests), `tonal` (only via `src/musicCore/tonalAdapter.ts`), ESLint, Knip.

**Spec:** `docs/superpowers/specs/2026-09-26-scale-library-design.md`

## Global Constraints

- `src/data/` imports nothing at runtime, not even a sibling; it holds no functions, no `new`, no impure globals (R020, R022). `SCALE_CATEGORIES` is a literal array.
- Only `src/musicCore/tonalAdapter.ts` imports `tonal` in production code (R044); tests may import `tonal`.
- `src/musicCore/**` imports nothing from `store/`, `components/`, `audio/`, `utils/` (R050).
- `scale.ts` is the one place an unknown scale type resolves to Major (R083); `resolveScaleKey()` is unchanged.
- Existing `SCALES` keys are persisted identities and never renamed. New keys are readable ASCII (`Dorian b2`, `Locrian #2`, `Mixolydian b6`), because the header's short label renders the key.
- Descriptions, display names and order are murva's, copied verbatim (`murva-app/shared/src/music/musicUtils.ts`, `SUPPORTED_SCALES`), including the `·` separator and the `♭`/`♯` in display names.
- The persist `version` does not move; new keys are validated on read (R035, R214).
- No chord qualities, no `intervals`, no override fields in `SCALES` (R061, R063).
- Rules files, ADRs and skills record no version numbers, file counts or line numbers (R001).
- Completion gate: `bun run verify` green, and `bun run eslint` with zero errors and zero warnings (R004, R005, R264). Any warning is fixed or line-disabled with `eslint-disable-next-line <rule> -- <reason>`.
- Commits end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work stays on `feat/scale-library`; never push.

## Review Focus

1. **A saved project on a legacy key (e.g. `Blues`, `Hirajoshi`) must sound and read exactly as before** — same intervals, same chord at every degree, same spelled notes. Pinned by the golden pin (Task 1) and by the fixture-regeneration check that every pre-existing characterization entry is byte-identical (Task 2, Step 6).
2. **A persisted `scaleType` that is not a key — a display name like `Locrian ♯2`/`Minor Blues`, or a murva/tonal value like `vietnamese 1` — must fall back, not half-resolve.** `sanitizeLoops` falls back to the default loop's scale; `scaleEntry` falls back to Major. Pinned in `src/store/sanitize.test.ts` (Task 2) and `src/musicCore/scale.test.ts` (Task 1).
3. **The header label for a new key reads correctly:** short form `Bb Locrian #2` (ASCII key, tonic spelled by `tonality`), long form `Bb Locrian ♯2`; a legacy key keeps its short form and takes its new display name in the long form (`A Minor Blues`). Pinned in `src/utils/noteSpelling.test.ts` (Task 2).
4. **A key change from a 7-note scale to a new 5-note one (Egyptian)** snaps every chord onto a degree of the new scale with its parent's quality, and remaps melodies by degree exactly as it does for Minor Pentatonic. Pinned in `src/store/keyChange.test.ts` (Task 2).
5. **The scale-locked keyboard for a new 5-, 6- or 7-note scale** (Egyptian, Pelog, Major Blues, Locrian #2) lays out one octave of the scale per row with the tonic first. Pinned in `src/components/ui/Keyboard.test.ts` (Task 2).

Known, accepted, not fixed here: the compact header trigger shows `SCALES[scaleType].name.slice(0, 4)`, so after the renames `Natural Minor`, `Minor Pentatonic` and `Minor Blues` all show `Mino` (the full name stays in the trigger's `title`). Sub-project 2 replaces this select; do not widen this plan to fix it.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/musicCore/tonalAdapter.ts` | + `scaleSemitonesForTonal(name)` | 1 |
| `src/musicCore/scale.ts` | `ResolvedScale`, `SCALE_LIBRARY`, `scaleEntry(): ResolvedScale` | 1 |
| `src/data/scales.ts` | Content: drop `intervals` (T1); 24 entries, `ScaleCategory`, `SCALE_CATEGORIES`, `description` (T2) | 1, 2 |
| `src/utils/musicTheory.ts` | Read scales only through `scaleEntry` (drops the `SCALES` import) | 1, 2 (comment) |
| `src/utils/noteSpelling.ts` | Comments only | 2 |
| `src/components/ui/ScaleTypeOptions.tsx` (new) | Grouped `<option>`s shared by both scale selects | 3 |
| `src/components/header/ScaleMenu.tsx`, `src/components/song/KeyChangeDialog.tsx` | Use `ScaleTypeOptions` | 3 |
| `scripts/gen-diatonic-characterization.ts`, `scripts/verify-borrowed.mts`, `.claude/skills/instant-vibes/scripts/vibe-inventory.ts` | Read intervals through `scaleEntry` (not type-checked by `tsc`, so fixed by hand) | 1 |
| `src/utils/*CharacterizationFixture.ts` | Regenerated, additive only | 2 |
| `.claude/rules/music-domain.md`, `.claude/rules/data-layer.md`, `docs/decisions/0053-derived-scale-intervals.md` (new), `docs/decisions/0006-…md` (Status line), `docs/decisions/README.md`, skills, two data comments | Docs | 4 |

---

### Task 1: Derive scale intervals from `tonal` (behaviour identical)

**Files:**
- Modify: `src/musicCore/tonalAdapter.ts` (add one export after `scaleNotesForTonal`)
- Modify: `src/musicCore/scale.ts` (whole file)
- Modify: `src/data/scales.ts:1-30` (doc comment + interface) and delete the 11 `intervals:` lines
- Modify: `src/utils/musicTheory.ts` (drop the `SCALES` import block at ~19-25; `parentDegreesFor`, `resolveParentDegreeQuality`, `degreeToRoman`, `getDiatonicChordForDegree`)
- Modify (tests): `src/musicCore/tonalAdapter.test.ts`, `src/musicCore/scale.test.ts`, `src/data/scales.test.ts`, `src/utils/musicTheory.test.ts`, `src/utils/diatonicCharacterization.test.ts`, `src/audio/chordProgressions.test.ts`, `src/store/vibeVariation.test.ts`, `src/components/loop/ChordPresetLibrary.test.tsx`
- Modify (scripts): `scripts/gen-diatonic-characterization.ts`, `scripts/verify-borrowed.mts`, `.claude/skills/instant-vibes/scripts/vibe-inventory.ts`

**Interfaces:**
- Consumes: `SCALES`, `ScaleDefinition` from `@/data/scales` (existing).
- Produces:
  - `scaleSemitonesForTonal(name: string): number[]` in `src/musicCore/tonalAdapter.ts` — semitones of `Scale.get('C ' + name).intervals`; throws `Error("tonal has no scale named '<name>'")` on an empty scale. Not re-exported from the barrel.
  - `type ResolvedScale = ScaleDefinition & { readonly intervals: readonly number[] }` and `SCALE_LIBRARY: Readonly<Record<string, ResolvedScale>>` (frozen, same keys and order as `SCALES`) in `src/musicCore/scale.ts`.
  - `scaleEntry(scaleType: string): ResolvedScale` (was `ScaleDefinition`); `resolveScaleKey` unchanged. The barrel `src/musicCore/index.ts` is unchanged (it already exports `resolveScaleKey, scaleEntry`).
  - `ScaleDefinition` no longer has `intervals`. Every interval read goes through `scaleEntry(key).intervals`.

- [ ] **Step 1: Copy the golden pin, then write the failing tests**

Before touching `src/data/scales.ts`, confirm the arrays below match today's literals: `grep -n "intervals:" src/data/scales.ts` must list exactly these 11 arrays in this order. Then replace `src/data/scales.test.ts` entirely:

```ts
import { describe, expect, test } from 'bun:test';
import { SCALES } from './scales';
import { scaleEntry } from '@/musicCore';
import { parentDegreesFor, resolveParentDegreeQuality } from '@/utils/musicTheory';

// The golden pin. These are the interval arrays the eleven legacy scales were
// hand-authored with before intervals became derived from `tonal`. A saved
// project names its scale by key, so each of these must keep sounding exactly
// as it did: a tonal upgrade that shifts one fails here, never in a user's ear.
// Copied verbatim from src/data/scales.ts as it stood; never regenerate it.
const LEGACY_INTERVALS: Record<string, readonly number[]> = {
  'Major': [0, 2, 4, 5, 7, 9, 11],
  'Natural Minor': [0, 2, 3, 5, 7, 8, 10],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Lydian': [0, 2, 4, 6, 7, 9, 11],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10],
  'Minor Pentatonic': [0, 3, 5, 7, 10],
  'Major Pentatonic': [0, 2, 4, 7, 9],
  'Blues': [0, 3, 5, 6, 7, 10],
  'Hirajoshi': [0, 2, 3, 7, 8],
};

describe('SCALES', () => {
  test('the eleven legacy keys still exist', () => {
    for (const key of Object.keys(LEGACY_INTERVALS)) {
      expect(Object.hasOwn(SCALES, key), key).toBe(true);
    }
  });

  test('every legacy scale derives exactly the intervals it was authored with', () => {
    for (const [key, intervals] of Object.entries(LEGACY_INTERVALS)) {
      expect(scaleEntry(key).intervals, key).toEqual(intervals);
    }
  });

  test('every parent names a 7-note SCALES entry, and no 7-note scale declares one', () => {
    for (const key of Object.keys(SCALES)) {
      const scale = scaleEntry(key);
      if (scale.intervals.length === 7) {
        expect(scale.parent, key).toBeUndefined();
        continue;
      }
      expect(scale.parent, key).toBeDefined();
      const parentKey = scale.parent as string;
      expect(Object.hasOwn(SCALES, parentKey), key).toBe(true);
      expect(scaleEntry(parentKey).intervals.length, key).toBe(7);
    }
  });

  // A degree the parent does not contain resolves through its nearest parent
  // neighbours. When two are equidistant their qualities must AGREE — the tie
  // is decided by agreement, never by array order. If this goes red, the answer
  // is an explicit `parent` change, never a tiebreak rule invented at that
  // moment to make the suite pass.
  test('equidistant parent neighbours agree on the quality', () => {
    let ties = 0;
    for (const key of Object.keys(SCALES)) {
      scaleEntry(key).intervals.forEach((_, degree) => {
        const { parentKey, degrees } = parentDegreesFor(key, degree);
        if (degrees.length < 2) return;
        ties++;
        for (const use7ths of [false, true]) {
          const qualities = degrees.map((d) => resolveParentDegreeQuality(parentKey, d, use7ths));
          expect(new Set(qualities).size, `${key} degree ${degree} 7ths=${use7ths}`).toBe(1);
        }
      });
    }
    // Exactly one tie exists today: Blues degree 3, the b5 at interval 6,
    // equidistant from Natural Minor's interval 5 and interval 7.
    expect(ties).toBe(1);
  });
});
```

Replace `src/musicCore/scale.test.ts` entirely:

```ts
import { describe, expect, test } from 'bun:test';
import { SCALES } from '@/data/scales';
import { SCALE_LIBRARY, resolveScaleKey, scaleEntry } from './scale';
import { scaleSemitonesForTonal } from './tonalAdapter';

describe('resolveScaleKey', () => {
  test('echoes a known scale type', () => {
    expect(resolveScaleKey('Minor Pentatonic')).toBe('Minor Pentatonic');
  });

  test('falls back to Major for an unrecognized scale type', () => {
    expect(resolveScaleKey('not-a-scale')).toBe('Major');
    expect(resolveScaleKey('')).toBe('Major');
  });

  test('falls back to Major for an inherited Object.prototype key rather than resolving it as a scale', () => {
    // A truthy `SCALES[scaleType]` check would pass for these — `SCALES['constructor']` is
    // the real `Object` constructor, which is truthy but not a ScaleDefinition.
    expect(resolveScaleKey('constructor')).toBe('Major');
    expect(resolveScaleKey('toString')).toBe('Major');
    expect(resolveScaleKey('__proto__')).toBe('Major');
    expect(resolveScaleKey('hasOwnProperty')).toBe('Major');
  });
});

describe('SCALE_LIBRARY', () => {
  test('has exactly the SCALES keys, in the same order', () => {
    expect(Object.keys(SCALE_LIBRARY)).toEqual(Object.keys(SCALES));
  });

  test('each entry is its SCALES definition plus the intervals its tonal name derives', () => {
    for (const [key, definition] of Object.entries(SCALES)) {
      const { intervals, ...rest } = SCALE_LIBRARY[key];
      expect(rest, key).toEqual(definition);
      expect(intervals, key).toEqual(scaleSemitonesForTonal(definition.tonal));
    }
  });

  test('is frozen, entries and interval arrays included', () => {
    expect(Object.isFrozen(SCALE_LIBRARY)).toBe(true);
    expect(Object.isFrozen(SCALE_LIBRARY['Major'])).toBe(true);
    expect(Object.isFrozen(SCALE_LIBRARY['Major'].intervals)).toBe(true);
  });
});

describe('scaleEntry', () => {
  test('returns the resolved library entry for a known scale type', () => {
    expect(scaleEntry('Minor Pentatonic')).toBe(SCALE_LIBRARY['Minor Pentatonic']);
    expect(scaleEntry('Minor Pentatonic').intervals).toEqual([0, 3, 5, 7, 10]);
  });

  test('returns the Major entry for an unrecognized scale type', () => {
    expect(scaleEntry('not-a-scale')).toBe(SCALE_LIBRARY['Major']);
  });

  test('returns the Major entry, not the inherited property, for an Object.prototype key', () => {
    expect(scaleEntry('constructor')).toBe(SCALE_LIBRARY['Major']);
    expect(scaleEntry('constructor').intervals).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleEntry('toString').intervals).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });
});
```

In `src/musicCore/tonalAdapter.test.ts`, add `scaleSemitonesForTonal,` to the `./tonalAdapter` import list (between `scaleNotesForTonal,` and `transposeByInterval,`) and insert these two tests immediately before `test('resolveTonalChord narrows …`:

```ts
  test('scaleSemitonesForTonal measures Scale.get(C name).intervals in semitones', () => {
    expect(scaleSemitonesForTonal('major')).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleSemitonesForTonal('minor pentatonic')).toEqual(
      Scale.get('C minor pentatonic').intervals.map((i) => Interval.semitones(i)),
    );
  });

  test('scaleSemitonesForTonal throws on a name tonal does not know', () => {
    expect(() => scaleSemitonesForTonal('not-a-scale')).toThrow("tonal has no scale named 'not-a-scale'");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/musicCore/tonalAdapter.test.ts src/musicCore/scale.test.ts src/data/scales.test.ts`
Expected: FAIL — `SyntaxError: Export named 'scaleSemitonesForTonal' not found` / `Export named 'SCALE_LIBRARY' not found`. (`src/data/scales.test.ts` passes on its own before and after this task: it is the pin that proves behaviour is unchanged.)

- [ ] **Step 3: Add `scaleSemitonesForTonal` to the adapter**

In `src/musicCore/tonalAdapter.ts`, insert directly after the `scaleNotesForTonal` function (it already imports `Interval` and `Scale`):

```ts
/**
 * The semitone offsets of `Scale.get('C ' + name).intervals`, tonic first.
 * Throws on a name tonal does not know: a scale library entry that resolves
 * to nothing is a typo, and it must fail at load rather than sound as silence.
 */
export function scaleSemitonesForTonal(name: string): number[] {
  const scale = Scale.get(`C ${name}`);
  if (scale.empty || scale.intervals.length === 0) {
    throw new Error(`tonal has no scale named '${name}'`);
  }
  return scale.intervals.map((interval) => Interval.semitones(interval));
}
```

- [ ] **Step 4: Build `SCALE_LIBRARY` in `scale.ts`**

Replace `src/musicCore/scale.ts` entirely:

```ts
import { SCALES, type ScaleDefinition } from '@/data/scales';
import { scaleSemitonesForTonal } from './tonalAdapter';

/**
 * A SCALES entry plus the intervals its `tonal` name derives. SCALES states no
 * intervals: `tonal` is their one source, and src/data/scales.test.ts pins the
 * legacy scales' intervals so a saved project keeps sounding as it did.
 */
export type ResolvedScale = ScaleDefinition & { readonly intervals: readonly number[] };

function resolveScale(definition: ScaleDefinition): ResolvedScale {
  return Object.freeze({
    ...definition,
    intervals: Object.freeze(scaleSemitonesForTonal(definition.tonal)),
  });
}

/**
 * Every SCALES entry, resolved once at module load. A `tonal` name that does
 * not resolve throws here, so a bad library entry fails the first import
 * rather than playing silence.
 */
export const SCALE_LIBRARY: Readonly<Record<string, ResolvedScale>> = Object.freeze(
  Object.fromEntries(Object.entries(SCALES).map(([key, definition]) => [key, resolveScale(definition)])),
);

/**
 * The ONE place an unrecognised scale type falls back to Major.
 *
 * Moved from `src/utils/scaleLookup.ts` (DEV-392): this issue's own audit found
 * `src/utils/musicTheory.ts` still inlining the same `SCALES[t] || SCALES['Major']`
 * pattern at six call sites despite this resolver already existing, plus a fourth,
 * uncoordinated copy (a hardcoded Major interval array) in `src/audio/bassPatterns.ts`.
 * Living under `src/musicCore/` — rather than `src/utils/` — is what lets
 * `src/audio/bassPatterns.ts` and every future non-`utils/` consumer reach it through
 * the same `@/musicCore` barrel as every other pitch/scale primitive, with no direct
 * dependency on `src/utils/`.
 */
export function resolveScaleKey(scaleType: string): string {
  return Object.hasOwn(SCALES, scaleType) ? scaleType : 'Major';
}

/** The resolved library entry a scale type names, with the same fallback. */
export function scaleEntry(scaleType: string): ResolvedScale {
  return SCALE_LIBRARY[resolveScaleKey(scaleType)];
}
```

- [ ] **Step 5: Drop `intervals` from the data**

In `src/data/scales.ts`, replace lines 1-30 (the doc comment and `interface ScaleDefinition`) with:

```ts
/**
 * The scale library: each scale's display name, category, the tonal scale
 * name its intervals and spelling come from, its spelling tonality, and — for
 * scales with fewer than seven degrees — the 7-note parent whose harmony it
 * borrows.
 *
 * Authored content, not a system registry: adding a scale is an edit to this
 * table and nothing else, which is the test that decides what belongs in
 * src/data/. ROOTS stays in musicCore — it is a spelling convention
 * inseparable from the functions that enforce it, not a library.
 *
 * Intervals are NOT stated here: `tonal` is their one source, and
 * src/musicCore/scale.ts derives them once at load (a name tonal does not
 * know throws there). scales.test.ts pins the legacy scales' intervals so a
 * saved project keeps sounding as it did. Per-degree chord qualities are not
 * stated either — utils/musicTheory.ts's resolveDegreeQuality derives them.
 * There are no overrides: an override field is the shortcut people reach for
 * instead of fixing the derivation. A specific chord at a specific degree
 * belongs in a CHORD_PROGRESSIONS step's explicit `quality`.
 */
export interface ScaleDefinition {
  name: string;
  category: 'Major / Minor' | 'Modal' | 'Pentatonic & Blues' | 'World & Exotic';
  /** tonal's scale name, e.g. 'harmonic minor'. `Scale.get('C ' + tonal)` spells and measures this scale. */
  tonal: string;
  /** SCALES key of the 7-note scale whose harmony this scale borrows. 7-note scales omit it. */
  parent?: string;
  /** Which tonic-spelling convention this scale writes its key with. */
  tonality: 'major' | 'minor';
}
```

Then delete every `    intervals: [...],` line in the `SCALES` object (11 lines; Hirajoshi's comment above its `intervals` line stays, it describes the scale). Check: `grep -c "intervals" src/data/scales.ts` prints `2` (both in the doc comment).

- [ ] **Step 6: Read scales only through `scaleEntry` in `musicTheory.ts`**

In `src/utils/musicTheory.ts`:
- Delete the 7-line block starting `// SCALES is authored content and lives in src/data/, below this file in the` and ending `import { SCALES } from '@/data/scales';`. (`scaleEntry` is already imported from `@/musicCore`.)
- In `parentDegreesFor`, replace
  ```ts
    const scale = SCALES[resolvedKey];
    const parentKey = scale.parent ?? resolvedKey;
    const degrees = nearestDegrees(SCALES[parentKey].intervals, scale.intervals[degree]);
  ```
  with
  ```ts
    const scale = scaleEntry(resolvedKey);
    const parentKey = scale.parent ?? resolvedKey;
    const degrees = nearestDegrees(scaleEntry(parentKey).intervals, scale.intervals[degree]);
  ```
- In `resolveParentDegreeQuality`: `scaleNotesForTonal('C', SCALES[parentKey].tonal)` → `scaleNotesForTonal('C', scaleEntry(parentKey).tonal)`.
- In `degreeToRoman` and `getDiatonicChordForDegree`: `const scale = SCALES[resolvedType];` → `const scale = scaleEntry(resolvedType);` (two sites).

Check: `grep -n "SCALES\[" src/utils/musicTheory.ts` prints nothing.

- [ ] **Step 7: Fix the type fallout the compiler reports**

Run: `bun run lint`
Expected: `TS2339: Property 'intervals' does not exist on type 'ScaleDefinition'` only in test files. Production code needs nothing else: every other production reader already uses `scaleEntry(...)`, and none mutates or passes the now-`readonly` array to a `number[]` parameter. Fix each test site:

- `src/utils/musicTheory.test.ts`: change the `@/musicCore` import to `import { CHORD_QUALITY_GROUPS, isChordQuality, scaleEntry, type ChordQuality } from '@/musicCore';` then:
  - `const numDegrees = SCALES[scaleType]?.intervals.length ?? 7;` → `const numDegrees = scaleEntry(scaleType).intervals.length;` (the `?? 7` was the unknown-key fallback; `scaleEntry` now supplies Major's 7).
  - In `describe('Hirajoshi')`: replace `const scale = SCALES['Hirajoshi'];` and the following `expect(scale).toBeDefined();` with `const scale = scaleEntry('Hirajoshi');`; `SCALES['Natural Minor'].intervals` → `scaleEntry('Natural Minor').intervals`; `SCALES['Hirajoshi'].intervals` → `scaleEntry('Hirajoshi').intervals`.
  - In `transposeProgression`'s `degreeOf`: `SCALES['Natural Minor'].intervals.indexOf(` → `scaleEntry('Natural Minor').intervals.indexOf(`.
  - In `reproduces nine of the eleven scales exactly`: `const scale = SCALES[key];` → `const scale = scaleEntry(key);`.
  - `Blues changes at four degrees` / `Hirajoshi changes at degree 3 …`: each `SCALES['Blues'].intervals` → `scaleEntry('Blues').intervals`, each `SCALES['Hirajoshi'].intervals` → `scaleEntry('Hirajoshi').intervals`.
  - In the registry test: `SCALES[scaleType].intervals.length` → `scaleEntry(scaleType).intervals.length`.
  - Keep the `SCALES` import (still used by `SCALE_KEYS` and loops over keys).
- `src/utils/diatonicCharacterization.test.ts`: add `import { scaleEntry } from '@/musicCore';` after the `SCALES` import; `SCALES[scaleType].intervals.map(` → `scaleEntry(scaleType).intervals.map(`.
- `src/audio/chordProgressions.test.ts`: import becomes `import { resolveScaleKey, scaleEntry, type ChordQuality } from '@/musicCore';`; `SCALES[p.referenceScale].intervals.length` → `scaleEntry(p.referenceScale).intervals.length`; `SCALES[resolvedType].intervals.length` → `scaleEntry(resolvedType).intervals.length`.
- `src/store/vibeVariation.test.ts`: replace `import { SCALES } from '../data/scales';` with `import { scaleEntry } from '@/musicCore';` (SCALES has no other use there — ESLint `no-unused-vars` fails otherwise); `SCALES[v.scaleType].intervals.length` → `scaleEntry(v.scaleType).intervals.length`.
- `src/components/loop/ChordPresetLibrary.test.tsx`: add `import { scaleEntry } from '@/musicCore';` after the `SCALES` import, and replace
  ```ts
      for (const [scaleType, scale] of Object.entries(SCALES)) {
        if (scale.intervals.length !== 7) continue;
  ```
  with
  ```ts
      for (const scaleType of Object.keys(SCALES)) {
        if (scaleEntry(scaleType).intervals.length !== 7) continue;
  ```

Run: `bun run lint`
Expected: no output after `$ tsc --noEmit`.

- [ ] **Step 8: Fix the scripts `tsc` does not see**

These run under Bun but are outside `tsconfig.json`'s `include`, so a stale `.intervals` read would only fail at run time.
- `scripts/gen-diatonic-characterization.ts`: add `import { scaleEntry } from '../src/musicCore';` after the `SCALES` import; `SCALES[scaleType].intervals.map(` → `scaleEntry(scaleType).intervals.map(`.
- `scripts/verify-borrowed.mts`: add `import { scaleEntry } from '../src/musicCore';` after the `SCALES` import; both `SCALES[scaleType].intervals.map(` → `scaleEntry(scaleType).intervals.map(`.
- `.claude/skills/instant-vibes/scripts/vibe-inventory.ts`: add `import { scaleEntry } from '@/musicCore';` after the `SCALES` import; the three `SCALES[s].intervals.length` / `SCALES[arg].intervals.length` reads → `scaleEntry(s).intervals.length` / `scaleEntry(arg).intervals.length`. Keep `if (!SCALES[arg])` (a key-existence check).

Run: `bun run scripts/gen-diatonic-characterization.ts | diff - src/utils/diatonicCharacterizationFixture.ts && echo SAME`
Expected: `SAME` (derived intervals reproduce the fixture byte for byte).
Run: `bun run scripts/verify-borrowed.mts > /dev/null && bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts | head -3`
Expected: exits 0; the inventory prints `SCALE TYPES that progressions are authored against`.
Run: `grep -rnE "SCALES\[[^]]+\]\??\.intervals" src scripts .claude/skills`
Expected: no `.ts`/`.tsx`/`.mts` hits (Markdown hits are fixed in Task 4).

- [ ] **Step 9: Run the suite, lint and dead-code scans**

Run: `bun test && bun run lint && bun run eslint && bun run check:dead-code`
Expected: all tests pass (0 fail), `tsc` and `eslint` print nothing, Knip reports nothing.

- [ ] **Step 10: Commit**

```bash
git add src/musicCore/tonalAdapter.ts src/musicCore/tonalAdapter.test.ts src/musicCore/scale.ts src/musicCore/scale.test.ts \
  src/data/scales.ts src/data/scales.test.ts src/utils/musicTheory.ts src/utils/musicTheory.test.ts \
  src/utils/diatonicCharacterization.test.ts src/audio/chordProgressions.test.ts src/store/vibeVariation.test.ts \
  src/components/loop/ChordPresetLibrary.test.tsx scripts/gen-diatonic-characterization.ts scripts/verify-borrowed.mts \
  .claude/skills/instant-vibes/scripts/vibe-inventory.ts
git commit -m "$(cat <<'EOF'
refactor(scales): derive scale intervals from tonal

SCALES no longer states intervals; musicCore resolves each entry's tonal
name once at load into SCALE_LIBRARY, and scaleEntry returns the resolved
entry. A golden pin holds the eleven legacy interval arrays so saved
projects sound identical.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Grow the library to 24 scales

**Files:**
- Modify: `src/data/scales.ts` (whole file)
- Modify (tests): `src/data/scales.test.ts`, `src/utils/musicTheory.test.ts` (Hirajoshi category), `src/utils/diatonicCharacterization.test.ts`, `src/utils/noteSpelling.test.ts`, `src/store/sanitize.test.ts`, `src/store/keyChange.test.ts`, `src/components/ui/Keyboard.test.ts`
- Regenerate: `src/utils/diatonicCharacterizationFixture.ts`, `src/utils/spellingCharacterizationFixture.ts`
- Modify (comments): `src/utils/musicTheory.ts` (`parentDegreesFor` doc), `src/utils/noteSpelling.ts` (cache comment, `formatKeyLabel` doc), `scripts/gen-spelling-characterization.ts` (header)

**Interfaces:**
- Consumes: `scaleEntry(key): ResolvedScale` (Task 1); `resolveDegreeQuality`, `parentDegreesFor`, `resolveParentDegreeQuality`, `getScaleNotes` from `@/utils/musicTheory`; `formatKeyLabel` from `@/utils/noteSpelling`; `sanitizeLoops` from `@/store/sanitize`; `changeKey`, `harmonizeChordsToKey` from `@/store/keyChange`.
- Produces (in `src/data/scales.ts`):
  - `export type ScaleCategory = 'Diatonic' | 'Modes' | 'Pentatonic' | 'Blues' | 'World'`
  - `export const SCALE_CATEGORIES: readonly ScaleCategory[]` — display order `['Diatonic', 'Modes', 'Pentatonic', 'Blues', 'World']`
  - `export interface ScaleDefinition { name: string; description: string; category: ScaleCategory; tonal: string; tonality: 'major' | 'minor'; parent?: string }`
  - `SCALES` with the 24 keys, in this display order: `Major, Natural Minor, Harmonic Minor, Melodic Minor, Harmonic Major, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Dorian b2, Lydian Dominant, Lydian Augmented, Mixolydian b6, Locrian #2, Phrygian Dominant, Major Pentatonic, Minor Pentatonic, Egyptian, Major Blues, Blues, Hirajoshi, Pelog, Vietnamese`.

- [ ] **Step 1: Write the failing library tests**

In `src/data/scales.test.ts`:
- Change the imports to:
  ```ts
  import { SCALES, SCALE_CATEGORIES } from './scales';
  import { scaleEntry } from '@/musicCore';
  import { parentDegreesFor, resolveDegreeQuality, resolveParentDegreeQuality } from '@/utils/musicTheory';
  ```
- Replace the tie count comment and assertion at the end of `equidistant parent neighbours agree on the quality` with:
  ```ts
      // Exactly two ties exist today, and both sides agree in each: Blues
      // degree 3, the b5 at interval 6, equidistant from Natural Minor's
      // intervals 5 and 7; and Major Blues degree 2, the blue b3 at interval 3,
      // equidistant from Major's intervals 2 and 4.
      expect(ties).toBe(2);
  ```
- Add these tests inside `describe('SCALES', …)`, after the tie test:

```ts
  test('holds the library keys in display order', () => {
    expect(Object.keys(SCALES)).toEqual([
      'Major', 'Natural Minor', 'Harmonic Minor', 'Melodic Minor', 'Harmonic Major',
      'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Locrian', 'Dorian b2', 'Lydian Dominant',
      'Lydian Augmented', 'Mixolydian b6', 'Locrian #2', 'Phrygian Dominant',
      'Major Pentatonic', 'Minor Pentatonic', 'Egyptian',
      'Major Blues', 'Blues',
      'Hirajoshi', 'Pelog', 'Vietnamese',
    ]);
  });

  test('every scale has 5 to 7 intervals, from 0, strictly increasing, below 12', () => {
    for (const key of Object.keys(SCALES)) {
      const { intervals } = scaleEntry(key);
      expect(intervals.length, key).toBeGreaterThanOrEqual(5);
      expect(intervals.length, key).toBeLessThanOrEqual(7);
      expect(intervals[0], key).toBe(0);
      intervals.forEach((interval, i) => {
        expect(interval, key).toBeLessThan(12);
        if (i > 0) expect(interval, key).toBeGreaterThan(intervals[i - 1]);
      });
    }
  });

  test('no parent itself has a parent', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      if (scale.parent === undefined) continue;
      expect(SCALES[scale.parent].parent, key).toBeUndefined();
    }
  });

  // The major third decides, when the scale has one: Major Blues holds the b3
  // as a blue note beside its major third and is still a major-key scale. A
  // scale with no third at all (Egyptian) spells as minor.
  test('tonality agrees with the derived third', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      const expected = scaleEntry(key).intervals.includes(4) ? 'major' : 'minor';
      expect(scale.tonality, key).toBe(expected);
    }
  });

  test('categories run in SCALE_CATEGORIES order, contiguously, none empty', () => {
    const runs: string[] = [];
    for (const scale of Object.values(SCALES)) {
      if (runs[runs.length - 1] !== scale.category) runs.push(scale.category);
    }
    expect(runs).toEqual([...SCALE_CATEGORIES]);
  });

  test('every scale has a name and a one-line description', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      expect(scale.name.trim(), key).not.toBe('');
      expect(scale.description, key).toMatch(/^\S.* · \S.*$/);
      expect(scale.description, key).not.toContain('\n');
    }
  });

  // The header's short label renders the key itself, so a key must read as
  // plain text: letters, digits, spaces and '#' only — no '♭' or '♯'.
  test('every key is readable ASCII', () => {
    for (const key of Object.keys(SCALES)) {
      expect(key).toMatch(/^[A-Za-z0-9# ]+$/);
    }
  });
```

- Add a second `describe` at the end of the file:

```ts
describe('harmony', () => {
  // Every scale must harmonize at every degree: a scale whose derived
  // interval tuple is missing from the quality tables throws in
  // resolveDegreeQuality, and that must fail here, not in the chord pads.
  test('every degree of every scale resolves a triad and a seventh', () => {
    for (const key of Object.keys(SCALES)) {
      scaleEntry(key).intervals.forEach((_, degree) => {
        for (const use7ths of [false, true]) {
          expect(() => resolveDegreeQuality(key, degree, use7ths), `${key} degree ${degree} 7ths=${use7ths}`).not.toThrow();
        }
      });
    }
  });
});
```

- [ ] **Step 2: Write the failing Review Focus tests**

`src/store/sanitize.test.ts` — insert before `describe('sanitizeLoops fills the label fields instead of inventing a name', …)`:

```ts
describe('sanitizeLoops and the scale library', () => {
  // A scale key added to SCALES is valid on read with no persist version bump
  // (R035): SCALE_TYPE_SET is built from the table itself.
  test('keeps a scale key added with the library growth', () => {
    for (const scaleType of ['Locrian #2', 'Egyptian', 'Vietnamese']) {
      const [out] = sanitizeLoops([{ ...createDefaultLoop(), scaleType }]) ?? [];
      expect(out.scaleType).toBe(scaleType);
    }
  });

  test('keeps every legacy key', () => {
    for (const scaleType of ['Major', 'Natural Minor', 'Blues', 'Hirajoshi']) {
      const [out] = sanitizeLoops([{ ...createDefaultLoop(), scaleType }]) ?? [];
      expect(out.scaleType).toBe(scaleType);
    }
  });

  // A murva value or a display name is not a key: it falls back like any
  // unknown string, to the default loop's scale.
  test('rejects a display name or a tonal name in place of a key', () => {
    for (const scaleType of ['Locrian ♯2', 'Minor Blues', 'vietnamese 1']) {
      const [out] = sanitizeLoops([{ ...createDefaultLoop(), scaleType }]) ?? [];
      expect(out.scaleType).toBe(createDefaultLoop().scaleType);
    }
  });
});
```

`src/store/keyChange.test.ts` — add `import { getScaleNotes } from '../utils/musicTheory';` after the `./keyChange` import. In `describe('harmonizeChordsToKey')`, insert before `test('both changed transposes first, then snaps — the order is pinned', …)`:

```ts
  // A 7-note scale to a new 5-note one: every chord snaps onto a degree of
  // A Egyptian (A B D E G) with the quality its Dorian parent gives there.
  test('a change to a 5-note scale snaps every chord into it', () => {
    const out = harmonizeChordsToKey(PROGRESSION, A_MINOR, { ...A_MINOR, scaleType: 'Egyptian' });
    expect(names(out)).toEqual(['Amin', 'Emin', 'Bmin', 'Gmaj']);
    for (const c of out ?? []) expect(getScaleNotes('A', 'Egyptian')).toContain(c.root);
  });
```

In `describe('changeKey')`, insert before `test('harmonizeChords: false leaves chords out of the patch', …)`:

```ts
  // Melody remaps by degree index, exactly as for Minor Pentatonic: C4 (degree
  // 2 of A minor) lands on D4 (degree 2 of A Egyptian), E4 (degree 4) on G4.
  test('a change to a 5-note scale remaps melodies by degree', () => {
    const patch = changeKey(source(), { scaleType: 'Egyptian' }, { harmonizeChords: true });
    expect(patch.scaleType).toBe('Egyptian');
    expect(patch.leadMelodySteps![0]).toEqual([{ note: 'A3', len: 1 }, { note: 'D4', len: 1 }]);
    expect(patch.fxMelodySteps![0]).toEqual([{ note: 'G4', len: 1 }]);
    expect(names(patch.chords)).toEqual(['Amin', 'Emin', 'Bmin', 'Gmaj']);
  });
```

`src/components/ui/Keyboard.test.ts` — in `describe('getScaleLockedTouchRows — one octave of the scale per row (R340)')`, extend `cases`:

```ts
  const cases: [string, string, number][] = [
    ['C', 'Major', 7],
    ['A', 'Blues', 6],
    ['E', 'Hirajoshi', 5],
    ['F#', 'Minor Pentatonic', 5],
    ['D', 'Egyptian', 5],
    ['G', 'Pelog', 5],
    ['C#', 'Major Blues', 6],
    ['A#', 'Locrian #2', 7],
  ];
```

`src/utils/noteSpelling.test.ts` — add `formatKeyLabel,` to the `./noteSpelling` import list (after `KEY_OPTIONS,`) and append:

```ts
describe('formatKeyLabel', () => {
  // The short form renders the key itself (the header summary); the long form
  // swaps in the display name (its tooltip). Both spell the tonic by the
  // scale's tonality.
  test('a new key reads as ASCII short and as its display name long', () => {
    expect(formatKeyLabel('A#', 'Locrian #2')).toBe('Bb Locrian #2');
    expect(formatKeyLabel('A#', 'Locrian #2', { long: true })).toBe('Bb Locrian ♯2');
    expect(formatKeyLabel('D#', 'Phrygian Dominant')).toBe('Eb Phrygian Dominant');
    expect(formatKeyLabel('C#', 'Egyptian')).toBe('C# Egyptian');
  });

  test('a legacy key keeps its key in short form and takes the new display name long', () => {
    expect(formatKeyLabel('A', 'Blues')).toBe('A Blues');
    expect(formatKeyLabel('A', 'Blues', { long: true })).toBe('A Minor Blues');
    expect(formatKeyLabel('A#', 'Major', { long: true })).toBe('Bb Major');
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `bun test src/data/scales.test.ts src/store/sanitize.test.ts src/store/keyChange.test.ts src/components/ui/Keyboard.test.ts src/utils/noteSpelling.test.ts`
Expected: FAIL — `Export named 'SCALE_CATEGORIES' not found` in `scales.test.ts`; unknown keys (`Locrian #2`, `Egyptian`, …) fall back, so the sanitize, key-change, keyboard and label assertions fail.

- [ ] **Step 4: Write the 24-scale library**

Replace `src/data/scales.ts` entirely. Descriptions and display names are murva's `SUPPORTED_SCALES` strings, verbatim:

```ts
/**
 * The scale library: each scale's display name, one-line description,
 * category, the tonal scale name its intervals and spelling come from, its
 * spelling tonality, and — for scales with fewer than seven degrees — the
 * 7-note parent whose harmony it borrows.
 *
 * Authored content, not a system registry: adding a scale is an edit to this
 * table and nothing else, which is the test that decides what belongs in
 * src/data/. Names, descriptions and order follow murva's scale list.
 *
 * Intervals are NOT stated here: `tonal` is their one source, and
 * src/musicCore/scale.ts derives them once at load (a name tonal does not
 * know throws there). scales.test.ts pins the legacy scales' intervals so a
 * saved project keeps sounding as it did. Per-degree chord qualities are not
 * stated either — utils/musicTheory.ts's resolveDegreeQuality derives them.
 * There are no overrides: an override field is the shortcut people reach for
 * instead of fixing the derivation. A specific chord at a specific degree
 * belongs in a CHORD_PROGRESSIONS step's explicit `quality`.
 *
 * Keys are persisted identities (`scaleType`) and never renamed; the header's
 * short label renders the key itself, so a key is readable ASCII. Key order is
 * display order, grouped contiguously by category in SCALE_CATEGORIES order.
 */
export type ScaleCategory = 'Diatonic' | 'Modes' | 'Pentatonic' | 'Blues' | 'World';

/** Display order of the categories; every category holds at least one scale. */
export const SCALE_CATEGORIES: readonly ScaleCategory[] = ['Diatonic', 'Modes', 'Pentatonic', 'Blues', 'World'];

export interface ScaleDefinition {
  /** Display name, e.g. 'Minor (Natural)'. */
  name: string;
  /** One line of mood and genres, e.g. 'Minor but hopeful · jazz, funk, soul'. */
  description: string;
  category: ScaleCategory;
  /** tonal's scale name, e.g. 'harmonic minor'. `Scale.get('C ' + tonal)` spells and measures this scale. */
  tonal: string;
  /** Which tonic-spelling convention this scale writes its key with. */
  tonality: 'major' | 'minor';
  /** SCALES key of the 7-note scale whose harmony this scale borrows. 7-note scales omit it. */
  parent?: string;
}

export const SCALES: Record<string, ScaleDefinition> = {
  'Major': {
    name: 'Major',
    description: 'Bright and uplifting · pop, rock, folk',
    category: 'Diatonic',
    tonal: 'major',
    tonality: 'major',
  },
  'Natural Minor': {
    name: 'Minor (Natural)',
    description: 'Dark and emotional · rock, pop, classical',
    category: 'Diatonic',
    tonal: 'aeolian',
    tonality: 'minor',
  },
  'Harmonic Minor': {
    name: 'Harmonic Minor',
    description: 'Dramatic with an exotic pull · classical, metal',
    category: 'Diatonic',
    tonal: 'harmonic minor',
    tonality: 'minor',
  },
  'Melodic Minor': {
    name: 'Melodic Minor',
    description: 'Smooth and bittersweet · jazz, cinematic',
    category: 'Diatonic',
    tonal: 'melodic minor',
    tonality: 'minor',
  },
  'Harmonic Major': {
    name: 'Harmonic Major',
    description: 'Warm with a classical color · orchestral, jazz',
    category: 'Diatonic',
    tonal: 'harmonic major',
    tonality: 'major',
  },
  'Dorian': {
    name: 'Dorian',
    description: 'Minor but hopeful · jazz, funk, soul',
    category: 'Modes',
    tonal: 'dorian',
    tonality: 'minor',
  },
  'Phrygian': {
    name: 'Phrygian',
    description: 'Dark and tense · metal, flamenco',
    category: 'Modes',
    tonal: 'phrygian',
    tonality: 'minor',
  },
  'Lydian': {
    name: 'Lydian',
    description: 'Dreamy and ethereal · film scores, ambient',
    category: 'Modes',
    tonal: 'lydian',
    tonality: 'major',
  },
  'Mixolydian': {
    name: 'Mixolydian',
    description: 'Bright but bluesy · rock, blues, country',
    category: 'Modes',
    tonal: 'mixolydian',
    tonality: 'major',
  },
  'Locrian': {
    name: 'Locrian',
    description: 'Tense and unresolved · experimental, horror',
    category: 'Modes',
    tonal: 'locrian',
    tonality: 'minor',
  },
  'Dorian b2': {
    name: 'Dorian ♭2',
    description: 'Dark and exotic · ethnic fusion, jazz',
    category: 'Modes',
    tonal: 'dorian b2',
    tonality: 'minor',
  },
  'Lydian Dominant': {
    name: 'Lydian Dominant',
    description: 'Bright with a bluesy edge · jazz, funk, fusion',
    category: 'Modes',
    tonal: 'lydian dominant',
    tonality: 'major',
  },
  'Lydian Augmented': {
    name: 'Lydian Augmented',
    description: 'Mysterious and floating · cinematic, jazz',
    category: 'Modes',
    tonal: 'lydian augmented',
    tonality: 'major',
  },
  'Mixolydian b6': {
    name: 'Mixolydian ♭6',
    description: 'Bittersweet and moody · film, fusion',
    category: 'Modes',
    tonal: 'mixolydian b6',
    tonality: 'major',
  },
  'Locrian #2': {
    name: 'Locrian ♯2',
    description: 'Tense but usable in jazz · modern, fusion',
    category: 'Modes',
    tonal: 'locrian #2',
    tonality: 'minor',
  },
  'Phrygian Dominant': {
    name: 'Phrygian Dominant',
    description: 'Intense and passionate · flamenco, metal, cinematic',
    category: 'Modes',
    tonal: 'phrygian dominant',
    tonality: 'major',
  },
  'Major Pentatonic': {
    name: 'Major Pentatonic',
    description: 'Open and positive · pop, country, rock',
    category: 'Pentatonic',
    tonal: 'major pentatonic',
    tonality: 'major',
    parent: 'Major',
  },
  'Minor Pentatonic': {
    name: 'Minor Pentatonic',
    description: 'Soulful and versatile · blues, rock, R&B',
    category: 'Pentatonic',
    tonal: 'minor pentatonic',
    tonality: 'minor',
    parent: 'Natural Minor',
  },
  'Egyptian': {
    name: 'Egyptian',
    description: 'Ancient and mysterious · world, experimental',
    category: 'Pentatonic',
    tonal: 'egyptian',
    // No third at all (C D F G Bb), so the tonality is a spelling choice:
    // minor, the key signature of its Dorian parent.
    tonality: 'minor',
    // Dorian, not Natural Minor: Natural Minor would put a diminished chord
    // on degree 2. Dorian gives min / min / maj / min / maj.
    parent: 'Dorian',
  },
  'Major Blues': {
    name: 'Major Blues',
    description: 'Cheerful with a bluesy bite · blues, rock',
    category: 'Blues',
    tonal: 'major blues',
    tonality: 'major',
    parent: 'Major',
  },
  'Blues': {
    name: 'Minor Blues',
    description: 'Gritty and soulful · blues, rock, jazz',
    category: 'Blues',
    tonal: 'blues',
    tonality: 'minor',
    parent: 'Natural Minor',
  },
  'Hirajoshi': {
    name: 'Hirajoshi (Japanese)',
    description: 'Sparse and contemplative · ambient, world',
    category: 'World',
    // 1, 2, b3, 5, b6 — step pattern 2-1-4-1-4, two half-steps and two major
    // thirds. Burrows/Wikipedia spelling, the one the koto references use.
    tonal: 'hirajoshi',
    tonality: 'minor',
    // Parent is Natural Minor: Hirajoshi is a strict subset of it at degrees
    // 1, 2, 3, 5, 6. Stacking scale-steps on a scale with two major-third gaps
    // does not give tertian chords (degree 0 would be {0, 3, 8}), so the
    // harmony comes from the parent — and reaching outside the five notes is
    // what a five-note scale with two major-third gaps does, not a defect.
    // Degree 3 was a hand-written sus4/7sus4 deviation; it is now min/min7.
    parent: 'Natural Minor',
  },
  'Pelog': {
    name: 'Pelog (Indonesian)',
    description: 'Mystical and gamelan-like · world, experimental',
    category: 'World',
    tonal: 'pelog',
    tonality: 'minor',
    // Phrygian keeps pelog's b2; Natural Minor would not.
    parent: 'Phrygian',
  },
  'Vietnamese': {
    name: 'Vietnamese',
    description: 'Gentle and Southeast Asian · folk, world',
    category: 'World',
    tonal: 'vietnamese 1',
    tonality: 'minor',
    parent: 'Natural Minor',
  },
};
```

In `src/utils/musicTheory.test.ts`, `describe('Hirajoshi')`: rename the test to `'is a five-degree World scale on [0, 2, 3, 7, 8]'` and change `expect(scale.category).toBe('World & Exotic');` to `expect(scale.category).toBe('World');`.

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `bun test src/data/scales.test.ts src/store/sanitize.test.ts src/store/keyChange.test.ts src/components/ui/Keyboard.test.ts src/musicCore/scale.test.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate the characterization fixtures and prove the diff is additive**

```bash
bun run scripts/gen-diatonic-characterization.ts > src/utils/diatonicCharacterizationFixture.ts
bun run scripts/gen-spelling-characterization.ts > src/utils/spellingCharacterizationFixture.ts
OLD=$(mktemp -d) && git show HEAD:src/utils/diatonicCharacterizationFixture.ts > $OLD/d.ts && git show HEAD:src/utils/spellingCharacterizationFixture.ts > $OLD/s.ts && OLD=$OLD bun -e "
const old = process.env.OLD;
const { DIATONIC_CHARACTERIZATION: a } = await import(old + '/d.ts');
const { DIATONIC_CHARACTERIZATION: b } = await import('./src/utils/diatonicCharacterizationFixture.ts');
const { SPELLING_CHARACTERIZATION: c } = await import(old + '/s.ts');
const { SPELLING_CHARACTERIZATION: d } = await import('./src/utils/spellingCharacterizationFixture.ts');
const moved = (o, n) => Object.keys(o).filter((k) => o[k] !== n[k]);
console.log(Object.keys(b).length, moved(a, b), Object.keys(d).length, moved(c, d));
"; rm -rf $OLD
```

Expected: `576 [] 288 []` — every pre-existing entry is identical (the `git diff` shows moved lines only because key order changed). Any non-empty list is a behaviour change to a legacy scale: stop and investigate, do not commit.

- [ ] **Step 7: Update the counted characterization tests**

`src/utils/diatonicCharacterization.test.ts`: both `264` → `576`:
```ts
    expect(Object.keys(DIATONIC_CHARACTERIZATION).length).toBe(576);
    expect(Object.keys(SCALES).length * ROOTS.length * 2).toBe(576);
```

`src/utils/noteSpelling.test.ts`, `describe('spelling characterization')`:
- `test('pins all 132 (root x scale) pairs'` → `test('pins all 288 (root x scale) pairs'`, and `.toBe(132)` → `.toBe(288)`.
- `test('changes at least one note name in 68 of the 132 pairs'` → `test('changes at least one note name in 166 of the 288 pairs'`, and `expect(changed).toBe(68);` → `expect(changed).toBe(166);`.
- `test('exactly two pairs reach a double accidental and take the fallback'` → `test('exactly eleven pairs reach a double accidental and take the fallback'`, and the expectation becomes:
  ```ts
      expect(fallbacks.sort()).toEqual([
        'B|Lydian Augmented',
        'C#|Harmonic Major',
        'C#|Mixolydian b6',
        'C#|Phrygian Dominant',
        'D#|Blues',
        'D#|Locrian',
        'D#|Locrian #2',
        'F#|Lydian Augmented',
        'G#|Harmonic Minor',
        'G#|Melodic Minor',
        'G#|Phrygian Dominant',
      ]);
  ```
  (The legacy pairs `D#|Blues` and `G#|Harmonic Minor` stay; the other nine are new keys that reach a double accidental and take the existing sharp/flat fallback.)

- [ ] **Step 8: Fix the comments the growth made wrong**

- `src/utils/musicTheory.ts`, `parentDegreesFor` doc — replace
  ```ts
   * picking one. Exactly one such degree exists today: Blues degree 3.
  ```
  with
  ```ts
   * picking one. Two exist today: Blues degree 3 and Major Blues degree 2.
  ```
- `src/utils/noteSpelling.ts`, the spelling-cache comment — replace
  ```ts
  // Keyed `${pitchClass}|${rootNote}|${scaleType}`, so at most 12 x 12 x 11
  // entries. Correct forever because SCALES is frozen content and tonal is pure.
  ```
  with
  ```ts
  // Keyed `${pitchClass}|${rootNote}|${scaleType}`, so at most 12 x 12 x one
  // per SCALES key. Correct forever because SCALES is frozen content and tonal is pure.
  ```
  and in `formatKeyLabel`'s doc, `the SCALES entry's display name ('Major (Ionian)')` → `the SCALES entry's display name ('Minor (Natural)')`.
- `scripts/gen-spelling-characterization.ts` — replace the header lines
  ```ts
  // All 132 (root x scale) pairs, not a sample: a sample would miss both
  // double-accidental pairs — the only cases that exercise the fallback — and
  ```
  with
  ```ts
  // Every (root x scale) pair, not a sample: a sample would miss the
  // double-accidental pairs — the only cases that exercise the fallback — and
  ```
  and in the emitted doc string ` * All 132 (root x scale) pairs. Key: …` → ` * Every (root x scale) pair. Key: …` (keep the escaped key text as is). Then regenerate once more (`bun run scripts/gen-spelling-characterization.ts > src/utils/spellingCharacterizationFixture.ts`) so the fixture header matches.

- [ ] **Step 9: Run the suite and lints**

Run: `bun test && bun run lint && bun run eslint && bun run check:dead-code`
Expected: all pass, `tsc`/`eslint`/Knip print nothing.

- [ ] **Step 10: Commit**

```bash
git add src/data/scales.ts src/data/scales.test.ts src/utils/musicTheory.ts src/utils/musicTheory.test.ts \
  src/utils/noteSpelling.ts src/utils/noteSpelling.test.ts src/utils/diatonicCharacterization.test.ts \
  src/utils/diatonicCharacterizationFixture.ts src/utils/spellingCharacterizationFixture.ts \
  scripts/gen-spelling-characterization.ts src/store/sanitize.test.ts src/store/keyChange.test.ts \
  src/components/ui/Keyboard.test.ts
git commit -m "$(cat <<'EOF'
feat(scales): grow the library to 24 scales with descriptions

Adds thirteen tonal-derived scales and murva's names, descriptions and
categories. Legacy keys stay; every legacy characterization entry is
unchanged. Library and harmony invariants cover every scale.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Group the scale selects by category

**Files:**
- Create: `src/components/ui/ScaleTypeOptions.tsx`
- Create: `src/components/ui/ScaleTypeOptions.test.tsx`
- Modify: `src/components/header/ScaleMenu.tsx` (the scale `<select>` body in `ScaleSelects`)
- Modify: `src/components/song/KeyChangeDialog.tsx` (`SetKeyFields`' scale `<select>` body; drop its `SCALES` import)
- Modify (tests): `src/components/Header.test.tsx` (`describe('key picker')`), `src/components/song/KeyChangeDialog.test.tsx`

**Interfaces:**
- Consumes: `SCALES`, `SCALE_CATEGORIES` from `@/data/scales` (Task 2).
- Produces: `export function ScaleTypeOptions(): JSX.Element` — a fragment of `<optgroup label={category}>` elements, one per `SCALE_CATEGORIES` entry, each holding `<option value={key}>{SCALES[key].name}</option>` in `SCALES` order. No props, no store reads. Placed in `ui/` because two areas use it (R276).

- [ ] **Step 1: Write the failing tests**

Create `src/components/ui/ScaleTypeOptions.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SCALES, SCALE_CATEGORIES } from '@/data/scales';
import { ScaleTypeOptions } from './ScaleTypeOptions';

// No store read: the options are static content, so renderToString sees
// exactly what the browser gets (the R257 trap does not apply).
const html = renderToString(
  <select>
    <ScaleTypeOptions />
  </select>,
);

/** `[label, optionValues[]]` for each optgroup, in document order. */
function groups(markup: string): [string, string[]][] {
  return [...markup.matchAll(/<optgroup label="([^"]*)">(.*?)<\/optgroup>/g)].map(([, label, body]) => [
    label,
    [...body.matchAll(/<option value="([^"]*)"/g)].map(([, value]) => value),
  ]);
}

describe('ScaleTypeOptions', () => {
  test('one optgroup per category, in SCALE_CATEGORIES order', () => {
    expect(groups(html).map(([label]) => label)).toEqual([...SCALE_CATEGORIES]);
  });

  test('every SCALES key is one option, in SCALES order, under its own category', () => {
    const rendered = groups(html);
    expect(rendered.flatMap(([, values]) => values)).toEqual(Object.keys(SCALES));
    for (const [label, values] of rendered) {
      for (const key of values) expect(SCALES[key].category, key).toBe(label);
    }
  });

  test('an option shows the display name and keeps the key as its value', () => {
    expect(html).toContain('<option value="Locrian #2">Locrian ♯2</option>');
    expect(html).toContain('<option value="Blues">Minor Blues</option>');
    expect(html).toContain('<option value="Natural Minor">Minor (Natural)</option>');
  });
});
```

`src/components/Header.test.tsx`: add `import { SCALE_CATEGORIES } from '@/data/scales';` after the `useAppStore` import, and inside `describe('key picker')` insert before `test('the key/scale menu renders both breakpoint copies', …)`:

```tsx
  // The scale select groups its options by category; the root select has no
  // groups. Static content, so no store state is involved (R257).
  test('the scale select renders one optgroup per category, in order', () => {
    const html = renderToString(<ScaleSelects idPrefix="test" />);
    const labels = [...html.matchAll(/<optgroup label="([^"]*)"/g)].map(([, label]) => label);
    expect(labels).toEqual([...SCALE_CATEGORIES]);
  });

  test('both breakpoint copies group their scale options', () => {
    const html = renderToString(<ScaleMenu />);
    expect(html.match(/<optgroup /g) ?? []).toHaveLength(SCALE_CATEGORIES.length * 2);
  });
```

`src/components/song/KeyChangeDialog.test.tsx`: add `import { SCALE_CATEGORIES } from '@/data/scales';` after the `./KeyChangeDialog` import, and insert before `test('Apply and Cancel actions', …)`:

```tsx
  test('the scale select groups its options, one optgroup per category', () => {
    const select = html.slice(html.indexOf('id="select-key-change-scale"'));
    const labels = [...select.slice(0, select.indexOf('</select>')).matchAll(/<optgroup label="([^"]*)"/g)]
      .map(([, label]) => label);
    expect(labels).toEqual([...SCALE_CATEGORIES]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/ui/ScaleTypeOptions.test.tsx src/components/Header.test.tsx src/components/song/KeyChangeDialog.test.tsx`
Expected: FAIL — `Cannot find module './ScaleTypeOptions'`; the Header and dialog optgroup tests get `[]`.

- [ ] **Step 3: Create the component**

Create `src/components/ui/ScaleTypeOptions.tsx`:

```tsx
import { SCALES, SCALE_CATEGORIES } from '@/data/scales';

/** Each category with its SCALES keys, in display order. Built once: SCALES is static content. */
const SCALE_GROUPS = SCALE_CATEGORIES.map((category) => ({
  category,
  keys: Object.keys(SCALES).filter((key) => SCALES[key].category === category),
}));

/**
 * The scale-type `<option>`s for a native `<select>`, one `<optgroup>` per
 * category. The value is the persisted SCALES key; the text is the display
 * name. Shared by the header's scale select and the key-change dialog's.
 */
export function ScaleTypeOptions() {
  return (
    <>
      {SCALE_GROUPS.map(({ category, keys }) => (
        <optgroup key={category} label={category}>
          {keys.map((key) => (
            <option key={key} value={key}>
              {SCALES[key].name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Use it in both selects**

`src/components/header/ScaleMenu.tsx`: add `import { ScaleTypeOptions } from '@/components/ui/ScaleTypeOptions';` after the `fieldClasses` import, and replace the scale select's children

```tsx
        {Object.keys(SCALES).map((s) => (
          <option key={s} value={s}>
            {SCALES[s].name}
          </option>
        ))}
```

with

```tsx
        <ScaleTypeOptions />
```

Keep the `SCALES` import: the compact trigger's short label still reads `SCALES[scaleType]?.name`.

`src/components/song/KeyChangeDialog.tsx`: replace the first two import lines

```tsx
import { SCALES } from '@/data/scales';
import { Modal } from '@/components/ui/Modal';
```

with

```tsx
import { Modal } from '@/components/ui/Modal';
import { ScaleTypeOptions } from '@/components/ui/ScaleTypeOptions';
```

and in `SetKeyFields` replace

```tsx
        {Object.keys(SCALES).map((s) => <option key={s} value={s}>{SCALES[s].name}</option>)}
```

with

```tsx
        <ScaleTypeOptions />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/components/ui/ScaleTypeOptions.test.tsx src/components/Header.test.tsx src/components/song/KeyChangeDialog.test.tsx`
Expected: PASS (the existing width and `appearance-none` tests in `Header.test.tsx` still pass: an `<optgroup>` carries no classes).

- [ ] **Step 6: Lint**

Run: `bun run lint && bun run eslint && bun run check:dead-code`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/ScaleTypeOptions.tsx src/components/ui/ScaleTypeOptions.test.tsx \
  src/components/header/ScaleMenu.tsx src/components/song/KeyChangeDialog.tsx \
  src/components/Header.test.tsx src/components/song/KeyChangeDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(scales): group the scale selects by category

The header scale select and the key-change dialog share one
ScaleTypeOptions that renders an optgroup per category.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rules, ADR, skills and stale comments

Docs only; no counts, version numbers or line numbers in any of them (R001). ADRs are never rewritten (docs/decisions/README.md): the change to R061's rationale goes in a new ADR that amends ADR-0006, and ADR-0006 gets only a Status-line pointer, as ADR-0016 does for ADR-0048.

**Files:**
- Create: `docs/decisions/0053-derived-scale-intervals.md`
- Modify: `docs/decisions/0006-derived-degree-qualities-and-display-spelling.md` (Status section only)
- Modify: `docs/decisions/README.md` (index row)
- Modify: `.claude/rules/music-domain.md` (R061 line, its ADR reference line, Prohibited list)
- Modify: `.claude/rules/data-layer.md` (R058 example)
- Modify: `src/data/chordProgressions.ts` (`minScaleLength` doc), `src/data/vibes.ts` (`progressions` doc)
- Modify: `.claude/skills/music-theory/SKILL.md`, `.claude/skills/instant-vibes/SKILL.md`, `.claude/skills/instant-vibes/references/authoring-libraries.md`

**Interfaces:**
- Consumes: the names from Tasks 1-3 (`scaleSemitonesForTonal`, `SCALE_LIBRARY`, `ResolvedScale`, `scaleEntry`, `SCALE_CATEGORIES`, `ScaleTypeOptions`).
- Produces: nothing code-facing.

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0053-derived-scale-intervals.md`:

```markdown
# ADR-0053: Scale intervals are derived from tonal

**Status:** Accepted — 2026-09-26. Amends [ADR-0006](0006-derived-degree-qualities-and-display-spelling.md) (R061). No issue.

## Context

ADR-0006 kept `intervals` in `SCALES` as content a reviewer could check by eye, with a test
pinning each array to `tonal`. Every entry already named its `tonal` scale, so each scale's
intervals were stated twice, and the test existed only to keep the copies equal. Growing the
library to murva's scale list would have multiplied that duplication, and a reviewer cannot check a
Lydian Augmented or Locrian ♯2 array by eye any better than a chord-quality list.

## Decision

- `SCALES` states `name`, `description`, `category`, `tonal`, `tonality` and, for scales under
  seven degrees, a 7-note `parent`. It states no intervals and no chord qualities.
- `src/musicCore/tonalAdapter.ts`'s `scaleSemitonesForTonal` measures a tonal scale in semitones.
  `src/musicCore/scale.ts` resolves every entry once at module load into `SCALE_LIBRARY`
  (`ResolvedScale` = definition + derived `intervals`), and `scaleEntry` returns from it. A `tonal`
  name that does not resolve throws at load.
- Every interval read goes through `scaleEntry`; nothing indexes `SCALES[key].intervals`.
- A golden pin in `src/data/scales.test.ts` holds the interval arrays of the scales that were
  authored by hand, verbatim. A saved project names its scale by key, so those scales must keep
  sounding as they did; a `tonal` upgrade that moves one fails the pin.
- Names, descriptions, categories and order come from murva, because `tonal` has no mood or genre
  data. Existing keys are identities and stay; new keys are readable ASCII because the header's
  short label renders the key.

Rejected:

- **Keeping `intervals` as content.** Two sources for one fact, kept equal only by a test.
- **Deriving intervals at every call.** A `Scale.get` per lookup on paths the keyboard and
  pads call per render; resolving once at load costs nothing and fails fast.
- **Scales the `parent` mechanism cannot harmonize** (whole tone, diminished, bebop, double
  harmonic major, Hungarian minor, flamenco). They need their own harmony design; see the spec.

## Consequences

- Adding a scale is one `SCALES` entry naming a `tonal` scale; a scale whose derived chord tuple is
  missing from the quality tables fails the harmony invariant in `scales.test.ts`.
- `ScaleDefinition` has no `intervals`; consumers type against `ResolvedScale`.
- The characterization fixtures grow with the library; a legacy entry that changes is a
  behaviour change and must be explained.

## Rules this implies

- **R061** (amended) — `SCALES` states `name`, `description`, `category`, `tonal`, `tonality` and,
  for <7-degree scales, a 7-note `parent`; neither intervals (derived in `src/musicCore/scale.ts`,
  legacy intervals pinned by `src/data/scales.test.ts`) nor chord qualities.

## Sources

Spec: [`docs/superpowers/specs/2026-09-26-scale-library-design.md`](../superpowers/specs/2026-09-26-scale-library-design.md)
(commit `201994a4`). Plan: `docs/superpowers/plans/2026-09-26-scale-library.md`. Murva:
`murva-app/shared/src/music/musicUtils.ts`, `SUPPORTED_SCALES`.
```

- [ ] **Step 2: Point ADR-0006 and the index at it**

In `docs/decisions/0006-derived-degree-qualities-and-display-spelling.md`, replace the Status body line

```markdown
Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).
```

with

```markdown
Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425). R061 amended by
[0053](0053-derived-scale-intervals.md): `SCALES` no longer states intervals; they are derived
from `tonal` in Music Core.
```

In `docs/decisions/README.md`, add after the `[0052]` row:

```markdown
| [0053](0053-derived-scale-intervals.md) | Scale intervals are derived from tonal | `SCALES` states name, description, category, `tonal`, tonality and parent; Music Core derives intervals once at load; a golden pin keeps the legacy scales' intervals; amends ADR-0006's R061. |
```

- [ ] **Step 3: Update the rules files**

`.claude/rules/music-domain.md`:
- Replace the R061 bullet with:
  ```markdown
  - `SCALES` states `name`, `description`, `category`, `tonal`, `tonality` and, for scales under seven degrees, a 7-note `parent`; it states neither intervals — `src/musicCore/scale.ts` derives them from `tonal` once at load, and `src/data/scales.test.ts` pins the legacy scales' intervals — nor chord qualities. <!-- R061 -->
  ```
- Replace the section's reference line `([ADR-0006](../../docs/decisions/0006-derived-degree-qualities-and-display-spelling.md))` (the one closing "Degree qualities and spelling") with:
  ```markdown
  ([ADR-0006](../../docs/decisions/0006-derived-degree-qualities-and-display-spelling.md), [ADR-0053](../../docs/decisions/0053-derived-scale-intervals.md))
  ```
- In `## Prohibited`, replace `- Chord qualities or override fields in \`SCALES\` <!-- R061 --> <!-- R063 -->` with:
  ```markdown
  - Intervals, chord qualities or override fields in `SCALES`, or reading `SCALES[key].intervals` instead of `scaleEntry(key).intervals` <!-- R061 --> <!-- R063 -->
  ```

`.claude/rules/data-layer.md`, R058 bullet: `(\`musicTheory.ts\` imports \`SCALES\`)` → `(\`noteSpelling.ts\` imports \`SCALES\`)` — `musicTheory.ts` no longer imports it after Task 1.

- [ ] **Step 4: Fix the stale data comments**

`src/data/chordProgressions.ts`, the `minScaleLength` doc:

```ts
  /** Shortest scale this is valid in: the degree count of referenceScale
   *  (`scaleEntry(referenceScale).intervals.length`). 5 works in every
   *  5-note scale; 7 needs a full 7-note scale. */
  minScaleLength: number;
```

`src/data/vibes.ts`, in `VibeRandomRule.progressions`' doc, replace

```ts
   * Two invariants hold for every member: `minScaleLength <=
   * SCALES[scaleType].intervals.length`, and `referenceScale === scaleType`.
```

with

```ts
   * Two invariants hold for every member: `minScaleLength <=
   * scaleEntry(scaleType).intervals.length`, and `referenceScale === scaleType`.
```

- [ ] **Step 5: Update the skills**

`.claude/skills/music-theory/SKILL.md`:
- Replace the paragraph's opening
  ```markdown
  `SCALES` states `intervals` (a literal a reader can check by eye, pinned to `tonal` by
  `src/data/scales.test.ts`), the `tonal` scale name that spells it, its `tonality` spelling
  convention, and — for scales with fewer than seven degrees — the 7-note `parent` whose harmony it
  borrows. Per-degree chord qualities are **derived**, not stated:
  ```
  with
  ```markdown
  `SCALES` states a display `name`, a one-line `description`, a `category`, the `tonal` scale name
  that spells and measures it, its `tonality` spelling convention, and — for scales with fewer than
  seven degrees — the 7-note `parent` whose harmony it borrows. Intervals are **derived**:
  `src/musicCore/scale.ts` resolves each `tonal` name once at load, and `scaleEntry(key).intervals`
  is the only way to read them (`src/data/scales.test.ts` pins the legacy scales' intervals).
  Per-degree chord qualities are **derived** too, not stated:
  ```
- Replace the key list and loop advice
  ```markdown
  `Major`, `Natural Minor`, `Harmonic Minor`, `Dorian`, `Mixolydian`, `Lydian`, `Phrygian`,
  `Minor Pentatonic`, `Major Pentatonic`, `Blues`, `Hirajoshi`. Pentatonic/Blues/Hirajoshi have 5–6
  degrees, so never assume 7 — loop `SCALES[scaleType].intervals.length` (unknown key falls back to
  `Major`, which is how `'Pentatonic Major'` ran as Major for months without anyone hearing it).
  `Hirajoshi` is `[0, 2, 3, 7, 8]` with `parent: 'Natural Minor'` — a strict subset of it at degrees
  ```
  with
  ```markdown
  The keys are `Object.keys(SCALES)` in `src/data/scales.ts`, grouped by `SCALE_CATEGORIES`. The
  pentatonic, blues and world scales have 5–6 degrees, so never assume 7 — loop
  `scaleEntry(scaleType).intervals.length` (unknown key falls back to `Major`, which is how
  `'Pentatonic Major'` ran as Major for months without anyone hearing it).
  `Hirajoshi` is `[0, 2, 3, 7, 8]` with `parent: 'Natural Minor'` — a strict subset of it at degrees
  ```
- In "Where key/scale live", replace
  ```markdown
  `header/ScaleMenu.tsx` renders the pickers from `ROOTS` / `Object.keys(SCALES)`. The sequencer is **not**
  ```
  with
  ```markdown
  `header/ScaleMenu.tsx` renders the pickers from `KEY_OPTIONS` / `ui/ScaleTypeOptions.tsx` (one optgroup
  per category). The sequencer is **not**
  ```
- `` `approachDiatonicUp` walks to the next scale degree above via `SCALES[scaleType].intervals`. `` → `` `approachDiatonicUp` walks to the next scale degree above via `scaleEntry(scaleType).intervals`. ``

`.claude/skills/instant-vibes/SKILL.md`: `` `minScaleLength <= SCALES[vibe.scaleType].intervals.length` `` → `` `minScaleLength <= scaleEntry(vibe.scaleType).intervals.length` ``.

`.claude/skills/instant-vibes/references/authoring-libraries.md`: `minScaleLength: 7,           // SCALES[referenceScale].intervals.length` → `minScaleLength: 7,           // scaleEntry(referenceScale).intervals.length`.

- [ ] **Step 6: Verify nothing stale remains**

Run: `grep -rnE "SCALES\[[^]]+\]\??\.intervals" src scripts .claude/skills`
Expected: no output. (The rules file and ADR-0053 name `SCALES[key].intervals` on purpose, as the prohibited form, so they are not searched.)
Run: `grep -rnE "World & Exotic|Major \(Ionian\)|Blues Scale" src scripts .claude docs/decisions`
Expected: no output.
Run: `grep -nE "[0-9]+ scales|eleven|twenty" .claude/rules/music-domain.md docs/decisions/0053-derived-scale-intervals.md`
Expected: no output (R001).
Run: `bun run lint && bun run eslint`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add docs/decisions/0053-derived-scale-intervals.md docs/decisions/0006-derived-degree-qualities-and-display-spelling.md \
  docs/decisions/README.md .claude/rules/music-domain.md .claude/rules/data-layer.md \
  src/data/chordProgressions.ts src/data/vibes.ts .claude/skills/music-theory/SKILL.md \
  .claude/skills/instant-vibes/SKILL.md .claude/skills/instant-vibes/references/authoring-libraries.md
git commit -m "$(cat <<'EOF'
docs(scales): record derived scale intervals in R061 and ADR-0053

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Final: completion gate

- [ ] **Step 1: Run the gate**

Run: `bun run verify`
Expected: every stage passes — tests (0 fail), `tsc`, `eslint`, `check:keys`, `check:drums`, `check:contrast`, `check:levels`, both Knip scans, and the Vite build.

- [ ] **Step 2: Confirm zero ESLint warnings and a quiet build**

Run: `bun run eslint`
Expected: prints only `$ eslint .` — zero errors and zero warnings. Any warning is fixed, or disabled on its line with `// eslint-disable-next-line <rule> -- <reason>`; never relax a rule globally (R264).
Run: `bun run build 2>&1 | grep -iE "warn|\(!\)"`
Expected: no output.

- [ ] **Step 3: Report**

State each warning met and its decision (fixed / line-disabled with reason). If the gate needed a fix, commit it with a message naming what it fixed, ending with the Co-Authored-By line.

## Self-review notes

- Spec coverage: data shape (T2), derivation + throw at load (T1), `parentDegreesFor` via `scaleEntry` (T1), 24 scales with parents/tonality (T2), renamed display names (T2), optgroups in both selects (T3), R061 + Prohibited + ADR + stale comments (T4), golden pin / invariants / harmony / sanitize / render tests (T1-T3), persist version unchanged (no task touches it).
- Spec deviation, deliberate: "ADR-0006 is updated" is done as a new ADR-0053 that amends it plus a Status-line pointer, because docs/decisions/README.md forbids rewriting an accepted ADR's decision.
- Spec clarification: "an unknown key still falls back to Major" holds for `scaleEntry`/`resolveScaleKey`; `sanitizeLoops` falls back to the default loop's scale (today `Natural Minor`), which is existing behaviour and what the sanitize test pins.
