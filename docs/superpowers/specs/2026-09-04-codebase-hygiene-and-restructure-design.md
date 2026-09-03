# Codebase Hygiene and Restructure — Design

> Four phases that take the view layer from `src/components/` (grouped by page) to
> `src/features/` + `src/ui/` + `src/app/`, backed by a stricter compiler and linter and a
> small set of shared primitives. Every decision here is settled; rationale is recorded inline
> so it is not re-derived. Written 2026-09-04 against `main` (5288da1).

## Goal

Make the codebase honest about the rules it already mostly follows, then reorganise it so the
rules are enforceable by path. Three things must be true when this is done:

1. `bun run verify` runs ESLint and passes with zero errors; every rule that guards a
   convention is `error`, not `warn`.
2. A component's neighbours are the files it actually imports (feature folders), and the
   shared primitives live in one place that cannot reach back into the store.
3. Modals, confirmations, icon buttons and card headers are built from one primitive each,
   so the accessibility gaps and class-string drift measured below cannot recur.

### Non-goals

- No visual change. Class strings move into primitives; the rendered markup stays the same
  (the renderToString tests pin it).
- No audio or store behaviour change. `audio/` is untouched; `store/` is regrouped, not
  rewritten.
- No new UI library. Radix, headless-ui and similar are out (see Decisions).
- No fixing of cross-feature coupling that Phase 3 exposes; those are listed as backlog.

## Measurements (2026-09-04, `main`)

These are what the phases below respond to. They are measurements, not opinions.

| Area | Finding |
| --- | --- |
| Compiler | `tsconfig.strict.json` has `strict: false`; `tsc --noEmit --strict` yields **3 errors** (`audio/engine.ts:1263`, `loop/SynthPresetLibrary.tsx:424`, `store/projectDirty.test.ts:27`). |
| ESLint | `eslint.config.js` = js + ts `recommended`, `complexity` warn at 20, three path-based layering rules. No `react-hooks`, no `jsx-a11y`. `verify` does not run it. |
| Alias | `@/*` is declared in `tsconfig.strict.json` and `vite.config.ts` (`resolve.alias`) but used **0** times; `../../` imports: **148**. |
| a11y | 236 `<button>` vs 46 `aria-label`. ~12 icon-only buttons unlabelled: `TransportBar.tsx:95,111`, `ui/BottomInputDock.tsx:126,141`, `loop/SequencerView.tsx:297,306`, `Header.tsx:387`, `ui/MidiSettingsModal.tsx:87,230`, `loop/lead/LeadMelodyGrid.tsx:267`. |
| Dialogs | All 4 `<dialog className="modal modal-open">` sites (`ui/MidiSettingsModal.tsx:76`, `ui/PresetLibrary.tsx:386`, `project/ProjectDialogs.tsx:7`, `project/ProjectManagerModal.tsx:145`) never call `showModal()`: no focus trap, no Escape, and their `onCancel` handlers never fire (the `cancel` event only fires for modal dialogs). |
| Native prompts | `confirm()`/`alert()` at `loop/SynthPresetLibrary.tsx:153,199,439` and `loop/ChordPresetLibrary.tsx:178,244,514`, while `project/ProjectDialogs.tsx` already has `DeleteConfirmDialog`. |
| Class drift | `flex items-center justify-between border-b border-base-300 pb-2` ×9; `text-xs font-bold text-base-content flex items-center gap-1.5` ×10; `card bg-panel border border-base-300 shadow-md` ×4; icon-button variants ×9 (e.g. `btn btn-xs btn-square btn-ghost border border-base-300` ×4). `FIELD_LABEL` lookalikes at `ui/PresetLibrary.tsx:400,413`, `loop/synth/ArpeggiatorPanel.tsx:47`, `loop/synth/FilterPanel.tsx:30`. |
| Component style | `React.FC` in **46** files vs plain function in 9; `interface XProps` 32 vs `type` 2. Store reads are uniformly `useAppStore(s => s.x)` (213 sites, zero object selectors) with `getState()` in handlers. |
| Duplicates | `utils/projectFile.ts` and `store/projectFile.ts` share a basename. `bpm: 120` in `store/projectFormat.ts:91` and `store/transportSlice.ts:103`. |
| Comments | Task/phase references at `project/ProjectManagerModal.tsx:77`, `audio/data/vibeEffectChains.ts:94`, `audio/data/vibeDrumPatterns.ts:110`. |
| Tests | Store reset reimplemented in ~20 test files (`useAppStore.setState` in a `beforeEach`; 3 under the name `resetStore`: `song/ArrangeView.test.tsx:14`, `loop/LoopSelector.test.tsx:12`, `store/loadLoop.test.ts:15`). File-level `eslint-disable no-explicit-any` in `engine.test.ts:8`, `clock.test.ts:6`, `presetPreview.test.ts:7`. |
| Docs | `design.md` §5 duplicates the CLAUDE.md architecture section and is stale (no IndexedDB library); §4 duplicates the vibe-id trap. |

