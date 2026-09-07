# Data Layer Extraction — Design

Date: 2026-09-06
Status: Draft — all owner decisions settled and folded in (helpers in `src/data/`, the vibe-id
realignment, deleting `vibeChips.ts`, and the rationale for keeping vibe ids out of `.solna`)

## Context

Solna's factory content — 29 synth presets, 44 chord progressions, 21 chord rhythms, 16 bass
patterns, 12 drum kits, 14 sequencer drum grids, 8 vibe drum grids, 6 effect chains, 11 scales and
8 Instant Vibes — is scattered across three layers with no rule about where a table lives. Some
of it sits in `src/audio/` beside DSP code (`synthPresets.ts`, `bassPatterns.ts`,
`rhythmPatterns.ts`, `drumKits.ts`), some in a `src/audio/data/` sub-folder that exists for no
stated reason other than that four files needed somewhere to go, and some in `src/store/`
(`instantVibes.ts`, `vibeChips.ts`). One table is buried inside a function library
(`SCALES` inside `utils/musicTheory.ts`).

> **Every count above was measured by evaluating the table, not by grepping it.** An earlier draft
> of this spec said *37* synth presets, from counting `^    id: '` lines in
> `src/audio/synthPresets.ts` — which is 32, being **24 presets plus the 8 `SYNTH_CATEGORIES`
> entries that share that indent**. The measured basis is `FACTORY_PRESETS.length === 24` plus
> `FACTORY_BASS_PRESETS.length === 5`, so the merged array is **29**. Re-derive a count with
> `bun -e "const {X} = await import('./src/…'); console.log(X.length)"`, never with `grep -c`: a
> table's rows and a file's lines are not the same thing, and this one is a table whose element
> shape appears twice in the same file.

The cost is not aesthetic. Three things follow from it today:

1. **Components import from `src/audio/`** to reach content. `SequencerView.tsx:17-18` imports
   `GENRE_PRESETS` and `DRUM_KITS`; `ChordView.tsx:79` and `ChordPresetLibrary.tsx:5` import
   `CHORD_PROGRESSIONS`. Layering rule 3 only bans `audio/engine`, so this is legal — but it means
   "components must not import audio" is not a rule anyone can state simply.
2. **A table cannot be told from a module that computes.** `audio/rhythmPatterns.ts` holds
   `RHYTHM_PATTERNS` *and* `feelToHoldScale`, `equalPowerVelocityScale`, `fullHoldDuration` and
   `customRhythmPattern`. Editing content and editing behaviour touch the same file, so a review
   of "I retuned a pattern" and a review of "I changed the hold maths" look identical in a diff
   list.
3. **A vibe is not data.** `INSTANT_VIBES` calls three resolver functions at module-evaluation
   time (`instantVibes.ts:156-664`). That is what forces `vibeChips.ts` to exist as a
   hand-duplicated copy — a second table of seven fields, plus a test whose only job is to prove
   the copy has not drifted — and it is what makes each vibe write its library ids twice.

This spec does three coupled things, because doing any one alone leaves the other two blocked:

- **Part 1** — a `src/data/` layer whose files import nothing at runtime, read no impure global and
  hold no mutable binding, with an eslint guard for each.
- **Part 2** — `InstantVibe` splits into `VibeSpec` (ids only, in `data/`) and `ResolvedVibe`
  (produced at apply time), because a vibe that calls three *imported* resolvers at module scope
  cannot live in a folder that imports nothing. The duplicated `vibeChips.ts` goes with it.
- **Part 3** — the dice pool becomes per-vibe data and the `VibeGenre` mechanism is deleted,
  because a *derived* pool is a computed value and a genre union is a `src/types.ts` edit that
  adding content should never require.

The through-line: **static content becomes data, and a vibe becomes pure data too.**

## Part 1 — `src/data/`

### The rule, stated once

> **A file in `src/data/` cannot do anything at load that a reader of the file cannot see.** It
> imports nothing at runtime — **not even another file in `src/data/`** — reads no impure global,
> declares no function and constructs no object, and holds no mutable module-scope binding. It may
> declare types and interfaces, and may `import type` from anywhere. Top-level `const` arrow
> helpers that are shorthand for writing a literal are allowed.
>
> Equivalently, and more usefully: **every file in `src/data/` is an independent leaf.**

The load-bearing half of that rule is the **import ban**, not a ban on syntax. What makes a
`src/data/` file safe to read as content is that nothing outside it can influence what it evaluates
to — not that it contains no parentheses. The three enforced bans below are the three ways a file
could reach outside itself, and closing all three is what makes the "helpers are shorthand"
convention safe to leave unenforced (see "Helpers, and why the convention needs no guard").

Layers become **`data → audio → store → components`**, and every layer may import `data/`.
`src/utils/` is unchanged and stays outside the four-layer chain — it is a leaf-module folder that
all layers already import (`meter.ts`, `musicTheory.ts`, `stepResolution.ts`). `data/` sits below
`utils/` too: `utils/musicTheory.ts` will import `SCALES` from `data/scales.ts`, never the
reverse.

The rule is worth its enforcement cost because it makes one question answerable by location alone:
*can this file's value depend on anything I cannot see in it?* A `src/data/` file's cannot. That is
what lets a reviewer read a 900-line preset diff as content, and it is what makes `data/vibes.ts`
importable by a top-bar component without dragging a resolver graph into the eager chunk (Part 2).

### Enforcement in `eslint.config.js`

Two blocks, following the existing layering blocks at `eslint.config.js:90-137`:

```js
{
  files: ['src/data/**/*.ts'],
  rules: {
    // The import ban. The base rule MUST be off for the TS-aware one to run.
    'no-restricted-imports': 'off',
    '@typescript-eslint/no-restricted-imports': ['error', {
      patterns: [{ group: ['**'], message: 'src/data/ holds literals: `import type` only.',
                   allowTypeImports: true }],
    }],

    // The impure-global ban. `no-restricted-globals` reports the identifier
    // itself, so the message lands on `Math` rather than on the statement.
    //
    // NOTE: this REPLACES the global no-restricted-globals entry
    // (eslint.config.js:46-51), so its confirm/alert/prompt bans are
    // re-declared at the end here, verbatim.
    'no-restricted-globals': ['error',
      ...['Math', 'Date', 'crypto', 'fetch', 'performance', 'process', 'globalThis',
          'localStorage', 'sessionStorage', 'window', 'document'].map((name) => ({
        name, message: 'src/data/ is pure: no impure globals.',
      })),
      { name: 'confirm', message: 'Use ui/ConfirmDialog — confirm() blocks the main thread and cannot be themed.' },
      { name: 'alert', message: 'Use an inline role="alert" notice — alert() blocks the main thread and cannot be themed.' },
      { name: 'prompt', message: 'Use ui/Modal with a form — prompt() blocks the main thread and cannot be themed.' },
    ],

    // NOTE: this REPLACES the global no-restricted-syntax entry (eslint.config.js:58-87),
    // so its React.FC and `../../` bans are re-declared here verbatim.
    'no-restricted-syntax': ['error',
      /* …the two global entries, copied … */
      { selector: 'NewExpression',
        message: 'src/data/ holds literals: write the literal, not a constructed object.' },
      { selector: 'FunctionDeclaration',
        message: 'src/data/ holds literals: only top-level `const` arrow helpers.' },
      { selector: 'FunctionExpression',
        message: 'src/data/ holds literals: only top-level `const` arrow helpers.' },
      { selector: 'ClassDeclaration',
        message: 'src/data/ holds literals, not classes.' },
      { selector: 'ClassExpression',
        message: 'src/data/ holds literals, not classes.' },
      { selector: 'Program > VariableDeclaration[kind=/^(let|var)$/]',
        message: 'src/data/ is stateless: module-scope bindings must be `const`.' },
      { selector: 'ExportNamedDeclaration > VariableDeclaration[kind=/^(let|var)$/]',
        message: 'src/data/ is stateless: module-scope bindings must be `const`.' },
    ],
  },
}
```

#### The rule that governs all of it: **a `files:` block that sets a rule REPLACES the global entry for that rule, for those files**

Flat-config severities and options are not merged. Setting `'no-restricted-syntax'` inside a
`files:` block does not *add* to whatever the global config declared — it discards it. The three
existing layering blocks never hit this, because each of them sets exactly one rule
(`no-restricted-imports`) that the global config does not set at all. The `src/data/` block is the
first in this config to override a rule the global config already carries, and it overrides **two**
of them.

**So the rule, stated once and applied to every rule this block touches:** for each rule a
`files:` block sets, look up what the global config declared for that same rule id and re-declare
it verbatim inside the block, then add the new entries. The spec must **name each rule it touches
and say what was carried across**, rather than leaving a reader to check. For this block:

| rule the block sets | what the global config had | carried across? |
|---|---|---|
| `no-restricted-imports` | nothing global (only the three layering blocks) | n/a — set to `'off'` so the TS-aware variant can run |
| `@typescript-eslint/no-restricted-imports` | nothing | n/a — new |
| `no-restricted-globals` | `confirm`, `alert`, `prompt` (`eslint.config.js:46-51`) | **yes** — all three re-declared verbatim after the eleven impure globals |
| `no-restricted-syntax` | two React.FC selectors + three `../../` selectors (`eslint.config.js:58-87`) | **yes** — all five re-declared verbatim before the seven new selectors |

