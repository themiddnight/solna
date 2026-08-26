# Progression Library as Degrees + Auto-Harmonize Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 22 interval-form chord-progression templates with one degree-form library that both `ChordPresetLibrary` and (later) B2's dice read, prove the migration changed no progression's sound, and split the auto-harmonize function into the transpose and snap operations it was conflating — so changing the key transposes instead of scrambling the progression.

**Architecture:** Three layers, in dependency order. `src/utils/musicTheory.ts` gains the `Hirajoshi` scale and the two pure functions `transposeProgression` / `snapProgressionToScale` that replace `reharmonizeProgressionToScale`. `src/audio/data/chordProgressions.ts` is rewritten as `CHORD_PROGRESSIONS: ChordProgression[]` — scale degrees plus optional quality overrides — with `resolveProgression()` turning degrees into `ChordItem`s through `getDiatonicChordForDegree` and `deriveChordNotes`. `src/components/` then picks the right operation per call site: `ChordView`'s effect through the new pure `applyKeyScaleChange`, `ChordPresetLibrary` through `resolveProgression` plus a `minScaleLength` filter. `VibeGenre` is declared in `src/types.ts` (a leaf) and re-exported from `chordProgressions.ts`.

**Tech Stack:** Bun (test runner + scripts), Vite, React 18, Zustand (`subscribeWithSelector` + `persist`), `tonal` for note/interval/chord math, raw Web Audio API, Tailwind v4 + daisyUI v5 (CSS-first, no `tailwind.config.*`).

**Spec:** `docs/superpowers/specs/2026-08-26-progression-library-degrees-design.md`

## Global Constraints

- **Layering (enforced by eslint `no-restricted-imports`):** `src/audio/` must not import `store/` or `components/`. `src/store/` must not import `components/`. `src/components/` must not import `audio/engine` — only the `audio/playback/playbackEngine.ts` bridge. `src/store/` importing `src/audio/` IS allowed. `src/audio/data/chordProgressions.ts` importing `src/utils/musicTheory.ts` and `src/types.ts` is allowed: the rule restricts `src/audio/**` only from `**/store/**` and `**/components/**`.
- **Never call engine setters from a component.** Store-state → engine sync lives in `src/store/engineSync.ts`; event-driven playback goes through `playbackEngine.ts`. This project adds no engine call at all.
- **Theme tokens only.** `scripts/themeTokenGuard.ts` bans raw hex, Tailwind palette classes (`indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), `text-white`/`bg-black`, the `dark:` variant, `rgb()`/`rgba()`, and dead utilities (`py-0.2`, `scale-102`, `z-60`, `xs:`). Its `ALLOWLIST` is empty and must stay empty.
- **Look up daisyUI v5 docs before writing any daisyUI class.** A class that does not exist in v5 emits no CSS and fails silently; the theme guard does not catch invented names. Use context7 (`resolve-library-id` → `query-docs`). Only Task 7 adds markup, and only a category chip.
- **Tests are pure-logic `bun:test`.** No DOM or testing-library setup. Components export their testable helpers and tests import those. `renderToString` cannot observe `useAppStore.setState` under zustand v5 (`getServerSnapshot` reads `getInitialState()`), so nothing here asserts store-driven markup.
- **Gate:** `bun run verify` (test + lint + check:keys + check:drums + build), and `bun run eslint` separately — `verify` does not include it and this work changes import lists in five files.
- **Theory lives in `src/utils/musicTheory.ts` (pure).** Use `tonal` for note/interval/chord math — never hand-rolled semitone tables.
- **`SCALES` is the one deliberately hand-authored table**: semitone `intervals` plus per-degree `triadQualities` / `seventhQualities`. **Pentatonic, Blues and Hirajoshi have 5–6 degrees — never assume 7.** Loop `SCALES[scaleType].intervals.length`.
- **`deriveChordNotes()` is the single source of truth for `ChordItem.notes`.** Never build a `notes` array by hand.
- **The app has no users.** `reharmonizeProgressionToScale`, `ProgressionTemplate` and `CHORD_PROGRESSION_TEMPLATES` are deleted outright rather than aliased, and the persisted `scaleType: 'Pentatonic Major'` value is not migrated. No store version bump, no `partialize`/`migrate` change.
- **Hirajoshi is `[0, 2, 3, 7, 8]`**, `triadQualities: ['min', 'dim', 'maj', 'sus4', 'maj']`, `seventhQualities: ['min7', 'm7b5', 'maj7', '7sus4', 'maj7']`.
- **`VIBE_GENRE_SCALES`**: `lofi → Major`, `synthwave → Natural Minor`, `edm → Natural Minor`, `ambient → Lydian`, `boombap → Dorian`, `zen → Hirajoshi`. A progression may carry a genre tag only when its `referenceScale` equals that genre's scale.
- **Genre floor: four progressions per `VibeGenre`** (ruling R4). Final coverage is lofi 6, synthwave 4, edm 4, ambient 4, boombap 4, zen 4 across 40 entries (22 migrated + 18 new).

### Phases

The work is one spec but three commits' worth of surface. `bun run verify` **and** `bun run eslint` must both be green at each phase boundary before the next phase starts.

| phase | tasks | boundary |
| --- | --- | --- |
| 1 — theory | 1–2 | `Hirajoshi`, `transposeProgression`, `snapProgressionToScale` exist; every existing call site is mechanically ported with no behaviour change. |
| 2 — data | 3–5 | `CHORD_PROGRESSIONS` exists and the migration-equivalence proof passes across all 12 roots. |
| 3 — call sites | 6–9 | The five call sites, the `ChordView` guard, the `ChordPresetLibrary` filter, Zen Garden's scale, and the skill doc. |

**Phase 2 is the dangerous one:** a wrong degree changes a progression silently and nothing else fails. Task 3 therefore captures the fixture *while the original data still exists* and proves the copy is verbatim; Task 4 then proves the degrees reproduce that fixture in all 12 roots. Do not reorder those two tasks, and do not delete `CHORD_PROGRESSION_TEMPLATES` before Task 7.

---

### Task 1: Hirajoshi in `SCALES`, and export `TONAL_CHORD_ALIASES`

Additive. Nothing reads the new scale yet; the export is what Task 5's quality-validity test needs.

**Files:**
- Modify: `src/utils/musicTheory.ts:15-86` (the `SCALES` table), `:289` (the aliases const)
- Test: `src/utils/musicTheory.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `SCALES['Hirajoshi']`, `TONAL_CHORD_ALIASES` (now exported).

- [ ] **Step 1: Write the failing test**

Append to `src/utils/musicTheory.test.ts`:

```ts
describe('Hirajoshi', () => {
  test('is a five-degree World & Exotic scale on [0, 2, 3, 7, 8]', () => {
    const scale = SCALES['Hirajoshi'];
    expect(scale).toBeDefined();
    expect(scale.category).toBe('World & Exotic');
    expect(scale.intervals).toEqual([0, 2, 3, 7, 8]);
    expect(scale.triadQualities).toHaveLength(5);
    expect(scale.seventhQualities).toHaveLength(5);
  });

  test('is a strict subset of natural minor, at degrees 1, 2, 3, 5, 6', () => {
    // This is why the qualities are inherited from the parent 7-note scale,
    // exactly as Major/Minor Pentatonic already do.
    const parent = SCALES['Natural Minor'].intervals;
    for (const interval of SCALES['Hirajoshi'].intervals) {
      expect(parent).toContain(interval);
    }
  });

  test('getScaleNotes in G is G A A# D D#', () => {
    expect(getScaleNotes('G', 'Hirajoshi')).toEqual(['G', 'A', 'A#', 'D', 'D#']);
  });

  test('getDiatonicChordForDegree returns the authored table in C', () => {
    const rows = [
      { root: 'C', triad: 'min', seventh: 'min7', degreeName: 'i' },
      { root: 'D', triad: 'dim', seventh: 'm7b5', degreeName: 'ii' },
      { root: 'D#', triad: 'maj', seventh: 'maj7', degreeName: 'III' },
      { root: 'G', triad: 'sus4', seventh: '7sus4', degreeName: 'IV' },
      { root: 'G#', triad: 'maj', seventh: 'maj7', degreeName: 'V' },
    ];
    rows.forEach((row, degree) => {
      const triad = getDiatonicChordForDegree(degree, 'C', 'Hirajoshi', false);
      expect(triad).toEqual({ root: row.root, quality: row.triad, degreeName: row.degreeName });
      const seventh = getDiatonicChordForDegree(degree, 'C', 'Hirajoshi', true);
      expect(seventh.root).toBe(row.root);
      expect(seventh.quality).toBe(row.seventh);
    });
  });

  test('degrees 0, 3 and 4 are fully in-scale triads, and every other chord adds exactly one outside tone', () => {
    // Pinned as counts so a future re-authoring that makes them worse fails.
    const expectedTriadOutsiders = [0, 1, 1, 0, 0];
    const expectedSeventhOutsiders = [1, 1, 1, 1, 0];
    for (let degree = 0; degree < 5; degree++) {
      for (const [use7ths, expected] of [
        [false, expectedTriadOutsiders[degree]],
        [true, expectedSeventhOutsiders[degree]],
      ] as const) {
        const chord = getDiatonicChordForDegree(degree, 'C', 'Hirajoshi', use7ths);
        const outside = generateBlockChordNotes(chord.quality, chord.root, 4).filter(
          (note) => !isNoteInScale(note, 'C', 'Hirajoshi'),
        );
        expect(outside).toHaveLength(expected);
      }
    }
  });
});

describe('TONAL_CHORD_ALIASES', () => {
  test('is exported and every alias resolves to a chord tonal knows', () => {
    expect(TONAL_CHORD_ALIASES.min9).toBe('m9');
    for (const [app, tonalType] of Object.entries(TONAL_CHORD_ALIASES)) {
      expect(Chord.getChord(tonalType, 'C').empty).toBe(false);
      // The app token itself is the one tonal does NOT know — that is why the
      // alias exists, and why authored-quality validation must go through it.
      expect(app).not.toBe(tonalType);
    }
  });
});
```

Extend the file's existing import block to `import { Chord } from 'tonal';` and add `TONAL_CHORD_ALIASES`, `getScaleNotes` to the `./musicTheory` import.

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/utils/musicTheory.test.ts
```

Expected: FAIL — `SCALES['Hirajoshi']` is undefined and `TONAL_CHORD_ALIASES` is not exported.

- [ ] **Step 3: Add the scale**

In `src/utils/musicTheory.ts`, add as the last entry of `SCALES` (after `'Blues'`):

```ts
  'Hirajoshi': {
    name: 'Hirajoshi (Japanese)',
    category: 'World & Exotic',
    // 1, 2, b3, 5, b6 — step pattern 2-1-4-1-4, two half-steps and two major
    // thirds. Burrows/Wikipedia spelling, the one the koto references use.
    intervals: [0, 2, 3, 7, 8],
    // Stacking scale-steps on a scale with two major-third gaps does not give
    // tertian chords (degree 0 would be {0,3,8}). The repo's pentatonics solve
    // this by inheriting the parent 7-note scale's qualities; Hirajoshi is
    // natural minor at degrees 1, 2, 3, 5, 6 -> i, ii°, bIII, v, bVI.
    // One deliberate deviation: degree 3 is sus4/7sus4, not min/min7. The
    // parent's minor third reaches a semitone Hirajoshi does not contain,
    // while root-4th-5th (degrees 3, 4, 0) is entirely inside the five notes
    // and is the canonical open-fourth koto sound.
    triadQualities: ['min', 'dim', 'maj', 'sus4', 'maj'],
    seventhQualities: ['min7', 'm7b5', 'maj7', '7sus4', 'maj7'],
  },
```

- [ ] **Step 4: Export the aliases**

At `src/utils/musicTheory.ts:289`, change the declaration to:

```ts
// App quality names that differ from tonal's chord-type tokens (keys are lowercase — lookups use toLowerCase()).
// Exported so authored chord data can be validated against tonal in tests:
// generateBlockChordNotes falls back to `maj` on an unknown token, so a typo
// in a progression's quality is inaudible unless something checks it.
export const TONAL_CHORD_ALIASES: Record<string, string> = {
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test src/utils/musicTheory.test.ts
```

Expected: PASS. The file's existing "every scale key" sweeps now cover `Hirajoshi` too — if one of them assumed 7 degrees it fails here, which is the point.

- [ ] **Step 6: Commit**

```bash
git add src/utils/musicTheory.ts src/utils/musicTheory.test.ts
git commit -m "feat(theory): add the Hirajoshi scale and export TONAL_CHORD_ALIASES"
```

---

### Task 2: Split `reharmonizeProgressionToScale` into transpose and snap

The behaviour fix's foundation. `snapProgressionToScale` is today's body renamed — every existing call site is ported to it mechanically, so this task changes **no** behaviour. `transposeProgression` is new and, after this task, still has no caller: Task 6 is what makes the app use it.

**Files:**
- Modify: `src/utils/musicTheory.ts:211-259`
- Modify: `src/components/ChordView.tsx:61,178-190,695,722` (mechanical rename)
- Modify: `src/components/ChordPresetLibrary.tsx:12,143,155` (mechanical rename)
- Test: `src/utils/musicTheory.test.ts` (append)

**Interfaces:**
- Consumes: `ROOTS`, `rootSemitone`, `deriveChordNotes`, `getDiatonicChordForDegree`.
- Produces: `transposeProgression(chords, fromRoot, toRoot, octave?)`, `snapProgressionToScale(chords, root, scaleType, octave?)`. Removes `reharmonizeProgressionToScale`.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/musicTheory.test.ts`:

```ts
const chord = (id: string, root: string, quality: string, bars = 1): ChordItem =>
  deriveChordNotes({ id, root, quality, bars, notes: [] }, 4);

// A Natural Minor, i - VI - III - VII. The progression the spec measured.
const A_MINOR_PROGRESSION: ChordItem[] = [
  chord('c1', 'A', 'min'),
  chord('c2', 'F', 'maj'),
  chord('c3', 'C', 'maj'),
  chord('c4', 'G', 'maj'),
];

const names = (chords: ChordItem[]) => chords.map((c) => `${c.root}${c.quality}`);

describe('transposeProgression', () => {
  test('the measured case: A to C keeps the tonic first', () => {
    // Today's reharmonize turns this into G#maj - Fmin - Cmin - Gmin, moving
    // the tonic from position 1 to position 3. Transposition must not.
    expect(names(transposeProgression(A_MINOR_PROGRESSION, 'A', 'C', 4))).toEqual([
      'Cmin', 'G#maj', 'D#maj', 'A#maj',
    ]);
  });

  test('quality, bars and id are preserved verbatim', () => {
    const source = [chord('x1', 'D', 'min9', 2), chord('x2', 'G', '7sus4', 4)];
    const moved = transposeProgression(source, 'C', 'F#', 4);
    expect(moved.map((c) => c.id)).toEqual(['x1', 'x2']);
    expect(moved.map((c) => c.quality)).toEqual(['min9', '7sus4']);
    expect(moved.map((c) => c.bars)).toEqual([2, 4]);
  });

  test('every adjacent interval is preserved, for all 144 root pairs', () => {
    const gaps = (chords: ChordItem[]) =>
      chords.slice(1).map((c, i) => (rootSemitone(c.root) - rootSemitone(chords[i].root) + 12) % 12);
    for (const from of ROOTS) {
      for (const to of ROOTS) {
        expect(gaps(transposeProgression(A_MINOR_PROGRESSION, from, to, 4))).toEqual(
          gaps(A_MINOR_PROGRESSION),
        );
      }
    }
  });

  test('each chord keeps its scale degree in the new key', () => {
    const degreeOf = (chordRoot: string, keyRoot: string) =>
      SCALES['Natural Minor'].intervals.indexOf(
        (rootSemitone(chordRoot) - rootSemitone(keyRoot) + 12) % 12,
      );
    const moved = transposeProgression(A_MINOR_PROGRESSION, 'A', 'F#', 4);
    expect(moved.map((c) => degreeOf(c.root, 'F#'))).toEqual(
      A_MINOR_PROGRESSION.map((c) => degreeOf(c.root, 'A')),
    );
  });

  test('a slash bass moves with the chord and keeps its written octave', () => {
    // Pitch class only: a bass note that jumped a register on a key change
    // would leave the bass line, and it is what makes the round trip exact.
    const source = [{ ...chord('s1', 'C', 'maj'), bassNote: 'E4' }];
    expect(transposeProgression(source, 'C', 'D#', 4)[0].bassNote).toBe('G4');
    const nulled = [{ ...chord('s2', 'C', 'maj'), bassNote: null }];
    expect(transposeProgression(nulled, 'C', 'D', 4)[0].bassNote).toBeNull();
  });

  test('notes are re-derived at the requested octave', () => {
    const moved = transposeProgression(A_MINOR_PROGRESSION, 'A', 'C', 3);
    expect(moved[0].notes).toEqual(generateBlockChordNotes('min', 'C', 3));
  });

  test('round trips exactly for all 144 ordered root pairs', () => {
    for (const a of ROOTS) {
      for (const b of ROOTS) {
        expect(
          transposeProgression(transposeProgression(A_MINOR_PROGRESSION, a, b, 4), b, a, 4),
        ).toEqual(A_MINOR_PROGRESSION);
      }
    }
  });
});

describe('snapProgressionToScale', () => {
  // Golden values captured from reharmonizeProgressionToScale before the
  // rename: this proves the rename changed nothing, including the behaviour
  // that is wrong for a key change and correct for a scale change.
  const EXTENDED = [
    chord('e1', 'D', 'min9'),
    chord('e2', 'G', '7'),
    chord('e3', 'C', 'maj9'),
    chord('e4', 'F', 'maj7'),
  ];

  test('chords already in the target key and scale come back unchanged', () => {
    expect(names(snapProgressionToScale(EXTENDED, 'C', 'Major', 4))).toEqual([
      'Dmin9', 'G7', 'Cmaj9', 'Fmaj7',
    ]);
  });

  test('maj9 / min9 / 7sus4 / sus4 survive a snap into a five-note scale', () => {
    expect(names(snapProgressionToScale(EXTENDED, 'G', 'Major Pentatonic', 4))).toEqual([
      'Dmin9', 'Gmaj7', 'Bmaj9', 'Emin7',
    ]);
  });

  test('the old key-change behaviour is preserved verbatim under the new name', () => {
    expect(names(snapProgressionToScale(A_MINOR_PROGRESSION, 'C', 'Natural Minor', 4))).toEqual([
      'G#maj', 'Fmin', 'Cmin', 'Gmin',
    ]);
  });

  test('every output root is a degree of the target scale', () => {
    for (const root of ROOTS) {
      for (const scaleType of Object.keys(SCALES)) {
        const snapped = snapProgressionToScale(A_MINOR_PROGRESSION, root, scaleType, 4);
        for (const c of snapped) {
          expect(getScaleNotes(root, scaleType)).toContain(c.root);
        }
      }
    }
  });
});
```

Add `ROOTS`, `deriveChordNotes`, `rootSemitone`, `snapProgressionToScale`, `transposeProgression` to the `./musicTheory` import, and `import type { ChordItem } from '../types';`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/utils/musicTheory.test.ts
```

Expected: FAIL — neither function exists.

- [ ] **Step 3: Replace the function**

In `src/utils/musicTheory.ts`, replace the whole `reharmonizeProgressionToScale` block (`:211-259`, comment included) with:

```ts
/**
 * Moves a progression from one key to another. Every chord shifts by the same
 * interval, so scale degrees are preserved by construction and the tonic stays
 * where the user put it. `id`, `quality` and `bars` are untouched.
 *
 * This is the operation a ROOT change needs. It is not the operation a SCALE
 * change needs — see snapProgressionToScale.
 */
export function transposeProgression(
  chords: ChordItem[],
  fromRoot: string,
  toRoot: string,
  octave = 4,
): ChordItem[] {
  const shift = (rootSemitone(toRoot) - rootSemitone(fromRoot) + 12) % 12;
  return chords.map((chord) =>
    deriveChordNotes(
      {
        ...chord,
        root: ROOTS[(rootSemitone(chord.root) + shift) % 12],
        ...(chord.bassNote ? { bassNote: transposePitchClass(chord.bassNote, shift) } : {}),
      },
      octave,
    ),
  );
}

/**
 * Shifts a note's pitch class and keeps its written octave, so a slash bass
 * never jumps a register on a key change — and a transpose round trip is exact.
 * Returns the input unchanged when it is not a note name.
 */
function transposePitchClass(note: string, shift: number): string {
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)?$/);
  if (!match) return note;
  const shifted = ROOTS[(rootSemitone(match[1]) + shift) % 12];
  return match[2] === undefined ? shifted : `${shifted}${match[2]}`;
}