## Decisions

All final. Do not add options.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | Component style is `export function X(props: XProps)` with `interface XProps`; named exports; no `React.FC`. | The codebase is already 32:2 on `interface` and the 9 plain-function files are the newest. `React.FC` adds nothing under `react-jsx` and hides the props type behind a generic. |
| D2 | `@/` alias for every cross-layer or cross-folder import (`@/store/...`, `@/ui/...`, `@/audio/...`); relative imports only within the same feature folder. ESLint bans `../../`. | 148 `../../` paths break on every move; Phase 3 is a move. The alias is already configured in both tsconfig and Vite. |
| D3 | ESLint additions are limited to: `eslint-plugin-react-hooks` (`rules-of-hooks` error, `exhaustive-deps` warn), `eslint-plugin-jsx-a11y` recommended, `@typescript-eslint/consistent-type-definitions: interface`, `no-restricted-syntax` banning `React.FC` and `confirm`/`alert`/`prompt`, `no-restricted-imports` banning `../../`. **No import ordering.** | Each rule guards a measured defect. Import ordering guards nothing measured and generates churn on every move. |
| D4 | **No Radix** or other headless library. | Surface is 4 dialogs, 1 popover, 2 daisyUI dropdowns, 0 tab primitives, native selects. Native `<dialog>` already provides focus trap + Escape once `showModal()` is called. daisyUI styles by class; Radix styles by `data-state`, which would mean a second styling vocabulary for four components. |
| D5 | New rules land as `warn` in Phase 1 and flip to `error` in the phase that fixes the offending code. | `verify` must stay green at every phase boundary; a rule that errors on code nobody has touched yet blocks unrelated work. |
| D6 | `audio/` and `store/` remain layers. Only the view layer becomes feature-based. | `engineSync`, `partialize`, `projectDirty` and `PROJECT_CONTENT_KEYS` are cross-cutting: every feature's state passes through them. Layering ESLint is path-based, so a layer must be a path. |
| D7 | No forced `logic/` / `ui/` subfolders inside a feature. Add `logic/` only when a feature exceeds ~10 files. | Most features are 3–7 files; a subfolder for two files is a click for nothing. |
| D8 | `utils/projectFile.ts` is renamed to `utils/projectFileIO.ts`. | Read both: `store/projectFile.ts` owns the format (`parseProjectFile`, `serializeProject`, MIME/extension constants); `utils/projectFile.ts` owns browser I/O (`downloadTextFile`, `readFileAsText`, `projectFileName`). "IO" names what the utils file does and leaves the format file's name alone, which has more importers. Its one non-test importer is `project/ProjectManagerModal.tsx`. |
| D9 | `DEFAULT_BPM` lives in `store/transportSlice.ts` and `store/projectFormat.ts` imports it. | The transport slice is the runtime owner of `bpm`; the factory project content must match the slice default, so it reads the same constant rather than restating it. |

## Phase 1 — Tooling

**Scope.** Compiler and linter become honest; nothing in `src/` moves.

**Changes.**

1. `tsconfig.strict.json`: `strict: true`, drop `noImplicitAny: false`. Fix the 3 errors listed
   above.
2. `eslint.config.js`: add `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y` (devDeps),
   and the rules in D3. All new rules at `warn` except `react-hooks/rules-of-hooks`, which is
   `error` from the start (there are no violations to fix; a violation is a bug).
3. `package.json`: `verify` becomes
   `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`.
4. `@/` alias: already present in `tsconfig.strict.json` (`paths`) and `vite.config.ts`
   (`resolve.alias`). Confirm, do not re-add. `bun test` resolves `paths` from tsconfig
   natively, so no test-runner configuration is needed. Nothing is rewritten to `@/` in this
   phase; the `../../` ban is `warn`.
5. `store/transportSlice.ts`: `export const DEFAULT_BPM = 120;` used by the slice initial
   state and by `factoryProjectContent()` in `store/projectFormat.ts` (D9).
