# Drum Slice 2 — Data Corrections That Need No New Voice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the drum library's authored *data* — hats that ask one instrument to be open and closed at once, clap rows that duplicate a snare in genres that have no clap, a `bass` row nothing can play, four grids pointed at the wrong machine — and add the one kit those grids need, without touching a voice, an engine file, or a migration.

**Architecture:** Everything here is a literal table under `src/data/` (`drumGrids.ts`, `drumKits.ts`, `vibes.ts`) plus the tests that guard those tables and the golden fixture that pins what the eight Instant Vibes resolve to. Three of the five tasks are mechanical edits driven by a new invariant test; two add a table entry and a guard. No file outside `src/data/`, `src/data/*.test.ts`, `src/store/vibes.test.ts`, `src/store/instantVibesDrums*.ts` and one comment in `scripts/check-drum-kit-separation.ts` is touched.

**Tech Stack:** TypeScript, Bun test runner, Vite/React app, eslint with the four-layer `no-restricted-imports` matrix, `bun run verify` as the gate.

**Spec:** `docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md` — slice 2 is decisions 20–24, bound by the cross-slice contract (decisions 1–12) and the verification requirements (39–43). Decision 3's `bass` deletion and decision 5's vibe repoints land here because decisions 23 and 24 place them here.

**Evidence:** `docs/research/2026-09-06-genre-drum-voice-selection.md` (§2 clap verdicts, §4 kit fit) and `docs/research/2026-09-06-drum-kit-identities.md` (§4 Gap 1, the `Dusty Break` parameter set). Every per-grid and per-kit specific either research document supplies is copied into the task that needs it, so no implementer has to go looking.

---

## Global Constraints

Every task's requirements implicitly include this section.

**Layering and purity — `src/data/**` (CLAUDE.md, and `src/data/dataLayerPurity.test.ts` enforces it through eslint's own API):**

- `src/data/` **imports nothing at runtime, not even a sibling in `src/data/`.** `import type` from anywhere is fine.
- It **reads no impure global** (`Math`, `Date`, `crypto`, …), **declares no function**, **constructs no object with `new`**, and **holds no module-scope `let`/`var`**.
- Everything slice 2 edits under `src/data/` is a literal table. Adding a grid, a kit or a vibe stays *an edit to that table and nothing else.*

**The gate — as the last step of every task:**

- `bun run verify` (test + `tsc --noEmit` + eslint + `check:keys` + `check:drums` + build).
- **eslint reports zero errors.** Warnings are tolerated; errors are not.
- Faster inner loops while working: `bun test src/data/drumGrids.test.ts`, `bun test src/store/instantVibesDrums.test.ts`, `bun test src/store/vibes.test.ts`, `bun run check:drums`.

**Measure by evaluating, never by grepping (spec, "Evidence base"):**

- Every count in this plan — 30 grids, 18 colliding grids, 33 colliding steps, 14 clap/snare duplicates, 23 `bass` rows — was re-derived on branch `refactor/data-layer-extraction` with `bun -e` against `src/data/*.ts` before it was written down. **Re-derive each one yourself with the command the task gives before you edit anything.** A documented past incident on this repo put a grep-derived count into a spec; a `grep -c` over a table of boolean literals answers a different question from the one being asked.
- If your measurement disagrees with this plan's number, **stop and report the disagreement.** Do not adjust the plan's number silently and do not adjust the data to match the plan.

**The golden fixtures will move, and every movement must be justified:**

- `src/store/instantVibesDrumsFixture.ts` pins every vibe's resolved drum rows. De-colliding hats and dropping clap/snare/`bass` rows changes what vibes resolve to, so **fixture updates are expected in Tasks 1, 2 and 3** and each task states exactly which vibe, which row and which step indices may move.
- **An unexplained fixture movement means something was edited that the task did not authorise.** Stop and report it. Do not update the fixture to make the test green.

**Slice 2 must NOT touch** (these are slices 3 and 4): the voice roster or any new voice; `DRUM_ALIASES`; `INITIAL_SEQUENCER_TRACKS` or any sequencer track; `src/audio/engine.ts`; track colours or `--color-drum-*`; **any migration or version constant** (`version` in `store/store.ts`, `PROJECT_FORMAT_VERSION`, `migrate`, `migrateProjectBody`); and **any kit *name*.**

**Four controller decisions made after the spec was written. They are binding, and they are applied by this plan:**

1. **`ambient-sparse-drift` moves from `Warehouse` to `Acoustic Studio`, and `deep-ambient`'s `soundKit` moves with it.** This settles the spec's open question 3. Reason: `Warehouse` has the shortest decays in the library (`genre-drum-voice-selection.md` §4) and the research recommends `Acoustic Studio` (crash 1.7 s, tom 0.45 s decay) for ambient. This *overrides* decision 5's repoint of `deep-ambient` to `Warehouse`: the vibe goes to `Acoustic Studio`.
2. **`909 Modern` is renamed to `Club Standard` — but NOT in this slice. It is deferred to slice 4.** Kit names are the persisted key (`loop.soundKit`), so a rename is a persist migration *and* a `.solna` `migrateProjectBody` step. Everything else in slice 2 is data under `src/data/` and needs no migration at all. Batching the rename with slice 4's voice-roster migration bumps each version once instead of twice. **Slice 2 therefore renames no kit and touches no migration or version constant.** A reviewer who notices the rename is missing is looking at a deliberate deferral, not an omission — `cyber-edm` is repointed to the *current* name `'909 Modern'` in Task 5 and moves again in slice 4.
3. **Adding `Dusty Break` needs no migration.** A new key in `DRUM_KITS` is additive; nothing persisted refers to it yet.
4. **Repointing a vibe's `soundKit` is not a migration either.** Vibes are data resolved at apply time by `resolveVibe`/`applyVibeToStore`; a user's persisted `loop.soundKit` keeps whatever they had.

**A green gate cannot judge whether drums sound right (decision 39).** `bun run verify` proves nothing broke and that rows differ. It cannot tell you the groove survived. The **listening checklist at the end of this plan is a human gate of equal weight** (decision 42) and is executed as numbered steps, not skimmed as a closing note.

**Commit trailers.** Every commit message in this plan ends with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
```

---

### Task 1: De-collide `hihat` and `openhat` across 18 grids (decision 20)

One hi-hat cannot be open and closed on the same step. Measured: **33 steps in 18 of the 30 grids** have both rows true. The sources these grids were transcribed from meant a single instrument — "16th hats with an open on the offbeat" means the open *replaces* the closed on that step — so this is a **transcription correction, and every grid's `provenance` stays valid.** Nothing here re-interprets a source, so no `provenance` string changes.

**This must land before slice 3's choke group (decisions 12, 28).** After the choke, a colliding step becomes an open hat killed instantly by its own closed hat: those 33 steps would sound *worse* than they do today. This is the one ordering constraint in the whole spec that produces a worse-sounding app if violated.

**Files:**
- Modify: `src/data/drumGrids.ts` (the `hihat` row of 18 entries)
- Modify: `src/data/drumGrids.test.ts` (add the invariant test)
- Modify: `src/store/instantVibesDrumsFixture.ts` (7 of 8 vibes' `hihat` rows)

**Interfaces:**
- Consumes: `DRUM_GRIDS: Record<string, DrumGrid>` from `src/data/drumGrids.ts`, where `DrumGrid.rows` is `Record<string, boolean[]>`; `ALL_IDS: string[]` (the 30 ids, already defined in `src/data/drumGrids.test.ts`); `ORIGINAL_VIBE_DRUM_PATTERNS: Record<string, Record<string, boolean[]>>` from `src/store/instantVibesDrumsFixture.ts`.
- Produces: no new export. A permanent invariant in `drumGrids.test.ts`: **for every grid and every step, `rows.openhat[i] && rows.hihat[i]` is never true.** Tasks 2–5 must keep it green.

- [ ] **Step 1: Re-measure the collision, before editing anything**

Run exactly this and keep the output — it is the task's work list and the commit message quotes its totals:

```bash
bun -e '
import { DRUM_GRIDS } from "./src/data/drumGrids";
const ids = Object.keys(DRUM_GRIDS);
let total = 0; let grids = 0;
for (const id of ids) {
  const g = DRUM_GRIDS[id];
  const h = g.rows.hihat ?? []; const o = g.rows.openhat ?? [];
  const steps = h.map((v, i) => (v && o[i] ? i : -1)).filter((i) => i >= 0);
  if (steps.length === 0) continue;
  grids += 1; total += steps.length;
  console.log(id.padEnd(26), "steps=[" + steps.join(",") + "]");
}
console.log("grids:", ids.length, "colliding grids:", grids, "colliding steps:", total);
'
```

Expected, measured on this branch: `grids: 30 colliding grids: 18 colliding steps: 33`, and this per-grid list:

| grid | `hihat` steps to flip to `false` |
|---|---|
| `synthwave` | 10 |
| `house` | 2, 6, 10, 14 |
| `dnb` | 14 |
| `dubstep` | 14 |
| `techno` | 2, 6, 10, 14 |
| `funk` | 5, 13 |
| `rock` | 14 |
| `reggae` | 14 |
| `lofi-hip-hop` | 14 |
| `lofi-half-time-brush` | 6, 14 |
| `synthwave-four-on-floor` | 2, 6, 10, 14 |
| `boombap-swung-break` | 14 |
| `zen-bamboo-pulse` | 14 |
| `waltz-brush-three` | 10 |
| `afro-six-eight-bell` | 8 |
| `techno-rolling` | 2, 6, 10, 14 |
| `funky-drummer` | 5, 13 |
| `reggae-rockers` | 14 |

If your numbers differ from 18/33 or from this table, **stop and report** — do not proceed.

- [ ] **Step 2: Write the failing invariant test**

Add this test to `src/data/drumGrids.test.ts`, inside the existing top-level `describe('DRUM_GRIDS', …)` block, immediately after the `test('every grid names a real drum kit', …)` block:

```ts
  test('no grid asks one hi-hat to be open and closed on the same step', () => {
    // A hi-hat is ONE physical instrument: the closure is the damping. Where an
    // open hat sounds, the closed hat is off. "16th hats with an open on the
    // offbeat" means the open REPLACES the closed on that step — writing both
    // rows true was our transcription artefact, not what any source said.
    //
    // This is also a prerequisite for the choke group (spec decision 28): with
    // the choke in place, a colliding step is an open hat killed instantly by
    // its own closed hat, which sounds worse than today's doubled hit.
    const collisions: string[] = [];
    for (const id of ALL_IDS) {
      const hihat = DRUM_GRIDS[id].rows.hihat ?? [];
      const openhat = DRUM_GRIDS[id].rows.openhat ?? [];
      for (let i = 0; i < openhat.length; i++) {
        if (openhat[i] && hihat[i]) collisions.push(`${id}:${i}`);
      }
    }
    expect(collisions).toEqual([]);
  });
```

- [ ] **Step 3: Run it and see it fail with the expected message**

Run: `bun test src/data/drumGrids.test.ts -t "open and closed on the same step"`

Expected: FAIL. The diff lists **33** entries, opening with `"synthwave:10"`, `"house:2"`, `"house:6"`, `"house:10"`, `"house:14"`, and ending with `"reggae-rockers:14"`. If the failure lists a different count, stop and report.

- [ ] **Step 4: Flip the 18 grids' colliding `hihat` cells to `false`**

In `src/data/drumGrids.ts`, for each grid in Step 1's table, change **only** the `hihat` row, and only at the listed indices, from `true` to `false`. Rows are written one line per row with the cells in step order, so index *n* is the *n*-th `true`/`false` on that line counting from 0.

Do not touch `openhat`. Do not touch any other row. Do not touch `provenance` — the source is unchanged; only our transcription of it is corrected.

Worked example — `techno-rolling`'s `hihat` line is all-`true` 16ths and becomes:

```ts
      hihat:   [true, true, false, true, true, true, false, true, true, true, false, true, true, true, false, true],
```

(indices 2, 6, 10 and 14 are now `false`; its `openhat` line stays `[…]` true at exactly those four.)

Worked example — `funky-drummer`'s `hihat` line becomes:

```ts
      hihat:   [true, true, true, true, true, false, true, true, true, true, true, true, true, false, true, true],
```

(indices 5 and 13 are now `false`, matching its `openhat 5,13`.)

- [ ] **Step 5: Run the invariant test and see it pass**

Run: `bun test src/data/drumGrids.test.ts -t "open and closed on the same step"`

Expected: PASS.

- [ ] **Step 6: Run the whole grid + fixture suite and read what else moved**

Run: `bun test src/data/drumGrids.test.ts src/store/instantVibesDrums.test.ts`

Expected failures, and **only** these:

1. `src/data/drumGrids.test.ts` → `techno-rolling is four-on-the-floor under rolling 16ths, offbeat opens` — asserts `on('techno-rolling','hihat')` equals all sixteen.
2. `src/data/drumGrids.test.ts` → `funky-drummer is the Stubblefield kick with 16th hats opening on the e of 2 and 4` — same, all sixteen.
3. `src/store/instantVibesDrums.test.ts` → `matches the drum pattern every vibe resolves to` and `resolving drumGridId reproduces the captured pattern byte-for-byte`.

Any other failure means something outside this task was edited. Stop and report.

- [ ] **Step 7: Correct the two sourced-variant transcription assertions**

Both tests pinned a hi-hat row that the source never meant. In `src/data/drumGrids.test.ts`, inside `describe('the nine sourced variants transcribe one source each', …)`:

Replace the `techno-rolling` hi-hat assertion:

```ts
    // ALL_SIXTEEN minus the four offbeats the open hat takes: the source's
    // "rolling 16ths with an offbeat open" is one hi-hat, so the open REPLACES
    // the closed on 2, 6, 10 and 14 (spec decision 20).
    expect(on('techno-rolling', 'hihat')).toEqual([0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15]);
```

Replace the `funky-drummer` hi-hat assertion:

```ts
    // ALL_SIXTEEN minus 5 and 13, where the source opens the hat (spec
    // decision 20): one hand, one hi-hat, so the open replaces the closed.
    expect(on('funky-drummer', 'hihat')).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 14, 15]);
