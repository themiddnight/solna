# Adjustable Lead Step Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each loop choose how fine its melody grid is — 1/8, 1/16 or 1/32 — so a run can be written inside a 16th and a slow line can be drawn without counting four cells per note, while every project that exists today opens and sounds byte-identical.

**Architecture:** The melody is stored at the finest resolution, always, and the active resolution is a *stride* over that storage — the same non-destructive windowing scheme meter already uses one dimension over. Three coordinate spaces are named once and used everywhere: a **column** is what the user clicks and what `leadCursor` holds; a **tick** is a 1/32 of a bar, what `len` counts and what the scheduler ranges over; a **stored index** is bar-major at `LEAD_TICKS_PER_BAR`. `src/utils/stepResolution.ts` is a new leaf holding the id union, the stride table and `columnsPerBar`; `src/audio/leadMelody.ts` owns every piece of tick arithmetic and is the only module that speaks stored indices, alongside the two migration chains. `leadActivePosAt` is the single place both kinds of dormancy live — outside the bar (meter) and off the grid (resolution) — and both return -1, which every existing caller already handles, so an off-grid note is silent with no branch added anywhere else. The shared clock keeps counting 16ths for the sequencer, chords, bass, arp and metronome; the lead callback owns the two-tick range inside its dispatch and fires every on-grid tick in it. The arpeggiator asks a different question of that same clock — not which pitches are held but when to strike them — so it is fed once per dispatch off the clock, never off the grid, and resolution does not change its firing schedule.

**Tech Stack:** Bun (test runner + scripts), Vite + React 19, TypeScript `strict`, Zustand with `persist` + `subscribeWithSelector`, raw Web Audio API, Tailwind v4 + daisyUI v5, ESLint flat config with the three-layer `no-restricted-imports` rules.

**Spec:** docs/superpowers/specs/2026-09-05-lead-step-resolution-design.md

## Global Constraints