6. `git mv src/utils/projectFile.ts src/utils/projectFileIO.ts` (+ test), update the importer
   (D8).
7. Remove the three task/phase comments; where the comment carried a reason, keep the reason
   and drop the reference ("closing would unmount it" stays; "per the Task 12 review finding"
   goes).
8. Leave the `complexity` warning on `song/SortableLoopCard.tsx`.

**Acceptance.** `bun run verify` green with zero ESLint errors. Warnings are expected and
counted in the PR description so Phases 2–3 can show them going to zero.

**Warn vs error at end of Phase 1.** Error: the three existing layering rules,
`react-hooks/rules-of-hooks`. Warn: everything else new.

## Phase 2 — Primitives in `ui/`

**Scope.** Five primitives, one popover fix, one guard extension. All still under
`src/components/ui/` (Phase 3 moves them). Each primitive replaces every current copy of its
role in the same PR; a primitive with zero call sites is not done.

**Changes.**

| Primitive | Contract | Replaces |
| --- | --- | --- |
| `Modal` | `open: boolean`, `onClose: () => void`, `title`, `children` rendered inside `modal-box`, optional `size`. Holds a `ref<HTMLDialogElement>`; an effect calls `showModal()` when `open` flips true and `close()` when false. `onClose` is bound to the native `close` event so Escape, the backdrop form and the header `IconButton` all go through one path. Never renders `modal-open`. | The 4 `<dialog className="modal modal-open">` sites. `ProjectDialogs.tsx`'s `Shell` is deleted. |
| `ConfirmDialog` | Built on `Modal`. `title`, `message`, `confirmLabel`, `danger?: boolean`, `onConfirm`, `onCancel`. Lifted from `DeleteConfirmDialog`, which becomes a thin call. | The 4 `confirm()` calls. The 2 `alert()` calls become inline `role="alert"` notices in the preset libraries. |
| `IconButton` | `label: string` (required; emitted as both `aria-label` and `title`), `icon`, `size: 'xs' \| 'sm' \| 'md'`, `variant: 'ghost' \| 'outline' \| 'primary' \| 'error'`, `active?`, plus native button props. | The ~12 unlabelled icon buttons and the 9 hand-written icon-button class variants. |
| `ModuleHeader` | `badge?`, `icon?`, `title`, `right?: ReactNode`. Renders the `flex items-center justify-between border-b border-base-300 pb-2` row with the `text-xs font-bold ... gap-1.5` title. | 9 header rows + 10 title spans. |
| `PanelCard` | `tint?: ModuleTint`, `children`, `className?`. Renders `card bg-panel border border-base-300 shadow-md` plus the module tint class. | 4 card shells. |

- `ui/QuickSavePopover.tsx`: close on Escape, return focus to the trigger on close.
- `ui/fieldClasses.test.ts`: extend the guard to regex over `src/` for hand-written
  `FIELD_LABEL` and `SECTION_HEADER` lookalikes (`text-[10px] text-base-content/60`,
  `text-xs font-bold uppercase tracking-wider`) outside `fieldClasses.ts`; fix the 4 leaks.
- Every primitive gets a `renderToString` test per `.claude/rules/testing.md`. `Modal`'s test
  asserts the markup only; `showModal()` is exercised by a pure helper (`syncDialogOpen(el,
  open)`) tested with a stub object, since there is no DOM.

**Acceptance.** `bun run verify` green. `grep -rn "confirm(\|alert(\|modal-open" src` returns
nothing outside `ui/Modal.tsx`'s own comment. Every `<button>` whose only child is an icon
carries `aria-label`.

**Warn vs error at end of Phase 2.** Flip to error: `no-restricted-syntax` (confirm/alert/
prompt), all `jsx-a11y` rules. Still warn: `React.FC` ban, `../../` ban,
`consistent-type-definitions`, `exhaustive-deps`.

## Phase 3 — Restructure

**Scope.** One mechanical commit: `git mv`, import rewrite, `React.FC` → function, ESLint
globs. No logic change; the diff is reviewable as "moves plus renames" only.

**File mapping.** Destination chosen by who imports the file (measured with grep, non-test
importers).

