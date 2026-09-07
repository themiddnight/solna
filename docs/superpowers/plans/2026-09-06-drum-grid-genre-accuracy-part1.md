# Drum-Grid Genre Accuracy — Part 1 (data + store) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the drum library's grids play what their genres actually play — correct ten grids to a sourced canonical pattern, author nine more, delete the one that cannot be authored honestly, record where every grid came from — and turn the drum axis of the Instant Vibes dice into an id pool like the other three, backed by the two sequencer tracks (`tom`, `crash`) that make 30 already-authored rows audible for the first time.

**Architecture:** `data → audio → store → components`. Everything this plan writes lands in the first two of those and in `scripts/`. `src/data/drumGrids.ts` gains a field and 9 entries, loses 1 and rewrites 10; `src/data/vibes.ts` swaps one `random` field for another; `src/store/vibeVariation.ts` loses a whole subsystem and gains four lines; `src/store/initialState.ts` gains two tracks and one pure transform that **two separate migration chains** call. One report script sits outside the gate. No DSP is touched: `tom` and `crash` already have param interfaces, `triggerDrum` cases and drum pads — only the sequencer tracks were missing.

**Tech Stack:** TypeScript, React 19, Zustand (`persist` + `subscribeWithSelector`), raw Web Audio API, `tonal` for note/interval math, Tailwind v4 + daisyUI, Bun (test runner + scripts), Vite, ESLint 10 flat config + typescript-eslint 8.

**Spec:** `docs/superpowers/specs/2026-09-06-drum-grid-genre-accuracy-design.md` — **this plan implements Slice 1 only** (spec items 1–12 and 17–24). Slice 2 (`ride` / `bell` DSP voices, items 13–16) is a separate plan.

**Evidence:** `docs/research/2026-09-06-drum-grid-genre-survey.md`. Every step index and every source URL below is copied from that document. **Nothing in this plan re-derives a pattern**; where the survey does not record a URL, the entry stays `'authored'` rather than acquiring an invented one.

---

## Global Constraints

### The `src/data/` rule (spec item 4; `CLAUDE.md`, layer 1)

> **A file in `src/data/` cannot do anything at load that a reader of the file cannot see.** It
> imports nothing at runtime — **not even another file in `src/data/`** — reads no impure global,
> declares no function and constructs no object, and holds no mutable module-scope binding. It may
> declare types and interfaces, and may `import type` from anywhere.

`provenance: string` is a plain string field on a literal — no import, no construction, no global — so it keeps the folder's purity trivially, and `src/data/dataLayerPurity.test.ts` keeps that measured. It also satisfies the folder's own distinguishing test: **adding a grid stays an edit to that table and nothing else.**

### The naming rule (spec, inherited from the data-layer spec)

> **A name says what an entry IS, not what it is keyed by.** And `preset` / `pattern` are banned as
> a name with no qualifier.

`drumGrids`, `withDrumTracks`, `provenance`, `replaceDrumPattern`, `migrateDrumTracks`, `upgradeDrumTracksV5` all follow it. `drumDecoration` is deleted rather than renamed, and `applyDrumPattern` is renamed rather than kept, **because its contract changed and the old name describes the old behaviour**.

### The two-migration-chain rule (spec item 12; `CLAUDE.md`)

> **Never merge the chains.** A persist payload is private `localStorage` shape; a project body is
> an external contract; their versions move for different reasons. The two chains share only *pure
> transforms* — `defaultPadState()` is the precedent, and `withDrumTracks` is this change's
> equivalent.

### Gate

**`bun run verify`** = `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`. `bun run eslint` must report **zero errors**; warnings are tolerated. Run it as the last step of every task, before the commit. The suite is **2287 passing** at the start of this plan; it grows.

`bun run report:drums-diff` (Task 2) is **not** in that chain and never will be — see Task 2's design notes.

### Measure by evaluating, never by grepping

> Every count in this plan was produced by evaluating the table (`bun -e "…"`), never by counting
> matched lines. A documented past incident on this repo produced a wrong count by grepping literal
> lines and that count reached a spec before anyone re-measured it. When a step says "expect 30",
> get the 30 from `Object.keys(DRUM_GRIDS).length`, not from `grep -c`.

### `bun run verify` cannot judge whether drums sound right (spec item 17)

The previous branch had a contract a machine could settle — *only import paths and symbol names may change*. **Here the sound changes on purpose.** Every test that pins a drum row goes red by design. The suite can say *what* changed and that nothing changed by accident; it can never say the new rhythm is right. The **Listening checklist** at the end of this document is a human gate with the same weight as the code tasks, and a green gate is not a finished change.

### Branch

All work lands on **`refactor/data-layer-extraction`**, which already holds the spec commit and this plan. Never commit to `main`.

### Explicitly OUT of scope

- **`ride` and `bell`** — the voices, the two twelve-step grids (`bembe-standard-bell`, `jazz-waltz-ride`), the second migration round, and the nine-tracks-against-eight-tokens decision. Slice 2.
- **A per-grid step-resolution axis, per-cell velocity, swing/shuffle timing** — the spec's non-goals. Trap hat rolls at 32nds and the Purdie shuffle stay unexpressible and that is recorded, not fixed.
- **The three vibes naming a `soundKit` `DRUM_KITS` does not define** (`cyber-edm` → "Hyperpop 2000"; `deep-ambient` and `zen-garden` → "Minimal Glitch"). A real pre-existing bug, deliberately left: no source says which kit those three should have.
- **Reclaiming the `clap` row.** `clap` is a real voice with params in every kit, a `triggerDrum` case, a pad on `KeyM` and a track. The survey's finding was about how the *grids were written*, not that the voice is unused.
- **Changing which progression, synth preset or effect chain any vibe uses.** This change touches the drum axis of a vibe and nothing else.

---

## Ordering decision, and the one place this plan departs from the brief

The ten tasks run in the order below and the order is load-bearing in five places:

1. **Task 1 (`provenance`) precedes every row edit.** The field lands with every grid marked `'authored'`, because at that moment every grid *is* unsourced — the ten corrections have not happened. Task 3 then flips a grid's provenance to its source URL **in the same commit that makes its rows match that source**. Landing the URLs first would mean shipping, for one commit, 10 entries claiming a provenance their rows contradict, which is exactly the lie `provenance` exists to prevent.
2. **Task 2 (the diff report) precedes every row edit**, so it can report them. A report written after the fact reports nothing.
3. **Task 5 (delete `edm-offbeat-pump`) follows Task 4**, because `meterRegression.test.ts:144` pins the *ordered* list of 4/4 grid ids and both tasks edit it; doing them apart makes each diff readable.
4. **Task 7 (`replaceDrumPattern`) precedes Task 8 (the tom and crash tracks).** Task 8 is what makes the merge semantics a bug — the 14 sequencer genre grids declare no `crash`, so loading one after a vibe would leave the vibe's crash ringing. Fixing the semantics **before** the tracks that expose it exist means the bug is never on the branch, not even for one commit. Reversing the two would ship it and then remove it, which is a worse history to read and a worse bisect.
5. **Task 9 (migrations) follows Task 8**, because it calls `withDrumTracks`, and **Task 10 (docs) is last**, because it records the final counts.

**No new store state, and that is a decision rather than an omission.** Spec item 10 originally said `pickDistinct`, "like the other axes", which needs a fourth `current` field. Measured: **no such value exists anywhere in the store** — `scaleRoot`, `chordRhythmId` and `bassPatternId` are store fields; the drum grid id is `useState` local to `SequencerView` (`SequencerView.tsx:55`) and `applyVibeToStore` never writes it. The spec now settles it the other way: the axis uses plain `draw.pick`, following the `progressions` precedent two lines away in the same function. Manufacturing an `activeDrumGridId` written by two callers would be a **second source of truth for the playing grid**, and the moment one writer is missed `pickDistinct` silently excludes the wrong id — pool invariant 1 true on paper, false in the running app, with no test that could tell. **The sequencer slice gains nothing and `SequencerView`'s `selectedGridId` stays a `useState`.** See Task 6's design notes for the accepted cost.

---

## File Structure

### Created

| file | responsibility |
|---|---|
| `scripts/report-drum-diff.ts` | Per-grid, per-row step-index diff of `DRUM_GRIDS` against the pinned pre-change commit. A report: always exits 0, never in `verify`. |

### Modified

| file | change |
|---|---|
| `package.json` | one script: `report:drums-diff` |
| `src/data/drumGrids.ts` | `DrumGrid.provenance`; 10 grids corrected; 9 authored; `edm-offbeat-pump` deleted; `house` gains `tom` + `crash`; head comment rewritten |
| `src/data/drumGrids.test.ts` | provenance + allowlist tests; the ten source-citing correction tests; the nine new-grid tests; `SILENT_DUPLICATES` → `[]`; a third id group for the sourced variants |
| `src/data/vibes.ts` | `VibeRandomRule.drumGrids` replaces `drumDecoration`; 8 pools authored; `cyber-edm.drumGridId` → `house`; the `drumGridId` doc comment's "a reroll does NOT repoint this" paragraph deleted |
| `src/types.ts:205-232` | `DecorationLayer`, `DensityName`, `DrumDecorationRule` deleted |
| `src/store/vibeVariation.ts` | the decoration subsystem deleted; the drum axis becomes one `pickDistinct`; `VariationSummary.drums` becomes `drumGridId` + `drumGridName`; the toast segment becomes the grid's display name |
| `src/store/vibeVariation.test.ts` | every decoration describe-block deleted; pool invariants and draw tests rewritten |
| `src/store/vibeVariationFixtures.ts` | `scriptedDraw` scripts shorten from `5 + layers` draws to exactly 6 |
| `src/store/sequencerSlice.ts` | `applyDrumPattern` → `replaceDrumPattern`, and it replaces |
| `src/store/types.ts:252` | the action's name and its doc comment |
| `src/store/vibes.ts:126,136`, `src/components/loop/SequencerView.tsx:36,142,145` | the two real call sites, re-read and renamed |
| `src/store/store.test.ts:242-280,411`, `src/store/vibes.test.ts:443-486`, `src/store/instantVibesDrums.test.ts:40` | the old contract's two assertions rewritten; the ordering probe and one comment renamed |
| `src/store/initialState.ts` | `tom` + `crash` tracks; the pure `withDrumTracks` |
| `src/store/initialState.test.ts` | `withDrumTracks` unit tests |
| `src/store/migrate.ts`, `src/store/store.ts` | `migrateDrumTracks`; persist `version` 12 → **13** |
| `src/store/projectFormatMigrate.ts`, `src/store/projectFormat.ts` | `upgradeDrumTracksV5`; `PROJECT_FORMAT_VERSION` 4 → **5** |
| `src/store/migrate.test.ts`, `src/store/projectFormatMigrate.test.ts` | one describe-block each |
| `src/store/store.test.ts:883,918` | the two rehydration colour lists grow to seven |
| `src/store/instantVibesDrumsFixture.ts` | `cyber-edm` gains house's `bass` row — **the only fixture change in this plan** |
| `src/store/instantVibesDrums.test.ts:73` | `edm-offbeat-pump` → `house` in the sorted id list |
| `src/audio/meterRegression.test.ts:126` | `FOUR_FOUR_GRID_IDS`: minus one, plus nine |
| `CLAUDE.md`, `.claude/skills/instant-vibes/SKILL.md`, `docs/design.md` | Task 9 |

### Not created, deliberately

**No snapshot file of the pre-change grids.** Task 2 reads them with `git show 00a61f1:src/data/drumGrids.ts`. The reason is not convenience: **a checked-in snapshot is a file in the working tree, and any later edit — including the very edit it exists to check — can regenerate it, silently, and nothing notices.** A git object at a pinned sha cannot drift; it is immutable by construction, costs zero repo bytes and needs no maintenance. Spec item 18 asks for "snapshot before, diff report after"; git already holds the snapshot.

---

## Task 1: `DrumGrid.provenance`, and an allowlist that makes "unsourced" a deliberate act

**Files:**
- Modify: `src/data/drumGrids.ts` (the interface, and all 22 entries), `src/data/drumGrids.test.ts` (append one describe-block)

**Interfaces:**
- Produces, from `@/data/drumGrids`: `DrumGrid` gains `provenance: string`.
- Consumes: nothing new. `drumGridById` (`src/audio/drumGrids.ts`) spreads `...grid`, so `provenance` travels to a `ResolvedVibe` with no edit.

**Design notes for the implementer:**
- **No row changes in this task at all.** If the diff shows a `true` or a `false` moving, stop.
- **Every entry gets `'authored'` except `rock`.** That is not laziness — at this commit it is the truth. The survey records a source URL for `rock`'s canonical backbeat (`fundamental-changes.com/learn-to-play-backbeat-on-drums/`) *and* records that `rock` already matches it, so `rock` is the one grid whose rows and whose claimed source agree right now. The ten grids Task 3 corrects do **not** match their sources yet; they get their URL in Task 3, in the same commit as the rows.
- **Only URLs that appear verbatim in the survey may ever be written into this field.** If a grid has no URL in the survey, it is `'authored'` and goes on the allowlist. `house` and `dnb` are the interesting case: the survey found both *match* a sourced canonical pattern but did not record which page. They stay `'authored'` with that stated in a comment, which is precisely the allowlist doing its job — it makes "we did not write the source down" visible instead of invisible.
- The allowlist **shrinks** as later tasks land sources (21 → 11 after Task 3 → 10 after Task 5). The test does not change again; only the constant does.

- [ ] **Step 1: Write the failing test**

Append to `src/data/drumGrids.test.ts`:

```ts
describe('provenance', () => {
  /**
   * Grids that are honestly unsourced.
   *
   * The load-bearing half of this file's provenance rules. Shipping a grid with
   * no source is allowed — some rhythms are inventions that sound good — but it
   * has to be a DELIBERATE act: a name added to a list a reviewer sees, not the
   * default that happens when nobody looked for a source.
   *
   * `zen-bamboo-pulse` is the first member by decision. The survey looked and
   * found that "zen garden" is not a documented percussion tradition at all:
   * searches surface karesansui gardens, ambient playlists and Midori Takada,
   * and the nearest real East Asian idioms with notatable patterns (Miyake,
   * Yatai-bayashi taiko) are dense ensemble music — the opposite of the sparse
   * thing this grid is. Attaching a tangentially related source to it would be
   * the exact failure mode `provenance` exists to prevent.
   *
   * This list SHRINKS as sources land. Never grow it to make a test pass.
   */
  const AUTHORED_ALLOWLIST = [
    'synthwave', 'house', 'trap', 'boom-bap', 'cyberpunk', 'dnb', 'dubstep',
    'techno', 'funk', 'reggae', 'lofi-hip-hop', 'waltz', 'afro-6-8',
    'lofi-half-time-brush', 'synthwave-four-on-floor', 'edm-offbeat-pump',
    'ambient-sparse-drift', 'boombap-swung-break', 'zen-bamboo-pulse',
    'waltz-brush-three', 'afro-six-eight-bell',
  ];

  test('every grid records where its rhythm came from', () => {
    for (const [id, grid] of Object.entries(DRUM_GRIDS)) {
      expect(grid.provenance.length, `${id} provenance`).toBeGreaterThan(0);
    }
  });

  test("every grid claiming 'authored' is on the allowlist, and every allowlisted grid exists", () => {
    const authored = Object.entries(DRUM_GRIDS)
      .filter(([, g]) => g.provenance === 'authored')
      .map(([id]) => id);
    expect(authored.sort()).toEqual([...AUTHORED_ALLOWLIST].sort());
  });

  test('a sourced grid names a source, not a vague gesture at one', () => {
    // The only two shapes allowed: the literal 'authored', or something with a
    // dot in it — a URL or a citation. "from a video", "traditional" and
    // "standard" are the failure mode this catches.
    for (const [id, grid] of Object.entries(DRUM_GRIDS)) {
      if (grid.provenance === 'authored') continue;
      expect(grid.provenance.includes('.'), `${id}: "${grid.provenance}"`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `bun test src/data/drumGrids.test.ts`

Expected: FAIL with a type error surfacing as a runtime one — `grid.provenance.length` throws `undefined is not an object`, because no entry has the field yet. That is the right failure: it is the field's absence, not a wrong value.

- [ ] **Step 3: Add the field to the interface**

In `src/data/drumGrids.ts`, insert into `interface DrumGrid` directly above `rows`:

```ts
  /**
   * Where this rhythm came from: a source URL, or the literal `'authored'`.
   *
   * A research pass was spent rediscovering which of the library's grids had a
   * documented basis and which were invented, and the answer was not
   * recoverable from the table — nobody recorded it when the grids were
   * written. The table carries it now, so the next "where did this rhythm come
   * from?" is answered by reading the entry.
   *
   * `'authored'` is an honest answer and an allowlisted one: see the provenance
   * describe-block in drumGrids.test.ts. Never invent a URL to get off that
   * list — a tangentially related source is worse than no source, because it
   * reads as verification.
   */
  provenance: string;
```

- [ ] **Step 4: Add `provenance` to all 22 entries**

One line per entry, directly under `kit`. Twenty-one read exactly:

```ts
    provenance: 'authored',
```

and `rock` alone reads:

```ts
    // The survey checked rock against a sourced transcription and it MATCHED —
    // kick 0,8 with the backbeat at 4,12 and straight 8th hats. It is the only
    // grid whose rows and whose source already agree, which is why it is the
    // only one sourced before Task 3 rewrites anything.
    provenance: 'fundamental-changes.com/learn-to-play-backbeat-on-drums/',
```

Add these two comments above `house` and `dnb`'s `provenance` lines, because they are the entries a future reader will most want to argue with:

```ts
    // The survey found house MATCHES a sourced canonical pattern (kick 0,4,8,12,
    // backbeat 4,12, offbeat open hats) but did not record which page. Until
    // someone writes the URL down, 'authored' is the honest label — that is the
    // allowlist working, not a gap in it.
```

```ts
    // As with house: the survey verified dnb against a source and recorded the
    // verdict, not the URL.
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `bun test src/data/drumGrids.test.ts`
Expected: PASS, three tests added, everything already there still green.

Confirm the field reaches a resolved vibe, by evaluating rather than reading:

