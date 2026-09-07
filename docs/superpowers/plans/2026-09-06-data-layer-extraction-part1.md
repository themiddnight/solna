# Data Layer Extraction — Part 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/data/` — a fourth layer below `audio/` whose files import nothing at runtime, read no impure global and hold no mutable binding — and move the ten non-vibe factory tables into it, with the spec's renames and an eslint block that enforces the three bans.

**Architecture:** Layers become `data → audio → store → components`; every layer may import `data/`. `src/utils/` stays outside the chain and sits *above* `data/` (`utils/musicTheory.ts` will import `SCALES` from `data/scales.ts`, never the reverse). Each table's type declarations travel with it, so a consumer imports the shape from the same module as the values. Every lookup, merge, index or grouping *over* a table stays on the `audio/` side of the split. `src/audio/data/` disappears entirely.

**Tech Stack:** TypeScript, React 18, Zustand (`persist` + `subscribeWithSelector`), raw Web Audio API, `tonal` for note/interval math, Tailwind v4 + daisyUI, Bun (test runner + scripts), Vite, ESLint 10 flat config + typescript-eslint 8.

**Spec:** `docs/superpowers/specs/2026-09-06-data-layer-extraction-design.md` — **this plan implements Part 1 only.**

---

## Global Constraints

### The `src/data/` rule, stated once (spec, "The rule, stated once")

> **A file in `src/data/` cannot do anything at load that a reader of the file cannot see.** It
> imports nothing at runtime — **not even another file in `src/data/`** — reads no impure global,
> declares no function and constructs no object, and holds no mutable module-scope binding. It may
> declare types and interfaces, and may `import type` from anywhere. Top-level `const` arrow
> helpers that are shorthand for writing a literal are allowed.
>
> Equivalently, and more usefully: **every file in `src/data/` is an independent leaf.**

### The three enforced bans

1. **The import ban.** `@typescript-eslint/no-restricted-imports` with `patterns: [{ group: ['**'], allowTypeImports: true }]`. It blocks relative, aliased, bare-package **and same-folder sibling** imports. The base `no-restricted-imports` rule MUST be set to `'off'` in the same block or the typescript-eslint variant never fires at all (measured in the spec).
2. **The impure-global ban.** `no-restricted-globals` over `Math`, `Date`, `crypto`, `fetch`, `performance`, `process`, `globalThis`, `localStorage`, `sessionStorage`, `window`, `document`. It is scope-aware, so a table field or helper parameter named `performance` is untouched. The list is a floor, not a ceiling.
3. **The stateless/literal ban.** `no-restricted-syntax` over `NewExpression`, `FunctionDeclaration`, `FunctionExpression`, `ClassDeclaration`, `ClassExpression`, and `let`/`var` at module scope — **two** selectors for the last one (`Program > VariableDeclaration[kind=/^(let|var)$/]` **and** `ExportNamedDeclaration > VariableDeclaration[kind=/^(let|var)$/]`), because the export form is not a child of `Program`.

**`no-restricted-syntax` and `no-restricted-globals` are not additive.** A `files:` block that sets either rule *replaces* the global entry. The `src/data/` block must therefore re-declare the global config's entries verbatim: all five `no-restricted-syntax` objects from `eslint.config.js:58-87` (two React.FC selectors, three `../../` selectors) and all three `no-restricted-globals` entries from `eslint.config.js:46-51` (`confirm`, `alert`, `prompt`). See "Where the source disagrees with the spec", item 3.

**Helpers are allowed and are not a carve-out.** `CallExpression` and `ArrowFunctionExpression` are not banned. `step()` in `chordProgressions.ts` and `block()` / `strum()` in `chordRhythms.ts` move into `src/data/` unchanged, each directly above the table it builds. Do **not** expand their ~268 call sites inline; do **not** create a shared `data/helpers.ts` (the import ban forbids it anyway).

### The naming rule

> **A name says what an entry IS, not what it is keyed by.**