Missing either one is silent. A dropped `../../` ban un-bans relative cross-folder imports in the
one folder where every import is a type import; a dropped `confirm`/`alert`/`prompt` ban un-bans
the three native modals in the one folder that is supposed to be incapable of doing anything at
all. Neither produces an error, a warning or a diff hunk that looks wrong — which is why the
change owes a **committed fixture test** that asserts the reported rule ids *and severities* for
each case (see "New tests this change owes", item 1), and why that test carries a row for
`confirm` and a row for `../../` specifically.

Six further notes on the shape, each of which is a trap if missed:

- **`allowTypeImports` only exists on the typescript-eslint variant.** The base
  `no-restricted-imports` has no such option, and typescript-eslint requires the base rule to be
  disabled for its own to take effect. Both lines are load-bearing.
- **`no-restricted-syntax` and `no-restricted-globals` are both non-additive, and this block is the
  first one in the config to override either.** Copy all five `no-restricted-syntax` objects (two
  React.FC selectors, three `../../` selectors for `ImportDeclaration`, `ExportNamedDeclaration`
  and `ExportAllDeclaration`) and all three `no-restricted-globals` entries (`confirm`, `alert`,
  `prompt`). The `/* …the two global entries, copied … */` line above is not a placeholder to leave
  in.

  **The existing comment at `eslint.config.js:66-75` must be corrected in the same change.** It
  reads: *"the path-scoped layering blocks below override only `no-restricted-imports` for their
  files … `no-restricted-syntax` is untouched by those blocks, so this entry reaches every file."*
  After this change that is false — `src/data/**` is the exception — and it is exactly the kind of
  comment a later reader trusts instead of checking. The corrected comment should say which rules
  the data block replaces, so the next person to add a global entry knows there is a second copy.

- **The global entry is `'warn'`; the data block sets `'error'`.** That is deliberate, and it means
  a React.FC or a `../../` inside `src/data/` fails the gate rather than warning. `bun run verify`
  requires zero eslint *errors*, so this is a real escalation and not a formality — but neither ban
  is reachable in practice there (no JSX in a data file, and the `@/` alias covers cross-folder).

