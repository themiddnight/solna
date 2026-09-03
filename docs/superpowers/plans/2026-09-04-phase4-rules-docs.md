# Phase 4 — Rules and Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the codebase's rules match what the restructured tree (Phases 1–3) actually
enforces: a new `.claude/rules/components.md` for `src/{features,ui,app}/**`, a real
`resetStore()` helper replacing ~14 hand-rolled per-test copies, the four remaining file-level
`no-explicit-any` disables converted to a typed access helper, `CLAUDE.md`'s architecture
section rewritten for the five-layer tree, `docs/design.md` deduplicated against it, and the
dependency-upgrade research doc moved into `docs/research/`.

**Architecture:** Six independent documentation/tooling tasks plus one small real module
(`store/testUtils.ts`) and its test. No production behaviour changes; `bun run verify` gates
every task exactly as it does in Phases 1–3.

**Tech Stack:** Bun (tests + scripts), TypeScript, ESLint flat config, Zustand.

**Spec:** `docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md` —
sections *Decisions* (D1–D9), *Phase 4 — Rules and docs*, *Target directory layout*, *Testing*.

**Tree this plan runs against:** Phases 2 and 3 have already landed. `src/` is
`{app,features,ui,store,audio,utils,routing,pwa,types}` per the spec's target layout; the `ui/`
primitives from Phase 2 exist under `src/ui/`; `React.FC` is gone (D1: `export function
X(props: XProps)`); every cross-folder import uses `@/`. **Measurements below were taken on
today's pre-Phase-3 tree** (paths under `src/components/...` and `src/store/...` at the repo
root) because that is the tree that exists right now — each measured path is paired with its
Phase-3 destination from the spec's *Target directory layout* / *Phase 3 — Restructure* file
mapping. Re-resolve with `find`/`grep` at execution time if a path has moved again since this
plan was written; Phase 3's move is a rename, not a rewrite, so file *contents* below are
expected to still match verbatim.

## Global Constraints

- `bun run verify` = `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`. Green at the end of every task in this plan.
- No file-level `eslint-disable`. `@typescript-eslint/no-explicit-any` goes line-level with a reason, or the type is fixed (spec Phase 4 item 2).
- Documentation records rules, never version numbers, dependency versions, or line/file counts that go stale silently — this is `CLAUDE.md`'s own standing instruction ("Do not record version numbers here... Read `package.json` / the source instead, and write down the *rule*, not the number") and this plan follows it in every task, including the ones that touch `CLAUDE.md` itself.
- D1: component style is `export function X(props: XProps)` with `interface XProps`; named exports; no `React.FC`.
- D2: `@/` alias for every cross-layer or cross-folder import; relative imports only within the same feature folder; ESLint bans `../../`.
- D6: `audio/` and `store/` remain layers; only the view layer is feature-based.
- D7: no forced `logic/`/`ui/` subfolders inside a feature; add one only past ~10 files.
- Commits stage files by name (`git add <files>`, never `-A`). Every commit message ends with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
```

---

## Measurements (taken on today's pre-Phase-3 tree, 2026-09-04)

**`grep -rn "eslint-disable " src`** — 4 file-level directives, all the same rule:

| File (pre-Phase-3 path) | Phase-3 destination | Approx. `any` sites |
| --- | --- | --- |
| `src/audio/engine.test.ts` | `src/audio/engine.test.ts` (unchanged — `audio/` doesn't move) | ~182 |
| `src/audio/testFakes.ts` | `src/audio/testFakes.ts` (unchanged) | 1 (the constructor cast) |
| `src/audio/clock.test.ts` | `src/audio/clock.test.ts` (unchanged) | ~19 |
| `src/audio/playback/presetPreview.test.ts` | `src/audio/playback/presetPreview.test.ts` (unchanged) | ~9 |

The spec's own *Measurements* table names only the first, third and fourth of these (the ones
whose comment reads "tests deliberately reach private fields... via casts" or "matching
engine.test.ts's casting convention"); `testFakes.ts` carries the same directive for the same
reason (it defines `makeEngine()`, the one place the engine's private constructor is
instantiated) and was not named in the spec's table. All four are `src/audio/`, which does not
move in Phase 3, so these paths are stable — **Conflict/ruling:** the spec undercounts this
grep by one file; Task 4 below fixes all four, since the acceptance grep (`grep -rn
"eslint-disable " src` returns no file-level directives) does not care which table named which
file.

**`grep -rln "setState(.*getInitialState" src --include='*.test.*'`** — **0 matches today.**
No test file currently calls `useAppStore.setState(useAppStore.getInitialState(), ...)`; every
existing "reset copy" hand-rolls a literal object instead. This is expected, not a
contradiction: the grep is the Phase-4 *acceptance* check (it must return only
`store/testUtils.ts` once that file exists), not a defect count. The actual defect is the ~14
hand-rolled copies enumerated below, found instead with
`grep -rl "useAppStore.setState" src --include='*.test.*'` (20 files) filtered down to the ones
whose `setState` sits in a `beforeEach`/`afterEach` establishing a shared baseline (as opposed
to a one-off mutation inside a single test, or a fixture value a test needs — those are not
"reset copies" and are left alone):

| File (pre-Phase-3 path) | Phase-3 destination | Reset function | What it restores |
| --- | --- | --- | --- |
| `src/components/song/ArrangeView.test.tsx` | `src/features/song/ArrangeView.test.tsx` | `resetStore` (named) | fresh loop, transient players, `songLoopIndex`, `playbackScope` |
| `src/components/loop/LoopSelector.test.tsx` | `src/features/song/LoopSelector.test.tsx` | `resetStore` (named) | fresh loop, transient players, `songLoopIndex` |
| `src/store/loadLoop.test.ts` | `src/store/persist/loadLoop.test.ts` | `resetStore` (named) | fresh loop, transient players, `songLoopIndex` |
| `src/store/songMode.test.ts` | `src/store/songMode.test.ts` (stays root) | `resetState` (named) | fresh loop, `activeTab`, transient players, `songLoopIndex`, `playbackScope` |
| `src/store/loopSync.test.ts` | `src/store/persist/loopSync.test.ts` | inline `afterEach` | fresh loop only |
| `src/store/leadSlice.test.ts` | `src/store/slices/leadSlice.test.ts` | `resetLead` (named) | `meterId`, lead melody/loop/view/octave defaults |
| `src/store/customStepSequencer.test.ts` | `src/store/customStepSequencer.test.ts` (stays root) | `resetCustomFields` (named) | 4 custom-step fields to factory defaults |
| `src/components/InstantVibesBar.test.tsx` | `src/features/vibes/InstantVibesBar.test.tsx` | inline `beforeEach` | transient players, `selectedVibeId` |
| `src/components/ui/BottomInputDock.test.tsx` | `src/features/input/BottomInputDock.test.tsx` | inline `beforeEach` | input-panel open/mode |
| `src/store/store.test.ts` | `src/store/store.test.ts` (stays root) | inline `beforeEach` | transient players |
| `src/store/transportSlice.test.ts` | `src/store/slices/transportSlice.test.ts` | inline `afterEach` | `bpm` (via `setBpm(120)`, not `setState`) |
| `src/audio/synthPresets.test.ts` | `src/audio/synthPresets.test.ts` (unchanged) | inline `beforeEach` | custom preset/progression arrays |
| `src/store/projectSlice.test.ts` | `src/store/slices/projectSlice.test.ts` | inline `beforeEach` | transient players, `selectedVibeId` |
| `src/store/engineSync.test.ts` | `src/store/engineSync.test.ts` (stays root) | inline `beforeEach` | transient players |

Excluded despite matching the raw grep: `src/components/loop/ChordView.test.tsx`,
`src/store/transportSlice.test.ts`'s `meterId` line, `src/components/loop/SequencerView.test.tsx`,
`src/store/instantVibes.test.ts`, `src/components/project/ProjectManagerModal.test.tsx` — these
call `useAppStore.setState(...)` inside a single test or as one-off per-test setup, not in a
shared `beforeEach`/`afterEach`, so there is no "copy" to replace. Also excluded:
`src/store/musicContextSlice.test.ts` — its `beforeEach` writes specific fixture note data
(`steps[0] = ['A3', 'C4']`), not a baseline reset; migrating it to `resetStore()` would change
what the test is asserting, not just how the store gets there.

Every value each hand-rolled reset restores was checked against the corresponding slice's own
initial-state default (`transportSlice.ts`, `loopSlice.ts`, `presetsSlice.ts`, `uiSlice.ts`) and
matches exactly — these are all restoring creation-time state, just by re-listing it instead of
reading it. `resetStore()` (Task 2) is a drop-in replacement for every one of them.

---

## File Structure

Created:
- `.claude/rules/components.md`
- `src/store/testUtils.ts`
- `src/store/testUtils.test.ts`

Modified: the ~14 test files above (their `beforeEach`/`afterEach`/named-reset-function bodies
only), `.claude/rules/testing.md`, `src/audio/testFakes.ts`, `src/audio/engine.test.ts`,
`src/audio/clock.test.ts`, `src/audio/playback/presetPreview.test.ts`, `CLAUDE.md`,
`docs/design.md`.

Renamed: `docs/dependency-upgrade-research.md` → `docs/research/dependency-upgrade-research.md`.

---

### Task 1: `.claude/rules/components.md`

**Files:**
- Create: `.claude/rules/components.md`

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: the rule file every future component-authoring session in `src/features/`,
  `src/ui/`, `src/app/` loads automatically.

- [ ] **Step 1: Confirm the frontmatter format against an existing rule file**

Run: `cat /Users/Pathompong/Sites/Personal/solna/.claude/rules/theming.md | head -6`
Expected:
```
---
paths:
  - "src/components/**/*"
  - "src/utils/themeColor.ts"
  - "src/**/*.css"
  - "scripts/themeTokenGuard.ts"
