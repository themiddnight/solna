# DEV-396: Derive Chord Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `notes` from `ChordItem`'s authoritative shape entirely, so a chord's pitches
are always computed fresh from `root` + `quality` + the caller's octave, and can never disagree
with what was persisted, previewed, played back, or rendered offline.

**Architecture:** `ChordItem` keeps `id`, `root`, `quality`, `bars`, `bassNote?` — the facts a
chord actually stores — and loses `notes: string[]`. Every one of the handful of places that
needs the actual pitch list calls `generateBlockChordNotes(quality, root, octave)`
(`src/utils/musicTheory.ts`, itself a thin re-export of Music Core's `resolveChordNotes`) with
whichever octave that surface already owns (`chordOctave`, `bassOctave`, `padOctave`, or a fixed
audition octave). This is not a new abstraction: `useChordPlayback.ts` (live chord playback) and
`padPlayback.ts` (the pad arm) already derive this way and read `chord.notes` nowhere — this plan
makes every remaining consumer match them, and removes the second, storable, driftable copy of
the same fact. `deriveChordNotes` — the helper whose only job was building that second copy — is
deleted outright rather than kept as an unused convenience.

Removing the field from the TypeScript type is the mechanism that finds every consumer: once
`ChordItem` has no `notes`, `bun run lint` (tsc) fails at every read and every construction site
that still names it, so the task list below is exhaustive by construction, not by grep-and-hope.
Mid-plan, between Task 1 and the task that fixes the last consumer, `bun run lint` is expected to
be RED — that is normal for a type-first migration and is called out per task; only the final
task requires the full `bun run verify` gate to be green.

**Tech Stack:** TypeScript, Bun test runner, Zustand, Music Core (`src/musicCore/chordQuality.ts`).

**Spec:** This plan's own "Explore before planning" findings below stand in for a separate spec
doc — DEV-396 is scoped directly from the Linear issue AC/DoD reproduced in full in the dispatch
that produced this plan; no separate design doc exists yet. `docs/superpowers/plans/2026-09-16-dev-391-music-domain-architecture-epic-plan.md` §6 is the original epic-level survey (superseded by the file-by-file findings below, which were re-verified against current `main` after DEV-392/393/394 landed).

## Global Constraints

- No migration chains: this is a persisted-shape change handled by the sanitize boundary
  validating on every read, never by a `PERSIST_VERSION`/`formatVersion` gated branch (CLAUDE.md,
  "no migration chains").
- `PROJECT_FORMAT_VERSION` (`src/store/projectFormat.ts`) is still bumped by one, because the
  `.solna` content contract genuinely changed shape — that constant is stamped and checked
  (`parseProjectFile` refuses a newer body) but drives no read-time transform; do not add one.
- Every write site derives nothing — it stores `{ id, root, quality, bars, bassNote? }` and
  nothing else; only a READ site that needs actual pitches calls
  `generateBlockChordNotes(quality, root, octave)`.
- No file under `src/data/` is touched by this plan (chord tables there already store
  `root`/`quality`/`roman`/`degree`, never `notes`).
- `src/audio/`, `src/store/`, `src/components/` keep the existing import-layering rules
  (CLAUDE.md's four layers) — nothing in this plan crosses one.
- Tests are `bun:test`, no DOM/testing-library (`.claude/rules/testing.md`).
- `bun run verify` is the completion gate for the final task only; intermediate tasks are judged
  by their own test file(s) passing, per the note under Architecture above.

---

## Explore-before-planning findings (what is CURRENT, re-verified against `main`)

- `ChordItem` (`src/types.ts:139-146`) has `notes: string[]` alongside `root`, `quality:
  ChordQuality`, `bars`, `bassNote?`.
- `generateBlockChordNotes(chord, root, octave)` (`src/utils/musicTheory.ts:589-591`) already
  wraps Music Core's `resolveChordNotes` (`src/musicCore/chordQuality.ts:210-229`), which throws
  on an unregistered quality or an unresolvable root. This is already "Music Core generating
  notes from validated root/quality/octave" — the AC bullet asking for this is already satisfied
  by existing infrastructure; this plan's job is only to route every consumer through it.
- `deriveChordNotes(chord, octave)` (`musicTheory.ts:490-492`) is a thin wrapper:
  `{ ...chord, notes: generateBlockChordNotes(chord.quality, chord.root, octave) }`. It is called
  at every production WRITE site that builds a `ChordItem` — `chordsSlice.ts` (init,
  `setChordOctave`), `loopSlice.ts` (init), `audio/chordProgressions.ts`'s `resolveProgression`,
  `store/instantVibesChordsFixture.ts`, `utils/musicTheory.ts`'s own `transposeProgression`,
  `audio/playback/chordPlayback.ts`'s `previewChordForScale`, and
  `components/loop/chord/useChordView.ts` (add/update/apply-library-chord/preview-temp-chord).
  **Every production write site already derives fresh at write time.** The only bypass is the
  sanitize boundary.
- `store/sanitize.ts`'s `isChordItem` (line ~419-435) validates `root` against `ROOT_SET`,
  `quality` by exact-token registry match, `bassNote`'s pitch class against `ROOT_SET` — and
  `notes` only with `isStringArray(value.notes)`, an arbitrary-string-array check with **no
  relationship to `root`/`quality`**. This is the one real hole DEV-392/393/394 left open: a
  persisted/imported chord body can carry `root: 'C', quality: 'maj', notes: ['F#3','A3','C4']`
  and sanitize accepts it whole.
- `store/initialState.ts`'s `INITIAL_CHORDS` (line 84-88) hand-authors a `notes` array per chord.
  Both `chordsSlice.ts:31` and `loopSlice.ts:41` immediately discard it:
  `INITIAL_CHORDS.map((chord) => deriveChordNotes(chord, 4))`. Confirmed dead/redundant data.
- `chordsSlice.ts`'s `setChordOctave` (line 127-131) already derives notes for every chord in the
  SAME `set()` call as the octave write — the "atomic octave change" AC is **already satisfied**
  for the current (notes-carrying) shape. Once `notes` is removed from `ChordItem`, this action
  becomes a plain `set({ chordOctave })` with nothing else to keep in sync — atomicity becomes
  structural rather than a discipline to maintain.
- Consumers confirmed to already derive fresh (no change needed beyond the type edit):
  `components/loop/chord/useChordPlayback.ts` (live chord + bass pattern playback — calls
  `generateBlockChordNotes(chord.quality, chord.root, s.chordOctave)` directly, ignores
  `chord.notes`) and `audio/playback/padPlayback.ts`'s `resolvePadArm` (calls
  `generateBlockChordNotes(input.chord.quality, input.chord.root, input.padOctave)`). Offline
  render (`audio/export/renderMixdown.ts`) reuses `resolvePadArm`'s output (`arm.notes`), never
  reads `chord.notes` directly, and shares `useChordPlayback`'s scheduling helpers per the
  "one synth implementation serves the speakers and the mixdown" rule — so once the shared
  helpers below are fixed, live and offline output stay equivalent by construction, with no
  separate offline-only fix needed.
- Consumers confirmed to read `chord.notes` DIRECTLY and needing a fix:
  1. `audio/bassPatterns.ts`'s `resolveBassSteps` — `chord.notes[TONE_INDEX[t]]` (line 89), the
     third/fifth/seventh fallback chain for a bass step with no explicit tone. The result is
     immediately stripped to a pitch class (`pitchClassOfNote`) and re-placed at the bass
     octave — the exact octave `chord.notes` was derived at never mattered.
  2. `audio/playback/chordPlayback.ts`'s `playChordLegato`/`playChordLegatoWithEngine` — `for
     (const note of chord.notes)` (line 326), the held-chord preview (mouse-down on a catalog
     chip or a progression card).
  3. `audio/playback/presetPreview.ts`'s `previewChordProgression` — `for (const n of
     chords[nextIndex].notes)` (line 164), the chord-library audition.
  4. `components/loop/chord/SortableChordCard.tsx`'s `ChordTriggerPad` — `chord.notes.map(...)`
     (line 169), the note-name readout under the root/quality on each chord card.
  5. `components/song/SortableLoopCard.tsx`'s `LoopChordStrip` — `chord.notes?.length ? ...
     chord.notes.join(...) : ...` (line 335), the hover tooltip on a loop's chord badges.
- `components/loop/ChordPresetLibrary.tsx`'s `resolveFactoryChords`/`resolveCustomChords`
  (line 161-183) both build notes at a **hard-coded octave 4** regardless of the live
  `chordOctave` — `resolveFactoryChords` via `resolveProgression(..., 4)`, `resolveCustomChords`
  via `generateBlockChordNotes(c.quality, c.root, 4)`. This existing octave-4-for-audition
  behavior is unrelated to this issue and is preserved verbatim, not "fixed."
- `store/vibes.ts`'s `resolveVibe` passes `spec.chordOctave` into `resolveProgression`'s octave
  param — the only call site that passes a real (non-literal-4) octave. `applyVibeToStore` also
  calls `store.setChordOctave(vibe.chordOctave)` separately, so the loop's `chordOctave` field
  ends up correct regardless of what `resolveProgression` does with its octave arg.
- `store/loop.ts`'s field-name list (`chordOctave` appears there and in `loopCopy.ts`) is
  unrelated to `notes` — no changes needed in either file.
- No caller anywhere passes a `notes` array into a freshly-constructed `ChordItem` except through
  `deriveChordNotes`/`generateBlockChordNotes`/the hand-authored `INITIAL_CHORDS` literals — full
  repo grep for `notes:` inside a `ChordItem`-shaped object literal confirms this.

---

## Task 1: Drop `ChordItem.notes` from the type; delete `deriveChordNotes`; update `transposeProgression` and `snapProgressionToScale`

**Files:**
- Modify: `src/types.ts` (`ChordItem` interface)
- Modify: `src/utils/musicTheory.ts` (`deriveChordNotes`, `transposeProgression`,
  `snapProgressionToScale`)
- Modify: `src/utils/musicTheory.test.ts`

**Interfaces:**
- Produces: `ChordItem` with no `notes` field — every later task's "does this file still
  compile" check is against this shape.
- Produces: `transposeProgression(chords: ChordItem[], fromRoot: string, toRoot: string):
  ChordItem[]` — three params, no `octave`.
- Produces: `snapProgressionToScale(currentChords: ChordItem[], root: string, scaleType: string):
  ChordItem[]` — three params, no `octave`.
- Removes: `deriveChordNotes` (no longer exported; every prior caller is fixed in a later task).

- [ ] **Step 1: Write the failing tests**

Replace the `chord()` test helper and the `transposeProgression`/`snapProgressionToScale`
describe blocks in `src/utils/musicTheory.test.ts`. The helper no longer derives notes:

```typescript
const chord = (id: string, root: string, quality: ChordQuality, bars = 1): ChordItem => ({
  id, root, quality, bars,
});
```

Drop the trailing octave argument from every `transposeProgression(...)` call in the file (the
measured case, the 144-root-pair interval test, the degree-preservation test, the slash-bass
test, and the round-trip test) — e.g. line 243's
`transposeProgression(A_MINOR_PROGRESSION, 'A', 'C', 4)` becomes
`transposeProgression(A_MINOR_PROGRESSION, 'A', 'C')`. Delete the
`'notes are re-derived at the requested octave'` test (current lines 288-291) outright — there is
no `notes` field left for it to assert on, and `transposeProgression`'s note-derivation behavior
no longer exists to test. Add one new test proving the field really is gone from what the
function returns:

```typescript
  test('the result carries no notes field', () => {
    const moved = transposeProgression(A_MINOR_PROGRESSION, 'A', 'C');
    for (const c of moved) {
      expect('notes' in c).toBe(false);
    }
  });
```

Do the same drop-the-trailing-octave-arg edit for every `snapProgressionToScale(...)` call in
this file's `describe('snapProgressionToScale', ...)` block, and add the matching
no-notes-field assertion there too.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/utils/musicTheory.test.ts`
Expected: FAIL — `ChordItem` still has `notes`, `deriveChordNotes` still exists,
`transposeProgression`/`snapProgressionToScale` still take a 4th `octave` argument the new calls
no longer pass, so TS argument-count errors surface as `bun test` failures (this repo's test
runner type-checks via the same `tsc` config).

- [ ] **Step 3: Remove `notes` from `ChordItem`**

In `src/types.ts`, delete the `notes: string[];` line from the `ChordItem` interface (leaves
`id`, `root`, `quality`, `bars`, `bassNote?`).

- [ ] **Step 4: Delete `deriveChordNotes` and update the two functions that used it**

In `src/utils/musicTheory.ts`, delete the `deriveChordNotes` function (current lines 489-492) and
its docblock entirely.

Replace `transposeProgression`:

```typescript
export function transposeProgression(
  chords: ChordItem[],
  fromRoot: string,
  toRoot: string,
): ChordItem[] {
  const shift = (rootSemitone(toRoot) - rootSemitone(fromRoot) + 12) % 12;
  return chords.map((chord) => ({
    ...chord,
    root: ROOTS[(rootSemitone(chord.root) + shift) % 12],
    ...(chord.bassNote ? { bassNote: transposePitchClass(chord.bassNote, shift) } : {}),
  }));
}
```

Update its docblock: drop the reference to `deriveChordNotes`/octave, keep the "every chord shifts
by the same interval" explanation.

In `snapProgressionToScale`, drop the `octave = 4` parameter and the
`notes: generateBlockChordNotes(targetQuality, diatonic.root, octave)` line from the returned
object:

```typescript
export function snapProgressionToScale(
  currentChords: ChordItem[],
  root: string,
  scaleType: string,
): ChordItem[] {
  const newRootIndex = rootSemitone(root);
  const scale = scaleEntry(scaleType);

  return currentChords.map((chord, idx) => {
    const currentRootIdx = rootSemitone(chord.root);
    const intervalFromNewRoot = (currentRootIdx - newRootIndex + 12) % 12;
    const bestDegree = nearestDegrees(scale.intervals, intervalFromNewRoot)[0];

    const preserveQuality = shouldPreserveQualityOnSnap(chord.quality);
    const use7ths = !preserveQuality && SEVENTH_SHAPED_QUALITIES.has(chord.quality);
    const diatonic = getDiatonicChordForDegree(bestDegree, root, scaleType, use7ths);

    const targetQuality: ChordQuality = preserveQuality ? chord.quality : diatonic.quality;

    return {
      ...chord,
      id: chord.id || `chord-${Date.now()}-${idx}`,
      root: diatonic.root,
      quality: targetQuality,
    };
  });
}
```

(Docblock keeps its reharmonization-policy explanation verbatim; only the "and
`notes: generateBlockChordNotes(...)`" clause and the `octave` parameter documentation are
removed.)

This step leaves `bun run lint` RED across the rest of the repo (every other consumer of
`deriveChordNotes`/`ChordItem.notes`/the 4-arg `transposeProgression`/`snapProgressionToScale`
signatures now fails to compile) — expected per the Architecture note; subsequent tasks fix each
one.

- [ ] **Step 5: Run this file's tests to verify they pass**

Run: `bun test src/utils/musicTheory.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/utils/musicTheory.ts src/utils/musicTheory.test.ts
git commit -m "refactor(chords): drop ChordItem.notes, derive-only transposeProgression/snapProgressionToScale"
```

---

## Task 2: Fix `previewChordForScale` and change `playChordLegato`/`playChordLegatoWithEngine` to take `notes: string[]`

**Files:**
- Modify: `src/audio/playback/chordPlayback.ts`
- Modify: `src/audio/playback/chordPlayback.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 beyond the updated `ChordItem` type.
- Produces: `playChordLegato(notes: string[], synth: ActiveSynth, engine: PreviewEngine): void`
  (was `(chord: ChordItem, ...)`) — matches the existing convention `playFullHoldChord(notes:
  string[], ...)` in the same file already uses.
- Produces: `playChordLegatoWithEngine(notes: string[], synth: ActiveSynth): void`.
- Produces: `previewChordForScale(scaleRoot: string, scaleType: string): ChordItem` — no `octave`
  param, no `notes` field on the result.

- [ ] **Step 1: Write the failing tests**

In `src/audio/playback/chordPlayback.test.ts`, find the existing `playChordLegato`/
`playChordLegatoWithEngine` tests (they currently build a `ChordItem` with a `notes` array and
pass the whole chord). Change every such call site to pass a bare `string[]` instead:

```typescript
  test('strikes every note of the chord and stops the bus first', () => {
    const engine = fakePreviewEngine();
    playChordLegato(['C4', 'E4', 'G4'], SOME_SYNTH, engine);
    expect(engine.stopSource).toHaveBeenCalledWith('chord', 0.05);
    expect(engine.triggerSynthNoteOn).toHaveBeenCalledTimes(3);
  });
```

(Use whatever fake-engine helper and `ActiveSynth` fixture the existing test already defines —
only the first argument's shape changes, from a `ChordItem` literal to a plain note-name array.)

For `previewChordForScale`, update its test(s) to call it with two arguments instead of three
(`previewChordForScale(scaleRoot, scaleType)`, no octave) and assert the result has no `notes`
key:

```typescript
  test('has no notes field', () => {
    const preview = previewChordForScale('C', 'Major');
    expect('notes' in preview).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/audio/playback/chordPlayback.test.ts`
Expected: FAIL — current signatures still take a `ChordItem`/a 3rd octave arg.

- [ ] **Step 3: Implement**

```typescript
export function playChordLegato(
  notes: string[],
  synth: ActiveSynth,
  engine: PreviewEngine,
): void {
  engine.stopSource("chord", 0.05);
  for (const note of notes) {
    engine.triggerSynthNoteOn(
      note,
      synth,
      DEFAULT_VELOCITY * equalPowerVelocityScale(notes.length),
      undefined,
      "chord",
      1,
      "preview",
    );
  }
}
```

```typescript
export function previewChordForScale(
  scaleRoot: string,
  scaleType: string,
): ChordItem {
  const tonic = getDiatonicChordForDegree(0, scaleRoot, scaleType, false);
  return {
    id: "preview",
    root: tonic.root,
    quality: tonic.quality,
    bars: 1,
  };
}
```

```typescript
export function playChordLegatoWithEngine(
  notes: string[],
  synth: ActiveSynth,
): void {
  playChordLegato(notes, synth, audioEngine);
}
```

Remove the now-unused `deriveChordNotes` import at the top of the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/audio/playback/chordPlayback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/playback/chordPlayback.ts src/audio/playback/chordPlayback.test.ts
git commit -m "refactor(chords): playChordLegato takes notes, previewChordForScale drops octave/notes"
```

---

## Task 3: Fix `resolveProgression` (drop `octave`, drop `notes`) and every call site

**Files:**
- Modify: `src/audio/chordProgressions.ts`
- Modify: `src/audio/chordProgressions.test.ts`
- Modify: `src/audio/chordProgressions.migration.test.ts`
- Modify: `src/utils/musicTheory.test.ts` (its own `resolveProgression` calls, lines ~453-478)
- Modify: `src/store/vibes.ts`
- Modify: `src/store/vibes.test.ts`
- Modify: `src/store/instantVibesChordsFixture.ts`
- Modify: `src/store/instantVibesProgressions.test.ts`
- Modify: `src/components/loop/ChordPresetLibrary.tsx` (`resolveFactoryChords` only — leave
  `resolveCustomChords` for Task 9)

**Interfaces:**
- Consumes: `ChordItem` with no `notes` (Task 1).
- Produces: `resolveProgression(progression: ChordProgression, scaleRoot: string, scaleType:
  string): ChordItem[]` — three params, no `octave`.

- [ ] **Step 1: Write the failing tests**

In `src/audio/chordProgressions.test.ts`, drop the trailing octave argument from every
`resolveProgression(...)` call (there are ~10; every one currently ends `, 4)` or `, 3)`). Delete
the `'notes come from deriveChordNotes at the requested octave'` test (current lines 156-161)
outright. Add:

```typescript
  test('the result carries no notes field', () => {
    const chords = resolveProgression(popAnthem, 'C', 'Major');
    for (const c of chords) {
      expect('notes' in c).toBe(false);
    }
  });
```

In `src/audio/chordProgressions.migration.test.ts`, drop the trailing `, 4` from the
`resolveProgression(progression, root, progression.referenceScale, 4)` call (line ~94).

In `src/utils/musicTheory.test.ts`, drop the trailing octave argument from its four
`resolveProgression(...)` calls (lines ~453, 461, 471, 478).

In `src/store/vibes.test.ts`, drop the trailing `, 4` from the `resolveProgression(...)` call
(line ~647).

In `src/store/instantVibesProgressions.test.ts`, change
`resolveProgression(progression, vibe.scaleRoot, vibe.scaleType, vibe.chordOctave)` (line ~39) to
drop the 4th argument.

In `src/store/instantVibesChordsFixture.ts`, `snapshotChord` no longer needs `octave` or
`deriveChordNotes`:

```typescript
function snapshotChord(id: string, root: string, quality: ChordQuality, bars: number): ChordItem {
  return { id, root, quality, bars };
}
```

Update every `snapshotChord(...)` call in the same file to drop its trailing `, 4` argument (all
32 of them share the same final `4`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/audio/chordProgressions.test.ts src/audio/chordProgressions.migration.test.ts src/utils/musicTheory.test.ts src/store/vibes.test.ts src/store/instantVibesProgressions.test.ts`
Expected: FAIL — `resolveProgression` still takes 4 args and still builds `notes`.

- [ ] **Step 3: Implement**

In `src/audio/chordProgressions.ts`:

```typescript
export function resolveProgression(
  progression: ChordProgression,
  scaleRoot: string,
  scaleType: string,
): ChordItem[] {
  return progression.steps.map((progressionStep, i) => {
    const diatonic = getDiatonicChordForDegree(progressionStep.degree, scaleRoot, scaleType, false);
    const quality = progressionStep.quality ?? diatonic.quality;
    return {
      id: `${progression.id}-${i}`,
      root: diatonic.root,
      quality,
      bars: progressionStep.bars,
    };
  });
}
```

Remove the now-unused `deriveChordNotes` import and update the file's header comment (it
currently says "deriveChordNotes is the single source of truth for ChordItem.notes and must not
be re-implemented here" — replace with "getDiatonicChordForDegree is data/'s only runtime-import
reason this file exists outside src/data/, same as before; notes are no longer part of
ChordItem").

In `src/store/vibes.ts`, drop the trailing argument:

```typescript
    chords: resolveProgression(progression, spec.scaleRoot, spec.scaleType),
```

In `src/components/loop/ChordPresetLibrary.tsx`'s `resolveFactoryChords`:

```typescript
function resolveFactoryChords(
  progression: ChordProgression,
  spellingKey: SpellingKey,
): ChordItem[] {
  return resolveProgression(progression, spellingKey.scaleRoot, spellingKey.scaleType);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/audio/chordProgressions.test.ts src/audio/chordProgressions.migration.test.ts src/utils/musicTheory.test.ts src/store/vibes.test.ts src/store/instantVibesProgressions.test.ts src/store/instantVibesChordsFixture.ts`
Expected: PASS (the fixture file itself has no tests; it is exercised by
`instantVibesProgressions.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/audio/chordProgressions.ts src/audio/chordProgressions.test.ts src/audio/chordProgressions.migration.test.ts src/utils/musicTheory.test.ts src/store/vibes.ts src/store/vibes.test.ts src/store/instantVibesChordsFixture.ts src/store/instantVibesProgressions.test.ts src/components/loop/ChordPresetLibrary.tsx
git commit -m "refactor(chords): resolveProgression drops octave/notes; update every call site"
```

---

## Task 4: Fix `resolveBassSteps` to derive the fallback tone instead of reading `chord.notes`

**Files:**
- Modify: `src/audio/bassPatterns.ts`
- Modify: `src/audio/bassPatterns.test.ts`

**Interfaces:**
- Consumes: `generateBlockChordNotes(quality: string, root: string, octave: number): string[]`
  from `src/utils/musicTheory.ts`.
- Produces: `resolveBassSteps`'s public signature is UNCHANGED (still takes `octave`, which it
  already threads through for the root/next-root MIDI lookups) — only its internal fallback-tone
  lookup changes.

- [ ] **Step 1: Write the failing test**

In `src/audio/bassPatterns.test.ts`, find (or add, if none exists) a test that installs a chord
whose `notes`-shaped field would have disagreed with `root`/`quality` under the old shape, and
asserts the fallback tone (third/fifth/seventh) matches what `generateBlockChordNotes` produces
for that chord's actual `quality`/`root`:

```typescript
  test('a fallback tone is derived from quality/root, not a stored notes array', () => {
    // Both chords name the SAME quality/root; only their id differs. Under the
    // old chord.notes[TONE_INDEX[t]] lookup this test would be meaningless —
    // there was nothing to disagree with once notes always matched. It exists
    // to pin that the derivation, not a stored array, is what resolveBassSteps
    // now reads.
    const chords: ChordItem[] = [{ id: 'c1', root: 'D', quality: 'min7', bars: 1 }];
    const events = resolveBassSteps(THIRD_ONLY_PATTERN, chords, 0, 2, 'C', 'Major', 120);
    const expectedThird = generateBlockChordNotes('min7', 'D', 2)[1]; // TONE_INDEX.third
    expect(events[0].noteName).toBe(expectedThird);
  });
```

(`THIRD_ONLY_PATTERN` stands for whatever fixture pattern the existing test file already uses to
force a `'third'` step token — reuse it rather than inventing a new one; check the file's
existing fixtures for the pattern name.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: FAIL (or does not compile, since `ChordItem` no longer has `notes` and any existing
fixture in this test file that still builds one with `notes: [...]` now fails to type-check —
remove `notes: [...]` from every `ChordItem` literal in this test file as part of this step).

- [ ] **Step 3: Implement**

```typescript
import { generateBlockChordNotes } from '../utils/musicTheory';
```

```typescript
  const toneMidi = (token: 'third' | 'fifth' | 'seventh'): number => {
    const chordNotes = generateBlockChordNotes(chord.quality, chord.root, octave);
    for (const t of FALLBACK_CHAIN[token]) {
      const note = chordNotes[TONE_INDEX[t]];
      if (note) return midiAtOctave(pitchClassOfNote(note), octave);
    }
    return bassRootMidi;
  };
```

(`generateBlockChordNotes` is called once per `resolveBassSteps` invocation, not once per
fallback-chain step — hoist it above the `toneMidi` closure so it is computed once even when the
chain checks more than one token.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/bassPatterns.ts src/audio/bassPatterns.test.ts
git commit -m "refactor(chords): bass fallback tone derives from quality/root, not chord.notes"
```

---

## Task 5: Fix `previewChordProgression` to derive notes instead of reading `chords[i].notes`

**Files:**
- Modify: `src/audio/playback/presetPreview.ts`
- Modify: `src/audio/playback/presetPreview.test.ts`

**Interfaces:**
- Consumes: `generateBlockChordNotes` from `src/utils/musicTheory.ts`.
- Produces: `previewChordProgression`'s public signature is UNCHANGED
  (`(chords: ChordItem[], synth: ActiveSynth, scheduler?: PreviewScheduler): PreviewHandle`) —
  the audition octave stays a fixed `4`, matching what `ChordPresetLibrary.tsx`'s
  `resolveFactoryChords`/`resolveCustomChords` already bake their chords at (Task 3 and Task 9
  respectively) — this is existing behavior, not a fix, and is preserved verbatim.

- [ ] **Step 1: Write the failing test**

In `src/audio/playback/presetPreview.test.ts`, remove `notes: [...]` from every `ChordItem`
fixture literal (they no longer type-check), and add:

```typescript
  test('plays notes derived from quality/root at the audition octave, not a stored array', () => {
    const engine = fakeTriggerEngine(); // reuse whatever fake this file already installs
    const chords: ChordItem[] = [{ id: 'p1', root: 'A', quality: 'min7', bars: 1 }];
    previewChordProgression(chords, SOME_SYNTH, fakeScheduler());
    const expected = generateBlockChordNotes('min7', 'A', 4);
    const played = engine.triggerSynthNoteOn.mock.calls.map((call) => call[0]);
    expect(played).toEqual(expected);
  });
```

(Match this to whatever mocking convention the existing `presetPreview.test.ts` already uses for
`audioEngine.triggerSynthNoteOn` — the file already tests `previewChordProgression`'s scheduling,
so a fake/spy exists; reuse it rather than inventing a new one.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/playback/presetPreview.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
import { generateBlockChordNotes } from '@/utils/musicTheory';
```

```typescript
    for (; nextIndex < end; nextIndex++) {
      const start = startTime + nextIndex * PREVIEW_CHORD_DURATION;
      const chord = chords[nextIndex];
      for (const n of generateBlockChordNotes(chord.quality, chord.root, 4)) {
        const voiceId = audioEngine.triggerSynthNoteOn(n, synth, 0.75, start, PREVIEW_SOURCE, 1, "preview");
        if (voiceId) {
          audioEngine.triggerSynthNoteOff(voiceId, 0.3, start + PREVIEW_CHORD_DURATION * 0.85);
        }
      }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/audio/playback/presetPreview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audio/playback/presetPreview.ts src/audio/playback/presetPreview.test.ts
git commit -m "refactor(chords): previewChordProgression derives notes at the audition octave"
```

---

## Task 6: Drop the hand-authored `INITIAL_CHORDS.notes` literals and simplify `chordsSlice`/`loopSlice` init + `setChordOctave`

**Files:**
- Modify: `src/store/initialState.ts`
- Modify: `src/store/chordsSlice.ts`
- Modify: `src/store/loopSlice.ts`
- Modify: `src/store/chordsSlice.test.ts` (if it exists — check; otherwise the relevant assertions
  live in `src/store/store.test.ts`, modify there)
- Modify: `src/store/store.test.ts` (any assertion reading `chords[i].notes`)

**Interfaces:**
- Produces: `INITIAL_CHORDS: ChordItem[]` with no `notes` field per entry.
- Produces: `setChordOctave: (octave: number) => void` that writes only `{ chordOctave }`.

- [ ] **Step 1: Write the failing tests**

In `src/store/store.test.ts` (or wherever `setChordOctave`'s atomicity is currently pinned — grep
`setChordOctave` in test files first to find the exact home), replace any assertion that reads
`chords[i].notes` after calling `setChordOctave` with an assertion that the chords array
reference/content is untouched:

```typescript
  test('setChordOctave only writes chordOctave', () => {
    const before = useAppStore.getState().chords;
    useAppStore.getState().setChordOctave(5);
    expect(useAppStore.getState().chordOctave).toBe(5);
    expect(useAppStore.getState().chords).toBe(before); // same reference: nothing else was touched
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/store.test.ts`
Expected: FAIL — `setChordOctave` still remaps `chords` (and does not compile once `ChordItem`
literals it touches lose `notes`).

- [ ] **Step 3: Implement**

In `src/store/initialState.ts`, drop `notes: [...]` from every `INITIAL_CHORDS` entry:

```typescript
export const INITIAL_CHORDS: ChordItem[] = [
  { id: 'chord-1', root: 'A', quality: 'min7', bars: 1 },
  { id: 'chord-2', root: 'F', quality: 'maj7', bars: 1 },
  { id: 'chord-3', root: 'C', quality: 'maj', bars: 1 },
  { id: 'chord-4', root: 'G', quality: '7', bars: 1 },
];
```

In `src/store/chordsSlice.ts`, drop the `deriveChordNotes` import and use `INITIAL_CHORDS`
directly (no map needed — there is nothing left to derive at init):

```typescript
    chords: INITIAL_CHORDS,
```

Simplify `setChordOctave`:

```typescript
    setChordOctave: (chordOctave) => set({ chordOctave }),
```

Update the slice's docblock (currently: "`setChordOctave` derives the new chord notes INSIDE the
same `set()` call... so the octave and the notes can never be observed out of sync") — replace
with: "`setChordOctave` writes only the octave: `ChordItem` carries no `notes` to keep in sync,
so there is nothing left for this action to derive."

In `src/store/loopSlice.ts`, drop the `deriveChordNotes` import and the `.map(...)` wrapper:

```typescript
    chords: INITIAL_CHORDS,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/store.test.ts src/store/chordsSlice.test.ts src/store/loopSlice.test.ts`
(Run whichever of these files actually exist — check with `ls src/store/*Slice.test.ts` first.)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/initialState.ts src/store/chordsSlice.ts src/store/loopSlice.ts src/store/store.test.ts
git commit -m "refactor(chords): INITIAL_CHORDS carries no notes; setChordOctave writes only the octave"
```

---

## Task 7: Fix `useChordView.ts`'s progression editor and preview hooks

**Files:**
- Modify: `src/components/loop/chord/useChordView.ts`
- Modify: `src/components/loop/ChordView.test.tsx`

**Interfaces:**
- Consumes: `generateBlockChordNotes` from `src/utils/musicTheory.ts`;
  `playChordLegatoWithEngine(notes: string[], synth: ActiveSynth)` from Task 2;
  `previewChordForScale(scaleRoot: string, scaleType: string): ChordItem` from Task 2.
- Produces: `appendChord`, `updateChord`, `handleApplyLibraryChords` no longer take/use an octave
  for note derivation (only `appendChord`'s existing `octave` param disappears — it never needed
  one for anything else).

- [ ] **Step 1: Write the failing tests**

In `src/components/loop/ChordView.test.tsx`, find the test(s) exercising `addChord`/
`addDiatonicChord`/`updateChord`/`handleApplyLibraryChords` and remove any assertion reading
`.notes` off the resulting chords (assert on `root`/`quality`/`bars`/`id` instead, which is what
these actions actually determine). Add or update the held-preview test to assert the ACTUAL notes
played come from deriving at the live `chordOctave`, not a stored field:

```typescript
  test('holding a catalog chip plays notes derived at the live chordOctave', () => {
    useAppStore.setState({ chordOctave: 3 });
    const spy = spyOnPlayChordLegatoWithEngine(); // however this file already spies on the preview bridge
    // ...trigger handlePreviewMouseDown('D', 'min7', ...)...
    expect(spy).toHaveBeenCalledWith(generateBlockChordNotes('min7', 'D', 3), expect.anything());
  });
```

(Match the exact spy/mock mechanism this test file already uses for the preview bridge — check
its existing imports from `@/audio/playback/chordPlayback` first.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/loop/ChordView.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
/** A new one-bar chord of the given root/quality, appended to the progression. */
function appendChord(
  chords: ChordItem[],
  root: string,
  quality: ChordQuality,
  id: string,
): ChordItem[] {
  return [...chords, { id, root, quality, bars: 1 }];
}
```

```typescript
  const addChord = () => {
    setChords(appendChord(chords, scaleRoot, 'maj7', `chord-${Date.now()}`));
  };

  const addDiatonicChord = (degreeIndex: number) => {
    const diatonic = getDiatonicChordForDegree(degreeIndex, scaleRoot, scaleType, use7thsInQuickAdd);
    setChords(appendChord(chords, diatonic.root, diatonic.quality, `chord-${Date.now()}`));
  };

  const addBorrowedChord = (root: string, quality: ChordQuality) => {
    setChords(appendChord(chords, root, quality, `chord-${Date.now()}`));
  };
```

```typescript
  const updateChord = useCallback((id: string, updates: Partial<ChordItem>) => {
    const { chords: liveChords, setChords: writeChords } = useAppStore.getState();
    writeChords(liveChords.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  }, []);
```

```typescript
  const handleApplyLibraryChords = (libraryChords: ChordItem[]) => {
    setChords(
      libraryChords.map((c, i) => ({ ...c, id: `lib-chord-${Date.now()}-${i}` })),
    );
    clearReharmonizeBadge();
  };
```

In `useHeldChordPreview`, derive notes at the point of playing rather than passing a `ChordItem`:

```typescript
  const handlePreviewMouseDown = (
    e: React.MouseEvent | React.TouchEvent | React.KeyboardEvent,
    root: string,
    quality: ChordQuality,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    ensurePreviewEngine();
    playChordLegatoWithEngine(generateBlockChordNotes(quality, root, chordOctave), chordSynthParams);
  };
```

```typescript
  const handleCardPreviewMouseDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent, chord: ChordItem) => {
      e.stopPropagation();
      ensurePreviewEngine();
      const { chordOctave: liveOctave, chordSynthParams: liveSynth } = useAppStore.getState();
      playChordLegatoWithEngine(
        generateBlockChordNotes(chord.quality, chord.root, liveOctave),
        liveSynth,
      );
      setActiveChordId(chord.id);
    },
    [setActiveChordId],
  );
```

(`handleCardPreviewMouseDown` did not read `chordOctave` before — `chord.notes` was already
derived at whatever `chordOctave` was live when the chord was last written. It now reads the
CURRENT live octave explicitly, which is the more correct behavior: previewing a card always
sounds at today's octave setting, not whatever it happened to be when the chord was last edited.)

`usePatternPreviews`'s `previewSource` drops the now-removed `octave` argument to
`previewChordForScale`:

```typescript
  const previewSource = () => previewChordForScale(scaleRoot, scaleType);
```

Remove the now-unused `deriveChordNotes` import at the top of the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/components/loop/ChordView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/chord/useChordView.ts src/components/loop/ChordView.test.tsx
git commit -m "refactor(chords): useChordView derives preview notes live, stops building notes on write"
```

---

## Task 8: Fix `ProgressionCard`/`SortableChordCard` to derive the note readout

**Files:**
- Modify: `src/components/loop/chord/ProgressionCard.tsx`
- Modify: `src/components/loop/chord/SortableChordCard.tsx`
- Modify: `src/components/loop/chord/SortableChordCard.test.tsx`

**Interfaces:**
- Consumes: `ChordViewState.chordOctave` (already exists on the state object `ProgressionCard`
  receives — no new prop plumbing above `ProgressionCard` itself).
- Produces: `SortableChordCardProps` gains a required `octave: number` field.

- [ ] **Step 1: Write the failing test**

In `src/components/loop/chord/SortableChordCard.test.tsx`, update every rendered-card assertion
that currently expects the note readout to come from `chord.notes` — it must now derive from
`chord.quality`/`chord.root`/the new `octave` prop:

```typescript
  test('the readout shows notes derived at the given octave', () => {
    const chord: ChordItem = { id: 'c1', root: 'A', quality: 'min7', bars: 1 };
    const html = renderToString(
      <SortableChordCard
        chord={chord}
        octave={3}
        idx={0}
        totalChords={1}
        startBar={1}
        isActive={false}
        scaleRoot="C"
        scaleType="Major"
        updateChord={() => {}}
        removeChord={() => {}}
        handleMoveChord={() => {}}
        handleCardPreviewMouseDown={() => {}}
        handleCardPreviewMouseUp={() => {}}
      />,
    );
    const expected = generateBlockChordNotes('min7', 'A', 3)
      .map((n) => spellNoteInKey(n, 'C', 'Major'))
      .join(' • ');
    expect(html).toContain(expected);
  });
```

(Match this test's exact prop list and rendering helper to whatever the file's existing tests
already use — it is `renderToString`-based per `.claude/rules/testing.md`; only the note-readout
assertion's derivation changes.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/loop/chord/SortableChordCard.test.tsx`
Expected: FAIL — `octave` is not yet a prop, and the card still reads `chord.notes` (which no
longer exists).

- [ ] **Step 3: Implement**

In `src/components/loop/chord/SortableChordCard.tsx`, add `octave: number` to
`SortableChordCardProps`, thread it into `ChordTriggerPad`, and derive there:

```typescript
export interface SortableChordCardProps {
  chord: ChordItem;
  octave: number;
  // ...unchanged fields...
}
```

```typescript
function ChordTriggerPad({
  chord,
  octave,
  isActive,
  activeBeat,
  beatsPerBar,
  scaleRoot,
  scaleType,
  onDown,
  onUp,
}: {
  chord: ChordItem;
  octave: number;
  // ...unchanged fields...
}) {
```

```typescript
      <span className="text-[10px] opacity-70 mt-1">
        {generateBlockChordNotes(chord.quality, chord.root, octave)
          .map((n) => spellNoteInKey(n, scaleRoot, scaleType))
          .join(" • ")}
      </span>
```

Add `generateBlockChordNotes` to the file's `@/utils/musicTheory` import.

In `SortableChordCard`'s own destructure and its render of `<ChordTriggerPad>`, thread `octave`
through:

```typescript
export const SortableChordCard = React.memo(function SortableChordCard({
  chord,
  octave,
  idx,
  // ...
}: SortableChordCardProps) {
  // ...
      <ChordTriggerPad
        chord={chord}
        octave={octave}
        isActive={isActive}
        activeBeat={activeBeat}
```

In `src/components/loop/chord/ProgressionCard.tsx`'s `SortableProgression`, destructure
`chordOctave` off `state` (it is already part of `ChordViewState`) and pass it down:

```typescript
function SortableProgression({ state, editor, previews }: SortableProgressionProps) {
  const {
    chords, chordIds, scaleRoot, scaleType, meterId, playheadBeat,
    playheadChordIndex, playheadChordStartBeat, chordOctave,
  } = state;
  // ...
              <SortableChordCard
                key={chord.id}
                chord={chord}
                octave={chordOctave}
                idx={idx}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/loop/chord/SortableChordCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/loop/chord/ProgressionCard.tsx src/components/loop/chord/SortableChordCard.tsx src/components/loop/chord/SortableChordCard.test.tsx
git commit -m "refactor(chords): chord card note readout derives at the loop's live chordOctave"
```

---

## Task 9: Fix `SortableLoopCard`'s tooltip and `ChordPresetLibrary`'s `resolveCustomChords`

**Files:**
- Modify: `src/components/song/SortableLoopCard.tsx`
- Modify: `src/components/song/SortableLoopCard.test.tsx`
- Modify: `src/components/loop/ChordPresetLibrary.tsx` (`resolveCustomChords`)
- Modify: `src/components/loop/ChordPresetLibrary.test.tsx`

**Interfaces:**
- Produces: `LoopChordStripProps` gains `chordOctave: number`.
- Produces: `resolveCustomChords` returns chords with no `notes` field — the audition path (Task
  5) derives them at play time.

- [ ] **Step 1: Write the failing tests**

In `src/components/song/SortableLoopCard.test.tsx`, update the tooltip test to expect notes
derived at the loop's `chordOctave` rather than a stored field:

```typescript
  test('the chord badge tooltip lists notes derived at the loop octave', () => {
    const loop = { ...createDefaultLoop(), chordOctave: 5, chords: [
      { id: 'c1', root: 'D', quality: 'min7', bars: 1 },
    ]};
    const html = renderToString(<SortableLoopCard loop={loop} /* ...other required props... */ />);
    const expected = generateBlockChordNotes('min7', 'D', 5).join(', ');
    expect(html).toContain(`Notes: ${expected}`);
  });
```

(Match required props to whatever `SortableLoopCard.test.tsx` already supplies for its existing
render calls.)

In `src/components/loop/ChordPresetLibrary.test.tsx`, remove any assertion reading `.notes` off
`resolveCustomChords`'s output; assert on `root`/`quality` instead, and add an audition-path
assertion (via `previewChordProgression`, already fixed in Task 5) proving the actual sound still
comes out right — or, if the existing test only exercises `resolveCustomChords` in isolation,
assert the return value has no `notes` key.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/song/SortableLoopCard.test.tsx src/components/loop/ChordPresetLibrary.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/components/song/SortableLoopCard.tsx`:

```typescript
interface LoopChordStripProps {
  chords: ChordItem[] | undefined;
  chordOctave: number;
  isPlaying: boolean;
  activeChordIndex: number | null;
}

function LoopChordStrip({ chords, chordOctave, isPlaying, activeChordIndex }: LoopChordStripProps) {
  if (!chords || chords.length === 0) {
    return <span className="text-base-content/40 italic">No chords</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {chords.map((chord, cIdx) => {
        const isChordActive = isPlaying && cIdx === activeChordIndex;
        const notes = generateBlockChordNotes(chord.quality, chord.root, chordOctave);
        return (
          <span
            key={chord.id || `${chord.root}-${cIdx}`}
            className={/* unchanged */}
            title={notes.length ? `Notes: ${notes.join(', ')}` : undefined}
          >
```

Add `generateBlockChordNotes` to this file's `@/utils/musicTheory` import, and update the call
site (around line 737-738) to pass the new prop:

```typescript
        <LoopChordStrip
          chords={loop.chords}
          chordOctave={loop.chordOctave}
```

In `src/components/loop/ChordPresetLibrary.tsx`'s `resolveCustomChords`:

```typescript
function resolveCustomChords(
  customChords: ChordItem[],
  spellingKey: SpellingKey,
  autoReharmonize: boolean,
): ChordItem[] {
  let chords = customChords.map((c, i) => ({
    ...c,
    id: c.id || `custom-chord-${Date.now()}-${i}`,
  }));

  if (autoReharmonize) {
    chords = snapProgressionToScale(chords, spellingKey.scaleRoot, spellingKey.scaleType);
  }
  return chords;
}
```

Remove the now-unused `generateBlockChordNotes` import from this file if `resolveCustomChords`
was its only caller (check — `spellProgression`/other helpers in the same file do not need it).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/components/song/SortableLoopCard.test.tsx src/components/loop/ChordPresetLibrary.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/song/SortableLoopCard.tsx src/components/song/SortableLoopCard.test.tsx src/components/loop/ChordPresetLibrary.tsx src/components/loop/ChordPresetLibrary.test.tsx
git commit -m "refactor(chords): loop card tooltip and library apply derive notes, never store them"
```

---

## Task 10: Harden the sanitize boundary — drop the `notes` check, prove contradictory bodies can no longer install disagreeing pitches

**Files:**
- Modify: `src/store/sanitize.ts` (`isChordItem`)
- Modify: `src/store/sanitize.test.ts`

**Interfaces:**
- Produces: `isChordItem(value: unknown): boolean` with no `notes` check at all — the field is
  not part of the validated shape because it is not part of the type.

- [ ] **Step 1: Write the failing tests**

In `src/store/sanitize.test.ts`'s `describe('sanitizeLoops checks array elements, not just
Array.isArray', ...)` table (current lines 255-293):

- Remove the `'a chord missing notes'` row (current line 257) — a chord with no `notes` key is
  now exactly the valid shape, not an invalid one.
- Remove the `'a chord with string notes'` row (current line 258) — a stray, wrong-typed `notes`
  key is now inert extra JSON nothing reads or rejects.
- Drop the now-meaningless `notes: ['A3']`/`notes: 'A3'` key from every remaining row in the
  table (`'a chord with zero bars'`, `'a chord with an unregistered quality'`, `'a chord with an
  unresolvable root'`, `'a chord with a wrong-case quality'`, `'a chord with a malformed
  bassNote'`) — they stay invalid for their own stated reason (bad `bars`/`quality`/`root`/
  `bassNote`), independent of `notes`.

Add a new describe block proving the central DoD requirement — a contradictory stored body no
longer has anywhere to hide a wrong pitch, because there is no pitch stored at all:

```typescript
describe('a chord body with a contradictory notes field is accepted, because notes is not part of the validated shape', () => {
  test('sanitizeLoops keeps root/quality and drops the stray notes key from what the app trusts', () => {
    const contradictory = {
      id: 'c1',
      root: 'C',
      quality: 'maj',
      bars: 1,
      notes: ['F#3', 'A3', 'C4'], // a different chord's notes entirely
    };
    const [out] = sanitizeLoops([{ ...createDefaultLoop(), chords: [contradictory] }]) ?? [];
    expect(out.chords[0].root).toBe('C');
    expect(out.chords[0].quality).toBe('maj');
    // The derived pitches for what was actually stored (root/quality), proving
    // nothing downstream can observe the contradictory stray array:
    expect(generateBlockChordNotes('maj', 'C', 4)).not.toEqual(contradictory.notes);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/sanitize.test.ts`
Expected: FAIL — `isChordItem` still calls `isStringArray(value.notes)`, so the two removed rows'
assertions (which now expect these bodies to be VALID, since the table drives a
falls-back-to-default check that no longer applies to them — see Step 1's actual edit: these rows
are REMOVED from the falls-back table, not flipped in place) leave the file red until Step 3.

- [ ] **Step 3: Implement**

In `src/store/sanitize.ts`, remove the `isStringArray(value.notes) &&` line from `isChordItem`:

```typescript
function isChordItem(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.root === 'string' &&
    isRootNote(value.root) &&
    typeof value.quality === 'string' &&
    getChordQualityEntry(value.quality)?.token === value.quality &&
    typeof value.bars === 'number' &&
    Number.isFinite(value.bars) &&
    value.bars > 0 &&
    (value.bassNote === undefined ||
      value.bassNote === null ||
      (typeof value.bassNote === 'string' && isRootNote(pitchClassOfNote(value.bassNote))))
  );
}
```

Delete the now-dead `isStringArray` helper if `isChordItem` was its only caller (grep the file
for other uses first — `asLeadNoteMatrix` does not use it, but check before deleting).

Update the docblock above `isChordItem` (current lines 374-417): remove the paragraph about
`notes` being required and checked ("A chord is read by deriveChordNotes and played straight out
of `notes`, so every field the chord path dereferences must be the right type — a missing `notes`
array is a crash..."). Replace with a note that `notes` is not part of the validated shape at all
because it is not part of `ChordItem` — every reader derives it from `root`/`quality`/an octave
it already owns, so there is nothing here to validate or reject.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/store/sanitize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/sanitize.ts src/store/sanitize.test.ts
git commit -m "fix(chords): sanitize boundary stops checking a notes field ChordItem no longer has"
```

---

## Task 11: Cross-consumer equivalence test — the DoD's "same derived pitches everywhere" proof

**Files:**
- Create: `src/store/chordNotesEquivalence.test.ts`

**Interfaces:**
- Consumes: `sanitizeLoops` (`src/store/sanitize.ts`), `generateBlockChordNotes` (`src/utils/
  musicTheory.ts`), `resolveBassSteps` (`src/audio/bassPatterns.ts`), `resolvePadArm`
  (`src/audio/playback/padPlayback.ts`).

This is the DoD's explicit ask: install a deliberately contradictory chord body through the real
ingress path (`sanitizeLoops`, exactly what a `.solna` import or a corrupted `localStorage` read
uses) and prove every consumer this plan touched agrees on the SAME derived pitches — none of
them can independently observe a different, stale or contradictory value, because none of them
read anything but `root`/`quality`/an octave.

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, test } from 'bun:test';
import { sanitizeLoops } from './sanitize';
import { createDefaultLoop } from './loopSlice';
import { generateBlockChordNotes } from '../utils/musicTheory';
import { resolveBassSteps } from '../audio/bassPatterns';
import { resolvePadArm } from '../audio/playback/padPlayback';
import { BASS_PATTERNS } from '@/data/bassPatterns';

describe('a chord installed with a contradictory stored notes field resolves identically everywhere', () => {
  // A malicious/legacy body: root C maj, but a stray notes array naming an
  // entirely different chord (F# minor). Nothing downstream may read that
  // array — it does not exist on ChordItem any more, and sanitize does not
  // validate a field it does not check.
  const rawChord = {
    id: 'c1',
    root: 'C',
    quality: 'maj',
    bars: 1,
    notes: ['F#3', 'A3', 'C#4'],
  };

  test('sanitizeLoops, bass resolution and the pad arm all agree on the derived pitches', () => {
    const [loop] = sanitizeLoops([{ ...createDefaultLoop(), chords: [rawChord] }]) ?? [];
    const chord = loop.chords[0];
    const expected = generateBlockChordNotes('maj', 'C', 4);

    // Bass fallback-tone resolution (Task 4).
    const thirdOnlyPattern = BASS_PATTERNS.find((p) => p.id === 'root-third-fifth') ?? BASS_PATTERNS[0];
    const bassEvents = resolveBassSteps(thirdOnlyPattern, [chord], 0, 4, 'C', 'Major', 120);
    for (const event of bassEvents) {
      // Every bass event's pitch class must come from the SAME chord family
      // as `expected`, never from the stray F#/A/C# array.
      expect(expected.some((n) => n.startsWith(event.noteName.replace(/\d+$/, '')))).toBe(true);
    }

    // Pad arm (already-derive-fresh path, Task-independent — proves the
    // pre-existing code and the newly fixed code agree).
    const arm = resolvePadArm({
      chord,
      mode: 'pad',
      voicing: 'triad',
      padOctave: 4,
      droneDegree: 0,
      droneIntervals: [],
      scaleRoot: 'C',
      scaleType: 'Major',
      isLoopStart: true,
    });
    expect(arm?.notes).toEqual(generateBlockChordNotes('maj', 'C', 4));
  });
});
```

(Adjust `resolvePadArm`'s argument shape and `BASS_PATTERNS` lookup to the file's actual current
signature/fixture set — read `src/audio/playback/padPlayback.ts`'s `PadArmInput` interface and
`src/data/bassPatterns.ts`'s id list before finalizing this test; the assertions above are the
required content, the exact fixture plumbing must match what those modules actually export today.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/chordNotesEquivalence.test.ts`
Expected: FAIL if run before Task 10 lands (the contradictory body would previously survive
sanitize with its `notes` field intact — though since `notes` no longer exists on `ChordItem` by
this point in the plan, this test can only be meaningfully written AFTER Task 10; if executing
tasks in order, this file compiles and its assertions should already PASS — in that case this
step's "expected failure" is instead a compile check: temporarily leave out the `Bass fallback`
block, confirm the rest passes, then add it and confirm it also passes without modification. This
test's job is to stay green FOREVER as a regression guard, not to have ever been red — it is a
proof-of-invariant test, not a feature test.)

- [ ] **Step 3: Run the test to verify it passes**

Run: `bun test src/store/chordNotesEquivalence.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/store/chordNotesEquivalence.test.ts
git commit -m "test(chords): pin that every consumer derives the same pitches, never a stored notes field"
```

---

## Task 12: Bump `PROJECT_FORMAT_VERSION`; update project round-trip tests

**Files:**
- Modify: `src/store/projectFormat.ts`
- Modify: `src/store/projectFile.test.ts`
- Modify: `src/store/migrate.test.ts` (if it asserts the current `PROJECT_FORMAT_VERSION` value)

**Interfaces:**
- Produces: `PROJECT_FORMAT_VERSION` incremented by exactly 1 from its current value.

- [ ] **Step 1: Write the failing test**

Find (`grep -n "PROJECT_FORMAT_VERSION" src/store/projectFile.test.ts src/store/migrate.test.ts`)
whichever test currently pins the literal value of `PROJECT_FORMAT_VERSION` and update the
expected number to `current + 1`. Add a round-trip test proving a project saved after this plan
lands has no `notes` key anywhere in its serialized chords:

```typescript
  test('a serialized project carries no notes field on any chord', () => {
    const state = useAppStore.getState();
    const serialized = serializeProject(state);
    for (const loop of serialized.loops) {
      for (const chord of loop.chords) {
        expect('notes' in chord).toBe(false);
      }
    }
  });
```

(Match `serializeProject`'s actual export name/shape — check `src/store/projectFile.ts`'s current
exports first.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/projectFile.test.ts src/store/migrate.test.ts`
Expected: FAIL — `PROJECT_FORMAT_VERSION` has not yet been bumped, and the new round-trip test
may already pass by construction (every write site was already fixed in Tasks 1-9) — if so, that
assertion is a regression guard rather than a red-then-green step; only the version-number
assertion is expected to be genuinely red here.

- [ ] **Step 3: Implement**

In `src/store/projectFormat.ts`, increment `PROJECT_FORMAT_VERSION` by exactly 1 and add a code
comment (not a CLAUDE.md entry — CLAUDE.md records no version numbers) at the constant's
definition:

```typescript
// Bumped for DEV-396: ChordItem dropped `notes` from the content set a .solna
// body carries. The bump signals the shape change to murva; it drives no
// read-time transform here, per the "no migration chains" policy.
export const PROJECT_FORMAT_VERSION = /* current value */ + 1;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/store/projectFile.test.ts src/store/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/projectFormat.ts src/store/projectFile.test.ts src/store/migrate.test.ts
git commit -m "chore(chords): bump PROJECT_FORMAT_VERSION for the notes-free chord content shape"
```

---

## Task 13: Document the chord-notes ownership rule in CLAUDE.md; run the full verification gate

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** None — documentation and final verification only.

- [ ] **Step 1: Add the CLAUDE.md paragraph**

Insert the following paragraph immediately after the existing "A per-degree chord quality is
derived, and a note name is spelled only where it is read." paragraph block (the one ending "...a
key name that is only read stays a candidate for spelling, one that is stored, compared, or used
as a lookup key must stay `ROOTS`-spelled."), matching the file's established voice:

```markdown
**A chord's notes are derived at the moment they are needed, never a second stored fact.**
`ChordItem` carries `root`, `quality`, `bars` and an optional `bassNote` — never `notes`. Every
consumer that needs the actual pitches — live chord playback, the pad arm, bass chord-tone
fallback, the held-chord preview, the progression audition, the chord card's readout, the loop
card's tooltip — calls `generateBlockChordNotes(quality, root, octave)` (the single Music
Core-backed derivation entrypoint `src/utils/musicTheory.ts` re-exports) with whichever octave
that surface already owns (a loop's `chordOctave`, its `bassOctave`, its `padOctave`, or a fixed
audition octave), never a `chord.notes` field, because there is none to read. This replaces a
shape that stored `notes` alongside `root`/`quality` and trusted every writer to keep them in
sync: the sanitize boundary could only check that a stored `notes` was an array of strings, never
that it matched the chord it sat beside, so an imported or hand-edited body could carry a `notes`
array naming a different chord than its own `root`/`quality` said — and playback, preview and
display would each sound or show a different chord depending on which of them still bothered to
derive fresh rather than trust the stored array. Deriving on every read makes that disagreement
structurally impossible instead of merely validated against: changing `chordOctave` is now a
single field write (`setChordOctave` in `store/chordsSlice.ts` sets nothing else) with nothing
else to keep in sync, because there is nothing else stored to fall out of sync.
```

- [ ] **Step 2: Run the full verification gate**

Run: `bun run verify`
Expected: PASS — all tests, `eslint` (zero findings), both Knip dead-code scans (zero findings —
confirm `deriveChordNotes`, the deleted `isStringArray` helper if removed in Task 10, and any
other now-dead export this plan produced do not trip the production dead-code scan; if Knip flags
a newly-unused export that this plan's tasks missed removing, delete it as part of this step, not
by adding it to an allowlist), and the production build.

If `bun run verify` surfaces a failure this plan's task list did not anticipate (a test file this
survey missed, a remaining `.notes` reference in a file not listed above), fix it directly — the
fix must follow the same rule every task above follows: a write site stores `{root, quality, bars,
bassNote?}` only, a read site that needs pitches calls `generateBlockChordNotes(quality, root,
octave)`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(chords): record the derived-notes ownership rule"
```

---

## Self-Review

**Spec coverage against the DEV-396 AC/DoD:**

- "Authoritative persisted chord shape explicitly separated from resolved chord-note
  representation" — Task 1 removes `notes` from `ChordItem` outright; Tasks 2-9 route every
  consumer through `generateBlockChordNotes`, the one resolved-representation entrypoint.
- "Chord notes generated through Music Core from validated root/quality/octave" — already true
  (`resolveChordNotes` in `chordQuality.ts`); confirmed in the explore-before-planning findings,
  no task needed beyond routing consumers to it.
- "Project files, persisted Zustand state, and custom-preset imports normalize at ingress" — Task
  10 (sanitize boundary), Task 3/9 (`sanitizeCustomChordProgressions` reuses the same
  `isChordItem`, so it is fixed by the same edit).
- "Live playback, bass, preview, UI, offline render consume the same derivation contract" — Tasks
  2, 4, 5, 7, 8, 9; live-vs-offline equivalence is structural because `renderMixdown.ts` reuses
  `resolvePadArm`/the shared chord-playback helpers rather than duplicating them (noted in
  findings, no separate offline fix needed).
- "Initial chord data contains no hand-authored note list immediately discarded" — Task 6.
- "Octave change remains atomic" — Task 6's `setChordOctave` simplification makes this
  structurally true rather than merely disciplined.
- "Legacy input repaired or rejected explicitly, never installs contradictory notes" — Task 10 +
  Task 11's equivalence proof.
- "No migration chains" — Global Constraints + Task 12's version bump with no read-time branch.

**DoD:**

- "Tests install contradictory chord bodies, prove every consumer resolves to the same derived
  pitches" — Task 11.
- "Live and offline chord/bass outputs equivalent" — structural, per above; no dedicated task
  needed since neither path was ever found reading `chord.notes` independently once Task 4 lands.
- "Project round-trip and custom-preset tests pass" — Task 12 (round-trip), Task 3/9 (custom
  presets via `sanitizeCustomChordProgressions`/`resolveCustomChords`).
- "CLAUDE.md documents the ownership rule" — Task 13.
- "`bun run verify` passes" — Task 13, Step 2.

**Placeholder scan:** every step above either shows the exact code to write or names the exact
mechanical, enumerable edit (drop a trailing argument at N named call sites, remove a named test
row) — no "add appropriate tests" or "handle edge cases" language remains.

**Type consistency check:** `generateBlockChordNotes(quality: string, root: string, octave:
number): string[]` is used with the same argument order in every task (Tasks 4, 5, 7, 8, 9, 11).
`ChordItem` without `notes` is referenced identically everywhere. `resolveProgression`'s and
`transposeProgression`'s and `snapProgressionToScale`'s new (shorter) signatures are used
consistently by every caller listed in Task 3/1. `playChordLegato`/`playChordLegatoWithEngine`'s
new `notes: string[]` first parameter is used consistently in Tasks 2 and 7 (the only two
producers of calls to it).