- **The glob has been measured, not assumed.** The concern was real: the existing layering blocks
  all use path-fragment groups (`['**/store/**']`) that only ever have to match a specifier
  containing a folder name, and minimatch's `**` does not obviously match a leading `./`. So the
  block above was patched into `eslint.config.js` and run with `npx eslint` (ESLint 10.9.1, the
  repo's own version) against fixture files under `src/data/`, then reverted. Result — a plain
  `group: ['**']` catches every specifier form there is:

  | import form in a `src/data/` file | result |
  |---|---|
  | `import type { MeterId } from '../utils/meter'` | **allowed** |
  | `import { METERS } from '../utils/meter'` | blocked (relative, cross-folder) |
  | `import { SCALES } from '@/utils/musicTheory'` | blocked (alias) |
  | `import { Note } from 'tonal'` | blocked (bare package) |
  | `import { SIB } from './sibling'` | blocked (same folder) |

  No enumeration of forms is needed; `['**']` plus `allowTypeImports: true` is the whole rule. The
  base-rule-shadowing trap was confirmed in the same run: **without `'no-restricted-imports': 'off'`
  in the block, the typescript-eslint variant never fires at all** — every row above passes,
  including the four that must not.

#### The stronger invariant the measurement bought

The last row is the interesting one. The ban blocks a runtime import **between two files inside
`src/data/`**, not just imports that leave the folder. That is not a gap needing a carve-out — it
is the rule getting stronger than it was written to be, and the final design has no counterexample.
Checked file by file against the "What moves" table:

- `data/vibes.ts` carries id **strings**, never a reference to the table an id names — that is the
  entire point of Part 2.
- `data/drumGrids.ts`'s `GENRE_TO_KIT` maps a genre string to a kit **name string**
  (`'Synthwave': 'Retro Drive'`), not to a `DRUM_KITS` entry. It could sit in a different file from
  `data/drumKits.ts` and neither would notice.
- `data/vibeDrumGrids.ts` needs `MeterId` as a **type** only. The one runtime import in its source
  module today — `DEFAULT_METER_ID` at `vibeDrumPatterns.ts:21` — is used exclusively by
  `drumPatternMeterId` at `:145`, and that function stays in `audio/` per "What stays behind".
- `satisfies` and `as const` take a type import or nothing.
- `DEFAULT_DRUM_KIT` is referenced only from within its own file (`drumKits.ts:200-210`, inside
  `mergeDrumKit`, which stays in `audio/`).

There is exactly **one** runtime sibling import among the source modules today, and this spec
already removes it for an unrelated reason: `synthPresets.ts:2` imports `FACTORY_BASS_PRESETS` from
`./bassPresets` (with `bassPresets.ts:1` importing the `SynthPresetItem` type back — a cycle in
which one direction is a value). "What moves" merges both arrays into a single 29-entry
`SYNTH_PRESETS` in one file, so the import has no sibling left to point at. The merge was proposed
to end the `FACTORY_PRESETS` / `ALL_FACTORY_PRESETS` split; it also happens to be what makes the
folder-wide invariant hold.

> **Every file in `src/data/` is an independent leaf. It imports nothing at runtime — not even
> another file in `src/data/`.**

What that buys, beyond the purity argument: **there is no load order.** A folder of literals where
one file may read another has an evaluation graph, and an evaluation graph has a temporal-dead-zone
failure mode — `A` imports `B`, `B` imports `A`, and one of them sees `undefined` at module scope
with no error anywhere. That class of bug cannot exist here. Concretely, it means any data file can
be read, reviewed, moved, split or copied into a fixture **in isolation**, and a reviewer who has
one file open has all of its inputs on screen. It is also the precondition the "Out of scope" note
depends on: a table that reads no sibling is a table that could be serialised to JSON and loaded at
runtime later.
- **Two selectors for `let`/`var`, not one.** `Program > VariableDeclaration` catches
  `let n = 0;` but *not* `export let n = 0;`, because the declaration is then a child of an
  `ExportNamedDeclaration`, not of `Program`. Both selectors are needed. The alternative —
  escalating `prefer-const` — does **not** work: `prefer-const` only fires on a binding that is
  never reassigned, so the exact case this ban exists to catch (`let n = 0` followed by `n++`) is
  the one case `prefer-const` deliberately allows.
- **`no-restricted-globals` is the right rule for the impure globals, not a syntax selector.** It
  is scope-aware: it fires on a *global* reference and stays silent on a local binding that
  shadows the name, so a table with a field called `performance` or a helper parameter named `date`
  is untouched. A `no-restricted-syntax` selector like `Identifier[name='Math']` has no scope
  information and would flag both. The list is a floor, not a ceiling — add to it rather than
  arguing about whether a given global counts.
- **`satisfies` is unaffected.** It parses as `TSSatisfiesExpression`, not a call, so
  `export const X = {...} satisfies Record<string, Y>` stays legal and is the preferred way to
  type a table without widening its literal types. `as const` is likewise untouched.
- **`NewExpression` is banned outright, with no carve-out, and nothing in the move needs one.**
  The repo's one instance of the idiom is `const PROGRESSIONS_BY_ID = new Map(...)`
  (`chordProgressions.ts:640`) — and per "What stays behind", that line does **not** move to
  `src/data/`. It is a lookup index built over the table, so it stays with `progressionById` in
  `audio/chordProgressions.ts`, on the other side of the split. The ban is therefore free: it
  costs nothing today and closes the one construction that is both stateful and invisible in a
  diff of values. Verified against every prospective `src/data/` file: no `new`, and no read of
  `Math`, `Date`, `crypto`, `performance` or any other banned global. The four `Math.*` uses in
  `rhythmPatterns.ts:349-370` and `bassPatterns.ts:389` are all inside resolver functions that stay
  in `audio/`.

### Helpers, and why the convention needs no guard

**Allowed:** a top-level `const` arrow helper and calls to it. `CallExpression` and
`ArrowFunctionExpression` are *not* in the ban list.

**Convention, documented but not enforced:** a helper in `src/data/` may only be shorthand for
writing a literal — it takes values and returns an object or array built from them, and does
nothing else.

That convention is safe to leave unenforced because the three enforced bans make it true by
construction. A helper in a `src/data/` file:

1. **cannot see anything outside its file** — the import ban leaves it nothing to call but the
   file's own bindings;
2. **cannot see anything outside the program** — the impure-global ban removes every source of a
   value that is not written in the file (a clock, a random number, an environment, storage);
3. **cannot carry state between calls** — the `let`/`var` ban means there is no mutable binding for
   one call to leave behind for the next.

With all three closed, the *only* inputs a helper has are its arguments and the file's own `const`
literals, and the only thing it can produce is a value assembled from those. It is pure, total and
deterministic **whatever it is written to do**, so there is no hostile version of it to guard
against. `step(0, 1, 'min7')` is a shorter spelling of an object literal, and it is not possible
for it to be anything else.

Drop any one of the three and the argument collapses — which is why the third ban is enforced
rather than trusted:

> ```ts
> let n = 0;
> const step = (degree: number) => ({ id: `s${n++}`, degree });
> ```
>
> This imports nothing and touches no impure global, so bans 1 and 2 both pass it, and it is
> perfectly deterministic. But it makes every id **positional**: reordering two entries in the file
> renames both, and nothing in the diff says so. That is the same failure this spec spends Part 3
> arguing against — a value whose only legal setting is a consequence of something else — so it is
> closed at the rule level, not left to a reviewer's eye.

**Verified: no current or prospective `src/data/` file uses a module-scope `let` or `var` today.**
Every source module in the "What moves" table was checked; none has one, so the ban costs nothing
at adoption and nothing needs replacing.

### What moves

| new file | exports | from |
|---|---|---|
| `data/synthPresets.ts` | `SYNTH_PRESETS`, `SYNTH_CATEGORIES`, `SynthPresetItem`, `SynthPresetCategory`, `SynthPresetCategoryMeta` | `audio/synthPresets.ts` (`FACTORY_PRESETS`, **24**) **+** `audio/bassPresets.ts` (`FACTORY_BASS_PRESETS`, 5) merged into ONE array of **29** |
| `data/drumKits.ts` | `DRUM_KITS` (12), `DEFAULT_DRUM_KIT`, `DrumKit` + the six param interfaces | `audio/drumKits.ts:1-181` — the range **starts at `:1`**, not at `DrumKit` (`:52`): the six param interfaces at `:1-50` are part of what moves, and a range that begins at `:52` leaves the exports column unsatisfiable |
| `data/chordProgressions.ts` | `CHORD_PROGRESSIONS` (44), `ChordProgression`, `ProgressionStep`, `ProgressionCategory` | `audio/data/chordProgressions.ts:76-638` |
| `data/chordRhythms.ts` | `CHORD_RHYTHMS` (21), `RhythmPattern`, `RhythmHit`, `RhythmHitType` | `audio/rhythmPatterns.ts:68-335` (`RHYTHM_PATTERNS`) |
| `data/bassPatterns.ts` | `BASS_PATTERNS` (16), `BassPattern`, `BassStep`, `BassNoteToken`, `BassStepChoice` | `audio/bassPatterns.ts:175-371` |
| `data/drumGrids.ts` | `DRUM_GRIDS` (14), `GENRE_TO_KIT` (14), `DrumGrid` | `audio/data/genrePresets.ts:19` (`GENRE_PRESETS`) + `audio/drumKits.ts:183` |
| `data/vibeDrumGrids.ts` | `VIBE_DRUM_GRIDS` (8), `VIBE_DRUM_GRID_METERS` (8) | `audio/data/vibeDrumPatterns.ts:23` + `:132` |
| `data/effectChains.ts` | `EFFECT_CHAINS` (6) | `audio/data/vibeEffectChains.ts:23` |
| `data/vibes.ts` | `VIBES` (8), `VibeSpec` | `store/instantVibes.ts:156` — the literal only, restructured by Parts 2 and 3; **absorbs `store/vibeChips.ts` entirely** (Part 2) |
| `data/scales.ts` | `SCALES` (11), `ScaleDefinition` | `utils/musicTheory.ts:16-104` |

**`src/audio/data/` disappears entirely.** Its four files split between `src/data/` (their tables)
and `src/audio/` (their resolvers). A `data/` sub-folder inside a layer was a way of admitting the
problem without naming it.

Type declarations travel with their table. `data/` is allowed to declare types and is allowed
`import type` from anywhere, so a table and its shape stay in one file and every consumer imports
the shape from the same place it imports the values. `CategoryPresetGroup` is the exception: it
describes the *output* of a grouping function, not a table, and goes with the registry.

### What stays behind, and where

| new/kept module | keeps | why it is not data |
|---|---|---|
| `audio/presetRegistry.ts` (new) | `presetById`, `getAllSynthPresets`, `applyPreset`, `findPresetByName`, `getPresetsGroupedByCategory`, `getCategoryMeta`, `CategoryPresetGroup` | every one is a lookup or a merge over the table |
| `audio/chordProgressions.ts` (moved up out of `data/`) | `progressionById`, `resolveProgression`, `PROGRESSIONS_BY_ID` | `resolveProgression` calls `getDiatonicChordForDegree` and `deriveChordNotes`; the `Map` is computed |
| `audio/chordRhythms.ts` (renamed from `rhythmPatterns.ts`) | `CHORD_RHYTHM_STYLE_GROUPS`, `feelToHoldScale`, `equalPowerVelocityScale`, `fullHoldDuration`, `customRhythmPattern` | `*_STYLE_GROUPS` is `groupByStyle(...)`, a call |
| `audio/bassPatterns.ts` | `BASS_STYLE_GROUPS`, `resolveBassSteps`, `isApproachToken`, `customBassPattern`, `ResolvedBassEvent` | same, plus the whole token-resolution engine |
| `audio/drumKits.ts` | `mergeDrumKit` | a merge |
| `audio/vibeDrumGrids.ts` | `drumGridById` (was `drumPatternById`), `drumGridMeterId` | returns a fresh deep copy per call, deliberately |
| `audio/effectChains.ts` | `effectChainById`, `requireEffectChain` | lookups; `requireEffectChain` throws |
| `store/vibes.ts` (renamed from `instantVibes.ts`) | `resolveVibe` (new, Part 2), `applyVibeToStore` (was `applyInstantVibeToStore`), `resolveVibeSynthParams`, `VIBE_IDS` | `VIBE_IDS` is `VIBES.map(...)` |
| `utils/musicTheory.ts` | `ROOTS` and every function; imports `SCALES` from `data/scales.ts` | see below |

`ROOTS` stays in `musicTheory.ts` deliberately even though it is a bare literal: it is the
chromatic spelling convention that `getScaleNotes`, `transposePitchClass` and `rootSemitone` are
each written against, and moving it away from them would separate a convention from the three
functions that enforce it. `SCALES` is different — it is authored content that grows (11 entries
today, each hand-authored with per-degree qualities), and `progressionAvailability.ts`,
`bassPatterns.ts` and `PadModulePanel` all read it as a table.

### The naming rule

> **A name says what an entry IS, not what it is keyed by.** `GENRE_PRESETS` was keyed by genre,
> but each entry is a drum grid — so it is `DRUM_GRIDS`. `VIBE_DRUM_PATTERNS` is keyed by a
> library id and each entry is a drum grid too, so `VIBE_DRUM_GRIDS`.

And: **`preset` and `pattern` are banned as a name with no qualifier.** The repo currently uses
`preset` for a synth patch (`FACTORY_PRESETS`), for a drum grid (`GENRE_PRESETS`) and for a chord
progression (`ChordPresetLibrary.tsx`); it uses `pattern` for a chord-comp rhythm
(`RHYTHM_PATTERNS`), a bass figure (`BASS_PATTERNS`) and a drum grid (`VIBE_DRUM_PATTERNS`). Both
words have come to mean "a thing from a library", which is the one meaning a name in a folder full
of libraries cannot carry.

`RHYTHM_PATTERNS` → `CHORD_RHYTHMS` is the sharpest case: the table is chord-comp only —
`useChordPlayback.ts:19` is its consumer — and "rhythm pattern" reads as if it might cover drums.

### `step()`, `block()` and `strum()` travel with their tables

Two tables build their entries with module-private helpers, and both helpers move into `src/data/`
unchanged:

- `chordProgressions.ts:73` — `const step = (degree, bars = 1, quality?) => ...`, used in 179
  places across 44 progressions.
- `rhythmPatterns.ts:46` and `:53` — `block(step, velocity, holdSteps)` and
  `strum(step, direction, velocity, holdSteps, spreadMs)`, used in 94 places across 21 patterns.

All three are exactly the case the helper convention describes: a shorter spelling of an object
literal, defined at the top of the file that uses it and nowhere else. Under the three bans above
they are pure by construction, so they need no exemption and get none — the rule was written to
allow them, not to tolerate them.

**Considered and rejected by the owner: expanding all 273 calls inline.** The mechanical case for
it was sound — `strum(4, 'up')` hides three default parameters from a reader of the table, and
expanding it makes every field visible at the point of use. It was rejected because the price is
paid on every future read of the two largest content files in the repo, in exchange for a property
the import and global bans already deliver. A reviewer who can see that `step` is defined four
lines above the table, in a file that can import nothing, can read `step(0, 1, 'min7')` as data
without leaving the file.

One consequence to keep in view: a default parameter *is* a fact about the table that its rows do
not show. The mitigation is that the helper must sit directly above the table it builds, in the
same file. A shared `data/helpers.ts` would be a real regression — the whole convention rests on
"the helper's inputs are its arguments and this file's own literals" — but it needs no separate
rule, because the import ban already covers it: `src/data/**` may not import at runtime, and that
includes a sibling inside `src/data/`.

### What is deliberately NOT moving

| stays | why |
|---|---|
| `ROOTS` (`musicTheory.ts:5`) | a spelling convention, inseparable from the three functions that enforce it |
| `METERS` (`utils/meter.ts:32`) | a system registry — a seventh meter needs `accentGroups`, `MAX_STEPS_PER_BAR` and the lead's divisibility matrix reviewed, not just a row |
| `METER_OPTIONS` (`components/meterSelect.ts:13`) | already computed — `METER_IDS.map(...)` |
| `THEME_TOKENS` (`utils/themeColor.ts:36`) | a system registry paired with `check:theme` and `index.css`; adding a token is a CSS change |
| `VIEW_META` (`components/viewMeta.ts:27`) | a system registry — a sixth view needs a tab, a route and an `App.tsx` mount |
| the three `*Fixture.ts` files (`store/instantVibes{Chords,Drums,Effects}Fixture.ts`) | golden snapshots belong beside their tests; `instantVibesChordsFixture.ts` also *calls* `deriveChordNotes`, and moving it would either break the purity rule or destroy the independence that makes it a proof |
| `presetsSlice` (`store/presetsSlice.ts`) | `customSynthPresets` / `customChordProgressions` are user data written at runtime, not factory content |

The distinguishing test: **adding an entry to a data table must be an edit to that table and
nothing else.** Adding a `METERS` row, a `THEME_TOKENS` entry or a `VIEW_META` view all require
code changes elsewhere. Those are registries; they stay where the code that reads them lives.

## Part 2 — `VibeSpec` and `ResolvedVibe`

### The problem

A vibe literal today calls three functions per entry (`instantVibes.ts:195-197`, and the same
three lines in each of the eight entries):

```ts
progressionId: 'lofi-morning-turnaround',
chords: resolveProgression(progressionById('lofi-morning-turnaround')!, 'C', 'Major', 4),
drumPatternId: 'lofi-half-time-brush',
drumPattern: drumPatternById('lofi-half-time-brush')!,
effectChainId: 'lofi-tape-room',
effects: requireEffectChain('lofi-tape-room'),
```

That cannot live in a literal-only `src/data/`. It also has a documented failure mode.
`.claude/skills/instant-vibes/SKILL.md:79-82` records it in as many words:

> Each sits beside the id it resolves, and the id is written twice on purpose — a typo in the
> second makes `!` hand back `undefined` and `Object.entries(vibe.drumPattern)` throws at apply
> time, so check the pair matches.

**Writing the id once removes that failure mode entirely.** The skill's advice ("check the pair
matches") is a human check for a class of bug that only exists because the data duplicates itself.

### The split

`src/data/vibes.ts` holds `VibeSpec` — **ids only**. Every resolved field
(`chords`, `drumPattern`, `effects`) is gone from the table. Resolution moves to `store/vibes.ts`:

```ts
// store/vibes.ts
export function resolveVibe(spec: VibeSpec): ResolvedVibe
```

`ResolvedVibe` is `VibeSpec` plus the three resolved fields, and `applyVibeToStore` takes a
`ResolvedVibe`. `resolveVibe` resolves everything **before** it returns, which preserves the rule
`applyInstantVibeToStore` already follows and documents at `instantVibes.ts:42`: resolve all ids
up front, because a throw mid-swap leaves the store holding half of each vibe.

Two consequences that pay for the change beyond the folder rule:

- **`resolveVibe` is where a bad id gets a real error.** Today `progressionById(...)!` and
  `drumPatternById(...)!` hand back `undefined` and fail somewhere downstream;
  `requireEffectChain` is the only one that throws, and `vibeEffectChains.ts:111` explains why it
  had to be different (spreading `undefined` is a silent no-op). With one resolver, all three ids
  get the loud treatment and the asymmetry disappears.
- **`data/vibes.ts` imports nothing at runtime**, so the vibe table can be imported eagerly with
  no resolver graph behind it — which is what lets `vibeChips.ts` be deleted rather than kept and
  re-justified. See below.

### `vibeChips.ts` is deleted, and `data/vibes.ts` takes its place

This is the strongest single argument in the spec, because the duplication it removes exists
**only** as a workaround for the coupling Part 2 dissolves. The chain, in order:

1. **The file states its own reason for existing.** `store/vibeChips.ts:4-10`:

   > Deliberately duplicates seven fields of INSTANT_VIBES rather than importing it: instantVibes.ts
   > resolves its chords, drum patterns and effect chains at MODULE EVALUATION time, so importing it
   > drags synthPresets.ts, chordProgressions.ts, vibeDrumPatterns.ts and vibeEffectChains.ts into
   > the eagerly-parsed main chunk. The bar renders none of that — it renders a name, an emoji, a
   > BPM and a key.

2. **The reason is real, and it is a *module-evaluation* reason, not a size one.** The Instant
   Vibes bar is always mounted, so whatever it imports is in the eager chunk. `instantVibes.ts:1-9`
   imports `audio/engine`, `playbackEngine`, `synthPresets`, `store`, `initialState`,
   `chordProgressions`, `vibeDrumPatterns` and `vibeEffectChains`, and the table body calls three of
   those resolvers per entry at module scope. The cost is measurable: the five modules the chip
   comment names total **2,489 lines** (`instantVibes` 665, `synthPresets` 886,
   `chordProgressions` 675, `vibeDrumPatterns` 146, `vibeEffectChains` 117); with `vibeVariation`
   (290), which the graph also pulls, **2,779** — which is what `InstantVibesBar.tsx:10-11`
   measures as *"~45 KB of source … into the eagerly-parsed main chunk for a bar that renders eight
   names and eight emoji."*

3. **Part 2 removes the cause, not just the symptom.** A `VibeSpec` resolves nothing, and
   `src/data/**` has no runtime imports **at all** — that is the enforced rule from Part 1, not an
   aspiration. So `import { VIBES } from '@/data/vibes'` pulls in exactly one module and its
   transitive graph is empty by construction. `data/vibes.ts` is **one file of roughly 490 lines**
   (today's `INSTANT_VIBES` literal is `:156-664`, ~509 lines, minus the 24 resolved-field lines
   Part 2 deletes; Part 3 renames the pool fields without growing them). **2,779 lines across six
   modules, three of which reach the engine and the store, becomes ~490 lines of literals in one.**

4. **So the duplication has nothing left to buy.** It is a hand-maintained copy of seven fields,
   plus a test whose entire job is to prove the copy has not drifted. Delete both.

**`VIBE_CHIPS` carries no presentational fields, so folding it in breaks no rule.** Correcting a
factual error worth stating explicitly, because it is the obvious objection to raise later:
`VIBE_CHIPS` is `VibeChip[]` — an **array**, in the same order as `INSTANT_VIBES`, not a `Record`
keyed by id. Its seven fields are `id`, `name`, `emoji`, `bpm`, `scaleRoot`, `scaleType` and
`hasVariation`. Six of those are already fields of `InstantVibe` verbatim; the seventh is derived.
There is **no** `color`, `bgGradient`, `borderColor` or `textColor` — the four that
`.claude/skills/instant-vibes/SKILL.md:201` forbids on a vibe. Nothing presentational moves into
`data/vibes.ts`, and the chip's look stays where it is, in `InstantVibesBar`'s theme classes.

Four consequences, each verified:

- **`hasVariation` becomes derived, not stored.** `VibeSpec` has no such field; the bar reads
  `!!vibe.random`. `vibeChips.test.ts:19` already computes it exactly this way
  (`hasVariation: Boolean(v.variation)`), which is the proof that it was never independent data.
  All eight vibes have a `variation` today, so every chip shows a dice and this changes no pixel —
  but the derivation is what keeps that true if a ninth vibe ships without one.
- **`vibeChips.test.ts` is deleted outright, not migrated.** Every one of its four tests pins the
  duplicate against the original: `:6` same ids in the same order, `:10` every field
  field-for-field, `:24` the four drifting id/label pairs, `:34` id uniqueness. With one table,
  the first three assert a table against itself. Id uniqueness is worth keeping and moves to the
  vibe-table suite; the drifting-pairs test is deleted by Decision 2 in any case.
- **The dynamic import in the click handler stays — but it narrows.**
  `InstantVibesBar.tsx:23-35` currently `Promise.all`s **two** modules: `./vibeActions` and
  `../store/instantVibes`. The second is no longer needed; the bar has the spec in hand from the
  eager `VIBES` import and passes it straight to `selectVibe`. The first is still very much needed
  and must not be inlined: `vibeActions` reaches `applyVibeToStore`, which reaches
  `audio/engine`, `playbackEngine` and the resolvers — the entire graph the lazy boundary exists
  to keep out of the eager chunk. The prefetch on idle/hover/focus (`:80-92`) is unchanged.
- **`InstantVibesBar.tsx` changes in four named places, and nowhere else.** `:3` imports `VIBES` /
  `VibeSpec` from `@/data/vibes` instead of `VIBE_CHIPS` / `VibeChip` from `../store/vibeChips`;
  `:17-35` drops `INSTANT_VIBES` from `loadVibeActions`'s promise and its return; `:94-117`
  `handleSelectVibe` / `handleReroll` lose their `INSTANT_VIBES.find((v) => v.id === chip.id)`
  lookup and the `if (!vibe) return;` guard that goes with it — the argument *is* the vibe;
  `:132-181` maps `VIBES` and reads `vibe.random` where it read `vibe.hasVariation`. The rendered
  markup, the class expressions, `isSelected`, the toasts and the dice are untouched. Removing that
  `.find` also removes a real silent-failure path: a chip whose id had no matching vibe did nothing
  at all when clicked.

The head comment on `data/vibes.ts` should record why the eager import is now safe — one sentence
naming the `src/data/` no-runtime-imports rule as the thing holding it up. Without that, the next
person to find `VIBES` imported into an always-mounted component reasonably reaches for a lazy
boundary and re-creates the problem.

### The three golden fixtures

`instantVibesChordsFixture.ts`, `instantVibesDrumsFixture.ts` and `instantVibesEffectsFixture.ts`
currently compare against `vibe.chords`, `vibe.drumPattern` and `vibe.effects` — table fields.
After Part 2 those fields do not exist on a `VibeSpec`, so the tests compare against
`resolveVibe(spec)` output instead.

**They must still import nothing from the vibe table or the libraries.** Each fixture's head
comment says the same thing three times — "it is a snapshot, not a re-derivation, and that
independence is the whole proof" — and that is exactly as true against a resolver's output as
against a table field. What changes is one expression in each test file; what does not change is a
single asserted value.

Two stale comments in the fixtures must be corrected in the same change: the drums fixture claims
it pins "all 6×7×16 authored cells" (there are 8 vibes, and `waltz-brush-three` /
`afro-six-eight-bell` are 12 steps, not 16), and `instantVibesProgressions.test.ts:15` names its
test "captures exactly the six vibes".

## Part 3 — per-vibe pools; the genre mechanism is deleted

### What exists today

`VibeVariation.progressionIds` (`types.ts:253`) is documented as a hand-written field whose value
is a *derived* one. `vibeVariation.test.ts:205-215` pins the derivation:

```ts
test('progressionIds equals the full genre-and-scale-length filter', () => {
  const expected = CHORD_PROGRESSIONS.filter(
    (p) => p.genres.includes(r.genre) && p.minScaleLength <= scaleLength(v.scaleType),
  ).map((p) => p.id);
  expect([...r.progressionIds].sort()).toEqual([...expected].sort());
  expect(r.progressionIds.length).toBeGreaterThanOrEqual(4);
});
```

So `progressionIds` is data whose only legal value is the output of a rule. Adding one progression
to the library and tagging it `lofi` silently changes what two vibes can roll, and the test then
demands the arrays be edited to match — a change to shared content forcing an edit to unrelated
vibes.

### The evidence for reversing it

All three claims below were checked against the source, not taken on trust.

1. **`variation.genre` has zero runtime consumers.** `grep -rn genre src --include=*.ts
   --include=*.tsx`, excluding tests, finds it only as a *declaration* (`types.ts:250`), as
   *authored values* in the eight vibe literals, and in comments. `vibeVariation.ts` never reads
   it — `resolveVibeVariation` (`:184`) draws from `rule.progressionIds` directly. The field
   exists solely to make the invariant test computable.
2. **`ChordProgression.genres` has no runtime consumer either.** Every `.genres` reference in
   `src/` is in a test file (`chordProgressions.test.ts:19,77,144,151,162,171` and
   `vibeVariation.test.ts:181,210`). The UI's availability filter,
   `components/loop/chord/progressionAvailability.ts`, uses `minScaleLength` and nothing else.
3. **The original rationale describes an outcome, not a requirement.**
   `2026-08-26-vibe-variation-engine-design.md:390` reads: *"Cross-check ruling R4 settled the
   size of that filter's output: B1 ships four progressions for every one of the six `VibeGenre`
   values"* — i.e. the ≥4 floor was a property of what that build shipped, asserted afterwards.
   The same spec at `:384` also concedes the intent: *"The field exists so a specific progression
   can later be excluded from one vibe without editing the library; today no vibe deviates from
   the rule."* The escape hatch was designed in and then locked shut by the test.

### The replacement

`variation` is renamed `random`, and its fields say what they hold:

| today | after |
|---|---|
| `variation.genre: VibeGenre` | *deleted* |
| `variation.keyPool: string[]` | `random.keys: string[]` |
| `variation.bpmRange: [number, number]` | `random.bpm: [number, number]` |
| `variation.progressionIds: string[]` | `random.progressions: string[]` |
| `variation.rhythmIds: string[]` | `random.chordRhythms: string[]` |
| `variation.bassPatternIds: string[]` | `random.bassPatterns: string[]` |
| `variation.drumDecoration` | `random.drumDecoration` (unchanged) |

Each vibe carries its own explicit candidate arrays. **A one-member array is legitimate and
readable** — it states "this axis is deliberately fixed" in the same shape as every other axis,
where today the only way to say that is a comment or a pool of one that the derived-filter test
would reject.

`VibeGenre` (`types.ts:11`), `VIBE_GENRE_SCALES` (`chordProgressions.ts:64`) and the
`variation.genre` field are deleted. `types.ts` loses a union that content edits used to have to
widen.

`ChordProgression.genres` is kept as a free-form `string[]` for human browsing — the survey script
groups by it, and a tag like `lofi` is genuinely useful when choosing what to pool. **Nothing
computes from it.** Say so in the field's doc comment, because a `string[]` that once drove a
filter will otherwise be assumed to still drive one.

### Two guards the derived filter used to give for free

Both become invariant tests over each vibe's own pool. Both are *louder* than what they replace.

1. **Scale length.** Every id in `random.progressions` satisfies
   `minScaleLength <= SCALES[vibe.scaleType].intervals.length`. The old filter dropped a too-long
   progression **silently**; this fails the build. That matters most for `asian-zen` (Hirajoshi, 5
   degrees) and the two pentatonic scales, where a 7-degree progression would otherwise vanish
   from a pool with no signal.
2. **Reference scale.** Every pooled progression has `referenceScale === vibe.scaleType`. This
   replaces `referenceScale === VIBE_GENRE_SCALES[genre]` and is strictly more direct — it names
   the property that actually matters (the progression was authored against the scale the vibe
   plays) instead of routing it through a genre table.

   **This is behaviour-preserving, and the existing suite proves it transitively**:
   `chordProgressions.test.ts:78` already asserts `p.referenceScale === VIBE_GENRE_SCALES[genre]`
   for every tag, and `vibeVariation.test.ts:200` already asserts
   `v.scaleType === VIBE_GENRE_SCALES[v.variation.genre]`. Both are green today, so
   `referenceScale === vibe.scaleType` holds for every currently pooled progression.

A third guard is worth adding while the pools are being written out, because the derived filter
made it nearly automatic and explicit pools do not: **a vibe's own `progressionId` is a member of
its `random.progressions`.** The sibling assertions already exist for the other three axes —
`vibeVariation.test.ts:157-160` pins `keys ∋ scaleRoot`, `chordRhythms ∋ chordRhythmId` and
`bassPatterns ∋ bassPatternId` — and progressions were the one axis left out because the filter
covered it.

### The accepted cost, and the mitigation

**Pools can go stale as the library grows.** Add a progression tagged `lofi` today and the two
lo-fi vibes pick it up automatically; after this change they do not. That is the intended
trade — a shared-library edit no longer reaches into vibes that did not ask for it — but it means
a new entry can sit unreferenced forever.

**The mitigation is a report, not an assertion.** A script that lists library entries no vibe
references:

```json
"report:library": "bun scripts/report-library-coverage.ts"
```

It prints unreferenced progressions, chord rhythms, bass patterns, drum grids, effect chains and
synth presets, and **exits 0 always**. It is deliberately not part of `bun run verify`: an unused
library entry is a fact about the content, not a defect. A progression may exist for the chord
preset browser and never suit any vibe; asserting on the count would make the library's growth
depend on the vibes' appetite for it, which is the coupling this part exists to remove.

### Worked example — adding a "K-Pop Bright" vibe

New content: one progression, one vibe drum grid. Reused: synth presets, bass patterns, chord
rhythms, drum kits and an effect chain.

| file | edit |
|---|---|
| `src/data/chordProgressions.ts` | one `ChordProgression` entry, `referenceScale: 'Major'`, `minScaleLength: 7`, `genres: ['kpop']` (a free string — no union to widen) |
| `src/data/vibeDrumGrids.ts` | one grid + one `VIBE_DRUM_GRID_METERS` row |
| `src/data/vibes.ts` | one `VibeSpec`, whose `random.progressions` names the new id plus whichever existing Major-scale progressions suit it |

Plus one row each in the three golden fixtures, which are keyed by vibe id and pinned against
`VIBE_IDS` — that is unchanged by this spec and is true today too.

**Three files under `src/data/`, and nothing else.** `src/types.ts` is never touched, nor is any
file under `src/audio/`, `src/store/` or `src/components/`. The chip row that would have been a
fourth edit does not exist: Part 2 deletes `vibeChips.ts`, so a new vibe's name, emoji, BPM and key
are written once, in the same literal as everything else about it.

Contrast with today's cost for a vibe in a genre the union does not have
(`.claude/skills/instant-vibes/references/authoring-libraries.md:148-151` documents the procedure):
widen the `VibeGenre` union in `src/types.ts`, add an anchor scale to `VIBE_GENRE_SCALES` in
`src/audio/data/chordProgressions.ts`, author **at least four** progressions tagged with the new
genre before any test passes, then write the vibe. Four files across three layers, two of them
type/registry edits, and a minimum content quota enforced by a test rather than by taste.

## Traps and consequences

### 1. `FACTORY_BASS_PRESETS[0]` — the one genuinely dangerous item

The default bass patch is read **positionally** in two slices:

```
src/store/synthSlice.ts:16   bassSynthParams: { ...INITIAL_SYNTH_PARAMS, ...FACTORY_BASS_PRESETS[0].params },
src/store/loopSlice.ts:32    bassSynthParams: { ...INITIAL_SYNTH_PARAMS, ...FACTORY_BASS_PRESETS[0].params },
```

and asserted the same way at `src/store/store.test.ts:184`.

`FACTORY_BASS_PRESETS[0]` is `bass-deep-sine` ("Deep Sine Sub"). Merging the two arrays into
`SYNTH_PRESETS` puts `factory-cosmic-lead` at index 0, so **both defaults silently become a lead
patch, and `store.test.ts:184` follows the change rather than catching it** — it asserts against
the same expression it is meant to pin.

**Both sites must become an explicit id lookup**, resolved once at module scope in
`store/initialState.ts` or beside it:

```ts
const DEFAULT_BASS_PRESET = presetById('bass-deep-sine');   // throw/assert if undefined
```

and `store.test.ts:184` must assert against the **id**, not against an index. This is the only
change in the whole spec that can alter what the app sounds like without a test going red, and it
is why merging the arrays is worth calling out separately from the folder move.

Note in passing: the five bass presets use a `bass-` id prefix while the other 24 use `factory-`.
Merging the arrays makes that inconsistency visible in one list. **Do not "fix" it in this
change** — `bassPresetId` values are written into all eight vibe specs, and renaming them here
mixes a mechanical move with a content edit. If it is worth doing it is worth its own change.

### 2. `DRUM_GRIDS` and `VIBE_DRUM_GRIDS` must not be merged

`audio/data/vibeDrumPatterns.ts:9-15` records measured evidence:

```
// Deliberately NOT merged with GENRE_PRESETS (./genrePresets.ts). Measured:
// no vibe's pattern matches its own genre entry best (Jaccard over hit cells —
// synthwave-80s is closest to Trap at 81%, not Synthwave at 58%; ambient-chill
// peaks at 26% against anything; nothing matches at 100%), and the two
// disagree on cell type (boolean vs number), row set (`bass` only on the
// sequencer side, `crash` only here) and consumer. Merging them would force a
// sound change on one side or the other, which this refactor forbids.
```

**Carry that comment verbatim to `data/vibeDrumGrids.ts`**, with the file names updated. Putting
the two tables side by side in one folder under near-identical names makes them look mergeable in
a way they did not when one was in `audio/data/` and the other's key set was buried; the comment
is the only thing standing between a future reader and a silent sound change.

The reciprocal note at `genrePresets.ts:5-7` points at `vibeDrumPatterns.ts:9-15` by line number
and must be repointed.

Also update the `data/vibeDrumGrids.ts` head comment's other stale claims: it says "the six
Instant Vibes' authored drum skeletons" (there are 8) and "Library ids here are internal: projects
persist the resolved boolean grid, not the id" (still true, and worth keeping).

### 3. Documentation that goes stale — all fixed in this change

| file | what is wrong |
|---|---|
| `CLAUDE.md:122-125` | the "Instant Vibes ids drift from labels" trap entry — see item 5 |
| `CLAUDE.md:29` | the layer list — must become `data → audio → store → components` with the `src/data/` rule stated |
| `docs/design.md` §4 item 2 | the drifting-ids table, its stated reason, and a six-vibe list |
| `.claude/skills/instant-vibes/SKILL.md` | **already stale before this change**: `:11` and `:169` say six vibes (8); `:3`'s description lists 6 of 8 names; `:92`, `:113`, `:146` reference `src/audio/data/` paths; `:56` `ALL_FACTORY_PRESETS`; `:59` `RHYTHM_PATTERNS`; `:214` cites `src/types.ts:8` for `VibeGenre`, which is at `:11`; `:79-82` documents the write-the-id-twice rule that Part 2 deletes; `:205-215` documents the closed-union genre procedure that Part 3 deletes |
| `.claude/skills/instant-vibes/references/authoring-libraries.md` | `:45` `VIBE_GENRE_SCALES` rule; `:101` `ALL_FACTORY_PRESETS`; `:148-151` the four-coordinated-edits genre procedure — deleted by Part 3 |
| `.claude/skills/instant-vibes/scripts/vibe-inventory.ts` | `:11`, `:12`, `:19`, `:21`, `:66-67` import `CHORD_PROGRESSIONS`, `VIBE_GENRE_SCALES`, `VibeGenre` and `ALL_FACTORY_PRESETS` — the script will not run after this change and must be rewritten against `data/` and per-vibe pools |
| `.claude/skills/music-theory/SKILL.md` | `:88` `src/audio/data/chordProgressions.ts` and "40 progressions" (44); `:94` the `VIBE_GENRE_SCALES` tag rule; `:105` `BASS_PATTERNS (12, …)` (16); `:116` `RHYTHM_PATTERNS (15, 9 styles)` (21); `:25`, `:33`, `:39`, `:50`, `:113`, `:122` reference `SCALES` / `BASS_PATTERNS` locations |
| `.claude/skills/dsp-audio/SKILL.md:169` | `src/audio/synthPresets.ts` exports `FACTORY_PRESETS` / `ALL_FACTORY_PRESETS` |
| `src/store/vibeChips.ts` | **deleted** (Part 2) — its head comment carries both the now-obsolete module-evaluation justification and the false "IDS ARE PERSISTED IN PROJECT FILES" claim (item 5), and the file's `:16` cross-reference to `docs/design.md` §4 item 2 points at text item 5 deletes |
| `src/store/vibeChips.test.ts` | **deleted** (Part 2) — it pins a duplicate that no longer exists |
| `src/components/InstantVibesBar.tsx:9-13` | the head comment's module-evaluation reasoning, for the same reason as `vibeChips.ts` — it is the second copy of that argument |
| `eslint.config.js:66-75` | *"`no-restricted-syntax` is untouched by those blocks, so this entry reaches every file"* — false once the `src/data/` block lands (Part 1) |

`.claude/rules/theming.md`, `.claude/rules/testing.md` and `.claude/rules/note-input.md` reference
none of the moved paths — checked, no change needed.

**`docs/design.md` needs no Part 1 edit.** Checked file-wide: every moved path and table name it
names sits inside §4 item 2, and Part 2/3 deletes that item wholesale (`:140-151`, plus the
completion of the six-of-eight chip list at `:138`). Splitting a path rewrite out of a deletion
would mean editing text twice and leaving a corrected version of a passage that is about to go.
The row above stays in this table because the *file* changes in this spec — just not in Part 1.

Three of the four `.claude/skills/instant-vibes/` sections that change are not path updates but
**deletions of procedures this spec removes**. That skill is largely a guide to a mechanism Part 3
deletes; treat rewriting it as part of the work, not as a follow-up.

### 4. `ALL_FACTORY_PRESETS` disappears

Once the arrays merge there is one table, `SYNTH_PRESETS`, and no `FACTORY_PRESETS` /
`ALL_FACTORY_PRESETS` split. **Four doc comments in `src/types.ts` name it** — `:302`
(`chordPresetId`), `:309` (`bassPresetId`), `:322` (`pad.presetId`), `:332` (`synthPresetId`) —
plus the test names at `synthPresets.test.ts:214` and `:220` and the assertions at `:37-38`, which
compare `getAllSynthPresets(...)` against `FACTORY_PRESETS[0]` and `FACTORY_BASS_PRESETS[0]`. All
of those become `SYNTH_PRESETS`; the two positional assertions in the test become id lookups for
the same reason as item 1.

### 5. No vibe id reaches a `.solna` body — by design, not by accident

This is the point most likely to be misread as a discovery, so state the intent first, in the
owner's terms:

> **Applying a vibe is a one-shot write.** It applies every preset at once, and from that moment
> the user is editing individual modules. The vibe that seeded the project has no meaning
> afterwards, so there is nothing to persist.

A vibe is a *starting position*, not a *setting*. Once the chords have been re-harmonised, the kit
swapped and the bass pattern changed, "this project is a Lo-Fi Chill project" is not a fact about
the project any more — it is a fact about how it began, and the file format deliberately declines
to record it. Three things follow from that intent, and all three are visible in the source:

- `PROJECT_CONTENT_KEYS` is `['bpm', 'meterId', 'masterVolume', 'effects', 'loops']`
  (`projectFormat.ts:42`). **No vibe id is in a `.solna` body**, and the content set is a closed
  list, so this is enforced rather than merely true today.
- `projectFormat.ts:71-72` says it in the docblock — *"`selectedVibeId` → null (a project has no
  vibe until a chip is pressed)"* — and `applyProjectContent` writes that `null` explicitly at
  `:85`, with the reset typed into `ProjectOpenPatch` as `selectedVibeId: null`. Opening a project
  does not merely fail to restore a vibe; it actively clears one.