Run: `bun -e "const {drumGridById}=await import('./src/audio/drumGrids.ts'); console.log(drumGridById('rock').provenance)"`
Expected: `fundamental-changes.com/learn-to-play-backbeat-on-drums/`

- [ ] **Step 6: Run the gate and commit**

Run: `bun run verify`

```
git add src/data/drumGrids.ts src/data/drumGrids.test.ts
git commit -m "feat(data): record every drum grid's provenance, with an allowlist for the unsourced

A source URL or the literal 'authored'. Twenty-one entries are 'authored'
today because that is the truth today — the ten corrections have not landed,
so a URL on those entries would claim a source their rows contradict. Task 3
flips each one in the same commit that makes its rows match.

The allowlist is the load-bearing half: shipping an unsourced grid is now a
name added to a list a reviewer sees, rather than the default that happens
when nobody looked. zen-bamboo-pulse is on it by decision — 'zen garden' is
not a documented percussion tradition and attaching a near-miss source to it
would read as verification.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Task 2: `report:drums-diff`, landed before anything moves

**Files:**
- Create: `scripts/report-drum-diff.ts`
- Modify: `package.json` (one script line)

**Interfaces:**
- Consumes: `DRUM_GRIDS` from `../src/data/drumGrids.ts`; `Bun.spawnSync` for `git show`; `node:os` / `node:path` / `node:fs` for the temp module.
- Produces: `bun run report:drums-diff`, stdout only, **exit code always 0**.

**Design notes for the implementer:**
- **Why this is a report and not a test.** A changed drum row is a fact about content, not a defect. Asserting on the *set* of changes would mean editing the assertion every time content is edited — a test that asserts nothing. `report:library` already establishes the pattern in this repo, down to the "always exits 0" line in its header comment.
- **Why `git show` and not a snapshot file.** See "Not created, deliberately" above. Pin the sha in a named constant so a reader can see what "before" means.
- **The pre-change module has one `import type` line and Bun needs the `@/` alias to resolve it.** Strip every line beginning with `import ` before writing the temp module: the types are erased at runtime, `DrumGrid` is declared in the same file, and `MeterId` survives only as an unresolved annotation Bun never checks. Do **not** write the temp file inside `src/` — a stray `.ts` there would be picked up by `bun test`, `tsc` and `eslint .`. Use `os.tmpdir()`.
- **Degrade, do not throw.** If `git show` fails (shallow clone, detached worktree), print one line saying the baseline is unreachable and still exit 0. A report that crashes the moment a repo is unusual is a report nobody runs.

- [ ] **Step 1: Write the script**

Create `scripts/report-drum-diff.ts`:

```ts
/**
 * What changed in DRUM_GRIDS, per grid, per row, as step indices.
 *
 *   bun run report:drums-diff
 *
 * A REPORT, NOT AN ASSERTION. It always exits 0 and is deliberately not part of
 * `bun run verify` — same rule as `report:library`. A changed drum row is a
 * fact about content, not a defect; asserting on the set of changes would mean
 * editing the assertion every time content is edited, which is a test that
 * asserts nothing.
 *
 * It exists because the drum-grid genre-accuracy work rewrites ten grids and
 * authors nine, and a reviewer cannot read that as thirty screens of booleans.
 * Its output is quoted in the commit message of the row-editing commits, and
 * that quote is the record of which changes were the intended corrections and
 * which were not intended at all.
 *
 * THERE IS NO SNAPSHOT FILE, ON PURPOSE. The "before" side is read straight out
 * of git at a pinned commit. A checked-in snapshot is a file in the working
 * tree, and any later edit — including the very edit it exists to check — can
 * regenerate it silently. A git object cannot drift.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DRUM_GRIDS, type DrumGrid } from '../src/data/drumGrids.ts';

/**
 * The last commit before any row in this work was touched: the spec's own
 * commit's parent state of the table. Bump it only when starting a NEW piece of
 * drum-content work, never to make a diff smaller.
 */
const BASELINE = '00a61f1';
const TABLE_PATH = 'src/data/drumGrids.ts';

const on = (row: boolean[] | undefined): number[] =>
  (row ?? []).map((hit, i) => (hit ? i : -1)).filter((i) => i >= 0);

const fmt = (steps: number[]): string => (steps.length === 0 ? '(silent)' : steps.join(','));

function reportGrid(id: string, before: DrumGrid, after: DrumGrid): string[] {
  const lines: string[] = [];
  const rows = [...new Set([...Object.keys(before.rows), ...Object.keys(after.rows)])].sort();
  for (const row of rows) {
    const b = on(before.rows[row]);
    const a = on(after.rows[row]);
    if (b.join(',') === a.join(',') && row in before.rows === row in after.rows) continue;
    if (!(row in before.rows)) {
      lines.push(`    + row ${row.padEnd(8)} ${fmt(a)}`);
    } else if (!(row in after.rows)) {
      lines.push(`    - row ${row.padEnd(8)} ${fmt(b)}`);
    } else {
      const added = a.filter((i) => !b.includes(i));
      const removed = b.filter((i) => !a.includes(i));
      lines.push(`      ${row.padEnd(8)} ${fmt(b)}  ->  ${fmt(a)}`);
      lines.push(`               on: ${fmt(added)}   off: ${fmt(removed)}`);
    }
  }
  if (before.provenance !== after.provenance) {
    lines.push(`      provenance  ${before.provenance}  ->  ${after.provenance}`);
  }
  return lines;
}

