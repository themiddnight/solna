# Phase 3 — Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the view layer from `src/components/` (grouped by page) to `src/app/` + `src/features/<feature>/` + `src/ui/`, regroup `src/store/` into `slices/` + `persist/` + `project/`, rewrite every cross-folder import to the `@/` alias, replace `React.FC` with plain functions, and re-express the ESLint layering rules by the new paths so the architecture is enforced by path rather than by convention.

**Architecture:** The risk in this phase is not the destination — it is the transition. A single 200-file move that rewrites 600 import specifiers by hand cannot be reviewed and cannot be bisected. So the phase is decomposed into three kinds of task, in this order: (1) **preparation** — normalise every cross-folder import to `@/` while nothing has moved, so an importer's text stops depending on the importer's location; (2) **content rewrites** — `React.FC`, `type`→`interface`, the `Header.tsx` split, the `DEFAULT_BPM` constant — each in its own commit while paths are still the familiar ones; (3) **moves** — one task per destination directory, each `git mv` plus a scripted specifier rewrite, each ending green. Because step (1) has already made every cross-folder specifier alias-based, a move task's rewrite touches only a handful of files (measured: 8 specifiers in 4 files for `features/synth`, against 592 for the initial sweep).

**Tech Stack:** Bun (tests + scripts), Vite + React 19, TypeScript 5 with `strict: true`, ESLint flat config via `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`. One throwaway Bun codemod, kept **outside** the repo at `/tmp/solna-codemod/`.

**Spec:** `docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md` — sections *Goal*, *Decisions* (D1, D2, D6, D7, D9), *Phase 3 — Restructure*, *Target directory layout*, *ESLint rule matrix*, *Testing*, *Out of scope / backlog*.

## Global Constraints

Copied from the spec; every task's requirements implicitly include this section.

- **D1** — Component style is `export function X(props: XProps)` with `interface XProps`; named exports; no `React.FC`.
- **D2** — `@/` alias for every cross-layer or cross-folder import (`@/store/...`, `@/ui/...`, `@/audio/...`); relative imports only within the same feature folder. ESLint bans `../../`.
- **D6** — `audio/` and `store/` remain layers. Only the view layer becomes feature-based.
- **D7** — No forced `logic/` / `ui/` subfolders inside a feature. Add `logic/` only when a feature exceeds ~10 files.
- **D9** — `DEFAULT_BPM` lives in `store/transportSlice.ts` and `store/projectFormat.ts` imports it.
- Spec, *Phase 3 — Scope*: "No logic change; the diff is reviewable as 'moves plus renames' only."
- Spec, *Target directory layout*: import direction is `app → features → ui`, everything → `store → audio`, everything → `utils`. `ui/` reaches neither `store/` nor `features/`. Features do not reach each other.
- Spec, *Phase 3 — Acceptance*: "`bun run verify` green. `git log --stat` for the commit shows renames (R) for every moved file — no file is deleted and recreated. `grep -rn "React.FC\|from '\.\./\.\./" src` returns nothing. Cross-feature warnings are enumerated in the PR body."
- Spec, *Testing*: "Phase 3 is verified by the existing suite: since no logic changes, every test moves with its subject and passes unchanged apart from import paths."
- Spec, *Non-goals*: no visual change; no audio or store behaviour change; no new UI library; cross-feature coupling that this phase exposes is **not** fixed here.
- **`bun run verify` must be green at the end of every task.** It is `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`.
- **Every move uses `git mv`.** A step that writes a new file and deletes the old one fails the acceptance criterion. Never `git add -A`; stage files by name.
- **The mechanical commits stay logic-free.** A commit that moves files or rewrites import specifiers contains no other change. Content rewrites (`React.FC`, `type`→`interface`, the `Header.tsx` split, `DEFAULT_BPM`) each get their own commit, before the moves.
- **No file-level `eslint-disable`.** If a rule fires, fix the code or disable one line with a reason.
- Tests are `bun:test`; there is no DOM and no testing-library (`.claude/rules/testing.md`).
- Every commit message ends with the two trailer lines shown in each task.

---

## Measured baseline (2026-09-04, `main` at `3b944f5`)

Re-measured for this plan; where a number differs from the spec's *Measurements* table, the spec was measured differently and the number below is the one to trust.

| Quantity | Value | How |
| --- | --- | --- |
| Tests | 1732 pass, 0 fail, 128 files | `bun test` |
| ESLint | 0 errors, **358** warnings | `bun run eslint` |
| — `no-restricted-syntax` | 307 (244 `../../` + 57 `React.FC` + 6 `confirm`/`alert`) | breakdown by rule id |
| — `jsx-a11y/*` | 41 | 29 `label-has-associated-control`, 6 `no-autofocus`, 4 `click-events-have-key-events`, 1 `no-static-element-interactions`, 1 `no-noninteractive-element-interactions` |
| — `react-hooks/exhaustive-deps` | 6 | stays `warn` (spec backlog) |
| — `@typescript-eslint/consistent-type-definitions` | 3 | `audio/engine.ts:16`, `audio/testFakes.ts:17`, `components/song/SortableLoopCard.tsx:50` |
| — `complexity` | 1 | `song/SortableLoopCard.tsx`, accepted forever |
| `React.FC` | **46 files, 57 sites** | `grep -rln "React\.FC\|: FC<" src` — matches the spec's 46 |
| `../../` imports | **235** `from '../../` / `from "../../` in 80 files under `src/`, plus 9 in `.claude/skills/instant-vibes/scripts/vibe-inventory.ts`; ESLint reports **244** | the spec's "148" counted single-quoted specifiers only |
| `@/` imports today | **0** | `grep -rn "from '@/" src` |
| Relative specifiers under `src/components` + `src/store` | 312 `./…`, 310 `../…` | these are what the codemod rewrites |

**Phase 2 lands first.** By the time this plan runs, the 6 `confirm`/`alert` warnings and the 41 `jsx-a11y` warnings are gone (fixed, and the rules flipped to `error`), so the expected starting baseline for Phase 3 is **≈311 warnings**: 244 `../../` + 57 `React.FC` + 6 `exhaustive-deps` + 3 `consistent-type-definitions` + 1 `complexity`. Phase 2 also adds five primitives under `src/components/ui/` (`Modal`, `ConfirmDialog`, `IconButton`, `ModuleHeader`, `PanelCard`) plus their tests; Task 8 moves them with the rest of `ui/`, and Task 8 Step 1 re-lists the directory rather than trusting this plan's file list.

**Expected end state:** 0 errors, **7 warnings** (6 `exhaustive-deps` + 1 `complexity`), both explicitly backlogged by the spec.

---

## Deviations from the spec

Each was found by measuring the tree the spec describes. Read these before starting; two of them change what a task does.

**V1 — `playbackStep.ts` and `sequencerGrid.ts` go to `src/ui/`, not `features/sequencer/`.**
The spec creates a rule "`src/ui/**` may not import `**/store/**` or `**/features/**` (**error** — verified clean by the mapping above)". It is not clean. Under the spec's own mapping, `src/ui/StepRow.tsx` and `src/ui/StepHeader.tsx` each import both `playbackStep` and `sequencerGrid`, which the mapping sends to `features/sequencer/` — four `ui → features` violations that would make the new `error` rule fail `verify` on the commit that introduces it. Both modules are pure: `playbackStep.ts` imports only `react`, `sequencerGrid.ts` imports only `@/utils/meter`. Neither touches the store or the engine. They are imported by `ui/StepRow`, `ui/StepHeader`, `features/sequencer/SequencerGrid`, `features/lead/LeadMelodyGrid`, `features/lead/useLeadPlayback`, `features/chords/useChordPlayback`, `features/chords/BassModulePanel` and `features/chords/ChordModulePanel` — which is exactly the criterion the spec used to put `StepRow`/`StepHeader`/`ChannelStrip` in `ui/` ("used by sequencer *and* chords, so they are shared primitives rather than sequencer files"), and exactly the resolution the spec's own backlog proposes ("`playbackStep`/`sequencerGrid`/`meterSelect` move to `ui/` or `utils/` if store-free"). They are store-free. They move to `src/ui/`. `playerStop.ts`, `useSequencerPlayback.ts` and `meterSelect.ts` are **not** moved — they stay where the spec's table puts them, and their cross-feature edges are recorded in Task 20's allowlist.

**V2 — the `features/X → features/Y` ban ships as a test guard, not as an ESLint `warn` rule.**
ESLint flat config replaces a rule's options **wholesale** per file — the same constraint the spec already documented for `no-restricted-syntax` in Phase 2 — and a rule id carries one severity per file set. `src/features/**` must keep the existing `**/audio/engine` ban at **error** (layering rule 3, load-bearing). Adding a second `no-restricted-imports` block for `src/features/synth/**` at `warn` would replace that block for those files and silently downgrade the engine ban to a warning. There is no third rule id available: `no-restricted-syntax` is global and flips to `error` in Task 7, and D3 forbids adding `eslint-plugin-import` (which has `no-restricted-paths` and would solve this). So the cross-feature guard is a `bun:test` source scan with a frozen allowlist (Task 20) — a strictly stronger ratchet than a warning, because a **new** cross-feature import fails `verify` instead of adding to a list nobody reads. Task 19 Step 5 proves the override behaviour on a probe so a reviewer can see the constraint rather than take it on trust. The 11 accepted edges are enumerated in Task 20.

**V3 — there are 12 slices, not 11.** The spec (and CLAUDE.md) say "the 11 slices". `src/store/*Slice.ts` is: `bass`, `chords`, `effects`, **`lead`**, `loop`, `musicContext`, `presets`, `project`, `sequencer`, `synth`, `transport`, `ui`. `leadSlice.ts` is the one both lists omit. All 12 move to `store/slices/`.

**V4 — `consistent-type-definitions` has 3 violations, 2 of them in `src/audio/`.** The spec says "`type XProps =` → `interface` in the 2 files" as part of the view-layer rewrite. The actual sites are `src/audio/engine.ts:16` (`type SynthVoice`), `src/audio/testFakes.ts:17` (`export type FakeOpts`) and `src/components/song/SortableLoopCard.tsx:50` (`export type MixChannelProps`). Flipping the rule to `error` therefore requires touching two `audio/` files. That is a type-level edit with no runtime effect, so it does not break the "no audio behaviour change" non-goal, but it gets its own commit (Task 4) rather than riding along with the view-layer work.

**V5 — `React.FC` conversion is split out of the move commits.** The spec describes one commit containing moves, import rewrite and `React.FC`. Doing the `React.FC` sweep first, while files are still in `src/components/`, means every subsequent `git mv` is a byte-identical rename and `git log --stat` shows `R100` for it. Both commits are still logic-free, which is the property the "one mechanical commit" instruction exists to protect.

**V6 — `.claude/skills/instant-vibes/scripts/vibe-inventory.ts` has 9 `../../../../src/…` imports.** ESLint lints `.`, so these are 9 of the 244 `../../` warnings and would become 9 **errors** in Task 7. The file imports only from `audio/`, `store/instantVibes`, `utils/musicTheory` and `src/types` — nothing that moves — so it is untouched by the restructure, but it must be alias-ised in Task 2. The `@/` alias resolves for a script outside `src/` (verified: `bun` reads `paths` from the root `tsconfig.json` regardless of `include`).

**V7 — files the spec's mapping table does not cover.** Every file under `src/components/` is covered by a row. The uncovered files are: `src/main.tsx`, `src/index.css`, `src/types.ts`, `src/vite-env.d.ts`, `src/types/bun-test.d.ts` (all **stay** — `main.tsx` is the Vite entry named by `index.html`, and the other four are already outside the view layer); `src/store/customStepSequencer.test.ts` (the spec names `customStepSequencer` as staying at the store root, but **there is no `customStepSequencer.ts`** — the file is a test of `instantVibes` + `store` integration; it stays at the store root); and `src/store/vibeSynthPresets.test.ts`, `src/store/instantVibes*Fixture.ts`, `src/store/projectDirtyBoot.test.ts`, `src/components/playbackStep.wiring.test.ts` (all covered by the "tests follow their subject" rule the spec states for two files and clearly intends for all).

**V8 — non-source files that name moving paths.** These are not imports and no codemod finds them:
- `scripts/check-key-bindings.ts:1-2` imports `../src/components/ui/DrumPadGrid.tsx` and `../src/components/loop/SynthView.tsx`. `bun run check:keys` is in `verify`, so a miss breaks the gate.
- Six test files hard-code `src/components/...` paths and read the files off disk: `playbackStep.wiring.test.ts` (10 sites), `ui/fieldClasses.test.ts` (4 × `sourceFiles('src/components')` — Phase 2 may already have widened these to `'src'`), `useSequencerPlayback.test.ts:143`, `ui/Keyboard.test.ts:270`, `loop/lead/useLeadPlayback.test.ts:30`, `loop/chord/useChordPlayback.test.ts:363`.
- Two comments name moving paths: `src/store/migrate.ts:9`, `src/store/presetsSlice.ts:14`.
- `.claude/rules/theming.md` front matter globs `src/components/**/*`.

---

## Scope decision

One plan, one branch, 21 tasks. Land Phases 1 and 2 first; do this phase on a fresh branch from `main` in one sitting with no other branch open (spec, *Risks*). Task order:

| Tasks | What | Why here |
| --- | --- | --- |
| 1 | Confirm the `@/` alias in both toolchains; build the codemod | Nothing else works without it |
| 2 | Alias sweep — every cross-folder import becomes `@/` | Makes an importer's text independent of its location, which is what makes the move tasks small |
| 3–6 | `DEFAULT_BPM`; `consistent-type-definitions`; `Header.tsx` split; `React.FC` ×2 | Content rewrites, done while paths are still familiar |
| 7 | `no-restricted-syntax` → `error` | Both of its remaining bans are clean after Tasks 2 and 6 |
| 8–18 | The moves, one task per destination directory | Each is a `git mv` + a small scripted rewrite, each ends green |
| 19 | ESLint layering rules re-expressed by the new paths | Needs every destination to exist |
| 20 | Cross-feature guard test + the accepted-edge allowlist | Needs the features to exist |
| 21 | `.claude/rules/` globs and the stale path strings | Housekeeping the moves invalidated |

---

## File Structure

**Created (source):**

| Path | Responsibility |
| --- | --- |
| `src/app/TabButton.tsx` | The view-switch button, extracted from `Header.tsx` (Task 5, then moved in Task 9) |
| `src/app/ScaleSelects.tsx` | The two master scale selects, extracted from `Header.tsx` |
| `src/features/project/ProjectNameLabel.tsx` | The song-layer project name, extracted from `Header.tsx` |
| `src/features/crossFeature.test.ts` | The cross-feature import guard and its frozen allowlist (Task 20) |

**Created (throwaway, outside the repo):** `/tmp/solna-codemod/rewriteImports.ts` and one `.map` file per move task. Never committed; nothing under `/tmp` is linted, type-checked or staged.

**Directories created by `git mv`:** `src/app/`, `src/ui/`, `src/features/{synth,chords,lead,sequencer,song,project,input,transport,midi,vibes}/`, `src/store/{slices,persist,project}/`. `src/components/` ceases to exist at the end of Task 18.

**Modified:** `eslint.config.js` (Tasks 4, 7, 19), `src/store/projectFile.ts` and `src/store/store.ts` (Task 3), `src/audio/engine.ts` and `src/audio/testFakes.ts` (Task 4), `scripts/check-key-bindings.ts` (Tasks 15, 9), `.claude/rules/theming.md` and `.claude/rules/testing.md` (Task 21), `.claude/skills/instant-vibes/scripts/vibe-inventory.ts` (Task 2), plus every file whose import specifiers the codemod rewrites.

**Full destination map.** 179 files move. Every row is exercised by exactly one task.

