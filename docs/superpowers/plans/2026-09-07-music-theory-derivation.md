# Music Theory Derivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the two hand-written per-degree quality arrays from `SCALES`, derive the same answers from spelled third-stacking over each scale's parent, and give every *display* surface the key's own accidentals while every stored and computed value stays sharp.

**Architecture:** Three layers, in dependency order. `src/data/scales.ts` loses `triadQualities`/`seventhQualities` and gains three literal fields (`tonal`, `parent?`, `tonality`) — still a pure leaf table. `src/utils/musicTheory.ts` gains `resolveDegreeQuality(scaleType, degree, use7ths)`, which maps a scale degree to a *parent* degree by semitone offset (never by index), stacks thirds over `tonal`'s spelled note names, measures with `Interval.distance`, and looks the resulting interval tuple up in an exhaustive map that throws on a miss. A new `src/utils/noteSpelling.ts` — importing only `tonal` and `@/data/scales`, so no cycle can form — spells pitch classes and MIDI numbers in a key, and lands only on labels.

**Tech Stack:** TypeScript, Bun test runner, Vite + React, `tonal` (`Scale`, `Interval`, `Note`, `Key`), Zustand.

**Spec:** docs/superpowers/specs/2026-09-07-music-theory-derivation-design.md

## Global Constraints

- `bun run verify` is the completion gate: `bun test` + `bun run lint` + `bun run eslint` + `check:keys` + `check:drums` + `check:contrast` + `bun run build`. **`bun run eslint` must report zero errors.**
- Four-layer import rule: `src/data/` imports nothing at runtime → `src/audio/` never imports `store/` or `components/` → `src/store/` never imports `components/` → `src/components/` must not import `audio/engine`. `src/utils/` sits outside the chain, above `data/`: it may read `data/` at runtime; `data/` may only `import type` back.
- `src/data/` purity: **no runtime imports (not even a sibling in `src/data/`), no function declarations, no `new`, no impure globals (`Math`, `Date`, `crypto`), no module-scope `let`/`var`.** `src/data/scales.ts` gains only string/array literal fields. `src/data/dataLayerPurity.test.ts` lints this through eslint's own API. Test files under `src/data/` are excluded from the rule (`eslint.config.js:156`), so `src/data/scales.test.ts` may import `tonal` and `@/utils/musicTheory`.
- **Nothing spelled is ever persisted.** A stored root is an identity — one of twelve pitch classes written as its canonical sharp name. **No persist `version` bump and no `.solna` `formatVersion` bump is needed, because no stored shape changes.** Do not touch `store.ts`'s `migrate`, `migrate.ts`, or `projectFormatMigrate.ts`.
- **Audio must not change except at Hirajoshi degree 3** (`sus4` → `min`, `7sus4` → `min7`). If any other *pitch* assertion moves — a bass test, a keyboard test, the chord-progression migration proof, a vibe golden fixture other than Zen Garden's one line — **stop**: it is a regression in the derivation, not a fixture to update.
- Every commit message in this plan ends with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
```

- Branch: `refactor/dev-380-derive-chord-qualities` (already checked out). Never commit to `main`.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `scripts/gen-diatonic-characterization.ts` | Prints the diatonic characterization fixture to stdout. Regeneration + `git diff` is the review mechanism for Task 3. |
| `src/utils/diatonicCharacterizationFixture.ts` | 264 committed strings: every scale × 12 roots × {triad, 7th}. Generated; never hand-edited. |
| `src/utils/diatonicCharacterization.test.ts` | Asserts `getDiatonicChordForDegree` still produces the fixture. |
| `src/utils/noteSpelling.ts` | `MAJOR_TONICS`, `MINOR_TONICS`, `KEY_OPTIONS`, `getTonicSpelling`, `getKeyAccidental`, `spellPitchClassInKey`, `spellMidiInKey`, `spellNoteInKey`, `spellScaleNotes`. Imports `tonal` and `@/data/scales` and nothing else. |
| `src/utils/noteSpelling.test.ts` | Named cases + the 132-pair fixture check + the 68-pair count. |
| `scripts/gen-spelling-characterization.ts` | Prints the spelling fixture to stdout. |
| `src/utils/spellingCharacterizationFixture.ts` | 132 committed strings: `spellScaleNotes` for every (root × scale) pair. |

**Modified:** `src/data/scales.ts`, `src/data/scales.test.ts`, `src/utils/musicTheory.ts`, `src/utils/musicTheory.test.ts`, `src/audio/chordProgressions.migration.test.ts`, `src/data/chordProgressions.ts`, `src/store/instantVibesChordsFixture.ts`, `scripts/verify-borrowed.mts`, `src/components/PlayheadReadout.tsx`, `src/components/ui/Keyboard.tsx`, `src/components/loop/ChordView.tsx`, `src/components/loop/ChordPresetLibrary.tsx`, `src/components/loop/lead/melodyGrid.ts`, `src/components/loop/lead/melodyGrid.test.ts`, `src/components/loop/lead/LeadMelodyGrid.tsx`, `src/components/ui/Keyboard.test.ts`, `src/components/Header.tsx`, `src/components/Header.test.tsx`, `CLAUDE.md`, `.claude/skills/music-theory/SKILL.md`.

---

### Task 1: Characterization lock, before any behaviour change

Pins what `getDiatonicChordForDegree` returns *today*, off the hand-written arrays. Written after the derivation it would pin whatever the derivation happens to do, which proves nothing. **No source file changes behaviour in this task.**

**Files:**
- Create: `scripts/gen-diatonic-characterization.ts`
- Create: `src/utils/diatonicCharacterizationFixture.ts` (generated)
- Create: `src/utils/diatonicCharacterization.test.ts`

**Interfaces:**
- Consumes: `SCALES: Record<string, ScaleDefinition>` from `@/data/scales`; `ROOTS: readonly string[]` and `getDiatonicChordForDegree(degreeIndex: number, root: string, scaleType: string, use7ths?: boolean): { root: string; quality: string; degreeName: string }` from `src/utils/musicTheory.ts`.
- Produces: `DIATONIC_CHARACTERIZATION: Record<string, string>` from `src/utils/diatonicCharacterizationFixture.ts`. Key is `` `${scaleType}|${root}|${use7ths ? '7' : '3'}` ``; value is a space-joined list of `` `${chordRoot}:${quality}:${degreeName}` ``, one cell per degree. 264 keys (11 scales × 12 roots × 2).

- [ ] **Step 1: Write the generator script**

Create `scripts/gen-diatonic-characterization.ts`:

```ts
// Regenerates src/utils/diatonicCharacterizationFixture.ts.
// Run: bun run scripts/gen-diatonic-characterization.ts > src/utils/diatonicCharacterizationFixture.ts
//
// The fixture is a characterization lock, not authored content: it is
// regenerated and the DIFF is reviewed. A key that moves without a decision
// behind it is the bug this file exists to make visible.
import { SCALES } from '../src/data/scales';
import { ROOTS, getDiatonicChordForDegree } from '../src/utils/musicTheory';

const lines: string[] = [];
for (const scaleType of Object.keys(SCALES)) {
  for (const root of ROOTS) {
    for (const use7ths of [false, true]) {
      const cells = SCALES[scaleType].intervals.map((_, degree) => {
        const chord = getDiatonicChordForDegree(degree, root, scaleType, use7ths);
        return `${chord.root}:${chord.quality}:${chord.degreeName}`;
      });
      lines.push(`  '${scaleType}|${root}|${use7ths ? '7' : '3'}': '${cells.join(' ')}',`);
    }
  }
}

console.log(`/**
 * GENERATED by scripts/gen-diatonic-characterization.ts — do not hand-edit.
 * Regenerate and review the diff; a moved key is a behaviour change.
 *
 * Key: \`\${scaleType}|\${root}|\${'3' triads | '7' sevenths}\`
 * Value: one \`root:quality:degreeName\` cell per scale degree, space-joined.
 */
export const DIATONIC_CHARACTERIZATION: Record<string, string> = {
${lines.join('\n')}
};
`);
```

- [ ] **Step 2: Generate the fixture and eyeball two lines**

```bash
bun run scripts/gen-diatonic-characterization.ts > src/utils/diatonicCharacterizationFixture.ts
grep -c "': '" src/utils/diatonicCharacterizationFixture.ts
grep "'Hirajoshi|G|3'\|'Blues|C|3'" src/utils/diatonicCharacterizationFixture.ts
```

Expected: `264`, then

```
  'Blues|C|3': 'C:min:i D#:maj:II F:dim:iii F#:dim:iv G:min:v A#:maj:VI',
  'Hirajoshi|G|3': 'G:min:i A:dim:ii A#:maj:III D:sus4:IV D#:maj:V',
```

If either line differs, stop — the generator is reading something other than the live table.

- [ ] **Step 3: Write the test**

Create `src/utils/diatonicCharacterization.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SCALES } from '@/data/scales';
import { ROOTS, getDiatonicChordForDegree } from './musicTheory';
import { DIATONIC_CHARACTERIZATION } from './diatonicCharacterizationFixture';

/**
 * A characterization lock: it states what the app does today so that a change
 * to how it decides has to declare, line by line, what it moved. It is NOT a
 * statement that today's answers are the right ones.
 */
describe('getDiatonicChordForDegree — characterization lock', () => {
  test('covers every scale x 12 roots x {triad, 7th}', () => {
    expect(Object.keys(DIATONIC_CHARACTERIZATION).length).toBe(264);
    expect(Object.keys(SCALES).length * ROOTS.length * 2).toBe(264);
  });

  test('every degree of every key still resolves to the pinned root, quality and numeral', () => {
    const actual: Record<string, string> = {};
    for (const scaleType of Object.keys(SCALES)) {
      for (const root of ROOTS) {
        for (const use7ths of [false, true]) {
          const cells = SCALES[scaleType].intervals.map((_, degree) => {
            const chord = getDiatonicChordForDegree(degree, root, scaleType, use7ths);
            return `${chord.root}:${chord.quality}:${chord.degreeName}`;
          });
          actual[`${scaleType}|${root}|${use7ths ? '7' : '3'}`] = cells.join(' ');
        }
      }
    }
    expect(actual).toEqual(DIATONIC_CHARACTERIZATION);
  });
});
```

- [ ] **Step 4: Run the test and see it pass green on the current tables**

Run: `bun test src/utils/diatonicCharacterization.test.ts`
Expected: PASS, 2 tests. (This test is written to be green now — its job starts in Task 3.)

- [ ] **Step 5: Prove it can fail — mutate one array, run, revert**

```bash
sed -i '' "s/triadQualities: \['min', 'dim', 'maj', 'sus4', 'maj'\]/triadQualities: ['min', 'dim', 'maj', 'min', 'maj']/" src/data/scales.ts
bun test src/utils/diatonicCharacterization.test.ts
git checkout -- src/data/scales.ts
```

Expected on the middle command: FAIL, with a diff naming `Hirajoshi|…|3` keys (`D:sus4:IV` vs `D:min:iv`). A green run here means the test is not wired to the table — stop and fix it before continuing.

- [ ] **Step 6: Type-check and lint**

Run: `bun run lint && bun run eslint`
Expected: both exit 0, zero eslint errors.

- [ ] **Step 7: Commit**

```bash
git add scripts/gen-diatonic-characterization.ts src/utils/diatonicCharacterizationFixture.ts src/utils/diatonicCharacterization.test.ts
git commit -m "test(theory): pin every diatonic degree before deriving them" -m "264 keys — 11 scales x 12 roots x {triad, 7th} — locked against the current
hand-written triadQualities/seventhQualities. Written first, so the derivation
that follows has to declare what it moves.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 2: The resolver, alongside the arrays it will replace