const shown = Bun.spawnSync(['git', 'show', `${BASELINE}:${TABLE_PATH}`]);
if (shown.exitCode !== 0) {
  console.log(`Cannot read ${BASELINE}:${TABLE_PATH} — is this a shallow clone?`);
  console.log('Nothing to diff against. This is still a clean exit.');
} else {
  // The type-only imports are erased at runtime and `@/` will not resolve from
  // a temp directory, so drop every import line. `DrumGrid` is declared in the
  // same file; `MeterId` survives as an annotation Bun never checks.
  const source = shown.stdout
    .toString()
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'solna-drum-diff-'));
  const file = join(dir, 'baselineDrumGrids.ts');
  writeFileSync(file, source, 'utf8');
  const mod = (await import(pathToFileURL(file).href)) as { DRUM_GRIDS: Record<string, DrumGrid> };
  const before = mod.DRUM_GRIDS;
  const after = DRUM_GRIDS;

  console.log(`DRUM_GRIDS, ${BASELINE} -> working tree.`);
  console.log('A report, not a check — this always exits 0.\n');
  console.log(`  entries: ${Object.keys(before).length} -> ${Object.keys(after).length}\n`);

  const added = Object.keys(after).filter((id) => !(id in before));
  const removed = Object.keys(before).filter((id) => !(id in after));
  const shared = Object.keys(after).filter((id) => id in before);

  for (const id of removed) {
    console.log(`  - ${id}  DELETED`);
    for (const [row, steps] of Object.entries(before[id].rows)) {
      console.log(`      ${row.padEnd(8)} ${fmt(on(steps))}`);
    }
    console.log('');
  }
  for (const id of added) {
    console.log(`  + ${id}  NEW  (${after[id].meter}, ${after[id].kit})`);
    console.log(`      provenance  ${after[id].provenance}`);
    for (const [row, steps] of Object.entries(after[id].rows)) {
      if (on(steps).length === 0) continue;
      console.log(`      ${row.padEnd(8)} ${fmt(on(steps))}`);
    }
    console.log('');
  }
  let changed = 0;
  for (const id of shared) {
    const lines = reportGrid(id, before[id], after[id]);
    if (lines.length === 0) continue;
    changed += 1;
    console.log(`  ~ ${id}`);
    for (const line of lines) console.log(line);
    console.log('');
  }
  console.log(
    `  ${removed.length} deleted, ${added.length} new, ${changed} changed, ` +
      `${shared.length - changed} untouched.`,
  );
  console.log('\nA changed row is content, not a defect. What this report is FOR is');
  console.log('spotting the row you did not mean to touch, in the same pass as the');
  console.log('ones you did.');
}
```

Note the two things that make this run at all: `mkdtempSync` puts the temp module **outside `src/`**, so no stray `.ts` is picked up by `bun test`, `tsc --noEmit` or `eslint .`; and the top-level `await import(...)` needs the script to stay an ES module, which it is — Bun runs `scripts/*.ts` as one.

- [ ] **Step 2: Add the package script**

In `package.json`, directly after the `report:library` line:

```json
    "report:drums-diff": "bun scripts/report-drum-diff.ts",
```

**Do not add it to `verify`.**

- [ ] **Step 3: Run it against an unchanged table**

Run: `bun run report:drums-diff`

Expected: `entries: 22 -> 22`, `0 deleted, 0 new, 22 changed, 0 untouched` — every grid reports a `provenance` line, because Task 1 added the field and the baseline predates it. Nothing else. That is the proof the diff reads real values on both sides: if it printed `22 untouched` it would be comparing the working tree to itself.

- [ ] **Step 4: Prove it catches a row change, then undo it**

Flip one cell — set `DRUM_GRIDS.rock.rows.kick[1]` to `true` — and re-run.

Expected: `~ rock` with `kick  0,8  ->  0,1,8` and `on: 1   off: (silent)`.

Revert the cell. Re-run and confirm `rock` drops back to a provenance-only entry. **Do not commit with the cell flipped.**

- [ ] **Step 5: Run the gate and commit**

Run: `bun run verify` — the script is not in the chain, but `eslint .` and `tsc --noEmit` both cover `scripts/`, so this is where a stray unused import shows up.

```
git add scripts/report-drum-diff.ts package.json
git commit -m "chore(scripts): add report:drums-diff, before any row is edited

Reads the pre-change grids straight out of git at a pinned sha rather than
from a checked-in snapshot: a snapshot file is in the working tree and any
later edit — including the very edit it exists to check — can regenerate it
silently. A git object cannot drift.

Always exits 0 and is deliberately not in verify, same rule as report:library.
A changed drum row is content, not a defect; asserting on the set of changes
would mean editing the assertion every time content changes.

It lands before the row edits so it can report them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Task 3: Correct ten grids to their sourced canonical pattern

**Files:**
- Modify: `src/data/drumGrids.ts` (10 entries: rows + `provenance`), `src/data/drumGrids.test.ts` (the ten source-citing tests; shrink `AUTHORED_ALLOWLIST`; delete the now-false twelve-step assertions)

**Interfaces:** none change. Row values and `provenance` strings only.

**Design notes for the implementer:**
- The change list is the survey's Part-2 table and **nothing else**. Ten grids, not eight: `waltz` and `afro-6-8` are in that table and their corrections are as sourced as the other eight.
- **`waltz` and `afro-6-8` land half right, on purpose.** A bembé bell played by a closed hi-hat is the right rhythm on the wrong instrument, and so is a jazz ride. Slice 2 gives both a real row and moves them there. Writing them onto `hihat` here is not a shortcut around slice 2 — it is the half of the fix that does not need a new DSP voice, shipped first. **Write the caveat into the entry**, so the next reader does not "fix" the timbre by deleting the rhythm.
- The survey also records that in a real drum-set arrangement the bell and the hi-hat sound **simultaneously**. Slice 1 cannot express that at all. Slice 2 can.
- **`afro-6-8`'s correction is what dissolves one of the two silent duplicates.** After it, `afro-6-8` and `afro-six-eight-bell` differ on `snare` and `hihat`. Task 5 dissolves the other. Do not touch `SILENT_DUPLICATES` here; Task 5 empties it in one move so the change reads as one decision.
- **Test names cite their source (spec item 19).** A test called `'techno hihat'` asserting sixteen `true`s is indistinguishable from a test pinning a typo. The name is the only place the *reason* for an expected value survives.
- Every row below is a full 16-step (or 12-step) literal in the file's existing one-line-per-row style. **Rows not named below are not touched.**

- [ ] **Step 1: Write the ten failing tests**

Append to `src/data/drumGrids.test.ts`:

```ts
describe('the ten corrected grids match their sourced canonical pattern', () => {
  const on = (id: string, row: string) =>
    DRUM_GRIDS[id].rows[row].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

  const ALL_SIXTEEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const STRAIGHT_EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];

  test("techno's hat is rolling 16ths with an open on every offbeat (Attack Magazine, Motor City Detroit techno)", () => {
    expect(on('techno', 'hihat')).toEqual(ALL_SIXTEEN);
    expect(on('techno', 'openhat')).toEqual([2, 6, 10, 14]);
  });

  test("synthwave's kick is 1, 3 and the 'a' of 4, under rolling 16th hats (Attack Magazine, synthwave drums)", () => {
    expect(on('synthwave', 'kick')).toEqual([0, 8, 15]);
    expect(on('synthwave', 'hihat')).toEqual(ALL_SIXTEEN);
  });

  test("dubstep kicks once a bar, on 1 (Unison, how to make dubstep)", () => {
    expect(on('dubstep', 'kick')).toEqual([0]);
  });

  test("trap's kick is 1, the 'and-a' of 2 and the 'and' of 3, over quarter-note hats (Reason Studios trap cheat sheet)", () => {
    // The rolls a real trap hat plays are 32nds and triplets. This grid stores
    // 16ths, so the sourced QUARTER-note hat is what is storable and what is
    // written; the rolls are a documented non-goal (survey Part 4).
    expect(on('trap', 'kick')).toEqual([0, 6, 10]);
    expect(on('trap', 'hihat')).toEqual([0, 4, 8, 12]);
    expect(on('trap', 'openhat')).toEqual([6]);
  });

  test("boom bap kicks 1, the 'and' of 2 and 3, under straight 8th hats (Attack Magazine, 90s boom bap)", () => {
    expect(on('boom-bap', 'kick')).toEqual([0, 6, 8]);
    expect(on('boom-bap', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
  });

  test("lo-fi hip-hop is a two-kick half-time bar with straight 8th hats (Native Instruments, lo-fi hip hop beats)", () => {
    expect(on('lofi-hip-hop', 'kick')).toEqual([0, 8]);
    expect(on('lofi-hip-hop', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
  });

  test("funk plays 16th hats with the open on the 'e' of 2 and 4 (Roland, Behind the Beat: Funky Drummer)", () => {
    expect(on('funk', 'hihat')).toEqual(ALL_SIXTEEN);
    expect(on('funk', 'openhat')).toEqual([5, 13]);
  });

  test("reggae's one drop plays straight 8th hats with an open pickup on the last 8th (Soundbrenner, rockers rhythm)", () => {
    expect(on('reggae', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
    expect(on('reggae', 'openhat')).toEqual([14]);
  });

  // The two that land HALF right. Slice 2 moves both rows onto a real voice.
  test("waltz plays the jazz-waltz ride figure — on the HIHAT row until slice 2 (studydrums.com)", () => {
    expect(on('waltz', 'hihat')).toEqual([0, 4, 6, 8]);
    expect(DRUM_GRIDS.waltz.rows.hihat.length).toBe(12);
  });

  test("afro 6/8 is a cross-stick and the standard bembé bell — the bell on the HIHAT row until slice 2 (Jerry Leake, uvic.ca)", () => {
    expect(on('afro-6-8', 'snare')).toEqual([1, 4, 7, 10]);
    expect(on('afro-6-8', 'hihat')).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });
});
```

- [ ] **Step 2: Run them and watch all ten fail**

Run: `bun test src/data/drumGrids.test.ts -t "sourced canonical"`

Expected: 10 fail. Spot-check the first failure reads `Expected: [0,1,2,…,15]  Received: [2,6,10,14]` for `techno.hihat` — the six-grid shared offbeat hat that is the reason this whole change exists.

- [ ] **Step 3: Rewrite the ten grids' rows**

In `src/data/drumGrids.ts`, replace exactly these rows (nothing else in these entries moves):

`techno`:
```ts
      hihat:   [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
      openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
```

`synthwave`:
```ts
      kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, true],
      hihat:   [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
```

`dubstep`:
```ts
      kick:    [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
```

`trap`:
```ts
      kick:    [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false],
      hihat:   [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false],
```

`boom-bap`:
```ts
      kick:    [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
```

`lofi-hip-hop`:
```ts
      kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
```

`funk`:
```ts
      hihat:   [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
      openhat: [false, false, false, false, false, true, false, false, false, false, false, false, false, true, false, false],
```

`reggae`:
```ts
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
```

`waltz` (12 steps):
```ts
      hihat:   [true, false, false, false, true, false, true, false, true, false, false, false],
```

`afro-6-8` (12 steps):
```ts
      snare:   [false, true, false, false, true, false, false, true, false, false, true, false],
      hihat:   [true, false, true, false, true, true, false, true, false, true, false, true],
```

- [ ] **Step 4: Flip the ten `provenance` values, with the caveat on the two twelve-step grids**

`techno`: `provenance: 'attackmagazine.com/technique/beat-dissected/motor-city-detroit-techno/',`
`synthwave`: `provenance: 'attackmagazine.com/technique/beat-dissected/synthwave-drums/',`
`dubstep`: `provenance: 'unison.audio/how-to-make-dubstep/',`
`trap`: `provenance: 'reasonstudios.com/news/post/trap-drum-basics-super-neat-beat-cheat-sheet',`
`boom-bap`: `provenance: 'attackmagazine.com/technique/beat-dissected/90s-boom-bap-hip-hop/',`
`lofi-hip-hop`: `provenance: 'blog.native-instruments.com/lo-fi-hip-hop-beats/',`
`funk`: `provenance: 'articles.roland.com/behind-the-beat-funky-drummer-by-james-brown/',`
`reggae`: `provenance: 'soundbrenner.com/blogs/articles/rockers-rhythm',`

`waltz`, with the comment above it:
```ts
    // THE RHYTHM IS RIGHT, THE TIMBRE IS NOT. `hihat 0,4,6,8` is the jazz-waltz
    // RIDE figure, written on the hi-hat row because slice 1 has no ride voice.
    // Slice 2 adds `ride` and moves it. Do not "fix" this by deleting the
    // figure — the figure is the correction; the row is the compromise.
    provenance: 'studydrums.com/hsid/jzwalz01.html',
```

`afro-6-8`, with the comment above it:
```ts
    // THE RHYTHM IS RIGHT, THE TIMBRE IS NOT. `hihat 0,2,4,5,7,9,11` is the
    // STANDARD BEMBÉ BELL, written on the hi-hat row because slice 1 has no
    // bell voice; `snare 1,4,7,10` is the cross-stick. In a real arrangement
    // the bell and the hi-hat sound SIMULTANEOUSLY, which slice 1 cannot
    // express at all and slice 2 can. Slice 2 adds `bell` and moves this row.
    provenance: 'Jerry Leake, "Perspectives on the Standard African Bell" (uvic.ca)',
```

- [ ] **Step 5: Shrink the allowlist and fix the two twelve-step assertions that are now false**

In the `provenance` describe-block, remove these ten from `AUTHORED_ALLOWLIST`: `synthwave`, `trap`, `boom-bap`, `dubstep`, `techno`, `funk`, `reggae`, `lofi-hip-hop`, `waltz`, `afro-6-8`. Eleven remain: `house`, `cyberpunk`, `dnb`, `rock` is **not** among them (it was sourced in Task 1), so: `house`, `cyberpunk`, `dnb`, `lofi-half-time-brush`, `synthwave-four-on-floor`, `edm-offbeat-pump`, `ambient-sparse-drift`, `boombap-swung-break`, `zen-bamboo-pulse`, `waltz-brush-three`, `afro-six-eight-bell`.

In `describe('the twelve-step grids state their meter through their accents')`, the `afro-6-8` test's snare assertion is now wrong. Replace `expect(on('afro-6-8', 'snare')).toEqual([4, 10]);` with `expect(on('afro-6-8', 'snare')).toEqual([1, 4, 7, 10]);` and rename the test to `'Afro 6/8 kicks the two dotted-quarter beats and cross-sticks 1,4,7,10'`. Its `kick` and `bass` assertions are untouched, and `waltz`'s three assertions (`kick`, `snare`, `bass`) are untouched — none of those rows changed.

The `'no two twelve-step grids are the same pattern under different names'` test still passes and gets stronger; leave it.

- [ ] **Step 6: Run the report and read it by eye**

Run: `bun run report:drums-diff`

Expected: `0 deleted, 0 new, 22 changed` with **exactly ten** entries showing a row line. The other twelve show only `provenance` lines (Task 1's field, against a baseline that predates it). **Read every row line.** If a grid you did not intend to touch shows a row change, that is the report doing its job — revert it.

Capture the output; Step 8 quotes it.

- [ ] **Step 7: Run the suite and expect breakage outside this file**

Run: `bun test`

Expected: the ten new tests pass, and **`instantVibesDrums.test.ts` stays green** — none of the eight vibes points at a corrected grid (they point at the eight vibe grids, all untouched here). If that fixture goes red, a vibe grid was edited by mistake.

`meterRegression.test.ts` stays green: no meter and no row length changed.

- [ ] **Step 8: Run the gate and commit, quoting the report**

Run: `bun run verify`

```
git add src/data/drumGrids.ts src/data/drumGrids.test.ts
git commit -m "fix(data): correct ten drum grids to their sourced canonical pattern

The survey checked twelve grids against sourced transcriptions and four
matched. This is the other eight, plus waltz and afro-6-8 from the same
table — ten, not eight.

waltz and afro-6-8 land HALF right on purpose. The jazz-waltz ride figure and
the standard bembé bell are written on the hihat row because slice 1 has no
ride and no bell voice: the rhythm becomes correct, the timbre stays wrong,
and slice 2 moves both rows onto a real voice. Each entry carries that caveat
so nobody 'fixes' it by deleting the figure.

afro-6-8's rewrite dissolves one of the two silent duplicates on its own;
Task 5 dissolves the other.

report:drums-diff, ten changed grids:

$(paste the ten '~ <id>' blocks from `bun run report:drums-diff` here, verbatim)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Task 4: Author the nine new 4/4 grids — the library goes 22 → 31

**Files:**
- Modify: `src/data/drumGrids.ts` (a third section at the end), `src/data/drumGrids.test.ts` (a third id group, nine source-citing tests), `src/audio/meterRegression.test.ts:126` (`FOUR_FOUR_GRID_IDS` gains nine ids, in table order)

**Interfaces:** nine new keys in `DRUM_GRIDS`. No type changes.

**Design notes for the implementer:**
- The nine are the survey's Part-3 **4/4** entries. The two twelve-step entries in that table (`bembe-standard-bell`, `jazz-waltz-ride`) are **slice 2**: both are defined by a row the schema does not have, so authoring them here would mean authoring them onto `hihat` and then rewriting them — two edits to make one change.
- **A new grid defines all seven `GENRE_ROWS`; rows the source does not specify are all-false.** This is not padding. At *this* commit `applyDrumPattern` still merges — it looks a row up by track instrument and **ignores every row matching none** — so a grid that omits `clap` leaves the *previous* grid's clap hits playing underneath it. **Task 7 fixes that for good**, and after it an omitted row and an all-false row behave identically. Write the row anyway: a grid should state what it plays, including where it plays nothing, and a reviewer reading one entry should not have to know which tracks exist to know what it sounds like. `tom` and `bass` are all-false on all nine, because the sources say nothing about either and inventing a tom fill is exactly the thing this change exists to stop.
- **Verbatim means verbatim, including where it looks wrong.** `techno-rolling` and `dubstep-halftime` have no `clap` in the source, and `techno-rolling` has no `snare` — a techno grid with no backbeat. That is what the source specifies. It is on the Listening checklist; if it sounds wrong, that is a listening finding with a name, not a licence to invent a row here.
- **Measured near-collision, recorded rather than smoothed over.** `funky-drummer` and the newly-corrected `funk` differ on **one playable row only** — `clap` (`funk` has 4,12; `funky-drummer` has none). They are not a silent duplicate and the sweep will not flag them, but a listener will hear two nearly-identical grids in the menu. That is the honest consequence of taking the source verbatim, and it is on the Listening checklist.
- **Insert all nine as one new section at the END of the table**, in survey order. `meterRegression.test.ts:144` asserts the *ordered* list of 4/4 ids in `DRUM_GRIDS` insertion order; a block at the end makes that edit an append rather than nine interleavings.
- Kits reuse the kit of the genre each derives from — the grid menu writes grid and kit in one action, so a variant that loaded a different kit would sound like a different genre, not a variant of one.

- [ ] **Step 1: Write the nine failing tests and the third id group**

In `src/data/drumGrids.test.ts`, add below `VIBE_GRID_IDS`:

```ts
// A third origin, and it earns its own list for the same reason the first two
// have theirs: where an entry came from is what explains its shape. These nine
// are transcriptions — each is one source's canonical pattern and nothing else,
// which is why several have rows the genre would normally fill.
const SOURCED_GRID_IDS = [
  'techno-rolling',
  'synthwave-attack',
  'dubstep-halftime',
  'trap-quarter-hat',
  'boombap-8th-hat',
  'lofi-ghost-kick',
  'funky-drummer',
  'rock-driving-8th',
  'reggae-rockers',
];
```

Change `const ALL_IDS = [...GENRE_GRID_IDS, ...VIBE_GRID_IDS];` to `const ALL_IDS = [...GENRE_GRID_IDS, ...VIBE_GRID_IDS, ...SOURCED_GRID_IDS];`, add the nine `'4/4'` entries to the `METERS` map, and rename the first test to `'holds exactly the 31 grid ids — 14 sequencer genres, 8 vibe grids and 9 sourced variants'`.

Add a row-set test beside the two that exist:

```ts
  test('the sourced variants define all seven genre rows and nothing else', () => {
    // All seven, including the ones their source is silent about. A grid
    // should STATE what it plays, including where it plays nothing: a reviewer
    // reading one entry should not need to know which tracks exist to know
    // what it sounds like. (It was also load-bearing until replaceDrumPattern
    // landed, when an omitted row left the previous grid's hits playing.)
    for (const id of SOURCED_GRID_IDS) {
      expect(Object.keys(DRUM_GRIDS[id].rows).sort()).toEqual([...GENRE_ROWS].sort());
    }
  });
```

And the nine transcription tests:

```ts
describe('the nine sourced variants transcribe one source each', () => {
  const on = (id: string, row: string) =>
    DRUM_GRIDS[id].rows[row].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const ALL_SIXTEEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const STRAIGHT_EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];

  test('techno-rolling is four-on-the-floor under rolling 16ths, offbeat opens (Attack Magazine, Motor City)', () => {
    expect(on('techno-rolling', 'kick')).toEqual([0, 4, 8, 12]);
    expect(on('techno-rolling', 'hihat')).toEqual(ALL_SIXTEEN);
    expect(on('techno-rolling', 'openhat')).toEqual([2, 6, 10, 14]);
    // The source specifies no backbeat. Written as authored, not invented into.
    expect(on('techno-rolling', 'snare')).toEqual([]);
  });

  test('synthwave-attack is the 1-3-and-a kick with a backbeat and 16th hats (Attack Magazine, synthwave drums)', () => {
    expect(on('synthwave-attack', 'kick')).toEqual([0, 8, 15]);
    expect(on('synthwave-attack', 'snare')).toEqual([4, 12]);
    expect(on('synthwave-attack', 'hihat')).toEqual(ALL_SIXTEEN);
  });

  test('dubstep-halftime is one kick and one snare a bar, and nothing else (Unison)', () => {
    expect(on('dubstep-halftime', 'kick')).toEqual([0]);
    expect(on('dubstep-halftime', 'snare')).toEqual([8]);
    expect(on('dubstep-halftime', 'hihat')).toEqual([]);
  });

  test('trap-quarter-hat claps the half-bar over quarter-note hats (Reason Studios trap cheat sheet)', () => {
    expect(on('trap-quarter-hat', 'kick')).toEqual([0, 6, 10]);
    expect(on('trap-quarter-hat', 'clap')).toEqual([8]);
    expect(on('trap-quarter-hat', 'hihat')).toEqual([0, 4, 8, 12]);
    expect(on('trap-quarter-hat', 'openhat')).toEqual([6]);
  });

  test('boombap-8th-hat is the 0-6-8 kick with a backbeat and straight 8ths (Attack Magazine, 90s boom bap)', () => {
    expect(on('boombap-8th-hat', 'kick')).toEqual([0, 6, 8]);
    expect(on('boombap-8th-hat', 'snare')).toEqual([4, 12]);
    expect(on('boombap-8th-hat', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
  });

  test('lofi-ghost-kick adds a ghost kick on the last 8th (Native Instruments, lo-fi hip hop beats)', () => {
    expect(on('lofi-ghost-kick', 'kick')).toEqual([0, 8, 14]);
    expect(on('lofi-ghost-kick', 'snare')).toEqual([4, 12]);
    expect(on('lofi-ghost-kick', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
  });

  test('funky-drummer is the Stubblefield kick with 16th hats opening on the e of 2 and 4 (Roland)', () => {
    // Differs from the corrected `funk` on CLAP ALONE — funk claps 4,12, this
    // has no clap because the source has none. Measured, recorded, and left as
    // transcribed: they are two entries because they came from two places.
    expect(on('funky-drummer', 'kick')).toEqual([0, 7, 10]);
    expect(on('funky-drummer', 'snare')).toEqual([4, 12]);
    expect(on('funky-drummer', 'hihat')).toEqual(ALL_SIXTEEN);
    expect(on('funky-drummer', 'openhat')).toEqual([5, 13]);
  });

  test('rock-driving-8th kicks every 8th under the backbeat (Fundamental Changes, backbeat)', () => {
    expect(on('rock-driving-8th', 'kick')).toEqual(STRAIGHT_EIGHTHS);
    expect(on('rock-driving-8th', 'snare')).toEqual([4, 12]);
    expect(on('rock-driving-8th', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
  });

  test('reggae-rockers is four-on-the-floor with the snare on 3 (Soundbrenner, rockers rhythm)', () => {
    // Rockers, not one drop: the kick plays all four beats. That is exactly
    // what separates it from the corrected `reggae` entry, which kicks only 3.
    expect(on('reggae-rockers', 'kick')).toEqual([0, 4, 8, 12]);
    expect(on('reggae-rockers', 'snare')).toEqual([8]);
    expect(on('reggae-rockers', 'hihat')).toEqual(STRAIGHT_EIGHTHS);
    expect(on('reggae-rockers', 'openhat')).toEqual([14]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bun test src/data/drumGrids.test.ts`

Expected: FAIL. The id-set test reports nine missing keys; the nine transcription tests throw on `DRUM_GRIDS['techno-rolling'].rows` being undefined.

- [ ] **Step 3: Author the nine grids**

Append to `src/data/drumGrids.ts`, after `afro-six-eight-bell`'s closing `},` and before the table's closing `};`:

```ts

  // --- Sourced genre variants (survey Part 3) ---
  //
  // Each of these is ONE source's canonical pattern, transcribed, and nothing
  // else. Where a source is silent about a row, the row is present and empty:
  // a grid should STATE what it plays, including where it plays nothing, so a
  // reviewer reading one entry does not have to know which tracks exist to
  // know what it sounds like. `tom` and `bass` are all-false on all nine — no
  // source specifies either, and inventing a tom fill is the exact thing this
  // whole change exists to stop.
  //
  // The two twelve-step entries from the same survey table
  // (`bembe-standard-bell`, `jazz-waltz-ride`) are SLICE 2: both are defined by
  // a row the schema does not have yet.
  'techno-rolling': {
    name: 'Techno Rolling 16ths',
    meter: '4/4',
    kit: 'Warehouse',
    provenance: 'attackmagazine.com/technique/beat-dissected/motor-city-detroit-techno/',
    rows: {
      kick:    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      hihat:   [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
      openhat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'synthwave-attack': {
    name: 'Synthwave Attack',
    meter: '4/4',
    kit: 'Retro Drive',
    provenance: 'attackmagazine.com/technique/beat-dissected/synthwave-drums/',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, true],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'dubstep-halftime': {
    name: 'Dubstep Half-Time',
    meter: '4/4',
    kit: 'Sub Weight',
    provenance: 'unison.audio/how-to-make-dubstep/',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihat:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'trap-quarter-hat': {
    name: 'Trap Quarter Hat',
    meter: '4/4',
    kit: 'Trap Beat',
    provenance: 'reasonstudios.com/news/post/trap-drum-basics-super-neat-beat-cheat-sheet',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      hihat:   [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      openhat: [false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'boombap-8th-hat': {
    name: 'Boom Bap 8th Hat',
    meter: '4/4',
    kit: '808 Vintage',
    provenance: 'attackmagazine.com/technique/beat-dissected/90s-boom-bap-hip-hop/',
    rows: {
      kick:    [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'lofi-ghost-kick': {
    name: 'Lo-Fi Ghost Kick',
    meter: '4/4',
    kit: 'Lo-Fi Vinyl',
    provenance: 'blog.native-instruments.com/lo-fi-hip-hop-beats/',
    rows: {
      kick:    [true, false, false, false, false, false, false, false, true, false, false, false, false, false, true, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'funky-drummer': {
    name: 'Funky Drummer',
    meter: '4/4',
    kit: 'Tight Pocket',
    // MEASURED: this differs from the corrected `funk` entry on CLAP ALONE
    // (funk claps 4,12; this source specifies none). They stay two entries
    // because they came from two places, and the ghost-note velocities that
    // actually separate them are not storable in a boolean grid (survey
    // Part 4). Do not collapse them and do not add a clap to make them differ.
    provenance: 'articles.roland.com/behind-the-beat-funky-drummer-by-james-brown/',
    rows: {
      kick:    [true, false, false, false, false, false, false, true, false, false, true, false, false, false, false, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
      openhat: [false, false, false, false, false, true, false, false, false, false, false, false, false, true, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'rock-driving-8th': {
    name: 'Rock Driving 8ths',
    meter: '4/4',
    kit: 'Acoustic Studio',
    provenance: 'fundamental-changes.com/learn-to-play-backbeat-on-drums/',
    rows: {
      kick:    [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      snare:   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
  'reggae-rockers': {
    name: 'Reggae Rockers',
    meter: '4/4',
    kit: 'Warm Riddim',
    provenance: 'soundbrenner.com/blogs/articles/rockers-rhythm',
    rows: {
      kick:    [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
      snare:   [false, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
      hihat:   [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
      openhat: [false, false, false, false, false, false, false, false, false, false, false, false, false, false, true, false],
      clap:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      tom:     [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
      bass:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
    },
  },
```

- [ ] **Step 4: Extend the silent-duplicate sweep over the grown library**

In `describe('what the two former tables actually share')`, change the sweep's genre side:

```ts
  test('no other vibe/genre pair is a silent duplicate', () => {
    // The sourced variants join the genre side. This is the SAME invariant over
    // a bigger library, not a new one: nine grids arrived and any of them could
    // be an accidental restatement of a vibe grid.
    const genreGrids = [...GENRE_GRID_IDS, ...SOURCED_GRID_IDS];
    const found: string[] = [];
    for (const v of VIBE_GRID_IDS) {
      for (const g of genreGrids) {
        if (DRUM_GRIDS[v].meter !== DRUM_GRIDS[g].meter) continue;
        if (playableRowsDiffer(v, g).length === 0) found.push(`${v}=${g}`);
      }
    }
    expect(found.sort()).toEqual(SILENT_DUPLICATES.map(([v, g]) => `${v}=${g}`).sort());
  });
```

- [ ] **Step 5: Extend `FOUR_FOUR_GRID_IDS`**

`src/audio/meterRegression.test.ts:126` asserts the ordered list of 4/4 ids **in `DRUM_GRIDS` insertion order**. Append the nine, in table order, and update the comment:

```ts
  // One list since the two drum-grid tables merged, plus the sourced variants
  // that arrived after: the sequencer's genre grids, the vibe grids, then the
  // nine transcriptions — in DRUM_GRIDS order.
  const FOUR_FOUR_GRID_IDS = [
    'synthwave', 'house', 'trap', 'boom-bap', 'cyberpunk', 'dnb', 'dubstep',
    'techno', 'funk', 'rock', 'reggae', 'lofi-hip-hop',
    'lofi-half-time-brush', 'synthwave-four-on-floor', 'edm-offbeat-pump',
    'ambient-sparse-drift', 'boombap-swung-break', 'zen-bamboo-pulse',
    'techno-rolling', 'synthwave-attack', 'dubstep-halftime',
    'trap-quarter-hat', 'boombap-8th-hat', 'lofi-ghost-kick',
    'funky-drummer', 'rock-driving-8th', 'reggae-rockers',
  ];
```

- [ ] **Step 6: Measure the library, do not count lines**

Run: `bun -e "const {DRUM_GRIDS}=await import('./src/data/drumGrids.ts'); console.log(Object.keys(DRUM_GRIDS).length)"`
Expected: `31`

Run: `bun run report:drums-diff`
Expected: `entries: 22 -> 31`, `0 deleted, 9 new, 22 changed`. Every one of the nine prints its `provenance` and its non-empty rows.

- [ ] **Step 7: Run the gate and commit**

Run: `bun run verify`

```
git add src/data/drumGrids.ts src/data/drumGrids.test.ts src/audio/meterRegression.test.ts
git commit -m "feat(data): author the nine sourced 4/4 drum grids — the library goes 22 to 31

Each is one source's canonical pattern, transcribed verbatim, with a source
URL as its provenance. Rows a source is silent about are present and EMPTY,
not absent: a grid should state what it plays, including where it plays
nothing. (Until replaceDrumPattern lands two tasks later, it is also
load-bearing — a merge leaves the previous grid's hits on an unnamed track.)

Two consequences taken deliberately rather than smoothed over: techno-rolling
has no backbeat and dubstep-halftime has no hats, because their sources
specify none; and funky-drummer differs from the corrected funk entry on clap
alone, because the ghost-note velocities that really separate them are not
storable in a boolean grid. Both are on the listening checklist.

The survey's two twelve-step entries are slice 2 — each is defined by a row
the schema does not have yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Task 5: Delete `edm-offbeat-pump`, move its rows into `house`, repoint `cyber-edm` — 31 → 30

**Files:**
- Modify: `src/data/drumGrids.ts` (delete one entry; `house` gains two rows), `src/data/vibes.ts:288` (the repoint), `src/data/drumGrids.test.ts` (`:30`, `:57`, `:143`, `:184`), `src/audio/meterRegression.test.ts` (one id), `src/store/instantVibesDrums.test.ts:73` (one id), `src/store/instantVibesDrumsFixture.ts` (`cyber-edm` gains `bass`), `.claude/skills/instant-vibes/SKILL.md:176`

**Interfaces:** `DRUM_GRIDS` loses the key `edm-offbeat-pump`. `house.rows` gains `tom` and `crash`, so `house` is the one grid with **eight** rows.

**Design notes for the implementer:**
- **The reason, not the mechanism.** The survey found that house and trance/festival EDM are *literally identical* on this grid — kick 0,4,8,12, backbeat 4,12, openhat 2,6,10,14 — and that sources separate them only by sound design and sidechain, never by step position. **A distinct grid cannot be authored honestly here**, so the library should not pretend to hold one. The measured duplicate the test already pins is the symptom; this is the cause.
- **The move is additive, never an overwrite.** `house` has an empty `tom` row and no `crash` row, so `tom 7,14` and `crash 0` land in empty space. A repoint that dropped them would silently make `cyber-edm` quieter the moment Task 7 lands the crash track — the failure would arrive two commits later with no obvious cause.
- **Exactly one golden-fixture value moves (spec item 23).** Repointing changes nothing on kick, snare, hihat, openhat or clap; tom and crash *move with it*; the only row `house` has that `edm-offbeat-pump` did not is `bass`. `cyber-edm`'s **sound does not change**, because `bass` is not a drum voice and stays unplayable after slice 1 and after slice 2. **If any other fixture value moves, something was edited this task did not authorise.**
- **`SILENT_DUPLICATES` becomes `[]` and the sweep is kept.** An empty expected set is the strongest form that test has ever had: any new duplicate is a failure with no allowlist to hide behind. The per-pair `for` loop over an empty array registers no tests — that is fine and intended; do not delete the loop.
- `house`'s eighth row breaks the "genre grids define all seven rows and nothing else" test. Handle it with an explicit exception table, not by loosening the assertion.

- [ ] **Step 1: Move the rows into `house`, then delete the entry**

In `src/data/drumGrids.ts`, replace `house`'s `tom` row and append a `crash` row:

```ts
      // From edm-offbeat-pump, which was deleted because house and
      // trance/festival EDM are literally identical on this grid: sources
      // separate them by sound design and sidechain, never by step position.
      // These two rows are ADDITIVE — nothing in house was replaced — and they
      // are what keeps cyber-edm's sound intact now that it points here.
      tom:     [false, false, false, false, false, false, false, true, false, false, false, false, false, false, true, false],
      bass:    [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
      crash:   [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
```

(`bass` is unchanged and shown only for placement — `crash` goes after it, so the eight rows read kick, snare, hihat, openhat, clap, tom, bass, crash.)

Then delete the whole `'edm-offbeat-pump': { … },` entry.

- [ ] **Step 2: Repoint `cyber-edm`**

`src/data/vibes.ts:288`: `drumGridId: 'edm-offbeat-pump',` → `drumGridId: 'house',`

- [ ] **Step 3: Update the fixture — the one authorised value change**

In `src/store/instantVibesDrumsFixture.ts`, add to the `'cyber-edm'` entry, after `clap` and before `tom`:

```ts
    bass:    [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
```

Add above the entry:

```ts
  // Repointed from edm-offbeat-pump to house when that grid was deleted. The
  // only value that moved is this `bass` row: kick, snare, hihat, openhat and
  // clap were byte-identical between the two grids, and edm-offbeat-pump's tom
  // and crash MOVED INTO house with the repoint. cyber-edm sounds exactly the
  // same — `bass` is not a drum voice and nothing plays it.
```

- [ ] **Step 4: Update the four sites in `drumGrids.test.ts`**

- `VIBE_GRID_IDS` (`:30`): remove `'edm-offbeat-pump'`.
- `METERS` (`:57`): remove the `'edm-offbeat-pump': '4/4',` line.
- The byte-for-byte spot-check (`:143`): replace the `edm-offbeat-pump` openhat assertion with the row that survived the move, so the deletion is still proved to have carried its content:

```ts
    // Was the edm-offbeat-pump assertion. The grid is gone; its two authored
    // rows are here, which is the thing worth pinning.
    expect(DRUM_GRIDS.house.rows.tom).toEqual([
      false, false, false, false, false, false, false, true,
      false, false, false, false, false, false, true, false,
    ]);
    expect(DRUM_GRIDS.house.rows.crash).toEqual([
      true, false, false, false, false, false, false, false,
      false, false, false, false, false, false, false, false,
    ]);
```

- `SILENT_DUPLICATES` (`:184`):

```ts
  // EMPTY, and that is the strongest form this test has ever had. Both former
  // members are gone for different reasons: edm-offbeat-pump was deleted
  // (house and festival EDM cannot be honestly distinguished on a step grid),
  // and afro-6-8's snare and hihat were corrected to the cross-stick and the
  // standard bembé bell. Any new duplicate is now a failure with no allowlist
  // to hide behind. Never add a member to make a test pass.
  const SILENT_DUPLICATES: Array<[string, string]> = [];
```

The 22-id test's name becomes `'holds exactly the 30 grid ids — 14 sequencer genres, 7 vibe grids and 9 sourced variants'`.

- [ ] **Step 5: Let `house` have eight rows, explicitly**

Replace the genre row-set test:

```ts
  // house is the one grid with eight rows: it absorbed edm-offbeat-pump's
  // `crash` when that entry was deleted. An explicit exception table, not a
  // loosened assertion — the next grid to grow a row should have to come here
  // and say so.
  const EXTRA_ROWS: Record<string, string[]> = { house: ['crash'] };

  test('the sequencer genre grids define all seven of their rows, and only house has an eighth', () => {
    for (const id of GENRE_GRID_IDS) {
      expect(Object.keys(DRUM_GRIDS[id].rows).sort()).toEqual(
        [...GENRE_ROWS, ...(EXTRA_ROWS[id] ?? [])].sort(),
      );
    }
  });
```

- [ ] **Step 6: Update the three remaining references**

- `src/audio/meterRegression.test.ts`: remove `'edm-offbeat-pump'` from `FOUR_FOUR_GRID_IDS`.
- `src/store/instantVibesDrums.test.ts:73`: in the sorted list, `'edm-offbeat-pump'` → `'house'` — and move it, since the list is asserted sorted: it now sits between `'boombap-swung-break'` and `'lofi-half-time-brush'`.
- `.claude/skills/instant-vibes/SKILL.md:176`: the "Two pairs (`edm-offbeat-pump`/`house`, `afro-six-eight-bell`/`afro-6-8`) are identical…" sentence is now false in every clause. Replace with:

```
   table** — a vibe may reference any of the 30, and the sequencer menu offers
   all 30. The CONTENT still did not merge: measured, no vibe's grid matches
   its own genre entry best. There are no silent duplicates left —
   `edm-offbeat-pump` was deleted and `afro-6-8` was corrected — and
   `src/data/drumGrids.test.ts` pins that set as EMPTY.
```

- [ ] **Step 7: Verify the sound did not move**

Run: `bun test src/store/instantVibesDrums.test.ts`
Expected: PASS. The golden fixture is the proof: seven vibes byte-identical, `cyber-edm` differing by the one authorised `bass` row.

Run: `bun -e "const {DRUM_GRIDS}=await import('./src/data/drumGrids.ts'); console.log(Object.keys(DRUM_GRIDS).length, 'edm-offbeat-pump' in DRUM_GRIDS)"`
Expected: `30 false`

Run: `bun run report:drums-diff`
Expected: `entries: 22 -> 30`, `1 deleted, 9 new`, and `~ house` showing `+ row crash` and the `tom` change.

- [ ] **Step 8: Run the gate and commit**

Run: `bun run verify`

```
git add src/data/drumGrids.ts src/data/drumGrids.test.ts src/data/vibes.ts src/audio/meterRegression.test.ts src/store/instantVibesDrums.test.ts src/store/instantVibesDrumsFixture.ts .claude/skills/instant-vibes/SKILL.md
git commit -m "feat(data): delete edm-offbeat-pump, fold its rows into house, repoint cyber-edm

House and trance/festival EDM are literally identical on a step grid — kick
0,4,8,12, backbeat 4,12, offbeat opens — and sources separate them only by
sound design and sidechain. A distinct grid cannot be authored honestly here,
so the library stops pretending to hold one. Library 31 -> 30.

The move is additive: house's empty tom row and its missing crash row take
edm-offbeat-pump's tom 7,14 and crash 0. Dropping them would have made
cyber-edm quieter the moment the crash track lands, two commits later, with
no obvious cause.

Exactly one golden-fixture value moves — cyber-edm gains house's bass row,
and bass is not a drum voice, so the sound is unchanged. SILENT_DUPLICATES
becomes [] and the sweep is kept: an empty expected set is the strongest form
that test has ever had.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Task 6: The drum axis becomes an id pool, and the decoration machinery is deleted

**Files:**
- Modify: `src/types.ts:205-232`; `src/data/vibes.ts` (the interface field, the 8 pools, the `drumGridId` doc comment); `src/store/vibeVariation.ts`; `src/store/vibeVariation.test.ts`; `src/store/vibeVariationFixtures.ts`

**Interfaces:**
- Produces, from `@/data/vibes`: `VibeRandomRule.drumGrids: string[]` replaces `drumDecoration: DrumDecorationRule`.
- Produces, from `./vibeVariation`: `VariationSummary` loses `drums: Array<{layer, density}>` and gains `drumGridId: string` and `drumGridName: string`. **`resolveVibeVariation`'s `current` parameter is UNCHANGED** — three fields, as today.
- Produces, from the store: **nothing.** No slice gains a field; `src/components/vibeActions.ts` is not touched.
- **Removed from `src/types.ts`:** `DrumDecorationRule`, `DecorationLayer`, `DensityName`.
- **Removed from `src/store/vibeVariation.ts`:** `DRUM_DENSITIES`, `DRUM_DENSITY_METER`, `densityRowFor`, `DECORATION_ORDER`, `LAYER_LABELS`, `COLLISION_FILTERED`, `collidesWithKick`, `eligibleDensities`, `rollDecoration`.
- **`eligibleFor` is KEPT.** It is the generic `pickDistinct` uses for every axis, not decoration machinery.

**Design notes for the implementer:**
- **No new concept is introduced.** The drum axis stops being the one axis with bespoke machinery and becomes the fourth id pool, the same shape as `progressions`, `chordRhythms` and `bassPatterns`. `VibeSpec.drumGridId` is unchanged and stays the vibe's authored grid; `random.drumGrids` is the set the dice may land on.
- **The kick-collision filter is deliberately not replaced.** `collidesWithKick` existed to constrain *generated* rows: a density picked at random for `openhat` or `tom` could land on the kick and mud the downbeat. Authored grids are curated — a human chose every cell — and **real music has reasons to double a kick**. A crash on beat 1 over a kick on beat 1 is standard, and `house`'s `crash 0` against `kick 0,4,8,12` is now an example in the library. Porting the filter would reject grids for being correct.
- **`draw.pick`, not `pickDistinct` — and the reason is the finding, not a shortcut.** Three id axes use `pickDistinct` and it needs a `current` value. Measured: there is **no fourth `current` field to give it.** `scaleRoot`, `chordRhythmId` and `bassPatternId` are store fields; the playing drum grid id is `useState` local to `SequencerView` (`:55`) and `applyVibeToStore` never writes it. So the drum axis follows the fourth axis instead — `progressions`, which uses plain `draw.pick` two lines away in the same function (`vibeVariation.ts:201`).

  The rejected alternative was an `activeDrumGridId` in the sequencer slice, written by both `applyVibeToStore` and the sequencer menu. **That is a second source of truth for the playing grid**, and the failure is silent: miss one writer and `pickDistinct` excludes the wrong id, leaving pool invariant 1 true on paper and false in the running app, with no test able to tell. A field two callers must remember to write is a field that will eventually not be written.

  **Accepted cost, stated rather than buried: consecutive rolls can repeat a grid** — at the same 1-in-N the progression axis already accepts, and with pools of 3 to 4 members that is a 25–33% chance per roll. It is the honest trade for not inventing state.
- **Do NOT move `SequencerView`'s local `selectedGridId` into the store**, then or ever. That component runs `useEffect(… onChangeSoundKit(DRUM_GRIDS[selectedGridId].kit) …)`, and a vibe's `soundKit` may legitimately differ from its grid's `kit` — a store-driven `selectedGridId` would let that effect overwrite the vibe's chosen kit with the grid's. It stays a `useState`.
- **Two pool invariants, and exactly two** (spec item 9). No meter constraint: trim-or-loop is the project's documented rule and is surfaced by `patternMeterTitle` / `patternOptionLabel` in the menus, so forcing same-meter membership would make the dice stricter than the menu three inches from it. No minimum pool size: `VibeRandomRule`'s own doc comment already settles it — *"A ONE-MEMBER ARRAY IS LEGITIMATE."*
- **Which vibes exercise cross-meter pooling, and why** (the spec leaves this to the plan). Two: `lofi-waltz` pools `lofi-ghost-kick` and `afro-six-eight` pools `reggae-rockers`. Both are 4/4 grids trimmed to 12 by `adaptStepRow` — **verified by evaluation, not guessed**: `lofi-ghost-kick` becomes kick 0,8 / snare 4 / hihat 0,2,4,6,8,10; `reggae-rockers` becomes kick 0,4,8 / snare 8 / hihat 0,2,4,6,8,10, with its openhat 14 trimmed away entirely. Both are real 12-step rhythms. Every other pool is authored same-meter, which is the default the spec asks for.

- [ ] **Step 1: Write the failing pool tests**

In `src/store/vibeVariation.test.ts`, inside `describe('authored random data')`, **delete** these five tests outright (they are the decoration invariants, and the machinery they test is going away):

- `'densities has an entry for every layer in layers and no others'`
- `'every layer the random rule can draw is a key of that vibe's authored drumPattern'`
- `'after the kick-collision filter, openhat and tom still have a candidate'`
- `'the filter removes exactly one candidate across all authored data'`
- `'no vibe lists a candidate that is silent in that vibe's own meter'`

Add in their place the two pool invariants and nothing else:

```ts
  test('the dice can always land back on the vibe as authored — drums included', () => {
    // The sibling assertions for keys, chord rhythms, bass patterns and
    // progressions already exist in the test above. This is the fifth axis
    // joining them, which is the whole point of the change: the drum axis is
    // no longer special.
    for (const v of VIBES) {
      expect(v.random!.drumGrids, v.id).toContain(v.drumGridId);
    }
  });

  test('every id in every drum pool resolves', () => {
    for (const v of VIBES) {
      for (const id of v.random!.drumGrids) {
        expect(DRUM_GRIDS[id], `${v.id} -> ${id}`).toBeDefined();
      }
    }
  });

  test('a pool may cross meters, and two do — deliberately', () => {
    // NOT an invariant, a record of a taste decision. Trim-or-loop is the
    // project's documented rule for a pattern whose meter differs from the
    // transport's, and the sequencer, chord and bass menus already surface it.
    // Forcing same-meter membership in the dice alone would make the dice
    // stricter than the menu three inches from it.
    const crossMeter = VIBES.flatMap((v) =>
      v.random!.drumGrids
        .filter((id) => DRUM_GRIDS[id].meter !== v.meter)
        .map((id) => `${v.id}=${id}`),
    );
    expect(crossMeter.sort()).toEqual([
      'afro-six-eight=reggae-rockers',
      'lofi-waltz=lofi-ghost-kick',
    ]);
  });
```

Add `import { DRUM_GRIDS } from '@/data/drumGrids';` to that block's imports; drop `import type { DecorationLayer } from '../types';` and the local `COLLISION_FILTERED` constant.

- [ ] **Step 2: Run them and watch them fail**

Run: `bun test src/store/vibeVariation.test.ts -t "drum pool"`

Expected: FAIL — `v.random!.drumGrids` is `undefined`, so `toContain` throws. That is the field's absence, which is the right failure.

- [ ] **Step 3: Change the type and author the eight pools**

In `src/data/vibes.ts`, replace the last field of `VibeRandomRule`:

```ts
  /**
   * Ids into DRUM_GRIDS. Always contains the vibe's own drumGridId.
   *
   * The same shape as the three pools above, and that is the point: the drum
   * axis used to be the one axis with bespoke machinery — a decoration rule
   * that rewrote four rows of the authored grid from a density catalogue — and
   * it is now the fourth id pool. A reroll REPOINTS the grid; it does not
   * decorate one.
   *
   * A member may be in a different meter from the vibe. Trim-or-loop is the
   * project's rule for that everywhere else, so the dice is not made stricter
   * than the menus. Two pools use the permission on purpose; the rest are
   * authored same-meter.
   */
  drumGrids: string[];
