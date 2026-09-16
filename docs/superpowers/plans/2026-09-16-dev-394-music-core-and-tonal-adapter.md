# DEV-394 — Music Core and a Single Tonal Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Solna one public Music Core API and one production Tonal-import boundary
(`src/musicCore/tonalAdapter.ts`), and consolidate the app's four drifting chord-quality
representations into one registry that the chord-quality type, the picker, the formatter and
chord-note resolution all derive from.

**Architecture:** A new top-level directory, `src/musicCore/`, sits between `src/data/` and
`src/store/`/`src/audio/`/`src/components/` in the dependency graph (parallel to `src/utils/`,
which stays outside the four-layer chain per CLAUDE.md). `src/musicCore/tonalAdapter.ts` is the
only file in production code allowed to `import ... from 'tonal'`; every Tonal call currently
inside the six DEV-395-allowlisted files moves there as a thin, Solna-shaped wrapper function
(plain strings/numbers in and out, never a Tonal type). `src/musicCore/chordQuality.ts` owns the
canonical chord-quality registry and the operations built on it (`ChordQuality` type,
`resolveChordNotes`, `formatChordQuality`, the picker's option groups). `src/musicCore/index.ts`
is the one public barrel; nothing outside `src/musicCore/` imports `tonalAdapter.ts` or
`chordQuality.ts` directly. The six original files keep their existing exported function
names/signatures (`ROOTS`, `TONAL_CHORD_ALIASES`, `formatChordQuality`, `generateBlockChordNotes`,
etc. all keep working from `@/utils/musicTheory`) so none of their ~20 existing consumer files
need an import-path change — only the *internals* of those six files change, from calling Tonal
directly to calling Music Core.

**Tech Stack:** Bun (test runner), TypeScript, `tonal` (confined by this issue to one file),
ESLint flat config (`no-restricted-imports`), `bun:test`.

**Spec:** This issue's own acceptance criteria (given in the task prompt); codebase findings in
`docs/superpowers/plans/2026-09-16-dev-391-music-domain-architecture-epic-plan.md` §"2. DEV-394";
architectural contract in
`docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md` (this plan's
Task 13 updates that doc and CLAUDE.md's matching paragraph to reflect DEV-394's completion).

## Global Constraints

- `bun run verify` (eslint zero-warning baseline, both Knip scans, all tests, production build)
  must pass at the end of this issue — run it as Task 14, the completion gate.
- **No migration chains**: any persisted-shape validation change (the `ChordItem.quality`
  tightening in Task 4) is a validate-at-ingress change (`sanitize.ts`'s `isChordItem`), never a
  version-gated `if (version < N)` step.
- **Canonical sharp vs. display spelling stays split** (DEV-380): every function this plan moves
  keeps returning ROOTS-spelled (canonical sharp) values from `musicTheory.ts`; `noteSpelling.ts`
  keeps being the only place display spelling happens. Task 3 and Task 5 move *where* Tonal is
  called from, never *what* the moved functions return.
- Layering: `src/musicCore/**` must not import `store/` or `components/`; may import `src/data/`
  (for `SCALES`). `src/data/**` continues to import nothing at runtime — Task 4's
  `ProgressionStep.quality` retype uses `import type`, which the layer already permits.
- Branch naming: `<type>/<issue-code>-<slug>` — this work continues on the already-checked-out
  `feat/dev-394-music-core-tonal-adapter` branch.
- Every task ends with `bun run lint` (tsc, no emit) and the task's own `bun test` scope both
  clean before moving to the next task — do not accumulate type errors across tasks.

## What this issue does NOT do

Read this before starting — these are deliberate exclusions, not oversights:

- **No general pitch-parsing API.** DEV-392 (next in the epic) centralizes note-regex parsing,
  scale lookup, MIDI conversion and a "genuinely invalid input" failure policy used by lead
  recording, the melody grid, bass resolution and keyboard construction. This issue's adapter
  wrappers (`noteMidi`, `chromaOfNote`, etc.) are narrow, named after exactly what today's six
  files already compute — not a redesigned canonical pitch API. `musicTheory.ts:388`'s duplicate
  note-regex, `Keyboard.tsx:72`'s manual octave arithmetic and `bassPatterns.ts:103`'s hardcoded
  Major-interval fallback are untouched.
- **No reharmonization-classification fix.** `snapProgressionToScale`'s
  `chord.quality.includes('7')`/`.includes('9')` dispatch and its four-item quality-preservation
  list (`musicTheory.ts:424-430`) are left exactly as they are. The registry's
  `reharmonizationCategory` field (Task 2) exists solely so DEV-393 has an obvious place to read a
  classification from instead of a substring test — this issue assigns a category to every
  quality but wires nothing to consume it.
- **No `ChordItem.notes` derivation guarantee.** DEV-396 makes `notes` strictly derived from
  `root`/`quality` everywhere. This issue leaves `chord.notes` as an independently stored
  `string[]` exactly as today; `deriveChordNotes` keeps being the one function that populates it
  correctly, unchanged in this issue.
- **No auto-generated `src/data/` content.** The registry and the adapter add no code path that
  produces a `src/data/chordProgressions.ts`/preset/vibe entry from Tonal's catalog. Authored
  content stays hand-curated.
- **No change to which six behaviours the six files compute**, except the one the acceptance
  criteria explicitly require: an unregistered chord quality now throws instead of silently
  resolving to `'maj'` (`resolveChordNotes` in Task 2; `generateBlockChordNotes` used to do this
  at `musicTheory.ts:577-580`).

## File structure

New://musicCore/
- `src/musicCore/tonalAdapter.ts` — the one production file that imports `tonal`. Nine thin wrapper
  functions plus a musicCore-internal `resolveTonalChord`.
- `src/musicCore/tonalAdapter.test.ts` — characterizes every wrapper against a direct Tonal call
  (test files may import `tonal` directly; this is the DEV-394 equivalent of the six old
  characterization tests).
- `src/musicCore/chordQuality.ts` — `ROOTS`, `ChordQuality`, `ReharmonizationCategory`,
  `ChordQualityEntry`, `CHORD_QUALITY_REGISTRY`, `CHORD_QUALITY_ALIASES`, `CHORD_QUALITY_GROUPS`,
  `isChordQuality`, `getChordQualityEntry`, `formatChordQuality`, `resolveChordNotes`.
- `src/musicCore/chordQuality.test.ts` — registry completeness, alias/group/formatter derivation,
  the unregistered-quality throw.
- `src/musicCore/index.ts` — the public barrel. Re-exports the adapter's nine wrappers and
  everything from `chordQuality.ts` except the musicCore-internal `resolveTonalChord`/
  `TonalChordResult`.

Modified (stop importing `tonal`; call `@/musicCore` instead):
- `src/utils/musicTheory.ts` — internals of `isNoteInScale`, `transposeNoteBySemitones`,
  `remapNoteByScaleDegree`, `resolveParentDegreeQuality`, `rootSemitone`, `noteFrequency`,
  `shiftNoteOctave`, `generateBlockChordNotes`; `ROOTS`/`TONAL_CHORD_ALIASES`/`formatChordQuality`
  become re-exports; `BorrowedChord.quality`, `getDiatonicChordForDegree`'s return type,
  `resolveDegreeQuality`'s return type and the two quality-by-interval tables retype to
  `ChordQuality`.
- `src/utils/noteSpelling.ts` — internals of the `SHARP_NAMES`/`FLAT_NAMES` construction,
  `getTonicSpelling`, `getKeyAccidental`, `spellPitchClassUncached`, `spellMidiInKey`,
  `spellNoteInKey`, `spellScaleNotes`. No exported signature changes.
- `src/audio/arpeggiator.ts` — `buildArpSequenceUncached`'s sort comparator and octave-transpose
  loop.
- `src/audio/bassPatterns.ts` — `midiAtOctave` and `resolveBassSteps`'s note-name construction.
- `src/audio/playback/padPlayback.ts` — `resolveDroneNotes`'s transpose call.
- `src/store/midiInput.ts` — the MIDI note-on handler's note-name lookup.
- `src/types.ts` — `ChordItem.quality: string` → `ChordItem.quality: ChordQuality`.
- `src/data/chordProgressions.ts` — `ProgressionStep.quality?: string` → `?: ChordQuality` (type-only
  import, permitted in `src/data/`).
- `src/store/sanitize.ts` — `isChordItem` validates `quality` against `isChordQuality`.
- `src/components/loop/chord/useChordView.ts`, `src/components/loop/chord/ProgressionCard.tsx`,
  `src/store/instantVibesChordsFixture.ts` — retype local `quality: string` parameters that build
  a `ChordItem` to `quality: ChordQuality`.
- `src/components/loop/chord/SortableChordCard.tsx` — delete the hand-written `QUALITY_GROUPS`
  table; render `CHORD_QUALITY_GROUPS` from `@/musicCore` instead (closes the `minMaj7`/`maj7#5`
  picker gap).
- `eslint.config.js` — the six DEV-395 carve-out blocks are deleted; two new blocks gate
  `src/musicCore/**` (tonal banned) and `src/musicCore/tonalAdapter.ts` (tonal allowed).
- `src/architecture/dependencyLayers.test.ts` — rewritten to prove the new, narrower boundary.
- `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md`, `CLAUDE.md` —
  the "Gated but not yet moved" / "fifth axis" text updated from "six files, future adapter" to
  "one adapter file, implemented."

Test-only touch-ups (typing only, no assertion changes unless noted):
- `src/utils/musicTheory.test.ts` — `chord()` helper's `quality` param retypes to `ChordQuality`;
  new `describe` block asserting every `resolveDegreeQuality` output is a registered quality.
- `src/components/loop/chord/SortableChordCard.test.tsx` — `chord`/`flatChord` fixtures gain an
  explicit `ChordItem` type annotation; new `describe` block asserts the rendered options include
  `minMaj7`/`maj7#5`.

---

## Task 1: `src/musicCore/tonalAdapter.ts` — the Tonal adapter

**Files:**
- Create: `src/musicCore/tonalAdapter.ts`
- Test: `src/musicCore/tonalAdapter.test.ts`

**Interfaces:**
- Produces (consumed by Task 2 and Tasks 3–9): `chromaOfNote(note: string): number`,
  `noteMidi(note: string): number | null`, `midiToSharpName(midi: number): string`,
  `midiToFlatName(midi: number): string`, `pitchClassOfNote(note: string): string`,
  `transposeByInterval(note: string, intervalName: string): string`,
  `intervalDistance(from: string, to: string): string`,
  `intervalSemitones(intervalName: string): number`,
  `scaleNotesForTonal(tonic: string, tonalScaleName: string): string[]`,
  `resolveTonalChord(tonalType: string, root: string): TonalChordResult` where
  `interface TonalChordResult { empty: boolean; intervals: readonly string[] }`.

- [ ] **Step 1: Write the failing test file**

Create `src/musicCore/tonalAdapter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Chord, Interval, Note, Scale, transpose } from 'tonal';
import {
  chromaOfNote,
  intervalDistance,
  intervalSemitones,
  midiToFlatName,
  midiToSharpName,
  noteMidi,
  pitchClassOfNote,
  resolveTonalChord,
  scaleNotesForTonal,
  transposeByInterval,
} from './tonalAdapter';

describe('tonalAdapter', () => {
  test('chromaOfNote matches Note.get(...).chroma, including NaN for an unparseable name', () => {
    expect(chromaOfNote('C#4')).toBe(Note.get('C#4').chroma);
    expect(Number.isNaN(chromaOfNote('not-a-note'))).toBe(true);
    expect(Note.get('not-a-note').empty).toBe(true);
  });

  test('noteMidi matches Note.midi', () => {
    expect(noteMidi('C4')).toBe(Note.midi('C4'));
    expect(noteMidi('not-a-note')).toBeNull();
  });

  test('midiToSharpName matches Note.fromMidiSharps', () => {
    expect(midiToSharpName(61)).toBe(Note.fromMidiSharps(61));
    expect(midiToSharpName(61)).toBe('C#5');
  });

  test('midiToFlatName matches Note.fromMidi', () => {
    expect(midiToFlatName(61)).toBe(Note.fromMidi(61));
    expect(midiToFlatName(61)).toBe('Db5');
  });

  test('pitchClassOfNote matches Note.pitchClass', () => {
    expect(pitchClassOfNote('Db5')).toBe(Note.pitchClass('Db5'));
    expect(pitchClassOfNote('Db5')).toBe('Db');
  });

  test('transposeByInterval matches transpose verbatim, including empty string on failure', () => {
    expect(transposeByInterval('C4', '8P')).toBe(transpose('C4', '8P'));
    expect(transposeByInterval('not-a-note', '8P')).toBe('');
  });

  test('intervalDistance matches Interval.distance', () => {
    expect(intervalDistance('C', 'E')).toBe(Interval.distance('C', 'E'));
    expect(intervalDistance('C', 'E')).toBe('3M');
  });

  test('intervalSemitones matches Interval.semitones', () => {
    expect(intervalSemitones('3M')).toBe(Interval.semitones('3M'));
    expect(intervalSemitones('3M')).toBe(4);
  });

  test('scaleNotesForTonal matches Scale.get(...).notes', () => {
    expect(scaleNotesForTonal('C', 'major')).toEqual(Scale.get('C major').notes);
  });

  test('resolveTonalChord narrows Chord.getChord to { empty, intervals }', () => {
    const chord = Chord.getChord('maj7', 'C');
    expect(resolveTonalChord('maj7', 'C')).toEqual({ empty: chord.empty, intervals: chord.intervals });
    expect(resolveTonalChord('not-a-chord-type', 'C').empty).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/musicCore/tonalAdapter.test.ts`
Expected: FAIL — `Cannot find module './tonalAdapter'` (the module does not exist yet).

- [ ] **Step 3: Write the adapter**

Create `src/musicCore/tonalAdapter.ts`:

```ts
import { Chord, Interval, Note, Scale, transpose } from 'tonal';

/**
 * The ONLY file in production code permitted to `import ... from 'tonal'`
 * (DEV-394, closing the allowlist DEV-395 opened across six call sites — see
 * eslint.config.js's TONAL_IMPORT_BAN carve-out and
 * docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md).
 * Every export here is a thin, Solna-shaped wrapper: plain strings and
 * numbers in, plain strings/numbers/booleans out — never a Tonal `NoteName`,
 * `Chord` or `Interval` object. `src/musicCore/chordQuality.ts` and every
 * production file outside this one call these wrappers through
 * `src/musicCore/index.ts`'s barrel, never `tonal` itself and never this file
 * directly.
 *
 * This module is not DEV-392's canonical pitch-parsing API: it does not
 * define a "parse a pitch" operation, a failure-policy contract, or a
 * MIDI/pitch-class abstraction beyond what today's six call sites already
 * compute. It exists to move Tonal's call surface behind one door, not to
 * redesign it.
 */

/** `Note.get(note).chroma` verbatim — `NaN` for an unparseable name (Tonal's own contract; every caller already guards it with `Number.isFinite`). */
export function chromaOfNote(note: string): number {
  return Note.get(note).chroma;
}

/** `Note.midi(note)` verbatim; `null` for an unparseable name or a name with no octave. */
export function noteMidi(note: string): number | null {
  return Note.midi(note);
}

/** `Note.fromMidiSharps(midi)` — always the sharp spelling, with octave. */
export function midiToSharpName(midi: number): string {
  return Note.fromMidiSharps(midi);
}

/** `Note.fromMidi(midi)` — Tonal's default (flat) spelling, with octave. */
export function midiToFlatName(midi: number): string {
  return Note.fromMidi(midi);
}

/** `Note.pitchClass(note)` — the note name with its octave stripped. */
export function pitchClassOfNote(note: string): string {
  return Note.pitchClass(note);
}

/** `transpose(note, intervalName)` verbatim — Tonal's own interval notation (e.g. `'8P'`); an empty string on failure, exactly as Tonal returns it. Callers already guard the falsy result themselves. */
export function transposeByInterval(note: string, intervalName: string): string {
  return transpose(note, intervalName);
}

/** `Interval.distance(from, to)` — the interval name between two spelled note names (e.g. `'3M'`). */
export function intervalDistance(from: string, to: string): string {
  return Interval.distance(from, to);
}

/** `Interval.semitones(intervalName)` — `NaN` for an unparseable interval name. */
export function intervalSemitones(intervalName: string): number {
  return Interval.semitones(intervalName);
}

/** `Scale.get('${tonic} ${tonalScaleName}').notes` — the scale's spelled note names, tonic first. */
export function scaleNotesForTonal(tonic: string, tonalScaleName: string): string[] {
  return Scale.get(`${tonic} ${tonalScaleName}`).notes;
}

/** A Tonal chord-lookup result, narrowed to the two fields any caller needs. */
export interface TonalChordResult {
  empty: boolean;
  intervals: readonly string[];
}

/**
 * `Chord.getChord(tonalType, root)`, narrowed to `{ empty, intervals }`.
 * Deliberately NOT re-exported from `src/musicCore/index.ts` — only
 * `chordQuality.ts`'s `resolveChordNotes` calls it, so the public Music Core
 * surface never hands out a near-passthrough of a raw Tonal lookup.
 */
export function resolveTonalChord(tonalType: string, root: string): TonalChordResult {
  const chord = Chord.getChord(tonalType, root);
  return { empty: chord.empty, intervals: chord.intervals };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/musicCore/tonalAdapter.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Type-check**

Run: `bun run lint`
Expected: no new errors (the module is not imported by anything yet).

- [ ] **Step 6: Commit**

```bash
git add src/musicCore/tonalAdapter.ts src/musicCore/tonalAdapter.test.ts
git commit -m "$(cat <<'EOF'
feat(dev-394): add the Tonal adapter, src/musicCore/tonalAdapter.ts

The first step of Music Core (DEV-394): one file wraps every Tonal call
today's six allowlisted files use, in Solna-shaped functions (plain
strings/numbers, never a Tonal type). Nothing imports it yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 2: `src/musicCore/chordQuality.ts` + `src/musicCore/index.ts` — the chord-quality registry and public barrel

**Files:**
- Create: `src/musicCore/chordQuality.ts`
- Create: `src/musicCore/index.ts`
- Test: `src/musicCore/chordQuality.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produced, via `import { ... } from './tonalAdapter'`.
- Produces (consumed by Task 3 onward, via `@/musicCore`): `ROOTS: readonly string[]`,
  `type ChordQuality` (a 20-member string-literal union: `'maj' | 'min' | 'dim' | 'aug' | 'sus2' |
  'sus4' | 'maj7' | 'min7' | '7' | 'm7b5' | 'dim7' | '7sus4' | 'minMaj7' | 'maj7#5' | '9' | 'maj9' |
  'min9' | 'add9' | '6' | 'min6'`), `type ReharmonizationCategory`, `interface ChordQualityEntry`,
  `CHORD_QUALITY_REGISTRY: readonly ChordQualityEntry[]`,
  `CHORD_QUALITY_ALIASES: Readonly<Record<string, string>>`,
  `CHORD_QUALITY_GROUPS: readonly { label: string; options: readonly { value: ChordQuality; label: string }[] }[]`,
  `isChordQuality(value: string): value is ChordQuality`,
  `getChordQualityEntry(quality: string): ChordQualityEntry | undefined`,
  `formatChordQuality(quality: string): string`,
  `resolveChordNotes(quality: string, root?: string, octave?: number): string[]` (throws `Error`
  for an unregistered `quality` or one Tonal cannot resolve at the given root).

- [ ] **Step 1: Write the failing test file**

Create `src/musicCore/chordQuality.test.ts`:

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
} from './chordQuality';

describe('CHORD_QUALITY_REGISTRY', () => {
  test('every registered quality resolves through Tonal at a natural root', () => {
    for (const entry of CHORD_QUALITY_REGISTRY) {
      expect(() => resolveChordNotes(entry.token, 'C', 4)).not.toThrow();
      expect(resolveChordNotes(entry.token, 'C', 4).length).toBeGreaterThan(0);
    }
  });

  test('has no duplicate tokens', () => {
    const tokens = CHORD_QUALITY_REGISTRY.map((e) => e.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe('resolveChordNotes', () => {
  test('an unregistered quality throws rather than silently becoming maj', () => {
    expect(() => resolveChordNotes('not-a-real-quality', 'C', 4)).toThrow();
  });

  test('resolves the notes a registered quality names', () => {
    expect(resolveChordNotes('maj7', 'C', 4)).toEqual(['C4', 'E4', 'G4', 'B4']);
    expect(resolveChordNotes('min', 'A', 4)).toEqual(['A4', 'C5', 'E5']);
  });
});

describe('isChordQuality / getChordQualityEntry', () => {
  test('accepts every registered token case-insensitively', () => {
    expect(isChordQuality('minMaj7')).toBe(true);
    expect(isChordQuality('MINMAJ7')).toBe(true);
    expect(isChordQuality('not-a-quality')).toBe(false);
  });

  test('getChordQualityEntry returns undefined for an unregistered token', () => {
    expect(getChordQualityEntry('not-a-quality')).toBeUndefined();
  });
});

describe('formatChordQuality', () => {
  test('returns the registry display suffix', () => {
    expect(formatChordQuality('maj')).toBe('');
    expect(formatChordQuality('min7')).toBe('m7');
    expect(formatChordQuality('minMaj7')).toBe('mM7');
    expect(formatChordQuality('maj7#5')).toBe('maj7#5');
  });

  test('an unregistered token echoes itself', () => {
    expect(formatChordQuality('not-a-quality')).toBe('not-a-quality');
  });
});

describe('CHORD_QUALITY_ALIASES', () => {
  test('only lists tokens whose Tonal alias actually differs, matching the historical contract', () => {
    expect(CHORD_QUALITY_ALIASES.min9).toBe('m9');
    expect(CHORD_QUALITY_ALIASES.min6).toBe('m6');
    expect(CHORD_QUALITY_ALIASES.minmaj7).toBe('mMaj7');
    for (const [app, tonalType] of Object.entries(CHORD_QUALITY_ALIASES)) {
      expect(app).not.toBe(tonalType);
    }
  });
});

describe('CHORD_QUALITY_GROUPS', () => {
  test('covers every registered token exactly once, across the three groups', () => {
    const flattened = CHORD_QUALITY_GROUPS.flatMap((g) => g.options.map((o) => o.value));
    const registered = CHORD_QUALITY_REGISTRY.map((e) => e.token);
    expect([...flattened].sort()).toEqual([...registered].sort());
  });

  test('includes the two qualities the pre-DEV-394 picker was missing', () => {
    const values = CHORD_QUALITY_GROUPS.flatMap((g) => g.options.map((o) => o.value));
    expect(values).toContain('minMaj7');
    expect(values).toContain('maj7#5');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/musicCore/chordQuality.test.ts`
Expected: FAIL — `Cannot find module './chordQuality'`.

- [ ] **Step 3: Write the registry**

Create `src/musicCore/chordQuality.ts`:

```ts
import { intervalSemitones, noteMidi, resolveTonalChord } from './tonalAdapter';

/** The twelve sharp-spelled pitch-class names, index = chroma. Canonical identity per DEV-380 — nothing here ever spells a flat. */
export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * How a quality reharmonizes when a progression is snapped to a new key
 * (DEV-393's concern, not this issue's). A plain triad or seventh can be
 * replaced by the target scale's own diatonic chord at that degree; every
 * other category names a shape snapping cannot safely regenerate (a 6th, an
 * added tone, an extension, a suspension, a half-diminished/diminished
 * shape, or an altered chord like minMaj7/maj7#5) and today is preserved
 * verbatim by `snapProgressionToScale`'s own hardcoded list
 * (`src/utils/musicTheory.ts`). This issue only assigns the category; it
 * wires nothing to read it.
 */
export type ReharmonizationCategory =
  | 'triad'
  | 'seventh'
  | 'sixth'
  | 'added-tone'
  | 'extension'
  | 'suspended'
  | 'diminished-half-diminished'
  | 'altered';

export interface ChordQualityEntry {
  /** The token `ChordItem.quality` stores and every reader compares against. */
  token: ChordQuality;
  /** The chord-type string Tonal's `Chord.getChord` resolves for this token. */
  tonalAlias: string;
  /** The suffix `formatChordQuality`/`formatChordLabel` render after a spelled root, e.g. `''`, `'m7'`, `'mM7'`. */
  displaySuffix: string;
  /** The chord picker's option text, e.g. `'Minor 7th (min7)'`. */
  pickerLabel: string;
  /** The chord picker's `<optgroup>` label; option order within a group follows registry order. */
  pickerGroup: 'Triads' | '7th Chords' | 'Extensions & Additions';
  /** DEV-393's classification axis — read but not yet acted on by anything in this issue. */
  reharmonizationCategory: ReharmonizationCategory;
}

const CHORD_QUALITY_REGISTRY_ENTRIES = [
  { token: 'maj', tonalAlias: 'maj', displaySuffix: '', pickerLabel: 'Major (maj)', pickerGroup: 'Triads', reharmonizationCategory: 'triad' },
  { token: 'min', tonalAlias: 'min', displaySuffix: 'm', pickerLabel: 'Minor (min)', pickerGroup: 'Triads', reharmonizationCategory: 'triad' },
  { token: 'dim', tonalAlias: 'dim', displaySuffix: 'dim', pickerLabel: 'Diminished (dim)', pickerGroup: 'Triads', reharmonizationCategory: 'diminished-half-diminished' },
  { token: 'aug', tonalAlias: 'aug', displaySuffix: 'aug', pickerLabel: 'Augmented (aug)', pickerGroup: 'Triads', reharmonizationCategory: 'altered' },
  { token: 'sus2', tonalAlias: 'sus2', displaySuffix: 'sus2', pickerLabel: 'Sus 2', pickerGroup: 'Triads', reharmonizationCategory: 'suspended' },
  { token: 'sus4', tonalAlias: 'sus4', displaySuffix: 'sus4', pickerLabel: 'Sus 4', pickerGroup: 'Triads', reharmonizationCategory: 'suspended' },
  { token: 'maj7', tonalAlias: 'maj7', displaySuffix: 'maj7', pickerLabel: 'Major 7th (maj7)', pickerGroup: '7th Chords', reharmonizationCategory: 'seventh' },
  { token: 'min7', tonalAlias: 'min7', displaySuffix: 'm7', pickerLabel: 'Minor 7th (min7)', pickerGroup: '7th Chords', reharmonizationCategory: 'seventh' },
  { token: '7', tonalAlias: '7', displaySuffix: '7', pickerLabel: 'Dominant 7th (7)', pickerGroup: '7th Chords', reharmonizationCategory: 'seventh' },
  { token: 'm7b5', tonalAlias: 'm7b5', displaySuffix: 'm7b5', pickerLabel: 'Half-Dim (m7b5)', pickerGroup: '7th Chords', reharmonizationCategory: 'diminished-half-diminished' },
  { token: 'dim7', tonalAlias: 'dim7', displaySuffix: 'dim7', pickerLabel: 'Diminished 7th (dim7)', pickerGroup: '7th Chords', reharmonizationCategory: 'diminished-half-diminished' },
  { token: '7sus4', tonalAlias: '7sus4', displaySuffix: '7sus4', pickerLabel: '7 Sus 4', pickerGroup: '7th Chords', reharmonizationCategory: 'suspended' },
  { token: 'minMaj7', tonalAlias: 'mMaj7', displaySuffix: 'mM7', pickerLabel: 'Minor Major 7th (mM7)', pickerGroup: '7th Chords', reharmonizationCategory: 'altered' },
  { token: 'maj7#5', tonalAlias: 'maj7#5', displaySuffix: 'maj7#5', pickerLabel: 'Major 7th #5 (maj7#5)', pickerGroup: '7th Chords', reharmonizationCategory: 'altered' },
  { token: '9', tonalAlias: '9', displaySuffix: '9', pickerLabel: 'Dominant 9th (9)', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'extension' },
  { token: 'maj9', tonalAlias: 'maj9', displaySuffix: 'maj9', pickerLabel: 'Major 9th (maj9)', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'extension' },
  { token: 'min9', tonalAlias: 'm9', displaySuffix: 'm9', pickerLabel: 'Minor 9th (min9)', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'extension' },
  { token: 'add9', tonalAlias: 'add9', displaySuffix: 'add9', pickerLabel: 'Add 9', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'added-tone' },
  { token: '6', tonalAlias: '6', displaySuffix: '6', pickerLabel: 'Major 6th (6)', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'sixth' },
  { token: 'min6', tonalAlias: 'm6', displaySuffix: 'm6', pickerLabel: 'Minor 6th (min6)', pickerGroup: 'Extensions & Additions', reharmonizationCategory: 'sixth' },
] as const;

/** Every chord quality Solna's chord editor, degree resolver and playback can name. */
export type ChordQuality = (typeof CHORD_QUALITY_REGISTRY_ENTRIES)[number]['token'];

/**
 * One entry per token; a new quality is one row above, never a second
 * hand-written array — `ChordQuality`, `CHORD_QUALITY_GROUPS`,
 * `CHORD_QUALITY_ALIASES` and `formatChordQuality` are all DERIVED from this
 * table, not maintained beside it.
 */
export const CHORD_QUALITY_REGISTRY: readonly ChordQualityEntry[] = CHORD_QUALITY_REGISTRY_ENTRIES;

const registryByLowercaseToken = new Map<string, ChordQualityEntry>(
  CHORD_QUALITY_REGISTRY.map((entry) => [entry.token.toLowerCase(), entry]),
);

/** Whether `value` is a registered chord-quality token (case-insensitive, matching the historical `.toLowerCase()` lookup contract `formatChordQuality`/`generateBlockChordNotes` used). */
export function isChordQuality(value: string): value is ChordQuality {
  return registryByLowercaseToken.has(value.toLowerCase());
}

/** The registry entry for `quality`, or `undefined` if it names no registered quality. */
export function getChordQualityEntry(quality: string): ChordQualityEntry | undefined {
  return registryByLowercaseToken.get(quality.toLowerCase());
}

/** Display suffix for a chord quality token, e.g. 'maj' -> '', 'min7' -> 'm7'. An unregistered token echoes itself, same contract as the pre-DEV-394 `CHORD_QUALITY_LABELS` lookup. */
export function formatChordQuality(quality: string): string {
  return getChordQualityEntry(quality)?.displaySuffix ?? quality;
}

/** App-token -> Tonal-alias pairs, but ONLY where they differ — the historical `TONAL_CHORD_ALIASES` contract `musicTheory.test.ts` pins (`app !== tonalType` for every entry). */
export const CHORD_QUALITY_ALIASES: Readonly<Record<string, string>> = Object.fromEntries(
  CHORD_QUALITY_REGISTRY.filter((entry) => entry.token.toLowerCase() !== entry.tonalAlias.toLowerCase()).map(
    (entry) => [entry.token.toLowerCase(), entry.tonalAlias],
  ),
);

/** The picker's option groups, built from the registry so a new quality needs one row, never a second table. Group order and per-group option order both follow registry order. */
export const CHORD_QUALITY_GROUPS: readonly {
  label: string;
  options: readonly { value: ChordQuality; label: string }[];
}[] = (['Triads', '7th Chords', 'Extensions & Additions'] as const).map((label) => ({
  label,
  options: CHORD_QUALITY_REGISTRY.filter((entry) => entry.pickerGroup === label).map((entry) => ({
    value: entry.token,
    label: entry.pickerLabel,
  })),
}));

/**
 * A chord quality's notes at a root/octave. Every registered quality
 * resolves through Tonal's `Chord.getChord` (proven exhaustively by this
 * file's own test); an unregistered quality — or a registered one Tonal
 * still cannot resolve for the given root — throws instead of silently
 * becoming a `maj` triad, which is what `generateBlockChordNotes` did before
 * this issue (the one explicit behavior fix DEV-394's acceptance criteria
 * require; see `musicTheory.ts`'s re-export of this function).
 */
export function resolveChordNotes(quality: string, root = 'C', octave = 4): string[] {
  const entry = getChordQualityEntry(quality);
  if (!entry) {
    throw new Error(`Unregistered chord quality: "${quality}"`);
  }
  const chordData = resolveTonalChord(entry.tonalAlias, root);
  if (chordData.empty) {
    throw new Error(
      `Tonal could not resolve registered quality "${quality}" (alias "${entry.tonalAlias}") at root "${root}"`,
    );
  }
  const rootMidi = noteMidi(`${root}${octave}`) ?? noteMidi(`C${octave}`) ?? 60;
  return chordData.intervals.map((ivl) => {
    const semitones = intervalSemitones(ivl);
    const midi = rootMidi + (Number.isFinite(semitones) ? semitones : 0);
    const noteName = ROOTS[((midi % 12) + 12) % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${noteName}${oct}`;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/musicCore/chordQuality.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Write the public barrel**

Create `src/musicCore/index.ts`:

```ts
/**
 * Music Core's public API (DEV-394). Every production file outside
 * `src/musicCore/` that needs pitch, interval or chord-quality operations
 * imports from here — never from `./tonalAdapter` or `./chordQuality`
 * directly, and never from `tonal` (eslint.config.js's `TONAL_IMPORT_BAN`
 * enforces the latter; see
 * docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md).
 *
 * `resolveTonalChord`/`TonalChordResult` (tonalAdapter.ts) are deliberately
 * NOT re-exported: nothing outside `chordQuality.ts`'s `resolveChordNotes`
 * needs a near-passthrough of a raw Tonal chord lookup.
 */
export {
  chromaOfNote,
  intervalDistance,
  intervalSemitones,
  midiToFlatName,
  midiToSharpName,
  noteMidi,
  pitchClassOfNote,
  scaleNotesForTonal,
  transposeByInterval,
} from './tonalAdapter';

export {
  CHORD_QUALITY_ALIASES,
  CHORD_QUALITY_GROUPS,
  CHORD_QUALITY_REGISTRY,
  ROOTS,
  formatChordQuality,
  getChordQualityEntry,
  isChordQuality,
  resolveChordNotes,
} from './chordQuality';
export type { ChordQuality, ChordQualityEntry, ReharmonizationCategory } from './chordQuality';
```

- [ ] **Step 6: Type-check and run the full musicCore suite**

Run: `bun run lint && bun test src/musicCore`
Expected: no errors; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/musicCore/chordQuality.ts src/musicCore/chordQuality.test.ts src/musicCore/index.ts
git commit -m "$(cat <<'EOF'
feat(dev-394): add the chord-quality registry and Music Core's public barrel

One registry (app token, Tonal alias, display suffix, picker label/group,
reharmonization category) now owns every chord quality Solna knows.
resolveChordNotes throws on an unregistered quality instead of silently
falling back to maj. Nothing consumes @/musicCore yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 3: Migrate `src/utils/musicTheory.ts` off `tonal`

**Files:**
- Modify: `src/utils/musicTheory.ts`
- Modify: `src/utils/musicTheory.test.ts`

**Interfaces:**
- Consumes: `@/musicCore`'s full public surface from Tasks 1–2.
- Produces (unchanged names/signatures for ~20 existing consumer files): `ROOTS`,
  `TONAL_CHORD_ALIASES`, `formatChordQuality(quality: string): string`,
  `formatChordLabel(root: string, quality: string, key?: SpellingKey): string`,
  `generateBlockChordNotes(chord: string, root?: string, octave?: number): string[]`,
  `deriveChordNotes`, `getScaleNotes`, `getScaleNotesInOctave`, `isNoteInScale`,
  `transposeNoteBySemitones`, `remapNoteByScaleDegree`, `rootSemitone`, `noteFrequency`,
  `shiftNoteOctave`, `transposeProgression`, `snapProgressionToScale`.
- Produces (retyped, still same names): `resolveDegreeQuality(...): ChordQuality`,
  `getDiatonicChordForDegree(...): { root: string; quality: ChordQuality; degreeName: string }`,
  `resolveParentDegreeQuality(...): ChordQuality`, `interface BorrowedChord { root: string;
  quality: ChordQuality; label: string }`.

- [ ] **Step 1: Confirm the pre-refactor baseline passes**

Run: `bun test src/utils/musicTheory.test.ts`
Expected: PASS (this is a refactor of already-characterized behavior, not new behavior — the
existing suite is today's baseline; no new failing test is written first).

- [ ] **Step 2: Replace the `tonal` import and rewrite each function's internals**

In `src/utils/musicTheory.ts`, replace the top import block:

```ts
import { Chord, Interval, Note, Scale, transpose } from 'tonal';
import { ChordItem } from '../types';
import { METERS } from './meter';
import { SCALES } from '@/data/scales';
import { spellPitchClassInKey, type SpellingKey } from './noteSpelling';
import { resolveScaleKey, scaleEntry } from './scaleLookup';
```

with:

```ts
import {
  CHORD_QUALITY_ALIASES,
  ROOTS,
  chromaOfNote,
  formatChordQuality,
  intervalDistance,
  intervalSemitones,
  midiToSharpName,
  noteMidi,
  resolveChordNotes,
  scaleNotesForTonal,
  transposeByInterval,
  type ChordQuality,
} from '@/musicCore';
import { ChordItem } from '../types';
import { METERS } from './meter';
import { SCALES } from '@/data/scales';
import { spellPitchClassInKey, type SpellingKey } from './noteSpelling';
import { resolveScaleKey, scaleEntry } from './scaleLookup';

// Backward-compatible re-exports: these three names are now owned by Music
// Core's chord-quality registry (src/musicCore/chordQuality.ts) — kept under
// their historical names so this file's ~20 existing consumers need no
// import-path change.
export { ROOTS, formatChordQuality, CHORD_QUALITY_ALIASES as TONAL_CHORD_ALIASES };
```

Then rewrite each Tonal-touching function body (signatures and everything else in the file stay
unchanged unless noted):

```ts
export function isNoteInScale(noteWithOrWithoutOctave: string, root: string, scaleType: string): boolean {
  const chroma = chromaOfNote(noteWithOrWithoutOctave);
  if (!Number.isFinite(chroma)) return false;
  const rootChroma = chromaOfNote(root);
  if (!Number.isFinite(rootChroma)) return false;

  const interval = (chroma - rootChroma + 12) % 12;
  const scale = SCALES[scaleType] || SCALES['Major'];
  return scale.intervals.includes(interval);
}

export function transposeNoteBySemitones(note: string, semitones: number): string {
  const midi = noteMidi(note);
  if (midi == null) return note;
  return midiToSharpName(midi + semitones);
}

export function remapNoteByScaleDegree(
  note: string,
  fromRoot: string,
  fromScaleType: string,
  toRoot: string,
  toScaleType: string,
): string {
  const midi = noteMidi(note);
  if (midi == null) return note;
  const rootRef = rootSemitone(fromRoot);
  const block = Math.floor((midi - rootRef) / 12);
  const offset = ((midi - rootRef) % 12 + 12) % 12;
  const fromIntervals = (SCALES[fromScaleType] || SCALES['Major']).intervals;
  const degree = fromIntervals.indexOf(offset);
  if (degree === -1) return note;
  const toIntervals = (SCALES[toScaleType] || SCALES['Major']).intervals;
  if (degree >= toIntervals.length) return note;
  return midiToSharpName(rootSemitone(toRoot) + block * 12 + toIntervals[degree]);
}
```

Retype the two interval-lookup tables' value type from `Record<string, string>` to
`Record<string, ChordQuality>` (contents unchanged):

```ts
const TRIAD_QUALITY_BY_INTERVALS: Record<string, ChordQuality> = {
  '3M 5P': 'maj',
  '3m 5P': 'min',
  '3m 5d': 'dim',
  '3M 5A': 'aug',
};

const SEVENTH_QUALITY_BY_INTERVALS: Record<string, ChordQuality> = {
  '3M 5P 7M': 'maj7',
  '3M 5P 7m': '7',
  '3m 5P 7m': 'min7',
  '3m 5d 7m': 'm7b5',
  '3m 5d 7d': 'dim7',
  '3m 5P 7M': 'minMaj7',
  '3M 5A 7M': 'maj7#5',
};
```

Retype the cache and `resolveParentDegreeQuality`/`resolveDegreeQuality`:

```ts
const degreeQualityCache = new Map<string, ChordQuality>();
```

```ts
export function resolveParentDegreeQuality(
  parentKey: string,
  parentDegree: number,
  use7ths: boolean,
): ChordQuality {
  const notes = scaleNotesForTonal('C', SCALES[parentKey].tonal);
  const chordRoot = notes[parentDegree];
  const third = intervalDistance(chordRoot, notes[(parentDegree + 2) % 7]);
  const fifth = intervalDistance(chordRoot, notes[(parentDegree + 4) % 7]);
  const seventh = intervalDistance(chordRoot, notes[(parentDegree + 6) % 7]);

  const tuple = use7ths ? `${third} ${fifth} ${seventh}` : `${third} ${fifth}`;
  const table = use7ths ? SEVENTH_QUALITY_BY_INTERVALS : TRIAD_QUALITY_BY_INTERVALS;
  const quality = table[tuple];
  if (quality === undefined) {
    throw new Error(
      `No ${use7ths ? 'seventh' : 'triad'} quality for (${tuple}) at ${parentKey} degree ${parentDegree}`,
    );
  }
  return quality;
}

export function resolveDegreeQuality(scaleType: string, degree: number, use7ths: boolean): ChordQuality {
  const cacheKey = `${scaleType}|${degree}|${use7ths}`;
  const cached = degreeQualityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const { parentKey, degrees } = parentDegreesFor(scaleType, degree);
  const qualities = [
    ...new Set(degrees.map((d) => resolveParentDegreeQuality(parentKey, d, use7ths))),
  ];
  if (qualities.length > 1) {
    throw new Error(
      `Equidistant parent degrees ${degrees.join(', ')} of ${parentKey} disagree ` +
        `(${qualities.join(', ')}) for ${scaleType} degree ${degree}`,
    );
  }
  const quality = qualities[0];
  degreeQualityCache.set(cacheKey, quality);
  return quality;
}
```

Retype `getDiatonicChordForDegree`'s return annotation only (`quality: string` → `quality:
ChordQuality`) and `BorrowedChord`'s field (`quality: string` → `quality: ChordQuality`); their
bodies are unchanged. Leave `isInScalePaletteChord`/`isDiatonic`'s local `quality: string`
parameters as-is (a `ChordQuality` argument is already assignable to a `string` parameter, so no
retype is required there).

Rewrite `noteFrequency` and `shiftNoteOctave`:

```ts
export function noteFrequency(note: string, octaveOffset = 0): number {
  const midi = noteMidi(note);
  if (midi == null) return 440;
  return 440 * Math.pow(2, (midi + 12 * octaveOffset - 69) / 12);
}

export function shiftNoteOctave(note: string, octaves: number): string {
  if (octaves === 0) return note;
  const degree = 8 + 7 * (Math.abs(octaves) - 1);
  const shifted = transposeByInterval(note, `${octaves > 0 ? '' : '-'}${degree}P`);
  return shifted || note;
}
```

Delete the local `TONAL_CHORD_ALIASES` and `CHORD_QUALITY_LABELS` constants and the old
`formatChordQuality` function entirely (both are now the re-exports added above). Rewrite
`generateBlockChordNotes` as a thin delegate:

```ts
/**
 * Notes for a chord quality at a root/octave. The resolution itself —
 * registry lookup, the Tonal call, the unregistered-quality failure — now
 * lives in Music Core's `resolveChordNotes` (src/musicCore/chordQuality.ts);
 * this name and signature stay so the app's many callers need no change.
 */
export function generateBlockChordNotes(chord: string, root = 'C', octave = 4): string[] {
  return resolveChordNotes(chord, root, octave);
}
```

Leave `getScaleNotes`, `getScaleNotesInOctave`, `getBorrowedChords`, `transposeProgression`,
`transposePitchClass`, `snapProgressionToScale`, `deriveChordNotes`, `sixteenthNoteMs`,
`STEPS_PER_BAR`, `MIN_BPM`, `MAX_BPM`, `clampBpm`, `stepDurationSec`, `barDurationSec`,
`formatChordLabel`, `spellChordRoot` untouched — none of them call Tonal directly.

- [ ] **Step 3: Retype the test helper and add the registry-coverage test**

In `src/utils/musicTheory.test.ts`, add `import type { ChordQuality } from '@/musicCore';` and
`import { isChordQuality } from '@/musicCore';` to the import block, then retype the `chord`
helper:

```ts
const chord = (id: string, root: string, quality: ChordQuality, bars = 1): ChordItem =>
  deriveChordNotes({ id, root, quality, bars, notes: [] }, 4);
```

Append a new `describe` block proving the acceptance criterion "every quality
`resolveDegreeQuality` can emit is representable in the chord editor":

```ts
describe('resolveDegreeQuality output vs. the chord-quality registry', () => {
  test('every triad and seventh quality every scale can emit is a registered, picker-representable token', () => {
    for (const scaleType of SCALE_KEYS) {
      const numDegrees = SCALES[scaleType].intervals.length;
      for (let degree = 0; degree < numDegrees; degree++) {
        for (const use7ths of [false, true]) {
          const quality = resolveDegreeQuality(scaleType, degree, use7ths);
          expect(isChordQuality(quality)).toBe(true);
        }
      }
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it still passes, plus the new coverage**

Run: `bun test src/utils/musicTheory.test.ts`
Expected: PASS, including the new `describe` block.

- [ ] **Step 5: Type-check**

Run: `bun run lint`
Expected: no errors in `musicTheory.ts`/`musicTheory.test.ts` (other files may still error until
Task 4 retypes `ChordItem.quality` — if `bun run lint` reports errors in *other* files at this
point, that is expected and Task 4 resolves them; do not fix them here).

- [ ] **Step 6: Commit**

```bash
git add src/utils/musicTheory.ts src/utils/musicTheory.test.ts
git commit -m "$(cat <<'EOF'
refactor(dev-394): move musicTheory.ts's Tonal calls behind Music Core

musicTheory.ts no longer imports tonal directly — every former Tonal call
(Note.get/midi/fromMidiSharps, Scale.get, Interval.distance/semitones,
transpose, Chord.getChord) now goes through @/musicCore. Public exports and
behavior are unchanged except generateBlockChordNotes, which now throws on
an unregistered quality via Music Core's resolveChordNotes instead of
silently returning a maj chord.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 4: Retype `ChordItem.quality` and harden the sanitize boundary

**Files:**
- Modify: `src/types.ts`
- Modify: `src/data/chordProgressions.ts`
- Modify: `src/store/sanitize.ts`
- Modify: `src/components/loop/chord/useChordView.ts`
- Modify: `src/components/loop/chord/ProgressionCard.tsx`
- Modify: `src/store/instantVibesChordsFixture.ts`
- Modify: `src/components/loop/chord/SortableChordCard.test.tsx`
- Possibly modify: any other file `bun run lint` reports after this task's Step 2 (see Step 5).

**Interfaces:**
- Consumes: `ChordQuality` (Task 2/3), `isChordQuality` (Task 2).
- Produces: `ChordItem.quality: ChordQuality` (was `string`) — every later task's `ChordItem`
  literal must satisfy this.

**Why now:** `resolveChordNotes` (Task 2) throws on an unregistered quality. Before this task, the
only place a legacy or corrupted quality string could reach it was through `sanitize.ts`'s
`isChordItem`, which today accepts any string. Retyping `ChordItem.quality` turns every remaining
bad call site into a compile error (authored data, in-memory construction), and this task's
`sanitize.ts` change is what stops a bad *runtime* string (an imported `.solna` file, a stale
`localStorage` payload) from reaching `resolveChordNotes` at all — it is defaulted at the ingress
boundary instead, per the project's "validate, don't migrate" rule.

- [ ] **Step 1: Retype the two `quality` fields**

In `src/types.ts`, add `import type { ChordQuality } from './musicCore';` near the top and change:

```ts
export interface ChordItem {
  id: string;
  root: string;
  quality: string;
  bars: number;
  notes: string[];
  bassNote?: string | null;
}
```

to:

```ts
export interface ChordItem {
  id: string;
  root: string;
  quality: ChordQuality;
  bars: number;
  notes: string[];
  bassNote?: string | null;
}
```

In `src/data/chordProgressions.ts`, add `import type { ChordQuality } from '@/musicCore';` and
change `interface ProgressionStep`'s field:

```ts
quality?: string;
```

to:

```ts
quality?: ChordQuality;
```

- [ ] **Step 2: Run the type-checker to find every break**

Run: `bun run lint`
Expected: FAIL, listing every file whose `ChordItem`/`ProgressionStep` construction is no longer
type-safe. The known set (fix in Step 3) is: `src/components/loop/chord/useChordView.ts`,
`src/components/loop/chord/ProgressionCard.tsx`, `src/store/instantVibesChordsFixture.ts`,
`src/components/loop/chord/SortableChordCard.test.tsx`. If `bun run lint` reports additional
files, fix each with the same rule as Step 3: widen nothing, narrow the local parameter/binding to
`ChordQuality` (or annotate a literal with `ChordItem`) — never add an `as unknown as` cast and
never change what value is written.

- [ ] **Step 3: Fix the known break sites**

In `src/components/loop/chord/useChordView.ts`, add `import type { ChordQuality } from
'@/musicCore';` and retype the three local `quality: string` parameters that build a `ChordItem`:

```ts
function appendChord(
  chords: ChordItem[],
  root: string,
  quality: ChordQuality,
  octave: number,
  id: string,
): ChordItem[] {
```

```ts
const addBorrowedChord = (root: string, quality: ChordQuality) => {
```

```ts
const handlePreviewMouseDown = (
  e: React.MouseEvent | React.TouchEvent | React.KeyboardEvent,
  root: string,
  quality: ChordQuality,
) => {
```

In `src/components/loop/chord/ProgressionCard.tsx`, add `import type { ChordQuality } from
'@/musicCore';` and retype:

```ts
onAddBorrowed: (root: string, quality: ChordQuality) => void;
```

```ts
const hold = (root: string, quality: ChordQuality) => ({
```

In `src/store/instantVibesChordsFixture.ts`, add `import type { ChordQuality } from
'@/musicCore';` and retype:

```ts
function snapshotChord(id: string, root: string, quality: ChordQuality, bars: number, octave: number): ChordItem {
```

In `src/components/loop/chord/SortableChordCard.test.tsx`, add `import type { ChordItem } from
'@/types';` and annotate both chord fixtures:

```ts
const chord: ChordItem = {
  id: 'chord-1',
  root: 'A',
  quality: 'min7',
  bars: 1,
  notes: ['A3', 'C4', 'E4', 'G4'],
};
```

```ts
const flatChord: ChordItem = {
  id: 'chord-2',
  root: 'D#',
  quality: 'maj',
  bars: 1,
  notes: ['D#4', 'G4', 'A#4'],
};
```

- [ ] **Step 4: Harden `sanitize.ts`'s `isChordItem`**

In `src/store/sanitize.ts`, add `import { isChordQuality } from '@/musicCore';` near the top, then
change `isChordItem`:

```ts
function isChordItem(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.root === 'string' &&
    typeof value.quality === 'string' &&
    typeof value.bars === 'number' &&
    Number.isFinite(value.bars) &&
    value.bars > 0 &&
    isStringArray(value.notes)
  );
}
```

to:

```ts
function isChordItem(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.root === 'string' &&
    typeof value.quality === 'string' &&
    isChordQuality(value.quality) &&
    typeof value.bars === 'number' &&
    Number.isFinite(value.bars) &&
    value.bars > 0 &&
    isStringArray(value.notes)
  );
}
```

- [ ] **Step 5: Run the type-checker again, fixing any remaining reported file the same way**

Run: `bun run lint`
Expected: PASS. If not, repeat Step 2's rule at each remaining site until clean.

- [ ] **Step 6: Add a regression test for the sanitize fix**

In `src/store/sanitize.test.ts`, find the existing chord-sanitization tests (search for
`isChordItem` or a nearby `describe('sanitizeLoops'`-style block) and add:

```ts
test('a chord with an unregistered quality is rejected, not passed through', () => {
  const withBadQuality = {
    ...DEFAULT_LOOP, // use whatever this file's existing default-loop fixture is named
    chords: [{ id: 'c1', root: 'C', quality: 'not-a-real-quality', bars: 1, notes: ['C4'] }],
  };
  const sanitized = sanitizeLoops([withBadQuality], FALLBACK_LOOPS); // match this file's existing sanitizeLoops call shape
  expect(sanitized[0].chords[0].quality).not.toBe('not-a-real-quality');
});
```

Adjust the fixture names/call shape to match whatever `sanitize.test.ts` already uses elsewhere in
the file for a chord-sanitization test (read the file's existing chord tests immediately before
writing this one, and mirror their exact setup rather than inventing new fixture names).

- [ ] **Step 7: Run the full store and utils test suites**

Run: `bun test src/store src/utils src/components src/audio src/data src/musicCore`
Expected: PASS. (This is a wide net because a type-only change can still be caught by a test
constructing a `ChordItem` literal inline; if anything fails, it is almost certainly a missing
`ChordQuality`/`ChordItem` annotation at that file's fixture — fix it the same way as Step 3, never
by loosening the type back to `string`.)

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/data/chordProgressions.ts src/store/sanitize.ts \
  src/components/loop/chord/useChordView.ts src/components/loop/chord/ProgressionCard.tsx \
  src/store/instantVibesChordsFixture.ts src/components/loop/chord/SortableChordCard.test.tsx \
  src/store/sanitize.test.ts
git commit -m "$(cat <<'EOF'
feat(dev-394): type ChordItem.quality as the Music Core ChordQuality union

ChordItem.quality and ProgressionStep.quality are no longer bare strings —
every literal quality in the app is now checked against the chord-quality
registry at compile time. sanitize.ts's isChordItem additionally rejects an
unregistered quality string at the persisted/imported-project boundary, so a
legacy or corrupted value is defaulted at ingress rather than reaching
resolveChordNotes (which now throws on one) at playback time.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 5: Migrate `src/utils/noteSpelling.ts` off `tonal`

**Files:**
- Modify: `src/utils/noteSpelling.ts`

**Interfaces:**
- Consumes: `@/musicCore`'s `chromaOfNote`, `noteMidi`, `midiToSharpName`, `midiToFlatName`,
  `pitchClassOfNote`, `scaleNotesForTonal`.
- Produces: unchanged — `SpellingKey`, `getTonicSpelling`, `getKeyAccidental`,
  `spellPitchClassInKey`, `spellMidiInKey`, `spellNoteInKey`, `spellScaleNotes`, `KEY_OPTIONS`,
  `formatKeyLabel` all keep their exact signatures.

- [ ] **Step 1: Confirm the pre-refactor baseline passes**

Run: `bun test src/utils/noteSpelling.test.ts`
Expected: PASS.

- [ ] **Step 2: Replace the `tonal` import and rewrite internals**

Replace the top of `src/utils/noteSpelling.ts`:

```ts
import { Note, Scale } from 'tonal';
import { SCALES } from '@/data/scales';
import { scaleEntry } from './scaleLookup';
```

with:

```ts
import { chromaOfNote, midiToFlatName, midiToSharpName, noteMidi, pitchClassOfNote, scaleNotesForTonal } from '@/musicCore';
import { SCALES } from '@/data/scales';
import { scaleEntry } from './scaleLookup';
```

Update the module docblock's claim about its own imports (search for "This module imports `tonal`,
`@/data/scales` and `./scaleLookup`") to read "This module imports `@/musicCore`, `@/data/scales`
and `./scaleLookup`" — the rest of that paragraph (about the cycle `noteSpelling.ts` must not
create with `musicTheory.ts`) is still accurate and stays as-is.

Rewrite the `SHARP_NAMES`/`FLAT_NAMES` construction:

```ts
const SHARP_NAMES: readonly string[] = Array.from({ length: 12 }, (_, pc) =>
  pitchClassOfNote(midiToSharpName(60 + pc)),
);
const FLAT_NAMES: readonly string[] = Array.from({ length: 12 }, (_, pc) =>
  pitchClassOfNote(midiToFlatName(60 + pc)),
);
```

Rewrite `getTonicSpelling` and `getKeyAccidental`:

```ts
export function getTonicSpelling(rootNote: string, scaleType: string): string {
  const chroma = chromaOfNote(rootNote);
  if (!Number.isFinite(chroma)) return rootNote;
  const tonics = scaleEntry(scaleType).tonality === 'minor' ? MINOR_TONICS : MAJOR_TONICS;
  return tonics[chroma];
}

export function getKeyAccidental(rootNote: string, scaleType: string): 'sharp' | 'flat' {
  const chroma = chromaOfNote(rootNote);
  if (!Number.isFinite(chroma)) return 'sharp';
  return scaleEntry(scaleType).tonality === 'minor'
    ? MINOR_ACCIDENTALS[chroma]
    : MAJOR_ACCIDENTALS[chroma];
}
```

Rewrite `spellPitchClassUncached`:

```ts
function spellPitchClassUncached(pitchClass: number, rootNote: string, scaleType: string): string {
  const entry = scaleEntry(scaleType);
  const tonic = getTonicSpelling(rootNote, scaleType);

  for (const degree of scaleNotesForTonal(tonic, entry.tonal)) {
    if (chromaOfNote(degree) !== pitchClass) continue;
    if (!/##|bb/.test(degree)) return degree;
    break;
  }

  const names = getKeyAccidental(rootNote, scaleType) === 'flat' ? FLAT_NAMES : SHARP_NAMES;
  return names[pitchClass];
}
```

Rewrite `spellMidiInKey`, `spellNoteInKey`, `spellScaleNotes`:

```ts
export function spellMidiInKey(midi: number, rootNote: string, scaleType: string): string {
  const pitchClass = spellPitchClassInKey(midi % 12, rootNote, scaleType);
  const octave = Math.floor(midi / 12) - 1;
  for (const candidate of [
    `${pitchClass}${octave}`,
    `${pitchClass}${octave + 1}`,
    `${pitchClass}${octave - 1}`,
  ]) {
    if (noteMidi(candidate) === midi) return candidate;
  }
  return `${pitchClass}${octave}`;
}

export function spellNoteInKey(note: string, rootNote: string, scaleType: string): string {
  const midi = noteMidi(note);
  return midi === null ? note : spellMidiInKey(midi, rootNote, scaleType);
}

export function spellScaleNotes(rootNote: string, scaleType: string): string[] {
  const chroma = chromaOfNote(rootNote);
  if (!Number.isFinite(chroma)) return [];
  return scaleEntry(scaleType).intervals.map((interval) =>
    spellPitchClassInKey(chroma + interval, rootNote, scaleType),
  );
}
```

Leave `spellPitchClassInKey` (the cache wrapper), `SpellingKey`, `KEY_OPTIONS`, `formatKeyLabel`
and the `MAJOR_TONICS`/`MINOR_TONICS`/`MAJOR_ACCIDENTALS`/`MINOR_ACCIDENTALS` tables untouched.

- [ ] **Step 3: Run the test to verify it still passes**

Run: `bun test src/utils/noteSpelling.test.ts`
Expected: PASS, unchanged (this test imports `tonal` itself to cross-check — it does not test
`noteSpelling.ts`'s internal implementation choice, only its public output).

- [ ] **Step 4: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/noteSpelling.ts
git commit -m "$(cat <<'EOF'
refactor(dev-394): move noteSpelling.ts's Tonal calls behind Music Core

noteSpelling.ts no longer imports tonal directly. Every exported function's
behavior is unchanged — proven by the existing noteSpelling.test.ts, which
cross-checks output against tonal directly rather than the old
implementation.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 6: Migrate `src/audio/arpeggiator.ts` off `tonal`

**Files:**
- Modify: `src/audio/arpeggiator.ts`

- [ ] **Step 1: Confirm the pre-refactor baseline passes**

Run: `bun test src/audio/arpeggiator.test.ts`
Expected: PASS.

- [ ] **Step 2: Replace the `tonal` import and the two call sites**

Replace:

```ts
import { Note, transpose } from 'tonal';
```

with:

```ts
import { noteMidi, transposeByInterval } from '@/musicCore';
```

In `buildArpSequenceUncached`, replace:

```ts
  const notesArray = Array.from(heldNotes).sort((a, b) => {
    const midiA = Note.midi(a) ?? 0;
    const midiB = Note.midi(b) ?? 0;
    return midiA - midiB;
  });
```

with:

```ts
  const notesArray = Array.from(heldNotes).sort((a, b) => {
    const midiA = noteMidi(a) ?? 0;
    const midiB = noteMidi(b) ?? 0;
    return midiA - midiB;
  });
```

and replace:

```ts
    for (const noteStr of notesArray) {
      const transposed = transpose(noteStr, interval);
      if (transposed) expanded.push(transposed);
    }
```

with:

```ts
    for (const noteStr of notesArray) {
      const transposed = transposeByInterval(noteStr, interval);
      if (transposed) expanded.push(transposed);
    }
```

- [ ] **Step 3: Run the test to verify it still passes**

Run: `bun test src/audio/arpeggiator.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 4: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/audio/arpeggiator.ts
git commit -m "$(cat <<'EOF'
refactor(dev-394): move arpeggiator.ts's Tonal calls behind Music Core

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 7: Migrate `src/audio/bassPatterns.ts` off `tonal`

**Files:**
- Modify: `src/audio/bassPatterns.ts`

- [ ] **Step 1: Confirm the pre-refactor baseline passes**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: PASS.

- [ ] **Step 2: Replace the `tonal` import and the two call sites**

Replace:

```ts
import { Note } from 'tonal';
```

with:

```ts
import { midiToSharpName, noteMidi } from '@/musicCore';
```

Replace:

```ts
function midiAtOctave(pc: string, octave: number): number {
  return Note.midi(`${pc}${octave}`) ?? Note.midi(`C${octave}`) ?? 60;
}
```

with:

```ts
function midiAtOctave(pc: string, octave: number): number {
  return noteMidi(`${pc}${octave}`) ?? noteMidi(`C${octave}`) ?? 60;
}
```

Replace, inside `resolveBassSteps`:

```ts
      noteName: Note.fromMidiSharps(shiftedMidi) ?? 'C2',
```

with:

```ts
      noteName: midiToSharpName(shiftedMidi) ?? 'C2',
```

- [ ] **Step 3: Run the test to verify it still passes**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 4: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/audio/bassPatterns.ts
git commit -m "$(cat <<'EOF'
refactor(dev-394): move bassPatterns.ts's Tonal calls behind Music Core

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 8: Migrate `src/audio/playback/padPlayback.ts` off `tonal`

**Files:**
- Modify: `src/audio/playback/padPlayback.ts`

- [ ] **Step 1: Confirm the pre-refactor baseline passes**

Run: `bun test src/audio/playback/padPlayback.test.ts`
Expected: PASS.

- [ ] **Step 2: Replace the `tonal` import and the one call site**

Replace:

```ts
import { transpose } from 'tonal';
import { generateBlockChordNotes, getDiatonicChordForDegree } from '@/utils/musicTheory';
```

with:

```ts
import { transposeByInterval } from '@/musicCore';
import { generateBlockChordNotes, getDiatonicChordForDegree } from '@/utils/musicTheory';
```

Replace, inside `resolveDroneNotes`:

```ts
  for (const interval of intervals) {
    const note = transpose(base, INTERVAL_NAME[interval]);
    if (note) out.push(note);
  }
```

with:

```ts
  for (const interval of intervals) {
    const note = transposeByInterval(base, INTERVAL_NAME[interval]);
    if (note) out.push(note);
  }
```

- [ ] **Step 3: Run the test to verify it still passes**

Run: `bun test src/audio/playback/padPlayback.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 4: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/audio/playback/padPlayback.ts
git commit -m "$(cat <<'EOF'
refactor(dev-394): move padPlayback.ts's Tonal call behind Music Core

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 9: Migrate `src/store/midiInput.ts` off `tonal`

**Files:**
- Modify: `src/store/midiInput.ts`

- [ ] **Step 1: Confirm the pre-refactor baseline passes**

Run: `bun test src/store/midiInput.test.ts` (if this file does not exist, run `bun test src/store`
and confirm nothing currently exercising `midiInput.ts` fails — check with `find src/store -iname
"*midiInput*"` first).

- [ ] **Step 2: Replace the `tonal` import and the one call site**

Replace:

```ts
import { Note } from 'tonal';
```

with:

```ts
import { midiToFlatName } from '@/musicCore';
```

Replace, inside the note-on/off handler:

```ts
            const noteName = Note.fromMidi(data1);
            if (!noteName) return;
```

with:

```ts
            const noteName = midiToFlatName(data1);
            if (!noteName) return;
```

- [ ] **Step 3: Run the relevant test(s) to verify no regression**

Run: `bun test src/store` (midiInput.ts has no MIDIAccess in the test environment, so this proves
nothing else broke, not new coverage of the handler itself).

- [ ] **Step 4: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/midiInput.ts
git commit -m "$(cat <<'EOF'
refactor(dev-394): move midiInput.ts's Tonal call behind Music Core

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 10: Wire the chord picker to `CHORD_QUALITY_GROUPS`

**Files:**
- Modify: `src/components/loop/chord/SortableChordCard.tsx`
- Modify: `src/components/loop/chord/SortableChordCard.test.tsx`

**Interfaces:**
- Consumes: `CHORD_QUALITY_GROUPS`, `type ChordQuality` from `@/musicCore` (Task 2).

- [ ] **Step 1: Write the failing test**

In `src/components/loop/chord/SortableChordCard.test.tsx`, add:

```ts
describe('SortableChordCard quality options', () => {
  test('offers every registered quality, including the ones the pre-DEV-394 picker dropped', () => {
    const html = render(false);
    expect(html).toContain('value="minMaj7"');
    expect(html).toContain('value="maj7#5"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/loop/chord/SortableChordCard.test.tsx`
Expected: FAIL — the current hand-written `QUALITY_GROUPS` has no `minMaj7`/`maj7#5` entries.

- [ ] **Step 3: Replace `QUALITY_GROUPS` with `CHORD_QUALITY_GROUPS`**

In `src/components/loop/chord/SortableChordCard.tsx`, replace the import line:

```ts
import { ROOTS, formatChordQuality, spellChordRoot } from "@/utils/musicTheory";
```

with:

```ts
import { ROOTS, formatChordQuality, spellChordRoot } from "@/utils/musicTheory";
import { CHORD_QUALITY_GROUPS, type ChordQuality } from "@/musicCore";
```

Delete the entire local `QUALITY_GROUPS` constant (the block starting `const QUALITY_GROUPS:
{...}[] = [` through its closing `];`, roughly lines 58–95).

In `ChordEditControls`, replace the quality `<select>`:

```tsx
        <select
          id={`select-chord-quality-${chord.id}`}
          value={chord.quality}
          onChange={(e) => updateChord(chord.id, { quality: e.target.value })}
          className="select select-xs w-full"
        >
          {QUALITY_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
```

with:

```tsx
        <select
          id={`select-chord-quality-${chord.id}`}
          value={chord.quality}
          onChange={(e) => updateChord(chord.id, { quality: e.target.value as ChordQuality })}
          className="select select-xs w-full"
        >
          {CHORD_QUALITY_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/loop/chord/SortableChordCard.test.tsx`
Expected: PASS, including the new `describe` block.

- [ ] **Step 5: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/loop/chord/SortableChordCard.tsx src/components/loop/chord/SortableChordCard.test.tsx
git commit -m "$(cat <<'EOF'
fix(dev-394): render every registered chord quality in the picker

SortableChordCard's quality <select> now renders Music Core's
CHORD_QUALITY_GROUPS instead of a hand-written table that had drifted out of
sync with resolveDegreeQuality's actual output — minMaj7 and maj7#5 chords
(e.g. Harmonic Minor's i and III) could sound correctly but were not
selectable in the editor. One registry now backs both.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 11: Narrow the ESLint Tonal-import gate to `src/musicCore/tonalAdapter.ts`

**Files:**
- Modify: `eslint.config.js`

- [ ] **Step 1: Confirm the current allowlist test still passes (pre-change baseline)**

Run: `bun test src/architecture/dependencyLayers.test.ts`
Expected: PASS (this is today's six-file-allowlist test; Task 12 replaces it — do not edit it
yet).

- [ ] **Step 2: Delete the three DEV-395 carve-out blocks**

In `eslint.config.js`, delete these three whole blocks (each is a `{ files: [...], rules: {...}
}` object inside the `tseslint.config(...)` call):

1. The block whose `files` is exactly `['src/audio/arpeggiator.ts', 'src/audio/bassPatterns.ts',
   'src/audio/playback/padPlayback.ts']` (comment: "DEV-395 carve-out: today's three
   tonal-importing files under src/audio/").
2. The block whose `files` is exactly `['src/store/midiInput.ts']` (comment: "DEV-395 carve-out:
   today's one tonal-importing file under src/store/").
3. The block whose `files` is exactly `['src/utils/noteSpelling.ts', 'src/utils/musicTheory.ts']`
   (comment: "DEV-395 carve-out: the two remaining tonal-importing files, both under src/utils/").

- [ ] **Step 3: Remove the now-empty `ignores` entries from the three layering blocks**

In the `src/audio/**` layering block, remove `ignores: ['src/audio/arpeggiator.ts',
'src/audio/bassPatterns.ts', 'src/audio/playback/padPlayback.ts'],` and update its comment (which
says "DEV-395 excludes today's three tonal-importing files here...") to: "Layering rule 1: audio/
never imports store/ or components/. DEV-394 confines every `tonal` import to
`src/musicCore/tonalAdapter.ts`, so this ban now applies uniformly across `src/audio/**` with no
carve-out."

In the `src/store/**` layering block, remove `ignores: ['src/store/midiInput.ts'],` and update its
comment similarly (was "DEV-395 excludes src/store/midiInput.ts here...").

In the final `src/**/*.{ts,tsx}` catch-all block, remove `'src/utils/noteSpelling.ts',` and
`'src/utils/musicTheory.ts',` from its `ignores` array, and add `'src/musicCore/**/*.{ts,tsx}',`
to that same `ignores` array (so the catch-all does not double-ban `src/musicCore/`, which gets
its own dedicated blocks in Step 4). Update the block's comment (was "DEV-395 excludes the two
remaining tonal-importing files here...") to: "DEV-394 confines every `tonal` import to
`src/musicCore/tonalAdapter.ts`, which has its own dedicated block below — `src/musicCore/**` is
excluded here so this catch-all doesn't also apply the ban to it via a different rule instance."

- [ ] **Step 4: Add the two `src/musicCore/**` blocks**

Insert these two new blocks (placed near the other layering blocks, e.g. immediately after the
`src/store/**` pair):

```js
  {
    // Music Core (DEV-394): sits below store/audio/components, parallel to
    // src/utils/ and src/data/ in the dependency graph — see
    // docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md.
    // May import src/data/ (SCALES); must not import store/ or components/,
    // mirroring layering rules 1-2. `tonalAdapter.ts` is the ONE file in the
    // whole app permitted to import `tonal`/`@tonaljs/*` — every other file
    // here (chordQuality.ts, index.ts) is banned from it too, so confinement
    // is to one file, not "somewhere in musicCore".
    files: ['src/musicCore/**/*.{ts,tsx}'],
    ignores: ['src/musicCore/tonalAdapter.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
            { group: ['**/store/**'], message: 'src/musicCore/ must not import store/ (mirrors layering rule 2)' },
            { group: ['**/components/**'], message: 'src/musicCore/ must not import components/ (mirrors layering rule 3)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
  {
    // DEV-394: the Tonal adapter. The only production file permitted to
    // `import ... from 'tonal'` anywhere in the app.
    files: ['src/musicCore/tonalAdapter.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/store/**'], message: 'src/musicCore/ must not import store/ (mirrors layering rule 2)' },
            { group: ['**/components/**'], message: 'src/musicCore/ must not import components/ (mirrors layering rule 3)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
```

- [ ] **Step 5: Update the `TONAL_IMPORT_BAN`/`TONAL_SCOPED_PACKAGE_BAN` comments**

Replace the `TONAL_IMPORT_BAN` comment block (the one starting "DEV-395: confines `tonal` to the
current, explicit allowlist...") with:

```js
// DEV-394: confines `tonal` to src/musicCore/tonalAdapter.ts, the one Tonal
// adapter file — see
// docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md
// (updated by DEV-394). `paths` (not `patterns`) is used because this bans
// one exact bare package specifier, not a glob over path shapes.
```

Replace the `TONAL_SCOPED_PACKAGE_BAN` comment's closing sentence ("Spread into the same
`patterns` arrays TONAL_IMPORT_BAN's `paths` entry sits beside; the six carve-out blocks below
omit both.") with: "Spread into the same `patterns` arrays TONAL_IMPORT_BAN's `paths` entry sits
beside; only `src/musicCore/tonalAdapter.ts`'s block omits both."

- [ ] **Step 6: Run `bun run eslint` against the whole repo**

Run: `bun run eslint`
Expected: zero errors, zero warnings (the six original files no longer import `tonal`, so the
narrower ban does not fire against them; `src/musicCore/tonalAdapter.ts` is the only file
importing `tonal` and is exempted).

- [ ] **Step 7: Commit**

```bash
git add eslint.config.js
git commit -m "$(cat <<'EOF'
feat(dev-394): narrow the tonal-import gate to src/musicCore/tonalAdapter.ts

Replaces DEV-395's six-file allowlist (three carve-out blocks) with the
adapter's own file, now that every one of those six files calls @/musicCore
instead of tonal directly. src/musicCore/** gains its own layering block
(no store/, no components/) matching audio/ and store/'s shape.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 12: Rewrite `src/architecture/dependencyLayers.test.ts`

**Files:**
- Modify: `src/architecture/dependencyLayers.test.ts`

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `src/architecture/dependencyLayers.test.ts` with:

```ts
/**
 * The committed proof that DEV-394's Tonal-adapter confinement is armed.
 *
 * Supersedes DEV-395's six-file allowlist test: DEV-394 moved every
 * production Tonal call site behind src/musicCore/tonalAdapter.ts, so the
 * only file with a tonal exemption left is that one. See
 * docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md
 * (updated by DEV-394) for the contract this test enforces.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

/** Rule ids this file's assertions care about; everything else is noise. */
const GUARDED = new Set(['no-restricted-imports']);

async function guardedMessages(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => GUARDED.has(m.ruleId ?? ''))
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const err = (ruleId: string) => ({ ruleId, severity: 2 });
const TONAL_IMPORT = "import { Note } from 'tonal';\nexport const N = Note;\n";

describe('tonal import confinement (DEV-394)', () => {
  test('the adapter, src/musicCore/tonalAdapter.ts, may still import tonal', async () => {
    const messages = await guardedMessages(TONAL_IMPORT, 'src/musicCore/tonalAdapter.ts');
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  test('a new src/musicCore/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/musicCore/chordQuality.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('src/musicCore/tonalAdapter.ts is still banned from importing store/', async () => {
    expect(
      await guardedMessages(
        "import { useAppStore } from '@/store/store';\nexport const S = useAppStore;\n",
        'src/musicCore/tonalAdapter.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('src/musicCore/ is banned from importing components/', async () => {
    expect(
      await guardedMessages(
        "import { Keyboard } from '@/components/ui/Keyboard';\nexport const K = Keyboard;\n",
        'src/musicCore/chordQuality.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('the six original call sites are no longer allowlisted for tonal', async () => {
    for (const file of [
      'src/utils/noteSpelling.ts',
      'src/utils/musicTheory.ts',
      'src/audio/arpeggiator.ts',
      'src/audio/bassPatterns.ts',
      'src/audio/playback/padPlayback.ts',
      'src/store/midiInput.ts',
    ]) {
      expect(await guardedMessages(TONAL_IMPORT, file)).toContainEqual(err('no-restricted-imports'));
    }
  });

  test('src/audio/arpeggiator.ts is still banned from importing store/ (layering rule 1)', async () => {
    expect(
      await guardedMessages(
        "import { useAppStore } from '@/store/store';\nexport const S = useAppStore;\n",
        'src/audio/arpeggiator.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('src/store/midiInput.ts is still banned from importing components/ (layering rule 2)', async () => {
    expect(
      await guardedMessages(
        "import { Keyboard } from '@/components/ui/Keyboard';\nexport const K = Keyboard;\n",
        'src/store/midiInput.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('a new src/audio/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/audio/newDspHelper.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('a new src/store/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/store/newSlice.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('a new src/utils/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/utils/someOtherHelper.ts'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('a new src/components/ file importing tonal is an error', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/components/loop/SomeView.tsx'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('VolumeFader.tsx importing tonal is still an error (its taper-ban carve-out does not exempt it from this one)', async () => {
    expect(
      await guardedMessages(TONAL_IMPORT, 'src/components/ui/VolumeFader.tsx'),
    ).toContainEqual(err('no-restricted-imports'));
  });

  test('src/utils/noteSpelling.ts is still banned by TAPER_CONVERSION_BAN (DEV-386 taper ban survives)', async () => {
    expect(
      await guardedMessages(
        "import { dbToSliderPos } from '@/utils/gainUnits';\nexport const F = dbToSliderPos;\n",
        'src/utils/noteSpelling.ts',
      ),
    ).toContainEqual(err('no-restricted-imports'));
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun test src/architecture/dependencyLayers.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 3: Commit**

```bash
git add src/architecture/dependencyLayers.test.ts
git commit -m "$(cat <<'EOF'
test(dev-394): rewrite dependencyLayers.test.ts for the single-adapter gate

Replaces the six-file allowlist assertions with proof that only
src/musicCore/tonalAdapter.ts may import tonal, that src/musicCore/ itself
is banned from store/ and components/, and that the six original call sites
are now refused tonal like any other file.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 13: Update the DEV-395 contract doc and CLAUDE.md

**Files:**
- Modify: `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md`
- Modify: `CLAUDE.md`

**Why:** Per the epic's own instruction, DEV-394 is "exactly the event that makes [the six-file
allowlist] stale", and this issue owns updating it in the same two places DEV-395 wrote it, so no
two documents contradict each other about whether Music Core exists yet.

- [ ] **Step 1: Update the contract doc's compile-time diagram**

In `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md`, in the
"1. Compile-time dependency graph" diagram, replace:

```
Music Core                              <- NEW CONCEPT (DEV-394), does not exist as a module yet
  +-- Tonal adapter (the ONLY code       <- NEW CONCEPT (DEV-394), does not exist as a module yet
  |     allowed to `import ... from 'tonal'`
  |     once DEV-394 lands)
```

with:

```
Music Core (src/musicCore/)             <- DEV-394, implemented
  +-- Tonal adapter (src/musicCore/tonalAdapter.ts —
  |     the ONLY file in production code allowed to
  |     `import ... from 'tonal'`)
```

- [ ] **Step 2: Update the "Gated but not yet moved" section**

Replace the whole paragraph starting "**Gated but not yet moved.**" (through the paragraph ending
"...only the file list it names does.") with:

```markdown
**Gated and moved (DEV-394).** Music Core and its Tonal adapter now exist as real modules:
`src/musicCore/index.ts` is the public API, `src/musicCore/tonalAdapter.ts` is the one production
file in the whole app permitted to `import ... from 'tonal'`, and `src/musicCore/chordQuality.ts`
owns the chord-quality registry (app token, Tonal alias, display suffix, picker label/group,
reharmonization category) that `ChordItem['quality']`'s type, the chord picker's options,
`formatChordQuality`/`formatChordLabel` and chord-note resolution all derive from. The six files
DEV-395 allowlisted directly (`src/utils/noteSpelling.ts`, `src/utils/musicTheory.ts`,
`src/audio/arpeggiator.ts`, `src/audio/bassPatterns.ts`, `src/audio/playback/padPlayback.ts`,
`src/store/midiInput.ts`) no longer import `tonal` at all — each calls `@/musicCore` instead, and
each keeps its own pre-existing public exports unchanged. The enforcement mechanism (an ESLint
`no-restricted-imports` rule with a `paths` ban plus a carve-out) is unchanged; only the carve-out
target moved, from the six files to `src/musicCore/tonalAdapter.ts` alone.
```

- [ ] **Step 3: Update section 4's Music Core / Tonal adapter bullets**

Replace:

```markdown
- **Music Core (future, DEV-394)** — the one public API every other music-domain reader calls for parsing, comparing, transposing, formatting pitch, resolving chord qualities, and applying display spelling. Exposes typed results; a genuinely invalid input is a typed failure or a thrown error, never a silent fallback to a default root/quality/frequency (per DEV-392's AC). Does not read the store, the engine, or `AudioContext`.
- **Tonal adapter (future, DEV-394)** — the only code in the whole app permitted to `import ... from 'tonal'`, once it exists. Confined behind Music Core's API; nothing outside the adapter names a Tonal type or function. Until DEV-394 lands, this issue's ESLint gate stands in for the adapter boundary by allowlisting today's six call sites directly (see "Gated but not yet moved" above).
```

with:

```markdown
- **Music Core (`src/musicCore/`, DEV-394)** — the one public API (`src/musicCore/index.ts`) every other music-domain reader calls for pitch/interval operations and chord-quality resolution. `resolveChordNotes` throws on a genuinely unregistered chord quality rather than silently falling back to a default (DEV-392 will extend this "no silent fallback" stance to pitch parsing more broadly). Does not read the store, the engine, or `AudioContext`.
- **Tonal adapter (`src/musicCore/tonalAdapter.ts`, DEV-394)** — the only file in the whole app permitted to `import ... from 'tonal'`. Confined behind Music Core's public barrel; nothing outside this one file names a Tonal type or function, and nothing outside `src/musicCore/` imports this file directly (see "Gated and moved" above).
```

- [ ] **Step 4: Update the "musicTheory.test.ts" cross-reference**

In the paragraph beginning "The gate covers non-test files under `src/` only", replace:

```
`scales.test.ts`, `musicTheory.test.ts` and `noteSpelling.test.ts` deliberately pin behavior against tonal
```

with:

```
`scales.test.ts`, `src/musicCore/tonalAdapter.test.ts` and `noteSpelling.test.ts` deliberately pin behavior against tonal
```

- [ ] **Step 5: Update CLAUDE.md's "fifth axis" paragraph**

In `CLAUDE.md`, replace the paragraph beginning "**A fifth axis sits on top of the four layers:
Tonal.js is confined to an explicit allowlist, not yet a directory.**" through the sentence ending
"...unrelated to this axis and unchanged by it." (i.e. everything up to but not including the
final sentence about `src/architecture/`) with:

```markdown
**A fifth axis sits on top of the four layers: Tonal.js is confined to one file.** `tonal` may be
imported only from `src/musicCore/tonalAdapter.ts` (DEV-394), enforced with the same
replace-not-merge `no-restricted-imports` pattern as the four layers above (see
`TAPER_CONVERSION_BAN` and its carve-outs for the mechanism this reuses). Every other file that
needs pitch, interval or chord-quality operations imports Music Core's public API
(`src/musicCore/index.ts`) instead — including the six files that carried a temporary,
file-named allowlist under DEV-395 (`src/utils/noteSpelling.ts`, `src/utils/musicTheory.ts`,
`src/audio/arpeggiator.ts`, `src/audio/bassPatterns.ts`, `src/audio/playback/padPlayback.ts`,
`src/store/midiInput.ts`); none of them import `tonal` directly any more, and each keeps its own
pre-existing public exports unchanged. `src/musicCore/chordQuality.ts` also owns the one canonical
chord-quality registry — app token, Tonal alias, display suffix, picker label/group and
reharmonization category — that `ChordItem['quality']`'s TypeScript type, the chord picker's
options, `formatChordQuality`/`formatChordLabel` and chord-note resolution (`resolveChordNotes`)
all derive from; a quality absent from the registry is a compile error anywhere it is written as a
literal, and a runtime string that names no registered quality is a thrown error at
`resolveChordNotes`, never a silent `maj` chord. A **musical intent** (a persisted, user-authored
decision — a chord's root/quality, a key, a note's pitch and timing) is not the same thing as a
**derived representation** (a value a pure function computes from musical intent, such as a
resolved chord quality or a display-spelled label) or a **playable event** (a fully resolved,
timestamped instruction — pitch and timing already resolved, voice ownership already assigned —
that is the sole input the audio engine may take once DEV-399 narrows its contract); the full
contract, including the compile-time, runtime-flow and data-ownership diagrams, lives in
`docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md` (updated by
DEV-394). `src/data/`'s own block already forbids every value import including `tonal`, so it
carries no separate carve-out. The gate covers non-test files under `src/` only — the config's
final block exempts `**/*.test.{ts,tsx}` from every import ban, which is how `scales.test.ts`,
`src/musicCore/tonalAdapter.test.ts` and `noteSpelling.test.ts` deliberately pin behavior against
tonal, and `scripts/` sits outside the gate's `src/**` scope entirely. The analyser exceptions two
paragraphs up (`AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/AmbientBackdrop.tsx`,
`ui/GainReductionMeter.tsx`, `ui/SourceMeter.tsx`) are unrelated to this axis and unchanged by it.
```

Leave the final sentence of the original paragraph ("`src/architecture/` holds cross-cutting
architecture tests that don't belong to any single layer — `dependencyLayers.test.ts` proves this
axis and the four layers above it — and a non-test file placed there would fall under the `src/**`
catch-all block like everything else, since the folder has no layering block of its own.")
unchanged immediately after the replaced text.

- [ ] **Step 6: Proofread the two docs against the actual eslint.config.js from Task 11**

Re-read the updated `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md`
and the updated `CLAUDE.md` paragraph side by side with `eslint.config.js` (post-Task-11) and
confirm every file path and claim (which file may import `tonal`, which files are banned from
`store/`/`components/`) matches exactly.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(dev-394): record the Music Core/Tonal adapter as implemented

Updates the DEV-395 contract doc and CLAUDE.md's tonal-confinement paragraph
from "six files, future adapter" to "one adapter file (tonalAdapter.ts),
implemented" — the two documents no longer contradict each other about
whether src/musicCore/ exists.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UDsEzBTy21EnRKKtTjExMP
EOF
)"
```

---

## Task 14: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full completion gate**

Run: `bun run verify`
Expected: PASS — `bun run eslint` reports zero errors/warnings, both Knip scans report zero
findings, every test passes (including all new `src/musicCore/*.test.ts` files and the rewritten
`dependencyLayers.test.ts`), and the production build succeeds.

- [ ] **Step 2: If Knip flags anything**

If either Knip scan reports `src/musicCore/tonalAdapter.ts`'s `resolveTonalChord`/
`TonalChordResult` as unused exports (they are used only within `src/musicCore/chordQuality.ts`,
which is legitimate internal use, not dead code): confirm they ARE imported by
`chordQuality.ts` — if Knip still flags them, it is treating them as unused because they are not
re-exported through `index.ts`; this is expected and correct per this plan's design (they are
deliberately musicCore-internal). If this happens, do not re-export them to silence Knip — instead
verify Knip's own config already scopes to file-level unused-EXPORT detection reachable from
project entry points, and confirm `chordQuality.ts` actually has a live import line for both names
(if it does and Knip still complains, this is a config gap outside this issue's scope — flag it in
the task's final summary rather than change unrelated Knip configuration).

- [ ] **Step 3: Confirm the acceptance criteria, one by one**

- [ ] A public Music Core API exposes only Solna-domain operations and values: confirmed by
  `src/musicCore/index.ts`'s export list (Task 2) — no Tonal type crosses it.
- [ ] Direct production imports of `tonal` are confined to the adapter: confirmed by Task 11's
  ESLint gate and Task 12's test.
- [ ] The canonical chord-quality registry owns app token, Tonal alias, display suffix, picker
  label/group and reharmonization category: confirmed by `CHORD_QUALITY_REGISTRY` (Task 2).
- [ ] The chord-quality type, picker options, formatter and validation all derive from the
  registry: confirmed by `ChordQuality`, `CHORD_QUALITY_GROUPS`, `formatChordQuality`,
  `isChordQuality` all being derived exports of `chordQuality.ts` (Task 2), and
  `SortableChordCard.tsx` rendering `CHORD_QUALITY_GROUPS` directly (Task 10).
- [ ] Every quality `resolveDegreeQuality` emits is representable in the chord editor: confirmed
  by Task 3's new `musicTheory.test.ts` coverage and Task 10's rendered-options test.
- [ ] Every registered quality resolves through `Chord.getChord`; an unregistered quality fails
  explicitly: confirmed by `chordQuality.test.ts` (Task 2).
- [ ] DEV-380's canonical sharp identity and key-aware display spelling are unchanged in behavior:
  confirmed by `noteSpelling.test.ts` passing unmodified (Task 5) and `musicTheory.test.ts`'s
  existing spelling/transpose assertions passing unmodified (Task 3).
- [ ] Authored content in `src/data/` remains curated: confirmed — no task in this plan adds a
  code path that writes to `src/data/`.

- [ ] **Step 4: Report the final state**

No commit in this task (verification only). If Step 1 fails, return to the task whose file the
failure implicates, fix it there (not by patching around it in Task 14), and re-run `bun run
verify` from the top.

---

## Self-review notes (for the plan author, not a task to execute)

- Spec coverage: every acceptance criterion above is implemented by a specific task; the
  Definition of Done's four items map to Task 3 (focused tests), Task 11/12 (import guard), Task
  4/5/6/7/8/9 baseline-preserved (existing characterization tests), and Task 14 (`bun run verify`).
- Placeholder scan: every step above contains literal code, exact file paths, and exact strings to
  search for — the only intentionally open-ended steps are Task 4 Step 2/5 and Task 14 Step 2,
  each of which names an exact, bounded discovery method (`bun run lint`'s own error list) rather
  than leaving behavior undefined.
- Type consistency: `ChordQuality`, `ChordQualityEntry`, `CHORD_QUALITY_REGISTRY`,
  `CHORD_QUALITY_GROUPS`, `CHORD_QUALITY_ALIASES`, `isChordQuality`, `getChordQualityEntry`,
  `formatChordQuality`, `resolveChordNotes` are named identically in every task that references
  them (Tasks 2–13); `TonalChordResult`/`resolveTonalChord` are consistently treated as
  musicCore-internal (never re-exported) across Tasks 1, 2 and 14.