And: **`preset` and `pattern` are banned as a name with no qualifier.** `GENRE_PRESETS` → `DRUM_GRIDS`, `VIBE_DRUM_PATTERNS` → `VIBE_DRUM_GRIDS`, `RHYTHM_PATTERNS` → `CHORD_RHYTHMS`, `drumPatternById` → `drumGridById`, `drumPatternMeterId` → `drumGridMeterId`, `VIBE_DRUM_PATTERN_METERS` → `VIBE_DRUM_GRID_METERS`, `VIBE_EFFECT_CHAINS` → `EFFECT_CHAINS`, `RHYTHM_STYLE_GROUPS` → `CHORD_RHYTHM_STYLE_GROUPS`, `GenrePreset` → `DrumGrid`, `RhythmPattern` → keeps its name (it is qualified by its module and by 40+ consumer type annotations; the spec's "What moves" row names `RhythmPattern` as a moved export verbatim).

### The behaviour-preservation rule

> **Only import paths and symbol names may change. If an asserted value has to change, something
> broke — stop and find out why.**

The existing suite is the proof that Part 1 is behaviour-preserving. **No test is deleted in Part 1.** A test file may be renamed with its module and a test's *subject expression* may be rewritten from an index to an id (Task 2 only), but no asserted number, note, boolean grid or param value changes anywhere in this plan.

### Layering, still enforced

`src/audio/` never imports `store/` or `components/`. `src/store/` never imports `components/`. `src/components/` must not import `audio/engine`. Engine setters are never called from a component. All four layering blocks stay exactly as they are; the `src/data/` block is added alongside them.

### Import style inside `src/data/`

Cross-folder imports use the `@/` alias (decision D2). New `src/data/**` files write `import type { X } from '@/types'` and `import type { MeterId } from '@/utils/meter'`, never `../types`. The `../../` eslint selector would not catch a single `../`, so this is a convention the plan follows uniformly rather than a rule the linter enforces.

### Gate

**`bun run verify`** = `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`. `bun run eslint` must report **zero errors**; warnings are tolerated. Run it as the last step of every task, before the commit. `bun run check:theme` is not in that chain and is unaffected by this work.

### Branch

All work lands on **`refactor/data-layer-extraction`**, which already exists and already holds the spec commit (`1b75faf`). Never commit to `main`.

### Explicitly OUT of scope for this plan

- **`INSTANT_VIBES` does not move.** It stays in `src/store/instantVibes.ts`, under that name, in that file. It calls `resolveProgression`, `progressionById`, `drumPatternById` and `requireEffectChain` at module-evaluation time, and the runtime-import ban forbids all four inside `src/data/`. It can only move after the `VibeSpec` / `ResolvedVibe` split, which is Part 2. What *does* change here: its import specifiers, and `drumPatternById` → `drumGridById`. **Do not rename `store/instantVibes.ts` in this plan.**
- **`src/store/vibeChips.ts` and `vibeChips.test.ts` stay.** Part 2 deletes them. Neither is touched here — they import nothing that moves.
- **The vibe id realignment** (`cyber-dance` → `cyber-edm` and the other three), the `CLAUDE.md:122-125` trap entry and `docs/design.md:140-151` — Part 2/3. The trap entry names `src/store/instantVibes.ts` as the table's home, which is still true after Part 1, so it is left alone.
- **`VibeGenre`, `VIBE_GENRE_SCALES`, `ChordProgression.genres`, `VibeVariation`** — Part 3. `VIBE_GENRE_SCALES` stays in `src/audio/chordProgressions.ts` (it is a genre→scale registry read only by tests, not a content table), and the `export type { VibeGenre }` re-export stays with it so `vibeVariation.test.ts` keeps one import site.
- **`ROOTS`, `METERS`, `METER_OPTIONS`, `THEME_TOKENS`, `VIEW_META`, `presetsSlice`, the three `instantVibes*Fixture.ts` files** — deliberately not data; see the spec's "What is deliberately NOT moving".
- **The `bass-` / `factory-` id prefix inconsistency.** Do not "fix" it. `bassPresetId` values are written into all eight vibe specs, and renaming them mixes a mechanical move with a content edit.
- **`report:library`, `check:presets`, CI, the music-theory rework** — the spec's "Out of scope" section.

---

## Ordering decision: the eslint block lands **first**, at `'error'`

The brief raised the risk that flipping the block to `'error'` before every table has moved turns the gate red mid-plan, and offered a warn-then-error alternative on the precedent of the ESLint rule matrix in `2026-09-04-codebase-hygiene-and-restructure-design.md`.

**That precedent does not apply here, and the block lands first at `'error'`.** The reason is that the two situations are opposites:

- The hygiene matrix flips rules that already have hundreds of violations across files that exist. `warn` first is the only way to land the rule at all.
- The `src/data/` block scopes to `src/data/**/*.ts`, and **`src/data/` does not exist when the block lands**. There are zero files to violate it. Every file added to the folder afterwards is written to comply from its first line.

Verified against every prospective `src/data/` file: none needs a runtime import. Every cross-file reference any of them makes is a *type* (`SynthParams`, `MeterId`, `MasterEffects`, `VibeGenre`, `ChordItem`), which `allowTypeImports: true` permits. `PROGRESSIONS_BY_ID = new Map(...)` — the repo's only `NewExpression` in this territory — stays in `audio/chordProgressions.ts`. No prospective file uses a module-scope `let`/`var`, and the four `Math.*` uses (`rhythmPatterns.ts:349,354`, `bassPatterns.ts`) are all inside resolvers that stay in `audio/`.

Landing it first is strictly better than landing it last: the guard checks the *first* table move rather than being switched on after the last one, and if some later table turns out to need a runtime import, the gate goes red at exactly the moment the design assumption breaks — which is the signal, not the accident.

**Task 1 therefore has no production dependency and every later task depends on it.** Tasks 3–10 are otherwise independent of one another and may be reordered or parallelised, with two exceptions:

- **Task 5 (`drumGrids`) must follow Task 4 (`drumKits`)**, because `GENRE_TO_KIT` starts life in `audio/drumKits.ts` and ends in `data/drumGrids.ts`. Task 4 leaves it in place; Task 5 moves it.
- **Task 11 (docs) must be last**, because it records the final paths.

**Task 2 is early and isolated on purpose.** It carries the plan's one dangerous item — the positional `FACTORY_BASS_PRESETS[0]` default — and its middle steps deliberately produce a red test that proves the guard catches the merge bug. That red state is the point of the task; do not commit inside it.

---

## File Structure

### Created — `src/data/` (the new layer)

| file | responsibility |
|---|---|
| `src/data/synthPresets.ts` | The single 29-entry `SYNTH_PRESETS` table, the 8-entry `SYNTH_CATEGORIES` table, and the `SynthPresetItem` / `SynthPresetCategory` / `SynthPresetCategoryMeta` shapes. |
| `src/data/synthPresets.test.ts` | Table-only invariants over `SYNTH_PRESETS`: the five bass-prefixed presets, id uniqueness, no `params.preset`. |
| `src/data/scales.ts` | `SCALES` (11) and `ScaleDefinition`. |
| `src/data/scales.test.ts` | Table-only invariants over `SCALES`: entry count, one triad/seventh quality per degree, every scale starting on the root. |
| `src/data/drumKits.ts` | `DRUM_KITS` (12), `DEFAULT_DRUM_KIT`, `DrumKit` and the six param interfaces. |
| `src/data/drumKits.test.ts` | Table-only invariants over `DRUM_KITS`: entry count, the default kit defining every drum type, no kit introducing a type the default lacks. |
| `src/data/drumGrids.ts` | `DRUM_GRIDS` (14) with `DrumGrid`, plus `GENRE_TO_KIT` (14) — a genre string to a kit **name string**, never a kit object. |
| `src/data/drumGrids.test.ts` | Table-only invariants over `DRUM_GRIDS`: declared meters, step counts, row sets. |
| `src/data/chordProgressions.ts` | `CHORD_PROGRESSIONS` (44), `ChordProgression`, `ProgressionStep`, `ProgressionCategory`, and the private `step()` helper directly above the table. |
| `src/data/chordRhythms.ts` | `CHORD_RHYTHMS` (21), `RhythmPattern`, `RhythmHit`, `RhythmHitType`, and the private `block()` / `strum()` helpers directly above the table. |
| `src/data/bassPatterns.ts` | `BASS_PATTERNS` (16), `BassPattern`, `BassStep`, `BassNoteToken`, `BassStepChoice`. |
| `src/data/vibeDrumGrids.ts` | `VIBE_DRUM_GRIDS` (8) and `VIBE_DRUM_GRID_METERS` (8), carrying the "deliberately NOT merged with `DRUM_GRIDS`" measurement comment verbatim. |
| `src/data/effectChains.ts` | `EFFECT_CHAINS` (6). |
| `src/data/dataLayerPurity.test.ts` | Lints 16 fixture sources through ESLint's Node API and asserts the reported rule ids **and severities** — the committed test that keeps the three bans measured across eslint/typescript-eslint upgrades. |

### Created — `src/audio/` (the resolver side of each split)

| file | responsibility |
|---|---|
| `src/audio/presetRegistry.ts` | `applyPreset`, `getAllSynthPresets`, `presetById`, `findPresetByName`, `getPresetsGroupedByCategory`, `getCategoryMeta`, `CategoryPresetGroup`. Every one is a lookup or a merge over `SYNTH_PRESETS`. |
| `src/audio/presetRegistry.test.ts` | Renamed from `src/audio/synthPresets.test.ts`, with the three tests from the deleted `src/audio/bassPresets.test.ts` that cover the registry rather than the table folded in. |
| `src/audio/chordProgressions.ts` | Moved up out of `audio/data/`. Keeps `PROGRESSIONS_BY_ID`, `progressionById`, `resolveProgression`, `VIBE_GENRE_SCALES` and the `VibeGenre` re-export. |
| `src/audio/chordProgressions.test.ts` | Moved from `audio/data/`. Covers the table and the resolvers, so it stays on the resolver side. |
| `src/audio/chordProgressions.migration.test.ts` | Moved from `audio/data/`, imports only. |
| `src/audio/chordRhythms.ts` | Renamed from `rhythmPatterns.ts`. Keeps `CHORD_RHYTHM_STYLE_GROUPS`, `feelToHoldScale`, `equalPowerVelocityScale`, `fullHoldDuration`, `customRhythmPattern`. |
| `src/audio/chordRhythms.test.ts` | Renamed from `rhythmPatterns.test.ts`. |
| `src/audio/vibeDrumGrids.ts` | Moved up out of `audio/data/`. Keeps `drumGridById` (fresh deep copy per call) and `drumGridMeterId`. |
| `src/audio/vibeDrumGrids.test.ts` | Moved from `audio/data/vibeDrumPatterns.test.ts`. |
| `src/audio/effectChains.ts` | Moved up out of `audio/data/`. Keeps `effectChainById` and `requireEffectChain`. |
| `src/audio/effectChains.test.ts` | Moved from `audio/data/vibeEffectChains.test.ts`. |

### Deleted

| file | why |
|---|---|
| `src/audio/synthPresets.ts` | splits into `data/synthPresets.ts` + `audio/presetRegistry.ts` |
| `src/audio/bassPresets.ts` | merged into `data/synthPresets.ts` |
| `src/audio/synthPresets.test.ts` | renamed to `audio/presetRegistry.test.ts` |
| `src/audio/bassPresets.test.ts` | splits into `data/synthPresets.test.ts` + three tests appended to `audio/presetRegistry.test.ts` |
| `src/audio/rhythmPatterns.ts` / `.test.ts` | renamed to `audio/chordRhythms.ts` / `.test.ts` |
| `src/audio/data/chordProgressions.ts` / `.test.ts` / `.migration.test.ts` | split and moved up |
| `src/audio/data/genrePresets.ts` / `.test.ts` | become `data/drumGrids.ts` / `.test.ts` |
| `src/audio/data/vibeDrumPatterns.ts` / `.test.ts` | split into `data/vibeDrumGrids.ts` and `audio/vibeDrumGrids.ts` / `.test.ts` |
| `src/audio/data/vibeEffectChains.ts` / `.test.ts` | split into `data/effectChains.ts` and `audio/effectChains.ts` / `.test.ts` |
| **`src/audio/data/`** | the directory itself, empty after Task 10 |

### Modified

| file | change |
|---|---|
| `eslint.config.js` | add the `src/data/**` block (Task 1); correct the false comment at `:68-75` |
| `src/audio/drumKits.ts` | reduced to `mergeDrumKit` over `@/data/drumKits` |
| `src/audio/bassPatterns.ts` | keeps `BASS_STYLE_GROUPS`, `resolveBassSteps`, `isApproachToken`, `customBassPattern`, `ResolvedBassEvent` |
| `src/audio/engine.ts:2,11` | `DrumKit` type from `@/data/drumKits`; `mergeDrumKit` unchanged; `musicTheory` unchanged |
| `src/audio/engine.test.ts:5` | `DEFAULT_DRUM_KIT` from `@/data/drumKits` |
| `src/audio/drumKits.test.ts:2-3` | table imports from `@/data/drumKits` and `@/data/drumGrids`; `mergeDrumKit` stays local |
| `src/audio/bassPatterns.test.ts:2-3` | `BASS_PATTERNS` and the types from `@/data/bassPatterns` |
| `src/audio/meterRegression.test.ts:16-19` | four import specifiers repointed |
| `src/audio/leadMelody.ts:12`, `leadLiveRecord.test.ts:13`, `clock.test.ts:2`, `playback/arpPlayback.ts:5`, `playback/padPlayback.ts:2` | unchanged — they import functions, not `SCALES` |
| `src/audio/playback/presetPreview.ts:4` | `applyPreset` / `SynthPresetItem` repointed |
| `src/audio/playback/chordPlayback.test.ts:4-5` | `equalPowerVelocityScale` from `@/audio/chordRhythms`, `RhythmPattern` type from `@/data/chordRhythms` |
| `src/utils/musicTheory.ts:8-104` | `ScaleDefinition` and `SCALES` deleted; re-exported from `@/data/scales` |
| `src/utils/musicTheory.test.ts` | `SCALES` import repointed |
| `src/utils/patternAdapt.ts:5` | doc comment names `DRUM_GRIDS` / `VIBE_DRUM_GRIDS` |
| `src/store/initialState.ts` | `presetById` repointed; gains `DEFAULT_BASS_PRESET_ID` and `INITIAL_BASS_SYNTH_PARAMS` |
| `src/store/initialState.test.ts` | `presetById` repointed; gains the three default-bass assertions |
| `src/store/synthSlice.ts:3,16` | reads `INITIAL_BASS_SYNTH_PARAMS`, not an array index |
| `src/store/loopSlice.ts:2-3,32` | same, plus `BASS_PATTERNS` repointed |
| `src/store/store.test.ts:5-8,184` | the positional bass assertion becomes an id lookup |
| `src/store/types.ts:17-18` | `SynthPresetItem` / `SynthPresetCategory` / `BassStepChoice` repointed to `@/data/` |
| `src/store/migrate.ts:1`, `presetsSlice.ts:2`, `sanitize.ts:13`, `customStepSequencer.test.ts:4` | type imports repointed |
| `src/store/engineSync.ts:5`, `projectFile.ts:1-3`, `bassSlice.ts:2` | table imports repointed |
| `src/store/vibeVariation.ts:2-4`, `vibeVariation.test.ts:137-140,295` | resolver vs table imports split across `@/audio/` and `@/data/` |
| `src/store/instantVibes.ts:4,7-9` | repointed; `drumPatternById` → `drumGridById` |
| `src/store/instantVibes.test.ts:4-6,365-366`, `instantVibesDrums.test.ts:4`, `instantVibesEffects.test.ts:4`, `instantVibesProgressions.test.ts:4`, `instantVibesChordsFixture.ts:2`, `vibeSynthPresets.test.ts:4` | imports only |
| `src/components/loop/SequencerView.tsx:17-18` | one import from `@/data/drumGrids`, one from `@/data/drumKits` |
| `src/components/loop/ChordView.tsx:56-60,79` | `SCALES` and `CHORD_PROGRESSIONS` repointed |
| `src/components/loop/ChordPresetLibrary.tsx:5-6,17`, `.test.tsx:5-6` | table vs resolver imports split |
| `src/components/loop/chord/progressionAvailability.ts:1-2` | `ChordProgression` and `SCALES` from `@/data/` |
| `src/components/loop/chord/useChordPlayback.ts:13-27`, `.test.ts:18-19` | split across `@/audio/chordRhythms` + `@/data/chordRhythms` + `@/data/bassPatterns` |
| `src/components/loop/chord/ChordModulePanel.tsx:4-9`, `BassModulePanel.tsx:4-12`, `PadModulePanel.tsx:7`, `PresetSelect.tsx:2`, `padPanel.ts:1-2`, `padPanel.test.ts:2`, `bassStepChoice.ts:1` | repointed |
| `src/components/loop/SynthPresetLibrary.tsx:12-19`, `SynthView.tsx:28` | split across `@/data/synthPresets` + `@/audio/presetRegistry` |
| `src/components/ui/Keyboard.tsx:2-10`, `StepRow.test.tsx:7`, `ChordView.test.tsx:312`, `Header.tsx:9` | repointed |
| `src/components/useInputDeck.ts:3` | `equalPowerVelocityScale` from `@/audio/chordRhythms` |
| `src/types.ts:249,255,257,283,297,302,309,322,332,337` | doc comments renamed to the new table names |
| `scripts/check-drum-kit-separation.ts:9-14` | `DEFAULT_DRUM_KIT` / `DRUM_KITS` from `../src/data/drumKits.ts`, `mergeDrumKit` from `../src/audio/drumKits.ts` |
| `tsconfig.json` | unchanged — `src/**/*` already covers `src/data/` |
| `CLAUDE.md:41-56` | the layer list becomes four layers with the `src/data/` rule stated |
| `.claude/skills/dsp-audio/SKILL.md:156,169` | paths and export names |
| `.claude/skills/music-theory/SKILL.md:8,25,33,39,50,88,105,113,116,122` | paths, table names, and three stale counts (40→44, 12→16, 15→21) |
| `.claude/skills/instant-vibes/SKILL.md:56,59,61,62,92,113,143-147` | paths and table names only — the procedure deletions are Part 2/3 |
| `.claude/skills/instant-vibes/references/authoring-libraries.md:35,98-101` | paths and the merged-array name |
| `.claude/skills/instant-vibes/scripts/vibe-inventory.ts:11-16,66-67,90,92-95` | repointed so the script still runs |

---

## Task 1: The `src/data/` eslint block and its fixture test

**Files:**
- Create: `src/data/dataLayerPurity.test.ts`
- Modify: `eslint.config.js:68-75` (correct the false comment), `eslint.config.js:136` (insert the new block after the components layering block, before the trailing test-file exception block)

**Interfaces:**
- Consumes: `ESLint` from `eslint` (v10.9.1, already a devDependency); `describe` / `expect` / `test` from `bun:test`.
- Produces: no importable symbol. It produces the eslint config block that every later task is written against, and the committed proof that the block behaves as measured.

**Design notes for the implementer:**
- `ESLint#lintText(source, { filePath })` does **not** require the file to exist. The fixtures are string constants inside the committed test; nothing is written to `src/data/` for a real `eslint .` run to trip over.
- The block carries `ignores: ['src/data/**/*.test.ts']`. Data tests are colocated with their tables (Tasks 2 and 5), and a test file necessarily imports `bun:test` at runtime. Excluding them is what lets the folder rule stay absolute for the files it is actually about.
- Assert only on the four guarded rule ids. `@typescript-eslint/no-unused-vars` is `error` in the recommended set and will fire on some fixtures; filtering by rule id keeps the test about the bans.

- [ ] **Step 1: Write the failing test**

Create `src/data/dataLayerPurity.test.ts`:

```ts
/**
 * The committed proof that the three `src/data/` bans are actually armed.
 *
 * Every row below was measured by hand while the spec was written (see
 * "Enforcement in eslint.config.js"). This test is what KEEPS them measured:
 * the whole "a helper in src/data/ is pure by construction" argument rests on
 * three rules that live in a config file, and a config file is exactly the kind
 * of thing an eslint or typescript-eslint upgrade loosens silently — a renamed
 * option, a changed `allowTypeImports` default, a selector that stops matching.
 *
 * Severity is asserted, not just presence. `bun run verify` tolerates warnings,
 * and the global `no-restricted-syntax` entry this block replaces is 'warn', so
 * a block that landed at the wrong severity would pass a presence-only test and
 * enforce nothing.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

/**
 * A path that does not exist. `lintText` uses it only to resolve which config
 * blocks apply, so no scratch file is left in src/ for a real lint run to pick
 * up. It deliberately does NOT end in `.test.ts`: the block ignores those.
 */
const FIXTURE_PATH = 'src/data/__purityFixture__.ts';

/** The four rule ids the block is responsible for. Everything else is noise. */
const GUARDED = new Set([
  'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports',
  'no-restricted-globals',
  'no-restricted-syntax',
]);

const eslint = new ESLint({ cwd: process.cwd() });

async function guardedMessages(source: string) {
  const [result] = await eslint.lintText(source, { filePath: FIXTURE_PATH });
  return (result?.messages ?? [])
    .filter((m) => GUARDED.has(m.ruleId ?? ''))
    .map((m) => ({ ruleId: m.ruleId, severity: m.severity }));
}

const err = (ruleId: string) => ({ ruleId, severity: 2 });
const IMPORT_BAN = '@typescript-eslint/no-restricted-imports';

describe('src/data/ import ban', () => {
  test('a type-only import is allowed', async () => {
    expect(
      await guardedMessages(
        "import type { MeterId } from '@/utils/meter';\nexport const M: MeterId = '4/4';\n",
      ),
    ).toEqual([]);
  });

  test('a value import from another folder is an error', async () => {
    expect(
      await guardedMessages(
        "import { METERS } from '../utils/meter';\nexport const M = METERS;\n",
      ),
    ).toContainEqual(err(IMPORT_BAN));
  });

  test('an aliased value import is an error', async () => {
    expect(
      await guardedMessages(
        "import { SCALES } from '@/utils/musicTheory';\nexport const S = SCALES;\n",
      ),
    ).toContainEqual(err(IMPORT_BAN));
  });

  test('a bare package import is an error', async () => {
    expect(
      await guardedMessages("import { Note } from 'tonal';\nexport const N = Note;\n"),
    ).toContainEqual(err(IMPORT_BAN));
  });

  // The independent-leaf invariant: src/data/ files may not read each other
  // either, so the folder has no evaluation graph and no temporal-dead-zone
  // failure mode. Nothing in the design needs a carve-out for this.
  test('a same-folder sibling import is an error', async () => {
    expect(
      await guardedMessages("import { SIB } from './sibling';\nexport const S = SIB;\n"),
    ).toContainEqual(err(IMPORT_BAN));
  });
});

describe('src/data/ impure-global ban', () => {
  test('Math is an error', async () => {
    expect(await guardedMessages('export const seed = Math.random();\n')).toContainEqual(
      err('no-restricted-globals'),
    );
  });

  test('Date is an error', async () => {
    expect(await guardedMessages('export const t = Date.now();\n')).toContainEqual(
      err('no-restricted-globals'),
    );
  });

  // The block REPLACES the global no-restricted-globals entry, so it has to
  // re-declare confirm/alert/prompt or they are silently un-banned here.
  test('confirm is still an error', async () => {
    expect(await guardedMessages("export const ok = confirm('x');\n")).toContainEqual(
      err('no-restricted-globals'),
    );
  });

  // Scope-aware: a local binding that shadows a banned name is untouched, which
  // is why this is no-restricted-globals and not an Identifier selector.
  test('a local binding named performance is allowed', async () => {
    expect(
      await guardedMessages(
        'const row = (performance: number) => ({ performance });\nexport const T = [row(1)];\n',
      ),
    ).toEqual([]);
  });
});

describe('src/data/ stateless-literal ban', () => {
  test('new is an error', async () => {
    expect(await guardedMessages('export const m = new Map();\n')).toContainEqual(
      err('no-restricted-syntax'),
    );
  });

  test('a function declaration is an error', async () => {
    expect(await guardedMessages('export function f() { return 1; }\n')).toContainEqual(
      err('no-restricted-syntax'),
    );
  });

  test('a module-scope let is an error', async () => {
    expect(await guardedMessages('let n = 0;\nexport const T = [n];\n')).toContainEqual(
      err('no-restricted-syntax'),
    );
  });

  // The export form is a child of ExportNamedDeclaration, not of Program, so a
  // single `Program >` selector misses it. This row is why there are two.
  test('an exported module-scope let is an error', async () => {
    expect(await guardedMessages('export let n = 0;\n')).toContainEqual(
      err('no-restricted-syntax'),
    );
  });

  // The allowed helper. A rule that rejects this is the rule mis-copied: `step`
  // is a shorter spelling of an object literal and the three bans above make it
  // pure, total and deterministic whatever it is written to do.
  test('a const arrow helper and a call to it are allowed', async () => {
    expect(
      await guardedMessages(
        'const step = (d: number) => ({ degree: d });\nexport const T = [step(0), step(1)];\n',
      ),
    ).toEqual([]);
  });

  test('satisfies and as const are untouched', async () => {
    expect(
      await guardedMessages(
        "export const T = { a: 1 } satisfies Record<string, number>;\nexport const U = ['x'] as const;\n",
      ),
    ).toEqual([]);
  });
});

describe('src/data/ inherits the global bans it replaces', () => {
  // The block replaces the global no-restricted-syntax entry (eslint.config.js
  // :58-87), which carries the React.FC and `../../` bans. Those are as true
  // inside src/data/ as anywhere, and the replacement must re-declare them —
  // at 'error' here, where the global entry is 'warn'.
  test('a ../../ import is an error, not a warning', async () => {
    expect(
      await guardedMessages(
        "import type { X } from '../../types';\nexport const T: X | null = null;\n",
      ),
    ).toContainEqual(err('no-restricted-syntax'));
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `bun test src/data/dataLayerPurity.test.ts`

Expected: FAIL — every `toContainEqual` assertion fails because no block matches `src/data/**` yet, so `guardedMessages` returns `[]` for the ban rows. The first failure reads roughly:

```
error: expect(received).toContainEqual(expected)
Expected to contain: { ruleId: "@typescript-eslint/no-restricted-imports", severity: 2 }
Received: []
```

The four "allowed" tests pass already; that is correct and expected — they must keep passing after the block lands.

- [ ] **Step 3: Correct the false comment in `eslint.config.js`**

Replace the comment at `eslint.config.js:68-75` (inside the global `no-restricted-syntax` array, immediately above the first `ImportDeclaration` selector):

```js
        // Decision D2, `../../` ban: the path-scoped layering blocks below
        // override only `no-restricted-imports` for their files, so a second
        // copy of that rule here would be shadowed the same way the original
        // one was. `no-restricted-syntax` is untouched by those blocks, so
        // this entry reaches every file, including src/audio, src/store and
        // src/components. Two or more `../` levels are banned; a single
        // `../` (same-folder-ish) is left alone.
```

with:

```js
        // Decision D2, `../../` ban: the path-scoped layering blocks below
        // override only `no-restricted-imports` for their files, so a second
        // copy of that rule here would be shadowed the same way the original
        // one was.
        //
        // `no-restricted-syntax` reaches every file EXCEPT `src/data/**`. That
        // one block sets the rule itself, and `no-restricted-syntax` is not
        // additive — a block that sets it REPLACES this entry — so the data
        // block re-declares all five objects below verbatim, at 'error'. The
        // same is true of `no-restricted-globals` above. If you add an entry
        // here, add it there too; nothing checks that for you except
        // src/data/dataLayerPurity.test.ts.
        //
        // Two or more `../` levels are banned; a single `../` is left alone.
```

- [ ] **Step 4: Add the `src/data/**` block to `eslint.config.js`**

Insert immediately after the closing `},` of the "Layering rule 3" block (currently ending at `eslint.config.js:136`) and before the trailing test-file exception block:

```js
  {
    // Layering rule 0: src/data/ holds literals and nothing else.
    //
    // Every file here is an INDEPENDENT LEAF — it imports nothing at runtime,
    // not even a sibling in this folder, so the folder has no evaluation graph
    // and no temporal-dead-zone failure mode. That is what lets a reviewer read
    // a 900-line table diff as content: nothing outside the open file can
    // influence what it evaluates to.
    //
    // Test files are excluded: a test necessarily imports bun:test at runtime,
    // and the rule is about the tables, not about what asserts on them.
    files: ['src/data/**/*.ts'],
    ignores: ['src/data/**/*.test.ts'],
    rules: {
      // The import ban. The base rule MUST be off for the TS-aware one to run —
      // measured: without this line the variant below never fires at all.
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**'],
              message: 'src/data/ holds literals: `import type` only.',
              allowTypeImports: true,
            },
          ],
        },
      ],

      // The impure-global ban. `no-restricted-globals` is scope-aware: it fires
      // on a GLOBAL reference and stays silent on a local binding that shadows
      // the name, so a table field or helper parameter called `performance` is
      // untouched. An `Identifier[name='Math']` syntax selector would flag both.
      // The list is a floor, not a ceiling — add to it rather than arguing
      // about whether a given global counts.
      //
      // This REPLACES the global no-restricted-globals entry (:46-51), so its
      // three native-prompt bans are re-declared verbatim at the end.
      'no-restricted-globals': [
        'error',
        ...[
          'Math', 'Date', 'crypto', 'fetch', 'performance', 'process', 'globalThis',
          'localStorage', 'sessionStorage', 'window', 'document',
        ].map((name) => ({ name, message: 'src/data/ is pure: no impure globals.' })),
        { name: 'confirm', message: 'Use ui/ConfirmDialog — confirm() blocks the main thread and cannot be themed.' },
        { name: 'alert', message: 'Use an inline role="alert" notice — alert() blocks the main thread and cannot be themed.' },
        { name: 'prompt', message: 'Use ui/Modal with a form — prompt() blocks the main thread and cannot be themed.' },
      ],

      // This REPLACES the global no-restricted-syntax entry (:58-87), so its
      // React.FC and `../../` bans are re-declared verbatim first — at 'error'
      // here, where the global entry is 'warn'. Neither is reachable in
      // practice (no JSX in a table, and `@/` covers cross-folder), but leaving
      // them out would silently un-ban `../../` in the one folder where every
      // import is a type import.
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSTypeReference[typeName.name='FC']",
          message: 'Use `export function X(props: XProps)` instead of React.FC (decision D1).',
        },
        {
          selector: "TSTypeReference[typeName.type='TSQualifiedName'][typeName.right.name='FC']",
          message: 'Use `export function X(props: XProps)` instead of React.FC (decision D1).',
        },
        {
          selector: "ImportDeclaration[source.value=/^\\.\\.\\/\\.\\.\\//]",
          message: 'Cross-folder imports use the `@/` alias (decision D2); relative paths only within one folder.',
        },
        {
          selector: "ExportNamedDeclaration[source.value=/^\\.\\.\\/\\.\\.\\//]",
          message: 'Cross-folder imports use the `@/` alias (decision D2); relative paths only within one folder.',
        },
        {
          selector: "ExportAllDeclaration[source.value=/^\\.\\.\\/\\.\\.\\//]",
          message: 'Cross-folder imports use the `@/` alias (decision D2); relative paths only within one folder.',
        },
        {
          selector: 'NewExpression',
          message: 'src/data/ holds literals: write the literal, not a constructed object.',
        },
        {
          selector: 'FunctionDeclaration',
          message: 'src/data/ holds literals: only top-level `const` arrow helpers.',
        },
        {
          selector: 'FunctionExpression',
          message: 'src/data/ holds literals: only top-level `const` arrow helpers.',
        },
        { selector: 'ClassDeclaration', message: 'src/data/ holds literals, not classes.' },
        { selector: 'ClassExpression', message: 'src/data/ holds literals, not classes.' },
        // Two selectors, not one: `export let n = 0` is a child of
        // ExportNamedDeclaration, not of Program. Escalating `prefer-const`
        // does NOT substitute — it only fires on a binding that is never
        // reassigned, so `let n = 0; n++` is the one case it deliberately
        // allows, and that is the exact case this ban exists to catch.
        {
          selector: 'Program > VariableDeclaration[kind=/^(let|var)$/]',
          message: 'src/data/ is stateless: module-scope bindings must be `const`.',
        },
        {
          selector: 'ExportNamedDeclaration > VariableDeclaration[kind=/^(let|var)$/]',
          message: 'src/data/ is stateless: module-scope bindings must be `const`.',
        },
      ],
    },
  },
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `bun test src/data/dataLayerPurity.test.ts`
Expected: PASS — 16 tests, 0 fail.