```

and remove `DrumDecorationRule` from the `import type { … } from '@/types';` list at the top of the file.

Replace each vibe's `drumDecoration: { … }` block with its pool:

`lofi-chill`:
```ts
      // Its own grid, the corrected genre entry, and the two hip-hop
      // transcriptions closest to it. All 4/4.
      drumGrids: ['lofi-half-time-brush', 'lofi-hip-hop', 'lofi-ghost-kick', 'boombap-8th-hat'],
```

`synthwave-80s`:
```ts
      drumGrids: ['synthwave-four-on-floor', 'synthwave', 'synthwave-attack', 'techno-rolling'],
```

`cyber-edm`:
```ts
      // house is now this vibe's authored grid (edm-offbeat-pump was deleted).
      // The rest are the four-on-the-floor family it can move through without
      // stopping being dance music.
      drumGrids: ['house', 'techno', 'techno-rolling', 'dubstep-halftime'],
```

`deep-ambient`:
```ts
      // Three sparse grids. dubstep-halftime is one kick and one snare a bar,
      // which is the sparsest thing in the library after ambient-sparse-drift.
      drumGrids: ['ambient-sparse-drift', 'dubstep-halftime', 'zen-bamboo-pulse'],
```

`boom-bap`:
```ts
      drumGrids: ['boombap-swung-break', 'boom-bap', 'boombap-8th-hat', 'funky-drummer'],
