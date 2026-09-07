# Drum Slice 3 — Engine Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four small, independently revertible engine changes that unlock kit identity — a hi-hat choke group, a `reverbSend` on the kick and the tom, a `topCut` lowpass on the hats, and a resonant `q` on the hats — plus the two supporting changes they need: one shared `DRUM_TYPES` list, and a `report:drums-diff` that reports kit values.

**Architecture:** Slice 3 of the four-slice design in the spec. Slices 1 and 2 are already on this branch (kit retuning; grid and vibe corrections; `Dusty Break` as the thirteenth kit). This slice adds **two new kit fields** (`reverbSend` on `KickParams` and `TomParams`, `topCut` on `HatParams`), **one hardcoded engine constant** (the hat `q`), and **one piece of engine state** (the map of sounding hat voices). It adds no voice, touches no migration chain, and changes no grid row. The four engine changes are mutually independent: any one of Tasks 3–6 can be reverted without disturbing the other three.

**Tech Stack:** TypeScript, Bun (test runner + scripts), React 19 + Vite, raw Web Audio API. No new dependency, no samples.

**Spec:** `docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md` — Slice 3 is decisions **25–28**, bound by decision **9** (the choke table), decisions **39, 40, 42, 43** (verification), and the cross-slice contract in decisions **1–12**.

**Evidence base (every number below is copied into the task that uses it, so no task needs to re-open a research file):**
- `docs/research/2026-09-06-drum-synthesis-hats-and-cymbals.md` — §4.1 and §4.2 (choke mechanism and release times), §5.1 (the hat `q`), §5.2 (the ranked addition list)
- `docs/research/2026-09-06-drum-kit-identities.md` — §2 (per-kit targets and the `Lo-Fi Vinyl` / `Warehouse` gaps), §5.2 (the ceiling-gain scorecard), §6 (the ranked engine changes)

---

## Global Constraints

Every task's requirements implicitly include this section.

1. **The gate is `bun run verify`** — `bun test && bun run lint && bun run eslint && bun run
   check:keys && bun run check:drums && bun run build`. `eslint` must report **zero errors**;
   the pre-existing warnings are tolerated and must not grow.
2. **Four layers, enforced by eslint:** `data → audio → store → components`. `src/audio/` never
   imports `store/` or `components/`; `src/store/` never imports `components/`;
   `src/components/` must not import `audio/engine`. `src/utils/` sits above `data/` and may
   read it at runtime; nothing in `data/` may read `utils/` except through an `import type`.
3. **`src/data/` purity.** A file there imports nothing at runtime — not even a sibling in
   `src/data/` — reads no impure global (`Math`, `Date`, `crypto`), declares no function,
   constructs nothing with `new`, and holds no module-scope `let`/`var`. `import type` and
   comments are fine. Top-level `const` arrow helpers that are shorthand for writing a literal
   (`step()`, `block()`) are allowed and must sit in the same file as the table they build.
   Enforced by eslint and by `src/data/dataLayerPurity.test.ts`, which lints fixture sources
   through eslint's own API.
4. **Repetition across `src/data/` files is deliberate.** Every file is an independent leaf, so
   the folder has no evaluation graph. Never factor a shared helper out of two `src/data/` files.
5. **`mergeDrumKit` is a one-level spread per voice.** A kit may override a default key; it can
   never delete one. Any new required `DrumKit` field must therefore carry a value in
   `DEFAULT_DRUM_KIT`, and `DEFAULT_DRUM_KIT` must stay a sound a kit can inherit.
6. **Counts are measured by evaluating, never by grepping literal lines.** Every count the plan
   states must come from a `bun -e` (or equivalent) command the plan shows inline.
7. **`PAIRWISE_PARAMS` in `scripts/check-drum-kit-separation.ts` is a `max` over its list**, so
   adding an entry can only *raise* every pair's separation and make the floor *easier* to clear.
   Adding a parameter there **weakens** the check (slice 1, ruling E — `snare.noiseGain` was
   rejected on exactly this ground). New parameters enter through `spread()` / `spreadDefined()`,
   which are genuine floors.
8. **Never lower `MIN_PAIRWISE_SEPARATION` or a `spread()` factor to make the gate green.**
   Retune a kit, or add the pair to `ACCEPTED_NEIGHBOURS` with a written reason.
9. **The two migration chains are never merged.** Persist upgrades live in `migrate`
   (`store/store.ts`, before `merge`); `.solna` body upgrades live in `migrateProjectBody`
   (`store/projectFormatMigrate.ts`, before `sanitizeContent`). They share pure transforms and
   nothing else. A persist payload is private `localStorage` shape; a project body is an external
   contract; their versions move for different reasons.
10. **A project written before a change must reopen sounding the way it sounded when it was
    closed.** Appended tracks are silent, a renamed track keeps its steps, a renamed kit resolves
    to the same parameters.
11. **The golden fixtures hand-copy their data deliberately.** `instantVibesDrumsFixture.ts` and
    its two siblings import nothing from `VIBES`, from `resolveVibe` or from the libraries — that
    independence is what makes them proofs rather than tautologies. Never make one read the vibe
    table or a resolver.
12. **No new dependency, and no samples of any kind.** The engine is the raw Web Audio API (no
    Tone.js); synthesis from scratch is the premise, and is why several referents are permanently
    out of reach by construction rather than by difficulty.
13. **Do not record version numbers, file counts or line numbers in `CLAUDE.md`.** Write the
    rule, not the number.
14. Branch names are `<type>/<issue-code>-<name>`; feature work never lands as a commit made
    directly on `main`. Written artefacts — code, comments, docs, commit messages — are in English.

---

## Rulings carried from the spec's open questions

These are the controller's rulings, copied verbatim. Only the five that bind slice 3 are here;
R2, R3, R4, R5 and R9 bind slice 4 and are carried by that plan.

**R1 (open question 1) — the clap-shape rewrite is already shipped.** Slice 1 landed it; it is in
commit `1f3661e` ("refactor(audio): consume the data layer and fix the clap envelope") on this
branch. Slice 1 was "values plus one envelope constant"; slice 3 stays at four engine changes.
Neither slice 3 nor slice 4 touches the clap envelope. Cost if wrong: none — verify by reading
`git show 1f3661e -- src/audio/engine.ts`.

**R6 (spec decisions 32, 33, 40) — new voices are protected by a spread floor and a NEW
within-kit check, never by growing `PAIRWISE_PARAMS`.** `PAIRWISE_PARAMS` is unchanged by both
slices, for the reason in Global Constraint 7. What decisions 32 and 33 actually ask for is a
different shape of check: **within one kit, are two voices that could collapse into each other
actually distinct?** Slice 4 adds that as a new function in
`scripts/check-drum-kit-separation.ts` — a per-kit, per-pair minimum on a named parameter — over
at least these four pairs: `hitom`↔`lowtom` (decision 32), `ride`↔`crash` (decision 33),
`bell`↔`hihat` (decision 34), `rimshot`↔`snare` (decision 31). Aggregate `spread()` entries for
every new voice land too, per decision 40.3, and land BEFORE the values are authored so the first
authoring pass runs against a check that can fail. Cost if wrong: a check that is stricter than
needed and has to be relaxed with a written reason.

**R7 (spec decision 27) — hat `q` starts hardcoded.** No new kit field in slice 3; the spec says
so explicitly ("needs no new kit field if it starts hardcoded"). Cost if wrong: all thirteen kits
share one hat resonance until a later slice promotes it to a field.

**R8 (spec decision 40.2) — the single `DRUM_TYPES` list lands in slice 3, not slice 4.** It is
exported from `src/data/drumKits.ts` as a `readonly` array of string literals with
`export type DrumType = (typeof DRUM_TYPES)[number]`; the three existing copies
(`src/audio/drumKits.test.ts:5`, `src/data/drumKits.test.ts:4`,
`scripts/check-drum-kit-separation.ts:16`) are deleted and import it. A test asserts that
`DRUM_TYPES` and `keyof DrumKit` are the same set — that assertion, not the shared constant, is
what makes adding a voice to one and not the other impossible. Reason for slice 3: it is a
prerequisite for slice 4 and is cheapest to do while there are still seven voices. Cost if wrong:
a mechanical refactor done one slice early.

**R10 (spec decision 43) — `report:drums-diff` gains kit values in slice 3, as its first task.**
Slices 3 and 4 are both kit-value changes, so the report must exist before them or it reports
nothing about either. The same task replaces `scripts/report-drum-diff.ts`'s hardcoded stale
`BASELINE = '00a61f1'` with a required command-line argument (this is slice 2's parked finding,
ruling J, which was deliberately left out of scope there). The report always exits 0 and asserts
nothing — a changed kit parameter is a fact about content, not a defect. Cost if wrong: a
reporting script changed early.

---

## The interface contract with slice 4

Slice 4's plan is being written in parallel against this contract. **These names and shapes are
fixed. Do not rename or re-shape any of them.**

```ts
// src/data/drumKits.ts  — this plan, Task 1
export const DRUM_TYPES = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'] as const;
export type DrumType = (typeof DRUM_TYPES)[number];

// src/data/drumKits.ts  — this plan, Tasks 4 and 5 (both required fields, both defaulted)
export interface KickParams { /* … existing … */ reverbSend: number }
export interface TomParams  { /* … existing … */ reverbSend: number }
export interface HatParams  { filter: number; topCut: number; decay: number; gain: number }
```

`scripts/check-drum-kit-separation.ts` keeps its existing exported shape: `report()`, `spread()`,
`spreadDefined()`, `PAIRWISE_PARAMS`, `MIN_PAIRWISE_SEPARATION = 0.8`, `ACCEPTED_NEIGHBOURS` and
the `ACCEPTED_NEIGHBOURS` key-validation block. **This slice adds `spread()` entries only** — four
of them (Tasks 4 and 5). It does not touch `PAIRWISE_PARAMS` (Global Constraint 7, ruling R6).

Slice 4 does **not** extend the choke group's membership: decision 9 puts `ride`, `crash` and
`bell` in no group. It does register **more nodes per hat**, which is why Task 3's registration
method is plural from its first commit:

```ts
// src/audio/engine.ts — this plan, Task 3. Slice 4 calls it unchanged.
private registerHatVoice(
  name: string,
  envs: GainNode[],
  sources: AudioScheduledSourceNode[],
  stopAt: number,
): void
```

Slice 3 always passes `[oneEnv]` and `[oneNoiseSource]`. Slice 4's metallic bank passes
`[noiseEnv, bankEnv]` and `[noise, ...sixOscillators]` through the same signature.

### One measured deviation from the contract, stated rather than smuggled

The contract says the choke group "lives in `src/audio/engine.ts` as a **module-scope map** of
currently sounding hat voices". **Task 3 makes it a private instance field instead**, for a
measured reason:

```
$ grep -rn "makeEngine" src/audio/*.ts | wc -l   # → 12 call sites
```

`src/audio/testFakes.ts:10` builds a **fresh engine instance per test** from the singleton's
constructor (`export const makeEngine = () => new (audioEngine.constructor as any)()`), and
`freshEngine()` gives each one a fresh fake `AudioContext` whose `currentTime` is always `10`. A
module-scope map is shared by every instance, so one test's still-"sounding" hat — at a timestamp
that overlaps the next test's, because every fake clock starts at 10 — would be choked by the next
test's first hat, on nodes belonging to a dead context. That is a cross-test coupling with no
upside. The map is otherwise exactly as specified: keyed hat voices, cut with a ramp to the
existing `ENV_FLOOR`. Nothing in slice 4 reads it, so the deviation is invisible across the slice
boundary.

---

## Measured corrections to the spec's own supporting numbers

Recorded rather than smoothed over — this repo's discipline. None of them changes a decision.

1. **Decision 26 says `Lo-Fi Vinyl`'s hat corner is 3500 Hz. Measured after slice 1, it is 3600,
   and it is tied, not unique.**

   ```
   $ bun -e 'import { DRUM_KITS } from "./src/data/drumKits.ts";
     import { mergeDrumKit } from "./src/audio/drumKits.ts";
     console.log(Object.entries(DRUM_KITS)
       .map(([n,p])=>[mergeDrumKit(p).hihat.filter,n]).sort((a,b)=>a[0]-b[0])
       .map(r=>r.join("\t")).join("\n"))'
   3600  Tight Pocket
   3600  Lo-Fi Vinyl
   5200  808 Vintage
   …
   9000  Trap Beat
   ```

   Slice 1 moved the value 3500 → 3600 (the "Lo-fi muffled" archetype of
   `…hats-and-cymbals.md` §5.1, which `Tight Pocket` also joined). **The decision is unaffected:**
   a highpass at 3600 Hz still passes everything from 3.6 kHz to Nyquist, so both kits still have
   the fullest hats in the library and both are pointed the wrong way. Task 5 fixes both, and the
   listening step in Task 7 asks about the pair, not about `Lo-Fi Vinyl` alone.