```

Leave `ALL_SIXTEEN` and `STRAIGHT_EIGHTHS` defined — other tests in that block still use them.

- [ ] **Step 8: Update the golden fixture, one authorised change at a time**

`src/store/instantVibesDrumsFixture.ts` pins each vibe's resolved rows. **Exactly these `hihat` cells may change, and nothing else in the file may change:**

| vibe id | its grid | `hihat` indices that become `false` |
|---|---|---|
| `lofi-chill` | `lofi-half-time-brush` | 6, 14 |
| `synthwave-80s` | `synthwave-four-on-floor` | 2, 6, 10, 14 |
| `cyber-edm` | `house` | 2, 6, 10, 14 |
| `deep-ambient` | `ambient-sparse-drift` | **none — this vibe does not change in this task** |
| `boom-bap` | `boombap-swung-break` | 14 |
| `zen-garden` | `zen-bamboo-pulse` | 14 |
| `lofi-waltz` | `waltz-brush-three` | 10 |
| `afro-six-eight` | `afro-six-eight-bell` | 8 |

Edit those cells by hand. Then verify the fixture is exactly the library, and that nothing but `hihat` moved:

```bash
bun -e '
import { VIBES } from "./src/data/vibes";
import { resolveVibe } from "./src/store/vibes";
import { ORIGINAL_VIBE_DRUM_PATTERNS as F } from "./src/store/instantVibesDrumsFixture";
for (const spec of VIBES) {
  const live = resolveVibe(spec).drumPattern;
  const pinned = F[spec.id];
  for (const row of new Set([...Object.keys(live), ...Object.keys(pinned ?? {})])) {
    const a = JSON.stringify(live[row]); const b = JSON.stringify(pinned?.[row]);
    if (a !== b) console.log("DIFF", spec.id, row, "live=", a, "pinned=", b);
  }
}
console.log("compared", VIBES.length, "vibes");
'
```

Expected: `compared 8 vibes` and no `DIFF` line. A `DIFF` on any row other than `hihat` means an unauthorised edit — stop and report.

- [ ] **Step 9: Run the gate**

Run: `bun run verify`

Expected: all tests pass, `tsc --noEmit` clean, **eslint zero errors**, `check:keys` and `check:drums` pass, build succeeds.

- [ ] **Step 10: Produce the row-diff report for the reviewer (decision 43)**

Run: `bun run report:drums-diff`

It always exits 0 — it reports row changes, it does not assert. Read it and confirm every reported row change is a `hihat` row in one of the 18 grids from Step 1. Quote its summary line in the commit message.

- [ ] **Step 11: Commit**

```bash
git add src/data/drumGrids.ts src/data/drumGrids.test.ts src/store/instantVibesDrumsFixture.ts
git commit -m "$(cat <<'EOF'
fix(data): de-collide hihat and openhat in 18 drum grids

One hi-hat cannot be open and closed on the same step. Measured on this
branch: 33 steps across 18 of the 30 grids had both rows true. Where an
open hat sounds, the closed hat is now off — the sources meant a single
instrument, so this is a transcription correction and every grid's
provenance stays valid.

Lands before the choke group (spec decision 28): with the choke in place
first, a colliding step becomes an open hat killed instantly by its own
closed hat, which would sound worse than the doubled hit does today.

Adds the permanent invariant test, corrects the two sourced-variant
hi-hat assertions that pinned all sixteen 16ths, and moves seven of the
eight golden vibe fixtures on the hihat row only.

Spec: docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md (decision 20)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 2: Optional rows — three row tests become one, and the `bass` row goes (decisions 10, 23, 3)

Decision 10: **a grid may omit a voice.** This is already correct *behaviour* — Part 1 made `replaceDrumPattern` (`src/store/sequencerSlice.ts:36`) clear any track the incoming pattern does not name, so an omitted row and an all-false row are identical in effect. Optional rows are therefore a **documentation and test change, not a behaviour change.**

The tests move with it. Measured, `src/data/drumGrids.test.ts` has **three** row-shape tests — `the sequencer genre grids define all seven of their rows, and only house has an eighth`, `the vibe grids define all seven of their rows and nothing else`, and `the sourced variants define all seven genre rows and nothing else` — plus an `EXTRA_ROWS` exception table carrying `house: ['crash']`. **All three collapse into one assertion: a grid declares only known voice names.** `EXTRA_ROWS` is deleted with them; it describes an exception to a rule that no longer exists.

Decision 23 places decision 3's **`bass` row deletion** here, in the same change: `bass` is not a drum voice — no `DrumKit` field, no `triggerDrum` case, no sequencer track — and it could never sound. Deleting it is what first *needs* the relaxed test, so the test relaxation lands first inside this task and the suite is never red between them.

What is **not** relaxed: the head comment's authoring guidance at `src/data/drumGrids.ts` — *"write every row your origin group defines anyway, even where the source is silent"* — stays. Omission becomes legal; it does not become the recommended way to say "silent". **A row of `false` states that the genre plays nothing there; an omitted row states that the question was not asked.**

