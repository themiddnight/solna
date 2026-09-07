# Data Layer Extraction — Parts 2 and 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a vibe pure data — split `InstantVibe` into `VibeSpec` (ids only, in `src/data/vibes.ts`) and `ResolvedVibe` (produced at apply time by `resolveVibe` in `src/store/vibes.ts`), delete the hand-duplicated `vibeChips.ts`, replace the derived genre dice-pool mechanism with explicit per-vibe pools, and realign the four vibe ids that drift from their display names.

**Architecture:** Every library id is written **once**. `src/data/vibes.ts` holds eight `VibeSpec` literals that name ids and nothing else, so the file obeys Part 1's `src/data/` no-runtime-imports rule and can be imported eagerly by the always-mounted top bar. `src/store/vibes.ts` is the only place that turns ids into sound: `resolveVibe(spec)` resolves the progression, the drum grid and the effect chain up front and hands `applyVibeToStore` a `ResolvedVibe`. The dice pool stops being the output of a genre filter and becomes six explicit arrays on each vibe, guarded by two invariants that name the property that actually matters (scale length, reference scale) instead of routing it through a `VibeGenre` union.

**Tech Stack:** TypeScript, React 19, Zustand (`persist` + `subscribeWithSelector`), raw Web Audio API, `tonal` for note/interval math, Tailwind v4 + daisyUI, Bun (test runner + scripts), Vite, ESLint 10 flat config + typescript-eslint 8.

**Spec:** `docs/superpowers/specs/2026-09-06-data-layer-extraction-design.md` — **this plan implements Part 2, Part 2b, Part 3 and Part 3b. Part 1 is `docs/superpowers/plans/2026-09-06-data-layer-extraction-part1.md` and must land first.**

---

## Starting state this plan assumes

**Part 1 has landed on `refactor/data-layer-extraction`.** Concretely, all of the following are true before Task 1 begins. If any is not, stop — this plan's paths and symbol names will not resolve.

- `src/data/` exists and holds the ten non-vibe tables, under the eslint block that bans runtime imports, impure globals, `new`, function/class declarations and module-scope `let`/`var` in `src/data/**/*.ts` (with `src/data/**/*.test.ts` ignored). `src/data/dataLayerPurity.test.ts` pins that block.
- These modules exist with these exact exports:
  - `@/data/vibeDrumGrids` → `VIBE_DRUM_GRIDS`, `VIBE_DRUM_GRID_METERS`
  - `@/data/effectChains` → `EFFECT_CHAINS`
  - `@/data/chordProgressions` → `CHORD_PROGRESSIONS`, `ChordProgression`, `ProgressionStep`, `ProgressionCategory`
  - `@/data/chordRhythms` → `CHORD_RHYTHMS`, `RhythmPattern`, `RhythmHit`, `RhythmHitType`
  - `@/data/bassPatterns` → `BASS_PATTERNS`, `BassPattern`, `BassStep`, `BassNoteToken`, `BassStepChoice`
  - `@/data/synthPresets` → `SYNTH_PRESETS` (29 entries), `SYNTH_CATEGORIES`, `SynthPresetItem`, `SynthPresetCategory`, `SynthPresetCategoryMeta`
  - `@/data/scales` → `SCALES`, `ScaleDefinition`
  - `@/data/drumKits` → `DRUM_KITS`, `DEFAULT_DRUM_KIT`, `DrumKit`
  - `@/data/drumGrids` → `DRUM_GRIDS`, `GENRE_TO_KIT`, `DrumGrid`
  - `@/audio/presetRegistry` → `applyPreset`, `getAllSynthPresets`, `presetById`, `findPresetByName`, `getPresetsGroupedByCategory`, `getCategoryMeta`, `CategoryPresetGroup`
  - `@/audio/chordProgressions` → `progressionById`, `resolveProgression`, `VIBE_GENRE_SCALES`, and `export type { VibeGenre }`
  - `@/audio/vibeDrumGrids` → `drumGridById` (was `drumPatternById`), `drumGridMeterId` (was `drumPatternMeterId`)
  - `@/audio/effectChains` → `effectChainById`, `requireEffectChain`
  - `@/audio/chordRhythms` → `CHORD_RHYTHM_STYLE_GROUPS`, `feelToHoldScale`, `equalPowerVelocityScale`, `fullHoldDuration`, `customRhythmPattern`
  - `@/audio/bassPatterns` → `BASS_STYLE_GROUPS`, `resolveBassSteps`, `isApproachToken`, `customBassPattern`, `ResolvedBassEvent`
- `src/audio/data/` no longer exists.
- **`src/store/instantVibes.ts` still exists**, still exports `INSTANT_VIBES: InstantVibe[]`, `applyInstantVibeToStore`, `resolveVibeSynthParams` and `VIBE_IDS`, and its literal still calls `resolveProgression`, `drumGridById` and `requireEffectChain` at module-evaluation time. Only its import specifiers changed in Part 1 (`drumPatternById` → `drumGridById`).
- **`src/store/vibeChips.ts` and `src/store/vibeChips.test.ts` still exist, untouched.**
- **`VibeGenre` (`src/types.ts:11`), `VibeVariation` (`src/types.ts:248-262`), `InstantVibe` (`src/types.ts:264-345`), `VIBE_GENRE_SCALES` and `ChordProgression.genres` all still exist**, untouched.
- The four drifting vibe ids (`cyber-dance`, `ambient-chill`, `hiphop-groove`, `asian-zen`) are unchanged, and `CLAUDE.md:122-125` and `docs/design.md:140-151` still carry the "ids are persisted in project files" claim.

---

## Global Constraints

### The `src/data/` rule, unchanged from Part 1 and binding on `src/data/vibes.ts`

> **A file in `src/data/` cannot do anything at load that a reader of the file cannot see.** It
> imports nothing at runtime — **not even another file in `src/data/`** — reads no impure global,
> declares no function and constructs no object, and holds no mutable module-scope binding. It may
> declare types and interfaces, and may `import type` from anywhere. Top-level `const` arrow
> helpers that are shorthand for writing a literal are allowed.
>
> Equivalently, and more usefully: **every file in `src/data/` is an independent leaf.**

`src/data/vibes.ts` is the file this rule was written for. **If a resolver call ever appears in it, the whole argument for deleting `vibeChips.ts` collapses** and the duplication has to come back. The eslint block enforces it; the head comment on the file records why.

### The behaviour-preservation rule

> **Only import paths, symbol names and field names may change. If an asserted VALUE has to change,
> something broke — stop and find out why.**

Every fixture *value* stays byte-identical across all six tasks. There are exactly two deliberate value changes in the whole plan, both in Task 5 and both to **vibe id strings**: four ids are renamed, and the three golden fixtures' keys and the id lists in five tests follow them. Nothing else.

**The eight vibes' pool contents must not change.** Task 3 renames `variation` to `random` and renames five of its fields. It writes out today's arrays **verbatim**. Curating a pool is a content decision that belongs in a change a listener can review; doing it here would hide it inside a rename.

### The naming rule, inherited from Part 1

> **A name says what an entry IS, not what it is keyed by.** And **`preset` and `pattern` are banned as a name with no qualifier.**

**Two names are deliberately NOT changed by this plan**, and a reviewer must not "finish the job":

- **`drumPatternId` and `drumPattern` stay.** They are qualified by `drum`, the spec's Part 2 names `drumPattern` as one of `ResolvedVibe`'s three resolved fields verbatim, and renaming them would touch `types.ts`, `vibeVariation.ts`'s `rollDecoration`, the drums fixture and its test on top of everything else this plan already moves.
- **The `bass-` / `factory-` synth-preset id prefix inconsistency stays.** `bassPresetId` values are written into all eight vibe specs.

### Deletions, stated precisely

Exactly these tests are deleted, and nothing else. A deletion not on this list is a regression, whatever the justification offered for it in review.

| deleted | task | why it has nothing left to assert |
|---|---|---|
| all four tests in `src/store/vibeChips.test.ts` (the file goes) | 2 | three of them pin a duplicate against its original; with one table they compare it to itself. Id uniqueness is worth keeping and moves to `store/vibes.test.ts`. |
| `instantVibesProgressions.test.ts:43-50` `'vibe.chords is itself the resolved progression, not a separate literal'` | 1 | a `VibeSpec` has no `chords`; the property is true by construction |
| `instantVibesDrums.test.ts:65-70` `'vibe.drumPattern is itself the resolved library pattern, not a separate literal'` | 1 | same |
| `instantVibesEffects.test.ts:63-68` `'vibe.effects is itself the resolved library chain, not a separate literal'` | 1 | same |
| `vibeVariation.test.ts` `'progressionIds equals the full genre-and-scale-length filter'` | 3 | this is the mechanism being removed |
| `vibeVariation.test.ts` `'the vibe genre and its scale type agree with B1 VIBE_GENRE_SCALES'` | 3 | `VibeGenre` is gone |
| the whole `describe('genre tagging')` block in `audio/chordProgressions.test.ts:74-137` (three tests) | 3 | all three compute from `p.genres` + `VIBE_GENRE_SCALES`; `genres` no longer constrains anything |

### Gate

**`bun run verify`** = `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`. `bun run eslint` must report **zero errors**; warnings are tolerated. Run it as the last step of every task, before the commit. `bun run check:theme` is not in that chain and is unaffected. `bun run report:library` (added in Task 4) is **never** in the gate.

### Branch

All work lands on **`refactor/data-layer-extraction`**, on top of Part 1. Never commit to `main`.

### Explicitly OUT of scope for this plan

- Everything Part 1 owns. Do not re-move a table.
- **Curating any pool.** No id is added to or removed from a `random.*` array.
- **`check:presets`, CI, the music-theory rework, runtime-loadable preset packs** — the spec's "Out of scope".
- **Persisting a vibe id into a `.solna` body.** `selectedVibeId` must never enter `PROJECT_CONTENT_KEYS`; that is what makes the Task 5 rename safe.

---

## Ordering, and why it is this order

The six tasks are **strictly sequential**. Each reason below is a real dependency, not a preference.

1. **Task 1 (the `VibeSpec` / `ResolvedVibe` split) is first** because everything else needs the shape. The dice-pool arrays in Task 3 are fields *of* `VibeSpec`; the chip deletion in Task 2 rests on `data/vibes.ts` importing nothing at runtime; the id rename in Task 5 edits the `VibeSpec` literal.
2. **Task 2 (delete `vibeChips.ts`) follows Task 1** and precedes Task 3 because it is the spec's Part 2b — the second half of one argument — and a reviewer should see the split and the deletion it enables next to each other. The one cost is that `InstantVibesBar.tsx` writes `!!vibe.variation` here and Task 3's field rename touches it again; that second touch is one word inside a sweep Task 3 performs across nine files anyway.
3. **Task 3 (per-vibe pools) follows Task 2** because the arrays it renames cannot exist before `VibeSpec` does, and because `vibeChips.test.ts:19` computes `Boolean(v.variation)` — deleting that file first means Task 3 does not have to edit a file it is about to delete.
4. **Task 4 (the orphan report) follows Task 3** because the script reads `spec.random.progressions`, `random.chordRhythms` and `random.bassPatterns` — fields that do not exist until Task 3.
5. **Task 5 (the id realignment) is second-to-last, and this is the load-bearing ordering decision.** By Task 5 the three golden fixtures already compare `resolveVibe(spec)` output rather than table fields, so a fixture failure during the rename means **"an id changed"** and nothing else. Do it before Task 1 and a red fixture is ambiguous between "the shape changed" and "a key changed", which is the one distinction the fixtures exist to make. The spec asks for it as its own commit for the same reason: a `git show` that both restructures a 500-line table and rewrites four ids shows neither.
6. **Task 6 (docs and skills) is last** because it records the final paths, symbol names and field names, and three of its sections are deletions of procedures Tasks 3 and 5 remove.

### The three golden fixtures — which task touches which, and why not one sweep

Each fixture is a **pair**: a data module (`instantVibes*Fixture.ts`) and a test that checks the table against it. The pairs are touched in **two different tasks for two different reasons**, and the split is forced, not chosen.

| pair | Task 1 (Part 2) | Task 5 (Part 3b) |
|---|---|---|
| chords | `instantVibesProgressions.test.ts` — `vibe.chords` → `resolveVibe(spec).chords`; delete the `:43-50` tautology; fix the `"six vibes"` test name at `:15` | `instantVibesChordsFixture.ts:29-76` — four of the eight record keys renamed |
| drums | `instantVibesDrums.test.ts` — `vibe.drumPattern` → `resolveVibe(spec).drumPattern`; delete the `:65-70` tautology; fix the `"six vibes"` test name at `:10` and the fixture head comment's `"6×7×16"` claim | `instantVibesDrumsFixture.ts:26-97` — four keys renamed |
| effects | `instantVibesEffects.test.ts` — `vibe.effects` → `resolveVibe(spec).effects`; delete the `:63-68` tautology; fix the `"six vibes"` test name at `:7` | `instantVibesEffectsFixture.ts:26-107` — four keys renamed; and the test's `:39` `distortionVibeIds` list |

**Why all three test files change in one task (Task 1) rather than one at a time:** `chords`, `drumPattern` and `effects` leave the type *together*, in the single edit that replaces `InstantVibe` with `VibeSpec`. There is no intermediate state where one of them still exists — the suite is red for all three between the type edit and the third test's update, so splitting them would mean committing a red gate twice.

**Why the key renames are a different task from the expression change:** they are a *content* edit (four strings the app persists in `localStorage`), while Task 1 is a *structural* edit. Keeping them apart is what makes a Task 5 failure legible.

**The independence rule is not relaxed by either task.** Each fixture's head comment says the same thing — *"it is a snapshot, not a re-derivation, and that independence is the whole proof"* — and that is exactly as true against a resolver's output as against a table field. **No fixture module may import `VIBES`, `resolveVibe`, or any library table**, in Task 1, in Task 5, or ever. The test files import the resolver; the fixture data modules import nothing but `ChordItem` / `MasterEffects` types and `deriveChordNotes`. Do not "simplify" a fixture by deriving it.

---

## File Structure

### Created

| file | responsibility |
|---|---|
| `src/data/vibes.ts` | The eight `VibeSpec` literals plus the `VibeSpec` and (from Task 3) `VibeRandomRule` shapes. Ids only — no resolved field, no runtime import, no call to anything outside the file. Its head comment records why an always-mounted component may import it eagerly. |
| `src/store/vibes.ts` | The whole resolver + apply side: `ResolvedVibe`, `resolveVibe`, `applyVibeToStore`, `resolveVibeSynthParams`, `VIBE_IDS`. Renamed from `store/instantVibes.ts`; the apply body is unchanged. |
| `src/store/vibes.test.ts` | Renamed from `store/instantVibes.test.ts`. Gains the three `resolveVibe`-throws tests, the "every vibe resolves" invariant, and (Task 2) the vibe-id-uniqueness test rescued from `vibeChips.test.ts`. |
| `scripts/report-library-coverage.ts` | Prints library entries no vibe references, across six libraries. Exits **0 always**. Never part of `bun run verify`. |

### Deleted

| file | task | why |
|---|---|---|
| `src/store/instantVibes.ts` | 1 | becomes `src/data/vibes.ts` (the literal) + `src/store/vibes.ts` (the resolvers) |
| `src/store/instantVibes.test.ts` | 1 | renamed to `src/store/vibes.test.ts` |
| `src/store/vibeChips.ts` | 2 | a hand-maintained copy of seven fields whose only reason to exist was the module-evaluation coupling Task 1 dissolves |
| `src/store/vibeChips.test.ts` | 2 | it pins a duplicate that no longer exists |

### Modified