- The only place a vibe id persists at all is `selectedVibeId` in `partializeAppState`
  (`store.ts:160`) — a `localStorage` field whose sole consumer is `InstantVibesBar.tsx:133`
  (`const isSelected = selectedVibeId === vibe.id`). It exists to highlight a chip in the session
  that pressed it, and for nothing else.

**Three things this intent decides, which is why it is recorded as intent and not as trivia:**

1. **Renaming a vibe id is safe** (Decision 2 below). The cost is exactly one stale `localStorage`
   string leaving one chip un-highlighted until the user clicks a chip. Not "breaks every saved
   project".
2. **`selectedVibeId` must never be promoted into `PROJECT_CONTENT_KEYS`.** It would look like a
   harmless nicety — a project remembering which vibe it came from — and it would silently convert
   a session-scoped highlight into an external contract, making every vibe id un-renameable
   forever and putting a `formatVersion` bump behind every content edit. The reason not to do it is
   not compatibility; it is that the field would be *false* the moment the user changed anything.
3. **A vibe id is never a migration concern.** It cannot appear in a `.solna` body, so
   `migrateProjectBody` has nothing to do with it and no `formatVersion` moves for a rename.

The repo has no users to break either — `package.json` has `"private": true`, and there is no
`README`, no `LICENSE`, no `CONTRIBUTING` and no `.github/` directory at all. That is the weaker
half of the argument and is recorded second on purpose: the design intent above would make the
rename safe even if the project shipped tomorrow.