2. **Decision 28's prerequisite (decision 20) has landed. Verified, not assumed.**

   ```
   $ bun -e 'import { DRUM_GRIDS } from "./src/data/drumGrids.ts";
     const bad=[]; let both=0;
     for (const [id,g] of Object.entries(DRUM_GRIDS)) {
       const h=g.rows.hihat??[], o=g.rows.openhat??[];
       if (h.some(x=>x)&&o.some(x=>x)) both++;
       const c=h.map((x,i)=>x&&o[i]?i:-1).filter(i=>i>=0);
       if (c.length) bad.push(`${id}: ${c}`);
     }
     console.log("both hat rows active:", both, "| still colliding:", bad.length?bad:"none")'
   both hat rows active: 24 | still colliding: none
   ```

   Zero grids fire `hihat` and `openhat` on the same step, and **24 grids use both rows**, so
   Task 3 has real material to be heard on and no grid where it will sound worse. This is the
   spec's one hard ordering constraint and it is satisfied.

3. **The literal `['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash']` appears twelve
   times in the tree. R8 named three of them; measured, a FOURTH is foldable and Task 1 takes it
   too, while the remaining eight stay.** A source-text search (this is locating duplicated *text*, not counting *data*, so grep
   is the right tool here):

   ```
   $ grep -rn "'kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'" src scripts
   src/audio/drumKits.test.ts:5              ← DRUM_TYPES        (delete, import)
   src/data/drumKits.test.ts:4               ← DRUM_TYPES        (delete, import)
   scripts/check-drum-kit-separation.ts:16   ← DRUM_TYPES        (delete, import)
   src/data/drumGrids.test.ts:226            ← KNOWN_ROW_NAMES   (delete, derive — see below)
   src/audio/engine.test.ts:1576             ← triggerDrum switch coverage
   src/data/drumGrids.test.ts:388            ← PLAYABLE, the duplicate-grid comparison signature
   src/store/initialState.test.ts:133, 160   ← sequencer track names
   src/store/instantVibesDrums.test.ts:13, 14, 16, 18  ← per-vibe expected row sets
   ```

   **`KNOWN_ROW_NAMES` folds in, and it is worth saying why it is not obvious.** A grid row name
   is not automatically a kit voice name — the `bass` row was a row no kit ever had a voice for.
   Slice 2 deleted every `bass` row, and measured after it (Task 1 Step 7 shows the command), the
   two sets are now **identical** and no grid uses a row outside them. The distinction has stopped
   being real, so restating the list is duplication rather than a statement.

   **The remaining eight stay literals.** `PLAYABLE` is a comparison signature, not a roster: it
   decides which two grids count as duplicates, and its own comment records it being widened by
   hand when `tom` and `crash` arrived. Deriving it would let slice 4 change the duplicate check's
   strictness as a side effect of adding voices. The others are sequencer track rosters, pad
   rosters and per-vibe expectations — independent assertions whose whole value is that they were
   written out separately.

---

## File Structure

| file | responsibility in this slice | tasks |
|---|---|---|
| `src/data/drumKits.ts` | the voice roster (`DRUM_TYPES`, `DrumType`), the two new fields on three interfaces, and 13 + 1 literal tables of new values | 1, 4, 5 |
| `src/data/drumKits.test.ts` | the set-equality assertion that makes the shared list load-bearing | 1 |
| `src/audio/drumKits.test.ts` | rule tests over **merged** kits — it already imports `mergeDrumKit` and `@/data/drumKits`, so it is the layer-legal home for any rule about a merged entry | 1, 4, 5 |
| `src/audio/engine.ts` | `drumTone` gains a send; `drumNoiseBurst` gains a second biquad and a return value; two hat cases gain a choke, a `topCut` and a `q`; one new private field, one new private method, three new module constants | 3, 4, 5, 6 |
| `src/audio/engine.test.ts` | the choke behaviour, the send routing, the two-biquad hat band, the hat `q` | 3, 4, 5, 6 |
| `src/audio/testFakes.ts` | `fakeCtx` starts recording biquads in `_filters`, the way it already records `_gains` and `_bufferSources` | 5 |
| `scripts/check-drum-kit-separation.ts` | imports the shared roster; gains four `spread()` entries | 1, 4, 5 |
| `scripts/report-drum-diff.ts` | a required baseline argument, and a second report section over `DRUM_KITS` | 2 |

---

## Task 1: One `DRUM_TYPES` list

Spec decision 40.2, ruling R8. Three files each declare their own copy of the seven voice names.
Slice 4 adds four voices; adding them to two of three copies is a silent hole exactly the size of
the missing voice. The shared constant is the cheap part — **the assertion that it equals
`keyof DrumKit` is the actual guard**, and it is what makes slice 4's roster change impossible to
half-apply.

**Files:**
- Modify: `src/data/drumKits.ts` — insert above `export interface KickParams` (currently line 9)
- Modify: `src/data/drumKits.test.ts:1-4` and its third test (currently lines 19–25)
- Modify: `src/audio/drumKits.test.ts:3-5`
- Modify: `scripts/check-drum-kit-separation.ts:9-16`
- Modify: `src/data/drumGrids.test.ts:226` — `KNOWN_ROW_NAMES`, the fourth copy R8 did not name
- Test: `src/data/drumKits.test.ts`, `src/data/drumGrids.test.ts`

**Interfaces:**
- Consumes: nothing from an earlier task — this is the first task.
- Produces: `DRUM_TYPES: readonly ['kick','snare','hihat','openhat','clap','tom','crash']` and
  `type DrumType = (typeof DRUM_TYPES)[number]`, both exported from `src/data/drumKits.ts`.
  Slice 4's part 1 replaces the array's contents with its eleven-member version and relies on the
  test below to force `DrumKit` to move with it.

- [ ] **Step 1: Write the failing test**

In `src/data/drumKits.test.ts`, replace the first four lines:

```ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_DRUM_KIT, DRUM_KITS, DRUM_TYPES, type DrumType } from './drumKits';
```

(the local `const DRUM_TYPES = [...] as const;` on line 4 goes away with them), and add this test
inside the existing `describe('DRUM_KITS', …)` block:

```ts
  test('DRUM_TYPES is the same set as keyof DrumKit', () => {
    // DEFAULT_DRUM_KIT is annotated `: DrumKit`, so TypeScript already forbids
    // a missing or an extra key on it: Object.keys(DEFAULT_DRUM_KIT) IS
    // `keyof DrumKit` at runtime. This assertion — not the shared constant —
    // is what makes adding a voice to the interface and forgetting the list
    // impossible. Sorted copies, because DRUM_TYPES's order is trigger order
    // and carries no meaning here.
    const declared: string[] = [...DRUM_TYPES];
    expect(declared.sort()).toEqual(Object.keys(DEFAULT_DRUM_KIT).sort());
  });
```

Then update the existing third test's cast, which currently reads
`expect(DRUM_TYPES, \`${name}.${type}\`).toContain(type as (typeof DRUM_TYPES)[number]);`:

```ts
        expect(DRUM_TYPES, `${name}.${type}`).toContain(type as DrumType);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/data/drumKits.test.ts`
Expected: FAIL — `SyntaxError: Export named 'DRUM_TYPES' not found in module '.../src/data/drumKits.ts'`.

- [ ] **Step 3: Export the list from the data layer**

In `src/data/drumKits.ts`, insert directly above `export interface KickParams {`:

```ts
/**
 * The kit's voice roster, in trigger order. ONE list: both drum-kit test files
 * and `check:drums` import it, and `drumKits.test.ts` asserts it is the same
 * set as `keyof DrumKit`. That assertion, not this constant, is what makes
 * adding a voice to the interface and forgetting the list impossible.
 *
 * It is NOT the grid row roster or the sequencer track roster. A grid may omit
 * a voice and may carry a row no kit plays, so those lists are different sets
 * and are declared where they are used.
 */
export const DRUM_TYPES = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'] as const;

export type DrumType = (typeof DRUM_TYPES)[number];
```

A `const` array literal with `as const` and a type alias is legal in `src/data/`: no import, no
function, no `new`, no impure global (Global Constraint 3). `src/data/bassPatterns.ts:135` already
uses `as const`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/data/drumKits.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Delete the copy in `src/audio/drumKits.test.ts`**

Change line 3 and delete line 5:

```ts
import { DEFAULT_DRUM_KIT, DRUM_KITS, DRUM_TYPES } from '@/data/drumKits';
```

The only other use of the name in that file is `for (const type of DRUM_TYPES) {` at line 31,
which works unchanged against the imported `readonly` tuple.

- [ ] **Step 6: Delete the copy in `scripts/check-drum-kit-separation.ts`**

Change the import block (currently lines 9–13) and delete line 16:

```ts
import {
  DEFAULT_DRUM_KIT,
  DRUM_KITS,
  DRUM_TYPES,
  type DrumKit,
} from '../src/data/drumKits.ts';
```

`type DrumKit` stays — `spread()` and `spreadDefined()` take `(kit: DrumKit) => number`. The
deleted local was annotated `(keyof DrumKit)[]`; `DrumType` is that same union, so
`kit[type]` and `DEFAULT_DRUM_KIT[type]` at lines 34–35 still type-check.

- [ ] **Step 7: Delete the fourth copy — `KNOWN_ROW_NAMES` in `src/data/drumGrids.test.ts`**

R8 named three copies. **Measured, there is a fourth**, and it is the same set:

```
$ bun -e 'import { DRUM_GRIDS } from "./src/data/drumGrids.ts";
  import { DEFAULT_DRUM_KIT } from "./src/data/drumKits.ts";
  const rows = new Set();
  for (const g of Object.values(DRUM_GRIDS)) for (const r of Object.keys(g.rows)) rows.add(r);
  const kn = ["kick","snare","hihat","openhat","clap","tom","crash"].sort();
  const dt = Object.keys(DEFAULT_DRUM_KIT).sort();
  console.log("KNOWN_ROW_NAMES:", kn.join(","));
  console.log("keyof DrumKit  :", dt.join(","));
  console.log("identical      :", JSON.stringify(kn) === JSON.stringify(dt));
  console.log("rows in use    :", [...rows].sort().join(","))'
KNOWN_ROW_NAMES: clap,crash,hihat,kick,openhat,snare,tom
keyof DrumKit  : clap,crash,hihat,kick,openhat,snare,tom
identical      : true
rows in use    : clap,crash,hihat,kick,openhat,snare,tom
```

Slice 2 deleted every `bass` row, which is what closed the last real difference between a grid
row name and a kit voice name. The sets are now equal *and no grid uses a row outside them*, so
this is the same list, not a coincidence — derive it.

At `src/data/drumGrids.test.ts:226`, keep the comment, replace the literal:

```ts
  // The seven voices a sequencer track can actually play today, derived rather
  // than restated: `bass` was never one of them — no DrumKit field, no
  // triggerDrum case, no track — which is why slice 2 deleted the row instead
  // of keeping it as "unplayable but authored". With that gone, a grid row name
  // and a kit voice name are the same set, and this assertion is what says so.
  const KNOWN_ROW_NAMES: readonly string[] = DRUM_TYPES;
```

The `readonly string[]` annotation matters: `DRUM_TYPES` is a tuple of string *literal* types, and
`KNOWN_ROW_NAMES.includes(row)` on line 229 passes a plain `string`, which the literal-typed
`.includes` rejects. Add `DRUM_TYPES` to the file's existing import from `./drumKits` — or add the
import if it has none.

**`PLAYABLE` at line 388 is deliberately left as a literal.** It is not a roster, it is the
**comparison signature** for the duplicate-grid test: the set of rows over which two grids are
judged identical. Its own comment records that it was widened by hand when `tom` and `crash`
arrived — "before authoring any new grid that might create one, not after". Deriving it would let
slice 4 silently change which grids count as duplicates as a side effect of adding voices, which
is a review decision, not a rename.

- [ ] **Step 8: Run the affected checks**

Run: `bun test src/data/drumKits.test.ts src/audio/drumKits.test.ts src/data/drumGrids.test.ts src/data/dataLayerPurity.test.ts && bun run check:drums && bun run lint && bun run eslint`
Expected: all tests PASS; `check:drums` prints its PASS lines and exits 0; `tsc --noEmit` clean;
eslint zero errors.

- [ ] **Step 9: Run the gate**

Run: `bun run verify`
Expected: all six stages pass, eslint at zero errors.

- [ ] **Step 10: Commit**