| file | task | change |
|---|---|---|
| `src/types.ts:264-345` | 1 | `InstantVibe` deleted (moves to `data/vibes.ts` as `VibeSpec`, minus three fields) |
| `src/types.ts:2-11`, `:248-262` | 3 | `VibeGenre` and `VibeVariation` deleted |
| `src/store/vibeVariation.ts:1,169-240` | 1, 3 | takes and returns a `ResolvedVibe`; reads `vibe.random` and its renamed fields |
| `src/store/vibeVariation.test.ts` | 1, 3 | resolves the table once into `RESOLVED_VIBES`; the pool invariants become the two new guards |
| `src/store/instantVibesProgressions.test.ts` | 1, 5 | compares `resolveVibe(spec).chords`; loses one tautology |
| `src/store/instantVibesDrums.test.ts` | 1, 5 | compares `resolveVibe(spec).drumPattern`; loses one tautology |
| `src/store/instantVibesEffects.test.ts` | 1, 5 | compares `resolveVibe(spec).effects`; loses one tautology |
| `src/store/instantVibesChordsFixture.ts`, `instantVibesDrumsFixture.ts`, `instantVibesEffectsFixture.ts` | 1 (comments), 5 (keys) | stale-count comments; then four record keys each |
| `src/store/vibeSynthPresets.test.ts:4,39` | 1 | import from `./vibes`; the throw message names `Vibe`, not `InstantVibe` |
| `src/store/customStepSequencer.test.ts:3,85,89` | 1 | `applyVibeToStore(resolveVibe(VIBES[0]))` |
| `src/store/musicContextSlice.ts:10`, `src/store/loadLoop.ts:27` | 1 | comments name `applyVibeToStore` |
| `src/components/vibeActions.ts:9-10,19-25,34,40-52` | 1 | both actions take a `VibeSpec` and resolve it |
| `src/components/InstantVibesBar.tsx` | 1, 2, 3 | dynamic import repointed; then `VIBES` eager and the `.find` deleted; then `vibe.random` |
| `src/components/InstantVibesBar.test.tsx:3,26,31,37,49,56,91-92,113,125,137,160,170-171` | 1 | `VIBES` + `resolveVibe` |
| `src/audio/meterRegression.test.ts:20,133-136,149,160` | 1, 5 | `VIBES`; then four ids in `FOUR_FOUR_VIBE_IDS` |
| `src/audio/vibeDrumGrids.ts`, `src/audio/effectChains.ts`, `src/audio/presetRegistry.test.ts` | 1 | comments naming `INSTANT_VIBES` / `applyInstantVibeToStore` / `InstantVibe` |
| `src/data/chordProgressions.ts` | 3 | `genres: VibeGenre[]` → `genres: string[]`, with the doc comment saying nothing computes from it; the `VibeGenre` type import dropped |
| `src/audio/chordProgressions.ts` | 3 | `VIBE_GENRE_SCALES` and the `export type { VibeGenre }` re-export deleted |
| `src/audio/chordProgressions.test.ts:1-19,74-137,139-177` | 3 | the `genre tagging` describe deleted; the four convention tests rewritten against explicit id lists |
| `package.json:6-15` | 4 | `report:library` added; `verify` unchanged |
| `CLAUDE.md:122-125` | 5 | the "Instant Vibes ids drift from labels" trap entry deleted |
| `docs/design.md:138,140-151` | 5 | the six-of-eight chip list completed; the drifting-ids blockquote deleted |
| `.claude/skills/instant-vibes/SKILL.md` | 6 | rewritten for `VibeSpec` / `resolveVibe` / per-vibe pools |
| `.claude/skills/instant-vibes/references/authoring-libraries.md:45,98-101,146-160` | 6 | the `VIBE_GENRE_SCALES` tag rule and the four-edit genre procedure deleted |
| `.claude/skills/instant-vibes/scripts/vibe-inventory.ts` | 6 | rewritten per-vibe instead of per-genre |
| `.claude/skills/music-theory/SKILL.md:94` | 6 | the `VIBE_GENRE_SCALES` tag rule |
| `CLAUDE.md` (architecture section) | 6 | the vibe paragraph records the one-id-once rule |

---

## Task 1: Split `InstantVibe` into `VibeSpec` and `ResolvedVibe`

**This is the task the rest of the plan stands on.** After it, every library id in a vibe is written exactly once, and the documented failure mode it removes is real: `.claude/skills/instant-vibes/SKILL.md:79-82` currently tells a human to *"check the pair matches"*, because a typo in the second copy of an id makes `!` hand back `undefined` and `Object.entries(vibe.drumPattern)` throw at apply time.

**One property is lost and must be replaced.** Today the resolution happens at **module-evaluation** time, so importing the table anywhere catches a typo'd id immediately. After the split, `resolveVibe` runs at apply time, so a typo would only surface when a chip is clicked. Step 1 below adds the invariant test that restores the guarantee: **every vibe in `VIBES` resolves**.

**Files:**
- Create: `src/data/vibes.ts`, `src/store/vibes.ts`
- Rename: `src/store/instantVibes.ts` → `src/store/vibes.ts`; `src/store/instantVibes.test.ts` → `src/store/vibes.test.ts`
- Modify: `src/types.ts:264-345` (delete `InstantVibe`); `src/store/vibeVariation.ts:1,169-240`; `src/store/vibeVariation.test.ts:2,15-19,38-43,151-290,297,313,365-542`; `src/store/instantVibesProgressions.test.ts:1-50`; `src/store/instantVibesDrums.test.ts:1-96`; `src/store/instantVibesEffects.test.ts:1-94`; `src/store/instantVibesDrumsFixture.ts:5`; `src/store/vibeSynthPresets.test.ts:4,39`; `src/store/customStepSequencer.test.ts:3,85,89`; `src/store/musicContextSlice.ts:10`; `src/store/loadLoop.ts:27`; `src/components/vibeActions.ts:9-52`; `src/components/InstantVibesBar.tsx:17-35,94-105`; `src/components/InstantVibesBar.test.tsx`; `src/audio/meterRegression.test.ts:20,149,160`; `src/audio/vibeDrumGrids.ts` (comment); `src/audio/effectChains.ts` (comment); `src/audio/presetRegistry.test.ts` (comment)

**Interfaces:**
- Consumes: `ChordItem`, `MasterEffects`, `FilterType`, `MeterId`, `PadMode`, `PadVoicing`, `PadInterval`, `VibeVariation` (types, `@/types`); `progressionById`, `resolveProgression` (`@/audio/chordProgressions`); `drumGridById` (`@/audio/vibeDrumGrids`); `requireEffectChain` (`@/audio/effectChains`); `presetById`, `applyPreset` (`@/audio/presetRegistry`); `INITIAL_SYNTH_PARAMS` (`./initialState`).
- Produces, from `@/data/vibes`:
  - `interface VibeSpec { id: string; name: string; tagline: string; emoji: string; bpm: number; meter: MeterId; scaleRoot: string; scaleType: string; soundKit: string; drumPatternId: string; drumFilterCutoff?: number; drumFilterResonance?: number; drumFilterType?: FilterType; progressionId: string; chordRhythmId: string; chordFeel: number; chordOctave: number; chordPresetId: string; bassPatternId: string; bassFeel: number; bassOctave: number; bassPresetId: string; pad?: { volume: number; presetId: string; mode: PadMode; octave: number; voicing: PadVoicing; droneDegree: number; droneIntervals: readonly PadInterval[] }; synthPresetId: string; effectChainId: string; variation?: VibeVariation }`
  - `const VIBES: VibeSpec[]` — 8 entries, in today's order
- Produces, from `@/store/vibes`:
  - `interface ResolvedVibe extends VibeSpec { chords: ChordItem[]; drumPattern: Record<string, number[]>; effects: Partial<MasterEffects> }`
  - `function resolveVibe(spec: VibeSpec): ResolvedVibe`
  - `function applyVibeToStore(vibe: ResolvedVibe): void` — was `applyInstantVibeToStore`
  - `function resolveVibeSynthParams(presetId: string): SynthParams` — unchanged
  - `const VIBE_IDS: string[]` — `VIBES.map((v) => v.id)`, unchanged in value

**Design notes for the implementer:**

- **`VibeSpec` keeps `variation?: VibeVariation` in this task.** Task 3 renames it to `random` and moves the rule's declaration into `data/vibes.ts`. Keeping the field as-is here is what keeps this task a pure structural change.
- **`ResolvedVibe extends VibeSpec`**, so every existing read of a spec field on a resolved vibe keeps working. That is what makes the test edits below a rename and not a rewrite.
- **`resolveVibe` resolves everything before it returns.** That preserves the rule `applyInstantVibeToStore` already documents at `instantVibes.ts:42`: resolve all ids up front, because a throw mid-swap leaves the store holding half of each vibe. `applyVibeToStore`'s body is otherwise **byte-identical** to today's — do not touch the hard-stop ordering, the selective restart, or the `stopSource(..., 0.02)` cut. Two real overlapping-audio bug fixes live in that ordering (`d8df714`, `c4a253a`).
- **`resolveVibe` calls `requireEffectChain`, not `effectChainById`.** It is already the loud one (`vibeEffectChains.ts` explained why: spreading `undefined` over `store.effects` is a silent no-op rather than a crash), it stays exported and tested by Part 1's `audio/effectChains.test.ts`, and routing through it keeps `resolveVibe` from having a third bespoke error message where a perfectly good one exists.
- **`resolveVibe` passes the vibe's own `scaleRoot`, `scaleType` and `chordOctave` to `resolveProgression`.** This deletes a second documented trap: `SKILL.md:84-87` currently warns that those three arguments are written as literals beside the id and *"a mismatch changes what the vibe sounds like without changing `progressionId`"*. After this task they cannot mismatch.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/instantVibes.test.ts` (it becomes `src/store/vibes.test.ts` in Step 3; writing the tests here first is what makes the rename observable as a rename):

```ts
describe('resolveVibe', () => {
  test('every vibe in VIBES resolves — the module-evaluation guarantee, restored', () => {
    // The old table called resolveProgression/drumGridById/requireEffectChain
    // at module scope, so a typo'd id failed the moment anything imported it.
    // A VibeSpec resolves nothing, so this test IS that guarantee now.
    for (const spec of VIBES) {
      const resolved = resolveVibe(spec);
      expect(resolved.chords.length).toBeGreaterThan(0);
      expect(Object.keys(resolved.drumPattern).length).toBeGreaterThan(0);
      expect(Object.keys(resolved.effects).length).toBeGreaterThan(0);
    }
  });

  test('a resolved vibe carries every field of its spec unchanged', () => {
    for (const spec of VIBES) {
      expect(resolveVibe(spec)).toMatchObject(spec);
    }
  });

  test('an unknown progressionId throws and names the vibe', () => {
    expect(() => resolveVibe({ ...VIBES[0], progressionId: 'nope' }))
      .toThrow('Vibe "lofi-chill" references unknown progression id: nope');
  });

  test('an unknown drumPatternId throws and names the vibe', () => {
    expect(() => resolveVibe({ ...VIBES[0], drumPatternId: 'nope' }))
      .toThrow('Vibe "lofi-chill" references unknown drum grid id: nope');
  });

  test('an unknown effectChainId throws', () => {
    // requireEffectChain is already the loud one and stays the loud one.
    expect(() => resolveVibe({ ...VIBES[0], effectChainId: 'nope' }))
      .toThrow('Unknown vibe effect chain id: nope');
  });

  test('resolveVibe hands back a fresh drum grid, never the library array', () => {
    const a = resolveVibe(VIBES[0]);
    const b = resolveVibe(VIBES[0]);
    expect(a.drumPattern.kick).toEqual(b.drumPattern.kick);
    expect(a.drumPattern.kick).not.toBe(b.drumPattern.kick);
  });
});
```

and add to that file's import block:

```ts
import { VIBES } from '../data/vibes';
import { resolveVibe } from './vibes';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/instantVibes.test.ts`
Expected: FAIL — `Cannot find module '../data/vibes' from '/Users/Pathompong/Sites/Personal/solna/src/store/instantVibes.test.ts'`

- [ ] **Step 3: Create `src/data/vibes.ts`**

`git mv src/store/instantVibes.ts src/data/vibes.ts` first, so git records this as the move it is, then rewrite the file down to the literal.

Delete everything above `export const INSTANT_VIBES` (`instantVibes.ts:1-155` — the nine imports, `resolveVibeSynthParams`, `VIBE_SWAP_RELEASE` and `applyInstantVibeToStore`) and the `VIBE_IDS` line at the end (`:665`); those come back in Step 4. Then, in the literal itself, make exactly **four** mechanical edits per entry:

1. delete the `drumPattern: drumGridById('…')!,` line;
2. delete the `chords: resolveProgression(progressionById('…')!, '…', '…', 4),` line;
3. delete the `effects: requireEffectChain('…'),` line;
4. leave every other line, every comment and every blank line **exactly** as it is.

The three deleted lines per entry are at these source line numbers (`src/store/instantVibes.ts` as it stands after Part 1) — 24 lines in total:

| vibe | `drumPattern` | `chords` | `effects` |
|---|---|---|---|
| `lofi-chill` | 174 | 177 | 196 |
| `synthwave-80s` | 237 | 240 | 259 |
| `cyber-dance` | 302 | 305 | 324 |
| `ambient-chill` | 364 | 367 | 386 |
| `hiphop-groove` | 426 | 429 | 445 |
| `asian-zen` | 488 | 494 | 513 |
| `lofi-waltz` | 556 | 559 | 578 |
| `afro-six-eight` | 618 | 621 | 637 |

Rename the export `INSTANT_VIBES` → `VIBES` and its type annotation `InstantVibe[]` → `VibeSpec[]`.

Then put this at the top of the file, replacing the deleted imports:

```ts
/**
 * The eight Instant Vibes, as pure references.
 *
 * WHY AN ALWAYS-MOUNTED COMPONENT MAY IMPORT THIS EAGERLY: every file in
 * src/data/ imports nothing at runtime — the eslint block on src/data/**
 * enforces it — so `import { VIBES } from '@/data/vibes'` pulls in this file
 * and nothing else. Its transitive graph is empty by construction.
 *
 * That is the whole reason store/vibeChips.ts could be deleted rather than
 * re-justified. That file existed because the old table resolved its chords,
 * drum grid and effect chain at MODULE-EVALUATION time, which dragged
 * synthPresets, chordProgressions, vibeDrumGrids and vibeEffectChains into the
 * eagerly-parsed main chunk for a bar that renders eight names and eight
 * emoji. If a resolver call ever appears below, that cost comes straight back
 * and the chip duplication has to come back with it. DO NOT ADD ONE.
 *
 * A VibeSpec writes every library id EXACTLY ONCE. `chords`, `drumPattern`
 * and `effects` are not fields here — `resolveVibe` in store/vibes.ts produces
 * them from the ids below, in the vibe's own key, scale and octave. Writing an
 * id twice used to be the documented failure mode: a typo in the second copy
 * made `!` hand back `undefined` and threw at apply time.
 *
 * No presentational field belongs here: `color`, `bgGradient`, `borderColor`
 * and `textColor` are forbidden on a vibe. The chip's look comes from theme
 * tokens in InstantVibesBar.
 */
import type {
  FilterType,
  MeterId,
  PadInterval,
  PadMode,
  PadVoicing,
  VibeVariation,
} from '@/types';

export interface VibeSpec {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  bpm: number;
  /**
   * The time signature this vibe is written in. Applying the vibe sets the
   * transport meter to it, so the vibe always resolves patterns of the right
   * meter.
   */
  meter: MeterId;
  scaleRoot: string;
  scaleType: string;

  // Beat & Drum Kit
  soundKit: string;
  /**
   * Library reference into VIBE_DRUM_GRIDS. Unlike `progressionId`, a reroll
   * does NOT repoint this: the dice decorates the resolved grid in place,
   * overwriting only the `hihat`/`openhat`/`tom`/`crash` rows (see
   * `rollDecoration` in store/vibeVariation.ts), so a rerolled vibe's
   * `drumPatternId` and its `drumPattern` can legitimately disagree.
   */
  drumPatternId: string;
  drumFilterCutoff?: number;
  drumFilterResonance?: number;
  drumFilterType?: FilterType;

  // Chords
  /** Library reference into CHORD_PROGRESSIONS. */
  progressionId: string;
  chordRhythmId: string;
  chordFeel: number; // 0.0 (tight) to 1.0 (loose/swung)
  chordOctave: number;
  /** Library reference into SYNTH_PRESETS for the comp voice. */
  chordPresetId: string;

  // Bass
  bassPatternId: string;
  bassFeel: number; // 0.0 (tight) to 1.0 (loose/swung)
  bassOctave: number;
  /** Library reference into SYNTH_PRESETS; must resolve to category 'Bass'. */
  bassPresetId: string;

  /**
   * The pad layer, when the genre uses one.
   *
   * OPTIONAL here and required on `Loop`, deliberately: a vibe *chooses*
   * whether to bring a pad, while a loop *always has* pad state.
   */
  pad?: {
    volume: number;
    /** Library reference into SYNTH_PRESETS; must resolve to category 'Pad'. */
    presetId: string;
    mode: PadMode;
    octave: number;
    voicing: PadVoicing;
    droneDegree: number;
    droneIntervals: readonly PadInterval[];
  };

  // Lead / Melody Synthesizer (preset reference only — arp is the user's)
  /** Library reference into SYNTH_PRESETS for the lead voice. */
  synthPresetId: string;

  /** Library reference into EFFECT_CHAINS. */
  effectChainId: string;

  /** Vibe Variation rule for the dice button. All eight ship one. */
  variation?: VibeVariation;
}

export const VIBES: VibeSpec[] = [
  /* … the eight entries, verbatim from store/instantVibes.ts:157-661, each
     minus its three resolved-field lines … */
];
```

- [ ] **Step 4: Create `src/store/vibes.ts`**