| Current (`src/components/…` unless noted) | Destination | Reasoning |
| --- | --- | --- |
| `src/App.tsx`, `Header.tsx`, `AudioVisualizer.tsx`, `ui/AmbientBackdrop.tsx`, `ui/UpdateBanner.tsx`, `ui/Wordmark.tsx` | `src/app/` | App shell. `UpdateBanner`, `Wordmark` are imported only by `App`/`Header`. `AudioVisualizer`/`AmbientBackdrop` are the analyser exemptions. |
| split out of `Header.tsx`: `TabButton`, `ScaleSelects` | `src/app/TabButton.tsx`, `src/app/ScaleSelects.tsx` | Already separate components at `Header.tsx:56,88`; `ProjectNameLabel` (`:141`) moves to `features/project`. |
| `loop/SynthView.tsx`, `loop/SimpleSynthPanel.tsx`, `loop/SynthPresetLibrary.tsx`, `loop/synth/*` | `features/synth/` | |
| `loop/ChordView.tsx`, `loop/ChordPresetLibrary.tsx`, `loop/chord/*` | `features/chords/` | `SortableChordCard` imports `BeatDots` (cross-feature, see backlog). |
| `loop/lead/*` | `features/lead/` | |
| `loop/SequencerView.tsx`, `loop/sequencer/*`, `sequencerGrid.ts`, `playbackStep.ts`, `playerStop.ts`, `useSequencerPlayback.ts` | `features/sequencer/` | `playbackStep`/`sequencerGrid` are imported by `SequencerGrid` and `LeadMelodyGrid`; the sequencer owns them, lead imports across (backlog). |
| `loop/LoopPage.tsx`, `loop/LoopSelector.tsx`, `song/*` (`ArrangeView`, `EffectsRackView`, `SongPage`, `SortableLoopCard`, `arrangeStep`, `loopIdKey`), `fxDescriptors.ts` | `features/song/` | `LoopSelector` is loop-library UI used by `Header`; it belongs with the arrangement, not the shell. `fxDescriptors` has one importer, `EffectsRackView`. |
| `project/*`, `ProjectNameLabel` from `Header.tsx` | `features/project/` | |
| `ui/BottomInputDock.tsx`, `ui/Keyboard.tsx` (+ tests), `ui/DrumPadGrid.tsx`, `loop/DrumPads.tsx`, `useInputDeck.ts` | `features/input/` | `DrumPadGrid` and `Keyboard` are imported by `BottomInputDock` and `useInputDeck`; `DrumPads.tsx` is imported only by `DrumPadGrid`. `SynthView` importing `Keyboard` is cross-feature (backlog). |
| `TransportBar.tsx`, `ui/PlayerTransport.tsx`, `PlayheadReadout.tsx`, `ui/NowNextChord.tsx`, `usePlayheadSync.ts`, `meterSelect.ts` | `features/transport/` | `PlayerTransport` and `PlayheadReadout` are imported by `TransportBar`/`Header`; `NowNextChord` only by `PlayheadReadout`. `meterSelect` is also imported by the sequencer and chord panels (backlog). |
| `ui/MidiSettingsModal.tsx`, `ui/MidiIndicator.tsx` | `features/midi/` | Both read `store/midiInput`. |
| `InstantVibesBar.tsx`, `vibeActions.ts` | `features/vibes/` | `vibeActions` has one importer. |
| `ui/Knob`, `ui/Slider`, `ui/Field`, `ui/fieldClasses`, `ui/PowerToggle`, `ui/StepRow`, `ui/StepHeader`, `ui/BeatDots`, `ui/ChannelStrip`, `ui/PresetLibrary`, `ui/QuickSavePopover`, `ui/ViewHeader` + `viewMeta.ts`, `ui/VuMeter`, and the Phase 2 primitives | `src/ui/` | None import `store/` (verified by grep). `VuMeter` keeps its analyser exemption. `StepRow`/`StepHeader`/`ChannelStrip` are used by sequencer *and* chords, so they are shared primitives rather than sequencer files. |
| `ui/useLiveStore.ts` | `src/store/useLiveStore.ts` | It imports the store, so it cannot live in `ui/`; it is a store-read helper, sibling of `useAppStore`. |
| `appChildMemo.test.tsx`, `viewMeta.test.ts` | follow their subject | |
| `src/store/*` | `src/store/slices/` (the 11 slices, `initialState`, `types`), `src/store/persist/` (`store.ts` stays at root; `migrate`, `sanitize`, `loop`, `loadLoop`, `loopSync`), `src/store/project/` (`projectFile`, `projectFormat`, `projectFormatMigrate`, `projectFingerprint`, `projectDirty`, `projectStore`, `projectStoreIdb`) | Regrouping only; still one layer. `engineSync`, `instantVibes*`, `vibe*`, `midiInput`, `playbackScope`, `songMode`, `customStepSequencer` stay at the root. |
| `src/audio/`, `src/utils/`, `src/routing/`, `src/pwa/` | unchanged | |