```bash
git add src/data/drumKits.ts src/data/drumKits.test.ts src/audio/drumKits.test.ts src/data/drumGrids.test.ts scripts/check-drum-kit-separation.ts
git commit -m "$(cat <<'EOF'
refactor(data): make DRUM_TYPES one exported list

The seven voice names were declared four times: both drum-kit test files,
check:drums, and drumGrids.test.ts' KNOWN_ROW_NAMES each had their own copy.
The fourth is only foldable because slice 2 deleted every `bass` row -- with
that gone, a grid row name and a kit voice name are measurably the same set,
and no grid uses a row outside it. Slice 4 adds four voices, and
adding them to two of three copies is a silent hole exactly the size of the
missing voice.

The shared constant is the cheap half. The guard is the new assertion that
DRUM_TYPES equals Object.keys(DEFAULT_DRUM_KIT) — which is keyof DrumKit at
runtime, because DEFAULT_DRUM_KIT is annotated with it.

Deliberately untouched: the nine other places that spell the same seven
names. They are grid row, sequencer track and pad rosters, which are
different sets from the kit's voice roster — a grid may omit a voice and may
carry a row no kit plays.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

## Task 2: `report:drums-diff` reports kit values

Spec decision 43, ruling R10. The report covers grid rows and nothing covers kit values — and
slices 3 and 4 are both kit-value changes, so without this the reviewer of the next five commits
has no artifact to read. The same task retires the hardcoded baseline: `BASELINE = '00a61f1'`
sits at line 34 and is stale (it predates the whole data-layer split), so the report currently
answers a question nobody asked.

**A report, not an assertion. It always exits 0.** A changed kit parameter is a fact about
content, not a defect; asserting on the set of changes would mean editing the assertion every time
content is edited, which is a test that asserts nothing.

**Files:**
- Modify: `scripts/report-drum-diff.ts` — the doc block (lines 17–21), the `BASELINE` const
  (line 34), the imports (lines 23–27), and a new section appended after the existing grid block
- Test: none. This script is not unit-tested; the check is running it and reading its output.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `bun run report:drums-diff <baseline-commit>` — a two-section report on stdout,
  exit code always 0. Task 7 runs it as the closing step of the slice, and slice 4's plan runs it
  for its own value changes.

- [ ] **Step 1: Make the baseline a required argument**

Replace the doc comment at lines 30–34 (`/** The last commit before any row … */` and
`const BASELINE = '00a61f1';`) with:

```ts
/**
 * The "before" side, as a git rev. REQUIRED, and deliberately not a default:
 * the previous hardcoded value went stale the moment the work it was pinned to
 * merged, and a stale default makes the report answer a question nobody asked
 * while looking exactly like a report that works.
 *
 * Pass the last commit before the work you are reporting on:
 *   bun run report:drums-diff 457de72
 */
const BASELINE = Bun.argv[2];
const TABLE_PATH = 'src/data/drumGrids.ts';
const KIT_TABLE_PATH = 'src/data/drumKits.ts';

if (!BASELINE) {
  console.log('Usage: bun run report:drums-diff <baseline-commit>');
  console.log('');
  console.log('  <baseline-commit>  any git rev. The "before" side is read straight out of');
  console.log('                     git, so there is no snapshot file that can drift.');
  console.log('');
  console.log('No baseline given — nothing to diff against. This is still a clean exit.');
  process.exit(0);
}
```

`Bun.argv[2]` is the first argument after the script path (`Bun.argv` is
`[bunPath, scriptPath, ...args]` — verified: `bun /tmp/probe.ts abc123` printed
`argv: [ "abc123" ]` for `Bun.argv.slice(2)`). `process.exit` is already the idiom in this folder
(`scripts/check-drum-kit-separation.ts:201`, `scripts/check-key-bindings.ts:27`).

Delete the now-duplicated `const TABLE_PATH = 'src/data/drumGrids.ts';` that followed the old
`BASELINE` line — it is folded into the block above.

- [ ] **Step 2: Import the kit table**

Add to the imports (after the `DRUM_GRIDS` import at line 27):

```ts
import { DEFAULT_DRUM_KIT, DRUM_KITS } from '../src/data/drumKits.ts';
```

- [ ] **Step 3: Run it with no argument and confirm the clean exit**

Run: `bun scripts/report-drum-diff.ts; echo "exit=$?"`
Expected: the usage banner, then `exit=0`.

- [ ] **Step 4: Add the kit-value section**

Append this to the **end** of the file, after the existing grid block's closing `}`:

```ts
// --- DRUM_KITS: per kit, per voice, per parameter -------------------------
// A second, self-contained block with its own temp dir. It deliberately does
// NOT share the grid block's scaffolding: the contract is "stdout only, exit
// code always 0" for each half independently, and a kit-side failure must not
// take the working grid report down with it. Six duplicated lines is the
// cheaper of the two risks in a script that asserts nothing.

type Voices = Record<string, Record<string, number>>;

/**
 * mergeDrumKit's one-level-per-voice spread, rewritten locally on purpose.
 * Importing mergeDrumKit would merge the OLD table against TODAY's default and
 * against today's fixed list of voice names, so a slice that adds a voice would
 * report it as unchanged.
 */
const mergeVoices = (def: Voices, partial: Voices): Voices => {
  const out: Voices = {};
  for (const voice of new Set([...Object.keys(def), ...Object.keys(partial)])) {
    out[voice] = { ...(def[voice] ?? {}), ...(partial[voice] ?? {}) };
  }
  return out;
};

const val = (v: number | undefined): string => (v === undefined ? '-' : String(v));

/**
 * Where a merged value came from: the kit's own literal, or DEFAULT_DRUM_KIT.
 * Without this column a slice that adds a voice or a field to the DEFAULT makes
 * every parameter of every kit change at once, and the report is unreadable
 * exactly when it matters most. With it, a reader collapses the `inherited`
 * rows and is left with what someone actually typed.
 */
const originOf = (partial: Voices, voice: string, param: string): string =>
  partial[voice] !== undefined && param in partial[voice] ? 'kit' : 'inherited';

function reportKit(
  before: Voices,
  after: Voices,
  beforePartial: Voices,
  afterPartial: Voices,
): string[] {
  const lines: string[] = [];
  for (const voice of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const b = before[voice] ?? {};
    const a = after[voice] ?? {};
    const params = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
    const changed = params.filter((p) => b[p] !== a[p]);
    if (changed.length === 0) continue;
    lines.push(`      ${voice}`);
    for (const p of changed) {
      const from = originOf(beforePartial, voice, p);
      const to = originOf(afterPartial, voice, p);
      const origin = from === to ? to : `${from} -> ${to}`;
      lines.push(
        `        ${p.padEnd(16)} ${val(b[p]).padStart(9)}  ->  ${val(a[p]).padStart(9)}` +
          `   [${origin}]`,
      );
    }
  }
  return lines;
}