- [ ] **Step 6: Confirm the block breaks nothing that exists**

Run: `bun run eslint`
Expected: zero errors. `src/data/` currently holds one file and it is a `.test.ts`, which the block ignores.

- [ ] **Step 7: Run the gate and commit**

Run: `bun run verify`

```
git add eslint.config.js src/data/dataLayerPurity.test.ts
git commit -m "chore(eslint): add the src/data/ purity block and its fixture suite

src/data/ is empty, so the block lands at 'error' rather than warn-then-error:
there is nothing for it to fail, and the guard then checks the first table move
instead of being switched on after the last.

no-restricted-syntax and no-restricted-globals are not additive, so the block
re-declares the global entries it replaces. The comment at :68-75 said the
opposite and is corrected here."
```

---

## Task 2: Merge the preset arrays into `data/synthPresets.ts`, split off `audio/presetRegistry.ts`, and resolve the default bass patch by id

**This is the one change in Part 1 that can alter what the app sounds like without a test going red.** `FACTORY_BASS_PRESETS[0]` is `bass-deep-sine` ("Deep Sine Sub"), read positionally as the default bass patch in two slices and asserted the same way in `store.test.ts`. The merged array puts `factory-cosmic-lead` at index 0. Steps 2–5 below are ordered so that the engineer *sees* the guard fail against the merge before fixing the call sites. **Do not commit between Step 1 and Step 6.**

**Files:**
- Create: `src/data/synthPresets.ts`, `src/data/synthPresets.test.ts`, `src/audio/presetRegistry.ts`
- Rename: `src/audio/synthPresets.test.ts` → `src/audio/presetRegistry.test.ts`
- Delete: `src/audio/synthPresets.ts`, `src/audio/bassPresets.ts`, `src/audio/bassPresets.test.ts`
- Modify: `src/store/initialState.ts:2` + append; `src/store/initialState.test.ts:2` + append; `src/store/synthSlice.ts:3,16`; `src/store/loopSlice.ts:3,32`; `src/store/store.test.ts:5,8,184`; `src/store/types.ts:17`; `src/store/migrate.ts:1`; `src/store/presetsSlice.ts:2`; `src/store/instantVibes.ts:4`; `src/store/instantVibes.test.ts:6`; `src/store/vibeSynthPresets.test.ts:4`; `src/audio/playback/presetPreview.ts:4`; `src/components/loop/SynthPresetLibrary.tsx:12-19`; `src/components/loop/SynthView.tsx:28`; `src/components/loop/chord/ChordModulePanel.tsx:5-9`; `src/components/loop/chord/BassModulePanel.tsx:8-12`; `src/components/loop/chord/PadModulePanel.tsx:7`; `src/components/loop/chord/PresetSelect.tsx:2`; `src/components/loop/chord/padPanel.ts:2`; `src/components/loop/chord/padPanel.test.ts:2`; `src/types.ts:302,309,322,332`

**Interfaces:**
- Consumes: `SynthParams` (type, `@/types`); `INITIAL_SYNTH_PARAMS` (`src/store/initialState.ts`).
- Produces, from `@/data/synthPresets`:
  - `type SynthPresetCategory = 'Bass' | 'Lead' | 'Pad' | 'Keys' | 'Pluck' | 'Brass' | 'FX' | 'User'`
  - `interface SynthPresetCategoryMeta { id: SynthPresetCategory; label: string; shortLabel: string; badgeClass: string; description: string }`
  - `interface SynthPresetItem { id: string; name: string; category: SynthPresetCategory; params: Partial<SynthParams>; isFactory?: boolean; createdAt?: number; description?: string }`
  - `const SYNTH_CATEGORIES: SynthPresetCategoryMeta[]` — 8 entries
  - `const SYNTH_PRESETS: SynthPresetItem[]` — **29 entries**: today's 24 `FACTORY_PRESETS` in order, then today's 5 `FACTORY_BASS_PRESETS` in order
- Produces, from `@/audio/presetRegistry`:
  - `function applyPreset(base: SynthParams, preset: SynthPresetItem): SynthParams`
  - `function getAllSynthPresets(custom: SynthPresetItem[]): SynthPresetItem[]`
  - `function presetById(id: string): SynthPresetItem | undefined`
  - `function findPresetByName(name: string, presets: SynthPresetItem[]): SynthPresetItem | undefined`
  - `interface CategoryPresetGroup { category: SynthPresetCategory; label: string; badgeClass: string; description: string; presets: SynthPresetItem[] }`
  - `function getPresetsGroupedByCategory(allPresets: SynthPresetItem[]): CategoryPresetGroup[]`
  - `function getCategoryMeta(category: SynthPresetCategory): SynthPresetCategoryMeta`
- Produces, from `src/store/initialState.ts`:
  - `const DEFAULT_BASS_PRESET_ID = 'bass-deep-sine'`
  - `const INITIAL_BASS_SYNTH_PARAMS: SynthParams`
- Removed everywhere: `FACTORY_PRESETS`, `ALL_FACTORY_PRESETS`, `FACTORY_BASS_PRESETS`.

- [ ] **Step 1: Do the mechanical merge and split**

Create `src/data/synthPresets.ts`:

```ts
/**
 * The factory synth preset library — 29 patches in one array.
 *
 * The bass patches used to live in a sibling `bassPresets.ts` that
 * `synthPresets.ts` imported at runtime, with the type imported back the other
 * way: a cycle in which one direction carried a value. Merging ends the
 * FACTORY_PRESETS / ALL_FACTORY_PRESETS split AND removes the only runtime
 * sibling import among the tables this folder holds, which is what makes the
 * independent-leaf rule hold folder-wide.
 *
 * Ids are the contract. The five bass patches use a `bass-` prefix where the
 * other 24 use `factory-`; that inconsistency is now visible in one list and is
 * deliberately NOT fixed here — `bassPresetId` values are written into all
 * eight vibe specs, so renaming them would mix a content edit into a
 * mechanical move. If it is worth doing it is worth its own change.
 *
 * NEVER read this array positionally for a default. `SYNTH_PRESETS[0]` is a
 * lead patch; the default bass patch is `presetById(DEFAULT_BASS_PRESET_ID)`
 * and the default pad patch is `presetById(PAD_DEFAULT_PRESET_ID)`, both in
 * store/initialState.ts.
 */
import type { SynthParams } from '@/types';

export type SynthPresetCategory =
  | 'Bass'
  | 'Lead'
  | 'Pad'
  | 'Keys'
  | 'Pluck'
  | 'Brass'
  | 'FX'
  | 'User';

export interface SynthPresetCategoryMeta {
  id: SynthPresetCategory;
  label: string;
  shortLabel: string;
  badgeClass: string;
  description: string;
}

export const SYNTH_CATEGORIES: SynthPresetCategoryMeta[] = [
  /* … the 8 entries from audio/synthPresets.ts:22-79, verbatim … */
];

export interface SynthPresetItem {
  id: string;
  name: string;
  category: SynthPresetCategory;
  params: Partial<SynthParams>;
  isFactory?: boolean;
  /**
   * Written by presetsSlice on save. Nothing in src/ reads it today, but it is
   * persisted user data inside `customSynthPresets` — dropping the write would
   * silently strip the only chronology existing saved presets have, for the
   * cost of one number. Kept deliberately.
   */
  createdAt?: number;
  description?: string;
}

export const SYNTH_PRESETS: SynthPresetItem[] = [
  /* … the 24 entries from audio/synthPresets.ts:107-804, verbatim and in order …
     … then the 5 entries from audio/bassPresets.ts:3-43, verbatim and in order … */
];
```

Move the bodies with an editor, not by retyping. `SYNTH_CATEGORIES` comes from `src/audio/synthPresets.ts:22-79`; the 24 factory patches from `:107-804` (the array body of `FACTORY_PRESETS`); the 5 bass patches from `src/audio/bassPresets.ts:4-42`. **Not one character of any params object changes.**

Create `src/audio/presetRegistry.ts` with the six functions and `CategoryPresetGroup` lifted verbatim from `src/audio/synthPresets.ts:96-886`, with three edits:

```ts
/**
 * Lookups, merges and groupings over SYNTH_PRESETS. Every export here is a
 * computation, which is why none of it lives in src/data/.
 */
import type {
  SynthPresetCategory,
  SynthPresetCategoryMeta,
  SynthPresetItem,
} from '@/data/synthPresets';
import { SYNTH_CATEGORIES, SYNTH_PRESETS } from '@/data/synthPresets';
import type { SynthParams } from '../types';

/**
 * Load a preset over a base patch. The three call sites (SynthView's preset
 * picker, the audition preview, and instantVibes' library resolver) all wrote
 * this same three-line spread, and all three overwrite `params.preset` with the
 * preset's name — which is why no preset needs to carry its own name in params.
 */
export function applyPreset(base: SynthParams, preset: SynthPresetItem): SynthParams {
  return { ...base, ...preset.params, preset: preset.name };
}

export function getAllSynthPresets(custom: SynthPresetItem[]): SynthPresetItem[] {
  return [...custom, ...SYNTH_PRESETS];
}

/**
 * Library reference resolution: id -> preset. Ids are stable and are referenced
 * by the Instant Vibes table and by the two resolved-at-boot defaults in
 * store/initialState.ts.
 *
 * They do NOT reach a .solna body: a loop stores resolved SynthParams, not a
 * preset id, and the only preset id that persists at all is a user-authored
 * `user-preset-<timestamp>-<rand>` inside `customSynthPresets`, which is in
 * `partialize` but not in PROJECT_CONTENT_KEYS. This comment used to claim
 * otherwise; the claim was false and is how a constraint that belongs to
 * nothing spreads.
 */
export function presetById(id: string): SynthPresetItem | undefined {
  if (!id) return undefined;
  return SYNTH_PRESETS.find((p) => p.id === id);
}

export function findPresetByName(
  name: string,
  presets: SynthPresetItem[],
): SynthPresetItem | undefined {
  if (!name) return undefined;
  return presets.find((p) => p.name === name);
}

export interface CategoryPresetGroup {
  category: SynthPresetCategory;
  label: string;
  badgeClass: string;
  description: string;
  presets: SynthPresetItem[];
}

/* getPresetsGroupedByCategory and getCategoryMeta move verbatim from
   audio/synthPresets.ts:842-886; they already read SYNTH_CATEGORIES by name. */
```

Then, in one pass:

- Delete `src/audio/synthPresets.ts` and `src/audio/bassPresets.ts`.
- `git mv src/audio/synthPresets.test.ts src/audio/presetRegistry.test.ts` and repoint its imports: `SYNTH_CATEGORIES` and the `SynthPresetItem` type to `@/data/synthPresets`; `getAllSynthPresets`, `findPresetByName`, `getCategoryMeta`, `getPresetsGroupedByCategory`, `presetById` to `./presetRegistry`. Its `:37-38` assertions become `expect(all).toContain(SYNTH_PRESETS[0])` and `expect(all).toContain(SYNTH_PRESETS[SYNTH_PRESETS.length - 1])`; its `:44,48,52` `findPresetByName(..., FACTORY_BASS_PRESETS)` arguments become `SYNTH_PRESETS`; its `:214,220` test names become "every preset id in SYNTH_PRESETS is unique" / "every preset name in SYNTH_PRESETS is unique".
- Repoint every import site listed under **Files** above. Type-only imports (`SynthPresetItem`, `SynthPresetCategory`, `CategoryPresetGroup`) split: the first two come from `@/data/synthPresets`, `CategoryPresetGroup` from `@/audio/presetRegistry`.
- In `src/store/synthSlice.ts:3,16` and `src/store/loopSlice.ts:3,32`, replace the `FACTORY_BASS_PRESETS` import with `import { SYNTH_PRESETS } from '@/data/synthPresets';` and the expression with `{ ...INITIAL_SYNTH_PARAMS, ...SYNTH_PRESETS[0].params }`.
- In `src/store/store.test.ts:5`, replace the `FACTORY_BASS_PRESETS` import the same way, and `:184` with `expect(s.bassSynthParams).toEqual({ ...INITIAL_SYNTH_PARAMS, ...SYNTH_PRESETS[0].params });`.
- Update the four doc comments at `src/types.ts:302,309,322,332`: "Library reference into ALL_FACTORY_PRESETS" → "Library reference into SYNTH_PRESETS".

This is the *mechanical* substitution the spec warns about, and it is deliberately wrong. Steps 2–5 fix it.

