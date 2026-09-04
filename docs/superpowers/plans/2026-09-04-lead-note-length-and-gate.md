# Lead Note Length and Per-Loop Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a lead note a length in steps (`LeadNote { note, len }`) and give each loop a single `leadGate` articulation slider, so the melody grid can draw held and legato lines instead of only even, detached one-step notes.

**Architecture:** `leadMelodySteps` changes from `string[][]` to `LeadNote[][]` — the index still means *the step the note starts on*, the matrix is still stored at `MAX_STEPS_PER_BAR` per bar and windowed to the active `stepsPerBar`. Scheduling splits "which notes are sounding here" (`leadSoundingNotes`, a stateless backward scan returning an `age`) from "which notes start here" (block mode keeps `age === 0` and holds `(len - 1 + gate) * stepDurSec`; arp mode feeds *all* sounding notes into the unchanged arp pool). Two independent migration chains — persist and `.solna` format — share one pure `upgradeLeadMelodyV1` transform and must both run **before** their sanitize step, or a v1 melody silently blanks.

**Tech Stack:** Bun (test runner + scripts), Vite + React 19, TypeScript `strict`, Zustand with `persist` + `subscribeWithSelector`, raw Web Audio API, Tailwind v4 + daisyUI v5, ESLint flat config with the three-layer `no-restricted-imports` rules.

**Spec:** docs/superpowers/specs/2026-09-04-lead-note-length-and-gate-design.md

## Global Constraints

- Branch is `feat/dev-369-lead-note-length-and-gate`. All work lands there; never on `main`.
- `bun run verify` is the completion gate: `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`. It must be green at the end of Task 10, and `bun run lint` (tsc `--noEmit`) must pass at **every** task boundary — the decomposition below is ordered so it does.
- `bun run eslint` must report **zero errors** at every task boundary. Warnings are tolerated.
- Three-layer import rule (eslint `no-restricted-imports`, all `error`): `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; `src/components/` never imports `audio/engine`. `LeadNote`, `LeadSounding`, `upgradeLeadMelodyV1`, `isLegacyLeadMelody`, `leadSoundingNotes` and `DEFAULT_LEAD_GATE` therefore live in `src/audio/leadMelody.ts` and are imported *downward* by `store/` and `components/`.
- Tests are `bun:test`. **There is no DOM and no testing-library, and none may be added** (`.claude/rules/testing.md`). Rendered-markup tests use `renderToString` from `react-dom/server` and assert single literal substrings covering several classes at once.
- The zustand + `renderToString` trap: `getServerSnapshot` is `selector(api.getInitialState())`, captured once at store creation, so `useAppStore.setState(...)` before a `renderToString` has **no effect, silently**. The drag gesture gets no DOM test — that is why its arithmetic lives in `melodyGrid.ts` as pure functions.
- `LeadNote` is `{ note: string; len: number }`; `len` is an **integer ≥ 1** counted in **active** steps (`stepsPerBar`-relative), not stored slots.
- The three invariants are enforced **in the slice, never at a call site**: (1) extending a note over an existing note on the same pitch row **swallows** the covered note; (2) `start + len` never crosses the loop end, clamped on write; (3) `len` is an integer ≥ 1. `setLeadNoteLength` owns all three; `toggleLeadNote` owns invariant 1 from the other direction, since a click inside an existing note's span must not nest a second note inside it (Task 7).
- Gate is clamped to **0.05–1.0** (5–100% in the UI, step 5). `DEFAULT_LEAD_GATE = 0.85` — exactly today's `LEAD_GATE` — is both the slice default and the migration seed.
- **The no-op guarantee is the risk budget of this change**: an all-`len: 1` melody at gate `0.85` must produce byte-identical `LeadTrigger[]` to the current implementation, with the arp both on and off. Task 6 owns the test.
- **Upgrade runs before sanitize on both paths.** `parseProjectFile` runs `migrateProjectBody` (projectFile.ts:91-93) before `sanitizeContent` (:100); zustand runs the persist `migrate` before `merge`, and `merge` is where `sanitizePersistedState` is called (store.ts:319-320). Neither transform may be moved into or after `merge` / `sanitizeContent`. This failure mode blanks data rather than throwing.
- The persist chain and the `.solna` chain stay **separate functions**. Only the pure `upgradeLeadMelodyV1` transform is shared. The persist migration chain must never be used to read a project body.
- Bump the persist `version` and add a migration step whenever the persisted shape changes; bump `PROJECT_FORMAT_VERSION` only when the content contract changes. They move for different reasons.
- Adding a per-loop field means adding it to `LOOP_FLAT_KEYS` (`loop.ts`), to `Loop` and `LeadSlice` (`types.ts`), to `createDefaultLoop` (`loopSlice.ts`) and to `sanitizeLoops` (`sanitize.ts`) — `sanitizeLoops` builds an explicit `Loop` object literal, so a missing field is a tsc error. `PROJECT_LOOP_KEYS` derives from `LOOP_FLAT_KEYS` and picks it up for free.
- Never call engine setters from a component. Nothing in this change is an engine-settable value: `leadGate` is read live inside the clock callback, so `engineSync.ts` is untouched.
- Theming (`.claude/rules/theming.md`): components name roles, never colours. `scripts/themeTokenGuard.ts` fails the build on raw hex, Tailwind palette classes, `text-white` and the `dark:` variant. Every class string this plan writes already exists in `src/`.
- Commits use `git add <named files>`, never `-A`. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  ```

---

### Task 1: `LeadNote` type and the shared `upgradeLeadMelodyV1` helper

Adds the new note type and the one pure transform both migration chains will call. Nothing consumes them yet, so the tree still compiles and every existing test still passes.

**Files:**
- Modify: `src/audio/leadMelody.ts:1-20` (add the interface and two exports near the top, beside `LeadTrigger`)
- Test: `src/audio/leadMelody.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface LeadNote { note: string; len: number }
  export function isLegacyLeadMelody(value: unknown): value is string[][]
  export function upgradeLeadMelodyV1(steps: string[][]): LeadNote[][]
  ```
  `upgradeLeadMelodyV1` maps every string to `{ note, len: 1 }`. `isLegacyLeadMelody` is the "is this the old shape" guard both migration chains use so their step is a no-op on an already-current payload.

**Steps:**

- [ ] **Step 1: Write the failing test for `upgradeLeadMelodyV1` and `isLegacyLeadMelody`.**
  Append to `src/audio/leadMelody.test.ts`, and add `isLegacyLeadMelody, upgradeLeadMelodyV1` to the existing `from './leadMelody'` import list:
  ```ts
  describe('upgradeLeadMelodyV1', () => {
    test('maps every string to a len-1 note, preserving row order', () => {
      expect(upgradeLeadMelodyV1([['C4', 'E4'], [], ['G4']])).toEqual([
        [{ note: 'C4', len: 1 }, { note: 'E4', len: 1 }],
        [],
        [{ note: 'G4', len: 1 }],
      ]);
    });

    test('an empty matrix upgrades to an empty matrix', () => {
      expect(upgradeLeadMelodyV1([])).toEqual([]);
    });
  });

  describe('isLegacyLeadMelody', () => {
    test('accepts a matrix of strings, including empty rows', () => {
      expect(isLegacyLeadMelody([['C4'], []])).toBe(true);
      expect(isLegacyLeadMelody([])).toBe(true);
    });

    test('rejects the already-upgraded object shape', () => {
      expect(isLegacyLeadMelody([[{ note: 'C4', len: 1 }]])).toBe(false);
    });

    test('rejects non-matrix values', () => {
      expect(isLegacyLeadMelody(undefined)).toBe(false);
      expect(isLegacyLeadMelody('C4')).toBe(false);
      expect(isLegacyLeadMelody(['C4'])).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/audio/leadMelody.test.ts
  ```
  Expected failure: `SyntaxError: Export named 'upgradeLeadMelodyV1' not found in module '.../src/audio/leadMelody.ts'`.

- [ ] **Step 3: Add the interface and the two functions.**
  In `src/audio/leadMelody.ts`, immediately after the `LeadTrigger` interface:
  ```ts
  /**
   * One drawn lead note. The matrix index is the step the note STARTS on;
   * `len` is how many steps it occupies, counted in ACTIVE steps (the current
   * meter's stepsPerBar), an integer >= 1. Defined here, next to the functions
   * that consume it, so store/ and components/ import it downward and audio/
   * never has to import either (CLAUDE.md, three-layer rule).
   */
  export interface LeadNote {
    note: string;
    len: number;
  }

  /** True for the pre-DEV-369 `string[][]` melody shape. */
  export function isLegacyLeadMelody(value: unknown): value is string[][] {
    return (
      Array.isArray(value) &&
      value.every((row) => Array.isArray(row) && row.every((n) => typeof n === 'string'))
    );
  }

  /**
   * The one transform both migration chains share: every old note becomes a
   * one-step note. The persist chain and the .solna chain call this from two
   * separate functions and must NOT be refactored into one — the persist
   * payload is private localStorage shape, a project body is an external
   * contract, and the two version numbers move for different reasons.
   */
  export function upgradeLeadMelodyV1(steps: string[][]): LeadNote[][] {
    return steps.map((row) => row.map((note) => ({ note, len: 1 })));
  }
  ```

- [ ] **Step 4: Run the test and watch it pass.**
  ```bash
  bun test src/audio/leadMelody.test.ts
  ```
  Every test in the file passes, including the pre-existing `leadStepNotes` / `resizeLeadMelody` blocks.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/audio/leadMelody.ts src/audio/leadMelody.test.ts
  git commit -m "$(cat <<'EOF'
  feat(lead): add the LeadNote type and the shared v1 melody upgrade (DEV-369)

  LeadNote { note, len } and the pure upgradeLeadMelodyV1 transform both
  migration chains will call, plus isLegacyLeadMelody so each chain's step
  is a no-op on an already-current payload. Nothing consumes them yet.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 2: Flip the state type to `LeadNote[][]` with zero behaviour change

Every note becomes `len: 1`; nothing sounds or renders differently. The proof is that the whole existing suite stays green after the fixtures are re-spelled.