{
  let kitDir: string | undefined;
  try {
    const shownKits = Bun.spawnSync(['git', 'show', `${BASELINE}:${KIT_TABLE_PATH}`]);
    if (shownKits.exitCode !== 0) {
      console.log(`\nCannot read ${BASELINE}:${KIT_TABLE_PATH} — it did not exist at that rev.`);
      console.log('No kit-value diff. This is still a clean exit.');
    } else {
      kitDir = mkdtempSync(join(tmpdir(), 'solna-kit-diff-'));
      const source = shownKits.stdout
        .toString()
        .split('\n')
        .filter((line) => !line.startsWith('import '))
        .join('\n');
      const file = join(kitDir, 'baselineDrumKits.ts');
      writeFileSync(file, source, 'utf8');
      const mod = (await import(pathToFileURL(file).href)) as {
        DEFAULT_DRUM_KIT: Voices;
        DRUM_KITS: Record<string, Voices>;
      };

      const beforePartials = mod.DRUM_KITS;
      const afterPartials = DRUM_KITS as unknown as Record<string, Voices>;
      const before: Record<string, Voices> = {};
      for (const [name, partial] of Object.entries(beforePartials)) {
        before[name] = mergeVoices(mod.DEFAULT_DRUM_KIT, partial);
      }
      const after: Record<string, Voices> = {};
      const todayDefault = DEFAULT_DRUM_KIT as unknown as Voices;
      for (const [name, partial] of Object.entries(afterPartials)) {
        after[name] = mergeVoices(todayDefault, partial);
      }

      console.log(`\nDRUM_KITS, ${BASELINE} -> working tree.`);
      console.log('Values are MERGED (default + override), so a DEFAULT_DRUM_KIT change shows');
      console.log('in every kit that does not override it. A missing value prints as "-", and');
      console.log('the [kit] / [inherited] column says whether the kit typed that value or got');
      console.log('it from DEFAULT_DRUM_KIT — collapse the inherited rows to see the authoring.\n');
      console.log(`  kits: ${Object.keys(before).length} -> ${Object.keys(after).length}\n`);

      let changedKits = 0;
      for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
        if (!(name in before)) {
          console.log(`  + ${name}  NEW KIT\n`);
          changedKits += 1;
          continue;
        }
        if (!(name in after)) {
          console.log(`  - ${name}  DELETED\n`);
          changedKits += 1;
          continue;
        }
        const lines = reportKit(
          before[name],
          after[name],
          beforePartials[name],
          afterPartials[name],
        );
        if (lines.length === 0) continue;
        changedKits += 1;
        console.log(`  ~ ${name}`);
        for (const line of lines) console.log(line);
        console.log('');
      }
      console.log(`  ${changedKits} of ${Object.keys(after).length} kits changed.`);
      console.log('A changed kit parameter is a fact about content, not a defect.');
    }
  } catch (err) {
    console.log(
      `\nCannot build a comparable kit baseline from ${BASELINE}:${KIT_TABLE_PATH}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    console.log('Nothing to diff against. This is still a clean exit.');
  } finally {
    if (kitDir) rmSync(kitDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Update the file's doc block**

The header still says the script reports rows only. Replace lines 1–2 (`* What changed in
DRUM_GRIDS, per grid, per row, as step indices.` and the blank comment line) with:

```
 * What changed in DRUM_GRIDS (per grid, per row, as step indices) and in
 * DRUM_KITS (per kit, per voice, per parameter), between a git rev and the
 * working tree.
 *
 *   bun run report:drums-diff <baseline-commit>
```

and delete the old `*   bun run report:drums-diff` usage line below it.

- [ ] **Step 6: Run it against a baseline that has both tables**

Run: `bun run report:drums-diff 457de72; echo "exit=$?"`
Expected: the grid section, then a `DRUM_KITS, 457de72 -> working tree.` section listing the
slice-1 and slice-2 value changes per kit (`Dusty Break` appears as `+ Dusty Break  NEW KIT`,
because 457de72 predates it), then `exit=0`. Rows look like this — the trailing column is the
provenance:

```
  ~ Warm Riddim
      snare
        bodyFreqStart          180  ->        900   [kit]
      hihat
        filter                4500  ->       5200   [kit]
```

A row that reads `[inherited]` on both sides is a `DEFAULT_DRUM_KIT` change propagating, not
something anyone typed into that kit; a row that reads `[inherited -> kit]` is a kit that has
started overriding a value it used to take from the default.

If this prints the usage banner instead, your `bun run` did not forward the trailing argument —
run `bun scripts/report-drum-diff.ts 457de72` directly and note it in the commit message.

- [ ] **Step 7: Run it against a baseline where the kit table did not exist yet**

Run: `bun run report:drums-diff 633d919; echo "exit=$?"`
Expected: `Cannot read 633d919:src/data/drumKits.ts — it did not exist at that rev.` followed by
`No kit-value diff. This is still a clean exit.` and `exit=0`. (Verified: `git show
633d919:src/data/drumKits.ts` exits non-zero — the data layer landed in 457de72.) The grid section
degrades the same way, on its own path.

- [ ] **Step 8: Run the gate**

Run: `bun run verify`
Expected: all six stages pass. `report:drums-diff` is deliberately **not** part of `verify` — same
rule as `report:library`.

- [ ] **Step 9: Commit**

```bash
git add scripts/report-drum-diff.ts
git commit -m "$(cat <<'EOF'
chore(scripts): report kit values, and require the baseline rev

report:drums-diff covered grid rows and nothing covered kit values, which is
the whole content of slices 1, 3 and 4. It now prints a second section: per
kit, per voice, per parameter, before -> after, over the MERGED kits so a
DEFAULT_DRUM_KIT change is visible where it is heard.

Each row carries a [kit] / [inherited] column. Merged values alone would be
unreadable on a slice that adds a field or a voice to the default, because
every parameter of every kit changes at once; the column lets a reader
collapse the inherited rows and see only what someone typed.

BASELINE was hardcoded to 00a61f1, which predates the data-layer split. A
stale default makes the report answer a question nobody asked while looking
exactly like a report that works, so the rev is now a required argument and
the script prints usage and exits 0 without one.

Still a report, not a check: every failure path prints and exits 0, and the
two sections degrade independently.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

## Task 3: The hi-hat choke group

Spec decisions 9 and 28. A hi-hat is one physical instrument and the closure **is** the damping
(`…hats-and-cymbals.md` §4.1); the TR-808 implements it as the closed-hat envelope forced onto the
open hat's VCA — **an envelope, not a switch**, so the cut has a shape.

| new hit | cuts | release |
|---|---|---|
| `hihat` | any sounding `openhat`, any sounding `hihat` | **20 ms** |
| `openhat` | any sounding `openhat`, any sounding `hihat` | **8 ms** |
| `ride`, `crash`, `bell` | nothing | — |

The release is a property of the **new** hit. 20 ms is the default for closed-cuts-open, where
nothing loud follows to mask the cut; 8 ms is enough for a hat cutting its own kind, because the
new strike masks it. Below ~15 ms a gain jump clicks (`…hats-and-cymbals.md` §4.2).

**Three implementation constraints that are not negotiable (decision 9):**
1. `exponentialRampToValueAtTime` **cannot ramp to 0**, so the choke ramps to the existing
   `ENV_FLOOR` (`src/audio/constants.ts:15`, `0.0001`).
2. The ramp must start from the value **at the choke moment**, not from the peak, or the choke
   re-swells the voice. `this.cancelAndHold(param, now)` (`engine.ts:1309`) is exactly that
   primitive and is already used by the synth path.
3. The node must still be `stop()`ed after the ramp, or the looping noise source keeps running,
   never fires `onended`, and nothing disconnects.

**Prerequisite:** decision 20 landed in slice 2 — verified in "Measured corrections" item 2 above,
zero grids still collide. This is the spec's one ordering constraint that produces a
worse-sounding app if violated.

**Files:**
- Modify: `src/audio/engine.ts` — two new module constants near `DRUM_ALIASES` (line 92); one
  private field and one private method beside `drumNoiseBurst` (currently lines 1621–1653); the
  `drumNoiseBurst` return type; the `hihat` and `openhat` cases (currently lines 1706–1721)
- Test: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `ENV_FLOOR` (already imported at `engine.ts:10`), the private `cancelAndHold(param,
  now, fallbackValue?)`.
- Produces: `private drumNoiseBurst(o): { env: GainNode; noise: AudioBufferSourceNode; stopAt:
  number }` — the return value is new; the four existing callers ignore it. Also
  **the seam slice 4 calls into** — it is "the hat-voice registration method slice 3's task 3
  introduces":

  ```ts
  private registerHatVoice(
    name: string,
    envs: GainNode[],
    sources: AudioScheduledSourceNode[],
    stopAt: number,
  ): void
  private chokeHats(now: number, release: number): void
  private readonly soundingHats: Map<string, SoundingHat>   // written ONLY by registerHatVoice
  type SoundingHat = { envs: GainNode[]; sources: AudioScheduledSourceNode[]; stopAt: number }
  ```

  **`envs` and `sources` are plural from the first commit**, though slice 3 always passes one of
  each. Slice 4 puts the hats on a metallic oscillator bank, so one hat hit sounds through two
  envelopes and seven sources and all of them must be choked; `AudioScheduledSourceNode` is the
  common base of `AudioBufferSourceNode` and `OscillatorNode`, so the bank's oscillators go into
  the same array as the noise. **Slice 4 therefore changes no type here — it calls the same method
  with longer arrays.**

  Task 5 adds a `topCut?: number` option to the same `drumNoiseBurst` signature; Task 6 passes
  `q`. Slice 4 does not extend the *membership* of the group: `ride`, `crash` and `bell` stay in
  no group.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `src/audio/engine.test.ts`, directly after the existing
`describe('drum aliases and unknown types', …)` block:

```ts
describe('the hi-hat choke group', () => {
  test('a closed hat cuts a sounding open hat over 20 ms, from the value at the cut', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('openhat', 1.0, t0);
    // drumEnv creates the env gain first; wireDrumVoice's send gain (if any)
    // comes after it, so the first new gain is always the envelope.
    const openEnv = ctx._gains[before].gain;

    engine.triggerDrum('hihat', 1.0, t0 + 0.05);

    // The ramp must start from the value AT the cut, not from the peak, or the
    // choke re-swells the voice. cancelAndHold is what holds that value.
    expect(openEnv.cancels).toContain(t0 + 0.05);
    // It cannot ramp to 0 — exponentialRampToValueAtTime rejects a zero target
    // — so it lands on the shared ENV_FLOOR, 20 ms later.
    const last = openEnv.events[openEnv.events.length - 1];
    expect(last.kind).toBe('exp');
    expect(last.v).toBe(0.0001);
    expect(last.t).toBeCloseTo(t0 + 0.07, 9);
  });

  test('an open hat cuts a sounding closed hat over 8 ms — its own strike masks it', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('hihat', 1.0, t0);
    const closedEnv = ctx._gains[before].gain;

    engine.triggerDrum('openhat', 1.0, t0 + 0.01);

    expect(closedEnv.cancels).toContain(t0 + 0.01);
    const last = closedEnv.events[closedEnv.events.length - 1];
    expect(last.v).toBe(0.0001);
    expect(last.t).toBeCloseTo(t0 + 0.018, 9);
  });

  test('the crash is in no choke group — real crashes ring through each other', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('crash', 1.0, t0);
    const crashEnv = ctx._gains[before].gain;

    engine.triggerDrum('crash', 1.0, t0 + 0.05);
    engine.triggerDrum('hihat', 1.0, t0 + 0.1);

    // `ride` aliases to `crash` today (DRUM_ALIASES), so this covers the ride
    // too: a ride struck in time-keeping must overlap itself.
    expect(crashEnv.cancels).toEqual([]);
  });

  test('a hat that has already finished is not reached by a later choke', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    // DEFAULT_DRUM_KIT.hihat.decay is 0.05 and the default stopPad is 0.01, so
    // this voice is over at t0 + 0.06.
    engine.triggerDrum('hihat', 1.0, t0);
    const deadEnv = ctx._gains[before].gain;

    engine.triggerDrum('hihat', 1.0, t0 + 0.5);

    expect(deadEnv.cancels).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/audio/engine.test.ts -t "choke group"`
Expected: FAIL — the first two tests fail on `expect(openEnv.cancels).toContain(...)` with
`received: []`, because nothing chokes anything yet. The last two pass already (they assert the
absence of a behaviour) and are there to stay passing.

- [ ] **Step 3: Add the two release constants**

In `src/audio/engine.ts`, directly below the `DRUM_ALIASES` block (which ends at line 96):

```ts
/**
 * The one choke group (spec decision 9): hi-hats, and only hi-hats. A hi-hat is
 * one physical instrument and the closure IS the damping, so a new hat cuts any
 * sounding hat. `ride`, `crash` and `bell` are in NO group — real crashes ring
 * through each other, and a ride struck in time-keeping must overlap itself, so
 * a mono ride would cut every quarter-note ping and destroy the wash.
 *
 * The release belongs to the NEW hit: 20 ms when a closed hat cuts, because
 * nothing loud follows to mask it; 8 ms when an open hat cuts, because its own
 * strike does the masking. Below ~15 ms a gain change clicks
 * (hats-and-cymbals.md §4.2).
 */
const HIHAT_CHOKE_RELEASE = 0.02;
const OPENHAT_CHOKE_RELEASE = 0.008;
```

- [ ] **Step 4: Add the map and the choke method**

Add the field to the `AudioEngine` class, beside the other private drum state (near
`private drumKit`, which `setDrumKit` writes at line 1546):

```ts
  /**
   * Hat voices that are still sounding, keyed by voice name — so at most one
   * `hihat` and one `openhat` are ever held.
   *
   * An INSTANCE field, not a module-scope map: testFakes' makeEngine() builds a
   * fresh engine per test against a fresh fake context whose currentTime is
   * always 10, so a shared map would let one test's "sounding" hat be choked by
   * the next test's first hat, on nodes belonging to a dead context.
   */
  private readonly soundingHats = new Map<string, SoundingHat>();
```

and the value type beside the two release constants at module scope:

```ts
/**
 * One sounding hat, as the choke group needs to see it.
 *
 * `envs` and `sources` are ARRAYS from the first commit even though slice 3
 * only ever puts one of each in them, and that is deliberate: slice 4 puts the
 * hats on a metallic oscillator bank, so a single hat hit will sound through
 * TWO envelopes — the noise burst's and the bank's — over a noise source and
 * six oscillators. A choke that reached only the first of them would half-work,
 * leave the bank ringing, and give no clue why. Plural before it needs to be is
 * the cheaper half of that trade.
 */
type SoundingHat = {
  envs: GainNode[];
  sources: AudioScheduledSourceNode[];
  stopAt: number;
};
```

Add both methods directly above `drumNoiseBurst`:

```ts
  /**
   * Put a hat voice in the choke group, replacing whatever was registered under
   * the same name. THE one registration path — nothing else may write
   * `soundingHats`, so a new hat voice is choked correctly by construction
   * rather than by remembering to add it.
   */
  private registerHatVoice(
    name: string,
    envs: GainNode[],
    sources: AudioScheduledSourceNode[],
    stopAt: number,
  ): void {
    this.soundingHats.set(name, { envs, sources, stopAt });
  }

  /**
   * Cut every sounding hat at `now`, over `release` seconds. Three constraints,
   * all non-negotiable (spec decision 9):
   *  - exponentialRampToValueAtTime cannot ramp to 0, so the target is the
   *    shared ENV_FLOOR;
   *  - the ramp starts from the value AT `now`, via cancelAndHold. Starting
   *    from the peak would make the choke re-swell the voice it is cutting;
   *  - every source is still stop()ed after the ramp, or a looping node keeps
   *    running, never fires onended, and nothing disconnects.
   *
   * Every envelope of the voice is ramped and every source stopped, not just
   * the first — see the note on `SoundingHat`.
   *
   * Entries whose voice is already over are dropped rather than re-scheduled:
   * ramping a finished envelope would revive it.
   */
  private chokeHats(now: number, release: number): void {
    for (const [key, voice] of this.soundingHats) {
      this.soundingHats.delete(key);
      if (voice.stopAt <= now) continue;
      for (const env of voice.envs) {
        this.cancelAndHold(env.gain, now);
        env.gain.exponentialRampToValueAtTime(ENV_FLOOR, now + release);
      }
      for (const source of voice.sources) {
        try {
          source.stop(now + release);
        } catch {
          /* already stopped */
        }
      }
    }
  }
```

- [ ] **Step 5: Make `drumNoiseBurst` return its voice**

Change its signature's return type from `: void` to:

```ts
  }): { env: GainNode; noise: AudioBufferSourceNode; stopAt: number } {
```

and inside, replace `noise.stop(o.t + o.decay + (o.stopPad ?? 0.01));` with:

```ts
    const stopAt = o.t + o.decay + (o.stopPad ?? 0.01);
    noise.start(o.t, this.noiseStartOffset());
    noise.stop(stopAt);
```

(deleting the existing `noise.start(...)` line above it), and add a `return` as the method's last
statement, after the `noise.onended = …` assignment:

```ts
    return { env, noise, stopAt };
```

The four existing callers (`snare`, `clap`, `crash`, and the two hats) ignore the value; an
ignored return is not a lint error here.

- [ ] **Step 6: Choke and register in the two hat cases**

Replace the `hihat` and `openhat` cases:

```ts
      case 'hihat': {
        const h = k.hihat;
        this.chokeHats(now, HIHAT_CHOKE_RELEASE);
        const hat = this.drumNoiseBurst({
          filterType: 'highpass', freq: h.filter, peak: v * h.gain, decay: h.decay, t: now,
        });
        this.registerHatVoice('hihat', [hat.env], [hat.noise], hat.stopAt);
        break;
      }
      case 'openhat': {
        // No delay tap: drums bypass delay and distortion entirely. The old
        // unconditional gain.connect(delayNode) here was a stray with no kit
        // parameter behind it.
        const h = k.openhat;
        this.chokeHats(now, OPENHAT_CHOKE_RELEASE);
        const hat = this.drumNoiseBurst({
          filterType: 'highpass', freq: h.filter, peak: v * h.gain, decay: h.decay, t: now,
        });
        this.registerHatVoice('openhat', [hat.env], [hat.noise], hat.stopAt);
        break;
      }
```

The choke runs **before** the new burst is built, so the new voice is never in the map it sweeps.
The single-element arrays are not over-engineering: slice 4 passes `[noiseEnv, bankEnv]` and
`[noise, ...bankOscillators]` through this same method, and widening a value type at a distance
across a slice boundary is exactly the seam that rots.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS, including the four new tests and the existing
`the open hat does not tap the delay` and `drum noise is looped and starts at a random offset`
tests, which both go through the changed `drumNoiseBurst`.

- [ ] **Step 8: Run the gate**

Run: `bun run verify`
Expected: all six stages pass, eslint at zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/audio/engine.ts src/audio/engine.test.ts
git commit -m "$(cat <<'EOF'
feat(audio): give the hi-hats a choke group

A hi-hat is one physical instrument and the closure IS the damping, so a new
hat now cuts any sounding hat: 20 ms when a closed hat cuts (nothing loud
follows to mask it), 8 ms when an open hat cuts (its own strike does).
ride, crash and bell are in no group and may ring together.

The cut is an envelope, not a switch, and its three constraints are load
bearing: it ramps to ENV_FLOOR because an exponential ramp cannot reach 0;
it starts from the value at the cut via cancelAndHold, because starting from
the peak makes the choke re-swell the voice; and it still stops the source,
because a looping noise node that never ends never disconnects.

The map of sounding hats is an instance field, not module scope: tests build
a fresh engine per case against a fake clock that always starts at 10. Its
one writer is registerHatVoice, which takes ARRAYS of envelopes and sources
though slice 3 passes one of each -- slice 4's metallic bank makes a single
hat hit sound through two envelopes and seven sources, and a choke that
reached only the first would half-work with no visible cause.

24 grids play both hat rows and none of them collide on a step any more
(slice 2, decision 20), which is what makes this audible rather than
destructive.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

## Task 4: `reverbSend` on `KickParams` and `TomParams`

Spec decision 25. `wireDrumVoice` already accepts a send (`engine.ts:1583`, `private
wireDrumVoice(env: GainNode, reverbSend = 0)`); `drumTone` — the pitched path the kick and the tom
run through — never passes one, so the send argument defaults to 0 and no send node is built.

Per `drum-kit-identities.md` §5.2 this is **the largest ceiling gain in the library from the
smallest change**: `Warehouse` moves 2.5 → 4.0, because both of its defining traits are routing —
a dense low-passed reverb fed from the kick, doing the job of a bassline. Without it, `Warehouse`
reduces to "909 Modern with a duller kick and a brighter hat", which is what the measured twinning
in §3 says it currently is. Second named beneficiary: `Acoustic Studio` gets a room.

**Files:**
- Modify: `src/data/drumKits.ts` — `KickParams`, `TomParams`, `DEFAULT_DRUM_KIT`, and the `kick`
  and `tom` entries of all 13 kits
- Modify: `src/audio/engine.ts` — `drumTone`'s options and its `wireDrumVoice` call; the `kick`
  and `tom` cases in `triggerDrum`
- Modify: `scripts/check-drum-kit-separation.ts` — two `spread()` entries
- Test: `src/audio/engine.test.ts`, `src/audio/drumKits.test.ts`

**Interfaces:**
- Consumes: `DRUM_TYPES` is not needed here. Uses `wireDrumVoice(env, reverbSend)` as it stands.
- Produces: `KickParams.reverbSend: number` and `TomParams.reverbSend: number` — **required**
  fields, per the slice-4 contract, so every kit and `DEFAULT_DRUM_KIT` must carry one (Global
  Constraint 5: `mergeDrumKit` cannot delete a default key). `drumTone`'s option object gains
  `reverbSend?: number`.

### The values

**Every value is > 0, and that is load-bearing.** `spread()` asserts `max >= factor * min`; a
single kit at exactly 0 makes `required` 0 and the check passes vacuously for any factor, which is
precisely what decision 40 forbids. The driest kits sit at 0.05, not at 0.

Sends are on the same 0..1 scale as the existing `snare`, `clap` and `crash` sends, which today
span 0.10–0.55. Sourced where `drum-kit-identities.md` §2 names the kit's intent; reasoned from
that kit's existing sends where it does not.

| kit | `kick.reverbSend` | `tom.reverbSend` | why |
|---|---|---|---|
| Retro Drive | 0.22 | 0.40 | gated 80s: high send + short source is the reachable approximation (§2 "Gap"). The Simmons tom carries it |
| 909 Modern | 0.10 | 0.20 | a club 909 kick is dry and forward. Kept far from `Warehouse` on purpose — this is the pair §3 measured as twins |
| Trap Beat | 0.05 | 0.10 | the 808 is a sustained *note*; a wet sub is mud |
| 808 Vintage | 0.08 | 0.15 | the bridged-T rings itself down (§2); no room |
| Chrome Pulse | 0.30 | 0.45 | the wettest/brightest corner kit — its snare, clap and crash sends are already 0.50/0.50/0.55 |
| Velocity Breaks | 0.12 | 0.18 | a break's ambience lives on the snare; the kick is the shortest in the library |
| Sub Weight | 0.15 | 0.30 | the sub must stay defined |
| **Warehouse** | **0.45** | 0.40 | **the point of this task**: the highest kick send in the library, feeding the same dense low-passed reverb its snare (0.40) and crash (0.45) already use |
| Tight Pocket | 0.05 | 0.08 | driest kit in the library — 1969 King Studios, no gates, no reverb ornament (§2) |
| **Acoustic Studio** | **0.28** | **0.50** | the second named beneficiary: a room around a close-miked kit. Its tom is the longest in the library and its crash send is already 0.50 |
| Warm Riddim | 0.35 | 0.45 | dub's spring reverb — its clap send is already the library's wettest at 0.50 |
| Lo-Fi Vinyl | 0.18 | 0.22 | an SP-1200 room: dusty, not big |
| Dusty Break | 0.20 | 0.25 | mid-dry, consistent with its 0.25 snare and 0.15 clap |
| `DEFAULT_DRUM_KIT` | 0.15 | 0.25 | a middle value a kit can inherit and still sound like a kit |

Measured spreads over the 13 merged kits (`DEFAULT_DRUM_KIT` is not one of them, so it does not
enter the ratio):

```
$ bun -e '<the two tables above as objects>; const r=(o)=>{const v=Object.values(o);
  return `min=${Math.min(...v)} max=${Math.max(...v)} ratio=${(Math.max(...v)/Math.min(...v)).toFixed(2)}`};
  console.log("kick", r(kickSend)); console.log("tom", r(tomSend))'
kick  min=0.05 max=0.45 ratio=9.00
tom   min=0.05 max=0.5  ratio=6.25
```

Both clear the factor 3.0 the task adds with a wide margin, so a later retune has room to move
without hitting the floor.

- [ ] **Step 1: Write the failing tests**

In `src/audio/engine.test.ts`, add to the drum `describe` block that already contains
`velocity is clamped to 0..1`:

```ts
  test('the kick body feeds the reverb send at the kit level; the click does not', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit.kick = {
      freqStart: 150, freqEnd: 40, pitchTime: 0.02, decay: 0.4, gain: 1,
      clickFreq: 1100, clickLevel: 0.35, clickDecay: 0.008, reverbSend: 0.45,
    };
    const sendFilter = (engine as any).drumSendFilter;
    const before = ctx._gains.length;

    engine.triggerDrum('kick', 1.0);

    const sends = ctx._gains.slice(before).filter((g) => g.connectedTo.includes(sendFilter));
    // Exactly one: the body. A click through a reverb is a slap, and the click
    // is a transient whose whole job is to stay dry.
    expect(sends).toHaveLength(1);
    expect(sends[0].gain.value).toBeCloseTo(0.45, 9);
  });

  test('the tom feeds the reverb send at the kit level', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit.tom = {
      freqStart: 200, freqEnd: 110, pitchTime: 0.3, decay: 0.6, gain: 0.78, reverbSend: 0.5,
    };
    const sendFilter = (engine as any).drumSendFilter;
    const before = ctx._gains.length;

    engine.triggerDrum('tom', 1.0);

    const sends = ctx._gains.slice(before).filter((g) => g.connectedTo.includes(sendFilter));
    expect(sends).toHaveLength(1);
    expect(sends[0].gain.value).toBeCloseTo(0.5, 9);
  });
```

In `src/audio/drumKits.test.ts`, add:

```ts
  test('every kit sends its kick and its tom to the reverb, and Warehouse sends the most kick', () => {
    const sends = Object.entries(DRUM_KITS).map(
      ([name, partial]) => [name, mergeDrumKit(partial)] as const,
    );
    for (const [name, kit] of sends) {
      // Strictly greater than zero, and that is not decoration: check:drums'
      // spread() asserts max >= factor * min, so one kit at exactly 0 makes the
      // requirement 0 and the check passes vacuously for any factor.
      expect(kit.kick.reverbSend, `${name}.kick`).toBeGreaterThan(0);
      expect(kit.tom.reverbSend, `${name}.tom`).toBeGreaterThan(0);
    }
    const wettestKick = sends.reduce((a, b) =>
      b[1].kick.reverbSend > a[1].kick.reverbSend ? b : a,
    );
    // decision 25: the kick send is what makes Warehouse ≠ 909 Modern.
    expect(wettestKick[0]).toBe('Warehouse');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/audio/engine.test.ts -t "reverb send" && bun test src/audio/drumKits.test.ts -t "sends its kick"`
Expected: FAIL — the engine tests fail with `expect(sends).toHaveLength(1)` receiving `[]`
(`drumTone` builds no send node), and the kit test fails to type-check / fails on
`expect(undefined).toBeGreaterThan(0)`.

- [ ] **Step 3: Add the field to the two interfaces and to `DEFAULT_DRUM_KIT` — and nowhere else**

**Do not author the thirteen kit values yet.** Steps 3–7 exist in this order so the first
authoring pass runs against a check that can fail (spec decision 40.3): with only the default
carrying a value, all thirteen merged kits hold the *identical* number, and no `spread()` factor
above 1 can hold. Steps 4 and 5 prove the check is live before Step 6 satisfies it.

**Expect `tsc` to be red from here until Step 6.** `KickParams` and `TomParams` are not `Partial`
inside `DRUM_KITS` — a kit that provides a `kick` literal must provide a whole `KickParams` — so
adding a required field breaks all thirteen literals at type-check time. That is fine and
temporary: `bun run check:drums` runs the script through Bun, which strips types without checking
them, so the check still executes. **Do not run `bun run verify` between here and Step 7.**

In `src/data/drumKits.ts`:

```ts
export interface KickParams {
  freqStart: number;
  freqEnd: number;
  pitchTime: number;
  decay: number;
  gain: number;
  clickFreq?: number;
  clickLevel?: number;
  clickDecay?: number;
  /** Level into the drum reverb send, 0..1. The BODY only — the click stays dry. */
  reverbSend: number;
}
```

```ts
export interface TomParams {
  freqStart: number;
  freqEnd: number;
  pitchTime: number;
  decay: number;
  gain: number;
  /** Level into the drum reverb send, 0..1. */
  reverbSend: number;
}
```

and in `DEFAULT_DRUM_KIT`:

```ts
  kick: { freqStart: 150, freqEnd: 35, pitchTime: 0.03, decay: 0.35, gain: 0.9, reverbSend: 0.15 },
  tom: { freqStart: 88, freqEnd: 65, pitchTime: 0.14, decay: 0.28, gain: 0.7, reverbSend: 0.25 },
```

- [ ] **Step 4: Add the two spread entries — before the values, not after**

In `scripts/check-drum-kit-separation.ts`, after the `spreadDefined('kick.clickLevel', …)` line:

```ts
// --- Check 2c: the routing parameters (spec decision 25) ---
// Every kit's value is > 0 by construction (asserted in audio/drumKits.test.ts):
// a single kit at 0 would make `factor * min` zero and this check vacuous.
spread('kick.reverbSend', (k) => k.kick.reverbSend, 3.0);
spread('tom.reverbSend', (k) => k.tom.reverbSend, 3.0);
```

- [ ] **Step 5: Run `check:drums` and watch it FAIL**

Run: `bun run check:drums; echo "exit=$?"`
Expected: **FAIL**, `exit=1`, with exactly these two lines:

```
FAIL  kick.reverbSend spread  (max=0.15, min=0.15, required max >= 3*min=0.450 -- retune a kit to widen this spread; do not lower the factor)
FAIL  tom.reverbSend spread  (max=0.25, min=0.25, required max >= 3*min=0.750 -- retune a kit to widen this spread; do not lower the factor)
```

Every kit inherits the one default, so `max` and `min` are the same number. **This failure is the
point of the step.** A spread added after its values can only ever have been seen passing, and a
check whose failing state was never observed is a check nobody has tested.

- [ ] **Step 6: Author the value in all 13 kits**

Append `reverbSend: <value>` to each kit's `kick` and `tom` literals in `DRUM_KITS`, using the
table above. Every entry already overrides both voices, so this is one added key per literal:

| kit | append to `kick` | append to `tom` |
|---|---|---|
| `'Retro Drive'` | `reverbSend: 0.22` | `reverbSend: 0.4` |
| `'909 Modern'` | `reverbSend: 0.1` | `reverbSend: 0.2` |
| `'Trap Beat'` | `reverbSend: 0.05` | `reverbSend: 0.1` |
| `'808 Vintage'` | `reverbSend: 0.08` | `reverbSend: 0.15` |
| `'Chrome Pulse'` | `reverbSend: 0.3` | `reverbSend: 0.45` |
| `'Velocity Breaks'` | `reverbSend: 0.12` | `reverbSend: 0.18` |
| `'Sub Weight'` | `reverbSend: 0.15` | `reverbSend: 0.3` |
| `'Warehouse'` | `reverbSend: 0.45` | `reverbSend: 0.4` |
| `'Tight Pocket'` | `reverbSend: 0.05` | `reverbSend: 0.08` |
| `'Acoustic Studio'` | `reverbSend: 0.28` | `reverbSend: 0.5` |
| `'Warm Riddim'` | `reverbSend: 0.35` | `reverbSend: 0.45` |
| `'Lo-Fi Vinyl'` | `reverbSend: 0.18` | `reverbSend: 0.22` |
| `'Dusty Break'` | `reverbSend: 0.2` | `reverbSend: 0.25` |

**Two of these values need a comment in the table, in the same shape as the `Chrome Pulse` and
`Warm Riddim` notes already in the file.** `Tight Pocket` and `Trap Beat` are the driest kits and
0.05 looks like a rounding error someone should tidy to 0. It is not a taste choice. Write it
above each of those two kit entries:

```ts
  // The 0.05 sends are a FLOOR, not a taste choice: do not "tidy" them to 0.
  // check:drums' spread() asserts max >= factor * min, so one kit at exactly 0
  // makes the requirement 0 and the whole check passes for any factor. This is
  // the driest kit in the library and 0.05 is how it says so without going mute
  // on the gate.
  'Tight Pocket': {
```

```ts
  // 0.05, not 0 — see the note on 'Tight Pocket'. A trap 808 is a dry sustained
  // note, and a single 0 anywhere in this column makes the spread check vacuous.
  'Trap Beat': {
```

- [ ] **Step 7: Run `check:drums` and watch it pass**

Run: `bun run check:drums; echo "exit=$?"`
Expected: `exit=0`, with the two lines from Step 5 now reading
`PASS  kick.reverbSend spread  (max=0.45, min=0.05, required max >= 3*min=0.150)` and
`PASS  tom.reverbSend spread  (max=0.5, min=0.08, required max >= 3*min=0.240)`.

- [ ] **Step 8: Thread the send through `drumTone`**

In `src/audio/engine.ts`, add the option and use it:

```ts
  /** A pitched drum component (kick body, kick click, snare body, tom). */
  private drumTone(o: {
    type?: OscillatorType;
    freq: number;
    freqEnd?: number;
    pitchTime?: number;
    peak: number;
    decay: number;
    t: number;
    stopAt?: number;
    reverbSend?: number;
  }): void {
```

and change the one call inside it:

```ts
    const send = this.wireDrumVoice(env, o.reverbSend);
```

Then in `triggerDrum`, the `kick` case — the **body only**:

```ts
      case 'kick': {
        const d = k.kick;
        this.drumTone({
          freq: d.freqStart, freqEnd: d.freqEnd, pitchTime: d.pitchTime,
          peak: v * d.gain, decay: d.decay, t: now, reverbSend: d.reverbSend,
        });
        if (d.clickFreq && d.clickLevel) {
          // No send: the click is the beater transient and its whole job is to
          // stay dry. A click through a reverb is a slap.
          this.drumTone({
            freq: d.clickFreq, peak: v * d.clickLevel, decay: d.clickDecay ?? 0.01,
            t: now, stopAt: now + d.decay + 0.02,
          });
        }
        break;
      }
```

and the `tom` case:

```ts
      case 'tom': {
        const t = k.tom;
        this.drumTone({
          freq: t.freqStart, freqEnd: t.freqEnd, pitchTime: t.pitchTime,
          peak: v * t.gain, decay: t.decay, t: now, reverbSend: t.reverbSend,
        });
        break;
      }
```

The `snare` case's `drumTone` call is left alone on purpose: the snare's send is already carried
by its noise burst, and adding a second send would double the kit's authored level.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `bun test src/audio/engine.test.ts src/audio/drumKits.test.ts src/data/drumKits.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the gate**

Run: `bun run verify`
Expected: all six stages pass, eslint at zero errors. `tsc --noEmit` is green again — the thirteen
kit literals gained the required field in Step 6.

- [ ] **Step 11: Commit**

```bash
git add src/data/drumKits.ts src/audio/engine.ts src/audio/engine.test.ts src/audio/drumKits.test.ts scripts/check-drum-kit-separation.ts
git commit -m "$(cat <<'EOF'
feat(audio): give the kick and the tom a reverb send

wireDrumVoice already took a send level; drumTone never passed one, so the
two pitched voices were the only ones in the kit with no route to the drum
reverb. Threading it through is four lines and, per the identities research,
the largest ceiling gain in the library: Warehouse's defining trait is a
dense low-passed reverb fed from the kick, and without it the kit is 909
Modern with a duller kick and a brighter hat -- which is what the measured
twinning said it was. Acoustic Studio gets its room.

The click stays dry: it is the beater transient, and a click through a
reverb is a slap. The snare's drumTone call is untouched -- its send is
already on its noise burst.

Every kit's value is strictly greater than zero, asserted in a test, because
spread() checks max >= factor * min and one kit at zero would make the whole
check vacuous.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

## Task 5: `topCut` on `HatParams`

Spec decision 26. The hat's `filter` is a **highpass**, so a *lower* corner passes *more* energy:
`Lo-Fi Vinyl`'s low corner makes it one of the two fullest and loudest hats in the library — the
exact inverse of its intent. "Lo-fi" means a *band*, not a floor. A second biquad gives the hat an
upper corner and turns the busiest row in the library from a one-axis voice into a two-axis one.

`drum-kit-identities.md` §6 item 2 names the reachable anchors: **808 ~12 kHz, LinnDrum ~12 kHz,
909 ~15 kHz**, and §2's `Lo-Fi Vinyl` gap names **7–8 kHz** as the value that kit was reaching for.

**Files:**
- Modify: `src/data/drumKits.ts` — `HatParams`, `DEFAULT_DRUM_KIT`, and the `hihat` and `openhat`
  entries of all 13 kits
- Modify: `src/audio/engine.ts` — `drumNoiseBurst` gains a `topCut?: number` option and a second
  biquad; the two hat cases pass it
- Modify: `src/audio/testFakes.ts` — `fakeCtx` records biquads in `_filters`
- Modify: `scripts/check-drum-kit-separation.ts` — two `spread()` entries
- Test: `src/audio/engine.test.ts`, `src/audio/drumKits.test.ts`

**Interfaces:**
- Consumes: `drumNoiseBurst`'s option object and return type as Task 3 left them
  (`{ env, noise, stopAt }`).
- Produces: `HatParams { filter: number; topCut: number; decay: number; gain: number }` — a
  **required** field, per the slice-4 contract, so `DEFAULT_DRUM_KIT` must carry one.
  `drumNoiseBurst`'s options gain `topCut?: number`. `fakeCtx()` gains `_filters:
  ReturnType<typeof fakeNode>[]`, which Task 6's tests also read.

### The values

Two rules the whole table obeys:

1. **`topCut` must sit well above `filter`, or the band closes and the hat goes silent.** Every
   entry below is at least **1.5×** the kit's highpass corner, and a test asserts it.
2. **`DEFAULT_DRUM_KIT` is effectively open (16000).** A hypothetical kit that inherits it sounds
   exactly as it does today, which is what Global Constraint 5 asks of a default.

| kit | `hihat.filter` (today) | `hihat.topCut` | `openhat.filter` (today) | `openhat.topCut` | source |
|---|---|---|---|---|---|
| Retro Drive | 6400 | 12000 | 5400 | 12000 | LinnDrum ~12 kHz (§6 item 2) |
| 909 Modern | 8500 | 15000 | 7200 | 15000 | 909 ~15 kHz (§6 item 2) |
| Trap Beat | 9000 | 16000 | 7600 | 15000 | trap hats sit above everything; the brightest referenced kit |
| 808 Vintage | 5200 | 12000 | 4400 | 12000 | 808 ~12 kHz (§6 item 2) |
| Chrome Pulse | 8800 | 18000 | 7200 | 17000 | no referent by design (§2): its job is the brightest corner, so its band is the widest |
| Velocity Breaks | 8800 | 14000 | 7200 | 13000 | a miked 1969 kit through tape — bright, band-limited |
| Sub Weight | 7200 | 13000 | 6200 | 12000 | synthesised dubstep hats, bright but not the top |
| Warehouse | 8800 | 14000 | 7200 | 13000 | "rattling" (§2), bright, below Chrome Pulse |
| Tight Pocket | 3600 | 9000 | 3200 | 8500 | a 1969 console: the band is narrow at both ends |
| Acoustic Studio | 6400 | 13000 | 5400 | 13000 | a real hat has energy right to the top |
| Warm Riddim | 5200 | 10000 | 4400 | 9500 | valve/tape reggae: a softened top |
| **Lo-Fi Vinyl** | 3600 | **7500** | 3200 | **7000** | **§2's own prescription** — "a `topCut` lowpass around 7–8 kHz". This is the value the kit was authored to want and could not express |
| Dusty Break | 7000 | 11000 | 5200 | 9500 | dark end of the middle; 11000 rather than a lower figure because its highpass is already 7000 and the band must stay ≥ 1.5× wide |
| `DEFAULT_DRUM_KIT` | 7500 | 16000 | 6500 | 16000 | effectively open — a kit that inherits it is unchanged |

Measured, over the 13 merged kits:

```
$ bun -e '<the two topCut tables as objects>; const r=(o)=>{const v=Object.values(o);
  return `min=${Math.min(...v)} max=${Math.max(...v)} ratio=${(Math.max(...v)/Math.min(...v)).toFixed(2)}`};
  console.log("hihat.topCut", r(hiTop)); console.log("openhat.topCut", r(opTop))'
hihat.topCut    min=7500 max=18000 ratio=2.40
openhat.topCut  min=7000 max=17000 ratio=2.43
```

Both clear the factor 2.0 this task adds.

- [ ] **Step 1: Let the fake context record its biquads**

In `src/audio/testFakes.ts`, inside `fakeCtx`, add the collection beside the two that already
exist and push to it:

```ts
export function fakeCtx(opts: FakeOpts = {}) {
  const gains: ReturnType<typeof fakeNode>[] = [];
  const filters: ReturnType<typeof fakeNode>[] = [];
  const bufferSources: ReturnType<typeof fakeBufferSource>[] = [];
```

```ts
    createBiquadFilter: () => {
      const f = fakeNode(opts);
      filters.push(f);
      return f;
    },
```

```ts
    _gains: gains,
    _filters: filters,
    _bufferSources: bufferSources,
```

This is additive — no existing test reads `_filters`, and `createBiquadFilter` still returns the
same kind of node.

- [ ] **Step 2: Write the failing tests**

In `src/audio/engine.test.ts`, in the same drum `describe` block:

```ts
  test('a hat is a BAND: the highpass runs into a lowpass at the kit topCut', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit.hihat = { filter: 3600, topCut: 7500, decay: 0.038, gain: 0.22 };
    const before = ctx._filters.length;

    engine.triggerDrum('hihat', 1.0);

    const made = ctx._filters.slice(before);
    expect(made).toHaveLength(2);
    expect(made[0].type).toBe('highpass');
    expect(made[0].frequency.value).toBe(3600);
    expect(made[1].type).toBe('lowpass');
    expect(made[1].frequency.value).toBe(7500);
    // Order matters: highpass -> lowpass -> envelope. Without the second
    // biquad a LOWER corner passes MORE energy, which is how the darkest
    // authored hat became the fullest-sounding one.
    expect(made[0].connectedTo).toContain(made[1]);
  });

  test('the open hat gets its own topCut', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit.openhat = { filter: 3200, topCut: 7000, decay: 0.24, gain: 0.26 };
    const before = ctx._filters.length;

    engine.triggerDrum('openhat', 1.0);

    const made = ctx._filters.slice(before);
    expect(made).toHaveLength(2);
    expect(made[1].type).toBe('lowpass');
    expect(made[1].frequency.value).toBe(7000);
  });

  test('the crash and the clap get no topCut — only the hats are a band', () => {
    const { engine, ctx } = freshEngine();

    let before = ctx._filters.length;
    engine.triggerDrum('crash', 1.0);
    expect(ctx._filters.slice(before)).toHaveLength(1);

    before = ctx._filters.length;
    engine.triggerDrum('clap', 1.0);
    expect(ctx._filters.slice(before)).toHaveLength(1);
  });