```ts
/**
 * Turning a VibeSpec into sound.
 *
 * `resolveVibe` is the ONLY place a vibe's library ids become values, and it
 * resolves all of them before it returns anything. That ordering is the same
 * rule applyVibeToStore follows for the three synth presets, and for the same
 * reason: a throw part-way through a swap leaves the store holding half of one
 * vibe and half of another, with the transport stopped.
 */
import type { ChordItem, MasterEffects, SynthParams } from '../types';
import type { VibeSpec } from '../data/vibes';
import { VIBES } from '../data/vibes';
import { audioEngine } from '../audio/engine';
import { ACCOMPANIMENT_SOURCES } from '../audio/playback/playbackEngine';
import { applyPreset, presetById } from '../audio/presetRegistry';
import { progressionById, resolveProgression } from '../audio/chordProgressions';
import { drumGridById } from '../audio/vibeDrumGrids';
import { requireEffectChain } from '../audio/effectChains';
import { useAppStore } from './store';
import { INITIAL_SYNTH_PARAMS } from './initialState';

/** A VibeSpec with its three library references turned into values. */
export interface ResolvedVibe extends VibeSpec {
  chords: ChordItem[];
  /** Seven rows of 0/1, one bar of the vibe's own meter. A fresh copy. */
  drumPattern: Record<string, number[]>;
  /** A Partial — an omitted key means "inherit the current value". */
  effects: Partial<MasterEffects>;
}

/**
 * Resolve a vibe's progression, drum grid and effect chain.
 *
 * All three throw on an unknown id. That symmetry is the point: before the
 * VibeSpec split, two of the three used `!` and handed back `undefined`, which
 * failed somewhere downstream, and only the effect chain threw.
 */
export function resolveVibe(spec: VibeSpec): ResolvedVibe {
  const progression = progressionById(spec.progressionId);
  if (!progression) {
    throw new Error(`Vibe "${spec.id}" references unknown progression id: ${spec.progressionId}`);
  }
  const drumPattern = drumGridById(spec.drumPatternId);
  if (!drumPattern) {
    throw new Error(`Vibe "${spec.id}" references unknown drum grid id: ${spec.drumPatternId}`);
  }
  return {
    ...spec,
    // The vibe's OWN key, scale and octave, by construction. These used to be
    // three literals written beside the id, and a mismatch changed what the
    // vibe sounded like without changing progressionId.
    chords: resolveProgression(progression, spec.scaleRoot, spec.scaleType, spec.chordOctave),
    drumPattern,
    effects: requireEffectChain(spec.effectChainId),
  };
}

/* … resolveVibeSynthParams verbatim from instantVibes.ts:11-30, except its
   thrown message, which loses the dead type name — see Step 11 … */

/** Same instant-but-clickless release the hard-stop button uses. */
const VIBE_SWAP_RELEASE = 0.02;

export function applyVibeToStore(vibe: ResolvedVibe) {
  /* … the body verbatim from instantVibes.ts:35-153, unchanged … */
}

export const VIBE_IDS: string[] = VIBES.map((v) => v.id);
```

Two things about this file that are not free-form:

- `resolveVibeSynthParams` and `applyVibeToStore`'s body move **verbatim**. The only edits are the function's own name and its parameter type (`InstantVibe` → `ResolvedVibe`).
- `VIBE_IDS` moves here rather than to `data/vibes.ts` because it is `VIBES.map(...)` — a computed value, which the `src/data/` rule does not forbid but which belongs with the code that consumes it.

- [ ] **Step 5: Delete `InstantVibe` from `src/types.ts`**

Delete `src/types.ts:264-345` (the whole `export interface InstantVibe { … }` block). `VibeGenre`, `VibeVariation`, `DrumDecorationRule`, `DecorationLayer` and `DensityName` all stay — Task 3 deals with them.

- [ ] **Step 6: Repoint `store/vibeVariation.ts`**

Rewrite `:1` and the `resolveVibeVariation` signature/docblock (`:168-188`) so the reroll works on a resolved vibe. Nothing about the draw order, `rollDecoration` or the returned summary changes.

```ts
import type { DecorationLayer, DensityName, DrumDecorationRule } from '../types';
import type { ResolvedVibe } from './vibes';
```

and:

```ts
/**
 * Rerolls a vibe into a different piece of music in the same genre.
 *
 * Takes and returns a ResolvedVibe: it reads the AUTHORED drumPattern to
 * decorate, and it hands the caller something applyVibeToStore can apply
 * directly. There is deliberately no second apply path — that is what keeps
 * the hard-stop-on-swap fix from regressing.
 *
 * Starts from the AUTHORED vibe every time — never from the current store — so
 * rerolls never compound, and overwrites exactly six fields: scaleRoot, bpm,
 * chordRhythmId, bassPatternId, chords and the decoration rows of drumPattern.
 * `scaleType` is copied, never drawn: it is the genre anchor.
 *
 * Draw order is part of the contract, because a scripted draw depends on it:
 * scaleRoot, bpm, chordRhythmId, bassPatternId, progression, then the layers
 * of DECORATION_ORDER that the rule lists.
 */
export function resolveVibeVariation(
  vibe: ResolvedVibe,
  current: { scaleRoot: string; chordRhythmId: string; bassPatternId: string },
  draw: VibeDraw,
): { vibe: ResolvedVibe; summary: VariationSummary } {
```

The body is unchanged. Repoint its three table/resolver imports to their Part 1 homes if Part 1 has not already: `progressionById` / `resolveProgression` from `../audio/chordProgressions`, `CHORD_RHYTHMS` from `../data/chordRhythms`, `BASS_PATTERNS` from `../data/bassPatterns` — and rename the two `.find` lookups' array names to match.

- [ ] **Step 7: Repoint `store/vibeVariation.test.ts`**

Replace `:2` with:

```ts
import { VIBES } from '../data/vibes';
import { resolveVibe } from './vibes';

/**
 * Every vibe, resolved once. This suite is about the REROLL, which reads the
 * authored drumPattern and compares its output against the authored chords and
 * effects — all three of which exist only on a ResolvedVibe.
 */
const RESOLVED_VIBES = VIBES.map(resolveVibe);
```

Then replace every `INSTANT_VIBES` in the file with `RESOLVED_VIBES` (occurrences at `:16, 38 (comment), 151, 157, 169, 188, 199, 207, 218, 235, 245, 261, 280, 297, 313, 365, 386, 396, 433, 444, 453, 468, 499, 524, 534, 542`). Nothing else changes: `ResolvedVibe extends VibeSpec`, so `v.variation`, `v.scaleRoot` and `v.drumPattern.kick` all keep working, and `{ ...RESOLVED_VIBES[0], variation: undefined }` at `:542` still type-checks.

- [ ] **Step 8: Rewrite the three golden-fixture tests**

These three files are the proof that the resolver reproduces the table. **Do not touch a single asserted value, and do not let any fixture module import `VIBES`, `resolveVibe` or a library** — each fixture's head comment says it is *"a snapshot, not a re-derivation, and that independence is the whole proof"*, and that is exactly as true against a resolver's output as against a table field.

`src/store/instantVibesProgressions.test.ts` — replace `:2` and `:16-21`, and delete `:43-50`:

```ts
import { VIBES } from '../data/vibes';
import { resolveVibe, VIBE_IDS } from './vibes';
import { ORIGINAL_VIBE_CHORDS } from './instantVibesChordsFixture';
import { progressionById, resolveProgression } from '../audio/chordProgressions';
```

```ts
describe('ORIGINAL_VIBE_CHORDS fixture', () => {
  test('captures exactly the eight vibes, matching what VIBES resolves to today', () => {
    expect(Object.keys(ORIGINAL_VIBE_CHORDS).sort()).toEqual([...VIBE_IDS].sort());
    for (const id of VIBE_IDS) {
      const spec = VIBES.find((v) => v.id === id)!;
      expect(spec).toBeDefined();
      expect(withoutId(ORIGINAL_VIBE_CHORDS[id])).toEqual(withoutId(resolveVibe(spec).chords));
    }
  });
});
```

The `'every vibe has a progressionId that resolves to a real progression'` and `'resolving progressionId in the vibe\'s own key reproduces the captured chords byte-for-byte'` tests keep their bodies, with `INSTANT_VIBES.find(...)` becoming `VIBES.find(...)`. Delete `'vibe.chords is itself the resolved progression, not a separate literal'` (`:43-50`) — a `VibeSpec` has no `chords`, so the property is now true by construction rather than by test.

`src/store/instantVibesDrums.test.ts` — replace `:2` and `:4`, rename the fixture test at `:10`, rewrite `:18` and `:61`, delete `:65-70`:

```ts
import { VIBES } from '../data/vibes';
import { resolveVibe, VIBE_IDS } from './vibes';
import { ORIGINAL_VIBE_DRUM_PATTERNS } from './instantVibesDrumsFixture';
import { drumGridById, drumGridMeterId } from '../audio/vibeDrumGrids';
```

```ts
  test('captures exactly the eight vibes', () => {
    expect(Object.keys(ORIGINAL_VIBE_DRUM_PATTERNS).sort()).toEqual([...VIBE_IDS].sort());
  });

  test('matches the drum pattern every vibe resolves to', () => {
    for (const id of VIBE_IDS) {
      const spec = VIBES.find((v) => v.id === id)!;
      expect(spec).toBeDefined();
      expect(resolveVibe(spec).drumPattern).toEqual(ORIGINAL_VIBE_DRUM_PATTERNS[id]);
    }
  });
```

The `'a vibe does not share array instances with the library'` describe at `:88-96` becomes:

```ts
describe('a vibe does not share array instances with the library', () => {
  test('mutating a resolved row cannot rewrite VIBE_DRUM_GRIDS', () => {
    for (const id of VIBE_IDS) {
      const spec = VIBES.find((v) => v.id === id)!;
      const fresh = drumGridById(spec.drumPatternId)!;
      expect(resolveVibe(spec).drumPattern.kick).not.toBe(fresh.kick);
    }
  });
});
```

Delete `'vibe.drumPattern is itself the resolved library pattern, not a separate literal'` (`:65-70`). Everything else — the seven-row check, the meter-agreement check, the eight-distinct-ids list — keeps its body with `INSTANT_VIBES.find(...)` → `VIBES.find(...)` and `INSTANT_VIBES.map(...)` → `VIBES.map(...)`.

`src/store/instantVibesEffects.test.ts` — replace `:2` and `:4`, rename `:7`, rewrite `:15`, delete `:63-68`:

```ts
import { VIBES } from '../data/vibes';
import { resolveVibe, VIBE_IDS } from './vibes';
import { ORIGINAL_VIBE_EFFECTS } from './instantVibesEffectsFixture';
import { effectChainById } from '../audio/effectChains';
```

```ts
  test('captures exactly the eight vibes', () => {
    expect(Object.keys(ORIGINAL_VIBE_EFFECTS).sort()).toEqual([...VIBE_IDS].sort());
  });

  test('matches the effects block every vibe resolves to', () => {
    for (const id of VIBE_IDS) {
      const spec = VIBES.find((v) => v.id === id)!;
      expect(spec).toBeDefined();
      expect(resolveVibe(spec).effects).toEqual(ORIGINAL_VIBE_EFFECTS[id]);
    }
  });
```

and the last describe (`:86-94`):

```ts
describe('a vibe does not share an object instance with the library', () => {
  test('mutating a resolved effects field cannot rewrite EFFECT_CHAINS', () => {
    for (const id of VIBE_IDS) {
      const spec = VIBES.find((v) => v.id === id)!;
      expect(resolveVibe(spec).effects).not.toBe(effectChainById(spec.effectChainId)!);
    }
  });
});
```

Delete `'vibe.effects is itself the resolved library chain, not a separate literal'` (`:63-68`).

- [ ] **Step 9: Correct the two stale comments the spec names**

`src/store/instantVibesDrumsFixture.ts:5` — the head comment claims it pins *"all 6×7×16 authored cells"*. There are **eight** vibes, and `waltz-brush-three` and `afro-six-eight-bell` are **12** steps, not 16. Replace that clause with:

```
 * is long done; this fixture's ongoing job is to pin all eight vibes' seven
 * rows — 16 steps each in 4/4, 12 in lofi-waltz's 3/4 and afro-six-eight's
 * 6/8 — so `instantVibesDrums.test.ts` fails loudly if a VIBE_DRUM_GRIDS
```

and in the same comment, `VIBE_DRUM_PATTERNS` → `VIBE_DRUM_GRIDS` and `drumPatternById` → `drumGridById`. Do the same table-name corrections in `instantVibesEffectsFixture.ts`'s head comment (`VIBE_EFFECT_CHAINS` → `EFFECT_CHAINS`). **No asserted value in either file changes.**

- [ ] **Step 10: Rename the store test file and sweep its symbols**

`git mv src/store/instantVibes.test.ts src/store/vibes.test.ts`

Replace `:3` with:

```ts
import { VIBES } from '../data/vibes';
import { applyVibeToStore, resolveVibe } from './vibes';

/**
 * Every vibe, resolved once. Most of this file asserts on spec fields, which a
 * ResolvedVibe carries unchanged; the rest applies a vibe, which needs one.
 */
const RESOLVED_VIBES = VIBES.map(resolveVibe);
```

Then two global replacements in the file: `INSTANT_VIBES` → `RESOLVED_VIBES` and `applyInstantVibeToStore` → `applyVibeToStore` (including inside test names and comments). Repoint `:4-6` to `../data/chordRhythms` (`CHORD_RHYTHMS`), `../data/bassPatterns` and `../audio/presetRegistry` if Part 1 has not already, renaming `RHYTHM_PATTERNS` → `CHORD_RHYTHMS` at its use sites. Rename the `:11` test from `'contains all 6 curated genre vibes …'` to `'contains all 8 curated genre vibes with complete presets and feel settings'` — the assertion at `:12` already says 8.

Move the `describe('resolveVibe')` block written in Step 1 into this file if it did not travel with the rename.

- [ ] **Step 11: Repoint the remaining consumers**

`src/store/vibeSynthPresets.test.ts:4` → `import { resolveVibeSynthParams } from './vibes';`. `:39`'s expected message is produced by `resolveVibeSynthParams`, which is unchanged — but its text says `InstantVibe references unknown synth preset id: …`. Change the thrown string in `store/vibes.ts` to `Vibe references unknown synth preset id: ${presetId}` and the expectation to match; `InstantVibe` is not a type any more.

`src/store/customStepSequencer.test.ts` — `:3` becomes two imports, `:85`'s test name and `:89`'s call become `applyVibeToStore`:

```ts
import { VIBES } from '../data/vibes';
import { applyVibeToStore, resolveVibe } from './vibes';
```
```ts
  test('applyVibeToStore returns both modes to preset', () => {
```
```ts
    applyVibeToStore(resolveVibe(VIBES[0]));
```

`src/components/vibeActions.ts` — `:9-10` and both function bodies:

```ts
import type { VibeSpec } from '../data/vibes';
import { applyVibeToStore, resolveVibe } from '../store/vibes';
import { useAppStore } from '../store/store';
import {
  createDraw,
  formatVariationSummary,
  resolveVibeVariation,
  type RerollToast,
} from '../store/vibeVariation';

export function selectVibe(
  vibe: VibeSpec,
  deps: { onToast: (text: string) => void }
): void {
  applyVibeToStore(resolveVibe(vibe));
  deps.onToast(`Loaded ${vibe.name} (${vibe.bpm} BPM · Key ${vibe.scaleRoot} ${vibe.scaleType})`);
}
```

and in `rerollVibe`, the parameter type becomes `VibeSpec`, the resolver call becomes `resolveVibeVariation(resolveVibe(vibe), { scaleRoot, chordRhythmId, bassPatternId }, createDraw(Math.random))`, and the apply becomes `applyVibeToStore(result.vibe)`. Its docblock's two references to `applyInstantVibeToStore` become `applyVibeToStore`. **Both functions stay synchronous** — the async boundary is the module load in the click handler, not these.

`src/components/InstantVibesBar.tsx` — only the dynamic-import plumbing changes in this task (Task 2 does the rest):

```ts
let vibeActionsPromise: Promise<{
  VIBES: import('../data/vibes').VibeSpec[];
  selectVibe: typeof import('./vibeActions').selectVibe;
  rerollVibe: typeof import('./vibeActions').rerollVibe;
}> | null = null;

export function loadVibeActions() {
  if (!vibeActionsPromise) {
    vibeActionsPromise = Promise.all([
      import('./vibeActions'),
      import('../data/vibes'),
    ]).then(([actions, table]) => ({
      VIBES: table.VIBES,
      selectVibe: actions.selectVibe,
      rerollVibe: actions.rerollVibe,
    }));
  }
  return vibeActionsPromise;
}
```