- [ ] **Step 2: Observe that the existing assertion follows the bug**

Run: `bun test src/store/store.test.ts`

Expected: **PASS.** Record this. `store.test.ts:184` asserts against the same expression the slices evaluate, so it agrees with whatever the slices do — including now, when both defaults have silently become `factory-cosmic-lead`, a sawtooth Lead patch, instead of `bass-deep-sine`, a sine sub. This is exactly the failure mode the spec calls "the one genuinely dangerous item"; a test that reads the same index on both sides passes against the bug it exists to catch.

Sanity-check what actually changed:

Run: `bun -e "const {SYNTH_PRESETS}=await import('./src/data/synthPresets.ts'); console.log(SYNTH_PRESETS.length, SYNTH_PRESETS[0].id, SYNTH_PRESETS[0].params.oscType)"`
Expected: `29 factory-cosmic-lead sawtooth`

- [ ] **Step 3: Write the id-pinned guard and watch it fail**

Replace `src/store/store.test.ts:184` with:

```ts
    // Pinned by ID, never by index. `bass-deep-sine` was FACTORY_BASS_PRESETS[0]
    // before the arrays merged; SYNTH_PRESETS[0] is `factory-cosmic-lead`, a
    // Lead patch. Asserting the same index the slice reads makes this test agree
    // with the bug instead of catching it — which is what it did, verbatim,
    // until this line. Revert to an index and this must go red.
    const defaultBassPreset = presetById(DEFAULT_BASS_PRESET_ID);
    expect(defaultBassPreset).toBeDefined();
    expect(defaultBassPreset!.category).toBe('Bass');
    expect(s.bassSynthParams).toEqual({
      ...INITIAL_SYNTH_PARAMS,
      ...defaultBassPreset!.params,
    });
```

and add to its imports:

```ts
import { presetById } from '../audio/presetRegistry';
import { DEFAULT_BASS_PRESET_ID } from './initialState';
```

Run: `bun test src/store/store.test.ts`

Expected: **FAIL**, twice over:

1. `SyntaxError: Export named 'DEFAULT_BASS_PRESET_ID' not found in module .../src/store/initialState.ts`

Add the constant alone (`export const DEFAULT_BASS_PRESET_ID = 'bass-deep-sine';` at the end of `src/store/initialState.ts`) and re-run to reach the assertion failure that matters:

2. `expect(received).toEqual(expected)` on `s.bassSynthParams`, with the diff naming the swapped patch — received `"oscType": "sawtooth"`, `"filterCutoff": 3500`, `"preset"` absent; expected `"oscType": "sine"`, `"filterCutoff": 220`, `"subOscVolume": 0.9`.

**That second failure is the deliverable of this step.** It is the proof that the guard catches the exact regression the merge introduces. Do not proceed until you have seen it.

- [ ] **Step 4: Resolve the default bass patch by id**

Append to `src/store/initialState.ts`, directly above the pad block so the two resolved-at-boot defaults sit together (`DEFAULT_BASS_PRESET_ID` from Step 3 is already there — replace it with this):

```ts
/**
 * The Bass-category factory preset a fresh bass module starts from.
 *
 * Resolved by ID, never by index. This was `FACTORY_BASS_PRESETS[0]` in
 * synthSlice.ts and loopSlice.ts until the preset arrays merged, at which point
 * index 0 became `factory-cosmic-lead` and both defaults silently turned into a
 * lead patch — with store.test.ts agreeing, because it asserted against the
 * same index expression. store.test.ts now pins this id and initialState.test.ts
 * pins that it resolves; reverting either to an index turns both red.
 */
export const DEFAULT_BASS_PRESET_ID = 'bass-deep-sine';

const DEFAULT_BASS_PRESET = presetById(DEFAULT_BASS_PRESET_ID);

/**
 * The shared synth defaults with the bass preset laid over them.
 *
 * Deliberately NOT `applyPreset(...)`: applyPreset also stamps
 * `preset: preset.name`, and today's default carries no `preset` field. Using
 * it here would change a persisted default value, which this refactor forbids.
 *
 * Falls back to the bare defaults if the id ever stops resolving —
 * initialState.test.ts is what makes that fallback loud instead of silent.
 */
export const INITIAL_BASS_SYNTH_PARAMS: SynthParams = DEFAULT_BASS_PRESET
  ? { ...INITIAL_SYNTH_PARAMS, ...DEFAULT_BASS_PRESET.params }
  : INITIAL_SYNTH_PARAMS;
```

Then:
- `src/store/synthSlice.ts` — drop the `SYNTH_PRESETS` import, change line 2 to `import { INITIAL_BASS_SYNTH_PARAMS, INITIAL_SYNTH_PARAMS } from './initialState';`, and line 16 to `bassSynthParams: INITIAL_BASS_SYNTH_PARAMS,`.
- `src/store/loopSlice.ts` — drop the `SYNTH_PRESETS` import, add `INITIAL_BASS_SYNTH_PARAMS` to the existing `./initialState` import block, and change line 32 to `bassSynthParams: INITIAL_BASS_SYNTH_PARAMS,`.

- [ ] **Step 5: Run the guard and watch it pass**

Run: `bun test src/store/store.test.ts`
Expected: PASS.

Now add the sibling assertions to `src/store/initialState.test.ts` (append inside a new `describe`, and add `DEFAULT_BASS_PRESET_ID, INITIAL_BASS_SYNTH_PARAMS` to the existing `./initialState` import and repoint `presetById` at `:2` to `'../audio/presetRegistry'`):

```ts
describe('bass defaults', () => {
  test('the default bass preset id resolves to a Bass-category preset', () => {
    const preset = presetById(DEFAULT_BASS_PRESET_ID);
    expect(preset?.category).toBe('Bass');
  });

  test('INITIAL_BASS_SYNTH_PARAMS is the resolved preset, not the bare synth default', () => {
    const preset = presetById(DEFAULT_BASS_PRESET_ID);
    expect(INITIAL_BASS_SYNTH_PARAMS.oscType).toBe(preset!.params.oscType!);
    expect(INITIAL_BASS_SYNTH_PARAMS.filterCutoff).toBe(preset!.params.filterCutoff!);
  });

  // applyPreset stamps `preset: preset.name`; the historical bass default did
  // not. Keeping the field absent is what makes this a move and not a change.
  test('the bass default carries no preset name, matching the pre-merge value', () => {
    expect(INITIAL_BASS_SYNTH_PARAMS.preset).toBe(INITIAL_SYNTH_PARAMS.preset);
  });
});
```

Run: `bun test src/store/initialState.test.ts`
Expected: PASS.

**Mutation check.** Temporarily change `synthSlice.ts:16` back to `{ ...INITIAL_SYNTH_PARAMS, ...SYNTH_PRESETS[0].params }`, run `bun test src/store/store.test.ts`, confirm it goes **red**, then revert. A guard you have not seen fail is not a guard.

- [ ] **Step 6: Move the table-only tests into `src/data/`**

Create `src/data/synthPresets.test.ts` carrying the three tests from the deleted `src/audio/bassPresets.test.ts`, with their subject rewritten from the array that no longer exists to the ids it held. **No asserted value changes: the count is still 5, the category is still `'Bass'`, and `params.preset` is still undefined.**

```ts
import { describe, expect, test } from 'bun:test';
import { SYNTH_PRESETS } from './synthPresets';

/**
 * The five patches that used to be FACTORY_BASS_PRESETS, pinned by id.
 *
 * Written out rather than derived with `.filter(p => p.category === 'Bass')`:
 * four `factory-` presets are also category Bass, so a filter would assert 9
 * and change the value this test has always pinned. The id list is what makes
 * "the five bass patches survived the merge" checkable at all.
 */
const BASS_PRESET_IDS = [
  'bass-deep-sine',
  'bass-round-pluck',
  'bass-punchy-square',
  'bass-saw-growl',
  'bass-warm-tri',
];

describe('bass presets', () => {
  test('every bass preset is category Bass', () => {
    // InstantVibe.bassPresetId is documented as having to resolve to category
    // 'Bass'; a mis-categorised preset makes a vibe load a lead patch onto the
    // bass bus.
    for (const id of BASS_PRESET_IDS) {
      const p = SYNTH_PRESETS.find((entry) => entry.id === id);
      expect(p, id).toBeDefined();
      expect(p!.category, p!.name).toBe('Bass');
    }
    expect(BASS_PRESET_IDS.length).toBe(5);
  });

  test('ids are unique across the whole factory library', () => {
    const ids = SYNTH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no preset pins its own name into params.preset', () => {
    // Every merge site overwrites it with the preset's name anyway; carrying a
    // copy in the data means two places to keep in sync for zero effect.
    for (const p of SYNTH_PRESETS) {
      expect(p.params.preset, p.name).toBeUndefined();
    }
  });

  test('the merged library is 29 entries', () => {
    // 24 factory + 5 bass. A count, not a cap: it is here so that adding a
    // preset is a deliberate two-line change rather than an accident of a
    // merge conflict.
    expect(SYNTH_PRESETS.length).toBe(29);
  });
});
```

Delete `src/audio/bassPresets.test.ts`.

- [ ] **Step 7: Run the gate and commit**

Run: `bun run verify`

```
git add -A src/data/synthPresets.ts src/data/synthPresets.test.ts src/audio/presetRegistry.ts src/audio/presetRegistry.test.ts src/audio/synthPresets.ts src/audio/synthPresets.test.ts src/audio/bassPresets.ts src/audio/bassPresets.test.ts src/store src/audio/playback/presetPreview.ts src/components src/types.ts
git commit -m "refactor(data): merge the preset arrays into src/data/synthPresets

FACTORY_PRESETS (24) + FACTORY_BASS_PRESETS (5) become one 29-entry
SYNTH_PRESETS, ending the FACTORY_PRESETS / ALL_FACTORY_PRESETS split and
removing the only runtime sibling import among the prospective src/data/ files.
Lookups, merges and groupings move to audio/presetRegistry.ts.

The merge moves bass-deep-sine off index 0, so the two positional default-bass
reads in synthSlice and loopSlice now resolve by id through
INITIAL_BASS_SYNTH_PARAMS, and store.test.ts asserts against the id instead of
the index it used to share with the code under test."
```

---

## Task 3: `SCALES` moves to `data/scales.ts`

**Files:**
- Create: `src/data/scales.ts`
- Modify: `src/utils/musicTheory.ts:8-104` (delete `ScaleDefinition` and `SCALES`, re-export from `@/data/scales`); `src/utils/musicTheory.test.ts`; `src/components/Header.tsx:9`; `src/components/ui/Keyboard.tsx:2-10`; `src/components/loop/ChordView.tsx:56-60`; `src/components/loop/ChordPresetLibrary.test.tsx:6`; `src/components/loop/chord/progressionAvailability.ts:2`; `src/components/loop/chord/padPanel.ts:1`; `src/components/loop/chord/padPanel.test.ts`; `src/audio/bassPatterns.ts:3`; `src/audio/data/chordProgressions.ts` and `.test.ts` and `.migration.test.ts`; `src/store/instantVibes.test.ts:365`; `src/store/vibeVariation.test.ts:140`

**Interfaces:**
- Consumes: nothing.
- Produces, from `@/data/scales`:
  - `interface ScaleDefinition { name: string; category: 'Major / Minor' | 'Modal' | 'Pentatonic & Blues' | 'World & Exotic'; intervals: number[]; triadQualities: string[]; seventhQualities: string[] }`
  - `const SCALES: Record<string, ScaleDefinition>` — 11 entries, keys `Major`, `Natural Minor`, …, `Hirajoshi`
- `src/utils/musicTheory.ts` keeps `ROOTS`, `RootNote` and every function, and re-exports `SCALES` / `ScaleDefinition` so its 15 existing consumers are not all forced to change in one commit.

**Why `ROOTS` does not move:** it is the chromatic *spelling convention* that `getScaleNotes`, `transposePitchClass` and `rootSemitone` are each written against. Moving it would separate a convention from the three functions that enforce it. `SCALES` is different — it is authored content that grows, and `progressionAvailability.ts`, `bassPatterns.ts` and `padPanel.ts` all read it as a table.

- [ ] **Step 1: Write the failing test**

Create `src/data/scales.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { SCALES } from './scales';

describe('SCALES', () => {
  test('holds 11 scales', () => {
    expect(Object.keys(SCALES).length).toBe(11);
  });

  test('every scale has one triad and one seventh quality per degree', () => {
    // getDiatonicChordForDegree indexes both arrays by degree; a short array
    // hands back `undefined` and the chord silently loses its quality.
    for (const [key, scale] of Object.entries(SCALES)) {
      expect(scale.triadQualities.length, key).toBe(scale.intervals.length);
      expect(scale.seventhQualities.length, key).toBe(scale.intervals.length);
    }
  });

  test('every scale starts on the root', () => {
    for (const [key, scale] of Object.entries(SCALES)) {
      expect(scale.intervals[0], key).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `bun test src/data/scales.test.ts`
Expected: FAIL — `Cannot find module './scales' from '.../src/data/scales.test.ts'`

- [ ] **Step 3: Create `src/data/scales.ts`**

Move `ScaleDefinition` (`src/utils/musicTheory.ts:8-14`) and `SCALES` (`:16-104`) verbatim, including every inline comment inside the Hirajoshi entry:

```ts
/**
 * The scale library: 11 hand-authored scales, each with its interval set and a
 * per-degree triad and seventh quality.
 *
 * Authored content, not a system registry: adding a scale is an edit to this
 * table and nothing else, which is the test that decides what belongs in
 * src/data/. ROOTS stays in utils/musicTheory.ts — it is a spelling convention
 * inseparable from the three functions that enforce it, not a library.
 *
 * The qualities are hand-written per degree rather than derived from interval
 * distances. Deriving them is real work with a visible output change (see the
 * spec's "Music theory rework", out of scope) — until then the arrays are the
 * contract and musicTheory.test.ts pins them.
 */
export interface ScaleDefinition {
  name: string;
  category: 'Major / Minor' | 'Modal' | 'Pentatonic & Blues' | 'World & Exotic';
  intervals: number[]; // semitone intervals from root [0, 2, 4, 5, 7, 9, 11]
  triadQualities: string[]; // chord quality for each scale degree: e.g. ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim']
  seventhQualities: string[]; // 7th chord quality: e.g. ['maj7', 'min7', 'min7', 'maj7', '7', 'min7', 'm7b5']
}

export const SCALES: Record<string, ScaleDefinition> = {
  /* … the 11 entries from utils/musicTheory.ts:16-104, verbatim … */
};
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `bun test src/data/scales.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Point `utils/musicTheory.ts` at the data module**

Delete lines 8-104 of `src/utils/musicTheory.ts` and put in their place:

```ts
// SCALES is authored content and lives in src/data/, below this file in the
// layering: data -> audio -> store -> components, with utils/ reading data/ and
// never the reverse. Re-exported here because 15 modules import it from this
// path today and a rename is not what this change is about.
export type { ScaleDefinition } from '@/data/scales';
export { SCALES } from '@/data/scales';
import { SCALES } from '@/data/scales';
```

- [ ] **Step 6: Run the theory and consumer suites**

Run: `bun test src/utils/musicTheory.test.ts src/audio/bassPatterns.test.ts src/components/loop/chord/padPanel.test.ts`
Expected: PASS, with no asserted value changed.

- [ ] **Step 7: Repoint the direct table consumers**

The re-export keeps everything compiling, but a consumer that reads `SCALES` **as a table** should say so. Change these four to `import { SCALES } from '@/data/scales';`, leaving their function imports on `musicTheory`:

- `src/components/loop/chord/progressionAvailability.ts:2`
- `src/components/loop/chord/padPanel.ts:1` (keep `getDiatonicChordForDegree` from `@/utils/musicTheory`)
- `src/audio/bassPatterns.ts:3` (keep `rootSemitone`, `stepDurationSec` from `../utils/musicTheory`)
- `src/components/loop/ChordView.tsx:56-60` (keep the rest of the block)

Leave `Header.tsx`, `Keyboard.tsx` and the test files on the re-export; they import `ROOTS` from the same statement and splitting them buys nothing.

- [ ] **Step 8: Run the gate and commit**

Run: `bun run verify`

```
git add src/data/scales.ts src/data/scales.test.ts src/utils/musicTheory.ts src/components/loop/chord/progressionAvailability.ts src/components/loop/chord/padPanel.ts src/audio/bassPatterns.ts src/components/loop/ChordView.tsx
git commit -m "refactor(data): move SCALES into src/data/scales