**Files:**
- Modify: `src/data/drumGrids.test.ts` (replace three tests + `GENRE_ROWS`/`VIBE_ROWS`/`EXTRA_ROWS` with one test + one guard-the-guard test)
- Modify: `src/data/drumGrids.ts` (delete the `bass:` line from 23 entries; rewrite one head-comment paragraph)
- Modify: `src/store/instantVibesDrums.test.ts` (delete its `EXTRA_ROWS` table)
- Modify: `src/store/instantVibesDrumsFixture.ts` (delete `cyber-edm`'s `bass` row; rewrite one docblock sentence)

**Interfaces:**
- Consumes: `DRUM_GRIDS`, `ALL_IDS` (as Task 1); `ORIGINAL_VIBE_DRUM_PATTERNS` (as Task 1).
- Produces: in `src/data/drumGrids.test.ts`, the test-local constant `KNOWN_ROW_NAMES: string[]` = `['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash']` and the test-local helper `unknownRows(rows: Record<string, boolean[]>): string[]`. Tasks 3–5 rely on `KNOWN_ROW_NAMES` existing and on the invariant **a grid declares only these names, and may omit any of them.** After this task **no grid has a `bass` row**, so Task 3's clap edits and Task 4's kit moves never see one.

- [ ] **Step 1: Re-measure the `bass` rows before deleting them**

```bash
bun -e '
import { DRUM_GRIDS } from "./src/data/drumGrids";
const withBass = Object.entries(DRUM_GRIDS).filter(([, g]) => g.rows.bass !== undefined);
const hits = withBass.reduce((n, [, g]) => n + g.rows.bass.filter(Boolean).length, 0);
console.log("grids with a bass row:", withBass.length, "authored bass hits:", hits);
console.log(withBass.map(([id]) => id).join(", "));
'
```

Expected: **23 grids, 53 authored hits** — every grid except the seven Instant Vibe grids (`lofi-half-time-brush`, `synthwave-four-on-floor`, `ambient-sparse-drift`, `boombap-swung-break`, `zen-bamboo-pulse`, `waltz-brush-three`, `afro-six-eight-bell`). If the numbers differ, stop and report.

- [ ] **Step 2: Write the failing consolidated row test, plus the test that proves it can fail**

In `src/data/drumGrids.test.ts`, insert these two tests **immediately above** the existing `EXTRA_ROWS` declaration (they will replace it and the three tests below it in Step 4):

```ts
  // The seven voices a sequencer track can actually play today. The eleven-voice
  // roster arrives in slice 4; `bass` was never one of them — no DrumKit field,
  // no triggerDrum case, no track — which is why it is deleted rather than kept
  // as an "unplayable but authored" row.
  const KNOWN_ROW_NAMES = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'];

  const unknownRows = (rows: Record<string, boolean[]>) =>
    Object.keys(rows).filter((row) => !KNOWN_ROW_NAMES.includes(row));

  test('a grid declares only known voice names, and may omit any of them', () => {
    // ONE assertion where there were three (genre / vibe / sourced), because
    // there is now one rule: replaceDrumPattern clears every track no row names,
    // so an omitted row and an all-false row are identical in effect and the
    // row SET is no longer part of a grid's contract. What is still forbidden is
    // naming something no track can ever play.
    //
    // Omission is legal; it is not the recommended way to say "silent". A row of
    // false states the genre plays nothing there; an omitted row states the
    // question was not asked. See the authoring guidance in drumGrids.ts.
    for (const id of ALL_IDS) {
      expect(unknownRows(DRUM_GRIDS[id].rows), `${id} declares an unknown row`).toEqual([]);
      expect(Object.keys(DRUM_GRIDS[id].rows).length, `${id} declares no rows at all`).toBeGreaterThan(0);
    }
  });

  test('the row-name check can actually fail', () => {
    // Guards the guard. An assertion that has only ever seen good data is not a
    // check — this pins that an unknown name IS rejected, without putting one in
    // the shipped table.
    expect(unknownRows({ ...DRUM_GRIDS.house.rows, banjo: [] })).toEqual(['banjo']);
  });
```

- [ ] **Step 3: Run them and see the first one fail**

Run: `bun test src/data/drumGrids.test.ts -t "only known voice names"`

Expected: FAIL with `synthwave declares an unknown row` and a diff showing `["bass"]` against `[]` — the first of the 23.

Run: `bun test src/data/drumGrids.test.ts -t "can actually fail"` → PASS.

- [ ] **Step 4: Delete the three old row-shape tests and their constants**

In `src/data/drumGrids.test.ts`, delete:

- the `EXTRA_ROWS` declaration (`const EXTRA_ROWS: Record<string, string[]> = { house: ['crash'] };`) and the three-line comment above it about house's eighth row;
- `test('the sequencer genre grids define all seven of their rows, and only house has an eighth', …)`;
- `test('the vibe grids define all seven of their rows and nothing else', …)`;
- `test('the sourced variants define all seven genre rows and nothing else', …)`;
- the now-unused constants `const GENRE_ROWS = [...]` and `const VIBE_ROWS = [...]`.

Leave `GENRE_GRID_IDS`, `VIBE_GRID_IDS`, `SOURCED_GRID_IDS` and `ALL_IDS` alone — other tests use them, and the three origin groups still explain why the table looks the way it does.

Leaving an unused `const` behind is an eslint **error**, so this deletion is not optional.

- [ ] **Step 5: Delete the `bass` row from all 23 grids**

In `src/data/drumGrids.ts`, delete the whole `bass:    [...]` line from each of the 23 entries listed by Step 1 — the 14 sequencer genre grids and the 9 sourced variants. Delete nothing else from those entries.

- [ ] **Step 6: Rewrite the head comment that described the unplayable row**

In `src/data/drumGrids.ts`, replace the paragraph that begins `* NOTE — the one row nothing will ever play.` (through `* what the rhythms were written as.`) with:

```
 * NOTE — every row here plays. `INITIAL_SEQUENCER_TRACKS` has seven tracks
 * (kick, snare, hihat, openhat, clap, tom, crash) and every row below names
 * one of them. The table used to carry a `bass` row in 23 entries — 53
 * authored hits that could never sound, because `bass` is not a drum voice at
 * all: no `DRUM_KITS` field, no `triggerDrum` case, no track. It was deleted
 * rather than kept as authored intent, because a row that cannot sound is not
 * a rhythm, and `drumGrids.test.ts` now rejects any row name a track cannot
 * play.
 *
 * A grid MAY omit a voice: `replaceDrumPattern` clears every track no row
 * names, so an omitted row and an all-false row are identical in effect. That
 * does not make omission the way to say "silent" — a row of `false` states the
 * genre plays nothing there, an omitted row states the question was not asked.
```

Keep the existing `replaceDrumPattern` paragraph with its authoring guidance (*"Write every row your origin group defines anyway…"*) exactly as it is: decision 10 explicitly preserves it.

- [ ] **Step 7: Drop the fixture's `bass` exception**

In `src/store/instantVibesDrums.test.ts`, delete the `EXTRA_ROWS` table and its comment:

```ts
// cyber-edm points at house, which was repointed from edm-offbeat-pump and
// carries house's `bass` row too (bass is not a drum voice, so nothing
// plays it) — the one vibe pattern with an eighth row.
const EXTRA_ROWS: Record<string, string[]> = { 'cyber-edm': ['bass'] };
```

and simplify the two places that read it, in `test("every captured pattern is seven rows of its vibe's own bar length, in 0/1", …)`:

```ts
      expect(Object.keys(pattern).sort()).toEqual([...ROWS].sort());
      for (const row of ROWS) {
```

Leave `const ROWS = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'];` in place — after the `bass` deletion all eight vibes resolve to exactly those seven rows. Task 3 replaces `ROWS` with a per-vibe table when the clap and snare deletions make the row sets differ.

- [ ] **Step 8: Delete `cyber-edm`'s `bass` row from the golden fixture, and correct its docblock**

In `src/store/instantVibesDrumsFixture.ts`, delete the `bass: [...]` line from the `'cyber-edm'` entry — it is the only vibe that had one.

Then replace the docblock sentence that explains it. The passage currently reads `Seven vibes have seven rows; `cyber-edm` has eight, because it points at `house` (repointed there after `edm-offbeat-pump` was deleted) and so inherits `house`'s `bass` row too — silently, since `bass` is not a drum voice, nothing plays it.` Replace it with:

```
 * All eight vibes pin seven rows. `cyber-edm` used to pin an eighth: it points
 * at `house` (repointed there after `edm-offbeat-pump` was deleted) and so
 * inherited house's `bass` row, which no track could ever play. That row was
 * deleted from the library, and from here with it.
```

- [ ] **Step 9: Run the suites and see everything pass**

Run: `bun test src/data/drumGrids.test.ts src/store/instantVibesDrums.test.ts src/store/vibes.test.ts`

Expected: PASS. If `matches the drum pattern every vibe resolves to` fails on a row other than `bass`, an unauthorised edit crept in — stop and report.

- [ ] **Step 10: Confirm no grid names an unplayable row, by evaluating**

```bash
bun -e '
import { DRUM_GRIDS } from "./src/data/drumGrids";
const KNOWN = ["kick","snare","hihat","openhat","clap","tom","crash"];
const bad = Object.entries(DRUM_GRIDS).flatMap(([id, g]) =>
  Object.keys(g.rows).filter((r) => !KNOWN.includes(r)).map((r) => id + ":" + r));
console.log("grids:", Object.keys(DRUM_GRIDS).length, "unknown rows:", JSON.stringify(bad));
'
```

Expected: `grids: 30 unknown rows: []`.

- [ ] **Step 11: Run the gate**

Run: `bun run verify`

Expected: all green, **eslint zero errors** (this is where a leftover unused `GENRE_ROWS`/`VIBE_ROWS`/`EXTRA_ROWS` would show up).

- [ ] **Step 12: Commit**

```bash
git add src/data/drumGrids.ts src/data/drumGrids.test.ts src/store/instantVibesDrums.test.ts src/store/instantVibesDrumsFixture.ts
git commit -m "$(cat <<'EOF'
refactor(data): make grid rows optional and delete the unplayable bass row

Three row-shape tests (genre / vibe / sourced) plus an EXTRA_ROWS
exception table collapse into one assertion: a grid declares only known
voice names, and may omit any of them. replaceDrumPattern already clears
every track no row names, so an omitted row and an all-false row are
identical in effect — this is a test and documentation change, not a
behaviour change.

With omission legal, the `bass` row goes: measured, 23 grids and 53
authored hits that could never sound, because `bass` is not a drum voice
(no DRUM_KITS field, no triggerDrum case, no sequencer track). The test
relaxation and the deletion land together so the suite is never red
between them.

Omission does not become the way to say "silent": a row of false states
the genre plays nothing there, an omitted row states the question was
not asked. The head comment's authoring guidance stays.

Spec: docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md (decisions 3, 10, 23)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 3: Clap corrections, per genre (decision 21)

`genre-drum-voice-selection.md` §2 is the change list. Measured against it: `clap` is **byte-identical to `snare` in 14 of 30 grids**, all-false in 11, genuinely different in 5.

Of the 14 duplicates: **six are deleted outright** because the genre has no clap at all (boom bap and dnb use a sampled acoustic snare, funk and rock use a snare, Afro 6/8 uses cross-stick and bell); **two become clap-only with the snare dropped** (house and techno, where the clap carries the backbeat); **four are correct layers and stay** (trap, dubstep, synthwave, synthwave-four-on-floor). The remaining two are lo-fi judgement calls that **thin rather than delete**. The **strays on `waltz`, `waltz-brush-three` and `afro-6-8` go** — those three are not snare duplicates, they are claps in genres the research says have none.

**"Dropped" means the row is omitted** (decision 10), not written all-false. Task 2 made that legal.

**Rows already all-false are left alone.** `genre-drum-voice-selection.md` §2 marks reggae's and ambient/zen's silent claps *correct*; slice 2 changes rows whose content is wrong, and an all-false row is a legal statement that the genre plays nothing there. That is why `boombap-8th-hat` keeps an all-false clap while `boom-bap` loses the row: the first transcribes a source that has no clap hit, the second asserted two hits the genre does not play.

**Declined, and recorded rather than silently skipped:** §2's verdict column also says *"give `techno-rolling` a clap"*. This plan does **not** do that. `techno-rolling` is a sourced transcription whose own test records *"The source specifies no backbeat. Written as authored, not invented into."* Authoring clap hits the cited source does not specify would invent into a transcription, which is the discipline Part 1 established. It is left for whoever authors a *new* techno grid with a sourced clap.

**Files:**
- Modify: `src/data/drumGrids.ts` (9 grids lose `clap`, 2 lose `snare`, 2 have `clap` thinned)
- Modify: `src/data/drumGrids.test.ts` (widen `PLAYABLE` to the seven playable voices)
- Modify: `src/store/vibes.test.ts` (the `drumPattern.snare` assertion)
- Modify: `src/store/instantVibesDrums.test.ts` (`ROWS` becomes a per-vibe table)
- Modify: `src/store/instantVibesDrumsFixture.ts` (4 vibes' row sets, 1 vibe's clap steps)

**Interfaces:**
- Consumes: `KNOWN_ROW_NAMES` and the "declares only known voice names" invariant from Task 2; the hi-hat invariant from Task 1; `resolveVibe(spec: VibeSpec): ResolvedVibe` from `src/store/vibes.ts`, whose `drumPattern` is `Record<string, boolean[]>`.
- Produces: in `src/store/instantVibesDrums.test.ts`, the test-local table `FIXTURE_ROWS: Record<string, string[]>` keyed by vibe id, replacing the single `ROWS` list. In `src/data/drumGrids.test.ts`, `PLAYABLE` widens to `['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash']`. After this task, `house` and `techno` have **no `snare` row** and nine grids have **no `clap` row**.

- [ ] **Step 1: Re-measure clap against snare across the library**

```bash
bun -e '
import { DRUM_GRIDS } from "./src/data/drumGrids";
const idx = (a?: boolean[]) => (a ? a.map((v, i) => (v ? i : -1)).filter((i) => i >= 0).join(",") : "ABSENT");
let dup = 0, allFalse = 0, diff = 0;
for (const [id, g] of Object.entries(DRUM_GRIDS)) {
  const c = idx(g.rows.clap), s = idx(g.rows.snare);
  const state = g.rows.clap === undefined ? "ABSENT" : c === "" ? "ALLFALSE" : c === s ? "DUP" : "DIFF";
  if (state === "DUP") dup++; else if (state === "ALLFALSE") allFalse++; else if (state === "DIFF") diff++;
  console.log(id.padEnd(26), state.padEnd(9), "clap=[" + c + "] snare=[" + s + "]");
}
console.log("duplicate:", dup, "all-false:", allFalse, "genuinely different:", diff);
'
```

Expected: `duplicate: 14 all-false: 11 genuinely different: 5`. The five different ones are `cyberpunk`, `waltz`, `afro-6-8`, `waltz-brush-three`, `trap-quarter-hat`. If your counts differ, stop and report.

- [ ] **Step 2: Write the failing per-genre clap test**

Add to `src/data/drumGrids.test.ts`, inside the top-level `describe('DRUM_GRIDS', …)` block, after the hi-hat collision test from Task 1:

```ts
  // genre-drum-voice-selection.md §2, one line per verdict. A clap is a drum
  // machine sound; six of these genres have no drum machine in them at all, and
  // two of them have no snare — the clap IS the backbeat. Pinned per grid,
  // because "the clap row is wrong" is not a rule a sweep can state.
  const NO_CLAP_ROW = [
    'boom-bap',            // sampled acoustic snare, never a machine clap (LANDR, SP-1200)
    'boombap-swung-break', // same genre, same reason
    'dnb',                 // the Amen break is an acoustic kit (Wikipedia, Amen break)
    'funk',                // no clap (PAS, ghost-note funk)
    'rock',                // no clap (Rhythm Notes)
    'afro-six-eight-bell', // cross-stick and bell, no clap (Sunhouse, bembe)
    'afro-6-8',            // same idiom, and its clap 4,10 was a stray
    'waltz',               // jazz waltz has no clap (Drumeo); its clap 8 was a stray
    'waltz-brush-three',   // same stray, in the lo-fi waltz reading
  ];

  // House and techno: the clap carries the backbeat and the snare is the one
  // that goes (Amped Studio; Studio Brootle / Attack).
  const NO_SNARE_ROW = ['house', 'techno'];

  test('the grids whose genre has no clap do not declare a clap row', () => {
    for (const id of NO_CLAP_ROW) {
      expect(DRUM_GRIDS[id].rows.clap, `${id} must omit clap`).toBeUndefined();
    }
  });

  test('house and techno are clap-only: the clap carries the backbeat, the snare row goes', () => {
    for (const id of NO_SNARE_ROW) {
      expect(DRUM_GRIDS[id].rows.snare, `${id} must omit snare`).toBeUndefined();
      expect(DRUM_GRIDS[id].rows.clap, `${id} must keep clap`).toBeDefined();
    }
  });

  test('the two lo-fi claps are thinned to a colour, not a backbeat', () => {
    // "Snap/clap is a thin colour, never the backbeat" (Mondo Loops). Both grids
    // clapped 4 AND 12 in unison with the snare; one hit on the second backbeat
    // is the colour, and the snare keeps the beat.
    const on = (id: string) =>
      DRUM_GRIDS[id].rows.clap.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    expect(on('lofi-hip-hop')).toEqual([12]);
    expect(on('lofi-half-time-brush')).toEqual([12]);
  });

  test('the four correct clap/snare layers are left alone', () => {
    // Trap layers clap with snare (eMastered); dubstep uses the clap as the
    // high-passed top of the snare (SOS); synthwave is an LM-1 clap over a gated
    // snare (loops de la creme). These are right, and stay right.
    const same = (id: string) =>
      JSON.stringify(DRUM_GRIDS[id].rows.clap) === JSON.stringify(DRUM_GRIDS[id].rows.snare);
    for (const id of ['trap', 'dubstep', 'synthwave', 'synthwave-four-on-floor']) {
      expect(same(id), `${id} clap must still layer its snare`).toBe(true);
    }
  });
```

- [ ] **Step 3: Run them and see three of the four fail**

Run: `bun test src/data/drumGrids.test.ts -t "clap"`

Expected: `the grids whose genre has no clap do not declare a clap row` FAILS on `boom-bap must omit clap`; `house and techno are clap-only` FAILS on `house must omit snare`; `the two lo-fi claps are thinned` FAILS with `[4, 12]` against `[12]`; `the four correct clap/snare layers are left alone` PASSES.

- [ ] **Step 4: Delete the nine clap rows**

In `src/data/drumGrids.ts`, delete the entire `clap:    [...]` line from: `boom-bap`, `boombap-swung-break`, `dnb`, `funk`, `rock`, `afro-six-eight-bell`, `afro-6-8`, `waltz`, `waltz-brush-three`. Change nothing else in those entries.

- [ ] **Step 5: Delete the two snare rows**

In `src/data/drumGrids.ts`, delete the entire `snare:   [...]` line from `house` and from `techno`. Their `clap` rows stay exactly as they are (`[4, 12]` in both).

- [ ] **Step 6: Thin the two lo-fi claps**

In `src/data/drumGrids.ts`, in `lofi-hip-hop` and in `lofi-half-time-brush`, change the `clap` line so index 4 becomes `false` and index 12 stays `true`:

```ts
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, true, false, false, false],
```

Their `snare` rows are untouched and keep the backbeat.

- [ ] **Step 7: Run the four clap tests and see them pass**

Run: `bun test src/data/drumGrids.test.ts -t "clap"`

Expected: PASS, all four.

- [ ] **Step 8: Run the full grid suite and expect exactly one further failure**

Run: `bun test src/data/drumGrids.test.ts`

Expected: one failure, in `describe('what the two former tables actually share', …)` — the silent-duplicate sweep reports `funk=funky-drummer`.

**This is a real finding, and it is expected.** The sweep's `PLAYABLE` signature is the pre-`tom`/`crash` five rows (`kick, snare, hihat, openhat, clap`), and its own comment says: *"Widen this list to all seven playable voices before authoring any new grid that might create one, not after."* Measured, `funk` and `funky-drummer` were already identical on kick, snare, hihat and openhat and differed **on the clap alone** — which the sourced deletion has just removed. They still differ on `tom` (`funk` has a tom on 15; `funky-drummer` has none), so widening the signature to the seven voices the sequencer actually plays is both the fix the comment asked for and an honest one.

If the sweep reports **any pair other than `funk=funky-drummer`**, stop and report.

- [ ] **Step 9: Widen the silent-duplicate signature to the seven playable voices**

In `src/data/drumGrids.test.ts`, replace the `PLAYABLE` constant and the comment paragraph above it that begins `// PLAYABLE is still the pre-`tom`/`crash` five rows` with:

```ts
  // PLAYABLE is the seven voices a sequencer track plays today. It was the
  // pre-`tom`/`crash` five, with a note to widen it "before authoring any new
  // grid that might create one, not after" — and decision 21's sourced clap
  // deletion is exactly that moment: `funk` and `funky-drummer` differed on the
  // CLAP ALONE, so dropping funk's clap made them identical on the old
  // five-row signature. They still differ on `tom` (funk 15, funky-drummer
  // none), which is a real audible difference, so the honest fix is a wider
  // signature rather than an exception table.
  const PLAYABLE = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'];
```

- [ ] **Step 10: Run the grid suite and see it green**

Run: `bun test src/data/drumGrids.test.ts`

Expected: PASS, with no silent duplicates found.

- [ ] **Step 11: Correct the vibe assertion that requires every vibe to have a snare**

`src/store/vibes.test.ts` asserts `expect(Boolean(vibe.drumPattern.snare)).toBe(true)`. `cyber-edm` points at `house`, which no longer has a snare row — the clap carries its backbeat. Replace that single line with:

```ts
      // No `snare` assertion: `house` (cyber-edm's grid) is clap-only by
      // decision 21 — in house the clap IS the backbeat and the snare row was
      // a duplicate of it. Kick and hihat are the rows every vibe still has.
      expect(Boolean(vibe.drumPattern.kick)).toBe(true);
```