and in `handleSelectVibe` / `handleReroll`, `const { INSTANT_VIBES, … } = await loadVibeActions();` becomes `const { VIBES, … } = await loadVibeActions();` with `VIBES.find((v) => v.id === chip.id)`.

`src/components/InstantVibesBar.test.tsx:3` → `import { VIBES } from '../data/vibes';` plus `import { applyVibeToStore, resolveVibe } from '../store/vibes';`; every `INSTANT_VIBES` → `VIBES`; `:92`'s `applyInstantVibeToStore(vibe)` → `applyVibeToStore(resolveVibe(vibe))`; the comments at `:119` and `:146` name `applyVibeToStore`.

`src/audio/meterRegression.test.ts:20` → `import { VIBES } from '../data/vibes';`; `:149` and `:160` use `VIBES`.

Comment-only edits, four files: `src/store/musicContextSlice.ts:10` and `src/store/loadLoop.ts:27` (`applyInstantVibeToStore` → `applyVibeToStore`); `src/audio/vibeDrumGrids.ts` (the three references to `INSTANT_VIBES`, `applyInstantVibeToStore` and `InstantVibe.drumPattern` — the first becomes *"`resolveVibe` resolves each grid per call"*, since the table no longer resolves anything at module load); `src/audio/effectChains.ts` (`applyInstantVibeToStore` → `applyVibeToStore`); `src/audio/presetRegistry.test.ts` (`InstantVibe.bassPresetId is documented (types.ts:195)` → `VibeSpec.bassPresetId is documented in src/data/vibes.ts` — drop the line number, which was already wrong).

- [ ] **Step 12: Run the tests to verify they pass**

Run: `bun test src/store/vibes.test.ts src/store/instantVibesProgressions.test.ts src/store/instantVibesDrums.test.ts src/store/instantVibesEffects.test.ts src/store/vibeVariation.test.ts`
Expected: PASS, with **no asserted value changed** — only test names, subject expressions and the three deleted tautologies.

Then the gate:

Run: `bun run verify`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add src/data/vibes.ts src/store/vibes.ts src/store/vibes.test.ts src/store/instantVibes.ts src/store/instantVibes.test.ts src/types.ts src/store/vibeVariation.ts src/store/vibeVariation.test.ts src/store/instantVibesProgressions.test.ts src/store/instantVibesDrums.test.ts src/store/instantVibesEffects.test.ts src/store/instantVibesDrumsFixture.ts src/store/instantVibesEffectsFixture.ts src/store/vibeSynthPresets.test.ts src/store/customStepSequencer.test.ts src/store/musicContextSlice.ts src/store/loadLoop.ts src/components/vibeActions.ts src/components/InstantVibesBar.tsx src/components/InstantVibesBar.test.tsx src/audio/meterRegression.test.ts src/audio/vibeDrumGrids.ts src/audio/effectChains.ts src/audio/presetRegistry.test.ts
git commit -m "refactor(store): split InstantVibe into VibeSpec and ResolvedVibe

The vibe table moves to src/data/vibes.ts as pure references and resolution
moves to store/vibes.ts. Every library id is now written once: resolveVibe
produces chords, drumPattern and effects from the ids, in the vibe's own key,
scale and octave, and throws a named error for each of the three.