```

`zen-garden`:
```ts
      drumGrids: ['zen-bamboo-pulse', 'ambient-sparse-drift', 'dubstep-halftime'],
```

`lofi-waltz`:
```ts
      // Three twelve-step grids plus ONE cross-meter member. lofi-ghost-kick is
      // 4/4 and adaptStepRow trims it to this vibe's 12 steps — measured, it
      // lands as kick 0,8 / snare 4 / hihat 0,2,4,6,8,10, which is a real 3/4
      // lo-fi bar rather than a fragment.
      drumGrids: ['waltz-brush-three', 'waltz', 'afro-6-8', 'lofi-ghost-kick'],
```

`afro-six-eight`:
```ts
      // Three twelve-step grids plus ONE cross-meter member. reggae-rockers is
      // 4/4 and trims to kick 0,4,8 / snare 8 / hihat 0,2,4,6,8,10 in this
      // vibe's 12 steps; its openhat 14 trims away entirely. Measured, not
      // assumed — trim takes the FIRST 12 steps.
      drumGrids: ['afro-six-eight-bell', 'afro-6-8', 'waltz', 'reggae-rockers'],
```

Also delete the "hihat and crash are exempt from the kick-collision filter…" comment above `lofi-waltz`'s block and the equivalent one on `afro-six-eight` — the filter is gone and a comment about it is a stale symbol in prose.

- [ ] **Step 4: Delete the decoration types**

`src/types.ts`: delete lines 205–232 — the `DecorationLayer` doc comment and type, the `DensityName` type, and the whole `DrumDecorationRule` interface. Nothing else in that file references them (verify with `bun run lint`, not with grep).

- [ ] **Step 5: Rewrite `vibeVariation.ts`**

Delete, in order: the `import type { DecorationLayer, DensityName, DrumDecorationRule } from '../types';` line; `DRUM_DENSITIES`; `DRUM_DENSITY_METER`; `densityRowFor`; `DECORATION_ORDER`; `LAYER_LABELS`; `COLLISION_FILTERED`; `collidesWithKick`; `eligibleDensities`; `rollDecoration`. **Keep `eligibleFor`, `VibeDraw`, `createDraw`, `RerollToast`.**

The `getMeter` / `MeterId` and `adaptStepRow` imports become unused with `densityRowFor` — delete both import lines. Add:

```ts
import { drumGridById } from '@/audio/drumGrids';
```

(`store/` → `audio/` is the allowed direction; `engineSync.ts` reaches the engine the same way. `drumGridById` returns a **fresh deep copy** of the rows on every call, which is what keeps the library authoritative once the drawn rows flow into store state.)

In `VariationSummary`, replace the `drums` field:

```ts
  /** The grid the dice landed on. Unambiguous where two grids share a name. */
  drumGridId: string;
  /** Its display name — what to look for in the sequencer's grid menu. */
  drumGridName: string;
```

Replace `resolveVibeVariation`'s docblock draw-order paragraph and the `rollDecoration` call:

```ts
/**
 * Rerolls a vibe into a different piece of music from its own pools.
 *
 * Takes and returns a ResolvedVibe, and hands the caller something
 * applyVibeToStore can apply directly. There is deliberately no second apply
 * path — that is what keeps the hard-stop-on-swap fix from regressing.
 *
 * Starts from the AUTHORED vibe every time — never from the current store — so
 * rerolls never compound, and overwrites exactly seven fields: scaleRoot, bpm,
 * chordRhythmId, bassPatternId, progressionId/chords, drumGridId and
 * drumPattern. `scaleType` is copied, never drawn: it is the genre anchor.
 *
 * Draw order is part of the contract, because a scripted draw depends on it:
 * scaleRoot, bpm, chordRhythmId, bassPatternId, progression, drumGrid. SIX
 * draws, always — it used to be five plus one per decoration layer.
 */
```

The signature is **unchanged**: `current` keeps its three fields. Then, replacing the `stepsPerBar` / `rollDecoration` block:

```ts
  // PLAIN pick, following progressions two lines above — not pickDistinct like
  // keys/chordRhythms/bassPatterns. Those three have a `current` to exclude;
  // the playing grid id is not in the store at all (SequencerView holds it in a
  // useState and applyVibeToStore never writes it). Manufacturing one would
  // mean a second source of truth that two callers must remember to write, and
  // the failure is SILENT: miss a writer and pickDistinct excludes the wrong
  // id, leaving "the dice can land back on the vibe as authored" true in the
  // test and false in the app. The cost is that two rolls in a row can repeat a
  // grid, at the same odds the progression axis already accepts.
  const drumGridId = draw.pick(rule.drumGrids);
  const grid = drumGridById(drumGridId);
  if (!grid) {
    throw new Error(`Vibe "${vibe.id}" lists unknown drum grid "${drumGridId}"`);
  }
```

In the returned vibe, add `drumGridId,` and set `drumPattern: grid.rows,`. In the summary, replace `drums,` with `drumGridId, drumGridName: grid.name,`.

Finally, the toast:

```ts
export function formatVariationSummary(summary: VariationSummary): RerollToast {
  return {
    headline: `🎲 ${summary.vibeName} — ${summary.scaleRoot} ${summary.scaleType} · ${summary.bpm} BPM`,
    detail: [
      summary.progressionRoman,
      summary.rhythmName,
      summary.bassPatternName,
      // The grid's display name, not a layer/density list. Shorter AND more
      // useful: a listener who hears the drums change can now be told what to
      // look for in the sequencer's grid menu. There is no `drums: bare` case
      // any more — a reroll always lands on a grid.
      `drums: ${summary.drumGridName}`,
    ].join(' · '),
  };
}
```

- [ ] **Step 6: Delete the "a reroll does NOT repoint this" comment**

`src/data/vibes.ts`, the `drumGridId` doc comment. The disagreement it documents no longer exists — the dice picks a grid id, `resolveVibe` resolves it, and `resolved.drumGridId` names the grid actually playing, exactly as `progressionId` already behaves. **Delete the paragraph; do not rewrite it into a weaker version.** What remains:

```ts
  /**
   * Library reference into DRUM_GRIDS — any of the 30, not a vibe-only subset:
   * the sequencer's genre grids and the vibes' own grids are one library.
   * A reroll REPOINTS this, the same way it repoints `progressionId`: the dice
   * draws from `random.drumGrids` and the resolved vibe's `drumGridId` always
   * names the grid actually playing.
   */
  drumGridId: string;
```

- [ ] **Step 7: Rewrite the rest of `vibeVariation.test.ts`**

Delete these describe-blocks entirely — every one of them tests machinery that no longer exists:

- `describe('DRUM_DENSITIES')` (3 tests)
- `describe('decoration layer metadata')` (2 tests)
- `describe('eligibleDensities')` (2 tests)
- `describe('DRUM_DENSITIES is a 4/4 catalogue, adapted to the vibe it decorates')` (7 tests, including `'THE TRAP: pickup and fillTail lose every hit in a 12-step bar'` — that trap belonged to the catalogue and dies with it)

Inside `describe('resolveVibeVariation')`, delete `'the drum skeleton is never rerolled'`, `'no drawn openhat or tom row shares a step with the authored kick'` and `'the collision filter actually narrows the pool — a script requesting the collision-only index throws'`. Replace the drum assertions in `'a scripted draw produces one exact, nameable vibe'` and `'the catalogue rows are copied, not aliased into the vibe'` with:

```ts
  test('the drawn grid is what plays, and drumGridId names it', () => {
    const authored = resolveVibe(VIBES.find((v) => v.id === 'lofi-chill')!);
    const { vibe: out, summary } = resolveVibeVariation(
      authored,
      authoredCurrent(authored),
      firstDraw,
    );
    // The old contract let drumGridId and drumPattern legitimately disagree.
    // They cannot any more, and this is the test that says so.
    expect(out.drumPattern).toEqual(DRUM_GRIDS[out.drumGridId].rows);
    expect(summary.drumGridId).toBe(out.drumGridId);
    expect(summary.drumGridName).toBe(DRUM_GRIDS[out.drumGridId].name);
  });

  test('the library rows are copied, not aliased into the vibe', () => {
    const authored = resolveVibe(VIBES.find((v) => v.id === 'lofi-chill')!);
    const { vibe: out } = resolveVibeVariation(authored, authoredCurrent(authored), firstDraw);
    expect(out.drumPattern.kick).not.toBe(DRUM_GRIDS[out.drumGridId].rows.kick);
  });

  test('the drum axis is a plain pick, so every pool member is reachable', () => {
    // pickDistinct would make this test impossible to write: the vibe's own
    // grid would be permanently excluded. Plain pick means every member is
    // reachable INCLUDING the authored one, which is what makes pool
    // invariant 1 true in the app and not only in the invariant test.
    // scriptedDraw indexes the raw pool, since there is no `current` to skip.
    for (const spec of VIBES) {
      const authored = resolveVibe(spec);
      const pool = spec.random!.drumGrids;
      const landed = pool.map((_, di) => {
        const { vibe: out } = resolveVibeVariation(
          authored,
          authoredCurrent(authored),
          scriptedDraw([0, 0, 0, 0, 0, di]),
        );
        return out.drumGridId;
      });
      expect(landed, spec.id).toEqual(pool);
    }
  });
```

In `describe('formatVariationSummary')`, the shared `BASE: VariationSummary` constant (`:561`) ends `drums: []`; replace that line with `drumGridId: 'lofi-half-time-brush',` and `drumGridName: 'Lo-Fi Half-Time Brush',`. Every test in the block spreads `...BASE` with a `drums:` override — delete each of those overrides. Delete `'layers drawn as off are omitted, in DECORATION_ORDER'` and `'an all-off draw reads drums: bare rather than an empty segment'` outright: neither has a subject any more. Replace the drum expectation in `'the detail is four dot-joined segments in a fixed order'` with `drums: Lo-Fi Half-Time Brush`, and add:

```ts
  test('the drum segment is the grid a listener can find in the menu', () => {
    // It used to read `drums: closed hat swung16ths, open hat pickup`, built
    // from layer labels and density names — accurate and unactionable. A grid
    // name is something you can go and select.
    expect(formatVariationSummary(BASE).detail.split(' · ')[3]).toBe(
      'drums: Lo-Fi Half-Time Brush',
    );
  });
```

In the enumeration harness (`:333-345`), the drum draw becomes a single index. Replace the `...drumIdx` spread with one `di` loop variable, so a scripted draw is exactly `[ki, bi, ri, si, pi, di]`.

`authoredCurrent` (`:309`) is **unchanged** — three fields, as today. That is the whole benefit of the plain `pick`: the harness, the fixtures and all three existing call sites (`:329`, `:437`, `:555`) keep their shape.

**One import note.** `vibeVariation.test.ts` interleaves import statements between describe-blocks (`:1`, `:145`, `:305`, `:559`). The `DRUM_GRIDS` import added in Step 1 sits in the `:145` group; the Step 7 tests live below `:305` and see it, because ES module imports hoist file-wide. Do not add a second one — `no-duplicate-imports` is on.

`src/store/vibeVariationFixtures.ts`: `scriptedDraw`'s scripts shorten from `5 + layers.length` entries to exactly 6. Update its docblock's draw-order sentence to match.

- [ ] **Step 8: Run the suite and the gate**

Run: `bun test`

Expected: green. `instantVibesDrums.test.ts` in particular must stay green — the pools change what a *reroll* can reach, never what a chip press applies.

Run: `bun -e "const {VIBES}=await import('./src/data/vibes.ts'); console.log(VIBES.map(v=>[v.id, v.random.drumGrids.length].join(':')).join(' '))"`
Expected: every count ≥ 3.

Run: `bun run report:library`
Expected: it now lists fewer unreferenced drum grids than before, because the pools reach 9 of the sourced variants. Whatever it lists is a fact, not a failure.

Run: `bun run verify`

- [ ] **Step 9: Commit**

```
git add src/types.ts src/data/vibes.ts src/store/vibeVariation.ts src/store/vibeVariation.test.ts src/store/vibeVariationFixtures.ts
git commit -m "refactor(store): the drum axis becomes an id pool, and the decoration machinery goes

random.drumDecoration becomes random.drumGrids: string[], the same shape as
progressions, chordRhythms and bassPatterns. No new concept — the drum axis
stops being the one axis with bespoke machinery.

Deleted: DrumDecorationRule, DecorationLayer, DensityName, DRUM_DENSITIES,
DRUM_DENSITY_METER, densityRowFor, DECORATION_ORDER, LAYER_LABELS,
COLLISION_FILTERED, collidesWithKick, eligibleDensities, rollDecoration.
eligibleFor stays — it is pickDistinct's generic, not decoration machinery.

The kick-collision filter is deliberately not replaced. It constrained
GENERATED rows; authored grids are curated, and real music has reasons to
double a kick — house's crash 0 over kick 0,4,8,12 is now an example in the
library. Porting it would reject grids for being correct.

Two pool invariants and exactly two: the pool contains the vibe's own
drumGridId, and every id resolves. No meter constraint (trim-or-loop is the
documented rule and the menus already surface it) and no minimum size (a
one-member array is legitimate).

The axis uses plain draw.pick, following progressions two lines away in the
same function, and `current` keeps its three fields. Measured: the playing
grid id is in no slice — SequencerView holds it in a useState and
applyVibeToStore never writes it — and manufacturing an activeDrumGridId
written by two callers would be a second source of truth whose failure is
silent: miss a writer and pickDistinct excludes the wrong id, leaving
invariant 1 true in the test and false in the app. Accepted cost, stated:
consecutive rolls can repeat a grid, at the odds the progression axis already
accepts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Task 7: `applyDrumPattern` becomes `replaceDrumPattern`, and replaces

**Files:**
- Modify: `src/store/sequencerSlice.ts` (the action, its body, the file docblock); `src/store/types.ts:252` (the name and its doc comment); `src/store/vibes.ts:126,136` (`applyVibeToStore`); `src/components/loop/SequencerView.tsx:36,142,145`; `src/store/store.test.ts:242-280,411`; `src/store/vibes.test.ts:456-486` (the ordering probe names the action three times); `src/store/instantVibesDrums.test.ts:40` (one comment); `src/data/drumGrids.ts:11,32` and `src/data/drumGrids.test.ts:65,156` (comments naming the old action)

**Interfaces:**
- `SequencerSlice.applyDrumPattern` → **`replaceDrumPattern`**, same signature `(pattern: Record<string, boolean[]>) => void`, **different contract**: a track the pattern does not name has its active window cleared instead of being skipped.

**Design notes for the implementer:**
- **This lands BEFORE the tom and crash tracks, and the ordering is the point.** Task 8 is what turns the merge semantics into an audible bug — the 14 sequencer genre grids declare no `crash`, so loading one after a vibe would leave the vibe's crash ringing under it. Fixing the semantics first means the bug is **never on the branch**, not even for one commit. Reversing the two would ship it and then remove it: a worse history and a worse bisect.
- **This is a bug the work introduces, not one it inherits.** Today every grid declares every row the five tracks have, so merging and replacing are the same operation and the `if (!row) return track` at `sequencerSlice.ts:34` has never been observable. Part 2 makes it worse again — nine tracks, and most grids name neither `ride` nor `bell`.
- **The fix restores semantics that already held: a drum grid determines the whole kit.** Picking "Techno" from the menu should give you techno, not techno plus whatever was left over.
- **Clearing MUST go through `writeStepWindow`.** That is what confines the clear to the active window and leaves the padding beyond `stepsPerBar` alone — the non-destructive meter scheme `CLAUDE.md` documents. Writing `steps: new Array(stepsPerBar).fill(false)` directly would truncate every track to the window width and destroy the wider-meter content silently. **`store.test.ts`'s seeded-`true`-at-index-20 assertion is the acceptance test for this step and must pass unchanged.**
- **The rename is not cosmetic and is not optional.** The contract changed: a partial call now clears everything it does not name. The old name describes the old behaviour, and leaving it would let a future caller pass one row expecting a merge. The rename is also the mechanism that forces every call site to be re-read — verified, there are exactly **two real callers** (the sequencer menu and `applyVibeToStore`) and **both already pass a whole grid**, so neither changes behaviour.
- **`store.test.ts:242-280` encodes the old contract in two assertions. Rewrite both; delete neither.** A deleted assertion is a contract nobody is checking. The `for (let i = 1; …) expect(after[i]).toEqual(before[i])` loop becomes the clearing proof, and the `{ cowbell: [true, false] }` "changes nothing" case becomes "a pattern naming only unknown instruments clears every track" — which is the sharpest possible statement of the new contract, and would have caught the stale crash on its own.