**Files:**
- Modify: `src/store/types.ts:130` (`LeadSlice.leadMelodySteps`), `src/store/types.ts:132` (`setLeadMelodySteps`), `src/store/types.ts:262` (`Loop.leadMelodySteps`)
- Modify: `src/store/leadSlice.ts:26` (default), `:48-58` (`toggleLeadNote`)
- Modify: `src/store/loopSlice.ts:37` (default)
- Modify: `src/audio/leadMelody.ts:26-35` (`leadStepNotes`), `:70-78` (`resizeLeadMelody`), `:84-91` (`transposeLeadMelodyByRoot`), `:97-106` (`remapLeadMelodyByScale`)
- Modify: `src/store/sanitize.ts:123-127` (`isStringMatrix` → `isLeadNoteMatrix`), `:226` (guard site)
- Modify: `src/store/store.ts:204-206` (guard site)
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx:47` (`melody` prop type), `:78` (the `.includes` read), `:223` (`clearMelody`)
- Test: `src/audio/leadMelody.test.ts`, `src/store/leadSlice.test.ts`, `src/store/sanitize.test.ts`, `src/store/store.test.ts`, `src/store/musicContextSlice.test.ts`, `src/store/loop.test.ts`

**Interfaces:**
- Consumes: `LeadNote` from `src/audio/leadMelody.ts` (Task 1).
- Produces:
  ```ts
  // src/audio/leadMelody.ts
  export function leadStepNotes(steps: readonly LeadNote[][], stepInLoop: number, stepsPerBar: number): string[]
  export function resizeLeadMelody(steps: readonly LeadNote[][], newLoopLength: number): LeadNote[][]
  export function transposeLeadMelodyByRoot(steps: readonly LeadNote[][], fromRoot: string, toRoot: string): LeadNote[][]
  export function remapLeadMelodyByScale(steps: readonly LeadNote[][], root: string, fromType: string, toType: string): LeadNote[][]
  // src/store/sanitize.ts
  export function isLeadNoteMatrix(value: unknown): value is LeadNote[][]
  // src/store/types.ts
  // LeadSlice.leadMelodySteps: LeadNote[][]; setLeadMelodySteps: (steps: LeadNote[][]) => void
  // Loop.leadMelodySteps: LeadNote[][]
  ```
  `leadStepNotes` deliberately still returns `string[]` so `resolveLeadStepTriggers` and `useLeadPlayback.ts` are untouched here; Task 6 replaces it with `leadSoundingNotes`.

**Steps:**

- [ ] **Step 1: Write the failing test that pins the new stored shape.**
  Append to `src/store/leadSlice.test.ts` (the file already imports `useAppStore` and defines `resetLead`):
  ```ts
  describe('lead slice — LeadNote shape', () => {
    beforeEach(resetLead);
    test('toggleLeadNote creates a one-step note object, not a bare string', () => {
      useAppStore.getState().toggleLeadNote(0, 'C4');
      expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
    });

    test('toggling the same note again removes it', () => {
      useAppStore.getState().toggleLeadNote(0, 'C4');
      useAppStore.getState().toggleLeadNote(0, 'C4');
      expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
    });

    test('a second note on the same step appends without disturbing the first', () => {
      useAppStore.getState().toggleLeadNote(3, 'C4');
      useAppStore.getState().toggleLeadNote(3, 'G4');
      expect(useAppStore.getState().leadMelodySteps[3]).toEqual([
        { note: 'C4', len: 1 },
        { note: 'G4', len: 1 },
      ]);
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/store/leadSlice.test.ts -t "one-step note object"
  ```
  Expected failure: `expect(received).toEqual(expected)` — received `[ "C4" ]`, expected `[ { note: "C4", len: 1 } ]`.

- [ ] **Step 3: Flip the two type declarations in `src/store/types.ts`.**
  At `:130` and `:132` inside `LeadSlice`:
  ```ts
    /** Notes per step, stored at a fixed MAX_STEPS_PER_BAR per bar. The index is the step a note STARTS on. */
    leadMelodySteps: LeadNote[][];
  ```
  ```ts
    setLeadMelodySteps: (steps: LeadNote[][]) => void;
  ```
  At `:262` inside `Loop`:
  ```ts
    leadMelodySteps: LeadNote[][];
  ```
  Add the import at the top of the file:
  ```ts
  import type { LeadNote } from '../audio/leadMelody';
  ```

- [ ] **Step 4: Flip the four pure functions in `src/audio/leadMelody.ts`.**
  Replace the bodies of `leadStepNotes`, `resizeLeadMelody`, `transposeLeadMelodyByRoot` and `remapLeadMelodyByScale` with:
  ```ts
  export function leadStepNotes(
    steps: readonly LeadNote[][],
    stepInLoop: number,
    stepsPerBar: number,
  ): string[] {
    const barIndex = Math.floor(stepInLoop / stepsPerBar);
    const stepInBar = stepInLoop - barIndex * stepsPerBar;
    const idx = barIndex * MAX_STEPS_PER_BAR + stepInBar;
    return (steps[idx] ?? []).map((n) => n.note);
  }
  ```
  ```ts
  export function resizeLeadMelody(
    steps: readonly LeadNote[][],
    newLoopLength: number,
  ): LeadNote[][] {
    const targetLen = newLoopLength * MAX_STEPS_PER_BAR;
    const out = steps.slice(0, targetLen).map((row) => [...row]);
    while (out.length < targetLen) out.push([]);
    return out;
  }
  ```
  ```ts
  export function transposeLeadMelodyByRoot(
    steps: readonly LeadNote[][],
    fromRoot: string,
    toRoot: string,
  ): LeadNote[][] {
    const delta = rootSemitone(toRoot) - rootSemitone(fromRoot);
    return steps.map((row) =>
      row.map((n) => ({ note: transposeNoteBySemitones(n.note, delta), len: n.len })),
    );
  }
  ```
  ```ts
  export function remapLeadMelodyByScale(
    steps: readonly LeadNote[][],
    root: string,
    fromType: string,
    toType: string,
  ): LeadNote[][] {
    return steps.map((row) =>
      row.map((n) => ({
        note: remapNoteByScaleDegree(n.note, root, fromType, root, toType),
        len: n.len,
      })),
    );
  }
  ```

- [ ] **Step 5: Flip the two slice defaults and `toggleLeadNote`.**
  This is the length-unaware version and it is correct at this boundary — every note is `len: 1`, so `melody[stepIndex]` still answers "is this cell filled". Task 7 replaces it once notes can span several cells.
  In `src/store/leadSlice.ts`, add `import { resizeLeadMelody, type LeadNote } from '../audio/leadMelody';` (replacing the existing `resizeLeadMelody` import), then:
  ```ts
      leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]),
  ```
  ```ts
      toggleLeadNote: (stepIndex, note) =>
        set((state) => {
          const row = state.leadMelodySteps[stepIndex] ?? [];
          const has = row.some((n) => n.note === note);
          const nextRow = has
            ? row.filter((n) => n.note !== note)
            : [...row, { note, len: 1 }];
          return {
            leadMelodySteps: state.leadMelodySteps.map((r, i) =>
              i === stepIndex ? nextRow : r,
            ),
          };
        }),
  ```
  In `src/store/loopSlice.ts:37`, with `import type { LeadNote } from '../audio/leadMelody';` added:
  ```ts
      leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]),
  ```

- [ ] **Step 6: Replace `isStringMatrix` with `isLeadNoteMatrix` at both guard sites.**
  In `src/store/sanitize.ts`, replace the `isStringMatrix` function (`:123-127`) with:
  ```ts
  /**
   * A valid lead melody: rows of { note: string; len: integer >= 1 }. A row
   * entry with a missing or non-integer `len` makes the whole matrix fall back
   * to the default rather than reaching the scheduler half-typed. The v1
   * `string[][]` shape is rejected here on purpose — both migration chains
   * upgrade BEFORE sanitize runs (see projectFile.ts:91-100 and the persist
   * migrate/merge order in store.ts), and reaching this guard un-upgraded is
   * the silent data-loss bug the ordering requirement exists to prevent.
   */
  export function isLeadNoteMatrix(value: unknown): value is LeadNote[][] {
    return (
      Array.isArray(value) &&
      value.every(
        (row) =>
          Array.isArray(row) &&
          row.every(
            (n) =>
              typeof n === 'object' &&
              n !== null &&
              typeof (n as LeadNote).note === 'string' &&
              Number.isInteger((n as LeadNote).len) &&
              (n as LeadNote).len >= 1,
          ),
      )
    );
  }
  ```
  Add `import type { LeadNote } from '../audio/leadMelody';` to the file's imports. At `:226`:
  ```ts
        leadMelodySteps: isLeadNoteMatrix(r.leadMelodySteps) ? r.leadMelodySteps : fallback.leadMelodySteps,
  ```
  In `src/store/store.ts:204-206`, swap the imported name in the `from './sanitize'` import list and the call:
  ```ts
    if (!isLeadNoteMatrix(sanitized.leadMelodySteps)) {
      delete sanitized.leadMelodySteps;
    }
  ```

- [ ] **Step 7: Flip the three reads in `LeadMelodyGrid.tsx`.**
  The prop type at `:47`:
  ```ts
    melody: readonly LeadNote[][];
  ```
  The cell read at `:78`:
  ```ts
              const active = melody[idx]?.some((n) => n.note === note) ?? false;
  ```
  `clearMelody` at `:223`:
  ```ts
    const clearMelody = useCallback(
      () => setLeadMelodySteps(leadMelodySteps.map(() => [] as LeadNote[])),
      [leadMelodySteps, setLeadMelodySteps],
    );
  ```
  Add `LeadNote` to the existing `from '../../../audio/leadMelody'` type import.

- [ ] **Step 8: Re-spell the existing string fixtures in the six affected test files.**
  Every `['C4']`-style melody literal becomes `[{ note: 'C4', len: 1 }]`. The mechanical rule: in `src/audio/leadMelody.test.ts`, `src/store/leadSlice.test.ts`, `src/store/sanitize.test.ts`, `src/store/store.test.ts`, `src/store/musicContextSlice.test.ts` and `src/store/loop.test.ts`, any array assigned to or asserted against `leadMelodySteps` — and any argument to `leadStepNotes` / `resizeLeadMelody` / `transposeLeadMelodyByRoot` / `remapLeadMelodyByScale` — becomes the object shape. Expected results of `leadStepNotes` stay bare strings (it still returns `string[]`). Expected results of `transposeLeadMelodyByRoot` / `remapLeadMelodyByScale` / `resizeLeadMelody` become objects.   ```bash
  grep -rn "isStringMatrix\|leadMelodySteps\|leadStepNotes" src --include='*.test.ts' --include='*.test.tsx'
  ```

- [ ] **Step 9: Replace the `isStringMatrix` block in `src/store/sanitize.test.ts` with the three `isLeadNoteMatrix` cases.**
  Rename the import and the describe block, then:
  ```ts
  describe('isLeadNoteMatrix', () => {
    test('accepts rows of { note, len } and empty rows', () => {
      expect(isLeadNoteMatrix([[{ note: 'C4', len: 1 }, { note: 'E4', len: 4 }], []])).toBe(true);
      expect(isLeadNoteMatrix([])).toBe(true);
    });

    test('rejects the pre-DEV-369 string matrix — both chains upgrade BEFORE sanitize', () => {
      expect(isLeadNoteMatrix([['C4', 'E4'], []])).toBe(false);
    });

    test('a missing or non-integer len falls back rather than reaching the scheduler', () => {
      expect(isLeadNoteMatrix([[{ note: 'C4', len: 1.5 }]])).toBe(false);
      expect(isLeadNoteMatrix([[{ note: 'C4', len: 0 }]])).toBe(false);
      expect(isLeadNoteMatrix([[{ note: 'C4' }]])).toBe(false);
      expect(isLeadNoteMatrix([[{ len: 2 }]])).toBe(false);
      expect(isLeadNoteMatrix([[null]])).toBe(false);
      expect(isLeadNoteMatrix('C4')).toBe(false);
    });
  });
  ```

- [ ] **Step 10: Run the whole suite and watch it pass.**
  ```bash
  bun test && bun run lint
  ```
  Every test passes and tsc reports no errors. This green suite *is* the zero-behaviour-change proof for this task.

- [ ] **Step 11: Commit.**
  ```bash
  git add src/store/types.ts src/store/leadSlice.ts src/store/loopSlice.ts src/store/sanitize.ts src/store/store.ts src/audio/leadMelody.ts src/components/loop/lead/LeadMelodyGrid.tsx src/audio/leadMelody.test.ts src/store/leadSlice.test.ts src/store/sanitize.test.ts src/store/store.test.ts src/store/musicContextSlice.test.ts src/store/loop.test.ts
  git commit -m "$(cat <<'EOF'
  refactor(lead): store the melody as LeadNote[][] with no behaviour change (DEV-369)

  leadMelodySteps flips from string[][] to LeadNote[][] end to end: both type
  declarations, both slice defaults, the four pure melody helpers, the grid's
  cell read and clear, and the two isStringMatrix guards which become
  isLeadNoteMatrix. Every note is len: 1, so nothing sounds or renders
  differently — the green suite is the proof.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 3: The per-loop `leadGate` field

Adds the state and its clamped setter, and retires `LEAD_GATE` into `DEFAULT_LEAD_GATE`. Nothing reads `leadGate` yet — scheduling picks it up in Task 6, the slider in Task 10.

**Files:**
- Modify: `src/audio/leadMelody.ts:7-12` (`LEAD_GATE` → `DEFAULT_LEAD_GATE`, and its use inside `resolveLeadStepTriggers`)
- Modify: `src/store/types.ts` (`LeadSlice`: `leadGate` + `setLeadGate`; `Loop`: `leadGate` beside the other `lead*` fields)
- Modify: `src/store/loop.ts:22` (add `'leadGate'` to `LOOP_FLAT_KEYS`, after `'leadMelodyOctave'`)
- Modify: `src/store/leadSlice.ts` (default + setter)
- Modify: `src/store/loopSlice.ts:40` (default, after `leadMelodyOctave`)
- Modify: `src/store/sanitize.ts:231` (clamp in `sanitizeLoops`, after `leadMelodyOctave`)
- Modify: `src/store/store.ts` (clamp in `sanitizePersistedState`, beside the other numeric clamps)
- Test: `src/store/leadSlice.test.ts`, `src/audio/leadMelody.test.ts`

**Interfaces:**
- Consumes: `LeadNote` (Task 1); `leadMelodySteps: LeadNote[][]` (Task 2).
- Produces:
  ```ts
  // src/audio/leadMelody.ts
  export const DEFAULT_LEAD_GATE = 0.85;
  // src/store/types.ts — LeadSlice
  leadGate: number;
  setLeadGate: (gate: number) => void;
  // src/store/types.ts — Loop
  leadGate: number;
  ```
  `setLeadGate` clamps to `[0.05, 1]` and falls back to `DEFAULT_LEAD_GATE` for a non-finite input. `LEAD_GATE` no longer exists.

**Steps:**

- [ ] **Step 1: Write the failing test for the default and both clamps.**
  Append to `src/store/leadSlice.test.ts`, importing `DEFAULT_LEAD_GATE` from `'../audio/leadMelody'`:
  ```ts
  describe('lead slice — leadGate', () => {
    beforeEach(() => {
      resetLead();
      useAppStore.setState({ leadGate: DEFAULT_LEAD_GATE });
    });

    test('defaults to DEFAULT_LEAD_GATE, which is exactly the retired fixed gate', () => {
      expect(DEFAULT_LEAD_GATE).toBe(0.85);
      expect(useAppStore.getState().leadGate).toBe(0.85);
    });

    test('clamps to the 0.05 floor so a note can never be silent', () => {
      useAppStore.getState().setLeadGate(0);
      expect(useAppStore.getState().leadGate).toBe(0.05);
      useAppStore.getState().setLeadGate(-3);
      expect(useAppStore.getState().leadGate).toBe(0.05);
    });

    test('clamps to the 1.0 ceiling so a note never overlaps the next step', () => {
      useAppStore.getState().setLeadGate(1.4);
      expect(useAppStore.getState().leadGate).toBe(1);
    });

    test('keeps a value inside the range and rejects a non-finite one', () => {
      useAppStore.getState().setLeadGate(0.5);
      expect(useAppStore.getState().leadGate).toBe(0.5);
      useAppStore.getState().setLeadGate(Number.NaN);
      expect(useAppStore.getState().leadGate).toBe(DEFAULT_LEAD_GATE);
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/store/leadSlice.test.ts -t "leadGate"
  ```
  Expected failure: `SyntaxError: Export named 'DEFAULT_LEAD_GATE' not found in module '.../src/audio/leadMelody.ts'`.

- [ ] **Step 3: Rename `LEAD_GATE` to `DEFAULT_LEAD_GATE`.**
  In `src/audio/leadMelody.ts`, replace the constant and its doc comment:
  ```ts
  /**
   * The default per-loop gate: what fraction of a note's FINAL step sounds
   * before note-off. 0.85 is exactly the fixed gate this replaces, so a
   * project that never touches the slider sounds identical to before. Used as
   * the slice default and as the seed in both migration chains — the two
   * places that must agree on "what old music sounded like".
   */
  export const DEFAULT_LEAD_GATE = 0.85;
  ```
  Inside `resolveLeadStepTriggers`, the block-mode branch becomes `holdSec: DEFAULT_LEAD_GATE * stepDurSec` (Task 6 replaces this line with the length-aware formula). In `src/audio/leadMelody.test.ts`, change the import and every `LEAD_GATE` reference to `DEFAULT_LEAD_GATE`.

- [ ] **Step 4: Add the field to both type declarations and to `LOOP_FLAT_KEYS`.**
  In `src/store/types.ts`, inside `LeadSlice` after `leadMelodyOctave`:
  ```ts
    /** Fraction of a note's FINAL step that sounds, 0.05-1.0; per loop. */
    leadGate: number;
  ```
  and after `setLeadMelodyOctave`:
  ```ts
    setLeadGate: (gate: number) => void;
  ```
  In `Loop`, after `leadMelodyOctave: number;`:
  ```ts
    leadGate: number;
  ```
  In `src/store/loop.ts`, after `'leadMelodyOctave',`:
  ```ts
    'leadGate',
  ```

- [ ] **Step 5: Add the default and the clamped setter to the slice, and the loop default.**
  In `src/store/leadSlice.ts`, extend the `leadMelody` import to `import { DEFAULT_LEAD_GATE, resizeLeadMelody, type LeadNote } from '../audio/leadMelody';`, then after `leadMelodyOctave: 3,`:
  ```ts
      leadGate: DEFAULT_LEAD_GATE,
  ```
  and after `setLeadMelodyOctave`:
  ```ts
      // Clamped here, not in the slider: the floor stops the slider ever
      // producing a silent note that still shows as drawn in the grid, and the
      // ceiling stops a note overlapping into the next step, which is the
      // overlap invariant 1 exists to prevent.
      setLeadGate: (gate) =>
        set({
          leadGate: Number.isFinite(gate)
            ? Math.min(1, Math.max(0.05, gate))
            : DEFAULT_LEAD_GATE,
        }),
  ```
  In `src/store/loopSlice.ts`, after `leadMelodyOctave: 3,` (with `DEFAULT_LEAD_GATE` imported from `'../audio/leadMelody'`):
  ```ts
      leadGate: DEFAULT_LEAD_GATE,
  ```

- [ ] **Step 6: Clamp it in both sanitize paths.**
  In `src/store/sanitize.ts`, inside the `loops.push({ ... })` literal after the `leadMelodyOctave` entry:
  ```ts
        leadGate: clampFinite(r.leadGate, 0.05, 1, fallback.leadGate),
  ```
  In `src/store/store.ts`, in `sanitizePersistedState` beside the other numeric clamps (after the `drumFilterResonance` line), with `DEFAULT_LEAD_GATE` added to the `from '../audio/leadMelody'` import:
  ```ts
    sanitized.leadGate = clampFinite(sanitized.leadGate, 0.05, 1, DEFAULT_LEAD_GATE);
  ```