The three golden fixtures compare resolveVibe(spec) output instead of table
fields. No asserted value changes; each loses only the tautology that asserted
a resolved field equalled its own resolver."
```

---

## Task 2: Delete `vibeChips.ts` and read `VIBES` eagerly

`store/vibeChips.ts:4-10` states its own reason for existing: it *"deliberately duplicates seven fields of INSTANT_VIBES rather than importing it: instantVibes.ts resolves its chords, drum patterns and effect chains at MODULE EVALUATION time, so importing it drags synthPresets.ts, chordProgressions.ts, vibeDrumPatterns.ts and vibeEffectChains.ts into the eagerly-parsed main chunk."* Task 1 removed that cause. `data/vibes.ts` imports nothing at runtime — enforced, not aspirational — so `import { VIBES } from '../data/vibes'` in an always-mounted component pulls in one file with an empty transitive graph.

**The dynamic import stays.** `loadVibeActions` still narrows to `./vibeActions`, which reaches `applyVibeToStore`, `resolveVibe`, `audio/engine`, `playbackEngine` and the four library resolvers — the entire graph the lazy boundary exists to keep out of the eager chunk. **Verified in the source, not assumed:** `vibeActions.ts:1-17` imports `../store/vibes` (which imports `audio/engine`, `playbackEngine`, `presetRegistry`, `chordProgressions`, `vibeDrumGrids`, `effectChains`, `store` and `initialState`) and `../store/vibeVariation`. It narrows from two dynamically-imported modules to one; it does not disappear. The prefetch on idle/hover/focus (`InstantVibesBar.tsx:80-92`) is unchanged.

**Files:**
- Delete: `src/store/vibeChips.ts`, `src/store/vibeChips.test.ts`
- Modify: `src/components/InstantVibesBar.tsx:3,6-35,94-105,132-181`; `src/store/vibes.test.ts` (append the rescued id-uniqueness test)

**Interfaces:**
- Consumes: `VIBES`, `VibeSpec` (`../data/vibes`); `selectVibe`, `rerollVibe` (`./vibeActions`).
- Produces: `loadVibeActions(): Promise<{ selectVibe: …; rerollVibe: … }>` — the `VIBES` key is **removed** from the resolved object. Removed entirely: `VIBE_CHIPS`, `VibeChip`.

**Two facts worth stating, because they are the objections a reviewer will raise:**

- **`VIBE_CHIPS` carries no presentational field.** It is a `VibeChip[]` — an array in the same order as the vibe table, not a `Record`. Its seven fields are `id`, `name`, `emoji`, `bpm`, `scaleRoot`, `scaleType` and `hasVariation`. Six are fields of `VibeSpec` verbatim; the seventh is derived. There is no `color`, `bgGradient`, `borderColor` or `textColor`, so nothing presentational moves into `data/vibes.ts` and the chip's look stays in `InstantVibesBar`'s theme classes.
- **`hasVariation` was never independent data.** `vibeChips.test.ts:19` already computes it as `Boolean(v.variation)`. All eight vibes have a rule today, so the bar's dice renders identically — but deriving it is what keeps that true if a ninth vibe ships without one.

- [ ] **Step 1: Write the failing test**

Append to `src/store/vibes.test.ts` — this is the one assertion worth rescuing from `vibeChips.test.ts:34`:

```ts
describe('the vibe table', () => {
  test('vibe ids are unique', () => {
    expect(new Set(VIBES.map((v) => v.id)).size).toBe(VIBES.length);
  });

  test('no vibe carries a presentational field', () => {
    // The chip's look comes from theme tokens in InstantVibesBar. A colour on
    // a vibe would put a design decision in a content table, where no theme
    // switch can reach it.
    const FORBIDDEN = ['color', 'bgGradient', 'borderColor', 'textColor'];
    for (const spec of VIBES) {
      for (const key of FORBIDDEN) {
        expect(key in spec, `${spec.id} must not carry ${key}`).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Delete `src/store/vibeChips.ts` and `src/store/vibeChips.test.ts` first (`git rm src/store/vibeChips.ts src/store/vibeChips.test.ts`), so the bar's import is broken and the failure is the one this task is about.

Run: `bun test src/components/InstantVibesBar.test.tsx`
Expected: FAIL — `Cannot find module '../store/vibeChips' from '/Users/Pathompong/Sites/Personal/solna/src/components/InstantVibesBar.tsx'`

- [ ] **Step 3: Rewrite `InstantVibesBar.tsx`**

Four named places change, and nowhere else. The rendered markup, the class expressions, `isSelected`, the toasts, the dice spin and the prefetch are untouched.

`:3` — the chip import becomes the table import:

```ts
import { VIBES, type VibeSpec } from '../data/vibes';
```

`:6-35` — the head comment and `loadVibeActions` lose the table:

```ts
/**
 * The two vibe actions, loaded on demand.
 *
 * `VIBES` is imported eagerly above and costs one file: data/vibes.ts imports
 * nothing at runtime, so its transitive graph is empty. What still must not be
 * eager is `./vibeActions`, which reaches applyVibeToStore and from there
 * audio/engine, playbackEngine and the four library resolvers. None of that is
 * needed until a chip is clicked.
 *
 * The promise is cached, so the module is fetched and evaluated at most once.
 */
let vibeActionsPromise: Promise<{
  selectVibe: typeof import('./vibeActions').selectVibe;
  rerollVibe: typeof import('./vibeActions').rerollVibe;
}> | null = null;

export function loadVibeActions() {
  if (!vibeActionsPromise) {
    vibeActionsPromise = import('./vibeActions').then((actions) => ({
      selectVibe: actions.selectVibe,
      rerollVibe: actions.rerollVibe,
    }));
  }
  return vibeActionsPromise;
}
```

`:94-105` — both handlers take the vibe itself, so the lookup and its guard go. Removing that `.find` also removes a real silent-failure path: a chip whose id matched no vibe did nothing at all when clicked.

```ts
  const handleSelectVibe = async (vibe: VibeSpec) => {
    const { selectVibe } = await loadVibeActions();
    selectVibe(vibe, { onToast: (text) => setToast({ kind: 'load', text }) });
    scheduleToastClear(3000);
  };

  const handleReroll = async (vibe: VibeSpec) => {
    const { rerollVibe } = await loadVibeActions();
    setRollingVibeId(vibe.id);
    try {
      rerollVibe(vibe, { onToast: (t) => setToast({ kind: 'reroll', ...t }) });
      // 400 ms of spin, then the icon settles; the toast holds longer because
      // its second line has more to read than the load toast's one.
      scheduleToastClear(4000);
    } finally {
      // Robust to rerollVibe throwing: the spin must stop either way, or the
      // dice would spin forever.
      scheduleTimeout(spinTimerRef, () => setRollingVibeId(null), 400);
    }
  };
```

`:132-181` — the map source and the derived dice flag. Three edits inside the map: `{VIBE_CHIPS.map((vibe) => {` becomes `{VIBES.map((vibe) => {`, and the two reads of `vibe.hasVariation` (at the `join-item` class expression and at the `if (!isSelected || !vibe.hasVariation)` early return) become `!!vibe.variation`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/components/InstantVibesBar.test.tsx src/store/vibes.test.ts`
Expected: PASS. `InstantVibesBar.test.tsx:49-56` iterates the table and asserts a `btn-vibe-<id>` element per vibe; it must still pass unchanged, which is the proof that the bar renders the same eight chips from one table that it rendered from two.

Run: `bun run verify`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A src/store/vibeChips.ts src/store/vibeChips.test.ts src/components/InstantVibesBar.tsx src/store/vibes.test.ts
git commit -m "refactor(components): delete vibeChips and read VIBES eagerly

vibeChips.ts existed only because the old vibe table resolved its chords, drum
grid and effect chain at module-evaluation time, so importing it dragged four
library modules into the eager chunk. A VibeSpec resolves nothing and
src/data/ imports nothing, so the bar reads the table directly and hasVariation
becomes !!vibe.random's predecessor, !!vibe.variation.

The dynamic import of ./vibeActions stays: it still reaches applyVibeToStore
and the engine. Id uniqueness moves to the vibe-table suite; the three tests
that pinned the duplicate against its original are deleted."
```

**Note for the implementer:** the commit body above says *"hasVariation becomes !!vibe.random's predecessor, !!vibe.variation"* because Task 3 renames the field one commit later. If you prefer, write simply *"hasVariation becomes derived from the variation rule"* — do not write `!!vibe.random`, which is not true until Task 3.

---

## Task 3: Per-vibe dice pools; delete the genre mechanism

`VibeVariation.progressionIds` is data whose only legal value is the output of a rule — `vibeVariation.test.ts`'s `'progressionIds equals the full genre-and-scale-length filter'` recomputes it and demands the array match. Adding one progression to the library and tagging it `lofi` silently changes what two vibes can roll, and the test then demands unrelated vibes be edited. This task reverses that: each vibe carries its own explicit arrays, and the two properties the filter used to give for free become invariants that name the property directly.

**Three claims behind the reversal, each verified against the source:**

1. **`variation.genre` has zero runtime consumers.** `resolveVibeVariation` draws from `rule.progressionIds` directly and never reads `rule.genre`. The field exists only to make the invariant test computable.
2. **`ChordProgression.genres` has no runtime consumer either.** Every `.genres` reference in `src/` outside a test is the declaration itself. The UI's availability filter, `components/loop/chord/progressionAvailability.ts`, uses `minScaleLength` and nothing else.
3. **The two new guards are behaviour-preserving today, and the suite proves it transitively.** `audio/chordProgressions.test.ts:75-81` asserts `p.referenceScale === VIBE_GENRE_SCALES[genre]` for every tag and `vibeVariation.test.ts:198-202` asserts `v.scaleType === VIBE_GENRE_SCALES[v.variation.genre]`; both are green, so `referenceScale === vibe.scaleType` already holds for every pooled progression. **Measured directly as well**, by evaluating the table rather than grepping it: all eight vibes pass both new guards with zero violations, and all eight already contain their own `progressionId` in their pool.

**Files:**
- Modify: `src/data/vibes.ts` (the `VibeSpec` shape, the new `VibeRandomRule`, and the eight `variation` blocks); `src/types.ts:2-11` (delete `VibeGenre`), `:248-262` (delete `VibeVariation`); `src/data/chordProgressions.ts` (`genres: string[]`); `src/audio/chordProgressions.ts` (delete `VIBE_GENRE_SCALES` and the `VibeGenre` re-export); `src/audio/chordProgressions.test.ts:1-19,74-177`; `src/store/vibeVariation.ts:184-240`; `src/store/vibeVariation.test.ts:137-295,542`; `src/components/InstantVibesBar.tsx` (two reads of `vibe.variation`)

**Interfaces:**
- Consumes: `SCALES` (`@/data/scales`); `CHORD_PROGRESSIONS`, `ChordProgression` (`@/data/chordProgressions`); `CHORD_RHYTHMS` (`@/data/chordRhythms`); `BASS_PATTERNS` (`@/data/bassPatterns`); `ROOTS` (`@/utils/musicTheory`); `DrumDecorationRule` (type, `@/types`).
- Produces, from `@/data/vibes`:
  - `interface VibeRandomRule { keys: string[]; bpm: [number, number]; progressions: string[]; chordRhythms: string[]; bassPatterns: string[]; drumDecoration: DrumDecorationRule }`
  - `VibeSpec.random?: VibeRandomRule` — replaces `variation?: VibeVariation`
- Removed: `VibeGenre` and `VibeVariation` from `src/types.ts`; `VIBE_GENRE_SCALES` and the `export type { VibeGenre }` re-export from `@/audio/chordProgressions`.
- Changed: `ChordProgression.genres` is `string[]`, free-form, with **nothing computing from it**.

**Design notes for the implementer:**

- **Copy today's arrays verbatim.** This is a rename of five field names and the deletion of a sixth. No id joins or leaves any pool. If a pool's contents change, the change is wrong.
- **A one-member array is legitimate** and states "this axis is deliberately fixed" in the same shape as every other axis. The `>= 4` floor is deleted with the filter. (Nothing today has a one-member pool; the smallest is 2.)
- **`ChordProgression.genres` stays as a free-form `string[]`** for human browsing — the survey script groups by it and a tag like `lofi` is useful when choosing what to pool. Say in the doc comment that nothing computes from it, because a `string[]` that once drove a filter will otherwise be assumed to still drive one.
- **`DrumDecorationRule`, `DecorationLayer` and `DensityName` stay in `src/types.ts`.** They describe what the *reroll engine* can draw, not what a vibe is, and `vibeVariation.ts` reads them independently of the vibe table. `data/vibes.ts` type-imports `DrumDecorationRule`, which the `src/data/` import ban permits.

- [ ] **Step 1: Write the failing tests**

In `src/store/vibeVariation.test.ts`, replace the whole `describe('authored variation data')` block's pool section. Delete `VIBE_GENRE_SCALES` from the `:139` import and add `SCALES` from `../data/scales` (it is re-exported by `utils/musicTheory` too; import from the table). The replacement:

```ts
describe('authored random data', () => {
  test('every vibe ships a random rule', () => {
    for (const v of RESOLVED_VIBES) {
      expect(v.random).toBeDefined();
    }
  });

  test('the dice can always land back on the vibe as authored', () => {
    for (const v of RESOLVED_VIBES) {
      const r = v.random!;
      expect(r.keys).toContain(v.scaleRoot);
      expect(r.bpm[0]).toBeLessThanOrEqual(r.bpm[1]);
      expect(v.bpm).toBeGreaterThanOrEqual(r.bpm[0]);
      expect(v.bpm).toBeLessThanOrEqual(r.bpm[1]);
      expect(r.chordRhythms).toContain(v.chordRhythmId);
      expect(r.bassPatterns).toContain(v.bassPatternId);
      // The axis the derived filter used to cover for free.
      expect(r.progressions).toContain(v.progressionId);
    }
  });

  test('every id in every pool resolves', () => {
    for (const v of RESOLVED_VIBES) {
      const r = v.random!;
      for (const root of r.keys) expect(ROOTS).toContain(root);
      for (const id of r.chordRhythms) {
        expect(CHORD_RHYTHMS.some((p) => p.id === id)).toBe(true);
      }
      for (const id of r.bassPatterns) {
        expect(BASS_PATTERNS.some((p) => p.id === id)).toBe(true);
      }
      for (const id of r.progressions) {
        expect(CHORD_PROGRESSIONS.some((p) => p.id === id), `${v.id}/${id}`).toBe(true);
      }
    }
  });

  // Guard 1, replacing half of the deleted genre filter. The filter dropped a
  // too-long progression SILENTLY; this fails the build. It matters most for
  // asian-zen (Hirajoshi, 5 degrees), where a 7-degree progression would
  // otherwise vanish from the pool with no signal at all.
  test('every pooled progression fits the vibe\'s scale', () => {
    for (const v of RESOLVED_VIBES) {
      const degrees = SCALES[v.scaleType].intervals.length;
      for (const id of v.random!.progressions) {
        const p = CHORD_PROGRESSIONS.find((c) => c.id === id)!;
        expect(p.minScaleLength, `${v.id}/${id}`).toBeLessThanOrEqual(degrees);
      }
    }
  });

  // Guard 2, replacing the other half. This is strictly more direct than
  // `referenceScale === VIBE_GENRE_SCALES[genre]`: it names the property that
  // actually matters — the progression was authored against the scale the
  // vibe plays — instead of routing it through a genre table.
  test('every pooled progression was authored against the vibe\'s own scale', () => {
    for (const v of RESOLVED_VIBES) {
      for (const id of v.random!.progressions) {
        const p = CHORD_PROGRESSIONS.find((c) => c.id === id)!;
        expect(p.referenceScale, `${v.id}/${id}`).toBe(v.scaleType);
      }
    }
  });

  test('every pool is non-empty and free of duplicates', () => {
    for (const v of RESOLVED_VIBES) {
      const r = v.random!;
      const pools = [r.keys, r.chordRhythms, r.bassPatterns, r.progressions];
      for (const pool of pools) {
        expect(pool.length).toBeGreaterThan(0);
        expect(new Set(pool).size).toBe(pool.length);
      }
    }
  });
```

Delete outright, from the same describe: `'the vibe genre and its scale type agree with B1 VIBE_GENRE_SCALES'` and `'progressionIds equals the full genre-and-scale-length filter'`. Delete the local `scaleLength` helper at `:143-145` — the two new guards read `SCALES[v.scaleType].intervals.length` directly, and the helper's `?? 7` fallback would hide a typo'd `scaleType`.

In the rest of the file, rename every remaining `variation` read to `random`: `:236` and `:246` (`v.variation!.drumDecoration`), `:262`, `:281` (`v.variation!.drumDecoration.densities`), and `:542`'s `{ ...RESOLVED_VIBES[0], variation: undefined }` → `random: undefined`. Rename the describe at `:234`'s test name from *"every layer the variation can draw"* to *"every layer the random rule can draw"*.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/store/vibeVariation.test.ts`
Expected: FAIL — `TypeError: undefined is not an object (evaluating 'v.random.keys')`, from `'the dice can always land back on the vibe as authored'`, plus a type error on `random` from `bun run lint`.

- [ ] **Step 3: Rename the rule in `src/data/vibes.ts`**

Declare the rule in the table's own file — it is part of the vibe's shape, and `data/` is allowed to declare types:

```ts
import type { DrumDecorationRule, FilterType, MeterId, PadInterval, PadMode, PadVoicing } from '@/types';

/**
 * What the dice may reroll, per vibe.
 *
 * Every pool is written out explicitly. It used to be derived — `progressions`
 * was pinned to the complete genre-and-scale-length filter over
 * CHORD_PROGRESSIONS — which meant adding one progression to the shared
 * library silently changed what two unrelated vibes could roll, and a test then
 * demanded those vibes be edited to match. A pool is a taste decision about ONE
 * vibe, so it lives on that vibe.
 *
 * The accepted cost: a pool can go stale as the library grows. The mitigation
 * is `bun run report:library`, which lists unreferenced entries and always
 * exits 0 — an unused library entry is a fact about the content, not a defect.
 *
 * A ONE-MEMBER ARRAY IS LEGITIMATE. It says "this axis is deliberately fixed"
 * in the same shape as every other axis. Note that `pickDistinct` falls back to
 * the current value when it is the sole member, so such an axis stops rerolling
 * — which is what a one-member pool means.
 */
export interface VibeRandomRule {
  /** Roots that suit the vibe. The dice picks one. Always contains scaleRoot. */
  keys: string[];
  /** Inclusive [min, max] integer BPM. Always contains the vibe's own bpm. */
  bpm: [number, number];
  /**
   * Ids into CHORD_PROGRESSIONS. Always contains the vibe's own progressionId.
   * Two invariants hold for every member: `minScaleLength <=
   * SCALES[scaleType].intervals.length`, and `referenceScale === scaleType`.
   */
  progressions: string[];
  /** Ids into CHORD_RHYTHMS. Always contains the vibe's own chordRhythmId. */
  chordRhythms: string[];
  /** Ids into BASS_PATTERNS. Always contains the vibe's own bassPatternId. */
  bassPatterns: string[];
  drumDecoration: DrumDecorationRule;
}
```

and in `VibeSpec`, replace the `variation` field:

```ts
  /** What the dice may reroll. Optional — a vibe without one shows no dice. */
  random?: VibeRandomRule;
```

Drop `VibeVariation` from the file's `import type` list.

Then, in each of the eight entries, apply exactly these six edits inside the rule literal:

| today | after |
|---|---|
| `variation: {` | `random: {` |
| `genre: '…',` | *delete the line* |
| `keyPool:` | `keys:` |
| `bpmRange:` | `bpm:` |
| `progressionIds:` | `progressions:` |
| `rhythmIds:` | `chordRhythms:` |
| `bassPatternIds:` | `bassPatterns:` |
| `drumDecoration:` | unchanged |

**Every array's contents stay byte-identical.** For reference, the eight `progressions` pools after the rename are exactly:

```
lofi-chill      ['jazz-ii-v-i-vi','jazz-neosoul-butter','lofi-coffeehouse','lofi-bedroom-pop','lofi-rainy-window','lofi-tape-loop','lofi-morning-turnaround']
synthwave-80s   ['pop-club-house','cine-epic-ostinato','synthwave-midnight-drive','synthwave-neon-horizon']
cyber-dance     ['pop-club-house','edm-cyber-drop','edm-neon-rise','edm-arena-sweep','edm-cyber-vamp']
ambient-chill   ['ambient-still-water','ambient-lydian-drift','ambient-open-fourths','ambient-glass-horizon','ambient-lydian-halo']
hiphop-groove   ['cine-dorian-voyage','boombap-dusty-ii-v','boombap-crate-dig','boombap-head-nod','boombap-soul-piano']
asian-zen       ['zen-bamboo-vamp','zen-moonlit-koto','zen-still-pond','zen-temple-bell']
lofi-waltz      ['jazz-ii-v-i-vi','jazz-neosoul-butter','lofi-coffeehouse','lofi-bedroom-pop','lofi-rainy-window','lofi-tape-loop','lofi-morning-turnaround']
afro-six-eight  ['cine-dorian-voyage','boombap-dusty-ii-v','boombap-crate-dig','boombap-head-nod','boombap-soul-piano']
```

The comments above `keyPool` in `lofi-chill`, `synthwave-80s`, `cyber-dance`, `ambient-chill`, `hiphop-groove` and `asian-zen` explain acoustic and taste choices about the key range. **Keep every one of them verbatim**, above the renamed `keys` field.

- [ ] **Step 4: Delete `VibeGenre`, `VibeVariation` and `VIBE_GENRE_SCALES`**

`src/types.ts` — delete `:2-11` (the `VibeGenre` docblock and its declaration) and `:248-262` (the whole `export interface VibeVariation { … }`). `DrumDecorationRule` at `:232-246`, `DecorationLayer` and `DensityName` all stay.

`src/data/chordProgressions.ts` — the `genres` field becomes free-form, and the file's `import type { VibeGenre } from '@/types'` goes:

```ts
  /**
   * Free-form tags for human browsing — "which shelf would I look on for this".
   * NOTHING COMPUTES FROM THIS. It used to drive each vibe's dice pool through
   * a closed `VibeGenre` union plus a VIBE_GENRE_SCALES anchor table; a vibe
   * now names its own progressions, so a tag here constrains nothing and adding
   * one requires no edit anywhere else.
   */
  genres: string[];
```

`src/audio/chordProgressions.ts` — delete the `VIBE_GENRE_SCALES` table and the `export type { VibeGenre } from '../types'` re-export.

`src/audio/chordProgressions.test.ts` — delete `:9` (`import type { VibeGenre }`), `:16` (`const GENRES`), `:18-19` (`idsFor`), `VIBE_GENRE_SCALES` from the `:3-8` import block, and the whole `describe('genre tagging')` at `:74-137` (all three tests: `'a genre tag is only used on its own scale'`, `'every genre has at least four progressions'`, `'the exact tagged set per genre is authored, not inferred'`). All three compute from `p.genres` and `VIBE_GENRE_SCALES`; with `genres` constraining nothing they assert properties of a tag that no longer has meaning.

Rewrite the four tests in `describe('genre conventions from the research')` (`:139-177`) against **explicit id lists**, so they keep pinning the real musical conventions of the authored content without reading `genres`. Add above the describe:

```ts
// The tagged sets as authored today, written out. They used to be computed
// from `genres`; that tag no longer constrains anything, so the conventions
// below name the entries they are about. Adding a progression does not oblige
// you to add it here — these pin conventions, not coverage.
const EDM_IDS = ['pop-club-house', 'edm-cyber-drop', 'edm-neon-rise', 'edm-arena-sweep', 'edm-cyber-vamp'];
const AMBIENT_IDS = ['ambient-still-water', 'ambient-lydian-drift', 'ambient-open-fourths', 'ambient-glass-horizon', 'ambient-lydian-halo'];
const EXTENSION_IDS = [
  'jazz-ii-v-i-vi', 'jazz-neosoul-butter', 'lofi-coffeehouse', 'lofi-bedroom-pop',
  'lofi-rainy-window', 'lofi-tape-loop', 'lofi-morning-turnaround',
  'cine-dorian-voyage', 'boombap-dusty-ii-v', 'boombap-crate-dig',
  'boombap-head-nod', 'boombap-soul-piano',
];
const ZEN_IDS = ['zen-bamboo-vamp', 'zen-moonlit-koto', 'zen-still-pond', 'zen-temple-bell'];

const byIds = (ids: string[]) => ids.map((id) => progressionById(id)!);
```

and replace each test's selector, leaving every assertion body untouched:

- `:143` `const edm = CHORD_PROGRESSIONS.filter((p) => p.genres.includes('edm'));` → `const edm = byIds(EDM_IDS);`
- `:151` `for (const p of CHORD_PROGRESSIONS.filter((x) => x.genres.includes('ambient')))` → `for (const p of byIds(AMBIENT_IDS))`
- `:160-163` the lofi/boombap loop → `for (const p of byIds(EXTENSION_IDS)) { for (const step of p.steps) { … } }`, dropping the `if (!p.genres.includes(…)) continue;` line
- `:171` `for (const p of CHORD_PROGRESSIONS.filter((x) => x.genres.includes('zen')))` → `for (const p of byIds(ZEN_IDS))`

Rename the describe from `'genre conventions from the research'` to `'authoring conventions from the research'`.

- [ ] **Step 5: Repoint `store/vibeVariation.ts`**

Four lines inside `resolveVibeVariation`, and its `rule` lookup:

```ts
  const rule = vibe.random;
  if (!rule) {
    throw new Error(`Vibe "${vibe.id}" has no random rule and cannot be rerolled`);
  }

  const scaleRoot = draw.pickDistinct(rule.keys, current.scaleRoot);
  const bpm = draw.int(rule.bpm[0], rule.bpm[1]);
  const chordRhythmId = draw.pickDistinct(rule.chordRhythms, current.chordRhythmId);
  const bassPatternId = draw.pickDistinct(rule.bassPatterns, current.bassPatternId);

  const progressionId = draw.pick(rule.progressions);
```

Draw order is unchanged, so every scripted-draw test still passes with the same script. Update the file's `:1` import (drop `DrumDecorationRule`'s siblings only if unused) and `:169`'s docblock line *"in the same genre"* → *"from its own pools"*. The `'has no variation rule'` message in `vibeVariation.test.ts` (the `random: undefined` case at `:542`) must be updated to match the new text.

- [ ] **Step 6: Repoint `InstantVibesBar.tsx`**

Two reads: the `join-item` class expression and the `if (!isSelected || !vibe.hasVariation)` early return, both written as `!!vibe.variation` by Task 2, become `!!vibe.random`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/store/vibeVariation.test.ts src/audio/chordProgressions.test.ts src/store/vibes.test.ts`
Expected: PASS. The two new guards pass with zero violations across all eight vibes — measured before this plan was written, by evaluating the table.

Run: `bun run verify`
Expected: PASS

- [ ] **Step 8: Mutation-check the two new guards**

Neither guard is worth anything if it cannot fail. Do both, and revert both.

1. In `src/data/vibes.ts`, add `'pop-i-v-vi-iv'` (Major, `minScaleLength: 7`) to `asian-zen`'s `random.progressions`.
   Run: `bun test -t "every pooled progression fits the vibe's scale"`
   Expected: FAIL with `asian-zen/pop-i-v-vi-iv` in the message — Hirajoshi has 5 degrees.
   Revert the edit.
2. Add `'pop-i-v-vi-iv'` to `hiphop-groove`'s `random.progressions` (Dorian, 7 degrees — guard 1 passes).
   Run: `bun test -t "every pooled progression was authored against the vibe's own scale"`
   Expected: FAIL with `hiphop-groove/pop-i-v-vi-iv`, `expected 'Dorian', received 'Major'`.
   Revert the edit.
   Run: `bun test src/store/vibeVariation.test.ts`
   Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/data/vibes.ts src/types.ts src/data/chordProgressions.ts src/audio/chordProgressions.ts src/audio/chordProgressions.test.ts src/store/vibeVariation.ts src/store/vibeVariation.test.ts src/components/InstantVibesBar.tsx
git commit -m "refactor(store): make the dice pool per-vibe data, delete VibeGenre

variation becomes random, and its fields say what they hold: keys, bpm,
progressions, chordRhythms, bassPatterns, drumDecoration. Every array is
written out explicitly with today's contents, byte for byte.

progressionIds used to be pinned to the complete genre-and-scale-length filter
over CHORD_PROGRESSIONS, so a shared-library edit reached into vibes that did
not ask for it. VibeGenre, VIBE_GENRE_SCALES and variation.genre are deleted;
ChordProgression.genres stays as a free-form string[] that nothing computes
from. Two invariants replace the filter, and both are louder than it was: a
pooled progression must fit the vibe's scale length and must have been authored
against the vibe's own scale. A third pins progressions contains the vibe's own
progressionId, which the filter used to cover for free."
```

---

## Task 4: The library-coverage report

Explicit pools have one accepted cost: **they can go stale as the library grows.** Add a progression today and the lo-fi vibes used to pick it up automatically; after Task 3 they do not. That is the intended trade — a shared-library edit no longer reaches into vibes that did not ask for it — but it means a new entry can sit unreferenced forever.

**The mitigation is a report, not an assertion**, and the distinction is the whole design. The script **exits 0 always** and is deliberately **not** part of `bun run verify`: an unused library entry is a fact about the content, not a defect. A progression may exist for the chord preset browser and never suit any vibe; asserting on the count would make the library's growth depend on the vibes' appetite for it, which is the coupling Task 3 exists to remove.

**Files:**
- Create: `scripts/report-library-coverage.ts`
- Modify: `package.json:6-15` (add `report:library`; `verify` unchanged)

**Interfaces:**
- Consumes: `VIBES` (`../src/data/vibes.ts`); `CHORD_PROGRESSIONS` (`../src/data/chordProgressions.ts`); `CHORD_RHYTHMS` (`../src/data/chordRhythms.ts`); `BASS_PATTERNS` (`../src/data/bassPatterns.ts`); `VIBE_DRUM_GRIDS` (`../src/data/vibeDrumGrids.ts`); `EFFECT_CHAINS` (`../src/data/effectChains.ts`); `SYNTH_PRESETS` (`../src/data/synthPresets.ts`).
- Produces: `bun run report:library`, a console report. No exported symbol, no exit code other than 0.

**Design note:** the script imports only `src/data/` modules, which import nothing at runtime, so it needs no `AudioContext`, no store and no DOM. That is a side benefit of Part 1 worth knowing: a content report is a pure function of the tables.

- [ ] **Step 1: Write the script**

Create `scripts/report-library-coverage.ts`:

```ts
/**
 * Which library entries no vibe references.
 *
 *   bun run report:library
 *
 * A REPORT, NOT AN ASSERTION. It always exits 0 and is deliberately not part
 * of `bun run verify`. An unreferenced entry is a fact about the content, not
 * a defect: a progression may exist for the chord preset browser and never
 * suit any vibe. Asserting on the count would make the library's growth depend
 * on the vibes' appetite for it — the exact coupling that deleting the derived
 * genre pool was meant to remove.
 *
 * It exists because explicit per-vibe pools have one accepted cost: a new
 * library entry no longer joins a pool automatically, so it can sit unused
 * forever with nothing saying so. This is the thing that says so.
 */
import { VIBES } from '../src/data/vibes.ts';
import { CHORD_PROGRESSIONS } from '../src/data/chordProgressions.ts';
import { CHORD_RHYTHMS } from '../src/data/chordRhythms.ts';
import { BASS_PATTERNS } from '../src/data/bassPatterns.ts';
import { VIBE_DRUM_GRIDS } from '../src/data/vibeDrumGrids.ts';
import { EFFECT_CHAINS } from '../src/data/effectChains.ts';
import { SYNTH_PRESETS } from '../src/data/synthPresets.ts';

const referenced = {
  progressions: new Set<string>(),
  chordRhythms: new Set<string>(),
  bassPatterns: new Set<string>(),
  drumGrids: new Set<string>(),
  effectChains: new Set<string>(),
  synthPresets: new Set<string>(),
};

for (const v of VIBES) {
  referenced.progressions.add(v.progressionId);
  referenced.chordRhythms.add(v.chordRhythmId);
  referenced.bassPatterns.add(v.bassPatternId);
  referenced.drumGrids.add(v.drumPatternId);
  referenced.effectChains.add(v.effectChainId);
  referenced.synthPresets.add(v.synthPresetId);
  referenced.synthPresets.add(v.chordPresetId);
  referenced.synthPresets.add(v.bassPresetId);
  if (v.pad) referenced.synthPresets.add(v.pad.presetId);
  const r = v.random;
  if (!r) continue;
  for (const id of r.progressions) referenced.progressions.add(id);
  for (const id of r.chordRhythms) referenced.chordRhythms.add(id);
  for (const id of r.bassPatterns) referenced.bassPatterns.add(id);
}

function report(label: string, allIds: string[], used: Set<string>): void {
  const unused = allIds.filter((id) => !used.has(id));
  const head = `${label.padEnd(18)} ${String(allIds.length - unused.length).padStart(3)}/${String(allIds.length).padEnd(3)} referenced`;
  if (unused.length === 0) {
    console.log(`${head}   (all)`);
    return;
  }
  console.log(`${head}   ${unused.length} unreferenced:`);
  for (const id of unused) console.log(`    ${id}`);
}

console.log('Library entries no Instant Vibe references.');
console.log('A report, not a check — this always exits 0.\n');

report('progressions', CHORD_PROGRESSIONS.map((p) => p.id), referenced.progressions);
report('chord rhythms', CHORD_RHYTHMS.map((p) => p.id), referenced.chordRhythms);
report('bass patterns', BASS_PATTERNS.map((p) => p.id), referenced.bassPatterns);
report('vibe drum grids', Object.keys(VIBE_DRUM_GRIDS), referenced.drumGrids);
report('effect chains', Object.keys(EFFECT_CHAINS), referenced.effectChains);
report('synth presets', SYNTH_PRESETS.map((p) => p.id), referenced.synthPresets);

console.log('\nUnreferenced is not wrong. The chord preset browser, the sequencer');
console.log('genre picker and the synth preset library all read these tables too.');
```

- [ ] **Step 2: Wire it into `package.json`**

Add one line to `package.json`'s `scripts`, after `check:drums` and before `verify`. **`verify` itself does not change.**

```json
    "check:drums": "bun scripts/check-drum-kit-separation.ts",
    "report:library": "bun scripts/report-library-coverage.ts",
    "verify": "bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build"
```

- [ ] **Step 3: Run it and read the output**

Run: `bun run report:library`
Expected: exit 0, six lines plus their unreferenced lists. Sanity checks against the tables as they stand: `vibe drum grids` reports **8/8 referenced (all)** — every grid belongs to exactly one vibe; `effect chains` reports **6/6 (all)** — `lofi-waltz` reuses `lofi-chill`'s and `afro-six-eight` reuses `hiphop-groove`'s; `progressions` reports **29/44** referenced with 15 unreferenced, among them `pop-i-v-vi-iv`, `blues-12bar`, `jpop-royal-road` and `baroque-canon`, which exist for the chord preset browser.

Run: `echo $?`
Expected: `0`

- [ ] **Step 4: Confirm the gate is unchanged**

Run: `bun run verify`
Expected: PASS, and **`report:library` does not appear in its output** — it is not in the chain.

- [ ] **Step 5: Commit**

```bash
git add scripts/report-library-coverage.ts package.json
git commit -m "chore(scripts): report library entries no vibe references

Explicit per-vibe pools mean a new library entry no longer joins a pool
automatically, so it can sit unused with nothing saying so. This says so. It
exits 0 always and is deliberately outside bun run verify: an unreferenced
entry is a fact about the content, not a defect, and asserting on it would
make the library's growth depend on the vibes' appetite for it."
```

---

## Task 5: Realign the four drifting vibe ids, and delete the three false claims

Four vibe ids use different words from their display names. Each pairing below was read out of `src/store/vibeChips.ts:33-36` before Task 2 deleted it, and cross-checked against the vibe literal:

| id today | display name | id after |
|---|---|---|
| `cyber-dance` | Cyber EDM | `cyber-edm` |
| `ambient-chill` | Deep Ambient | `deep-ambient` |
| `hiphop-groove` | Boom Bap | `boom-bap` |
| `asian-zen` | Zen Garden | `zen-garden` |

The other four already agree and are **untouched**: `lofi-chill` / "Lo-Fi Chill", `synthwave-80s` / "Synthwave 80s", `lofi-waltz` / "Lo-Fi Waltz", `afro-six-eight` / "Afro 6/8".

**Why this is safe, stated as intent rather than as a discovery.** Applying a vibe is a one-shot write: it applies every preset at once, and from that moment the user is editing individual modules. A vibe is a *starting position*, not a *setting*, so the file format deliberately declines to record it. Three things in the source follow from that intent, all verified:

- `PROJECT_CONTENT_KEYS` is `['bpm', 'meterId', 'masterVolume', 'effects', 'loops']` (`projectFormat.ts:42`). **No vibe id is in a `.solna` body**, and the content set is a closed list, so this is enforced rather than merely true today.
- `projectFormat.ts:71-72` says it in the docblock — *"`selectedVibeId` → null (a project has no vibe until a chip is pressed)"* — and `applyProjectContent` writes that `null` explicitly at `:85`. Opening a project does not merely fail to restore a vibe; it actively clears one.
- The only place a vibe id persists at all is `selectedVibeId` in `partializeAppState` (`store.ts:160`), a `localStorage` field whose sole consumer is the `isSelected` highlight in `InstantVibesBar`.

**So the whole cost of this rename is one stale `localStorage` string leaving one chip un-highlighted until the user clicks a chip.** `store.ts:224-225` already deletes a non-string `selectedVibeId`, and an unknown string simply matches no chip. No migration, no `.solna` change, no persist `version` bump, no `formatVersion` bump. Nothing user-visible changes: all four display names, emoji, BPMs and keys stay exactly as they are.

**No derived id rule is available, and this task must not add one.** After the rename, five of the eight ids are the plain kebab-case of their names and three are not: `lofi-chill` and `lofi-waltz` drop the internal hyphen of "Lo-Fi" (kebab would give `lo-fi-chill`), and `afro-six-eight` spells out the digits of "Afro 6/8" (kebab would give `afro-6-8`). Those three are id-spelling conventions, not drift. The rename removes the *documented exception*; it does not create a rule to enforce in its place. **Assert uniqueness and nothing more.**

**Files:**
- Modify: `src/data/vibes.ts` (four `id:` values); `src/store/instantVibesChordsFixture.ts` (four record keys); `src/store/instantVibesDrumsFixture.ts` (four keys); `src/store/instantVibesEffectsFixture.ts` (four keys); `src/store/instantVibesEffects.test.ts` (the `distortionVibeIds` list and one describe name); `src/store/vibes.test.ts` (the preset matrix, the id list and its test name, three `.find` lookups, one `byId` pair); `src/store/vibeVariation.test.ts` (three `vibe('hiphop-groove')` call sites and one comment); `src/audio/meterRegression.test.ts` (`FOUR_FOUR_VIBE_IDS`); `CLAUDE.md:122-125`; `docs/design.md:138,140-151`

**Interfaces:**
- Consumes: `VIBES`, `VIBE_IDS` — unchanged in shape; four of the eight strings change.
- Produces: nothing new. `VIBE_IDS` becomes `['lofi-chill', 'synthwave-80s', 'cyber-edm', 'deep-ambient', 'boom-bap', 'zen-garden', 'lofi-waltz', 'afro-six-eight']`.

- [ ] **Step 1: Write the failing test**

In `src/store/vibes.test.ts`, add `VIBE_IDS` to the `./vibes` import (`import { applyVibeToStore, resolveVibe, VIBE_IDS } from './vibes';`), then replace the test named `'the eight vibe ids are unchanged — they are persisted in project files'` — **the name states a false claim** (see the three sites deleted in Step 5) — with:

```ts
  test('the eight vibe ids match their display names, and are unique', () => {
    expect(VIBES.map((v) => v.id)).toEqual([
      'lofi-chill',
      'synthwave-80s',
      'cyber-edm',
      'deep-ambient',
      'boom-bap',
      'zen-garden',
      'lofi-waltz',
      'afro-six-eight',
    ]);
    expect(new Set(VIBE_IDS).size).toBe(VIBE_IDS.length);
    // Deliberately NOT an id-derives-from-name check. Three of the eight would
    // fail one for reasons that are correct: lofi-chill and lofi-waltz drop the
    // internal hyphen of "Lo-Fi", and afro-six-eight spells out the digits of
    // "Afro 6/8". Those are id-spelling conventions, not drift.
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test -t "the eight vibe ids match their display names"`
Expected: FAIL — the received array still holds `'cyber-dance'`, `'ambient-chill'`, `'hiphop-groove'`, `'asian-zen'` at indices 2, 3, 4 and 5.

- [ ] **Step 3: Rename the four ids in the table**

In `src/data/vibes.ts`, change exactly four `id:` values — `cyber-dance` → `cyber-edm`, `ambient-chill` → `deep-ambient`, `hiphop-groove` → `boom-bap`, `asian-zen` → `zen-garden`. Every other field of those four entries, including the six inline `// <old-id>` comments above each `random` block, is either unchanged or, for those comments, updated to the new id.

Run: `bun test src/store`
Expected: FAIL, and **the failures are only key-set mismatches naming the four old ids** in the three fixture suites plus the id lists below. That is the fixtures doing their job: because they already compare `resolveVibe(spec)` output rather than table fields (Task 1), a red fixture here can only mean "an id changed" — which is exactly why this task comes after Task 1 and not before it.

- [ ] **Step 4: Follow the ids through the fixtures and tests**

The three fixture **data** modules are keyed by vibe id. Rename four record keys in each, and **change no value**:

- `src/store/instantVibesChordsFixture.ts` — `'cyber-dance':` → `'cyber-edm':`, `'ambient-chill':` → `'deep-ambient':`, `'hiphop-groove':` → `'boom-bap':`, `'asian-zen':` → `'zen-garden':`
- `src/store/instantVibesDrumsFixture.ts` — the same four keys
- `src/store/instantVibesEffectsFixture.ts` — the same four keys

They still import nothing from `VIBES`, `resolveVibe` or any library, and they must not start.

Then, in test files:

- `src/store/instantVibesEffects.test.ts` — `const distortionVibeIds = ['synthwave-80s', 'cyber-dance'];` → `['synthwave-80s', 'cyber-edm']`, the test name `'exactly synthwave-80s and cyber-dance carry distortionWet'` → `'exactly synthwave-80s and cyber-edm carry distortionWet'`, and the long test name at `:70` `"lofi-waltz reuses lofi-chill's chain and afro-six-eight reuses hiphop-groove's"` → `"… afro-six-eight reuses boom-bap's"`.
- `src/store/vibes.test.ts` — the four ids in the preset matrix (`'cyber-dance'`, `'ambient-chill'`, `'hiphop-groove'`, `'asian-zen'` rows), the two `VIBES.find((v) => v.id === 'asian-zen')` lookups → `'zen-garden'`, and `byId['hiphop-groove']` → `byId['boom-bap']` in `'the two boombap-pool vibes ship no pad'`.
- `src/store/vibeVariation.test.ts` — `vibe('hiphop-groove')` at the `DRUM_DENSITIES.swung16ths` assertion and at the `const groove = vibe('hiphop-groove')` line → `vibe('boom-bap')`, and the comment *"hiphop-groove's kick hits step 6, which is `and2and4`'s first hit"* → *"boom-bap's kick …"*.
- `src/audio/meterRegression.test.ts` — `FOUR_FOUR_VIBE_IDS` becomes `['lofi-chill', 'synthwave-80s', 'cyber-edm', 'deep-ambient', 'boom-bap', 'zen-garden']`.

Run: `bun test`
Expected: PASS. **Not one asserted chord, drum cell or effect value changed** — only eight record keys and the id lists.

- [ ] **Step 5: Delete the three false claims**

All three say the opposite of the design intent above, and each was checked against the file.

`CLAUDE.md:122-125` — delete the whole bullet:

```
- **Instant Vibes ids drift from labels** (`cyber-dance` → "Cyber EDM", `ambient-chill` → "Deep
  Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden"). Ids are persisted in
  project files; renaming them breaks saved projects. The table lives in
  `src/store/instantVibes.ts` — the single copy since the `audio/` fork was deleted.
```

There is no corrected version to keep: after this task there is no drift to record, and the entry also names a file that no longer exists. The `- **Tap Tempo and stereo VU are unbuilt**` bullet becomes the first item under `## Traps recorded in the spec`.

`docs/design.md:140-151` — delete the whole blockquote: the *"Ids drift from display names — do not "fix" this"* paragraph, the six-row id/label table at `:142-149`, and the `src/store/instantVibes.ts` pointer at `:151`. Note the table was six rows for eight vibes — it predates `lofi-waltz` and `afro-six-eight` — so it was stale twice over.

`docs/design.md:138` — item 2's prose list of chip names is also six of eight. Complete it:

```md
2. **`InstantVibesBar.tsx`**: Quick-start genre and mood presets (`Lo-Fi Chill`, `Synthwave 80s`, `Cyber EDM`, `Deep Ambient`, `Boom Bap`, `Zen Garden`, `Lo-Fi Waltz`, `Afro 6/8`) allowing instant loading of complete harmonic and rhythmic templates.
```

The third site, `src/store/vibeChips.ts:15-16` (*"THE IDS ARE PERSISTED IN PROJECT FILES … Do not "fix" them"*), went with the file in Task 2 — as did the fourth, `vibeChips.test.ts`'s `'the four deliberately drifting id/label pairs are reproduced verbatim'`, which was the only assertion in the suite that would have gone red on this rename, for a reason that is not true.

A **fifth** site makes the same overstatement about a different table and is corrected here, because it is how the false constraint spreads from vibes to presets. `presetById`'s docblock (now in `src/audio/presetRegistry.ts` after Part 1) says *"Ids are stable and persisted in project files; … Anything that needs to survive a rename (Instant Vibes, saved projects) resolves by id."* A loop stores resolved `SynthParams`, not a preset id, so no factory preset id reaches a `.solna` body through `loops`. The one place a preset id persists is `customSynthPresets` — user-authored ids of the form `user-preset-<timestamp>-<rand>`, which no rename can touch — and that key is in `partialize` but **not** in `PROJECT_CONTENT_KEYS`. Correct it to:

```
 * Ids are referenced by the vibe table in src/data/vibes.ts and by nothing
 * that persists: a loop stores resolved SynthParams, not a preset id, so no
 * factory preset id reaches a .solna body. The only persisted preset ids are
 * the user's own (`user-preset-<timestamp>-<rand>`), which no rename can touch.
```

- [ ] **Step 6: Run the gate**

Run: `bun run verify`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/data/vibes.ts src/store/instantVibesChordsFixture.ts src/store/instantVibesDrumsFixture.ts src/store/instantVibesEffectsFixture.ts src/store/instantVibesEffects.test.ts src/store/vibes.test.ts src/store/vibeVariation.test.ts src/audio/meterRegression.test.ts src/audio/presetRegistry.ts CLAUDE.md docs/design.md
git commit -m "refactor(store): realign four vibe ids with their display names

cyber-dance -> cyber-edm, ambient-chill -> deep-ambient, hiphop-groove ->
boom-bap, asian-zen -> zen-garden. Each old id used different words from its
label; each new one uses the label's own words.

The claim that justified keeping them is false: no vibe id reaches a .solna
body. PROJECT_CONTENT_KEYS is a closed list that does not include one, and
applyProjectContent actively clears selectedVibeId on open. The whole cost is
one stale localStorage string leaving one chip un-highlighted until the next
click. The three places that stated otherwise are deleted, along with an
overstatement of the same kind in presetById's docblock.

No display name, emoji, BPM, key, chord, drum cell or effect value changes."
```

---

## Task 6: Documentation, the instant-vibes skill and the inventory script

Three of the sections that change in `.claude/skills/instant-vibes/` are not path updates but **deletions of procedures this work removes**. That skill is largely a guide to a mechanism Task 3 deleted, so treat rewriting it as part of the work, not as a follow-up. It was **already stale before this change**: `:3`, `:11` and `:169` say six vibes (there are eight), `:3` lists six of eight names, `:92`/`:113`/`:146` reference `src/audio/data/` paths, `:56` names `ALL_FACTORY_PRESETS`, `:59` names `RHYTHM_PATTERNS`, `:164-165` cite `instantVibes.test.ts` line numbers for a "6" that is already 8 in the source, and `:214` cites `src/types.ts:8` for `VibeGenre`, which was at `:11`.

**Files:**
- Modify: `.claude/skills/instant-vibes/SKILL.md` (whole file); `.claude/skills/instant-vibes/references/authoring-libraries.md:44-46,98-101,146-160`; `.claude/skills/instant-vibes/scripts/vibe-inventory.ts` (whole file); `.claude/skills/music-theory/SKILL.md:94`; `CLAUDE.md` (the architecture section's vibe paragraph)

**Interfaces:**
- Consumes: every symbol and path produced by Tasks 1–5, plus Part 1's `@/data/` modules.
- Produces: no code that ships. `vibe-inventory.ts` is a script a human runs.

**Design note the implementer must know:** `.claude/` is **outside** `tsconfig.json`'s `include`, so `bun run lint` does not type-check `vibe-inventory.ts`, and `eslint .` does lint it but does not resolve modules. **A broken import in that script fails no gate.** Running it is the only check, so Step 3 runs it.

- [ ] **Step 1: Rewrite `.claude/skills/instant-vibes/SKILL.md`**

Replace the whole file with:

````md
---
name: instant-vibes
description: Add, remove, retune or debug an Instant Vibe in solna — the genre chips in the top bar (Lo-Fi Chill, Synthwave 80s, Cyber EDM, Deep Ambient, Boom Bap, Zen Garden, Lo-Fi Waltz, Afro 6/8) and the dice that rerolls them. Carries a survey-first workflow, the eight library ids a vibe resolves, the per-vibe dice pools and the two invariants that guard them, and the three golden fixtures behind the tests. Also covers changing a vibe's chords, synth voices, drum decoration, key pool or BPM range, and failures in vibes / vibeVariation / instantVibesProgressions tests.
---

# Instant Vibes (solna)

A vibe is the genre chip in the top bar. Clicking it rewrites the whole project;
the dice beside it rerolls into different music with the same identity.

**A vibe is pure data.** The table is `VIBES` in **`src/data/vibes.ts`** — eight
`VibeSpec` literals that name library ids and nothing else. `src/data/` files
import nothing at runtime, so that file has no dependencies at all, which is why
the always-mounted top bar can import it eagerly.

**Resolution lives somewhere else.** `resolveVibe(spec)` in
**`src/store/vibes.ts`** turns the ids into a `ResolvedVibe` — the spec plus
`chords`, `drumPattern` and `effects` — and `applyVibeToStore(resolved)` writes
it into the store.

**Every library id is written exactly once.** It used to be written twice (an id
beside its resolved value), and the second copy was a documented typo hazard.
`resolveVibe` also passes the vibe's own `scaleRoot`, `scaleType` and
`chordOctave` to `resolveProgression`, so those cannot disagree with the vibe
any more either.

## Start by surveying, not by writing

A vibe is assembled from libraries, so the first question is what those libraries
already hold. One call answers it:

```bash
bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts            # summary
bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts Major      # one scale, in full
bun run report:library                                                # what nothing uses
```

The inventory prints, per scale type: which progressions are playable in it,
which of those have the 4 steps a vibe's own `progressionId` needs, every preset
by category with its timbre-defining parameters, what the existing vibes use, and
the comp-rhythm, bass-pattern, drum-grid and effect-chain ids.
`report:library` lists entries no vibe references — often the best candidates.

Then decide, in this order:

1. **Does an existing progression fit?** It must have `referenceScale` equal to
   your vibe's `scaleType`, `minScaleLength` no greater than that scale's degree
   count, and exactly 4 steps. Reuse is the normal answer.
2. **Do three existing presets fit the lead, comp and bass roles?** Bass must be
   `category: 'Bass'`; lead and comp are judged by ear.
3. **Only if something genuinely does not exist**, author it — read
   `references/authoring-libraries.md` first. It carries the gap test ("name the
   closest candidate and say what disqualifies it"), the seventh-chord trap that
   silently downgrades progressions to triads, and the engine facts that decide
   whether a preset's numbers are audible at all.

Authoring the library entry before the vibe keeps the vibe from ever pointing at
something that does not exist yet.

## What a vibe is

Identity fields, eight library ids, a few scalars, one `random` rule — and
nothing hand-authored that a library could hold instead.

| field | resolves through | hard constraint |
|---|---|---|
| `progressionId` | `progressionById` → `CHORD_PROGRESSIONS` (`src/data/chordProgressions.ts`) | must have **exactly 4 steps**; `referenceScale === scaleType` |
| `synthPresetId` (lead) | `presetById` → `SYNTH_PRESETS` (`src/data/synthPresets.ts`) | any category |
| `chordPresetId` (comp) | `presetById` | any category |
| `bassPresetId` | `presetById` | **`category === 'Bass'`** |
| `chordRhythmId` | `CHORD_RHYTHMS` (`src/data/chordRhythms.ts`) | — |
| `bassPatternId` | `BASS_PATTERNS` (`src/data/bassPatterns.ts`) | — |
| `drumPatternId` | `drumGridById` → `VIBE_DRUM_GRIDS` (`src/data/vibeDrumGrids.ts`) | rows must be the **7 keys**, one bar of the vibe's own meter, 0/1 |
| `effectChainId` | `requireEffectChain` → `EFFECT_CHAINS` (`src/data/effectChains.ts`) | stays a **`Partial`** — an omitted key means "inherit" |

Bass is a hard category constraint because register is physics, not taste. Lead
and comp are judged by ear — there are deliberately **no genre tags on presets**,
and adding one is a rejected design.

**`chords`, `drumPattern` and `effects` are not fields of a vibe.** Never write
one. If you need them in a test, call `resolveVibe(spec)`.

**`resolveVibe` throws on all three unknown ids**, by name:

```
Vibe "lofi-chill" references unknown progression id: nope
Vibe "lofi-chill" references unknown drum grid id: nope
Unknown vibe effect chain id: nope
```

## Two things a vibe must not carry

- **No arp.** No vibe sets `arpActive`/`arpMode`/`arpRate`/`arpOctaves`, and no
  preset does either. The arpeggiator is a performance control the user drives
  from the UI, and a vibe must not switch it on behind them.
  `INITIAL_SYNTH_PARAMS.arpActive` is already `false`, so simply omit the fields —
  never write an explicit `arpActive: false`.
- **No presentational fields.** `color`, `bgGradient`, `borderColor`, `textColor`
  are forbidden; the chip's look comes from theme tokens in `InstantVibesBar`. An
  invariant test in `store/vibes.test.ts` pins this.

## `src/data/vibes.ts` may not import anything at runtime

This is an eslint rule (`src/data/**`), not a convention, and it is what lets the
always-mounted `InstantVibesBar` import `VIBES` eagerly. The bar used to read a
hand-duplicated seven-field copy (`store/vibeChips.ts`) precisely because
importing the real table dragged four library modules into the eager chunk.

**If you find yourself wanting to call a resolver inside `src/data/vibes.ts`,
stop.** That single call brings back the eager-chunk cost and the chip
duplication with it. Resolve in `store/vibes.ts` instead.

## Scale type is the vibe's identity — the dice never rerolls it

There is no genre union any more. `scaleType` is a free choice, made once per
vibe, and everything the vibe pools must agree with it. Two invariant tests in
`vibeVariation.test.ts` enforce that, per pooled progression:

1. `'every pooled progression fits the vibe's scale'` —
   `minScaleLength <= SCALES[vibe.scaleType].intervals.length`. This matters most
   for `zen-garden` (Hirajoshi, 5 degrees) and the pentatonic scales, where a
   7-degree progression used to vanish from the pool silently.
2. `'every pooled progression was authored against the vibe's own scale'` —
   `referenceScale === vibe.scaleType`.

`ChordProgression.genres` still exists as a free-form `string[]` for human
browsing. **Nothing computes from it.** A tag constrains no vibe and widens no
union; adding one is an edit to that progression and nothing else.

## The dice pool is a taste call, written out

`random` carries six explicit fields:

```ts
random: {
  keys: ['C', 'D', 'D#', 'F', 'G', 'A'],
  bpm: [78, 88],
  progressions: ['jazz-ii-v-i-vi', 'lofi-coffeehouse', 'lofi-morning-turnaround'],
  chordRhythms: ['lofiSwing', 'syncopatedPush', 'bassPlusStrum'],
  bassPatterns: ['dilla-sub', 'walking-groove', 'half-time-legato'],
  drumDecoration: { layers: [...], densities: { ... } },
}
```

It used to be derived: `progressionIds` was pinned to the complete
genre-and-scale-length filter over the library, so adding one tagged progression
silently changed what unrelated vibes could roll. Pools are per-vibe now. The
accepted cost is that a new library entry does not join any pool automatically —
`bun run report:library` is what makes that visible.

`'the dice can always land back on the vibe as authored'` pins all five:
`keys ∋ scaleRoot`, `bpm[0] <= bpm <= bpm[1]`, `chordRhythms ∋ chordRhythmId`,
`bassPatterns ∋ bassPatternId`, `progressions ∋ progressionId`.

**A one-member array is legitimate** — it says "this axis is deliberately fixed",
and there is no `>= 4` floor any more. Know what it means: `pickDistinct` falls
back to the current value when it is the sole member, so that axis stops
rerolling. If you want the axis to reroll, give it **≥2 members**. Today's
authored minimum is 2 (`deep-ambient` and `zen-garden` bass pools); keys are 5-6
and chord rhythms 3.

## Drum decoration is the fiddliest part

`random.drumDecoration` rewrites only `hihat`, `openhat`, `tom`, `crash`
(`DecorationLayer`) — `kick`, `snare` and `clap` are the skeleton and are not
assignable to the type, so they can never be rerolled. Four rules bite:

1. **All seven rows must exist** in the `VIBE_DRUM_GRIDS` entry the vibe points
   at, each exactly one bar of the vibe's own meter in numeric 0/1 steps.
   Re-clicking a chip restores the authored grid only because a reroll merges
   over a complete row set. `VIBE_DRUM_GRIDS` is deliberately **separate from
   `DRUM_GRIDS`** (the sequencer's genre grids) — measured, no vibe's grid
   matches its own genre entry best, and the two disagree on cell type and row
   set. Read the comment at the top of `src/data/vibeDrumGrids.ts` before
   thinking about merging them.
2. `densities` keys must equal `layers` **exactly** — no extras, no omissions.
3. Every `openhat` and `tom` candidate that shares a step with this vibe's `kick`
   is dropped by the collision filter, and at least one must survive. Cross-check
   your kick row against `DRUM_DENSITIES` before choosing candidates.
4. `'the filter removes exactly one candidate across all authored data'` is a
   **global count** across every vibe.

## Tests that pin exact counts or sets

**These fail loudly.** You cannot miss them; the gate stops you:

| file | what it pins |
|---|---|
| `src/store/vibes.test.ts` | `VIBES.length` is 8; the 8×3 preset matrix, id by id; the exact id list; id uniqueness; that `resolveVibe` succeeds for every vibe |
| `src/store/vibeVariation.test.ts` | every pool member resolves; the two scale guards; the dice lands back on the vibe as authored |
| `src/audio/meterRegression.test.ts` | every vibe's declared meter |

**Three golden fixtures fail loudly too — but only about the right thing.**
`instantVibesChordsFixture.ts`, `instantVibesDrumsFixture.ts` and
`instantVibesEffectsFixture.ts` each hold a hand-copied snapshot of what the
eight vibes resolve to, and each is checked against `VIBE_IDS`, so a ninth vibe
**does** fail them, with a key-set mismatch naming your id.

| fixture | what it pins |
|---|---|
| `src/store/instantVibesChordsFixture.ts` | every vibe's resolved chords |
| `src/store/instantVibesDrumsFixture.ts` | every vibe's seven drum rows |
| `src/store/instantVibesEffectsFixture.ts` | every vibe's effect chain, including which keys it omits |

Add your vibe's entry to all three by hand. They deliberately import nothing from
`VIBES`, from `resolveVibe` or from the libraries — **that independence is what
makes them proofs rather than tautologies, so never make one read the vibe table
or the resolver.** When a fixture test goes red on an *existing* vibe, that is
not a fixture to update: it means someone changed a library entry, and the
question is whether that sound change was intended.

One more that *may* fire: `'the filter removes exactly one candidate across all
authored data'` in `vibeVariation.test.ts` is a global count. It holds if your
`openhat`/`tom` candidates avoid your `kick` steps, which is worth aiming for
anyway — but if you do collide deliberately, update the number rather than
deleting the test.

## Never touch `applyVibeToStore`

It runs `store.hardStopAll()`, then a synchronous `audioEngine.stopSource('chord',
0.02)` / `stopSource('bass', 0.02)` cut **before the first vibe-state write**,
then restarts only the players that were active. Two real overlapping-audio bug
fixes live in that ordering (`d8df714`, `c4a253a`). Adding a vibe is pure data —
the function does not change. Non-regression tests pin the ordering.

## Adding a vibe: three files under `src/data/`, and nothing else

| file | edit |
|---|---|
| `src/data/chordProgressions.ts` | a new `ChordProgression`, if none fits — `genres` is a free string array with no union to widen |
| `src/data/vibeDrumGrids.ts` | one grid + one `VIBE_DRUM_GRID_METERS` row, if none fits |
| `src/data/vibes.ts` | one `VibeSpec`, whose `random.progressions` names whatever suits it |

Plus one row each in the three golden fixtures, and the count/matrix/id-list
updates in `store/vibes.test.ts`. `src/types.ts` is never touched, nor is
anything under `src/audio/`, `src/store/` or `src/components/`.

## Order of work

1. Survey (`scripts/vibe-inventory.ts`, `bun run report:library`) and decide what,
   if anything, is missing
2. Author only the genuinely missing library entries, with their tests —
   see `references/authoring-libraries.md`
3. The vibe literal in `src/data/vibes.ts` — every sound field an id, nothing
   hand-authored, and **no resolver call in that file**
4. `random`, with pools you chose and can defend
5. Update `store/vibes.test.ts`'s count, preset matrix and id list, then add your
   entry to all three golden fixtures. Every one of these fails loudly, so the
   gate will walk you through them — but it reports them one at a time, so expect
   several passes
6. `bun run verify`

## Gate

`bun run verify` (test + lint + eslint + check:keys + check:drums + build).
`bun run report:library` is **not** in it and never asserts anything.

## Bundled with this skill

- `scripts/vibe-inventory.ts` — what the libraries hold, per scale type
- `references/authoring-libraries.md` — read when the survey found a real gap

Related skills: `dsp-audio` before touching the engine or effect routing,
`music-theory` before touching scales, chord generation or bass/rhythm patterns.
````

- [ ] **Step 2: Rewrite `scripts/vibe-inventory.ts`**

The old script is organised around `VIBE_GENRE_SCALES`, `VibeGenre` and `ALL_FACTORY_PRESETS`, none of which exist. Rewrite it around **scale type**, which is what actually constrains a pool now. Replace the whole file:

```ts
/**
 * What is already available for a scale type, in one call.
 *
 * Run from the repo root:
 *   bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts
 *   bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts "Natural Minor"
 *
 * Organised by SCALE TYPE, not by genre: a vibe's pool is constrained by its
 * scaleType (referenceScale must match, minScaleLength must fit) and by nothing
 * else. The VibeGenre union and VIBE_GENRE_SCALES are gone — a pool is now a
 * taste call, so this prints the candidates and leaves the choosing to you.
 *
 * `bun run report:library` is the companion: it lists what NOTHING references.
 */
import { CHORD_PROGRESSIONS } from '../../../../src/data/chordProgressions';
import { SYNTH_PRESETS } from '../../../../src/data/synthPresets';
import { CHORD_RHYTHMS } from '../../../../src/data/chordRhythms';
import { BASS_PATTERNS } from '../../../../src/data/bassPatterns';
import { VIBE_DRUM_GRIDS } from '../../../../src/data/vibeDrumGrids';
import { EFFECT_CHAINS } from '../../../../src/data/effectChains';
import { VIBES } from '../../../../src/data/vibes';
import { SCALES } from '../../../../src/data/scales';

const arg = process.argv[2];

if (!arg) {
  console.log('SCALE TYPES that progressions are authored against\n');
  const scales = [...new Set(CHORD_PROGRESSIONS.map((p) => p.referenceScale))].sort();
  for (const s of scales) {
    const playable = CHORD_PROGRESSIONS.filter(
      (p) => p.referenceScale === s && p.minScaleLength <= SCALES[s].intervals.length,
    );
    const vibes = VIBES.filter((v) => v.scaleType === s).map((v) => v.id);
    console.log(
      `${s.padEnd(15)} ${String(SCALES[s].intervals.length)} degrees  ` +
        `${String(playable.length).padStart(2)} progressions   used by: ${vibes.join(', ') || '(none)'}`,
    );
  }
  console.log('\nPass a scale type in quotes for its full inventory.');
  process.exit(0);
}

if (!SCALES[arg]) {
  console.error(`Unknown scale type "${arg}". Known: ${Object.keys(SCALES).join(', ')}`);
  process.exit(1);
}

const len = SCALES[arg].intervals.length;
console.log(`SCALE ${arg} — ${len} degrees\n`);

const pool = CHORD_PROGRESSIONS.filter((p) => p.referenceScale === arg && p.minScaleLength <= len);
console.log('PROGRESSIONS a vibe in this scale may pool. Choose; do not copy wholesale:');
for (const p of pool) {
  const bars = p.steps.map((s) => s.bars);
  const uniform = new Set(bars).size === 1 ? `${bars[0]} bars each` : `bars ${bars.join('/')}`;
  console.log(
    `  ${p.id.padEnd(28)} ${String(p.steps.length)} steps, ${uniform.padEnd(14)} ${p.roman}` +
      `   tags: ${p.genres.join(',') || '-'}`,
  );
}
const fourStep = pool.filter((p) => p.steps.length === 4);
console.log(`\n  ${fourStep.length}/${pool.length} have exactly 4 steps — a vibe's own progressionId must be one of those:`);
console.log(`  ${JSON.stringify(fourStep.map((p) => p.id))}`);
console.log('  (`genres` is a free-form browsing tag. Nothing computes from it.)');

console.log('\nPRESETS — no genre tags exist by design; pick by ear, by category.');
const byCat = new Map<string, typeof SYNTH_PRESETS>();
for (const p of SYNTH_PRESETS) {
  if (!byCat.has(p.category)) byCat.set(p.category, []);
  byCat.get(p.category)!.push(p);
}
for (const [cat, list] of [...byCat].sort()) {
  console.log(`\n  ${cat}${cat === 'Bass' ? '   <- bassPresetId must resolve here' : ''}`);
  for (const p of list) {
    const q = p.params;
    console.log(
      `    ${p.id.padEnd(26)} ${String(q.oscType ?? '?').padEnd(9)} cut ${String(q.filterCutoff ?? '?').padStart(5)}` +
        ` env ${String(q.filterEnvAmount ?? '?').padStart(4)} A${q.attack ?? '?'} D${q.decay ?? '?'} S${q.sustain ?? '?'} R${q.release ?? '?'}` +
        ` sub ${q.subOscVolume ?? 0} noise ${q.noiseVolume ?? 0}${q.octave ? ` oct ${q.octave > 0 ? '+' : ''}${q.octave}` : ''}`,
    );
  }
}

console.log('\nWHICH VOICES THE EXISTING VIBES USE');
for (const v of VIBES) {
  const mark = v.scaleType === arg ? '*' : ' ';
  console.log(`  ${mark}${v.id.padEnd(15)} lead ${v.synthPresetId.padEnd(26)} comp ${v.chordPresetId.padEnd(26)} bass ${v.bassPresetId}`);
}
console.log('  (* = same scale type as the one you asked about)');

console.log(`\nCOMP RHYTHMS  ${JSON.stringify(CHORD_RHYTHMS.map((r) => r.id))}`);
console.log(`BASS PATTERNS ${JSON.stringify(BASS_PATTERNS.map((b) => b.id))}`);
console.log(`VIBE DRUM GRIDS ${JSON.stringify(Object.keys(VIBE_DRUM_GRIDS))}`);
console.log("  (a vibe's drumPatternId resolves here — separate from DRUM_GRIDS, which is the sequencer's)");
console.log(`EFFECT CHAINS ${JSON.stringify(Object.keys(EFFECT_CHAINS))}`);
for (const [id, chain] of Object.entries(EFFECT_CHAINS)) {
  console.log(`  ${id.padEnd(24)} ${JSON.stringify(chain)}`);
}
console.log('  (a Partial<MasterEffects> — an omitted key inherits the current value, so omissions are deliberate)');
```

- [ ] **Step 3: Run the script both ways**

`.claude/` is outside `tsconfig.json`'s `include`, so nothing in the gate catches a broken import here. Running it **is** the check.

Run: `bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts`
Expected: a table of scale types. `Major` shows the vibes `lofi-chill, lofi-waltz`; `Natural Minor` shows `synthwave-80s, cyber-edm`; `Dorian` shows `boom-bap, afro-six-eight`; `Lydian` shows `deep-ambient`; `Hirajoshi` shows `zen-garden`.

Run: `bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts Hirajoshi`
Expected: `SCALE Hirajoshi — 5 degrees`, then the four `zen-*` progressions, then the preset listing by category with `Bass` marked.

- [ ] **Step 4: Update `references/authoring-libraries.md`**

Three edits, all deletions of a mechanism that no longer exists:

- `:45` — the inline comment `referenceScale: 'Major',     // must equal VIBE_GENRE_SCALES[each tag]` becomes `referenceScale: 'Major',     // the scale this was authored against; a vibe pooling it must play the same one`. Two lines below, `genres: ['lofi'],` gains a trailing comment: `// free-form browsing tag; nothing computes from it`.
- `:98-101` — `FACTORY_PRESETS` in `src/audio/synthPresets.ts`, `FACTORY_BASS_PRESETS` in `src/audio/bassPresets.ts` and `ALL_FACTORY_PRESETS` all became one table in Part 1. Rewrite to: *"`SYNTH_PRESETS` in `src/data/synthPresets.ts`. Ids follow the file's convention: `factory-*`, and `bass-*` for `category: 'Bass'`. **Both id and name must be unique** across the table — invariant tests pin each. Name uniqueness matters because `resolveVibeSynthParams` stamps the resolved entry's `name` into `params.preset`, and the preset UI selects back by name."*
- `:146-160` — delete the whole `## Adding a whole genre` section. `VibeGenre` does not exist; there is no union to extend, no anchor scale to add and no four-progression quota. Replace it with:

```md
## Choosing what a vibe pools

There is no genre union and no quota. A vibe's `random.progressions` is a taste
call, bounded by two facts about the scale it plays: every member must have
`referenceScale === vibe.scaleType`, and `minScaleLength` no greater than that
scale's degree count. Two invariant tests enforce exactly that and nothing more.

`ChordProgression.genres` is a free-form `string[]` for human browsing. Nothing
computes from it, so tagging a progression `kpop` widens no type and obliges no
other file to change.

Prefer reuse. A pool of existing progressions that suit the vibe is a better
answer than four new ones, and `bun run report:library` will show you which
entries nothing has claimed yet.
```

- [ ] **Step 5: Update `.claude/skills/music-theory/SKILL.md:94`**

The clause *"and `genres` — a tag is only legal when `referenceScale === VIBE_GENRE_SCALES[tag]`"* describes a deleted rule. Replace it with:

```md
degree count), and `genres` — a free-form browsing tag that nothing computes from.
```

(The path and count corrections elsewhere in that file — `src/audio/data/chordProgressions.ts`, "40 progressions", `BASS_PATTERNS (12, …)`, `RHYTHM_PATTERNS (15, 9 styles)` and the `SCALES` locations — are Part 1's Task 11. If any is still wrong when you read the file, fix it here rather than leaving it.)

- [ ] **Step 6: Update `CLAUDE.md`**

Part 1 already rewrote the layer list into four layers. Add one paragraph to the Architecture section, after the layer list, recording the rule this plan established:

```md
**A vibe is pure data, and every library id in it is written once.** `VIBES` in
`src/data/vibes.ts` is eight `VibeSpec` literals that name ids and nothing else;
`resolveVibe` in `src/store/vibes.ts` turns them into a `ResolvedVibe` — the spec
plus `chords`, `drumPattern` and `effects` — and `applyVibeToStore` writes that.
The table resolves nothing at module scope, which is what lets the always-mounted
`InstantVibesBar` import it eagerly with no resolver graph behind it; a single
resolver call in that file would put four library modules back into the eager
chunk and bring back the hand-duplicated chip table that was deleted with it.
Each vibe's dice pool is its own explicit arrays (`random.progressions` and the
rest), not the output of a filter over the shared library — so adding a
progression never reaches into a vibe that did not ask for it.
```

- [ ] **Step 7: Run the gate**

Run: `bun run verify`
Expected: PASS. (Documentation changes cannot break it; run it anyway — the `CLAUDE.md` and skill edits are the last thing before the branch is done, and a green gate here is what "done" means.)

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/instant-vibes/SKILL.md .claude/skills/instant-vibes/references/authoring-libraries.md .claude/skills/instant-vibes/scripts/vibe-inventory.ts .claude/skills/music-theory/SKILL.md CLAUDE.md
git commit -m "docs: rewrite the instant-vibes skill for VibeSpec and per-vibe pools

The skill was largely a guide to two mechanisms this branch deleted: writing
each library id twice, and computing a vibe's dice pool from a closed VibeGenre
union. Both sections go, along with the four-coordinated-edits genre procedure
in authoring-libraries.md and the VIBE_GENRE_SCALES tag rule in music-theory.

vibe-inventory.ts is reorganised around scale type, which is what actually
constrains a pool now. Nothing in the gate type-checks or resolves imports
under .claude/, so it was run both ways by hand.

Also fixes what was already stale before this branch: six vibes where there are
eight, six of eight chip names, and the src/audio/data/ paths."
```

---

## Self-review notes

### Spec coverage — Part 2, Part 2b, Part 3 and Part 3b, section by section

| spec section | task |
|---|---|
| Part 2, "The problem" — the id written twice, and the SKILL.md `:79-82` failure mode | 1 (the split), 6 (the SKILL rewrite deletes the advice) |
| Part 2, "The split" — `VibeSpec` in `data/`, `resolveVibe`, `ResolvedVibe`, resolve-before-return | 1 Steps 3–4 |
| Part 2, "`resolveVibe` is where a bad id gets a real error" | 1 Step 1 (three throw tests) |
| Part 2, "`data/vibes.ts` imports nothing at runtime" + the head comment recording why | 1 Step 3 |
| Part 2b, "`vibeChips.ts` is deleted" — all four consequences | 2 |
| Part 2b, "`hasVariation` becomes derived" | 2 Step 3, then 3 Step 6 (`variation` → `random`) |
| Part 2b, "the dynamic import stays but narrows" | 2 Step 3, with the consumer verified in the task preamble |
| Part 2b, "`InstantVibesBar.tsx` changes in four named places" | 2 Step 3 |
| Part 2, "The three golden fixtures" + the two stale comments | 1 Steps 8–9; the fixture/task map is in "Ordering" |
| Part 3, "What exists today" + "The evidence for reversing it" | 3 preamble |
| Part 3, "The replacement" — the seven-row rename table, one-member arrays legitimate | 3 Step 3 |
| Part 3, deleting `VibeGenre`, `VIBE_GENRE_SCALES`, `variation.genre` | 3 Step 4 |
| Part 3, `ChordProgression.genres` kept free-form with the doc comment | 3 Step 4 |
| Part 3, "Two guards the derived filter used to give for free" + the third (`progressions ∋ progressionId`) | 3 Step 1, mutation-checked in Step 8 |
| Part 3, "The accepted cost, and the mitigation" — `report:library`, exits 0, not in `verify` | 4 |
| Part 3b / item 5, the design intent and the four ids | 5 |
| Item 5, "The three false claims, and where they are" + the fifth site (`presetById`'s docblock) | 5 Step 5 (and Task 2 for the `vibeChips.ts` one) |
| Verification, "The two changed contracts, stated precisely" | the Deletions table in Global Constraints; 1 Step 8; 3 Step 1 |
| Verification, "New tests this change owes" items 3, 4 and 5 | 3 Step 1; 1 Step 1; 2 Step 1 |
| Verification, "Mutation check" | 3 Step 8 |
| Traps item 3, the documentation table (the rows this plan owns) | 5 Step 5, 6 |

Items 1 and 2 of "New tests this change owes" (the `src/data/` purity fixture and the default bass patch by id) and Traps items 1, 2 and 4 belong to **Part 1** and are not repeated here.

### Where the source contradicts the spec or the brief

Every count, path, symbol, field name and line number in this plan was read out of the source on `refactor/data-layer-extraction` at `9128d94`, or measured by evaluating the tables with `bun`. Six places disagree; the plan follows the source.

1. **`vibeVariationFixtures.ts` is not in the blast radius of the id rename.** The spec's realignment section lists it among the files the rename touches. It holds `firstDraw`, `lastDraw` and `scriptedDraw` and **contains no vibe id at all** — checked line by line. Task 5 does not touch it.
2. **The `chordProgressions.test.ts` genre deletions are larger than the spec's line list implies.** The spec names `:77-78` (the per-genre `referenceScale` check) and `:144,151,162,171` (the conventions). It does not name `'every genre has at least four progressions'` or `'the exact tagged set per genre is authored, not inferred'`, both of which sit in the same `describe('genre tagging')` block and both of which compute from `p.genres` and `GENRES`. Task 3 deletes the whole block — three tests — and rewrites the four conventions against explicit id lists. This is covered by the spec's own summary line ("the per-genre `chordProgressions.test.ts` checks"), and it is recorded here because the line list alone would leave two tests that cannot compile.
3. **Minor line drift in `chordProgressions.test.ts`.** The spec's `:77-78`, `:144`, `:151`, `:162` and `:171` are at `:78`, `:143`, `:151`, `:160` and `:171` in the source. The plan uses the source's numbers and, where a body moves, names the test by its string instead.
4. **`vibeVariation.test.ts`'s pool-invariant lines are a few off.** The spec cites `:157-160`, `:163-186`, `:188-196`, `:198`, `:205-215`; the source has them at `:156-167`, `:169-186`, `:188-196`, `:198-202`, `:205-215`. Task 3 replaces the whole `describe('authored variation data')` block rather than patching by line.
5. **`requireEffectChain` stays, and `resolveVibe` calls it.** The spec says all three ids "get the loud treatment and the asymmetry disappears", which reads as if `resolveVibe` should own all three messages. Doing that would leave `requireEffectChain` exported, tested and called by nothing — dead code — and the spec's own "no other test is deleted" rule forbids removing its test. So `resolveVibe` throws two of the three messages itself and delegates the third. All three are loud, which is the property that matters; only the wording differs, and Task 1 pins all three exactly.
6. **The spec's Context paragraph carries Part 1's wrong preset count** ("37 synth presets"). Measured by evaluating the tables, not by grepping indented `id:` lines: `FACTORY_PRESETS.length` is 24 and `FACTORY_BASS_PRESETS.length` is 5, so `SYNTH_PRESETS` is **29**. Part 1's plan already records this; it is repeated here because the number appears in the skill text Task 6 rewrites, and the rewrite must not carry 37 forward. Two other counts in this plan were measured the same way and are correct in the spec: **8 vibes** and **44 progressions**.

Two brief-supplied facts were also checked and are correct as stated: the four id/label pairings, and that the `InstantVibesBar` dynamic import must stay because `./vibeActions` reaches `applyVibeToStore` and the engine (`vibeActions.ts:9-17` → `store/vibes.ts` → `audio/engine`, `playbackEngine`, four resolvers).