#### The three false claims, and where they are

The repo currently states the opposite of the design intent in three places. All three are wrong,
all three are deleted in this change, and each was checked against the file:

| location | exact text | disposition |
|---|---|---|
| `CLAUDE.md:122-125` | the "Instant Vibes ids drift from labels" trap entry — *"Ids are persisted in project files; renaming them breaks saved projects."* It also names `src/store/instantVibes.ts` as the table's home, which Part 1 moves. | **delete the whole entry.** After Decision 2 there is no drift to record, so there is no corrected version of it to keep. |
| `docs/design.md:140` (§4 item 2) | *"**Ids drift from display names — do not "fix" this.** Four vibe ids predate their current labels. Project files persist the id, so renaming an id silently breaks every saved project that references it."* plus the six-row id/label table at `:142-149` and the `src/store/instantVibes.ts` pointer at `:151`. | **delete the whole blockquote (`:140-151`).** Note the table is six rows for eight vibes — it predates `lofi-waltz` and `afro-six-eight` — so it is stale twice over. Item 2's prose list of chip names at `:138` is also six of eight and must be completed. |
| `src/store/vibeChips.ts:15-16` | *"THE IDS ARE PERSISTED IN PROJECT FILES. Four of them do not match their display names, on purpose (docs/design.md §4 item 2). Do not "fix" them."* | **goes with the file**, which Part 2 deletes. Its §4 item 2 cross-reference points at text this change removes, so leaving the file would leave a dangling pointer as well as a false claim. |