Keep the surrounding `expect(Boolean(vibe.drumPattern)).toBe(true);` and `expect(Boolean(vibe.drumPattern.hihat)).toBe(true);` lines. If a `kick` assertion already exists immediately above, do not duplicate it — keep one.

- [ ] **Step 12: Replace the fixture test's single `ROWS` list with a per-vibe table**

Four vibes now resolve to fewer than seven rows. In `src/store/instantVibesDrums.test.ts`, replace `const ROWS = ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'];` with:

```ts
// Row sets differ per vibe now that a grid may omit a voice (decision 10) and
// decision 21 has removed the clap rows genres do not play and the snare rows
// their clap replaces. Written out per vibe rather than derived, so a row
// appearing or disappearing is a diff a reviewer sees.
const FIXTURE_ROWS: Record<string, string[]> = {
  'lofi-chill': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'],
  'synthwave-80s': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'],
  'cyber-edm': ['kick', 'hihat', 'openhat', 'clap', 'tom', 'crash'], // house: clap-only
  'deep-ambient': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'],
  'boom-bap': ['kick', 'snare', 'hihat', 'openhat', 'tom', 'crash'], // no clap in boom bap
  'zen-garden': ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash'],
  'lofi-waltz': ['kick', 'snare', 'hihat', 'openhat', 'tom', 'crash'], // jazz waltz: no clap
  'afro-six-eight': ['kick', 'snare', 'hihat', 'openhat', 'tom', 'crash'], // cross-stick and bell
};
```

and rewrite the shape test that used `ROWS` so it reads the table — replace the whole `test("every captured pattern is seven rows of its vibe's own bar length, in 0/1", …)` block with:

```ts
  test("every captured pattern is its vibe's own rows at its own bar length, in booleans", () => {
    for (const id of VIBE_IDS) {
      const vibe = VIBES.find((v) => v.id === id)!;
      const expected = getMeter(vibe.meter).stepsPerBar;
      const pattern = ORIGINAL_VIBE_DRUM_PATTERNS[id];
      expect(Object.keys(pattern).sort(), id).toEqual([...FIXTURE_ROWS[id]].sort());
      for (const row of FIXTURE_ROWS[id]) {
        expect(pattern[row].length, `${id}/${row}`).toBe(expected);
        for (const cell of pattern[row]) {
          expect(typeof cell).toBe('boolean');
        }
      }
    }
  });
```

- [ ] **Step 13: Update the golden fixture, one authorised change at a time**

In `src/store/instantVibesDrumsFixture.ts`, **exactly these changes are authorised and nothing else in the file may change:**

| vibe id | its grid | authorised change |
|---|---|---|
| `lofi-chill` | `lofi-half-time-brush` | `clap` row: index 4 becomes `false` (index 12 stays `true`) |
| `synthwave-80s` | `synthwave-four-on-floor` | none |
| `cyber-edm` | `house` | delete the whole `snare` row |
| `deep-ambient` | `ambient-sparse-drift` | none |
| `boom-bap` | `boombap-swung-break` | delete the whole `clap` row |
| `zen-garden` | `zen-bamboo-pulse` | none |
| `lofi-waltz` | `waltz-brush-three` | delete the whole `clap` row |
| `afro-six-eight` | `afro-six-eight-bell` | delete the whole `clap` row |

Then re-run the comparison from Task 1 Step 8:

```bash
bun -e '
import { VIBES } from "./src/data/vibes";
import { resolveVibe } from "./src/store/vibes";
import { ORIGINAL_VIBE_DRUM_PATTERNS as F } from "./src/store/instantVibesDrumsFixture";
for (const spec of VIBES) {
  const live = resolveVibe(spec).drumPattern;
  const pinned = F[spec.id];
  for (const row of new Set([...Object.keys(live), ...Object.keys(pinned ?? {})])) {
    const a = JSON.stringify(live[row]); const b = JSON.stringify(pinned?.[row]);
    if (a !== b) console.log("DIFF", spec.id, row, "live=", a, "pinned=", b);
  }
}
console.log("compared", VIBES.length, "vibes");
'
```

Expected: `compared 8 vibes` and no `DIFF` line. Any `DIFF` outside the table above means an unauthorised edit — stop and report.

- [ ] **Step 14: Run the three suites**

Run: `bun test src/data/drumGrids.test.ts src/store/instantVibesDrums.test.ts src/store/vibes.test.ts`

Expected: PASS.

- [ ] **Step 15: Run the gate and the row-diff report**

Run: `bun run verify`, then `bun run report:drums-diff`.

Expected: verify green with **eslint zero errors**; the report lists only clap/snare row changes in the thirteen grids this task named, and exits 0.

- [ ] **Step 16: Commit**

```bash
git add src/data/drumGrids.ts src/data/drumGrids.test.ts src/store/vibes.test.ts src/store/instantVibesDrums.test.ts src/store/instantVibesDrumsFixture.ts
git commit -m "$(cat <<'EOF'
fix(data): correct the clap row per genre

genre-drum-voice-selection.md section 2 is the change list. Measured:
clap was byte-identical to snare in 14 of 30 grids, all-false in 11,
genuinely different in 5.

Nine grids lose the clap row outright — boom bap and dnb play a sampled
acoustic snare, funk and rock a snare, Afro 6/8 a cross-stick and bell,
and the claps on waltz and waltz-brush-three were strays. House and
techno become clap-only: there the clap carries the backbeat and the
snare row was its duplicate. The two lo-fi claps are thinned to one hit
as a colour. Trap, dubstep and the two synthwave grids are correct
layers and are untouched.

Dropped means omitted, not written all-false (decision 10). Rows that
were already all-false are left alone: an all-false row states the genre
plays nothing there, which is a true statement.

Widens the silent-duplicate signature from five rows to the seven the
sequencer plays, as that test's own comment instructed — funk and
funky-drummer differed on the clap alone, and still differ on tom.

Declined from the change list: giving techno-rolling a clap. It is a
sourced transcription whose source specifies no backbeat, and inventing
into a transcription is the thing Part 1's discipline forbids.

Spec: docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md (decision 21)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 4: `Dusty Break` lands, and the kit reassignments follow (decision 22, decision 5, controller decision 1)

Adding a kit is pure data. **Gap 1 in `drum-kit-identities.md` §4:** four grids point at `808 Vintage`, but boom bap's instrument is *acoustic breaks through a 12-bit SP-1200* — the opposite of a bridged-T sine. The research supplies the values, and the second effect matters as much as the first: **it frees `808 Vintage` to be an actual 808** instead of a compromise between two referents. After this task no grid names `808 Vintage`, and that is the intended outcome, not an oversight.

`afro-6-8` and `afro-six-eight-bell` stop disagreeing about their kit and both take `Acoustic Studio` (`genre-drum-voice-selection.md` §4: Warm Riddim's 4500 Hz hat is the second-darkest in the library and a bembé bell is bright and cutting).

`ambient-sparse-drift` moves from `Warehouse` to `Acoustic Studio` — **controller decision 1**, settling the spec's open question 3. `Warehouse` has the shortest decays in the library; ambient wants the wash on the cymbal, and `Acoustic Studio` is the only kit with a long crash (1.7 s) and a full-bodied tom (0.45 s decay).

**Blast radius, enumerated rather than discovered** (decision 22): two vibes name `808 Vintage` while their grids move to `Dusty Break` — `lofi-chill` (grid `lofi-half-time-brush`) and `boom-bap` (grid `boombap-swung-break`). Decision 5's convention says they move together.

**No kit is renamed here** (controller decision 2) and **no migration or version constant is touched** (controller decisions 3 and 4): a new `DRUM_KITS` key is additive, and a vibe's `soundKit` is resolved at apply time.

**Files:**
- Modify: `src/data/drumKits.ts` (append the `'Dusty Break'` entry)
- Modify: `src/data/drumKits.test.ts` (kit count 12 → 13)
- Modify: `src/data/drumGrids.ts` (the `kit` field of 6 grids)
- Modify: `src/data/drumGrids.test.ts` (pin the reassignments)
- Modify: `src/data/vibes.ts` (`soundKit` of `lofi-chill` and `boom-bap`)
- Modify: `scripts/check-drum-kit-separation.ts` (one docblock number)

**Interfaces:**
- Consumes: `DrumKit`, `DEFAULT_DRUM_KIT`, `DRUM_KITS: Record<string, Partial<DrumKit>>` from `src/data/drumKits.ts`, whose voices are `kick: KickParams`, `snare: SnareParams`, `hihat: HatParams`, `openhat: HatParams`, `clap: ClapParams`, `tom: TomParams`, `crash: CrashParams`; `mergeDrumKit(partial?: Partial<DrumKit>): DrumKit` from `src/audio/drumKits.ts` (read-only — this task does not modify it).
- Produces: a new key `'Dusty Break'` in `DRUM_KITS`, overriding **all seven** voices. `DRUM_GRIDS[id].kit` becomes `'Dusty Break'` for `boom-bap`, `boombap-swung-break`, `boombap-8th-hat`, `lofi-half-time-brush`, and `'Acoustic Studio'` for `afro-6-8` and `ambient-sparse-drift`. `VIBES` entries `lofi-chill` and `boom-bap` get `soundKit: 'Dusty Break'`. Task 5's vibe guard depends on `'Dusty Break'` being a real key by then.

- [ ] **Step 1: Re-measure the current kit assignment before changing it**

```bash
bun -e '
import { DRUM_GRIDS } from "./src/data/drumGrids";
import { DRUM_KITS } from "./src/data/drumKits";
import { VIBES } from "./src/data/vibes";
const byKit: Record<string, string[]> = {};
for (const [id, g] of Object.entries(DRUM_GRIDS)) (byKit[g.kit] ??= []).push(id);
for (const k of Object.keys(byKit).sort()) console.log(k.padEnd(18), byKit[k].join(", "));
console.log("kits in DRUM_KITS:", Object.keys(DRUM_KITS).length);
console.log("vibes naming 808 Vintage:", VIBES.filter((v) => v.soundKit === "808 Vintage").map((v) => v.id).join(", "));
'
```

Expected: **12 kits**; `808 Vintage` carries exactly `boom-bap, boombap-swung-break, lofi-half-time-brush, boombap-8th-hat`; `afro-6-8` sits on `Warm Riddim` while `afro-six-eight-bell` sits on `Acoustic Studio`; `ambient-sparse-drift` sits on `Warehouse`; and the vibes naming `808 Vintage` are `lofi-chill, boom-bap`. If any of that differs, stop and report.

- [ ] **Step 2: Write the failing kit-assignment tests**

Add to `src/data/drumGrids.test.ts`, inside the top-level `describe('DRUM_GRIDS', …)` block, after the clap tests from Task 3:

```ts
  test('the four boom-bap-family grids name Dusty Break, not 808 Vintage', () => {
    // Boom bap's instrument is acoustic breaks through a 12-bit SP-1200
    // (LANDR; Levels), the opposite of a bridged-T sine. Moving them off the
    // 808 is also what frees 808 Vintage to be an actual 808.
    for (const id of ['boom-bap', 'boombap-swung-break', 'boombap-8th-hat', 'lofi-half-time-brush']) {
      expect(DRUM_GRIDS[id].kit, id).toBe('Dusty Break');
    }
  });

  test('the two Afro 6/8 grids agree on one kit', () => {
    // They disagreed: Warm Riddim vs Acoustic Studio for the same idiom. Warm
    // Riddim's 4500 Hz hat is the second-darkest in the library and a bembe
    // bell is bright and cutting, so both take Acoustic Studio.
    expect(DRUM_GRIDS['afro-6-8'].kit).toBe('Acoustic Studio');
    expect(DRUM_GRIDS['afro-six-eight-bell'].kit).toBe('Acoustic Studio');
  });

  test('ambient-sparse-drift is on the kit with the long tails, not the techno kit', () => {
    // Warehouse has the shortest decays in the library; ambient wants the wash
    // on the cymbal, and Acoustic Studio is the only kit with a long crash
    // (1.7 s) and a full-bodied tom (0.45 s decay).
    expect(DRUM_GRIDS['ambient-sparse-drift'].kit).toBe('Acoustic Studio');
  });

  test('no grid still names 808 Vintage, which is now free to be an actual 808', () => {
    const stragglers = ALL_IDS.filter((id) => DRUM_GRIDS[id].kit === '808 Vintage');
    expect(stragglers).toEqual([]);
  });