utils/musicTheory.ts keeps ROOTS and every function and re-exports SCALES, so
its 15 consumers keep one import path; the four modules that read SCALES as a
table now import it from src/data/ directly."
```

---

## Task 4: `DRUM_KITS` and `DEFAULT_DRUM_KIT` move to `data/drumKits.ts`

**Files:**
- Create: `src/data/drumKits.ts`
- Modify: `src/audio/drumKits.ts` (reduced to `mergeDrumKit`); `src/audio/drumKits.test.ts:2`; `src/audio/engine.ts:11`; `src/audio/engine.test.ts:5`; `src/store/engineSync.ts:5`; `src/store/projectFile.ts:2`; `src/components/loop/SequencerView.tsx:18`; `scripts/check-drum-kit-separation.ts:9-14`

**Interfaces:**
- Consumes: nothing.
- Produces, from `@/data/drumKits`:
  - `interface KickParams { freqStart: number; freqEnd: number; pitchTime: number; decay: number; gain: number; clickFreq?: number; clickLevel?: number; clickDecay?: number }`
  - `interface SnareParams { bodyFreqStart: number; bodyFreqEnd: number; bodyTime: number; bodyDecay: number; bodyGain: number; noiseFilter: number; noiseDecay: number; noiseGain: number; reverbSend: number }`
  - `interface HatParams { filter: number; decay: number; gain: number }`
  - `interface ClapParams { filter: number; decay: number; gain: number; reverbSend: number }`
  - `interface TomParams { freqStart: number; freqEnd: number; pitchTime: number; decay: number; gain: number }`
  - `interface CrashParams { filter: number; decay: number; gain: number; reverbSend: number }`
  - `interface DrumKit { kick: KickParams; snare: SnareParams; hihat: HatParams; openhat: HatParams; clap: ClapParams; tom: TomParams; crash: CrashParams }`
  - `const DEFAULT_DRUM_KIT: DrumKit`
  - `const DRUM_KITS: Record<string, Partial<DrumKit>>` — 12 entries
- Produces, still from `@/audio/drumKits`: `function mergeDrumKit(partial?: Partial<DrumKit>): DrumKit`
- **`GENRE_TO_KIT` stays in `src/audio/drumKits.ts` for this task only.** Task 5 moves it to `@/data/drumGrids`, where it belongs — it maps a genre string to a kit *name string*, and it is the sequencer's genre picker that reads it. Leaving it here for one commit keeps the two moves separately reviewable.

- [ ] **Step 1: Write the failing test**

Create `src/data/drumKits.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_DRUM_KIT, DRUM_KITS } from './drumKits';

const DRUM_TYPES = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'] as const;

