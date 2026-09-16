# DEV-398: Route Every Notation Surface Through Music Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every contextual chord/note/key label renders through the same key-aware display-spelling API, dynamic scale-degree Roman numerals are built by one canonical, reusable derivation instead of a duplicated local array, and every factory progression's authored `roman` summary is mechanically checked against its actual degree/quality/reference-scale data instead of only being checked for non-emptiness.

**Architecture:** Three independent fix clusters, in dependency order: (1) two small UI call sites that still render canonical-sharp text instead of passing their already-available `spellingKey` through — pure bug fixes, no design decisions; (2) a Roman-numeral **construction** helper, extracted from `getDiatonicChordForDegree` into a public, testable function that ALSO learns to place `b`/`#` accidentals correctly for 7-degree modal/minor scales (a real behavior improvement, not just a refactor) — everything reusing `degreeName` (the chord-picker degree buttons, the pad-panel drone buttons) benefits automatically; (3) a Roman-numeral **validator** built on top of (2), run once against the 44 factory progressions to find and fix any authored `roman` string that contradicts its own step data.

**Tech Stack:** TypeScript, Bun test runner, no DOM/testing-library (see `.claude/rules/testing.md` — this repo's tests are pure-logic + `renderToString` string-matching only).

**Spec:** Linear DEV-398 (`https://linear.app/pathompong-thitithan/issue/DEV-398`), the app-wide DEV-380/DEV-395 canonical-identity vs. display-spelling boundary documented in `CLAUDE.md` (search "canonical-identity", "display-spelling"), and `work/dev398-notation-survey.md` (this plan's research artifact — UI surface inventory, current Roman-numeral implementation, current progression data).

## Global Constraints

- **Never persist, compute from, or compare against a display-spelled value.** Every fix in this plan touches only the RENDER path — a component's JSX — never a value that is stored, matched, or fed into another derivation. (DEV-380's existing rule; restated because Tasks 1 and 2 both touch render call sites.)
- **`src/utils/musicTheory.ts` may import `@/musicCore` and `@/data/scales`; nothing in `src/musicCore/` or `src/data/` may import back.** The new Roman-numeral helper in Task 2 stays in `musicTheory.ts` (same layer as the `resolveDegreeQuality`/`getDiatonicChordForDegree` it sits beside) — it is NOT a Music Core function, because it needs `SCALES` (a `src/data/` table `src/musicCore/` may not read) to compare a scale's own intervals against Major's. Do not attempt to move it into `src/musicCore/`.
- **A chord's ROMAN CASE always reflects its actual resolved quality, not the scale's plain diatonic quality at that degree.** A `ProgressionStep.quality` override (a secondary dominant, a borrowed major triad on a normally-minor degree) changes the numeral's case. `getDiatonicChordForDegree`'s own `quality` return is always the plain diatonic one — Task 2's helper takes quality as an explicit parameter precisely so callers (the validator in Task 4) can pass the OVERRIDE quality when one exists.
- **The Roman-numeral quality SUFFIX (`m7`, `maj9`, `sus2`, …) is editorial, not mechanically validated.** The 44 factory progressions already contain deliberate simplifications (a `7sus4` step written as plain `V7`; a `min9` step's `V` cadence written with no suffix at all). Task 4's validator checks the numeral's letters, case and accidental only — never the trailing suffix text. Do not add a "suffix must be present/absent" check; it was tried during this plan's research and produces false failures against real, intentional authoring choices.
- **Only `CHORD_PROGRESSIONS` (factory data) is validated — a user's own saved custom progression's `roman` field is never touched, checked, or rewritten.** `ChordPresetLibrary.tsx`'s custom-progression save path (Task 1, Step 4) only changes what DEFAULT text pre-fills the roman field when the user has typed nothing of their own (`draft.roman?.trim() ? draft.roman : ...`) — a user's own typed text always wins and is never validated or reformatted, satisfying the AC that free-form user annotations are not rewritten as if they were derived notation.
- **This plan does not add spelling to any surface that is deliberately chromatic/key-agnostic.** The survey (`work/dev398-notation-survey.md` §1) found no surface currently in the wrong direction (i.e. none that should stay canonical-sharp but has been made key-aware) — Tasks 1/2/3/4 only fix surfaces that SHOULD already be key-aware per DEV-380 but weren't. The final review (below) re-confirms this stayed true.
- **`bun run verify` is the completion gate for every task** (tests, tsc, eslint, domain checks, both Knip scans, production build) — run it before any task is marked done, not a scoped subset. (Standing lesson from DEV-399: a scoped verification command missed a real regression there.)

---

### Task 1: Fix the two UI surfaces still rendering canonical-sharp text

**Files:**
- Modify: `src/components/song/SortableLoopCard.tsx:308-357` (`LoopChordStripProps`, `LoopChordStrip`) and its call site at `:739-744` (inside `LoopCardMetaRow`)
- Modify: `src/components/loop/ChordPresetLibrary.tsx:276-279` (inside `useChordLibraryCommands`'s `handleSave`)
- Test: `src/components/song/SortableLoopCard.test.tsx` (create if it does not exist — check first with `ls src/components/song/*.test.tsx`)

**Interfaces:**
- Consumes: `formatChordLabel(root: string, quality: string, key?: SpellingKey): string` and `spellNoteInKey(note: string, rootNote: string, scaleType: string): string` from `@/utils/musicTheory` / `@/utils/noteSpelling` (both already imported elsewhere in this repo — confirm the exact re-export path each file already uses for its neighbors before adding a new import).
- Produces: no signature change to any exported function — this task only changes what arguments existing calls pass.

**Context:** `work/dev398-notation-survey.md` §1 has the full 12-surface inventory. These are the only two non-compliant/partial ones; everything else (playback indicator, chord editor, preset library's factory-progression preview, chord grid, keyboard, key picker) already passes a `spellingKey`/`{scaleRoot, scaleType}` through and needs no change.

- [ ] **Step 1: Read the current `LoopChordStrip` and its call site**

Read `src/components/song/SortableLoopCard.tsx:308-357` (the component) and `:680-748` (`LoopCardMetaRow`, which has `loop.scaleRoot`/`loop.scaleType` in scope already but does not pass them down).

- [ ] **Step 2: Thread a `spellingKey` into `LoopChordStripProps` and use it**

```typescript
interface LoopChordStripProps {
  chords: ChordItem[] | undefined;
  chordOctave: number;
  isPlaying: boolean;
  activeChordIndex: number | null;
  spellingKey: SpellingKey;
}

function LoopChordStrip({ chords, chordOctave, isPlaying, activeChordIndex, spellingKey }: LoopChordStripProps) {
  if (!chords || chords.length === 0) {
    return <span className="text-base-content/40 italic">No chords</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {chords.map((chord, cIdx) => {
        const isChordActive = isPlaying && cIdx === activeChordIndex;
        const notes = generateBlockChordNotes(chord.quality, chord.root, chordOctave)
          .map((n) => spellNoteInKey(n, spellingKey.scaleRoot, spellingKey.scaleType));
        return (
          <span
            key={chord.id || `${chord.root}-${cIdx}`}
            className={`badge badge-sm gap-1 transition-all duration-150 ${
              isChordActive
                ? 'badge-primary font-bold ring-2 ring-primary/60 shadow-sm scale-105'
                : 'bg-base-200 border border-base-300'
            }`}
            title={notes.length ? `Notes: ${notes.join(', ')}` : undefined}
          >
            <span
              className={
                isChordActive ? 'text-primary-content font-bold' : 'font-bold text-base-content'
              }
            >
              {formatChordLabel(chord.root, chord.quality, spellingKey)}
            </span>
            <span
              className={`text-[9px] ${
                isChordActive ? 'text-primary-content/80' : 'text-base-content/50'
              }`}
            >
              {`${chord.bars ?? 1}b`}
            </span>
          </span>
        );
      })}
    </div>
  );
}
```

Add `formatChordLabel` and `spellNoteInKey` to this file's existing import block (check what it already imports from `@/utils/musicTheory` / `@/utils/noteSpelling` first — likely `getTonicSpelling` is already imported from `noteSpelling`, so add `spellNoteInKey` to that same import). Remove `formatChordQuality` from the import list if `LoopChordStrip` was its only user in this file (check with `grep -n formatChordQuality src/components/song/SortableLoopCard.tsx` after the edit — Knip's dead-import scan will also catch a leftover).

- [ ] **Step 3: Pass the key from the call site**

In `LoopCardMetaRow` (around line 739), change:

```typescript
        <LoopChordStrip
          chords={loop.chords}
          chordOctave={loop.chordOctave}
          isPlaying={isPlaying}
          activeChordIndex={activeChordIndex}
        />
```

to:

```typescript
        <LoopChordStrip
          chords={loop.chords}
          chordOctave={loop.chordOctave}
          isPlaying={isPlaying}
          activeChordIndex={activeChordIndex}
          spellingKey={{ scaleRoot: loop.scaleRoot, scaleType: loop.scaleType }}
        />
```

- [ ] **Step 4: Fix `ChordPresetLibrary.tsx`'s missing `spellingKey`**

In `useChordLibraryCommands`'s `handleSave` (around line 276-279), change:

```typescript
      draft.roman?.trim()
        ? draft.roman
        : currentChords.map((c) => formatChordLabel(c.root, c.quality)).join(' → ')
```

to:

```typescript
      draft.roman?.trim()
        ? draft.roman
        : currentChords.map((c) => formatChordLabel(c.root, c.quality, spellingKey)).join(' → ')
```

`spellingKey` is already constructed earlier in this same function (`const spellingKey: SpellingKey = { scaleRoot, scaleType };`) — no new variable needed.

- [ ] **Step 5: Regression test proving the loop card now agrees with the playback indicator**

Create (or extend) `src/components/song/SortableLoopCard.test.tsx`. This repo has no DOM/testing-library (`.claude/rules/testing.md`), so assert directly against the exact function + arguments `LoopChordStrip` now calls (per Step 2), using the SAME enharmonic-sensitive case `noteSpelling.test.ts` already pins as correct (`src/utils/noteSpelling.test.ts:72-76`: Bb Major's IV, chroma 3, spells as `Eb` — never the canonical-sharp `D#`):

```typescript
import { describe, expect, test } from 'bun:test';
import { formatChordLabel } from '@/utils/musicTheory';
import { spellNoteInKey } from '@/utils/noteSpelling';

describe('loop card chord spelling matches every other DEV-380-compliant surface', () => {
  test('Bb Major\'s IV renders as Eb, not the canonical-sharp D#', () => {
    // Same fixture noteSpelling.test.ts already pins: spellPitchClassInKey(3, 'A#', 'Major') -> 'Eb'.
    const key = { scaleRoot: 'A#', scaleType: 'Major' }; // Bb Major; ROOTS-spelled tonic is A#
    expect(formatChordLabel('D#', 'maj', key)).toBe('Eb'); // the exact call LoopChordStrip now makes
    expect(formatChordLabel('D#', 'maj')).toBe('D#'); // the OLD, buggy call — proves the fix changed something
  });

  test('the chord tooltip spells each note the same way', () => {
    const key = { scaleRoot: 'A#', scaleType: 'Major' };
    expect(spellNoteInKey('D#', key.scaleRoot, key.scaleType)).toBe('Eb');
  });
});
```

- [ ] **Step 6: Run and verify**

```bash
bun test src/components/song/SortableLoopCard.test.tsx src/components/loop/ChordPresetLibrary.test.tsx
bun run verify
```

- [ ] **Step 7: Commit**

```bash
git add src/components/song/SortableLoopCard.tsx src/components/loop/ChordPresetLibrary.tsx src/components/song/SortableLoopCard.test.tsx
git commit -m "fix(notation): spell Song loop card chords and preset-save roman default in key"
```

---

### Task 2: Extract a canonical, testable `degreeToRoman` — accidentals included

**Files:**
- Modify: `src/utils/musicTheory.ts:270-334` (`resolveDegreeQuality`, `getDiatonicChordForDegree`)
- Test: `src/utils/musicTheory.test.ts:150-200` (the existing `getDiatonicChordForDegree` describe block)

**Interfaces:**
- Consumes: `SCALES: Record<string, ScaleDefinition>` from `@/data/scales` (already imported in this file), `MINOR_THIRD_QUALITIES: ReadonlySet<ChordQuality>` (already defined in this file), `resolveScaleKey(scaleType: string): string` from `@/musicCore` (already imported).
- Produces: `export function degreeToRoman(scaleType: string, normDegree: number, quality: ChordQuality): string` — a NEW public export. `getDiatonicChordForDegree`'s return shape is unchanged; its `degreeName` field's VALUE changes for 7-degree non-Major scales (see Step 4 — this is an intentional correctness fix, not a regression).

**Context:** Today `getDiatonicChordForDegree` builds a `ROMAN_NUMERALS` array and a lowercase-if-minor rule INLINE, on every call, with no accidental support at all — a Mixolydian `bVII` or a Lydian `#IV` currently renders as plain `VII`/`IV`. This is exactly the "local Roman-numeral array" the Linear issue calls out. `padPanel.ts`'s drone-degree buttons and `ProgressionCard.tsx`'s chord-picker degree labels both read `getDiatonicChordForDegree(...).degreeName` and will automatically start showing correct accidentals once this task lands — no change needed in either of those two files.

**Accidental rule (derived from the 44 factory progressions' own authored `roman` fields — see `work/dev398-notation-survey.md` §3 and this task's own research):** compare the active scale's `intervals[normDegree]` against **Major**'s interval at the same position (`[0, 2, 4, 5, 7, 9, 11]`). A difference of `-1` semitone is `b`, `+1` is `#`, `0` is no accidental. This reproduces the standard convention this app's own data already uses: Mixolydian's `bVII`, Lydian's `#IV`, Natural Minor's `bVI`/`bVII`. **Two carve-outs, both empirically confirmed against the corpus:**
1. **The THIRD degree (`normDegree === 2`) never gets an accidental**, even when it differs from Major (Natural Minor's mediant is conventionally just `III`, never `bIII` — common-practice convention: there is no competing raised form of the mediant to distinguish it from, unlike VI/VII which distinguish natural- from harmonic/melodic-minor forms). Confirmed against TWO independent Natural Minor progressions in the data (`cine-epic-ostinato`, `baroque-passacaglia`), both showing plain `III`.
2. **Scales with fewer than 7 degrees get no accidentals at all** — a position-by-position comparison against a 7-note Major scale is not meaningful for a 5-note scale (Hirajoshi, both Pentatonic scales) or a 6-note one (Blues). Confirmed: all 4 Hirajoshi progressions in the data use plain numerals only, despite Hirajoshi's intervals differing from Major's at every comparable position.

- [ ] **Step 1: Write the failing tests for `degreeToRoman`**

Add to `src/utils/musicTheory.test.ts`, inside (or beside) the existing `getDiatonicChordForDegree` describe block:

```typescript
describe('degreeToRoman', () => {
  test('plain numeral, case from quality, no accidental in Major', () => {
    expect(degreeToRoman('Major', 0, 'maj')).toBe('I');
    expect(degreeToRoman('Major', 5, 'min')).toBe('vi');
  });

  test('Mixolydian flats the seventh degree', () => {
    expect(degreeToRoman('Mixolydian', 6, 'maj')).toBe('bVII');
  });

  test('Lydian sharps the fourth degree', () => {
    // degreeToRoman returns the numeral only — the m7b5 suffix is the
    // caller's job (formatChordQuality), not this function's.
    expect(degreeToRoman('Lydian', 3, 'm7b5')).toBe('#iv');
    expect(degreeToRoman('Lydian', 3, 'min')).toBe('#iv');
  });

  test('Natural Minor flats VI and VII but never the mediant', () => {
    expect(degreeToRoman('Natural Minor', 5, 'maj')).toBe('bVI');
    expect(degreeToRoman('Natural Minor', 6, 'maj')).toBe('bVII');
    expect(degreeToRoman('Natural Minor', 2, 'maj')).toBe('III'); // the carve-out
  });

  test('Harmonic Minor flats VI but the raised leading tone needs no accidental', () => {
    expect(degreeToRoman('Harmonic Minor', 5, 'maj')).toBe('bVI');
    expect(degreeToRoman('Harmonic Minor', 4, 'maj')).toBe('V'); // raised 7th makes the dominant major, no accidental
  });

  test('a scale with fewer than 7 degrees never gets an accidental', () => {
    expect(degreeToRoman('Hirajoshi', 2, 'min')).toBe('iii');
    expect(degreeToRoman('Hirajoshi', 4, 'maj')).toBe('V');
  });

  test('an explicit quality override changes the case, independent of the diatonic default', () => {
    // Major's iii is diatonically minor; a secondary-dominant override makes it major-quality.
    expect(degreeToRoman('Major', 2, '7')).toBe('III');
  });
});
```

- [ ] **Step 2: Run it — confirm `degreeToRoman` does not exist yet**

Run: `bun test src/utils/musicTheory.test.ts -t "degreeToRoman"`
Expected: FAIL — `degreeToRoman is not a function` (or a TS error, since it isn't exported yet).

- [ ] **Step 3: Implement `degreeToRoman`**

Add above `getDiatonicChordForDegree` in `src/utils/musicTheory.ts`:

```typescript
/** Major-scale reference intervals, degree-index 0-6. Accidentals below are
 *  relative to THIS, never to the active scale's own parent. */
const MAJOR_REFERENCE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

/**
 * A degree's Roman-numeral label — accidental, numeral and case, no quality
 * suffix (the caller appends `formatChordQuality(quality)` itself, the same
 * pairing `formatChordLabel` uses for a spelled root: this function is that
 * function's Roman-numeral counterpart).
 *
 * Case comes from the chord's own third (`MINOR_THIRD_QUALITIES`) — the same
 * test `formatChordLabel` and `getDiatonicChordForDegree`'s return already
 * use — so a step with an explicit `ProgressionStep.quality` override still
 * gets the numeral its ACTUAL chord implies, not the scale's plain diatonic
 * one.
 *
 * Accidentals name a degree that differs from the identically-numbered
 * Major-scale degree — the standard way to describe a mode's colour relative
 * to its parent (Mixolydian's b7, Lydian's #4, Phrygian's b2/b3/b6/b7).
 * Degree index 2 (the mediant) is a deliberate exception: common practice
 * never marks a minor key's relative-major mediant (`III`, not `bIII`) —
 * there is no competing raised form to distinguish it from, unlike VI/VII,
 * which distinguish the natural- and harmonic/melodic-minor forms. A scale
 * with fewer than 7 degrees has no meaningful position-by-position
 * comparison against a 7-note Major scale, so it never gets an accidental.
 */
export function degreeToRoman(scaleType: string, normDegree: number, quality: ChordQuality): string {
  const resolvedType = resolveScaleKey(scaleType);
  const scale = SCALES[resolvedType];
  const numDegrees = scale.intervals.length;

  const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const rawNumeral = ROMAN_NUMERALS[normDegree] || `${normDegree + 1}`;

  const accidental =
    numDegrees === 7 && normDegree !== 2
      ? romanAccidental(scale.intervals[normDegree] - MAJOR_REFERENCE_INTERVALS[normDegree])
      : '';

  const numeral = accidental + rawNumeral;
  return MINOR_THIRD_QUALITIES.has(quality) ? numeral.toLowerCase() : numeral;
}

function romanAccidental(semitoneDiff: number): string {
  if (semitoneDiff === -1) return 'b';
  if (semitoneDiff === 1) return '#';
  if (semitoneDiff === 0) return '';
  throw new Error(`Unrepresentable Roman-numeral accidental: ${semitoneDiff} semitones`);
}
```

- [ ] **Step 4: Wire `getDiatonicChordForDegree` to call it, deleting the inline array**

```typescript
export function getDiatonicChordForDegree(
  degreeIndex: number,
  root: string,
  scaleType: string,
  use7ths = false
): { root: string; quality: ChordQuality; degreeName: string } {
  const rootIndex = rootSemitone(root);
  const resolvedType = resolveScaleKey(scaleType);
  const scale = SCALES[resolvedType];
  const numDegrees = scale.intervals.length;

  const normDegree = ((degreeIndex % numDegrees) + numDegrees) % numDegrees;
  const semitoneOffset = scale.intervals[normDegree];
  const chordRoot = ROOTS[(rootIndex + semitoneOffset) % 12];

  const quality = resolveDegreeQuality(resolvedType, normDegree, use7ths);
  const degreeName = degreeToRoman(scaleType, normDegree, quality);

  return {
    root: chordRoot,
    quality,
    degreeName,
  };
}
```

Delete the old inline `ROMAN_NUMERALS`/`isMinor`/`rawNumeral` lines this replaces.

- [ ] **Step 5: Run the new tests, then the existing suite**

```bash
bun test src/utils/musicTheory.test.ts
```
Expected: all PASS, including the pre-existing Hirajoshi `getDiatonicChordForDegree` test (unaffected — Hirajoshi has 5 degrees, so no accidental logic engages).

- [ ] **Step 6: Regenerate the characterization-lock fixture, review the diff**

```bash
bun run scripts/gen-diatonic-characterization.ts > src/utils/diatonicCharacterizationFixture.ts
git diff src/utils/diatonicCharacterizationFixture.ts
```

Confirm by eye: every changed line belongs to a 7-degree NON-Major scale (Natural Minor, Harmonic Minor, Dorian, Mixolydian, Lydian, Phrygian) and only ever adds a `b`/`#` immediately before a `VI`, `VII`, or `IV` numeral (never before `III`, never for Major/Pentatonic/Blues/Hirajoshi rows, which must show ZERO diff). If ANY Major, Pentatonic, Blues or Hirajoshi row changed, or any `III` row gained an accidental, STOP — the implementation has a bug; do not proceed past this step until the diff matches this description exactly.

- [ ] **Step 7: Fix drift in downstream tests**

```bash
bun test src/utils/diatonicCharacterization.test.ts src/components/loop/chord/padPanel.test.ts
```
`padPanel.test.ts`'s "a seven-degree scale renders seven buttons with roman labels" test may assert exact label strings for a modal scale — if it now fails, update its expected strings to match the corrected (more accurate) accidentals; do not change the production code to make the old, wrong labels reappear.

- [ ] **Step 8: Full gate**

```bash
bun run verify
```

- [ ] **Step 9: Commit**

```bash
git add src/utils/musicTheory.ts src/utils/musicTheory.test.ts src/utils/diatonicCharacterizationFixture.ts src/components/loop/chord/padPanel.test.ts
git commit -m "refactor(theory): extract degreeToRoman, add scale-relative accidentals

getDiatonicChordForDegree's degreeName now names a mode's colour correctly
(Mixolydian bVII, Lydian #IV, Natural/Harmonic Minor bVI/bVII) instead of a
plain I-VII table with no accidental support at all. The mediant (degree
index 2) is a deliberate carve-out per common-practice convention, and
scales under 7 degrees never gain one. Every dynamic degree-name reader
(padPanel's drone buttons, ProgressionCard's chord-picker labels) improves
for free.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP"
```

---

### Task 3: Validate factory progression `roman` summaries against their step data

**Files:**
- Modify: `src/audio/chordProgressions.test.ts:15` (replace the length-only assertion)
- Modify: `src/data/chordProgressions.ts` — fix any `roman` string the validator finds genuinely wrong (expect at least one: see Step 4 below)

**Interfaces:**
- Consumes: `degreeToRoman(scaleType, normDegree, quality)` from Task 2; `getDiatonicChordForDegree`, `resolveDegreeQuality` from `@/utils/musicTheory`; `CHORD_PROGRESSIONS`, `ProgressionStep` shape from `@/data/chordProgressions`.
- Produces: no new exports — this is a test-only change plus data corrections.

**Validator design (read this before writing code — it is deliberately NOT exact-string matching):**
1. Split `progression.roman` on `' – '` (en dash, one space each side — every one of the 44 entries already uses this separator consistently; assert the split length equals `progression.steps.length` as the first check).
2. For step `i` at `progressionStep.degree`: `normDegree = ((degree % numDegrees) + numDegrees) % numDegrees` where `numDegrees = SCALES[resolveScaleKey(progression.referenceScale)].intervals.length`. Resolved quality = `progressionStep.quality ?? getDiatonicChordForDegree(degree, ANY_ROOT, referenceScale, false).quality` (root doesn't matter for quality — pass any fixed root, e.g. `'C'`). Expected leading numeral = `degreeToRoman(referenceScale, normDegree, resolvedQuality)`.
3. Extract the authored token's own leading numeral via `token.match(/^[b#]?[IViv]+/)` — this captures the FULL greedy run of accidental+roman letters, so `'VI'` is never mistaken for a prefix-match of `'V'`. Assert the match exists and `match[0] === expectedNumeral` EXACTLY (case-sensitive).
4. Do NOT validate anything after the numeral match (the quality suffix) — see this plan's Global Constraints.

```typescript
import { degreeToRoman, getDiatonicChordForDegree, resolveDegreeQuality } from '@/utils/musicTheory';
import { SCALES } from '@/data/scales';
import { resolveScaleKey } from '@/musicCore';

function expectedRomanNumeral(referenceScale: string, degree: number, quality: ChordQuality | undefined): string {
  const resolvedType = resolveScaleKey(referenceScale);
  const numDegrees = SCALES[resolvedType].intervals.length;
  const normDegree = ((degree % numDegrees) + numDegrees) % numDegrees;
  const resolvedQuality = quality ?? getDiatonicChordForDegree(degree, 'C', referenceScale, false).quality;
  return degreeToRoman(referenceScale, normDegree, resolvedQuality);
}

describe('CHORD_PROGRESSIONS roman summaries match their step data', () => {
  for (const progression of CHORD_PROGRESSIONS) {
    test(`${progression.id}: roman numerals match degree/quality/referenceScale`, () => {
      const tokens = progression.roman.split(' – ');
      expect(tokens.length).toBe(progression.steps.length);
      progression.steps.forEach((step, i) => {
        const expected = expectedRomanNumeral(progression.referenceScale, step.degree, step.quality);
        const match = tokens[i].match(/^[b#]?[IViv]+/);
        expect(match).not.toBeNull();
        expect(match![0]).toBe(expected);
      });
    });
  }
});
```

This REPLACES the old `expect(p.roman.length).toBeGreaterThan(0);` line inside the existing `describe('CHORD_PROGRESSIONS structure')` block — keep it as a new, separate `describe` block instead of folding it into the old one, since it is a materially different kind of check.

- [ ] **Step 1: Write the validator exactly as specified above**

Add it to `src/audio/chordProgressions.test.ts`. Import `ChordQuality` type from `@/musicCore` if not already imported in this file.

- [ ] **Step 2: Run it and read every failure**

```bash
bun test src/audio/chordProgressions.test.ts -t "roman numerals match"
```

Expect at least one failure: this plan's own research (cross-checking the data by hand before writing this plan) found `baroque-passacaglia`'s roman `'i – iv – VII – III – VI – iio – V – i'` has `step(5)` (its 5th token, `'VI'`) where the derivation predicts `'bVI'` — every OTHER Natural Minor progression in the corpus that reaches degree 5 (`rock-andalusian`, `cine-epic-ostinato`) already writes `bVI`. Treat this one as a very likely genuine typo to fix, but verify it yourself against the failure output rather than trusting this note blindly — this plan's hand-derivation could itself be wrong.

- [ ] **Step 3: Reconcile every failure**

For each failing progression, decide (and record the reasoning in the commit message or a code comment if the reasoning is non-obvious):
- **Most likely:** the authored `roman` string has a genuine mismatch — fix the string in `src/data/chordProgressions.ts` to match the derived numeral. This is the expected, common case (see Step 2's example).
- **If a mismatch instead reveals `degreeToRoman`'s rule is wrong for a case this plan's research did not anticipate:** that is a real finding — do not silently work around it in the data. Stop, re-examine the rule (Task 2's accidental logic and the mediant carve-out), fix the RULE if it is genuinely wrong, re-run Task 2's own test suite to confirm nothing there regresses, then re-run this task's validator. Record the ruling (what changed and why) — this is exactly the kind of judgment call this epic's standing authorization expects you to make and log, not stall on.
- Never adjust the VALIDATOR to special-case a specific progression `id` — every exception belongs in `degreeToRoman`'s general rule (Task 2) or the data, never in this test file.

- [ ] **Step 4: All 44 pass**

```bash
bun test src/audio/chordProgressions.test.ts
```
Expected: PASS, all progressions, including the pre-existing tests in this file (`resolveProgression`, the vibe-progression checks) unaffected by the data fixes (a `roman` string correction never changes `steps`, `degree`, or `quality` — only the display text).

- [ ] **Step 5: Full gate**

```bash
bun run verify
```

- [ ] **Step 6: Commit**

Commit the test file and any data fixes TOGETHER — splitting them leaves an intermediate commit whose test contradicts its own data (same reasoning as the precedent in `docs/superpowers/plans/2026-09-07-music-theory-derivation.md`'s Task 3).

```bash
git add src/audio/chordProgressions.test.ts src/data/chordProgressions.ts
git commit -m "test(theory): validate factory progression roman summaries against step data

Replaces the non-empty-string check with a real derivation: each token's
leading accidental+numeral+case must match degreeToRoman(referenceScale,
degree, resolvedQuality). The quality suffix stays unvalidated — several
progressions deliberately simplify it (a 7sus4 step written as plain V7,
a min9 cadence's V written with no suffix at all) and that is editorial,
not a bug.

<one line per data fix actually made, e.g.:>
Fixes baroque-passacaglia's 'VI' -> 'bVI' (degree 5 in Natural Minor;
every other progression reaching that degree already writes the flat).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP"
```

---

### Task 4: Surface-agreement characterization lock (DoD's surface matrix test)

**Files:**
- Create: `src/utils/notationSurfaceSpelling.test.ts`

**Interfaces:**
- Consumes: `spellChordRoot`, `formatChordLabel` from `@/utils/musicTheory`; `spellNoteInKey` from `@/utils/noteSpelling`; `ROOTS` from `@/utils/musicTheory`.
- Produces: no new exports — test only.

**What this test actually proves (read before writing it — do not overclaim in comments):** this repo has no DOM/testing-library (`.claude/rules/testing.md`), so this test cannot literally render the Song loop card, the chord editor, and the keyboard and compare pixels or strings. What it CAN prove, and what genuinely closes the regression class Task 1 fixed: every surface that shows a chord root calls `formatChordLabel`/`spellChordRoot`, and every surface that shows a bare note calls `spellNoteInKey` — both ultimately resolve through the SAME underlying `spellPitchClassInKey`. This test locks that a chord ROOT and a NOTE with the same pitch class, in the same key, always spell identically regardless of which of the two entry points a surface happens to call — the exact invariant a future surface-specific spelling shortcut (like Task 1's bug) would violate.

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, test } from 'bun:test';
import { formatChordLabel, spellChordRoot, ROOTS } from '@/utils/musicTheory';
import { spellNoteInKey, type SpellingKey } from '@/utils/noteSpelling';

/** One representative key per DEV-398's DoD: flat, sharp, modal, pentatonic, Harmonic Minor. */
const REPRESENTATIVE_KEYS: { label: string; key: SpellingKey }[] = [
  { label: 'F Major (flat)', key: { scaleRoot: 'F', scaleType: 'Major' } },
  { label: 'G Major (sharp)', key: { scaleRoot: 'G', scaleType: 'Major' } },
  { label: 'D Dorian (modal)', key: { scaleRoot: 'D', scaleType: 'Dorian' } },
  { label: 'G Hirajoshi (pentatonic)', key: { scaleRoot: 'G', scaleType: 'Hirajoshi' } },
  { label: 'E Harmonic Minor', key: { scaleRoot: 'E', scaleType: 'Harmonic Minor' } },
];

describe('every notation surface spells a pitch class identically, whatever entry point it calls', () => {
  for (const { label, key } of REPRESENTATIVE_KEYS) {
    test(`${label}: a chord root and a bare note at the same pitch class agree`, () => {
      for (const root of ROOTS) {
        const asChordRoot = spellChordRoot(root, key);
        const asBareNote = spellNoteInKey(root, key.scaleRoot, key.scaleType);
        expect(asChordRoot).toBe(asBareNote);
      }
    });

    test(`${label}: formatChordLabel's root matches spellChordRoot for every pitch class`, () => {
      for (const root of ROOTS) {
        const viaChordLabel = formatChordLabel(root, 'maj', key);
        const viaSpellChordRoot = spellChordRoot(root, key);
        expect(viaChordLabel.startsWith(viaSpellChordRoot)).toBe(true);
      }
    });
  }
});
```

- [ ] **Step 2: Run it**

```bash
bun test src/utils/notationSurfaceSpelling.test.ts
```
Expected: PASS. If it fails, that means `spellChordRoot` and `spellNoteInKey` have genuinely diverged for some pitch class/key — investigate `src/utils/noteSpelling.ts` before touching this test; do not weaken the assertion to make it pass.

- [ ] **Step 3: Full gate**

```bash
bun run verify
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/notationSurfaceSpelling.test.ts
git commit -m "test(theory): lock chord-root and bare-note spelling agreement across representative keys

DEV-398's surface-matrix requirement, expressed the only way this repo's
DOM-less test suite can: every surface reaches a pitch class's spelling
through spellChordRoot/formatChordLabel or spellNoteInKey, and this pins
that the two never diverge, across a flat, a sharp, a modal, a pentatonic
and a Harmonic Minor key.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP"
```

---

### Task 5: Document the Roman-numeral convention in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (add a paragraph near the existing "A per-degree chord quality is derived, and a note name is spelled only where it is read" section — same neighborhood as the other music-theory derivation rules)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Write the paragraph**

Add after the existing "A chord's reharmonization behavior is named on the registry, not sniffed from its token" paragraph in `CLAUDE.md` (keep the same bolded-topic-sentence style every other paragraph in that section uses):

```markdown
**A Roman numeral's accidental is relative to Major, and the mediant never carries one.**
`degreeToRoman` (`src/utils/musicTheory.ts`) builds a degree's numeral from three independent
parts: the position (I-VII), the case (lowercase iff the RESOLVED quality — the step's explicit
override if it has one, never the plain diatonic default — has a minor third), and, for
scales with exactly 7 degrees, an accidental comparing that scale's own interval at the degree's
position against Major's interval at the same position (Mixolydian's `bVII`, Lydian's `#IV`,
Natural/Harmonic Minor's `bVI`). The THIRD degree is a deliberate, permanent exception — common
practice never marks a minor key's relative-major mediant (`III`, never `bIII`), because there is
no competing raised form to distinguish it from, unlike VI/VII, which distinguish the natural- and
harmonic/melodic-minor forms. A scale under 7 degrees (the pentatonic family, Hirajoshi) never
gets an accidental at all — a position-by-position comparison against a 7-note Major scale has no
meaning there. `CHORD_PROGRESSIONS`' authored `roman` summaries (`src/data/chordProgressions.ts`)
are validated against exactly this — numeral, case and accidental — by
`src/audio/chordProgressions.test.ts`; the trailing quality suffix (`m7`, `maj9`, `sus2`, …) stays
unvalidated on purpose, since several progressions deliberately simplify it for readability.
```

- [ ] **Step 2: Full gate**

```bash
bun run verify
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the Roman-numeral accidental convention DEV-398 formalized

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP"
```

---

## Task Order and Dependencies

Tasks 1, 2 and 5 are independent of each other and could run in parallel; Task 3 depends on Task 2 (`degreeToRoman`); Task 4 depends on nothing in this plan but is most useful run last, once every surface fix (Task 1) and the numeral derivation (Task 2/3) are in place. Recommended sequential order for the SDD loop: **1 → 2 → 3 → 4 → 5** (matches file-touch locality: 1 and 2 never touch the same file, so running 1 first just avoids an unnecessary merge-conflict risk with a parallel implementer session; there is no hard requirement).

## Final Whole-Branch Review Focus

When all 5 tasks are done, the final review should specifically re-check:
1. Every `roman` string fixed in Task 3 against the ACTUAL progression name/description — a `roman` correction should never make the summary contradict the progression's own prose (e.g. a description that says "the flattened seventh" better still have a `b` somewhere in the roman string after the fix).
2. That Task 2's accidental logic was not accidentally scoped to apply to `Blues` (6 degrees) — re-run `scripts/gen-diatonic-characterization.ts` one more time and confirm the `Blues|*` rows are unchanged from `main`.
3. That no surface outside the 12 already inventoried in `work/dev398-notation-survey.md` §1 was missed — a final `grep -rn "\.root}" src/components --include=*.tsx` sweep for any other raw-root template literal the survey's targeted search did not catch.
4. That no genuinely chromatic/key-agnostic surface (a synth preset's note picker, a MIDI-input readout, anything that has no key/scale context to be "in") was accidentally given a `spellingKey` it shouldn't have — Tasks 1-4 should only ever have touched surfaces that already had a scale context available and simply failed to use it.
5. That a user's own custom saved progression's `roman` text (as opposed to the factory `CHORD_PROGRESSIONS` table) was never validated, reformatted, or rewritten anywhere in the diff.
6. That `src/utils/noteSpelling.test.ts` (the DEV-380 spelling characterization) is untouched and still green — none of this plan's tasks should have needed to modify it.