| Destination | Sources (all under `src/components/` unless noted) | Task |
| --- | --- | --- |
| `src/ui/` | `ui/{Knob,Slider,Field,fieldClasses,PowerToggle,StepRow,StepHeader,BeatDots,ChannelStrip,PresetLibrary,QuickSavePopover,ViewHeader,VuMeter}` + tests, the Phase 2 primitives, `viewMeta.ts` + test, **and (V1) `playbackStep.ts` + test + `playbackStep.wiring.test.ts`, `sequencerGrid.ts` + test** | 8 |
| `src/store/` | `ui/useLiveStore.ts` | 8 |
| `src/app/` | `src/App.tsx` + test, `Header.tsx` + test, `AudioVisualizer.tsx` + test, `appChildMemo.test.tsx`, `ui/{AmbientBackdrop,UpdateBanner,Wordmark}` + tests, `TabButton.tsx`, `ScaleSelects.tsx` | 9 |
| `src/features/synth/` | `loop/{SynthView,SimpleSynthPanel,SynthPresetLibrary}` + tests, `loop/synth/*` (7 files) | 10 |
| `src/features/chords/` | `loop/{ChordView,ChordPresetLibrary}` + tests, `loop/chord/*` (9 files) | 11 |
| `src/features/lead/` | `loop/lead/*` (6 files) | 12 |
| `src/features/sequencer/` | `loop/SequencerView` + test, `loop/sequencer/*` (3 files), `playerStop.ts` + test, `useSequencerPlayback.ts` + test | 13 |
| `src/features/song/` | `loop/LoopPage.tsx`, `loop/LoopSelector` + test, `song/*` (10 files), `fxDescriptors.ts` + test | 14 |
| `src/features/project/` | `project/*` (8 files), `ProjectNameLabel.tsx` | 15 |
| `src/features/input/` | `ui/BottomInputDock` + test, `ui/Keyboard.tsx` + `Keyboard.test.ts` + `Keyboard.tokens.test.tsx`, `ui/DrumPadGrid` + test, `loop/DrumPads` + test, `useInputDeck.ts` + test | 16 |
| `src/features/transport/` | `TransportBar` + test, `PlayheadReadout.tsx`, `ui/PlayerTransport` + test, `ui/NowNextChord` + test, `usePlayheadSync.ts` + test, `meterSelect.ts` + test | 17 |
| `src/features/midi/` | `ui/MidiSettingsModal.tsx`, `ui/MidiIndicator.tsx` | 18 |
| `src/features/vibes/` | `InstantVibesBar.tsx` + test, `vibeActions.ts` | 18 |
| `src/store/slices/` | the 12 `*Slice.ts` (V3) + their 6 tests, `initialState.ts`, `types.ts` | 18 |
| `src/store/persist/` | `migrate`, `sanitize`, `loop`, `loadLoop`, `loopSync` + their 5 tests | 18 |
| `src/store/project/` | `projectFile`, `projectFormat`, `projectFormatMigrate`, `projectFingerprint`, `projectDirty`, `projectStore`, `projectStoreIdb` + 6 tests | 18 |
| unchanged | `src/audio/`, `src/utils/`, `src/routing/`, `src/pwa/`, `src/types/`, `src/main.tsx`, `src/index.css`, `src/types.ts`, `src/vite-env.d.ts`, and the store-root files (`store.ts` + test, `engineSync` + test, `instantVibes*`, `vibe*`, `midiInput`, `playbackScope`, `songMode`, `customStepSequencer.test.ts`) | — |

---

### Task 1: The `@/` alias and the codemod

The alias is already wired in **both** toolchains — this task confirms that (spec, Phase 1 item 4: "Confirm, do not re-add") and builds the one tool the move tasks depend on.

**Files:**
- Read-only: `tsconfig.strict.json:14-16`, `vite.config.ts:82-86`
- Create (outside the repo): `/tmp/solna-codemod/rewriteImports.ts`

**Interfaces:**
- Produces: `bun /tmp/solna-codemod/rewriteImports.ts <map-file>` — rewrites every import specifier under `src/` and `scripts/` to the path its target **will** have after the moves in `<map-file>`, computed from the importer's own post-move location. Same-directory targets become `./Name`; everything else becomes `@/<path under src>`. Importers outside `src/` keep relative specifiers and keep their file extension. An empty map normalises the tree without moving anything. Idempotent: running it twice is a no-op.

- [ ] **Step 1: Confirm the alias is declared in the type-checker**

Run: `grep -n -A3 '"paths"' tsconfig.strict.json`
Expected:
```
    "paths": {
      "@/*": ["./src/*"]
    }
```
`tsconfig.json` extends `tsconfig.strict.json`, so `bun run lint` and `bun test` both see it. Do not add it again.

- [ ] **Step 2: Confirm the alias is declared in the bundler**

Run: `grep -n -A4 'resolve:' vite.config.ts`
Expected:
```
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
```
If either grep comes back empty, stop: the alias is a Phase 1 deliverable and its absence means Phase 1 did not land.

- [ ] **Step 3: Write the codemod, outside the repo**

```bash
mkdir -p /tmp/solna-codemod && cat > /tmp/solna-codemod/rewriteImports.ts <<'TS'
/**
 * Rewrite import specifiers for a planned set of file moves.
 *
 * Usage:  bun /tmp/solna-codemod/rewriteImports.ts <map-file>
 *
 * The map file has one `oldPath|newDir/` line per move (paths relative to the
 * repo root, `newDir` ends with `/`). An `oldPath` ending in `/` means "every
 * file directly inside this directory". Blank lines and `#` comments are ok.
 *
 * Run it BEFORE `git mv`: it rewrites every specifier in the repo to the path
 * the target WILL have, computed from the importer's own post-move location.
 * Same-directory targets are emitted relative (`./Name`), everything else
 * through the `@/` alias. Files outside `src/` keep relative specifiers.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const mapPath = process.argv[2];
if (!mapPath) throw new Error('usage: rewriteImports.ts <map-file>');

const move = new Map<string, string>();
for (const line of readFileSync(mapPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) continue;
  const [from, toDir] = trimmed.split('|');
  if (!toDir?.endsWith('/')) throw new Error(`bad map line (destination must end in "/"): ${line}`);
  if (from.endsWith('/')) {
    for (const name of readdirSync(from)) {
      const p = join(from, name);
      if (statSync(p).isDirectory()) throw new Error(`nested directory in a directory move: ${p}`);
      move.set(p, toDir + name);
    }
  } else {
    if (!existsSync(from)) throw new Error(`map source does not exist: ${from}`);
    move.set(from, toDir + from.split('/').pop());
  }
}

/** Every candidate on-disk path a specifier could name, in resolution order. */
function candidates(base: string): string[] {
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
}