/**
 * Snaps each chord to the nearest diatonic degree of the given key/scale.
 * Body carried over verbatim from reharmonizeProgressionToScale, including the
 * maj9 / min9 / 7sus4 / sus4 quality-preservation clause.
 *
 * This is the operation a SCALE change needs. It measures the chords against
 * `root`, so it is only correct when they are already in that key — feeding it
 * chords from another key is the bug this split exists to remove. Two chords a
 * scale cannot distinguish still collapse onto one degree; that is inherent to
 * snapping and is why five-note scales lose the most.
 */
export function snapProgressionToScale(
  currentChords: ChordItem[],
  root: string,
  scaleType: string,
  octave = 4
): ChordItem[] {
  const newRootIndex = rootSemitone(root);
  const scale = SCALES[scaleType] || SCALES['Major'];

  return currentChords.map((chord, idx) => {
    // Find semitone distance of chord from previous context, or snap to nearest scale degree
    const currentRootIdx = rootSemitone(chord.root);
    const intervalFromNewRoot = (currentRootIdx - newRootIndex + 12) % 12;

    // Find closest degree in scale
    let bestDegree = 0;
    let minDiff = 999;
    scale.intervals.forEach((degInt, dIdx) => {
      const diff = Math.min(
        Math.abs(degInt - intervalFromNewRoot),
        12 - Math.abs(degInt - intervalFromNewRoot)
      );
      if (diff < minDiff) {
        minDiff = diff;
        bestDegree = dIdx;
      }
    });

    const diatonic = getDiatonicChordForDegree(bestDegree, root, scaleType, chord.quality.includes('7') || chord.quality.includes('9'));

    // Preserve custom qualities if user intentionally used extended qualities like maj9, 7sus4, otherwise use diatonic
    let targetQuality = diatonic.quality;
    if (chord.quality === 'maj9' || chord.quality === 'min9' || chord.quality === '7sus4' || chord.quality === 'sus4') {
      targetQuality = chord.quality;
    }

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

- [ ] **Step 4: Port the five existing call sites mechanically**

Rename only — no argument changes, no behaviour changes. Task 6 and Task 7 revisit the semantics.

In `src/components/ChordView.tsx`: change the import at `:61` from `reharmonizeProgressionToScale` to `snapProgressionToScale`, and the three calls at `:180`, `:695` and `:722` to `snapProgressionToScale(...)` with the same arguments. Leave `:200` (`handleApplyLibraryChords`) calling `snapProgressionToScale` too for now.

In `src/components/ChordPresetLibrary.tsx`: change the import at `:12` and the two calls at `:143` and `:155` the same way.

- [ ] **Step 5: Run the gate**

```bash
bun run verify && bun run eslint
```

Expected: PASS. This is the **phase 1 boundary** — do not start Task 3 until it is green.

- [ ] **Step 6: Commit**

```bash
git add src/utils/musicTheory.ts src/utils/musicTheory.test.ts src/components/ChordView.tsx src/components/ChordPresetLibrary.tsx
git commit -m "feat(theory): split reharmonize into transposeProgression and snapProgressionToScale"
```

---

### Task 3: Capture the migration fixture while the original data still exists

No production change. This task copies the 22 `relativeChords` arrays into a test fixture and proves — against the live `CHORD_PROGRESSION_TEMPLATES` — that the copy is verbatim. Everything Task 4 asserts rests on this fixture, so it is captured before anything is rewritten, not after.

**Files:**
- Test: `src/audio/data/chordProgressions.migration.test.ts` (create)

**Interfaces:**
- Consumes: `CHORD_PROGRESSION_TEMPLATES` (still the old interval form).
- Produces: the `ORIGINAL_TEMPLATES` fixture, and the id → old-entry mapping the rest of the migration depends on.

- [ ] **Step 1: Write the fixture and its self-check**

Create `src/audio/data/chordProgressions.migration.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { CHORD_PROGRESSION_TEMPLATES } from './chordProgressions';

/**
 * The 22 original interval-form templates, copied verbatim. `interval` is
 * semitones from the key root. This fixture outlives the data it was copied
 * from: Task 7 deletes CHORD_PROGRESSION_TEMPLATES, and this stays as the only
 * remaining record of what each progression used to sound like.
 *
 * `referenceScale` is the scale each progression's degrees are authored in —
 * the first scale in the preference order [Major, Natural Minor, Dorian,
 * Mixolydian, Lydian, Phrygian, Harmonic Minor] that contains every one of its
 * chord roots without collapsing two distinct chords onto one degree.
 */
interface OriginalTemplate {
  id: string;
  name: string;
  referenceScale: string;
  relativeChords: Array<{ interval: number; quality: string; bars: number }>;
}

const c = (interval: number, quality: string, bars = 1) => ({ interval, quality, bars });

export const ORIGINAL_TEMPLATES: OriginalTemplate[] = [
  { id: 'pop-i-v-vi-iv', name: 'Classic 4-Chord Pop Anthem', referenceScale: 'Major',
    relativeChords: [c(0, 'maj'), c(7, 'maj'), c(9, 'min'), c(5, 'maj')] },
  { id: 'pop-vi-iv-i-v', name: 'Emotional Minor Synthwave', referenceScale: 'Major',
    relativeChords: [c(9, 'min'), c(5, 'maj'), c(0, 'maj'), c(7, 'maj')] },
  { id: 'pop-doowop', name: 'Classic 50s Doo-Wop Cadence', referenceScale: 'Major',
    relativeChords: [c(0, 'maj'), c(9, 'min'), c(5, 'maj'), c(7, 'maj')] },
  { id: 'pop-future-bass', name: 'Future Bass / Euphoric EDM Lift', referenceScale: 'Major',
    relativeChords: [c(5, 'maj7'), c(7, '7'), c(4, 'min7'), c(9, 'min7')] },
  { id: 'pop-club-house', name: 'Club Dance & House Groove', referenceScale: 'Natural Minor',
    relativeChords: [c(0, 'min7'), c(8, 'maj7'), c(10, '7'), c(7, 'min7')] },
  { id: 'jazz-ii-v-i-vi', name: 'Jazz ii-V-I-VI Turnaround', referenceScale: 'Major',
    relativeChords: [c(2, 'min7'), c(7, '7'), c(0, 'maj7'), c(9, '7')] },
  { id: 'jazz-neosoul-butter', name: 'Neo-Soul Butter Flow', referenceScale: 'Major',
    relativeChords: [c(0, 'maj9'), c(11, 'm7b5'), c(4, '7'), c(9, 'min9')] },
  { id: 'jazz-chromatic-mediants', name: 'Chromatic Mediants / Giant Step Cycle', referenceScale: 'Phrygian',
    relativeChords: [c(0, 'maj7'), c(8, 'maj7'), c(1, 'maj7'), c(7, '7sus4')] },
  { id: 'lofi-coffeehouse', name: 'Lofi Extended 9th Coffeehouse', referenceScale: 'Major',
    relativeChords: [c(2, 'min9'), c(7, '7'), c(0, 'maj9'), c(5, 'maj7')] },
  { id: 'lofi-trapsoul', name: 'Contemporary R&B / Trap-Soul Flow', referenceScale: 'Natural Minor',
    relativeChords: [c(0, 'min9'), c(5, 'min7'), c(10, '9'), c(3, 'maj7')] },
  { id: 'lofi-bedroom-pop', name: 'Melancholy Bedroom Pop', referenceScale: 'Major',
    relativeChords: [c(0, 'maj7'), c(5, 'maj7'), c(2, 'min7'), c(7, '7')] },
  { id: 'jpop-royal-road', name: 'Royal Road / Oudo Cadence (王道進行)', referenceScale: 'Major',
    relativeChords: [c(5, 'maj7'), c(7, '7'), c(4, 'min7'), c(9, 'min7')] },
  { id: 'jpop-marusa', name: 'City Pop / Marusa Groove (丸サ進行)', referenceScale: 'Major',
    relativeChords: [c(5, 'maj7'), c(4, '7'), c(9, 'min7'), c(0, '7')] },
  { id: 'jpop-heroic', name: 'Heroic Anthem / J-Rock Drive', referenceScale: 'Major',
    relativeChords: [c(9, 'min'), c(5, 'maj'), c(7, 'maj'), c(0, 'maj')] },
  { id: 'blues-12bar', name: '12-Bar Blues Standard', referenceScale: 'Major',
    relativeChords: [c(0, '7', 2), c(5, '7'), c(0, '7'), c(7, '7'), c(5, '7'), c(0, '7', 2)] },
  { id: 'rock-mixolydian', name: 'Mixolydian Rock Anthem', referenceScale: 'Mixolydian',
    relativeChords: [c(0, 'maj'), c(10, 'maj'), c(5, 'maj'), c(0, 'maj')] },
  { id: 'rock-andalusian', name: 'Andalusian / Flamenco Descent', referenceScale: 'Natural Minor',
    relativeChords: [c(0, 'min'), c(10, 'maj'), c(8, 'maj'), c(7, '7')] },
  { id: 'cine-epic-ostinato', name: 'Epic Cinematic Ostinato', referenceScale: 'Natural Minor',
    relativeChords: [c(0, 'min'), c(8, 'maj'), c(3, 'maj'), c(10, 'maj')] },
  { id: 'cine-dorian-voyage', name: 'Dorian Space Voyage', referenceScale: 'Dorian',
    relativeChords: [c(0, 'min7'), c(5, '7'), c(0, 'min7'), c(5, '7')] },
  { id: 'cine-lydian-dream', name: 'Lydian Dreamscape', referenceScale: 'Lydian',
    relativeChords: [c(0, 'maj7'), c(2, 'maj'), c(0, 'maj7'), c(2, 'maj')] },
  { id: 'baroque-canon', name: 'Baroque Canon Cadence', referenceScale: 'Major',
    relativeChords: [c(0, 'maj'), c(7, 'maj'), c(9, 'min'), c(4, 'min'), c(5, 'maj'), c(0, 'maj'), c(5, 'maj'), c(7, 'maj')] },
  { id: 'baroque-passacaglia', name: 'Passacaglia / Circle of Fifths Descent', referenceScale: 'Natural Minor',
    relativeChords: [c(0, 'min'), c(5, 'min'), c(10, 'maj'), c(3, 'maj'), c(8, 'maj'), c(2, 'dim'), c(7, '7'), c(0, 'min')] },
];

describe('migration fixture', () => {
  test('is a verbatim copy of CHORD_PROGRESSION_TEMPLATES, entry for entry', () => {
    // Runs only while the original array still exists (deleted in Task 7).
    // Its whole job is to prove the copy before the original goes away.
    expect(ORIGINAL_TEMPLATES).toHaveLength(CHORD_PROGRESSION_TEMPLATES.length);
    ORIGINAL_TEMPLATES.forEach((original, i) => {
      const template = CHORD_PROGRESSION_TEMPLATES[i];
      expect(original.name).toBe(template.name);
      expect(original.relativeChords).toEqual(template.relativeChords);
    });
  });

  test('ids are unique and every progression has at least one chord', () => {
    expect(new Set(ORIGINAL_TEMPLATES.map((t) => t.id)).size).toBe(ORIGINAL_TEMPLATES.length);
    for (const t of ORIGINAL_TEMPLATES) {
      expect(t.relativeChords.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test**

```bash
bun test src/audio/data/chordProgressions.migration.test.ts
```

Expected: PASS. If it fails, the fixture was mistyped — fix the fixture, never the original.

- [ ] **Step 3: Commit**

```bash
git add src/audio/data/chordProgressions.migration.test.ts
git commit -m "test(progressions): capture the interval-form fixture before the degree migration"
```

---

### Task 4: Degree-form library, the 22 migrated progressions, and the equivalence proof

The dangerous task. `CHORD_PROGRESSIONS` is added **alongside** the old array (which Task 7 deletes once its last reader is gone), so the fixture self-check from Task 3 keeps running while the proof is built.

**Files:**
- Modify: `src/types.ts` (add `VibeGenre`)
- Modify: `src/audio/data/chordProgressions.ts` (add the degree-form module above the existing template array)
- Modify: `src/audio/data/chordProgressions.migration.test.ts` (add the equivalence proof)

**Interfaces:**
- Consumes: `getDiatonicChordForDegree`, `deriveChordNotes`, `SCALES`, `ChordItem`.
- Produces: `VibeGenre` (declared in `src/types.ts`), and from `chordProgressions.ts`: `ProgressionCategory`, `ProgressionStep`, `ChordProgression`, `CHORD_PROGRESSIONS`, `VIBE_GENRE_SCALES`, `progressionById`, `resolveProgression`, plus the `VibeGenre` re-export.

- [ ] **Step 1: Write the failing equivalence test**

Replace the imports of `src/audio/data/chordProgressions.migration.test.ts` and append the proof:

```ts
import { describe, expect, test } from 'bun:test';
import { CHORD_PROGRESSION_TEMPLATES, progressionById, resolveProgression } from './chordProgressions';
import { generateBlockChordNotes, ROOTS, rootSemitone } from '../../utils/musicTheory';
```

```ts
describe('migration equivalence: degree form reproduces interval form', () => {
  test('every progression, in every one of the 12 roots, resolves to the same chords', () => {
    // 22 progressions x 12 roots. Running all 12 rather than C alone is what
    // catches modulo and wrap mistakes; a single wrong degree fails here.
    for (const original of ORIGINAL_TEMPLATES) {
      const progression = progressionById(original.id);
      expect(progression).toBeDefined();
      if (!progression) continue;
      expect(progression.name).toBe(original.name);
      expect(progression.referenceScale).toBe(original.referenceScale);
      expect(progression.steps).toHaveLength(original.relativeChords.length);

      for (const root of ROOTS) {
        const resolved = resolveProgression(progression, root, progression.referenceScale, 4);
        expect(resolved).toHaveLength(original.relativeChords.length);
        original.relativeChords.forEach((rc, i) => {
          const expectedRoot = ROOTS[(rootSemitone(root) + rc.interval) % 12];
          expect({
            root: resolved[i].root,
            quality: resolved[i].quality,
            bars: resolved[i].bars,
            notes: resolved[i].notes,
          }).toEqual({
            root: expectedRoot,
            quality: rc.quality,
            bars: rc.bars,
            notes: generateBlockChordNotes(rc.quality, expectedRoot, 4),
          });
        });
      }
    }
  });

  test('an omitted quality means the reference scale said so, not that it was forgotten', () => {
    // The one way a step can silently disagree with the original: leaving the
    // quality out when the scale's triad for that degree is something else.
    for (const original of ORIGINAL_TEMPLATES) {
      const progression = progressionById(original.id);
      if (!progression) continue;
      progression.steps.forEach((step, i) => {
        if (step.quality === undefined) {
          expect(SCALES[progression.referenceScale].triadQualities[step.degree]).toBe(
            original.relativeChords[i].quality,
          );
        }
      });
    }
  });
});
```

Add `SCALES` to the `musicTheory` import.

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/audio/data/chordProgressions.migration.test.ts
```

Expected: FAIL — `progressionById` and `resolveProgression` do not exist.

- [ ] **Step 3: Declare `VibeGenre` in `src/types.ts`**

Add at the top of `src/types.ts`, above `ViewMode`:

```ts
/**
 * The six Instant Vibe genres. Declared here rather than in
 * audio/data/chordProgressions.ts (which re-exports it) because
 * `VibeVariation` in this file needs it while chordProgressions.ts already
 * imports `ChordItem` from here — declaring it there would make the two files
 * import each other. This file imports nothing and must stay a leaf.
 */
export type VibeGenre = 'lofi' | 'synthwave' | 'edm' | 'ambient' | 'boombap' | 'zen';
```

- [ ] **Step 4: Add the degree-form module**

In `src/audio/data/chordProgressions.ts`, replace the file's three-line header comment with this block, keeping `ProgressionTemplate` and `CHORD_PROGRESSION_TEMPLATES` **below it, untouched**:

```ts
// The shared chord-progression library, in degree form. ChordPresetLibrary and
// (from project B2) the vibe dice both read CHORD_PROGRESSIONS; nothing stores
// a progression as absolute semitones any more.
//
// Layering: this file is under src/audio/, which eslint restricts only from
// store/ and components/. Importing utils/musicTheory.ts and types.ts is
// allowed and deliberate — deriveChordNotes is the single source of truth for
// ChordItem.notes and must not be re-implemented here.

import type { ChordItem } from '../../types';
import { deriveChordNotes, getDiatonicChordForDegree } from '../../utils/musicTheory';

// Declared in src/types.ts, re-exported here so this stays the import site the
// shared B1/B2 interface pins.
export type { VibeGenre } from '../../types';
import type { VibeGenre } from '../../types';

export type ProgressionCategory =
  | 'Pop & EDM'
  | 'Jazz & Neo-Soul'
  | 'Lofi & R&B'
  | 'Rock & Blues'
  | 'Anime & J-Pop'
  | 'Cinematic & Modal'
  | 'Classical & Baroque'
  | 'Ambient & Zen';

export interface ProgressionStep {
  /** 0-based scale degree; wraps modulo the scale's own length. */
  degree: number;
  /**
   * Overrides the diatonic quality. **Omitted means the scale's own TRIAD for
   * that degree**, never the seventh — ProgressionStep has no use7ths flag, and
   * the two readings are silently different music. Genres whose identity is
   * extended harmony (lo-fi, boom bap) write their qualities out.
   */
  quality?: string;
  /** Bars this chord is held. 1 for lofi/boom bap, 2 for EDM, 4+ for ambient. */
  bars: number;
}

export interface ChordProgression {
  /** Stable identifier. Referenced by VibeVariation.progressionIds in B2. */
  id: string;
  name: string;
  /** Display-ready roman-numeral summary; true in `referenceScale`. B2 prints
   *  this verbatim in its reroll toast, so it must match the steps. */
  roman: string;
  description: string;
  /** Library chip in ChordPresetLibrary. */
  category: ProgressionCategory;
  /** The key of SCALES the degrees and qualities were authored against. */
  referenceScale: string;
  /** Which vibes may draw this progression. Empty = library-only. A tag is
   *  only valid when referenceScale === VIBE_GENRE_SCALES[tag]. */
  genres: VibeGenre[];
  /** Shortest scale this is valid in: SCALES[referenceScale].intervals.length.
   *  5 works in pentatonic and Hirajoshi; 7 needs a full diatonic scale. */
  minScaleLength: number;
  steps: ProgressionStep[];
}

/** Each genre's anchor scale. Scale type is genre identity and never varies. */
export const VIBE_GENRE_SCALES: Record<VibeGenre, string> = {
  lofi: 'Major',
  synthwave: 'Natural Minor',
  edm: 'Natural Minor',
  ambient: 'Lydian',
  boombap: 'Dorian',
  zen: 'Hirajoshi',
};

const step = (degree: number, bars = 1, quality?: string): ProgressionStep =>
  quality === undefined ? { degree, bars } : { degree, quality, bars };

export const CHORD_PROGRESSIONS: ChordProgression[] = [
  {
    id: 'pop-i-v-vi-iv',
    name: 'Classic 4-Chord Pop Anthem',
    roman: 'I – V – vi – IV',
    description:
      'The definitive major-scale pop progression creating an instantly uplifting and catchy flow.',
    category: 'Pop & EDM',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(4), step(5), step(3)],
  },
  {
    id: 'pop-vi-iv-i-v',
    name: 'Emotional Minor Synthwave',
    roman: 'vi – IV – I – V',
    description:
      'Moody, heroic, and emotional minor opening used widely in synthwave, EDM, and cinematic anthems.',
    category: 'Pop & EDM',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(5), step(3), step(0), step(4)],
  },
  {
    id: 'pop-doowop',
    name: 'Classic 50s Doo-Wop Cadence',
    roman: 'I – vi – IV – V',
    description:
      'Timeless vintage progression with warm, romantic, and circular harmonic resolution.',
    category: 'Pop & EDM',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(5), step(3), step(4)],
  },
  {
    id: 'pop-future-bass',
    name: 'Future Bass / Euphoric EDM Lift',
    roman: 'IVmaj7 – V7 – iiim7 – vim7',
    description:
      'Lush 7th chord cadence creating unstoppable momentum and euphoric drops.',
    category: 'Pop & EDM',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(3, 1, 'maj7'), step(4, 1, '7'), step(2, 1, 'min7'), step(5, 1, 'min7')],
  },
  {
    id: 'pop-club-house',
    name: 'Club Dance & House Groove',
    roman: 'i – VI – VII – v',
    description:
      'Driving natural minor cadence standard in modern deep house and electronic dance music.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['synthwave', 'edm'],
    minScaleLength: 7,
    steps: [step(0, 1, 'min7'), step(5, 1, 'maj7'), step(6, 1, '7'), step(4, 1, 'min7')],
  },
  {
    id: 'jazz-ii-v-i-vi',
    name: 'Jazz ii-V-I-VI Turnaround',
    roman: 'ii7 – V7 – Imaj7 – VI7',
    description:
      'The quintessential jazz standard backbone featuring a secondary dominant turnaround.',
    category: 'Jazz & Neo-Soul',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(1, 1, 'min7'), step(4, 1, '7'), step(0, 1, 'maj7'), step(5, 1, '7')],
  },
  {
    id: 'jazz-neosoul-butter',
    name: 'Neo-Soul Butter Flow',
    roman: 'Imaj9 – viim7b5 – III7 – vim9',
    description:
      'Complex soulful harmony with half-diminished 7b5 leading into a dominant resolution.',
    category: 'Jazz & Neo-Soul',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(0, 1, 'maj9'), step(6, 1, 'm7b5'), step(2, 1, '7'), step(5, 1, 'min9')],
  },
  {
    id: 'jazz-chromatic-mediants',
    name: 'Chromatic Mediants / Giant Step Cycle',
    roman: 'Imaj7 – bVImaj7 – bIImaj7 – V7',
    description:
      'Chromatic third root movements providing a vibrant, otherworldly modal jazz coloration.',
    category: 'Jazz & Neo-Soul',
    referenceScale: 'Phrygian',
    genres: [],
    minScaleLength: 7,
    steps: [
      step(0, 1, 'maj7'),
      step(5, 1, 'maj7'),
      step(1, 1, 'maj7'),
      step(4, 1, '7sus4'),
    ],
  },
  {
    id: 'lofi-coffeehouse',
    name: 'Lofi Extended 9th Coffeehouse',
    roman: 'ii9 – V13 – Imaj9 – IVmaj7',
    description:
      'Warm, relaxed extended 9th and 13th chords tailored for mellow beats and study sessions.',
    category: 'Lofi & R&B',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(1, 1, 'min9'), step(4, 1, '7'), step(0, 1, 'maj9'), step(3, 1, 'maj7')],
  },
  {
    id: 'lofi-trapsoul',
    name: 'Contemporary R&B / Trap-Soul Flow',
    roman: 'i9 – iv7 – VII9 – IIImaj7',
    description:
      'Sultry, atmospheric minor progression standard in contemporary R&B and downtempo production.',
    category: 'Lofi & R&B',
    referenceScale: 'Natural Minor',
    genres: [],
    minScaleLength: 7,
    steps: [step(0, 1, 'min9'), step(3, 1, 'min7'), step(6, 1, '9'), step(2, 1, 'maj7')],
  },
  {
    id: 'lofi-bedroom-pop',
    name: 'Melancholy Bedroom Pop',
    roman: 'Imaj7 – IVmaj7 – ii7 – V7',
    description:
      'Intimate, nostalgic daydream feel with soft major-7th oscillations and tender resolutions.',
    category: 'Lofi & R&B',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(0, 1, 'maj7'), step(3, 1, 'maj7'), step(1, 1, 'min7'), step(4, 1, '7')],
  },
  {
    id: 'jpop-royal-road',
    name: 'Royal Road / Oudo Cadence (王道進行)',
    roman: 'IVmaj7 – V7 – iiim7 – vim7',
    description:
      'The golden standard harmonic sequence of Asian pop and modern dynamic anime theme tracks.',
    category: 'Anime & J-Pop',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(3, 1, 'maj7'), step(4, 1, '7'), step(2, 1, 'min7'), step(5, 1, 'min7')],
  },
  {
    id: 'jpop-marusa',
    name: 'City Pop / Marusa Groove (丸サ進行)',
    roman: 'IVmaj7 – III7 – vim7 – I7',
    description:
      'Infectious groove with secondary dominant transition standard in vintage City Pop and Funk.',
    category: 'Anime & J-Pop',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(3, 1, 'maj7'), step(2, 1, '7'), step(5, 1, 'min7'), step(0, 1, '7')],
  },
  {
    id: 'jpop-heroic',
    name: 'Heroic Anthem / J-Rock Drive',
    roman: 'vi – IV – V – I',
    description:
      'High-energy, heroic minor-to-major resolution celebrating triumph and determination.',
    category: 'Anime & J-Pop',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(5), step(3), step(4), step(0)],
  },
  {
    id: 'blues-12bar',
    name: '12-Bar Blues Standard',
    roman: 'I7 – IV7 – I7 – V7 – IV7 – I7',
    description:
      'The foundational public domain 12-bar blues form loaded with dominant 7th grit.',
    category: 'Rock & Blues',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [
      step(0, 2, '7'),
      step(3, 1, '7'),
      step(0, 1, '7'),
      step(4, 1, '7'),
      step(3, 1, '7'),
      step(0, 2, '7'),
    ],
  },
  {
    id: 'rock-mixolydian',
    name: 'Mixolydian Rock Anthem',
    roman: 'I – bVII – IV – I',
    description:
      'Modal rock swagger featuring the flattened seventh chord for a gritty, driving feel.',
    category: 'Rock & Blues',
    referenceScale: 'Mixolydian',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(6), step(3), step(0)],
  },
  {
    id: 'rock-andalusian',
    name: 'Andalusian / Flamenco Descent',
    roman: 'i – bVII – bVI – V',
    description:
      'Dramatic descending Phrygian bassline cadence rooted in historic Spanish folk and acoustic rock.',
    category: 'Rock & Blues',
    referenceScale: 'Natural Minor',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(6), step(5), step(4, 1, '7')],
  },
  {
    id: 'cine-epic-ostinato',
    name: 'Epic Cinematic Ostinato',
    roman: 'i – bVI – III – bVII',
    description:
      'Monumental cinematic progression built for soaring blockbuster film scores and orchestral trailers.',
    category: 'Cinematic & Modal',
    referenceScale: 'Natural Minor',
    genres: ['synthwave'],
    minScaleLength: 7,
    steps: [step(0), step(5), step(2), step(6)],
  },
  {
    id: 'cine-dorian-voyage',
    name: 'Dorian Space Voyage',
    roman: 'i7 – IV7 – i7 – IV7',
    description:
      'Floating, futuristic vamp utilizing natural 6th modal harmonization for electronic soundscapes.',
    category: 'Cinematic & Modal',
    referenceScale: 'Dorian',
    genres: ['boombap'],
    minScaleLength: 7,
    steps: [step(0, 1, 'min7'), step(3, 1, '7'), step(0, 1, 'min7'), step(3, 1, '7')],
  },
  {
    id: 'cine-lydian-dream',
    name: 'Lydian Dreamscape',
    roman: 'Imaj7 – II – Imaj7 – II',
    description:
      'Magical raised-4th harmony evoking wonder, airborne flight, and majestic adventure.',
    category: 'Cinematic & Modal',
    referenceScale: 'Lydian',
    genres: [],
    minScaleLength: 7,
    steps: [step(0, 1, 'maj7'), step(1), step(0, 1, 'maj7'), step(1)],
  },
  {
    id: 'baroque-canon',
    name: 'Baroque Canon Cadence',
    roman: 'I – V – vi – iii – IV – I – IV – V',
    description:
      'The golden traditional baroque harmonic sequence celebrated across 300 years of music history.',
    category: 'Classical & Baroque',
    referenceScale: 'Major',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(4), step(5), step(2), step(3), step(0), step(3), step(4)],
  },
  {
    id: 'baroque-passacaglia',
    name: 'Passacaglia / Circle of Fifths Descent',
    roman: 'i – iv – VII – III – VI – iio – V – i',
    description:
      'Hypnotic circular resolution driving classical drama, emotional tension, and resolve.',
    category: 'Classical & Baroque',
    referenceScale: 'Natural Minor',
    genres: [],
    minScaleLength: 7,
    steps: [step(0), step(3), step(6), step(2), step(5), step(1), step(4, 1, '7'), step(0)],
  },
];

const PROGRESSIONS_BY_ID = new Map(CHORD_PROGRESSIONS.map((p) => [p.id, p]));

export function progressionById(id: string): ChordProgression | undefined {
  return PROGRESSIONS_BY_ID.get(id);
}

/**
 * Degrees -> concrete chords in a key. An omitted step quality takes the
 * scale's triad; deriveChordNotes owns `notes`. Returns exactly one chord per
 * step, with ids unique within the returned array.
 *
 * Deliberately does NOT enforce minScaleLength: degrees wrap, per the field's
 * documented semantics, so filtering is the caller's job
 * (ChordPresetLibrary.isProgressionAvailable, and B2's dice pools).
 */
export function resolveProgression(
  progression: ChordProgression,
  scaleRoot: string,
  scaleType: string,
  octave = 4,
): ChordItem[] {
  return progression.steps.map((progressionStep, i) => {
    const diatonic = getDiatonicChordForDegree(progressionStep.degree, scaleRoot, scaleType, false);
    const quality = progressionStep.quality ?? diatonic.quality;
    return deriveChordNotes(
      {
        id: `${progression.id}-${i}`,
        root: diatonic.root,
        quality,
        bars: progressionStep.bars,
        notes: [],
      },
      octave,
    );
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
bun test src/audio/data/chordProgressions.migration.test.ts
```

Expected: PASS — 264 progression-in-root comparisons plus the omitted-quality check.

- [ ] **Step 6: Run the gate**

```bash
bun run verify && bun run eslint
```

Expected: PASS. `bun run eslint` matters here: it is what proves `src/audio/data/` may import `utils/`.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/audio/data/chordProgressions.ts src/audio/data/chordProgressions.migration.test.ts
git commit -m "feat(progressions): add the degree-form library and prove the 22-entry migration"
```

---

### Task 5: The 18 new progressions and the library invariants

Adds the genre coverage the dice needs — ambient and zen did not exist as categories at all — and the invariant suite that keeps the library honest.

**Files:**
- Modify: `src/audio/data/chordProgressions.ts` (append 18 entries to `CHORD_PROGRESSIONS`, tag `pop-club-house`)
- Modify: `src/audio/data/chordProgressions.test.ts` (rewrite)

**Interfaces:**
- Consumes: `CHORD_PROGRESSIONS`, `VIBE_GENRE_SCALES`, `SCALES`, `TONAL_CHORD_ALIASES`.
- Produces: no new export. After this task each `VibeGenre` has at least four progressions, which is what B2's `progressionIds` authoring rule draws from.

- [ ] **Step 1: Write the failing test**

Replace `src/audio/data/chordProgressions.test.ts` entirely:

```ts
import { describe, expect, test } from 'bun:test';
import { Chord } from 'tonal';
import {
  CHORD_PROGRESSIONS,
  VIBE_GENRE_SCALES,
  progressionById,
  resolveProgression,
} from './chordProgressions';
import type { VibeGenre } from '../../types';
import {
  deriveChordNotes,
  SCALES,
  TONAL_CHORD_ALIASES,
} from '../../utils/musicTheory';

const GENRES: VibeGenre[] = ['lofi', 'synthwave', 'edm', 'ambient', 'boombap', 'zen'];

const idsFor = (genre: VibeGenre) =>
  CHORD_PROGRESSIONS.filter((p) => p.genres.includes(genre)).map((p) => p.id);

describe('CHORD_PROGRESSIONS structure', () => {
  test('ids are unique and non-empty, and every entry has steps', () => {
    const ids = CHORD_PROGRESSIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CHORD_PROGRESSIONS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.roman.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.steps.length).toBeGreaterThan(0);
      expect(progressionById(p.id)).toBe(p);
    }
  });

  test('every bars value is an integer of at least 1', () => {
    for (const p of CHORD_PROGRESSIONS) {
      for (const step of p.steps) {
        expect(Number.isInteger(step.bars)).toBe(true);
        expect(step.bars).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('referenceScale is a real scale and minScaleLength matches its length', () => {
    for (const p of CHORD_PROGRESSIONS) {
      expect(SCALES[p.referenceScale]).toBeDefined();
      expect(p.minScaleLength).toBe(SCALES[p.referenceScale].intervals.length);
    }
  });

  test('no entry relies on degree wrapping', () => {
    for (const p of CHORD_PROGRESSIONS) {
      for (const step of p.steps) {
        expect(Number.isInteger(step.degree)).toBe(true);
        expect(step.degree).toBeGreaterThanOrEqual(0);
        expect(step.degree).toBeLessThan(p.minScaleLength);
      }
    }
  });

  test('every explicit quality is a chord type tonal actually knows', () => {
    // generateBlockChordNotes silently falls back to `maj` on an unknown
    // token, so without this a typo is inaudible rather than a failure.
    for (const p of CHORD_PROGRESSIONS) {
      for (const step of p.steps) {
        if (step.quality === undefined) continue;
        const token = step.quality.toLowerCase();
        expect(Chord.getChord(TONAL_CHORD_ALIASES[token] ?? token, 'C').empty).toBe(false);
      }
    }
  });
});

describe('genre tagging', () => {
  test('a genre tag is only used on its own scale', () => {
    for (const p of CHORD_PROGRESSIONS) {
      for (const genre of p.genres) {
        expect(p.referenceScale).toBe(VIBE_GENRE_SCALES[genre]);
      }
    }
  });

  test('every genre has at least four progressions', () => {
    // Ruling R4: with three rhythm and three bass options per vibe, fewer than
    // four progressions makes the harmony axis of a no-undo dice repetitive.
    for (const genre of GENRES) {
      expect(idsFor(genre).length).toBeGreaterThanOrEqual(4);
    }
  });

  test('the exact tagged set per genre is authored, not inferred', () => {
    // B2 authors each vibe's progressionIds as this filter's output and pins
    // it, so a tag added here without a decision breaks B2, not just this file.
    expect(idsFor('lofi')).toEqual([
      'jazz-ii-v-i-vi',
      'jazz-neosoul-butter',
      'lofi-coffeehouse',
      'lofi-bedroom-pop',
      'lofi-rainy-window',
      'lofi-tape-loop',
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
    ]);
    expect(idsFor('ambient')).toEqual([
      'ambient-still-water',
      'ambient-lydian-drift',
      'ambient-open-fourths',
      'ambient-glass-horizon',
    ]);
    expect(idsFor('boombap')).toEqual([
      'cine-dorian-voyage',
      'boombap-dusty-ii-v',
      'boombap-crate-dig',
      'boombap-head-nod',
    ]);
    expect(idsFor('zen')).toEqual([
      'zen-bamboo-vamp',
      'zen-moonlit-koto',
      'zen-still-pond',
      'zen-temple-bell',
    ]);
  });
});

describe('genre conventions from the research', () => {
  test('edm entries hold every chord for the same number of bars, and three of the four are 2-bar', () => {
    // Not "always 2": pop-club-house is cross-tagged from the migrated set and
    // its bars are fixed at 1 by the migration proof.
    const edm = CHORD_PROGRESSIONS.filter((p) => p.genres.includes('edm'));
    const uniform = edm.map((p) => new Set(p.steps.map((s) => s.bars)));
    for (const bars of uniform) expect(bars.size).toBe(1);
    expect(edm.filter((p) => p.steps.every((s) => s.bars === 2)).length).toBeGreaterThanOrEqual(3);
  });

  test('ambient entries hold 4+ bars and avoid V-I, including across the loop point', () => {
    for (const p of CHORD_PROGRESSIONS.filter((x) => x.genres.includes('ambient'))) {
      for (const step of p.steps) expect(step.bars).toBeGreaterThanOrEqual(4);
      p.steps.forEach((step, i) => {
        const next = p.steps[(i + 1) % p.steps.length];
        expect(step.degree === 4 && next.degree === 0).toBe(false);
      });
    }
  });

  test('lofi and boombap entries write an extension on every step', () => {
    for (const p of CHORD_PROGRESSIONS) {
      if (!p.genres.includes('lofi') && !p.genres.includes('boombap')) continue;
      for (const step of p.steps) {
        expect(step.quality).toBeDefined();
        expect(step.quality).toMatch(/7|9|11|13/);
      }
    }
  });

  test('zen entries are playable on a five-note scale', () => {
    for (const p of CHORD_PROGRESSIONS.filter((x) => x.genres.includes('zen'))) {
      expect(p.minScaleLength).toBe(5);
      expect(p.referenceScale).toBe('Hirajoshi');
    }
  });
});

describe('resolveProgression', () => {
  const popAnthem = progressionById('pop-i-v-vi-iv')!;

  test('resolves I - V - vi - IV in C Major to C - G - Am - F', () => {
    expect(resolveProgression(popAnthem, 'C', 'Major', 4).map((c) => `${c.root}${c.quality}`)).toEqual(
      ['Cmaj', 'Gmaj', 'Amin', 'Fmaj'],
    );
  });

  test('an omitted quality yields the triad, never the seventh', () => {
    const chords = resolveProgression(popAnthem, 'C', 'Major', 4);
    expect(chords.map((c) => c.quality)).toEqual(['maj', 'maj', 'min', 'maj']);
  });

  test('an explicit quality survives verbatim', () => {
    const lofi = progressionById('lofi-tape-loop')!;
    expect(resolveProgression(lofi, 'C', 'Major', 4).map((c) => c.quality)).toEqual([
      'maj9',
      'min7',
      'min9',
      '9',
    ]);
  });

  test('bars carry through and ids are unique within the result', () => {
    const zen = progressionById('zen-still-pond')!;
    const chords = resolveProgression(zen, 'G', 'Hirajoshi', 4);
    expect(chords.map((c) => c.bars)).toEqual([4, 4]);
    expect(chords.map((c) => c.id)).toEqual(['zen-still-pond-0', 'zen-still-pond-1']);
    expect(new Set(chords.map((c) => c.id)).size).toBe(chords.length);
  });

  test('returns exactly one chord per step, even in a five-note scale', () => {
    // B2 depends on this: a collapsed progression would silently shorten a loop.
    for (const p of CHORD_PROGRESSIONS.filter((x) => x.minScaleLength === 5)) {
      expect(resolveProgression(p, 'G', 'Hirajoshi', 4)).toHaveLength(p.steps.length);
    }
  });

  test('notes come from deriveChordNotes at the requested octave', () => {
    const chords = resolveProgression(popAnthem, 'C', 'Major', 3);
    expect(chords[0].notes).toEqual(
      deriveChordNotes({ id: 'x', root: 'C', quality: 'maj', bars: 1, notes: [] }, 3).notes,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/audio/data/chordProgressions.test.ts
```

Expected: FAIL — the genre coverage, exact-set and convention tests all fail; only the structural ones pass.

- [ ] **Step 3: Document the `pop-club-house` cross-tag**

Task 4 already authored that entry as `genres: ['synthwave', 'edm']`; the reason is not obvious from the data, so put it in the file. Above that line in `src/audio/data/chordProgressions.ts`:

```ts
    // Both synthwave and edm anchor on Natural Minor, so this entry is legal in
    // both pools, and it is the fourth edm progression the dice needs. Its bars
    // stay 1 because the migration proof compares them verbatim — which is why
    // the edm convention test asks for uniform bars rather than always-2.
```

- [ ] **Step 4: Append the 18 new progressions**

At the end of the `CHORD_PROGRESSIONS` array in `src/audio/data/chordProgressions.ts`:

```ts
  // --- Ambient: Lydian is the signature ambient scale. Modal vamps, pedal
  // tones, 4-32 bars per chord, and no V-I cadence anywhere — including across
  // the loop point, which is why none of these contains degree 4 at all.
  {
    id: 'ambient-still-water',
    name: 'Still Water Pedal',
    roman: 'Imaj7 – vim7',
    description:
      'Two chords over eight bars each: a tonic pedal that breathes rather than moves.',
    category: 'Ambient & Zen',
    referenceScale: 'Lydian',
    genres: ['ambient'],
    minScaleLength: 7,
    steps: [step(0, 8, 'maj7'), step(5, 8, 'min7')],
  },
  {
    id: 'ambient-lydian-drift',
    name: 'Lydian Drift',
    roman: 'Imaj7 – II – iiim7 – II',
    description:
      'The raised fourth heard as a major II chord, drifting back and forth without ever resolving.',
    category: 'Ambient & Zen',
    referenceScale: 'Lydian',
    genres: ['ambient'],
    minScaleLength: 7,
    steps: [step(0, 4, 'maj7'), step(1, 4), step(2, 4, 'min7'), step(1, 4)],
  },
  {
    id: 'ambient-open-fourths',
    name: 'Open-Fourth Vamp',
    roman: 'Isus2 – IIsus2',
    description:
      'Suspended, thirdless voicings that leave the mode ambiguous and the texture wide open.',
    category: 'Ambient & Zen',
    referenceScale: 'Lydian',
    genres: ['ambient'],
    minScaleLength: 7,
    steps: [step(0, 4, 'sus2'), step(1, 4, 'sus2')],
  },
  {
    id: 'ambient-glass-horizon',
    name: 'Glass Horizon',
    roman: 'vim7 – Imaj7 – iiim7 – IIsus2',
    description:
      'Opens away from the tonic, so the key arrives late and the loop never settles on a downbeat.',
    category: 'Ambient & Zen',
    referenceScale: 'Lydian',
    genres: ['ambient'],
    minScaleLength: 7,
    steps: [step(5, 4, 'min7'), step(0, 4, 'maj7'), step(2, 4, 'min7'), step(1, 4, 'sus2')],
  },

  // --- EDM: the three shapes the research names for 126-130 BPM, all two bars
  // per chord so the drop has room to breathe.
  {
    id: 'edm-cyber-drop',
    name: 'Cyber Drop Loop',
    roman: 'i – VII – VI – VII',
    description:
      'The workhorse main-stage loop: a minor tonic rocking between its two flat neighbours.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['edm'],
    minScaleLength: 7,
    steps: [step(0, 2), step(6, 2), step(5, 2), step(6, 2)],
  },
  {
    id: 'edm-neon-rise',
    name: 'Neon Rise',
    roman: 'i – VI – III – VII',
    description:
      'Descending-then-lifting minor cycle that carries a build without needing a key change.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['edm'],
    minScaleLength: 7,
    steps: [step(0, 2), step(5, 2), step(2, 2), step(6, 2)],
  },
  {
    id: 'edm-arena-sweep',
    name: 'Arena Sweep',
    roman: 'i – III – VII – VI',
    description:
      'Bright relative-major lift on the second chord, then a long fall back to the tonic.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['edm'],
    minScaleLength: 7,
    steps: [step(0, 2), step(2, 2), step(6, 2), step(5, 2)],
  },

  // --- Synthwave: almost exclusively minor, with occasional modal borrowing
  // for brightness.
  {
    id: 'synthwave-midnight-drive',
    name: 'Midnight Drive',
    roman: 'i – iv – VI – V',
    description:
      'A major V borrowed over the natural-minor scale — the one bright chord in an otherwise dark loop.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['synthwave'],
    minScaleLength: 7,
    steps: [step(0), step(3), step(5), step(4, 1, 'maj')],
  },
  {
    id: 'synthwave-neon-horizon',
    name: 'Neon Horizon',
    roman: 'i – VII – III – VI',
    description:
      'Strictly diatonic minor cycle with a chord per bar, built for arpeggiated pads.',
    category: 'Pop & EDM',
    referenceScale: 'Natural Minor',
    genres: ['synthwave'],
    minScaleLength: 7,
    steps: [step(0), step(6), step(2), step(5)],
  },

  // --- Lo-Fi: sevenths and ninths are the default, not decoration.
  {
    id: 'lofi-rainy-window',
    name: 'Rainy Window',
    roman: 'vim9 – IVmaj7 – ii9 – V7',
    description:
      'Starts on the relative minor ninth and walks a soft ii-V home; smooth voice leading throughout.',
    category: 'Lofi & R&B',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(5, 1, 'min9'), step(3, 1, 'maj7'), step(1, 1, 'min9'), step(4, 1, '7')],
  },
  {
    id: 'lofi-tape-loop',
    name: 'Tape Loop',
    roman: 'Imaj9 – vim7 – ii9 – V9',
    description:
      'A turnaround that closes on a dominant ninth, so the loop point never quite resolves.',
    category: 'Lofi & R&B',
    referenceScale: 'Major',
    genres: ['lofi'],
    minScaleLength: 7,
    steps: [step(0, 1, 'maj9'), step(5, 1, 'min7'), step(1, 1, 'min9'), step(4, 1, '9')],
  },

  // --- Boom Bap: Dorian, min7 / maj7 and 9/11/13 extensions, ii-V-i.
  {
    id: 'boombap-dusty-ii-v',
    name: 'Dusty ii–V–i',
    roman: 'iim7 – V7 – im9',
    description:
      'A three-chord ii-V-i that lands on a two-bar minor ninth — room for the sample to sit.',
    category: 'Lofi & R&B',
    referenceScale: 'Dorian',
    genres: ['boombap'],
    minScaleLength: 7,
    steps: [step(1, 1, 'min7'), step(4, 1, '7'), step(0, 2, 'min9')],
  },
  {
    id: 'boombap-crate-dig',
    name: 'Crate Dig',
    roman: 'im9 – VIImaj7 – IIImaj7 – IV7',
    description:
      'Two major sevenths lifted out of the mode, then the Dorian major IV that gives the style its colour.',
    category: 'Lofi & R&B',
    referenceScale: 'Dorian',
    genres: ['boombap'],
    minScaleLength: 7,
    steps: [step(0, 1, 'min9'), step(6, 1, 'maj7'), step(2, 1, 'maj7'), step(3, 1, '7')],
  },
  {
    id: 'boombap-head-nod',
    name: 'Head Nod',
    roman: 'im7 – IV7 – im7 – iim7',
    description:
      'Two-chord vamp with a turn onto the ii, the flattest, most loopable shape in the style.',
    category: 'Lofi & R&B',
    referenceScale: 'Dorian',
    genres: ['boombap'],
    minScaleLength: 7,
    steps: [step(0, 1, 'min7'), step(3, 1, '7'), step(0, 1, 'min7'), step(1, 1, 'min7')],
  },

  // --- Zen: Hirajoshi. Only degrees 0, 3 and 4 give triads that stay entirely
  // inside the five notes, so the vamp below is built from exactly those.
  {
    id: 'zen-bamboo-vamp',
    name: 'Bamboo Vamp',
    roman: 'i – IV – i – V',
    description:
      'Open-fourth koto sound over a minor tonic; every note it plays is inside the scale.',
    category: 'Ambient & Zen',
    referenceScale: 'Hirajoshi',
    genres: ['zen'],
    minScaleLength: 5,
    steps: [step(0, 2), step(3, 2), step(0, 2), step(4, 2)],
  },
  {
    id: 'zen-moonlit-koto',
    name: 'Moonlit Koto',
    roman: 'i – V – IV – III',
    description:
      'Descends through the half-step that gives Hirajoshi its melancholy, ending on the bright III.',
    category: 'Ambient & Zen',
    referenceScale: 'Hirajoshi',
    genres: ['zen'],
    minScaleLength: 5,
    steps: [step(0, 2), step(4, 2), step(3, 2), step(2, 2)],
  },
  {
    id: 'zen-still-pond',
    name: 'Still Pond',
    roman: 'im7 – Vmaj7',
    description:
      'Two four-bar chords, held long enough for the decay to become the arrangement.',
    category: 'Ambient & Zen',
    referenceScale: 'Hirajoshi',
    genres: ['zen'],
    minScaleLength: 5,
    steps: [step(0, 4, 'min7'), step(4, 4, 'maj7')],
  },
  {
    id: 'zen-temple-bell',
    name: 'Temple Bell',
    roman: 'i – III – V – IV',
    description:
      'Rises through both major thirds before the open fourth settles it — not a rotation of the vamp.',
    category: 'Ambient & Zen',
    referenceScale: 'Hirajoshi',
    genres: ['zen'],
    minScaleLength: 5,
    steps: [step(0, 2), step(2, 2), step(4, 2), step(3, 2)],
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
bun test src/audio/data/
```

Expected: PASS, both files. The migration proof must still be green — the 22 migrated entries were not touched except for `pop-club-house`'s `genres`, which the proof does not read.

- [ ] **Step 6: Run the gate**

```bash
bun run verify && bun run eslint
```

Expected: PASS. This is the **phase 2 boundary**.

- [ ] **Step 7: Commit**

```bash
git add src/audio/data/chordProgressions.ts src/audio/data/chordProgressions.test.ts
git commit -m "feat(progressions): add 18 genre progressions and the library invariant suite"
```

---

### Task 6: `ChordView` — transpose on a key change, and stop harmonizing chords that arrived with one

The behaviour fix the user sees. Today the effect at `:178` reharmonizes on every `[scaleRoot, scaleType]` change, which scrambles the progression on a key change and re-harmonizes an Instant Vibe's own chords against the vibe's own key.

**Files:**
- Modify: `src/components/ChordView.tsx:61-66` (imports), `:176-190` (the effect), `:192-213` (`handleApplyLibraryChords`), `:429-430` (the count)
- Test: `src/components/ChordView.test.tsx` (append)

**Interfaces:**
- Consumes: `transposeProgression`, `snapProgressionToScale`, `deriveChordNotes`, `CHORD_PROGRESSIONS`.
- Produces: `applyKeyScaleChange(chords, from, to, octave, chordsReplaced)` exported from `src/components/ChordView.tsx`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/ChordView.test.tsx`:

```ts
import { applyKeyScaleChange } from './ChordView';
import { deriveChordNotes } from '../utils/musicTheory';
import type { ChordItem } from '../types';

const chord = (id: string, root: string, quality: string): ChordItem =>
  deriveChordNotes({ id, root, quality, bars: 1, notes: [] }, 4);

// A Natural Minor, i - VI - III - VII.
const PROGRESSION: ChordItem[] = [
  chord('c1', 'A', 'min'),
  chord('c2', 'F', 'maj'),
  chord('c3', 'C', 'maj'),
  chord('c4', 'G', 'maj'),
];

const names = (chords: ChordItem[] | null) =>
  chords === null ? null : chords.map((c) => `${c.root}${c.quality}`);

const A_MINOR = { root: 'A', scaleType: 'Natural Minor' };

describe('applyKeyScaleChange', () => {
  test('a root-only change transposes and does not snap', () => {
    // The case the chordsReplaced guard could wrongly skip (ruling R1): the
    // chords array is the same object across the render, only the key moved.
    expect(
      names(applyKeyScaleChange(PROGRESSION, A_MINOR, { ...A_MINOR, root: 'C' }, 4, false)),
    ).toEqual(['Cmin', 'G#maj', 'D#maj', 'A#maj']);
  });

  test('a scale-only change snaps and does not transpose', () => {
    expect(
      names(applyKeyScaleChange(PROGRESSION, A_MINOR, { ...A_MINOR, scaleType: 'Major' }, 4, false)),
    ).toEqual(['Amaj', 'Emaj', 'Bmin', 'F#min']);
  });

  test('both changed transposes first, then snaps — the order is pinned', () => {
    const both = applyKeyScaleChange(
      PROGRESSION,
      A_MINOR,
      { root: 'C', scaleType: 'Major' },
      4,
      false,
    );
    expect(names(both)).toEqual(['Cmaj', 'Gmaj', 'Dmin', 'Amin']);
    // Snapping first would measure the chords against a root they are not yet
    // in — today's bug. It produces a visibly different progression:
    expect(names(both)).not.toEqual(['Cmin', 'G#maj', 'D#maj', 'A#maj']);
  });

  test('replaced chords are never touched, whatever else changed', () => {
    // An Instant Vibe writes scaleRoot, scaleType and chords in one batch. Its
    // chords were authored correct in its own key; harmonizing them is the bug.
    expect(
      applyKeyScaleChange(PROGRESSION, A_MINOR, { root: 'C', scaleType: 'Major' }, 4, true),
    ).toBeNull();
    expect(applyKeyScaleChange(PROGRESSION, A_MINOR, { ...A_MINOR, root: 'C' }, 4, true)).toBeNull();
  });

  test('an unchanged key and an empty chord list both return null', () => {
    expect(applyKeyScaleChange(PROGRESSION, A_MINOR, { ...A_MINOR }, 4, false)).toBeNull();
    expect(applyKeyScaleChange([], A_MINOR, { root: 'C', scaleType: 'Major' }, 4, false)).toBeNull();
  });

  test('the octave is honoured', () => {
    const moved = applyKeyScaleChange(PROGRESSION, A_MINOR, { ...A_MINOR, root: 'C' }, 3, false);
    expect(moved?.[0].notes).toEqual(deriveChordNotes(chord('c1', 'C', 'min'), 3).notes);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/components/ChordView.test.tsx
```

Expected: FAIL — `applyKeyScaleChange` is not exported.

- [ ] **Step 3: Add the helper**

In `src/components/ChordView.tsx`, above `export const ChordView`, add:

```tsx
/**
 * The whole auto-harmonize decision, as one pure function so it is testable
 * without a DOM (repo convention: components export their testable helpers).
 *
 * `chordsReplaced` means "this render's chord array is not the one the last run
 * saw" — an Instant Vibe, a library preset or a template just wrote it. Those
 * chords were built in the key that arrived with them, so no key delta this
 * effect can observe is a delta they need. It is checked first for that reason.
 *
 * Transpose-then-snap is the only correct order for a combined change: snapping
 * first would measure the chords against a root they are not yet in.
 */
export function applyKeyScaleChange(
  chords: ChordItem[],
  from: { root: string; scaleType: string },
  to: { root: string; scaleType: string },
  octave: number,
  chordsReplaced: boolean,
): ChordItem[] | null {
  if (chordsReplaced || chords.length === 0) return null;

  const rootChanged = from.root !== to.root;
  const scaleChanged = from.scaleType !== to.scaleType;
  if (!rootChanged && !scaleChanged) return null;

  let next = chords;
  if (rootChanged) next = transposeProgression(next, from.root, to.root, octave);
  if (scaleChanged) next = snapProgressionToScale(next, to.root, to.scaleType, octave);
  return next;
}
```

Add `transposeProgression` to the `../utils/musicTheory` import (`snapProgressionToScale` is already there from Task 2).

- [ ] **Step 4: Rewrite the effect**

Replace the effect at `src/components/ChordView.tsx:176-190` with:

```tsx
  // Auto-harmonize refs. The effect must not re-run when the toggle or the
  // octave changes — only when the key or the chords do — so those two are read
  // through refs kept fresh by an effect declared above it (effects run in
  // declaration order, so these are current by the time the next one runs).
  const keyRef = useRef({ root: scaleRoot, scaleType });
  const chordsRef = useRef(chords);
  const autoReharmonizeRef = useRef(autoReharmonize);
  const chordOctaveRef = useRef(chordOctave);

  useEffect(() => {
    autoReharmonizeRef.current = autoReharmonize;
    chordOctaveRef.current = chordOctave;
  });

  useEffect(() => {
    const previousKey = keyRef.current;
    const chordsReplaced = chordsRef.current !== chords;
    chordsRef.current = chords;
    keyRef.current = { root: scaleRoot, scaleType };

    if (!autoReharmonizeRef.current) return;

    const next = applyKeyScaleChange(
      chords,
      previousKey,
      keyRef.current,
      chordOctaveRef.current,
      chordsReplaced,
    );
    if (!next) return;

    // Remember what we wrote, so the run this setChords triggers sees the
    // chords as unreplaced rather than harmonizing its own output.
    chordsRef.current = next;
    setChords(next);
    setIsAutoReharmonizedIndicator(true);
  }, [scaleRoot, scaleType, chords, setChords]);
```

Two deliberate behaviour changes: `chords` joins the dependency list, and because `keyRef` starts at the current key the effect no longer harmonizes on mount — the persisted progression is left exactly as the user saved it.

- [ ] **Step 5: Simplify `handleApplyLibraryChords` and the count**

Replace `handleApplyLibraryChords` (`:192-213`) with:

```tsx
  const handleApplyLibraryChords = (libraryChords: ChordItem[]) => {
    // ChordPresetLibrary hands over chords already resolved in the active key
    // and scale (factory entries from their degrees, custom ones snapped), so
    // there is nothing left to harmonize here. Re-id and re-derive only.
    setChords(
      libraryChords.map((c, i) =>
        deriveChordNotes({ ...c, id: `lib-chord-${Date.now()}-${i}` }, chordOctave),
      ),
    );
    setIsAutoReharmonizedIndicator(false);
  };
```

Point the count at `:429-430` at the new library (Task 7 narrows it to the entries the library will actually show, once `isProgressionAvailable` exists):

```tsx
  const totalProgressionsCount = CHORD_PROGRESSIONS.length + customProgressions.length;
```

Change the import at `:73` to `import { CHORD_PROGRESSIONS } from "../audio/data/chordProgressions";`. Both arrays exist at this point, so the file still builds.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
bun test src/components/ChordView.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ChordView.tsx src/components/ChordView.test.tsx
git commit -m "fix(chords): transpose on a key change and never harmonize chords that arrived with one"
```

---

### Task 7: `ChordPresetLibrary` — resolve from degrees, filter by scale length, drop the old data

The last reader of `CHORD_PROGRESSION_TEMPLATES`. When this task is done the interval form is gone from the repo.

**Files:**
- Modify: `src/components/ChordPresetLibrary.tsx:5-6,23,41-52,74-95,113-124,129-146,~305-330,492`
- Modify: `src/components/ChordView.tsx:429-430` (narrow the count to available entries)
- Modify: `src/audio/data/chordProgressions.ts` (delete `ProgressionTemplate` and `CHORD_PROGRESSION_TEMPLATES`)
- Modify: `src/audio/data/chordProgressions.migration.test.ts` (drop the now-subjectless self-check)
- Test: `src/components/ChordPresetLibrary.test.tsx` (append)

**Interfaces:**
- Consumes: `CHORD_PROGRESSIONS`, `ChordProgression`, `resolveProgression`, `snapProgressionToScale`, `SCALES`.
- Produces: `isProgressionAvailable(p, scaleType)` exported from `src/components/ChordPresetLibrary.tsx`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/ChordPresetLibrary.test.tsx`:

```tsx
import { isProgressionAvailable } from './ChordPresetLibrary';
import { CHORD_PROGRESSIONS, progressionById } from '../audio/data/chordProgressions';
import { SCALES } from '../utils/musicTheory';

describe('isProgressionAvailable', () => {
  const sevenNote = progressionById('pop-i-v-vi-iv')!;
  const fiveNote = progressionById('zen-bamboo-vamp')!;

  test('a seven-degree progression is hidden in every short scale', () => {
    for (const scaleType of ['Hirajoshi', 'Major Pentatonic', 'Minor Pentatonic', 'Blues']) {
      expect(isProgressionAvailable(sevenNote, scaleType)).toBe(false);
    }
  });

  test('a seven-degree progression is available in every seven-degree scale', () => {
    for (const [scaleType, scale] of Object.entries(SCALES)) {
      if (scale.intervals.length !== 7) continue;
      expect(isProgressionAvailable(sevenNote, scaleType)).toBe(true);
    }
  });

  test('a five-degree progression is available everywhere', () => {
    for (const scaleType of Object.keys(SCALES)) {
      expect(isProgressionAvailable(fiveNote, scaleType)).toBe(true);
    }
  });

  test('an unknown scale type is treated as seven degrees, matching SCALES own fallback', () => {
    expect(isProgressionAvailable(sevenNote, 'Pentatonic Major')).toBe(true);
  });

  test('a five-note scale leaves exactly the four zen entries', () => {
    const visible = CHORD_PROGRESSIONS.filter((p) => isProgressionAvailable(p, 'Hirajoshi'));
    expect(visible.map((p) => p.id)).toEqual([
      'zen-bamboo-vamp',
      'zen-moonlit-koto',
      'zen-still-pond',
      'zen-temple-bell',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/components/ChordPresetLibrary.test.tsx
```

Expected: FAIL — `isProgressionAvailable` is not exported.

- [ ] **Step 3: Swap the data source**

In `src/components/ChordPresetLibrary.tsx`:

Replace the imports at `:5-6` with:

```tsx
import { CHORD_PROGRESSIONS, resolveProgression } from '../audio/data/chordProgressions';
import type { ChordProgression } from '../audio/data/chordProgressions';
```

and add `SCALES` to the `../utils/musicTheory` import. `rootSemitone` and `ROOTS` were only used by the interval-form transposition and are now unused — drop them. `generateBlockChordNotes` (used by `resolveCustomChords`) and `formatChordLabel` stay.

Add above the component:

```tsx
/**
 * A progression is only offered in a scale that has at least as many degrees as
 * it was authored against. Entries that fail are hidden rather than resolved
 * with wrapped degrees, which would silently produce a different progression.
 * An unknown scaleType is treated as seven degrees, matching SCALES' own
 * `|| SCALES['Major']` fallback.
 */
export function isProgressionAvailable(p: ChordProgression, scaleType: string): boolean {
  return (SCALES[scaleType]?.intervals.length ?? 7) >= p.minScaleLength;
}
```

Change the entry type at `:23`:

```tsx
  progression?: ChordProgression; // factory entries carry their library entry
```

Replace the factory half of the `entries` memo at `:86-93` and widen its dependency list:

```tsx
      ...CHORD_PROGRESSIONS.filter((p) => isProgressionAvailable(p, scaleType)).map((p) => ({
        id: `factory-${p.id}`,
        name: p.name,
        category: p.category,
        description: p.description,
        isFactory: true,
        progression: p,
      })),
    ],
    [customProgressions, scaleType],
  );
```

In `filterEntries`, change the roman lookup to `(e.progression ? e.progression.roman : e.roman ?? '')`.

- [ ] **Step 4: Resolve from degrees instead of transposing intervals**

Replace `resolveTemplateChords` (`:129-146`) with:

```tsx
  // Degree form has no other resolution: the result is in the active key and
  // scale by construction, so this is NOT gated on autoReharmonize any more
  // (and factory cards no longer show the "Auto" badge).
  const resolveFactoryChords = (progression: ChordProgression): ChordItem[] =>
    resolveProgression(progression, scaleRoot, scaleType, 4);
```

`resolveCustomChords` keeps its `snapProgressionToScale` call behind `autoReharmonize` and keeps its "Auto" badge: custom progressions are absolute chords with no recorded source key, so snapping is the only operation available to them.

In `applyEntry`, change `if (entry.template)` to `if (entry.progression)` and call `resolveFactoryChords(entry.progression)`.

In `renderTemplateCard`, replace `const tpl = e.template!;` with `const progression = e.progression!;`, replace `resolveTemplateChords(tpl)` with `resolveFactoryChords(progression)`, replace the three `tpl.` reads (`name`, `category`, `roman`) with `progression.`, and **delete** the `{autoReharmonize && ( ... Auto ... )}` badge block — a degree-form entry is always resolved into the active key, so the badge would claim a choice the user no longer has.

Add the new chip to `BASE_CHORD_CATEGORIES` after `'Classical & Baroque'`:

```tsx
  { id: 'Ambient & Zen', label: 'Ambient & Zen', badgeClass: 'badge badge-primary', description: '' },
```

Replace the count at `:492`:

```tsx
      headerSubtitle={`Key of ${scaleRoot} • ${entries.length} Total Progressions`}
```

- [ ] **Step 5: Narrow ChordView's count**

Now that `isProgressionAvailable` exists, replace `totalProgressionsCount` in `src/components/ChordView.tsx:429-430` so the badge cannot advertise progressions the library will not show:

```tsx
  const totalProgressionsCount =
    CHORD_PROGRESSIONS.filter((p) => isProgressionAvailable(p, scaleType)).length +
    customProgressions.length;
```

Add `isProgressionAvailable` to the existing `./ChordPresetLibrary` import in that file.

- [ ] **Step 6: Delete the interval form**

In `src/audio/data/chordProgressions.ts`, delete the `ProgressionTemplate` interface and the whole `CHORD_PROGRESSION_TEMPLATES` array. Nothing imports them any more.

In `src/audio/data/chordProgressions.migration.test.ts`, delete the `CHORD_PROGRESSION_TEMPLATES` import and the `is a verbatim copy of CHORD_PROGRESSION_TEMPLATES` test — its subject no longer exists. **Keep `ORIGINAL_TEMPLATES` and the equivalence proof:** the fixture is now the only record of what these progressions used to sound like, and the proof is what keeps them sounding that way.

- [ ] **Step 7: Run the tests and the theme guard**

```bash
bun test src/components/ChordPresetLibrary.test.tsx && bun run check:theme
```

Expected: PASS. The existing render tests still hold — they assert card, badge and button classes, none of which this task changes.

- [ ] **Step 8: Verify by hand**

```bash
bun run dev
```

1. Open the chord library in C Major: 40 factory progressions, and an `Ambient & Zen` chip that lists the four ambient and four zen entries.
2. Load `Classic 4-Chord Pop Anthem` → `C – G – Am – F`. No "Auto" badge on factory cards; custom cards still have one.
3. Switch the header key to `D` → the grid transposes to `D – A – Bm – G`. The tonic stays first.
4. Switch the scale to `Natural Minor` → the same progression snaps, and the card previews follow the scale.
5. Switch the scale to `Hirajoshi` → the factory list is the four zen entries only. Load `Bamboo Vamp`.

- [ ] **Step 9: Commit**

```bash
git add src/components/ChordPresetLibrary.tsx src/components/ChordPresetLibrary.test.tsx src/components/ChordView.tsx src/audio/data/chordProgressions.ts src/audio/data/chordProgressions.migration.test.ts
git commit -m "feat(library): resolve progressions from degrees and filter by scale length"
```

---

### Task 8: Zen Garden onto Hirajoshi

`src/store/instantVibes.ts:657` sets `scaleType: 'Pentatonic Major'`, which is not a key of `SCALES` (the real key is `'Major Pentatonic'`), so every lookup falls through to `Major` and the vibe silently runs in the wrong scale. The research also says the meditative Japanese sound is Hirajoshi, not the bright Yo scale.

**Files:**
- Modify: `src/store/instantVibes.ts:657,676-681`
- Test: `src/store/instantVibes.test.ts` (append)

**Interfaces:**
- Consumes: `SCALES`, `isNoteInScale`, `resolveProgression`, `progressionById`.
- Produces: nothing new. `applyInstantVibeToStore` and the hard-stop/restart path are untouched — do not regress them.

- [ ] **Step 1: Write the failing test**

Append to `src/store/instantVibes.test.ts`:

```ts
import { SCALES, isNoteInScale } from '../utils/musicTheory';
import { progressionById, resolveProgression } from '../audio/data/chordProgressions';

describe('vibe scales', () => {
  test('every vibe scaleType is a real key of SCALES', () => {
    // This alone would have caught 'Pentatonic Major', which fell through to
    // Major for the whole life of the vibe.
    for (const vibe of INSTANT_VIBES) {
      expect(SCALES[vibe.scaleType]).toBeDefined();
    }
  });

  test('Zen Garden is G Hirajoshi and plays the bamboo vamp', () => {
    const zen = INSTANT_VIBES.find((v) => v.id === 'asian-zen')!;
    expect(zen.scaleRoot).toBe('G');
    expect(zen.scaleType).toBe('Hirajoshi');

    const resolved = resolveProgression(progressionById('zen-bamboo-vamp')!, 'G', 'Hirajoshi', 4);
    expect(zen.chords.map((c) => ({ root: c.root, quality: c.quality, bars: c.bars, notes: c.notes })))
      .toEqual(resolved.map((c) => ({ root: c.root, quality: c.quality, bars: c.bars, notes: c.notes })));
  });

  test('every note Zen Garden plays is inside G Hirajoshi', () => {
    const zen = INSTANT_VIBES.find((v) => v.id === 'asian-zen')!;
    for (const chord of zen.chords) {
      for (const note of chord.notes) {
        expect(isNoteInScale(note, 'G', 'Hirajoshi')).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test src/store/instantVibes.test.ts
```

Expected: FAIL — `SCALES['Pentatonic Major']` is undefined and the chords are `G – C – D – Em`.

- [ ] **Step 3: Move the vibe onto the scale**

In `src/store/instantVibes.ts`, change `:657` to `scaleType: 'Hirajoshi',` and replace the `chords` block at `:676-681` with:

```ts
    // zen-bamboo-vamp resolved in G Hirajoshi: i - IV - i - V, two bars each.
    // Uses only degrees 0, 3 and 4, so every note is inside the five-note
    // scale. Same 8-bar length as the progression this replaces.
    chords: [
      makeVibeChord('zn1', 'G', 'min', 2, 4),
      makeVibeChord('zn2', 'D', 'sus4', 2, 4),
      makeVibeChord('zn3', 'G', 'min', 2, 4),
      makeVibeChord('zn4', 'D#', 'maj', 2, 4),
    ],
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun test src/store/instantVibes.test.ts
```

Expected: PASS, including the existing transport and audible-cut suites, which this task does not touch.

- [ ] **Step 5: Verify by hand**

```bash
bun run dev
```

Click Zen Garden with the Chords player running: the swap is still atomic (no overlap, old sound cut), the header scale reads `Hirajoshi (Japanese)`, and the progression is `Gm – Dsus4 – Gm – D#`.

- [ ] **Step 6: Commit**

```bash
git add src/store/instantVibes.ts src/store/instantVibes.test.ts
git commit -m "fix(vibes): put Zen Garden on Hirajoshi instead of a scale key that does not exist"
```

---

### Task 9: Update the music-theory skill and close the gate

The skill file documents a function that no longer exists and a `SCALES` key list that is now short by one. Agents read it before touching theory, so a stale entry is a real defect.

**Files:**
- Modify: `.claude/skills/music-theory/SKILL.md:32-36,54-55`

**Interfaces:**
- Consumes: nothing. Documentation only.

- [ ] **Step 1: Fix the scale key list**

Replace lines 32–36 of `.claude/skills/music-theory/SKILL.md` with:

```md
`SCALES` keys are the values persisted as `scaleType`:
`Major`, `Natural Minor`, `Harmonic Minor`, `Dorian`, `Mixolydian`, `Lydian`, `Phrygian`,
`Minor Pentatonic`, `Major Pentatonic`, `Blues`, `Hirajoshi`. Pentatonic/Blues/Hirajoshi have 5–6
degrees, so never assume 7 — loop `SCALES[scaleType].intervals.length` (unknown key falls back to
`Major`, which is how `'Pentatonic Major'` ran as Major for months without anyone hearing it).
`Hirajoshi` is `[0, 2, 3, 7, 8]` with hand-authored qualities inherited from natural minor, except
degree 3 which is `sus4` / `7sus4` — the open-fourth koto sound, and entirely inside the five notes.
```

- [ ] **Step 2: Fix the harmonize entry**

Replace the `reharmonizeProgressionToScale` bullet (lines 54–55) with:

```md
- `transposeProgression(chords, fromRoot, toRoot, octave)` moves a whole progression to a new key:
  every chord shifts by the same interval, so scale degrees and the tonic's position survive. This is
  what a **root** change needs.
- `snapProgressionToScale(chords, root, scaleType, octave)` snaps each chord to the nearest degree of
  the given scale; only `maj9 / min9 / 7sus4 / sus4` keep their user-chosen quality. This is what a
  **scale** change needs, and it is only correct on chords already in `root` — feeding it chords from
  another key collapses distinct chords onto one degree. `reharmonizeProgressionToScale` was the two
  operations conflated and is gone.
- `ChordView.applyKeyScaleChange(chords, from, to, octave, chordsReplaced)` picks between them:
  transpose, snap, or transpose-then-snap, and does nothing at all when the chords were just replaced.
```

- [ ] **Step 3: Add the progression library section**

Append to the same file, after the helpers section:

```md
## The progression library

`src/audio/data/chordProgressions.ts` holds `CHORD_PROGRESSIONS` — 40 progressions as **scale
degrees**, never semitones. A step is `{ degree, quality?, bars }`; an omitted `quality` means the
scale's **triad** for that degree, never the seventh. `resolveProgression(p, root, scaleType, octave)`
is the only way to turn one into `ChordItem`s.

Each entry declares the `referenceScale` its degrees were authored in, `minScaleLength` (that scale's
degree count), and `genres` — a tag is only legal when `referenceScale === VIBE_GENRE_SCALES[tag]`.
Callers must filter on `minScaleLength` themselves; `resolveProgression` wraps degrees and will not
stop you.

`chordProgressions.migration.test.ts` carries the 22 original interval-form progressions as a fixture
and proves the degree form reproduces them in all 12 roots. **Changing a degree without changing that
fixture is how you silently rewrite a progression** — if the proof fails, the degree is wrong, not the
fixture.
```

- [ ] **Step 4: Run the full gate**

```bash
bun run verify && bun run eslint
```

Expected: PASS. This is the **phase 3 boundary** and the completion gate.

- [ ] **Step 5: Verify by hand — the full matrix**

```bash
bun run dev
```

1. Load a progression, change the key in the header → it transposes; the tonic stays in position 1.
2. Change the scale only → it snaps; every chord root is a degree of the new scale.
3. Change key and scale in two clicks → transpose then snap; no chord collapses onto a neighbour.
4. Click an Instant Vibe → the chords on the grid are exactly the vibe's authored chords, unchanged.
5. Click Zen Garden → `Gm – Dsus4 – Gm – D#`, header scale `Hirajoshi (Japanese)`.
6. Turn Auto-Reharmonize off, change the key → nothing moves. Turn it back on → it snaps once.
7. Reload the page → the persisted progression comes back exactly as it was; the effect no longer harmonizes on mount.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/music-theory/SKILL.md
git commit -m "docs(skill): document the degree library and the transpose/snap split"
```

---

## Done criteria

- `bun run verify` and `bun run eslint` both pass.
- `reharmonizeProgressionToScale`, `ProgressionTemplate` and `CHORD_PROGRESSION_TEMPLATES` no longer appear anywhere in `src/` (`grep -rn` returns nothing).
- The migration-equivalence proof passes: 22 progressions × 12 roots, compared against the interval-form fixture including `notes`.
- Every `VibeGenre` has at least four tagged progressions, and each genre's exact id set is asserted.
- `SCALES` contains `Hirajoshi` and every Instant Vibe's `scaleType` is a key of `SCALES`.
- `scripts/themeTokenGuard.ts`'s `ALLOWLIST` is still empty.
- The store version is still 3 and `partializeAppState` is unchanged.
- Every row of the hand-verification matrix in Task 9 Step 5 behaves as described.