---
```
This confirms the repo's convention is a `paths:` list of explicit glob strings, one per line —
not brace-expansion syntax. `components.md` uses the same style, one line per top-level
directory the spec's `src/{features,ui,app}/**` names.

- [ ] **Step 2: Write the file**

```markdown
---
paths:
  - "src/features/**/*"
  - "src/ui/**/*"
  - "src/app/**/*"
---

# Components — store reads, style, primitives, boundaries

## Reading the store

`useAppStore(s => s.x)` is the only way a component reads store state during render — never
`useAppStore.getState()` at render time, which reads once and never updates. `getState()` is for
**handlers**: `onClick={() => useAppStore.getState().setBpm(140)}` reads the current value at
the moment the handler runs, not at the moment the component last rendered.

**Exception — `renderToString`-sensitive reads.** zustand serves `getInitialState()` (the state
captured once at store creation) as the server snapshot `useSyncExternalStore` reads under
`renderToString`. A plain `useAppStore(selector)` therefore always renders creation-time values
in a `renderToString` test; a test's `useAppStore.setState(...)` before the render has no
effect. If a component must reflect state a test sets up before rendering, read it through
`useLiveStore(selector)` (`src/store/useLiveStore.ts`) instead, which serves `getState()` for
both snapshots. Full detail: `.claude/rules/testing.md`.

## Component style (decision D1)

```tsx
export interface WidgetProps {
  value: number;
  onChange: (value: number) => void;
}

export function Widget({ value, onChange }: WidgetProps) {
  return <input value={value} onChange={(e) => onChange(Number(e.target.value))} />;
}
```

Named export, plain function, `interface` (never `type Props = {...}`), no `React.FC`.
`React.FC` adds nothing under the `react-jsx` runtime and hides the props type behind a
generic; ESLint's `no-restricted-syntax` bans it at `error`.

## The `ui/` primitives

Everything under `src/ui/` is presentation-only: it imports neither `store/` nor `features/`
(ESLint enforces this at `error`). A feature component composes these; it does not re-implement
their markup.

- **`Knob`** — rotary control. `value`, `onChange`, `min?`, `max?`, `step?`, `scale?`, `size?`,
  `label?`. `descriptor?: string` renders a plain-language reading of the value as a tinted
  badge (e.g. reverb decay in seconds as "Room"/"Hall"/"Cathedral") — only for parameters whose
  raw number doesn't say what the user will hear; never for percentages or dB.
- **`Slider`** — wraps `<input type="range">`. `value`, `min`, `max`, `step?`, `onChange`,
  `className?` (full daisyUI class list, defaults to `range range-primary range-xs w-full`).
- **`Field`** — one labelled control in a card's row: a stacked `label?` above a control lane.
  `htmlFor?`, `children`. Owns the pairing of `FIELD_LABEL` + `FIELD_LANE`, not just the class
  strings — hand-assembling the same `<div><label/><div/></div>` structure is the drift this
  primitive exists to stop.