```

And change the kit count in `src/data/drumKits.test.ts`:

```ts
  test('holds 13 kits', () => {
    expect(Object.keys(DRUM_KITS).length).toBe(13);
  });
```

- [ ] **Step 3: Run them and see them fail**

Run: `bun test src/data/drumGrids.test.ts src/data/drumKits.test.ts -t "Dusty Break"` then `bun test src/data/drumKits.test.ts`

Expected: `the four boom-bap-family grids name Dusty Break` FAILS (`boom-bap` is `'808 Vintage'`); `holds 13 kits` FAILS with `12` against `13`. The Afro and ambient tests fail on `afro-6-8` (`'Warm Riddim'`) and `ambient-sparse-drift` (`'Warehouse'`).

Note the existing test `every grid names a real drum kit` (which reads `DRUM_KITS[kit]`) is still green at this point and must stay green at every step.

- [ ] **Step 4: Add the `Dusty Break` kit**

In `src/data/drumKits.ts`, append this entry to `DRUM_KITS` after `'Lo-Fi Vinyl'` (keep the trailing `};` of the table):

```ts
  // Gap 1 in drum-kit-identities.md section 4: boom bap is acoustic breaks
  // through a 12-bit SP-1200, not a TR-808. Lo-Fi Vinyl's darkness, Acoustic
  // Studio's snare crack, a hard short kick — "boom" and "bap" are the impact,
  // which is why the kick gain is high and its decay short.
  'Dusty Break': {
    kick: { freqStart: 150, freqEnd: 52, pitchTime: 0.02, decay: 0.2, gain: 0.95, clickFreq: 2400, clickLevel: 0.3, clickDecay: 0.006 },
    snare: { bodyFreqStart: 250, bodyFreqEnd: 200, bodyTime: 0.03, bodyDecay: 0.12, bodyGain: 0.55, noiseFilter: 1800, noiseDecay: 0.18, noiseGain: 0.7, reverbSend: 0.25 },
    hihat: { filter: 6000, decay: 0.034, gain: 0.3 },
    openhat: { filter: 5200, decay: 0.22, gain: 0.34 },
    clap: { filter: 1300, decay: 0.18, gain: 0.5, reverbSend: 0.15 },
    tom: { freqStart: 128, freqEnd: 95, pitchTime: 0.06, decay: 0.3, gain: 0.7 },
    crash: { filter: 4800, decay: 1.1, gain: 0.5, reverbSend: 0.3 },
  },
```

Where each number comes from, so a later retune knows what is sourced and what is derived:

- `kick`, `snare` and `hihat` are `drum-kit-identities.md` §4 Gap 1 verbatim — `kick 150→52 / 0.20 / 0.95 + click 2400/0.30/0.006`, `snare 250/200 / 0.03 / 0.12 / 0.55, noiseFilter 1800, noiseDecay 0.18, noiseGain 0.70, send 0.25`, `hihat 6000 / 0.034 / 0.30` — **with one deliberate deviation**: the research's `pitchTime 0.04` is halved to **0.02** to satisfy slice 1's rule `pitchTime ≤ 0.1 × decay` (decision 13), which slice 1 applied to every other kit. Shipping 0.04 would make the new kit the only one in the library breaking that rule.
- `openhat`, `clap`, `tom` and `crash` are derived, not sourced: `check:drums` requires **every** kit to override **every** voice, so all seven must be authored. They are placed between `Lo-Fi Vinyl` (dark) and `Acoustic Studio` (open) — a dark-but-not-muffled open hat, a dry clap the genre never plays anyway, and a tom at `freqStart / freqEnd` ≈ 1.35 as decision 18 requires.

**If slice 1 has already added the required `reference` field to `DrumKit`** (decision 7 — check the interface in `src/data/drumKits.ts` before you write the entry; `tsc --noEmit` will tell you immediately), add this as the entry's first field:

```ts
    reference: {
      referent: 'E-mu SP-1200 sampling acoustic breaks (boom bap)',
      source: 'blog.landr.com/sp-1200/',
      reachable: 'kick and snare reachable — a hard short kick and a cracking, noisy snare are synthesis, not sampling. Hat is NOT: the SP-1200 hat is a 12-bit sample of an acoustic hi-hat and this engine has one noise burst; 6000 Hz is a stand-in for the sample bandwidth. The 12-bit aliasing that defines the machine is not modelled at all.',
    },