- [ ] **Step 1: Rewrite the two old-contract assertions and watch them fail**

Replace `src/store/store.test.ts:242-280`'s describe-block body. Keep the seeding preamble and the four `after[0]` assertions **exactly as they are** — they are the padding proof and they must not move. Replace only the trailing loop and the cowbell case:

```ts
    // WAS: `for (let i = 1; i < after.length; i++) expect(after[i]).toEqual(before[i]);`
    // — the old merge contract, where an unnamed track was skipped. A grid
    // determines the whole kit now, so an unnamed track is CLEARED. Rewritten,
    // not deleted: this is the assertion that says what happens to the tracks
    // the pattern is silent about, and something has to say it.
    for (let i = 1; i < after.length; i++) {
      expect(after[i].steps.slice(0, 16), after[i].instrument).toEqual(
        new Array(16).fill(false),
      );
      // ...and only the window clears. Everything past stepsPerBar is the
      // wider-meter content and survives, exactly as it does for a named row.
      expect(after[i].steps.slice(16), after[i].instrument).toEqual(
        before[i].steps.slice(16),
      );
      expect(after[i].id).toBe(before[i].id);
      expect(after[i].volume).toBe(before[i].volume);
      expect(after[i].muted).toBe(before[i].muted);
    }
  });

  test('a pattern naming only unknown instruments clears every track', () => {
    // WAS: "a pattern key with no matching instrument changes nothing".
    // The sharpest statement of the new contract, and the one that would have
    // caught the stale crash on its own: a grid with no `crash` row silences
    // the crash, rather than leaving the previous grid's ringing under it.
    const { useAppStore } = await getStore();
    const before = useAppStore.getState().sequencerTracks;
    useAppStore.getState().replaceDrumPattern({ cowbell: [true, false] });
    const after = useAppStore.getState().sequencerTracks;
    for (const [i, track] of after.entries()) {
      expect(track.steps.slice(0, 16), track.instrument).toEqual(new Array(16).fill(false));
      expect(track.steps.slice(16), track.instrument).toEqual(before[i].steps.slice(16));
    }
  });
```

(The second test needs `async` on its callback, like every other test in this file that calls `getStore()`.)

Add one test directly after, because the padding proof for a *cleared* track deserves its own name:

```ts
  test('clearing an unnamed track goes through writeStepWindow, so its padding survives', () => {
    // The failure this pins: `steps: new Array(stepsPerBar).fill(false)` looks
    // correct, passes the window assertions above, and silently truncates every
    // track to 16 — destroying the wider-meter content the non-destructive
    // scheme stores past stepsPerBar. Seeded like the kick test above, on a
    // track the pattern does NOT name.
    const { useAppStore } = await getStore();
    const initial = useAppStore.getState().sequencerTracks;
    const seeded = initial[1].steps.map((v, i) => (i === 20 ? true : v));
    useAppStore
      .getState()
      .setSequencerTracks(initial.map((t, i) => (i === 1 ? { ...t, steps: seeded } : t)));

    useAppStore.getState().replaceDrumPattern({ kick: new Array(16).fill(true) });

    const after = useAppStore.getState().sequencerTracks;
    expect(after[1].steps.length).toBe(MAX_STEPS_PER_BAR);
    expect(after[1].steps[20]).toBe(true);
    expect(after[1].steps.slice(0, 16)).toEqual(new Array(16).fill(false));
  });
```

Rename the describe-block to `describe('replaceDrumPattern')`, rename the three `applyDrumPattern(` calls in it, and add `MAX_STEPS_PER_BAR` to the file's `../utils/meter` import.

Run: `bun test src/store/store.test.ts`

Expected: FAIL — `replaceDrumPattern is not a function`. Once the rename lands (Step 2) but before the body changes, expect the *clearing* assertions to fail with `Expected: [false × 16]  Received: [true, false, ...]` on the snare — the old merge behaviour, caught by the new contract.

- [ ] **Step 2: Rename the action**

`src/store/types.ts:252`:

```ts
  /**
   * Write a whole drum grid onto the sequencer.
   *
   * REPLACES, it does not merge. A track whose instrument the pattern does not
   * name has its active window CLEARED — a drum grid determines the whole kit,
   * so picking "Techno" gives you techno and not techno plus leftovers.
   *
   * It was `applyDrumPattern` and it skipped unnamed tracks. That was invisible
   * while every grid declared every row the five tracks had; it became a bug
   * the moment `tom` and `crash` tracks existed, because the 14 sequencer genre
   * grids declare no `crash` and a vibe's crash would ring on underneath one.
   */
  replaceDrumPattern: (pattern: Record<string, boolean[]>) => void;
```

Rename at all four production sites: `src/store/sequencerSlice.ts:28`, `src/store/vibes.ts:136` (and the comment at `:126`), `src/components/loop/SequencerView.tsx:36` and `:145` (and the comment at `:142`). Rename in `src/store/store.test.ts:411` (the action-name list) and at the four sites in `src/store/vibes.test.ts:467,474,475,476,483,486` — that test's ordering probe monkey-patches the action by name, so a missed rename there is a test that silently stops probing anything.

- [ ] **Step 3: Make it replace**

`src/store/sequencerSlice.ts`, the action body:

```ts
    // Apply-time adaptation (see the spec, "Where adaptation happens differs by
    // target"): the user edits this grid, so an incoming pattern is adapted to
    // the active bar length HERE and materialised into state. Trimming at
    // playback instead would make the UI lie, showing steps that never sound.
    //
    // REPLACES, does not merge. A track the pattern does not name is cleared,
    // because a drum grid determines the whole kit. Clearing goes through
    // writeStepWindow like every other write, so it clears only the ACTIVE
    // WINDOW and the padding past stepsPerBar — the wider-meter content —
    // survives. Assigning `new Array(stepsPerBar).fill(false)` straight to
    // `steps` would pass every window assertion and silently truncate the
    // track; store.test.ts seeds a `true` at index 20 to catch exactly that.
    replaceDrumPattern: (pattern) =>
      set((state) => {
        const stepsPerBar = getMeter(state.meterId).stepsPerBar;
        return {
          sequencerTracks: state.sequencerTracks.map((track) => {
            const row = pattern[track.instrument];
            const next = row
              ? adaptStepRow(row, stepsPerBar)
              : new Array(stepsPerBar).fill(false);
            return {
              ...track,
              steps: writeStepWindow(track.steps, stepsPerBar, next),
            };
          }),
        };
      }),
```

Update the file's head docblock: `` `applyDrumPattern` maps the drum-pattern hits onto the matching tracks by instrument `` → `` `replaceDrumPattern` writes a whole grid: matching tracks take their row, every other track is cleared in its window. ``

- [ ] **Step 4: Run the acceptance test, then the suite**

Run: `bun test src/store/store.test.ts -t "replaceDrumPattern"`

Expected: PASS, including the **unchanged** seeded-`true`-at-index-20 assertion on the kick. If that one is red, the clear bypassed `writeStepWindow`.

Run: `bun test`

Expected green, and check three files specifically:
- `src/store/instantVibesDrums.test.ts` — it asserts on `drumGridById(...).rows`, not on tracks, so it is untouched. Only its `:40` comment mentions the old name.
- `src/store/vibes.test.ts:456-486` — the `setMeter` before `replaceDrumPattern` ordering probe. It must still assert `['setMeter', 'replaceDrumPattern']`; if it now reports one entry, a rename was missed and the monkey-patch is patching a key that no longer exists.
- `src/store/loop.test.ts` and the meter tests — none call the action, but they hold the padding invariants this step could break.

- [ ] **Step 5: Confirm the two real callers still pass whole grids**

Run: `grep -rn "replaceDrumPattern(" src --include="*.ts" --include="*.tsx" | grep -v test`

Expected: exactly two hits — `SequencerView.tsx:145` passing `grid.rows` and `vibes.ts:136` passing `vibe.drumPattern`. **Both are whole grids, so neither changes behaviour today.** If a third appears, read it: a partial call is now a destructive call.

- [ ] **Step 6: Fix the four comments that describe the old contract**

`src/data/drumGrids.ts:11` and `:32`, and `src/data/drumGrids.test.ts:65` and `:156`, all say the action "looks a row up by the sequencer track's instrument name and ignores every row that matches none". The first half is still true; the second half is now backwards. Rewrite each to: *"looks a row up by the sequencer track's instrument name; a track no row names is cleared."* Task 10's fence check re-verifies these.

- [ ] **Step 7: Run the gate and commit**

Run: `bun run verify`

```
git add src/store/sequencerSlice.ts src/store/types.ts src/store/vibes.ts src/components/loop/SequencerView.tsx src/store/store.test.ts src/store/vibes.test.ts src/store/instantVibesDrums.test.ts src/data/drumGrids.ts src/data/drumGrids.test.ts
git commit -m "fix(store): applyDrumPattern becomes replaceDrumPattern, and replaces

A drum grid determines the whole kit. A track the pattern does not name has
its window cleared instead of being skipped.

This lands BEFORE the tom and crash tracks on purpose. The merge semantics
have been invisible because every grid declares every row the five tracks
have; the moment a crash track exists, the 14 sequencer genre grids declare no
crash and a vibe's crash rings on underneath one. That is a bug this work
introduces, so it is fixed before the commit that would introduce it — never
on the branch, not even once.

Clearing goes through writeStepWindow, so only the active window clears and
the padding past stepsPerBar survives. store.test.ts's seeded-true-at-index-20
proof passes unchanged and is the acceptance test for that; assigning a fresh
stepsPerBar-wide array would pass every window assertion and truncate the
track silently.

The rename is the contract change made visible, and it forces every call site
to be re-read. Verified: two real callers, both already passing whole grids,
so no behaviour changes today.

store.test.ts's two old-contract assertions are rewritten, not deleted — a
deleted assertion is a contract nobody checks. 'a pattern key with no matching
instrument changes nothing' becomes 'a pattern naming only unknown instruments
clears every track', which would have caught the stale crash on its own.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Task 8: `tom` and `crash` sequencer tracks, and the `withDrumTracks` transform

**Files:**
- Modify: `src/store/initialState.ts`, `src/store/initialState.test.ts`

**Interfaces:**
- Produces, from `src/store/initialState.ts`:
  - `INITIAL_SEQUENCER_TRACKS` grows from 5 entries to **7** (`tom` at `bg-primary`, `crash` at `bg-info`).
  - `function withDrumTracks(tracks: SequencerTrack[]): SequencerTrack[]` — idempotent, appends only.

**Design notes for the implementer:**
- **This is not a DSP change.** `DRUM_KITS` already synthesises both (`TomParams` and `CrashParams` are two of the six param interfaces), `engine.triggerDrum` already has `case 'tom'` and `case 'crash'`, and `DEFAULT_PADS` already plays them on `Comma`, `Period` and `Slash`. **Only the sequencer tracks were missing.** This is the change that makes 30 authored rows and 29 authored hits audible for the first time.
- **Colours: `tom` → `bg-primary`, `crash` → `bg-info`.** The five existing tracks use `bg-error`, `bg-warning`, `bg-success`, `bg-accent`, `bg-secondary`, which left `bg-primary`, `bg-info` and `bg-neutral` unused among `THEME_TOKENS`' eight non-surface entries.
  > **Named here so slice 2 is not surprised.** Eight non-surface tokens, seven tracks after this task, **nine after slice 2's ride and bell** — so nine tracks cannot each hold a distinct semantic token. Slice 2's expected choice is **`ride` sharing `bg-info` with `crash`** (both are cymbals, and a shared hue reads as a family) and **`bell` taking the last free token, `bg-neutral`**. That is a recommendation, not a commitment; the alternatives are an opacity variant or changing how a track's colour is chosen.
- **`withDrumTracks` appends *any* missing canonical track, not just `tom` and `crash`.** That is what lets slice 2 reuse it unchanged. One consequence, stated so it is not discovered: a payload holding only two tracks comes back with seven, so a hand-edited `.solna` that deleted a track gets it back — silent, all-false. Verified: **`SequencerView` has no delete-track control**, so no user can reach that state through the app; only a hand-edited file can.
- **Appended tracks must be fresh objects with fresh `steps` arrays.** `INITIAL_SEQUENCER_TRACKS` is a module constant and `sequencerSlice` already hands it to the store by reference; appending the *same* object into two different loops' track arrays would make toggling a step in one loop toggle it in the other. `loopSlice.ts:51` already copies for exactly this reason.
- **The transform runs BEFORE `sanitize`** in both chains, so its input can hold junk. The `?.` and the cast in `present` are there for that and nothing else.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/initialState.test.ts`:

```ts
describe('withDrumTracks', () => {
  const kick = INITIAL_SEQUENCER_TRACKS[0];

  test('a 5-track payload becomes 7, and the first five are THE SAME OBJECTS', () => {
    // toBe, not toEqual. A toEqual assertion passes against a withDrumTracks
    // that rebuilds every track from defaults and happens to reproduce the
    // same values today; toBe fails against it. That distinction is the whole
    // point of the transform: a user's renamed, recoloured, muted,
    // reprogrammed track must come back as THE SAME OBJECT, not an equal one.
    const before = INITIAL_SEQUENCER_TRACKS.slice(0, 5).map((t) => ({
      ...t,
      name: `${t.name} (mine)`,
      muted: true,
    }));
    const after = withDrumTracks(before);
    expect(after).toHaveLength(7);
    for (let i = 0; i < 5; i += 1) expect(after[i]).toBe(before[i]);
    expect(after.map((t) => t.instrument).slice(5)).toEqual(['tom', 'crash']);
  });

  test('the appended tracks are silent — no existing session changes sound', () => {
    const after = withDrumTracks(INITIAL_SEQUENCER_TRACKS.slice(0, 5));
    expect(after[5].steps.some(Boolean)).toBe(false);
    expect(after[6].steps.some(Boolean)).toBe(false);
  });

  test('the appended tracks do not share arrays with the module constant', () => {
    // Two loops each run this over their own tracks. If the appended track
    // were the module object, toggling a tom step in one loop would toggle it
    // in the other and in INITIAL_SEQUENCER_TRACKS itself.
    const a = withDrumTracks(INITIAL_SEQUENCER_TRACKS.slice(0, 5));
    const b = withDrumTracks(INITIAL_SEQUENCER_TRACKS.slice(0, 5));
    expect(a[5]).not.toBe(b[5]);
    expect(a[5].steps).not.toBe(b[5].steps);
    expect(a[5].steps).not.toBe(INITIAL_SEQUENCER_TRACKS[5].steps);
  });

  test('running it twice is running it once', () => {
    const once = withDrumTracks(INITIAL_SEQUENCER_TRACKS.slice(0, 5));
    const twice = withDrumTracks(once);
    expect(twice).toEqual(once);
    // And the second pass is a no-op by identity, not just by value.
    expect(twice).toBe(once);
  });

  test('an already-complete array comes back untouched, by identity', () => {
    expect(withDrumTracks(INITIAL_SEQUENCER_TRACKS)).toBe(INITIAL_SEQUENCER_TRACKS);
  });

  test('it never rewrites a track that is present', () => {
    const renamed = [{ ...kick, name: 'My Kick', color: 'bg-custom-brand', muted: true }];
    const after = withDrumTracks(renamed);
    expect(after[0]).toBe(renamed[0]);
    expect(after[0].name).toBe('My Kick');
    expect(after[0].color).toBe('bg-custom-brand');
  });

  test('a 2-track payload gains the other five, silent', () => {
    // Consequence worth pinning: it appends ANY missing canonical track, which
    // is what lets slice 2 reuse it unchanged for ride and bell. Nothing in
    // the app can delete a track, so only a hand-edited .solna reaches here.
    const after = withDrumTracks(INITIAL_SEQUENCER_TRACKS.slice(0, 2));
    expect(after.map((t) => t.instrument)).toEqual([
      'kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash',
    ]);
    for (const t of after.slice(2)) expect(t.steps.some(Boolean)).toBe(false);
  });

  test('an empty array becomes the full canonical set', () => {
    expect(withDrumTracks([])).toHaveLength(7);
  });
});

describe('INITIAL_SEQUENCER_TRACKS', () => {
  test('seven tracks, each on its own semantic theme token', () => {
    expect(INITIAL_SEQUENCER_TRACKS.map((t) => t.instrument)).toEqual([
      'kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash',
    ]);
    const colors = INITIAL_SEQUENCER_TRACKS.map((t) => t.color);
    expect(colors).toEqual([
      'bg-error', 'bg-warning', 'bg-success', 'bg-accent', 'bg-secondary',
      'bg-primary', 'bg-info',
    ]);
    // Eight non-surface tokens exist. Seven tracks now, NINE after slice 2's
    // ride and bell — so slice 2 cannot give every track a distinct token and
    // has to repeat one, use an opacity variant, or change how a track's
    // colour is chosen. Recorded here so that is a decision, not a surprise.
    expect(new Set(colors).size).toBe(7);
  });

  test('every track stores a full-width bar', () => {
    for (const t of INITIAL_SEQUENCER_TRACKS) {
      expect(t.steps.length, t.instrument).toBe(MAX_STEPS_PER_BAR);
    }
  });
});
```

Add `withDrumTracks` to the `./initialState` import and `MAX_STEPS_PER_BAR` from `../utils/meter`.

- [ ] **Step 2: Run them and watch them fail**

Run: `bun test src/store/initialState.test.ts`

Expected: FAIL on the import — `withDrumTracks` is not exported — and, once the export exists as a stub, on `toHaveLength(7)` receiving 5.

- [ ] **Step 3: Add the two tracks**

In `src/store/initialState.ts`, directly above `INITIAL_SEQUENCER_TRACKS`:

```ts
/**
 * One empty bar at the widest storable width. Spread at each use site, never
 * shared: two tracks holding the same array would toggle together.
 */
const SILENT_BAR: boolean[] = [
  false, false, false, false, false, false, false, false,
  false, false, false, false, false, false, false, false,
  false, false, false, false, false, false, false, false,
];
```

and append two entries to the array, after `track-clap`:

```ts
  {
    id: 'track-tom',
    name: 'Tom',
    instrument: 'tom',
    steps: [...SILENT_BAR],
    volume: 0.8,
    muted: false,
    color: 'bg-primary',
  },
  {
    id: 'track-crash',
    name: 'Crash',
    instrument: 'crash',
    steps: [...SILENT_BAR],
    volume: 0.7,
    muted: false,
    color: 'bg-info',
  },
```

- [ ] **Step 4: Add `withDrumTracks`**

Directly below `INITIAL_SEQUENCER_TRACKS`:

```ts
/**
 * Backfill any canonical drum track a payload is missing, appending only.
 *
 * The shared pure transform BOTH migration chains call — the persist chain's
 * migrateDrumTracks and the .solna chain's upgradeDrumTracksV5. It is the
 * `defaultPadState()` of this change: shared DATA-shaped logic, called from two
 * separate upgrade steps that must never be merged into one function. A project
 * body is an external contract, the persist payload is private localStorage
 * shape, and their version numbers move for different reasons (CLAUDE.md).
 *
 * APPENDS ONLY. A track whose `instrument` is already present is returned as
 * THE SAME OBJECT — a user who renamed, recoloured, muted or reprogrammed it
 * keeps it exactly. An already-complete array is returned by identity.
 *
 * IDEMPOTENT, which is what lets slice 2 reuse it unchanged for `ride` and
 * `bell`: it adds whatever is missing from INITIAL_SEQUENCER_TRACKS, so
 * growing that constant grows this transform with no edit here.
 *
 * NO EXISTING SESSION OR .solna FILE CHANGES SOUND. An appended track is
 * silent: its steps are all false. The new rows are heard only when a grid or
 * a vibe is applied afterwards, which is a deliberate user action — the same
 * discipline upgradePadLayerV4 follows with `padMuted: true`.
 */
export function withDrumTracks(tracks: SequencerTrack[]): SequencerTrack[] {
  // The cast and the `?.` are because this runs BEFORE sanitize in both
  // chains, so an element can be anything a JSON file held.
  const present = new Set(
    tracks.map((track) => (track as Partial<SequencerTrack> | null)?.instrument),
  );
  const missing = INITIAL_SEQUENCER_TRACKS.filter((t) => !present.has(t.instrument));
  if (missing.length === 0) return tracks;
  // Fresh objects AND fresh steps arrays. Each loop in a payload runs this over
  // its own tracks, and appending the module constant itself would make two
  // loops share one bar — toggling a tom step in one would toggle it in the
  // other, and in INITIAL_SEQUENCER_TRACKS. loopSlice.ts copies for the same
  // reason.
  return [...tracks, ...missing.map((t) => ({ ...t, steps: [...t.steps] }))];
}
```

- [ ] **Step 5: Run the tests and the suite**

Run: `bun test src/store/initialState.test.ts`
Expected: PASS.

Run: `bun test`

Expected: **`store.test.ts:198` (`expect(s.sequencerTracks).toEqual(INITIAL_SEQUENCER_TRACKS)`) stays green** — it compares against the constant, so it follows. Any red here is a test that hard-coded 5 and should be found now, not in Task 8.

- [ ] **Step 6: Run the gate and commit**

Run: `bun run verify` — `check:theme` is not in the chain; run `bun run check:theme` as well, since two new colour tokens land here.

```
git add src/store/initialState.ts src/store/initialState.test.ts
git commit -m "feat(store): add the tom and crash sequencer tracks, and withDrumTracks

Not a DSP change: DRUM_KITS already synthesises both, triggerDrum has both
cases, and the drum pads already play them on Comma/Period/Slash. Only the
sequencer tracks were missing — this is what makes 30 authored rows and 29
authored hits audible for the first time.

tom takes bg-primary and crash bg-info, the two unused non-surface theme
tokens. THEME_TOKENS has eight; seven tracks now, NINE after slice 2's ride
and bell, so slice 2 has to repeat a token, use an opacity variant or change
how a track's colour is chosen. Pinned in a test comment so that is a
decision rather than a surprise at the end of slice 2.

withDrumTracks appends only and never rewrites a present track — the test
asserts the first five come back by toBe, not toEqual, because a transform
that rebuilt every track from defaults would pass toEqual today. It appends
any missing canonical track, not only tom and crash, which is what lets slice
2 reuse it unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Task 9: Wire `withDrumTracks` into both chains — persist 12 → 13, project format 4 → 5

**Files:**
- Modify: `src/store/migrate.ts`, `src/store/store.ts`, `src/store/migrate.test.ts`, `src/store/projectFormatMigrate.ts`, `src/store/projectFormat.ts`, `src/store/projectFormatMigrate.test.ts`, `src/store/store.test.ts:883,918`

**Interfaces:**
- Produces, from `src/store/migrate.ts`: `function migrateDrumTracks<T extends object>(state: T): T`.
- Produces, from `src/store/projectFormatMigrate.ts`: `upgradeDrumTracksV5` (module-private, like its siblings).
- `PERSIST version: 12 → 13`; `PROJECT_FORMAT_VERSION: 4 → 5`.

**Design notes for the implementer:**
- **Never merge the chains.** They share `withDrumTracks` and nothing else — the same relationship `migratePadLayer` and `upgradePadLayerV4` have with `defaultPadState()`, and `projectFormatMigrate.ts`'s own docblock records why. Each chain keeps its own traversal (`mapLoops` vs `mapBodyLoops`) even though the two do the same thing.
- **Where `sequencerTracks` actually lives, measured — and one place the spec named that does not apply.** `partializeAppState` is an explicit allow-list and **does not include a top-level `sequencerTracks`**; the live flat copy is the working copy of the active loop and is kept in sync by `loopSync`. So in a *current* persist payload it lives only inside `loops[]`. It can still appear at the top level of a **pre-v6 flat payload** — `store.test.ts:865-919` writes exactly such a payload — but `wrapFlatStateIntoLoop` runs earlier in the chain and has already turned it into a loop by the time this step sees it. **Keep the top-level branch anyway**, as a guarded no-op, and say in the comment that it is belt-and-braces: a hand-written or legacy payload can carry a stale top-level key, and a `Array.isArray` guard costs nothing.
- **The project body has no top-level `sequencerTracks` at all.** `PROJECT_CONTENT_KEYS` is `['bpm','meterId','masterVolume','effects','loops']`, so the `.solna` step maps `loops[]` and nothing else. Do not add a top-level branch there — it would be dead code claiming a key exists.
- **Both steps must be pure and non-mutating**, like every sibling. Neither is required to be a no-op on an already-current payload, but `withDrumTracks` happens to be one, and that is a property, not a licence to drop the version gate. The gate is what guarantees single application; `upgradeLeadTicksV3`'s docblock records what happened the one time a step tried to make itself self-idempotent instead.
- **Test each chain separately.** A test that exercises one and assumes the other is how the two chains drift into one.

- [ ] **Step 1: Write the persist-chain test and watch it fail**

Append to `src/store/migrate.test.ts`:

```ts
describe('v12 -> v13: the tom and crash tracks reach every loop', () => {
  const fiveTracks = () =>
    INITIAL_SEQUENCER_TRACKS.slice(0, 5).map((t) => ({ ...t, steps: [...t.steps] }));

  test('every loop in the payload gains the two tracks, silent', () => {
    const out = migrateDrumTracks({
      loops: [
        { id: 'a', sequencerTracks: fiveTracks() },
        { id: 'b', sequencerTracks: fiveTracks() },
      ],
    }) as { loops: Array<{ sequencerTracks: SequencerTrack[] }> };
    for (const loop of out.loops) {
      expect(loop.sequencerTracks.map((t) => t.instrument).slice(5)).toEqual(['tom', 'crash']);
      for (const t of loop.sequencerTracks.slice(5)) expect(t.steps.some(Boolean)).toBe(false);
    }
    // Two loops, two separate bars. Sharing one would make a tom edit in loop
    // a show up in loop b.
    expect(out.loops[0].sequencerTracks[5].steps).not.toBe(
      out.loops[1].sequencerTracks[5].steps,
    );
  });

  test("a user's programmed track survives by reference", () => {
    const mine = { ...INITIAL_SEQUENCER_TRACKS[0], name: 'My Kick', muted: true };
    const out = migrateDrumTracks({ loops: [{ id: 'a', sequencerTracks: [mine] }] }) as {
      loops: Array<{ sequencerTracks: SequencerTrack[] }>;
    };
    expect(out.loops[0].sequencerTracks[0]).toBe(mine);
  });

  test('a stale top-level sequencerTracks is backfilled too', () => {
    // Belt and braces: partialize does not persist a top-level copy and the
    // v5->v6 wrap runs first, so this branch should never fire in practice. A
    // legacy or hand-written payload can still carry the key, and the guard
    // costs nothing.
    const out = migrateDrumTracks({ sequencerTracks: fiveTracks() }) as {
      sequencerTracks: SequencerTrack[];
    };
    expect(out.sequencerTracks).toHaveLength(7);
  });

  test('a payload with no loops and no tracks passes through', () => {
    expect(migrateDrumTracks({ bpm: 120 })).toEqual({ bpm: 120 });
  });

  test('a non-array sequencerTracks is left alone for sanitize to refuse', () => {
    const out = migrateDrumTracks({ loops: [{ id: 'a', sequencerTracks: 'nope' }] }) as {
      loops: Array<{ sequencerTracks: unknown }>;
    };
    expect(out.loops[0].sequencerTracks).toBe('nope');
  });

  test('it does not mutate its input', () => {
    const input = { loops: [{ id: 'a', sequencerTracks: fiveTracks() }] };
    migrateDrumTracks(input);
    expect(input.loops[0].sequencerTracks).toHaveLength(5);
  });
});
```

Run: `bun test src/store/migrate.test.ts` — FAIL, `migrateDrumTracks` is not exported.

- [ ] **Step 2: Add the persist step**

At the end of `src/store/migrate.ts`:

```ts
/**
 * v12 -> v13: every loop's sequencer gains the `tom` and `crash` tracks, so the
 * 30 authored tom/crash rows in DRUM_GRIDS become audible.
 *
 * Shares only the pure withDrumTracks transform with the .solna chain's
 * upgradeDrumTracksV5 in projectFormatMigrate.ts, and must NOT be refactored
 * into one function with it: a project body is an external contract, the
 * persist payload is private localStorage shape, and their version numbers move
 * for different reasons.
 *
 * The appended tracks are silent, so a reopened session sounds exactly the way
 * it sounded when it was closed — the same discipline migratePadLayer follows
 * with padMuted: true.
 *
 * The top-level branch is belt-and-braces. partializeAppState does not persist
 * a top-level sequencerTracks, and wrapFlatStateIntoLoop (v5 -> v6) runs
 * earlier in the chain, so a pre-v6 flat payload is already a loop by the time
 * this sees it. A legacy or hand-written payload can still carry the key.
 */
export function migrateDrumTracks<T extends object>(state: T): T {
  const mapped = mapLoops(state, (row) => ({
    ...row,
    sequencerTracks: Array.isArray(row.sequencerTracks)
      ? withDrumTracks(row.sequencerTracks as SequencerTrack[])
      : row.sequencerTracks,
  }));
  const next = { ...(mapped as Record<string, unknown>) };
  if (Array.isArray(next.sequencerTracks)) {
    next.sequencerTracks = withDrumTracks(next.sequencerTracks as SequencerTrack[]);
  }
  return next as unknown as T;
}
```

Extend the existing imports: `import { defaultPadState, withDrumTracks } from './initialState';` and add `import type { SequencerTrack } from '../types';` (or extend the existing type import from that module).

- [ ] **Step 3: Bump the persist version and add the chain line**

`src/store/store.ts`: `version: 12,` → `version: 13,`, and one more line at the bottom of the ordered chain, directly after the v11→v12 line:

```ts
        // v12 -> v13 (tom + crash sequencer tracks)
        if (version < 13) next = migrateDrumTracks(next) as PersistedState;
```

Add `migrateDrumTracks` to the `from './migrate'` import list.

- [ ] **Step 4: Fix the two rehydration colour lists**

`src/store/store.test.ts:883` — the version-2 payload now rehydrates with seven tracks:

```ts
    expect(colors).toEqual([
      'bg-error',
      'bg-warning',
      'bg-success',
      'bg-accent',
      'bg-secondary',
      // Appended by the v12 -> v13 backfill, on top of the v2 -> v3 recolour.
      // Both ran, in version order, and neither touched the other's tracks.
      'bg-primary',
      'bg-info',
    ]);
```

`src/store/store.test.ts:918` — the version-3 payload holds only two tracks, so the backfill appends five:

```ts
    // Two tracks in, seven out: withDrumTracks appends any missing canonical
    // track, not only tom and crash. The user's bg-custom-brand snare is
    // untouched, which is the thing this test was always about.
    expect(colors).toEqual([
      'bg-error',
      'bg-custom-brand',
      'bg-success',
      'bg-accent',
      'bg-secondary',
      'bg-primary',
      'bg-info',
    ]);
```

- [ ] **Step 5: Write the project-chain test and watch it fail**

Append to `src/store/projectFormatMigrate.test.ts`:

```ts
describe('v4 -> v5: a project body gains the tom and crash tracks', () => {
  const body = (loops: unknown[]) => ({ formatVersion: 4, content: { loops } });
  const fiveTracks = () =>
    INITIAL_SEQUENCER_TRACKS.slice(0, 5).map((t) => ({ ...t, steps: [...t.steps] }));

  test('a body from before the tracks opens with both, silent', () => {
    const out = migrateProjectBody(body([{ id: 'a', sequencerTracks: fiveTracks() }]), 4) as {
      content: { loops: Array<{ sequencerTracks: SequencerTrack[] }> };
    };
    const tracks = out.content.loops[0].sequencerTracks;
    expect(tracks.map((t) => t.instrument).slice(5)).toEqual(['tom', 'crash']);
    for (const t of tracks.slice(5)) expect(t.steps.some(Boolean)).toBe(false);
  });

  test('a body already at the current version is not re-backfilled', () => {
    const current = body([{ id: 'a', sequencerTracks: INITIAL_SEQUENCER_TRACKS }]);
    const out = migrateProjectBody(current, 5) as {
      content: { loops: Array<{ sequencerTracks: SequencerTrack[] }> };
    };
    expect(out.content.loops[0].sequencerTracks).toHaveLength(7);
  });

  test('a body with no loops passes through', () => {
    expect(migrateProjectBody({ formatVersion: 4, content: { bpm: 120 } }, 4)).toEqual({
      formatVersion: 4,
      content: { bpm: 120 },
    });
  });

  test('the two chains are separate functions, and stay separate', () => {
    // The sibling of the existing assertion for the lead chain. They share
    // withDrumTracks — a pure transform — and nothing else. A project body is
    // an external contract; the persist payload is private localStorage shape.
    expect(migrateProjectBody).not.toBe(migrateDrumTracks);
  });
});
```

Run: `bun test src/store/projectFormatMigrate.test.ts` — FAIL, the tracks come back at length 5.

- [ ] **Step 6: Add the project-chain step and bump the format version**

In `src/store/projectFormatMigrate.ts`, after `upgradePadLayerV4`:

```ts
/**
 * v4 -> v5: every loop gains the `tom` and `crash` sequencer tracks, so a
 * reopened project can play the tom and crash rows its drum grids always had.
 *
 * Shares only the pure withDrumTracks transform with the persist chain's
 * migrateDrumTracks, and must not be refactored into one function with it: a
 * project body is an external contract, the persist payload is private
 * localStorage shape, and their version numbers move for different reasons.
 *
 * `loops` only. A project body has no top-level sequencerTracks — the content
 * set is PROJECT_CONTENT_KEYS and sequencerTracks is a per-loop field — so a
 * top-level branch here would be dead code claiming a key exists.
 *
 * The appended tracks are silent, so a project written before they existed
 * reopens sounding the way it sounded when it was closed.
 */
function upgradeDrumTracksV5(raw: Record<string, unknown>): Record<string, unknown> {
  return mapBodyLoops(raw, (loop) => ({
    ...loop,
    sequencerTracks: Array.isArray(loop.sequencerTracks)
      ? withDrumTracks(loop.sequencerTracks as SequencerTrack[])
      : loop.sequencerTracks,
  }));
}
```

and one line in `migrateProjectBody`:

```ts
  if (fromVersion < 5) next = upgradeDrumTracksV5(next);
```

`src/store/projectFormat.ts`: `export const PROJECT_FORMAT_VERSION = 5;`, and extend its docblock:

```ts
/**
 * The `.solna` / IndexedDB format version. Deliberately separate from the
 * persist `version` in store.ts: that one bumps for private localStorage
 * reshapes, this one only when the content contract changes. The persist
 * migration chain must never be used to read a project body.
 *
 * v5 adds the `tom` and `crash` sequencer tracks to every loop. It moved in
 * the same change as persist v13 and by coincidence only — the two numbers
 * answer different questions and must never be assumed to track each other.
 */
```

- [ ] **Step 7: Run both chains' tests, then the whole suite**

Run: `bun test src/store/migrate.test.ts src/store/projectFormatMigrate.test.ts src/store/store.test.ts src/store/projectFormat.test.ts`
Expected: PASS.

Run: `bun test`

- [ ] **Step 8: Run the gate and commit**

Run: `bun run verify`

```
git add src/store/migrate.ts src/store/store.ts src/store/migrate.test.ts src/store/projectFormatMigrate.ts src/store/projectFormat.ts src/store/projectFormatMigrate.test.ts src/store/store.test.ts
git commit -m "feat(store): backfill the tom and crash tracks through both migration chains

persist 12 -> 13 and PROJECT_FORMAT_VERSION 4 -> 5, as two separate steps in
two separate chains that share only the pure withDrumTracks transform. Never
merged: a project body is an external contract, the persist payload is
private localStorage shape, and their version numbers move for different
reasons. withDrumTracks is this change's defaultPadState().