describe('DRUM_KITS', () => {
  test('holds 12 kits', () => {
    expect(Object.keys(DRUM_KITS).length).toBe(12);
  });

  test('the default kit defines every drum type', () => {
    // mergeDrumKit spreads DEFAULT_DRUM_KIT under each partial, so a missing
    // type here is an `undefined` params object reaching the engine.
    for (const type of DRUM_TYPES) {
      expect(DEFAULT_DRUM_KIT[type], type).toBeDefined();
    }
  });

  test('no kit introduces a drum type the default does not have', () => {
    for (const [name, kit] of Object.entries(DRUM_KITS)) {
      for (const type of Object.keys(kit)) {
        expect(DRUM_TYPES, `${name}.${type}`).toContain(type as (typeof DRUM_TYPES)[number]);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `bun test src/data/drumKits.test.ts`
Expected: FAIL — `Cannot find module './drumKits' from '.../src/data/drumKits.test.ts'`

- [ ] **Step 3: Create `src/data/drumKits.ts`**

Move `src/audio/drumKits.ts:1-181` verbatim — the six param interfaces (`:1-50`), `DrumKit` (`:52-60`), `DEFAULT_DRUM_KIT` (`:62-70`) and `DRUM_KITS` (`:72-181`) — under this head comment:

```ts
/**
 * The drum-kit library: 12 kits, each a `Partial<DrumKit>` laid over
 * DEFAULT_DRUM_KIT by `mergeDrumKit` in audio/drumKits.ts.
 *
 * Kit NAMES are the persisted key (`loop.soundKit`), so renaming one is a
 * project-file change, not a cosmetic edit. `check:drums` asserts that the 12
 * stay audibly distinct — a kit that merely differs on paper is not a kit.
 */
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `bun test src/data/drumKits.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Reduce `src/audio/drumKits.ts` and repoint its consumers**

`src/audio/drumKits.ts` becomes:

```ts
import { DEFAULT_DRUM_KIT, type DrumKit } from '@/data/drumKits';

// The genre picker's kit pairing. Moves to data/drumGrids.ts with DRUM_GRIDS —
// it maps a genre to a kit NAME string, and the sequencer reads the two
// together.
export const GENRE_TO_KIT: Record<string, string> = {
  /* … the 14 entries from drumKits.ts:183-198, verbatim … */
};

/** A kit is a partial; this is the merge that makes it whole. */
export function mergeDrumKit(partial?: Partial<DrumKit>): DrumKit {
  /* … verbatim from drumKits.ts:200-210 … */
}
```

Repoint:
- `src/audio/engine.ts:11` → `import { mergeDrumKit } from './drumKits';` and `import type { DrumKit } from '@/data/drumKits';`
- `src/audio/engine.test.ts:5` → `import { DEFAULT_DRUM_KIT } from '@/data/drumKits';`
- `src/audio/drumKits.test.ts:2` → `import { GENRE_TO_KIT, mergeDrumKit } from './drumKits';` plus `import { DEFAULT_DRUM_KIT, DRUM_KITS } from '@/data/drumKits';`
- `src/store/engineSync.ts:5` → `import { DRUM_KITS } from '@/data/drumKits';`
- `src/store/projectFile.ts:2` → `import { DRUM_KITS } from '@/data/drumKits';`
- `src/components/loop/SequencerView.tsx:18` → `import { DRUM_KITS } from "@/data/drumKits";` and `import { GENRE_TO_KIT } from "../../audio/drumKits";`
- `scripts/check-drum-kit-separation.ts:9-14` → `import { DEFAULT_DRUM_KIT, DRUM_KITS } from '../src/data/drumKits.ts';` and `import { mergeDrumKit } from '../src/audio/drumKits.ts';`

- [ ] **Step 6: Run the gate and commit**

Run: `bun run verify` (this exercises `check:drums`, which imports the moved table directly)

```
git add src/data/drumKits.ts src/data/drumKits.test.ts src/audio/drumKits.ts src/audio/drumKits.test.ts src/audio/engine.ts src/audio/engine.test.ts src/store/engineSync.ts src/store/projectFile.ts src/components/loop/SequencerView.tsx scripts/check-drum-kit-separation.ts
git commit -m "refactor(data): move DRUM_KITS and DEFAULT_DRUM_KIT into src/data/

audio/drumKits.ts keeps mergeDrumKit — a merge over the table — and GENRE_TO_KIT
for one more commit; the next change moves that to data/drumGrids.ts, where the
sequencer reads it alongside the grids."
```

---

## Task 5: `GENRE_PRESETS` becomes `DRUM_GRIDS` in `data/drumGrids.ts`, with `GENRE_TO_KIT`

**Files:**
- Create: `src/data/drumGrids.ts`, `src/data/drumGrids.test.ts` (from `src/audio/data/genrePresets.test.ts`)
- Delete: `src/audio/data/genrePresets.ts`, `src/audio/data/genrePresets.test.ts`
- Modify: `src/audio/drumKits.ts` (drop `GENRE_TO_KIT`); `src/audio/drumKits.test.ts`; `src/audio/meterRegression.test.ts:16`; `src/store/store.test.ts`; `src/components/loop/SequencerView.tsx:17-18`; `src/utils/patternAdapt.ts:5`

**Interfaces:**
- Consumes: `MeterId` (type, `@/utils/meter`).
- Produces, from `@/data/drumGrids`:
  - `interface DrumGrid { meter: MeterId; rows: Record<string, boolean[]> }`
  - `const DRUM_GRIDS: Record<string, DrumGrid>` — 14 entries, keyed by genre name (`Synthwave`, `House`, `Trap`, `Boom Bap`, `Cyberpunk`, `DnB`, `Dubstep`, `Techno`, `Funk`, `Rock`, `Reggae`, `Lo-Fi Hip-Hop`, `Waltz`, `Afro 6/8`)
  - `const GENRE_TO_KIT: Record<string, string>` — 14 entries, the same keys, each mapping to a `DRUM_KITS` **name string**
- Removed: `GENRE_PRESETS`, `GenrePreset`.

**Naming:** `GENRE_PRESETS` was keyed by genre, but each entry is a drum grid, so it is `DRUM_GRIDS`. `preset` with no qualifier is banned — the repo used it for a synth patch, a drum grid and a chord progression.

**Why `GENRE_TO_KIT` lands here and not in `data/drumKits.ts`:** it maps a genre string to a kit *name string*, never to a `DRUM_KITS` entry, so it could sit in either file and neither would notice. It goes with `DRUM_GRIDS` because the two share a key set — `drumKits.test.ts` pins exactly that — and because `SequencerView`'s genre picker reads both in one action.

- [ ] **Step 1: Move the test file and watch it fail**

`git mv src/audio/data/genrePresets.test.ts src/data/drumGrids.test.ts`, then rewrite its imports and symbol names (nothing else):

```ts
import { describe, expect, test } from 'bun:test';
import { DRUM_GRIDS, GENRE_TO_KIT } from './drumGrids';
import { getMeter, isMeterId } from '@/utils/meter';
```

Replace every `GENRE_PRESETS` with `DRUM_GRIDS` inside the file. Then append the key-set pairing test, moved out of `src/audio/drumKits.test.ts` (where it currently reaches across two modules) so it now sits beside both tables:

```ts
describe('GENRE_TO_KIT', () => {
  test('names a kit for exactly the genres DRUM_GRIDS has', () => {
    // The sequencer's genre picker writes both in one action: pick "Trap" and
    // it loads the Trap grid AND the Trap Beat kit. A genre in one table and
    // not the other is a picker entry that half-works.
    expect(Object.keys(GENRE_TO_KIT).sort()).toEqual(Object.keys(DRUM_GRIDS).sort());
  });
});
```

Run: `bun test src/data/drumGrids.test.ts`
Expected: FAIL — `Cannot find module './drumGrids' from '.../src/data/drumGrids.test.ts'`

- [ ] **Step 2: Create `src/data/drumGrids.ts`**

Move `src/audio/data/genrePresets.ts:14-193` and `src/audio/drumKits.ts`'s `GENRE_TO_KIT` (currently `:183-198` before Task 4's edit, now near the top of that file):

```ts
/**
 * The sequencer's genre drum grids: genre -> { meter, instrument -> boolean
 * pattern }. Moved verbatim from SequencerView.tsx, then out of
 * audio/data/genrePresets.ts.
 *
 * One line per row: a rhythm is only readable as a row.
 *
 * Deliberately SEPARATE from VIBE_DRUM_GRIDS (./vibeDrumGrids.ts) — see the
 * measured note at the top of that file. The two now sit side by side under
 * near-identical names, which makes them look mergeable in a way they never
 * were; that note is the only thing standing between a future reader and a
 * silent sound change.
 *
 * The `{ meter, rows }` wrapper exists because the flat `Record<string,
 * boolean[]>` shape had nowhere to hang metadata, and a pattern's bar length
 * alone is not a sufficient tag: 3/4 and 6/8 are both 12 steps and differ only
 * in accent grouping.
 */
import type { MeterId } from '@/utils/meter';

export interface DrumGrid {
  meter: MeterId;
  rows: Record<string, boolean[]>;
}

export const DRUM_GRIDS: Record<string, DrumGrid> = {
  /* … the 14 entries from audio/data/genrePresets.ts:19-193, verbatim … */
};

/**
 * The kit each genre loads with its grid — a kit NAME string, never a DRUM_KITS
 * entry, which is why this table needs no import and could live anywhere. It
 * lives here because it shares a key set with DRUM_GRIDS and the sequencer's
 * genre picker writes both in one action.
 */
export const GENRE_TO_KIT: Record<string, string> = {
  /* … the 14 entries, verbatim … */
};
```

Delete `src/audio/data/genrePresets.ts` and remove `GENRE_TO_KIT` from `src/audio/drumKits.ts`, which is then `mergeDrumKit` and its import alone.

- [ ] **Step 3: Run the test and watch it pass**

Run: `bun test src/data/drumGrids.test.ts`
Expected: PASS.

- [ ] **Step 4: Repoint the consumers**

- `src/components/loop/SequencerView.tsx:17-18` → `import { DRUM_GRIDS, GENRE_TO_KIT } from "@/data/drumGrids";` and `import { DRUM_KITS } from "@/data/drumKits";`. Rename every `GENRE_PRESETS` in the file body.
- `src/audio/meterRegression.test.ts:16` → `import { DRUM_GRIDS } from '@/data/drumGrids';`, renaming its uses.
- `src/audio/drumKits.test.ts` → drop the `GENRE_PRESETS` import and the pairing test that moved in Step 1; keep everything else.
- `src/store/store.test.ts` → repoint and rename its `GENRE_PRESETS` uses.
- `src/utils/patternAdapt.ts:5` → the doc comment becomes "arrays (`boolean[]` in `DRUM_GRIDS`, `number[]` in `VIBE_DRUM_GRIDS`)".

- [ ] **Step 5: Run the gate and commit**

Run: `bun run verify`

```
git add -A src/data/drumGrids.ts src/data/drumGrids.test.ts src/audio/data/genrePresets.ts src/audio/data/genrePresets.test.ts src/audio/drumKits.ts src/audio/drumKits.test.ts src/audio/meterRegression.test.ts src/store/store.test.ts src/components/loop/SequencerView.tsx src/utils/patternAdapt.ts
git commit -m "refactor(data): GENRE_PRESETS becomes DRUM_GRIDS in src/data/

A name says what an entry IS, not what it is keyed by: the table was keyed by
genre but every entry is a drum grid. GENRE_TO_KIT comes along — it shares the
key set and the sequencer's picker writes both at once."
```

---

## Task 6: `CHORD_PROGRESSIONS` moves to `data/chordProgressions.ts`; the resolvers move up to `audio/`

**Files:**
- Create: `src/data/chordProgressions.ts`, `src/audio/chordProgressions.ts`
- Rename: `src/audio/data/chordProgressions.test.ts` → `src/audio/chordProgressions.test.ts`; `src/audio/data/chordProgressions.migration.test.ts` → `src/audio/chordProgressions.migration.test.ts`
- Delete: `src/audio/data/chordProgressions.ts`
- Modify: `src/components/loop/ChordView.tsx:79`; `src/components/loop/ChordPresetLibrary.tsx:5-6`; `src/components/loop/ChordPresetLibrary.test.tsx:5`; `src/components/loop/chord/progressionAvailability.ts:1`; `src/store/instantVibes.ts:7`; `src/store/instantVibes.test.ts:366`; `src/store/instantVibesProgressions.test.ts:4`; `src/store/instantVibesChordsFixture.ts` (imports only); `src/store/vibeVariation.ts:2`; `src/store/vibeVariation.test.ts:139,295`; `src/types.ts:249,255,297`

**Interfaces:**
- Consumes: `VibeGenre` (type, `@/types`).
- Produces, from `@/data/chordProgressions`:
  - `type ProgressionCategory = 'Pop & EDM' | 'Jazz & Neo-Soul' | 'Lofi & R&B' | 'Rock & Blues' | 'Anime & J-Pop' | 'Cinematic & Modal' | 'Classical & Baroque' | 'Ambient & Zen'`
  - `interface ProgressionStep { degree: number; quality?: string; bars: number }`
  - `interface ChordProgression { id: string; name: string; roman: string; description: string; category: ProgressionCategory; referenceScale: string; genres: VibeGenre[]; minScaleLength: number; steps: ProgressionStep[] }`
  - `const CHORD_PROGRESSIONS: ChordProgression[]` — 44 entries
  - private `const step = (degree: number, bars = 1, quality?: string): ProgressionStep => …`, directly above the table, **not exported**
- Produces, from `@/audio/chordProgressions`:
  - `function progressionById(id: string): ChordProgression | undefined`
  - `function resolveProgression(...)` — signature unchanged from `audio/data/chordProgressions.ts:655-675`
  - `const VIBE_GENRE_SCALES: Record<VibeGenre, string>` — unchanged; Part 3 deletes it
  - `export type { VibeGenre } from '../types'` — unchanged, so `vibeVariation.test.ts` keeps one import site
  - private `const PROGRESSIONS_BY_ID = new Map(CHORD_PROGRESSIONS.map((p) => [p.id, p]))`

**Why `PROGRESSIONS_BY_ID` does not move:** it is a `NewExpression`, banned outright in `src/data/`, and it is a lookup index built *over* the table rather than part of it. The ban costs nothing precisely because this is the repo's only instance of the idiom in this territory. `resolveProgression` stays for a second reason: it calls `getDiatonicChordForDegree` and `deriveChordNotes`, runtime imports a data file may not make.

- [ ] **Step 1: Move the test files and watch them fail**

`git mv src/audio/data/chordProgressions.test.ts src/audio/chordProgressions.test.ts`
`git mv src/audio/data/chordProgressions.migration.test.ts src/audio/chordProgressions.migration.test.ts`

Rewrite their import blocks: `CHORD_PROGRESSIONS` and the three types from `@/data/chordProgressions`; `progressionById`, `resolveProgression`, `VIBE_GENRE_SCALES` from `./chordProgressions`; `SCALES` from `@/data/scales`; the remaining theory functions from `@/utils/musicTheory`.

Run: `bun test src/audio/chordProgressions.test.ts`
Expected: FAIL — `Cannot find module '@/data/chordProgressions'`

- [ ] **Step 2: Create `src/data/chordProgressions.ts`**

Move `src/audio/data/chordProgressions.ts:18-61` (the three type declarations), `:73-75` (the `step` helper) and `:76-638` (the table) verbatim:

```ts
/**
 * The shared chord-progression library, in degree form. 44 progressions, each
 * authored against the scale named in `referenceScale`.
 *
 * `step()` sits directly above the table on purpose. It is shorthand for an
 * object literal and nothing else — the src/data/ import ban leaves it nothing
 * to call but this file's own bindings, the impure-global ban removes every
 * source of a value not written here, and the let/var ban means it cannot carry
 * state between calls. It is pure, total and deterministic by construction, so
 * `step(0, 1, 'min7')` reads as data without leaving the file. Do NOT move it
 * to a shared helpers module: that would break the property the whole
 * convention rests on, and the import ban forbids it anyway.
 *
 * The one fact the rows do not show is `bars = 1` by default. That is the price
 * of the helper, and it is why the helper must stay in this file, four lines
 * above the table it builds.
 */
import type { VibeGenre } from '@/types';

export type ProgressionCategory = /* … verbatim … */;

export interface ProgressionStep { /* … verbatim, with its doc comments … */ }

export interface ChordProgression { /* … verbatim, with its doc comments … */ }

const step = (degree: number, bars = 1, quality?: string): ProgressionStep =>
  quality === undefined ? { degree, bars } : { degree, quality, bars };

export const CHORD_PROGRESSIONS: ChordProgression[] = [
  /* … the 44 entries, verbatim … */
];
```

- [ ] **Step 3: Create `src/audio/chordProgressions.ts`**

```ts
// Lookups and resolution over CHORD_PROGRESSIONS.
//
// Layering: this file is under src/audio/, which eslint restricts only from
// store/ and components/. Importing utils/musicTheory.ts, types.ts and
// data/chordProgressions.ts is allowed and deliberate — deriveChordNotes is the
// single source of truth for ChordItem.notes and must not be re-implemented
// here, and that runtime import is exactly why this half could not move into
// src/data/ with the table.

import type { ChordItem, VibeGenre } from '../types';
import { deriveChordNotes, getDiatonicChordForDegree } from '../utils/musicTheory';
import { CHORD_PROGRESSIONS, type ChordProgression } from '@/data/chordProgressions';

// Declared in src/types.ts, re-exported here so this stays the import site the
// shared B1/B2 interface pins.
export type { VibeGenre } from '../types';

/**
 * Each genre's anchor scale. Scale type is genre identity and never varies.
 * Read only by tests today; Part 3 of the data-layer spec deletes it along with
 * the VibeGenre union. Left in place here deliberately — deleting a mechanism
 * and moving a table are two changes, and this plan does one of them.
 */
export const VIBE_GENRE_SCALES: Record<VibeGenre, string> = {
  /* … the 6 entries from audio/data/chordProgressions.ts:64-71, verbatim … */
};

const PROGRESSIONS_BY_ID = new Map(CHORD_PROGRESSIONS.map((p) => [p.id, p]));

export function progressionById(id: string): ChordProgression | undefined {
  /* … verbatim from :642-644 … */
}

export function resolveProgression(/* … */) {
  /* … verbatim from :655-675, doc comment included … */
}
```

Delete `src/audio/data/chordProgressions.ts`.

- [ ] **Step 4: Run the moved suites and watch them pass**

Run: `bun test src/audio/chordProgressions.test.ts src/audio/chordProgressions.migration.test.ts`
Expected: PASS, with no asserted value changed.

- [ ] **Step 5: Repoint the consumers**

- `src/components/loop/ChordView.tsx:79` → `import { CHORD_PROGRESSIONS } from "@/data/chordProgressions";`
- `src/components/loop/ChordPresetLibrary.tsx:5-6` → `import { CHORD_PROGRESSIONS, type ChordProgression } from '@/data/chordProgressions';` and `import { resolveProgression } from '@/audio/chordProgressions';`
- `src/components/loop/ChordPresetLibrary.test.tsx:5` → the same split
- `src/components/loop/chord/progressionAvailability.ts:1` → `import type { ChordProgression } from '@/data/chordProgressions';`
- `src/store/instantVibes.ts:7`, `instantVibes.test.ts:366`, `instantVibesProgressions.test.ts:4`, `vibeVariation.ts:2`, `vibeVariation.test.ts:295` → `from '@/audio/chordProgressions'`
- `src/store/vibeVariation.test.ts:139` → `import { CHORD_PROGRESSIONS } from '@/data/chordProgressions';` and `import { VIBE_GENRE_SCALES } from '@/audio/chordProgressions';`
- `src/types.ts:249,255,297` — the doc comments already name `CHORD_PROGRESSIONS` and stay correct; no edit needed.

- [ ] **Step 6: Run the gate and commit**

Run: `bun run verify`

```
git add -A src/data/chordProgressions.ts src/audio/chordProgressions.ts src/audio/chordProgressions.test.ts src/audio/chordProgressions.migration.test.ts src/audio/data/chordProgressions.ts src/components src/store src/types.ts
git commit -m "refactor(data): split CHORD_PROGRESSIONS from its resolvers

The 44-entry table and its step() helper move to src/data/; progressionById,
resolveProgression and the computed PROGRESSIONS_BY_ID map move up out of
audio/data/ into audio/. VIBE_GENRE_SCALES stays with the resolvers — deleting
it is Part 3's job, not this one's."
```

---

## Task 7: `RHYTHM_PATTERNS` becomes `CHORD_RHYTHMS` in `data/chordRhythms.ts`

**Files:**
- Create: `src/data/chordRhythms.ts`, `src/audio/chordRhythms.ts`
- Rename: `src/audio/rhythmPatterns.test.ts` → `src/audio/chordRhythms.test.ts`
- Delete: `src/audio/rhythmPatterns.ts`
- Modify: `src/components/loop/chord/useChordPlayback.ts:13-19`; `src/components/loop/chord/useChordPlayback.test.ts:18`; `src/components/loop/chord/ChordModulePanel.tsx:4`; `src/components/useInputDeck.ts:3`; `src/audio/playback/chordPlayback.test.ts:4-5`; `src/audio/meterRegression.test.ts:18`; `src/store/projectFile.ts:3,56,61`; `src/store/instantVibes.test.ts:4`; `src/store/vibeVariation.ts:4`; `src/store/vibeVariation.test.ts:138`; `src/types.ts:257`

**Interfaces:**
- Consumes: `MeterId` (type, `@/utils/meter`).
- Produces, from `@/data/chordRhythms`:
  - `type RhythmHitType = 'block' | 'strum'`
  - `interface RhythmHit { step: number; type: RhythmHitType; velocity?: number; holdSteps?: number; direction?: 'up' | 'down'; spreadMs?: number; note?: number; octaveShift?: number }`
  - `interface RhythmPattern { id: string; name: string; style: string; description?: string; meter?: MeterId; hits: RhythmHit[] }`
  - `const CHORD_RHYTHMS: RhythmPattern[]` — 21 entries
  - private `const block = (step: number, velocity = 1, holdSteps = 1): RhythmHit => …`
  - private `const strum = (step: number, direction: 'up' | 'down', velocity = 1, holdSteps = 2, spreadMs = 30): RhythmHit => …`
- Produces, from `@/audio/chordRhythms`:
  - `const CHORD_RHYTHM_STYLE_GROUPS` — `groupByStyle(CHORD_RHYTHMS)`, a call
  - `function feelToHoldScale(feel: number): number`
  - `function equalPowerVelocityScale(noteCount: number): number`
  - `function fullHoldDuration(totalBars: number, barDur: number, holdScale: number): number`
  - `function customRhythmPattern(grid: readonly boolean[], stepsPerBar: number, meter: MeterId): RhythmPattern`

**Naming:** `RHYTHM_PATTERNS` → `CHORD_RHYTHMS` is the sharpest case the naming rule covers. The table is chord-comp only — `useChordPlayback.ts` is its consumer — and "rhythm pattern" reads as if it might cover drums. `RhythmPattern` the *type* keeps its name: it is qualified by its module and by 40-odd consumer annotations, and the spec's "What moves" row names it as a moved export verbatim.

- [ ] **Step 1: Move the test file and watch it fail**

`git mv src/audio/rhythmPatterns.test.ts src/audio/chordRhythms.test.ts`, then rewrite its imports:

```ts
import { customRhythmPattern, equalPowerVelocityScale, feelToHoldScale, fullHoldDuration } from './chordRhythms';
import { CHORD_RHYTHMS } from '@/data/chordRhythms';
```

Rename every `RHYTHM_PATTERNS` in the file body to `CHORD_RHYTHMS`. **No asserted value changes.**

Run: `bun test src/audio/chordRhythms.test.ts`
Expected: FAIL — `Cannot find module '@/data/chordRhythms'`

- [ ] **Step 2: Create `src/data/chordRhythms.ts`**

Move `src/audio/rhythmPatterns.ts:8-44` (the three type declarations, doc comments included), `:46-66` (the two helpers) and `:68-335` (the table, renamed):

```ts
/**
 * The chord-comp rhythm library: 21 one-bar patterns of block and strum hits.
 *
 * Named CHORD_RHYTHMS, not RHYTHM_PATTERNS: the table is chord-comp only
 * (useChordPlayback is its one consumer) and "rhythm pattern" reads as if it
 * might cover drums, which it does not. `pattern` with no qualifier has come to
 * mean "a thing from a library", which is the one meaning a name in a folder
 * full of libraries cannot carry.
 *
 * `block()` and `strum()` sit directly above the table on purpose — see the
 * same note on `step()` in ./chordProgressions.ts. `strum(4, 'up')` hides three
 * defaults from a reader of a row; that is the price, and keeping the helper in
 * this file four lines above the table is the mitigation. Do NOT expand the ~93
 * call sites, and do NOT move the helpers to a shared module.
 *
 * Adaptation to a different active meter happens at PLAYBACK time
 * (utils/eventAdapt.ts). The user picks these by id and never edits them, so
 * the library stays pure and needs no migration.
 */
import type { MeterId } from '@/utils/meter';

export type RhythmHitType = 'block' | 'strum';

export interface RhythmHit { /* … verbatim from :10-27, doc comments included … */ }

export interface RhythmPattern { /* … verbatim from :29-44, doc comments included … */ }

const block = (step: number, velocity = 1, holdSteps = 1): RhythmHit => ({
  step,
  type: 'block',
  velocity,
  holdSteps,
});

const strum = (
  step: number,
  direction: 'up' | 'down',
  velocity = 1,
  holdSteps = 2,
  spreadMs = 30
): RhythmHit => ({
  step,
  type: 'strum',
  velocity,
  holdSteps,
  direction,
  spreadMs,
});

export const CHORD_RHYTHMS: RhythmPattern[] = [
  /* … the 21 entries from rhythmPatterns.ts:68-335, verbatim … */
];
```

- [ ] **Step 3: Create `src/audio/chordRhythms.ts`**

```ts
// Grouping and hold maths over CHORD_RHYTHMS. Everything here computes; the
// table itself is in data/chordRhythms.ts, and the two used to share a file —
// which meant a review of "I retuned a pattern" and a review of "I changed the
// hold maths" looked identical in a diff list.

import { groupByStyle } from './groupByStyle';
import { CHORD_RHYTHMS, type RhythmHit, type RhythmPattern } from '@/data/chordRhythms';
import type { MeterId } from '../utils/meter';

// Rhythms grouped by style, computed once at module load for the style-grouped
// select UI.
export const CHORD_RHYTHM_STYLE_GROUPS = groupByStyle(CHORD_RHYTHMS);

/* feelToHoldScale, equalPowerVelocityScale, fullHoldDuration and
   customRhythmPattern move verbatim from rhythmPatterns.ts:338-377, doc
   comments included. Their four Math.* uses are why they cannot move into
   src/data/. */
```

Delete `src/audio/rhythmPatterns.ts`.

- [ ] **Step 4: Run the suite and watch it pass**

Run: `bun test src/audio/chordRhythms.test.ts`
Expected: PASS.

- [ ] **Step 5: Repoint the consumers**

- `src/components/loop/chord/useChordPlayback.ts:13-19` →
  ```ts
  import { CHORD_RHYTHMS, type RhythmPattern } from "@/data/chordRhythms";
  import {
    customRhythmPattern,
    feelToHoldScale,
    fullHoldDuration,
  } from "@/audio/chordRhythms";
  ```
  and rename `RHYTHM_PATTERNS` in the body.
- `src/components/loop/chord/useChordPlayback.test.ts:18` → `import { CHORD_RHYTHMS, type RhythmPattern } from '@/data/chordRhythms';`
- `src/components/loop/chord/ChordModulePanel.tsx:4` → `import { CHORD_RHYTHM_STYLE_GROUPS } from "@/audio/chordRhythms";`, renamed in the body
- `src/components/useInputDeck.ts:3` → `import { equalPowerVelocityScale } from '@/audio/chordRhythms';`
- `src/audio/playback/chordPlayback.test.ts:4-5` → `equalPowerVelocityScale` from `../chordRhythms`, `RhythmPattern` type from `@/data/chordRhythms`
- `src/audio/meterRegression.test.ts:18` → `import { CHORD_RHYTHMS } from '@/data/chordRhythms';`, renamed
- `src/store/projectFile.ts:3,61` → `import { CHORD_RHYTHMS } from '@/data/chordRhythms';` and `const rhythmIds = new Set(CHORD_RHYTHMS.map((p) => p.id));`; the doc comment at `:56` becomes `CHORD_RHYTHMS[0]`
- `src/store/instantVibes.test.ts:4`, `vibeVariation.ts:4`, `vibeVariation.test.ts:138` → `from '@/data/chordRhythms'`, renamed
- `src/types.ts:257` → "Ids into `CHORD_RHYTHMS`. Always contains the vibe's own chordRhythmId."
- `src/audio/bassPatterns.ts:36` — the `BassPattern.style` doc comment says "same as RHYTHM_STYLE_GROUPS"; make it `CHORD_RHYTHM_STYLE_GROUPS`.

- [ ] **Step 6: Run the gate and commit**

Run: `bun run verify`

```
git add -A src/data/chordRhythms.ts src/audio/chordRhythms.ts src/audio/chordRhythms.test.ts src/audio/rhythmPatterns.ts src/audio/rhythmPatterns.test.ts src/audio/bassPatterns.ts src/audio/meterRegression.test.ts src/audio/playback/chordPlayback.test.ts src/components src/store src/types.ts
git commit -m "refactor(data): RHYTHM_PATTERNS becomes CHORD_RHYTHMS in src/data/

The table and its block()/strum() helpers move to src/data/chordRhythms.ts; the
style grouping and the hold maths stay behind in audio/chordRhythms.ts, where
their four Math.* uses are legal. The table is chord-comp only, and 'rhythm
pattern' read as if it might cover drums."
```

---

## Task 8: `BASS_PATTERNS` moves to `data/bassPatterns.ts`

**Files:**
- Create: `src/data/bassPatterns.ts`
- Modify: `src/audio/bassPatterns.ts:1-51,175-371`; `src/audio/bassPatterns.test.ts:2-3`; `src/audio/meterRegression.test.ts:19`; `src/components/loop/chord/useChordPlayback.ts:20-27`; `src/components/loop/chord/useChordPlayback.test.ts:19`; `src/components/loop/chord/BassModulePanel.tsx:4-7`; `src/components/loop/chord/bassStepChoice.ts:1`; `src/components/ui/StepRow.test.tsx:7`; `src/components/loop/ChordView.test.tsx:312`; `src/store/bassSlice.ts:2`; `src/store/loopSlice.ts:2`; `src/store/store.test.ts:6`; `src/store/instantVibes.test.ts:5`; `src/store/vibeVariation.ts:3`; `src/store/vibeVariation.test.ts:137`; `src/store/projectFile.ts:1,57,62`; `src/store/sanitize.ts:13`; `src/store/types.ts:18`; `src/store/customStepSequencer.test.ts:4`; `src/types.ts:259`

**Interfaces:**
- Consumes: `MeterId` (type, `@/utils/meter`).
- Produces, from `@/data/bassPatterns`:
  - `type BassNoteToken = 'root' | 'third' | 'fifth' | 'seventh' | 'octave' | 'approachChromaticAbove' | 'approachChromaticBelow' | 'approachDiatonicUp' | 'approachFifthOfNext' | 'rest'`
  - `type BassStepChoice = Extract<BassNoteToken, 'rest' | 'root' | 'third' | 'fifth' | 'seventh' | 'octave'>`
  - `interface BassStep { step: number; note: BassNoteToken; holdSteps?: number; velocity?: number; octaveShift?: number; staccato?: boolean; alternate?: boolean }`
  - `interface BassPattern { id: string; name: string; style: string; description?: string; meter?: MeterId; steps: BassStep[] }`
  - `const BASS_PATTERNS: BassPattern[]` — 16 entries
- Produces, still from `@/audio/bassPatterns`: `const BASS_STYLE_GROUPS`, `interface ResolvedBassEvent`, `function resolveBassSteps(...)`, `function isApproachToken(token: BassNoteToken): boolean`, `function customBassPattern(...)`, and the private `TONE_INDEX` / `FALLBACK_CHAIN` / `pitchClass` / `midiAtOctave` / `resolveAlternatedToken` / `resolveStepMidi`.

**Note:** `ResolvedBassEvent` stays in `audio/`. It describes the *output* of `resolveBassSteps`, not a table — the same reasoning that keeps `CategoryPresetGroup` with the registry in Task 2.

- [ ] **Step 1: Write the failing test**

Add to `src/audio/bassPatterns.test.ts`, above its existing describes, and change its import at `:2-3` to:

```ts
import { BASS_STYLE_GROUPS, customBassPattern, resolveBassSteps } from './bassPatterns';
import { BASS_PATTERNS } from '@/data/bassPatterns';
import type { BassPattern, BassStepChoice } from '@/data/bassPatterns';
```

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: FAIL — `Cannot find module '@/data/bassPatterns'`

- [ ] **Step 2: Create `src/data/bassPatterns.ts`**

Move `src/audio/bassPatterns.ts:8-42` (the four type declarations, doc comments included) and `:175-371` (the table):

```ts
/**
 * The bass-figure library: 16 patterns of note tokens over a one-bar grid.
 *
 * A step names a CHORD TONE or an approach, never a pitch — resolution against
 * the current chord happens in audio/bassPatterns.ts, which is where the
 * Note/tonal import and the fallback chain live. That split is why this file
 * can be a leaf: a table of tokens needs nothing but the tokens.
 *
 * Adaptation to a different active meter happens at PLAYBACK time; the user
 * picks these by id and never edits them.
 */
import type { MeterId } from '@/utils/meter';

export type BassNoteToken = /* … verbatim from :8-12 … */;

/**
 * The subset of BassNoteToken the custom bass grid offers. Deliberately no
 * scale-degree or 2-4-6 colour tones: borrowed/non-diatonic chords are always
 * possible, so a step that assumes a scale degree could resolve off-key.
 */
export type BassStepChoice = Extract<
  BassNoteToken,
  'rest' | 'root' | 'third' | 'fifth' | 'seventh' | 'octave'
>;

export interface BassStep { /* … verbatim from :24-32, inline comments included … */ }

export interface BassPattern { /* … verbatim from :34-42 … */ }

export const BASS_PATTERNS: BassPattern[] = [
  /* … the 16 entries from audio/bassPatterns.ts:175-371, verbatim … */
];
```

Reduce `src/audio/bassPatterns.ts` to its imports plus `ResolvedBassEvent`, the six private helpers, `resolveBassSteps`, `isApproachToken`, `BASS_STYLE_GROUPS` and `customBassPattern`, with:

```ts
import { BASS_PATTERNS, type BassNoteToken, type BassPattern, type BassStep, type BassStepChoice } from '@/data/bassPatterns';
```

and a re-export line so the type-only consumers do not all have to move in this commit:

```ts
// The tokens and shapes live with the table; re-exported so the ten modules
// that import BassStepChoice as a type keep one path.
export type { BassNoteToken, BassPattern, BassStep, BassStepChoice } from '@/data/bassPatterns';
```

- [ ] **Step 3: Run the suite and watch it pass**

Run: `bun test src/audio/bassPatterns.test.ts`
Expected: PASS.

- [ ] **Step 4: Repoint the consumers**

Every module that imports `BASS_PATTERNS` as a *table* takes `@/data/bassPatterns`; every module that imports `resolveBassSteps`, `isApproachToken`, `customBassPattern` or `BASS_STYLE_GROUPS` keeps `@/audio/bassPatterns`. Type-only importers of `BassStepChoice` / `BassPattern` move to `@/data/bassPatterns` in the same pass, and the re-export line added in Step 2 is then deleted:

- Table: `src/audio/meterRegression.test.ts:19`, `src/components/loop/chord/useChordPlayback.ts:20-27` (split: `BASS_PATTERNS`, `BassPattern`, `BassStepChoice` from data; `customBassPattern`, `isApproachToken`, `resolveBassSteps` from audio), `useChordPlayback.test.ts:19`, `src/store/bassSlice.ts:2`, `loopSlice.ts:2`, `store.test.ts:6`, `instantVibes.test.ts:5`, `vibeVariation.ts:3`, `vibeVariation.test.ts:137`, `projectFile.ts:1,62`
- Types only: `src/components/loop/chord/bassStepChoice.ts:1`, `src/components/ui/StepRow.test.tsx:7`, `src/components/loop/ChordView.test.tsx:312`, `src/store/sanitize.ts:13`, `src/store/types.ts:18`, `src/store/customStepSequencer.test.ts:4`
- Functions only: `src/components/loop/chord/BassModulePanel.tsx:4-7` (`BASS_STYLE_GROUPS` stays on `@/audio/bassPatterns`)
- `src/store/projectFile.ts:57` doc comment → `BASS_PATTERNS[0]` (unchanged text; confirm it still reads true)
- `src/types.ts:259` → "Ids into `BASS_PATTERNS`." (unchanged text)

Then delete the re-export line from `src/audio/bassPatterns.ts`.

- [ ] **Step 5: Run the gate and commit**

Run: `bun run verify`

```
git add -A src/data/bassPatterns.ts src/audio/bassPatterns.ts src/audio/bassPatterns.test.ts src/audio/meterRegression.test.ts src/components src/store src/types.ts
git commit -m "refactor(data): move BASS_PATTERNS and its token types into src/data/

The table names chord tones, never pitches, so it needs nothing at runtime;
resolveBassSteps and the whole token-resolution engine stay in audio/, along
with ResolvedBassEvent, which describes the resolver's output rather than the
table."
```

---

## Task 9: `VIBE_DRUM_PATTERNS` becomes `VIBE_DRUM_GRIDS` in `data/vibeDrumGrids.ts`

**Files:**
- Create: `src/data/vibeDrumGrids.ts`, `src/audio/vibeDrumGrids.ts`
- Rename: `src/audio/data/vibeDrumPatterns.test.ts` → `src/audio/vibeDrumGrids.test.ts`
- Delete: `src/audio/data/vibeDrumPatterns.ts`
- Modify: `src/audio/meterRegression.test.ts:17`; `src/store/instantVibes.ts:8`; `src/store/instantVibesDrums.test.ts:4`; `src/store/instantVibesDrumsFixture.ts` (comment only); `src/store/store.test.ts`; `src/types.ts:283`; `src/data/drumGrids.ts` (repoint its cross-reference comment)

**Interfaces:**
- Consumes: `MeterId` (type, `@/utils/meter`).
- Produces, from `@/data/vibeDrumGrids`:
  - `const VIBE_DRUM_GRIDS: Record<string, Record<string, number[]>>` — 8 entries, keyed by library id (`lofi-half-time-brush`, `synthwave-four-on-floor`, `edm-offbeat-pump`, `ambient-sparse-drift`, `boombap-swung-break`, `zen-bamboo-pulse`, `waltz-brush-three`, `afro-six-eight-bell`)
  - `const VIBE_DRUM_GRID_METERS: Record<string, MeterId>` — the same 8 keys
- Produces, from `@/audio/vibeDrumGrids`:
  - `function drumGridById(id: string): Record<string, number[]> | undefined` — was `drumPatternById`; still returns a **fresh deep copy per call**, deliberately
  - `function drumGridMeterId(id: string): MeterId` — was `drumPatternMeterId`; still falls back to `DEFAULT_METER_ID`

**Why `drumGridMeterId` stays in `audio/`:** it is the one thing in the source module that needs a *runtime* import (`DEFAULT_METER_ID` at `vibeDrumPatterns.ts:21`), and it is a lookup with a fallback. `VIBE_DRUM_GRID_METERS` itself needs `MeterId` as a type only.

- [ ] **Step 1: Move the test file and watch it fail**

`git mv src/audio/data/vibeDrumPatterns.test.ts src/audio/vibeDrumGrids.test.ts`, then rewrite its import at `:2`:

```ts
import { drumGridById, drumGridMeterId } from './vibeDrumGrids';
import { VIBE_DRUM_GRIDS, VIBE_DRUM_GRID_METERS } from '@/data/vibeDrumGrids';
```

and rename the symbols throughout the body. **No asserted value changes.**

Run: `bun test src/audio/vibeDrumGrids.test.ts`
Expected: FAIL — `Cannot find module './vibeDrumGrids'`

- [ ] **Step 2: Create `src/data/vibeDrumGrids.ts`**

Move `src/audio/data/vibeDrumPatterns.ts:23-98` and `:132-141`, carrying the measured separation comment **verbatim** with only the file and symbol names updated, and fixing the two stale head-comment claims:

```ts
// The vibe drum-grid library: the eight Instant Vibes' authored drum
// skeletons, keyed by a library id, so a vibe references a rhythm instead of
// inlining one — the same reference-and-resolve shape CHORD_PROGRESSIONS
// already gives a vibe's chords.
//
// Library ids here are internal: projects persist the resolved boolean grid,
// not the id, so these ids are safe to rename (unlike Instant Vibe ids).
//
// Deliberately NOT merged with DRUM_GRIDS (./drumGrids.ts). Measured:
// no vibe's grid matches its own genre entry best (Jaccard over hit cells —
// synthwave-80s is closest to Trap at 81%, not Synthwave at 58%; ambient-chill
// peaks at 26% against anything; nothing matches at 100%), and the two
// disagree on cell type (boolean vs number), row set (`bass` only on the
// sequencer side, `crash` only here) and consumer. Merging them would force a
// sound change on one side or the other, which this refactor forbids.
//
// That note matters MORE now than it did before this move: the two tables sit
// side by side in one folder under near-identical names, which makes them look
// mergeable in a way they did not when one was buried in audio/data/.
//
// Layering: this file imports nothing at runtime — src/data/ files never do —
// so it can be read, reviewed or copied into a fixture in isolation.

import type { MeterId } from '@/utils/meter';

export const VIBE_DRUM_GRIDS: Record<string, Record<string, number[]>> = {
  /* … the 8 entries from vibeDrumPatterns.ts:23-98, verbatim … */
};

/**
 * The meter each library grid was authored in.
 *
 * A sidecar rather than a field on the grid, deliberately: VIBE_DRUM_GRIDS is a
 * flat `id -> row -> number[]` map, and wrapping it in `{ meter, rows }` would
 * change `drumGridById`'s return type, `InstantVibe.drumPattern`, the
 * ORIGINAL_VIBE_DRUM_PATTERNS golden fixture and three invariant tests — all to
 * carry one string. The invariant test pins the two key sets together.
 */
export const VIBE_DRUM_GRID_METERS: Record<string, MeterId> = {
  /* … the 8 entries from vibeDrumPatterns.ts:132-141, verbatim … */
};
```

- [ ] **Step 3: Create `src/audio/vibeDrumGrids.ts`**

```ts
// Lookups over VIBE_DRUM_GRIDS. Both return values built per call, which is why
// neither could travel with the table.

import { DEFAULT_METER_ID, type MeterId } from '../utils/meter';
import { VIBE_DRUM_GRIDS, VIBE_DRUM_GRID_METERS } from '@/data/vibeDrumGrids';

/* drumGridById moves verbatim from vibeDrumPatterns.ts:100-120 (was
   drumPatternById), doc comment included — it returns a fresh deep copy per
   call so VIBE_DRUM_GRIDS stays authoritative and immutable and callers may
   mutate what they get. */

/** The meter a library grid was authored in; 4/4 for anything unknown. */
export function drumGridMeterId(id: string): MeterId {
  return VIBE_DRUM_GRID_METERS[id] ?? DEFAULT_METER_ID;
}
```

Delete `src/audio/data/vibeDrumPatterns.ts`.

- [ ] **Step 4: Run the suite and watch it pass**

Run: `bun test src/audio/vibeDrumGrids.test.ts`
Expected: PASS.

- [ ] **Step 5: Repoint the consumers**

- `src/audio/meterRegression.test.ts:17` → `import { VIBE_DRUM_GRID_METERS } from '@/data/vibeDrumGrids';`, renamed
- `src/store/instantVibes.ts:8` → `import { drumGridById } from '@/audio/vibeDrumGrids';`, and the call site inside the `INSTANT_VIBES` literal (`drumPatternById('…')!`, once per vibe) renamed. **The literal itself does not move and is not restructured — that is Part 2.**
- `src/store/instantVibesDrums.test.ts:4` → `import { drumGridById, drumGridMeterId } from '@/audio/vibeDrumGrids';`, renamed
- `src/store/store.test.ts` → repoint and rename its `VIBE_DRUM_PATTERNS` uses
- `src/store/instantVibesDrumsFixture.ts` → its head comment names `VIBE_DRUM_PATTERNS`; rename it. **Do not touch a single asserted cell** — the fixture is a snapshot, not a re-derivation, and that independence is the whole proof.
- `src/types.ts:283` → "Library reference into `VIBE_DRUM_GRIDS` naming the authored base…"
- `src/data/drumGrids.ts` head comment → confirm its `./vibeDrumGrids.ts` cross-reference now resolves

- [ ] **Step 6: Run the gate and commit**

Run: `bun run verify`

```
git add -A src/data/vibeDrumGrids.ts src/audio/vibeDrumGrids.ts src/audio/vibeDrumGrids.test.ts src/audio/data/vibeDrumPatterns.ts src/audio/data/vibeDrumPatterns.test.ts src/audio/meterRegression.test.ts src/store src/types.ts src/data/drumGrids.ts
git commit -m "refactor(data): VIBE_DRUM_PATTERNS becomes VIBE_DRUM_GRIDS in src/data/

The measured 'deliberately NOT merged with DRUM_GRIDS' note travels verbatim.
It matters more now: the two tables sit side by side under near-identical names,
and that note is the only thing standing between a future reader and a silent
sound change. drumPatternById/drumPatternMeterId become drumGridById/
drumGridMeterId and stay in audio/ — both build their return value per call."
```

---

## Task 10: `VIBE_EFFECT_CHAINS` becomes `EFFECT_CHAINS` in `data/effectChains.ts`; `src/audio/data/` is deleted

**Files:**
- Create: `src/data/effectChains.ts`, `src/audio/effectChains.ts`
- Rename: `src/audio/data/vibeEffectChains.test.ts` → `src/audio/effectChains.test.ts`
- Delete: `src/audio/data/vibeEffectChains.ts`, and then the **empty `src/audio/data/` directory itself**
- Modify: `src/store/instantVibes.ts:9`; `src/store/instantVibesEffects.test.ts:4`; `src/store/instantVibesEffectsFixture.ts` (comment only); `src/types.ts:337`

**Interfaces:**
- Consumes: `MasterEffects` (type, `@/types`).
- Produces, from `@/data/effectChains`:
  - `const EFFECT_CHAINS: Record<string, Partial<MasterEffects>>` — 6 entries
- Produces, from `@/audio/effectChains`:
  - `function effectChainById(id: string): Partial<MasterEffects> | undefined` — returns a fresh shallow copy
  - `function requireEffectChain(id: string): Partial<MasterEffects>` — throws `Unknown vibe effect chain id: ${id}`

- [ ] **Step 1: Move the test file and watch it fail**

`git mv src/audio/data/vibeEffectChains.test.ts src/audio/effectChains.test.ts`, then rewrite `:2`:

```ts
import { effectChainById, requireEffectChain } from './effectChains';
import { EFFECT_CHAINS } from '@/data/effectChains';
```

renaming `VIBE_EFFECT_CHAINS` throughout the body.

Run: `bun test src/audio/effectChains.test.ts`
Expected: FAIL — `Cannot find module './effectChains'`

- [ ] **Step 2: Create `src/data/effectChains.ts`**

Move `src/audio/data/vibeEffectChains.ts:23-92` verbatim:

```ts
// The effect-chain library: the eight Instant Vibes' authored master-effects
// blocks, keyed by a library id, so a vibe references a mix instead of inlining
// one — the same reference-and-resolve shape CHORD_PROGRESSIONS already gives a
// vibe's chords and VIBE_DRUM_GRIDS gives a vibe's rhythm.
//
// Library ids here are internal: projects persist the resolved effects object,
// not the id, so these ids are safe to rename.
//
// Every chain is a Partial<MasterEffects> by design, not oversight: only
// synthwave-neon-hall and edm-club-drive carry distortionWet. Applying a vibe
// spreads a resolved chain over the current store.effects
// (`{ ...store.effects, ...vibe.effects }`), so an omitted key means "inherit
// the current value" — adding distortionWet to a chain that omits it today
// would be a sound change, which this refactor forbids.

import type { MasterEffects } from '@/types';

export const EFFECT_CHAINS: Record<string, Partial<MasterEffects>> = {
  /* … the 6 entries from vibeEffectChains.ts:23-92, verbatim … */
};
```

- [ ] **Step 3: Create `src/audio/effectChains.ts`**

```ts
// Lookups over EFFECT_CHAINS. Both build their return value per call.

import type { MasterEffects } from '../types';
import { EFFECT_CHAINS } from '@/data/effectChains';

/* effectChainById and requireEffectChain move verbatim from
   vibeEffectChains.ts:93-117, doc comments included. requireEffectChain throws
   because spreading an undefined chain over store.effects is a legal no-op, so
   a mistyped id would otherwise apply no effects change instead of failing. */
```

Delete `src/audio/data/vibeEffectChains.ts`. `src/audio/data/` is now empty — remove the directory.

- [ ] **Step 4: Run the suite and watch it pass**

Run: `bun test src/audio/effectChains.test.ts`
Expected: PASS.

- [ ] **Step 5: Repoint the consumers and confirm the folder is gone**

- `src/store/instantVibes.ts:9` → `import { requireEffectChain } from '@/audio/effectChains';`
- `src/store/instantVibesEffects.test.ts:4` → `import { effectChainById } from '@/audio/effectChains';`
- `src/store/instantVibesEffectsFixture.ts` → head comment renamed; **no asserted value touched**
- `src/types.ts:337` → "Library reference into `EFFECT_CHAINS`. `effects` is its resolved output."

Run: `ls src/audio/data 2>&1` → expect `No such file or directory`
Run: `grep -rn "audio/data" src scripts` → expect no output

- [ ] **Step 6: Run the gate and commit**

Run: `bun run verify`

```
git add -A src/data/effectChains.ts src/audio/effectChains.ts src/audio/effectChains.test.ts src/audio/data src/store src/types.ts
git commit -m "refactor(data): VIBE_EFFECT_CHAINS becomes EFFECT_CHAINS; delete src/audio/data

src/audio/data/ was a way of admitting the problem without naming it — a data
sub-folder inside a layer, holding four files that had nowhere else to go. Its
tables are now in src/data/ and its resolvers in src/audio/, and the folder is
gone."
```

---

## Task 11: Documentation, skills and the inventory script

**Files:**
- Modify: `CLAUDE.md:41-56`; `.claude/skills/dsp-audio/SKILL.md:156,169`; `.claude/skills/music-theory/SKILL.md:8,25,33,39,50,88,105,113,116,122`; `.claude/skills/instant-vibes/SKILL.md:56,59,61,62,92,113,143-147`; `.claude/skills/instant-vibes/references/authoring-libraries.md:35,98-101`; `.claude/skills/instant-vibes/scripts/vibe-inventory.ts:11-16,66-67,90,92-95`

**Interfaces:**
- Consumes: every symbol and path produced by Tasks 2–10.
- Produces: no code. This task is what stops the next reader from trusting a stale pointer.

**Explicitly not in this task:** the `CLAUDE.md:122-125` "Instant Vibes ids drift from labels" trap entry, `docs/design.md` §4 item 2, and the three `.claude/skills/instant-vibes/` sections that document the write-the-id-twice rule and the closed-union genre procedure. Those are procedure deletions that Parts 2 and 3 own; the trap entry still points at `src/store/instantVibes.ts`, which is still where the table lives after Part 1.

- [ ] **Step 1: Rewrite the layer list in `CLAUDE.md`**

Replace `CLAUDE.md:41` (`**Three layers, enforced by eslint \`no-restricted-imports\`:**`) and insert a new item 1 before the current item 1, renumbering the rest:

```md
**Four layers, enforced by eslint (`no-restricted-imports`, plus `no-restricted-globals` and
`no-restricted-syntax` for the first):**

1. `src/data/` — **imports nothing at runtime, not even a sibling in `src/data/`.** Factory
   content only: synth presets, drum kits, drum grids, chord progressions, chord rhythms, bass
   patterns, effect chains, scales. It reads no impure global (`Math`, `Date`, `crypto`, …),
   declares no function, constructs no object with `new`, and holds no module-scope `let`/`var`;
   it may declare types and `import type` from anywhere. Top-level `const` arrow helpers that are
   shorthand for writing a literal — `step()`, `block()`, `strum()` — are allowed and must sit in
   the same file as the table they build. **Every file is an independent leaf**, so the folder has
   no evaluation graph and a reviewer with one file open has all of its inputs on screen.
   `src/data/dataLayerPurity.test.ts` lints fixture sources through eslint's own API and is what
   keeps that true across tool upgrades. The distinguishing test for what belongs: **adding an
   entry must be an edit to that table and nothing else** — which is why `METERS`, `THEME_TOKENS`
   and `VIEW_META` are registries and stay where the code that reads them lives.
```

and change the surviving items to 2/3/4, with item 2 becoming "`src/audio/` — never imports `store/` or `components/`; may import `data/`." `src/utils/` stays outside the chain, above `data/`.

- [ ] **Step 2: Update `.claude/skills/dsp-audio/SKILL.md`**

- `:156` → "`src/data/drumKits.ts`: `DrumKit` has 7 types — `kick, snare, hihat, openhat, clap, tom, crash`. `mergeDrumKit` is in `src/audio/drumKits.ts`."
- `:169` → "`src/data/synthPresets.ts` exports `SYNTH_PRESETS` (29 entries, `SynthPresetItem` …); the lookups (`presetById`, `applyPreset`, `getAllSynthPresets`, `getPresetsGroupedByCategory`) are in `src/audio/presetRegistry.ts`."

- [ ] **Step 3: Update `.claude/skills/music-theory/SKILL.md`**

- `:8` → theory *functions* live in `src/utils/musicTheory.ts`; the `SCALES` table lives in `src/data/scales.ts`
- `:25,33,39,50,113,122` → `SCALES` / `BASS_PATTERNS` locations become `src/data/scales.ts` / `src/data/bassPatterns.ts`
- `:88` → `src/data/chordProgressions.ts` holds `CHORD_PROGRESSIONS` — **44** progressions (was "40")
- `:94` → leave the `VIBE_GENRE_SCALES` tag rule; Part 3 deletes it, and rewriting it twice is churn. Add one line: "Part 3 of the data-layer spec deletes this rule."
- `:105` → `src/data/bassPatterns.ts` — `BASS_PATTERNS` (**16**, styles `Walking` / `Grooves` / `Minimal`) — was "12"
- `:116` → `src/data/chordRhythms.ts` — `CHORD_RHYTHMS` (**21**, 9 styles) — was "`RHYTHM_PATTERNS` (15, 9 styles)"

- [ ] **Step 4: Update `.claude/skills/instant-vibes/` paths only**

- `SKILL.md:56` → `presetById` → `SYNTH_PRESETS`
- `SKILL.md:59` → `CHORD_RHYTHMS`
- `SKILL.md:61` → `drumGridById` → `VIBE_DRUM_GRIDS`
- `SKILL.md:62` → `requireEffectChain` → `EFFECT_CHAINS`
- `SKILL.md:92` → `src/audio/chordProgressions.ts` (`VIBE_GENRE_SCALES` is still there)
- `SKILL.md:113-114` → `./src/data/chordProgressions.ts` and `./src/data/scales.ts`
- `SKILL.md:143-147` → `VIBE_DRUM_GRIDS` in `src/data/vibeDrumGrids.ts`, separate from `DRUM_GRIDS`
- `references/authoring-libraries.md:35` → `CHORD_PROGRESSIONS` (`src/data/chordProgressions.ts`)
- `references/authoring-libraries.md:98-101` → one array: append to `SYNTH_PRESETS` in `src/data/synthPresets.ts`; ids follow the file's convention (`factory-` for most, `bass-` for the five that predate the merge); id and name uniqueness are pinned by `src/data/synthPresets.test.ts` and `src/audio/presetRegistry.test.ts`

Leave `SKILL.md:79-82` (write the id twice), `:169`, `:201`, `:205-215` and `references/authoring-libraries.md:45,148-151` alone — Parts 2 and 3 delete the procedures they describe. The stale "six vibes" counts at `SKILL.md:3,11,169` are also Part 2/3's, since Part 2 is what changes the vibe table.

- [ ] **Step 5: Repoint `vibe-inventory.ts` so it still runs**

Rewrite `.claude/skills/instant-vibes/scripts/vibe-inventory.ts:11-16`:

```ts
import { CHORD_PROGRESSIONS } from '../../../../src/data/chordProgressions';
import { VIBE_GENRE_SCALES } from '../../../../src/audio/chordProgressions';
import { SYNTH_PRESETS } from '../../../../src/data/synthPresets';
import { CHORD_RHYTHMS } from '../../../../src/data/chordRhythms';
import { BASS_PATTERNS } from '../../../../src/data/bassPatterns';
import { VIBE_DRUM_GRIDS } from '../../../../src/data/vibeDrumGrids';
import { EFFECT_CHAINS } from '../../../../src/data/effectChains';
```

and rename the uses at `:66-67` (`ALL_FACTORY_PRESETS` → `SYNTH_PRESETS`), `:90` (`RHYTHM_PATTERNS` → `CHORD_RHYTHMS`), `:92-93` (`VIBE_DRUM_PATTERNS` → `VIBE_DRUM_GRIDS`, `GENRE_PRESETS` → `DRUM_GRIDS`) and `:94-95` (`VIBE_EFFECT_CHAINS` → `EFFECT_CHAINS`).

Run: `bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts`
Expected: it runs and prints the inventory. `VIBE_GENRE_SCALES` still resolves — Part 3 deletes it and rewrites this script's genre section then.

- [ ] **Step 6: Final full verification**

Run: `bun run verify`
Run: `grep -rn "ALL_FACTORY_PRESETS\|FACTORY_BASS_PRESETS\|GENRE_PRESETS\|RHYTHM_PATTERNS\|VIBE_DRUM_PATTERNS\|VIBE_EFFECT_CHAINS\|audio/data/" src scripts .claude docs/design.md CLAUDE.md`
Expected: no output.

Run: `grep -rEn "^import [^t]" src/data/*.ts | grep -v "\.test\.ts"`
Expected: no output — every import in a `src/data/` table file is `import type`.

- [ ] **Step 7: Commit**

```
git add CLAUDE.md .claude/skills
git commit -m "docs: record the src/data/ layer and repoint every moved path

CLAUDE.md gains a fourth layer with the three bans and the 'adding an entry is
an edit to that table and nothing else' test. Three stale counts in the
music-theory skill are corrected while the paths are being rewritten: 44
progressions (was 40), 16 bass patterns (was 12), 21 chord rhythms (was 15).

The instant-vibes skill's genre and write-the-id-twice procedures are left
alone — Parts 2 and 3 delete the mechanisms they describe."
```

---

## Where the source disagrees with the spec or the brief

Every count, path, symbol and line number in this plan was read out of the source on the branch as it stands at `1b75faf`. Six places disagree; the plan follows the source.

1. **`SYNTH_PRESETS` is 29 entries, not 37.** The spec's "What moves" row says `FACTORY_PRESETS, 32` **+** `FACTORY_BASS_PRESETS, 5` = 37, and the brief repeats "merged 37-entry array". Measured: `FACTORY_PRESETS.length === 24` and `FACTORY_BASS_PRESETS.length === 5`, so the merged array is **29**. The 32 appears to come from a survey counting `^    id: '` lines in `src/audio/synthPresets.ts`, which is 32 — 24 presets plus the 8 `SYNTH_CATEGORIES` entries, which sit at the same indent. The spec's Context paragraph ("37 synth presets") carries the same error. Task 2 pins 29 in `src/data/synthPresets.test.ts`.

2. **`data/drumKits.ts` comes from `audio/drumKits.ts:1-181`, not `:52-181`.** The spec's range starts at `DrumKit` (`:52`), but the exports it lists include "the six param interfaces", which are at `:1-50`. Task 4 moves `:1-181`.

3. **The spec's eslint block silently un-bans `confirm` / `alert` / `prompt` inside `src/data/`.** It correctly notes that `no-restricted-syntax` is not additive and that the block must re-declare the global entries — then sets `no-restricted-globals`, which is not additive either, without re-declaring the three native-prompt bans at `eslint.config.js:46-51`. This plan re-declares them, on the spec's own stated principle ("the list is a floor, not a ceiling"), and `dataLayerPurity.test.ts` has a row pinning it.

4. **The brief's ordering premise does not hold, so the eslint block lands first at `'error'`, not warn-then-error.** The brief says the block "cannot be switched to `error` until every table is moved, or the gate goes red mid-plan". The block scopes to `src/data/**`, which does not exist when it lands; there are zero files to violate it, and every file added afterwards is written compliant. See "Ordering decision" for the full argument. The warn-then-error precedent in the hygiene matrix exists for rules with pre-existing violations, which this is not.

5. **The brief's three `FACTORY_BASS_PRESETS[0]` line numbers are all correct** — `src/store/synthSlice.ts:16`, `src/store/loopSlice.ts:32`, `src/store/store.test.ts:184`. Verified. No discrepancy; recorded because the brief asked for the check.

6. **Minor line drift, all verified and used in the plan rather than the spec's numbers:** `presetById`'s docblock is at `synthPresets.ts:816-819` (spec says `:815-819`); `mergeDrumKit` is at `drumKits.ts:200-210` (spec says `:202-208`); `RHYTHM_STYLE_GROUPS` is at `rhythmPatterns.ts:337` and the four `Math.*` uses in that file are at `:349` and `:354` (spec says `:349-370`); the eslint layering blocks are at `eslint.config.js:90-137` and the global `no-restricted-syntax` entry at `:58-87` (spec's `:90-136` is one line short). `docs/design.md` needs no Part 1 edit — every moved path it mentions is in §4 item 2, which Part 2/3 deletes wholesale.