- Branch is `feat/dev-375-lead-step-resolution`. All work lands there; feature work never lands as a commit made directly on `main`.
- Three-layer import rule (eslint `no-restricted-imports`, all `error`): `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; `src/components/` never imports `audio/engine`. `src/utils/stepResolution.ts` is placed under `utils/` precisely so all three may import it, exactly as `meter.ts` is.
- `bun run verify` is the completion gate: `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`. `bun run lint` (tsc `--noEmit`) must pass at **every** task boundary — the decomposition below is ordered so it does.
- `bun run eslint` must report **zero errors** at every task boundary, and no *new* warnings. Run `bun run eslint` once before Task 1 and write the warning count down; that number is the line to hold. **Do not copy a warning count into this document or into CLAUDE.md** — it changes through routine work and goes stale silently.
- **No version numbers in docs.** This plan never states the persist `version` or the project `formatVersion`. Task 6 instructs you to read the current value in the source and add one. CLAUDE.md's own rule applies to Task 11: write the *rule*, never the number.
- **The two migration chains must never be merged into one.** The persist chain in `src/store/store.ts`'s `migrate` runs before zustand's `merge`; the `.solna` chain in `src/store/projectFormatMigrate.ts`'s `migrateProjectBody` runs before `sanitizeContent`. A persist payload is private `localStorage` shape; a project body is an external contract; their versions move for different reasons. The only shared piece is the pure transform, the same arrangement `upgradeLeadMelodyV1` already has.
- **The trap, restated because it has already bitten once:** an un-upgraded payload that reaches the sanitize step comes back **blank — no throw, no warning**. `isLeadNoteMatrix` rejects a shape it does not recognise and hands back an empty melody. Each chain needs an end-to-end test that starts from a genuinely old payload and ends at a populated melody.
- **Ordering inside each chain matters.** The tick widening runs **after** the existing `upgradeLeadMelodyV1` step, never before: a pre-DEV-369 `string[][]` payload becomes `LeadNote[][]` at the narrow stored width first, and is only then widened.
- **`LEAD_CELL_WIDTH` stays fixed at its current value.** A bar gets physically wider at 1/32 and narrower at 1/8, and the grid scrolls further. There is deliberately no zoom control: the marker's `translateX` and the ruler's header buttons must agree on a stride in pixels, and a fixed cell width keeps that agreement free.
- **DEV-371's contract survives unaltered.** The bar and step header buttons keep `aria-pressed` and `aria-label`, and `leadCursorKeyTarget` keeps driving arrow-key navigation with Shift jumping a whole bar. The labels' *content* changes with the column count; their contract does not.
- **`len` counts ticks; the editor writes whole cells.** A note's length is a number of 1/32 ticks, so a quarter note is 8 ticks at every resolution. Every length the drag handle and the recorder produce is a multiple of `stride`, with a floor of one cell. Sub-cell lengths are representable (a 1/32-authored note read at 1/8) but never *created* at the current resolution.
- **A change of view never writes.** An explicit edit writes; changing resolution writes nothing to the melody. The `cells` rounding is a read-time decision, and `holdSec` uses the same rounded `cells` the grid draws the note's width with — what sounds is what is drawn.
- **The sequencer, chord-rhythm and bass grids keep `MAX_STEPS_PER_BAR` untouched.** `customChordRhythm`, `customBassPattern` and every `sequencerTracks[].steps` row stay at that width. Only the lead melody moves to `LEAD_TICKS_PER_BAR`.
- Tests are `bun:test`, run with `bun test <path>` and `bun test -t "<name>"`. **There is no DOM and no testing-library, and none may be added** (`.claude/rules/testing.md`). Rendered-markup tests use `renderToString` from `react-dom/server`.
- **Every appended test block assumes its imports are extended to cover the symbols it names.** The blocks below are written as the code to append, not as whole files; add the helpers, constants and types each one uses to that file's existing import lists before running it.
- The zustand + `renderToString` trap: `getServerSnapshot` is `selector(api.getInitialState())`, captured once at store creation, so `useAppStore.setState(...)` before a `renderToString` has **no effect, silently**. Anything resolution-dependent in the rendered grid is tested through a component's own explicit prop, never by setting `leadStepResolution` and rendering `LeadMelodyGrid`.
- Never call engine setters from a component. Nothing here is an engine-settable value, so `engineSync.ts` is untouched.
- Theming (`.claude/rules/theming.md`): components name roles, never colours. `scripts/themeTokenGuard.ts` fails the build on raw hex, Tailwind palette classes, `text-white` and the `dark:` variant. Every class string this plan writes already exists in `src/`.
- Commits use `git add <named files>`, never `-A` and never `.`. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  ```

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/utils/stepResolution.ts` | The lead's subdivision table: `TICKS_PER_SIXTEENTH`, `LEAD_TICKS_PER_BAR`, the id union, the stride table, the never-throw resolver and `columnsPerBar`. Imports only `./meter`. |
| `src/utils/stepResolution.test.ts` | The table's invariants, including the full meter × resolution divisibility matrix. |

**Modified**

| Path | Change |
|---|---|
| `src/components/loop/lead/melodyGrid.ts` | Loses its duplicate `leadStoredIndex`; columns come from `columnsPerBar`, note widths from `cells`, and the marker's live branch passes the stride. |
| `src/components/loop/lead/melodyGrid.test.ts` | Drops the `leadStoredIndex` block, gains the single-copy guard and the stride-aware cell tests. |
| `src/audio/leadMelody.ts` | The whole tick move: both conversions take a stride, storage widens to `LEAD_TICKS_PER_BAR`, `len` and `age` count ticks, `cells`/`holdSec`, and `upgradeLeadMelodyToTicks`. |
| `src/audio/leadMelody.test.ts` | Fixtures re-expressed in ticks; new stride-1 and stride-4 coverage; the 1/16-unchanged-`holdSec` pin. |
| `src/audio/leadLiveRecord.ts` | `clockStepToGridColumn` gains the stride and stops being the identity; `heldStepLength` returns ticks with a one-cell floor. |
| `src/audio/leadLiveRecord.test.ts` | The "no imports at all" pin narrows to "no bpm-derived duration, and only the utils leaf". |
| `src/audio/playback/leadLiveClock.ts` | Unchanged in behaviour; re-exported types follow the new signatures. |
| `src/store/types.ts` | `Loop` and `LeadSlice` gain `leadStepResolution` and its setter. |
| `src/store/loopSlice.ts` | `createDefaultLoop` seeds the field and the wider melody. |
| `src/store/leadSlice.ts` | The flat mirror, the setter, and every call site moved to ticks and to the live stride. |
| `src/store/loop.ts` | `LOOP_FLAT_KEYS` gains the key, which `PROJECT_LOOP_KEYS` derives from. |
| `src/store/migrate.ts` | The persist chain's new tick step. |
| `src/store/store.ts` | The persist `version` bump and the new chain link. |
| `src/store/projectFormat.ts` | The project `formatVersion` bump. |
| `src/store/projectFormatMigrate.ts` | The `.solna` chain's new tick step. |
| `src/store/leadRecord.ts` | The write column and the held length in the new units. |
| `src/components/loop/lead/useLeadPlayback.ts` | One dispatch owns a tick range and fires every column in it. |
| `src/components/loop/lead/LeadMelodyGrid.tsx` | The resolution select beside the loop-length control; stride threaded through the grid. |
| `CLAUDE.md` | The lead's separate storage width, and the tick step joining the lead-migration trap entry. |

---

### Task 1: Delete the duplicate stored-index helper

`src/components/loop/lead/melodyGrid.ts` exports its own `leadStoredIndex(barIndex, stepInBar)`, a second copy of `barIndex * MAX_STEPS_PER_BAR + stepInBar`. It survives today only because it does not depend on the meter. Under a stride it does, and two independent copies of a conversion that now takes a third argument is exactly the "three scattered pieces of arithmetic that each look correct in isolation" DEV-374 named. Behaviour-preserving: the existing suite proves it on its own.

**Files:**
- Modify: `src/components/loop/lead/melodyGrid.ts`, `src/components/loop/lead/LeadMelodyGrid.tsx`
- Test: `src/components/loop/lead/melodyGrid.test.ts`

**Interfaces:**
- Consumes: `leadStoredIndexAt(stepInLoop: number, stepsPerBar: number): number` from `src/audio/leadMelody.ts` — unchanged in this task.
- Produces: `leadStoredIndex` no longer exists. Every column→stored-index conversion in `components/` goes through `leadStoredIndexAt`.

**Steps:**

- [ ] **Step 1: Write the failing guard test.**
  In `src/components/loop/lead/melodyGrid.test.ts`, **delete** the whole `describe('leadStoredIndex', ...)` block (it starts at line 48) and remove `leadStoredIndex` from the `from './melodyGrid'` import list. Then append this block, and add `import { readFileSync } from 'node:fs';` at the top of the file if it is not already imported:
  ```ts
  describe('the stored-index conversion has exactly one copy', () => {
    test('melodyGrid does not declare its own', () => {
      // Two copies of bar-major arithmetic agreed only for as long as it took
      // no meter argument. DEV-375 gives it a stride as well, and a second
      // copy that looks correct in isolation is how a note ends up drawn on
      // one column and scheduled on another.
      const src = readFileSync(new URL('./melodyGrid.ts', import.meta.url), 'utf8');
      expect(src).not.toContain('export function leadStoredIndex(');
      expect(src).toContain('leadStoredIndexAt');
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/components/loop/lead/melodyGrid.test.ts
  ```
  Expected failure: `expect(received).not.toContain(expected)` — the source still declares `export function leadStoredIndex(`.

- [ ] **Step 3: Delete the helper and reroute its four call sites.**
  In `src/components/loop/lead/melodyGrid.ts`, **delete** this function and its doc comment entirely:
  ```ts
  /**
   * The flat stored index for a (bar, stepInBar) column. The melody is stored at
   * MAX_STEPS_PER_BAR per bar, so this never depends on the active meter.
   */
  export function leadStoredIndex(barIndex: number, stepInBar: number): number {
    return barIndex * MAX_STEPS_PER_BAR + stepInBar;
  }
  ```
  Replace the `MAX_STEPS_PER_BAR` import line with the audio-layer conversion — note the type-only import of `LeadNote` already present, which this joins:
  ```ts
  import { leadStoredIndexAt, type LeadNote } from '../../../audio/leadMelody';
  ```
  and delete the now-unused `import { MAX_STEPS_PER_BAR } from '../../../utils/meter';` line and the separate `import type { LeadNote } from '../../../audio/leadMelody';` line.

  In `leadCellKinds`, replace:
  ```ts
      const barIndex = Math.floor(col / stepsPerBar);
      const row = melody[leadStoredIndex(barIndex, col - barIndex * stepsPerBar)];
  ```
  with:
  ```ts
      const row = melody[leadStoredIndexAt(col, stepsPerBar)];
  ```

  In `resolveLeadCellSpan`, replace:
  ```ts
    const startBar = startCol < 0 ? 0 : Math.floor(startCol / stepsPerBar);
    const spanStartIdx =
      startCol < 0 ? -1 : leadStoredIndex(startBar, startCol - startBar * stepsPerBar);
  ```
  with:
  ```ts
    const spanStartIdx = startCol < 0 ? -1 : leadStoredIndexAt(startCol, stepsPerBar);
  ```

  In `src/components/loop/lead/LeadMelodyGrid.tsx`, swap `leadStoredIndex` for `leadStoredIndexAt` in the `from '../../../audio/leadMelody'` import list (it is currently imported from `./melodyGrid`; remove it from there), then replace the memoised converter:
  ```ts
      (col: number) => leadStoredIndex(Math.floor(col / stepsPerBar), col % stepsPerBar),
  ```
  with:
  ```ts
      (col: number) => leadStoredIndexAt(col, stepsPerBar),
  ```
  and, inside the cell loop, replace:
  ```tsx
                const idx = leadStoredIndex(barIndex, stepInBar);
  ```
  with:
  ```tsx
                const idx = leadStoredIndexAt(barIndex * stepsPerBar + stepInBar, stepsPerBar);
  ```

- [ ] **Step 4: Run the tests and prove the refactor changed nothing.**
  ```bash
  bun test src/components/loop/lead/melodyGrid.test.ts
  bun test src/components/loop/lead/LeadMelodyGrid.test.tsx
  bun test src/audio/leadMelody.test.ts
  bun run lint
  grep -rn "leadStoredIndex(" src/ || echo "no copies left"
  ```
  The `grep` must print `no copies left`. The three suites must pass with no edits beyond the deleted `describe` block — that is the whole proof that this task is a no-op.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/components/loop/lead/melodyGrid.ts src/components/loop/lead/melodyGrid.test.ts src/components/loop/lead/LeadMelodyGrid.tsx
  git commit -m "$(cat <<'EOF'
  refactor(ui): route the melody grid through the one stored-index conversion (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 2: The subdivision table, as a leaf under `utils/`

A new module that nothing imports yet. It is deliberately **not** added to `meter.ts`: that module's header states the 16th-note grid never changes and that it imports nothing at all, and putting a lead-only subdivision table inside it would make its own header false and put lead concerns in a module the sequencer and metronome depend on. Meter answers *how long is a bar*; this answers *how fine is a lead cell*. One imports the other, in that direction only.

**Files:**
- Create: `src/utils/stepResolution.ts`
- Test: `src/utils/stepResolution.test.ts`

**Interfaces:**
- Consumes: `MAX_STEPS_PER_BAR`, `METERS`, `METER_IDS`, `type MeterId` from `./meter`. Nothing else, ever.
- Produces:
  ```ts
  export const TICKS_PER_SIXTEENTH = 2;
  export const LEAD_TICKS_PER_BAR: number; // MAX_STEPS_PER_BAR * TICKS_PER_SIXTEENTH
  export type LeadStepResolutionId = '1/8' | '1/16' | '1/32';
  export interface LeadStepResolution { id: LeadStepResolutionId; label: string; stride: number }
  export const LEAD_STEP_RESOLUTIONS: Record<LeadStepResolutionId, LeadStepResolution>;
  export const LEAD_STEP_RESOLUTION_IDS: LeadStepResolutionId[];
  export const DEFAULT_LEAD_STEP_RESOLUTION: LeadStepResolutionId; // '1/16'
  export function isLeadStepResolutionId(value: unknown): value is LeadStepResolutionId;
  export function getLeadStepResolution(id: string | null | undefined): LeadStepResolution;
  export function strideFor(id: string | null | undefined): number;
  export function columnsPerBar(stepsPerBar: number, stride: number): number;
  ```

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  Create `src/utils/stepResolution.test.ts`:
  ```ts
  import { describe, expect, test } from 'bun:test';
  import { readFileSync } from 'node:fs';
  import {
    DEFAULT_LEAD_STEP_RESOLUTION,
    LEAD_STEP_RESOLUTIONS,
    LEAD_STEP_RESOLUTION_IDS,
    LEAD_TICKS_PER_BAR,
    TICKS_PER_SIXTEENTH,
    columnsPerBar,
    getLeadStepResolution,
    isLeadStepResolutionId,
    strideFor,
  } from './stepResolution';
  import { MAX_STEPS_PER_BAR, METERS, METER_IDS } from './meter';

  describe('the table', () => {
    test('stores at 1/32 and strides down to the active resolution', () => {
      expect(TICKS_PER_SIXTEENTH).toBe(2);
      expect(LEAD_TICKS_PER_BAR).toBe(MAX_STEPS_PER_BAR * TICKS_PER_SIXTEENTH);
      expect(LEAD_STEP_RESOLUTIONS['1/8'].stride).toBe(4);
      expect(LEAD_STEP_RESOLUTIONS['1/16'].stride).toBe(2);
      expect(LEAD_STEP_RESOLUTIONS['1/32'].stride).toBe(1);
    });

    test('lists coarse to fine — the order the select shows', () => {
      expect(LEAD_STEP_RESOLUTION_IDS).toEqual(['1/8', '1/16', '1/32']);
    });

    test('every listed id has a row, and every row is listed', () => {
      // The same invariant meter.test.ts pins for METER_IDS: a resolution
      // added to one and not the other is a select option that resolves to
      // the default, silently.
      expect([...LEAD_STEP_RESOLUTION_IDS].sort()).toEqual(
        Object.keys(LEAD_STEP_RESOLUTIONS).sort(),
      );
      for (const id of LEAD_STEP_RESOLUTION_IDS) {
        expect(LEAD_STEP_RESOLUTIONS[id].id).toBe(id);
        expect(LEAD_STEP_RESOLUTIONS[id].label.length).toBeGreaterThan(0);
      }
    });

    test('the default is 1/16 — what every existing project is authored at', () => {
      expect(DEFAULT_LEAD_STEP_RESOLUTION).toBe('1/16');
      expect(strideFor(DEFAULT_LEAD_STEP_RESOLUTION)).toBe(TICKS_PER_SIXTEENTH);
    });

    test('the module reaches meter and nothing else', () => {
      // utils/ leaves may be imported by audio/, store/ AND components/. An
      // import from any of those three would make this module unimportable
      // by the other two under the layering rules.
      const src = readFileSync(new URL('./stepResolution.ts', import.meta.url), 'utf8');
      const imports = [...src.matchAll(/^import .*? from '(.*?)';$/gm)].map((m) => m[1]);
      expect(imports).toEqual(['./meter']);
    });
  });

  describe('isLeadStepResolutionId', () => {
    test('accepts exactly the three ids', () => {
      expect(isLeadStepResolutionId('1/8')).toBe(true);
      expect(isLeadStepResolutionId('1/16')).toBe(true);
      expect(isLeadStepResolutionId('1/32')).toBe(true);
    });

    test('rejects everything else, including triplets', () => {
      expect(isLeadStepResolutionId('1/12')).toBe(false);
      expect(isLeadStepResolutionId('')).toBe(false);
      expect(isLeadStepResolutionId(16)).toBe(false);
      expect(isLeadStepResolutionId(null)).toBe(false);
      expect(isLeadStepResolutionId(undefined)).toBe(false);
    });
  });

  describe('getLeadStepResolution', () => {
    test('resolves a known id', () => {
      expect(getLeadStepResolution('1/32').stride).toBe(1);
    });

    test('falls back to the default rather than throwing', () => {
      // The same reasoning getMeter states verbatim: a persisted id from a
      // future build, a corrupt payload or an empty string must not throw,
      // because this value feeds the scheduler and a throw there would
      // freeze the transport.
      expect(getLeadStepResolution('1/12').id).toBe(DEFAULT_LEAD_STEP_RESOLUTION);
      expect(getLeadStepResolution('').id).toBe(DEFAULT_LEAD_STEP_RESOLUTION);
      expect(getLeadStepResolution(null).id).toBe(DEFAULT_LEAD_STEP_RESOLUTION);
      expect(getLeadStepResolution(undefined).id).toBe(DEFAULT_LEAD_STEP_RESOLUTION);
    });
  });

  describe('columnsPerBar', () => {
    test('is the bar’s ticks divided by the stride', () => {
      expect(columnsPerBar(16, 4)).toBe(8);
      expect(columnsPerBar(16, 2)).toBe(16);
      expect(columnsPerBar(16, 1)).toBe(32);
    });

    test('a nonsense stride gives one column, never zero or NaN', () => {
      // A zero would divide the grid by nothing; a NaN would size it in NaN
      // pixels. Both are worse than a one-column bar.
      expect(columnsPerBar(16, 0)).toBe(1);
      expect(columnsPerBar(16, Number.NaN)).toBe(1);
      expect(columnsPerBar(0, 2)).toBe(1);
    });
  });

  describe('every meter divides cleanly at every resolution', () => {
    // The eighteen-cell matrix from the spec, pinned as a table — an
    // invariant of the meter table, not a property of any one call site. A
    // seventh meter added later must fail loudly HERE rather than quietly
    // draw a bar that ends mid-column. 7/8 is the row to watch: 28 ticks
    // gives 7 columns at 1/8, and 7/8 is precisely the meter whose bar
    // length is not a multiple of 4 (the reason ARP_PHASE_QUANTUM exists).
    // It works because divisibility runs the other way here — ticks by
    // stride, not bar by subdivision.
    const expected: Record<string, [number, number, number]> = {
      '4/4': [8, 16, 32],
      '3/4': [6, 12, 24],
      '6/8': [6, 12, 24],
      '12/8': [12, 24, 48],
      '5/4': [10, 20, 40],
      '7/8': [7, 14, 28],
    };

    test('the matrix is exactly the spec’s', () => {
      for (const meterId of METER_IDS) {
        const stepsPerBar = METERS[meterId].stepsPerBar;
        const row = LEAD_STEP_RESOLUTION_IDS.map((id) =>
          columnsPerBar(stepsPerBar, strideFor(id)),
        );
        expect(row).toEqual(expected[meterId]);
      }
    });

    test('no bar ever ends mid-column, at any stride', () => {
      for (const meterId of METER_IDS) {
        const ticks = METERS[meterId].stepsPerBar * TICKS_PER_SIXTEENTH;
        for (const id of LEAD_STEP_RESOLUTION_IDS) {
          expect(ticks % strideFor(id)).toBe(0);
        }
      }
    });

    test('the storage width covers the widest meter at the finest stride', () => {
      // 12/8 at 1/32 is 48 columns, which is exactly LEAD_TICKS_PER_BAR — no
      // meter loses columns to the storage width.
      const widest = Math.max(...METER_IDS.map((id) => METERS[id].stepsPerBar));
      expect(columnsPerBar(widest, 1)).toBe(LEAD_TICKS_PER_BAR);
    });
  });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/utils/stepResolution.test.ts
  ```
  Expected failure: `error: Cannot find module './stepResolution' from '.../src/utils/stepResolution.test.ts'`.

- [ ] **Step 3: Write the module.**
  Create `src/utils/stepResolution.ts`:
  ```ts
  import { MAX_STEPS_PER_BAR } from './meter';

  /**
   * How fine a lead melody cell is — the lead's second axis, on top of meter.
   *
   * This is deliberately NOT in meter.ts. That module's header states that
   * the 16th-note grid never changes, and it imports nothing at all so that
   * audio/, store/ and components/ may all reach it. A lead-only subdivision
   * table inside it would make its own header false and would put lead
   * concerns in a module the sequencer and the metronome depend on. Meter
   * answers "how long is a bar"; this answers "how fine is a lead cell". One
   * imports the other, in that direction only.
   *
   * The scheme is the one meter already teaches, one dimension over: STORE at
   * the finest and STRIDE to the active. A reshape on every resolution change
   * would silently lose the notes between the coarse columns on the way back.
   */

  /** Ticks per clock 16th. The melody is stored at 1/32, always. */
  export const TICKS_PER_SIXTEENTH = 2;

  /**
   * The stored width of one melody bar, in ticks — the widest meter at the
   * finest resolution. Lead-only: the sequencer, chord-rhythm and bass grids
   * keep storing at MAX_STEPS_PER_BAR and are not part of this scheme.
   */
  export const LEAD_TICKS_PER_BAR = MAX_STEPS_PER_BAR * TICKS_PER_SIXTEENTH;

  export type LeadStepResolutionId = '1/8' | '1/16' | '1/32';

  export interface LeadStepResolution {
    id: LeadStepResolutionId;
    /** Display string for the melody grid's select. */
    label: string;
    /** How many stored ticks one column spans. */
    stride: number;
  }

  export const LEAD_STEP_RESOLUTIONS: Record<LeadStepResolutionId, LeadStepResolution> = {
    '1/8': { id: '1/8', label: '1/8', stride: 4 },
    '1/16': { id: '1/16', label: '1/16', stride: 2 },
    '1/32': { id: '1/32', label: '1/32', stride: 1 },
  };

  /** Declaration order — coarse to fine, the order the select lists them in. */
  export const LEAD_STEP_RESOLUTION_IDS: LeadStepResolutionId[] = ['1/8', '1/16', '1/32'];

  /**
   * 1/16 is not an arbitrary default: it is the resolution every project that
   * exists today was authored at, so a loop without the field opens with
   * every note on the same beat, the same length and the same sound.
   */
  export const DEFAULT_LEAD_STEP_RESOLUTION: LeadStepResolutionId = '1/16';

  export function isLeadStepResolutionId(value: unknown): value is LeadStepResolutionId {
    return typeof value === 'string' && Object.hasOwn(LEAD_STEP_RESOLUTIONS, value);
  }

  /**
   * Resolve a resolution id. Anything unknown — a persisted id from a future
   * build, a corrupt payload, an empty string — falls back to the default
   * rather than throwing: this value feeds the scheduler, and a throw there
   * would freeze the transport. Exactly getMeter's rule, for exactly the same
   * reason.
   */
  export function getLeadStepResolution(id: string | null | undefined): LeadStepResolution {
    return isLeadStepResolutionId(id)
      ? LEAD_STEP_RESOLUTIONS[id]
      : LEAD_STEP_RESOLUTIONS[DEFAULT_LEAD_STEP_RESOLUTION];
  }

  /** The stride alone, for the many call sites that want only the number. */
  export function strideFor(id: string | null | undefined): number {
    return getLeadStepResolution(id).stride;
  }

  /**
   * How many columns one bar draws: its ticks divided by the stride. Whole
   * for all eighteen meter x resolution combinations, pinned by
   * stepResolution.test.ts — so no bar ever ends mid-column.
   *
   * Floors at 1 rather than returning 0 or NaN for nonsense input: a
   * zero-column bar divides the grid by nothing and sizes the marker in NaN
   * pixels, which is worse than one wrong column.
   */
  export function columnsPerBar(stepsPerBar: number, stride: number): number {
    if (!(stride > 0) || !(stepsPerBar > 0)) return 1;
    return Math.max(1, Math.floor((stepsPerBar * TICKS_PER_SIXTEENTH) / stride));
  }
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/utils/stepResolution.test.ts
  bun test src/utils/meter.test.ts
  bun run lint
  bun run eslint
  ```
  Zero eslint errors and no new warnings. Nothing imports the new module yet, which is the point: it lands provably correct before anything depends on it.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/utils/stepResolution.ts src/utils/stepResolution.test.ts
  git commit -m "$(cat <<'EOF'
  feat(utils): add the lead's step-resolution table and its divisibility matrix (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 3: One dormancy test, not two

`resizeLeadMelody` carries its own inline copy of the dormancy test (`offset >= stepsPerBar`). Resolution adds a second kind of dormancy, and the spec is explicit that **both live in `leadActivePosAt` and nowhere else** — a loop-length change that clamps the `len` of an off-grid note against a fictitious position would silently rewrite length data a finer resolution still needs, which is the same defect the existing comment in that function was written for. Route the inline copy through the function *first*, while it is still a no-op that the existing suite proves. Still 24-wide; no stride yet.

**Files:**
- Modify: `src/audio/leadMelody.ts`
- Test: `src/audio/leadMelody.test.ts`

**Interfaces:**
- Consumes: `leadActivePosAt(storedIndex: number, stepsPerBar: number): number` — unchanged in this task.
- Produces: `resizeLeadMelody(steps, newLoopLength, stepsPerBar)` keeps its exact signature and behaviour. It no longer computes an offset or a position of its own.

**Steps:**

- [ ] **Step 1: Write the failing test.**
  Append to `src/audio/leadMelody.test.ts`, adding `readFileSync` to the imports if it is not there already:
  ```ts
  describe('resizeLeadMelody shares the one dormancy test', () => {
    test('it does not compute a position of its own', () => {
      // Resolution adds a SECOND kind of dormancy (off-grid, not just
      // outside-the-bar). Two copies of the test would drift the moment the
      // second one lands, and the failure mode is silent: a loop-length
      // change clamping an off-grid note's len against a fictitious column.
      const src = readFileSync(new URL('./leadMelody.ts', import.meta.url), 'utf8');
      const body = src.slice(src.indexOf('export function resizeLeadMelody'));
      const fn = body.slice(0, body.indexOf('\n}\n') + 3);
      expect(fn).toContain('leadActivePosAt');
      expect(fn).not.toContain('offset >= stepsPerBar');
      expect(fn).not.toContain('barIndex * stepsPerBar + offset');
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/audio/leadMelody.test.ts -t "it does not compute a position of its own"
  ```
  Expected failure: `expect(received).toContain(expected)` — the function body does not mention `leadActivePosAt`.

- [ ] **Step 3: Route the inline test through the function.**
  In `src/audio/leadMelody.ts`, replace the body of the loop inside `resizeLeadMelody` — from `const barIndex = Math.floor(...)` down to the `out.push(row.map(...))` that ends the iteration — with:
  ```ts
      // The ONE dormancy test (leadActivePosAt), not a second copy: a slot
      // the active window cannot reach is dormant, not overhanging — leave it
      // untouched, or a meter change would silently rewrite length data a
      // wider window still needs (leadSlice.test.ts's "a meter change never
      // touches the stored melody" invariant). When resolution adds its own
      // kind of dormancy, this call site gets it for free.
      const activePos = leadActivePosAt(i, stepsPerBar);
      if (activePos < 0) {
        out.push(row.map((n) => ({ ...n })));
        continue;
      }
      const maxLen = Math.max(1, loopEnd - activePos);
      out.push(row.map((n) => ({ note: n.note, len: Math.min(n.len, maxLen) })));
  ```

- [ ] **Step 4: Run the tests and prove the refactor changed nothing.**
  ```bash
  bun test src/audio/leadMelody.test.ts
  bun test src/store/leadSlice.test.ts
  bun run lint
  ```
  `leadSlice.test.ts` carries the "a meter change never touches the stored melody" invariant and must pass with no edits — that is this task's whole proof.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/audio/leadMelody.ts src/audio/leadMelody.test.ts
  git commit -m "$(cat <<'EOF'
  refactor(audio): give resizeLeadMelody the one dormancy test (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 4: The audio layer speaks ticks

The unit change, all in one commit because the signatures force it. Storage widens to `LEAD_TICKS_PER_BAR`, both conversions take a stride, both kinds of dormancy live in `leadActivePosAt`, `len` and `age` count ticks, and the gate trims the tail of the note's final **cell**. Every caller outside `leadMelody.ts` passes a fixed `TICKS_PER_SIXTEENTH` for now — the loop has no resolution field until Task 5 — so **the whole existing suite staying green is this task's main proof**.

Two honest notes about that proof. First, fixtures that spell a stored index or a multi-16th `len` as a literal number are *expressed* in the old units and must be re-expressed in ticks in this same commit; a one-cell note is unaffected by construction, which is why the vast majority of the suite does not move. Second, the store's write path is part of the unit change: `paintLeadNote` writes one *cell*, which is `TICKS_PER_SIXTEENTH` ticks, not 1.

**Files:**
- Modify: `src/audio/leadMelody.ts`
- Modify (call sites only, at a fixed stride): `src/store/leadSlice.ts`, `src/store/loopSlice.ts`, `src/store/leadRecord.ts`, `src/components/loop/lead/melodyGrid.ts`, `src/components/loop/lead/LeadMelodyGrid.tsx`, `src/components/loop/lead/useLeadPlayback.ts`
- Test: `src/audio/leadMelody.test.ts`

**Interfaces:**
- Consumes: `LEAD_TICKS_PER_BAR`, `TICKS_PER_SIXTEENTH`, `columnsPerBar` from `src/utils/stepResolution.ts` (Task 2).
- Produces:
  ```ts
  export function leadStoredIndexAt(column: number, stepsPerBar: number, stride: number): number
  export function leadActivePosAt(storedIndex: number, stepsPerBar: number, stride: number): number
  export function leadSoundingNotes(
    steps: readonly LeadNote[][], columnInLoop: number, stepsPerBar: number, stride: number,
  ): LeadSounding[]                       // LeadSounding.age is in TICKS
  export function leadCoveringNoteIndex(
    steps: readonly LeadNote[][], columnInLoop: number, stepsPerBar: number, stride: number, note: string,
  ): number
  export function resizeLeadMelody(
    steps: readonly LeadNote[][], newLoopLength: number, stepsPerBar: number, stride: number,
  ): LeadNote[][]
  export function clampLeadCursor(
    cursor: number, loopLength: number, stepsPerBar: number, stride: number,
  ): number
  export function leadCursorBar(cursor: number, stepsPerBar: number, stride: number): number
  export function copyLeadBar(steps: readonly LeadNote[][], bar: number): LeadNote[][]  // LEAD_TICKS_PER_BAR wide
  export function pasteLeadBar(
    steps: readonly LeadNote[][], bar: number, clip: readonly LeadNote[][],
    stepsPerBar: number, stride: number, loopLength: number,
  ): LeadNote[][]
  export function resolveLeadStepTriggers(
    sounding: readonly LeadSounding[], arpActive: boolean, arpStep: number,
    params: { arpMode: ArpMode; arpRate: ArpRate; arpOctaves: number },
    tickDurSec: number, gate: number, stride: number,
    loop: { tickInLoop: number; melodyTicks: number },
  ): LeadTrigger[]
  ```

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  Append to `src/audio/leadMelody.test.ts`, adding `LEAD_TICKS_PER_BAR`, `TICKS_PER_SIXTEENTH` and `columnsPerBar` to the imports from `'../utils/stepResolution'`:
  ```ts
  describe('column <-> stored index, at every stride', () => {
    const round = (stepsPerBar: number, stride: number): void => {
      const cols = columnsPerBar(stepsPerBar, stride) * 2; // two bars
      for (let col = 0; col < cols; col++) {
        const stored = leadStoredIndexAt(col, stepsPerBar, stride);
        expect(leadActivePosAt(stored, stepsPerBar, stride)).toBe(col);
      }
    };

    test('round-trips in 4/4 at 1/8, 1/16 and 1/32', () => {
      round(16, 4);
      round(16, 2);
      round(16, 1);
    });

    test('round-trips in 7/8 — the odd meter, at every stride', () => {
      // 28 ticks a bar: 7 columns at 1/8, 14 at 1/16, 28 at 1/32. The row the
      // spec calls out, because 7/8 is the meter whose bar is not a multiple
      // of 4 and the one arpStepFor exists for.
      round(14, 4);
      round(14, 2);
      round(14, 1);
    });

    test('bar 1 starts at the stored width whatever the stride', () => {
      // The stored index is the ONE space that depends on neither meter nor
      // resolution, which is what makes a .solna body portable between them.
      expect(leadStoredIndexAt(columnsPerBar(16, 4), 16, 4)).toBe(LEAD_TICKS_PER_BAR);
      expect(leadStoredIndexAt(columnsPerBar(16, 2), 16, 2)).toBe(LEAD_TICKS_PER_BAR);
      expect(leadStoredIndexAt(columnsPerBar(16, 1), 16, 1)).toBe(LEAD_TICKS_PER_BAR);
    });

    test('a column is stride ticks wide', () => {
      expect(leadStoredIndexAt(1, 16, 1)).toBe(1);
      expect(leadStoredIndexAt(1, 16, 2)).toBe(2);
      expect(leadStoredIndexAt(1, 16, 4)).toBe(4);
    });
  });

  describe('leadActivePosAt knows both kinds of dormancy', () => {
    test('outside the bar: the meter cannot reach this tick', () => {
      // 4/4 is 32 ticks of a 48-tick stored bar. Tick 32 exists in 12/8 and
      // is unreachable in 4/4 — quiet, not gone, and it comes back.
      expect(leadActivePosAt(32, 16, 2)).toBe(-1);
      expect(leadActivePosAt(32, 24, 2)).toBe(16);
    });

    test('off the grid: the resolution cannot reach this tick', () => {
      // Tick 2 is column 1 at 1/16 and column 2 at 1/32, but at 1/8 (stride
      // 4) only multiples of 4 are reachable.
      expect(leadActivePosAt(2, 16, 4)).toBe(-1);
      expect(leadActivePosAt(2, 16, 2)).toBe(1);
      expect(leadActivePosAt(2, 16, 1)).toBe(2);
      expect(leadActivePosAt(1, 16, 2)).toBe(-1);
      expect(leadActivePosAt(1, 16, 1)).toBe(1);
    });

    test('both apply in the second bar too, not only the first', () => {
      expect(leadActivePosAt(LEAD_TICKS_PER_BAR + 2, 16, 4)).toBe(-1);
      expect(leadActivePosAt(LEAD_TICKS_PER_BAR + 32, 16, 2)).toBe(-1);
      expect(leadActivePosAt(LEAD_TICKS_PER_BAR + 4, 16, 4)).toBe(9);
    });
  });

  describe('leadSoundingNotes carries age in ticks', () => {
    const melody = (): LeadNote[][] => {
      const steps: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
      steps[0] = [{ note: 'C4', len: 8 }]; // a quarter note: 8 ticks, always
      return steps;
    };

    test('a quarter note is still sounding four columns later at 1/16', () => {
      const s = leadSoundingNotes(melody(), 3, 16, 2);
      expect(s).toEqual([{ note: 'C4', len: 8, age: 6 }]);
    });

    test('the same note, the same duration, at 1/8 and at 1/32', () => {
      // age = columnsBack * stride, so the note's audible span is identical
      // at every resolution — only the number of cells it covers changes.
      expect(leadSoundingNotes(melody(), 1, 16, 4)).toEqual([{ note: 'C4', len: 8, age: 4 }]);
      expect(leadSoundingNotes(melody(), 2, 16, 4)).toEqual([]);
      expect(leadSoundingNotes(melody(), 7, 16, 1)).toEqual([{ note: 'C4', len: 8, age: 7 }]);
      expect(leadSoundingNotes(melody(), 8, 16, 1)).toEqual([]);
    });

    test('an off-grid note is never visited, so it is simply silent', () => {
      // No branch anywhere else: the scheduler reads through columns only.
      const steps: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
      steps[1] = [{ note: 'C4', len: 1 }];
      expect(leadSoundingNotes(steps, 1, 16, 2)).toEqual([]);
      expect(leadSoundingNotes(steps, 1, 16, 1)).toEqual([{ note: 'C4', len: 1, age: 0 }]);
    });
  });

  describe('resolveLeadStepTriggers rounds up to whole cells', () => {
    const params = { arpMode: 'up' as const, arpRate: '1/16' as const, arpOctaves: 1 };
    const tickDur = 0.125 / TICKS_PER_SIXTEENTH; // 120 bpm 16th, halved
    const hold = (len: number, stride: number): number =>
      resolveLeadStepTriggers(
        [{ note: 'C4', len, age: 0 }],
        false,
        0,
        params,
        tickDur,
        0.85,
        stride,
        { tickInLoop: 0, melodyTicks: 32 },
      )[0].holdSec;

    test('a 1/16 project’s holdSec is byte-identical to before', () => {
      // A one-cell note at stride 2 gives gate * 2 * tickDur, which is
      // exactly the old (1 - 1 + gate) * stepDurSec. This is the bar
      // DEFAULT_LEAD_GATE was chosen to clear, and nothing that exists today
      // may move by a sample.
      expect(hold(2, 2)).toBeCloseTo(0.85 * 0.125, 10);
      expect(hold(8, 2)).toBeCloseTo((4 - 1 + 0.85) * 0.125, 10);
    });

    test('the gate trims the final CELL, not the final tick', () => {
      // (len - 1 + gate) * tickDur instead would make the gate four times
      // less audible at 1/8.
      expect(hold(8, 4)).toBeCloseTo((2 - 1 + 0.85) * 4 * tickDur, 10);
      expect(hold(8, 1)).toBeCloseTo((8 - 1 + 0.85) * 1 * tickDur, 10);
    });

    test('a note authored finer than the grid still sounds for one cell', () => {
      // The ceil and the floor of one cell are what keep a 1/32-authored note
      // audible when the loop is read at 1/8 — never a negative duration.
      expect(hold(1, 4)).toBeCloseTo(0.85 * 4 * tickDur, 10);
      expect(hold(3, 4)).toBeCloseTo(0.85 * 4 * tickDur, 10);
      expect(hold(5, 4)).toBeCloseTo((2 - 1 + 0.85) * 4 * tickDur, 10);
    });

    test('the loop end caps the audible length in ticks', () => {
      const triggers = resolveLeadStepTriggers(
        [{ note: 'C4', len: 64, age: 0 }],
        false,
        0,
        params,
        tickDur,
        1,
        2,
        { tickInLoop: 0, melodyTicks: 32 },
      );
      expect(triggers[0].holdSec).toBeCloseTo(16 * 2 * tickDur, 10);
    });
  });

  describe('the stored width moves with the melody, not with the sequencer', () => {
    test('resizeLeadMelody pads whole stored bars', () => {
      const one = Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]);
      expect(resizeLeadMelody(one, 2, 16, 2)).toHaveLength(2 * LEAD_TICKS_PER_BAR);
      expect(resizeLeadMelody(one, 2, 16, 2).slice(LEAD_TICKS_PER_BAR)).toEqual(
        Array.from({ length: LEAD_TICKS_PER_BAR }, () => []),
      );
    });

    test('copyLeadBar copies the full stored width, whatever is reachable', () => {
      const steps: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
      steps[1] = [{ note: 'C4', len: 1 }]; // off-grid at 1/16, still copied
      expect(copyLeadBar(steps, 0)).toHaveLength(LEAD_TICKS_PER_BAR);
      expect(copyLeadBar(steps, 0)[1]).toEqual([{ note: 'C4', len: 1 }]);
    });

    test('the cursor and its bar count columns, not 16ths', () => {
      expect(clampLeadCursor(999, 1, 16, 1)).toBe(31);
      expect(clampLeadCursor(999, 1, 16, 2)).toBe(15);
      expect(clampLeadCursor(999, 1, 16, 4)).toBe(7);
      expect(leadCursorBar(8, 16, 4)).toBe(1);
      expect(leadCursorBar(8, 16, 2)).toBe(0);
    });
  });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/audio/leadMelody.test.ts
  ```
  Expected failure: `error: Cannot find module '../utils/stepResolution'` is *not* what you should see (Task 2 created it) — expect instead `expect(received).toBe(expected)` on `bar 1 starts at the stored width whatever the stride`, receiving `24` where `48` was expected, plus a `tsc` complaint about the extra argument once you run `bun run lint`.

- [ ] **Step 3: Move `leadMelody.ts` to ticks.**
  In `src/audio/leadMelody.ts`, replace the `MAX_STEPS_PER_BAR` import with:
  ```ts
  import { LEAD_TICKS_PER_BAR, TICKS_PER_SIXTEENTH, columnsPerBar } from '../utils/stepResolution';
  ```
  Update the `LeadNote` doc comment's `len` sentence to:
  ```ts
  /**
   * One drawn lead note. The matrix index is the STORED tick the note starts
   * on; `len` is how many TICKS it occupies, an integer >= 1. Ticks, not
   * cells: a resolution change alters how long a cell is, so a length counted
   * in cells would make every note four times shorter the moment you switched
   * from 1/8 to 1/32. A quarter note is 8 ticks at every resolution.
   *
   * Defined here, next to the functions that consume it, so store/ and
   * components/ import it downward and audio/ never has to import either
   * (CLAUDE.md, three-layer rule).
   */
  ```
  Replace `LeadSounding`'s doc comment with:
  ```ts
  /** A note audible at a column. `age` is how many TICKS ago it started; 0 = starts here. */
  ```
  Then replace the two conversions and everything downstream of them:
  ```ts
  /**
   * The stored slot for a loop TICK. Bar-major at LEAD_TICKS_PER_BAR — the
   * one coordinate space that depends on neither meter nor resolution, which
   * is what makes a .solna body portable between both.
   */
  function storedIndexAtTick(tickInLoop: number, stepsPerBar: number): number {
    const ticksPerBar = stepsPerBar * TICKS_PER_SIXTEENTH;
    const barIndex = Math.floor(tickInLoop / ticksPerBar);
    return barIndex * LEAD_TICKS_PER_BAR + (tickInLoop - barIndex * ticksPerBar);
  }

  /**
   * The stored slot for a loop COLUMN. A column is `stride` ticks wide, and
   * the melody is stored at the finest resolution and windowed to the active
   * one — the same non-destructive scheme meter already runs, one dimension
   * over. This is the ONE column -> stored conversion in the codebase; the
   * duplicate in components/loop/lead/melodyGrid.ts was deleted for this.
   */
  export function leadStoredIndexAt(column: number, stepsPerBar: number, stride: number): number {
    return storedIndexAtTick(column * stride, stepsPerBar);
  }

  /**
   * The inverse: the ACTIVE-window column of a stored slot, or -1 when the
   * slot is DORMANT. There are now TWO ways to be dormant and both live
   * here and nowhere else:
   *
   *   tickInBar >= stepsPerBar * TICKS_PER_SIXTEENTH  -> outside the bar (meter)
   *   tickInBar % stride !== 0                        -> off the grid (resolution)
   *
   * Every existing caller already handles -1: paintLeadNote falls back to the
   * slot's own contents, setLeadNoteLength refuses, pasteLeadBar skips. The
   * scheduler reads through columns only, so an off-grid note is silent with
   * no branch added anywhere else — it is simply never visited.
   *
   * Silent-and-preserved, not muted-and-lost: the melody grid is the ONLY
   * editor there is, so a note that sounds but cannot be seen or deleted
   * would be a trap. Computing a position for a dormant slot anyway yields a
   * fictitious one that runs past the loop end, which is the defect
   * resizeLeadMelody was already fixed for.
   */
  export function leadActivePosAt(storedIndex: number, stepsPerBar: number, stride: number): number {
    const barIndex = Math.floor(storedIndex / LEAD_TICKS_PER_BAR);
    const tickInBar = storedIndex - barIndex * LEAD_TICKS_PER_BAR;
    if (tickInBar >= stepsPerBar * TICKS_PER_SIXTEENTH) return -1;
    if (tickInBar % stride !== 0) return -1;
    return barIndex * columnsPerBar(stepsPerBar, stride) + tickInBar / stride;
  }
  ```
  Replace `leadSoundingNotes`'s body (keeping its doc comment, with the two amendments below):
  ```ts
  export function leadSoundingNotes(
    steps: readonly LeadNote[][],
    columnInLoop: number,
    stepsPerBar: number,
    stride: number,
  ): LeadSounding[] {
    const out: LeadSounding[] = [];
    for (let columnsBack = 0; columnsBack <= columnInLoop; columnsBack++) {
      const row = steps[leadStoredIndexAt(columnInLoop - columnsBack, stepsPerBar, stride)];
      if (!row) continue;
      // age is in TICKS, so the `n.len > age` test and leadAudibleLen's clamp
      // keep working verbatim against tick-counted lengths.
      const age = columnsBack * stride;
      for (const n of row) {
        if (n.len > age) out.push({ note: n.note, len: n.len, age });
      }
    }
    return out;
  }
  ```
  Add these two sentences to that function's doc comment, after the existing "Worst case…" line:
  ```ts
   * The scan is by COLUMN and the age it reports is in ticks. At 1/32 with a
   * 4-bar 4/4 loop that is 128 iterations per dispatch instead of 64, and
   * there can be two dispatched columns per clock tick. Accepted, not
   * overlooked: it is array indexing over a short array, and the stateless
   * design is what stops a seek, a loop switch or a stop desynchronising a
   * sounding-note map. If it ever shows up in a profile, the fix is a cache
   * keyed on the melody, not a stateful map.
  ```
  Replace `leadCoveringNoteIndex`'s signature and body:
  ```ts
  export function leadCoveringNoteIndex(
    steps: readonly LeadNote[][],
    columnInLoop: number,
    stepsPerBar: number,
    stride: number,
    note: string,
  ): number {
    const covering = leadSoundingNotes(steps, columnInLoop, stepsPerBar, stride).find(
      (s) => s.note === note,
    );
    if (!covering) return -1;
    // age is ticks; the scan walked whole columns, so this division is exact.
    return leadStoredIndexAt(columnInLoop - covering.age / stride, stepsPerBar, stride);
  }
  ```
  Replace `resizeLeadMelody`'s signature and the two lines that size it:
  ```ts
  export function resizeLeadMelody(
    steps: readonly LeadNote[][],
    newLoopLength: number,
    stepsPerBar: number,
    stride: number,
  ): LeadNote[][] {
    const targetLen = newLoopLength * LEAD_TICKS_PER_BAR;
    const loopEndTicks = newLoopLength * stepsPerBar * TICKS_PER_SIXTEENTH;
  ```
  and, inside its loop, the dormancy branch Task 3 already routed through the function:
  ```ts
      const activePos = leadActivePosAt(i, stepsPerBar, stride);
      if (activePos < 0) {
        out.push(row.map((n) => ({ ...n })));
        continue;
      }
      // activePos is a column and a column starts on activePos * stride ticks
      // exactly, because columnsPerBar * stride == the bar's ticks for every
      // meter (pinned by stepResolution.test.ts).
      const maxLen = Math.max(1, loopEndTicks - activePos * stride);
      out.push(row.map((n) => ({ note: n.note, len: Math.min(n.len, maxLen) })));
  ```
  Replace `leadAudibleLen`:
  ```ts
  function leadAudibleLen(
    s: LeadSounding,
    loop: { tickInLoop: number; melodyTicks: number },
  ): number {
    const startTick = loop.tickInLoop - s.age;
    return Math.max(1, Math.min(s.len, loop.melodyTicks - startTick));
  }
  ```
  Replace `resolveLeadStepTriggers`'s signature and its block branch:
  ```ts
  export function resolveLeadStepTriggers(
    sounding: readonly LeadSounding[],
    arpActive: boolean,
    arpStep: number,
    params: { arpMode: ArpMode; arpRate: ArpRate; arpOctaves: number },
    tickDurSec: number,
    gate: number,
    stride: number,
    loop: { tickInLoop: number; melodyTicks: number },
  ): LeadTrigger[] {
    if (sounding.length === 0) return [];
    if (!arpActive) {
      return sounding
        .filter((s) => s.age === 0)
        .map((s) => {
          // What SOUNDS is what is DRAWN: this is the same rounding the grid
          // draws the note's width with. A note that showed as two cells but
          // sounded for five ticks would reintroduce exactly the invisible
          // state silent dormancy was chosen to avoid.
          //
          // The ceil cannot overrun the loop end: startTick is on-grid and
          // the bar's ticks divide by the stride for every meter, so
          // melodyTicks - startTick is a whole number of cells.
          const cells = Math.max(1, Math.ceil(leadAudibleLen(s, loop) / stride));
          return {
            note: s.note,
            timeOffsetSec: 0,
            holdSec: (cells - 1 + gate) * stride * tickDurSec,
          };
        });
    }
    if (!arpFiresOnStep(arpStep, params.arpRate)) return [];
  ```
  and, in the arp branch, feed `computeArpTriggers` the 16th it has always been given, rebuilt from the tick. The arp runs on the clock's 16ths, not on the grid's resolution: this branch reads `sounding.map((s) => s.note)`, presence only, and never asks a note how long it is, which is why `cells`/`gate` are confined to the block branch above and why `computeArpTriggers` keeps deriving its own `holdSec`. Task 8 states the model and pins it.
  ```ts
    return computeArpTriggers(
      arpStep,
      sequence.length,
      params.arpRate,
      tickDurSec * TICKS_PER_SIXTEENTH,
    ).map((t) => ({
  ```
  Replace `clampLeadCursor` and `leadCursorBar`:
  ```ts
  export function clampLeadCursor(
    cursor: number,
    loopLength: number,
    stepsPerBar: number,
    stride: number,
  ): number {
    if (!Number.isFinite(cursor)) return 0;
    const lastColumn = Math.max(0, loopLength * columnsPerBar(stepsPerBar, stride) - 1);
    return Math.min(lastColumn, Math.max(0, Math.round(cursor)));
  }

  /** The bar a cursor COLUMN falls in. */
  export function leadCursorBar(cursor: number, stepsPerBar: number, stride: number): number {
    return Math.floor(cursor / columnsPerBar(stepsPerBar, stride));
  }
  ```
  Replace `copyLeadBar`'s body — the clipboard carries ticks, so copying at one resolution and pasting at another is well defined with no conversion:
  ```ts
  export function copyLeadBar(steps: readonly LeadNote[][], bar: number): LeadNote[][] {
    const base = bar * LEAD_TICKS_PER_BAR;
    return Array.from({ length: LEAD_TICKS_PER_BAR }, (_, i) =>
      (steps[base + i] ?? []).map((n) => ({ note: n.note, len: n.len })),
    );
  }
  ```
  Replace `pasteLeadBar`'s signature and body:
  ```ts
  export function pasteLeadBar(
    steps: readonly LeadNote[][],
    bar: number,
    clip: readonly LeadNote[][],
    stepsPerBar: number,
    stride: number,
    loopLength: number,
  ): LeadNote[][] {
    const next = steps.map((row) => row.map((n) => ({ note: n.note, len: n.len })));
    const base = bar * LEAD_TICKS_PER_BAR;
    const ticksPerBar = stepsPerBar * TICKS_PER_SIXTEENTH;
    const barStartTick = bar * ticksPerBar;
    const loopEndTicks = loopLength * ticksPerBar;

    for (let idx = 0; idx < base && idx < next.length; idx++) {
      const pos = leadActivePosAt(idx, stepsPerBar, stride);
      if (pos < 0) continue;
      const startTick = pos * stride;
      next[idx] = next[idx].map((n) =>
        startTick + n.len > barStartTick ? { note: n.note, len: barStartTick - startTick } : n,
      );
    }

    for (let i = 0; i < LEAD_TICKS_PER_BAR; i++) {
      next[base + i] = (clip[i] ?? []).map((n) => ({ note: n.note, len: n.len }));
    }

    for (let i = 0; i < LEAD_TICKS_PER_BAR; i++) {
      const pos = leadActivePosAt(base + i, stepsPerBar, stride);
      if (pos < 0) continue;
      const startTick = pos * stride;
      next[base + i] = next[base + i].map((n) => ({
        note: n.note,
        len: Math.max(1, Math.min(n.len, loopEndTicks - startTick)),
      }));
      for (const n of next[base + i]) {
        // Walk TICKS, not columns: a pasted note swallows the same pitch
        // underneath it wherever it is stored, including slots the current
        // resolution cannot reach.
        for (let k = 1; k < n.len; k++) {
          const covered = storedIndexAtTick(startTick + k, stepsPerBar);
          if (covered === base + i || !next[covered]) continue;
          next[covered] = next[covered].filter((x) => x.note !== n.note);
        }
      }
    }

    return next;
  }
  ```

- [ ] **Step 4: Move every caller to the fixed stride.**
  In `src/store/leadSlice.ts`:
  - Replace the `MAX_STEPS_PER_BAR` import from `'../utils/meter'` with `import { getMeter } from '../utils/meter';` and add `import { LEAD_TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from '../utils/stepResolution';`.
  - Add, immediately above `createLeadSlice`:
    ```ts
    // Fixed at one 16th until the per-loop field lands (DEV-375 Task 5), so
    // this task provably changes no behaviour. Every call below reads it.
    const STRIDE = TICKS_PER_SIXTEENTH;
    ```
  - Replace `Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[])` with `Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[])`.
  - In `paintLeadNote`, replace `{ note, len: 1 }` with `{ note, len: STRIDE }` and add above it:
    ```ts
          // The editor writes whole CELLS, and a cell is `stride` ticks. A
          // literal 1 here would draw a note a fraction of a cell long the
          // moment the resolution is anything but the finest.
    ```
  - Append `, STRIDE` to every `clampLeadCursor(...)`, `leadCursorBar(...)`, `leadActivePosAt(...)`, `leadStoredIndexAt(...)`, `resizeLeadMelody(...)` call, and to `pasteLeadBar(...)` **before** its `loopLength` argument. Insert `STRIDE` as `leadCoveringNoteIndex`'s fourth argument, before `note`.
  - In `setLeadNoteLength`, replace the `maxLen` line with:
    ```ts
            const maxLen = Math.max(
              STRIDE,
              state.leadLoopLength * stepsPerBar * TICKS_PER_SIXTEENTH - activePos * STRIDE,
            );
    ```

  In `src/store/loopSlice.ts`, add `import { LEAD_TICKS_PER_BAR } from '../utils/stepResolution';` and change only the melody line — the chord-rhythm and bass rows keep `MAX_STEPS_PER_BAR`:
  ```ts
      leadMelodySteps: Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]),
  ```

  In `src/store/leadRecord.ts`, add `import { TICKS_PER_SIXTEENTH } from '../utils/stepResolution';` and append `, TICKS_PER_SIXTEENTH` to the `clampLeadCursor(...)` and `leadStoredIndexAt(...)` calls.

  In `src/components/loop/lead/melodyGrid.ts`, add `import { TICKS_PER_SIXTEENTH } from '../../../utils/stepResolution';` and append `, TICKS_PER_SIXTEENTH` to both `leadStoredIndexAt(...)` calls.

  In `src/components/loop/lead/LeadMelodyGrid.tsx`, add the same import and append `, TICKS_PER_SIXTEENTH` to the `leadStoredIndexAt(...)`, `clampLeadCursor(...)` and `leadCursorBar(...)` calls.

  In `src/components/loop/lead/useLeadPlayback.ts`, replace the block from `const sounding = ...` to the end of the `resolveLeadStepTriggers(...)` call with:
  ```ts
        const stride = TICKS_PER_SIXTEENTH;
        const sounding = leadSoundingNotes(s.leadMelodySteps, stepInLoop, stepsPerBar, stride);
        const tickDur = stepDurationSec(s.bpm) / TICKS_PER_SIXTEENTH;
        const arpStep = arpStepFor(step, stepsPerBar);
        const triggers = resolveLeadStepTriggers(
          sounding,
          s.synthParams.arpActive,
          arpStep,
          s.synthParams,
          tickDur,
          s.leadGate,
          stride,
          // The ACTIVE window in TICKS, so a note left overhanging by a METER
          // change is capped at read time instead of ringing over the seam.
          {
            tickInLoop: stepInLoop * TICKS_PER_SIXTEENTH,
            melodyTicks: melodyLength * TICKS_PER_SIXTEENTH,
          },
        );
  ```
  and add `import { TICKS_PER_SIXTEENTH } from '../../../utils/stepResolution';`.

- [ ] **Step 5: Run the whole suite — this is the proof.**
  ```bash
  bun test
  bun run lint
  bun run eslint
  ```
  Everything green, zero eslint errors, no new warnings. Any test that fails here is either a fixture spelled in the old units (re-express it in ticks: a stored index of `24` for bar 1 becomes `LEAD_TICKS_PER_BAR`, and a `len` counted in 16ths doubles) or a genuine behaviour change you have just introduced — **treat every failure as the second until you have read it**.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/audio/leadMelody.ts src/audio/leadMelody.test.ts src/store/leadSlice.ts src/store/loopSlice.ts src/store/leadRecord.ts src/components/loop/lead/melodyGrid.ts src/components/loop/lead/LeadMelodyGrid.tsx src/components/loop/lead/useLeadPlayback.ts
  git commit -m "$(cat <<'EOF'
  refactor(audio): store the lead melody in ticks and stride to the active grid (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 5: The `leadStepResolution` field, and the store reading it

A new per-loop field beside `leadLoopLength`, and every `STRIDE` constant Task 4 planted replaced by the live value. Per-loop, not global like `meterId`: a global flip would silence off-grid notes in every loop at once, so refining one loop's melody would mute another the user was not looking at — and the data a resolution *reinterprets* is per-loop data, so the lens onto it belongs there too.

`LOOP_FLAT_KEYS` feeds `PROJECT_LOOP_KEYS`, so the project fingerprint picks the field up automatically. `projectFormat.test.ts` pins that derivation against the `Loop` interface and **will fail until the addition is acknowledged there** — that is the point of that test, so add the key to the fixture rather than working around it. `loops` is already a project content key, so there is **no new top-level key and no change to `PROJECT_CONTENT_KEYS`**.

**Files:**
- Modify: `src/store/types.ts`, `src/store/loopSlice.ts`, `src/store/leadSlice.ts`, `src/store/loop.ts`
- Test: `src/store/leadSlice.test.ts`, `src/store/projectFormat.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_LEAD_STEP_RESOLUTION`, `strideFor`, `type LeadStepResolutionId` from `src/utils/stepResolution.ts`.
- Produces:
  ```ts
  // types.ts — on Loop and on LeadSlice
  leadStepResolution: LeadStepResolutionId;
  setLeadStepResolution: (id: LeadStepResolutionId) => void;
  ```
  `LOOP_FLAT_KEYS` gains `'leadStepResolution'`, immediately after `'leadLoopLength'`.

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  Append to `src/store/leadSlice.test.ts`:
  ```ts
  describe('leadStepResolution', () => {
    test('defaults to 1/16 — what every existing project is authored at', () => {
      expect(useAppStore.getState().leadStepResolution).toBe('1/16');
    });

    test('the setter takes the three ids and refuses anything else', () => {
      useAppStore.getState().setLeadStepResolution('1/32');
      expect(useAppStore.getState().leadStepResolution).toBe('1/32');
      useAppStore.getState().setLeadStepResolution('1/8');
      expect(useAppStore.getState().leadStepResolution).toBe('1/8');
      // Never throws — this value feeds the scheduler.
      useAppStore.getState().setLeadStepResolution('1/12' as never);
      expect(useAppStore.getState().leadStepResolution).toBe('1/16');
    });

    test('changing resolution writes nothing to the melody', () => {
      // The same invariant a meter change already keeps. Snapping every len
      // to a whole cell at the moment of the switch would RATCHET: a 5-tick
      // note becomes 6 at 1/16, then 8 at 1/8, and coming back to 1/32 gives
      // 8 rather than 5. Flipping the control three times would lengthen
      // music nobody asked to lengthen, unrecoverably.
      useAppStore.setState({ leadStepResolution: '1/32' });
      useAppStore.getState().paintLeadNote(0, 'C4', 'draw');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 5);
      const before = JSON.stringify(useAppStore.getState().leadMelodySteps);

      useAppStore.getState().setLeadStepResolution('1/8');
      expect(JSON.stringify(useAppStore.getState().leadMelodySteps)).toBe(before);
      useAppStore.getState().setLeadStepResolution('1/32');
      expect(JSON.stringify(useAppStore.getState().leadMelodySteps)).toBe(before);
    });

    test('a drawn note is one CELL long, whatever the resolution', () => {
      // len is ticks; the editor writes whole cells. Same music, different
      // number written down.
      useAppStore.setState({ leadStepResolution: '1/8' });
      useAppStore.getState().paintLeadNote(0, 'C4', 'draw');
      expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 4 }]);

      useAppStore.setState({
        leadStepResolution: '1/32',
        leadMelodySteps: useAppStore.getState().leadMelodySteps.map(() => []),
      });
      useAppStore.getState().paintLeadNote(0, 'D4', 'draw');
      expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'D4', len: 1 }]);
    });
  });
  ```
  In `src/store/projectFormat.test.ts`, add `leadStepResolution: '1/16',` to the loop fixture that the pinned key-set test builds (the object the comment above it describes as failing when a `Loop` field is added without listing it in `PROJECT_LOOP_KEYS`).

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/store/leadSlice.test.ts -t "leadStepResolution"
  bun test src/store/projectFormat.test.ts
  ```
  Expected failures: `expect(received).toBe(expected)` receiving `undefined` for the default, and `projectFormat.test.ts` reporting the two key lists differ by `leadStepResolution`.

- [ ] **Step 3: Add the field.**
  In `src/store/types.ts`, add to the imports:
  ```ts
  import type { LeadStepResolutionId } from '../utils/stepResolution';
  ```
  In the `Loop` interface, after `leadLoopLength: number;`:
  ```ts
    leadStepResolution: LeadStepResolutionId;
  ```
  In `LeadSlice`, after the `leadLoopLength` field and its comment:
  ```ts
    /**
     * How fine this loop's melody grid is. Per loop, not global: a global
     * flip would silence off-grid notes in every loop at once, so refining
     * one melody would mute another the user was not looking at.
     */
    leadStepResolution: LeadStepResolutionId;
  ```
  and, beside `setLeadLoopLength`:
  ```ts
    setLeadStepResolution: (id: LeadStepResolutionId) => void;
  ```

  In `src/store/loop.ts`, add `'leadStepResolution',` to `LOOP_FLAT_KEYS` immediately after `'leadLoopLength',`.

  In `src/store/loopSlice.ts`, add `import { DEFAULT_LEAD_STEP_RESOLUTION } from '../utils/stepResolution';` and, in `createDefaultLoop`, after `leadLoopLength: 1,`:
  ```ts
      leadStepResolution: DEFAULT_LEAD_STEP_RESOLUTION,
  ```

  In `src/store/leadSlice.ts`:
  - Replace the `TICKS_PER_SIXTEENTH` import with:
    ```ts
    import {
      DEFAULT_LEAD_STEP_RESOLUTION,
      LEAD_TICKS_PER_BAR,
      TICKS_PER_SIXTEENTH,
      isLeadStepResolutionId,
      strideFor,
    } from '../utils/stepResolution';
    ```
  - **Delete** the `const STRIDE = TICKS_PER_SIXTEENTH;` line from Task 4.
  - Add the default beside `leadLoopLength: 1,`:
    ```ts
      leadStepResolution: DEFAULT_LEAD_STEP_RESOLUTION,
    ```
  - Add the setter beside `setLeadLoopLengthPreserve`:
    ```ts
      // Never throws and never writes the melody: an unknown id falls back to
      // the default, and a resolution change is a change of VIEW. An explicit
      // edit writes; a change of view never does.
      setLeadStepResolution: (id) =>
        set({
          leadStepResolution: isLeadStepResolutionId(id) ? id : DEFAULT_LEAD_STEP_RESOLUTION,
        }),
    ```
  - Replace every `STRIDE` argument with the live value. In `selectedBar`, take the resolution off the state it is already handed:
    ```ts
    function selectedBar(state: {
      leadCursor: number;
      leadLoopLength: number;
      leadStepResolution: AppStore['leadStepResolution'];
      meterId: AppStore['meterId'];
    }): number {
      const stepsPerBar = getMeter(state.meterId).stepsPerBar;
      const stride = strideFor(state.leadStepResolution);
      return leadCursorBar(
        clampLeadCursor(state.leadCursor, state.leadLoopLength, stepsPerBar, stride),
        stepsPerBar,
        stride,
      );
    }
    ```
    In every other function, add `const stride = strideFor(state.leadStepResolution);` next to the existing `const stepsPerBar = ...` line and pass `stride`. In `paintLeadNote` the drawn length becomes the cell width:
    ```ts
            return covered ? r.filter((n) => n.note !== note) : [...r, { note, len: stride }];
    ```
    and in `setLeadNoteLength`:
    ```ts
            const maxLen = Math.max(
              stride,
              state.leadLoopLength * stepsPerBar * TICKS_PER_SIXTEENTH - activePos * stride,
            );
    ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/store/leadSlice.test.ts
  bun test src/store/projectFormat.test.ts
  bun test src/store/projectFingerprint.test.ts
  bun test src/store/loopSlice.test.ts
  bun run lint
  bun run eslint
  ```
  `projectFingerprint.test.ts` must pass untouched: the fingerprint reads `PROJECT_LOOP_KEYS`, so the new field joins the dirty check for free.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/store/types.ts src/store/loop.ts src/store/loopSlice.ts src/store/leadSlice.ts src/store/leadSlice.test.ts src/store/projectFormat.test.ts
  git commit -m "$(cat <<'EOF'
  feat(store): give each loop its own lead step resolution (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 6: Both migration chains, and only the transform shared

One pure transform, two callers, and **the two chains must never be merged into one**. A persist payload is private `localStorage` shape; a project body is an external contract; their version numbers move for different reasons. The shared piece is the pure transform and only the pure transform — the same arrangement `upgradeLeadMelodyV1` already has.

Ordering inside each chain matters: the tick widening runs **after** the existing `upgradeLeadMelodyV1` step, so a pre-DEV-369 `string[][]` payload becomes `LeadNote[][]` at the narrow stored width first and is then widened. Never the other way round.

The trap, restated because it has already bitten once: **an un-upgraded payload that reaches the sanitize step comes back blank — no throw, no warning.** `isLeadNoteMatrix` rejects a shape it does not recognise and hands back an empty melody. The failure is a user's melody silently vanishing on reload, which no test that only exercises the current shape will ever catch. Each chain gets an end-to-end test that starts from a genuinely old payload and ends at a populated melody.

**Do not write a version number into this plan or into CLAUDE.md.** Read the current `version` in `src/store/store.ts` and the current `PROJECT_FORMAT_VERSION` in `src/store/projectFormat.ts`, and add one to each. Below, `N` means "the value you just wrote" and `N-1` means "the value that was there".

**Files:**
- Modify: `src/audio/leadMelody.ts`, `src/store/migrate.ts`, `src/store/store.ts`, `src/store/projectFormat.ts`, `src/store/projectFormatMigrate.ts`
- Test: `src/audio/leadMelody.test.ts`, `src/store/migrate.test.ts`, `src/store/projectFormatMigrate.test.ts`

**Interfaces:**
- Consumes: `LEAD_TICKS_PER_BAR`, `TICKS_PER_SIXTEENTH`, `DEFAULT_LEAD_STEP_RESOLUTION` from `src/utils/stepResolution.ts`; `MAX_STEPS_PER_BAR` from `src/utils/meter.ts` (the *old* stored width, which is what makes this a widening).
- Produces:
  ```ts
  // src/audio/leadMelody.ts, beside upgradeLeadMelodyV1
  export function upgradeLeadMelodyToTicks(steps: readonly LeadNote[][], bars: number): LeadNote[][]

  // src/store/migrate.ts — the persist chain's step
  export function migrateLeadStepResolution<T extends object>(state: T): T
  ```
  `migrateProjectBody(raw, fromVersion)` keeps its exact signature and gains one gated step.

**Steps:**

- [ ] **Step 1: Write the failing tests for the transform.**
  Append to `src/audio/leadMelody.test.ts`:
  ```ts
  describe('upgradeLeadMelodyToTicks', () => {
    const oldBar = (): LeadNote[][] =>
      Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]);

    test('slot i becomes tick 2i and the odd ticks are empty', () => {
      const steps = oldBar();
      steps[0] = [{ note: 'C4', len: 1 }];
      steps[3] = [{ note: 'E4', len: 1 }];
      const out = upgradeLeadMelodyToTicks(steps, 1);

      expect(out).toHaveLength(LEAD_TICKS_PER_BAR);
      expect(out[0]).toEqual([{ note: 'C4', len: 2 }]);
      expect(out[1]).toEqual([]);
      expect(out[6]).toEqual([{ note: 'E4', len: 2 }]);
      expect(out[7]).toEqual([]);
    });

    test('every len doubles, because len now counts ticks', () => {
      // A note that was 4 sixteenths long is 8 ticks long. Same music, and
      // the same holdSec once resolveLeadStepTriggers rounds it to cells.
      const steps = oldBar();
      steps[0] = [{ note: 'C4', len: 4 }];
      expect(upgradeLeadMelodyToTicks(steps, 1)[0]).toEqual([{ note: 'C4', len: 8 }]);
    });

    test('a dormant slot the meter could not reach survives the widening', () => {
      // Slot 20 is unreachable in 4/4 and reachable in 12/8. Quiet, not gone
      // — the widening must not be the thing that finally loses it.
      const steps = oldBar();
      steps[20] = [{ note: 'G5', len: 1 }];
      expect(upgradeLeadMelodyToTicks(steps, 1)[40]).toEqual([{ note: 'G5', len: 2 }]);
    });

    test('widens every bar, not just the first', () => {
      const steps = [...oldBar(), ...oldBar()];
      steps[MAX_STEPS_PER_BAR] = [{ note: 'A4', len: 2 }];
      const out = upgradeLeadMelodyToTicks(steps, 2);
      expect(out).toHaveLength(2 * LEAD_TICKS_PER_BAR);
      expect(out[LEAD_TICKS_PER_BAR]).toEqual([{ note: 'A4', len: 4 }]);
    });

    test('an already-current payload comes back untouched', () => {
      // Idempotent by WIDTH, checked against the loop's own bar count: the
      // version gate is the real guard, but a transform that doubles a
      // current payload's lengths a second time would be catastrophic and
      // undetectable, so it refuses rather than trusting the gate alone.
      const current: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
      current[0] = [{ note: 'C4', len: 2 }];
      expect(upgradeLeadMelodyToTicks(current, 1)).toEqual(current);
    });

    test('a ragged payload is padded rather than dropped', () => {
      expect(upgradeLeadMelodyToTicks([[{ note: 'C4', len: 1 }]], 1)).toHaveLength(
        LEAD_TICKS_PER_BAR,
      );
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/audio/leadMelody.test.ts -t "upgradeLeadMelodyToTicks"
  ```
  Expected failure: `SyntaxError: Export named 'upgradeLeadMelodyToTicks' not found in module '.../src/audio/leadMelody.ts'`.

- [ ] **Step 3: Write the transform, next to the one it follows.**
  In `src/audio/leadMelody.ts`, add `import { MAX_STEPS_PER_BAR } from '../utils/meter';` back (it is the *old* width and only this function needs it), and add immediately after `upgradeLeadMelodyV1`:
  ```ts
  /**
   * The second transform both migration chains share: the melody widens from
   * MAX_STEPS_PER_BAR slots a bar to LEAD_TICKS_PER_BAR, stored slot `i`
   * becomes tick `i * TICKS_PER_SIXTEENTH`, the ticks between stay empty, and
   * every `len` is multiplied by TICKS_PER_SIXTEENTH because it now counts
   * ticks instead of 16ths.
   *
   * `bars` is the loop's own bar count. It is an argument rather than a
   * derivation because LEAD_TICKS_PER_BAR is itself a multiple of
   * MAX_STEPS_PER_BAR, so an array's length alone cannot say whether it is
   * two old bars or one new one — and guessing wrong doubles every length a
   * second time, silently and unrecoverably.
   *
   * The persist chain and the .solna chain call this from two separate
   * functions and must NOT be refactored into one: the persist payload is
   * private localStorage shape, a project body is an external contract, and
   * the two version numbers move for different reasons.
   */
  export function upgradeLeadMelodyToTicks(
    steps: readonly LeadNote[][],
    bars: number,
  ): LeadNote[][] {
    const barCount = Math.max(1, Math.round(bars) || 1);
    if (steps.length === barCount * LEAD_TICKS_PER_BAR) {
      return steps.map((row) => row.map((n) => ({ note: n.note, len: n.len })));
    }
    const out: LeadNote[][] = Array.from(
      { length: barCount * LEAD_TICKS_PER_BAR },
      () => [] as LeadNote[],
    );
    for (let bar = 0; bar < barCount; bar++) {
      for (let slot = 0; slot < MAX_STEPS_PER_BAR; slot++) {
        const row = steps[bar * MAX_STEPS_PER_BAR + slot];
        if (!row) continue;
        out[bar * LEAD_TICKS_PER_BAR + slot * TICKS_PER_SIXTEENTH] = row.map((n) => ({
          note: n.note,
          len: Math.max(1, Math.round(n.len)) * TICKS_PER_SIXTEENTH,
        }));
      }
    }
    return out;
  }
  ```

- [ ] **Step 4: Run the transform's tests, then write the two chains' failing tests.**
  ```bash
  bun test src/audio/leadMelody.test.ts -t "upgradeLeadMelodyToTicks"
  ```
  All green. Now append to `src/store/migrate.test.ts`:
  ```ts
  describe('migrateLeadStepResolution', () => {
    const oldLoop = (): Record<string, unknown> => {
      const steps: unknown[][] = Array.from({ length: MAX_STEPS_PER_BAR }, () => []);
      steps[4] = [{ note: 'C4', len: 2 }];
      return { id: 'loop-1', name: 'Loop 1', leadLoopLength: 1, leadMelodySteps: steps };
    };

    test('widens the melody and doubles the lengths', () => {
      const out = migrateLeadStepResolution({ loops: [oldLoop()] }) as {
        loops: { leadMelodySteps: LeadNote[][] }[];
      };
      expect(out.loops[0].leadMelodySteps).toHaveLength(LEAD_TICKS_PER_BAR);
      expect(out.loops[0].leadMelodySteps[8]).toEqual([{ note: 'C4', len: 4 }]);
    });

    test('every loop without the field gets 1/16', () => {
      // Not an arbitrary default: 1/16 is the resolution the melody actually
      // WAS authored at, so with the doubling above an existing project opens
      // with every note on the same beat, the same length and the same sound.
      const out = migrateLeadStepResolution({ loops: [oldLoop()] }) as {
        loops: { leadStepResolution: string }[];
      };
      expect(out.loops[0].leadStepResolution).toBe('1/16');
    });

    test('a payload with no loops is returned unharmed', () => {
      expect(migrateLeadStepResolution({ bpm: 120 })).toEqual({ bpm: 120 });
    });

    test('an old string[][] melody survives the WHOLE chain, not blank', () => {
      // The trap, end to end: isLeadNoteMatrix rejects the pre-DEV-369 shape
      // and hands back an EMPTY melody with no throw and no warning, so a
      // payload that reaches sanitize un-upgraded loses the user's music on
      // reload. The two lead steps must run in order — V1 first, ticks second.
      const legacy = Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]);
      legacy[2] = ['C4'];
      const lengthened = migrateLeadNoteLength({
        loops: [{ id: 'loop-1', name: 'Loop 1', leadLoopLength: 1, leadMelodySteps: legacy }],
      });
      const out = migrateLeadStepResolution(lengthened) as {
        loops: { leadMelodySteps: LeadNote[][]; leadStepResolution: string }[];
      };
      expect(out.loops[0].leadMelodySteps[4]).toEqual([{ note: 'C4', len: 2 }]);
      expect(out.loops[0].leadStepResolution).toBe('1/16');
    });
  });
  ```
  and to `src/store/projectFormatMigrate.test.ts`:
  ```ts
  describe('the .solna chain widens the melody to ticks', () => {
    const body = (steps: unknown, formatVersion: number): Record<string, unknown> => ({
      formatVersion,
      content: {
        loops: [{ id: 'loop-1', name: 'Loop 1', leadLoopLength: 1, leadMelodySteps: steps }],
      },
    });

    test('a current-shape body one version behind is widened and defaulted', () => {
      const steps: unknown[][] = Array.from({ length: MAX_STEPS_PER_BAR }, () => []);
      steps[4] = [{ note: 'C4', len: 2 }];
      const out = migrateProjectBody(body(steps, PROJECT_FORMAT_VERSION - 1), PROJECT_FORMAT_VERSION - 1);
      const loop = (out.content as { loops: Record<string, unknown>[] }).loops[0];
      expect(loop.leadMelodySteps).toHaveLength(LEAD_TICKS_PER_BAR);
      expect((loop.leadMelodySteps as LeadNote[][])[8]).toEqual([{ note: 'C4', len: 4 }]);
      expect(loop.leadStepResolution).toBe('1/16');
    });

    test('a v1 body runs BOTH lead steps, in order, and lands populated', () => {
      // Same trap as the persist chain, and the reason each chain needs its
      // own end-to-end test: a v1 string[][] widened first would never become
      // LeadNote[][] at all, and sanitizeContent would hand back a blank
      // melody with no throw and no warning.
      const legacy = Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]);
      legacy[2] = ['C4'];
      const out = migrateProjectBody(body(legacy, 1), 1);
      const loop = (out.content as { loops: Record<string, unknown>[] }).loops[0];
      expect((loop.leadMelodySteps as LeadNote[][])[4]).toEqual([{ note: 'C4', len: 2 }]);
      expect(loop.leadGate).toBeCloseTo(DEFAULT_LEAD_GATE, 10);
      expect(loop.leadStepResolution).toBe('1/16');
    });

    test('the two chains are separate functions, and stay separate', () => {
      const src = readFileSync(new URL('./projectFormatMigrate.ts', import.meta.url), 'utf8');
      // The ONLY thing shared with the persist chain is the pure transform.
      expect(src).toContain('upgradeLeadMelodyToTicks');
      expect(src).not.toContain("from './migrate'");
      expect(src).not.toContain("from './store'");
    });
  });
  ```

- [ ] **Step 5: Run both chains' tests and watch them fail.**
  ```bash
  bun test src/store/migrate.test.ts -t "migrateLeadStepResolution"
  bun test src/store/projectFormatMigrate.test.ts
  ```
  Expected failures: `SyntaxError: Export named 'migrateLeadStepResolution' not found in module '.../src/store/migrate.ts'`, and `expect(received).toHaveLength(expected)` receiving `24` in the `.solna` suite.

- [ ] **Step 6: Add the persist chain's step and bump its version.**
  In `src/store/migrate.ts`, add `upgradeLeadMelodyToTicks` to the existing `from '../audio/leadMelody'` import list, add `import { DEFAULT_LEAD_STEP_RESOLUTION } from '../utils/stepResolution';`, and append after `migrateLeadNoteLength`:
  ```ts
  /**
   * The lead melody widens from MAX_STEPS_PER_BAR slots a bar to
   * LEAD_TICKS_PER_BAR, `len` starts counting ticks, and every loop gains the
   * resolution it was actually authored at.
   *
   * Runs AFTER migrateLeadNoteLength, never before: that step turns a
   * pre-DEV-369 string[][] into LeadNote[][] at the narrow width, and widening
   * an un-upgraded payload would leave a shape sanitize rejects — blank
   * melody, no throw, no warning.
   *
   * Shares only the pure transform with the .solna chain in
   * projectFormatMigrate.ts. The two must NOT be refactored into one.
   */
  export function migrateLeadStepResolution<T extends object>(state: T): T {
    const next = { ...(state as Record<string, unknown>) } as Record<string, unknown>;
    if (!Array.isArray(next.loops)) return next as unknown as T;
    next.loops = next.loops.map((loop) => {
      if (!loop || typeof loop !== 'object' || Array.isArray(loop)) return loop;
      const row = loop as Record<string, unknown>;
      const bars = typeof row.leadLoopLength === 'number' ? row.leadLoopLength : 1;
      return {
        ...row,
        leadMelodySteps: Array.isArray(row.leadMelodySteps)
          ? upgradeLeadMelodyToTicks(row.leadMelodySteps as LeadNote[][], bars)
          : row.leadMelodySteps,
        leadStepResolution:
          typeof row.leadStepResolution === 'string'
            ? row.leadStepResolution
            : DEFAULT_LEAD_STEP_RESOLUTION,
      };
    });
    return next as unknown as T;
  }
  ```
  In `src/store/store.ts`, add `migrateLeadStepResolution` to the `from './migrate'` import list, **read the current `version:` value, add one, and write it back**, then add the new link after `lengthened`:
  ```ts
          // v(N-1) -> vN (lead melody in ticks + per-loop step resolution).
          // Runs LAST, outside `lengthened`, so the melody it widens is
          // already LeadNote[][] at the narrow stored width.
          const ticked = (payload: PersistedState): PersistedState => {
            const base = lengthened(payload);
            return version >= N ? base : (migrateLeadStepResolution(base) as PersistedState);
          };
          if (version >= 2) return ticked(wrapped(metered(recoloured)));
  ```
  replacing the existing `if (version >= 2) return lengthened(wrapped(metered(recoloured)));` line. Substitute the real number for `N`.

- [ ] **Step 7: Add the `.solna` chain's step and bump its format version.**
  In `src/store/projectFormat.ts`, **read the current `PROJECT_FORMAT_VERSION`, add one, and write it back.** In `src/store/projectFormatMigrate.ts`, add `upgradeLeadMelodyToTicks` to the `from '../audio/leadMelody'` import list, add `import { DEFAULT_LEAD_STEP_RESOLUTION } from '../utils/stepResolution';`, and add:
  ```ts
  /**
   * v(N-1) -> vN: the melody is stored in ticks and each loop carries the
   * resolution it was authored at. Shares only the pure
   * upgradeLeadMelodyToTicks transform with the persist chain in migrate.ts —
   * the two must NOT be refactored into one: a project body is an external
   * contract, the persist payload is private localStorage shape, and their
   * version numbers move for different reasons.
   */
  function upgradeLeadTicksVN(raw: Record<string, unknown>): Record<string, unknown> {
    const content = raw.content;
    if (typeof content !== 'object' || content === null || Array.isArray(content)) return raw;
    const c = content as Record<string, unknown>;
    if (!Array.isArray(c.loops)) return raw;
    return {
      ...raw,
      content: {
        ...c,
        loops: c.loops.map((loop) => {
          if (typeof loop !== 'object' || loop === null || Array.isArray(loop)) return loop;
          const row = loop as Record<string, unknown>;
          const bars = typeof row.leadLoopLength === 'number' ? row.leadLoopLength : 1;
          return {
            ...row,
            leadMelodySteps: Array.isArray(row.leadMelodySteps)
              ? upgradeLeadMelodyToTicks(row.leadMelodySteps as LeadNote[][], bars)
              : row.leadMelodySteps,
            leadStepResolution:
              typeof row.leadStepResolution === 'string'
                ? row.leadStepResolution
                : DEFAULT_LEAD_STEP_RESOLUTION,
          };
        }),
      },
    };
  }
  ```
  Rename it to the real version number (`upgradeLeadTicksV3` if `N` is 3), and add the gated step to `migrateProjectBody`, after the existing one:
  ```ts
    if (fromVersion < N) next = upgradeLeadTicksVN(next);
  ```
  The order in that function is the chain order, and it must stay ascending: `upgradeLeadNotesV2` first, this second.

- [ ] **Step 8: Run the tests.**
  ```bash
  bun test src/store/migrate.test.ts
  bun test src/store/projectFormatMigrate.test.ts
  bun test src/store/projectFile.test.ts
  bun test src/store/store.test.ts
  bun test src/audio/leadMelody.test.ts
  bun run lint
  bun run eslint
  ```
  All green. If `projectFile.test.ts` fails on a round-trip, check that the saved body's `formatVersion` is the new one and that its melody is at the new width — a save writes `PROJECT_FORMAT_VERSION` unconditionally.

- [ ] **Step 9: Commit.**
  ```bash
  git add src/audio/leadMelody.ts src/audio/leadMelody.test.ts src/store/migrate.ts src/store/migrate.test.ts src/store/store.ts src/store/projectFormat.ts src/store/projectFormatMigrate.ts src/store/projectFormatMigrate.test.ts
  git commit -m "$(cat <<'EOF'
  feat(store): migrate both chains to the tick-wide lead melody (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 7: Live capture, which needs almost nothing

This is DEV-374's dividend, and it is worth being explicit about how little is left to do.

**`measuredStepDurationSec` is unchanged.** It measures the 16th from clock anchors, and the clock still counts 16ths. Its own docblock predicted this; the prediction holds because the thing it measures is the thing that did not change. **`quantiseInputStep` is unchanged.** It still returns a fractional-then-rounded clock step. **Do not "fix" either of them.**

Two functions move. `clockStepToGridColumn` gains the stride and stops being the identity — the single named conversion DEV-374 created for exactly this moment. `heldStepLength` returns ticks with a floor of one cell.

**Files:**
- Modify: `src/audio/leadLiveRecord.ts`, `src/store/leadRecord.ts`, `src/components/loop/lead/melodyGrid.ts`, `src/components/loop/lead/useLeadMarker.ts`, `src/components/loop/lead/useLeadPlayback.ts`
- Test: `src/audio/leadLiveRecord.test.ts`, `src/store/leadRecord.test.ts`

**Interfaces:**
- Consumes: `TICKS_PER_SIXTEENTH` from `src/utils/stepResolution.ts`; `strideFor`, `columnsPerBar` in the store and component call sites.
- Produces:
  ```ts
  export function wrapColumn(column: number, columns: number): number
  export function clockStepToGridColumn(clockStep: number, columns: number, stride: number): number
  export function heldStepLength(onStep: number, offStep: number, stride: number): number
  ```
  `leadMarkerColumn(isPlaying, currentStep, cursor, columns)` keeps its signature; its live branch calls `wrapColumn` rather than `clockStepToGridColumn`, because the value it is handed has **already** been converted by the publisher.

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  In `src/audio/leadLiveRecord.test.ts`, replace the whole `describe('clockStepToGridColumn', ...)` block and the two `heldStepLength` tests that assume steps, with:
  ```ts
  describe('clockStepToGridColumn', () => {
    test('at 1/16 a clock step is still a column, exactly as before', () => {
      expect(clockStepToGridColumn(0, 16, 2)).toBe(0);
      expect(clockStepToGridColumn(7, 16, 2)).toBe(7);
      expect(clockStepToGridColumn(16, 16, 2)).toBe(0);
      expect(clockStepToGridColumn(37, 16, 2)).toBe(5);
    });

    test('at 1/8 two clock steps share a column', () => {
      // stride 4: tick = step * 2, column = tick / 4.
      expect(clockStepToGridColumn(0, 8, 4)).toBe(0);
      expect(clockStepToGridColumn(1, 8, 4)).toBe(0);
      expect(clockStepToGridColumn(2, 8, 4)).toBe(1);
      expect(clockStepToGridColumn(16, 8, 4)).toBe(0);
    });

    test('at 1/32 a clock step lands on an even column, always', () => {
      // Correct and deliberate: a quantiser that rounds to the nearest 16th
      // can only ever produce even columns. The clock is the only time
      // reference there is, and a performance cannot be captured finer than
      // the grid the anchors describe — half the 1/32 columns are reachable
      // by drawing but not by recording, the same way a note played between
      // two 16ths is captured on one of them today.
      expect(clockStepToGridColumn(0, 32, 1)).toBe(0);
      expect(clockStepToGridColumn(1, 32, 1)).toBe(2);
      expect(clockStepToGridColumn(7, 32, 1)).toBe(14);
      expect(clockStepToGridColumn(16, 32, 1)).toBe(0);
    });

    test('a negative step wraps forward rather than escaping the grid', () => {
      expect(clockStepToGridColumn(-1, 16, 2)).toBe(15);
      expect(clockStepToGridColumn(-1, 32, 1)).toBe(30);
    });

    test('a loop with no columns has nowhere to land', () => {
      expect(clockStepToGridColumn(4, 0, 2)).toBe(0);
    });
  });

  describe('wrapColumn', () => {
    test('is the wrap the conversion already did, named on its own', () => {
      // The marker consumes a column the publisher already converted, so it
      // must wrap and NOT convert again. One copy of the wrap, two entry
      // points — not two copies that agree today by coincidence.
      expect(wrapColumn(5, 16)).toBe(5);
      expect(wrapColumn(16, 16)).toBe(0);
      expect(wrapColumn(-1, 16)).toBe(15);
      expect(wrapColumn(4, 0)).toBe(0);
      expect(wrapColumn(Number.NaN, 16)).toBe(0);
    });
  });

  describe('heldStepLength', () => {
    test('returns TICKS: four clock steps held is eight ticks', () => {
      expect(heldStepLength(4, 8, 2)).toBe(8);
    });

    test('a tap is one CELL, never one tick — a sub-cell note is undrawable', () => {
      expect(heldStepLength(4, 4, 1)).toBe(1);
      expect(heldStepLength(4, 4, 2)).toBe(2);
      expect(heldStepLength(4, 4, 4)).toBe(4);
    });

    test('a release quantised earlier than the press is still one cell', () => {
      expect(heldStepLength(4, 3, 4)).toBe(4);
    });

    test('counts straight across the loop seam, because the clock never wraps', () => {
      // Truncating at the loop end is setLeadNoteLength's job (invariant 2),
      // not this function's; counting in raw clock steps is what makes the
      // length immune to a bpm change during the hold.
      expect(heldStepLength(14, 20, 2)).toBe(12);
    });
  });
  ```
  Then replace the source-guard test — the pin narrows rather than disappearing:
  ```ts
    test('the module still cannot reach the bpm-derived duration', () => {
      const src = readFileSync(new URL('./leadLiveRecord.ts', import.meta.url), 'utf8');
      // The pin that matters is unchanged: measuring the step from the
      // anchors is the whole reason a bpm change mid-take does not move the
      // notes, and a bpm-derived constant would keep returning the old value
      // with no error anywhere.
      expect(src).not.toContain('stepDurationSec');
      // It may now reach the subdivision table, and nothing else. That leaf
      // imports only meter.ts, so this module stays testable with no
      // AudioContext, no store and no DOM.
      const imports = [...src.matchAll(/^import .*? from '(.*?)';$/gm)].map((m) => m[1]);
      expect(imports).toEqual(['../utils/stepResolution']);
    });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/audio/leadLiveRecord.test.ts
  ```
  Expected failure: `SyntaxError: Export named 'wrapColumn' not found in module '.../src/audio/leadLiveRecord.ts'`.

- [ ] **Step 3: Convert through the stride.**
  In `src/audio/leadLiveRecord.ts`, add the single import at the top and amend the header comment's "no imports at all" sentence to say "one leaf import":
  ```ts
  import { TICKS_PER_SIXTEENTH } from '../utils/stepResolution';
  ```
  Replace `clockStepToGridColumn` with:
  ```ts
  /**
   * Wrap a column into the loop. Split out because the marker is handed a
   * column that has ALREADY been converted by the publisher and must not be
   * converted twice — one copy of the wrap with two entry points, rather than
   * two copies that agree today by coincidence.
   */
  export function wrapColumn(column: number, columns: number): number {
    if (!(columns > 0) || !Number.isFinite(column)) return 0;
    const c = Math.round(column);
    return ((c % columns) + columns) % columns;
  }

  /**
   * A clock step as a grid column: 16th -> tick -> column -> wrapped into the
   * loop. THE named conversion — useLeadPlayback, leadRecord.ts and the
   * marker all reach it rather than each dividing by their own copy of the
   * stride, which is the "three scattered pieces of arithmetic that each look
   * correct in isolation" this function was created to prevent.
   *
   * At 1/32 a quantiser that rounds to the nearest 16th can only ever produce
   * EVEN columns. That is correct and deliberate: the clock is the only time
   * reference there is, and a performance cannot be captured finer than the
   * grid the anchors describe.
   */
  export function clockStepToGridColumn(
    clockStep: number,
    columns: number,
    stride: number,
  ): number {
    if (!(columns > 0) || !(stride > 0)) return 0;
    const tick = Math.round(clockStep) * TICKS_PER_SIXTEENTH;
    return wrapColumn(Math.floor(tick / stride), columns);
  }
  ```
  Replace `heldStepLength` with:
  ```ts
  /**
   * How long the key was held, in TICKS, with a floor of one CELL so a
   * captured note is never shorter than the grid can draw. Counted from raw
   * clock steps, not seconds, so a bpm change during the hold cannot change
   * the answer. The loop-end truncation is setLeadNoteLength's (invariant 2).
   */
  export function heldStepLength(onStep: number, offStep: number, stride: number): number {
    const cell = stride > 0 ? stride : 1;
    return Math.max(cell, Math.round(offStep - onStep) * TICKS_PER_SIXTEENTH);
  }
  ```

- [ ] **Step 4: Move the three call sites.**
  In `src/store/leadRecord.ts`, add `import { columnsPerBar, strideFor } from '../utils/stepResolution';` (dropping the `TICKS_PER_SIXTEENTH` import Task 4 added) and rewrite the note-on column block and the note-off length line:
  ```ts
      const stepsPerBar = getMeter(state.meterId).stepsPerBar;
      const stride = strideFor(state.leadStepResolution);
      const columns = state.leadLoopLength * columnsPerBar(stepsPerBar, stride);
      const rawColumn = clockStepToGridColumn(clockStep, columns, stride);
  ```
  leaving the `clampLeadCursor(rawColumn, state.leadLoopLength, stepsPerBar, stride)` line and its comment as they are, and `leadStoredIndexAt(column, stepsPerBar, stride)` in the `held.set` call. `held` keeps storing the **raw, un-wrapped clock step** at note-on — that is what makes a note held across the loop seam yield a positive length, and the reasoning in that file survives verbatim; only the unit the length comes out in changes. In the note-off branch:
  ```ts
        const len = heldStepLength(entry.onStep, offStep, entry.stride);
        // > stride, not > 1: a one-cell note is already at that length, and
        // calling the setter for it would be a write with nothing to write.
        if (len > entry.stride) {
          useAppStore.getState().setLeadNoteLength(entry.storedIndex, event.note, len);
        }
  ```
  and add `stride: number;` to the `HeldNote` interface with the comment `/** The stride the note was captured at, so a resolution change mid-hold cannot re-scale its length. */`, setting it in the `held.set` call.

  In `src/components/loop/lead/melodyGrid.ts`, change `leadMarkerColumn`'s live branch and its comment:
  ```ts
    // Playing, the source is a column the publisher already converted through
    // clockStepToGridColumn (the ONE named conversion). Converting it a
    // second time here would multiply by the stride twice; it only needs the
    // wrap, which is why that wrap has its own name.
    if (isPlaying) return wrapColumn(currentStep, columns);
  ```
  and swap the import to `import { wrapColumn } from '@/audio/leadLiveRecord';`.

  In `src/components/loop/lead/useLeadPlayback.ts`, the existing `clockStepToGridColumn(step, melodyLength)` call becomes `clockStepToGridColumn(step, melodyLength, TICKS_PER_SIXTEENTH)` — Task 8 replaces this line entirely, and this edit exists only so `bun run lint` passes at this task's boundary.

- [ ] **Step 5: Run the tests.**
  ```bash
  bun test src/audio/leadLiveRecord.test.ts
  bun test src/store/leadRecord.test.ts
  bun test src/components/loop/lead/melodyGrid.test.ts
  bun run lint
  bun run eslint
  ```
  `leadRecord.test.ts`'s live-capture tests must pass with their expectations doubled where they assert a length (a four-step hold is now 8 ticks) and unchanged where they assert a column — at the default 1/16 every column in that suite is the same column it was.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/audio/leadLiveRecord.ts src/audio/leadLiveRecord.test.ts src/store/leadRecord.ts src/store/leadRecord.test.ts src/components/loop/lead/melodyGrid.ts src/components/loop/lead/useLeadPlayback.ts
  git commit -m "$(cat <<'EOF'
  feat(lead): capture played notes at the loop's own step resolution (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 8: One dispatch owns a tick range

The shared clock is not touched. It still counts 16ths, monotonically, for the sequencer, chords, bass, arp and metronome; nothing about `subscribePlaybackClock`, `arpStepFor` or the metronome changes. What changes is that the lead callback owns the tick range `[step * TICKS_PER_SIXTEENTH, step * TICKS_PER_SIXTEENTH + TICKS_PER_SIXTEENTH)` and fires every **on-grid** tick in it at offset `(t - step * TICKS_PER_SIXTEENTH) * tickDur`. One loop, one formula, no special case per stride — an even stride can never land on an odd tick, so at 1/8 and 1/16 only `t = step * 2` is ever on-grid, and only 1/32 ever produces two columns from one dispatch.

The marker uses the same loop: one `publishStepAt` per fired column, each with its own audible time. DEV-376's deferred publish is preserved unchanged and needs no modification — it already takes an audible time per call, which is exactly what makes two publishes in one dispatch land at two different moments rather than both jumping at once.

**The arp does not use that loop, and this is where the two questions split.** One clock, two consumers: the melody grid answers *which pitches are held right now*, which is what resolution changes; the arpeggiator answers *when to strike them, and in what order*, which comes from `arpRate` in `synthParams` and is counted in clock 16ths. They are already separate in the code — the arp branch of `resolveLeadStepTriggers` reads `sounding.map((s) => s.note)`, presence only, and `computeArpTriggers` builds its own `holdSec` and already subdivides the 16th itself for its 32nd rate. So the schedule branches here, in the hook, and nowhere deeper:

- **arp off — column-driven.** Each on-grid tick in the dispatch fires its own age-0 notes at its own offset.
- **arp on — clock-driven.** One call per dispatch, at the dispatch's own time, with `arpStep = arpStepFor(step, stepsPerBar)` unchanged and `sounding` read at the column *sounding* at the on-clock tick — the last column at or before `step * TICKS_PER_SIXTEENTH`, wrapped into the loop, which is precisely `clockStepToGridColumn(step, columns, stride)`.

Reduced, that is three cases and they are what the tests pin. At 1/16 both branches are today's behaviour exactly. At 1/8 the arp still fires on every 16th, because the column sounding at the odd 16th is the 1/8 column that started on the even one. At 1/32 the arp fires once per dispatch instead of twice. Do **not** gate the arp on "does a column start inside this dispatch" (an `arpActive ? ticks.slice(0, 1) : ticks`): it looks right at 1/32 and 1/16, and at stride 4 it finds an on-grid tick on only every other clock step, so the arp re-feeds half as often merely because the grid got coarser.

**Files:**
- Modify: `src/components/loop/lead/useLeadPlayback.ts`
- Test: `src/components/loop/lead/useLeadPlayback.test.ts`

**Interfaces:**
- Consumes: `TICKS_PER_SIXTEENTH`, `columnsPerBar`, `strideFor`; `wrapColumn` and `clockStepToGridColumn` (Task 7); `leadSoundingNotes`, `resolveLeadStepTriggers` (Task 4); `publishStepAt`.
- Produces:
  ```ts
  export function leadDispatchTicks(clockStep: number, stride: number): number[]

  export interface LeadScheduleHit { column: number; offsetSec: number }

  export function leadScheduleHits(
    clockStep: number, stride: number, columns: number, arpActive: boolean, tickDurSec: number,
  ): LeadScheduleHit[]
  ```
  `leadStepAction`, `resolveLeadStepTriggers`'s signature and the hook's return type are all unchanged: the branching is a *scheduling* decision and belongs in the hook, not in the audio layer, which already treats the two modes differently on its own terms.

**Steps:**

- [ ] **Step 1: Write the failing test.**
  Append to `src/components/loop/lead/useLeadPlayback.test.ts`:
  ```ts
  describe('leadDispatchTicks', () => {
    test('at 1/16 a dispatch owns exactly one column, as it always did', () => {
      expect(leadDispatchTicks(0, 2)).toEqual([0]);
      expect(leadDispatchTicks(1, 2)).toEqual([2]);
      expect(leadDispatchTicks(7, 2)).toEqual([14]);
    });

    test('at 1/32 a dispatch owns two, and only 1/32 ever does', () => {
      expect(leadDispatchTicks(0, 1)).toEqual([0, 1]);
      expect(leadDispatchTicks(3, 1)).toEqual([6, 7]);
    });

    test('at 1/8 every other dispatch owns none', () => {
      // An even stride can never land on an odd tick, so this is the same
      // formula, not a special case: the range simply contains no on-grid
      // tick on the odd 16ths.
      expect(leadDispatchTicks(0, 4)).toEqual([0]);
      expect(leadDispatchTicks(1, 4)).toEqual([]);
      expect(leadDispatchTicks(2, 4)).toEqual([4]);
      expect(leadDispatchTicks(3, 4)).toEqual([]);
    });

    test('a nonsense stride still yields the on-clock tick, never a hang', () => {
      expect(leadDispatchTicks(2, 0)).toEqual([4]);
    });
  });

  describe('leadScheduleHits — the arp runs on the clock, not on the grid', () => {
    // tickDur of 1 keeps the offsets readable: one tick == one unit.
    test('at 1/16 both branches are exactly today: one hit, this column, no offset', () => {
      for (const step of [0, 1, 5, 16]) {
        const block = leadScheduleHits(step, 2, 16, false, 1);
        const arp = leadScheduleHits(step, 2, 16, true, 1);
        expect(block).toEqual([{ column: step % 16, offsetSec: 0 }]);
        expect(arp).toEqual(block);
      }
    });

    test('at 1/8 the arp fires on EVERY 16th, on the column sounding there', () => {
      // The odd 16th has no column of its own; the 1/8 column that started on
      // the even one is still sounding, so that is what feeds the arp. Gating
      // on "does a column start here" would drop these dispatches entirely.
      expect(leadScheduleHits(0, 4, 8, true, 1)).toEqual([{ column: 0, offsetSec: 0 }]);
      expect(leadScheduleHits(1, 4, 8, true, 1)).toEqual([{ column: 0, offsetSec: 0 }]);
      expect(leadScheduleHits(2, 4, 8, true, 1)).toEqual([{ column: 1, offsetSec: 0 }]);
      expect(leadScheduleHits(3, 4, 8, true, 1)).toEqual([{ column: 1, offsetSec: 0 }]);
      // The block path is unchanged by this: it still owns columns only.
      expect(leadScheduleHits(1, 4, 8, false, 1)).toEqual([]);
    });

    test('at 1/32 the arp fires ONCE per dispatch, not twice', () => {
      expect(leadScheduleHits(3, 1, 32, true, 1)).toEqual([{ column: 6, offsetSec: 0 }]);
      // The block path is the branch that owns both 1/32 columns.
      expect(leadScheduleHits(3, 1, 32, false, 1)).toEqual([
        { column: 6, offsetSec: 0 },
        { column: 7, offsetSec: 1 },
      ]);
    });

    test('both branches wrap into the loop', () => {
      expect(leadScheduleHits(8, 2, 8, true, 1)).toEqual([{ column: 0, offsetSec: 0 }]);
      expect(leadScheduleHits(8, 2, 8, false, 1)).toEqual([{ column: 0, offsetSec: 0 }]);
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/components/loop/lead/useLeadPlayback.test.ts -t "leadDispatchTicks"
  ```
  Expected failure: `SyntaxError: Export named 'leadDispatchTicks' not found in module '.../src/components/loop/lead/useLeadPlayback.ts'` — `leadScheduleHits` is missing from the same module, so both describes fail together.

  ```bash
  bun test src/components/loop/lead/useLeadPlayback.test.ts -t "the arp runs on the clock"
  ```

- [ ] **Step 3: Range over the ticks.**
  In `src/components/loop/lead/useLeadPlayback.ts`, add:
  ```ts
  import { TICKS_PER_SIXTEENTH, columnsPerBar, strideFor } from '../../../utils/stepResolution';
  import { clockStepToGridColumn, wrapColumn } from '@/audio/leadLiveRecord';
  ```
  (`clockStepToGridColumn` stays — the arp branch is the caller that still needs it.)
  and, beside `leadStepAction`:
  ```ts
  /**
   * The on-grid ticks one clock dispatch owns: the half-open range
   * [step * TICKS_PER_SIXTEENTH, step * TICKS_PER_SIXTEENTH + TICKS_PER_SIXTEENTH).
   *
   * One formula for every stride, not a case per resolution. An even stride
   * can never land on an odd tick, so 1/8 and 1/16 only ever see the tick the
   * clock itself is on, and only 1/32 produces two columns from one dispatch.
   */
  export function leadDispatchTicks(clockStep: number, stride: number): number[] {
    const base = clockStep * TICKS_PER_SIXTEENTH;
    const step = stride > 0 ? stride : TICKS_PER_SIXTEENTH;
    const ticks: number[] = [];
    for (let t = base; t < base + TICKS_PER_SIXTEENTH; t++) {
      if (t % step === 0) ticks.push(t);
    }
    return ticks;
  }

  export interface LeadScheduleHit {
    /** The melody column to read the sounding notes at. */
    column: number;
    /** When to fire it, as an offset from the dispatch's own time. */
    offsetSec: number;
  }

  /**
   * Which column to read and when to fire it — the ONE place the melody grid's
   * question and the arpeggiator's question part company.
   *
   * arp OFF is COLUMN-driven: every on-grid tick this dispatch owns fires its
   * own age-0 notes at its own offset. Resolution decides which pitches are
   * held and when they start, which is precisely what resolution is for.
   *
   * arp ON is CLOCK-driven: one hit per dispatch, at the dispatch's own time,
   * on the column that is SOUNDING at the on-clock tick — the last column at
   * or before step * TICKS_PER_SIXTEENTH, which is exactly what
   * clockStepToGridColumn returns. The arp's rate lives in synthParams and its
   * stepMod is counted in clock 16ths; computeArpTriggers builds its own
   * holdSec and already subdivides the 16th for its 32nd rate, so it has never
   * needed the grid to be fine and must not be re-timed by it.
   *
   * Do NOT gate the arp on "does a column START inside this dispatch". It
   * looks right at 1/32 and 1/16, and at stride 4 an on-grid tick lands on
   * only every other clock step, so the arp would re-feed half as often merely
   * because the grid got coarser.
   */
  export function leadScheduleHits(
    clockStep: number,
    stride: number,
    columns: number,
    arpActive: boolean,
    tickDurSec: number,
  ): LeadScheduleHit[] {
    if (arpActive) {
      return [{ column: clockStepToGridColumn(clockStep, columns, stride), offsetSec: 0 }];
    }
    const base = clockStep * TICKS_PER_SIXTEENTH;
    return leadDispatchTicks(clockStep, stride).map((t) => ({
      column: wrapColumn(Math.floor(t / stride), columns),
      offsetSec: (t - base) * tickDurSec,
    }));
  }
  ```
  Then replace the clock callback's body, from `const stepsPerBar = ...` to the end of the trigger loop, with:
  ```ts
        const stepsPerBar = getMeter(s.meterId).stepsPerBar;
        const stride = strideFor(s.leadStepResolution);
        const columns = s.leadLoopLength * columnsPerBar(stepsPerBar, stride);
        const melodyTicks = s.leadLoopLength * stepsPerBar * TICKS_PER_SIXTEENTH;
        const action = leadStepAction(playerState, step, armingRef.current, stepsPerBar);
        const tickDur = stepDurationSec(s.bpm) / TICKS_PER_SIXTEENTH;
        // The marker is the GRID's playhead, so it always follows columns —
        // `false` here is "column-driven", not a claim about the arp.
        const marks = leadScheduleHits(step, stride, columns, false, tickDur);

        // Publish on EVERY dispatch while the transport runs, not only steps
        // that actually sound — this column is the marker AND the recorder's
        // write head (DEV-377), so a marker that stalls during pre-arm or
        // stop points at the wrong column while capture is already quantising
        // to the true clock step.
        //
        // One publish per fired column, each with its OWN audible time.
        // DEV-376's deferred publish already takes an audible time per call,
        // which is exactly what makes two publishes in one dispatch land at
        // two different moments rather than both jumping at once.
        for (const mark of marks) {
          publishStepAt('lead', mark.column, time + mark.offsetSec);
        }

        if (action === 'soft-stop') {
          playbackStopSource('synth', s.synthParams.release, time);
          softStopPendingRef.current = true;
          hardStop('lead');
          return;
        }
        if (action !== 'play') return;

        const arpStep = arpStepFor(step, stepsPerBar);
        // One clock, two questions. The grid answers "which pitches are held
        // right now" and resolution changes that answer; the arp answers
        // "when to strike them", and that answer comes off the clock's 16ths
        // via arpRate. leadScheduleHits is where the two part company, and
        // arpStep stays bar-phased by arpStepFor either way.
        const hits = leadScheduleHits(step, stride, columns, s.synthParams.arpActive, tickDur);

        for (const hit of hits) {
          const column = hit.column;
          const at = time + hit.offsetSec;
          const sounding = leadSoundingNotes(s.leadMelodySteps, column, stepsPerBar, stride);
          const triggers = resolveLeadStepTriggers(
            sounding,
            s.synthParams.arpActive,
            arpStep,
            s.synthParams,
            tickDur,
            s.leadGate,
            stride,
            // The ACTIVE window in TICKS, so a note left overhanging by a
            // METER change is capped at read time instead of ringing over
            // the loop seam. Unread on the arp path, which never asks a note
            // how long it is — only whether it is still held.
            { tickInLoop: column * stride, melodyTicks },
          );
          for (const trigger of triggers) {
            playbackNoteOn(trigger.note, s.synthParams, DEFAULT_VELOCITY, at + trigger.timeOffsetSec, 'synth');
            playbackNoteOff(
              trigger.note,
              s.synthParams.release,
              at + trigger.timeOffsetSec + trigger.holdSec,
              'synth',
            );
          }
        }
  ```
  Delete the now-unused `stepInLoop` line and its comment. Both `wrapColumn` and `clockStepToGridColumn` stay imported — `leadScheduleHits` calls one on each branch, and it is the only caller of either in this file.

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/components/loop/lead/useLeadPlayback.test.ts
  bun test src/components/playbackStep.test.ts
  bun run lint
  bun run eslint
  ```

- [ ] **Step 5: Commit.**
  ```bash
  git add src/components/loop/lead/useLeadPlayback.ts src/components/loop/lead/useLeadPlayback.test.ts
  git commit -m "$(cat <<'EOF'
  feat(lead): fire every on-grid column inside one clock dispatch (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 9: The grid's pure arithmetic, in columns and cells

`melodyGrid.ts` is where the view decides how many columns a bar has and how wide a note draws. Columns come from `columnsPerBar`; a note's drawn width is `cells` — **the same expression `holdSec` rounds with**, because what sounds must be what is drawn. The header strip needs one cell descriptor per column rather than one per 16th, which is the last place the old assumption "a column is a 16th" is still baked in.

**Files:**
- Modify: `src/components/loop/lead/melodyGrid.ts`
- Test: `src/components/loop/lead/melodyGrid.test.ts`

**Interfaces:**
- Consumes: `TICKS_PER_SIXTEENTH`, `columnsPerBar` from `src/utils/stepResolution.ts`; `beatIndexAt`, `isBeatBoundary`, `type Meter` from `src/utils/meter.ts`; `type StepCell` from `src/components/sequencerGrid.ts`; `leadStoredIndexAt` (Task 4).
- Produces:
  ```ts
  export function leadNoteCells(len: number, stride: number): number
  export function leadColumnCells(meter: Meter, stride: number): StepCell[]
  export function leadCellKinds(
    melody: readonly LeadNote[][], rows: readonly string[],
    columns: number, stepsPerBar: number, stride: number,
  ): Map<string, LeadCellKind[]>
  export function resolveLeadCellSpan(
    rowKinds: readonly LeadCellKind[], col: number, stepsPerBar: number, stride: number,
    note: string, previewed: readonly LeadNote[][],
  ): { spanStartIdx: number; spanLen: number; spanCells: number; endsSpan: boolean; startCol: number }
  ```
  `LEAD_CELL_WIDTH` is **unchanged**, and `leadResizeLen` and `leadCursorKeyTarget` keep their exact signatures — both already count columns.

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  Append to `src/components/loop/lead/melodyGrid.test.ts`:
  ```ts
  describe('leadNoteCells', () => {
    test('a quarter note is 2 cells at 1/8, 4 at 1/16 and 8 at 1/32', () => {
      expect(leadNoteCells(8, 4)).toBe(2);
      expect(leadNoteCells(8, 2)).toBe(4);
      expect(leadNoteCells(8, 1)).toBe(8);
    });

    test('a note finer than the grid still draws one cell, never zero', () => {
      // The same ceil and the same floor holdSec uses. What sounds is what
      // is drawn: two roundings that could disagree would put a note on the
      // grid at a width its sound does not match.
      expect(leadNoteCells(1, 4)).toBe(1);
      expect(leadNoteCells(3, 4)).toBe(1);
      expect(leadNoteCells(5, 4)).toBe(2);
    });
  });

  describe('leadColumnCells', () => {
    const meter = getMeter('4/4');

    test('one descriptor per COLUMN, not per 16th', () => {
      expect(leadColumnCells(meter, 2)).toHaveLength(16);
      expect(leadColumnCells(meter, 4)).toHaveLength(8);
      expect(leadColumnCells(meter, 1)).toHaveLength(32);
    });

    test('a beat starts on the column that starts the accent group', () => {
      // 4/4 accents every 4 sixteenths = every 8 ticks: columns 0/2/4/6 at
      // 1/8, 0/4/8/12 at 1/16, 0/8/16/24 at 1/32.
      expect(leadColumnCells(meter, 4).filter((c) => c.isBeatStart).map((c) => c.index))
        .toEqual([0, 2, 4, 6]);
      expect(leadColumnCells(meter, 2).filter((c) => c.isBeatStart).map((c) => c.index))
        .toEqual([0, 4, 8, 12]);
      expect(leadColumnCells(meter, 1).filter((c) => c.isBeatStart).map((c) => c.index))
        .toEqual([0, 8, 16, 24]);
    });

    test('the odd meter still groups 3+2+2', () => {
      const seven = leadColumnCells(getMeter('7/8'), 4);
      expect(seven).toHaveLength(7);
      expect(seven.filter((c) => c.isBeatStart).map((c) => c.index)).toEqual([0, 3, 5]);
    });

    test('labels are 1-based columns, so every column has a distinct one', () => {
      expect(leadColumnCells(meter, 1)[31].label).toBe(32);
    });
  });

  describe('leadCellKinds draws a note its audible width', () => {
    const rows = ['C4'];
    const melody = (len: number): LeadNote[][] => {
      const steps: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
      steps[0] = [{ note: 'C4', len }];
      return steps;
    };
    const kinds = (len: number, stride: number): LeadCellKind[] =>
      leadCellKinds(melody(len), rows, columnsPerBar(16, stride), 16, stride).get('C4')!;

    test('a quarter note spans 2 cells at 1/8 and 8 at 1/32', () => {
      expect(kinds(8, 4).slice(0, 3)).toEqual(['start', 'end', 'none']);
      expect(kinds(8, 1).slice(0, 9)).toEqual([
        'start', 'body', 'body', 'body', 'body', 'body', 'body', 'end', 'none',
      ]);
    });

    test('an off-grid note is not drawn at all — it is dormant, not lost', () => {
      const steps: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
      steps[1] = [{ note: 'C4', len: 1 }];
      expect(leadCellKinds(steps, rows, 16, 16, 2).get('C4')!.every((k) => k === 'none')).toBe(true);
      expect(leadCellKinds(steps, rows, 32, 16, 1).get('C4')![1]).toBe('start');
    });

    test('a span running past the last column is truncated, never wrapped', () => {
      expect(kinds(64, 4)).toHaveLength(8);
      expect(kinds(64, 4)[7]).toBe('body');
    });
  });

  describe('resolveLeadCellSpan reports both units', () => {
    test('the stored start, the tick length and the drawn cell count', () => {
      const previewed: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
      previewed[0] = [{ note: 'C4', len: 8 }];
      const rowKinds = leadCellKinds(previewed, ['C4'], 8, 16, 4).get('C4')!;

      // Shift+Arrow must work from ANY cell of a span, not just its first.
      const span = resolveLeadCellSpan(rowKinds, 1, 16, 4, 'C4', previewed);
      expect(span.spanStartIdx).toBe(0);
      expect(span.startCol).toBe(0);
      expect(span.spanLen).toBe(8);
      expect(span.spanCells).toBe(2);
      expect(span.endsSpan).toBe(true);
    });

    test('an empty cell resolves to no span', () => {
      const previewed: LeadNote[][] = Array.from({ length: LEAD_TICKS_PER_BAR }, () => []);
      const rowKinds = leadCellKinds(previewed, ['C4'], 8, 16, 4).get('C4')!;
      expect(resolveLeadCellSpan(rowKinds, 3, 16, 4, 'C4', previewed).spanStartIdx).toBe(-1);
    });
  });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/components/loop/lead/melodyGrid.test.ts
  ```
  Expected failure: `SyntaxError: Export named 'leadNoteCells' not found in module '.../src/components/loop/lead/melodyGrid.ts'`.

- [ ] **Step 3: Move the grid arithmetic to columns and cells.**
  In `src/components/loop/lead/melodyGrid.ts`, replace the `TICKS_PER_SIXTEENTH` import with:
  ```ts
  import { TICKS_PER_SIXTEENTH, columnsPerBar } from '../../../utils/stepResolution';
  import { beatIndexAt, isBeatBoundary, type Meter } from '../../../utils/meter';
  import type { StepCell } from '../../sequencerGrid';
  ```
  Add, above `leadCellKinds`:
  ```ts
  /**
   * How many CELLS a tick-counted note draws. The same expression
   * resolveLeadStepTriggers rounds holdSec with, deliberately: what sounds
   * must be what is drawn, or a note that showed as two cells while sounding
   * for five ticks reintroduces exactly the invisible state that silent
   * dormancy was chosen to avoid.
   */
  export function leadNoteCells(len: number, stride: number): number {
    const cell = stride > 0 ? stride : 1;
    return Math.max(1, Math.ceil(len / cell));
  }

  /**
   * One header descriptor per COLUMN rather than per 16th. `stepCells` in
   * sequencerGrid.ts answers the same question for a grid whose column IS a
   * 16th, which the lead's no longer is; the accent grouping still comes from
   * the meter, so a beat starts on the column whose tick starts an accent
   * group and nowhere else.
   */
  export function leadColumnCells(meter: Meter, stride: number): StepCell[] {
    const cells: StepCell[] = [];
    const columns = columnsPerBar(meter.stepsPerBar, stride);
    for (let index = 0; index < columns; index++) {
      const tick = index * stride;
      const sixteenth = Math.floor(tick / TICKS_PER_SIXTEENTH);
      const onSixteenth = tick % TICKS_PER_SIXTEENTH === 0;
      const beatIndex = beatIndexAt(sixteenth, meter.accentGroups);
      cells.push({
        index,
        label: index + 1,
        isBeatStart: onSixteenth && isBeatBoundary(sixteenth, meter.accentGroups),
        beatIndex,
        isAltBeatGroup: beatIndex % 2 === 0,
      });
    }
    return cells;
  }
  ```
  In `leadCellKinds`, add `stride: number` as the last parameter, and replace the span line:
  ```ts
        const span = Math.min(leadNoteCells(n.len, stride), columns - col);
  ```
  and the row lookup:
  ```ts
      const row = melody[leadStoredIndexAt(col, stepsPerBar, stride)];
  ```
  Amend its doc comment's last paragraph to:
  ```ts
   * `columns` is the ACTIVE window (loopLength x columnsPerBar); a span
   * running past the last column is truncated, never wrapped, which matches
   * invariant 2. A note the current resolution cannot reach is never looked
   * up, so it draws nothing — dormant, not lost.
  ```
  In `resolveLeadCellSpan`, add `stride: number` after `stepsPerBar`, replace the stored-start line with:
  ```ts
    const spanStartIdx = startCol < 0 ? -1 : leadStoredIndexAt(startCol, stepsPerBar, stride);
  ```
  and replace the return with:
  ```ts
    const spanLen =
      startCol < 0 ? 0 : (previewed[spanStartIdx]?.find((n) => n.note === note)?.len ?? stride);
    const nextKind = rowKinds[col + 1] ?? 'none';
    const endsSpan =
      kind === 'end' || (kind === 'start' && nextKind !== 'body' && nextKind !== 'end');
    // Both units, because the caller needs both: the drag handle counts
    // CELLS, and the write it eventually makes counts TICKS.
    return { spanStartIdx, spanLen, spanCells: leadNoteCells(spanLen, stride), endsSpan, startCol };
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/components/loop/lead/melodyGrid.test.ts
  bun run lint
  ```
  `bun run lint` will report the `LeadMelodyGrid.tsx` call sites missing their new argument — that is Task 10, and it is the only thing red at this point.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/components/loop/lead/melodyGrid.ts src/components/loop/lead/melodyGrid.test.ts
  git commit -m "$(cat <<'EOF'
  feat(ui): size the melody grid's columns and note widths from the stride (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

  Note: this commit leaves `bun run lint` red, which every other commit in this plan does not. Task 10 is its other half and must follow immediately; if you are stopping for the day, do Task 10 first.

---

### Task 10: The resolution select, beside the control it belongs with

The two controls that decide the grid's extent belong together, so the select sits on the melody grid header beside the loop-length one. **`LEAD_CELL_WIDTH` stays at its current value** — a bar simply gets physically wider at 1/32 and narrower at 1/8, and the grid scrolls further. There is deliberately no zoom control: DEV-377 requires the marker's `translateX` and the ruler's header buttons to agree on a stride in pixels, and a fixed cell width keeps that agreement free rather than making it a third thing to keep in sync.

DEV-371's keyboard navigation over the header strips and the `aria-pressed` / `aria-label` contract on the bar and step buttons must survive unaltered. The labels' *content* changes with the column count; their contract does not. The task verifies that by rendering the headers at two different strides and asserting the same contract holds in both, and by leaving `leadCursorKeyTarget` and its tests untouched.

**Files:**
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx`
- Test: `src/components/loop/lead/LeadMelodyGrid.test.tsx`

**Interfaces:**
- Consumes: `LEAD_STEP_RESOLUTION_IDS`, `LEAD_STEP_RESOLUTIONS`, `strideFor`, `columnsPerBar` from `src/utils/stepResolution.ts`; `leadColumnCells`, `leadNoteCells`, `leadCellKinds`, `resolveLeadCellSpan` (Task 9); `setLeadStepResolution` (Task 5).
- Produces: no new exports. `LeadMelodyHeaders` gains one prop — `{ stepsPerBar, columns, cellsPerBar, cursor, selectedBar, onSelectColumn, columnsPerBar: number }` — where `columnsPerBar` is the per-bar column count the strips group by. `LeadMarker` keeps its `{ column: number }` prop and its `LEAD_CELL_WIDTH` stride.

**Steps:**

- [ ] **Step 1: Write the failing tests.**
  In `src/components/loop/lead/LeadMelodyGrid.test.tsx`, append to the `describe('LeadMelodyHeaders', ...)` block:
  ```tsx
  test('the DEV-371 contract holds at every stride, only the counts change', () => {
    // The labels' CONTENT changes with the column count; their contract does
    // not. Every column is a real button, every button is labelled, the
    // selected bar and the cursor column are the pressed ones.
    const at = (colsPerBar: number): string =>
      renderToString(
        <LeadMelodyHeaders
          {...headerProps(colsPerBar, 0)}
          columnsPerBar={colsPerBar}
          cellsPerBar={leadColumnCells(meter, (16 * 2) / colsPerBar)}
        />,
      );

    const eighths = at(8);
    expect(eighths.split('<button').length - 1).toBe(16); // 8 bar + 8 beat
    expect(eighths).toContain('aria-label="Bar 1"');
    expect(eighths).toContain('aria-label="Bar 1 step 6"');
    expect(eighths.split('aria-pressed="true"').length - 1).toBe(8 + 1);

    const thirtyseconds = at(32);
    expect(thirtyseconds.split('<button').length - 1).toBe(64);
    expect(thirtyseconds).toContain('aria-label="Bar 1 step 32"');
    expect(thirtyseconds.split('aria-pressed="true"').length - 1).toBe(32 + 1);
  });

  test('the cell width never moves, so the marker and the ruler cannot drift', () => {
    // No zoom, on purpose: the marker's translateX and these buttons must
    // agree on a stride in pixels, and a fixed width keeps that agreement
    // free rather than making it a third thing to keep in sync.
    const wide = renderToString(
      <LeadMelodyHeaders
        {...headerProps(32, 0)}
        columnsPerBar={32}
        cellsPerBar={leadColumnCells(meter, 1)}
      />,
    );
    expect(wide.split('width:20px').length - 1).toBe(64);
    expect(renderToString(<LeadMarker column={3} />)).toContain('translateX(60px)');
  });
  ```
  and, to the `describe('LeadMelodyGrid', ...)` block:
  ```tsx
  test('the resolution select offers the three resolutions, in order', () => {
    const html = renderToString(<LeadMelodyGrid />);
    expect(html).toContain('id="select-lead-step-resolution"');
    const options = [...html.matchAll(/<option value="(1\/(?:8|16|32))"/g)].map((m) => m[1]);
    expect(options).toEqual(['1/8', '1/16', '1/32']);
  });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/components/loop/lead/LeadMelodyGrid.test.tsx
  ```
  Expected failure: `expect(received).toContain(expected)` — the rendered markup has no `id="select-lead-step-resolution"`, and the headers reject the `columnsPerBar` prop under `tsc`.

- [ ] **Step 3: Thread the stride and add the select.**
  In `src/components/loop/lead/LeadMelodyGrid.tsx`:

  a. Replace the `TICKS_PER_SIXTEENTH` import with:
  ```tsx
  import {
    LEAD_STEP_RESOLUTIONS,
    LEAD_STEP_RESOLUTION_IDS,
    columnsPerBar,
    strideFor,
  } from '../../../utils/stepResolution';
  ```
  and add `leadColumnCells` and `leadNoteCells` to the `from './melodyGrid'` import list.

  b. In `LeadMelodyCells`, add `stride: number` and `colsPerBar: number` to the props, replace `const columns = loopLength * stepsPerBar;` with `const columns = loopLength * colsPerBar;`, replace `stepCells(meter)` with the cells passed in, and pass `stride` through to `leadCellKinds`, `resolveLeadCellSpan` and `leadStoredIndexAt`. The per-cell index becomes:
  ```tsx
                const idx = leadStoredIndexAt(barIndex * colsPerBar + stepInBar, stepsPerBar, stride);
  ```

  c. In `LeadMelodyHeaders`, add `columnsPerBar: number` to the props and replace every `stepsPerBar` used as a *per-bar column count* with it — the bar strip's `Math.floor(col / columnsPerBar)`, the beat strip's `col % columnsPerBar`, and the `leadCursorKeyTarget(col, e.key, e.shiftKey, columnsPerBar, columns)` call. `leadCursorKeyTarget` itself is untouched: it already counts columns, and Shift still jumps exactly one bar because that is what it is now handed.

  d. In `LeadMelodyGrid`, read the field and derive everything from it:
  ```tsx
    const leadStepResolution = useAppStore((s) => s.leadStepResolution);
    const setLeadStepResolution = useAppStore((s) => s.setLeadStepResolution);
    const stride = strideFor(leadStepResolution);
    const colsPerBar = columnsPerBar(stepsPerBar, stride);
    const cellsPerBar = useMemo(() => leadColumnCells(meter, stride), [meter, stride]);
  ```
  replacing the existing `cellsPerBar` memo, and replace `const columns = leadLoopLength * stepsPerBar;` with `const columns = leadLoopLength * colsPerBar;`. Pass `stride` to `clampLeadCursor` and `leadCursorBar`, and `columnsPerBar={colsPerBar}` plus `stride={stride}` down to the two children.

  e. Where the drag commits a length, convert cells to ticks at the write:
  ```tsx
                    // leadResizeLen counts CELLS, because that is what the
                    // pointer moves over; the write counts TICKS, because
                    // that is what a length IS. The conversion happens once,
                    // here, at the boundary.
                    setLeadNoteLength(span.spanStartIdx, note, cells * stride);
  ```
  with `maxLen` for `leadResizeLen` computed as `columns - span.startCol` (cells), and the drag's starting length as `span.spanCells`.

  f. Add the select immediately **after** the loop-length select, so the two controls that decide the grid's extent sit together:
  ```tsx
              <select
                id="select-lead-step-resolution"
                value={leadStepResolution}
                onChange={(e) => setLeadStepResolution(e.target.value as typeof leadStepResolution)}
                className="select select-xs select-ghost"
                title="Melody grid resolution — a finer grid reveals more columns and never moves a note"
              >
                {LEAD_STEP_RESOLUTION_IDS.map((id) => (
                  <option key={id} value={id}>
                    {LEAD_STEP_RESOLUTIONS[id].label}
                  </option>
                ))}
              </select>
  ```

- [ ] **Step 4: Run the tests.**
  ```bash
  bun test src/components/loop/lead/LeadMelodyGrid.test.tsx
  bun test src/components/loop/lead/melodyGrid.test.ts
  bun run lint
  bun run eslint
  ```
  `melodyGrid.test.ts` is run explicitly to confirm `leadCursorKeyTarget` is untouched: the handler that calls it changed argument, not signature, and its tests must pass with no modification at all. Zero eslint errors and no new warnings — `scripts/themeTokenGuard.ts` covers the new markup, and `select select-xs select-ghost` is the class string the loop-length select already uses.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/components/loop/lead/LeadMelodyGrid.tsx src/components/loop/lead/LeadMelodyGrid.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(ui): add the lead step-resolution select to the melody grid header (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 11: Record the two rules that will otherwise be rediscovered

CLAUDE.md's own rule applies to this task: **write the rule, never the number.** No version, no width, no column count goes into the file — they all change through routine work and go stale silently.

Two things need recording. The lead melody no longer shares the sequencer's stored width, which is now a *difference* between grids rather than a shared constant. And each lead migration chain now runs two upgrades whose order is load-bearing, which the existing trap entry only half covers.

**Files:**
- Modify: `CLAUDE.md`
- Test: none — this task adds no code.

**Interfaces:**
- Consumes: everything from Tasks 1-10.
- Produces: no code. Two documented rules.

**Steps:**

- [ ] **Step 1: Record the lead's separate storage width.**
  In `CLAUDE.md`'s Architecture section, in the paragraph that describes the store layer, add after the sentence about the persist key and migrations:
  ```md
  **The lead melody stores at its own width, and only the lead melody does.** The sequencer,
  chord-rhythm and bass grids store every bar at the widest meter's `MAX_STEPS_PER_BAR` and window
  it to the active `stepsPerBar`. The lead runs the same non-destructive scheme on a second axis —
  it stores at the finest *step resolution* (`LEAD_TICKS_PER_BAR` in `utils/stepResolution.ts`) and
  *strides* to the active one — so a `leadMelodySteps` index is a tick, not a 16th, and a
  `LeadNote.len` counts ticks. Two consequences: a slot is dormant either because the meter cannot
  reach it or because the resolution cannot, and **both tests live in `leadActivePosAt` and nowhere
  else**; and a change of view never writes — an explicit edit writes, changing meter or resolution
  does not.
  ```

- [ ] **Step 2: Extend the lead-migration trap entry.**
  In the "Traps recorded in the spec — don't 'fix' these" section, replace the existing lead-migration bullet with:
  ```md
  - **The lead melody's two migration chains each run two upgrades, in order, before their sanitize
    step.** `isLeadNoteMatrix` rejects the pre-DEV-369 `string[][]` shape, so a payload that reaches
    sanitize un-upgraded comes back blank — no throw, no warning. Within a chain the note-length
    upgrade runs first and the tick widening second, never the other way round: widening a
    `string[][]` payload would leave a shape sanitize still rejects. Persist upgrades live in
    `migrate` (before `merge`); `.solna` upgrades in `migrateProjectBody` (before `sanitizeContent`).
    The two chains share the pure transforms and nothing else — **never merge them.** A persist
    payload is private `localStorage` shape; a project body is an external contract; their versions
    move for different reasons.
  ```

- [ ] **Step 3: Check no number crept in.**
  ```bash
  grep -nE "\b(24|48|version [0-9]|v[0-9]+)\b" CLAUDE.md
  ```
  Every hit must predate this task. If either of the two blocks above appears in the output, replace the number with the constant's name.

- [ ] **Step 4: Commit.**
  ```bash
  git add CLAUDE.md
  git commit -m "$(cat <<'EOF'
  docs: record the lead's own storage width and its two-step migrations (DEV-375)

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 12: The gate, and a hand check at all three resolutions

No new code. Pure functions carry this feature, as they must — there is no DOM in this suite, so anything left inside a clock callback or a bus listener cannot be tested at all. Hand verification against a running transport is still required, for the reason DEV-374 gave: this feature area's history is a fully green suite that proved nothing about whether the gesture worked. The branch is done when this task is done, and not before.

**Files:** none.

**Interfaces:** none.

**Steps:**

- [ ] **Step 1: Run the full gate.**
  ```bash
  bun run verify
  ```
  Every part must pass: `bun test`, `bun run lint`, `bun run eslint` (zero errors, no more warnings than the count you wrote down before Task 1), `bun run check:keys`, `bun run check:drums`, `bun run build`.

- [ ] **Step 2: Prove an existing project is untouched.**
  Before opening anything new, confirm the migration did what it promised:
  ```bash
  bun run dev
  ```
  1. Open a project saved before this branch (or reload a session that predates it). **Expect:** the melody looks exactly as it did, the resolution select reads 1/16, and every note is in the same place at the same drawn width.
  2. Play it. **Expect:** it sounds identical — same attacks, same note lengths, same gate. Any audible difference at 1/16 is a bug in `holdSec`, not a taste question.

- [ ] **Step 3: Hand-verify the feature.**
  Confirm each of these in the browser before claiming the branch is finished:
  1. Switch to 1/32. **Expect:** twice as many columns, the bar physically wider, every existing note still on the same beat and the same audible length, and the grid scrolls further. The cell width has not changed.
  2. Draw a note between two 16ths. Switch to 1/8. **Expect:** it disappears from the grid and is silent. Switch back to 1/32. **Expect:** it is exactly where you left it, at exactly the length you left it — quiet, not gone.
  3. Flip 1/32 → 1/8 → 1/32 three times with a note of an awkward length drawn. **Expect:** its length is unchanged. A ratchet here is the destructive-snap defect the spec rejected.
  4. Drag a note's right edge at 1/8. **Expect:** it grows a whole cell at a time and never ends inside a cell.
  5. Arrow-key across the header at 1/32, then Shift+Arrow. **Expect:** one column at a time, and a whole bar with Shift.
  6. Play at 1/32. **Expect:** the marker steps twice per clock 16th, evenly, and lines up with the ruler column above it at every step — no drift at the right-hand end of a 4-bar loop.
  7. Arm recording, play the sequencer, play notes at 1/32. **Expect:** they land on even columns only — correct and deliberate: the clock is the only time reference there is.
  8. Hold a key for roughly a bar at 1/8 and at 1/32. **Expect:** the captured note is the same musical length in both, and never shorter than one cell.
  9. Change meter to 7/8 at 1/8. **Expect:** 7 columns a bar, the accent groups at columns 0, 3 and 5, and no bar ending mid-column.
  10. Save a project, reload, open it. **Expect:** the resolution survives per loop, and switching loops switches the grid's resolution with it.

- [ ] **Step 4: If anything in step 2 or 3 failed, fix it and commit the fix.**
  Stage only the files you changed, by name, and use a conventional-commit subject describing the behaviour restored. End the message with the two trailer lines:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  ```
  Then re-run `bun run verify` and repeat step 3.

---

## Known gaps, stated rather than hidden

- **Triplets are excluded.** Supporting both binary and ternary subdivision means storing at LCM(2, 3) — six times today's width — and the payoff is a grid that *reads* differently, with cell boundaries that do not line up with the bar's beat groupings and a ruler that has to draw two rulers. Its own feature, its own issue.
- **Cell-width zoom is excluded.** A fixed `LEAD_CELL_WIDTH` is what keeps the marker and the ruler in agreement for free. A zoom control would have to earn its own test.
- **Half the 1/32 columns are reachable by drawing but not by recording.** A quantiser that rounds to the nearest 16th can only produce even columns, because the clock is the only time reference there is. The same way a note played between two 16ths is captured on one of them today.
- **`leadSoundingNotes` scans backward to column 0 on every dispatch,** and at 1/32 with a 4-bar 4/4 loop that is 128 iterations instead of 64, twice per clock tick. Accepted: it is array indexing over a short array, and the stateless design is what stops a seek, a loop switch or a stop desynchronising a sounding-note map. If it shows up in a profile, the fix is a cache keyed on the melody, not a stateful map.
- **`leadMelodySteps` doubles its slot count whether or not the loop uses the finer grid,** and `persist` re-serialises the whole slice on every `set()` that touches it. This is the price of non-destructive storage, and it is the same price meter already pays. It is also why nothing driven by a pointer, a clock tick or an animation frame may write `leadMelodySteps` directly.
- **The arp runs on the clock, not on the grid's resolution.** One clock, two questions: the grid answers which pitches are held, the arp answers when to strike them, and the second comes from `arpRate` in `synthParams`, counted in clock 16ths. So the arp is fed once per dispatch, at the dispatch's own time, on the column *sounding* at the on-clock tick. At 1/16 that is byte-for-byte today's behaviour; at 1/8 it still fires on every 16th; at 1/32 it fires once per dispatch instead of twice. This is not a gap — it is the existing separation made explicit, and Task 8 pins all three cases. Describing the grid as an automated instrument input is conceptual only: sequenced notes deliberately do not pass through `noteInputBus` (`.claude/rules/note-input.md`), and nothing here changes that.
- **Velocity is still not stored on a `LeadNote`.** The note-input bus already carries it so the day it lands needs no second refactor, but widening the note shape forces both version bumps again and is not what this issue is for.