`ScaleDefinition` gains `tonal`, `parent?` and `tonality`; `resolveDegreeQuality` is added and proved against the arrays *while both exist*. Nothing is rewired and nothing is deleted here, so the characterization fixture must not move.

**Files:**
- Modify: `src/data/scales.ts:15-21` (interface) and every entry (add three fields; keep the quality arrays)
- Modify: `src/data/scales.test.ts` (add three assertions)
- Modify: `src/utils/musicTheory.ts:1` (import `Scale`) and append the resolver near `getDiatonicChordForDegree`
- Modify: `src/utils/musicTheory.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `SCALES` from `@/data/scales`; `Scale`, `Interval`, `Note` from `tonal`.
- Produces, all from `src/utils/musicTheory.ts`:
  - `resolveDegreeQuality(scaleType: string, degree: number, use7ths: boolean): string`
  - `parentDegreesFor(scaleType: string, degree: number): { parentKey: string; degrees: number[] }`
  - `resolveParentDegreeQuality(parentKey: string, parentDegree: number, use7ths: boolean): string`
- Produces, from `@/data/scales`: `ScaleDefinition` now carries `tonal: string`, `parent?: string`, `tonality: 'major' | 'minor'`.

- [ ] **Step 1: Write the failing data test for `tonal` and `parent`**

Replace the whole body of `src/data/scales.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test';
import { Note, Scale } from 'tonal';
import { SCALES } from './scales';
import { parentDegreesFor, resolveParentDegreeQuality } from '@/utils/musicTheory';