/** Repo-relative path of the module a specifier names, or null if not ours. */
function resolveTarget(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join('src', spec.slice(2));
  else if (spec.startsWith('.')) base = relative(root, resolve(dirname(join(root, fromFile)), spec));
  else return null;
  for (const c of candidates(base)) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** The specifier `importer` (at its post-move path) should use for `target`. */
function specifierFor(importerNew: string, targetNew: string, hadExtension: boolean): string {
  const stripped = hadExtension ? targetNew : targetNew.replace(/\.tsx?$/, '');
  if (!importerNew.startsWith('src/')) {
    const rel = relative(dirname(importerNew), stripped);
    return rel.startsWith('.') ? rel : `./${rel}`;
  }
  if (dirname(importerNew) === dirname(targetNew)) return `./${stripped.split('/').pop()}`;
  return `@/${stripped.slice('src/'.length)}`;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const SPEC_RE = /(from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)(['"])([^'"]+)\2/g;
let rewritten = 0;
let touched = 0;
const skipped: string[] = [];

for (const file of [...sourceFiles('src'), ...sourceFiles('scripts')]) {
  const before = readFileSync(file, 'utf8');
  const importerNew = move.get(file) ?? file;
  const after = before.replace(SPEC_RE, (whole, head: string, quote: string, spec: string) => {
    if (!spec.startsWith('.') && !spec.startsWith('@/')) return whole;
    const target = resolveTarget(file, spec);
    if (target === null) {
      skipped.push(`${file}: ${spec}`);
      return whole;
    }
    const targetNew = move.get(target) ?? target;
    const next = specifierFor(importerNew, targetNew, /\.tsx?$/.test(spec));
    if (next !== spec) rewritten += 1;
    return `${head}${quote}${next}${quote}`;
  });
  if (after !== before) {
    writeFileSync(file, after);
    touched += 1;
  }
}

console.log(`rewriteImports: ${rewritten} specifiers in ${touched} files`);
if (skipped.length > 0) {
  console.log(`unresolved (left untouched):\n  ${skipped.join('\n  ')}`);
}
TS
```

Three properties matter and are relied on by every later task:
- It preserves the original quote style and the presence or absence of a file extension, so the diff shows only the specifier.
- It handles `from '…'`, bare `import '…'`, dynamic `import('…')` and `require('…')` — the codebase has a dynamic `import("./SynthPresetLibrary")` in `SynthView.tsx` and several `typeof import('./store')` in store tests, and all of them must move with their target.
- A specifier it cannot resolve to a file on disk is **left untouched and printed**. The only expected unresolved entry in this repo is `src/audio/engine.ts: ../engine` (a string inside a comment, not an import). Any other line in that list is a real problem: read it before continuing.

- [ ] **Step 4: Dry-run the codemod against a throwaway copy**

Never validate a codemod against the working tree. Copy, run, inspect, delete:

```bash
rm -rf /tmp/phase3-probe && mkdir -p /tmp/phase3-probe
cp -R src scripts /tmp/phase3-probe/
: > /tmp/solna-codemod/empty.map
(cd /tmp/phase3-probe && bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/empty.map)
```

Expected (measured on `3b944f5`):
```
rewriteImports: 592 specifiers in 181 files
unresolved (left untouched):
  src/audio/engine.ts: ../engine
```

Run: `grep -rcE "from ['\"]\.\./" /tmp/phase3-probe/src | grep -v ':0$' | head`
Expected: no output — every `../`-prefixed specifier under `src/` is gone.

Run: `grep -n "^import" /tmp/phase3-probe/src/components/loop/SynthView.tsx | head -20`
Expected: `@/store/store`, `@/audio/synthPresets`, `@/components/AudioVisualizer`, `@/components/ui/ChannelStrip`, and `./SimpleSynthPanel` / `./synth/OscillatorPanel` still relative (same directory or below).

Run: `rm -rf /tmp/phase3-probe`

- [ ] **Step 5: Nothing to commit**

Run: `git status --porcelain`
Expected: empty. This task creates no repo file.

---

### Task 2: Alias sweep — every cross-folder import becomes `@/`

Spec D2. This is the task that makes every later move cheap: once an importer names its targets through `@/`, moving the *importer* changes nothing in its own text, and moving a *target* is a prefix substitution. Measured effect: without this sweep the `features/synth` move rewrites hundreds of specifiers; with it, 8.

**Files:**
- Modify: 181 files under `src/` (import specifiers only) via the codemod
- Modify: `.claude/skills/instant-vibes/scripts/vibe-inventory.ts:10-19` (V6)

**Interfaces:**
- Consumes: `/tmp/solna-codemod/rewriteImports.ts` from Task 1.
- Produces: no API change. Every module keeps its exports; only specifier text changes.

- [ ] **Step 1: Record the starting warning count**

Run: `bun run eslint 2>&1 | tail -2`
Expected: `✖ N problems (0 errors, N warnings)` with N ≈ 311 after Phase 2 (358 on `3b944f5`). Write N down; Step 6 checks the delta.

Run: `bun run eslint 2>&1 | grep -c "Cross-folder imports use"`
Expected: `244`.

- [ ] **Step 2: Run the sweep**

```bash
: > /tmp/solna-codemod/empty.map
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/empty.map
```

Expected: `rewriteImports: 592 specifiers in 181 files`, and the single `src/audio/engine.ts: ../engine` unresolved line.

- [ ] **Step 3: Alias-ise the skill helper script (V6)**

`.claude/skills/instant-vibes/scripts/vibe-inventory.ts` sits outside `src/` and `scripts/`, so the codemod does not walk it, but ESLint lints `.` and its 9 `../../../../src/` imports would become errors in Task 7.

```bash
perl -pi -e "s#\.\./\.\./\.\./\.\./src/#\@/#g" .claude/skills/instant-vibes/scripts/vibe-inventory.ts
```

Prove the alias resolves for a file outside `src/` by running the script it belongs to:

Run: `bun .claude/skills/instant-vibes/scripts/vibe-inventory.ts | head -5`
Expected: the genre table, starting `GENRES (scale is fixed per genre — a vibe cannot choose its own)`. (Verified: `bun` reads `paths` from the root `tsconfig.json` even for files outside `include`.)

- [ ] **Step 4: Eyeball three rewritten files before trusting 181 of them**

Run: `git diff src/store/store.ts | head -20`
Expected: `../utils/meter` → `@/utils/meter`, `../utils/coalescedStorage` → `@/utils/coalescedStorage`; the `./projectSlice`, `./projectDirty`, `./types` same-folder imports untouched.

Run: `git diff src/components/loop/SynthView.tsx | head -40`
Expected: `../../store/store` → `@/store/store`, `../AudioVisualizer` → `@/components/AudioVisualizer`, `../ui/ChannelStrip` → `@/components/ui/ChannelStrip`; `./SimpleSynthPanel` and `import("./SynthPresetLibrary")` untouched.

Run: `git diff --stat | tail -1`
Expected: `181 files changed, 593 insertions(+), 593 deletions(-)` — insertions equal deletions, which is what "only specifier text changed" looks like.

- [ ] **Step 5: Check nothing outside imports moved**

Run: `git diff -U0 src | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" | grep -vcE "(from|import|require)\s*\(?\s*['\"]"`
Expected: `0` — every changed line is an import/export/`require` line.

- [ ] **Step 6: Verify and commit**

Run: `bun run verify`
Expected: green — 1732 tests pass, `tsc --noEmit` clean, eslint 0 errors, `check:keys`, `check:drums`, build. (This exact sweep was executed end-to-end during planning: 1732 pass, `tsc` exit 0, build succeeded.)

Run: `bun run eslint 2>&1 | grep -c "Cross-folder imports use"`
Expected: `0`.

Run: `bun run eslint 2>&1 | tail -2`
Expected: `0 errors`, N − 244 warnings (114 on `3b944f5`; ≈67 after Phase 2).

Run: `grep -rnE "from ['\"]\.\./\.\./" src scripts .claude`
Expected: no output.

```bash
git add src .claude/skills/instant-vibes/scripts/vibe-inventory.ts
git commit -m "refactor(imports): route every cross-folder import through the @/ alias

593 specifier rewrites across 182 files; no other change. Decision D2:
a cross-folder import names its target through @/, a same-folder import
stays relative. This is what makes the Phase 3 moves small — after it, an
importer's text no longer depends on where the importer lives.

The 9 ../../../../src/ imports in the instant-vibes skill helper are
included: eslint lints '.', so they would otherwise error when
no-restricted-syntax flips.

eslint: 0 errors, 244 fewer warnings.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 3: `DEFAULT_BPM` at the two `clampFinite` fallbacks

Spec, *Out of scope / backlog* item picked up here, and D9. Phase 1 gave `store/transportSlice.ts` a `DEFAULT_BPM = 120` and made `projectFormat.factoryProjectContent()` read it. Two more places still restate the literal: the project-file parser's clamp fallback and the persist sanitiser's. **This is a separate, clearly-labelled commit** — it is the only task in the plan that touches a value rather than a path, and it is deliberately kept out of every mechanical commit.

**Files:**
- Modify: `src/store/projectFile.ts:5-9` (import) and `:46`
- Modify: `src/store/store.ts:41` (import) and `:176`
- Test: `src/store/projectFile.test.ts`, `src/store/store.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_BPM` from `@/store/transportSlice` (Phase 1; `export const DEFAULT_BPM = 120;` at `transportSlice.ts:12`).
- Produces: no API change. `clampFinite(value, min, max, fallback)` keeps its signature.

- [ ] **Step 1: Confirm the two sites are where this plan says they are**

Run: `grep -n "clampFinite(.*, 20, 300, 120)" src/store/projectFile.ts src/store/store.ts`
Expected exactly:
```
src/store/projectFile.ts:46:    bpm: clampFinite(c.bpm, 20, 300, 120),
src/store/store.ts:176:  sanitized.bpm = clampFinite(sanitized.bpm, 20, 300, 120);
```
If the line numbers differ, use the ones grep prints — the file contents are what matter.

- [ ] **Step 2: Pin the coupling with a test in each file**

Be honest about what this test does: substituting a constant for its own value cannot fail before the change. The test exists so that a **future** change to `DEFAULT_BPM` cannot silently leave these two fallbacks behind — it passes before and after, and the proof that the substitution landed is the grep in Step 5.

In `src/store/projectFile.test.ts`, add to the imports and then a test in the existing top-level `describe` for content parsing:

```ts
import { DEFAULT_BPM } from '@/store/transportSlice';
```

```ts
test('a missing bpm falls back to the transport slice default, not a literal', () => {
  const parsed = parseProjectFile(
    JSON.stringify({ ...validProjectFileFixture(), content: { ...validProjectFileFixture().content, bpm: undefined } }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.project.content.bpm).toBe(DEFAULT_BPM);
});
```

Use whatever fixture builder the file already has instead of `validProjectFileFixture()` if it is named differently — run `grep -n "^function\|^const .* = () =>" src/store/projectFile.test.ts` first and reuse it; do not add a second fixture.

In `src/store/store.test.ts`, add the same import and, in the describe that covers `sanitizePersistedState` (find it with `grep -n "sanitiz" src/store/store.test.ts`):

```ts
test('a non-finite persisted bpm is clamped to the transport slice default', () => {
  const sanitized = sanitizePersistedState({ bpm: Number.NaN } as Partial<PersistedState>);
  expect(sanitized.bpm).toBe(DEFAULT_BPM);
});
```

Match the sanitiser's real exported name and argument shape from the file's existing tests.

- [ ] **Step 3: Run the new tests before the change**

Run: `bun test src/store/projectFile.test.ts src/store/store.test.ts`
Expected: pass. That is the point — they document the coupling, they do not prove the edit.

- [ ] **Step 4: Replace both literals**

`src/store/projectFile.ts` — add to the existing import block near line 9:

```diff
 import { clampFinite, sanitizeEffectsValue, sanitizeLoops } from './sanitize';
+import { DEFAULT_BPM } from './transportSlice';
```

```diff
-    bpm: clampFinite(c.bpm, 20, 300, 120),
+    bpm: clampFinite(c.bpm, 20, 300, DEFAULT_BPM),
```

`src/store/store.ts` — add to the existing import block that already brings in `clampFinite` (line 41 sits inside it):

```diff
+import { DEFAULT_BPM } from './transportSlice';
```

```diff
-  sanitized.bpm = clampFinite(sanitized.bpm, 20, 300, 120);
+  sanitized.bpm = clampFinite(sanitized.bpm, 20, 300, DEFAULT_BPM);
```

`store.ts` already imports from `./transportSlice` (it composes the slice), so check with `grep -n "transportSlice" src/store/store.ts` and add `DEFAULT_BPM` to that existing import instead of writing a second one.

The other `clampFinite` fallbacks on `store.ts:177-183` (`masterVolume`, `synthVolume`, `chordVolume`, `bassVolume`, `masterSequencerVolume`, `drumFilterCutoff`, `drumFilterResonance`) are **not** touched: no slice exports a named constant for them, and inventing seven constants is a different change than the one the backlog asks for.

- [ ] **Step 5: Prove the literal is gone**

Run: `grep -rn "300, 120" src/store`
Expected: no output.

Run: `grep -rn "DEFAULT_BPM" src/store`
Expected: `transportSlice.ts` (declaration + use), `projectFormat.ts` (+ its test), `projectFile.ts` (+ its test), `store.ts` (+ its test).

- [ ] **Step 6: Verify and commit**

Run: `bun run verify`
Expected: green.

```bash
git add src/store/projectFile.ts src/store/projectFile.test.ts src/store/store.ts src/store/store.test.ts
git commit -m "refactor(store): read the default tempo from DEFAULT_BPM, not a literal 120

Decision D9 gave transportSlice ownership of the default tempo and
projectFormat already reads it; the project-file parser and the persist
sanitiser still restated 120 in their clampFinite fallbacks, so a future
change to the default would have moved the runtime and left both
recovery paths one tempo behind. Both now read the constant.

The two added tests pin the coupling rather than prove the edit — a
constant substitution cannot fail before it lands.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 4: `consistent-type-definitions` to `error`

Spec, *ESLint rule matrix*: this rule goes to `error` in P3. It has 3 violations, two of them in `src/audio/` (V4) — a type-alias-to-interface change with no runtime effect, but it touches `audio/`, so it gets its own commit and its own verify rather than riding inside a move.

**Files:**
- Modify: `src/audio/engine.ts:16`
- Modify: `src/audio/testFakes.ts:17`
- Modify: `src/components/song/SortableLoopCard.tsx:50`
- Modify: `eslint.config.js` (the `@typescript-eslint/consistent-type-definitions` line)

**Interfaces:**
- Produces: `SynthVoice`, `FakeOpts` and `MixChannelProps` become `interface`s. All three are plain object shapes with no unions, intersections, mapped or conditional types, so the declarations are equivalent to callers.

- [ ] **Step 1: Confirm the three sites**

Run: `bun run eslint 2>&1 | grep -B1 "consistent-type-definitions"`
Expected: three warnings, at `src/audio/engine.ts:16:6`, `src/audio/testFakes.ts:17:13`, `src/components/song/SortableLoopCard.tsx:50:13`. If Phase 2 introduced a fourth in a new primitive, convert it here too.

- [ ] **Step 2: Convert `src/audio/engine.ts:16`**

```diff
-type SynthVoice = {
+interface SynthVoice {
   oscs: OscillatorNode[];
   gains: GainNode[];
   filter: BiquadFilterNode;
   filterCutoff: number;
   filterRelease: number;
   lfo?: OscillatorNode;
```
…and change the closing `};` of that declaration to `}`.

- [ ] **Step 3: Convert `src/audio/testFakes.ts:17`**

```diff
 /** `cancelAndHold: false` stands in for Firefox, which has no cancelAndHoldAtTime. */
-export type FakeOpts = { cancelAndHold?: boolean };
+export interface FakeOpts {
+  cancelAndHold?: boolean;
+}
```

- [ ] **Step 4: Convert `src/components/song/SortableLoopCard.tsx:50`**

```diff
-export type MixChannelProps = {
+export interface MixChannelProps {
   idPrefix: string;
   label: string;
   volume: number;
   muted: boolean;
   max: number;
   tone: PowerToggleTone;
   sliderAccent: string;
   onVolume: (v: number) => void;
```
…and change that declaration's closing `};` to `}`.

- [ ] **Step 5: Type-check before flipping the rule**

Run: `bun run lint`
Expected: exit 0, no output. This is the step that catches the one real hazard in an alias→interface conversion: an `interface` has no implicit index signature, so a value of that type can no longer be assigned to a `Record<string, unknown>` parameter. If `tsc` complains, the fix is at the call site (spread into a fresh object literal), not a revert.

- [ ] **Step 6: Flip the rule to `error`**

In `eslint.config.js`, inside the global rules block:

```diff
       // Decision D1: `interface XProps`, never `type XProps = {...}`.
-      '@typescript-eslint/consistent-type-definitions': ['warn', 'interface'],
+      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
```

- [ ] **Step 7: Prove the rule fires at `error` on a deliberate violation**

Phase 1 shipped two selectors that matched nothing. Do not repeat that — make the rule report before believing it.

```bash
cat > src/utils/__ruleProbe.ts <<'PROBE'
export type ProbeShape = { a: number };
export const probe: ProbeShape = { a: 1 };
PROBE
bun run eslint src/utils/__ruleProbe.ts; echo "exit=$?"
rm src/utils/__ruleProbe.ts
```

Expected: one `error  Use an \`interface\` instead of a \`type\`  @typescript-eslint/consistent-type-definitions` and `exit=1`.

Run: `git status --porcelain src/utils`
Expected: empty — the probe is deleted.

- [ ] **Step 8: Verify and commit**

Run: `bun run verify`
Expected: green, 0 errors, 3 fewer warnings.

```bash
git add src/audio/engine.ts src/audio/testFakes.ts src/components/song/SortableLoopCard.tsx eslint.config.js
git commit -m "style(types): interface over type alias, and flip the rule to error

Decision D1 and the P3 column of the spec's ESLint rule matrix. The three
offenders are SynthVoice, FakeOpts and MixChannelProps — all plain object
shapes, so the declarations are equivalent to every caller and tsc is
clean. Two of them live in src/audio/, which the spec's Phase 3 note did
not anticipate; the edit is type-level only and changes no audio
behaviour.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 5: Split `Header.tsx` into its three neighbours

Spec, Phase 3 file mapping: `TabButton` and `ScaleSelects` go to `src/app/`, `ProjectNameLabel` to `features/project/`. They are already separate components inside `Header.tsx`; `git mv` cannot express "part of a file", so the extraction happens **in place, in its own commit**, and Tasks 9 and 15 then `git mv` whole files.

**Files:**
- Create: `src/components/TabButton.tsx`, `src/components/ScaleSelects.tsx`, `src/components/ProjectNameLabel.tsx`
- Modify: `src/components/Header.tsx` (remove the three declarations, import them back)
- Modify: `src/components/Header.test.tsx:4` (import path for `TabButton`, `ProjectNameLabel`)

**Interfaces:**
- Produces:
  - `src/components/TabButton.tsx` — `export const TabButton: React.FC<{ view: ViewMode; activeTab: ViewMode; onSelect: (view: ViewMode) => void; labelClassName?: string }>` (Task 6 converts it to a function; keep `React.FC` here so this commit is a pure move of text).
  - `src/components/ScaleSelects.tsx` — `export const ScaleSelects: React.FC<{ idPrefix: string; stacked?: boolean }>`. It is currently **not** exported; extraction requires exporting it.
  - `src/components/ProjectNameLabel.tsx` — `export const ProjectNameLabel: React.FC<{ layer: Layer; currentProjectId: string | null; currentProjectName: string | null }>`.
- `Header.tsx` keeps `AUTOMATION_TABS`, `SONG_NAV_TABS`, `LAYER_META`, `layerToggleTarget`, `SolnaTheme`, `resolveInitialTheme`, `readStoredTheme`, `persistTheme` and `Header` itself. `src/components/viewMeta.test.ts:3` imports `AUTOMATION_TABS, SONG_NAV_TABS` from `./Header` and is unaffected.

- [ ] **Step 1: Extract `TabButton`**

Create `src/components/TabButton.tsx` with the JSDoc block and declaration currently at `Header.tsx:46-81` (from `/**\n * One view-switch button.` through the closing `};`), plus its imports:

```tsx
import React from "react";
import { ViewMode } from "@/types";
import { VIEW_META } from "@/components/viewMeta";
```

Do not retype the component body — cut it. Its only external references are `React`, `ViewMode` and `VIEW_META`.

- [ ] **Step 2: Extract `ScaleSelects`**

Create `src/components/ScaleSelects.tsx` with the JSDoc block and declaration at `Header.tsx:83-129`, exported, plus:

```tsx
import React from "react";
import { ROOTS, SCALES } from "@/utils/musicTheory";
import { useAppStore } from "@/store/store";
```

Change `const ScaleSelects` to `export const ScaleSelects` — it was file-private and now crosses a file boundary.

- [ ] **Step 3: Extract `ProjectNameLabel`**

Create `src/components/ProjectNameLabel.tsx` with the JSDoc block and declaration at `Header.tsx:131-165`, plus:

```tsx
import React from "react";
import { Layer } from "@/types";
import { sessionLabel } from "@/components/project/projectManagerFlow";
```

Keep the JSDoc verbatim: it explains why `layer` is a prop rather than a store read (the `renderToString` creation-time-snapshot trap in `.claude/rules/testing.md`), and that reason survives the move.

- [ ] **Step 4: Import the three back into `Header.tsx`**

Delete the three declarations from `Header.tsx` and add, next to its other component imports:

```tsx
import { TabButton } from "@/components/TabButton";
import { ScaleSelects } from "@/components/ScaleSelects";
import { ProjectNameLabel } from "@/components/ProjectNameLabel";
```

Then remove any import `Header.tsx` no longer uses — `ROOTS`, `SCALES`, `sessionLabel` and possibly `Layer` become unused. `bun run eslint` reports these as `@typescript-eslint/no-unused-vars` errors, which is exactly why the gate runs it.

`TabButton` must stay **re-exported** from `Header.tsx` only if something still imports it from there; `Header.test.tsx` is the only such importer and Step 5 repoints it, so do **not** add a re-export — a barrel that exists for one test is the kind of indirection this phase removes.

- [ ] **Step 5: Repoint `Header.test.tsx`**

```diff
-import { ProjectNameLabel, TabButton, AUTOMATION_TABS, LAYER_META, layerToggleTarget, persistTheme, readStoredTheme, resolveInitialTheme, SONG_NAV_TABS } from './Header';
+import { AUTOMATION_TABS, LAYER_META, layerToggleTarget, persistTheme, readStoredTheme, resolveInitialTheme, SONG_NAV_TABS } from './Header';
+import { TabButton } from './TabButton';
+import { ProjectNameLabel } from './ProjectNameLabel';
```

- [ ] **Step 6: Prove the markup did not change**

Run: `bun test src/components/Header.test.tsx`
Expected: pass. The `TabButton rendering` and `ProjectNameLabel (song layer only)` describes assert literal class strings; if either fails, text was retyped rather than cut.

Run: `bun test src/components/appChildMemo.test.tsx src/components/viewMeta.test.ts`
Expected: pass.

- [ ] **Step 7: Verify and commit**

Run: `bun run verify`
Expected: green.

```bash
git add src/components/Header.tsx src/components/Header.test.tsx src/components/TabButton.tsx src/components/ScaleSelects.tsx src/components/ProjectNameLabel.tsx
git commit -m "refactor(header): extract TabButton, ScaleSelects and ProjectNameLabel

They are already independent components inside Header.tsx and the Phase 3
mapping sends them to three different destinations (app/, app/,
features/project/). Extracting them in place, before the moves, keeps
every later git mv a whole-file rename.

Text is cut, not retyped: Header.test.tsx's literal class-string
assertions still pass.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 6: `React.FC` → plain function (28 files with no `React.memo`)

Spec D1. Measured: **46 files, 57 sites**. This task takes the 28 files that contain no `React.memo`; Task 7 takes the 18 that do, because a memo-wrapped component converts differently and mixing the two in one review is how a `memo` gets dropped by accident. Doing both **before** the moves keeps every `git mv` at `R100`.

**Files (28) — Modify:**

`InstantVibesBar.tsx` is in Task 7. This task:

```
src/components/ui/Wordmark.tsx            src/components/ui/PlayerTransport.tsx
src/components/ui/UpdateBanner.tsx        src/components/ui/ChannelStrip.tsx
src/components/ui/ViewHeader.tsx          src/components/ui/Field.tsx
src/components/ui/PowerToggle.tsx         src/components/ui/QuickSavePopover.tsx
src/components/ui/MidiSettingsModal.tsx   src/components/ui/DrumPadGrid.tsx
src/components/project/ProjectList.tsx    src/components/project/ProjectDialogs.tsx
src/components/project/ProjectManagerModal.tsx
src/components/project/ProjectManagerModal.test.tsx
src/components/loop/ChordPresetLibrary.tsx  src/components/loop/SynthPresetLibrary.tsx
src/components/loop/DrumPads.tsx          src/components/loop/LoopSelector.tsx
src/components/loop/SequencerView.test.tsx
src/components/loop/synth/ArpeggiatorPanel.tsx  src/components/loop/synth/FilterPanel.tsx
src/components/loop/synth/EnvelopePanel.tsx     src/components/loop/synth/LfoPanel.tsx
src/components/loop/synth/OscillatorPanel.tsx
src/components/loop/lead/LeadMelodyGrid.tsx
src/components/loop/sequencer/SequencerGrid.tsx
src/components/loop/chord/ChordModulePanel.tsx
src/components/loop/chord/BassModulePanel.tsx
```

Plus `src/components/TabButton.tsx`, `src/components/ScaleSelects.tsx`, `src/components/ProjectNameLabel.tsx` created in Task 5 (they carry `Header.tsx`'s original `React.FC` annotations) — 31 files in total once Task 5 has run.

**Interfaces:**
- Produces: every listed component becomes `export function X(props)` or `export function X({ …destructured }: XProps)`. Every export keeps its **name** and its **named-export** form, so no importer changes. Props types keep their names; inline `React.FC<{…}>` generics become a named `interface XProps` (D1).

- [ ] **Step 1: Learn the four conversion patterns**

**A — named props interface, arrow body.** `src/components/ui/PlayerTransport.tsx`:

```diff
-export const PlayerTransport: React.FC<PlayerTransportProps> = ({
-  module,
-  compact,
-}) => {
+export function PlayerTransport({ module, compact }: PlayerTransportProps) {
   …
-};
+}
```

**B — expression body.** `src/components/ui/Field.tsx`:

```diff
-export const Field: React.FC<FieldProps> = ({ label, htmlFor, children }) => (
+export function Field({ label, htmlFor, children }: FieldProps) {
+  return (
     <div className="…">…</div>
-);
+  );
+}
```

**C — no props.** `src/components/loop/synth/FilterPanel.tsx`:

```diff
-export const FilterPanel: React.FC = () => {
+export function FilterPanel() {
   …
-};
+}
```

**D — inline generic, no named type.** `src/components/project/ProjectList.tsx:` the `React.FC<{ name: string; disabled: boolean; onCommit: (name: string) => void }>` declaration. D1 requires a named `interface`, and `consistent-type-definitions` (now `error`) forbids a `type` alias:

```diff
-const RenameRow: React.FC<{ name: string; disabled: boolean; onCommit: (name: string) => void }> = ({ name, disabled, onCommit }) => {
+interface RenameRowProps {
+  name: string;
+  disabled: boolean;
+  onCommit: (name: string) => void;
+}
+
+function RenameRow({ name, disabled, onCommit }: RenameRowProps) {
   …
-};
+}
```

Name the interface `<ComponentName>Props`. `src/components/project/ProjectDialogs.tsx` has **five** inline generics and is the largest single file in this task; `src/components/loop/lead/LeadMelodyGrid.tsx` has one (`React.FC<{ currentStep: number }>`).

- [ ] **Step 2: Convert the two test files, which are not components**

`src/components/loop/SequencerView.test.tsx:192`:

```diff
-    const Probe: React.FC = () => {
+    function Probe() {
       …
-    };
+    }
```

`src/components/project/ProjectManagerModal.test.tsx:5` is a `let` binding for a lazily imported component, not a declaration:

```diff
-let ProjectManagerModal: React.FC;
+let ProjectManagerModal: typeof import('./ProjectManagerModal').ProjectManagerModal;
```
That is the exact style `src/store/store.test.ts:117` already uses for its lazy store import, and it keeps the binding typed after `React.FC` is gone.

- [ ] **Step 3: Convert the 31 files**

Work file by file. Two rules that prevent the two ways this goes wrong:
- **Hoisting.** `export function X` is hoisted; `export const X = …` is not. A file that used a component *above* its declaration was previously broken and is now legal — that is fine. The reverse never happens.
- **`React` import.** After conversion a file may no longer reference `React` by name (JSX does not need it under `react-jsx`). ESLint's `no-unused-vars` catches the leftover import as an **error**; delete it. Do not delete `import React from "react"` in a file that still calls `React.useState`, `React.memo`, `React.lazy` or uses `React.ReactNode`.

- [ ] **Step 4: Prove no `React.FC` remains in this task's files**

Run: `grep -rln "React\.FC\|: FC<" src/components/ui src/components/project src/components/loop/synth src/components/loop/chord src/components/loop/sequencer src/components/loop/lead src/components/TabButton.tsx src/components/ScaleSelects.tsx src/components/ProjectNameLabel.tsx`
Expected: only `src/components/ui/VuMeter.tsx`, `src/components/ui/MidiIndicator.tsx`, `src/components/ui/StepHeader.tsx`, `src/components/ui/BottomInputDock.tsx`, `src/components/loop/sequencer/TrackRow.tsx` — the memo-wrapped files, which are Task 7's.

- [ ] **Step 5: Verify and commit**

Run: `bun run verify`
Expected: green. The `renderToString` tests are the safety net here: they assert literal markup, so a mangled destructure or a dropped prop fails immediately.

Run: `bun run eslint 2>&1 | grep -c "instead of React.FC"`
Expected: `18` — the memo files' sites, left for Task 7. (57 − 37 − 2 test sites = 18.)

```bash
git add src/components
git commit -m "refactor(components): plain function components, part 1 of 2 (no memo)

Decision D1: export function X(props: XProps), named exports, no
React.FC. 37 sites across 31 files that contain no React.memo; the 18
memo-wrapped sites follow in the next commit, where the conversion is
shaped differently.

Inline React.FC<{...}> generics become named interfaces rather than type
aliases, per D1 and consistent-type-definitions. Every export keeps its
name, so no importer changes. Markup is pinned by the renderToString
suite.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 7: `React.FC` → plain function (18 memo files), then `no-restricted-syntax` to `error`

The 18 remaining files wrap their component in `React.memo`, which must survive: `src/components/appChildMemo.test.tsx` asserts `$$typeof === Symbol.for('react.memo')` on `BottomInputDock`, `LoopPage`, `SequencerView`, `SynthView`, `ArrangeView` and `SongPage`, and the memo is a real performance decision (CLAUDE.md: every tab stays mounted, so an unmemoised view re-renders on every unrelated store write). With this task both of `no-restricted-syntax`'s remaining bans are clean, so the rule flips to `error`.

**Files (18) — Modify:**

```
src/components/Header.tsx                 src/components/TransportBar.tsx
src/components/AudioVisualizer.tsx        src/components/InstantVibesBar.tsx
src/components/ui/VuMeter.tsx             src/components/ui/MidiIndicator.tsx
src/components/ui/StepHeader.tsx          src/components/ui/BottomInputDock.tsx
src/components/song/SongPage.tsx          src/components/song/ArrangeView.tsx
src/components/song/EffectsRackView.tsx   src/components/song/SortableLoopCard.tsx
src/components/loop/ChordView.tsx         src/components/loop/SequencerView.tsx
src/components/loop/SimpleSynthPanel.tsx  src/components/loop/SynthView.tsx
src/components/loop/LoopPage.tsx          src/components/loop/sequencer/TrackRow.tsx
```
- Modify: `eslint.config.js` (`no-restricted-syntax` severity)

**Interfaces:**
- Produces: every listed export stays a `React.memo` result bound to a `const` of the same name — the memo wrapper is what the importer receives, so the binding must stay a `const`, not become a `function`. Three of these files (`Header.tsx`, `ui/StepHeader.tsx`, `song/SortableLoopCard.tsx`) also contain a **non-memo** `React.FC` site; convert those with Task 6's patterns A–D.

- [ ] **Step 1: Learn the memo conversion pattern**

The annotation is dropped and the props type moves onto the inner function's parameter. The inner function is **named** so React DevTools and the `appChildMemo` test still see a name:

```diff
-export const SynthView: React.FC = React.memo(() => {
+export const SynthView = React.memo(function SynthView() {
   …
 });
```

With props — `src/components/ui/VuMeter.tsx`:

```diff
-export const VuMeter: React.FC<VuMeterProps> = React.memo(({ isPlaying }) => {
+export const VuMeter = React.memo(function VuMeter({ isPlaying }: VuMeterProps) {
   …
 });
```

`src/components/ui/BottomInputDock.tsx` already annotates its parameter (`React.memo(({ keyboardProps, drumProps }: BottomInputDockProps) => {`); there, only the `: React.FC<BottomInputDockProps>` annotation is deleted and the arrow becomes a named function expression.

Do **not** convert `export const X = React.memo(...)` into `export function X`. `React.memo` returns an object, not a function; `appChildMemo.test.tsx` checks exactly that and would fail.

- [ ] **Step 2: Convert the 18 files**

Three files carry two sites each — `Header.tsx` (the memoised `Header` plus one plain `React.FC`), `ui/StepHeader.tsx`, `song/SortableLoopCard.tsx` (`MixChannelProps`'s `MixChannel`, plain; `SortableLoopCard`, memoised). Convert both sites in each.

Apply the same `React` import rule as Task 6 — but note that every file here still calls `React.memo`, so `import React from "react"` stays in all 18.

- [ ] **Step 3: Prove the memos survived**

Run: `bun test src/components/appChildMemo.test.tsx`
Expected: pass. This is the test that catches a dropped `React.memo`; if it fails with "React.memo wrapper exposes no inner component", a `const X = React.memo(...)` was turned into `function X`.

Run: `grep -rn "React\.FC\|: FC<" src`
Expected: no output.

- [ ] **Step 4: Flip `no-restricted-syntax` to `error`**

By now the rule holds only the two `React.FC` selectors and the three `../../` selectors (Phase 2 moved the `confirm`/`alert`/`prompt` ban out to `no-restricted-globals` + `no-restricted-properties`). Both bans are clean.

In `eslint.config.js`:

```diff
       'no-restricted-syntax': [
-        'warn',
+        'error',
```

- [ ] **Step 5: Prove both bans fire at `error`**

```bash
mkdir -p src/utils/__probe && cat > src/utils/__probe/probe.tsx <<'PROBE'
import React from 'react';
import { clampBpm } from '../../utils/musicTheory';
interface ProbeProps { on: boolean }
export const Probe: React.FC<ProbeProps> = ({ on }) => <div>{on ? clampBpm(1) : 0}</div>;
PROBE
bun run eslint src/utils/__probe/probe.tsx; echo "exit=$?"
rm -r src/utils/__probe
```

Expected: **two** errors — one "Use `export function X(props: XProps)` instead of React.FC (decision D1)." and one "Cross-folder imports use the `@/` alias (decision D2)…" — and `exit=1`. If only one fires, the other selector is not matching; fix the selector before continuing, because a rule that matches nothing is worse than no rule.

Run: `git status --porcelain src/utils`
Expected: empty.

- [ ] **Step 6: Verify and commit**

Run: `bun run verify`
Expected: green.

Run: `bun run eslint 2>&1 | tail -2`
Expected: `0 errors`, 7 warnings (6 `react-hooks/exhaustive-deps` + 1 `complexity`).

```bash
git add src/components eslint.config.js
git commit -m "refactor(components): plain function components, part 2 of 2 (memo)

The 18 files whose export is a React.memo result: the annotation goes,
the props type moves onto a NAMED inner function, and the export stays a
const bound to the memo object — appChildMemo.test.tsx asserts
\$\$typeof === Symbol.for('react.memo') on six of them, and every tab
stays mounted, so these memos are load-bearing.

With React.FC at zero and ../../ at zero since the alias sweep,
no-restricted-syntax flips to error. Both of its selectors are proven to
fire on a probe.

eslint: 0 errors, 7 warnings (6 exhaustive-deps + 1 complexity, both
backlogged).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

## The move tasks (8–18) — shared procedure

Tasks 8 through 18 are the same five steps with a different map. Read this once; each task then states only what is specific to it.

1. **Write the map** to `/tmp/solna-codemod/<name>.map` (verbatim in each task).
2. **Run the codemod** — `bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/<name>.map`. It rewrites specifiers to their post-move form. The tree does not compile between this step and step 3; that is expected.
3. **`mkdir -p` the destination and `git mv`** every file, with the exact commands given.
4. **Fix the non-import references** that name the moved paths (V8) — the task says which.
5. **`bun run verify`, then commit** files by name.

Two invariants to check in every move task:

Run: `git status --porcelain | grep -c "^R"` after the `git mv` — the count must equal the number of files the task moves. A `??` plus a ` D` pair instead of an `R` means a file was copied rather than moved, and `git log --stat` will not show the rename.

Run: `bun run eslint 2>&1 | tail -2` — must stay `0 errors, 7 warnings` for every task from 8 to 18. Task 19 is where new rules can add output.

---

### Task 8: `src/ui/` and `store/useLiveStore.ts`

`ui/` first: it is the leaf every other destination imports, so moving it first means each later task's rewrite is smaller. `useLiveStore.ts` leaves `ui/` in the same commit because it imports the store and therefore cannot live in a layer that may not (spec mapping; the Task 19 rule makes this enforced).

`playbackStep.ts` and `sequencerGrid.ts` land here rather than in `features/sequencer/` — see **V1**.

**Files:**
- Move: 20 modules + their tests from `src/components/ui/` and `src/components/` → `src/ui/`
- Move: `src/components/ui/useLiveStore.ts` → `src/store/useLiveStore.ts`

**Interfaces:**
- Produces: `@/ui/<Name>` for every shared primitive; `@/store/useLiveStore` for the store-read helper. No export is renamed.

- [ ] **Step 1: Re-list the directory before trusting this plan's file list**

Phase 2 adds five primitives (`Modal`, `ConfirmDialog`, `IconButton`, `ModuleHeader`, `PanelCard`) and their tests to `src/components/ui/`, and deletes `ProjectDialogs.tsx`'s `Shell`.

Run: `ls src/components/ui`
Expected: the files below **plus** the Phase 2 primitives and their tests. Add every Phase 2 file to the `src/components/ui/|src/ui/` map line automatically — the directory form of a map line takes whatever is there, so nothing needs listing by hand. What must be listed by hand are the files that leave `ui/` for somewhere else; those are in Tasks 9, 16, 17 and 18.

- [ ] **Step 2: Write the map**

Because most of `src/components/ui/` goes to `src/ui/` but eleven files go elsewhere, this map lists the `src/ui/` files individually rather than using the directory form.

```bash
cat > /tmp/solna-codemod/ui.map <<'MAP'
src/components/ui/Knob.tsx|src/ui/
src/components/ui/Knob.test.tsx|src/ui/
src/components/ui/Slider.tsx|src/ui/
src/components/ui/Slider.test.tsx|src/ui/
src/components/ui/Field.tsx|src/ui/
src/components/ui/fieldClasses.ts|src/ui/
src/components/ui/fieldClasses.test.ts|src/ui/
src/components/ui/PowerToggle.tsx|src/ui/
src/components/ui/PowerToggle.test.tsx|src/ui/
src/components/ui/StepRow.tsx|src/ui/
src/components/ui/StepRow.test.tsx|src/ui/
src/components/ui/StepHeader.tsx|src/ui/
src/components/ui/StepHeader.test.tsx|src/ui/
src/components/ui/BeatDots.tsx|src/ui/
src/components/ui/BeatDots.test.tsx|src/ui/
src/components/ui/ChannelStrip.tsx|src/ui/
src/components/ui/ChannelStrip.test.tsx|src/ui/
src/components/ui/PresetLibrary.tsx|src/ui/
src/components/ui/PresetLibrary.test.tsx|src/ui/
src/components/ui/QuickSavePopover.tsx|src/ui/
src/components/ui/QuickSavePopover.test.tsx|src/ui/
src/components/ui/ViewHeader.tsx|src/ui/
src/components/ui/VuMeter.tsx|src/ui/
src/components/viewMeta.ts|src/ui/
src/components/viewMeta.test.ts|src/ui/
src/components/playbackStep.ts|src/ui/
src/components/playbackStep.test.ts|src/ui/
src/components/playbackStep.wiring.test.ts|src/ui/
src/components/sequencerGrid.ts|src/ui/
src/components/sequencerGrid.test.ts|src/ui/
src/components/ui/useLiveStore.ts|src/store/
MAP
```

Append one line per Phase 2 primitive and test found in Step 1, in the same form, e.g. `src/components/ui/Modal.tsx|src/ui/`.

- [ ] **Step 3: Rewrite specifiers, then move**

```bash
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/ui.map
mkdir -p src/ui
git mv src/components/ui/Knob.tsx src/components/ui/Knob.test.tsx \
       src/components/ui/Slider.tsx src/components/ui/Slider.test.tsx \
       src/components/ui/Field.tsx \
       src/components/ui/fieldClasses.ts src/components/ui/fieldClasses.test.ts \
       src/components/ui/PowerToggle.tsx src/components/ui/PowerToggle.test.tsx \
       src/components/ui/StepRow.tsx src/components/ui/StepRow.test.tsx \
       src/components/ui/StepHeader.tsx src/components/ui/StepHeader.test.tsx \
       src/components/ui/BeatDots.tsx src/components/ui/BeatDots.test.tsx \
       src/components/ui/ChannelStrip.tsx src/components/ui/ChannelStrip.test.tsx \
       src/components/ui/PresetLibrary.tsx src/components/ui/PresetLibrary.test.tsx \
       src/components/ui/QuickSavePopover.tsx src/components/ui/QuickSavePopover.test.tsx \
       src/components/ui/ViewHeader.tsx src/components/ui/VuMeter.tsx \
       src/ui/
git mv src/components/viewMeta.ts src/components/viewMeta.test.ts \
       src/components/playbackStep.ts src/components/playbackStep.test.ts \
       src/components/playbackStep.wiring.test.ts \
       src/components/sequencerGrid.ts src/components/sequencerGrid.test.ts \
       src/ui/
git mv src/components/ui/useLiveStore.ts src/store/useLiveStore.ts
```

Add a `git mv src/components/ui/<Primitive>.tsx src/ui/` line for each Phase 2 primitive found in Step 1.

- [ ] **Step 4: Fix the hard-coded paths in `playbackStep.wiring.test.ts`**

That file names ten source paths as strings and reads them off disk (V8). Two of them are files this task moved:

```bash
perl -pi -e "s#'src/components/ui/StepRow\.tsx'#'src/ui/StepRow.tsx'#g" src/ui/playbackStep.wiring.test.ts
```

Run: `grep -n "src/components" src/ui/playbackStep.wiring.test.ts`
Expected: eight remaining paths, all naming files that later tasks move (`loop/chord/useChordPlayback.ts`, `loop/chord/ChordModulePanel.tsx`, `loop/chord/BassModulePanel.tsx`, `loop/lead/useLeadPlayback.ts`, `loop/lead/LeadMelodyGrid.tsx`, `useSequencerPlayback.ts`, `loop/sequencer/SequencerGrid.tsx`, `song/ArrangeView.tsx`). Each of Tasks 11–14 and 16 updates its own; Task 18 Step 9 asserts the file names no `src/components` path at all.

- [ ] **Step 5: Verify and commit**

Run: `git status --porcelain | grep -c "^R"`
Expected: 31 plus twice the number of Phase 2 primitives.

Run: `bun run verify`
Expected: green.

Run: `grep -rn "@/components/ui/" src | grep -vE "AmbientBackdrop|UpdateBanner|Wordmark|BottomInputDock|Keyboard|DrumPadGrid|MidiSettingsModal|MidiIndicator|PlayerTransport|NowNextChord"`
Expected: no output — everything still addressed as `@/components/ui/…` is a file a later task moves.

```bash
git add src/ui src/store/useLiveStore.ts src/components
git commit -m "refactor(ui): move the shared primitives to src/ui/

src/ui/ is the leaf layer: it is imported by app/ and by every feature and
imports neither. useLiveStore leaves with them but lands in src/store/ —
it reads the store, so it cannot live in a layer that may not.

playbackStep and sequencerGrid come here rather than to features/sequencer
as the spec's table says. Both are pure (react / utils/meter only) and are
imported by ui/StepRow, ui/StepHeader, sequencer, lead and chords — the
same 'used by two features, therefore a shared primitive' test the spec
applied to StepRow, StepHeader and ChannelStrip, and the resolution its own
backlog proposes. Leaving them in features/sequencer would make the
ui-may-not-import-features rule (Task 19) fail on four real violations.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 9: `src/app/`

The app shell: what `main.tsx` mounts, plus the two analyser consumers the spec exempts from layering rule 3. `src/main.tsx` does **not** move (V7) — it is the Vite entry named by `index.html`.

**Files:**
- Move: 13 files → `src/app/`
- Modify: `scripts/check-key-bindings.ts` — no; that one is Tasks 10 and 16. Nothing outside `src/` names an app file.

**Interfaces:**
- Produces: `@/app/App`, `@/app/Header`, `@/app/AudioVisualizer`, `@/app/AmbientBackdrop`, `@/app/UpdateBanner`, `@/app/Wordmark`, `@/app/TabButton`, `@/app/ScaleSelects`. `src/main.tsx` imports `@/app/App`.

- [ ] **Step 1: Write the map**

```bash
cat > /tmp/solna-codemod/app.map <<'MAP'
src/App.tsx|src/app/
src/App.test.tsx|src/app/
src/components/appChildMemo.test.tsx|src/app/
src/components/Header.tsx|src/app/
src/components/Header.test.tsx|src/app/
src/components/TabButton.tsx|src/app/
src/components/ScaleSelects.tsx|src/app/
src/components/AudioVisualizer.tsx|src/app/
src/components/AudioVisualizer.test.tsx|src/app/
src/components/ui/AmbientBackdrop.tsx|src/app/
src/components/ui/AmbientBackdrop.test.tsx|src/app/
src/components/ui/UpdateBanner.tsx|src/app/
src/components/ui/Wordmark.tsx|src/app/
src/components/ui/Wordmark.test.tsx|src/app/
MAP
```

- [ ] **Step 2: Rewrite specifiers, then move**

```bash
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/app.map
mkdir -p src/app
git mv src/App.tsx src/App.test.tsx src/app/
git mv src/components/appChildMemo.test.tsx \
       src/components/Header.tsx src/components/Header.test.tsx \
       src/components/TabButton.tsx src/components/ScaleSelects.tsx \
       src/components/AudioVisualizer.tsx src/components/AudioVisualizer.test.tsx \
       src/app/
git mv src/components/ui/AmbientBackdrop.tsx src/components/ui/AmbientBackdrop.test.tsx \
       src/components/ui/UpdateBanner.tsx \
       src/components/ui/Wordmark.tsx src/components/ui/Wordmark.test.tsx \
       src/app/
```

- [ ] **Step 3: Confirm the entry point still resolves**

Run: `grep -n "App" src/main.tsx`
Expected: `import App from '@/app/App';` or `import { App } from '@/app/App';` — whichever form it used before, now alias-based. The codemod rewrote it; `main.tsx` itself did not move.

Run: `grep -n "main.tsx" index.html`
Expected: `<script type="module" src="/src/main.tsx"></script>` — unchanged, because `main.tsx` stayed.

- [ ] **Step 4: Note the temporary gap in layering rule 3**

`src/app/AudioVisualizer.tsx` and `src/app/AmbientBackdrop.tsx` import `@/audio/engine`. Layering rule 3 is still scoped to `src/components/**`, so between this task and Task 19 those files are outside every layering rule — as is the exemption block that named them. This is a gap, not a break: Task 19 re-scopes the rule to `src/{features,ui,app}/**` and re-points the exemption in the same commit, and Task 19 Step 6 proves the exemption still works.

- [ ] **Step 5: Verify and commit**

Run: `git status --porcelain | grep -c "^R"`
Expected: `14`.

Run: `bun run verify`
Expected: green.

```bash
git add src/app src/main.tsx src/components
git commit -m "refactor(app): move the app shell to src/app/

App, Header and the two components Header split into, plus the analyser
consumers (AudioVisualizer, AmbientBackdrop) and the two chrome pieces
only App/Header import (UpdateBanner, Wordmark).

src/main.tsx stays put — index.html names it — and now imports @/app/App.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 10: `src/features/synth/`

The whole procedure end-to-end was executed against a throwaway tree during planning: the codemod reported `8 specifiers in 4 files`, `bun run lint` exited 0 and all 1732 tests passed after the `git mv`. Expect the same numbers.

**Files:**
- Move: 13 files → `src/features/synth/`
- Modify: `scripts/check-key-bindings.ts:2`

**Interfaces:**
- Produces: `@/features/synth/{SynthView,SimpleSynthPanel,SynthPresetLibrary,OscillatorPanel,FilterPanel,EnvelopePanel,LfoPanel,ArpeggiatorPanel,useSynthChannel}`. `SynthView.tsx` keeps its `export const KEYBOARD_NOTES`, which `scripts/check-key-bindings.ts` reads.

- [ ] **Step 1: Write the map**

```bash
cat > /tmp/solna-codemod/synth.map <<'MAP'
src/components/loop/SynthView.tsx|src/features/synth/
src/components/loop/SynthView.test.tsx|src/features/synth/
src/components/loop/SimpleSynthPanel.tsx|src/features/synth/
src/components/loop/SimpleSynthPanel.test.tsx|src/features/synth/
src/components/loop/SynthPresetLibrary.tsx|src/features/synth/
src/components/loop/SynthPresetLibrary.test.tsx|src/features/synth/
src/components/loop/synth/|src/features/synth/
MAP
```

The last line is the directory form: every file directly inside `src/components/loop/synth/` (7 of them) maps to `src/features/synth/<same name>`, flattening the folder.

- [ ] **Step 2: Rewrite specifiers, then move**

```bash
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/synth.map
mkdir -p src/features/synth
git mv src/components/loop/SynthView.tsx src/components/loop/SynthView.test.tsx \
       src/components/loop/SimpleSynthPanel.tsx src/components/loop/SimpleSynthPanel.test.tsx \
       src/components/loop/SynthPresetLibrary.tsx src/components/loop/SynthPresetLibrary.test.tsx \
       src/features/synth/
git mv src/components/loop/synth/ArpeggiatorPanel.tsx src/components/loop/synth/EnvelopePanel.tsx \
       src/components/loop/synth/FilterPanel.tsx src/components/loop/synth/LfoPanel.tsx \
       src/components/loop/synth/OscillatorPanel.tsx src/components/loop/synth/synthPanels.test.tsx \
       src/components/loop/synth/useSynthChannel.ts \
       src/features/synth/
rmdir src/components/loop/synth
```

Expected codemod output: `rewriteImports: 8 specifiers in 4 files`.

- [ ] **Step 3: Repoint the key-binding check**

`scripts/check-key-bindings.ts` is run by `bun run check:keys`, which is in `verify`. It imports with a file extension and lives outside `src/`, so it keeps a relative specifier:

```bash
perl -pi -e "s#\.\./src/components/loop/SynthView\.tsx#../src/features/synth/SynthView.tsx#" scripts/check-key-bindings.ts
```

Run: `bun run check:keys`
Expected:
```
PASS no drum/synth overlap (none)
PASS all codes valid KeyboardEvent.code (invalid: none)
All key binding checks passed.
```

- [ ] **Step 4: Verify and commit**

Run: `git status --porcelain | grep -c "^R"`
Expected: `13`.

Run: `bun run verify`
Expected: green, 1732 tests.

```bash
git add src/features/synth src/components scripts/check-key-bindings.ts
git commit -m "refactor(synth): move the synth view to src/features/synth/

SynthView, SimpleSynthPanel, SynthPresetLibrary and the five parameter
panels plus useSynthChannel, flattened out of loop/synth/. Moves and
import specifiers only.

check-key-bindings.ts reads KEYBOARD_NOTES from SynthView by path; it
lives outside src/ so it keeps a relative specifier.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 11: `src/features/chords/`

**Files:**
- Move: 13 files → `src/features/chords/`
- Modify: `src/ui/playbackStep.wiring.test.ts` (3 of its remaining path strings)

**Interfaces:**
- Produces: `@/features/chords/{ChordView,ChordPresetLibrary,SortableChordCard,ChordModulePanel,BassModulePanel,AdjustSynthButton,bassStepChoice,progressionAvailability,useChordPlayback}`.

- [ ] **Step 1: Write the map**

```bash
cat > /tmp/solna-codemod/chords.map <<'MAP'
src/components/loop/ChordView.tsx|src/features/chords/
src/components/loop/ChordView.test.tsx|src/features/chords/
src/components/loop/ChordPresetLibrary.tsx|src/features/chords/
src/components/loop/ChordPresetLibrary.test.tsx|src/features/chords/
src/components/loop/chord/|src/features/chords/
MAP
```

- [ ] **Step 2: Rewrite specifiers, then move**

```bash
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/chords.map
mkdir -p src/features/chords
git mv src/components/loop/ChordView.tsx src/components/loop/ChordView.test.tsx \
       src/components/loop/ChordPresetLibrary.tsx src/components/loop/ChordPresetLibrary.test.tsx \
       src/features/chords/
git mv src/components/loop/chord/AdjustSynthButton.tsx src/components/loop/chord/BassModulePanel.tsx \
       src/components/loop/chord/ChordModulePanel.tsx src/components/loop/chord/SortableChordCard.tsx \
       src/components/loop/chord/SortableChordCard.test.tsx src/components/loop/chord/bassStepChoice.ts \
       src/components/loop/chord/modulePanels.test.tsx src/components/loop/chord/progressionAvailability.ts \
       src/components/loop/chord/useChordPlayback.ts src/components/loop/chord/useChordPlayback.test.ts \
       src/features/chords/
rmdir src/components/loop/chord
```

- [ ] **Step 3: Fix the hard-coded paths**

```bash
perl -pi -e "s#'src/components/loop/chord/#'src/features/chords/#g" src/ui/playbackStep.wiring.test.ts
perl -pi -e "s#'src/components/loop/chord/useChordPlayback\.ts'#'src/features/chords/useChordPlayback.ts'#g" src/features/chords/useChordPlayback.test.ts
```

The second one covers `useChordPlayback.test.ts:363`, which reads its own subject off disk to assert on the source text.

Run: `grep -rn "src/components/loop/chord" src`
Expected: no output.

- [ ] **Step 4: Verify and commit**

Run: `git status --porcelain | grep -c "^R"`
Expected: `14`.

Run: `bun run verify`
Expected: green.

```bash
git add src/features/chords src/ui/playbackStep.wiring.test.ts src/components
git commit -m "refactor(chords): move the chord view to src/features/chords/

ChordView, ChordPresetLibrary and the six chord modules plus their two
helpers, flattened out of loop/chord/. Two tests that read their subject
off disk get their path strings updated; that is a path rewrite, not a
behaviour change.

SortableChordCard's BeatDots import now reads @/ui/BeatDots — a feature
importing a shared primitive, which is the intended direction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 12: `src/features/lead/`

**Files:**
- Move: 6 files → `src/features/lead/`
- Modify: `src/ui/playbackStep.wiring.test.ts` (2 path strings), `src/features/lead/useLeadPlayback.test.ts:30`

**Interfaces:**
- Produces: `@/features/lead/{LeadMelodyGrid,melodyGrid,useLeadPlayback}`.

- [ ] **Step 1: Write the map**

```bash
cat > /tmp/solna-codemod/lead.map <<'MAP'
src/components/loop/lead/|src/features/lead/
MAP
```

- [ ] **Step 2: Rewrite specifiers, then move**

```bash
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/lead.map
mkdir -p src/features/lead
git mv src/components/loop/lead/LeadMelodyGrid.tsx src/components/loop/lead/LeadMelodyGrid.test.tsx \
       src/components/loop/lead/melodyGrid.ts src/components/loop/lead/melodyGrid.test.ts \
       src/components/loop/lead/useLeadPlayback.ts src/components/loop/lead/useLeadPlayback.test.ts \
       src/features/lead/
rmdir src/components/loop/lead
```

- [ ] **Step 3: Fix the hard-coded paths**

```bash
perl -pi -e "s#'src/components/loop/lead/#'src/features/lead/#g" src/ui/playbackStep.wiring.test.ts
perl -pi -e "s#'src/components/loop/lead/useLeadPlayback\.ts'#'src/features/lead/useLeadPlayback.ts'#g" src/features/lead/useLeadPlayback.test.ts
```

Run: `grep -rn "src/components/loop/lead" src`
Expected: no output.

- [ ] **Step 4: Verify and commit**

Run: `git status --porcelain | grep -c "^R"`
Expected: `6`.

Run: `bun run verify`
Expected: green.

```bash
git add src/features/lead src/ui/playbackStep.wiring.test.ts src/components
git commit -m "refactor(lead): move the lead melody grid to src/features/lead/

LeadMelodyGrid, melodyGrid and useLeadPlayback with their three tests.
Their playbackStep/sequencerGrid imports now read @/ui/... rather than
crossing into the sequencer; the playerStop import still crosses and is
recorded in the cross-feature allowlist.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 13: `src/features/sequencer/`

`playbackStep` and `sequencerGrid` are **not** in this task — Task 8 sent them to `src/ui/` (V1).

**Files:**
- Move: 9 files → `src/features/sequencer/`
- Modify: `src/ui/playbackStep.wiring.test.ts` (2 path strings), `src/features/sequencer/useSequencerPlayback.test.ts:143`

**Interfaces:**
- Produces: `@/features/sequencer/{SequencerView,SequencerGrid,TrackRow,playerStop,useSequencerPlayback}`.

- [ ] **Step 1: Write the map**

```bash
cat > /tmp/solna-codemod/sequencer.map <<'MAP'
src/components/loop/SequencerView.tsx|src/features/sequencer/
src/components/loop/SequencerView.test.tsx|src/features/sequencer/
src/components/loop/sequencer/|src/features/sequencer/
src/components/playerStop.ts|src/features/sequencer/
src/components/playerStop.test.ts|src/features/sequencer/
src/components/useSequencerPlayback.ts|src/features/sequencer/
src/components/useSequencerPlayback.test.ts|src/features/sequencer/
MAP
```

- [ ] **Step 2: Rewrite specifiers, then move**

```bash
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/sequencer.map
mkdir -p src/features/sequencer
git mv src/components/loop/SequencerView.tsx src/components/loop/SequencerView.test.tsx \
       src/features/sequencer/
git mv src/components/loop/sequencer/SequencerGrid.tsx src/components/loop/sequencer/TrackRow.tsx \
       src/components/loop/sequencer/TrackRow.test.tsx \
       src/features/sequencer/
git mv src/components/playerStop.ts src/components/playerStop.test.ts \
       src/components/useSequencerPlayback.ts src/components/useSequencerPlayback.test.ts \
       src/features/sequencer/
rmdir src/components/loop/sequencer
```

- [ ] **Step 3: Fix the hard-coded paths**

```bash
perl -pi -e "s#'src/components/loop/sequencer/SequencerGrid\.tsx'#'src/features/sequencer/SequencerGrid.tsx'#g; s#'src/components/useSequencerPlayback\.ts'#'src/features/sequencer/useSequencerPlayback.ts'#g" src/ui/playbackStep.wiring.test.ts
perl -pi -e "s#'src/components/useSequencerPlayback\.ts'#'src/features/sequencer/useSequencerPlayback.ts'#g" src/features/sequencer/useSequencerPlayback.test.ts
```

- [ ] **Step 4: Verify and commit**

Run: `git status --porcelain | grep -c "^R"`
Expected: `9`.

Run: `bun run verify`
Expected: green.

```bash
git add src/features/sequencer src/ui/playbackStep.wiring.test.ts src/components
git commit -m "refactor(sequencer): move the step sequencer to src/features/sequencer/

SequencerView, SequencerGrid, TrackRow, playerStop and
useSequencerPlayback. playbackStep and sequencerGrid are NOT here — they
went to src/ui/ in the ui/ commit, because ui/StepRow and ui/StepHeader
import them and a shared primitive may not reach into a feature.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 14: `src/features/song/`

The arrangement, the master rack, and the loop library UI. `LoopSelector` is rendered by `Header` but belongs to the arrangement, not the shell (spec mapping).

**Files:**
- Move: 15 files → `src/features/song/`
- Modify: `src/ui/playbackStep.wiring.test.ts:139`

**Interfaces:**
- Produces: `@/features/song/{LoopPage,LoopSelector,ArrangeView,EffectsRackView,SongPage,SortableLoopCard,arrangeStep,loopIdKey,fxDescriptors}`.

- [ ] **Step 1: Write the map**

```bash
cat > /tmp/solna-codemod/song.map <<'MAP'
src/components/loop/LoopPage.tsx|src/features/song/
src/components/loop/LoopSelector.tsx|src/features/song/
src/components/loop/LoopSelector.test.tsx|src/features/song/
src/components/song/|src/features/song/
src/components/fxDescriptors.ts|src/features/song/
src/components/fxDescriptors.test.ts|src/features/song/
MAP
```

- [ ] **Step 2: Rewrite specifiers, then move**

```bash
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/song.map
mkdir -p src/features/song
git mv src/components/loop/LoopPage.tsx \
       src/components/loop/LoopSelector.tsx src/components/loop/LoopSelector.test.tsx \
       src/features/song/
git mv src/components/song/ArrangeView.tsx src/components/song/ArrangeView.test.tsx \
       src/components/song/EffectsRackView.tsx src/components/song/EffectsRackView.test.tsx \
       src/components/song/SongPage.tsx \
       src/components/song/SortableLoopCard.tsx src/components/song/SortableLoopCard.test.tsx \
       src/components/song/arrangeStep.ts src/components/song/arrangeStep.test.ts \
       src/components/song/loopIdKey.ts src/components/song/loopIdKey.test.ts \
       src/features/song/
git mv src/components/fxDescriptors.ts src/components/fxDescriptors.test.ts src/features/song/
rmdir src/components/song src/components/loop
```

`rmdir src/components/loop` succeeds only if this task emptied it — Tasks 10–13 removed everything else from it. If it fails, run `ls src/components/loop` and move whatever is left in this task rather than leaving a stray directory.

- [ ] **Step 3: Fix the hard-coded path**

```bash
perl -pi -e "s#'src/components/song/ArrangeView\.tsx'#'src/features/song/ArrangeView.tsx'#g" src/ui/playbackStep.wiring.test.ts
```

- [ ] **Step 4: Verify and commit**

Run: `git status --porcelain | grep -c "^R"`
Expected: `15`.

Run: `bun run verify`
Expected: green. `SortableLoopCard.tsx` keeps its accepted `complexity` warning (spec, Phase 1 item 8) — the count stays at 7.

```bash
git add src/features/song src/ui/playbackStep.wiring.test.ts src/components
git commit -m "refactor(song): move the arrangement to src/features/song/

ArrangeView, EffectsRackView, SongPage, SortableLoopCard and the two step
helpers, plus LoopPage, LoopSelector and fxDescriptors. LoopSelector is
rendered by Header but is loop-library UI, so it belongs with the
arrangement rather than the shell; fxDescriptors has one importer,
EffectsRackView.

src/components/loop/ is now empty and removed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 15: `src/features/project/`

**Files:**
- Move: 8 files from `src/components/project/` + `src/app/ProjectNameLabel.tsx`… — no: `ProjectNameLabel.tsx` was left in `src/components/` by Task 5 and by Task 9 is still there. Move it from `src/components/ProjectNameLabel.tsx`.

Correction for the executor: Task 9's map moves `TabButton.tsx` and `ScaleSelects.tsx` to `src/app/` but **not** `ProjectNameLabel.tsx`, which stays in `src/components/` until this task. Confirm with `ls src/components` before starting.

**Interfaces:**
- Produces: `@/features/project/{ProjectManagerModal,ProjectDialogs,ProjectList,projectManagerFlow,ProjectNameLabel}`.

- [ ] **Step 1: Confirm what is left in `src/components/`**

Run: `ls src/components`
Expected after Tasks 8–14: `ProjectNameLabel.tsx`, `InstantVibesBar.tsx`, `InstantVibesBar.test.tsx`, `vibeActions.ts`, `TransportBar.tsx`, `TransportBar.test.tsx`, `PlayheadReadout.tsx`, `usePlayheadSync.ts`, `usePlayheadSync.test.tsx`, `meterSelect.ts`, `meterSelect.test.ts`, `useInputDeck.ts`, `useInputDeck.test.tsx`, `DrumPads.tsx`… (`DrumPads` is under `loop/`, already moved to `features/input` in Task 16 — no, Task 16 has not run yet; `src/components/loop/` was removed in Task 14, which means `DrumPads.tsx` must have moved before then).

**Ordering fix, apply it:** `src/components/loop/DrumPads.tsx` and `DrumPads.test.tsx` are Task 16's, but Task 14 removes `src/components/loop/`. Move the two `DrumPads` files as part of **Task 14's** `git mv` block into a `src/features/input/` created early, or run **Task 16 before Task 14**. Take the second option — it needs no change to either map:

> **Run Task 16 (`features/input`) before Task 14 (`features/song`).** Everything else keeps its order. Task 14's `rmdir src/components/loop` then succeeds.

- [ ] **Step 2: Write the map**

```bash
cat > /tmp/solna-codemod/project.map <<'MAP'
src/components/project/|src/features/project/
src/components/ProjectNameLabel.tsx|src/features/project/
MAP
```

- [ ] **Step 3: Rewrite specifiers, then move**

```bash
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/project.map
mkdir -p src/features/project
git mv src/components/project/ProjectDialogs.tsx src/components/project/ProjectDialogs.test.tsx \
       src/components/project/ProjectList.tsx src/components/project/ProjectList.test.tsx \
       src/components/project/ProjectManagerModal.tsx src/components/project/ProjectManagerModal.test.tsx \
       src/components/project/projectManagerFlow.ts src/components/project/projectManagerFlow.test.ts \
       src/features/project/
git mv src/components/ProjectNameLabel.tsx src/features/project/
rmdir src/components/project
```

- [ ] **Step 4: Verify and commit**

Run: `git status --porcelain | grep -c "^R"`
Expected: `9`.

Run: `bun run verify`
Expected: green.

Run: `grep -rn "projectFileIO" src/features/project`
Expected: `ProjectManagerModal.tsx` imports `@/utils/projectFileIO` — the Phase 1 rename (D8), still resolving.

```bash
git add src/features/project src/components
git commit -m "refactor(project): move the project manager to src/features/project/

The modal, its dialogs, the project list, the flow helper and
ProjectNameLabel (extracted from Header earlier in this phase). The
feature reads @/store/project* and @/utils/projectFileIO; nothing reads
back into it except App and Header.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 16: `src/features/input/`

**Run this before Task 14** (see Task 15 Step 1): it is the last task that takes files out of `src/components/loop/`.

**Files:**
- Move: 11 files → `src/features/input/`
- Modify: `scripts/check-key-bindings.ts:1`, `src/features/input/Keyboard.test.ts:270`

**Interfaces:**
- Produces: `@/features/input/{BottomInputDock,Keyboard,DrumPadGrid,DrumPads,useInputDeck}`. `DrumPadGrid.tsx` keeps `export const DEFAULT_PADS`, read by `scripts/check-key-bindings.ts`; `Keyboard.tsx` keeps `getChordKeyboardRows` and `getScaleLockedKeyboardNotes`, read by `src/app/appChildMemo.test.tsx`.

- [ ] **Step 1: Write the map**

```bash
cat > /tmp/solna-codemod/input.map <<'MAP'
src/components/ui/BottomInputDock.tsx|src/features/input/
src/components/ui/BottomInputDock.test.tsx|src/features/input/
src/components/ui/Keyboard.tsx|src/features/input/
src/components/ui/Keyboard.test.ts|src/features/input/
src/components/ui/Keyboard.tokens.test.tsx|src/features/input/
src/components/ui/DrumPadGrid.tsx|src/features/input/
src/components/ui/DrumPadGrid.test.tsx|src/features/input/
src/components/loop/DrumPads.tsx|src/features/input/
src/components/loop/DrumPads.test.tsx|src/features/input/
src/components/useInputDeck.ts|src/features/input/
src/components/useInputDeck.test.tsx|src/features/input/
MAP
```

- [ ] **Step 2: Rewrite specifiers, then move**

```bash
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/input.map
mkdir -p src/features/input
git mv src/components/ui/BottomInputDock.tsx src/components/ui/BottomInputDock.test.tsx \
       src/components/ui/Keyboard.tsx src/components/ui/Keyboard.test.ts \
       src/components/ui/Keyboard.tokens.test.tsx \
       src/components/ui/DrumPadGrid.tsx src/components/ui/DrumPadGrid.test.tsx \
       src/features/input/
git mv src/components/loop/DrumPads.tsx src/components/loop/DrumPads.test.tsx \
       src/components/useInputDeck.ts src/components/useInputDeck.test.tsx \
       src/features/input/
```

- [ ] **Step 3: Repoint the key-binding check and `Keyboard.test.ts`**

```bash
perl -pi -e "s#\.\./src/components/ui/DrumPadGrid\.tsx#../src/features/input/DrumPadGrid.tsx#" scripts/check-key-bindings.ts
perl -pi -e "s#'src/components/ui/Keyboard\.tsx'#'src/features/input/Keyboard.tsx'#g" src/features/input/Keyboard.test.ts
```

Run: `bun run check:keys`
Expected: `All key binding checks passed.`

Run: `bun test src/features/input/Keyboard.test.ts`
Expected: pass — that file reads `Keyboard.tsx` off disk to assert on the source text, so a stale path throws `ENOENT` rather than failing an assertion.

- [ ] **Step 4: Verify and commit**

Run: `git status --porcelain | grep -c "^R"`
Expected: `11`.

Run: `bun run verify`
Expected: green.

```bash
git add src/features/input src/components scripts/check-key-bindings.ts
git commit -m "refactor(input): move the input deck to src/features/input/

BottomInputDock, Keyboard, DrumPadGrid, DrumPads and useInputDeck — the
dock and the two surfaces it mounts. DrumPads' only importer is
DrumPadGrid; Keyboard's are BottomInputDock, useInputDeck and (across a
feature boundary) SynthView, which the cross-feature allowlist records.

check-key-bindings.ts and Keyboard.test.ts both read source files by
path; both are repointed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 17: `src/features/transport/`

**Files:**
- Move: 11 files → `src/features/transport/`

**Interfaces:**
- Produces: `@/features/transport/{TransportBar,PlayerTransport,PlayheadReadout,NowNextChord,usePlayheadSync,meterSelect}`.

- [ ] **Step 1: Write the map**

```bash
cat > /tmp/solna-codemod/transport.map <<'MAP'
src/components/TransportBar.tsx|src/features/transport/
src/components/TransportBar.test.tsx|src/features/transport/
src/components/PlayheadReadout.tsx|src/features/transport/
src/components/ui/PlayerTransport.tsx|src/features/transport/
src/components/ui/PlayerTransport.test.tsx|src/features/transport/
src/components/ui/NowNextChord.tsx|src/features/transport/
src/components/ui/NowNextChord.test.tsx|src/features/transport/
src/components/usePlayheadSync.ts|src/features/transport/
src/components/usePlayheadSync.test.tsx|src/features/transport/
src/components/meterSelect.ts|src/features/transport/
src/components/meterSelect.test.ts|src/features/transport/
MAP
```

`meterSelect.ts` imports only `@/utils/meter`, so it would also qualify as a `ui/` primitive by the V1 argument — but its importers are three **features** and no `ui/` file, so nothing forces it out of `transport/` and the spec's placement stands. Its three cross-feature edges go in Task 20's allowlist.

- [ ] **Step 2: Rewrite specifiers, then move**

```bash
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/transport.map
mkdir -p src/features/transport
git mv src/components/TransportBar.tsx src/components/TransportBar.test.tsx \
       src/components/PlayheadReadout.tsx \
       src/components/usePlayheadSync.ts src/components/usePlayheadSync.test.tsx \
       src/components/meterSelect.ts src/components/meterSelect.test.ts \
       src/features/transport/
git mv src/components/ui/PlayerTransport.tsx src/components/ui/PlayerTransport.test.tsx \
       src/components/ui/NowNextChord.tsx src/components/ui/NowNextChord.test.tsx \
       src/features/transport/
```

- [ ] **Step 3: Verify and commit**

Run: `git status --porcelain | grep -c "^R"`
Expected: `11`.

Run: `bun run verify`
Expected: green.

```bash
git add src/features/transport src/components
git commit -m "refactor(transport): move the transport to src/features/transport/

TransportBar, PlayerTransport, PlayheadReadout, NowNextChord,
usePlayheadSync and meterSelect. PlayerTransport and PlayheadReadout are
imported by TransportBar and Header; NowNextChord only by
PlayheadReadout.

meterSelect stays here rather than following playbackStep to ui/: it is
store-free, but no ui/ file imports it, so nothing forces the move and
the spec's placement stands.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 18: `features/midi`, `features/vibes`, and the `store/` regroup

Four commits: the two small features that empty `src/components/`, then the three store subfolders. They share a task because none of them is worth a separate review gate on its own, and because the store regroup is pure directory arithmetic that the codemod handles identically each time.

**Files:**
- Move: 2 → `src/features/midi/`, 3 → `src/features/vibes/`, 20 → `src/store/slices/`, 10 → `src/store/persist/`, 13 → `src/store/project/`
- Modify: `src/store/migrate.ts:9` and `src/store/slices/presetsSlice.ts:14` (comments naming moved paths)

**Interfaces:**
- Produces: `@/features/midi/{MidiSettingsModal,MidiIndicator}`; `@/features/vibes/{InstantVibesBar,vibeActions}`; `@/store/slices/*`, `@/store/persist/*`, `@/store/project/*`. `src/store/store.ts`, `engineSync.ts`, `useLiveStore.ts`, the `instantVibes*`, `vibe*`, `midiInput`, `playbackScope`, `songMode` files and `customStepSequencer.test.ts` stay at the store root (spec, D6).

- [ ] **Step 1: Move `features/midi` and `features/vibes`**

```bash
cat > /tmp/solna-codemod/midi-vibes.map <<'MAP'
src/components/ui/MidiSettingsModal.tsx|src/features/midi/
src/components/ui/MidiIndicator.tsx|src/features/midi/
src/components/InstantVibesBar.tsx|src/features/vibes/
src/components/InstantVibesBar.test.tsx|src/features/vibes/
src/components/vibeActions.ts|src/features/vibes/
MAP
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/midi-vibes.map
mkdir -p src/features/midi src/features/vibes
git mv src/components/ui/MidiSettingsModal.tsx src/components/ui/MidiIndicator.tsx src/features/midi/
git mv src/components/InstantVibesBar.tsx src/components/InstantVibesBar.test.tsx \
       src/components/vibeActions.ts src/features/vibes/
rmdir src/components/ui src/components
```

`rmdir src/components` is the acceptance check for Tasks 8–18: it fails if anything is left. If it does fail, `ls -R src/components` and place the remainder before continuing — do not force it.

- [ ] **Step 2: Prove `src/components/` is gone**

Run: `test -e src/components && echo STILL THERE || echo gone`
Expected: `gone`.

Run: `grep -rn "components/" src scripts .claude --include='*.ts' --include='*.tsx'`
Expected: only comments — `src/store/migrate.ts:9` and `src/store/presetsSlice.ts:14`. Fix them now:

```bash
perl -pi -e "s#src/components/loop/ChordPresetLibrary\.tsx#src/features/chords/ChordPresetLibrary.tsx#g" src/store/migrate.ts src/store/presetsSlice.ts
```

- [ ] **Step 3: Verify and commit the two features**

Run: `bun run verify`
Expected: green.

```bash
git add src/features/midi src/features/vibes src/store/migrate.ts src/store/presetsSlice.ts
git commit -m "refactor(midi,vibes): move the last two view features out of components/

MidiSettingsModal and MidiIndicator (both read store/midiInput) to
features/midi; InstantVibesBar and vibeActions to features/vibes.

src/components/ no longer exists. Two comments in store/ that named a
moved path are updated.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

- [ ] **Step 4: Move `store/slices/` (V3 — twelve slices, not eleven)**

```bash
cat > /tmp/solna-codemod/slices.map <<'MAP'
src/store/bassSlice.ts|src/store/slices/
src/store/chordsSlice.ts|src/store/slices/
src/store/effectsSlice.ts|src/store/slices/
src/store/leadSlice.ts|src/store/slices/
src/store/leadSlice.test.ts|src/store/slices/
src/store/loopSlice.ts|src/store/slices/
src/store/loopSlice.test.ts|src/store/slices/
src/store/musicContextSlice.ts|src/store/slices/
src/store/musicContextSlice.test.ts|src/store/slices/
src/store/presetsSlice.ts|src/store/slices/
src/store/projectSlice.ts|src/store/slices/
src/store/projectSlice.test.ts|src/store/slices/
src/store/sequencerSlice.ts|src/store/slices/
src/store/synthSlice.ts|src/store/slices/
src/store/transportSlice.ts|src/store/slices/
src/store/transportSlice.test.ts|src/store/slices/
src/store/uiSlice.ts|src/store/slices/
src/store/uiSlice.test.ts|src/store/slices/
src/store/initialState.ts|src/store/slices/
src/store/types.ts|src/store/slices/
MAP
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/slices.map
mkdir -p src/store/slices
git mv src/store/bassSlice.ts src/store/chordsSlice.ts src/store/effectsSlice.ts \
       src/store/leadSlice.ts src/store/leadSlice.test.ts \
       src/store/loopSlice.ts src/store/loopSlice.test.ts \
       src/store/musicContextSlice.ts src/store/musicContextSlice.test.ts \
       src/store/presetsSlice.ts \
       src/store/projectSlice.ts src/store/projectSlice.test.ts \
       src/store/sequencerSlice.ts src/store/synthSlice.ts \
       src/store/transportSlice.ts src/store/transportSlice.test.ts \
       src/store/uiSlice.ts src/store/uiSlice.test.ts \
       src/store/initialState.ts src/store/types.ts \
       src/store/slices/
```

`src/store/types.ts` is imported by more files than any other module in the repo; the codemod rewrites every one of them to `@/store/slices/types`.

Run: `bun run verify`
Expected: green.

```bash
git add src/store
git commit -m "refactor(store): group the slices under store/slices/

All twelve *Slice.ts (the spec and CLAUDE.md both say eleven and both
omit leadSlice) plus initialState.ts and types.ts. store.ts stays at the
store root — it is the composition point, not a slice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

- [ ] **Step 5: Move `store/persist/`**

```bash
cat > /tmp/solna-codemod/persist.map <<'MAP'
src/store/migrate.ts|src/store/persist/
src/store/migrate.test.ts|src/store/persist/
src/store/sanitize.ts|src/store/persist/
src/store/sanitize.test.ts|src/store/persist/
src/store/loop.ts|src/store/persist/
src/store/loop.test.ts|src/store/persist/
src/store/loadLoop.ts|src/store/persist/
src/store/loadLoop.test.ts|src/store/persist/
src/store/loopSync.ts|src/store/persist/
src/store/loopSync.test.ts|src/store/persist/
MAP
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/persist.map
mkdir -p src/store/persist
git mv src/store/migrate.ts src/store/migrate.test.ts \
       src/store/sanitize.ts src/store/sanitize.test.ts \
       src/store/loop.ts src/store/loop.test.ts \
       src/store/loadLoop.ts src/store/loadLoop.test.ts \
       src/store/loopSync.ts src/store/loopSync.test.ts \
       src/store/persist/
```

Run: `bun run verify`
Expected: green.

Run: `bun test src/store/store.test.ts src/store/persist/migrate.test.ts`
Expected: pass — these cover the legacy-key adoption path, which is the one place a wrong `migrate` import would be silently tolerated at build time and wrong at runtime.

```bash
git add src/store
git commit -m "refactor(store): group the persistence helpers under store/persist/

migrate (legacy-key adoption), sanitize, loop, loadLoop and loopSync —
everything the persist middleware reaches on rehydrate. store.ts stays at
the root and now imports @/store/persist/*.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

- [ ] **Step 6: Move `store/project/`**

```bash
cat > /tmp/solna-codemod/storeproject.map <<'MAP'
src/store/projectFile.ts|src/store/project/
src/store/projectFile.test.ts|src/store/project/
src/store/projectFormat.ts|src/store/project/
src/store/projectFormat.test.ts|src/store/project/
src/store/projectFormatMigrate.ts|src/store/project/
src/store/projectFingerprint.ts|src/store/project/
src/store/projectFingerprint.test.ts|src/store/project/
src/store/projectDirty.ts|src/store/project/
src/store/projectDirty.test.ts|src/store/project/
src/store/projectDirtyBoot.test.ts|src/store/project/
src/store/projectStore.ts|src/store/project/
src/store/projectStore.test.ts|src/store/project/
src/store/projectStoreIdb.ts|src/store/project/
MAP
bun /tmp/solna-codemod/rewriteImports.ts /tmp/solna-codemod/storeproject.map
mkdir -p src/store/project
git mv src/store/projectFile.ts src/store/projectFile.test.ts \
       src/store/projectFormat.ts src/store/projectFormat.test.ts \
       src/store/projectFormatMigrate.ts \
       src/store/projectFingerprint.ts src/store/projectFingerprint.test.ts \
       src/store/projectDirty.ts src/store/projectDirty.test.ts \
       src/store/projectDirtyBoot.test.ts \
       src/store/projectStore.ts src/store/projectStore.test.ts \
       src/store/projectStoreIdb.ts \
       src/store/project/
```

`src/store/project/projectFile.ts` is the **format** module (`parseProjectFile`, `serializeProject`), not the browser I/O one — Phase 1 renamed the latter to `src/utils/projectFileIO.ts` (D8), and it does not move.

Run: `bun run verify`
Expected: green.

Run: `bun test src/store/project/projectDirtyBoot.test.ts`
Expected: pass — this is the boot-pass test that keeps a reloaded session's dirty badge honest (CLAUDE.md); it dynamically imports `./store`, which the codemod rewrote to `@/store/store`.

```bash
git add src/store
git commit -m "refactor(store): group the project modules under store/project/

The format (projectFile, projectFormat, projectFormatMigrate), the
fingerprint/dirty pair and the IndexedDB library (projectStore,
projectStoreIdb). Regrouping only: the project body is still the content
set, and formatVersion is still independent of the persist version.

src/utils/projectFileIO.ts (browser I/O, renamed in Phase 1) stays in
utils/ — it is not part of the format.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

- [ ] **Step 7: Confirm the store root holds only what the spec says it should**

Run: `ls src/store`
Expected exactly: `slices/`, `persist/`, `project/`, `store.ts`, `store.test.ts`, `engineSync.ts`, `engineSync.test.ts`, `useLiveStore.ts`, `instantVibes.ts`, `instantVibes.test.ts`, `instantVibesChordsFixture.ts`, `instantVibesDrums.test.ts`, `instantVibesDrumsFixture.ts`, `instantVibesEffects.test.ts`, `instantVibesEffectsFixture.ts`, `instantVibesProgressions.test.ts`, `midiInput.ts`, `midiInput.test.ts`, `playbackScope.ts`, `playbackScope.test.ts`, `songMode.ts`, `songMode.test.ts`, `vibeChips.ts`, `vibeChips.test.ts`, `vibeSynthPresets.test.ts`, `vibeVariation.ts`, `vibeVariation.test.ts`, `vibeVariationFixtures.ts`, `customStepSequencer.test.ts`.

`customStepSequencer.test.ts` has no `customStepSequencer.ts` to sit beside (V7); it tests `instantVibes` + `store` integration and stays at the root.

- [ ] **Step 8: Confirm the whole tree matches the spec's target layout**

Run: `ls src && ls src/features`
Expected: `app audio features index.css main.tsx pwa routing store types types.ts ui vite-env.d.ts` and `chords input lead midi project sequencer song synth transport vibes`.

- [ ] **Step 9: Confirm no stale path string survives anywhere**

Run: `grep -rn "src/components" src scripts .claude docs/design.md CLAUDE.md`
Expected: `.claude/rules/theming.md` (Task 21), `CLAUDE.md` (Phase 4 per the spec) and nothing under `src/` or `scripts/`.

---

### Task 19: ESLint layering rules by the new paths

Every destination now exists, so the layering rules can name them. Five `no-restricted-imports` blocks, each holding **all** the patterns for its file set, because flat config replaces a rule's options wholesale per file — a second block for the same files would silently drop the first block's patterns.

**Files:**
- Modify: `eslint.config.js` (the three layering blocks and the exemption block; two new blocks)

**Interfaces:**
- Produces the enforced import direction from the spec's *Target directory layout*: `app → features → ui`, everything → `store → audio`, everything → `utils`; `ui/` reaches neither `store/` nor `features/`.

- [ ] **Step 1: Replace the three layering blocks and the exemption block**

Everything from `// Layering rule 1` to the closing `);` becomes:

```js
  {
    // Layering rule 1: audio/ is the bottom layer — no store, no views.
    files: ['src/audio/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/features/**'], message: 'audio/ must not import features/ (layering rule 1)' },
            { group: ['**/ui/**'], message: 'audio/ must not import ui/ (layering rule 1)' },
            { group: ['**/app/**'], message: 'audio/ must not import app/ (layering rule 1)' },
          ],
        },
      ],
    },
  },
  {
    // Layering rule 2: store/ must not import a view.
    files: ['src/store/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/features/**'], message: 'store/ must not import features/ (layering rule 2)' },
            { group: ['**/ui/**'], message: 'store/ must not import ui/ (layering rule 2)' },
            { group: ['**/app/**'], message: 'store/ must not import app/ (layering rule 2)' },
          ],
        },
      ],
    },
  },
  {
    // Layering rule 3: views are dumb — no direct audio/engine.
    // Exceptions: the read-only analyser consumers (app/AudioVisualizer,
    // app/AmbientBackdrop, ui/VuMeter) and test files, in the block below.
    // Routing their per-frame reads through the store would mean a store
    // write every animation frame and a re-render of every subscriber.
    files: ['src/{features,ui,app}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/audio/engine'], message: 'views must not import audio/engine (layering rule 3)' },
          ],
        },
      ],
    },
  },
  {
    // Layering rule 4: ui/ is the leaf. It is imported by app/ and by every
    // feature and reaches neither the store nor a feature, which is what
    // makes a primitive safe to use from anywhere. This block REPEATS rule
    // 3's audio/engine pattern: flat config replaces a rule's options
    // wholesale, so omitting it here would turn the engine ban off for
    // src/ui/**.
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/audio/engine'], message: 'views must not import audio/engine (layering rule 3)' },
            { group: ['**/store/**'], message: 'ui/ must not import store/ — a primitive takes props (layering rule 4)' },
            { group: ['**/features/**'], message: 'ui/ must not import features/ — move the shared module into ui/ (layering rule 4)' },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/app/AudioVisualizer.tsx',
      'src/app/AmbientBackdrop.tsx',
      'src/ui/VuMeter.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
);
```

- [ ] **Step 2: Confirm brace expansion works in a `files` glob**

`src/{features,ui,app}/**` is the one piece of new syntax here. ESLint matches `files` with minimatch, which supports braces — but prove it rather than assume it:

```bash
mkdir -p src/features/__probe && cat > src/features/__probe/probe.ts <<'PROBE'
import { audioEngine } from '@/audio/engine';
export const probe = () => audioEngine;
PROBE
bun run eslint src/features/__probe/probe.ts; echo "exit=$?"
rm -r src/features/__probe
```

Expected: `error  ... views must not import audio/engine (layering rule 3)` and `exit=1`. If it exits 0, the brace glob did not match: replace the single block with three blocks (`src/features/**`, `src/ui/**`, `src/app/**`) carrying the same patterns.

- [ ] **Step 3: Prove layering rule 4 fires on a `ui/ → store/` violation**

```bash
cat > src/ui/__probe.tsx <<'PROBE'
import { useAppStore } from '@/store/store';
export function Probe() {
  return <span>{useAppStore((s) => s.bpm)}</span>;
}
PROBE
bun run eslint src/ui/__probe.tsx; echo "exit=$?"
rm src/ui/__probe.tsx
```

Expected: `error  ... ui/ must not import store/ — a primitive takes props (layering rule 4)` and `exit=1`.

- [ ] **Step 4: Prove layering rule 4 fires on a `ui/ → features/` violation**

```bash
cat > src/ui/__probe.ts <<'PROBE'
import { meterSelectOptions } from '@/features/transport/meterSelect';
export const probe = meterSelectOptions;
PROBE
bun run eslint src/ui/__probe.ts; echo "exit=$?"
rm src/ui/__probe.ts
```

Expected: `error  ... ui/ must not import features/ …` and `exit=1`. (The named export does not need to exist — `no-restricted-imports` matches the specifier, not the binding.) **This is the probe that would have failed if `playbackStep` and `sequencerGrid` had gone to `features/sequencer`;** V1 is why it passes.

- [ ] **Step 5: Prove the flat-config override that forces V2**

Record the constraint in the repo's own terms so the next person does not re-litigate it. Temporarily append, after the rule-4 block:

```js
  {
    files: ['src/features/synth/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['warn', { patterns: [{ group: ['**/features/chords/**'], message: 'probe' }] }],
    },
  },
```

then:

```bash
cat > src/features/synth/__probe.ts <<'PROBE'
import { audioEngine } from '@/audio/engine';
export const probe = audioEngine;
PROBE
bun run eslint src/features/synth/__probe.ts; echo "exit=$?"
rm src/features/synth/__probe.ts
```

Expected: `exit=0` with **no** engine error — the per-feature `warn` block replaced layering rule 3 for those files. That is the whole argument for V2. **Remove the temporary block before continuing** and re-run Step 2's probe to confirm the engine ban is back at `error`.

- [ ] **Step 6: Prove the exemption still covers the three analyser consumers**

Run: `bun run eslint src/app/AudioVisualizer.tsx src/app/AmbientBackdrop.tsx src/ui/VuMeter.tsx`
Expected: exit 0. All three import `@/audio/engine`; if any errors, the exemption block's paths are stale.

Run: `grep -rn "audio/engine" src/app src/ui src/features`
Expected: exactly those three files. Anything else is a real layering violation that this task's rules will now catch.

- [ ] **Step 7: Verify and commit**

Run: `git status --porcelain`
Expected: only ` M eslint.config.js` — every probe deleted.

Run: `bun run verify`
Expected: green, `0 errors, 7 warnings`.

```bash
git add eslint.config.js
git commit -m "chore(eslint): express the layering rules by the new paths

Rules 1 and 2 ban features/, ui/ and app/ instead of components/; rule 3
is scoped to src/{features,ui,app}/**; the analyser exemption points at
app/AudioVisualizer, app/AmbientBackdrop and ui/VuMeter.

New rule 4: src/ui/** may not import store/ or features/, at error. It
repeats rule 3's audio/engine pattern on purpose — flat config replaces a
rule's options wholesale, so a second block for the same files drops the
first block's patterns rather than adding to them.

That same mechanic is why the features/X -> features/Y ban is NOT an
eslint rule: a per-feature warn block would silently downgrade the
audio/engine ban for those files. It ships as a test guard instead; see
the next commit. Every rule above is proven to fire on a deliberate
violation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 20: The cross-feature guard and its allowlist

Spec, *ESLint rule matrix*: "`features/X` may not import `features/Y` | P3 warn". V2 explains why it cannot be an ESLint rule here. It ships as a source-scanning test with a frozen allowlist — the same shape as `ui/fieldClasses.test.ts` and `playbackStep.wiring.test.ts`, both of which already guard conventions this way, and `.claude/rules/testing.md` covers the style.

A frozen allowlist is a **stronger** guard than a warning: a new cross-feature import fails `verify`, and removing one from the allowlist fails the "no stale entries" assertion, so the list can only shrink.

**Files:**
- Create: `src/features/crossFeature.test.ts`

**Interfaces:**
- Produces: `ACCEPTED_CROSS_FEATURE_IMPORTS: ReadonlyArray<`${string} -> ${string}`>` — the eleven edges the spec's backlog accepts, each as `<importer path> -> <target feature>`.

- [ ] **Step 1: Enumerate the real edges before writing the allowlist**

```bash
grep -rnoE "from '@/features/[a-z]+/" src/features --include='*.ts' --include='*.tsx' \
  | grep -v '\.test\.' \
  | sed -E "s#^src/features/([a-z]+)/([^:]+):[0-9]+:from '@/features/([a-z]+)/#\1 \2 -> \3#" \
  | awk '$1 != $NF' | sort -u
```

Expected — the eleven accepted edges (test files are excluded because they are exempt from layering rules and routinely reach across to build fixtures):

```
chords useChordPlayback.ts   -> sequencer   (playerStop)
chords BassModulePanel.tsx   -> transport   (meterSelect)
chords ChordModulePanel.tsx  -> transport   (meterSelect)
lead   useLeadPlayback.ts    -> sequencer   (playerStop)
sequencer SequencerView.tsx  -> transport   (meterSelect)
song   LoopPage.tsx          -> chords      (ChordView)
song   LoopPage.tsx          -> sequencer   (SequencerView)
song   LoopPage.tsx          -> synth       (SynthView)
synth  SynthView.tsx         -> input       (Keyboard)
synth  SynthView.tsx         -> lead        (LeadMelodyGrid)
transport TransportBar.tsx   -> midi        (MidiIndicator)
```

Six of the spec's expected edges are already gone because V1 sent `playbackStep` and `sequencerGrid` to `ui/`: `lead/LeadMelodyGrid → sequencer` ×2, `lead/useLeadPlayback → sequencer` ×1, `chords/{Bass,Chord}ModulePanel → sequencer` ×2 and `chords/useChordPlayback → sequencer` ×1 now read `@/ui/…`. The spec's `chords/SortableChordCard → ui/BeatDots` edge was never a violation — `BeatDots` is a `ui/` primitive and a feature importing `ui/` is the intended direction.

Three of the eleven were **not** in the spec's backlog and are recorded here for the first time: `song/LoopPage → {synth,chords,sequencer}` (LoopPage composes the three loop views), `synth/SynthView → lead/LeadMelodyGrid`, and `transport/TransportBar → midi/MidiIndicator`.

If the command prints an edge not in the list above, do not add it to the allowlist — find out which task introduced it.

- [ ] **Step 2: Write the guard**

```ts
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cross-feature imports the spec accepts for now, each `<importer> -> <feature>`.
 *
 * The spec's Phase 3 backlog leaves these unresolved on purpose: fixing them is
 * a design decision per edge (promote the shared module to ui/ or utils/, or
 * give the owning feature a public surface), not part of a mechanical move.
 *
 * This list may only SHRINK. A new edge fails the first test; a resolved edge
 * left behind fails the second. The eslint form of this rule is not available:
 * flat config replaces a rule's options wholesale, so a per-feature
 * `no-restricted-imports` block at `warn` would drop layering rule 3's
 * audio/engine ban for those same files.
 */
const ACCEPTED_CROSS_FEATURE_IMPORTS: readonly string[] = [
  'chords/useChordPlayback.ts -> sequencer',
  'chords/BassModulePanel.tsx -> transport',
  'chords/ChordModulePanel.tsx -> transport',
  'lead/useLeadPlayback.ts -> sequencer',
  'sequencer/SequencerView.tsx -> transport',
  'song/LoopPage.tsx -> chords',
  'song/LoopPage.tsx -> sequencer',
  'song/LoopPage.tsx -> synth',
  'synth/SynthView.tsx -> input',
  'synth/SynthView.tsx -> lead',
  'transport/TransportBar.tsx -> midi',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [path];
  });
}

/** Every `<featureRelativePath> -> <otherFeature>` edge in non-test sources. */
function crossFeatureEdges(): string[] {
  const edges = new Set<string>();
  for (const file of sourceFiles('src/features')) {
    const own = file.slice('src/features/'.length).split('/')[0];
    const rel = file.slice(`src/features/`.length);
    for (const m of readFileSync(file, 'utf8').matchAll(/['"]@\/features\/([a-z]+)\//g)) {
      if (m[1] !== own) edges.add(`${rel} -> ${m[1]}`);
    }
  }
  return [...edges].sort();
}

describe('feature boundaries', () => {
  test('no feature imports another feature except on the accepted list', () => {
    const unexpected = crossFeatureEdges().filter((e) => !ACCEPTED_CROSS_FEATURE_IMPORTS.includes(e));
    expect(unexpected).toEqual([]);
  });

  test('every accepted edge still exists, so the list can only shrink', () => {
    const actual = new Set(crossFeatureEdges());
    const stale = ACCEPTED_CROSS_FEATURE_IMPORTS.filter((e) => !actual.has(e));
    expect(stale).toEqual([]);
  });

  test('ui/ reaches neither the store nor a feature', () => {
    const offenders = sourceFiles('src/ui').filter((f) =>
      /['"]@\/(store|features)\//.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
```

The third test duplicates ESLint layering rule 4 on purpose: rule 4 turns itself **off** for `**/*.test.ts`, and a primitive that reaches the store from inside a test helper is the exact failure the rule exists to prevent.

- [ ] **Step 3: Prove the guard fails on a new cross-feature import**

```bash
printf "\nimport { MidiIndicator } from '@/features/midi/MidiIndicator';\nexport const probe = MidiIndicator;\n" >> src/features/song/loopIdKey.ts
bun test src/features/crossFeature.test.ts; echo "exit=$?"
git checkout -- src/features/song/loopIdKey.ts
```

Expected: the first test fails with `["song/loopIdKey.ts -> midi"]` and `exit=1`. Then `git checkout` restores the file — this is the one place in the plan where `git checkout` is used, on a single file, immediately after the probe.

Run: `git status --porcelain src/features/song`
Expected: empty.

- [ ] **Step 4: Verify and commit**

Run: `bun test src/features/crossFeature.test.ts`
Expected: 3 pass.

Run: `bun run verify`
Expected: green, `0 errors, 7 warnings`, 1735 tests.

```bash
git add src/features/crossFeature.test.ts
git commit -m "test(features): freeze the accepted cross-feature imports

The spec asks for features/X -> features/Y at eslint warn. It is not
expressible: flat config replaces a rule's options wholesale, so a
per-feature no-restricted-imports block at warn would drop layering rule
3's audio/engine ban for those files, and no third rule id is available
(no-restricted-syntax is global and now at error; D3 forbids adding
eslint-plugin-import).

A frozen allowlist is the stronger guard anyway: a NEW cross-feature
import fails verify instead of adding an eleventh warning nobody reads,
and a resolved edge left on the list fails too, so the list can only
shrink.

Eleven accepted edges, all from the spec's backlog except three this
phase surfaced for the first time: song/LoopPage -> {synth,chords,
sequencer}, synth/SynthView -> lead, transport/TransportBar -> midi.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 21: Path-scoped rule globs

Spec, *Phase 3 — Same-commit rewrites*: "`.claude/rules/testing.md` and `theming.md` path globs updated." A rule that globs a directory which no longer exists loads for nothing, and the theming rule is the one that keeps hard-coded colours out of components.

**Files:**
- Modify: `.claude/rules/theming.md:1-7` (front matter), `.claude/rules/testing.md:35-36` (two path references in prose)

**Interfaces:**
- Docs only.

- [ ] **Step 1: Re-scope `theming.md`**

```diff
 ---
 paths:
-  - "src/components/**/*"
+  - "src/app/**/*"
+  - "src/features/**/*"
+  - "src/ui/**/*"
   - "src/utils/themeColor.ts"
   - "src/**/*.css"
   - "scripts/themeTokenGuard.ts"
 ---
```

`testing.md`'s front matter globs `**/*.test.ts`, `**/*.test.tsx`, `src/audio/testFakes.ts` and `scripts/**/*` — none of those moved, so the front matter is left alone.

- [ ] **Step 2: Fix the two stale paths in `testing.md`'s prose**

```diff
-snapshots — see the `useLiveStore` helper and its comment in `src/components/ui/BottomInputDock.tsx`,
-and the note at the top of `src/components/TransportBar.test.tsx` explaining which cases cannot
+snapshots — see the `useLiveStore` helper and its comment in `src/features/input/BottomInputDock.tsx`,
+and the note at the top of `src/features/transport/TransportBar.test.tsx` explaining which cases cannot
```

`useLiveStore` itself now lives at `src/store/useLiveStore.ts`; if the surrounding sentence names its old path, fix that too.

- [ ] **Step 3: Confirm no rule or skill still names a dead path**

Run: `grep -rn "src/components" .claude`
Expected: no output.

Run: `grep -rn "components/" .claude/skills`
Expected: no output.

**`CLAUDE.md` and `docs/design.md` are deliberately left stale.** The spec assigns both to Phase 4 (items 3 and 4), which rewrites the architecture section wholesale for `app/features/ui/store/audio`. Do not half-rewrite it here: a partially updated architecture section is harder to review than an untouched one, and Phase 4 is the next PR.

- [ ] **Step 4: Verify and commit**

Run: `bun run verify`
Expected: green.

```bash
git add .claude/rules/theming.md .claude/rules/testing.md
git commit -m "docs(rules): re-scope the path-scoped rules to app/features/ui

theming.md globbed src/components/**, which no longer exists, so the rule
that keeps hard-coded colours out of the view layer had stopped loading
for the view layer. testing.md's two prose paths follow their files.

CLAUDE.md and docs/design.md stay stale on purpose: the spec's Phase 4
rewrites that architecture section wholesale.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

## Final acceptance

Run these after Task 21 and paste the output into the PR body.

```bash
bun run verify
git log --stat --oneline main..HEAD | grep -c "=>"     # renamed files
git log --oneline main..HEAD | wc -l                   # commits
grep -rn "React\.FC\|: FC<" src ; echo "React.FC: $?"
grep -rnE "from ['\"]\.\./\.\./" src scripts .claude ; echo "../../: $?"
test -e src/components && echo "FAIL components/ still exists" || echo "components/ gone"
bun run eslint 2>&1 | tail -2
```

Expected:
- `verify` green.
- The rename count equals the number of moved files (179 plus the Phase 2 primitives); `git log --stat` shows an `R` line for each, not an add/delete pair. Spot-check one move task with `git show --stat --find-renames=100% <sha>` and confirm every entry is a pure rename.
- 21 commits.
- Both greps print nothing and exit 1.
- `components/ gone`.
- `✖ 7 problems (0 errors, 7 warnings)` — 6 `react-hooks/exhaustive-deps` + 1 `complexity` on `features/song/SortableLoopCard.tsx`, both explicitly backlogged by the spec.

**For the PR body, enumerate the eleven accepted cross-feature edges** from Task 20's allowlist so a reviewer reads them as recorded debt rather than a regression, and note that they are guarded by `src/features/crossFeature.test.ts` (fails on a new one) rather than by an ESLint warning, with the reason from V2.

**Open risk, stated rather than hidden.** The codemod, the alias sweep and one full move (`features/synth`) were executed end-to-end while this plan was written — `bun run lint` exit 0, `bun test` 1732 pass, `bun run build` succeeded, `bun run check:keys` pass — but on a working copy that was then discarded. The remaining ten move tasks were validated by static analysis of the import graph (every specifier resolved, no destination collision, every `src/components/` file covered by exactly one map row) and not by a type-check. The first task to disprove that analysis will do so loudly, at its own `bun run verify`, which is why every task ends with one.

---

## Self-review

**Spec coverage.**

| Spec item (Phase 3) | Task |
| --- | --- |
| File mapping — `src/app/` | 9 |
| File mapping — `Header.tsx` split (`TabButton`, `ScaleSelects`, `ProjectNameLabel`) | 5, then 9 and 15 |
| File mapping — `features/{synth,chords,lead,sequencer,song,project,input,transport,midi,vibes}` | 10, 11, 12, 13, 14, 15, 16, 17, 18 |
| File mapping — `src/ui/` and `ui/useLiveStore.ts → src/store/` | 8 |
| File mapping — `appChildMemo.test.tsx`, `viewMeta.test.ts` follow their subject | 9, 8 |
| File mapping — `src/store/{slices,persist,project}` | 18 |
| File mapping — `audio/`, `utils/`, `routing/`, `pwa/` unchanged | untouched; asserted in Task 18 Step 8 |
| Same-commit rewrite — `React.FC` → function in 46 files | 6, 7 |
| Same-commit rewrite — `type XProps` → `interface` | 4 (V4: 3 sites, 2 in `audio/`) |
| Same-commit rewrite — all `../../` → `@/` | 2 |
| Same-commit rewrite — layering globs, exemption list | 19 |
| Same-commit rewrite — new rule `ui/` may not import `store/`/`features/` at error | 19 (V1 makes it clean) |
| Same-commit rewrite — new rule `features/X` ↛ `features/Y` at warn | 20 (V2: test guard, not ESLint) |
| Same-commit rewrite — flip `no-restricted-syntax`, `consistent-type-definitions` to error | 7, 4 |
| Same-commit rewrite — `.claude/rules/{testing,theming}.md` globs | 21 |
| Acceptance — `verify` green, renames as `R`, no `React.FC`, no `../../`, cross-feature enumerated | Final acceptance |
| Testing — every test moves with its subject, passes unchanged apart from imports | every move task |
| Backlog item folded in — `clampFinite(…, 120)` → `DEFAULT_BPM` | 3 (its own commit) |

**Placeholder scan.** No "TBD", no "update the imports", no "similar to Task N". Every code step carries the code; every rewrite step carries the exact command. The one repeated procedure (map → codemod → `git mv` → fix path strings → verify → commit) is stated once above Task 8 and then instantiated with concrete commands in each task rather than cross-referenced.

**Name consistency.** `DEFAULT_BPM` (Task 3) is the name D9 uses and Phase 1 shipped at `transportSlice.ts:12`. `rewriteImports.ts` is referenced by the same absolute path in Tasks 1–18. `ACCEPTED_CROSS_FEATURE_IMPORTS` (Task 20) is used only in its own file. `crossFeatureEdges()` is defined and called in Task 20's file. The destination directory names match the spec's *Target directory layout* exactly (`app`, `features/{synth,chords,lead,sequencer,song,project,input,transport,midi,vibes}`, `ui`, `store/{slices,persist,project}`).

**Ordering fix carried in-plan.** Task 15 Step 1 records that **Task 16 must run before Task 14**, because Task 14's `rmdir src/components/loop` requires `DrumPads.tsx` to have left already. Everything else runs in numeric order.