- [ ] **Step 7: Run the tests and watch them pass.**
  ```bash
  bun test src/store/leadSlice.test.ts src/audio/leadMelody.test.ts src/store/loop.test.ts src/store/projectFormat.test.ts && bun run lint
  ```
  All pass, including `loop.test.ts`'s `LOOP_FLAT_KEYS` pin and `projectFormat.test.ts`'s `PROJECT_LOOP_KEYS` pin, which pick the new field up through `LOOP_FLAT_KEYS`.

- [ ] **Step 8: Commit.**
  ```bash
  git add src/audio/leadMelody.ts src/store/types.ts src/store/loop.ts src/store/leadSlice.ts src/store/loopSlice.ts src/store/sanitize.ts src/store/store.ts src/store/leadSlice.test.ts src/audio/leadMelody.test.ts
  git commit -m "$(cat <<'EOF'
  feat(lead): add the per-loop leadGate field (DEV-369)

  leadGate joins the LeadSlice, Loop and LOOP_FLAT_KEYS with a 0.05-1.0 clamp
  in the setter and in both sanitize paths. LEAD_GATE is retired into
  DEFAULT_LEAD_GATE = 0.85, the single value the slice default and both
  migration seeds agree on. Nothing reads leadGate yet.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 4: The persist migration (version 9 → 10)

**Files:**
- Modify: `src/store/migrate.ts` (new `migrateLeadNoteLength` at the end, beside `migrateAddProjectIdentity`)
- Modify: `src/store/store.ts:270` (`version: 9` → `10`), `:275-312` (the chain)
- Test: `src/store/migrate.test.ts`

**Interfaces:**
- Consumes: `upgradeLeadMelodyV1(steps: string[][]): LeadNote[][]` and `isLegacyLeadMelody(value: unknown): value is string[][]` (Task 1); `DEFAULT_LEAD_GATE` (Task 3).
- Produces:
  ```ts
  // src/store/migrate.ts
  export function migrateLeadNoteLength<T extends object>(state: T): T
  ```
  Same generic shape as `backfillLeadWindow` / `migrateAddProjectIdentity`: pure, and a no-op on an already-current payload.

**Steps:**

- [ ] **Step 1: Write the failing migration test.**
  Append to `src/store/migrate.test.ts`, adding `migrateLeadNoteLength` to the existing `from './migrate'` import and `DEFAULT_LEAD_GATE` from `'../audio/leadMelody'`:
  ```ts
  describe('migrateLeadNoteLength (v9 -> v10)', () => {
    test('upgrades every loop melody to len-1 notes and seeds leadGate', () => {
      const migrated = migrateLeadNoteLength({
        loops: [
          { id: 'loop-1', leadMelodySteps: [['C4', 'E4'], [], ['G4']] },
          { id: 'loop-2', leadMelodySteps: [[]] },
        ],
      } as never) as { loops: { id: string; leadMelodySteps: unknown; leadGate: number }[] };

      expect(migrated.loops[0].leadMelodySteps).toEqual([
        [{ note: 'C4', len: 1 }, { note: 'E4', len: 1 }],
        [],
        [{ note: 'G4', len: 1 }],
      ]);
      expect(migrated.loops[0].leadGate).toBe(DEFAULT_LEAD_GATE);
      expect(migrated.loops[1].leadGate).toBe(DEFAULT_LEAD_GATE);
    });

    test('is a no-op on an already-upgraded payload and keeps a custom gate', () => {
      const already = {
        loops: [{ id: 'loop-1', leadMelodySteps: [[{ note: 'C4', len: 4 }]], leadGate: 0.4 }],
      };
      const migrated = migrateLeadNoteLength(already as never) as typeof already;
      expect(migrated.loops[0].leadMelodySteps).toEqual([[{ note: 'C4', len: 4 }]]);
      expect(migrated.loops[0].leadGate).toBe(0.4);
    });

    test('a payload with no loops array passes through untouched', () => {
      expect(migrateLeadNoteLength({ bpm: 118 } as never)).toEqual({ bpm: 118 } as never);
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/store/migrate.test.ts -t "migrateLeadNoteLength"
  ```
  Expected failure: `SyntaxError: Export named 'migrateLeadNoteLength' not found in module '.../src/store/migrate.ts'`.

- [ ] **Step 3: Add the migration function.**
  At the end of `src/store/migrate.ts`, with `import { DEFAULT_LEAD_GATE, isLegacyLeadMelody, upgradeLeadMelodyV1 } from '../audio/leadMelody';` added at the top:
  ```ts
  /**
   * v9 -> v10: lead notes gain a length and each loop gains a gate. Only the
   * loops are touched — persist `merge` writes loops[activeLoopId] over the
   * flat lead keys through loopStatePatch, so the flat mirror is rebuilt from
   * the upgraded loop. Must run BEFORE sanitizePersistedState (zustand runs
   * `migrate` before `merge`, and `merge` is where sanitize is called): the
   * new isLeadNoteMatrix guard rejects the v1 string shape, so a payload that
   * reached sanitize un-upgraded would blank the melody with no error.
   */
  export function migrateLeadNoteLength<T extends object>(state: T): T {
    const next = { ...(state as Record<string, unknown>) } as Record<string, unknown>;
    if (!Array.isArray(next.loops)) return next as unknown as T;
    next.loops = next.loops.map((loop) => {
      if (!loop || typeof loop !== 'object' || Array.isArray(loop)) return loop;
      const row = loop as Record<string, unknown>;
      return {
        ...row,
        leadMelodySteps: isLegacyLeadMelody(row.leadMelodySteps)
          ? upgradeLeadMelodyV1(row.leadMelodySteps)
          : row.leadMelodySteps,
        leadGate: typeof row.leadGate === 'number' ? row.leadGate : DEFAULT_LEAD_GATE,
      };
    });
    return next as unknown as T;
  }
  ```

- [ ] **Step 4: Bump the persist version and wire the chain step.**
  In `src/store/store.ts`, `version: 9` becomes `version: 10`, `migrateLeadNoteLength` joins the `from './migrate'` import, and the step goes after `identified`:
  ```ts
          // v9 -> v10 (lead note length + per-loop gate). Runs LAST, outside
          // `identified`, so every older payload is already in loop shape.
          const lengthened = (payload: PersistedState): PersistedState => {
            const base = identified(payload);
            return version >= 10 ? base : (migrateLeadNoteLength(base) as PersistedState);
          };
          if (version >= 2) return lengthened(wrapped(metered(recoloured)));
  ```
  and the final `return identified(wrapped(metered(next as unknown as PersistedState)));` becomes:
  ```ts
          return lengthened(wrapped(metered(next as unknown as PersistedState)));
  ```

- [ ] **Step 5: Run the tests and watch them pass.**
  ```bash
  bun test src/store/migrate.test.ts src/store/store.test.ts && bun run lint
  ```

- [ ] **Step 6: Commit.**
  ```bash
  git add src/store/migrate.ts src/store/store.ts src/store/migrate.test.ts
  git commit -m "$(cat <<'EOF'
  feat(store): migrate the persisted melody to LeadNote and seed leadGate (DEV-369)

  Persist version 9 -> 10. migrateLeadNoteLength runs upgradeLeadMelodyV1 over
  loops[].leadMelodySteps and seeds leadGate = 0.85, last in the chain so every
  older payload is already in loop shape. It runs before `merge`, which is where
  sanitize lives — reaching the new isLeadNoteMatrix guard un-upgraded would
  blank the melody silently.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 5: The project-format migration (formatVersion 1 → 2)

Includes the silent-failure regression test — a v1 `.solna` fixture through the real `parseProjectFile` path. This failure blanks data instead of throwing, so nothing else in the suite would catch it.

**Files:**
- Modify: `src/store/projectFormat.ts:16` (`PROJECT_FORMAT_VERSION` 1 → 2)
- Modify: `src/store/projectFormatMigrate.ts:1-16` (the whole file — the v1 → v2 step)
- Test: `src/store/projectFormat.test.ts`

**Interfaces:**
- Consumes: `upgradeLeadMelodyV1`, `isLegacyLeadMelody` (Task 1); `DEFAULT_LEAD_GATE` (Task 3); `Loop.leadGate` (Task 3).
- Produces:
  ```ts
  // src/store/projectFormat.ts
  export const PROJECT_FORMAT_VERSION = 2;
  // src/store/projectFormatMigrate.ts
  export function migrateProjectBody(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown>
  ```
  Signature unchanged; it now has one real step. Separate from the persist chain by design — only `upgradeLeadMelodyV1` is shared.

**Steps:**

- [ ] **Step 1: Write the failing format-migration test.**
  Append to `src/store/projectFormat.test.ts`, adding `PROJECT_FORMAT_VERSION` to the `from './projectFormat'` import, `import { migrateProjectBody } from './projectFormatMigrate';` and `import { DEFAULT_LEAD_GATE } from '../audio/leadMelody';`:
  ```ts
  describe('migrateProjectBody — v1 -> v2 (lead note length + gate)', () => {
    test('upgrades every loop melody and seeds leadGate', () => {
      const migrated = migrateProjectBody(
        {
          content: {
            bpm: 120,
            loops: [{ id: 'loop-1', leadMelodySteps: [['C4'], [], ['E4', 'G4']] }],
          },
        },
        1,
      ) as { content: { bpm: number; loops: { leadMelodySteps: unknown; leadGate: number }[] } };

      expect(migrated.content.loops[0].leadMelodySteps).toEqual([
        [{ note: 'C4', len: 1 }],
        [],
        [{ note: 'E4', len: 1 }, { note: 'G4', len: 1 }],
      ]);
      expect(migrated.content.loops[0].leadGate).toBe(DEFAULT_LEAD_GATE);
      expect(migrated.content.bpm).toBe(120);
    });

    test('is a no-op at the current version', () => {
      const body = {
        content: { loops: [{ id: 'loop-1', leadMelodySteps: [[{ note: 'C4', len: 3 }]], leadGate: 0.3 }] },
      };
      expect(migrateProjectBody(body, PROJECT_FORMAT_VERSION)).toEqual(body);
    });

    test('a body with no content or no loops passes through', () => {
      expect(migrateProjectBody({ id: 'p' }, 1)).toEqual({ id: 'p' });
      expect(migrateProjectBody({ content: { bpm: 90 } }, 1)).toEqual({ content: { bpm: 90 } });
    });
  });
  ```

- [ ] **Step 2: Write the failing silent-failure regression test.**
  Append to the same file, adding `import { parseProjectFile } from './projectFile';` and `import type { Loop } from './types';` (the file already imports `createDefaultLoop` and `INITIAL_EFFECTS`):
  ```ts
  /**
   * A formatVersion-1 file exactly as an older build wrote it: string melody
   * rows, no leadGate. Built from createDefaultLoop so every other field is
   * valid and the only thing under test is the melody.
   */
  function legacyV1ProjectFile(): string {
    const loop = { ...createDefaultLoop(), id: 'loop-1', name: 'Loop 1' } as unknown as Record<string, unknown>;
    loop.leadMelodySteps = [['C4', 'E4'], [], ['G4']];
    delete loop.leadGate;
    return JSON.stringify({
      formatVersion: 1,
      id: 'project-legacy',
      name: 'Legacy',
      createdAt: 1,
      updatedAt: 2,
      content: {
        bpm: 118,
        meterId: '4/4',
        masterVolume: 0.85,
        effects: INITIAL_EFFECTS,
        loops: [loop],
      },
    });
  }

  describe('a formatVersion-1 .solna file keeps its melody through the real import path', () => {
    test('parseProjectFile upgrades before sanitize, so nothing is blanked', () => {
      const result = parseProjectFile(legacyV1ProjectFile());
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('parseProjectFile refused a valid v1 file');

      const loop: Loop = result.body.content.loops[0];
      expect(result.body.formatVersion).toBe(PROJECT_FORMAT_VERSION);
      expect(loop.leadMelodySteps).toEqual([
        [{ note: 'C4', len: 1 }, { note: 'E4', len: 1 }],
        [],
        [{ note: 'G4', len: 1 }],
      ]);
      expect(loop.leadGate).toBe(DEFAULT_LEAD_GATE);
      expect(result.body.content.bpm).toBe(118);
    });
  });
  ```

- [ ] **Step 3: Run both tests and watch them fail.**
  ```bash
  bun test src/store/projectFormat.test.ts -t "v1"
  ```
  Expected failures: the migration test reports `expect(received).toEqual(expected)` with `received` still `[ [ "C4" ], [], [ "E4", "G4" ] ]` (the chain has no steps), and the regression test reports the loop's `leadMelodySteps` as the empty 24-row default — the melody blanked, exactly the silent failure being pinned.

- [ ] **Step 4: Bump the format version.**
  In `src/store/projectFormat.ts:16`:
  ```ts
  export const PROJECT_FORMAT_VERSION = 2;
  ```

- [ ] **Step 5: Add the v1 → v2 step to the format chain.**
  Replace the body of `src/store/projectFormatMigrate.ts`:
  ```ts
  import { DEFAULT_LEAD_GATE, isLegacyLeadMelody, upgradeLeadMelodyV1 } from '../audio/leadMelody';

  /**
   * v1 -> v2: lead notes gain a length and each loop gains a gate. Shares only
   * the pure upgradeLeadMelodyV1 transform with the persist chain in
   * migrate.ts — the two must NOT be refactored into one function: a project
   * body is an external contract, the persist payload is private localStorage
   * shape, and their version numbers move for different reasons.
   */
  function upgradeLeadNotesV2(raw: Record<string, unknown>): Record<string, unknown> {
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
          return {
            ...row,
            leadMelodySteps: isLegacyLeadMelody(row.leadMelodySteps)
              ? upgradeLeadMelodyV1(row.leadMelodySteps)
              : row.leadMelodySteps,
            leadGate: typeof row.leadGate === 'number' ? row.leadGate : DEFAULT_LEAD_GATE,
          };
        }),
      },
    };
  }

  /**
   * The `.solna` format migration chain. Separate from the persist chain in
   * store.ts on purpose (see projectFormat.ts): a project file is an external
   * contract, the persist payload is private.
   *
   * Each step must be pure and a no-op on an already-current payload. Steps run
   * in version order. This whole chain runs BEFORE sanitizeContent
   * (projectFile.ts:91-100) and must never be moved into or after it: the
   * isLeadNoteMatrix guard rejects the v1 string shape, so an un-upgraded body
   * would come back with a blank melody and no error.
   */
  export function migrateProjectBody(
    raw: Record<string, unknown>,
    fromVersion: number,
  ): Record<string, unknown> {
    let next: Record<string, unknown> = { ...raw };
    if (fromVersion < 2) next = upgradeLeadNotesV2(next);
    return next;
  }
  ```

- [ ] **Step 6: Run the tests and watch them pass.**
  ```bash
  bun test src/store/projectFormat.test.ts src/store/projectFile.test.ts src/store/projectStore.test.ts && bun run lint
  ```

- [ ] **Step 7: Commit.**
  ```bash
  git add src/store/projectFormat.ts src/store/projectFormatMigrate.ts src/store/projectFormat.test.ts
  git commit -m "$(cat <<'EOF'
  feat(store): migrate .solna bodies to LeadNote and seed leadGate (DEV-369)

  PROJECT_FORMAT_VERSION 1 -> 2 with the chain's first real step, running the
  shared upgradeLeadMelodyV1 over content.loops[]. Deliberately a separate
  function from the persist chain — only the pure transform is shared.

  Adds the regression test that pins the ordering requirement: a v1 .solna
  fixture through the real parseProjectFile path comes back with its melody
  intact. Upgrading after sanitize would blank it with no error and no throw,
  so nothing else in the suite would catch it.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 6: Length-aware scheduling

Splits "which notes are sounding here" from "which notes start here", applies the `(len - 1 + gate)` formula in block mode, feeds all sounding notes to the arp, clamps overhanging notes on shrink, and wires the hook. Carries the **no-op guarantee** test.

**Files:**
- Modify: `src/audio/leadMelody.ts:26-35` (`leadStepNotes` → `leadSoundingNotes`), `:70-78` (`resizeLeadMelody` gains `stepsPerBar`), `:117-142` (`resolveLeadStepTriggers`)
- Modify: `src/store/leadSlice.ts` (`setLeadLoopLength` passes `stepsPerBar`)
- Modify: `src/components/loop/lead/useLeadPlayback.ts:106-121`
- Test: `src/audio/leadMelody.test.ts`, `src/components/loop/lead/useLeadPlayback.test.ts`

**Interfaces:**
- Consumes: `LeadNote`, `DEFAULT_LEAD_GATE` (Tasks 1, 3); `leadGate: number` on the store (Task 3); `resizeLeadMelody(steps: readonly LeadNote[][], newLoopLength: number): LeadNote[][]` (Task 2, replaced here).
- Produces:
  ```ts
  // src/audio/leadMelody.ts
  export interface LeadSounding { note: string; len: number; age: number }
  export function leadSoundingNotes(
    steps: readonly LeadNote[][],
    stepInLoop: number,
    stepsPerBar: number,
  ): LeadSounding[]
  export function resizeLeadMelody(
    steps: readonly LeadNote[][],
    newLoopLength: number,
    stepsPerBar: number,
  ): LeadNote[][]
  export function resolveLeadStepTriggers(
    sounding: readonly LeadSounding[],
    arpActive: boolean,
    arpStep: number,
    params: { arpMode: ArpMode; arpRate: ArpRate; arpOctaves: number },
    stepDurSec: number,
    gate: number,
  ): LeadTrigger[]
  ```
  `leadStepNotes` is deleted. `LeadTrigger { note: string; timeOffsetSec: number; holdSec: number }` is unchanged. `age` is how many steps ago the note started; `0` means it starts here.

**Steps:**

- [ ] **Step 1: Write the failing tests for `leadSoundingNotes`.**
  In `src/audio/leadMelody.test.ts`, replace the `leadStepNotes` describe block with the following — swap `leadStepNotes` for `leadSoundingNotes` in the `from './leadMelody'` import list, and make sure `type LeadNote` is in it too:
  ```ts
  const oneBar = (): LeadNote[][] => Array.from({ length: 24 }, () => [] as LeadNote[]);

  describe('leadSoundingNotes', () => {
    test('age counts how many steps ago the note started', () => {
      const m = oneBar();
      m[0] = [{ note: 'C4', len: 3 }];
      expect(leadSoundingNotes(m, 0, 16)).toEqual([{ note: 'C4', len: 3, age: 0 }]);
      expect(leadSoundingNotes(m, 1, 16)).toEqual([{ note: 'C4', len: 3, age: 1 }]);
      expect(leadSoundingNotes(m, 2, 16)).toEqual([{ note: 'C4', len: 3, age: 2 }]);
      expect(leadSoundingNotes(m, 3, 16)).toEqual([]);
    });

    test('lists notes starting here before notes still sounding from earlier', () => {
      const m = oneBar();
      m[0] = [{ note: 'C4', len: 4 }];
      m[2] = [{ note: 'G4', len: 1 }];
      expect(leadSoundingNotes(m, 2, 16)).toEqual([
        { note: 'G4', len: 1, age: 0 },
        { note: 'C4', len: 4, age: 2 },
      ]);
    });

    test('the lookback stops at step 0 of the loop', () => {
      const m = oneBar();
      m[0] = [{ note: 'C4', len: 1 }];
      expect(leadSoundingNotes(m, 0, 16)).toEqual([{ note: 'C4', len: 1, age: 0 }]);
      expect(leadSoundingNotes(m, 1, 16)).toEqual([]);
    });

    test('a note held across the bar line keeps sounding', () => {
      const m = [...oneBar(), ...oneBar()];
      m[15] = [{ note: 'A4', len: 3 }];
      expect(leadSoundingNotes(m, 15, 16)).toEqual([{ note: 'A4', len: 3, age: 0 }]);
      expect(leadSoundingNotes(m, 16, 16)).toEqual([{ note: 'A4', len: 3, age: 1 }]);
      expect(leadSoundingNotes(m, 17, 16)).toEqual([{ note: 'A4', len: 3, age: 2 }]);
    });

    test('the stored width is windowed to the ACTIVE stepsPerBar', () => {
      const m = [...oneBar(), ...oneBar()];
      m[24] = [{ note: 'E4', len: 1 }];
      m[12] = [{ note: 'D4', len: 1 }];
      // stepsPerBar 12: loop step 12 is bar 1 step 0 -> stored 24.
      expect(leadSoundingNotes(m, 12, 12)).toEqual([{ note: 'E4', len: 1, age: 0 }]);
      // stepsPerBar 16: loop step 12 is bar 0 step 12 -> stored 12.
      expect(leadSoundingNotes(m, 12, 16)).toEqual([{ note: 'D4', len: 1, age: 0 }]);
    });
  });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/audio/leadMelody.test.ts -t "leadSoundingNotes"
  ```
  Expected failure: `SyntaxError: Export named 'leadSoundingNotes' not found in module '.../src/audio/leadMelody.ts'`.

- [ ] **Step 3: Replace `leadStepNotes` with `leadSoundingNotes`.**
  In `src/audio/leadMelody.ts`, delete `leadStepNotes` and put in its place:
  ```ts
  /** A note audible at a step. `age` is how many steps ago it started; 0 = starts here. */
  export interface LeadSounding {
    note: string;
    len: number;
    age: number;
  }

  /**
   * Every note sounding at `stepInLoop`, whether it started there or earlier.
   * The melody is stored at a fixed MAX_STEPS_PER_BAR width per bar and
   * windowed to the ACTIVE stepsPerBar (the same non-destructive scheme as
   * SP1's drum rows); `stepInLoop` is already reduced to the melody loop.
   *
   * Stateless by design: it scans backward from stepInLoop to step 0 rather
   * than maintaining a sounding-note map across ticks, which would have to be
   * rebuilt correctly on every seek, loop switch and stop. The scan stops at
   * step 0 because invariant 2 guarantees no note wraps the loop boundary.
   * Worst case is loop-length iterations of array indexing per clock tick.
   */
  export function leadSoundingNotes(
    steps: readonly LeadNote[][],
    stepInLoop: number,
    stepsPerBar: number,
  ): LeadSounding[] {
    const out: LeadSounding[] = [];
    for (let age = 0; age <= stepInLoop; age++) {
      const at = stepInLoop - age;
      const barIndex = Math.floor(at / stepsPerBar);
      const idx = barIndex * MAX_STEPS_PER_BAR + (at - barIndex * stepsPerBar);
      const row = steps[idx];
      if (!row) continue;
      for (const n of row) {
        if (n.len > age) out.push({ note: n.note, len: n.len, age });
      }
    }
    return out;
  }
  ```

- [ ] **Step 4: Run the tests and watch them pass.**
  ```bash
  bun test src/audio/leadMelody.test.ts -t "leadSoundingNotes"
  ```
  All five pass. (`bun run lint` still fails here — `useLeadPlayback.ts` calls the deleted `leadStepNotes`; Step 11 fixes it.)

- [ ] **Step 5: Write the failing tests for the gate formula and both modes.**
  In `src/audio/leadMelody.test.ts`, replace the `resolveLeadStepTriggers` describe block with:
  ```ts
  const ARP_PARAMS = { arpMode: 'up' as const, arpRate: '16n' as const, arpOctaves: 1 };
  const STEP_DUR = 0.125;

  describe('resolveLeadStepTriggers — block mode', () => {
    test('holdSec is (len - 1 + gate) * stepDurSec', () => {
      const one = [{ note: 'C4', len: 1, age: 0 }];
      const three = [{ note: 'C4', len: 3, age: 0 }];
      expect(resolveLeadStepTriggers(one, false, 0, ARP_PARAMS, STEP_DUR, 0.5)[0].holdSec).toBe(0.0625);
      expect(resolveLeadStepTriggers(one, false, 0, ARP_PARAMS, STEP_DUR, 1)[0].holdSec).toBe(0.125);
      expect(resolveLeadStepTriggers(one, false, 0, ARP_PARAMS, STEP_DUR, 0.85)[0].holdSec).toBeCloseTo(0.10625, 10);
      expect(resolveLeadStepTriggers(three, false, 0, ARP_PARAMS, STEP_DUR, 0.5)[0].holdSec).toBe(0.3125);
      expect(resolveLeadStepTriggers(three, false, 0, ARP_PARAMS, STEP_DUR, 1)[0].holdSec).toBe(0.375);
      expect(resolveLeadStepTriggers(three, false, 0, ARP_PARAMS, STEP_DUR, 0.85)[0].holdSec).toBeCloseTo(0.35625, 10);
    });

    test('at gate 1.0 a note ends exactly where the next step begins (legato)', () => {
      const t = resolveLeadStepTriggers([{ note: 'C4', len: 2, age: 0 }], false, 0, ARP_PARAMS, STEP_DUR, 1);
      expect(t[0].holdSec).toBe(2 * STEP_DUR);
    });

    test('notes with age > 0 emit nothing — their note-off is already scheduled', () => {
      const t = resolveLeadStepTriggers(
        [{ note: 'G4', len: 1, age: 0 }, { note: 'C4', len: 4, age: 2 }],
        false, 0, ARP_PARAMS, STEP_DUR, 0.85,
      );
      expect(t.map((x) => x.note)).toEqual(['G4']);
    });

    test('a step where every sounding note is held from earlier emits nothing', () => {
      expect(resolveLeadStepTriggers([{ note: 'C4', len: 4, age: 2 }], false, 0, ARP_PARAMS, STEP_DUR, 0.85)).toEqual([]);
    });
  });

  describe('resolveLeadStepTriggers — arp mode', () => {
    test('all sounding notes feed the arp pool, including age > 0', () => {
      const withHeld = resolveLeadStepTriggers(
        [{ note: 'G4', len: 1, age: 0 }, { note: 'C4', len: 4, age: 2 }],
        true, 0, ARP_PARAMS, STEP_DUR, 0.85,
      );
      const startsOnly = resolveLeadStepTriggers(
        [{ note: 'G4', len: 1, age: 0 }],
        true, 0, ARP_PARAMS, STEP_DUR, 0.85,
      );
      expect(withHeld.length).toBeGreaterThan(0);
      expect(withHeld).not.toEqual(startsOnly);
    });

    test('gate does not reach the arp — its hold comes from arpRate', () => {
      const atLowGate = resolveLeadStepTriggers(
        [{ note: 'C4', len: 1, age: 0 }, { note: 'E4', len: 1, age: 0 }],
        true, 0, ARP_PARAMS, STEP_DUR, 0.05,
      );
      const atFullGate = resolveLeadStepTriggers(
        [{ note: 'C4', len: 1, age: 0 }, { note: 'E4', len: 1, age: 0 }],
        true, 0, ARP_PARAMS, STEP_DUR, 1,
      );
      expect(atLowGate).toEqual(atFullGate);
    });
  });
  ```

- [ ] **Step 6: Write the failing no-op guarantee test.**
  Append to `src/audio/leadMelody.test.ts`, adding `import { buildArpSequence } from './arpeggiator';` and `import { computeArpTriggers } from './arpSchedule';`:
  ```ts
  /**
   * THE no-op guarantee. An old melody is every note len: 1 at gate 0.85, and
   * it must produce byte-identical LeadTrigger[] to the pre-DEV-369
   * implementation with the arp both on and off. If this passes, no existing
   * music changes sound — the entire risk budget of this change.
   */
  describe('no-op guarantee — an all-len-1 melody at gate 0.85', () => {
    const LEGACY_GATE = 0.85;
    const notes = ['C4', 'E4', 'G4'];
    const sounding = notes.map((note) => ({ note, len: 1, age: 0 }));

    test('block mode matches the retired `LEAD_GATE * stepDurSec` exactly', () => {
      const legacy = notes.map((note) => ({
        note,
        timeOffsetSec: 0,
        holdSec: LEGACY_GATE * STEP_DUR,
      }));
      expect(resolveLeadStepTriggers(sounding, false, 0, ARP_PARAMS, STEP_DUR, LEGACY_GATE)).toEqual(legacy);
    });

    test('arp mode matches buildArpSequence + computeArpTriggers unchanged', () => {
      for (const arpStep of [0, 1, 2, 3, 4, 7]) {
        const sequence = buildArpSequence(notes, ARP_PARAMS.arpMode, ARP_PARAMS.arpOctaves);
        const legacy = computeArpTriggers(arpStep, sequence.length, ARP_PARAMS.arpRate, STEP_DUR).map(
          (t) => ({ note: sequence[t.noteIndex], timeOffsetSec: t.timeOffsetSec, holdSec: t.holdSec }),
        );
        expect(resolveLeadStepTriggers(sounding, true, arpStep, ARP_PARAMS, STEP_DUR, LEGACY_GATE)).toEqual(legacy);
      }
    });
  });
  ```

- [ ] **Step 7: Run both blocks and watch them fail.**
  ```bash
  bun test src/audio/leadMelody.test.ts -t "resolveLeadStepTriggers"
  ```
  Expected failure: `TypeError: undefined is not an object (evaluating 'notes.length')` — the current signature's first parameter is `readonly string[]`, so `sounding` arrives where `notes` is expected and the extra `gate` argument is dropped.

- [ ] **Step 8: Rewrite `resolveLeadStepTriggers`.**
  ```ts
  /**
   * Resolve a step's SOUNDING notes into note-on/off triggers.
   *
   * arp OFF (block) → only notes starting here (age 0) fire, together, held
   * (len - 1 + gate) * stepDurSec: the gate trims the tail of the FINAL step
   * only, so length is duration and gate is articulation. Notes with age > 0
   * emit nothing — their note-off was scheduled at an absolute time when they
   * started, so Web Audio needs no cross-tick bookkeeping.
   *
   * arp ON → ALL sounding notes feed buildArpSequence + computeArpTriggers
   * (reused unchanged), including age > 0: a note's length means the same
   * thing in both modes, and a long note under an arp visibly asks to keep
   * feeding the arpeggio. `arpStep` must already be bar-phased by
   * arpStepFor(step, stepsPerBar).
   *
   * Known and accepted: the gate has no effect while the arp is on.
   * computeArpTriggers derives its own holdSec from arpRate, and multiplying
   * it by the gate would change the sound of every existing arp pattern the
   * moment this lands. The slider's tooltip says so.
   */
  export function resolveLeadStepTriggers(
    sounding: readonly LeadSounding[],
    arpActive: boolean,
    arpStep: number,
    params: { arpMode: ArpMode; arpRate: ArpRate; arpOctaves: number },
    stepDurSec: number,
    gate: number,
  ): LeadTrigger[] {
    if (sounding.length === 0) return [];
    if (!arpActive) {
      return sounding
        .filter((s) => s.age === 0)
        .map((s) => ({
          note: s.note,
          timeOffsetSec: 0,
          holdSec: (s.len - 1 + gate) * stepDurSec,
        }));
    }
    if (!arpFiresOnStep(arpStep, params.arpRate)) return [];
    const sequence = buildArpSequence(
      sounding.map((s) => s.note),
      params.arpMode,
      params.arpOctaves,
    );
    if (sequence.length === 0) return [];
    return computeArpTriggers(arpStep, sequence.length, params.arpRate, stepDurSec).map(
      (t) => ({
        note: sequence[t.noteIndex],
        timeOffsetSec: t.timeOffsetSec,
        holdSec: t.holdSec,
      }),
    );
  }
  ```

- [ ] **Step 9: Write the failing test for the shrink clamp.**
  In `src/audio/leadMelody.test.ts`, append to the existing `resizeLeadMelody` describe block (and change its existing two-argument calls to pass `16` as the third argument):
  ```ts
    test('clamps a note that would overhang the new loop end when shrinking', () => {
      const m: LeadNote[][] = [...Array.from({ length: 24 }, () => [] as LeadNote[]), ...Array.from({ length: 24 }, () => [] as LeadNote[])];
      m[14] = [{ note: 'C4', len: 6 }];
      const out = resizeLeadMelody(m, 1, 16);
      expect(out).toHaveLength(24);
      expect(out[14]).toEqual([{ note: 'C4', len: 2 }]);
    });

    test('leaves a note that still fits alone', () => {
      const m: LeadNote[][] = Array.from({ length: 24 }, () => [] as LeadNote[]);
      m[8] = [{ note: 'C4', len: 4 }];
      expect(resizeLeadMelody(m, 1, 16)[8]).toEqual([{ note: 'C4', len: 4 }]);
    });

    test('never clamps below 1', () => {
      const m: LeadNote[][] = Array.from({ length: 24 }, () => [] as LeadNote[]);
      m[15] = [{ note: 'C4', len: 8 }];
      expect(resizeLeadMelody(m, 1, 16)[15]).toEqual([{ note: 'C4', len: 1 }]);
    });
  ```

- [ ] **Step 10: Give `resizeLeadMelody` its clamp and its `stepsPerBar` argument.**
  ```ts
  /**
   * Resize the melody by whole bars: trim trailing bars, pad empty bars. Each
   * "bar" is MAX_STEPS_PER_BAR slots, so a loopLength change never drops steps
   * drawn in the bars that survive.
   *
   * Also clamps notes that now overhang the new loop end, so invariant 2
   * ("start + len never crosses the loop end") survives a loop-length change
   * as well as a write. `len` counts ACTIVE steps, which is why stepsPerBar is
   * needed here and the stored width alone is not enough.
   */
  export function resizeLeadMelody(
    steps: readonly LeadNote[][],
    newLoopLength: number,
    stepsPerBar: number,
  ): LeadNote[][] {
    const targetLen = newLoopLength * MAX_STEPS_PER_BAR;
    const loopEnd = newLoopLength * stepsPerBar;
    const out: LeadNote[][] = [];
    for (let i = 0; i < targetLen; i++) {
      const row = steps[i];
      if (!row) {
        out.push([]);
        continue;
      }
      const barIndex = Math.floor(i / MAX_STEPS_PER_BAR);
      const activePos = barIndex * stepsPerBar + (i - barIndex * MAX_STEPS_PER_BAR);
      const maxLen = Math.max(1, loopEnd - activePos);
      out.push(row.map((n) => ({ note: n.note, len: Math.min(n.len, maxLen) })));
    }
    return out;
  }
  ```
  In `src/store/leadSlice.ts`, add `getMeter` to the `from '../utils/meter'` import and pass it:
  ```ts
      setLeadLoopLength: (leadLoopLength) =>
        set((state) => ({
          leadLoopLength,
          leadMelodySteps: resizeLeadMelody(
            state.leadMelodySteps,
            leadLoopLength,
            getMeter(state.meterId).stepsPerBar,
          ),
        })),
  ```

- [ ] **Step 11: Wire the playback hook.**
  In `src/components/loop/lead/useLeadPlayback.ts`, the import becomes
  `import { leadSoundingNotes, resolveLeadStepTriggers } from '../../../audio/leadMelody';`
  and the block at `:106-121` becomes:
  ```ts
        const sounding = leadSoundingNotes(s.leadMelodySteps, stepInLoop, stepsPerBar);
        const stepDur = stepDurationSec(s.bpm);
        const arpStep = arpStepFor(step, stepsPerBar);
        const triggers = resolveLeadStepTriggers(
          sounding,
          s.synthParams.arpActive,
          arpStep,
          s.synthParams,
          stepDur,
          s.leadGate,
        );
  ```
  `playbackNoteOn` / `playbackNoteOff` below are untouched: Web Audio schedules at absolute times, so a four-step note simply gets its note-off at `time + 3.85 * stepDur`.

- [ ] **Step 12: Write the failing test that `leadGate` reaches the triggers.**
  Append to `src/components/loop/lead/useLeadPlayback.test.ts` (the file already imports `readFileSync` and `join` and reads its own source in the `HARD_STOP_RELEASE` test):
  ```ts
  describe('useLeadPlayback feeds the loop gate and the sounding notes into the scheduler', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/loop/lead/useLeadPlayback.ts'),
      'utf8',
    );

    test('reads leadGate live from the store inside the clock callback', () => {
      expect(source).toContain('s.leadGate');
    });

    test('resolves triggers from leadSoundingNotes, not a step note set', () => {
      expect(source).toContain('leadSoundingNotes(s.leadMelodySteps, stepInLoop, stepsPerBar)');
      expect(source).not.toContain('leadStepNotes');
    });
  });
  ```

- [ ] **Step 13: Run the whole suite and watch it pass.**
  ```bash
  bun test && bun run lint && bun run eslint
  ```
  Everything is green, including the no-op guarantee. `leadStepNotes` no longer exists anywhere:
  ```bash
  grep -rn "leadStepNotes\|LEAD_GATE\b" src
  ```
  returns only `DEFAULT_LEAD_GATE` matches.

- [ ] **Step 14: Commit.**
  ```bash
  git add src/audio/leadMelody.ts src/store/leadSlice.ts src/components/loop/lead/useLeadPlayback.ts src/audio/leadMelody.test.ts src/components/loop/lead/useLeadPlayback.test.ts
  git commit -m "$(cat <<'EOF'
  feat(lead): schedule notes by length and per-loop gate (DEV-369)

  leadStepNotes becomes leadSoundingNotes, returning LeadSounding { note, len,
  age } from a stateless backward scan that stops at loop step 0 (safe because
  no note wraps the boundary). Block mode keeps age 0 and holds
  (len - 1 + gate) * stepDurSec; arp mode passes ALL sounding notes into the
  unchanged arp pool. resizeLeadMelody clamps notes overhanging a shrunk loop.

  Carries the no-op guarantee: an all-len-1 melody at gate 0.85 produces
  byte-identical LeadTrigger[] to the previous implementation, arp on and off.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 7: `setLeadNoteLength` and a length-aware `toggleLeadNote`

The two slice actions that write note lengths, and the single place all three invariants are enforced.

`toggleLeadNote` can violate invariant 1 by a very ordinary action once notes have length: a note `{ note: 'C4', len: 4 }` stored at index 0 renders as filled cells at steps 0-3, but `melody[2]` is **empty** — the note lives at its start index — so the Task 2 implementation would append a *second* `C4` at step 2 and leave two overlapping notes in one row. It therefore becomes covered-aware: a click on a covered cell removes the **covering** note, deleting it from the index where it starts.

That rule follows from what the cell already promises. A covered cell renders filled and carries `aria-pressed="true"`, so a click must switch it off — sighted users and screen-reader users get the same result. The DAW-like alternative (truncate the covering note at the click point and create a new note there) is rejected: one click producing two notes is harder to explain than one click removing one note, and nothing in DEV-369 asks for it.

**Files:**
- Modify: `src/store/types.ts` (`LeadSlice`: the new `setLeadNoteLength` action)
- Modify: `src/store/leadSlice.ts` (`setLeadNoteLength` after `toggleLeadNote`; then `toggleLeadNote` itself)
- Modify: `src/audio/leadMelody.ts` (`leadStoredIndexAt` + `leadCoveringNoteIndex`, beside `leadSoundingNotes`)
- Test: `src/store/leadSlice.test.ts`, `src/audio/leadMelody.test.ts`

**Interfaces:**
- Consumes: `LeadNote` (Task 1); `leadSoundingNotes(steps: readonly LeadNote[][], stepInLoop: number, stepsPerBar: number): LeadSounding[]` and `LeadSounding { note: string; len: number; age: number }` (Task 6); `leadMelodySteps: LeadNote[][]`, `leadLoopLength: number`, `meterId` on the store; `getMeter(id).stepsPerBar` from `src/utils/meter.ts`; `MAX_STEPS_PER_BAR`.
- Produces:
  ```ts
  // src/store/types.ts — LeadSlice
  setLeadNoteLength: (stepIndex: number, note: string, len: number) => void;
  // src/audio/leadMelody.ts
  export function leadStoredIndexAt(stepInLoop: number, stepsPerBar: number): number
  export function leadCoveringNoteIndex(
    steps: readonly LeadNote[][],
    stepInLoop: number,
    stepsPerBar: number,
    note: string,
  ): number
  ```
  `stepIndex` on both slice actions is the **stored** index (`barIndex * MAX_STEPS_PER_BAR + stepInBar`, i.e. what `leadStoredIndex` returns); `len` is in **active** steps. A `stepIndex`/`note` pair that names no drawn note is a no-op for `setLeadNoteLength`.

  `leadStoredIndexAt` is the loop-step → stored-index arithmetic `leadSoundingNotes` already does inline, factored out so there is one copy. `leadCoveringNoteIndex` returns the **stored index of the note of pitch `note` sounding at `stepInLoop`**, or `-1` when none is — implemented *through* `leadSoundingNotes` rather than as a second backward scan, so the two can never disagree about what "covered" means. `toggleLeadNote`'s signature is unchanged: `(stepIndex: number, note: string) => void`.

**Steps:**

- [ ] **Step 1: Write the failing tests for all three invariants.**
  Append to `src/store/leadSlice.test.ts`:
  ```ts
  describe('setLeadNoteLength — invariant 1: same-row overlap swallows', () => {
    beforeEach(resetLead);

    test('extending over a note on the same pitch row removes the covered note', () => {
      const s = useAppStore.getState();
      s.toggleLeadNote(0, 'C4');
      s.toggleLeadNote(2, 'C4');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 4);

      const melody = useAppStore.getState().leadMelodySteps;
      expect(melody[0]).toEqual([{ note: 'C4', len: 4 }]);
      expect(melody[2]).toEqual([]);
    });

    test('a note on a DIFFERENT pitch row inside the span survives', () => {
      const s = useAppStore.getState();
      s.toggleLeadNote(0, 'C4');
      s.toggleLeadNote(2, 'G4');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 4);

      const melody = useAppStore.getState().leadMelodySteps;
      expect(melody[0]).toEqual([{ note: 'C4', len: 4 }]);
      expect(melody[2]).toEqual([{ note: 'G4', len: 1 }]);
    });

    test('shrinking a note leaves the steps it no longer covers empty', () => {
      const s = useAppStore.getState();
      s.toggleLeadNote(0, 'C4');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
      useAppStore.getState().setLeadNoteLength(0, 'C4', 1);

      const melody = useAppStore.getState().leadMelodySteps;
      expect(melody[0]).toEqual([{ note: 'C4', len: 1 }]);
      expect(melody[1]).toEqual([]);
      expect(melody[3]).toEqual([]);
    });
  });

  describe('setLeadNoteLength — invariant 2: never crosses the loop end', () => {
    beforeEach(resetLead);

    test('a length that would overhang is clamped on write', () => {
      // 4/4, 1 bar: the loop ends at active step 16, so a note at step 14 caps at 2.
      useAppStore.getState().toggleLeadNote(14, 'C4');
      useAppStore.getState().setLeadNoteLength(14, 'C4', 6);
      expect(useAppStore.getState().leadMelodySteps[14]).toEqual([{ note: 'C4', len: 2 }]);
    });

    test('the last step of the loop caps at 1', () => {
      useAppStore.getState().toggleLeadNote(15, 'C4');
      useAppStore.getState().setLeadNoteLength(15, 'C4', 9);
      expect(useAppStore.getState().leadMelodySteps[15]).toEqual([{ note: 'C4', len: 1 }]);
    });

    test('a two-bar loop lets a note cross the bar line', () => {
      useAppStore.setState({ leadLoopLength: 2 });
      useAppStore.getState().toggleLeadNote(15, 'C4');
      useAppStore.getState().setLeadNoteLength(15, 'C4', 4);
      expect(useAppStore.getState().leadMelodySteps[15]).toEqual([{ note: 'C4', len: 4 }]);
    });
  });

  describe('setLeadNoteLength — invariant 3: len is an integer >= 1', () => {
    beforeEach(resetLead);

    test('zero and negative lengths clamp to 1', () => {
      useAppStore.getState().toggleLeadNote(0, 'C4');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 0);
      expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
      useAppStore.getState().setLeadNoteLength(0, 'C4', -5);
      expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 1 }]);
    });

    test('a fractional length rounds', () => {
      useAppStore.getState().toggleLeadNote(0, 'C4');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 2.6);
      expect(useAppStore.getState().leadMelodySteps[0]).toEqual([{ note: 'C4', len: 3 }]);
    });

    test('a step/note pair that names no drawn note is a no-op', () => {
      const before = useAppStore.getState().leadMelodySteps;
      useAppStore.getState().setLeadNoteLength(4, 'A4', 3);
      expect(useAppStore.getState().leadMelodySteps).toBe(before);
    });
  });
  ```

- [ ] **Step 2: Run the tests and watch them fail.**
  ```bash
  bun test src/store/leadSlice.test.ts -t "setLeadNoteLength"
  ```
  Expected failure: `TypeError: useAppStore.getState().setLeadNoteLength is not a function`.

- [ ] **Step 3: Declare the action in `LeadSlice`.**
  In `src/store/types.ts`, after `toggleLeadNote`:
  ```ts
    /**
     * Set a drawn note's length. `stepIndex` is the STORED index; `len` counts
     * ACTIVE steps. The one place the three length invariants are enforced.
     */
    setLeadNoteLength: (stepIndex: number, note: string, len: number) => void;
  ```

- [ ] **Step 4: Implement the action.**
  In `src/store/leadSlice.ts`, after `toggleLeadNote` (with `getMeter` already imported from `'../utils/meter'` by Task 6):
  ```ts
      // All three invariants live here, never at a call site — a call site that
      // can violate an invariant is a call site that eventually will.
      //   1. Same-row overlap SWALLOWS the covered note (what Ableton and Logic
      //      do; anything else makes a drag either silently fail or need a modal).
      //      Only forward, from this note's start: the spec's rule is about
      //      EXTENDING over a note, so notes that start earlier keep their length.
      //   2. start + len never crosses the loop end — clamped on write, so notes
      //      never wrap and leadSoundingNotes can stop its scan at step 0.
      //   3. len is an integer >= 1.
      setLeadNoteLength: (stepIndex, note, len) =>
        set((state) => {
          const row = state.leadMelodySteps[stepIndex];
          if (!row || !row.some((n) => n.note === note)) return {};

          const stepsPerBar = getMeter(state.meterId).stepsPerBar;
          const barIndex = Math.floor(stepIndex / MAX_STEPS_PER_BAR);
          const activePos = barIndex * stepsPerBar + (stepIndex - barIndex * MAX_STEPS_PER_BAR);
          const maxLen = Math.max(1, state.leadLoopLength * stepsPerBar - activePos);
          const nextLen = Math.min(maxLen, Math.max(1, Math.round(len)));

          const next = [...state.leadMelodySteps];
          next[stepIndex] = row.map((n) => (n.note === note ? { note, len: nextLen } : n));
          for (let k = 1; k < nextLen; k++) {
            const at = activePos + k;
            const bar = Math.floor(at / stepsPerBar);
            const idx = bar * MAX_STEPS_PER_BAR + (at - bar * stepsPerBar);
            const covered = next[idx];
            if (covered?.some((n) => n.note === note)) {
              next[idx] = covered.filter((n) => n.note !== note);
            }
          }
          return { leadMelodySteps: next };
        }),
  ```

- [ ] **Step 5: Run the tests and watch them pass.**
  ```bash
  bun test src/store/leadSlice.test.ts && bun run lint
  ```

- [ ] **Step 6: Write the failing tests for the covering-note lookup.**
  Append to `src/audio/leadMelody.test.ts`, adding `leadCoveringNoteIndex` and `leadStoredIndexAt` to the `from './leadMelody'` import (`oneBar()` is already defined in the file by Task 6):
  ```ts
  describe('leadStoredIndexAt', () => {
    test('maps a loop step to its stored slot through the per-bar window', () => {
      expect(leadStoredIndexAt(0, 16)).toBe(0);
      expect(leadStoredIndexAt(15, 16)).toBe(15);
      expect(leadStoredIndexAt(16, 16)).toBe(24);
      expect(leadStoredIndexAt(12, 12)).toBe(24);
    });
  });

  describe('leadCoveringNoteIndex', () => {
    test('returns the START index of a note covering a step in its middle', () => {
      const m = oneBar();
      m[0] = [{ note: 'C4', len: 4 }];
      expect(leadCoveringNoteIndex(m, 0, 16, 'C4')).toBe(0);
      expect(leadCoveringNoteIndex(m, 2, 16, 'C4')).toBe(0);
      expect(leadCoveringNoteIndex(m, 3, 16, 'C4')).toBe(0);
    });

    test('returns -1 one step past the note and for an empty step', () => {
      const m = oneBar();
      m[0] = [{ note: 'C4', len: 4 }];
      expect(leadCoveringNoteIndex(m, 4, 16, 'C4')).toBe(-1);
      expect(leadCoveringNoteIndex(m, 9, 16, 'C4')).toBe(-1);
    });

    test('is per pitch row — another pitch inside the span is not covered', () => {
      const m = oneBar();
      m[0] = [{ note: 'C4', len: 4 }];
      expect(leadCoveringNoteIndex(m, 2, 16, 'G4')).toBe(-1);
    });

    test('finds a note that started in the previous bar', () => {
      const m = [...oneBar(), ...oneBar()];
      m[15] = [{ note: 'A4', len: 3 }];
      expect(leadCoveringNoteIndex(m, 17, 16, 'A4')).toBe(15);
    });
  });
  ```

- [ ] **Step 7: Write the failing tests for a covered-cell click.**
  Append to `src/store/leadSlice.test.ts`:
  ```ts
  describe('toggleLeadNote — a click on a covered cell removes the covering note', () => {
    beforeEach(resetLead);

    test('clicking the MIDDLE of a long note removes it entirely', () => {
      useAppStore.getState().toggleLeadNote(0, 'C4');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
      useAppStore.getState().toggleLeadNote(2, 'C4');

      const melody = useAppStore.getState().leadMelodySteps;
      expect(melody[0]).toEqual([]);
      expect(melody[2]).toEqual([]);
    });

    test('clicking the START step of a long note removes it entirely', () => {
      useAppStore.getState().toggleLeadNote(0, 'C4');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
      useAppStore.getState().toggleLeadNote(0, 'C4');
      expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
    });

    test('clicking the LAST step of a long note removes it entirely', () => {
      useAppStore.getState().toggleLeadNote(0, 'C4');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
      useAppStore.getState().toggleLeadNote(3, 'C4');
      expect(useAppStore.getState().leadMelodySteps[0]).toEqual([]);
    });

    test('a covered click leaves notes in OTHER pitch rows untouched', () => {
      useAppStore.getState().toggleLeadNote(0, 'C4');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
      useAppStore.getState().toggleLeadNote(2, 'G4');
      useAppStore.getState().toggleLeadNote(2, 'C4');

      const melody = useAppStore.getState().leadMelodySteps;
      expect(melody[0]).toEqual([]);
      expect(melody[2]).toEqual([{ note: 'G4', len: 1 }]);
    });

    test('clicking an UNCOVERED cell still creates a one-step note', () => {
      useAppStore.getState().toggleLeadNote(0, 'C4');
      useAppStore.getState().setLeadNoteLength(0, 'C4', 4);
      useAppStore.getState().toggleLeadNote(4, 'C4');

      const melody = useAppStore.getState().leadMelodySteps;
      expect(melody[0]).toEqual([{ note: 'C4', len: 4 }]);
      expect(melody[4]).toEqual([{ note: 'C4', len: 1 }]);
    });

    test('a note held across the bar line is removed from its start index', () => {
      useAppStore.setState({ leadLoopLength: 2 });
      useAppStore.getState().toggleLeadNote(15, 'C4');
      useAppStore.getState().setLeadNoteLength(15, 'C4', 4);
      // Loop step 17 is bar 1 step 1 -> stored 25, but the note lives at 15.
      useAppStore.getState().toggleLeadNote(25, 'C4');
      expect(useAppStore.getState().leadMelodySteps[15]).toEqual([]);
    });
  });
  ```

- [ ] **Step 8: Run both blocks and watch them fail.**
  ```bash
  bun test src/audio/leadMelody.test.ts -t "leadCoveringNoteIndex"
  bun test src/store/leadSlice.test.ts -t "covered cell"
  ```
  Expected failures: `SyntaxError: Export named 'leadCoveringNoteIndex' not found in module '.../src/audio/leadMelody.ts'`, and in the slice block `expect(received).toEqual(expected)` — `melody[0]` is still `[ { note: "C4", len: 4 } ]` and `melody[2]` has picked up a second, overlapping `{ note: "C4", len: 1 }`.

- [ ] **Step 9: Factor the index arithmetic and add the covering-note lookup.**
  In `src/audio/leadMelody.ts`, insert `leadStoredIndexAt` immediately before `leadSoundingNotes`, rewrite that function's two arithmetic lines to call it, and add `leadCoveringNoteIndex` immediately after it:
  ```ts
  /**
   * The stored slot for a loop step. The melody is stored at a fixed
   * MAX_STEPS_PER_BAR width per bar and windowed to the ACTIVE stepsPerBar, so
   * this is the one place that conversion lives.
   */
  export function leadStoredIndexAt(stepInLoop: number, stepsPerBar: number): number {
    const barIndex = Math.floor(stepInLoop / stepsPerBar);
    return barIndex * MAX_STEPS_PER_BAR + (stepInLoop - barIndex * stepsPerBar);
  }
  ```
  Inside `leadSoundingNotes`, the four lines computing `at` / `barIndex` / `idx` / `row` collapse to one (`at` has no other use):
  ```ts
      const row = steps[leadStoredIndexAt(stepInLoop - age, stepsPerBar)];
  ```
  Then, after `leadSoundingNotes`:
  ```ts
  /**
   * The STORED index of the note of pitch `note` sounding at `stepInLoop`, or
   * -1 when that pitch is not sounding there. Deliberately implemented THROUGH
   * leadSoundingNotes rather than as a second backward scan: "covered" must
   * mean exactly the same thing to the scheduler and to a mouse click, and two
   * copies of the scan would eventually disagree.
   */
  export function leadCoveringNoteIndex(
    steps: readonly LeadNote[][],
    stepInLoop: number,
    stepsPerBar: number,
    note: string,
  ): number {
    const covering = leadSoundingNotes(steps, stepInLoop, stepsPerBar).find((s) => s.note === note);
    if (!covering) return -1;
    return leadStoredIndexAt(stepInLoop - covering.age, stepsPerBar);
  }
  ```

- [ ] **Step 10: Make `toggleLeadNote` covered-aware.**
  In `src/store/leadSlice.ts`, add `leadCoveringNoteIndex` to the `from '../audio/leadMelody'` import and replace `toggleLeadNote` with:
  ```ts
      // Invariant 1 again, from the other direction. Once notes have length,
      // melody[stepIndex] is NOT "is this cell filled": a len-4 note at step 0
      // fills steps 0-3 while rows 1-3 are empty, so an unguarded append would
      // put a second C4 inside the first one. A covered cell renders filled and
      // carries aria-pressed="true", so a click must switch it off — and the
      // note is deleted from the index where it STARTS, not where it was
      // clicked. (Rejected: truncating the covering note and creating a new one
      // at the click point. More DAW-like, but one click producing two notes is
      // harder to explain, and nothing in DEV-369 asks for it.)
      toggleLeadNote: (stepIndex, note) =>
        set((state) => {
          const stepsPerBar = getMeter(state.meterId).stepsPerBar;
          const barIndex = Math.floor(stepIndex / MAX_STEPS_PER_BAR);
          const stepInLoop = barIndex * stepsPerBar + (stepIndex - barIndex * MAX_STEPS_PER_BAR);
          const coveringIdx = leadCoveringNoteIndex(
            state.leadMelodySteps,
            stepInLoop,
            stepsPerBar,
            note,
          );
          const target = coveringIdx >= 0 ? coveringIdx : stepIndex;
          return {
            leadMelodySteps: state.leadMelodySteps.map((r, i) => {
              if (i !== target) return r;
              return coveringIdx >= 0 ? r.filter((n) => n.note !== note) : [...r, { note, len: 1 }];
            }),
          };
        }),
  ```

- [ ] **Step 11: Run the whole suite and watch it pass.**
  ```bash
  bun test && bun run lint && bun run eslint
  ```
  Task 2's `toggleLeadNote` tests still pass unchanged — with every note `len: 1`, the covering note of a filled cell *is* the note at that index, so the new path reduces to the old one. Task 6's `leadSoundingNotes` tests still pass too, which is what proves the `leadStoredIndexAt` extraction was behaviour-identical.

- [ ] **Step 12: Commit.**
  ```bash
  git add src/store/types.ts src/store/leadSlice.ts src/audio/leadMelody.ts src/store/leadSlice.test.ts src/audio/leadMelody.test.ts
  git commit -m "$(cat <<'EOF'
  feat(lead): enforce the note-length invariants in both lead slice writers (DEV-369)

  setLeadNoteLength is the single place a length is written: same-row overlap
  swallows the covered note, start + len is clamped to the loop end, and len is
  rounded to an integer >= 1.

  toggleLeadNote becomes covered-aware, because it could break the same overlap
  invariant by an ordinary click: melody[stepIndex] is empty for the middle of a
  long note, so an unguarded append would nest a second note inside the first.
  A click on any covered cell now removes the covering note from the index where
  it starts, which is what the cell's aria-pressed="true" already promises.
  The lookup runs through leadSoundingNotes via the new leadCoveringNoteIndex,
  so the scheduler and a mouse click cannot disagree about "covered".

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 8: The pure grid functions

Pushing the cell classification and the drag arithmetic into `melodyGrid.ts` is what makes both testable without a DOM — the drag gesture itself can never get a `renderToString` test.

**Files:**
- Modify: `src/components/loop/lead/melodyGrid.ts` (append after `leadStoredIndex`)
- Test: `src/components/loop/lead/melodyGrid.test.ts`

**Interfaces:**
- Consumes: `LeadNote` (Task 1); `leadStoredIndex(barIndex: number, stepInBar: number): number` and `LEAD_CELL_WIDTH` (existing, same file).
- Produces:
  ```ts
  export type LeadCellKind = 'none' | 'start' | 'body' | 'end';
  export function leadCellKinds(
    melody: readonly LeadNote[][],
    rows: readonly string[],
    columns: number,
    stepsPerBar: number,
  ): Map<string, LeadCellKind[]>
  export function leadResizeLen(
    startLen: number,
    dxPx: number,
    cellWidth: number,
    maxLen: number,
  ): number
  ```
  The map is keyed by pitch-row note name, one `LeadCellKind` per column, so the render is a lookup rather than a search. **A one-step note is a lone `'start'`** — `'end'` only appears when the span is longer than one cell, so the renderer rounds a cell's right corners when its kind is `'end'` *or* when it is `'start'` and the next cell is neither `'body'` nor `'end'`. Task 9 depends on exactly that rule.

**Steps:**

- [ ] **Step 1: Write the failing tests for `leadCellKinds`.**
  Append to `src/components/loop/lead/melodyGrid.test.ts`, importing `leadCellKinds, leadResizeLen, type LeadCellKind` from `'./melodyGrid'` and `type LeadNote` from `'../../../audio/leadMelody'`:
  ```ts
  const emptyBar = (): LeadNote[][] => Array.from({ length: 24 }, () => [] as LeadNote[]);

  describe('leadCellKinds', () => {
    test('a one-step note is a lone start', () => {
      const m = emptyBar();
      m[0] = [{ note: 'C4', len: 1 }];
      const kinds = leadCellKinds(m, ['C4'], 4, 16);
      expect(kinds.get('C4')).toEqual(['start', 'none', 'none', 'none']);
    });

    test('a two-step note is start then end, with no body', () => {
      const m = emptyBar();
      m[0] = [{ note: 'C4', len: 2 }];
      expect(leadCellKinds(m, ['C4'], 4, 16).get('C4')).toEqual(['start', 'end', 'none', 'none']);
    });

    test('a three-step note is start, body, end', () => {
      const m = emptyBar();
      m[1] = [{ note: 'C4', len: 3 }];
      expect(leadCellKinds(m, ['C4'], 5, 16).get('C4')).toEqual([
        'none', 'start', 'body', 'end', 'none',
      ]);
    });

    test('two notes in one pitch row are painted independently', () => {
      const m = emptyBar();
      m[0] = [{ note: 'C4', len: 2 }];
      m[3] = [{ note: 'C4', len: 1 }];
      expect(leadCellKinds(m, ['C4'], 5, 16).get('C4')).toEqual([
        'start', 'end', 'none', 'start', 'none',
      ]);
    });

    test('a note crossing the bar boundary spans into the next bar', () => {
      const m: LeadNote[][] = [...emptyBar(), ...emptyBar()];
      m[15] = [{ note: 'C4', len: 3 }];
      const kinds = leadCellKinds(m, ['C4'], 32, 16) as Map<string, LeadCellKind[]>;
      expect(kinds.get('C4')?.slice(14, 19)).toEqual(['none', 'start', 'body', 'end', 'none']);
    });

    test('a span running past the last column is truncated, not wrapped', () => {
      const m = emptyBar();
      m[14] = [{ note: 'C4', len: 6 }];
      expect(leadCellKinds(m, ['C4'], 16, 16).get('C4')?.slice(13)).toEqual([
        'none', 'start', 'end',
      ]);
    });

    test('every requested row gets an entry, all none when nothing is drawn', () => {
      const kinds = leadCellKinds(emptyBar(), ['C4', 'E4'], 3, 16);
      expect(kinds.get('E4')).toEqual(['none', 'none', 'none']);
      expect([...kinds.keys()]).toEqual(['C4', 'E4']);
    });

    test('a note whose pitch row is outside the visible window is ignored', () => {
      const m = emptyBar();
      m[0] = [{ note: 'C7', len: 2 }];
      const kinds = leadCellKinds(m, ['C4'], 3, 16);
      expect(kinds.get('C4')).toEqual(['none', 'none', 'none']);
      expect(kinds.has('C7')).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Write the failing tests for `leadResizeLen`.**
  Append to the same file:
  ```ts
  describe('leadResizeLen', () => {
    test('rounds the drag distance to the nearest whole cell', () => {
      expect(leadResizeLen(1, 0, 20, 16)).toBe(1);
      expect(leadResizeLen(1, 9, 20, 16)).toBe(1);
      expect(leadResizeLen(1, 10, 20, 16)).toBe(2);
      expect(leadResizeLen(1, 31, 20, 16)).toBe(3);
      expect(leadResizeLen(2, -21, 20, 16)).toBe(1);
    });

    test('clamps to 1 at the bottom, however far left the drag goes', () => {
      expect(leadResizeLen(3, -400, 20, 16)).toBe(1);
    });

    test('clamps to maxLen at the top, however far right the drag goes', () => {
      expect(leadResizeLen(3, 4000, 20, 16)).toBe(16);
      expect(leadResizeLen(1, 100, 20, 2)).toBe(2);
    });

    test('a maxLen below 1 still yields 1', () => {
      expect(leadResizeLen(1, 100, 20, 0)).toBe(1);
    });
  });
  ```

- [ ] **Step 3: Run both blocks and watch them fail.**
  ```bash
  bun test src/components/loop/lead/melodyGrid.test.ts
  ```
  Expected failure: `SyntaxError: Export named 'leadCellKinds' not found in module '.../src/components/loop/lead/melodyGrid.ts'`.

- [ ] **Step 4: Implement both functions.**
  Append to `src/components/loop/lead/melodyGrid.ts`, with `import type { LeadNote } from '../../../audio/leadMelody';` added at the top:
  ```ts
  /**
   * How one grid cell renders inside a note's span. A ONE-step note is a lone
   * 'start' — 'end' only appears when the span is longer than one cell — so the
   * renderer rounds a cell's right corners when its kind is 'end' OR when it is
   * 'start' and the next cell is neither 'body' nor 'end'.
   */
  export type LeadCellKind = 'none' | 'start' | 'body' | 'end';

  /**
   * One LeadCellKind per column for every visible pitch row, keyed by note
   * name, so the render is a map lookup rather than a per-cell backward search.
   * Computed in a single pass over the note data — walk each note once and
   * paint its span — so the cost stays linear in notes, not in cells.
   *
   * `columns` is the ACTIVE window (loopLength x stepsPerBar); a span running
   * past the last column is truncated, never wrapped, which matches invariant 2.
   */
  export function leadCellKinds(
    melody: readonly LeadNote[][],
    rows: readonly string[],
    columns: number,
    stepsPerBar: number,
  ): Map<string, LeadCellKind[]> {
    const map = new Map<string, LeadCellKind[]>();
    for (const note of rows) {
      map.set(note, new Array<LeadCellKind>(columns).fill('none'));
    }
    for (let col = 0; col < columns; col++) {
      const barIndex = Math.floor(col / stepsPerBar);
      const row = melody[leadStoredIndex(barIndex, col - barIndex * stepsPerBar)];
      if (!row) continue;
      for (const n of row) {
        const kinds = map.get(n.note);
        if (!kinds) continue;
        const span = Math.min(Math.max(1, n.len), columns - col);
        for (let k = 0; k < span; k++) {
          kinds[col + k] = k === 0 ? 'start' : k === span - 1 ? 'end' : 'body';
        }
      }
    }
    return map;
  }

  /**
   * The drag arithmetic, kept pure and out of the pointer handlers: the gesture
   * itself can never be tested (renderToString has no DOM), so everything that
   * can be a function is one. `maxLen` derives from the loop end ONLY, never
   * from the next note's position, because extending swallows (invariant 1).
   */
  export function leadResizeLen(
    startLen: number,
    dxPx: number,
    cellWidth: number,
    maxLen: number,
  ): number {
    const raw = startLen + Math.round(dxPx / cellWidth);
    return Math.min(Math.max(1, maxLen), Math.max(1, raw));
  }
  ```

- [ ] **Step 5: Run the tests and watch them pass.**
  ```bash
  bun test src/components/loop/lead/melodyGrid.test.ts && bun run lint
  ```

- [ ] **Step 6: Commit.**
  ```bash
  git add src/components/loop/lead/melodyGrid.ts src/components/loop/lead/melodyGrid.test.ts
  git commit -m "$(cat <<'EOF'
  feat(lead): add leadCellKinds and leadResizeLen to melodyGrid (DEV-369)

  The span classification and the drag arithmetic live as pure functions beside
  leadStoredIndex, computed in a single pass over the notes so the render cost
  stays linear in notes rather than cells. This is the placement that makes the
  behaviour testable at all — the drag gesture can never get a DOM test.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 9: Render long notes as one continuous bar

One `<button>` per cell, styled into a bar. Per-cell buttons keep `aria-pressed`, focus order and hit targets for free; absolutely-positioned note `div`s would mean rebuilding the accessibility layer commit `0a9b4d3` just hardened.

**Files:**
- Modify: `src/components/loop/lead/melodyGrid.ts` (append `leadSpanClasses` after `leadResizeLen`)
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx:43-105` (`LeadMelodyCells`)
- Test: `src/components/loop/lead/melodyGrid.test.ts`, `src/components/loop/lead/LeadMelodyGrid.test.tsx`

**Interfaces:**
- Consumes: `leadCellKinds(melody, rows, columns, stepsPerBar): Map<string, LeadCellKind[]>`, `LeadCellKind` (Task 8); `LeadNote` (Task 1).
- Produces:
  ```ts
  // src/components/loop/lead/melodyGrid.ts
  export function leadSpanClasses(kind: LeadCellKind, next: LeadCellKind): string
  ```
  Returns `''` for `'none'`. Otherwise `bg-primary text-primary-content`, plus `rounded-l-sm` on `'start'` or `border-l-0` on `'body'`/`'end'`, plus `rounded-r-sm` when the cell ends the span — which is `kind === 'end'`, or `kind === 'start'` with a `next` that is neither `'body'` nor `'end'` (the one-step-note case).

**Steps:**

- [ ] **Step 1: Write the failing tests for `leadSpanClasses`.**
  Append to `src/components/loop/lead/melodyGrid.test.ts`, adding `leadSpanClasses` to the `from './melodyGrid'` import:
  ```ts
  describe('leadSpanClasses', () => {
    test('an empty cell gets no span classes at all', () => {
      expect(leadSpanClasses('none', 'none')).toBe('');
      expect(leadSpanClasses('none', 'start')).toBe('');
    });

    test('a one-step note rounds BOTH sides', () => {
      expect(leadSpanClasses('start', 'none')).toBe(
        'bg-primary text-primary-content rounded-l-sm rounded-r-sm',
      );
      expect(leadSpanClasses('start', 'start')).toBe(
        'bg-primary text-primary-content rounded-l-sm rounded-r-sm',
      );
    });

    test('the start of a longer span rounds only its left corners', () => {
      expect(leadSpanClasses('start', 'body')).toBe('bg-primary text-primary-content rounded-l-sm');
      expect(leadSpanClasses('start', 'end')).toBe('bg-primary text-primary-content rounded-l-sm');
    });

    test('a body cell drops its left border and rounds nothing', () => {
      expect(leadSpanClasses('body', 'end')).toBe('bg-primary text-primary-content border-l-0');
    });

    test('an end cell drops its left border and rounds its right corners', () => {
      expect(leadSpanClasses('end', 'none')).toBe(
        'bg-primary text-primary-content border-l-0 rounded-r-sm',
      );
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/components/loop/lead/melodyGrid.test.ts -t "leadSpanClasses"
  ```
  Expected failure: `SyntaxError: Export named 'leadSpanClasses' not found in module '.../src/components/loop/lead/melodyGrid.ts'`.

- [ ] **Step 3: Implement `leadSpanClasses`.**
  Append to `src/components/loop/lead/melodyGrid.ts`:
  ```ts
  /**
   * The classes that turn a run of per-cell buttons into one continuous bar:
   * the start rounds its left corners, body and end drop their left border
   * (box-sizing is border-box, so the cell keeps its column width and the
   * background stays continuous), and the last cell of the span rounds its
   * right corners. A one-step note is a lone 'start', so it is also the end of
   * its span — hence the `next` argument.
   */
  export function leadSpanClasses(kind: LeadCellKind, next: LeadCellKind): string {
    if (kind === 'none') return '';
    const parts = ['bg-primary text-primary-content'];
    parts.push(kind === 'start' ? 'rounded-l-sm' : 'border-l-0');
    const endsSpan = kind === 'end' || (kind === 'start' && next !== 'body' && next !== 'end');
    if (endsSpan) parts.push('rounded-r-sm');
    return parts.join(' ');
  }
  ```

- [ ] **Step 4: Run the test and watch it pass.**
  ```bash
  bun test src/components/loop/lead/melodyGrid.test.ts -t "leadSpanClasses"
  ```

- [ ] **Step 5: Rewrite `LeadMelodyCells` to consume the map.**
  In `src/components/loop/lead/LeadMelodyGrid.tsx`, add `leadCellKinds, leadSpanClasses` to the `from './melodyGrid'` import and replace the component body:
  ```tsx
  const LeadMelodyCells = React.memo(function LeadMelodyCells({
    meter,
    loopLength,
    melody,
    rows,
    root,
    onToggle,
  }: {
    meter: Meter;
    loopLength: number;
    melody: readonly LeadNote[][];
    rows: readonly string[];
    root: string;
    onToggle: (stepIndex: number, note: string) => void;
  }) {
    const stepsPerBar = meter.stepsPerBar;
    const columns = loopLength * stepsPerBar;
    const cellsPerBar = stepCells(meter);
    // One pass over the notes, not a per-cell backward search.
    const kinds = useMemo(
      () => leadCellKinds(melody, rows, columns, stepsPerBar),
      [melody, rows, columns, stepsPerBar],
    );

    return (
      <div
        className="grid shrink-0"
        style={{ gridTemplateColumns: `repeat(${columns}, ${LEAD_CELL_WIDTH}px)` }}
      >
        {rows.map((note) => {
          const rowKinds = kinds.get(note) ?? [];
          return (
            <React.Fragment key={note}>
              {Array.from({ length: columns }, (_, col) => {
                const barIndex = Math.floor(col / stepsPerBar);
                const stepInBar = col - barIndex * stepsPerBar;
                const idx = leadStoredIndex(barIndex, stepInBar);
                const kind = rowKinds[col] ?? 'none';
                const span = leadSpanClasses(kind, rowKinds[col + 1] ?? 'none');
                const cell = cellsPerBar[stepInBar];

                const inactive = isRootNote(note, root)
                  ? 'bg-primary/20'
                  : isBlackKey(note)
                    ? 'bg-roll-key-black'
                    : 'bg-roll-key-white';

                const sep =
                  barIndex > 0 && stepInBar === 0
                    ? 'border-l-2 border-l-base-content/50'
                    : cell.isBeatStart && stepInBar > 0
                      ? 'border-l border-l-base-content/30'
                      : '';

                return (
                  <button
                    key={`${note}-${col}`}
                    type="button"
                    aria-label={note}
                    aria-pressed={kind !== 'none'}
                    onClick={() => onToggle(idx, note)}
                    className={`h-5 border border-base-300 ${span || inactive} ${
                      kind === 'none' || kind === 'start' ? sep : ''
                    }`}
                  />
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    );
  });
  ```
  The bar/beat separator is suppressed inside a span's body and end cells so the note reads as one continuous bar rather than being sliced by the beat lines.

- [ ] **Step 6: Add the render test that the grid still renders one button per cell.**
  Append to `src/components/loop/lead/LeadMelodyGrid.test.tsx` (the file already renders through `renderToString`; creation-time state is an empty melody, and `useAppStore.setState` before a render has no effect — the zustand trap, so a *drawn* span cannot be asserted here):
  ```tsx
  describe('LeadMelodyGrid cells', () => {
    test('an empty melody renders every cell unpressed with its pitch label', () => {
      const html = renderToString(<LeadMelodyGrid />);
      expect(html).toContain('aria-pressed="false"');
      expect(html).toContain('aria-label="C4"');
      expect(html).not.toContain('aria-pressed="true"');
    });
  });
  ```

- [ ] **Step 7: Run the tests and watch them pass.**
  ```bash
  bun test src/components/loop/lead && bun run lint && bun run eslint
  ```
  Zero eslint errors — every cell is still a `<button>` with `aria-label` and `aria-pressed`.

- [ ] **Step 8: Commit.**
  ```bash
  git add src/components/loop/lead/melodyGrid.ts src/components/loop/lead/LeadMelodyGrid.tsx src/components/loop/lead/melodyGrid.test.ts src/components/loop/lead/LeadMelodyGrid.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(lead): render a long note as one continuous bar (DEV-369)

  LeadMelodyCells consumes leadCellKinds and leadSpanClasses: the start rounds
  its left corners, body and end drop their left border and the beat separator,
  and the last cell rounds its right corners. Still one button per cell, so
  aria-pressed, focus order and hit targets are unchanged.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```

---

### Task 10: Drag, keyboard equivalent, and the gate slider

The editing affordances. A pointer-only one would be an accessibility regression with the a11y rules at `error`, so the keyboard path is required, not optional. Ends with the full `bun run verify`.

**Files:**
- Create: `src/components/loop/lead/useLeadNoteResize.ts`
- Modify: `src/components/loop/lead/LeadMelodyGrid.tsx` (`LeadMelodyCells`: the grab strip, the keyboard handler, the preview; the header row: the gate slider)
- Test: `src/components/loop/lead/useLeadNoteResize.test.ts` (new), `src/components/loop/lead/LeadMelodyGrid.test.tsx`

**Interfaces:**
- Consumes: `leadResizeLen(startLen: number, dxPx: number, cellWidth: number, maxLen: number): number`, `LEAD_CELL_WIDTH`, `leadCellKinds`, `leadSpanClasses`, `LeadCellKind` (Tasks 8, 9); `setLeadNoteLength(stepIndex: number, note: string, len: number): void` (Task 7); `leadGate: number` and `setLeadGate(gate: number): void` (Task 3); `Slider` from `src/components/ui/Slider.tsx` with props `{ id?, value, min, max, step?, onChange, className?, title? }`.
- Produces:
  ```ts
  // src/components/loop/lead/useLeadNoteResize.ts
  export interface LeadResizePreview { stepIndex: number; note: string; len: number }
  export function useLeadNoteResize(): {
    preview: LeadResizePreview | null;
    startResize: (
      e: React.PointerEvent<HTMLElement>,
      stepIndex: number,
      note: string,
      startLen: number,
      maxLen: number,
    ) => void;
  }
  ```

**Steps:**

- [ ] **Step 1: Write the failing source-contract test for the resize hook.**
  Create `src/components/loop/lead/useLeadNoteResize.test.ts`. It is a source scan for the same reason `useLeadPlayback.test.ts` scans its own source: there is no DOM, and `renderToString` cannot drive a pointer gesture.
  ```ts
  import { describe, expect, test } from 'bun:test';
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { useLeadNoteResize } from './useLeadNoteResize';

  const source = readFileSync(
    join(process.cwd(), 'src/components/loop/lead/useLeadNoteResize.ts'),
    'utf8',
  );

  describe('useLeadNoteResize', () => {
    test('is a hook the grid can call', () => {
      expect(typeof useLeadNoteResize).toBe('function');
    });

    test('captures the pointer and never lets the gesture reach the cell click', () => {
      expect(source).toContain('setPointerCapture');
      expect(source).toContain('stopPropagation');
    });

    test('commits to the store EXACTLY once — a write per pointermove would re-render every mounted tab', () => {
      expect(source.match(/setLeadNoteLength\(/g) ?? []).toHaveLength(1);
      expect(source).toContain('setPreview');
    });

    test('does the arithmetic through the pure helper, not inline', () => {
      expect(source).toContain('leadResizeLen(');
      expect(source).toContain('LEAD_CELL_WIDTH');
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail.**
  ```bash
  bun test src/components/loop/lead/useLeadNoteResize.test.ts
  ```
  Expected failure: `error: Cannot find module './useLeadNoteResize' from '.../useLeadNoteResize.test.ts'`.

- [ ] **Step 3: Write the hook.**
  Create `src/components/loop/lead/useLeadNoteResize.ts`:
  ```ts
  import { useCallback, useRef, useState } from 'react';
  import type React from 'react';
  import { useAppStore } from '../../../store/store';
  import { LEAD_CELL_WIDTH, leadResizeLen } from './melodyGrid';

  export interface LeadResizePreview {
    stepIndex: number;
    note: string;
    len: number;
  }

  interface DragState {
    stepIndex: number;
    note: string;
    startLen: number;
    maxLen: number;
    startX: number;
  }

  /**
   * Pointer plumbing for the note-resize drag; the arithmetic stays in
   * leadResizeLen. The preview length lives in LOCAL component state and is
   * committed to the store exactly ONCE, on pointerup. That is required by
   * CLAUDE.md, not a preference: all four tab views stay mounted, so a store
   * write per pointermove would re-render every view and re-serialise the
   * persisted slice on every frame of the gesture.
   */
  export function useLeadNoteResize(): {
    preview: LeadResizePreview | null;
    startResize: (
      e: React.PointerEvent<HTMLElement>,
      stepIndex: number,
      note: string,
      startLen: number,
      maxLen: number,
    ) => void;
  } {
    const [preview, setPreview] = useState<LeadResizePreview | null>(null);
    const dragRef = useRef<DragState | null>(null);

    const startResize = useCallback(
      (
        e: React.PointerEvent<HTMLElement>,
        stepIndex: number,
        note: string,
        startLen: number,
        maxLen: number,
      ) => {
        // Never let the gesture reach the cell's onClick, or the drag would
        // toggle the note off the moment it starts.
        e.stopPropagation();
        e.preventDefault();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        dragRef.current = { stepIndex, note, startLen, maxLen, startX: e.clientX };
        setPreview({ stepIndex, note, len: startLen });

        const lenAt = (clientX: number, drag: DragState): number =>
          leadResizeLen(drag.startLen, clientX - drag.startX, LEAD_CELL_WIDTH, drag.maxLen);

        const onMove = (ev: PointerEvent): void => {
          const drag = dragRef.current;
          if (!drag) return;
          setPreview({ stepIndex: drag.stepIndex, note: drag.note, len: lenAt(ev.clientX, drag) });
        };
        const onEnd = (ev: PointerEvent): void => {
          const drag = dragRef.current;
          dragRef.current = null;
          target.releasePointerCapture(ev.pointerId);
          target.removeEventListener('pointermove', onMove);
          target.removeEventListener('pointerup', onEnd);
          target.removeEventListener('pointercancel', onEnd);
          setPreview(null);
          if (!drag) return;
          useAppStore.getState().setLeadNoteLength(drag.stepIndex, drag.note, lenAt(ev.clientX, drag));
        };
        target.addEventListener('pointermove', onMove);
        target.addEventListener('pointerup', onEnd);
        target.addEventListener('pointercancel', onEnd);
      },
      [],
    );

    return { preview, startResize };
  }
  ```

- [ ] **Step 4: Run the test and watch it pass.**
  ```bash
  bun test src/components/loop/lead/useLeadNoteResize.test.ts && bun run lint
  ```

- [ ] **Step 5: Write the failing render test for the gate slider.**
  Append to `src/components/loop/lead/LeadMelodyGrid.test.tsx`:
  ```tsx
  describe('LeadMelodyGrid gate slider', () => {
    test('renders the labelled per-loop gate at the default 85%', () => {
      const html = renderToString(<LeadMelodyGrid />);
      expect(html).toContain('Gate 85%');
      expect(html).toContain('id="range-lead-gate"');
      expect(html).toContain('range range-primary range-xs w-20');
    });

    test('the slider states that gate applies when the arp is off', () => {
      const html = renderToString(<LeadMelodyGrid />);
      expect(html).toContain('Applies when the arp is off');
    });
  });
  ```

- [ ] **Step 6: Run the test and watch it fail.**
  ```bash
  bun test src/components/loop/lead/LeadMelodyGrid.test.tsx -t "gate slider"
  ```
  Expected failure: `expect(received).toContain(expected)` — the rendered HTML has no `Gate 85%`.

- [ ] **Step 7: Add the gate slider to the lead panel header.**
  In `src/components/loop/lead/LeadMelodyGrid.tsx`, add `import { Slider } from '../../ui/Slider';`, read the two store values beside the other selectors:
  ```tsx
    const leadGate = useAppStore((s) => s.leadGate);
    const setLeadGate = useAppStore((s) => s.setLeadGate);
  ```
  and insert into the header control row, between the loop-length `<select>` and the Clear button:
  ```tsx
              <span className="text-[10px] font-mono text-base-content/60 whitespace-nowrap">
                Gate {Math.round(leadGate * 100)}%
              </span>
              <Slider
                id="range-lead-gate"
                value={Math.round(leadGate * 100)}
                min={5}
                max={100}
                step={5}
                onChange={(percent) => setLeadGate(percent / 100)}
                className="range range-primary range-xs w-20"
                title="How much of each note's final step sounds. Applies when the arp is off."
              />
  ```

- [ ] **Step 8: Run the slider test and watch it pass.**
  ```bash
  bun test src/components/loop/lead/LeadMelodyGrid.test.tsx -t "gate slider"
  ```

- [ ] **Step 9: Add the grab strip and the keyboard equivalent to the cells.**
  In `LeadMelodyCells`, call the hook and thread the preview through the kind map, then give the span's last cell its handle. Add `useLeadNoteResize` to the imports.
  ```tsx
    const { preview, startResize } = useLeadNoteResize();
    // The drag preview is applied here, in local render state — the store is
    // written once, on pointerup (see useLeadNoteResize).
    const previewed = useMemo(() => {
      if (!preview) return melody;
      return melody.map((row, i) =>
        i === preview.stepIndex
          ? row.map((n) => (n.note === preview.note ? { note: n.note, len: preview.len } : n))
          : row,
      );
    }, [melody, preview]);
    const kinds = useMemo(
      () => leadCellKinds(previewed, rows, columns, stepsPerBar),
      [previewed, rows, columns, stepsPerBar],
    );
  ```
  Inside the per-cell map, before the `return`, resolve which note this cell belongs to — one backward step to the nearest `'start'` in the row's kind array:
  ```tsx
                const startCol = kind === 'none' ? -1 : rowKinds.lastIndexOf('start', col);
                const startBar = startCol < 0 ? 0 : Math.floor(startCol / stepsPerBar);
                const spanStartIdx =
                  startCol < 0 ? -1 : leadStoredIndex(startBar, startCol - startBar * stepsPerBar);
                const spanLen =
                  startCol < 0
                    ? 0
                    : (previewed[spanStartIdx]?.find((n) => n.note === note)?.len ?? 1);
                const nextKind = rowKinds[col + 1] ?? 'none';
                const endsSpan =
                  kind === 'end' || (kind === 'start' && nextKind !== 'body' && nextKind !== 'end');
  ```
  and inside the `<button>`, replacing the self-closing tag with a child and a key handler:
  ```tsx
                  <button
                    key={`${note}-${col}`}
                    type="button"
                    aria-label={note}
                    aria-pressed={kind !== 'none'}
                    onClick={() => onToggle(idx, note)}
                    onKeyDown={(e) => {
                      if (!e.shiftKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
                      if (kind === 'none') return;
                      // The keyboard equivalent of the drag: required, not
                      // optional — a pointer-only editing affordance is an
                      // accessibility regression with jsx-a11y at error.
                      e.preventDefault();
                      onResize(spanStartIdx, note, spanLen + (e.key === 'ArrowRight' ? 1 : -1));
                    }}
                    className={`relative h-5 border border-base-300 ${span || inactive} ${
                      kind === 'none' || kind === 'start' ? sep : ''
                    }`}
                  >
                    {endsSpan && (
                      <span
                        aria-hidden="true"
                        onPointerDown={(e) => startResize(e, spanStartIdx, note, spanLen, columns - startCol)}
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
                      />
                    )}
                  </button>
  ```
  `onPointerDown` alone is not in `jsx-a11y/no-static-element-interactions`' handler list (which covers `onClick`, `onMouseDown`/`Up`, `onKeyDown`/`Up`/`Press`), so the decorative `<span>` handle passes the rules at `error`; the keyboard path above is what actually makes the affordance reachable. `maxLen` is `columns - startCol` — the loop end only, never the next note's position, because extending swallows (invariant 1).
  Add the `onResize` prop to the component's props type and thread it from `LeadMelodyGrid`:
  ```tsx
    onResize: (stepIndex: number, note: string, len: number) => void;
  ```
  ```tsx
    const setLeadNoteLength = useAppStore((s) => s.setLeadNoteLength);
    const onResize = useCallback(
      (stepIndex: number, note: string, len: number) => setLeadNoteLength(stepIndex, note, len),
      [setLeadNoteLength],
    );
  ```
  and pass `onResize={onResize}` on the `<LeadMelodyCells />` element.

- [ ] **Step 10: Run the lead tests and the type-check.**
  ```bash
  bun test src/components/loop/lead && bun run lint && bun run eslint
  ```
  All pass; eslint reports zero errors.

- [ ] **Step 11: Update `CLAUDE.md`'s slice list line for the new per-loop field.**
  In the `src/store/` bullet of the Architecture section, the parenthesised list of slices is unchanged, but the sentence about bumping the persist `version` already covers this change. Add one line to the "Traps recorded in the spec" section:
  ```markdown
  - **The lead melody's two migration chains must run before their sanitize step.** `isLeadNoteMatrix`
    rejects the pre-DEV-369 `string[][]` shape, so a v1 payload that reaches sanitize un-upgraded
    comes back blank — no throw, no warning. Persist upgrades in `migrate` (before `merge`);
    `.solna` upgrades in `migrateProjectBody` (before `sanitizeContent`). Never merge the two.
  ```

- [ ] **Step 12: Run the full gate.**
  ```bash
  bun run verify
  ```
  `bun test`, `bun run lint`, `bun run eslint` (zero errors), `bun run check:keys`, `bun run check:drums` and `bun run build` all pass. Do not claim the plan complete before this command's output is read.

- [ ] **Step 13: Commit.**
  ```bash
  git add src/components/loop/lead/useLeadNoteResize.ts src/components/loop/lead/useLeadNoteResize.test.ts src/components/loop/lead/LeadMelodyGrid.tsx src/components/loop/lead/LeadMelodyGrid.test.tsx CLAUDE.md
  git commit -m "$(cat <<'EOF'
  feat(lead): drag, keyboard and slider controls for length and gate (DEV-369)

  An 8px grab strip on the right edge of a note's last cell resizes it with
  pointer capture; the preview lives in local component state and the store is
  written exactly once, on pointerup. Shift+ArrowRight/Left on a focused note
  cell is the required keyboard equivalent, through the same slice action. The
  per-loop Gate slider lands in the lead panel header at 5-100% step 5, with a
  tooltip saying it applies when the arp is off.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
  EOF
  )"
  ```