describe('SCALES', () => {
  test('holds 11 scales', () => {
    expect(Object.keys(SCALES).length).toBe(11);
  });

  test('every scale starts on the root', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      expect(scale.intervals[0], key).toBe(0);
    }
  });

  // intervals stays a literal — it is the table's content, readable by eye —
  // but a hand-edited interval that tonal disagrees with is either a typo or a
  // decision to leave tonal, and both should be visible.
  test('every intervals array is what tonal spells for its `tonal` name', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      const chroma = Scale.get(`C ${scale.tonal}`).notes.map((n) => Note.get(n).chroma);
      expect(chroma, key).toEqual(scale.intervals);
    }
  });

  test('every parent names a 7-note SCALES entry, and no 7-note scale declares one', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      if (scale.intervals.length === 7) {
        expect(scale.parent, key).toBeUndefined();
        continue;
      }
      expect(scale.parent, key).toBeDefined();
      const parent = SCALES[scale.parent as string];
      expect(parent, key).toBeDefined();
      expect(parent.intervals.length, key).toBe(7);
    }
  });

  // A degree the parent does not contain resolves through its nearest parent
  // neighbours. When two are equidistant their qualities must AGREE — the tie
  // is decided by agreement, never by array order. If this goes red, the answer
  // is an explicit `parent` change or intervals that were mis-entered, never a
  // tiebreak rule invented at that moment to make the suite pass.
  test('equidistant parent neighbours agree on the quality', () => {
    let ties = 0;
    for (const [key, scale] of Object.entries(SCALES)) {
      scale.intervals.forEach((_, degree) => {
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

- [ ] **Step 2: Run it and see it fail**

Run: `bun test src/data/scales.test.ts`
Expected: FAIL — `Export named 'parentDegreesFor' not found in module '.../src/utils/musicTheory.ts'` (module-level, so the whole file errors before any assertion runs).

- [ ] **Step 3: Add the three fields to `ScaleDefinition`**

In `src/data/scales.ts`, replace the interface at lines 15-21 with:

```ts
export interface ScaleDefinition {
  name: string;
  category: 'Major / Minor' | 'Modal' | 'Pentatonic & Blues' | 'World & Exotic';
  intervals: number[]; // semitone intervals from root [0, 2, 4, 5, 7, 9, 11]
  /** tonal's scale name, e.g. 'harmonic minor'. `Scale.get('C ' + tonal)` spells this scale. */
  tonal: string;
  /** SCALES key of the 7-note scale whose harmony this scale borrows. 7-note scales omit it. */
  parent?: string;
  /** Which tonic-spelling convention this scale writes its key with. */
  tonality: 'major' | 'minor';
  triadQualities: string[]; // deleted in the next commit — kept here only so the resolver can be proved against it
  seventhQualities: string[]; // deleted in the next commit
}
```

- [ ] **Step 4: Add the three fields to all eleven entries**

In `src/data/scales.ts`, insert into each entry (order: after `intervals`). Exact values — do not guess:

```
'Major':            tonal: 'major',             tonality: 'major',
'Natural Minor':    tonal: 'aeolian',           tonality: 'minor',
'Harmonic Minor':   tonal: 'harmonic minor',    tonality: 'minor',
'Dorian':           tonal: 'dorian',            tonality: 'minor',
'Mixolydian':       tonal: 'mixolydian',        tonality: 'major',
'Lydian':           tonal: 'lydian',            tonality: 'major',
'Phrygian':         tonal: 'phrygian',          tonality: 'minor',
'Minor Pentatonic': tonal: 'minor pentatonic',  tonality: 'minor',  parent: 'Natural Minor',
'Major Pentatonic': tonal: 'major pentatonic',  tonality: 'major',  parent: 'Major',
'Blues':            tonal: 'blues',             tonality: 'minor',  parent: 'Natural Minor',
'Hirajoshi':        tonal: 'hirajoshi',         tonality: 'minor',  parent: 'Natural Minor',
```

For example, the `Blues` entry becomes:

```ts
  'Blues': {
    name: 'Blues Scale',
    category: 'Pentatonic & Blues',
    intervals: [0, 3, 5, 6, 7, 10],
    tonal: 'blues',
    parent: 'Natural Minor',
    tonality: 'minor',
    triadQualities: ['min', 'maj', 'dim', 'dim', 'min', 'maj'],
    seventhQualities: ['7', 'maj7', 'dim7', 'dim7', '7', '7'],
  },
```

`tonality` is stated, not computed: Dorian and Blues are minor-tonality scales whose spelling convention nobody derives from a third. Add that as a comment above `MAJOR_TONICS`' consumer in Task 4, and keep the field's own doc comment as written in Step 3.

- [ ] **Step 5: Write the failing resolver test**

Append to `src/utils/musicTheory.test.ts`:

```ts
describe('resolveDegreeQuality', () => {
  // The nine scales the derivation must reproduce EXACTLY, triads and sevenths,
  // every degree. Harmonic Minor's `aug`/`maj7#5` at degree 2 falls out of the
  // spelled stacking with no special case, which is the strongest single piece
  // of evidence that this is the method the table was written from.
  const REPRODUCED: Record<string, { triads: string[]; sevenths: string[] }> = {
    'Major': {
      triads: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
      sevenths: ['maj7', 'min7', 'min7', 'maj7', '7', 'min7', 'm7b5'],
    },
    'Natural Minor': {
      triads: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'],
      sevenths: ['min7', 'm7b5', 'maj7', 'min7', 'min7', 'maj7', '7'],
    },
    'Harmonic Minor': {
      triads: ['min', 'dim', 'aug', 'min', 'maj', 'maj', 'dim'],
      sevenths: ['minMaj7', 'm7b5', 'maj7#5', 'min7', '7', 'maj7', 'dim7'],
    },
    'Dorian': {
      triads: ['min', 'min', 'maj', 'maj', 'min', 'dim', 'maj'],
      sevenths: ['min7', 'min7', 'maj7', '7', 'min7', 'm7b5', 'maj7'],
    },
    'Mixolydian': {
      triads: ['maj', 'min', 'dim', 'maj', 'min', 'min', 'maj'],
      sevenths: ['7', 'min7', 'm7b5', 'maj7', 'min7', 'min7', 'maj7'],
    },
    'Lydian': {
      triads: ['maj', 'maj', 'min', 'dim', 'maj', 'min', 'min'],
      sevenths: ['maj7', '7', 'min7', 'm7b5', 'maj7', 'min7', 'min7'],
    },
    'Phrygian': {
      triads: ['min', 'maj', 'maj', 'min', 'dim', 'maj', 'min'],
      sevenths: ['min7', 'maj7', '7', 'min7', 'm7b5', 'maj7', 'min7'],
    },
    // Degree 1 is the bIII at interval 3, which Natural Minor carries at its
    // DEGREE 2. Indexing `degree % 7` into the parent — murva's method — would
    // hand back Natural Minor's degree 1, the ii(dim), with nothing failing.
    'Minor Pentatonic': {
      triads: ['min', 'maj', 'min', 'min', 'maj'],
      sevenths: ['min7', 'maj7', 'min7', 'min7', '7'],
    },
    'Major Pentatonic': {
      triads: ['maj', 'min', 'min', 'maj', 'min'],
      sevenths: ['maj7', 'min7', 'min7', '7', 'min7'],
    },
  };

  test('reproduces nine of the eleven scales exactly', () => {
    expect(Object.keys(REPRODUCED).length).toBe(9);
    for (const [key, expected] of Object.entries(REPRODUCED)) {
      const scale = SCALES[key];
      expect(scale.intervals.map((_, d) => resolveDegreeQuality(key, d, false)), key).toEqual(expected.triads);
      expect(scale.intervals.map((_, d) => resolveDegreeQuality(key, d, true)), key).toEqual(expected.sevenths);
    }
  });

  test('the nine reproduced scales still equal the table arrays they will replace', () => {
    // Deleted with the arrays in the next commit. While both exist this is the
    // direct proof that the derivation is not a re-decision.
    for (const key of Object.keys(REPRODUCED)) {
      const scale = SCALES[key];
      expect(scale.intervals.map((_, d) => resolveDegreeQuality(key, d, false)), key).toEqual(scale.triadQualities);
      expect(scale.intervals.map((_, d) => resolveDegreeQuality(key, d, true)), key).toEqual(scale.seventhQualities);
    }
  });

  // Degrees 2 and 3 lose their diminished chords because Natural Minor has no
  // diminished triad at its 4th or 5th degree; the current values are stacked
  // from the blues scale's OWN notes, a different rule than the one the table
  // claims. Degrees 0 and 4 lose their dominant sevenths for the same reason —
  // a `7` on the tonic is a blues idiom, and an idiom belongs in a
  // progression's explicit `quality`, not in a scale's diatonic palette.
  test('Blues changes at four degrees', () => {
    expect(SCALES['Blues'].intervals.map((_, d) => resolveDegreeQuality('Blues', d, false)))
      .toEqual(['min', 'maj', 'min', 'min', 'min', 'maj']);
    expect(SCALES['Blues'].intervals.map((_, d) => resolveDegreeQuality('Blues', d, true)))
      .toEqual(['min7', 'maj7', 'min7', 'min7', 'min7', '7']);
  });

  test('Hirajoshi changes at degree 3 and nowhere else', () => {
    expect(SCALES['Hirajoshi'].intervals.map((_, d) => resolveDegreeQuality('Hirajoshi', d, false)))
      .toEqual(['min', 'dim', 'maj', 'min', 'maj']);
    expect(SCALES['Hirajoshi'].intervals.map((_, d) => resolveDegreeQuality('Hirajoshi', d, true)))
      .toEqual(['min7', 'm7b5', 'maj7', 'min7', 'maj7']);
  });

  test('Blues degree 3 resolves through two equidistant parent degrees', () => {
    const { parentKey, degrees } = parentDegreesFor('Blues', 3);
    expect(parentKey).toBe('Natural Minor');
    expect(degrees).toEqual([3, 4]);
  });

  test('an unmapped interval tuple throws rather than guessing', () => {
    // Natural Minor has seven degrees; degree 7 does not exist and the parent
    // lookup runs off the spelled note list.
    expect(() => resolveParentDegreeQuality('Major', 99, false)).toThrow();
  });

  test('memoization returns the same answer, not a stale one', () => {
    expect(resolveDegreeQuality('Hirajoshi', 3, false)).toBe('min');
    expect(resolveDegreeQuality('Hirajoshi', 3, false)).toBe('min');
    expect(resolveDegreeQuality('Hirajoshi', 3, true)).toBe('min7');
  });
});
```

Add `resolveDegreeQuality`, `parentDegreesFor` and `resolveParentDegreeQuality` to the existing import from `./musicTheory` at the top of `src/utils/musicTheory.test.ts`, and confirm `SCALES` is already imported there (it is — the Hirajoshi describe reads it).

- [ ] **Step 6: Run it and see it fail**

Run: `bun test src/utils/musicTheory.test.ts`
Expected: FAIL — `Export named 'resolveDegreeQuality' not found in module '.../src/utils/musicTheory.ts'`.

- [ ] **Step 7: Implement the resolver**

In `src/utils/musicTheory.ts`, change line 1 to import `Scale`:

```ts
import { Chord, Interval, Note, Scale, transpose } from 'tonal';
```

Then insert this block immediately above `getDiatonicChordForDegree` (currently line 108):

```ts
// The interval tuples a stacked triad can measure to, and the app quality token
// each one names. Exhaustive over what the eleven scales produce. An unmapped
// tuple THROWS: a silent fallback to `maj` is how a wrong chord reaches the UI
// with nothing to notice it, and a twelfth scale whose stacking produces a
// tuple nobody has named should stop, not guess.
const TRIAD_QUALITY_BY_INTERVALS: Record<string, string> = {
  '3M 5P': 'maj',
  '3m 5P': 'min',
  '3m 5d': 'dim',
  '3M 5A': 'aug',
};

const SEVENTH_QUALITY_BY_INTERVALS: Record<string, string> = {
  '3M 5P 7M': 'maj7',
  '3M 5P 7m': '7',
  '3m 5P 7m': 'min7',
  '3m 5d 7m': 'm7b5',
  '3m 5d 7d': 'dim7',
  '3m 5P 7M': 'minMaj7',
  '3M 5A 7M': 'maj7#5',
};

// Keyed `${scaleType}|${degree}|${use7ths}`. Correct forever because SCALES is
// frozen content. The cache lives in utils/, not data/ — a src/data/ file holds
// no mutable module-scope binding.
const degreeQualityCache = new Map<string, string>();

/**
 * The parent degree(s) whose interval is nearest this scale's `degree`.
 *
 * Mapped by SEMITONE OFFSET, never by index. `degree % 7` is correct only when
 * a scale and its parent have the same number of degrees, which for a
 * pentatonic is never: it would make Minor Pentatonic degree 1 — interval 3,
 * the bIII — resolve as Natural Minor's degree 1, the ii(dim), and nothing
 * would fail because the shape and the length are both right.
 *
 * Returns every equidistant neighbour when no parent degree matches exactly,
 * so scales.test.ts can assert the tie's sides agree rather than the code
 * picking one. Exactly one such degree exists today: Blues degree 3.
 */
export function parentDegreesFor(
  scaleType: string,
  degree: number,
): { parentKey: string; degrees: number[] } {
  const resolvedKey = SCALES[scaleType] ? scaleType : 'Major';
  const scale = SCALES[resolvedKey];
  const parentKey = scale.parent ?? resolvedKey;
  const parent = SCALES[parentKey];
  const target = scale.intervals[degree];

  const exact = parent.intervals.indexOf(target);
  if (exact !== -1) return { parentKey, degrees: [exact] };

  let best = Number.POSITIVE_INFINITY;
  let degrees: number[] = [];
  parent.intervals.forEach((interval, parentDegree) => {
    const raw = Math.abs(interval - target);
    const distance = Math.min(raw, 12 - raw);
    if (distance < best) {
      best = distance;
      degrees = [parentDegree];
    } else if (distance === best) {
      degrees.push(parentDegree);
    }
  });
  return { parentKey, degrees };
}

/**
 * The quality of the chord stacked in thirds over a 7-note parent's degree.
 *
 * Measured from tonal's SPELLED note names, which is what makes it work:
 * `Eb`->`B` is `5A` and `Eb`->`Cb` would be `6m`, and only a speller that
 * agrees with the scale gets that right. Hand-rolled semitone arithmetic
 * cannot tell an augmented fifth from a minor sixth at all.
 */
export function resolveParentDegreeQuality(
  parentKey: string,
  parentDegree: number,
  use7ths: boolean,
): string {
  const notes = Scale.get(`C ${SCALES[parentKey].tonal}`).notes;
  const chordRoot = notes[parentDegree];
  const third = Interval.distance(chordRoot, notes[(parentDegree + 2) % 7]);
  const fifth = Interval.distance(chordRoot, notes[(parentDegree + 4) % 7]);

  if (!use7ths) {
    const quality = TRIAD_QUALITY_BY_INTERVALS[`${third} ${fifth}`];
    if (quality === undefined) {
      throw new Error(
        `No triad quality for (${third}, ${fifth}) at ${parentKey} degree ${parentDegree}`,
      );
    }
    return quality;
  }

  const seventh = Interval.distance(chordRoot, notes[(parentDegree + 6) % 7]);
  const quality = SEVENTH_QUALITY_BY_INTERVALS[`${third} ${fifth} ${seventh}`];
  if (quality === undefined) {
    throw new Error(
      `No seventh quality for (${third}, ${fifth}, ${seventh}) at ${parentKey} degree ${parentDegree}`,
    );
  }
  return quality;
}

/**
 * The chord quality a scale degree carries — derived, not stated.
 *
 * Replaces the hand-written triadQualities/seventhQualities arrays: a quality
 * array is a computation frozen into a literal, and a frozen computation
 * drifts silently (two of eleven entries were already wrong by the table's own
 * stated rule). There are no overrides of any kind — if the derivation is wrong
 * for a scale, the fix is the derivation or the `parent`. A specific chord at a
 * specific degree belongs in a CHORD_PROGRESSIONS step's explicit `quality`,
 * which is authored content and cannot leak into every other song in the scale.
 */
export function resolveDegreeQuality(scaleType: string, degree: number, use7ths: boolean): string {
  const cacheKey = `${scaleType}|${degree}|${use7ths}`;
  const cached = degreeQualityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const { parentKey, degrees } = parentDegreesFor(scaleType, degree);
  const quality = resolveParentDegreeQuality(parentKey, degrees[0], use7ths);
  degreeQualityCache.set(cacheKey, quality);
  return quality;
}
```

- [ ] **Step 8: Run both test files and see them pass**

Run: `bun test src/utils/musicTheory.test.ts src/data/scales.test.ts`
Expected: PASS, all tests, including `ties` = 1.

- [ ] **Step 9: Confirm the characterization fixture has NOT moved**

Run: `bun test src/utils/diatonicCharacterization.test.ts && git status --porcelain src/utils/diatonicCharacterizationFixture.ts`
Expected: PASS, and the `git status` line prints nothing. Nothing is rewired yet, so a move here means the resolver was wired in by accident.

- [ ] **Step 10: Full gate**

Run: `bun run verify`
Expected: exit 0, zero eslint errors, build succeeds.

- [ ] **Step 11: Commit**

```bash
git add src/data/scales.ts src/data/scales.test.ts src/utils/musicTheory.ts src/utils/musicTheory.test.ts
git commit -m "refactor(theory): add resolveDegreeQuality alongside the arrays it replaces" -m "ScaleDefinition gains tonal/parent/tonality; intervals stays a literal and a
test pins it to tonal. The resolver maps a degree to a parent degree by
semitone offset, stacks thirds over the parent's spelled names and measures
with Interval.distance. Nine of eleven scales reproduce the hand-written
arrays exactly; Blues moves at four degrees and Hirajoshi at degree 3.

Nothing is rewired yet — the characterization fixture is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 3: Switch over, delete the arrays, and move the data that depends on them

The behaviour change. The Zen Garden golden line, the three `roman` fields and the two progression descriptions move **in this same commit** — splitting them leaves an intermediate commit whose data contradicts its own tests.

**Files:**
- Modify: `src/utils/musicTheory.ts:126-128` (the quality ternary)
- Modify: `src/data/scales.ts` (delete both array fields from the interface and all eleven entries; rewrite the header paragraph and Hirajoshi's block comment)
- Modify: `src/utils/musicTheory.test.ts` (drop the "still equal the table arrays" test and the two Hirajoshi array-length assertions at `:128-129`; add the borrowed-chord measurement)
- Modify: `src/audio/chordProgressions.migration.test.ts:123`
- Modify: `src/data/chordProgressions.ts:541,543,552,576,578` (three `roman`, two `description`)
- Modify: `src/store/instantVibesChordsFixture.ts:61`
- Modify: `scripts/verify-borrowed.mts:4-9` (stale import — `SCALES` no longer re-exports from `musicTheory`)
- Regenerate: `src/utils/diatonicCharacterizationFixture.ts`

**Interfaces:**
- Consumes: `resolveDegreeQuality(scaleType: string, degree: number, use7ths: boolean): string` from `src/utils/musicTheory.ts`; `getBorrowedChords(root: string, scaleType: string): BorrowedChord[]` where `BorrowedChord = { root: string; quality: string; label: string }`.
- Produces: `ScaleDefinition` is now `{ name, category, intervals, tonal, parent?, tonality }` — no quality arrays. `getDiatonicChordForDegree` keeps its exact signature and return shape.

- [ ] **Step 1: Record the borrowed-chord "before", as the spec requires it be measured not assumed**

First repair the stale script. In `scripts/verify-borrowed.mts`, replace lines 3-9 with:

```ts
import { Chord, Note, Scale } from 'tonal';
import { SCALES } from '../src/data/scales';
import {
  getBorrowedChords,
  getDiatonicChordForDegree,
  getScaleNotes,
} from '../src/utils/musicTheory';
```

Then:

```bash
bun run scripts/verify-borrowed.mts > /tmp/borrowed-before.txt
for s in Blues Hirajoshi; do echo -n "$s: "; bun -e "import { getBorrowedChords } from './src/utils/musicTheory'; console.log(getBorrowedChords('C','$s').map(b=>b.root+' '+b.quality).join(' | '))"; done
```

Expected:

```
Blues: F min | G# maj
Hirajoshi: F min | A# maj
```

- [ ] **Step 2: Write the failing test for the post-derivation borrowed lists**

Append to the `describe('resolveDegreeQuality', ...)` block in `src/utils/musicTheory.test.ts`:

```ts
  // getBorrowedChords filters candidates against the in-scale palette, and that
  // palette is exactly what moved — so this is measured, not assumed. Blues
  // loses `iv` because the derived palette now carries F min at degree 2.
  // Hirajoshi is unchanged: nothing it gained collides with a candidate.
  test('borrowed chords, measured after the derivation', () => {
    expect(getBorrowedChords('C', 'Blues').map((b) => `${b.root} ${b.quality}`)).toEqual(['G# maj']);
    expect(getBorrowedChords('C', 'Hirajoshi').map((b) => `${b.root} ${b.quality}`)).toEqual([
      'F min',
      'A# maj',
    ]);
  });
```

Add `getBorrowedChords` to the import from `./musicTheory` if it is not already there.

- [ ] **Step 3: Run it and see it fail**

Run: `bun test src/utils/musicTheory.test.ts -t "borrowed chords, measured"`
Expected: FAIL — received `["F min", "G# maj"]`, expected `["G# maj"]`.

- [ ] **Step 4: Rewire `getDiatonicChordForDegree`**

In `src/utils/musicTheory.ts`, replace lines 126-128:

```ts
  const quality = use7ths 
    ? (scale.seventhQualities[normDegree] || '7')
    : (scale.triadQualities[normDegree] || 'maj');
```

with:

```ts
  // The `|| 'maj'` / `|| '7'` fallbacks went away with the arrays they guarded:
  // an unresolvable degree now throws inside the resolver rather than sounding
  // a wrong chord.
  const quality = resolveDegreeQuality(scaleType, normDegree, use7ths);
```

- [ ] **Step 5: Run it and see the borrowed test pass**

Run: `bun test src/utils/musicTheory.test.ts -t "borrowed chords, measured"`
Expected: PASS.

- [ ] **Step 6: Delete the arrays from the data table and rewrite its prose**

In `src/data/scales.ts`: delete the `triadQualities` and `seventhQualities` lines from the interface and from all eleven entries. Replace the file header (lines 1-14) with:

```ts
/**
 * The scale library: 11 hand-authored scales, each with its interval set, the
 * tonal scale name that spells it, its spelling tonality, and — for scales
 * with fewer than seven degrees — the 7-note parent whose harmony it borrows.
 *
 * Authored content, not a system registry: adding a scale is an edit to this
 * table and nothing else, which is the test that decides what belongs in
 * src/data/. ROOTS stays in utils/musicTheory.ts — it is a spelling convention
 * inseparable from the three functions that enforce it, not a library.
 *
 * `intervals` is content: a reader who knows the scale can check [0, 2, 3, 7, 8]
 * by eye, and scales.test.ts pins it against `tonal`. Per-degree chord
 * qualities are NOT content — a reviewer cannot check `['min','dim','maj',
 * 'sus4','maj']` by reading it — so they are derived by
 * utils/musicTheory.ts's resolveDegreeQuality and are not stated here. There
 * are no overrides: an override field is the shortcut people reach for instead
 * of fixing the derivation. A specific chord at a specific degree belongs in a
 * CHORD_PROGRESSIONS step's explicit `quality`.
 */
```

Replace Hirajoshi's block comment (the six lines above its former `triadQualities`) with:

```ts
    // Parent is Natural Minor: Hirajoshi is a strict subset of it at degrees
    // 1, 2, 3, 5, 6. Stacking scale-steps on a scale with two major-third gaps
    // does not give tertian chords (degree 0 would be {0, 3, 8}), so the
    // harmony comes from the parent — and reaching outside the five notes is
    // what a five-note scale with two major-third gaps does, not a defect.
    // Degree 3 was a hand-written sus4/7sus4 deviation; it is now min/min7.
```

Keep the existing `// 1, 2, b3, 5, b6 — step pattern …` comment above `intervals` unchanged.

- [ ] **Step 7: Move the two dependent test readers off the arrays**

In `src/audio/chordProgressions.migration.test.ts:123`, replace:

```ts
          expect(SCALES[progression.referenceScale].triadQualities[step.degree]).toBe(
            original.relativeChords[i].quality,
          );
```

with:

```ts
          expect(resolveDegreeQuality(progression.referenceScale, step.degree, false)).toBe(
            original.relativeChords[i].quality,
          );
```

and add `resolveDegreeQuality` to that file's import from `@/utils/musicTheory` (add the import if the file has none). The `SCALES` import may become unused — remove it if eslint flags it.

In `src/utils/musicTheory.test.ts`, delete these two lines from the `Hirajoshi` describe (currently `:128-129`):

```ts
    expect(scale.triadQualities).toHaveLength(5);
    expect(scale.seventhQualities).toHaveLength(5);
```

and delete the whole `test('the nine reproduced scales still equal the table arrays they will replace', …)` block added in Task 2 — the arrays it read no longer exist.

- [ ] **Step 8: Run the two suites and see them pass**

Run: `bun test src/audio/chordProgressions.migration.test.ts src/utils/musicTheory.test.ts src/data/scales.test.ts`
Expected: PASS. **If `chordProgressions.migration.test.ts` fails on a pitch, stop** — that suite is the proof that no shipped progression moved, and only Hirajoshi degree 3 is allowed to.

- [ ] **Step 9: Regenerate the characterization fixture and prove exactly 48 keys moved**

```bash
bun run scripts/gen-diatonic-characterization.ts > src/utils/diatonicCharacterizationFixture.ts
git diff -U0 src/utils/diatonicCharacterizationFixture.ts | grep -c '^+ '
git diff -U0 src/utils/diatonicCharacterizationFixture.ts | grep '^[+-]' | grep -v '^[+-][+-]' | grep -v "'Blues|" | grep -v "'Hirajoshi|"
```

Expected: `48` from the count (12 roots × 2 for Blues, 12 × 2 for Hirajoshi), and the third command prints **nothing**. Any line it prints is a scale the derivation reached that the spec says it must not — stop and fix the derivation, do not accept the fixture.

- [ ] **Step 10: Run the characterization test**

Run: `bun test src/utils/diatonicCharacterization.test.ts`
Expected: PASS (264 keys, matching the regenerated fixture).

- [ ] **Step 11: Move the Zen Garden golden — exactly one line**

In `src/store/instantVibesChordsFixture.ts:61`, replace:

```ts
    snapshotChord('zn2', 'D', 'sus4', 2, 4),
```

with:

```ts
    snapshotChord('zn2', 'D', 'min', 2, 4),
```

Run: `bun test src/store/vibes.test.ts`
Expected: PASS. **If a second line has to move, stop** — something other than Hirajoshi degree 3 changed.

- [ ] **Step 12: Verify the three roman numerals against the resolver, then write them**

The numeral is lower-cased by a rule (`quality.includes('min') || quality === 'dim'`), so check the rule's output rather than trusting a list:

```bash
bun -e "import { getDiatonicChordForDegree as g } from './src/utils/musicTheory'; console.log([0,1,2,3,4].map(d=>d+':'+g(d,'G','Hirajoshi',false).degreeName+' '+g(d,'G','Hirajoshi',false).quality).join('  '))"
```

Expected: `0:i min  1:ii dim  2:III maj  3:iv min  4:V maj`.

Then in `src/data/chordProgressions.ts`:
- `zen-bamboo-vamp` (line 541): `roman: 'i – IV – i – V'` → `roman: 'i – iv – i – V'`
- `zen-moonlit-koto` (line 552): `roman: 'i – V – IV – III'` → `roman: 'i – V – iv – III'`
- `zen-temple-bell` (line 576): `roman: 'i – III – V – IV'` → `roman: 'i – III – V – iv'`

`zen-still-pond` carries explicit qualities (`step(0, 4, 'min7')`, `step(4, 4, 'maj7')`) and does not move.

- [ ] **Step 13: Rewrite the two descriptions and the section comment**

In `src/data/chordProgressions.ts`, replace the comment at line 535-536:

```ts
  // --- Zen: Hirajoshi. Only degrees 0, 3 and 4 give triads that stay entirely
  // inside the five notes, so the vamp below is built from exactly those.
```

with:

```ts
  // --- Zen: Hirajoshi, a five-note scale with two major-third gaps, so most of
  // its diatonic chords reach outside it. That is a fact about the scale, not a
  // defect: of the four progressions below only zen-bamboo-vamp was ever fully
  // inside the five notes, and it no longer is.
```

Replace the `zen-bamboo-vamp` description (line 543):

```ts
      'Open-fourth koto sound over a minor tonic; every note it plays is inside the scale.',
```

with:

```ts
      'A minor tonic answered by its own iv and V — the plainest cadence Hirajoshi has.',
```

Replace the `zen-temple-bell` description (line 578):

```ts
      'Rises through both major thirds before the open fourth settles it — not a rotation of the vamp.',
```

with:

```ts
      'Rises through both major thirds before the iv settles it — not a rotation of the vamp.',
```

- [ ] **Step 14: Record the borrowed-chord diff in the commit evidence**

```bash
bun run scripts/verify-borrowed.mts > /tmp/borrowed-after.txt
diff /tmp/borrowed-before.txt /tmp/borrowed-after.txt
```

Expected: a diff confined to Blues and Hirajoshi. Blues loses `F min (iv)` from its borrowed row; Hirajoshi's row (`F min`, `A# maj`) is unchanged. Paste the one-line summary into the commit body (Step 16 already carries it — confirm it matches what you see).

- [ ] **Step 15: Full gate**

Run: `bun run verify`
Expected: exit 0, zero eslint errors. **Read the test summary**: the only suites whose expectations changed in this task are `musicTheory`, `scales`, `diatonicCharacterization`, `vibes` and `chordProgressions.migration`. If a bass, keyboard, sequencer or lead suite moved, stop — that is the negative assertion this whole exercise runs under.

- [ ] **Step 16: Commit**

```bash
git add src/utils/musicTheory.ts src/utils/musicTheory.test.ts src/data/scales.ts src/data/chordProgressions.ts src/store/instantVibesChordsFixture.ts src/audio/chordProgressions.migration.test.ts src/utils/diatonicCharacterizationFixture.ts scripts/verify-borrowed.mts
git commit -m "refactor(theory): derive per-degree chord qualities, delete the frozen arrays" -m "getDiatonicChordForDegree now calls resolveDegreeQuality; triadQualities and
seventhQualities are gone from ScaleDefinition and from all eleven entries.

The characterization fixture moves at 48 of 264 keys — Blues (four degrees,
12 roots, triads and 7ths) and Hirajoshi degree 3 — and nowhere else.
Hirajoshi degree 3 is sus4/7sus4 -> min/min7, the one pitch change in the
issue, accepted knowingly: three of Zen Garden's four progressions use it,
and only zen-bamboo-vamp was ever fully inside the five notes.

Shipped with it: the zen-garden golden's one line, three roman numerals
lower-cased by the rule, two descriptions that named an open fourth that no
longer exists. Splitting them would leave a commit whose data contradicts
its own tests.

Measured: getBorrowedChords loses 'iv' for Blues (the derived palette now
carries F min at degree 2); Hirajoshi's borrowed row is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 4: `noteSpelling.ts`, with no callers

The module is proved correct before anything depends on it.

**Files:**
- Create: `src/utils/noteSpelling.ts`
- Create: `scripts/gen-spelling-characterization.ts`
- Create: `src/utils/spellingCharacterizationFixture.ts` (generated)
- Create: `src/utils/noteSpelling.test.ts`

**Interfaces:**
- Consumes: `SCALES` from `@/data/scales` — specifically `tonal: string`, `tonality: 'major' | 'minor'`, `intervals: number[]`; `Key`, `Note`, `Scale` from `tonal`.
- Produces, all from `src/utils/noteSpelling.ts`:
  - `MAJOR_TONICS: readonly string[]` / `MINOR_TONICS: readonly string[]` — 12 entries each, indexed by chroma
  - `KEY_OPTIONS: readonly { value: string; label: string }[]`
  - `getTonicSpelling(rootNote: string, scaleType: string): string`
  - `getKeyAccidental(rootNote: string, scaleType: string): 'sharp' | 'flat'`
  - `spellPitchClassInKey(chroma: number, rootNote: string, scaleType: string): string`
  - `spellMidiInKey(midi: number, rootNote: string, scaleType: string): string`
  - `spellNoteInKey(note: string, rootNote: string, scaleType: string): string`
  - `spellScaleNotes(rootNote: string, scaleType: string): string[]`
  - `export interface SpellingKey { scaleRoot: string; scaleType: string }`
- **`scaleType` throughout is the SCALES key** (`'Natural Minor'`, `'Hirajoshi'`), never tonal's name. The module reads `.tonal` and `.tonality` off the entry itself.

- [ ] **Step 1: Write the failing named-case test**

Create `src/utils/noteSpelling.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SCALES } from '@/data/scales';
import { ROOTS, getScaleNotes } from './musicTheory';
import {
  KEY_OPTIONS,
  getKeyAccidental,
  getTonicSpelling,
  spellMidiInKey,
  spellNoteInKey,
  spellPitchClassInKey,
  spellScaleNotes,
} from './noteSpelling';

describe('getTonicSpelling', () => {
  test('writes the tonic the way the key writes it', () => {
    expect(getTonicSpelling('A#', 'Major')).toBe('Bb');
    expect(getTonicSpelling('G#', 'Natural Minor')).toBe('G#');
    expect(getTonicSpelling('D#', 'Blues')).toBe('Eb');
    expect(getTonicSpelling('C', 'Major')).toBe('C');
  });

  test('an unknown note name comes back untouched', () => {
    expect(getTonicSpelling('H', 'Major')).toBe('H');
  });
});

describe('getKeyAccidental', () => {
  test('reads the key signature, not the tonic name', () => {
    // F major carries no accidental in its own name and is a flat key.
    expect(getKeyAccidental('F', 'Major')).toBe('flat');
    expect(getKeyAccidental('G', 'Major')).toBe('sharp');
    expect(getKeyAccidental('G#', 'Harmonic Minor')).toBe('sharp');
    expect(getKeyAccidental('D#', 'Blues')).toBe('flat');
  });
});

describe('spellScaleNotes', () => {
  test('A flat major minor spells flat, not sharp', () => {
    expect(spellScaleNotes('G#', 'Natural Minor')).toEqual(['G#', 'A#', 'B', 'C#', 'D#', 'E', 'F#']);
    expect(spellScaleNotes('A#', 'Major')).toEqual(['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A']);
  });

  test('a single accidental that looks unusual is kept — F# major writes E#', () => {
    expect(spellScaleNotes('F#', 'Major')).toEqual(['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
  });

  test('a double accidental falls back to the key own direction', () => {
    // tonal gives Eb Gb Ab Bbb Bb Db — Bbb is unreadable on a grid row, and
    // the key is flat, so it falls back to A and never to G#.
    expect(spellScaleNotes('D#', 'Blues')).toEqual(['Eb', 'Gb', 'Ab', 'A', 'Bb', 'Db']);
    // tonal gives G# A# B C# D# E F## — the key is sharp, so F## falls to G.
    expect(spellScaleNotes('G#', 'Harmonic Minor')).toEqual([
      'G#', 'A#', 'B', 'C#', 'D#', 'E', 'G',
    ]);
  });

  test('an unknown scaleType falls back to Major, like the rest of the app', () => {
    expect(spellScaleNotes('C', 'Nonesuch')).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  });
});

describe('spellMidiInKey / spellNoteInKey', () => {
  test('never returns a name denoting a different pitch', () => {
    for (const scaleType of Object.keys(SCALES)) {
      for (const root of ROOTS) {
        for (let midi = 48; midi < 72; midi++) {
          const name = spellMidiInKey(midi, root, scaleType);
          expect(Note.midi(name), `${root} ${scaleType} ${midi} -> ${name}`).toBe(midi);
        }
      }
    }
  });

  test('keeps the octave a spelled letter would have moved', () => {
    // Cb4 and B3 are the same key; the letter that wraps the boundary shifts it.
    expect(Note.midi(spellMidiInKey(59, 'F#', 'Major'))).toBe(59);
  });

  test('spellNoteInKey carries the octave through', () => {
    expect(spellNoteInKey('D#4', 'A#', 'Major')).toBe('Eb4');
    expect(spellNoteInKey('C4', 'C', 'Major')).toBe('C4');
  });

  test('a name tonal cannot parse comes back untouched', () => {
    expect(spellNoteInKey('rest', 'C', 'Major')).toBe('rest');
  });
});

describe('KEY_OPTIONS', () => {
  test('value stays the canonical sharp name so the stored contract is unchanged', () => {
    expect(KEY_OPTIONS.map((o) => o.value)).toEqual([...ROOTS]);
  });

  test('label shows both spellings of an enharmonic key, regardless of scale', () => {
    expect(KEY_OPTIONS[1]).toEqual({ value: 'C#', label: 'C#/Db' });
    expect(KEY_OPTIONS[0]).toEqual({ value: 'C', label: 'C' });
    expect(KEY_OPTIONS.length).toBe(12);
  });
});

describe('spelling never changes which pitches a scale contains', () => {
  test('every spelled note has the same chroma as the sharp name it replaces', () => {
    for (const scaleType of Object.keys(SCALES)) {
      for (const root of ROOTS) {
        const sharp = getScaleNotes(root, scaleType).map((n) => Note.get(n).chroma);
        const spelled = spellScaleNotes(root, scaleType).map((n) => Note.get(n).chroma);
        expect(spelled, `${root} ${scaleType}`).toEqual(sharp);
      }
    }
  });
});
```

Add `import { Note } from 'tonal';` to the top of that file (it is used by two describes).

- [ ] **Step 2: Run it and see it fail**

Run: `bun test src/utils/noteSpelling.test.ts`
Expected: FAIL — `Cannot find module './noteSpelling'`.

- [ ] **Step 3: Write the module**

Create `src/utils/noteSpelling.ts`:

```ts
import { Key, Note, Scale } from 'tonal';
import { SCALES } from '@/data/scales';

/**
 * How a key is WRITTEN, as opposed to which pitches it contains.
 *
 * A stored root is an identity — one of twelve pitch classes, persisted as its
 * canonical sharp name — so a stored value can never disagree with the scale it
 * is paired with. Every accidental a user sees is derived here, from
 * (scaleRoot, scaleType), at render time. Nothing spelled is ever persisted,
 * which is why this change needs no persist-version and no .solna format bump.
 *
 * This module imports `tonal` and `@/data/scales` and NOTHING ELSE. That is
 * deliberate: musicTheory.ts imports this file (formatChordLabel's key
 * parameter), so importing musicTheory back would make the cycle load-bearing
 * at module-evaluation time. The `tonality` field lives on the SCALES entry
 * precisely so that never has to happen, and both name lists come from tonal
 * rather than from a hand-copied duplicate of ROOTS that would need its own
 * guard test.
 */
const SHARP_NAMES: readonly string[] = Array.from({ length: 12 }, (_, pc) =>
  Note.pitchClass(Note.fromMidiSharps(60 + pc)),
);
const FLAT_NAMES: readonly string[] = Array.from({ length: 12 }, (_, pc) =>
  Note.pitchClass(Note.fromMidi(60 + pc)),
);

/**
 * Conventional tonic spelling per pitch class, by circle-of-fifths practice —
 * NOT computed. Counting accidentals is not enough: it ties on Eb/D# minor and
 * picks the wrong side outright for blues and pentatonic scales, whose tonal
 * spelling carries accidentals that say nothing about the key.
 */
export const MAJOR_TONICS: readonly string[] = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
];
export const MINOR_TONICS: readonly string[] = [
  'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B',
];

/** The (scaleRoot, scaleType) pair every display surface spells against. */
export interface SpellingKey {
  scaleRoot: string;
  scaleType: string;
}

const entryFor = (scaleType: string) => SCALES[scaleType] ?? SCALES['Major'];

/** The tonic as this key writes it: `A#` + Major -> `Bb`, `G#` + Natural Minor -> `G#`. */
export function getTonicSpelling(rootNote: string, scaleType: string): string {
  const chroma = Note.get(rootNote).chroma;
  if (chroma === undefined) return rootNote;
  const tonics = entryFor(scaleType).tonality === 'minor' ? MINOR_TONICS : MAJOR_TONICS;
  return tonics[chroma] ?? rootNote;
}

/**
 * Which accidental this key writes its out-of-scale notes with.
 *
 * Read from the key signature, not from the tonic's own name: F major is a flat
 * key while its tonic carries no accidental at all.
 */
export function getKeyAccidental(rootNote: string, scaleType: string): 'sharp' | 'flat' {
  const tonic = getTonicSpelling(rootNote, scaleType);
  const alteration =
    entryFor(scaleType).tonality === 'minor'
      ? Key.minorKey(tonic).alteration
      : Key.majorKey(tonic).alteration;
  return alteration < 0 ? 'flat' : 'sharp';
}

/** Pitch-class name (no octave) as the given key writes it. */
export function spellPitchClassInKey(chroma: number, rootNote: string, scaleType: string): string {
  const pitchClass = ((chroma % 12) + 12) % 12;
  const entry = entryFor(scaleType);
  const tonic = getTonicSpelling(rootNote, scaleType);

  for (const degree of Scale.get(`${tonic} ${entry.tonal}`).notes) {
    if (Note.get(degree).chroma !== pitchClass) continue;
    // A few keys (D# blues, G# harmonic minor) reach a double accidental.
    // Those are unreadable on a grid row, so fall through to the key's plain
    // sharp/flat name; single accidentals like F# major's E# are kept, because
    // that is what the key signature writes and it is readable.
    if (!/##|bb/.test(degree)) return degree;
    break;
  }

  const names = getKeyAccidental(rootNote, scaleType) === 'flat' ? FLAT_NAMES : SHARP_NAMES;
  return names[pitchClass] ?? SHARP_NAMES[pitchClass] ?? '';
}

/**
 * Note name with octave for a MIDI number, as the given key writes it.
 *
 * The octave cannot be read off the MIDI number alone: `Cb4` and `B3` are the
 * same key, so a letter that wraps the octave boundary shifts it. The result is
 * checked against `Note.midi` and corrected, which makes it structurally
 * impossible for this function to return a name denoting a different pitch.
 */
export function spellMidiInKey(midi: number, rootNote: string, scaleType: string): string {
  const pitchClass = spellPitchClassInKey(midi % 12, rootNote, scaleType);
  const octave = Math.floor(midi / 12) - 1;
  for (const candidate of [
    `${pitchClass}${octave}`,
    `${pitchClass}${octave + 1}`,
    `${pitchClass}${octave - 1}`,
  ]) {
    if (Note.midi(candidate) === midi) return candidate;
  }
  return `${pitchClass}${octave}`;
}

/** Spell a note name that carries an octave: ('D#4', 'A#', 'Major') -> 'Eb4'. */
export function spellNoteInKey(note: string, rootNote: string, scaleType: string): string {
  const midi = Note.midi(note);
  return midi === null ? note : spellMidiInKey(midi, rootNote, scaleType);
}

/**
 * The DISPLAY counterpart of getScaleNotes.
 *
 * getScaleNotes must keep returning sharp names — ui/Keyboard.tsx does
 * `ROOTS.indexOf(n)` on its output to recover a semitone, and a flat name
 * yields -1 with no throw and no failing type. So display gets its own
 * function and getScaleNotes is not touched.
 */
export function spellScaleNotes(rootNote: string, scaleType: string): string[] {
  const chroma = Note.get(rootNote).chroma;
  if (chroma === undefined) return [];
  return entryFor(scaleType).intervals.map((interval) =>
    spellPitchClassInKey(chroma + interval, rootNote, scaleType),
  );
}

/**
 * The twelve key choices offered in the UI.
 *
 * `value` stays the canonical sharp name — identical to ROOTS, so the stored
 * contract is unchanged — while `label` shows both spellings of an enharmonic
 * key regardless of the scale, so the picker never has to explain why the same
 * button reads differently after a scale change.
 */
export const KEY_OPTIONS: readonly { value: string; label: string }[] = SHARP_NAMES.map(
  (value, chroma) => {
    const flat = FLAT_NAMES[chroma] ?? value;
    return { value, label: flat === value ? value : `${value}/${flat}` };
  },
);
```

- [ ] **Step 4: Run the named-case test and see it pass**

Run: `bun test src/utils/noteSpelling.test.ts`
Expected: PASS, all describes.

- [ ] **Step 5: Write the spelling fixture generator**

Create `scripts/gen-spelling-characterization.ts`:

```ts
// Regenerates src/utils/spellingCharacterizationFixture.ts.
// Run: bun run scripts/gen-spelling-characterization.ts > src/utils/spellingCharacterizationFixture.ts
//
// All 132 (root x scale) pairs, not a sample: a sample would miss both
// double-accidental pairs — the only cases that exercise the fallback — and
// would miss F# major's E#, the case that proves single accidentals are kept.
import { SCALES } from '../src/data/scales';
import { ROOTS } from '../src/utils/musicTheory';
import { spellScaleNotes } from '../src/utils/noteSpelling';

const lines: string[] = [];
for (const root of ROOTS) {
  for (const scaleType of Object.keys(SCALES)) {
    lines.push(`  '${root}|${scaleType}': '${spellScaleNotes(root, scaleType).join(' ')}',`);
  }
}

console.log(`/**
 * GENERATED by scripts/gen-spelling-characterization.ts — do not hand-edit.
 * All 132 (root x scale) pairs. Key: \`\${root}|\${scaleType}\`.
 */
export const SPELLING_CHARACTERIZATION: Record<string, string> = {
${lines.join('\n')}
};
`);
```

- [ ] **Step 6: Generate it and spot-check the two fallback pairs**

```bash
bun run scripts/gen-spelling-characterization.ts > src/utils/spellingCharacterizationFixture.ts
grep -c "': '" src/utils/spellingCharacterizationFixture.ts
grep "'D#|Blues'\|'G#|Harmonic Minor'\|'F#|Major'" src/utils/spellingCharacterizationFixture.ts
```

Expected: `132`, then

```
  'F#|Major': 'F# G# A# B C# D# E#',
  'D#|Blues': 'Eb Gb Ab A Bb Db',
  'G#|Harmonic Minor': 'G# A# B C# D# E G',
```

- [ ] **Step 7: Add the fixture and count assertions to the test**

Append to `src/utils/noteSpelling.test.ts`:

```ts
describe('spelling characterization', () => {
  test('pins all 132 (root x scale) pairs', () => {
    expect(Object.keys(SPELLING_CHARACTERIZATION).length).toBe(132);
    const actual: Record<string, string> = {};
    for (const root of ROOTS) {
      for (const scaleType of Object.keys(SCALES)) {
        actual[`${root}|${scaleType}`] = spellScaleNotes(root, scaleType).join(' ');
      }
    }
    expect(actual).toEqual(SPELLING_CHARACTERIZATION);
  });

  test('changes at least one note name in 68 of the 132 pairs', () => {
    let changed = 0;
    for (const root of ROOTS) {
      for (const scaleType of Object.keys(SCALES)) {
        const sharp = getScaleNotes(root, scaleType).join(' ');
        if (spellScaleNotes(root, scaleType).join(' ') !== sharp) changed++;
      }
    }
    expect(changed).toBe(68);
  });

  test('exactly two pairs reach a double accidental and take the fallback', () => {
    const fallbacks: string[] = [];
    for (const root of ROOTS) {
      for (const scaleType of Object.keys(SCALES)) {
        const tonic = getTonicSpelling(root, scaleType);
        const raw = Scale.get(`${tonic} ${SCALES[scaleType].tonal}`).notes;
        if (raw.some((n) => /##|bb/.test(n))) fallbacks.push(`${root}|${scaleType}`);
      }
    }
    expect(fallbacks.sort()).toEqual(['D#|Blues', 'G#|Harmonic Minor']);
  });
});
```

Extend the file's imports: add `Scale` to the `tonal` import, and add
`import { SPELLING_CHARACTERIZATION } from './spellingCharacterizationFixture';`.

- [ ] **Step 8: Run it and see it pass**

Run: `bun test src/utils/noteSpelling.test.ts`
Expected: PASS, including `changed` = 68 and the two named fallback pairs.

- [ ] **Step 9: Full gate**

Run: `bun run verify`
Expected: exit 0, zero eslint errors. Nothing imports `noteSpelling.ts` yet, so no other suite may move.

- [ ] **Step 10: Commit**

```bash
git add src/utils/noteSpelling.ts src/utils/noteSpelling.test.ts scripts/gen-spelling-characterization.ts src/utils/spellingCharacterizationFixture.ts
git commit -m "feat(theory): spell notes in the key, with no callers yet" -m "noteSpelling.ts imports tonal and @/data/scales and nothing else — tonality
lives on the SCALES entry precisely so no cycle with musicTheory can form,
and both name lists come from tonal rather than a hand-copied ROOTS.

Measured: spelling moves at least one note name in 68 of 132 (root x scale)
pairs. Two pairs reach a double accidental and fall back to the key's own
direction (D# blues -> Bbb becomes A; G# harmonic minor -> F## becomes G).
Single accidentals are kept: F# major still writes E#.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 5: Spelling into chord labels

`formatChordLabel` gains an **optional** third parameter, so the call sites migrate one at a time and an un-migrated one keeps today's output. **The resolvers do not change** — `getDiatonicChordForDegree`, `getBorrowedChords`, `transposeProgression`, `snapProgressionToScale` and `generateBlockChordNotes` all keep returning canonical sharp roots, because `SortableChordCard.tsx:171` renders its root `<select>` from `ROOTS` (an `Eb` value matches no `<option>`), `generateBlockChordNotes` maps names back through `ROOTS`, and `ChordItem.root` is persisted.

**Files:**
- Modify: `src/utils/musicTheory.ts:394-397` (`formatChordLabel`)
- Modify: `src/utils/musicTheory.test.ts:86-113` (extend the `formatChordLabel` describe)
- Modify: `src/components/PlayheadReadout.tsx:11-16,36-37`
- Modify: `src/components/ui/Keyboard.tsx:338`
- Modify: `src/components/loop/ChordView.tsx:317,759,765,827,833`
- Modify: `src/components/loop/ChordPresetLibrary.tsx:221,306,331,352,388,416,526,501`

**Interfaces:**
- Consumes: `spellPitchClassInKey(chroma, rootNote, scaleType)`, `getTonicSpelling(rootNote, scaleType)` and `SpellingKey` from `./noteSpelling`; `rootSemitone(root: string): number` from `./musicTheory`.
- Produces: `formatChordLabel(root: string, quality: string, key?: SpellingKey): string`. `formatChordQuality(quality: string): string` is **unchanged** — a quality suffix has no accidental.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('formatChordLabel', …)` in `src/utils/musicTheory.test.ts`:

```ts
  test('spells the root in the key when one is given', () => {
    expect(formatChordLabel('A#', 'maj', { scaleRoot: 'A#', scaleType: 'Major' })).toBe('Bb');
    expect(formatChordLabel('D#', 'min7', { scaleRoot: 'A#', scaleType: 'Major' })).toBe('Ebm7');
    expect(formatChordLabel('E', 'maj', { scaleRoot: 'F#', scaleType: 'Major' })).toBe('E#');
  });

  test('without a key it still writes the canonical sharp name', () => {
    expect(formatChordLabel('A#', 'maj')).toBe('A#');
    expect(formatChordLabel('D#', 'min7')).toBe('D#m7');
  });

  test('the quality suffix is untouched by spelling', () => {
    expect(formatChordLabel('D#', 'maj7#5', { scaleRoot: 'A#', scaleType: 'Major' })).toBe('Ebmaj7#5');
  });
```

Note on the third assertion: `E` is chroma 4, and F# major spells chroma 4 as `E#`. That is the case that proves single accidentals are kept at a chord label too.

- [ ] **Step 2: Run it and see it fail**

Run: `bun test src/utils/musicTheory.test.ts -t "spells the root in the key"`
Expected: FAIL — `Expected: "Bb", Received: "A#"` (the third argument is currently ignored, and TypeScript will also flag `Expected 2 arguments, but got 3` under `bun run lint`).

- [ ] **Step 3: Implement**

In `src/utils/musicTheory.ts`, add to the imports near the top:

```ts
import { spellPitchClassInKey, type SpellingKey } from './noteSpelling';
```

and replace `formatChordLabel` (lines 394-397) with:

```ts
/**
 * Standard display name for a chord, e.g. ('C', 'maj') -> 'C', ('A', 'min7') -> 'Am7'.
 *
 * `key` is optional and is the ONLY place spelling enters a chord label. The
 * resolvers keep returning canonical sharp roots — an `Eb` would match no
 * <option> in SortableChordCard's ROOTS-built select, would sit beside a note
 * list generateBlockChordNotes spelled with sharps, and would be persisted into
 * ChordItem.root. Spelling is a label, never an identity.
 */
export function formatChordLabel(root: string, quality: string, key?: SpellingKey): string {
  const spelled = key
    ? spellPitchClassInKey(rootSemitone(root), key.scaleRoot, key.scaleType)
    : root;
  return spelled + formatChordQuality(quality);
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `bun test src/utils/musicTheory.test.ts && bun run lint`
Expected: PASS and exit 0.

- [ ] **Step 5: Migrate `PlayheadReadout.tsx`**

Add two selectors after line 16 (`const meterId = …`):

```ts
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
```

and replace lines 36-37:

```tsx
        now={formatChordLabel(now.root, now.quality, { scaleRoot, scaleType })}
        next={next ? formatChordLabel(next.root, next.quality, { scaleRoot, scaleType }) : null}
```

Note the hook-order rule: both `useAppStore` calls must sit **above** the `if (!now) return null;` early return at line 19.

- [ ] **Step 6: Migrate `ui/Keyboard.tsx`**

`getChordKeyboardRows(root, scaleType, octaveOffset)` already has both values. Replace line 338:

```ts
      label: formatChordLabel(chordRoot, quality, { scaleRoot: root, scaleType }),
```

`notes:` on the next line still comes from `generateBlockChordNotes(quality, chordRoot, triadOctave)` — sharp, unchanged. Do not touch it.

- [ ] **Step 7: Migrate `loop/ChordView.tsx`**

`scaleRoot` and `scaleType` are already read at lines 144-145. Add near them:

```ts
  const spellingKey = useMemo(() => ({ scaleRoot, scaleType }), [scaleRoot, scaleType]);
```

Then pass `spellingKey` as the third argument at each of lines 317, 759, 765, 827, 833:

```tsx
      chords.map((c) => formatChordLabel(c.root, c.quality, spellingKey)).join(" → "),
```
```tsx
                  title={`Click to add ${formatChordLabel(diatonic.root, diatonic.quality, spellingKey)} (${diatonic.degreeName})`}
```
```tsx
                    {formatChordLabel(diatonic.root, diatonic.quality, spellingKey)}
```
```tsx
                  title={`Click to add ${borrowed.label}: ${formatChordLabel(borrowed.root, borrowed.quality, spellingKey)}`}
```
```tsx
                    {formatChordLabel(borrowed.root, borrowed.quality, spellingKey)}
```

- [ ] **Step 8: Migrate `loop/ChordPresetLibrary.tsx`**

`scaleRoot` and `scaleType` arrive as props (lines 54-55, 81-82). Thread `{ scaleRoot, scaleType }` into the four label sites — 221, 331, 388, 526:

```tsx
        : currentChords.map((c) => formatChordLabel(c.root, c.quality, { scaleRoot, scaleType })).join(' → ')
```
```tsx
    const previewNames = resolvedChords.map((c) => formatChordLabel(c.root, c.quality, { scaleRoot, scaleType })).join(' → ');
```
```tsx
    const previewNames = resolvedCustom.map((c) => formatChordLabel(c.root, c.quality, { scaleRoot, scaleType })).join(' → ');
```
```tsx
            text: currentChords.map((c) => formatChordLabel(c.root, c.quality, { scaleRoot, scaleType })).join(' → '),
```

If any of these sit in a subcomponent that does not receive both props, add `scaleRoot: string` / `scaleType: string` to that subcomponent's prop type and pass them from the parent — do not reach for the store inside a presentational child.

Then spell the four raw key displays in the same file, so a row cannot read `In A#: Bbmaj7 → …`. Replace `{scaleRoot}` with `{getTonicSpelling(scaleRoot, scaleType)}` at lines 306, 352, 416 and in the `headerSubtitle` template at line 501:

```tsx
              Key: {getTonicSpelling(scaleRoot, scaleType)}
```
```tsx
              In {getTonicSpelling(scaleRoot, scaleType)}: <span className="text-base-content font-semibold">{previewNames}</span>
```
```tsx
              In {getTonicSpelling(scaleRoot, scaleType)} {scaleType}: <span className="text-base-content font-semibold">{previewNames}</span>
```
```tsx
        headerSubtitle={`Key of ${getTonicSpelling(scaleRoot, scaleType)} • ${entries.length} Total Progressions`}
```

Add `import { getTonicSpelling } from '@/utils/noteSpelling';` to the file. Line 306's subcomponent may need `scaleType` threaded in for this — add the prop if so.

- [ ] **Step 9: Confirm no resolver started spelling**

```bash
bun test src/utils/diatonicCharacterization.test.ts
git status --porcelain src/utils/diatonicCharacterizationFixture.ts
grep -rn "spellPitchClassInKey\|getTonicSpelling\|spellScaleNotes" src/utils/musicTheory.ts
```

Expected: PASS; the `git status` prints nothing; and the grep prints exactly one line — the `import` — plus the single use inside `formatChordLabel`. If `getDiatonicChordForDegree`, `getBorrowedChords`, `transposeProgression`, `snapProgressionToScale` or `generateBlockChordNotes` appears anywhere near a spelling call, stop.

- [ ] **Step 10: Full gate**

Run: `bun run verify`
Expected: exit 0, zero eslint errors. The default session is `A` / `Natural Minor`, which spells with no accidentals at all, so **no existing rendered-markup test should move**. If one does, read it before changing it.

- [ ] **Step 11: Commit**

```bash
git add src/utils/musicTheory.ts src/utils/musicTheory.test.ts src/components/PlayheadReadout.tsx src/components/ui/Keyboard.tsx src/components/loop/ChordView.tsx src/components/loop/ChordPresetLibrary.tsx
git commit -m "feat(ui): spell chord labels in the active key" -m "formatChordLabel gains an optional third parameter, so call sites migrate one
at a time and an un-migrated one keeps today's output. All twelve migrated
here, plus the four raw key displays in ChordPresetLibrary so a preview row
cannot read 'In A#: Bbmaj7'.

The resolvers are untouched: getDiatonicChordForDegree, getBorrowedChords,
transposeProgression, snapProgressionToScale and generateBlockChordNotes all
still return canonical sharp roots. SortableChordCard builds its root select
from ROOTS, generateBlockChordNotes maps names back through ROOTS, and
ChordItem.root is persisted — spelling is a label, never an identity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 6: Spelling into the melody grid, the keyboard and the key picker

The three remaining display surfaces. The row-identity trap is the whole risk here.

**Files:**
- Modify: `src/components/loop/lead/melodyGrid.ts` (add `leadRowLabel`; `leadPitchRows` unchanged)
- Modify: `src/components/loop/lead/melodyGrid.test.ts`
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx:594` and its `title` on the line above
- Modify: `src/components/ui/Keyboard.tsx:99-102` (`noteAt`) and `:352-355` (`melodyRow`)
- Modify: `src/components/ui/Keyboard.test.ts` (add the scale-locked caption test)
- Modify: `src/components/Header.tsx:90` (export `ScaleSelects`) and `:110-114` (the options)
- Modify: `src/components/Header.test.tsx`

**Interfaces:**
- Consumes: `spellNoteInKey(note: string, rootNote: string, scaleType: string): string` and `KEY_OPTIONS: readonly { value: string; label: string }[]` from `@/utils/noteSpelling`; `LeadMelodyView` from `store/types`.
- Produces: `leadRowLabel(note: string, view: LeadMelodyView, root: string, scaleType: string): string` from `src/components/loop/lead/melodyGrid.ts`.

- [ ] **Step 1: Write the failing melody-grid test**

Append to `src/components/loop/lead/melodyGrid.test.ts`:

```ts
describe('leadRowLabel', () => {
  test('spells a scale-locked row in the key', () => {
    expect(leadRowLabel('D#4', 'scale', 'A#', 'Major')).toBe('Eb4');
    expect(leadRowLabel('A#4', 'scale', 'A#', 'Major')).toBe('Bb4');
  });

  test('leaves chromatic rows on the sharp names — the chromatic view is key-agnostic', () => {
    expect(leadRowLabel('D#4', 'chromatic', 'A#', 'Major')).toBe('D#4');
  });

  test('the ROW ITSELF never changes, whatever the label says', () => {
    // The row string is an IDENTITY: it keys `kinds`, it is the argument
    // previewNote plays, it is the value written into LeadNote.note (which is
    // persisted), and isRootNote compares it against a sharp ROOTS value. A
    // spelled row name would write a spelled note into persisted state and
    // would silently lose the tonic highlight.
    const rows = leadPitchRows('scale', 'A#', 'Major', 4, 1);
    expect(rows).toContain('A#4');
    expect(rows.some((r) => r.includes('b'))).toBe(false);
    expect(isRootNote('A#4', 'A#')).toBe(true);
  });
});
```

Add `leadRowLabel`, `leadPitchRows` and `isRootNote` to the file's import from `./melodyGrid`.

- [ ] **Step 2: Run it and see it fail**

Run: `bun test src/components/loop/lead/melodyGrid.test.ts`
Expected: FAIL — `Export named 'leadRowLabel' not found in module '.../melodyGrid.ts'`.

- [ ] **Step 3: Implement `leadRowLabel`**

In `src/components/loop/lead/melodyGrid.ts`, add to the imports:

```ts
import { spellNoteInKey } from '@/utils/noteSpelling';
```

and add immediately below `leadPitchRows`:

```ts
/**
 * The LABEL for a pitch row — and only the label.
 *
 * `leadPitchRows` returns identities: LeadMelodyGrid uses those exact strings
 * as `kinds.get(note)` map keys, as `previewNote(note)` arguments, and as the
 * values written into `LeadNote.note`, which is persisted. `isRootNote`
 * compares them against a sharp ROOTS value, so a flat row name also loses the
 * tonic highlight. Spelling therefore lands here and nowhere else.
 *
 * Chromatic rows stay sharp: the chromatic view is a key-agnostic ladder of
 * twelve semitones, not a reading of the key.
 */
export function leadRowLabel(
  note: string,
  view: LeadMelodyView,
  root: string,
  scaleType: string,
): string {
  return view === 'chromatic' ? note : spellNoteInKey(note, root, scaleType);
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `bun test src/components/loop/lead/melodyGrid.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the label in `LeadMelodyGrid.tsx`**

Add `leadRowLabel` to the import from `./melodyGrid` (near line 24). Then in the row-button block at lines 588-597, replace the `title` and the child:

```tsx
                {rows.map((note) => (
                  <button
                    key={note}
                    type="button"
                    onClick={() => previewNote(note)}
                    title={`Preview ${leadRowLabel(note, leadMelodyView, scaleRoot, scaleType)}`}
                    className="h-5 flex items-center justify-end pr-2 text-[10px] font-mono leading-none text-base-content/60 hover:text-base-content cursor-pointer"
                  >
                    {leadRowLabel(note, leadMelodyView, scaleRoot, scaleType)}
                  </button>
                ))}
```

`key={note}`, `onClick={() => previewNote(note)}` and every other use of `note` in this file stay on the identity. `leadMelodyView`, `scaleRoot` and `scaleType` are already read at lines 364, 373-374.

**Do not add a component-level assertion for this in `LeadMelodyGrid.test.tsx`.** Under `renderToString`, zustand serves `getServerSnapshot` from creation-time state, so `useAppStore.setState({ scaleRoot: 'A#' })` before the render has no effect — and the default session (`A` / `Natural Minor`) spells with no accidentals, so the rendered markup cannot demonstrate spelling at all. `leadRowLabel` is the pure helper the behaviour lives in; the Step 1 test is the coverage.

- [ ] **Step 6: Write the failing keyboard-caption test**

Append to `src/components/ui/Keyboard.test.ts` (note: `.ts`, not `.tsx` — it is a pure-logic suite with no JSX, and the snippet below adds none):

```ts
describe('scale-locked captions spell in the key', () => {
  test('label spells, note stays sharp', () => {
    const { topRow } = getScaleLockedKeyboardNotes('A#', 'Major', 0);
    expect(topRow[0].note).toBe('A#4');
    expect(topRow[0].label).toBe('Bb4');
  });

  test('KEYBOARD_NOTES is key-agnostic and stays sharp', () => {
    // A binding table of 18 chromatic KeyboardEvent.codes, C3-F4, that
    // scripts/check-key-bindings.ts pins. It does not change when the key does.
    expect(KEYBOARD_NOTES.map((k) => k.note)).toContain('C#3');
    expect(KEYBOARD_NOTES.every((k) => !k.note.includes('b'))).toBe(true);
  });
});
```

Add `getScaleLockedKeyboardNotes` and `KEYBOARD_NOTES` to that file's imports from `./Keyboard`.

- [ ] **Step 7: Run it and see it fail**

Run: `bun test src/components/ui/Keyboard.test.ts -t "label spells"`
Expected: FAIL — `Expected: "Bb4", Received: "A#4"`.

- [ ] **Step 8: Spell the two caption sites in `Keyboard.tsx`**

Add to that file's imports:

```ts
import { spellNoteInKey } from '@/utils/noteSpelling';
```

Replace `noteAt` (lines 99-102) inside `getScaleLockedKeyboardNotes`:

```ts
  const noteAt = (step: number): ScaleKeyboardNote => {
    const note = scaleStepNote(tonicPitch, scaleSemitones, scaleLength, step);
    // `note` is the identity the engine plays; `label` is what the cap reads.
    return { note, label: spellNoteInKey(note, root, scaleType), key: '', isBlack: false };
  };
```

Replace `melodyRow` (lines 352-355) inside `getChordKeyboardRows`:

```ts
  const melodyRow: ChordKeyboardButton[] = MELODY_KEYS.map((key, i) => {
    const note = scaleStepNote(melodyTonicPitch, scaleSemitones, scaleLength, i);
    return { key, label: spellNoteInKey(note, root, scaleType), notes: [note] };
  });
```

`getScaleNotes` at lines 89 and 346 and `scaleSemitonesFor` at line 73 stay exactly as they are — `scaleSemitonesFor` does `ROOTS.indexOf(n)` on `getScaleNotes`' output and a flat name would silently yield `-1`. `KEYBOARD_NOTES` is untouched.

- [ ] **Step 9: Run and see it pass, plus the binding guard**

Run: `bun test src/components/ui/Keyboard.test.ts && bun run check:keys`
Expected: PASS and exit 0.

- [ ] **Step 10: Write the failing key-picker test**

The two master scale selects live in `ScaleSelects` (`src/components/Header.tsx:90`), which is currently module-private. Export it — `Header.test.tsx` already imports named exports (`ProjectNameLabel`, `TabButton`, …) rather than the `Header` root, and this follows that pattern:

```ts
const ScaleSelects: React.FC<{ idPrefix: string; stacked?: boolean }> = ({
```
becomes
```ts
export const ScaleSelects: React.FC<{ idPrefix: string; stacked?: boolean }> = ({
```

Then append to `src/components/Header.test.tsx`:

```tsx
describe('key picker', () => {
  test('offers the dual label while storing the sharp name', () => {
    const html = renderToString(<ScaleSelects idPrefix="test" />);
    expect(html).toContain('<option value="C#">C#/Db</option>');
    expect(html).toContain('<option value="C">C</option>');
  });
});
```

Add `ScaleSelects` to the existing `from './Header'` import on line 4. `KEY_OPTIONS` is a module constant, so this assertion is independent of store state and the `getServerSnapshot` trap does not apply — the `value={scaleRoot}` attribute will render the store's creation-time root, which this test does not assert on.

- [ ] **Step 11: Run it and see it fail**

Run: `bun test src/components/Header.test.tsx -t "dual label"`
Expected: FAIL — the rendered markup contains `<option value="C#">C#</option>`.

- [ ] **Step 12: Implement the picker**

In `src/components/Header.tsx`, add:

```ts
import { KEY_OPTIONS } from '@/utils/noteSpelling';
```

and replace lines 110-114:

```tsx
        {KEY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
```

`value` stays the canonical sharp name, so `setScaleRoot` writes exactly what it wrote before and the persisted contract is unchanged. The label reads `C#/Db` regardless of scale, so the picker never has to explain why the same button reads differently after a scale change. If `ROOTS` becomes unused in this file, remove the import.

- [ ] **Step 13: Run it and see it pass**

Run: `bun test src/components/Header.test.tsx`
Expected: PASS.

- [ ] **Step 14: Full gate**

Run: `bun run verify`
Expected: exit 0, zero eslint errors, `check:keys` green.

- [ ] **Step 15: Commit**

```bash
git add src/components/loop/lead/melodyGrid.ts src/components/loop/lead/melodyGrid.test.ts src/components/loop/lead/LeadMelodyGrid.tsx src/components/ui/Keyboard.tsx src/components/ui/Keyboard.test.ts src/components/Header.tsx src/components/Header.test.tsx
git commit -m "feat(ui): spell the melody grid, the keyboard caps and the key picker" -m "leadRowLabel spells the rendered row label and nothing else: leadPitchRows
still returns identities, which key \`kinds\`, are what previewNote plays, are
written into the persisted LeadNote.note, and are what isRootNote compares
against a sharp ROOTS value.

Keyboard caps spell \`label\` while \`note\` stays sharp — scaleSemitonesFor does
ROOTS.indexOf() on getScaleNotes' output, so a flat name there would yield -1
with no throw. KEYBOARD_NOTES is untouched: it is a key-agnostic binding
table that check:keys pins.

The key picker adopts the dual label; \`value\` is still the sharp name.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

### Task 7: Docs, and the final gate

The derivation rule and the sharp-identity/spelled-display split belong where a reader hits them **before** editing `SCALES`.

**Files:**
- Modify: `.claude/skills/music-theory/SKILL.md:26-28,42-43`
- Modify: `CLAUDE.md` (add a paragraph to the Architecture section)

**Interfaces:**
- Consumes: nothing at runtime. Both documents must describe `resolveDegreeQuality`, `parentDegreesFor`, `spellScaleNotes`, `spellNoteInKey`, `KEY_OPTIONS` and `ScaleDefinition`'s `{ name, category, intervals, tonal, parent?, tonality }` shape exactly as Tasks 2-6 defined them.
- Produces: nothing.

- [ ] **Step 1: Fix the SKILL's "hand-authored table" claim**

In `.claude/skills/music-theory/SKILL.md`, replace lines 26-28:

```markdown
The one deliberately hand-authored table is `SCALES` — semitone intervals plus per-degree
`triadQualities` / `seventhQualities`, which `tonal` does not provide. Chord *spelling* still goes
through `tonal`.
```

with:

```markdown
`SCALES` states `intervals` (a literal a reader can check by eye, pinned to `tonal` by
`src/data/scales.test.ts`), the `tonal` scale name that spells it, its `tonality` spelling
convention, and — for scales with fewer than seven degrees — the 7-note `parent` whose harmony it
borrows. Per-degree chord qualities are **derived**, not stated:
`resolveDegreeQuality(scaleType, degree, use7ths)` in `utils/musicTheory.ts` maps a degree to a
parent degree **by semitone offset** (never by index — `degree % 7` would make Minor Pentatonic
degree 1 resolve as the parent's ii°), stacks thirds over the parent's spelled note names and
measures with `Interval.distance`. An unmapped interval tuple **throws**. There are **no
overrides**: if the derivation is wrong for a scale the fix is the derivation or the `parent`, and
a specific chord at a specific degree belongs in a `CHORD_PROGRESSIONS` step's explicit `quality`.
```

- [ ] **Step 2: Fix the SKILL's Hirajoshi sentence**

Replace lines 42-43 of the same file:

```markdown
`Hirajoshi` is `[0, 2, 3, 7, 8]` with hand-authored qualities inherited from natural minor, except
degree 3 which is `sus4` / `7sus4` — the open-fourth koto sound, and entirely inside the five notes.
```

with:

```markdown
`Hirajoshi` is `[0, 2, 3, 7, 8]` with `parent: 'Natural Minor'` — a strict subset of it at degrees
1, 2, 3, 5, 6. Degree 3 was once a hand-written `sus4` / `7sus4` deviation and is now `min` /
`min7`: a five-note scale with two major-third gaps is one most of whose diatonic chords reach
outside it, which is a fact about the scale, not a defect.
```

- [ ] **Step 3: Add the spelling section to the SKILL**

Immediately after the `ROOTS` line in the "Scales and roots" section (currently line 32), insert:

```markdown
**Sharp is the identity; spelling is a label.** `ROOTS` is twelve sharp-spelled pitch classes and
every *generated* and every *stored* note name is one of them — `getScaleNotes`,
`generateBlockChordNotes`, `getDiatonicChordForDegree`, `getBorrowedChords`,
`transposeProgression`, `snapProgressionToScale`, `leadPitchRows`, `KEYBOARD_NOTES`. Display goes
through `utils/noteSpelling.ts` instead: `spellScaleNotes(root, scaleType)`,
`spellNoteInKey(note, root, scaleType)`, `getTonicSpelling`, `formatChordLabel`'s optional third
parameter, and `KEY_OPTIONS` for the key picker. Nothing spelled is ever persisted, which is why
the whole spelling change needed no persist-version and no `.solna` format bump. Two traps:
`ui/Keyboard.tsx` does `ROOTS.indexOf()` on `getScaleNotes`' output, so a flat name there yields
`-1` silently; and the lead grid's row strings are identities that key `kinds`, drive
`previewNote` and are written into the persisted `LeadNote.note`, so only `leadRowLabel` spells.
```

- [ ] **Step 4: Add the rule to `CLAUDE.md`**

In `CLAUDE.md`, insert a paragraph in the Architecture section immediately after the paragraph ending "…which is what keeps every data file an independent leaf." (the `src/utils/` layering paragraph):

```markdown
**A per-degree chord quality is derived, and a note name is spelled only where it is read.**
`SCALES` states `intervals` — content a reviewer can check by eye, pinned to `tonal` by
`src/data/scales.test.ts` — plus `tonal`, `tonality` and, for scales under seven degrees, a
7-note `parent`. It states no chord qualities: `resolveDegreeQuality` derives them by mapping a
degree onto a parent degree **by semitone offset**, stacking thirds over the parent's spelled
names and measuring with `Interval.distance`. Indexing `degree % 7` into the parent is the trap —
it would make Minor Pentatonic's ♭III resolve as the parent's ii°, with the right shape, the right
length and only the sound wrong. An unmapped interval tuple throws rather than falling back to
`maj`, and **there are no overrides**: an override field is the shortcut people reach for instead
of fixing the derivation, which is exactly how two of eleven entries came to contradict the
table's own stated rule with nothing failing. Separately, **a sharp name is an identity and a
spelled name is a label.** Everything generated, computed or persisted is `ROOTS`-spelled;
`src/utils/noteSpelling.ts` spells for display only, at `formatChordLabel`'s optional third
parameter, the lead grid's `leadRowLabel`, the keyboard's `label` field and the key picker's
`KEY_OPTIONS`. Nothing spelled is persisted, so spelling never moves a persist `version` or a
`.solna` `formatVersion`.
```

- [ ] **Step 5: Check the docs against the code they describe**

```bash
grep -n "triadQualities\|seventhQualities" -r src/ scripts/ docs/superpowers/plans/ .claude/ CLAUDE.md
```

Expected: matches only inside `docs/superpowers/specs/2026-09-07-music-theory-derivation-design.md`, `docs/superpowers/plans/2026-09-07-music-theory-derivation.md` and any historical doc that describes the state *before* this change. **No match in `src/`, `scripts/`, `CLAUDE.md` or `.claude/skills/`.**

- [ ] **Step 6: Final gate**

Run: `bun run verify`
Expected: exit 0. Zero eslint errors. Build succeeds.

- [ ] **Step 7: Review the whole branch diff against the negative assertion**

```bash
git diff main...HEAD --stat
```

Expected: the only pitch-bearing fixtures that moved across the whole branch are `src/utils/diatonicCharacterizationFixture.ts` (48 of 264 keys) and `src/store/instantVibesChordsFixture.ts` (one line). If any bass, drum, sequencer, lead, project-format or migration fixture appears in that stat, the derivation reached further than the spec says it does — investigate before merging.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md .claude/skills/music-theory/SKILL.md
git commit -m "docs: record the derivation rule and the sharp-identity/spelled-display split" -m "The SKILL's 'one deliberately hand-authored table' claim and its Hirajoshi
sus4 sentence both described a table that no longer exists. CLAUDE.md gains
the rule a reader needs BEFORE editing SCALES: qualities are derived by
semitone-offset parent mapping, degree % 7 is the trap, there are no
overrides, and a sharp name is an identity while a spelled name is a label.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Self-review record

**Spec coverage.** Part 1 (`ScaleDefinition` shape, `intervals` stays a literal, the `tonal` pin, why `tonality` lives in data, no overrides) → Task 2. Part 2 (`resolveDegreeQuality`, the five-step algorithm, the `degree % 7` trap, ties, memoization) → Task 2. Part 3's measurements (nine scales reproduce, Blues at four degrees, Hirajoshi degree 3, the purity table, the spelling counts) → asserted in Tasks 2, 3 and 4 rather than trusted. Part 4 (the module, render-time-only, why resolvers do not return spelled roots, where spelling lands, the three traps) → Tasks 4, 5, 6. Consequent edits: Zen golden, three `roman`s, two descriptions, `scales.ts` comments, `chordProgressions.migration.test.ts:123`, the deleted length assertions, the `getBorrowedChords` measurement → all Task 3; `SKILL.md` and `CLAUDE.md` → Task 7. Testing section: characterization first → Task 1; three `scales.test.ts` assertions → Task 2; the 132-pair spelling snapshot → Task 4; the negative assertion → Task 3 Step 15 and Task 7 Step 7. Commit sequence: the spec's commit 2 is split into Tasks 2 and 3 — the resolver can be reviewed on its own evidence (it reproduces the arrays while both exist, which is only provable in that intermediate state), and Task 3 keeps every data edit in one commit exactly as the spec requires.

**No gaps found.** One addition beyond the spec's literal list: `ChordPresetLibrary.tsx`'s four raw `{scaleRoot}` displays (Task 5, Step 8), which the spec does not enumerate but whose omission would print `In A#: Bbmaj7 → …` on one row. It is a separate, rejectable step.

**Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling". Every code step carries real code; the only prose-only steps are shell commands with their exact expected output.

**Type consistency.** `resolveDegreeQuality`, `parentDegreesFor`, `resolveParentDegreeQuality`, `spellPitchClassInKey`, `spellMidiInKey`, `spellNoteInKey`, `spellScaleNotes`, `getTonicSpelling`, `getKeyAccidental`, `KEY_OPTIONS`, `SpellingKey`, `leadRowLabel`, `DIATONIC_CHARACTERIZATION`, `SPELLING_CHARACTERIZATION` are each defined once and used under the same name and signature everywhere later.
</content>
</invoke>