A fourth site carries the same claim in test form: `vibeChips.test.ts:24-32`, *"the four
deliberately drifting id/label pairs are reproduced verbatim"*, with the comment *"ids are
persisted in project files. This is NOT a bug to fix."* That test is deleted with its file
(Part 2) and would have to be deleted by Decision 2 regardless — it is the only thing in the suite
that would go red on the rename, and it goes red for a reason that is not true.

**A fifth site makes the same overstatement about a different table**, and is worth fixing here
because it is how the false constraint spreads from vibes to presets: the `presetById` docblock
(`synthPresets.ts:816-819`) says *"Ids are stable and persisted in project files; … Anything that
needs to survive a rename (Instant Vibes, saved projects) resolves by id."* A loop stores resolved
`SynthParams`, not a preset id, so no factory preset id reaches a `.solna` body through `loops`.
The one place a preset id persists is `customSynthPresets` — user-authored ids of the form
`user-preset-<timestamp>-<rand>`, which no rename can touch — and that key is in `partialize` but
**not** in `PROJECT_CONTENT_KEYS`. Correct the comment to what is true: factory preset ids are
referenced by the vibe table and by nothing that persists. Leaving it is how the false constraint
spreads.

#### The realignment — settled

The four drifting ids are renamed to match their display names. Each pairing below was read out of
`src/store/vibeChips.ts:33-36` and cross-checked against the vibe literal:

| id today | display name | id after |
|---|---|---|
| `cyber-dance` | Cyber EDM | `cyber-edm` |
| `ambient-chill` | Deep Ambient | `deep-ambient` |
| `hiphop-groove` | Boom Bap | `boom-bap` |
| `asian-zen` | Zen Garden | `zen-garden` |

The other four already agree and are untouched: `lofi-chill` / "Lo-Fi Chill", `synthwave-80s` /
"Synthwave 80s", `lofi-waltz` / "Lo-Fi Waltz", `afro-six-eight` / "Afro 6/8".

**What this fixes is a semantic gap, not a formatting one** — and that distinction matters, because
it decides what can be asserted. Each of the four old ids uses *different words* from its label:
`cyber-dance` says "dance" where the label says "EDM", `ambient-chill` says "chill" where the label
says "deep", `hiphop-groove` and "Boom Bap" share no word at all, and `asian-zen` encodes a region
where the label names a garden. Each new id uses the label's own words.

**A mechanical kebab-case rule is *not* available, and the spec must not claim one.** Checked
against all eight after the rename: five ids are the plain kebab-case of their names, and three are
not — `lofi-chill` and `lofi-waltz` drop the internal hyphen of "Lo-Fi" (kebab would give
`lo-fi-chill`), and `afro-six-eight` spells out the digits of "Afro 6/8" (kebab would give
`afro-6-8`). Those three are id-spelling conventions, not drift: the id and the label name the same
thing in the same words. So the rename removes the *documented exception*, but there is no derived
rule to enforce in its place — see the test list, which asserts uniqueness and nothing more.

Blast radius, verified: `data/vibes.ts`, the three golden fixtures (all keyed by vibe id),
`vibeVariationFixtures.ts`, the tests that name ids, the deletion of `docs/design.md:140-151` and
of `CLAUDE.md:122-125`. `data/vibeChips.ts` is *not* on the list — Part 2 deletes it, so the
rename touches one table, not two. No migration, no `.solna` change, no persist version bump:
`selectedVibeId` is already type-guarded (`store.ts:224-225` deletes a non-string) and an unknown
value simply fails to match any chip, which is the whole cost (item 5).

Nothing user-visible changes. All four display names, emoji, BPMs and keys stay exactly as they
are; the strings being edited are internal keys that appear in no UI surface.

One sequencing note for the plan: **do the rename as its own commit inside this branch.** It is a
content edit and the rest of Part 1 is a mechanical move, and a reviewer reading
`git show` on a commit that both moves 3,000 lines of tables and rewrites four ids cannot see
either change. Same branch, separate commits — this is not a reason to defer it.

## Verification

**The existing suite is the proof that Part 1 is behaviour-preserving.** These are the suites that
cover the moved content directly:

| suite | covers |
|---|---|
| `src/audio/bassPresets.test.ts` | the 5 bass presets, their count, and id uniqueness across the merged array |
| `src/audio/synthPresets.test.ts` | preset ids, names, category membership, param completeness |
| `src/audio/rhythmPatterns.test.ts` | the 21 chord rhythms |
| `src/audio/bassPatterns.test.ts` | the 16 bass patterns and their token resolution |
| `src/audio/drumKits.test.ts` | 12 kits, `mergeDrumKit`, and the `GENRE_TO_KIT` ↔ `GENRE_PRESETS` key-set pairing |
| `src/audio/data/chordProgressions.test.ts` + `.migration.test.ts` | the 44 progressions, their reference scales and per-degree qualities |
| `src/audio/data/genrePresets.test.ts` | the 14 sequencer grids, their meters and row sets |
| `src/audio/data/vibeDrumPatterns.test.ts` | the 8 vibe grids and the meters sidecar |
| `src/audio/meterRegression.test.ts` | every grid's step count against its meter |
| `scripts/check-drum-kit-separation.ts` (`check:drums`) | audible separation of the 12 kits |
| the three vibe golden fixtures | every vibe's resolved chords, drum rows and effect values |

> **The rule: only import paths and symbol names may change. If an asserted value has to change,
> something broke — stop and find out why.**

That rule holds without exception for Part 1. `step()`, `block()` and `strum()` move with their
tables untouched, so there is no transcription step to get wrong — the two files that were the
riskiest part of the move under the inline-expansion plan are now the two that change least, and
`chordProgressions.test.ts`, `rhythmPatterns.test.ts` and `ORIGINAL_VIBE_CHORDS` guard them the
same way they always did.

### Deletions, stated precisely

Three test files or tests are deleted outright rather than migrated, and each is deleted because
the thing it asserts stops existing:

| deleted | why it has nothing left to assert |
|---|---|
| `src/store/vibeChips.test.ts` (all four tests) | `:6`, `:10` and `:24` pin `VIBE_CHIPS` against `INSTANT_VIBES`; with one table they compare it to itself. `:34` (id uniqueness) is worth keeping and moves to the vibe-table suite. |
| its `:24` "four deliberately drifting id/label pairs" test specifically | Decision 2 removes the drift. This is the only assertion in the suite that goes red on the rename, and its stated reason — *"ids are persisted in project files"* — is false (item 5). |
| the two `vibeVariation.test.ts` genre tests and the per-genre `chordProgressions.test.ts` checks | Part 3, listed in full below. |

**No other test is deleted anywhere in this spec.** A deletion that is not on this list is a
regression, whatever the justification offered for it in review.

### The two changed contracts, stated precisely

**Part 2** changes structure, so exactly these assertions move — and no others:

| assertion | before | after |
|---|---|---|
| `instantVibesProgressions.test.ts:19` | `withoutId(vibe.chords)` | `withoutId(resolveVibe(spec).chords)` |
| `instantVibesProgressions.test.ts:47` | `expect(vibe.chords).toEqual(resolved)` | *delete* — a spec has no `chords`, so "`vibe.chords` is the resolved progression, not a separate literal" is now true by construction rather than by test |
| `instantVibesDrums.test.ts` | `vibe.drumPattern` | `resolveVibe(spec).drumPattern` |
| `instantVibesEffects.test.ts` | `vibe.effects` | `resolveVibe(spec).effects` |
| new | — | `resolveVibe` throws a named error for each of an unknown progression, drum grid and effect chain id |

