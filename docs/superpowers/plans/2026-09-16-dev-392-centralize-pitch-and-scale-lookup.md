# DEV-392 — Centralize Pitch, Note Parsing, Scale Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every production consumer parses, compares, transposes and formats pitch through Music
Core's public API — no more local note-name regexes, no more duplicated Major-scale fallback
arrays, and Music Core's own functions fail explicitly (typed failure or throw) instead of
silently substituting C, Major or A440 for invalid input.

**Architecture:** Extend `src/musicCore/` (DEV-394's Tonal adapter + chord-quality registry) with
two small additions — a new `octaveOfNote` wrapper in `tonalAdapter.ts` and a new composed
`pitch.ts` module — plus a relocation of the scale-fallback resolver that already exists in
`src/utils/scaleLookup.ts` into `src/musicCore/scale.ts` (it only ever needed `src/data/scales`,
which Music Core may import). Every one of the five call sites the epic survey named — lead step
recording, the melody grid, bass resolution, the on-screen keyboard, and `musicTheory.ts`'s
slash-bass transpose — then gets rewired to call these instead of hand-rolling a regex or a
second copy of the Major interval array. A new ESLint rule, scoped to exactly those five files
(each audited and confirmed to contain no other regex literal), makes a reintroduced local
note-parser a red `bun run eslint` gate rather than a silent regression.

**Tech Stack:** TypeScript, Bun test runner, `tonal` (confined to
`src/musicCore/tonalAdapter.ts`), ESLint flat config (`eslint.config.js`).

**Spec:** `docs/superpowers/plans/2026-09-16-dev-391-music-domain-architecture-epic-plan.md`
(§"3. DEV-392" — read together with this plan, since several of its exact file:line citations
have shifted post-DEV-394 and this plan re-verifies every one against current source). No
separate DEV-392 contract doc exists; this plan's "Survey findings" section below is the
authoritative, re-verified replacement for the epic's preliminary audit.

## Global Constraints

- `src/musicCore/**` must not import `src/store/`, `src/components/`, `src/audio/`, or
  `src/utils/` — ESLint-enforced (`eslint.config.js` lines ~267–320). Only
  `src/musicCore/tonalAdapter.ts` may import `tonal`/`@tonaljs/*`; every other file under
  `src/musicCore/` is banned from it too.
- `src/musicCore/index.ts` is the only import path production code outside `src/musicCore/` uses
  for pitch/interval/chord-quality operations — never `./tonalAdapter`, `./chordQuality`,
  `./scale` or `./pitch` directly, and never `tonal`.
- A Music Core **core function** (one that lives under `src/musicCore/`) must never silently
  substitute a default for invalid input. It fails explicitly: a typed failure (`null`/`NaN`,
  matching `chromaOfNote`/`noteMidi`'s existing contract) or a thrown error (matching
  `resolveChordNotes`'s DEV-394 precedent in `chordQuality.ts`). What a *consumer* does with that
  failure — including keeping an existing, already-reviewed defensive fallback in a real-time
  audio path — is the consumer's decision, made visibly in the consumer's own file, never hidden
  inside the core function.
- Canonical pitch identities stay sharp-spelled (`ROOTS`, DEV-380); display spelling stays
  exclusively in `src/utils/noteSpelling.ts`. This issue never touches that split.
- No persisted-shape change: nothing this issue moves is stored, so no `PERSIST_VERSION` or
  `PROJECT_FORMAT_VERSION` bump.
- `max-lines` (750) and `max-lines-per-function` (100) are `error`-level ESLint gates
  (`skipBlankLines`/`skipComments`); no file or function this plan touches should approach either
  limit, but keep it in mind when adding code to `musicTheory.ts` (559 lines today) and
  `Keyboard.tsx` (664 lines today).
- `bun run verify` is the completion gate for the whole issue (Task 12).

---

## Survey findings (re-verified against current source, 2026-09-16)

Confirms, corrects and extends the epic plan's "3. DEV-392" preliminary audit.

**Still present, confirmed by direct read:**
- `src/audio/leadStepRecord.ts:20-23` — `noteOctave(note)` extracts the trailing octave digits
  with `/(-?\d+)$/.exec(note)`. This is the "lead recording parses octave digits itself" the
  issue names; its only production caller is `src/store/leadSlice.ts` (not `leadRecord.ts`, which
  handles live-capture quantisation and touches no note regex at all — the epic's guess at the
  exact file was close but not exact).
- `src/components/loop/lead/melodyGrid.ts:60-65` — `noteSemitone(note)` re-parses a ROOTS-spelled
  note with `/^([A-G]#?)(-?\d+)$/` and a local `ROOTS.indexOf` lookup, purely to get a sortable
  absolute semitone value for `mergeBorrowedRows`.
- `src/components/loop/lead/melodyGrid.ts:126` (`isBlackKey`) and `:163` (`isRootNote`) — both
  strip the octave with `note.replace(/\d+$/, '')` to get a bare pitch class.
- `src/components/ui/Keyboard.tsx:649-664` — `getChromaticKeyboardNotes` re-parses each static
  `KEYBOARD_NOTES` entry with `/^([A-G][#b]?)(-?\d+)/` to shift its octave.
- `src/components/ui/Keyboard.tsx:63-73` — `scaleStepNote` manually reassembles a note name from
  an absolute MIDI-convention pitch via `` `${ROOTS[pitch % 12]}${Math.floor(pitch / 12) - 1}` ``
  — exactly what `midiToSharpName` (already in Music Core) computes.
- `src/audio/bassPatterns.ts:28-30` — a local `pitchClass(noteName)` strips the octave with
  `noteName.replace(/[0-9-]/g, '')`.
- `src/audio/bassPatterns.ts:103` — `diatonicStepAbove` still hardcodes
  `SCALES[scaleType]?.intervals ?? [0, 2, 4, 5, 7, 9, 11]`, a second, uncoordinated copy of the
  Major-scale fallback.
- `src/utils/musicTheory.ts:402-407` — the private (unexported) `transposePitchClass` helper
  behind slash-bass transposition uses `/^([A-Ga-g][#b]?)(-?\d+)?$/`.

**Already fixed by DEV-394 (do not re-touch):** `generateBlockChordNotes`'s old silent
root-`'C'`/quality-`'maj'`/MIDI-`60` fallback is gone — it now delegates to Music Core's
`resolveChordNotes`, which throws on an unregistered quality or an unresolvable root (see
`src/musicCore/chordQuality.ts:180-199`). The epic audit's `musicTheory.ts:577,580,583`
citations describe pre-DEV-394 code; today's `generateBlockChordNotes` (line ~557) is a two-line
pass-through.

**New finding — a scale resolver already exists but is inconsistently used.**
`src/utils/scaleLookup.ts` already centralizes "what happens when a scale type isn't found"
(`resolveScaleKey`/`scaleEntry`, falling back to `'Major'`) — its own docblock says so verbatim,
citing a 2026-09 cleanup. But `src/utils/musicTheory.ts` calls it only at three of nine call
sites (lines 207, 296, 427) and still inlines the duplicate `SCALES[scaleType] || SCALES['Major']`
pattern at six others (lines 40, 52, 69, 99, 102, 114) — plus `bassPatterns.ts`'s own hardcoded
array above is a **fourth**, uncoordinated copy of the same rule. This is exactly the "audit for
duplicates" the acceptance criteria ask for. Per this issue's constraint that centralized pitch
*and scale-lookup* logic must live under `src/musicCore/`, Task 2 relocates
`resolveScaleKey`/`scaleEntry` into `src/musicCore/scale.ts` (it has no dependency that would
make the move risky — it only imports `SCALES` from `@/data/scales`, and Music Core may import
`src/data/`), and Task 3 closes the six remaining `musicTheory.ts` duplicates.

**Named in the epic audit, deliberately deferred, with reasons recorded:**
- `src/utils/musicTheory.ts:462-465`, `rootSemitone(root)` — wraps `chromaOfNote` and silently
  returns `0` (i.e. `C`) when `chromaOfNote` returns `NaN`. `chromaOfNote` itself (Music Core)
  already fails explicitly (`NaN`, a typed failure); `rootSemitone` is the `src/utils/` consumer
  wrapper that chooses to swallow that failure, and it is called from ~15 sites across
  `musicTheory.ts`, `Keyboard.tsx` and `bassPatterns.ts`, several in the live-playback path
  (chord transposition, keyboard note construction, bass tone resolution). Changing its failure
  policy is a substantially larger, higher-risk change than the four consumer areas this issue's
  acceptance criteria name, and is not itself a "Music Core function" per the constraint's own
  wording ("the actual Music Core API this issue builds"). Deferred; flag for a follow-up issue
  if the team wants a typed-failure contract here.
- `src/utils/musicTheory.ts:510-514`, `noteFrequency(note, octaveOffset)` — still
  `if (midi == null) return 440;`. Its one production caller,
  `src/audio/synth/subtractiveVoice.ts:1083,1118`, is the synth voice's real-time note-on/glide
  scheduling — every `noteName` reaching it has already passed through the note-input dispatcher
  (`.claude/rules/note-input.md`) or a sequencer bridge, both of which only ever hand it
  ROUTES-spelled, well-formed note names, so the `440` branch is unreachable in practice today.
  Hz conversion is not in the acceptance criteria's explicit "Music Core owns" list (note
  parsing, pitch-class extraction, octave extraction, MIDI conversion, canonical-sharp
  conversion, comparison, octave transposition — no frequency conversion), and turning this into
  a throw would convert a currently-impossible input into an audio-engine crash risk for no
  behavioural gain. Deferred, not touched by this plan; recorded here so it is a decision, not an
  oversight.

**"Comparison"** (the acceptance criteria's "Music Core owns: … comparison") is satisfied by
composition, not a new named function: every consumer this plan migrates compares two notes by
comparing the values Music Core's existing primitives already return —
`pitchClassOfNote(a) === pitchClassOfNote(b)`, `noteMidi(a) === noteMidi(b)`. Inventing a
dedicated `comparePitch`/`notesEqual` wrapper around a single `===` would be an abstraction with
no behaviour of its own; per this repo's YAGNI stance, it is not added.

**"Octave transposition"** is already satisfied and needs no new function:
`shiftNoteOctave` (`musicTheory.ts:516-521`) already calls Music Core's existing
`transposeByInterval` wrapper. Not touched by this plan.

---

## File structure

**New:**
- `src/musicCore/pitch.ts` — one composed function, `transposePitchClassPreservingOctave`, built
  on `tonalAdapter.ts`'s primitives (never imports `tonal` itself).
- `src/musicCore/pitch.test.ts`
- `src/musicCore/scale.ts` — relocated from `src/utils/scaleLookup.ts`, byte-identical contents.
- `src/musicCore/scale.test.ts` — new; `scaleLookup.ts` had no dedicated test file before this
  move (only indirect coverage via `musicTheory.test.ts`/`noteSpelling.test.ts`).
- `src/architecture/notePatternGuard.test.ts` — proves the new ESLint regex-reintroduction guard
  (Task 10) is armed, same `ESLint.lintText` pattern as `src/architecture/dependencyLayers.test.ts`.

**Modified:**
- `src/musicCore/tonalAdapter.ts` — add `octaveOfNote`.
- `src/musicCore/tonalAdapter.test.ts` — add its tests.
- `src/musicCore/index.ts` — export `octaveOfNote`, `transposePitchClassPreservingOctave`,
  `resolveScaleKey`, `scaleEntry`.
- `src/utils/musicTheory.ts` — dedupe the six inline scale-fallback copies onto `scaleEntry`;
  rewrite the private `transposePitchClass` helper onto
  `transposePitchClassPreservingOctave`; drop the `./scaleLookup` import.
- `src/utils/noteSpelling.ts` — import `scaleEntry` from `@/musicCore` instead of `./scaleLookup`.
- `src/audio/leadStepRecord.ts` — `noteOctave` delegates to `octaveOfNote`.
- `src/audio/leadStepRecord.test.ts` — no behaviour change expected; re-run as a regression gate.
- `src/audio/bassPatterns.ts` — drop the local `pitchClass` function for `pitchClassOfNote`;
  `diatonicStepAbove` calls `scaleEntry` instead of hardcoding the Major interval array; drop the
  now-unused `SCALES` import.
- `src/components/loop/lead/melodyGrid.ts` — `noteSemitone` delegates to `noteMidi`; `isBlackKey`
  and `isRootNote` delegate to `pitchClassOfNote`.
- `src/components/ui/Keyboard.tsx` — `scaleStepNote` delegates to `midiToSharpName`;
  `getChromaticKeyboardNotes` delegates to `pitchClassOfNote` + `octaveOfNote`.
- `eslint.config.js` — extract `AUDIO_RANDOM_BAN_SYNTAX` from the existing `src/audio/**`
  Math.random block; add `NOTE_REGEX_BAN`; add two new `no-restricted-syntax` blocks scoped to
  exactly the five migrated files.

**Deleted:**
- `src/utils/scaleLookup.ts` (moved to `src/musicCore/scale.ts`).

---

### Task 1: Music Core — add `octaveOfNote`

**Files:**
- Modify: `src/musicCore/tonalAdapter.ts`
- Modify: `src/musicCore/tonalAdapter.test.ts`
- Modify: `src/musicCore/index.ts`

**Interfaces:**
- Produces: `octaveOfNote(note: string): number | null` — Task 6 (keyboard), Task 7 (lead step
  record), Task 9 (keyboard) all consume this by name.

- [ ] **Step 1: Write the failing tests**

Add to `src/musicCore/tonalAdapter.test.ts`, inside the existing `describe('tonalAdapter', ...)`
block, right after the `pitchClassOfNote` test:

```ts
  test('octaveOfNote matches Note.get(...).oct, narrowed to null', () => {
    expect(octaveOfNote('C4')).toBe(Note.get('C4').oct);
    expect(octaveOfNote('C4')).toBe(4);
    expect(octaveOfNote('F#3')).toBe(3);
    expect(octaveOfNote('Bb10')).toBe(10);
    expect(octaveOfNote('C-1')).toBe(-1);
  });

  test('octaveOfNote is null for a pitch class with no octave, or an unparseable name', () => {
    expect(octaveOfNote('C')).toBeNull();
    expect(octaveOfNote('')).toBeNull();
    expect(octaveOfNote('not-a-note')).toBeNull();
  });
```

Add `octaveOfNote` to the test file's existing `import { ... } from './tonalAdapter';` list.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/musicCore/tonalAdapter.test.ts -t "octaveOfNote"`
Expected: FAIL — `octaveOfNote` is not exported.

- [ ] **Step 3: Implement `octaveOfNote`**

In `src/musicCore/tonalAdapter.ts`, add after `pitchClassOfNote`:

```ts
/** `Note.get(note).oct` — the note's octave, or `null` when `note` has no octave or does not parse (Tonal returns `undefined` for both; this wrapper narrows to `null` so every Music Core typed failure reads the same way). */
export function octaveOfNote(note: string): number | null {
  return Note.get(note).oct ?? null;
}
```

- [ ] **Step 4: Export it from the barrel**

In `src/musicCore/index.ts`, add `octaveOfNote` to the existing `export { ... } from
'./tonalAdapter';` list (alphabetical, between `noteMidi` and `pitchClassOfNote`):

```ts
export {
  chromaOfNote,
  intervalDistance,
  midiToFlatName,
  midiToSharpName,
  noteMidi,
  octaveOfNote,
  pitchClassOfNote,
  scaleNotesForTonal,
  transposeByInterval,
} from './tonalAdapter';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/musicCore/tonalAdapter.test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add src/musicCore/tonalAdapter.ts src/musicCore/tonalAdapter.test.ts src/musicCore/index.ts
git commit -m "feat(musicCore): add octaveOfNote, the canonical octave-extraction primitive"
```

---

### Task 2: Music Core — relocate the scale resolver

**Files:**
- Create: `src/musicCore/scale.ts` (moved content from `src/utils/scaleLookup.ts`)
- Create: `src/musicCore/scale.test.ts`
- Modify: `src/musicCore/index.ts`
- Modify: `src/utils/noteSpelling.ts`
- Delete: `src/utils/scaleLookup.ts`

**Interfaces:**
- Consumes: `SCALES`, `ScaleDefinition` from `@/data/scales` (unchanged).
- Produces: `resolveScaleKey(scaleType: string): string`, `scaleEntry(scaleType: string):
  ScaleDefinition` — Task 3 (`musicTheory.ts`) and Task 8 (`bassPatterns.ts`) both consume these
  by name from `@/musicCore`.

- [ ] **Step 1: Write the failing test**

Create `src/musicCore/scale.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SCALES } from '@/data/scales';
import { resolveScaleKey, scaleEntry } from './scale';

describe('resolveScaleKey', () => {
  test('echoes a known scale type', () => {
    expect(resolveScaleKey('Minor Pentatonic')).toBe('Minor Pentatonic');
  });

  test('falls back to Major for an unrecognized scale type', () => {
    expect(resolveScaleKey('not-a-scale')).toBe('Major');
    expect(resolveScaleKey('')).toBe('Major');
  });
});

describe('scaleEntry', () => {
  test('returns the SCALES entry for a known scale type', () => {
    expect(scaleEntry('Minor Pentatonic')).toBe(SCALES['Minor Pentatonic']);
  });

  test('returns the Major entry for an unrecognized scale type', () => {
    expect(scaleEntry('not-a-scale')).toBe(SCALES['Major']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/musicCore/scale.test.ts`
Expected: FAIL — `./scale` does not exist yet.

- [ ] **Step 3: Create `src/musicCore/scale.ts` with the moved content**

```ts
import { SCALES, type ScaleDefinition } from '@/data/scales';

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
  return SCALES[scaleType] ? scaleType : 'Major';
}

/** The SCALES entry a scale type names, with the same fallback. */
export function scaleEntry(scaleType: string): ScaleDefinition {
  return SCALES[resolveScaleKey(scaleType)];
}
```

- [ ] **Step 4: Delete `src/utils/scaleLookup.ts`**

```bash
git rm src/utils/scaleLookup.ts
```

- [ ] **Step 5: Export from the barrel**

In `src/musicCore/index.ts`, add a new export group (after the `chordQuality` group):

```ts
export { resolveScaleKey, scaleEntry } from './scale';
```

- [ ] **Step 6: Update `src/utils/noteSpelling.ts`'s import**

Change:

```ts
import { chromaOfNote, midiToFlatName, midiToSharpName, noteMidi, pitchClassOfNote, scaleNotesForTonal } from '@/musicCore';
import { SCALES } from '@/data/scales';
import { scaleEntry } from './scaleLookup';
```

to:

```ts
import { chromaOfNote, midiToFlatName, midiToSharpName, noteMidi, pitchClassOfNote, scaleEntry, scaleNotesForTonal } from '@/musicCore';
import { SCALES } from '@/data/scales';
```

Also update the file's own docblock line "This module imports `@/musicCore`, `@/data/scales` and
`./scaleLookup`" to "This module imports `@/musicCore` and `@/data/scales`".

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/musicCore/scale.test.ts src/utils/noteSpelling.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/musicCore/scale.ts src/musicCore/scale.test.ts src/musicCore/index.ts src/utils/noteSpelling.ts
git rm src/utils/scaleLookup.ts
git commit -m "refactor(musicCore): relocate the scale-fallback resolver from utils/ into musicCore/"
```

---

### Task 3: Dedupe `musicTheory.ts`'s six inline scale-fallback copies

**Files:**
- Modify: `src/utils/musicTheory.ts:1-24` (imports), `:38-42`, `:50-57`, `:62-71`, `:87-105`,
  `:108-121`

**Interfaces:**
- Consumes: `scaleEntry` from `@/musicCore` (Task 2).

- [ ] **Step 1: Update the import block**

Change:

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
  scaleNotesForTonal,
  transposeByInterval,
  type ChordQuality,
} from '@/musicCore';
import { ChordItem } from '../types';
import { METERS } from './meter';
import { SCALES } from '@/data/scales';
import { spellPitchClassInKey, type SpellingKey } from './noteSpelling';
import { resolveScaleKey, scaleEntry } from './scaleLookup';
```

to:

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
  transposeByInterval,
  type ChordQuality,
} from '@/musicCore';
import { ChordItem } from '../types';
import { METERS } from './meter';
import { SCALES } from '@/data/scales';
import { spellPitchClassInKey, type SpellingKey } from './noteSpelling';
```

(`SCALES` stays imported — it is still used directly at the three call sites that already call
`resolveScaleKey`/`scaleEntry`, e.g. `SCALES[resolvedKey]` at line ~208.)

- [ ] **Step 2: Replace the six inline fallbacks**

In `getScaleNotes` (`SCALES[scaleType] || SCALES['Major']` at line 40) and
`getScaleNotesInOctave` (line 52) and `isNoteInScale` (line 69) and `isInScalePaletteChord`
(line 114), replace:

```ts
  const scale = SCALES[scaleType] || SCALES['Major'];
```

with:

```ts
  const scale = scaleEntry(scaleType);
```

(four occurrences — this is a 1:1 textual replacement, same in all four functions.)

In `remapNoteByScaleDegree`, replace:

```ts
  const fromIntervals = (SCALES[fromScaleType] || SCALES['Major']).intervals;
  ...
  const toIntervals = (SCALES[toScaleType] || SCALES['Major']).intervals;
```

with:

```ts
  const fromIntervals = scaleEntry(fromScaleType).intervals;
  ...
  const toIntervals = scaleEntry(toScaleType).intervals;
```

- [ ] **Step 3: Run existing tests to verify no behaviour change**

Run: `bun test src/utils/musicTheory.test.ts`
Expected: PASS, unchanged — `scaleEntry(t)` and `SCALES[t] || SCALES['Major']` are the same value
for every input (`scaleEntry` is `SCALES[resolveScaleKey(t)]`, and `resolveScaleKey(t)` is `t` when
`SCALES[t]` is truthy, `'Major'` otherwise — identical to the inline `||`).

- [ ] **Step 4: Commit**

```bash
git add src/utils/musicTheory.ts
git commit -m "refactor(musicTheory): dedupe six inline scale-fallback copies onto Music Core's scaleEntry"
```

---

### Task 4: Music Core — add `transposePitchClassPreservingOctave`

**Files:**
- Create: `src/musicCore/pitch.ts`
- Create: `src/musicCore/pitch.test.ts`
- Modify: `src/musicCore/index.ts`

**Interfaces:**
- Consumes: `chromaOfNote`, `octaveOfNote` from `./tonalAdapter`; `ROOTS` from `./chordQuality`
  (same-folder imports, not the barrel — matches `chordQuality.ts`'s own pattern of importing
  `./tonalAdapter` directly rather than through `./index`).
- Produces: `transposePitchClassPreservingOctave(note: string, semitones: number): string | null`
  — Task 5 (`musicTheory.ts`'s slash-bass transpose) consumes this by name.

- [ ] **Step 1: Write the failing tests**

Create `src/musicCore/pitch.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { transposePitchClassPreservingOctave } from './pitch';

describe('transposePitchClassPreservingOctave', () => {
  test('shifts the pitch class and keeps the written octave', () => {
    expect(transposePitchClassPreservingOctave('E4', 2)).toBe('F#4');
    expect(transposePitchClassPreservingOctave('C4', 1)).toBe('C#4');
  });

  test('wraps around the octave boundary without changing the written octave', () => {
    // B3 + 1 semitone is pitch-class C, and the WRITTEN octave stays 3 (this is
    // pitch-class transposition, not MIDI transposition — the octave suffix is
    // preserved verbatim, never recomputed from an absolute pitch).
    expect(transposePitchClassPreservingOctave('B3', 1)).toBe('C3');
  });

  test('negative octaves round-trip', () => {
    expect(transposePitchClassPreservingOctave('C-1', 2)).toBe('D-1');
  });

  test('a pitch class with no octave stays without one', () => {
    expect(transposePitchClassPreservingOctave('E', 2)).toBe('F#');
  });

  test('flats resolve through the same sharp-spelled ROOTS table as every other Music Core output', () => {
    expect(transposePitchClassPreservingOctave('Db4', 1)).toBe('D4');
  });

  test('a negative shift wraps downward', () => {
    expect(transposePitchClassPreservingOctave('C4', -1)).toBe('B4');
  });

  test('returns null for an unparseable note', () => {
    expect(transposePitchClassPreservingOctave('not-a-note', 2)).toBeNull();
    expect(transposePitchClassPreservingOctave('', 2)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/musicCore/pitch.test.ts`
Expected: FAIL — `./pitch` does not exist yet.

- [ ] **Step 3: Implement `src/musicCore/pitch.ts`**

```ts
import { chromaOfNote, octaveOfNote } from './tonalAdapter';
import { ROOTS } from './chordQuality';

/**
 * Shifts `note`'s pitch class by `semitones`, keeping whatever octave it was
 * written with (or none, if it had none) — the operation slash-bass
 * transposition needs so a chord's bass never jumps a register on a key
 * change (see `src/utils/musicTheory.ts`'s `transposeProgression`).
 *
 * `null` when `note`'s pitch class does not parse — a Music Core core
 * function's typed-failure contract (see this plan's Global Constraints):
 * never a silent substitution. The caller decides what "unchanged" or
 * "default" means for its own domain.
 */
export function transposePitchClassPreservingOctave(note: string, semitones: number): string | null {
  const chroma = chromaOfNote(note);
  if (!Number.isFinite(chroma)) return null;
  const shiftedPc = ROOTS[((chroma + semitones) % 12 + 12) % 12];
  const octave = octaveOfNote(note);
  return octave === null ? shiftedPc : `${shiftedPc}${octave}`;
}
```

- [ ] **Step 4: Export from the barrel**

In `src/musicCore/index.ts`, add to the `./tonalAdapter` export group's neighbourhood a new line:

```ts
export { transposePitchClassPreservingOctave } from './pitch';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/musicCore/pitch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/musicCore/pitch.ts src/musicCore/pitch.test.ts src/musicCore/index.ts
git commit -m "feat(musicCore): add transposePitchClassPreservingOctave"
```

---

### Task 5: Migrate slash-bass transposition (`musicTheory.ts`)

**Files:**
- Modify: `src/utils/musicTheory.ts:397-407`

**Interfaces:**
- Consumes: `transposePitchClassPreservingOctave` from `@/musicCore` (Task 4).

This is a **preserve-behaviour** migration, not a redesign — `transposeProgression`'s existing
test coverage (`src/utils/musicTheory.test.ts`, `describe('transposeProgression', ...)`,
specifically `'a slash bass moves with the chord and keeps its written octave'` and the 144-pair
round-trip test) is the contract to keep green, unchanged.

- [ ] **Step 1: Confirm the current characterization test passes before touching anything**

Run: `bun test src/utils/musicTheory.test.ts -t "transposeProgression"`
Expected: PASS (baseline, before this task's change).

- [ ] **Step 2: Add `transposePitchClassPreservingOctave` to the `@/musicCore` import**

(Same import block Task 3 already touched — add one more named import.)

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
  transposeByInterval,
  transposePitchClassPreservingOctave,
  type ChordQuality,
} from '@/musicCore';
```

- [ ] **Step 3: Rewrite `transposePitchClass`**

Replace:

```ts
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
```

with:

```ts
/**
 * Shifts a note's pitch class and keeps its written octave, so a slash bass
 * never jumps a register on a key change — and a transpose round trip is exact.
 * Returns the input unchanged when it is not a note name — this function's own
 * contract, preserved verbatim; Music Core's `transposePitchClassPreservingOctave`
 * fails explicitly (`null`) per its own typed-failure contract, and this is the
 * one place that "unchanged" default belongs.
 */
function transposePitchClass(note: string, shift: number): string {
  return transposePitchClassPreservingOctave(note, shift) ?? note;
}
```

Note `ROOTS` may now be unused in this exact spot, but it is still used elsewhere in the file
(e.g. `getScaleNotes`, `transposeProgression`) — do not remove the import.

- [ ] **Step 4: Run the tests to verify they still pass**

Run: `bun test src/utils/musicTheory.test.ts -t "transposeProgression"`
Expected: PASS, identical to the Step 1 baseline.

Also run the full file once to catch any other regression:

Run: `bun test src/utils/musicTheory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/musicTheory.ts
git commit -m "refactor(musicTheory): slash-bass transposition via Music Core, behaviour unchanged"
```

---

### Task 6: Migrate lead step recording (`leadStepRecord.ts`)

**Files:**
- Modify: `src/audio/leadStepRecord.ts:19-23`
- Test: `src/audio/leadStepRecord.test.ts` (existing — must keep passing unmodified)

**Interfaces:**
- Consumes: `octaveOfNote` from `@/musicCore` (Task 1).
- Produces: `noteOctave(note: string): number | null` — unchanged signature; `leadSlice.ts`
  (`src/store/leadSlice.ts`) keeps importing it from `./leadStepRecord` with no change.

- [ ] **Step 1: Confirm the existing test passes before touching anything**

Run: `bun test src/audio/leadStepRecord.test.ts`
Expected: PASS (baseline).

- [ ] **Step 2: Rewrite `noteOctave`**

Replace:

```ts
/** The trailing digits of a note name, e.g. 'F#4' -> 4. Null if there are none. */
export function noteOctave(note: string): number | null {
  const match = /(-?\d+)$/.exec(note);
  return match ? Number(match[1]) : null;
}
```

with:

```ts
import { octaveOfNote } from '@/musicCore';

/** The trailing digits of a note name, e.g. 'F#4' -> 4. Null if there are none. */
export function noteOctave(note: string): number | null {
  return octaveOfNote(note);
}
```

(Add the `import` at the top of the file, alongside no other existing imports — this file
currently imports nothing.)

- [ ] **Step 3: Run the test to verify it still passes**

Run: `bun test src/audio/leadStepRecord.test.ts`
Expected: PASS, identical to the Step 1 baseline (`noteOctave('C4')` → `4`,
`noteOctave('Bb10')` → `10`, `noteOctave('C')` → `null`, `noteOctave('')` → `null` — all already
covered and all match `octaveOfNote`'s contract 1:1, per Task 1's own test coverage).

- [ ] **Step 4: Regression-check the store consumer**

Run: `bun test src/store/leadSlice.test.ts`
Expected: PASS (no source change here, but this is `leadRecordOctave`'s only production caller —
confirm nothing downstream broke).

- [ ] **Step 5: Commit**

```bash
git add src/audio/leadStepRecord.ts
git commit -m "refactor(leadStepRecord): noteOctave delegates to Music Core's octaveOfNote"
```

---

### Task 7: Migrate the melody grid (`melodyGrid.ts`)

**Files:**
- Modify: `src/components/loop/lead/melodyGrid.ts:1-2` (imports), `:60-65` (`noteSemitone`),
  `:125-128` (`isBlackKey`), `:161-164` (`isRootNote`)
- Test: `src/components/loop/lead/melodyGrid.test.ts` (existing — must keep passing unmodified)

**Interfaces:**
- Consumes: `noteMidi`, `pitchClassOfNote` from `@/musicCore`.

- [ ] **Step 1: Confirm the existing tests pass before touching anything**

Run: `bun test src/components/loop/lead/melodyGrid.test.ts`
Expected: PASS (baseline).

- [ ] **Step 2: Add the Music Core import**

Add, near the top of the file (after the existing `@/utils/musicTheory` import):

```ts
import { noteMidi, pitchClassOfNote } from '@/musicCore';
```

- [ ] **Step 3: Rewrite `noteSemitone`**

Replace:

```ts
function noteSemitone(note: string): number {
  const match = /^([A-G]#?)(-?\d+)$/.exec(note);
  if (!match) return Number.NaN;
  const pitchClass = (ROOTS as readonly string[]).indexOf(match[1]);
  return pitchClass < 0 ? Number.NaN : pitchClass + Number(match[2]) * 12;
}
```

with:

```ts
function noteSemitone(note: string): number {
  return noteMidi(note) ?? Number.NaN;
}
```

(`noteMidi` returns Tonal's real MIDI number — a different absolute scale than the old
`pitchClass + octave*12`, but the two call sites of `noteSemitone` inside `mergeBorrowedRows`
only ever compare its outputs to each other for ordering/range-membership within the SAME
function call, never against a value from outside it, so the change of absolute scale is
behaviour-invisible. `NaN` still fails every comparison, matching the old contract.)

- [ ] **Step 4: Rewrite `isBlackKey`**

Replace:

```ts
export function isBlackKey(note: string): boolean {
  const pitchClass = note.replace(/\d+$/, '');
  return pitchClass.includes('#') || pitchClass.includes('b');
}
```

with:

```ts
export function isBlackKey(note: string): boolean {
  const pitchClass = pitchClassOfNote(note);
  return pitchClass.includes('#') || pitchClass.includes('b');
}
```

- [ ] **Step 5: Rewrite `isRootNote`**

Replace:

```ts
export function isRootNote(note: string, root: string): boolean {
  return note.replace(/\d+$/, '') === root;
}
```

with:

```ts
export function isRootNote(note: string, root: string): boolean {
  return pitchClassOfNote(note) === root;
}
```

- [ ] **Step 6: Run the tests to verify they still pass**

Run: `bun test src/components/loop/lead/melodyGrid.test.ts`
Expected: PASS, identical to the Step 1 baseline — including `isBlackKey('C#4')` → `true`,
`isBlackKey('Db4')` → `true`, `isRootNote('C4', 'C')` → `true`, `isRootNote('A#4', 'A#')` → `true`
(the `leadRowLabel` describe block's own regression case).

- [ ] **Step 7: Commit**

```bash
git add src/components/loop/lead/melodyGrid.ts
git commit -m "refactor(melodyGrid): note parsing via Music Core, no local regexes"
```

---

### Task 8: Migrate bass resolution (`bassPatterns.ts`)

**Files:**
- Modify: `src/audio/bassPatterns.ts:1-10` (imports), `:28-30` (delete local `pitchClass`),
  `:86-95` (call sites), `:100-112` (`diatonicStepAbove`)
- Test: `src/audio/bassPatterns.test.ts` (existing — must keep passing unmodified)

**Interfaces:**
- Consumes: `pitchClassOfNote`, `scaleEntry` from `@/musicCore` (Tasks 1/2).

- [ ] **Step 1: Confirm the existing tests pass before touching anything**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: PASS (baseline).

- [ ] **Step 2: Update imports**

Replace:

```ts
import { midiToSharpName, noteMidi } from '@/musicCore';
import type { ChordItem } from '../types';
import { SCALES } from '@/data/scales';
import { rootSemitone, stepDurationSec } from '../utils/musicTheory';
```

with:

```ts
import { midiToSharpName, noteMidi, pitchClassOfNote, scaleEntry } from '@/musicCore';
import type { ChordItem } from '../types';
import { rootSemitone, stepDurationSec } from '../utils/musicTheory';
```

(`SCALES` is no longer used anywhere else in this file after Step 4 below — dropped entirely.)

- [ ] **Step 3: Delete the local `pitchClass` function and its call sites**

Delete:

```ts
function pitchClass(noteName: string): string {
  return noteName.replace(/[0-9-]/g, '');
}
```

Replace its three call sites — in `resolveBassSteps`:

```ts
  const bassRootMidi = midiAtOctave(pitchClass(chord.bassNote ?? chord.root), octave);
  const nextRootMidi = midiAtOctave(pitchClass(nextChord.bassNote ?? nextChord.root), octave);
```

with:

```ts
  const bassRootMidi = midiAtOctave(pitchClassOfNote(chord.bassNote ?? chord.root), octave);
  const nextRootMidi = midiAtOctave(pitchClassOfNote(nextChord.bassNote ?? nextChord.root), octave);
```

and inside `toneMidi`:

```ts
      const note = chord.notes[TONE_INDEX[t]];
      if (note) return midiAtOctave(pitchClass(note), octave);
```

with:

```ts
      const note = chord.notes[TONE_INDEX[t]];
      if (note) return midiAtOctave(pitchClassOfNote(note), octave);
```

`midiAtOctave` itself is unchanged — it keeps its existing `noteMidi(...) ?? noteMidi('C'+octave)
?? 60` fallback chain, now fed a Music-Core-derived pitch class instead of a regex-stripped one.
This plan does not remove that fallback chain: the acceptance criteria name only
"strips octave characters itself" and "carries its own Major interval fallback" for bass — not
this defensive MIDI-resolution chain, and `chord.root`/`chord.bassNote` reaching this real-time
scheduling path are not user-facing free-text, so a throw here would trade a defended-against
"cannot happen" input for a real-time-audio crash risk with no reviewed upside. If a future issue
wants a typed-failure contract for this specific chain, that is a separate, scoped change.

- [ ] **Step 4: Rewrite `diatonicStepAbove`'s scale-fallback**

Replace:

```ts
  const diatonicStepAbove = (targetPc: number): number => {
    const rootPc = rootSemitone(scaleRoot);
    const intervals = SCALES[scaleType]?.intervals ?? [0, 2, 4, 5, 7, 9, 11];
```

with:

```ts
  const diatonicStepAbove = (targetPc: number): number => {
    const rootPc = rootSemitone(scaleRoot);
    const intervals = scaleEntry(scaleType).intervals;
```

- [ ] **Step 5: Run the tests to verify they still pass**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: PASS, identical to the Step 1 baseline — `scaleEntry(scaleType).intervals` is the same
value `SCALES[scaleType]?.intervals ?? [0, 2, 4, 5, 7, 9, 11]` produced for every scale type
`src/data/scales.ts` defines (every defined scale type is truthy either way; an unrecognized type
falls back to Major's `[0, 2, 4, 5, 7, 9, 11]` either way — the two expressions are equal for
every input, not just the ones the existing test suite happens to cover).

- [ ] **Step 6: Commit**

```bash
git add src/audio/bassPatterns.ts
git commit -m "refactor(bassPatterns): pitch-class and scale-fallback via Music Core"
```

---

### Task 9: Migrate the on-screen keyboard (`Keyboard.tsx`)

**Files:**
- Modify: `src/components/ui/Keyboard.tsx:1-14` (imports), `:63-73` (`scaleStepNote`),
  `:647-664` (`getChromaticKeyboardNotes`)
- Test: `src/components/ui/Keyboard.test.ts` (existing — must keep passing unmodified)

**Interfaces:**
- Consumes: `midiToSharpName`, `octaveOfNote`, `pitchClassOfNote` from `@/musicCore`.

Does **not** touch `getScaleLockedKeyboardNotes`'s `HOME_ROW_KEYS`/`TOP_ROW_KEYS` QWERTY
key-mapping arrays, or `scaleSemitonesFor` (which operates on pitch-class-only strings from
`getScaleNotes` with no octave to parse — a plain `ROOTS.indexOf`, not a regex, and out of this
issue's named scope).

- [ ] **Step 1: Confirm the existing tests pass before touching anything**

Run: `bun test src/components/ui/Keyboard.test.ts`
Expected: PASS (baseline).

- [ ] **Step 2: Add the Music Core import**

Add, after the existing `@/utils/musicTheory` import block:

```ts
import { midiToSharpName, octaveOfNote, pitchClassOfNote } from '@/musicCore';
```

- [ ] **Step 3: Rewrite `scaleStepNote`**

Replace:

```ts
function scaleStepNote(
  tonicPitch: number,
  scaleSemitones: number[],
  scaleLength: number,
  step: number,
): string {
  const degree = ((step % scaleLength) + scaleLength) % scaleLength;
  const pitch =
    tonicPitch + 12 * Math.floor(step / scaleLength) + scaleSemitones[degree];
  return `${ROOTS[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}
```

with:

```ts
function scaleStepNote(
  tonicPitch: number,
  scaleSemitones: number[],
  scaleLength: number,
  step: number,
): string {
  const degree = ((step % scaleLength) + scaleLength) % scaleLength;
  const pitch =
    tonicPitch + 12 * Math.floor(step / scaleLength) + scaleSemitones[degree];
  return midiToSharpName(pitch);
}
```

(`tonicPitch`'s "C-1 = 0" convention is exactly MIDI's own convention — this is a pure rename to
the already-existing Music Core wrapper, not a behaviour change. `ROOTS` may now be unused in
this exact function, but stays imported — `scaleSemitonesFor`, a few lines below, still uses it.)

- [ ] **Step 4: Rewrite `getChromaticKeyboardNotes`**

Replace:

```ts
// Chromatic keyboard always starts from C — octaveOffset shifts the range up/down
// Not affected by master key/scale; regex supports any octave number
export function getChromaticKeyboardNotes(octaveOffset: number) {
  return KEYBOARD_NOTES.map((k) => {
    const match = k.note.match(/^([A-G][#b]?)(-?\d+)/);
    if (match) {
      const noteName = match[1];
      const origOct = parseInt(match[2], 10);
      const targetOct = origOct + octaveOffset;
      return {
        ...k,
        note: `${noteName}${targetOct}`,
        label: k.isBlack ? noteName : `${noteName}${targetOct}`,
      };
    }
    return k;
  });
}
```

with:

```ts
// Chromatic keyboard always starts from C — octaveOffset shifts the range up/down.
// KEYBOARD_NOTES entries are always well-formed literals, so a null octave never
// actually occurs here; the guard exists only so this function's return type
// matches its input type exactly, with no `!` assertion.
export function getChromaticKeyboardNotes(octaveOffset: number) {
  return KEYBOARD_NOTES.map((k) => {
    const origOct = octaveOfNote(k.note);
    if (origOct === null) return k;
    const noteName = pitchClassOfNote(k.note);
    const targetOct = origOct + octaveOffset;
    return {
      ...k,
      note: `${noteName}${targetOct}`,
      label: k.isBlack ? noteName : `${noteName}${targetOct}`,
    };
  });
}
```

- [ ] **Step 5: Run the tests to verify they still pass**

Run: `bun test src/components/ui/Keyboard.test.ts`
Expected: PASS, identical to the Step 1 baseline — including the byte-pinned
`expect(html.length).toBe(8090)` render test (label text is unchanged, since the same note names
are produced for the same inputs) and the scale-locked/key-spelling describe blocks (unaffected —
they exercise `getScaleLockedKeyboardNotes`, not the two functions this task touches).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Keyboard.tsx
git commit -m "refactor(Keyboard): note construction via Music Core, no local regexes"
```

---

### Task 10: ESLint guard against a reintroduced local note-regex

**Files:**
- Modify: `eslint.config.js`

**Interfaces:**
- Produces: two new `no-restricted-syntax` config blocks, scoped to exactly the five files this
  plan centralized (`src/audio/leadStepRecord.ts`, `src/audio/bassPatterns.ts`,
  `src/components/loop/lead/melodyGrid.ts`, `src/components/ui/Keyboard.tsx`,
  `src/utils/musicTheory.ts`). Confirmed by direct read (this plan's Survey findings section):
  none of these five files contains any regex literal other than the ones Tasks 5–9 just
  deleted, so a blanket "no regex literal" ban is precise, not a pattern-match against the
  note-parsing shape specifically.

`no-restricted-syntax` is **not additive** — a config block that sets it for a file REPLACES the
rule for that file (see the file's own `GLOBAL_RESTRICTED_SYNTAX` docblock). Two existing blocks
already set it for a subset of these five files: the top-level rule block (no `files` key, so it
matches everything) and the `src/audio/**` Math.random ban (matches the two `src/audio/` files
among the five). This task extracts that block's three selectors into a named const so both the
existing block and the two new blocks can spread them in, rather than silently dropping the
Math.random ban for `leadStepRecord.ts`/`bassPatterns.ts` the moment a later-in-array block also
claims `no-restricted-syntax` for them.

- [ ] **Step 1: Extract `AUDIO_RANDOM_BAN_SYNTAX` from the existing `src/audio/**` block**

Find the const declarations near the top of `eslint.config.js` (after `GLOBAL_RESTRICTED_SYNTAX`)
and add:

```js
// The three Math.random selectors the `src/audio/**` block below already enforces —
// extracted to a const (DEV-392) so the two new note-regex-guard blocks (below) can
// spread it in too, rather than silently dropping this ban the moment a
// later-in-array block also sets `no-restricted-syntax` for the same two files
// (`src/audio/leadStepRecord.ts`, `src/audio/bassPatterns.ts`). See the
// `no-restricted-syntax` replace-not-merge note above GLOBAL_RESTRICTED_SYNTAX.
const AUDIO_RANDOM_BAN_SYNTAX = [
  {
    selector: "MemberExpression[object.name='Math'][computed=false][property.name='random']",
    message: 'src/audio/ routes randomness through src/audio/rng.ts (setRandomSource) so calibration renders stay reproducible — call the seam, not Math.random directly (also bans an alias assignment like `const r = Math.random`).',
  },
  {
    selector: "MemberExpression[object.name='Math'][computed=true][property.value='random']",
    message: "src/audio/ routes randomness through src/audio/rng.ts (setRandomSource) — Math['random'] is the same ban as Math.random, just spelled to dodge it.",
  },
  {
    selector: "VariableDeclarator[init.name='Math'] ObjectPattern > Property[key.name='random']",
    message: 'src/audio/ routes randomness through src/audio/rng.ts (setRandomSource) — destructuring `random` out of `Math` is the same ban as Math.random.',
  },
];

// DEV-392: guards against a new local note-name/octave regex being reintroduced
// into the five files this issue centralized onto Music Core's pitch API
// (src/musicCore/tonalAdapter.ts's octaveOfNote, pitchClassOfNote, noteMidi,
// midiToSharpName; src/musicCore/pitch.ts's transposePitchClassPreservingOctave).
// A blanket "no regex literal" ban is correct here, not just convenient: each of
// the five files was audited and confirmed (see the DEV-392 plan's survey) to
// contain no OTHER regex literal, so this cannot false-positive against
// legitimate unrelated use without the file changing shape first — at which
// point the failing lint is the prompt to reconsider whether this file still
// belongs in the list, not to silently loosen the rule.
const NOTE_REGEX_BAN = {
  selector: 'Literal[regex]',
  message:
    'DEV-392: note/pitch parsing is centralized in @/musicCore — this file must not reintroduce a local regex-based note parser. If this really is an unrelated regex, that is a sign this file has grown a second responsibility worth splitting out, not a reason to loosen this rule.',
};
```

- [ ] **Step 2: Update the existing `src/audio/**` Math.random block to spread the new const**

Find (inside the block with the long "DEV-387 final review" comment, `files:
['src/audio/**/*.{ts,tsx}']`, the one that currently inlines the three selector objects):

```js
    rules: {
      'no-restricted-syntax': [
        'error',
        ...GLOBAL_RESTRICTED_SYNTAX,
        {
          selector: "MemberExpression[object.name='Math'][computed=false][property.name='random']",
          message: 'src/audio/ routes randomness through src/audio/rng.ts (setRandomSource) so calibration renders stay reproducible — call the seam, not Math.random directly (also bans an alias assignment like `const r = Math.random`).',
        },
        {
          selector: "MemberExpression[object.name='Math'][computed=true][property.value='random']",
          message: "src/audio/ routes randomness through src/audio/rng.ts (setRandomSource) — Math['random'] is the same ban as Math.random, just spelled to dodge it.",
        },
        {
          selector: "VariableDeclarator[init.name='Math'] ObjectPattern > Property[key.name='random']",
          message: 'src/audio/ routes randomness through src/audio/rng.ts (setRandomSource) — destructuring `random` out of `Math` is the same ban as Math.random.',
        },
      ],
    },
```

Replace with:

```js
    rules: {
      'no-restricted-syntax': [
        'error',
        ...GLOBAL_RESTRICTED_SYNTAX,
        ...AUDIO_RANDOM_BAN_SYNTAX,
      ],
    },
```

- [ ] **Step 3: Add the two new blocks**

Add near the end of the `tseslint.config(...)` array (after the last existing block, before the
closing `);`):

```js
  {
    // DEV-392 note-regex guard, audio half — see AUDIO_RANDOM_BAN_SYNTAX and
    // NOTE_REGEX_BAN above for why these two files need their own block rather
    // than folding into the src/audio/** Math.random block above: that block's
    // glob (`src/audio/**`) is far wider than "the two files this issue
    // centralized," and this repo's whole `src/audio/` tree legitimately uses
    // regex elsewhere (unaudited by this issue) — only these two are confirmed
    // regex-free apart from what Tasks 6 and 8 just deleted.
    files: ['src/audio/leadStepRecord.ts', 'src/audio/bassPatterns.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...GLOBAL_RESTRICTED_SYNTAX,
        ...AUDIO_RANDOM_BAN_SYNTAX,
        NOTE_REGEX_BAN,
      ],
    },
  },
  {
    // DEV-392 note-regex guard, non-audio half.
    files: [
      'src/components/loop/lead/melodyGrid.ts',
      'src/components/ui/Keyboard.tsx',
      'src/utils/musicTheory.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...GLOBAL_RESTRICTED_SYNTAX, NOTE_REGEX_BAN],
    },
  },
```

- [ ] **Step 4: Run ESLint to verify the whole app still passes**

Run: `bun run eslint`
Expected: PASS — zero errors, zero warnings (the repo's established baseline; Tasks 1–9 already
removed every regex literal these two new blocks would have flagged).

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js
git commit -m "chore(eslint): guard the five DEV-392 files against a reintroduced note-regex"
```

---

### Task 11: Architecture test proving the guard is armed

**Files:**
- Create: `src/architecture/notePatternGuard.test.ts`

**Interfaces:**
- Consumes: `eslint` (the `ESLint` class), same pattern as `src/architecture/dependencyLayers.test.ts`.

- [ ] **Step 1: Write the test**

```ts
/**
 * The committed proof that DEV-392's note-regex reintroduction guard is armed.
 * See eslint.config.js's NOTE_REGEX_BAN and the two blocks that apply it, and
 * docs/superpowers/plans/2026-09-16-dev-392-centralize-pitch-and-scale-lookup.md.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

const GUARDED = new Set(['no-restricted-syntax']);

async function guardedMessages(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((m) => GUARDED.has(m.ruleId ?? ''))
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const err = (ruleId: string) => ({ ruleId, severity: 2 });
const NOTE_REGEX_SOURCE = "export const RE = /^([A-G]#?)(-?\\d+)$/;\n";

describe('note-regex reintroduction guard (DEV-392)', () => {
  test('a new regex literal in melodyGrid.ts is an error', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/components/loop/lead/melodyGrid.ts'),
    ).toContainEqual(err('no-restricted-syntax'));
  });

  test('a new regex literal in Keyboard.tsx is an error', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/components/ui/Keyboard.tsx'),
    ).toContainEqual(err('no-restricted-syntax'));
  });

  test('a new regex literal in musicTheory.ts is an error', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/utils/musicTheory.ts'),
    ).toContainEqual(err('no-restricted-syntax'));
  });

  test('a new regex literal in bassPatterns.ts is an error, and the Math.random ban still applies too', async () => {
    const messages = await guardedMessages(NOTE_REGEX_SOURCE, 'src/audio/bassPatterns.ts');
    expect(messages).toContainEqual(err('no-restricted-syntax'));
    const randomMessages = await guardedMessages(
      "export const R = Math.random();\n",
      'src/audio/bassPatterns.ts',
    );
    expect(randomMessages).toContainEqual(err('no-restricted-syntax'));
  });

  test('a new regex literal in leadStepRecord.ts is an error', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/audio/leadStepRecord.ts'),
    ).toContainEqual(err('no-restricted-syntax'));
  });

  test('a regex literal elsewhere in src/audio/ is unaffected (the guard is scoped, not global)', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/audio/synth/subtractiveVoice.ts'),
    ).toEqual([]);
  });

  test('src/musicCore/tonalAdapter.ts — where octaveOfNote/pitchClassOfNote actually live — is unaffected', async () => {
    expect(
      await guardedMessages(NOTE_REGEX_SOURCE, 'src/musicCore/tonalAdapter.ts'),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun test src/architecture/notePatternGuard.test.ts`
Expected: PASS — all seven assertions, proving both that the guard fires on the five named files
and that it does not overreach onto an unrelated `src/audio/` file or onto `tonalAdapter.ts`
itself.

- [ ] **Step 3: Commit**

```bash
git add src/architecture/notePatternGuard.test.ts
git commit -m "test(architecture): prove DEV-392's note-regex reintroduction guard is armed"
```

---

### Task 12: Full verification and CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the complete gate**

Run: `bun run verify`
Expected: PASS — every test file, `eslint` (zero findings), both `check:*` dead-code scans (zero
findings), and the production build.

If anything fails, fix it in the file the failure names and re-run `bun run verify` from the top
— do not narrow to a single test file once the full gate has been run once, since a later task's
change can regress an earlier task's file.

- [ ] **Step 2: Add a CLAUDE.md paragraph documenting the new Music Core surface**

Insert a new paragraph after the existing "A per-degree chord quality is derived…" paragraph
(the one ending "…which is exactly how two of eleven entries came to contradict the table's own
stated rule with nothing failing"), before the "A vibe is pure data…" paragraph:

```markdown
**Music Core owns pitch parsing, octave extraction and scale-fallback resolution, and nothing
outside `src/musicCore/` hand-rolls a note-name regex.** `tonalAdapter.ts` wraps `octaveOfNote`
(a note's octave, `null` for none or for an unparseable name) alongside the DEV-394 primitives
(`noteMidi`, `pitchClassOfNote`, `chromaOfNote`, `midiToSharpName`); `pitch.ts` composes
`transposePitchClassPreservingOctave` (shift a pitch class, keep the written octave — what a
slash bass needs on a key change) on top of them; `scale.ts` (moved from `src/utils/scaleLookup.ts`,
DEV-392) is the one place an unrecognised scale type resolves to Major. Every one of these fails
explicitly on invalid input — `null`/`NaN`, never a silent substitution — because that is Music
Core's contract for a core function; a consumer's own defensive default, where one exists (real-time
audio scheduling code that would rather keep an unreachable-in-practice fallback than risk a
throw mid-callback), stays visible in the consumer's file, not folded into the core function.
`eslint.config.js`'s `NOTE_REGEX_BAN` bans any regex literal at all in the five files this
centralization touched (`leadStepRecord.ts`, `bassPatterns.ts`, `melodyGrid.ts`, `Keyboard.tsx`,
`musicTheory.ts`) — a blanket ban is correct there, not just convenient, because none of the five
has any other legitimate use for one.
```

- [ ] **Step 3: Run `bun run verify` one final time**

Run: `bun run verify`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record DEV-392's Music Core pitch/scale-lookup surface in CLAUDE.md"
```

---

## Self-review notes

- **Spec coverage:** every acceptance-criteria bullet maps to a task — note parsing/pitch-class/
  octave/MIDI/canonical-sharp/comparison/octave-transposition ownership (Tasks 1, 4, and the
  Survey findings' "already satisfied" notes for comparison/octave-transposition); lead recording
  (Task 6); melody grid (Task 7); bass resolution (Task 8); keyboard (Task 9); slash-bass
  preserve-behaviour (Task 5); single scale resolver / audit for duplicates (Tasks 2–3, 8);
  import/project boundaries vs. core-function failure policy (Global Constraints + the deferred
  items recorded in Survey findings); reintroduction guard (Tasks 10–11); characterization tests
  for enharmonics/negative octaves/octave-boundary spellings/malformed input (Tasks 1, 4, and the
  preserved existing suites in Tasks 5–9); `bun run verify` (Task 12).
- **Placeholder scan:** every step carries literal before/after code, not a description of intent;
  every new function has a real body; every migration step names the exact existing test file to
  re-run.
- **Type consistency:** `octaveOfNote(note: string): number | null` (Task 1) is used with that
  exact signature in Tasks 6 and 9; `transposePitchClassPreservingOctave(note: string, semitones:
  number): string | null` (Task 4) is used with that exact signature in Task 5;
  `resolveScaleKey(scaleType: string): string` / `scaleEntry(scaleType: string): ScaleDefinition`
  (Task 2) are used with those exact signatures in Tasks 3 and 8. `pitchClassOfNote`/`noteMidi`/
  `midiToSharpName` are DEV-394's existing, unchanged signatures, consumed as-is by Tasks 6–9.