```

If `DrumKit` has no `reference` field yet, do not add one — an unknown property on a `Partial<DrumKit>` is a type error.

- [ ] **Step 5: Repoint the six grids' `kit` fields**

In `src/data/drumGrids.ts`, change **only** the `kit:` line of these entries:

| grid | from | to |
|---|---|---|
| `boom-bap` | `'808 Vintage'` | `'Dusty Break'` |
| `boombap-swung-break` | `'808 Vintage'` | `'Dusty Break'` |
| `boombap-8th-hat` | `'808 Vintage'` | `'Dusty Break'` |
| `lofi-half-time-brush` | `'808 Vintage'` | `'Dusty Break'` |
| `afro-6-8` | `'Warm Riddim'` | `'Acoustic Studio'` |
| `ambient-sparse-drift` | `'Warehouse'` | `'Acoustic Studio'` |

- [ ] **Step 6: Move the two vibes that name the kit their grid just left**

In `src/data/vibes.ts`, change `soundKit` on two entries:

- `lofi-chill`: `soundKit: '808 Vintage'` → `soundKit: 'Dusty Break'`
- `boom-bap`: `soundKit: '808 Vintage'` → `soundKit: 'Dusty Break'`

Both vibes' grids (`lofi-half-time-brush` and `boombap-swung-break`) moved in Step 5; decision 5's convention is that a vibe moves with its grid. Change no other field on those vibes, and no other vibe here — the three dangling `soundKit` names are Task 5.

- [ ] **Step 7: Correct the kit count in the separation script's docblock**

In `scripts/check-drum-kit-separation.ts`, change the docblock line `* Verifies that the 12 drum kits in DRUM_KITS are audibly distinguishable:` to read `13`. This is a comment only — do not change the script's logic, its `DRUM_TYPES` list or its thresholds.

- [ ] **Step 8: Run the tests and the separation check**

Run: `bun test src/data/drumGrids.test.ts src/data/drumKits.test.ts src/audio/drumKits.test.ts && bun run check:drums`

Expected: tests PASS; `check:drums` prints `PASS` for all seven `Dusty Break` voice overrides and for every spread line, and exits 0.

**If `check:drums` fails a pairwise nearest-neighbour line** (slice 1 added that check per decision 19) naming `Dusty Break` against `Lo-Fi Vinyl`, `Acoustic Studio` or `808 Vintage`: **adjust `Dusty Break`, never the check.** Move `hihat.filter` (its nearest-neighbour axis) in 250 Hz steps away from the twin, and if that is not enough, `hihat.decay` in 0.004 s steps — both stay inside "dark but not muffled", which is the kit's character. Record in the commit message which parameter moved and to what.

- [ ] **Step 9: Confirm the vibes and grids agree, by evaluating**

```bash
bun -e '
import { DRUM_GRIDS } from "./src/data/drumGrids";
import { DRUM_KITS } from "./src/data/drumKits";
import { VIBES } from "./src/data/vibes";
console.log("kits:", Object.keys(DRUM_KITS).length);
console.log("grids on 808 Vintage:", Object.entries(DRUM_GRIDS).filter(([, g]) => g.kit === "808 Vintage").length);
for (const v of VIBES) {
  const grid = DRUM_GRIDS[v.drumGridId];
  console.log(v.id.padEnd(15), "vibe=" + String(v.soundKit).padEnd(17), "grid=" + grid.kit.padEnd(17), DRUM_KITS[v.soundKit] ? "exists" : "MISSING");
}
'
```

Expected: `kits: 13`, `grids on 808 Vintage: 0`, `lofi-chill` and `boom-bap` both showing `vibe=Dusty Break grid=Dusty Break exists`. Three vibes still print `MISSING` — `cyber-edm`, `deep-ambient`, `zen-garden`. That is Task 5's job and is expected here.

- [ ] **Step 10: Run the gate**

Run: `bun run verify`

Expected: green, **eslint zero errors**. The Instant Vibes fixture must **not** move in this task — `kit` is not part of a resolved drum pattern. If `instantVibesDrums.test.ts` fails, a row was edited that this task did not authorise: stop and report.

- [ ] **Step 11: Commit**

```bash
git add src/data/drumKits.ts src/data/drumKits.test.ts src/data/drumGrids.ts src/data/drumGrids.test.ts src/data/vibes.ts scripts/check-drum-kit-separation.ts
git commit -m "$(cat <<'EOF'
feat(data): add the Dusty Break kit and correct six grid assignments

Gap 1 in drum-kit-identities.md section 4: four grids pointed at 808
Vintage, but boom bap's instrument is acoustic breaks through a 12-bit
SP-1200, the opposite of a bridged-T sine. Dusty Break is Lo-Fi Vinyl's
darkness with Acoustic Studio's snare crack and a hard short kick, and
boom-bap, boombap-swung-break, boombap-8th-hat and lofi-half-time-brush
move onto it. No grid names 808 Vintage any more, which frees it to be
an actual 808 instead of a compromise between two referents.

afro-6-8 and afro-six-eight-bell stop disagreeing and both take Acoustic
Studio. ambient-sparse-drift leaves Warehouse — the shortest decays in
the library — for Acoustic Studio's long crash and full-bodied tom,
settling the spec's open question 3.

The two vibes whose grid moved move with it: lofi-chill and boom-bap now
name Dusty Break. Adding a kit key and repointing a vibe are both
additive — no migration and no version constant is touched, and no kit
is renamed (the 909 Modern rename is deferred to slice 4, where it can
share one version bump with the voice-roster migration).

Spec: docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md (decisions 5, 22)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

### Task 5: A vibe's `soundKit` must exist (decisions 24 and 5)

Measured: three of the eight vibes name a `soundKit` that is **not a key of `DRUM_KITS`** — `cyber-edm` → `'Hyperpop 2000'`, `deep-ambient` → `'Minimal Glitch'`, `zen-garden` → `'Minimal Glitch'`. `mergeDrumKit` takes `DRUM_KITS[name]` as a `Partial<DrumKit>` and spreads it over `DEFAULT_DRUM_KIT`, so an unknown name silently yields the default kit: **three vibes ship the fallback with no error.** Today's `expect(Boolean(vibe.soundKit)).toBe(true)` passes on a name that resolves to nothing, which is how this shipped.

The fix is not an invention. **The three dangling names are repointed to the kit their own grid names**, which is the convention every working vibe already follows. **No kit is created to satisfy a dangling name** — that would be inventing a sound decision to make a typo true (decision 5, decision 6).

- `cyber-edm`'s grid is `house`, whose kit is `'909 Modern'` → the vibe takes `'909 Modern'`. **It keeps the current name**: the rename to `Club Standard` is slice 4's, batched with the voice-roster migration so each version bumps once (controller decision 2).
- `deep-ambient`'s grid is `ambient-sparse-drift`, which Task 4 moved to `'Acoustic Studio'` → the vibe takes `'Acoustic Studio'`. **This supersedes decision 5's `Warehouse`**, per controller decision 1.
- `zen-garden`'s grid is `zen-bamboo-pulse`, whose kit is `'Acoustic Studio'` → the vibe takes `'Acoustic Studio'`.

This lands in slice 2 because it is data, and because it is the last chance to fix it before slice 4's rename starts moving `soundKit` values for a different reason.

**Files:**
- Modify: `src/store/vibes.test.ts` (add the existence assertion mirroring `drumGrids.test.ts:122`)
- Modify: `src/data/vibes.ts` (`soundKit` of `cyber-edm`, `deep-ambient`, `zen-garden`)

**Interfaces:**
- Consumes: `DRUM_KITS` from `src/data/drumKits.ts` (including `'Dusty Break'` from Task 4); `VIBES` from `src/data/vibes.ts`; `resolveVibe` and `VIBE_IDS` from `src/store/vibes.ts`; `DRUM_GRIDS` from `src/data/drumGrids.ts`.
- Produces: a permanent assertion in `src/store/vibes.test.ts` — **every vibe's `soundKit` is a key of `DRUM_KITS`** — mirroring the grid guard `expect(DRUM_KITS[kit]).toBeTruthy()` at `src/data/drumGrids.test.ts:122`. No vibe field other than `soundKit` changes.

- [ ] **Step 1: Re-measure the dangling names**

```bash
bun -e '
import { VIBES } from "./src/data/vibes";
import { DRUM_KITS } from "./src/data/drumKits";
import { DRUM_GRIDS } from "./src/data/drumGrids";
for (const v of VIBES) {
  const ok = Boolean(DRUM_KITS[v.soundKit]);
  console.log(v.id.padEnd(15), String(v.soundKit).padEnd(17), ok ? "ok" : "MISSING", "grid kit=" + DRUM_GRIDS[v.drumGridId].kit);
}
console.log("dangling:", VIBES.filter((v) => !DRUM_KITS[v.soundKit]).map((v) => v.id + " -> " + v.soundKit).join(", "));
'
```

Expected: exactly three dangling — `cyber-edm -> Hyperpop 2000`, `deep-ambient -> Minimal Glitch`, `zen-garden -> Minimal Glitch` — with their grid kits printing `909 Modern`, `Acoustic Studio`, `Acoustic Studio`. If any other vibe is `MISSING`, stop and report.

- [ ] **Step 2: Write the failing existence test**

In `src/store/vibes.test.ts`, add this test inside the `describe('Instant Vibes Mode', …)` block, directly after `test('contains all 8 curated genre vibes with complete presets and feel settings', …)`. Add `import { DRUM_KITS } from '../data/drumKits';` and `import { DRUM_GRIDS } from '../data/drumGrids';` to the file's imports if they are not already there:

```ts
  test("every vibe's soundKit is a real kit", () => {
    // The sibling of drumGrids.test.ts's "every grid names a real drum kit".
    // mergeDrumKit takes DRUM_KITS[name] as a Partial<DrumKit> and spreads it
    // over DEFAULT_DRUM_KIT, so an unknown name silently yields the default
    // kit — no error, no warning, just the wrong sound. Three vibes shipped
    // that way ('Hyperpop 2000', 'Minimal Glitch' x2) because the only
    // assertion here was that soundKit is truthy.
    for (const vibe of RESOLVED_VIBES) {
      expect(DRUM_KITS[vibe.soundKit], `${vibe.id} -> ${vibe.soundKit}`).toBeTruthy();
    }
  });

  test("a vibe's soundKit agrees with its own grid's kit, or says why not", () => {
    // A vibe chooses a sound as well as a rhythm, so it MAY disagree with its
    // grid — but every disagreement is deliberate and listed here. An
    // unlisted one is a repoint that forgot its grid, which is exactly how the
    // three dangling names went unnoticed.
    const DELIBERATE_DISAGREEMENT: Record<string, string> = {};
    for (const vibe of RESOLVED_VIBES) {
      const gridKit = DRUM_GRIDS[vibe.drumGridId].kit;
      const expected = DELIBERATE_DISAGREEMENT[vibe.id] ?? gridKit;
      expect(vibe.soundKit, `${vibe.id} (grid ${vibe.drumGridId} -> ${gridKit})`).toBe(expected);
    }
  });
```

Also replace the weak assertion in the first test — change `expect(Boolean(vibe.soundKit)).toBe(true);` to:

```ts
      expect(Boolean(vibe.soundKit)).toBe(true); // existence of the KIT is asserted below
```

- [ ] **Step 3: Run them and see them fail**

Run: `bun test src/store/vibes.test.ts -t "soundKit"`

Expected: `every vibe's soundKit is a real kit` FAILS with `cyber-edm -> Hyperpop 2000` (received `undefined`); `a vibe's soundKit agrees with its own grid's kit` FAILS with `cyber-edm (grid house -> 909 Modern)`, expecting `'909 Modern'` and receiving `'Hyperpop 2000'`.

- [ ] **Step 4: Repoint the three vibes**

In `src/data/vibes.ts`, change only the `soundKit` line of three entries:

- `cyber-edm`: `soundKit: 'Hyperpop 2000'` → `soundKit: '909 Modern'`
- `deep-ambient`: `soundKit: 'Minimal Glitch'` → `soundKit: 'Acoustic Studio'`
- `zen-garden`: `soundKit: 'Minimal Glitch'` → `soundKit: 'Acoustic Studio'`