**Every fixture *value* stays byte-identical.** If a fixture number has to change, the resolver
does not reproduce the table and the work is wrong.

**Part 3** changes the pool contract, so exactly these move:

| assertion | disposition |
|---|---|
| `vibeVariation.test.ts:205-215` "progressionIds equals the full genre-and-scale-length filter" | **deleted** — this is the mechanism being removed |
| `vibeVariation.test.ts:198` "the vibe genre and its scale type agree with `VIBE_GENRE_SCALES`" | **deleted** — `VibeGenre` is gone |
| `vibeVariation.test.ts:181` `expect(p.genres).toContain(r.genre)` | **replaced** by the two guards: `referenceScale === vibe.scaleType`, and `minScaleLength <= SCALES[vibe.scaleType].intervals.length` |
| `chordProgressions.test.ts:77-78` per-genre `referenceScale` check | **deleted** — `genres` no longer constrains anything |
| `chordProgressions.test.ts:144,151,162,171` per-genre content checks | **rewritten** against explicit id lists, or deleted; they assert properties of a tag that no longer has meaning |
| `vibeVariation.test.ts:157-160` "the dice can always land back on the vibe as authored" | **kept, and widened** with `random.progressions ∋ vibe.progressionId` |
| `vibeVariation.test.ts:163-186` "every id in every pool resolves" | **kept**, field names updated |
| `vibeVariation.test.ts:188-196` "every pool is non-empty and free of duplicates" | **kept**, field names updated |
| the `>= 4` floor on pool size | **deleted** — a one-member pool is a legitimate statement that an axis is fixed |
| the scripted-draw / reroll behaviour tests | **unchanged** — draw order is unchanged, and `resolveVibeVariation` reads `rule.progressions` where it read `rule.progressionIds` |

**The eight vibes' pool *contents* must not change in this work.** Write out today's derived
arrays verbatim as the new explicit ones. Curating a pool is a content decision and belongs in a
change a listener can review; doing it here would hide it inside a rename.

### New tests this change owes

1. **`src/data/` purity — a committed fixture test, not a one-off manual check.** The import ban's
   five rows have **already been measured** (see Part 1); that risk is closed and is not
   implementation work. What the change still owes is a test that *keeps* them measured. The whole
   "helpers are safe" argument rests on three bans that live in a config file, and a config file is
   exactly the kind of thing an eslint or typescript-eslint upgrade loosens silently — a renamed
   option, a changed `allowTypeImports` default, a selector that stops matching. Ship a fixture
   suite that lints a set of fixture sources through eslint's API and asserts on the reported rule
   ids:

   | fixture line | expected |
   |---|---|
   | `import type { MeterId } from '../utils/meter';` | **no error** — measured; a false positive here breaks every data file |
   | `import { METERS } from '../utils/meter';` | `@typescript-eslint/no-restricted-imports` — measured |
   | `import { SCALES } from '@/utils/musicTheory';` | same — measured |
   | `import { Note } from 'tonal';` | same — measured |
   | `import { SIB } from './sibling';` | same — measured; this row pins the independent-leaf invariant |
   | `const seed = Math.random();` | `no-restricted-globals` |
   | `const m = new Map();` | `no-restricted-syntax` (`NewExpression`) |
   | `function f() {}` | `no-restricted-syntax` (`FunctionDeclaration`) |
   | `let n = 0;` **and** `export let n = 0;` | `no-restricted-syntax`, both — the export form is the one a single `Program >` selector misses |
   | `const step = (d: number) => ({ degree: d });` plus a call to it | **no error** — the allowed helper; a rule that rejects this is the rule mis-copied |
   | `const ok = confirm('x');` | `no-restricted-globals` — this row exists because the block **replaces** the global entry that banned it; drop the re-declaration and this row is the only thing that notices |
   | `import type { X } from '../../types';` | `no-restricted-syntax` at **error** — the `../../` ban, likewise carried across from the global entry, where it is `'warn'` |
   | `const row = (performance: number) => ({ performance });` | **no error** — a local binding shadowing a banned global; this row pins that `no-restricted-globals` is scope-aware and an `Identifier[name=…]` selector is not a substitute |

   Assert *severity* too, not just presence: every row above must be an **error**, since
   `bun run verify` tolerates warnings and the global `no-restricted-syntax` entry this block
   replaces is set to `'warn'`. Filter the reported messages to the four guarded rule ids before
   asserting — `@typescript-eslint/no-unused-vars` is an error in the recommended set and will fire
   on some fixtures. The fixture sources are committed **as string constants inside the test**, and
   linted with `ESLint#lintText(source, { filePath: 'src/data/…' })`, which resolves config against
   a path that need not exist: nothing is written into `src/data/` for a real `eslint .` run to
   pick up.

2. **The default bass patch resolves by id** — assert `bassSynthParams` against
   `presetById('bass-deep-sine')`, and assert that `presetById('bass-deep-sine')` is defined.
   Reverting to `SYNTH_PRESETS[0]` must turn this red (item 1).
3. **The two new pool guards**, per vibe (Part 3).
4. **`resolveVibe` throws on each of the three unknown-id cases** (Part 2).
5. **Vibe ids are unique** — the one assertion worth keeping from the deleted
   `vibeChips.test.ts:34`, moved to the vibe-table suite. Deliberately *not* extended into an
   id-derives-from-name check: three of the eight ids would fail it for reasons that are correct
   (see the realignment section), so such a test would either be wrong or would need three
   exceptions, which is the shape of thing this change is removing.

### Mutation check

For items 1 and 2 above, revert the guard and confirm the test fails. Item 1 in particular: a test
that reads `FACTORY_BASS_PRESETS[0]` on both sides passes against the bug it exists to catch, and
that is precisely the shape `store.test.ts:184` has today.

### Gate

`bun run verify` — `bun test && bun run lint && bun run eslint && bun run check:keys && bun run
check:drums && bun run build`. `bun run check:theme` is not in that chain and is unaffected by this
work.

## Out of scope — recorded as follow-up

### Contributor readiness

The repo has **no `.github/` directory at all**, no README, no CONTRIBUTING and no LICENSE. A
`src/data/` layer is most of what a "here is how you add content" document would need to say, so
the two belong together — but writing them is separate work:

- **CI running `bun run verify` on pull requests.** Everything the gate needs already exists; the
  workflow file does not.
- **A `check:presets` guard**, in the shape of the two that exist (`check:keys`, `check:drums`):
  schema-level checks over `src/data/` — id uniqueness across the merged preset array, name
  uniqueness, category membership, every library id referenced by a vibe resolving. Several of
  these live in test files today and would move to a script that a contributor can run alone.
- **A listening-review process.** A schema cannot tell whether a preset sounds good, and
  `check:drums` is the repo's only existing acknowledgement of that. Adding content needs a human
  who has heard it.

### Music theory rework

Modelled on `/Users/Pathompong/Sites/Personal/murva/murva-app/shared/src/music/`:

- **`getParentScale`** (`murva-app/shared/src/music/musicUtils.ts:107`) maps a non-7-note scale to
  a parent diatonic, so a pentatonic or Hirajoshi degree gets its quality from real interval
  distances instead of a hand-written array.
- **Deriving chord qualities from intervals** would replace `triadQualities` and
  `seventhQualities` — currently 11 hand-authored pairs of arrays in `SCALES`.
- **Separating pitch-class identity from enharmonic spelling** (`noteSpelling.ts` in murva).

**Out of scope because it changes output.** `getScaleNotes`'s own docblock
(`musicTheory.ts:106-110`) states the current convention: *"Spelling is sharp-only (the ROOTS
convention): C# major's 7th is `C` (enharmonic B#), F major's 4th is `A#` (enharmonic Bb)."* Doing
this properly means a chord in Bb major labels as `Eb` rather than `D#` — a visible change to
every chord card, every progression label and the golden fixtures. That is a feature with its own
listening review, not a refactor.

Two things make the eventual change smaller than it looks, both verified:

- **`rootSemitone` already accepts flats.** `musicTheory.ts:382-385` is
  `Note.get(root).chroma`, tonal's own parser — so `Bb` already resolves to 10. The input side is
  already spelling-agnostic; only the output side is sharp-locked.
- **`triadQualities` / `seventhQualities` have exactly one runtime consumer**:
  `getDiatonicChordForDegree` at `musicTheory.ts:216-218`. Everything else that reads them is a
  test (`musicTheory.test.ts:128-129`, `chordProgressions.migration.test.ts:122`). Replacing the
  arrays is a one-function change plus whatever the golden fixtures say about the result.

### Also out of scope

- **Unlocking cross-category preset selection for every slot.** `bassPresetId` is constrained to
  `category === 'Bass'` and `pad.presetId` to `'Pad'`, each pinned by an invariant test. Relaxing
  those is a UI and taste question, not a data-layout one.
- **`METERS`, `THEME_TOKENS`, `VIEW_META`, `METER_OPTIONS`** — system registries, per the table in
  Part 1.
- **Runtime-loadable preset packs.** `src/data/` being pure literals is the precondition for a
  future JSON-loaded pack, and stating the rule now is what keeps that door open — but nothing in
  this change loads anything at runtime.