```

In `src/audio/drumKits.test.ts`:

```ts
  test('every kit\'s hats are a band, not an inversion: topCut sits above filter', () => {
    for (const [name, partial] of Object.entries(DRUM_KITS)) {
      const kit = mergeDrumKit(partial);
      for (const voice of ['hihat', 'openhat'] as const) {
        // 1.5x, not merely ">": a lowpass a hair above a highpass leaves a
        // notch, not a hat. The margin is what keeps the voice audible.
        expect(kit[voice].topCut, `${name}.${voice}`).toBeGreaterThan(kit[voice].filter * 1.5);
      }
    }
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/audio/engine.test.ts -t "topCut" && bun test src/audio/drumKits.test.ts -t "are a band"`
Expected: FAIL — `expect(made).toHaveLength(2)` receives 1, and the kit test fails to type-check
(`topCut` is not on `HatParams` yet).

- [ ] **Step 4: Add the field to `HatParams` and to `DEFAULT_DRUM_KIT` — and nowhere else**

**Do not author the thirteen kit values yet.** Steps 4–8 are in this order so the first authoring
pass runs against a check that can fail (spec decision 40.3): with only the default carrying a
value, all thirteen merged kits hold the *identical* number and no `spread()` factor above 1 can
hold. **Expect `tsc` to be red from here until Step 7** — a kit that provides a `hihat` literal
must provide a whole `HatParams` — and do not run `bun run verify` in between. `bun run
check:drums` goes through Bun, which strips types without checking them, so the check still runs.

In `src/data/drumKits.ts`:

```ts
export interface HatParams {
  /** Highpass corner, Hz. LOWER passes MORE — it is a floor, not a colour. */
  filter: number;
  /** Lowpass corner, Hz. With `filter` it makes the hat a band rather than a floor. */
  topCut: number;
  decay: number;
  gain: number;
}
```

In `DEFAULT_DRUM_KIT`:

```ts
  hihat: { filter: 7500, topCut: 16000, decay: 0.05, gain: 0.36 },
  openhat: { filter: 6500, topCut: 16000, decay: 0.35, gain: 0.4 },
```

- [ ] **Step 5: Add the two spread entries — before the values, not after**

In `scripts/check-drum-kit-separation.ts`, after the two `reverbSend` spreads from Task 4:

```ts
// --- Check 2d: the hat's second axis (spec decision 26) ---
// One highpass buys about 2.5 hat characters and four kit groups share a hat
// because of it. topCut is the axis that separates them, so it gets a floor of
// its own rather than riding on hihat.filter's.
spread('hihat.topCut', (k) => k.hihat.topCut, 2.0);
spread('openhat.topCut', (k) => k.openhat.topCut, 2.0);
```

- [ ] **Step 6: Run `check:drums` and watch it FAIL**

Run: `bun run check:drums; echo "exit=$?"`
Expected: **FAIL**, `exit=1`, with exactly these two lines:

```
FAIL  hihat.topCut spread  (max=16000, min=16000, required max >= 2*min=32000.000 -- retune a kit to widen this spread; do not lower the factor)
FAIL  openhat.topCut spread  (max=16000, min=16000, required max >= 2*min=32000.000 -- retune a kit to widen this spread; do not lower the factor)
```

Every kit inherits the one default, so `max` and `min` are the same number. **This failure is the
point of the step** — a check whose failing state was never observed is a check nobody has tested.

- [ ] **Step 7: Author `topCut` in all 13 kits**

Add `topCut` to each kit's two hat literals, from the table above:

| kit | `hihat` | `openhat` |
|---|---|---|
| `'Retro Drive'` | `topCut: 12000` | `topCut: 12000` |
| `'909 Modern'` | `topCut: 15000` | `topCut: 15000` |
| `'Trap Beat'` | `topCut: 16000` | `topCut: 15000` |
| `'808 Vintage'` | `topCut: 12000` | `topCut: 12000` |
| `'Chrome Pulse'` | `topCut: 18000` | `topCut: 17000` |
| `'Velocity Breaks'` | `topCut: 14000` | `topCut: 13000` |
| `'Sub Weight'` | `topCut: 13000` | `topCut: 12000` |
| `'Warehouse'` | `topCut: 14000` | `topCut: 13000` |
| `'Tight Pocket'` | `topCut: 9000` | `topCut: 8500` |
| `'Acoustic Studio'` | `topCut: 13000` | `topCut: 13000` |
| `'Warm Riddim'` | `topCut: 10000` | `topCut: 9500` |
| `'Lo-Fi Vinyl'` | `topCut: 7500` | `topCut: 7000` |
| `'Dusty Break'` | `topCut: 11000` | `topCut: 9500` |

- [ ] **Step 8: Run `check:drums` and watch it pass**

Run: `bun run check:drums; echo "exit=$?"`
Expected: `exit=0`, with the two lines from Step 6 now reading
`PASS  hihat.topCut spread  (max=18000, min=7500, required max >= 2*min=15000.000)` and
`PASS  openhat.topCut spread  (max=17000, min=7000, required max >= 2*min=14000.000)`.

- [ ] **Step 9: Add the second biquad to `drumNoiseBurst`**

In `src/audio/engine.ts`, add the option:

```ts
  private drumNoiseBurst(o: {
    filterType: BiquadFilterType;
    freq: number;
    q?: number;
    topCut?: number;
    peak: number;
    decay: number;
    t: number;
    stopPad?: number;
    reverbSend?: number;
    shape?: (gain: AudioParam) => void;
  }): { env: GainNode; noise: AudioBufferSourceNode; stopAt: number } {
```

Build it after the first filter:

```ts
    const noise = this.createNoiseNode();
    const filter = this.ctx!.createBiquadFilter();
    filter.type = o.filterType;
    filter.frequency.value = o.freq;
    if (o.q !== undefined) filter.Q.value = o.q;

    // The upper corner. `filterType` is a HIGHPASS for the hats, so without
    // this a lower `freq` passes MORE energy, not less — which is how the two
    // darkest-authored hats in the library became its fullest-sounding ones.
    // Two biquads make the hat a band; one made it a floor.
    let topCutFilter: BiquadFilterNode | undefined;
    if (o.topCut !== undefined) {
      topCutFilter = this.ctx!.createBiquadFilter();
      topCutFilter.type = 'lowpass';
      topCutFilter.frequency.value = o.topCut;
    }
```

Wire it in place of the existing `noise.connect(filter); filter.connect(env);` pair:

```ts
    noise.connect(filter);
    if (topCutFilter) {
      filter.connect(topCutFilter);
      topCutFilter.connect(env);
    } else {
      filter.connect(env);
    }
```

and add it to the teardown inside `noise.onended`, after the `filter.disconnect()` line:

```ts
      if (topCutFilter) try { topCutFilter.disconnect(); } catch { /* ignore */ }
```

- [ ] **Step 10: Pass it from the two hat cases**

```ts
      case 'hihat': {
        const h = k.hihat;
        this.chokeHats(now, HIHAT_CHOKE_RELEASE);
        const hat = this.drumNoiseBurst({
          filterType: 'highpass', freq: h.filter, topCut: h.topCut,
          peak: v * h.gain, decay: h.decay, t: now,
        });
        this.registerHatVoice('hihat', [hat.env], [hat.noise], hat.stopAt);
        break;
      }
      case 'openhat': {
        // No delay tap: drums bypass delay and distortion entirely. The old
        // unconditional gain.connect(delayNode) here was a stray with no kit
        // parameter behind it.
        const h = k.openhat;
        this.chokeHats(now, OPENHAT_CHOKE_RELEASE);
        const hat = this.drumNoiseBurst({
          filterType: 'highpass', freq: h.filter, topCut: h.topCut,
          peak: v * h.gain, decay: h.decay, t: now,
        });
        this.registerHatVoice('openhat', [hat.env], [hat.noise], hat.stopAt);
        break;
      }
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `bun test src/audio/ src/data/`
Expected: PASS.

- [ ] **Step 12: Run the gate**

Run: `bun run verify`
Expected: all six stages pass, eslint at zero errors. `tsc --noEmit` is green again — the thirteen
kit literals gained the required field in Step 7.

- [ ] **Step 13: Commit**

```bash
git add src/data/drumKits.ts src/audio/engine.ts src/audio/engine.test.ts src/audio/drumKits.test.ts src/audio/testFakes.ts scripts/check-drum-kit-separation.ts
git commit -m "$(cat <<'EOF'
feat(audio): give the hats an upper corner

hat.filter is a HIGHPASS, so a lower corner passes MORE energy. That is why
the two kits authored as the darkest -- Lo-Fi Vinyl and Tight Pocket, both at
3600 Hz -- are the fullest and loudest hats in the library, the exact inverse
of their intent. Lo-fi means a band, not a floor.

A second biquad on the hat path gives every kit an upper corner, and turns
the busiest row in the library from a one-axis voice into a two-axis one.
The sourced anchors land: 808 and LinnDrum at 12 kHz, 909 at 15 kHz, and
Lo-Fi Vinyl at the 7.5 kHz its own research note prescribed and it had no
way to express.

Every topCut is at least 1.5x its kit's highpass corner, asserted in a test:
a lowpass a hair above a highpass is a notch, not a hat. The default is
effectively open, so a kit that inherits it is unchanged.

fakeCtx now records biquads in _filters, the way it already records _gains.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

## Task 6: Pass `q` to the hats

Spec decision 27, ruling R7. `drumNoiseBurst` already takes a `q` and applies it
(`if (o.q !== undefined) filter.Q.value = o.q;`); the `crash` passes `0.8`, the `clap` passes
`1.5`, and **the hats pass nothing**, so their highpass runs at the browser default Q of 1.

A highpass at **Q 4–6** has a resonant bump at the cutoff, which is **the cheapest available
approximation of a partial** over white noise — `…hats-and-cymbals.md` §5.1 calls it *"the highest
value-per-line change in the whole document"*. Ruling R7: **hardcoded, no new kit field.**

**Files:**
- Modify: `src/audio/engine.ts` — one module constant beside the choke releases, passed from the
  two hat cases
- Test: `src/audio/engine.test.ts`

**Interfaces:**
- Consumes: `drumNoiseBurst`'s `q?: number` option (pre-existing) and `ctx._filters` from Task 5.
- Produces: `const HAT_Q = 5;` at module scope in `engine.ts`. Nothing outside the file reads it.
  Slice 4's `metal` work does not depend on it.

- [ ] **Step 1: Write the failing test**

In `src/audio/engine.test.ts`, in the same drum `describe` block:

```ts
  test('both hats run a resonant highpass; the crash and the clap keep their own Q', () => {
    const { engine, ctx } = freshEngine();

    let before = ctx._filters.length;
    engine.triggerDrum('hihat', 1.0);
    // The resonant bump at the corner is the cheapest approximation of a
    // partial that white noise through one biquad can produce. 5 is the middle
    // of the sourced 4-6 band.
    expect(ctx._filters[before].Q.value).toBe(5);

    before = ctx._filters.length;
    engine.triggerDrum('openhat', 1.0);
    expect(ctx._filters[before].Q.value).toBe(5);

    // Asserted so a later edit cannot sweep the other noise voices along with
    // the hats: these two are authored values with their own reasons.
    before = ctx._filters.length;
    engine.triggerDrum('crash', 1.0);
    expect(ctx._filters[before].Q.value).toBe(0.8);

    before = ctx._filters.length;
    engine.triggerDrum('clap', 1.0);
    expect(ctx._filters[before].Q.value).toBe(1.5);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/audio/engine.test.ts -t "resonant highpass"`
Expected: FAIL — `expect(received).toBe(5)` receives `1`, `fakeParam`'s initial `value`, because
the hats pass no `q` and the engine never writes `filter.Q.value`.

- [ ] **Step 3: Add the constant**

In `src/audio/engine.ts`, directly below `OPENHAT_CHOKE_RELEASE`:

```ts
/**
 * The hats' highpass resonance. A highpass at Q 4-6 has a resonant bump at the
 * corner, which is the cheapest available approximation of a partial over white
 * noise — hats-and-cymbals.md §5.1 ranks it the highest value-per-line change
 * in that document. 5 is the middle of that band.
 *
 * Hardcoded on purpose (ruling R7): it is one number until a later slice has a
 * reason to make it thirteen. The crash (0.8) and the clap (1.5) keep their own
 * authored values at their call sites.
 */
const HAT_Q = 5;
```

- [ ] **Step 4: Pass it from the two hat cases**

Add `q: HAT_Q` to both `drumNoiseBurst` calls:

```ts
      case 'hihat': {
        const h = k.hihat;
        this.chokeHats(now, HIHAT_CHOKE_RELEASE);
        const hat = this.drumNoiseBurst({
          filterType: 'highpass', freq: h.filter, q: HAT_Q, topCut: h.topCut,
          peak: v * h.gain, decay: h.decay, t: now,
        });
        this.registerHatVoice('hihat', [hat.env], [hat.noise], hat.stopAt);
        break;
      }
      case 'openhat': {
        // No delay tap: drums bypass delay and distortion entirely. The old
        // unconditional gain.connect(delayNode) here was a stray with no kit
        // parameter behind it.
        const h = k.openhat;
        this.chokeHats(now, OPENHAT_CHOKE_RELEASE);
        const hat = this.drumNoiseBurst({
          filterType: 'highpass', freq: h.filter, q: HAT_Q, topCut: h.topCut,
          peak: v * h.gain, decay: h.decay, t: now,
        });
        this.registerHatVoice('openhat', [hat.env], [hat.noise], hat.stopAt);
        break;
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/audio/engine.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the gate**

Run: `bun run verify`
Expected: all six stages pass, eslint at zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/audio/engine.ts src/audio/engine.test.ts
git commit -m "$(cat <<'EOF'
feat(audio): give the hats a resonant highpass

drumNoiseBurst has always taken a q; the crash passes 0.8, the clap 1.5, and
the hats passed nothing and ran at the browser default of 1. A highpass at
Q 4-6 has a resonant bump at the corner, which is the cheapest available
approximation of a partial over white noise -- the research ranks it the
highest value-per-line change in the whole hats-and-cymbals document.

One constant, not a kit field: it is one number until a later slice has a
reason to make it thirteen. The crash and clap values are now asserted so a
later edit cannot sweep them along with the hats.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

## Task 7: The slice 3 listening checklist and the gate

Spec decisions 39 and 42. **`bun run verify` proves nothing broke and that the values differ. It
cannot tell you that a hi-hat sounds like a hi-hat.** Every change in this slice is a change to
timbre, and there is no assertion whose passing means anything about the sound. This checklist is
a **human gate of equal weight to `bun run verify`**, and the slice is not done until it has been
worked through.

**Every step below is executed by a person, at the app, with the sound on.** Record the answer to
each question — including "no" — in the branch's working notes or the PR description. A "no" here
is a finding, not a failure to be fixed on the spot.

**Files:** none — this task changes no code. Its deliverable is a recorded set of answers and a
green gate.

**Interfaces:**
- Consumes: everything Tasks 1–6 produced.
- Produces: the recorded listening findings, and the `report:drums-diff` output that the slice's
  final commit message quotes.

- [ ] **Step 1: Note the baseline commit before you start**

Run: `git log --oneline -1 <the commit before Task 1's>` and write the short SHA down. It is the
argument Step 12 needs. If the branch has not moved since, it is the SHA that `git rev-parse
--short HEAD` printed before Task 1 — on the tree this plan was written against, `65b5028`.

- [ ] **Step 2: Start the app**

Run: `bun run dev`
Open `http://localhost:3000` and **click once anywhere** — the `AudioContext` is created on the
first user gesture, and every engine setter no-ops until then.

- [ ] **Step 3: Hear the choke — the open hat is cut, and it does not click**

Go to the **Sequencer** tab. Load a grid that plays both hat rows (24 of them do — `synthwave`,
`trap`, `boom-bap`, `cyberpunk`, `dnb` and `dubstep` are among them) and press play.

Question 1: **does an open hat now stop when the next closed hat lands, instead of ringing
through it?** That is the single most recognisable "this is a drum machine and it grooves"
behaviour.

Question 2: **is there a click, tick or pop at the moment of the cut?** There must not be. If
there is, the release is too short — the fix is inside 10–60 ms, never a jump to zero.

- [ ] **Step 4: Hear the choke on 16ths, where it earns its keep**

Raise the tempo to ~140 BPM on a grid with 16th-note hats.

Question 3: **do open hats stop piling up on each other?** Before this slice, overlapping open
hats accumulated into a wash. Question 4: **does the groove survive it, or has the pattern lost
something it was relying on?**

- [ ] **Step 5: The decision-25 test — `Warehouse` against the 909 kit, back to back**

This is decision 42's named slice-3 bullet, and it is the one step whose negative result is a
recorded outcome rather than a bug.

Pick **one** grid and leave it playing. Using the kit selector in `SequencerView`, switch between
`Warehouse` and **`909 Modern`** — the two kits the identity research measured as twins — several
times without changing anything else.

Question 5: **are they still the same kit?**

- If they are clearly different now, the kick send did its job: `Warehouse`'s defining trait is a
  dense low-passed reverb fed from the kick, and that is what it just gained.
- **If they still sound the same, that is a legitimate outcome and it is a finding: decision 25
  did not land the way its research predicted.** Record it in those words. Do not respond by
  raising `Warehouse`'s send until it is different — the research's claim was that routing, not
  level, is the difference, and a louder send would only disguise a failed prediction.

**Note on the name:** the kit is called `909 Modern` today. Slice 4 renames it (`Club Standard`,
ruling R4). Use the name in the selector.

- [ ] **Step 6: The second beneficiary — `Acoustic Studio` has a room**

Same grid, switch to `Acoustic Studio`.

Question 6: **is there a room around the kick and the toms now?** Play a tom fill from the drum
pads (`Acoustic Studio` has the longest tom in the library and the highest tom send, 0.50).

- [ ] **Step 7: The dry end still reads as dry**

Switch to `Tight Pocket` (the driest kit: kick 0.05, tom 0.08) and then to `Trap Beat`.

Question 7: **is the kick still tight and forward, not washed?** If the driest kits now sound wet,
the whole send scale is too high and the table moves down together, not one kit at a time.

- [ ] **Step 8: The topCut question — is the lo-fi hat finally dark?**

Play a 16th-hat grid and switch between **`Lo-Fi Vinyl`**, **`Tight Pocket`** and
**`Chrome Pulse`**.

Question 8: **is `Lo-Fi Vinyl` now among the darkest hats instead of the brightest?** Slice 1's
checklist asked the inverse question and expected "no, it is still the brightest" — confirming
that was how we knew `topCut` was needed rather than a nicety. This is that question's answer.

Question 9: **is `Chrome Pulse` audibly the brightest hat in the set?** It has the widest band by
design (18000 / 8800) and nothing to be faithful to.

Question 10: **do the four kit groups that share a hat now sound different from each other?**
After slice 1, `Chrome Pulse` / `Velocity Breaks` / `Warehouse` shared `8800 / 0.022 / 0.34`,
`Retro Drive` shared one with `Acoustic Studio`, `808 Vintage` with `Warm Riddim`, and
`Tight Pocket` with `Lo-Fi Vinyl`. `topCut` is the axis that was supposed to separate them. If a
pair still collapses, name the pair.

- [ ] **Step 9: The `q` question — "tss" or "shh"?**

Same grids, listening to the closed hat alone (mute the other tracks).

Question 11: **does the hat read as a "tss"/"chick" rather than a "shh"?** Q 5 puts a resonant
bump at the corner, which is the cheapest stand-in for a partial.

Question 12: **does any kit's hat now whistle, ring at a pitch, or sound like a tuned tone?** If
one does, `HAT_Q` moves **inside the sourced 4–6 band** — try 4 — and never outside it. A hat that
whistles is Q too high; a hat back to "shh" is Q too low.

- [ ] **Step 10: Press all eight vibe chips and roll the dice on each**

Decision 42's "throughout" bullet. Every vibe names a `soundKit`, and all four changes in this
slice alter how those kits sound.

Question 13: **does any vibe now sound wrong in a way slice 2 did not leave it?**

- [ ] **Step 11: Judge the twenty-six unsourced numbers, and record the verdict as a finding**

**Of the 26 new values this slice authors, only four have a source.** `drum-kit-identities.md` §6
names 808 and LinnDrum at ~12 kHz and the 909 at ~15 kHz for `topCut`, §2 names 7–8 kHz for
`Lo-Fi Vinyl`, and the research says `Warehouse` must have the library's wettest kick — it gives
**no per-kit send figures at all**. Every other number in Tasks 4 and 5 is engineering judgement
with a written reason, and this step is where a human overrules it.

Go through the kits in the selector, one at a time, on the same grid.

Question 14: **is any kit's kick or tom too wet — washed, smeared, or losing its front edge?**
Name the kit and say "too wet".

Question 15: **is any kit's kick or tom too dry — flat, small, or disconnected from the rest of
the kit?** Name the kit and say "too dry".

Question 16: **is any kit's hat band too narrow — thin, whistly, or gone?** Name the kit.

**"This send is too wet" and "this band is too narrow" are recordable findings, not failures of
the slice.** The plan committed a starting point, on purpose, because thirteen kits cannot be
tuned from a document. Write the kit name and the direction; changing the number is a one-line
follow-up commit against a table, and the four sourced anchors are the only values that need a
reason to move.

- [ ] **Step 12: Run the gate**

Run: `bun run verify`
Expected: all six stages pass, eslint reporting **zero errors** and no new warnings.

- [ ] **Step 13: Run the value report and read it**

Run: `bun run report:drums-diff <the SHA from Step 1>`
Expected: a `DRUM_KITS` section showing, for all 13 kits, `kick.reverbSend`, `tom.reverbSend`,
`hihat.topCut` and `openhat.topCut` going from `-` to their authored values, each tagged `[kit]`,
and **no other parameter changing**. Anything else in that output is a value this slice touched by
accident — that is what the report is for. No row should read `[inherited]`: this slice changes
`DEFAULT_DRUM_KIT` only for the two new fields, and every kit overrides both.

Keep the output: it is quoted in the closing commit message.

- [ ] **Step 14: Commit the record**

If Steps 3–11 produced no code change, this commit is the checklist's answers alone.

```bash
git commit --allow-empty -m "$(cat <<'EOF'
docs: record the slice 3 listening pass

A green gate proves nothing broke and that the values differ. It cannot tell
us that a hi-hat sounds like a hi-hat, and every change in this slice is a
change to timbre. The answers to the sixteen listening questions, including
the decision-25 verdict on Warehouse against 909 Modern and the per-kit
verdict on the 26 values the research did not supply, are recorded on the
branch.

report:drums-diff over the slice: kick.reverbSend, tom.reverbSend,
hihat.topCut and openhat.topCut appear in all 13 kits and nothing else moved.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

## Self-review

**1. Spec coverage.**

| spec item | task |
|---|---|
| Decision 25 — `reverbSend` on `KickParams` / `TomParams` | Task 4 |
| Decision 26 — `topCut` on `HatParams` | Task 5 |
| Decision 27 — pass `q` to the hats | Task 6 |
| Decision 28 / decision 9 — the choke group, its table and its three constraints | Task 3 |
| Decision 28's prerequisite (decision 20 landed) | verified in "Measured corrections" item 2 |
| Decision 39 — the listening checklist is a human gate of equal weight | Task 7 |
| Decision 40.2 — one `DRUM_TYPES` list, with the `keyof DrumKit` assertion | Task 1 |
| Decision 40.3 — the first authoring pass runs against a check that can fail | Task 4 Steps 3–7 and Task 5 Steps 4–8, in that order: field + default only, then the `spread()` entry, then `check:drums` **observed failing** with `max == min`, then the thirteen values, then `check:drums` observed passing. The only deviation is that the spread and the values **ship in one commit** rather than two — the intermediate state does not type-check (a required field the kit literals do not yet carry), so it is not a commit anyone should be able to land on. |
| Decision 42 — the slice-3 bullet (`Warehouse` vs the 909 kit) | Task 7 Step 5, with the negative outcome named |
| Decision 43 / ruling R10 — `report:drums-diff` covers kit values; required baseline | Task 2 |
| Non-goals — `clickType`, `attack`, `delaySend`, an envelope on the send, `trackPitch`, distortion, `metal` | none. No task adds any of them. The kick click deliberately stays dry (Task 4 Step 5) rather than gaining an envelope. |

Not covered by any task, correctly: decisions 29–38 and 41 (slice 4), decisions 13–24 (slices 1
and 2, landed).

**2. Placeholder scan.** No `TBD`, no "similar to Task N", no "add appropriate error handling", no
"write tests for the above". Every code step carries the code. Every one of the 13 kits has a
literal number for each of the four new values. Every count and current value came from a command
shown inline.

**3. Type consistency.**
- `DRUM_TYPES` / `DrumType` — declared once (Task 1), spelled the same in Tasks 1 and in the
  slice-4 contract block.
- `reverbSend` — the same name on `KickParams`, `TomParams`, `drumTone`'s options and
  `wireDrumVoice`'s existing parameter. Not optional on the interfaces; optional on `drumTone`'s
  option object, which is correct: the click and the snare body deliberately pass none.
- `topCut` — the same name on `HatParams` and on `drumNoiseBurst`'s option. Optional on the
  option object (the clap, snare and crash pass none), required on the interface.
- `drumNoiseBurst`'s return type `{ env: GainNode; noise: AudioBufferSourceNode; stopAt: number }`
  is written identically in Task 3's Interfaces block, its Step 5, and the `soundingHats` field's
  value type.
- `registerHatVoice(name, envs, sources, stopAt)`, `chokeHats(now, release)`, `SoundingHat`,
  `HIHAT_CHOKE_RELEASE`, `OPENHAT_CHOKE_RELEASE`, `HAT_Q`, `soundingHats`, `_filters` — each
  defined in exactly one task and referenced by the same name
  everywhere after.
- Task 5 and Task 6 both edit the same two `case` blocks. Task 6's Step 4 shows the blocks **as
  they stand after Task 5**, including `topCut`, so an implementer reading Task 6 alone does not
  delete Task 5's work.