**Same-commit rewrites.**

- `React.FC` → `export function X(props: XProps)` in the 46 files; `type XProps =` → `interface`
  in the 2 files.
- All `../../` imports → `@/`. Same-folder imports stay relative.
- `eslint.config.js`: layering rule 3 glob becomes `src/{features,ui,app}/**`; rules 1 and 2
  ban `**/features/**`, `**/ui/**`, `**/app/**` instead of `**/components/**`. Exemption list
  updated to the new paths of `AudioVisualizer`, `AmbientBackdrop`, `VuMeter`.
- New rules: `src/ui/**` may not import `**/store/**` or `**/features/**` (**error** — verified
  clean by the mapping above); `src/features/X/**` may not import `src/features/Y/**` (**warn**
  — the known violations are listed in the backlog, not fixed here).
- Flip to error: `React.FC` ban, `../../` ban, `consistent-type-definitions`.
- `.claude/rules/testing.md` and `theming.md` path globs updated.

**Acceptance.** `bun run verify` green. `git log --stat` for the commit shows renames (R) for
every moved file — no file is deleted and recreated. `grep -rn "React.FC\|from '\.\./\.\./" src`
returns nothing. Cross-feature warnings are enumerated in the PR body.

## Phase 4 — Rules and docs

**Changes.**

1. `.claude/rules/components.md`, scoped `src/{features,ui,app}/**`: store-read pattern
   (`useAppStore(s => s.x)`, `getState()` in handlers, `useLiveStore` for renderToString-
   sensitive reads), component style (D1), the list of `ui/` primitives with their prop
   contracts, the `fieldClasses` tokens, feature boundaries (a feature imports `@/ui`,
   `@/store`, `@/utils`; never another feature), and the comment rule: a comment explains why
   the code is the way it is *now*, never what it used to be or which task changed it.
2. `.claude/rules/testing.md`: add `src/store/testUtils.ts` `resetStore()` (a real module:
   `useAppStore.setState(useAppStore.getInitialState(), true)` plus the per-slice extras the
   ~20 copies had accumulated), replace the copies, and ban file-level `eslint-disable`
   (`no-explicit-any` goes line-level with a reason, or the type is fixed).
3. `CLAUDE.md`: architecture section rewritten for `app/features/ui/store/audio`; the
   "`verify` does not include eslint" note removed; layering rules restated by the new paths.
4. `docs/design.md`: §5 becomes a pointer to CLAUDE.md; §4 keeps only what CLAUDE.md does not
   say (the vibe-id trap is deduplicated to one home).
5. `git mv docs/dependency-upgrade-research.md docs/research/`.

**Acceptance.** `bun run verify` green. `grep -rn "eslint-disable " src` returns no file-level
directives. `grep -rln "setState(.*getInitialState" src --include='*.test.*'` returns only
`store/testUtils.ts`.

## Target directory layout

```
src/
  app/        App, Header, TabButton, ScaleSelects, AudioVisualizer, AmbientBackdrop,
              UpdateBanner, Wordmark
  features/   synth/ chords/ lead/ sequencer/ song/ project/ input/ transport/ midi/ vibes/
  ui/         Knob, Slider, Field, fieldClasses, PowerToggle, StepRow, StepHeader, BeatDots,
              ChannelStrip, PresetLibrary, QuickSavePopover, ViewHeader, viewMeta, VuMeter,
              Modal, ConfirmDialog, IconButton, ModuleHeader, PanelCard
  store/      store.ts, engineSync, useLiveStore, testUtils, vibes/midi/scope helpers,
              slices/  persist/  project/
  audio/      unchanged
  utils/ routing/ pwa/ types/   unchanged (utils/projectFileIO renamed)
```

Import direction: `app → features → ui`, everything → `store → audio`, everything → `utils`.
`ui/` reaches neither `store/` nor `features/`. Features do not reach each other.

## ESLint rule matrix