- **`fieldClasses`** — the shared class-string tokens (below). Import these; never retype them.
- **`PowerToggle`** — the single on/off control app-wide. `on`, `onToggle`, `name` (rendered as
  `"${name} On"`), `tone` (closed union, the module's own colour), `iconOnly?`, `size?`, `verb?:
  { on, off }` for controls that read as mute rather than power. `off` is always
  `btn-ghost text-base-content/40`, never `btn-error` — red on an off control reads as broken,
  not muted.
- **`StepRow<T>`** — the one step-grid row implementation (chord on/off grid, bass tone grid,
  sequencer drum/synth lanes). `cells`, `steps: readonly T[]`, `currentStep`, `isPlaying`,
  `color` (caller's module token — the primitive never names a colour), `isActive: (v: T) =>
  boolean`, `getLabel?`, `getButtonId?`, `activeOverlay?: 'label' | 'pulse'`, `rowClassName?`.
- **`StepHeader`** — the step-number strip above sequencer lanes. `cells`, `currentStep`,
  `isPlaying`, `className?` (replaces the default container classes entirely — pass
  `STEP_ROW_CLASS` plus any margin so numbers share the row's column pitch).
- **`BeatDots`** — a beat-position counter. `totalBeats`, `activeBeat: number | null`, `size?:
  'sm' | 'md'`, `tone?`, `className?`, `beatsPerBar?`.
- **`ChannelStrip`** — a mixer channel (fader, mute, solo, pan). `idPrefix`, `label?`, `volume`,
  `accentClass`, `onVolumeChange`, `showReadout?`, `sliderClassName?`, and `max` — **required,
  not defaulted**, because the fader ceiling is a property of the bus (chord/bass boost to 1.5,
  drums are a plain 0..1 master); a default would silently hand the wrong ceiling to the next
  caller.
- **`PresetLibrary<T>`** — the generic library-drawer shell both preset browsers build on.
  `isOpen`, `onClose`, `title`, `headerSubtitle?`, `headerBadge?`, `headerAccessory?`,
  `panelTintClass?`, `activeEntryId?`, `saveButton?: { label, title?, inToolbar?, className? }`,
  `renderHeaderActions?`.
- **`QuickSavePopover`** — inline name-and-category save form. `open`, `onClose`, `heading`,
  `placeholder`, `saveLabel`, `name`, `onNameChange`, `onSubmit`, `categories?`, `category?`,
  `onCategoryChange?`. Its `inputClassName`/`selectClassName`/`buttonClassName` default to the
  shared daisyUI chrome — leave them alone unless the caller genuinely needs a different shape.
  Closes on Escape and returns focus to its trigger on close.
- **`ViewHeader`** — the header card every view opens with. `view: ViewMode`, `badge?`,
  `actions?`, `children?`. Icon and title come from `viewMeta.ts` so a tab and the view it opens
  can never disagree about what it's called; the icon chip is always `primary` — module
  identity colours are reserved for the synth's signal-stage panels, never the view header.
- **`viewMeta.ts`** — not a component: the one table `Header`'s tab buttons and `ViewHeader`
  both read (`VIEW_META: Record<ViewMode, { icon, tabLabel, title }>`, `VIEW_ORDER`).
- **`VuMeter`** — one of the three analyser-read exemptions (with `AudioVisualizer` and
  `AmbientBackdrop` in `src/app/`) allowed to read `audioEngine` directly instead of through the
  store, because routing a per-frame analyser read through Zustand would mean a store write
  every animation frame and a re-render of every subscriber.
- **`Modal`** — `open: boolean`, `onClose: () => void`, `title`, `children`, `size?`. Wraps a
  `ref<HTMLDialogElement>`; an effect calls `showModal()` when `open` flips true and `close()`
  when false. `onClose` is bound to the native `close` event, so Escape, the backdrop form and
  a header close button all go through one path. Never renders `modal-open`.
- **`ConfirmDialog`** — built on `Modal`. `title`, `message`, `confirmLabel`, `danger?: boolean`,
  `onConfirm`, `onCancel`.
- **`IconButton`** — `label: string` (required; emitted as both `aria-label` and `title`),
  `icon`, `size: 'xs' | 'sm' | 'md'`, `variant: 'ghost' | 'outline' | 'primary' | 'error'`,
  `active?`, plus native button props. Every icon-only `<button>` in the app renders through
  this — a bare `<button><X /></button>` with no visible text is an accessibility bug, not a
  style choice; `jsx-a11y` catches the unlabelled case at `error`.
- **`ModuleHeader`** — `badge?`, `icon?`, `title`, `right?: ReactNode`. The header row a module
  card opens with.
- **`PanelCard`** — `tint?: ModuleTint`, `children`, `className?`. The card shell every module
  panel wraps in.

## `fieldClasses` tokens

Import these from `src/ui/fieldClasses.ts`; never retype the string. A hand-written lookalike
(e.g. `text-[10px] text-base-content/60` or `text-xs font-bold uppercase tracking-wider` outside
this file) fails `fieldClasses.test.ts`'s regex sweep.

| Token | Value | Use |
| --- | --- | --- |
| `FIELD_LABEL` | `text-[10px] text-base-content/60 block mb-1` | the one stacked form-field label |
| `FIELD_SELECT` | `select select-sm font-semibold` | the select a card's control row uses |
| `FIELD_LANE` | `flex items-center h-8` | the 32px control lane a labelled field's control sits in |
| `SECTION_HEADER` | `text-xs font-bold uppercase tracking-wider text-base-content` | a section header — never a field label; a label above its own control is not a section |
| `COUNT_BADGE` | see `fieldClasses.ts` | an inline count pill |
| `STEP_BADGE` | `badge badge-sm badge-outline tabular-nums` | a step-index badge |
| `HEADER_BADGE` | `badge badge-sm badge-outline text-[10px] font-semibold tabular-nums` | a header-row badge |

## Feature boundaries

A feature under `src/features/<name>/` imports `@/ui/*`, `@/store/*`, `@/utils/*` — never
another feature's folder (`@/features/<other>/*`). This is `error` for `ui/` importing `store/`
or `features/`, and `warn` (tracked as backlog) for `features/X` importing `features/Y` — the
known cross-feature imports from the Phase 3 restructure are listed in the spec's *Out of
scope / backlog* section and are resolved one at a time, not as part of ordinary feature work.
Do not add a new cross-feature import to "fix" a warning quickly; route the shared piece through
`ui/` or `utils/` instead, or raise it for its own task.

No forced `logic/`/`ui/` subfolder inside a feature (decision D7) — add one only once a feature
passes roughly 10 files.

## Comments

A comment explains why the code is the way it is **now** — never what it used to be, and never
which task or phase changed it. `// per the Task 12 review finding` and `// this replaces the
old X component` are both wrong: six months from now neither sentence helps the reader, and the
task/phase number is meaningless outside the PR that wrote it. If the code's behaviour has a
non-obvious reason, state the reason itself ("closing would unmount it, so the effect is
guarded on `open`"), not the history that produced it. `git log`/`git blame` already carries the
history; a comment's job is the present tense.
```

- [ ] **Step 2: Verify the primitive names and prop lists against the source they describe**

Run (adjust the `src/ui/` prefix if Phase 3 landed the primitives at a different path than
this plan assumes):
```bash
grep -n "^export interface\|^interface" src/ui/{Knob,Slider,Field,PowerToggle,StepRow,StepHeader,BeatDots,ChannelStrip,PresetLibrary,QuickSavePopover,ViewHeader}.tsx
```
Expected: one `Props` interface per file whose members match Step 1's bullet list. If a
primitive gained or lost a prop since this plan was written, correct the bullet — the rule file
must describe the real contract, not this plan's snapshot of it.

- [ ] **Step 3: Run the gate**

Run: `bun run verify`
Expected: green — this task touches no source, only a new rules file, so nothing should change.

- [ ] **Step 4: Commit**

```bash
git add .claude/rules/components.md
git commit -m "$(cat <<'EOF'
docs(rules): add components.md for features/ui/app

Store-read pattern, component style (D1), every ui/ primitive's prop
contract, the fieldClasses tokens, feature-boundary rules and the
comment rule, scoped to the tree Phase 3 produced.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
EOF
)"
```

---

### Task 2: `src/store/testUtils.ts` — `resetStore()`

**Files:**
- Create: `src/store/testUtils.ts`
- Create: `src/store/testUtils.test.ts`

**Interfaces:**
- Consumes: `useAppStore` from `./store` (`store/store.ts`, stays at the store root per the
  target layout).
- Produces: `export function resetStore(): void` — importable as `import { resetStore } from
  '@/store/testUtils'` (or `./testUtils` / `../../store/testUtils` from a test file in the same
  folder, per D2's same-folder-relative rule).

- [ ] **Step 1: Write the failing test**

```typescript
// src/store/testUtils.test.ts
import { describe, expect, test } from 'bun:test';
import { useAppStore } from './store';
import { resetStore } from './testUtils';
import { createDefaultLoop, DEFAULT_LOOP_ID } from './loopSlice';

describe('resetStore', () => {
  test('restores loops, activeLoopId, currentProjectId and dirty to creation-time state', () => {
    const initial = useAppStore.getInitialState();
    const mutatedLoop = { ...createDefaultLoop(), id: 'mutated-loop', name: 'Mutated' };

    useAppStore.setState({
      loops: [mutatedLoop],
      activeLoopId: mutatedLoop.id,
      currentProjectId: 'some-project-id',
      currentProjectName: 'Some Project',
      dirty: true,
    });
    expect(useAppStore.getState().activeLoopId).toBe(mutatedLoop.id);
    expect(useAppStore.getState().dirty).toBe(true);

    resetStore();

    const state = useAppStore.getState();
    expect(state.loops).toEqual(initial.loops);
    expect(state.activeLoopId).toBe(DEFAULT_LOOP_ID);
    expect(state.currentProjectId).toBeNull();
    expect(state.dirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails on the missing module**

Run: `bun test src/store/testUtils.test.ts`
Expected: FAIL — `Cannot find module './testUtils'` (or equivalent resolution error); no
`testUtils.ts` exists yet.

- [ ] **Step 3: Write `resetStore()`**

```typescript
// src/store/testUtils.ts
import { useAppStore } from './store';

/**
 * Resets the shared store singleton to its creation-time state.
 *
 * bun runs every test file in one process without isolation, so a mutation
 * in one file leaks into whichever file runs next unless every file
 * establishes the same baseline by hand — this was reimplemented as a
 * hand-rolled beforeEach/afterEach in roughly a dozen test files before this
 * module existed, each restating a subset of the same defaults and drifting
 * whenever a slice gained a new field.
 *
 * `getInitialState()` returns the object zustand captured once at store
 * creation, before `persist`'s hydration ever calls `setState` on it — the
 * same "creation-time" value a `renderToString` test already sees through
 * `getServerSnapshot` (see `.claude/rules/testing.md`'s zustand +
 * renderToString trap). Resetting to it here keeps a test's starting point
 * identical to what a fresh page load — or a fresh renderToString render —
 * would see. The second `true` argument replaces the state wholesale rather
 * than merging over whatever the previous test left behind.
 */
export function resetStore(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test src/store/testUtils.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `bun run verify`
Expected: green.

```bash
git add src/store/testUtils.ts src/store/testUtils.test.ts
git commit -m "$(cat <<'EOF'
feat(store): add testUtils.resetStore() for shared per-test baselines

setState(getInitialState(), true) restores every slice to its
creation-time value in one call, replacing the hand-rolled
beforeEach/afterEach copies migrated in the next commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
EOF
)"
```

---

### Task 3: Migrate the hand-rolled resets to `resetStore()`

**Files** (pre-Phase-3 path shown; re-resolve to the Phase-3 destination from the Measurements
table above before editing):
- Modify: `src/components/song/ArrangeView.test.tsx`
- Modify: `src/components/loop/LoopSelector.test.tsx`
- Modify: `src/store/loadLoop.test.ts`
- Modify: `src/store/songMode.test.ts`
- Modify: `src/store/loopSync.test.ts`
- Modify: `src/store/leadSlice.test.ts`
- Modify: `src/store/customStepSequencer.test.ts`
- Modify: `src/components/InstantVibesBar.test.tsx`
- Modify: `src/components/ui/BottomInputDock.test.tsx`
- Modify: `src/store/store.test.ts`
- Modify: `src/store/transportSlice.test.ts`
- Modify: `src/audio/synthPresets.test.ts`
- Modify: `src/store/projectSlice.test.ts`
- Modify: `src/store/engineSync.test.ts`
- Modify: `.claude/rules/testing.md`

**Interfaces:**
- Consumes: `resetStore()` from Task 2.
- Produces: no new API; every listed file's `beforeEach`/`afterEach` calls `resetStore()`
  instead of restating defaults.

Every value below was checked against the store's actual initial-state default in Task 2's
Measurements — `resetStore()` restores each one exactly, so each diff is a subtraction: the
local reset body is deleted and replaced with a call to the shared helper. Where a file needs
something `resetStore()` doesn't restore because it isn't part of default store state (there is
no such case among these 14; every one of them is restoring a plain default), that extra
`setState` would stay as a second line after the `resetStore()` call — none of these files need
that, so none get one.

- [ ] **Step 1: `ArrangeView.test.tsx` — replace the named `resetStore`**

```diff
-const resetStore = () => {
-  const loop = createDefaultLoop();
-  useAppStore.setState({
-    loops: [loop],
-    activeLoopId: loop.id,
-    ...loopStatePatch(loop),
-    sequencerPlayer: 'stopped',
-    chordsPlayer: 'stopped',
-    leadPlayer: 'stopped',
-    songLoopIndex: null,
-    playbackScope: { kind: 'none' },
-  });
-};
+import { resetStore } from '@/store/testUtils';
```

Remove the now-unused `createDefaultLoop`/`loopStatePatch` imports only if nothing else in the
file references them — check with `grep -n "createDefaultLoop\|loopStatePatch"` on the file
before deleting the import line.

- [ ] **Step 2: `LoopSelector.test.tsx` and `loadLoop.test.ts` — same named `resetStore` body**

Both files have the byte-identical function (minus `ArrangeView`'s extra `playbackScope` line).
Apply the same replacement as Step 1: delete the local `resetStore` function, add `import {
resetStore } from '@/store/testUtils';`, remove `createDefaultLoop`/`loopStatePatch` imports if
they become unused.

- [ ] **Step 3: `songMode.test.ts` — replace `resetState`**

```diff
-const resetState = () => {
-  const loop = createDefaultLoop();
-  useAppStore.setState({
-    loops: [loop],
-    activeLoopId: loop.id,
-    ...loopStatePatch(loop),
-    activeTab: 'synth',
-    sequencerPlayer: 'stopped',
-    chordsPlayer: 'stopped',
-    leadPlayer: 'stopped',
-    songLoopIndex: null,
-    playbackScope: { kind: 'none' },
-  });
-};
+import { resetStore } from './testUtils';
```

And update its two call sites: `beforeEach(resetState); afterEach(resetState);` becomes
`beforeEach(resetStore); afterEach(resetStore);`. (This file stays at `src/store/` root per the
target layout, so the import is relative, not `@/`.)

- [ ] **Step 4: `loopSync.test.ts` — replace the inline `afterEach`**

```diff
+import { resetStore } from './testUtils';
+
-afterEach(() => {
-  const loop = createDefaultLoop();
-  useAppStore.setState({
-    loops: [loop],
-    activeLoopId: loop.id,
-    ...loopStatePatch(loop),
-  });
-});
+afterEach(resetStore);
```

- [ ] **Step 5: `leadSlice.test.ts` — replace `resetLead`**

```diff
-function resetLead(): void {
-  useAppStore.setState({
-    meterId: '4/4',
-    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]),
-    leadLoopLength: 1,
-    leadMelodyView: 'scale-locked',
-    leadMelodyOctave: 3,
-  });
-}
+import { resetStore } from './testUtils';
```
and `beforeEach(resetLead);` → `beforeEach(resetStore);`.

- [ ] **Step 6: `customStepSequencer.test.ts` — replace `resetCustomFields`**

```diff
-/** Reset the four new fields to their factory defaults so tests never leak. */
-function resetCustomFields(): void {
-  useAppStore.setState({
-    chordRhythmMode: 'preset',
-    bassPatternMode: 'preset',
-    customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
-    customBassPattern: new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest'),
-  });
-}
+import { resetStore } from './testUtils';
```
and `beforeEach(resetCustomFields);` → `beforeEach(resetStore);`.

- [ ] **Step 7: `InstantVibesBar.test.tsx` — replace the inline `beforeEach` body**

```diff
+import { resetStore } from '@/store/testUtils';
+
 beforeEach(() => {
   spyOn(audioEngine, 'init').mockImplementation(() => Promise.resolve());
   spyOn(audioEngine, 'resetClock').mockClear();
-  useAppStore.setState({
-    sequencerPlayer: 'stopped',
-    chordsPlayer: 'stopped',
-    selectedVibeId: null,
-  });
+  resetStore();
 });
```

- [ ] **Step 8: `BottomInputDock.test.tsx` — replace the inline `beforeEach` body**

```diff
+import { resetStore } from '@/store/testUtils';
+
 beforeEach(() => {
-  useAppStore.setState({ isInputPanelOpen: false, inputPanelMode: 'keyboard' });
+  resetStore();
 });
```

- [ ] **Step 9: `store.test.ts` — replace the async `beforeEach` body**

```diff
+import { resetStore } from './testUtils';
+
 beforeEach(async () => {
   fakeLocalStorage.clear();
-  // Reset the transient transport player states so tests are order-independent.
-  const { useAppStore } = await getStore();
-  useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped' });
+  const { useAppStore } = await getStore();
+  resetStore();
 });
```
`useAppStore` from `getStore()` may be a dynamically-imported module instance distinct from the
one `testUtils.ts` imports statically — check `getStore()`'s implementation first (`grep -n
"function getStore" src/store/store.test.ts`). If it returns the same singleton module (the
common case for a dynamic `import('./store')` in the same process), `resetStore()` operates on
it correctly with no change needed. If `getStore()` intentionally re-imports a fresh module
instance per call (rare, only relevant if the file resets module state between tests), keep the
inline `useAppStore.setState(...)` for that file and skip this step — the point of `resetStore`
is a shared *default*, not a mandate to touch every last file.

- [ ] **Step 10: `transportSlice.test.ts` — replace the `afterEach` action call**

```diff
+import { resetStore } from './testUtils';
+
 describe('setBpm clamping', () => {
   afterEach(() => {
-    useAppStore.getState().setBpm(120);
+    resetStore();
   });
```
Keep the existing comment above `afterEach` explaining *why* a reset runs here (it explains
today's reasoning, not history — Task 1's comment rule applies to new comments, not to deleting
a correct existing one).

- [ ] **Step 11: `synthPresets.test.ts` — replace the inline `beforeEach` body**

```diff
+import { resetStore } from './testUtils';
+
 describe('custom preset store actions', () => {
   beforeEach(() => {
-    useAppStore.setState({ customSynthPresets: [], customChordProgressions: [] });
+    resetStore();
   });
```

- [ ] **Step 12: `projectSlice.test.ts` — replace the async `beforeEach` body**

```diff
+import { resetStore } from './testUtils';
+
 beforeEach(async () => {
   const { useAppStore } = await storeModule;
-  useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped', selectedVibeId: null });
+  resetStore();
   stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
 });
```
Same `storeModule` caveat as Step 9 — verify it resolves to the same singleton before assuming
`resetStore()` (which imports `useAppStore` statically from `./store`) reaches it.

- [ ] **Step 13: `engineSync.test.ts` — replace the inline `beforeEach` body**

```diff
+import { resetStore } from './testUtils';
+
 beforeEach(() => {
-  useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped' });
+  resetStore();
 });
```

- [ ] **Step 14: Update `.claude/rules/testing.md` to document `resetStore()`**

Add, after the "The zustand + renderToString trap" section:

```markdown
## Resetting the store between tests

bun runs every test file in one process with no isolation, so a mutation to the shared
`useAppStore` singleton in one file leaks into whichever file runs next. Use
`resetStore()` from `src/store/testUtils.ts` in a `beforeEach`/`afterEach` to restore
creation-time state — never hand-roll a `useAppStore.setState({...defaults...})` copy; that
was the pattern that drifted across roughly a dozen files before this helper existed, each
restating a different subset of the same defaults. If a test's baseline genuinely needs more
than the store's own defaults (a specific fixture, not a reset), set that separately, after
calling `resetStore()` — do not fold fixture data into a reset function.
```

- [ ] **Step 15: Run the full suite and lint for unused imports**

Run: `bun test`
Expected: every test passes, in particular the 14 files touched above and anything downstream
that shares the singleton (`bun test` runs the whole suite in one process, so a leftover
mismatch shows up as a failure in a *different* file, not necessarily the one you edited).

Run: `bun run eslint`
Expected: no new errors; any newly-unused import (`createDefaultLoop`, `loopStatePatch`,
`MAX_STEPS_PER_BAR`, `BassStepChoice`, etc., wherever a file's only use of them was the deleted
reset body) is flagged — remove it.

- [ ] **Step 16: Verify and commit**

Run: `bun run verify`
Expected: green.

```bash
git add src/components/song/ArrangeView.test.tsx src/components/loop/LoopSelector.test.tsx \
  src/store/loadLoop.test.ts src/store/songMode.test.ts src/store/loopSync.test.ts \
  src/store/leadSlice.test.ts src/store/customStepSequencer.test.ts \
  src/components/InstantVibesBar.test.tsx src/components/ui/BottomInputDock.test.tsx \
  src/store/store.test.ts src/store/transportSlice.test.ts src/audio/synthPresets.test.ts \
  src/store/projectSlice.test.ts src/store/engineSync.test.ts .claude/rules/testing.md
git commit -m "$(cat <<'EOF'
test(store): replace hand-rolled store resets with testUtils.resetStore()

Fourteen files reimplemented the same "reset to creation-time defaults"
setState call, each restating a subset of the same values. Every value
checked against its slice's own initial state and replaced with the
shared resetStore() helper; testing.md documents the convention.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
EOF
)"
```

---

### Task 4: Replace the four file-level `no-explicit-any` disables

**Files** (all under `src/audio/`, unchanged by Phase 3):
- Modify: `src/audio/testFakes.ts`
- Modify: `src/audio/engine.test.ts`
- Modify: `src/audio/clock.test.ts`
- Modify: `src/audio/playback/presetPreview.test.ts`
- Modify: `.claude/rules/testing.md`

**Interfaces:**
- Consumes: `EngineInstance` (already exported from `testFakes.ts`).
- Produces: `export function asEnginePrivate(engine: EngineInstance): EnginePrivate` and
  `export interface EnginePrivate { ... }` from `src/audio/testFakes.ts`, used by all three test
  files instead of `(engine as any)` / `(audioEngine as any)`.

All four files disable the same rule for the same reason: the engine class isn't exported (it's
a singleton), so tests reach private fields via a cast. Fixing the type means naming that
private surface once, in one interface, instead of casting to `any` at each of the ~210 call
sites across the three test files.

- [ ] **Step 1: Enumerate the private surface these tests actually touch**

Run:
```bash
grep -ohE "\((?:engine|audioEngine) as any\)\.[A-Za-z_]+" src/audio/engine.test.ts src/audio/clock.test.ts src/audio/playback/presetPreview.test.ts | sort -u
grep -n "const \w\+ = (?:engine|ctx) as any;" src/audio/engine.test.ts
```
Expected (first command): a sorted list including at least `activeVoices`, `analyser`,
`clockBpm`, `clockNextStepTime`, `clockStepIndex`, `clockTick`, `compressor`, `ctx`,
`delayFeedbackGain`, `delayGain`, `delayNode`, `distortionNode`, `drumBusFilter`,
`drumFilterCutoff`, `drumFilterResonance`, `drumFilterType`, `drumKit`, `drumSendFilter`,
`dryGain`, `eqLowNode`, `impulseCache`, `impulseCacheSampleBudget`, `limiter`, `masterGain`,
`maxVoiceLifetimeMs`, `maxVoicesPerSource`, `playMetronomeClick`, `reshapeableVoices`,
`reverbGain`, `reverbNode`, `setupMasterChain`, `sourceAnalysers`, `sourceBuses`,
`sourceVoices`, `stopClockTimer`. `engine.test.ts` additionally rebinds
`const e = engine as any;` in many tests and continues with `e.<property>` — the second command
finds those aliasing lines so their properties get folded into the same enumeration by hand
(read the ~15 lines after each match).

- [ ] **Step 2: Add the typed accessor to `testFakes.ts`**

Type every member conservatively: where the exact runtime shape is a `Map`/`Set`/`GainNode`/
`BiquadFilterNode` etc. used elsewhere in the same file, give it that type; where a test only
ever narrows it further with its own `as Set<{...}>` at the call site (very common in
`engine.test.ts`, e.g. `(engine as any).sourceVoices.get('chord') as Set<{...}>`), type the
member `unknown` here and let the existing per-call-site `as` narrow it — that per-site cast is
not `any`, so it needs no disable.

```typescript
// src/audio/testFakes.ts — add near the top, after the EngineInstance export

/**
 * The engine's private surface that tests reach into. The engine class is
 * not exported (singleton pattern), so there is no public type for these
 * fields — this interface is that type, kept in one place instead of an
 * `any` cast at every call site.
 */
export interface EnginePrivate {
  ctx: unknown;
  masterGain: unknown;
  limiter: unknown;
  compressor: unknown;
  analyser: unknown;
  dryGain: unknown;
  delayNode: unknown;
  delayGain: unknown;
  delayFeedbackGain: unknown;
  reverbNode: unknown;
  reverbGain: unknown;
  distortionNode: unknown;
  eqLowNode: unknown;
  drumBusFilter: unknown;
  drumSendFilter: unknown;
  drumFilterCutoff: unknown;
  drumFilterResonance: unknown;
  drumFilterType: unknown;
  drumKit: unknown;
  sourceBuses: unknown;
  sourceVoices: unknown;
  sourceAnalysers: unknown;
  activeVoices: unknown;
  reshapeableVoices: unknown;
  impulseCache: unknown;
  impulseCacheSampleBudget: unknown;
  maxVoiceLifetimeMs: unknown;
  maxVoicesPerSource: unknown;
  clockBpm: unknown;
  clockStepIndex: unknown;
  clockNextStepTime: unknown;
  clockTick: (...args: unknown[]) => unknown;
  stopClockTimer: (...args: unknown[]) => unknown;
  setupMasterChain: (...args: unknown[]) => unknown;
  playMetronomeClick: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

/** Casts through `unknown`, not `any` — every member above is still typed. */
export function asEnginePrivate(engine: EngineInstance): EnginePrivate {
  return engine as unknown as EnginePrivate;
}

/** Same bridge for a fake node or fake AudioContext reached the same way. */
export function asPrivate<T = Record<string, unknown>>(x: object): T {
  return x as unknown as T;
}
```

The `[key: string]: unknown` index signature is a deliberate safety net: Step 1's enumeration is
best-effort, and any property this plan missed still type-checks (as `unknown`) instead of
silently reverting to `any`. If `tsc` later complains that a specific access needs a concrete
type (e.g. calling `.get()` on a `Map`), narrow that one property's declared type in
`EnginePrivate` rather than casting at the call site with `any`.

- [ ] **Step 3: Replace the casts in `clock.test.ts` and `presetPreview.test.ts`** (the two
  files with no `const e = engine as any` rebinding — every cast is a direct
  `(engine as any).x` or `(audioEngine as any).x`)

Run:
```bash
sed -i '' \
  -e "s/(engine as any)/asEnginePrivate(engine)/g" \
  -e "s/(audioEngine as any)/asEnginePrivate(audioEngine)/g" \
  src/audio/clock.test.ts src/audio/playback/presetPreview.test.ts
```
Then add `import { asEnginePrivate } from './testFakes';` (`clock.test.ts` already imports
`makeEngine`/`fakeCtx` from `./testFakes` — add `asEnginePrivate` to that same import line) and
`import { asEnginePrivate } from '../testFakes';` to `presetPreview.test.ts` (one directory
deeper, under `src/audio/playback/`). Delete the file-level `/* eslint-disable
@typescript-eslint/no-explicit-any ... */` comment block at the top of both files.

- [ ] **Step 4: Replace the casts in `engine.test.ts`** (the large file, including the
  `const e = engine as any;` rebinding pattern)

Run:
```bash
sed -i '' \
  -e "s/(engine as any)/asEnginePrivate(engine)/g" \
  -e "s/(ctx as any)/asPrivate(ctx)/g" \
  -e "s/(n as any)/asPrivate(n)/g" \
  -e "s/const e = engine as any;/const e = asEnginePrivate(engine);/g" \
  -e "s/const c = ctx as any;/const c = asPrivate(ctx);/g" \
  src/audio/engine.test.ts
```
Add `asEnginePrivate, asPrivate` to the existing `import ... from './testFakes'` line. Delete
the file-level disable comment. The remaining bare `: any` annotations this sed does not touch
(callback parameters like `(e: any) => e.t === t0`, and `const n: any = mk('compressor');`) are
few — fix each individually:
- `const n: any = mk('compressor');` and similar → give it the fake node's actual return type
  (check `mk`'s return type in the same file; if `mk` isn't already typed, type its return as
  the concrete fake-node shape rather than reaching for `any` here too).
- `(e: any) => e.t === t0 + 0.01` and `(e: any) => e.v)` (`.gain.events.find`/`.map` callbacks)
  → these operate on `fakeParam`'s recorded `events` array; import and use its element type
  (check `fakeParam`'s definition in `testFakes.ts` for the events array's element type and
  annotate the callback parameter with it instead of `any`).
- `Set<any>` (e.g. `Array.from((engine as any).sourceVoices.get('bass') as Set<any>)`) → replace
  `any` with `unknown` (`Set<unknown>`) unless the immediately following code narrows it
  further, in which case give it that narrower type directly.
- `spyOn(engine as any, 'reshapeableVoices')` → `spyOn(asEnginePrivate(engine),
  'reshapeableVoices')`.

- [ ] **Step 5: Fix `testFakes.ts`'s own constructor cast**

```diff
-export const makeEngine = () => new (audioEngine.constructor as any)() as EngineInstance;
+export const makeEngine = () =>
+  new (audioEngine.constructor as new () => EngineInstance)() as EngineInstance;
```
Delete the file-level disable comment.

- [ ] **Step 6: Type-check and iterate**

Run: `bun run lint`
Expected: `tsc` errors, if any, name exactly which `EnginePrivate` member needs a narrower type
than `unknown` (e.g. "Property 'get' does not exist on type 'unknown'"). For each error, narrow
that one member's declared type in `EnginePrivate` (Step 2) to the concrete type the call site
needs (a `Map<string, ...>`, a `GainNode`, etc.) and re-run. Repeat until clean. Do not add a
new `any` anywhere in this loop — narrowing `EnginePrivate` is always possible because every
member starts at `unknown`, the safe default.

Run: `bun run eslint`
Expected: `no-explicit-any` no longer fires in any of the four files; zero file-level disable
comments remain in `src/`.

- [ ] **Step 7: Run the touched tests**

Run: `bun test src/audio/engine.test.ts src/audio/clock.test.ts src/audio/playback/presetPreview.test.ts src/audio/testFakes.ts`
Expected: every test passes — the sed replacements are behaviourally inert (same runtime cast,
different compile-time type), so a failure here means a property was missed by Step 1's
enumeration and the sed left a bare `(engine as any)` behind; re-run Step 1's grep to confirm
zero remaining matches before investigating further.

- [ ] **Step 8: Confirm no file-level directive remains anywhere in `src/`**

Run: `grep -rn "eslint-disable " src`
Expected: no output.

- [ ] **Step 9: Update `.claude/rules/testing.md` to ban file-level disables**

Add, at the end of the "The audio engine harness" section:

```markdown
`asEnginePrivate()` / `asPrivate()` (also exported from `testFakes.ts`) are the only sanctioned
way to reach the engine's private fields from a test — they cast through `unknown`, never
`any`, so no `no-explicit-any` disable is needed. **No file-level `eslint-disable` in `src/`.**
If a specific line genuinely cannot be typed, disable that rule on that line with a reason
(`// eslint-disable-next-line rule-name -- reason`); a file-level directive silences the rule
for code nobody has looked at yet.
```

- [ ] **Step 10: Verify and commit**

Run: `bun run verify`
Expected: green.

**Bounded fallback for this step only.** Steps 1-9 are the one place in this plan that cannot
be a fixed diff — `EnginePrivate`'s member list is discovered by the compiler, not written
ahead of time. If `bun run lint` still fails here after three passes of the Step 6 loop, do not
keep iterating and do not widen a member back to `any`. Instead put the whole escape hatch on
the single helper:

```ts
export function asEnginePrivate(engine: EngineInstance): EnginePrivate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the engine class is not
  // exported (module-level singleton), so its private surface has no nameable type; the cast
  // is confined to this one line and every call site goes through the typed EnginePrivate.
  return engine as any as EnginePrivate
}
```

That is spec-compliant (`no-explicit-any` goes line-level with a reason, or the type is fixed
— the spec accepts either), it removes all four file-level directives just the same, and it
bounds a task that would otherwise expand without a stopping rule. Record which route was taken
in the commit body.

```bash
git add src/audio/testFakes.ts src/audio/engine.test.ts src/audio/clock.test.ts \
  src/audio/playback/presetPreview.test.ts .claude/rules/testing.md
git commit -m "$(cat <<'EOF'
refactor(audio): type the engine's private test surface instead of any

asEnginePrivate()/asPrivate() cast through unknown to a named
EnginePrivate interface; every (engine as any).x access across the
three test files goes through it. Removes the last four file-level
no-explicit-any disables in src/.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
EOF
)"
```

---

### Task 5: `CLAUDE.md` — rewrite the architecture section

**Files:**
- Modify: `CLAUDE.md` (the `## Architecture` section)

**Interfaces:**
- Consumes / Produces: docs only.

- [ ] **Step 1: Replace the `## Architecture` section**

Replace everything from `## Architecture` up to (not including) `## Testing — the one trap
worth knowing up front` with:

```markdown
## Architecture

Single-page audio workstation ("Solna"): four tab views (Synth, Sequencer, Chords, Effects) that
stay mounted simultaneously (`activeTab` toggles `block`/`hidden` in `src/app/App.tsx`) so audio
never stops when switching tabs. **Consequence:** state that lives in a store slice or high in
the tree re-renders *every* mounted view, not just the visible one. High-frequency state — the
current playback step, a value being dragged on a knob — must therefore stay local to the
subtree that shows it, never in a slice.

**Five layers, enforced by eslint `no-restricted-imports`/`no-restricted-syntax`:**

1. `src/audio/` — never imports `store/`, `features/`, `ui/` or `app/`. Pure DSP + a single
   `audioEngine` singleton built on the **raw Web Audio API** (no Tone.js; `tonal` is used for
   theory only). All engine setters no-op until `init()` creates the `AudioContext`.
2. `src/store/` — never imports `features/`, `ui/` or `app/`. One Zustand store composed from
   slices under `store/slices/` (`transport`, `musicContext`, `synth`, `chords`, `bass`,
   `sequencer`, `effects`, `ui`, `presets`, `loop`, `project`), with `persist` (key
   `musibox_project_state_v1`, `partialize` + `migrate` under `store/persist/`) and
   `subscribeWithSelector`. Project-file I/O and format live under `store/project/`
   (`projectFile`, `projectFormat`, `projectFingerprint`, `projectDirty`, `projectStore`,
   `projectStoreIdb`). `store.ts`, `engineSync.ts`, `useLiveStore.ts`, `testUtils.ts` and the
   cross-cutting helpers (`instantVibes`, `vibe*`, `midiInput`, `playbackScope`, `songMode`,
   `customStepSequencer`) stay at the `store/` root. Bump the persist `version` and add a
   migration step whenever the persisted shape changes.
3. `src/ui/` — presentation-only primitives (`Knob`, `Slider`, `Field`, `fieldClasses`,
   `PowerToggle`, `StepRow`, `StepHeader`, `BeatDots`, `ChannelStrip`, `PresetLibrary`,
   `QuickSavePopover`, `ViewHeader`, `viewMeta`, `VuMeter`, `Modal`, `ConfirmDialog`,
   `IconButton`, `ModuleHeader`, `PanelCard`). Never imports `store/` or `features/` — eslint
   enforces this at `error`. `VuMeter` (and `app/AudioVisualizer.tsx`, `app/AmbientBackdrop.tsx`)
   are the read-only analyser exemptions: routing a per-frame analyser read through the store
   would mean a store write on every animation frame and a re-render of every subscriber, so
   they read `audioEngine` directly instead.
4. `src/features/` — one folder per feature (`synth`, `chords`, `lead`, `sequencer`, `song`,
   `project`, `input`, `transport`, `midi`, `vibes`), each importing `@/ui/*`, `@/store/*` and
   `@/utils/*` only — never another feature's folder. A feature does not import `audio/engine`
   directly; that stays behind `store/engineSync.ts`. No forced `logic/`/`ui/` subfolder inside
   a feature — add one only past ~10 files.
5. `src/app/` — the shell: `App.tsx`, `Header.tsx`, `TabButton.tsx`, `ScaleSelects.tsx`,
   `AudioVisualizer.tsx`, `AmbientBackdrop.tsx`, `UpdateBanner.tsx`, `Wordmark.tsx`.

Cross-folder and cross-layer imports use the `@/` alias (`@/store/...`, `@/ui/...`,
`@/audio/...`); relative imports are for same-folder siblings only — eslint bans `../../` at
`error`. Components are `export function X(props: XProps)` with `interface XProps`; no
`React.FC`, no `type Props = {...}`.

**`persist` serialises on every `set()`; only the `localStorage` write is coalesced.** Every
`set()` that touches a key returned by `partialize` re-serialises that slice on the spot. The
write itself goes through `utils/coalescedStorage.ts`, which buffers it to an idle callback and
flushes on `pagehide`/`visibilitychange` — so the serialise cost is still per-`set()`, and
anything driven by a pointer, a clock tick or an animation frame must not write persisted state
directly. Consequence for tests and for reading `localStorage` in a live page: storage lags the
store by up to one idle window; call `flushPersistedWrites()` before asserting on it.

**The store→engine bridge** is `src/store/engineSync.ts`: one `subscribeWithSelector`
subscription per engine-settable value with `fireImmediately`, started once by `useEngineSync()`
in `src/app/App.tsx`. The `AudioContext` is created on the first user click, after which
`applyEngineSnapshot()` re-applies the whole persisted audio state. **Never call engine setters
from a component** — add the state to a slice and wire it in `engineSync.ts`.

**Storage access is always guarded.** `localStorage` can *throw* (Safari private mode, blocked
cookies, embedded webviews), not just return null — `store/store.ts` falls back to an
in-memory `StateStorage`, and helpers like `Header.tsx`'s theme functions take an injectable
storage param and read it *inside* a `try`, never in a default-parameter expression.

**Three storage zones, not two.** `localStorage` holds the live session (persist, above);
`sessionStorage` nothing; and **IndexedDB holds the saved project library**, reached only
through `store/project/projectStore.ts`. That wrapper resolves availability *once, lazily* and
turns every failure into a typed result — a device that cannot store projects is a **normal
degraded state the UI renders, never an exception path**, the same discipline `resolveStorage()`
follows. Bodies and metadata live in **separate object stores** so listing the library never
deserialises a single project body; every write touches both in one transaction. A **project
body is the content set only** (see `PROJECT_CONTENT_KEYS` in `store/project/projectFormat.ts`)
— view, session and library state are excluded by construction — and its `formatVersion` is
deliberately **independent of the persist `version`**: that one bumps for private `localStorage`
reshapes, this one only when the content contract changes, and the persist migration chain must
never be used to read a project body.

**`dirty` is derived, never persisted.** One idle pass fingerprints the content set and compares
it to the project's baseline (or, untitled, to the default project) — see
`store/project/projectDirty.ts`; computing it per `set()` would fingerprint the whole
arrangement on every knob tick. Because hydration runs synchronously *inside* `create()`, before
the tracker exists, `store/store.ts` schedules **one pass at boot** — that pass is what makes a
reloaded session honest, and without it a restored session with unsaved work gets no badge and
no dirty guard.
```

- [ ] **Step 2: Check nothing else in the repo still describes the old three-layer tree as current**

Run: `grep -rn "src/components/\|Three layers, enforced" CLAUDE.md docs/design.md README.md 2>/dev/null`
Expected: no hits inside `CLAUDE.md` itself (`docs/design.md` and `README.md` are handled by
Task 6 / are out of scope and may still legitimately reference historical paths — this check is
only confirming `CLAUDE.md`'s own rewritten section is internally consistent).

- [ ] **Step 3: Verify and commit**

Run: `bun run verify`
Expected: green — this task touches no source.

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude-md): rewrite architecture for the five-layer tree

app/features/ui/store/audio replaces the three-layer
audio/store/components description; layering rules, storage zones,
persist and dirty-tracking sections restated by their Phase 3 paths.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
EOF
)"
```

---

### Task 6: `docs/design.md` — deduplicate §4/§5 against `CLAUDE.md`

**Files:**
- Modify: `docs/design.md` (§4 item 2's vibe-id table, §5 in full)

**Interfaces:**
- Consumes / Produces: docs only.

- [ ] **Step 1: Confirm what §5 currently says**

Run: `sed -n '/^## 5\. Audio Engine/,/^## 6\./p' docs/design.md`
Expected: three bullets (Audio Synthesis / State Management / Persistence) plus a "Resolved:
the forked Instant Vibes module" subsection — this whole section duplicates `CLAUDE.md`'s
architecture section and is stale (no mention of the IndexedDB project library `CLAUDE.md`
already documents).

- [ ] **Step 2: Replace §5 with a pointer**

```diff
-## 5. Audio Engine & State Persistence
-
-- **Audio Synthesis**: Hand-rolled on the **raw Web Audio API** — a single `audioEngine`
-  singleton (`src/audio/engine.ts`) owning the `AudioContext`, the voice pool, the parallel
-  effect sends and the shared 16th-note clock. There is no Tone.js; `tonal` is a music-theory
-  dependency only.
-- **State Management**: Zustand store (`src/store/`) managing transport, synth patches, chord
-  progressions, drum patterns, and master effects in real-time.
-- **Persistence**: Local storage and project JSON export/import workflows allowing creators to
-  save and load their musical sketches effortlessly.
-
-### Resolved: the forked Instant Vibes module
-
-`src/audio/instantVibes.ts` was a diverged copy of `src/store/instantVibes.ts`
-with no production importer — only its own test file loaded it. The
-`2026-08-24-murva-restructure` plan already called for deleting it after the
-move to `store/`; that step was never carried out, so the fork stayed behind
-and drifted: its drum-pattern keys were `Kick`/`Snare`/`HiHat` where the engine
-reads `kick`/`snare`/`hihat`, and it named a `Velvet EP` preset that no longer
-exists anywhere in the codebase. Its test suite passed the whole time, on data
-nothing shipped.
-
-Both files are now deleted. `src/store/instantVibes.ts` is the only copy, and
-the two `no-restricted-imports` errors the fork raised (`audio/` must not import
-`store/`) are gone with it. The engine-init block and the extra effect
-parameters it carried (`delayTime`, `chorusWet`/`Rate`/`Depth`) were never
-audible and are recoverable from git history if they are ever wanted.
+## 5. Audio Engine & State Persistence
+
+See `CLAUDE.md`'s Architecture section for the layer boundaries, the store→engine bridge, the
+persist/dirty/storage-zone rules and the project-file format — that is the one place this is
+kept current; restating it here duplicated it and the copy went stale (it never mentioned the
+IndexedDB project library CLAUDE.md documents). The forked `audio/instantVibes.ts` this section
+used to describe resolving is gone; the trap that remains — the vibe **ids** drifting from
+their display names — is recorded once, in §4 item 2, not here.
```

- [ ] **Step 3: Deduplicate the vibe-id table in §4 item 2**

Run: `sed -n '/^2\. \*\*`InstantVibesBar/,/one copy to keep correct\./p' docs/design.md`
Expected: the id/display-name table plus its closing line — this is the copy `CLAUDE.md`'s
"Traps recorded in the spec" section also carries verbatim. Since `CLAUDE.md` already states
the rule and the table, and §4 is a numbered *component* inventory (not a rules doc), keep §4's
prose pointer short and let `CLAUDE.md` be the one place with the table:

```diff
 2. **`InstantVibesBar.tsx`**: Quick-start genre and mood presets (`Lo-Fi Chill`, `Synthwave 80s`, `Cyber EDM`, `Deep Ambient`, `Boom Bap`, `Zen Garden`) allowing instant loading of complete harmonic and rhythmic templates.

-   > **Ids drift from display names — do not "fix" this.** Four vibe ids predate their current labels. Project files persist the id, so renaming an id silently breaks every saved project that references it.
-   >
-   > | id (persisted) | display name |
-   > |---|---|
-   > | `lofi-chill` | Lo-Fi Chill |
-   > | `synthwave-80s` | Synthwave 80s |
-   > | `cyber-dance` | **Cyber EDM** |
-   > | `ambient-chill` | **Deep Ambient** |
-   > | `hiphop-groove` | **Boom Bap** |
-   > | `asian-zen` | **Zen Garden** |
-   >
-   > The table lives in `src/store/instantVibes.ts`. It used to be duplicated in an `audio/` fork; that fork is gone, so there is one copy to keep correct.
+   > **Ids drift from display names — do not "fix" this.** See `CLAUDE.md`'s "Traps recorded
+   > in the spec" section for the id/display-name table; the table itself lives in
+   > `src/store/instantVibes.ts`.
```

- [ ] **Step 4: Confirm `CLAUDE.md` actually still carries the table this points to**

Run: `grep -n "cyber-dance\|Cyber EDM" CLAUDE.md`
Expected: a match inside `CLAUDE.md`'s "Traps recorded in the spec" section (`## Traps recorded
in the spec — don't "fix" these`, unaffected by Task 5 — that section is below `## Architecture`
and this plan does not touch it). If it is missing for any reason, restore it there before
pointing `design.md` at it — a pointer to a table that doesn't exist is worse than the
duplicate it replaced.

- [ ] **Step 5: Verify and commit**

Run: `bun run verify`
Expected: green — docs only.

```bash
git add docs/design.md
git commit -m "$(cat <<'EOF'
docs(design): dedupe §4/§5 against CLAUDE.md

§5 becomes a pointer to CLAUDE.md's Architecture section, which was
the more current and complete copy; §4's vibe-id table is kept in one
place (CLAUDE.md's Traps section) instead of two.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
EOF
)"
```

---

### Task 7: Move the dependency-upgrade research doc

**Files:**
- Rename: `docs/dependency-upgrade-research.md` → `docs/research/dependency-upgrade-research.md`

**Interfaces:**
- Consumes / Produces: docs only.

- [ ] **Step 1: Confirm the destination directory exists**

Run: `ls docs/research/`
Expected: a listing (the directory already holds other research docs); if it doesn't exist,
`mkdir -p docs/research` first.

- [ ] **Step 2: Move with `git mv` so history follows**

```bash
git mv docs/dependency-upgrade-research.md docs/research/dependency-upgrade-research.md
```

- [ ] **Step 3: Check nothing links to the old path**

Run: `grep -rln "dependency-upgrade-research" --include='*.md' . | grep -v '^\./docs/research/dependency-upgrade-research.md'`
Expected: no output, or only mentions inside other plan/spec files describing history (leave
those — they describe what was true when they were written, per this repo's own comment rule
in `components.md`, Task 1). If a currently-live doc (e.g. a README index) links the old path,
update that link in this same commit.

- [ ] **Step 4: Verify and commit**

Run: `bun run verify`
Expected: green — docs only, but the gate is run for consistency with every other task.

```bash
git add docs/dependency-upgrade-research.md docs/research/dependency-upgrade-research.md
git commit -m "$(cat <<'EOF'
docs(research): move dependency-upgrade-research.md into docs/research/

Groups it with the other research docs instead of sitting alone at
the docs/ root.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr
EOF
)"
```

Note: `git add` on a `git mv`-produced rename stages the rename as one change even though two
paths are listed; if your git version requires only the destination path, `git add
docs/research/dependency-upgrade-research.md` alone is sufficient — `git status` after `git mv`
already shows it staged.

---

## Self-review

**Spec coverage** — every Phase 4 item maps to a task:

| Spec item | Task |
| --- | --- |
| 1. `.claude/rules/components.md` | 1 |
| 2. `testUtils.ts` `resetStore()`, replace the copies, ban file-level `eslint-disable` | 2, 3, 4 |
| 3. `CLAUDE.md` architecture rewrite | 5 |
| 4. `docs/design.md` §5 pointer, §4 vibe-id dedup | 6 |
| 5. `git mv` the research doc | 7 |
| Acceptance: `verify` green | every task's last step |
| Acceptance: `grep -rn "eslint-disable " src` empty | 4 |
| Acceptance: `grep -rln "setState(.*getInitialState" src --include='*.test.*'` returns only `testUtils.ts` | 2 (creates the one match), 3 (removes the only other candidates — none existed under this exact pattern, confirmed in Measurements) |

**Placeholder scan** — no "TBD", "add appropriate", or "similar to Task N" (Task 3's 14 steps
each carry the file's actual current body, not a cross-reference); Task 4's compiler-driven
loop (Step 6) is a concrete, runnable process, not a placeholder — it names the exact failure
mode ("Property 'x' does not exist on type 'unknown'") and the exact fix (narrow that member),
which is standard practice for a type this wide.

**Name consistency** — `resetStore()` (Task 2) is the name every Task 3 step imports;
`asEnginePrivate()`/`asPrivate()`/`EnginePrivate` (Task 4) are used consistently across
`testFakes.ts`, `engine.test.ts`, `clock.test.ts` and `presetPreview.test.ts`; `EnginePrivate`'s
member list in Task 4 Step 2 matches Task 4 Step 1's enumeration.

**Known limitation stated in-plan** — Task 4's `EnginePrivate` interface types most members
`unknown` rather than their precise runtime shape, with an index signature as a safety net;
Step 6 describes the compiler-driven refinement loop that narrows individual members as real
`tsc` output demands it, rather than this plan guessing every property's exact type in advance
(the enumeration script in Step 1 over-collects on generic method/property names like `get`,
`set`, `keys`, `value` when following the `const e = engine as any;` rebinding pattern, so a
hand-verified list was used instead of a fully automated one — Step 6 is where any gap surfaces
and gets fixed, not silently left as `any`).

**Conflict with the spec, and my ruling** — the spec's *Measurements* table names three files
for the file-level `eslint-disable` finding; the actual grep on today's tree finds a fourth,
`src/audio/testFakes.ts`, carrying the identical directive for the identical reason (it defines
`makeEngine()`, the shared constructor-cast site all three named files import). Ruling: fix all
four. The acceptance grep in the spec's own Phase 4 section (`grep -rn "eslint-disable " src`
returns no file-level directives) does not exempt a file merely because the *Measurements*
table's enumeration missed it, and leaving one directive behind would fail that grep.