Add this comment above `cyber-edm`'s `soundKit` line so the slice-4 rename finds it:

```ts
    // Repointed from the non-existent 'Hyperpop 2000' to the kit its own grid
    // (house) names. Slice 4 renames this kit, and this line moves with it.
```

and this one above `deep-ambient`'s:

```ts
    // Repointed from the non-existent 'Minimal Glitch'. Follows its grid
    // (ambient-sparse-drift), which left Warehouse — the shortest decays in
    // the library — for the long crash and tom ambient wants.
```

- [ ] **Step 5: Run the vibe suite and see it pass**

Run: `bun test src/store/vibes.test.ts src/store/instantVibesDrums.test.ts`

Expected: PASS. The golden fixture must **not** move — `soundKit` is not part of a resolved drum pattern. If it does, something outside this task was edited: stop and report.

- [ ] **Step 6: Confirm no vibe resolves to the fallback kit**

```bash
bun -e '
import { VIBES } from "./src/data/vibes";
import { DRUM_KITS } from "./src/data/drumKits";
console.log("dangling soundKits:", VIBES.filter((v) => !DRUM_KITS[v.soundKit]).length);
console.log([...new Set(VIBES.map((v) => v.soundKit))].sort().join(" | "));
'
```

Expected: `dangling soundKits: 0`, and the distinct list `909 Modern | Acoustic Studio | Dusty Break | Lo-Fi Vinyl | Retro Drive`.

- [ ] **Step 7: Run the gate**

Run: `bun run verify`

Expected: green, **eslint zero errors**.

- [ ] **Step 8: Commit**

```bash
git add src/data/vibes.ts src/store/vibes.test.ts
git commit -m "$(cat <<'EOF'
fix(data): repoint the three vibes naming a kit that does not exist

Measured: cyber-edm named 'Hyperpop 2000' and deep-ambient and zen-garden
named 'Minimal Glitch'. Neither is a key of DRUM_KITS, and mergeDrumKit
spreads an undefined partial over DEFAULT_DRUM_KIT — so three of the
eight vibes silently shipped the fallback kit. The only guard was that
soundKit is truthy.

Each is repointed to the kit its own grid names, which is the convention
every working vibe already follows: cyber-edm to 909 Modern (its grid is
house), deep-ambient and zen-garden to Acoustic Studio. No kit is
invented to make a dangling name true.

Adds the sibling of drumGrids.test.ts's grid guard — every vibe's
soundKit is a key of DRUM_KITS — plus an assertion that a vibe agrees
with its grid's kit unless the disagreement is listed.

Spec: docs/superpowers/specs/2026-09-06-drum-voices-and-kit-fidelity-design.md (decisions 5, 24, 41)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM
EOF
)"
```

---

## The slice 2 listening checklist (decision 42)

**A green gate cannot judge whether drums sound right (decision 39).** `bun run verify` proves the rows differ from what they were; it cannot tell you the groove survived. This checklist carries equal weight and is executed as steps, not skimmed.

Run `bun run dev`, open the Sequencer tab, and click once anywhere to create the `AudioContext` before judging anything. Load each grid from the sequencer's grid menu — the menu writes the grid *and* its kit in one action, so what you hear is the pair this slice authored.

- [ ] **1. `techno` — the offbeat open hat is now ONE sound.** On steps 2, 6, 10 and 14 you should hear a single open hat, not an open and a closed together. Compare against `git stash`-ed old behaviour if unsure: the old version has a doubled, slightly flammed transient on those four steps and a shorter tail, because the closed hat's own noise burst masked the open one's decay.
- [ ] **2. `techno-rolling` — the 16th roll still rolls.** This grid lost four of sixteen closed-hat hits, the most of any grid. Listen for whether the 16ths still read as continuous drive. If the offbeats now feel like holes rather than accents, the correction removed the groove with the collision and that is a finding to report — not something to fix by putting the closed hats back.
- [ ] **3. `house` — the offbeat open hat is the identity, and there is no snare.** The open hat between every kick should be the loudest thing after the kick. Then confirm the backbeat: on 2 and 4 you should hear a **clap**, one sound, with no snare body under it. If it sounds thin, that is the honest house voicing and belongs in a kit-tuning note, not a re-added snare row.
- [ ] **4. `funk` and `funky-drummer` — the open hat is an accent, not a doubling.** On steps 5 and 13 the hat should *open* out of the 16th stream. And listen to the two grids back to back: they are now identical except that `funk` has a tom on the last 16th. Confirm you can hear that difference; if you cannot, the pair is a duplicate in all but name and it is worth telling the controller.
- [ ] **5. `boom-bap`, `boombap-swung-break`, `boombap-8th-hat`, `lofi-half-time-brush` — the new kit.** Play each and ask: does the kick hit hard and stop (the "boom"), and does the snare crack rather than sizzle (the "bap")? Then load one of them and switch the kit picker manually back to `808 Vintage` and A/B. Dusty Break should sound *drier and harder*; if 808 Vintage sounds better, the kit's values need a tuning note, and say so rather than reverting the grid assignment.
- [ ] **6. The boom-bap grids have no clap, and should not sound emptier.** The clap was a unison duplicate of the snare — removing it should make the backbeat *cleaner*, not quieter. If the backbeat now feels weak, that is a snare-gain observation about Dusty Break, not an argument for the clap.
- [ ] **7. `lofi-hip-hop` and `lofi-half-time-brush` — one snap, not two.** The clap now lands only on the second backbeat. It should read as a colour sitting on top of the snare, once a bar. If you cannot hear it at all, note the clap gain; if it still reads as a second backbeat, the thinning did not go far enough.
- [ ] **8. `rock`, `dnb`, `waltz`, `afro-6-8`, `afro-six-eight-bell` — nothing where the clap was.** Confirm the backbeat is a snare alone and that no drum-machine handclap is audible anywhere in the bar.
- [ ] **9. `ambient-sparse-drift` on `Acoustic Studio`.** This is the controller decision this slice was asked to make audible: the downbeat crash should now *wash* — a long, decaying tail rather than the short tick `Warehouse` gave it. If it still sounds short, the kit move did not do what the research predicted and that is a finding.
- [ ] **10. `afro-6-8` and `afro-six-eight-bell` on the same kit.** Play them back to back. The hi-hat should sound identical between the two now; only the rhythm differs. Under `Warm Riddim` the first was noticeably darker.
- [ ] **11. All eight vibe chips, then the dice on each.** Three vibes get a real kit for the first time (`cyber-edm`, `deep-ambient`, `zen-garden`) and two change kit (`lofi-chill`, `boom-bap`). Press each chip and listen for a kit that suits the chip's name; `cyber-edm` in particular moves from the generic default kit to the 909-derived kit and should get noticeably clickier and brighter. Then roll the dice several times on each chip and confirm no rolled grid produces silence on a row that should be playing.
- [ ] **12. Report before fixing.** Anything on this list that sounds wrong is a **finding to report with the grid id and what you heard** — not a licence to edit a row this plan did not authorise. Every row this slice touches is listed in a task; an edit outside that list is out of scope by construction.

---

## Self-review

Checked against decisions 20–24, decision 5 and the four controller decisions.

| requirement | task |
|---|---|
| Decision 20 — de-collide `hihat`/`openhat`, before the choke | Task 1 |
| Decision 21 — clap corrections per genre | Task 3 |
| Decision 22 — `Dusty Break` + the kit reassignments + the two vibes that follow their grid | Task 4 |
| Decision 23 — optional rows; three row tests become one | Task 2 |
| Decision 3 — the `bass` row deletion (placed in slice 2 by decision 23) | Task 2 |
| Decision 24 / 41 — every vibe's `soundKit` is a key of `DRUM_KITS` | Task 5 |
| Decision 5 — repoint the three dangling `soundKit` names, invent no kit | Task 5 (Task 4 for the two that follow their grid) |
| Decision 10 — omission legal, all-false still meaningful, authoring guidance kept | Task 2 (Steps 2 and 6) |
| Decisions 39 / 42 — the listening checklist as a gate of equal weight | the checklist above, twelve numbered steps |
| Decision 43 — `report:drums-diff` covers the row changes | Task 1 Step 10, Task 3 Step 15 |
| Controller 1 — `ambient-sparse-drift` and `deep-ambient` to `Acoustic Studio` | Task 4 Step 5, Task 5 Step 4 |
| Controller 2 — no kit renamed, no migration or version constant touched | Global Constraints; Task 5 repoints to the current name `'909 Modern'` |
| Controller 3 / 4 — additive kit key and vibe repoint need no migration | Global Constraints; Task 4, Task 5 |

Three things this plan resolves that the spec did not name, each recorded where it is decided rather than smoothed over:

1. **Dropping `funk`'s clap makes `funk` and `funky-drummer` identical on the silent-duplicate sweep's five-row signature.** Measured, not predicted. Resolved in Task 3 Step 9 by widening the signature to the seven playable voices — which the test's own comment instructed to do "before authoring any new grid that might create one, not after" — because the pair still differs on `tom`. No exception table was added.
2. **`genre-drum-voice-selection.md` §2 also says "give `techno-rolling` a clap". This plan declines it**, with the reason in Task 3's preamble and in its commit message: that grid is a sourced transcription whose source specifies no backbeat.
3. **`Dusty Break`'s `kick.pitchTime` deviates from the research's 0.04.** It is authored at 0.02 to satisfy slice 1's `pitchTime ≤ 0.1 × decay` rule (decision 13); the deviation and its reason are in Task 4 Step 4.

Scanned for placeholders: none. Every code step carries the code, every test step the test, every measurement step the command and its expected output. Names checked across tasks: `KNOWN_ROW_NAMES` and `unknownRows` (Task 2) are referenced only by Task 2 and by the invariant Tasks 3–5 must keep; `PLAYABLE` (Task 3) and `FIXTURE_ROWS` (Task 3) are each defined once; `'Dusty Break'` is spelled identically in `DRUM_KITS`, in six grid `kit` fields, in two vibe `soundKit` fields and in four test assertions.