| Rule | Introduced | Warn | Error |
| --- | --- | --- | --- |
| layering 1–3 (existing, path-based) | — | — | already |
| `react-hooks/rules-of-hooks` | P1 | — | P1 |
| `react-hooks/exhaustive-deps` | P1 | P1 | stays warn (backlog) |
| `jsx-a11y` recommended | P1 | P1 | P2 |
| `no-restricted-syntax`: `confirm`/`alert`/`prompt` | P1 | P1 | P2 |
| `no-restricted-syntax`: `React.FC` | P1 | P1 | P3 |
| `no-restricted-imports`: `../../` | P1 | P1 | P3 |
| `@typescript-eslint/consistent-type-definitions: interface` | P1 | P1 | P3 |
| `ui/` may not import `store/` or `features/` | P3 | — | P3 |
| `features/X` may not import `features/Y` | P3 | P3 | backlog |
| `complexity` 20 (existing) | — | already | never (SortableLoopCard accepted) |

## Testing

- Every phase ends with `bun run verify`, which from Phase 1 includes `bun run eslint`.
- Phase 2 primitives: one `renderToString` test each, asserting single literal class strings
  per `.claude/rules/testing.md`. `Modal` open/close logic is a pure helper tested with a stub
  `{ open, showModal, close }` object.
- Phase 2 guard: `fieldClasses.test.ts` regex sweep over `src/` for label/header lookalikes.
- Phase 3 is verified by the existing suite: since no logic changes, every test moves with its
  subject and passes unchanged apart from import paths. A `git diff --stat` with no
  non-rename edits outside `eslint.config.js`, import lines and `React.FC` signatures is the
  review criterion.
- Phase 4: `store/testUtils.ts` gets its own test proving `resetStore()` restores creation-time
  state including `loops`, `activeLoopId`, `currentProjectId` and `dirty`.
- `bun run eslint` is also run standalone after each phase to catch unused imports left by
  deletions (the reason CLAUDE.md warned about it).

## Out of scope / backlog

- Radix or any headless UI library (D4).
- Import ordering (D3).
- Splitting `audio/engine.test.ts` (2516 lines) and `store/store.test.ts` (1149 lines).
- `song/SortableLoopCard.tsx` complexity warning.
- DSP magic numbers in `audio/`.
- `react-hooks/exhaustive-deps` to error.
- Cross-feature imports surfaced in Phase 3, to be resolved one at a time afterwards:
  `chords/SortableChordCard → ui/BeatDots` (fine, `ui/`), `lead/* → sequencer/{playbackStep,
  sequencerGrid, playerStop}`, `synth/SynthView → input/Keyboard`, `chords/*` and
  `sequencer/SequencerView → transport/meterSelect`, `chords/AdjustSynthButton` used by
  `ChordView` only (fine). Likely resolutions: `playbackStep`/`sequencerGrid`/`meterSelect`
  move to `ui/` or `utils/` if store-free, else a small `features/sequencer/index.ts` public
  surface.
- `loop/DrumPads.tsx`: only importer is `DrumPadGrid`; check whether it is reducible to a
  constants file.

## Risks

| Risk | Mitigation |
| --- | --- |
| `strict: true` surfaces more than 3 errors once `noImplicitAny: false` is removed. | Measured with `--strict` on the CLI, which already implies `noImplicitAny`; the count is 3. If the tsconfig run differs, fix in the same PR — do not reintroduce the override. |
| `showModal()` changes behaviour: a modal dialog blocks the page behind it and stacks by call order. `ProjectDialogs` stack above `ProjectManagerModal`. | Nested `showModal()` is supported by the platform; the later call sits on top. Verified manually in the Phase 2 PR with the dirty-guard flow. |
| `jsx-a11y` recommended flags patterns beyond icon buttons (e.g. `onClick` on `div`, `autoFocus`). | These are real findings; fix or line-disable with a reason in Phase 2. `autoFocus` in dialogs is kept and disabled with a reason: it is the correct focus target for a modal. |
| Phase 3's single commit is large; a bad merge conflict would be expensive. | Land Phases 1–2 first; do Phase 3 on a fresh branch from `main` in one sitting; no other branch open during it. Use `git mv` so history follows. |
| `bun test` path alias resolution differs from Vite in some edge case. | `bun test` reads `paths` from `tsconfig.json`; a smoke test importing `@/store/store` is added in Phase 1 and runs in `verify`. |
| `resetStore()` centralisation changes what a test starts from (some copies reset only part of the state). | The shared helper resets *everything*; tests that relied on partial reset are fixed to set what they need explicitly. This is the intended outcome. |
| Class-string primitives drift again. | `fieldClasses.test.ts` regex sweep (Phase 2) is extended to `ModuleHeader` and `PanelCard` strings; a hand-written copy fails `verify`. |