Measured, against the spec's assumption: partializeAppState does NOT persist a
top-level sequencerTracks — the flat copy is the working copy of the active
loop — so a current persist payload holds tracks only inside loops[]. The
top-level branch stays as a guarded no-op for legacy and hand-written
payloads. A project body has no top-level copy at all, so its step maps loops
and nothing else.

No existing session or .solna file changes sound: an appended track is silent.
The new rows are heard only when a grid or a vibe is applied afterwards, which
is a deliberate user action.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Task 10: Docs sweep

**Files:**
- Modify: `CLAUDE.md`, `.claude/skills/instant-vibes/SKILL.md`, `docs/design.md`, the head comment of `src/data/drumGrids.ts`, the head comment of `src/store/vibeVariation.ts`

**Design notes for the implementer:**
- **The named risk, from a previous branch on this repo: a stale symbol left inside a code fence while the prose above it was updated.** A fence reads as example code and gets copied; a wrong symbol in one is worse than a wrong sentence, because it compiles in a reader's head. `SKILL.md:141` is exactly that shape today — `drumDecoration: { layers: [...], densities: { ... } },` inside the `random` template. **Check every fence explicitly**, not just the prose.
- Do not record counts that will go stale for other reasons. Where a number is load-bearing (30 grids; 7 tracks; 8 non-surface tokens), write it with the rule that produced it.

- [ ] **Step 1: `CLAUDE.md`**

In the vibe paragraph (currently ~`:78-85`), replace:

```
The two tables that merged into it disagreed on cell type and row set, and neither
mattered: only 0 and 1 were ever authored, and `applyDrumPattern` looks a row up by
the sequencer track's instrument name and drops every row matching none — which is
also why `tom`, `bass` and `crash` cells are authored intent that nothing plays
until a track for them exists.
```

with:

```
**A drum grid determines the whole kit.** `replaceDrumPattern` looks a row up by
the sequencer track's instrument name and **clears every track no row names** — so
picking a grid gives you that grid, never that grid plus leftovers. It was
`applyDrumPattern` and it merged, which was invisible while every grid declared
every row the five tracks had and became a bug the moment `tom` and `crash` tracks
existed. Clearing goes through `writeStepWindow`, so only the active window clears
and the wider-meter padding survives. `bass` cells remain authored intent that
nothing will ever play — `DRUM_KITS` has no bass voice, by design. Every grid still
writes every row its origin group defines, empty or not, because a grid should
state what it plays. Each entry also carries a `provenance` — a source URL or the literal `'authored'` —
and the `'authored'` set is an allowlist in `drumGrids.test.ts`, so shipping an
unsourced grid is a name a reviewer sees rather than the default when nobody
looked.
```

Add a paragraph after it:

```
**The dice repoints the drum grid; it does not decorate one.** All five reroll axes
are id pools now (`keys`, `progressions`, `chordRhythms`, `bassPatterns`,
`drumGrids`), and four of the five use `pickDistinct` — `progressions` alone uses
plain `pick`. A rerolled vibe's `drumGridId` therefore always names the grid
actually playing. The density catalogue and the kick-collision filter that used to
sit behind this axis are deleted, deliberately: they constrained GENERATED rows,
and authored grids are curated — a crash on beat 1 over a kick on beat 1 is
standard, not a clash, and porting the filter would reject grids for being correct.
```

- [ ] **Step 2: `.claude/skills/instant-vibes/SKILL.md` — prose AND fences**

- **`:141`, inside the `random` fence** — this is the named risk. `drumDecoration: { layers: [...], densities: { ... } },` → `drumGrids: ['lofi-half-time-brush', 'lofi-hip-hop', 'lofi-ghost-kick', 'boombap-8th-hat'],`
- **`:155`**, the invariant sentence: `pins all five` → `pins all six`, and append `` , `drumGrids ∋ drumGridId` `` to the list.
- **`:165-185`**, the whole "Drum decoration is the fiddliest part" section. Retitle it **"The drum axis is a pool like every other axis"** and replace its four numbered rules with two:

```
`random.drumGrids` is a list of ids into `DRUM_GRIDS` — the same shape as
`progressions`, `chordRhythms` and `bassPatterns`. A reroll REPOINTS the vibe's
grid; nothing is rewritten in place any more. Two rules bite, and only two:

1. **The pool contains the vibe's own `drumGridId`**, so the dice can land back on
   the vibe as authored, and **every id resolves**. There is no meter constraint
   (trim-or-loop is the documented rule and the menus already surface it) and no
   minimum pool size (a one-member array says "this axis is deliberately fixed").
2. **The grid you point at must define every row its origin group defines**, each
   exactly one bar of that grid's own meter. `replaceDrumPattern` clears every
   track no row names, so an omitted row no longer leaks the previous grid's hits
   — but a grid should still state what it plays, including where it plays nothing.

The eight vibe grids, the sequencer's fourteen genre grids and the nine sourced
variants are **one table** of 30; a vibe may pool any of them and the sequencer menu
offers all of them. There are no silent duplicates left: `edm-offbeat-pump` was
deleted (house and festival EDM cannot be honestly distinguished on a step grid) and
`afro-6-8` was corrected, so `drumGrids.test.ts` pins that set as **empty**.
```

- **`:186-215`**, the "Tests that pin exact counts" table: the `vibeVariation.test.ts` row's "the two scale guards; the dice lands back on the vibe as authored" is still right; add "; the two drum-pool invariants". The `instantVibesDrumsFixture.ts` row's "every vibe's seven drum rows" becomes "every vibe's drum rows — seven, or eight for `cyber-edm`, which points at `house`".
- Search the whole file for `DRUM_DENSITIES`, `DecorationLayer`, `densities`, `layers`, `edm-offbeat-pump`, `applyDrumPattern`, and any `22`. Every hit must be gone or corrected. **`grep` is fine for finding candidates here; it is prose. It is not fine for counting library entries.**

- [ ] **Step 3: `docs/design.md`**

- `:145` (`SequencerView.tsx`): the description says "Multi-track step sequencer grid for drums, bass, synth, and percussion patterns". Append: `Seven tracks — kick, snare, hihat, openhat, clap, tom, crash — each on its own semantic theme token; THEME_TOKENS has eight non-surface entries, so the next two voices cannot each take a fresh one.`
- `:187` (State Management): "drum patterns" → "drum grids".
- Confirm `§4 item 3`'s Tap Tempo / stereo-VU trap entry is untouched — it is unrelated and `CLAUDE.md` records it as "unbuilt, not broken".

- [ ] **Step 4: The two head comments**

`src/data/drumGrids.ts` — rewrite the `NOTE — rows that no sequencer track can play` paragraph, which is now half false:

```
 * NOTE — the one row nothing will ever play. `INITIAL_SEQUENCER_TRACKS` now has
 * seven tracks (kick, snare, hihat, openhat, clap, tom, crash), so every `tom`
 * and `crash` cell below sounds. `bass` does not and never will: it is not a
 * drum voice at all (`DRUM_KITS` defines kick, snare, hihat, openhat, clap, tom
 * and crash, and nothing else). Those rows are kept verbatim because they are
 * what the rhythms were written as.
 *
 * `replaceDrumPattern` REPLACES: it looks a row up by the sequencer track's
 * instrument name and CLEARS every track no row names. So a grid determines
 * the whole kit, and an omitted row is not a leak any more. Write every row
 * your origin group defines anyway, even where the source is silent — a grid
 * should state what it plays, including where it plays nothing.
```

Also update the "22 entries and not 14" measurement paragraph to 30 with its reason, and add a sentence naming the three origin groups.

`src/store/vibeVariation.ts` — the file's first docblock is attached to `DRUM_DENSITIES` and dies with it. Add a real head comment above the imports:

```ts
/**
 * Rerolling a vibe: five draws from the vibe's own pools, plus a BPM.
 *
 * There is no generation here and there never was — every axis picks an id out
 * of a list a human wrote. The drum axis was the exception until it became the
 * fourth id pool: it used to hold a catalogue of named density rows and a
 * kick-collision filter, both of which existed to make GENERATED rows musical.
 * Authored grids are curated, so both are deleted; a crash on beat 1 over a
 * kick on beat 1 is standard, and filtering it out would reject a grid for
 * being correct.
 *
 * Draw order is part of the contract, because a scripted draw depends on it:
 * scaleRoot, bpm, chordRhythmId, bassPatternId, progression, drumGrid.
 */
```

- [ ] **Step 5: Check every fence, explicitly**

Run: `bun -e "const fs=require('fs'); for (const f of ['CLAUDE.md','docs/design.md','.claude/skills/instant-vibes/SKILL.md','.claude/skills/instant-vibes/references/authoring-libraries.md']) { const t=fs.readFileSync(f,'utf8'); const fences=[...t.matchAll(/\`\`\`[\s\S]*?\`\`\`/g)].map(m=>m[0]); for (const s of ['drumDecoration','DRUM_DENSITIES','DecorationLayer','DensityName','densityRowFor','edm-offbeat-pump','rollDecoration','applyDrumPattern']) fences.forEach((fence,i)=>{ if (fence.includes(s)) console.log(f, 'fence', i, 'still holds', s); }); }"`

Expected: no output. **This is the check the previous branch did not run**, and a fence is the one place a stale symbol reads as authoritative.

Then the same over prose:

Run: `grep -rn "drumDecoration\|DRUM_DENSITIES\|DecorationLayer\|DensityName\|densityRowFor\|rollDecoration\|edm-offbeat-pump\|applyDrumPattern" CLAUDE.md docs/design.md .claude/skills/ src/ | grep -v docs/superpowers`

Expected: no output outside `docs/superpowers/` (the spec and the older plans are historical records and are left alone).

- [ ] **Step 6: Run the gate and commit**

Run: `bun run verify`

```
git add CLAUDE.md docs/design.md .claude/skills/instant-vibes/SKILL.md src/data/drumGrids.ts src/store/vibeVariation.ts
git commit -m "docs: record the drum-grid rework in CLAUDE.md, the vibes skill and the head comments

The named risk from a previous branch was a stale symbol left inside a code
fence while the prose above it was updated — a fence reads as authoritative
and gets copied. SKILL.md:141 was exactly that: a drumDecoration literal in
the random-rule template. Every fence in the four docs is now checked by an
explicit script, not by reading.

Also rewrites the paragraph that described applyDrumPattern's merge, which
Task 7 replaced: a drum grid determines the whole kit, and a track no row
names is cleared in its window.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mc8K9UiXuv53pemscafxpM"
```

---

## Spec Slice 1 coverage

Every requirement in the spec's Slice 1, and the task that implements it. Walk this before calling the work done.

| spec item | requirement | task |
|---|---|---|
| 1 | Ten grids corrected to their sourced canonical pattern; `waltz` and `afro-6-8` land half right, on `hihat`, with the caveat written into the entry | 3 |
| 2 | Nine new 4/4 grids from survey Part 3; the two twelve-step entries deferred to slice 2 | 4 |
| 3 | `edm-offbeat-pump` deleted; its `tom 7,14` and `crash 0` moved into `house` additively; `cyber-edm` repointed | 5 |
| 4 | `DrumGrid.provenance: string` | 1 |
| 5 | `zen-bamboo-pulse` keeps its content with `provenance: 'authored'`, stated plainly | 1 |
| 6 | `VibeRandomRule.drumDecoration` → `drumGrids: string[]` | 6 |
| 7 | The decoration machinery deleted outright; `eligibleFor` kept; the kick filter deliberately not replaced | 6 |
| 8 | A rerolled vibe's `drumGridId` tells the truth; the doc comment deleted, not weakened; the toast becomes the grid's display name | 6 |
| 9 | Two pool invariants and exactly two; no meter constraint; no minimum size; which vibes use cross-meter pooling and why | 6 |
| 10 | The drum axis uses `draw.pick`, following the progression axis; `current` keeps its three fields | 6 |
| 10a | `applyDrumPattern` becomes `replaceDrumPattern` and replaces; clearing goes through `writeStepWindow` so padding survives | 7 |
| 11 | `tom` and `crash` sequencer tracks on semantic tokens; the eight-token trap named for slice 2 | 8 |
| 12 | One shared pure transform, two chains that never merge; both `sequencerTracks` locations; nothing changes sound | 8 (transform), 9 (wiring) |
| 17 | The verification problem stated up front | Global Constraints |
| 18 | Snapshot before, diff report after; reviewed by eye once; quoted in the commit message | 2 (script), 3 (quote) |
| 19 | Test names cite their source | 3, 4 |
| 20 | Two provenance assertions, the allowlist being the load-bearing one | 1 |
| 21 | `SILENT_DUPLICATES` goes from two pairs to zero; the sweep kept | 5 (with 3 dissolving `afro-6-8`) |
| 22 | `withDrumTracks` preserves programming by reference (`toBe`), is idempotent, covers the loop-nested case | 8 (transform), 9 (loop-nested) |
| 23 | Exactly one golden-fixture change | 5 |
| 24 | Explicit listening tasks in the plan | Listening checklist, below |

**One thing this plan does that the spec does not spell out**, recorded here rather than smuggled in: the ordering of Task 7 against Task 8. The spec states the `replaceDrumPattern` fix (item 10a) and the `tom`/`crash` tracks (item 11) in that order but does not say the order is load-bearing. It is. Task 8 is what turns the merge semantics into an audible bug, so Task 7 lands first and the bug is **never on the branch** — not for one commit, not for one bisect step. Shipping it and then removing it would be a strictly worse history for the same end state.

Two earlier findings from this plan reached the spec and changed it, so they are no longer departures:

1. **The drum axis uses `draw.pick`.** The finding was that no store field holds the playing grid id, so `pickDistinct` has no `current` to take. The spec's answer (§10) is the `progressions` precedent rather than a manufactured `activeDrumGridId`, whose failure mode would be silent.
2. **The stale crash is fixed, not deferred.** The finding was that Task 8 creates it. The spec's answer (§10a) is Task 7.

---

## Listening checklist

**Not a task, and not a thing tests can do.** `bun run verify` cannot judge whether drums sound right. Ten grids were rewritten and nine invented; every row assertion in the suite is a *transcription check against a source URL*, not a judgement that techno sounds like techno. A green gate means nothing changed by accident. It does not mean the change is good.

Run this after Task 10, in one sitting, with the app open (`bun run dev`).

**1. Load each of the ten corrected genres from the sequencer's grid menu and listen.**
`techno`, `synthwave`, `dubstep`, `trap`, `boom-bap`, `lofi-hip-hop`, `funk`, `reggae`, `waltz`, `afro-6-8`. The question is **not** "did the steps change" — `report:drums-diff` already answered that — but **"does this sound like the genre now"**. Two to listen for specifically:
- `trap`'s hat is now quarter notes, where it was all sixteen. That is the sourced pattern; the rolls that make real trap are 32nds and triplets and are not storable. If it sounds empty, that is the resolution non-goal being audible, not a mistake in this change.
- `waltz` and `afro-6-8` play a ride figure and a bembé bell **on a closed hi-hat**. The rhythm should be right and the timbre should be obviously wrong. If the timbre sounds fine, listen harder — slice 2 depends on someone hearing the difference.

**2. Audition the nine new grids, and two in particular.**
- `techno-rolling` has **no snare and no clap** and `dubstep-halftime` has **no hats** — both verbatim from their sources. Decide whether a backbeat-less techno grid earns its place in the menu. If it does not, deleting it is a content decision, not a bug fix.
- `funky-drummer` and the corrected `funk` differ on **`clap` alone**. Play them back to back. If they are indistinguishable, that is the ghost-note velocity the schema cannot hold, and the honest response is to say so — not to invent a row that separates them.

**3. Press all eight vibe chips and confirm each still sounds like itself.**
`cyber-edm` is the one to check hardest: it was repointed from a deleted grid to `house`, and the golden fixture says the only value that moved is a `bass` row nothing plays. It should be **indistinguishable** from before. If it is not, the tom/crash move in Task 5 did not land the way it was measured.

**4. Roll the dice repeatedly on each vibe, and confirm the drum grid actually changes.**
This is the first time a reroll repoints the grid rather than decorating it. Every pool has at least three members, so **every roll should land somewhere new** — watch the toast, which now names the grid, and watch the sequencer grid change under it. A vibe whose drums never move has a pool problem, not a dice problem.

**5. Listen for the two cross-meter pool members being trimmed.**
`lofi-waltz` can roll `lofi-ghost-kick` (4/4 → 12 steps: kick 0,8 / snare 4 / hihat 0,2,4,6,8,10) and `afro-six-eight` can roll `reggae-rockers` (4/4 → 12: kick 0,4,8 / snare 8 / hihat 0,2,4,6,8,10, openhat trimmed away entirely). Both should sound like a deliberate 12-step bar, not like a fragment of a 4/4 one. If either sounds truncated rather than re-felt, replace that pool member with a twelve-step grid — the permission is a design property, using it is a taste call.

**6. Compare `tom` and `crash` before and after the tracks exist.**
Thirty rows become audible at once and some of them were written by an author who could not hear them. Go through the grid menu with the tom and crash tracks unmuted and listen for a fill that lands wrong. **Fixing a bad tom row is in scope for this work** — it is the one thing on this list that can send you back into `drumGrids.ts`.

**7. Confirm a grid with no `crash` row silences a ringing crash.**
Press a vibe chip — every vibe grid has `crash 0`, so you should hear a crash on beat 1 — then pick `techno` (or any of the 14 genre grids, none of which declares a `crash` row) from the sequencer menu. **The crash must stop.** That is `replaceDrumPattern` doing what its name says, and hearing it is the only end-to-end confirmation that the Task 7 fix reached the audio rather than only the store. While you are there, check the reverse: go back to a vibe and confirm the crash returns, so the clear did not damage the track. Then switch the transport to 3/4 and repeat — the padding past `stepsPerBar` must survive a clear, and the grid should look the same when you switch back to 4/4.

**8. Say plainly, in the branch's summary, what the listening pass found.**
Including "nothing". A change whose entire justification is that its decisions are sourced deserves an equally honest record of the one decision no source can make.
