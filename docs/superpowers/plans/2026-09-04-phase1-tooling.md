# Phase 1 — Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the compiler and linter honest about the rules the codebase already mostly follows: `strict: true` with zero errors, `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y` wired in, the convention rules from the spec's D3 landed as `warn`, and `bun run eslint` inside the `verify` gate. Plus the four hygiene items the spec attaches to this phase: `DEFAULT_BPM`, the `projectFile` → `projectFileIO` rename, three history-referencing comments, and the CLAUDE.md sentence that is no longer true once eslint is in the gate. Nothing in `src/` moves.

**Architecture:** Configuration-only changes at the root (`tsconfig.strict.json`, `eslint.config.js`, `package.json`, `CLAUDE.md`) plus five surgical source edits (three strict fixes, one constant, one rename). Every new ESLint rule is `warn` except `react-hooks/rules-of-hooks`, so `verify` stays green at the phase boundary (spec D5); the warnings are counted in the commit body so Phases 2–3 can show them reaching zero.

**Tech Stack:** Bun (tests + scripts), Vite + React 19, TypeScript, ESLint flat config via `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`.

**Spec:** `docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md` — sections *Goal*, *Decisions* (D3, D5, D8, D9), *Phase 1 — Tooling*, *ESLint rule matrix*, *Testing*.

## Global Constraints

- Runtime is Bun. Run one file with `bun test <file>`; the completion gate is `bun run verify`. Until Task 3 lands, `verify` is `bun test && bun run lint && bun run check:keys && bun run check:drums && bun run build` and does **not** run eslint — Tasks 1 and 2 therefore run `bun run eslint` explicitly. From Task 3 onward `verify` includes it.
- Layering (`eslint.config.js` `no-restricted-imports`, all `error`): `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; components never import `audio/engine`. The three layering blocks and their exemption block are **not edited** by this plan.
- Spec, Phase 1 item 2: "All new rules at `warn` except `react-hooks/rules-of-hooks`, which is `error` from the start (there are no violations to fix; a violation is a bug)."
- Spec D3: ESLint additions are limited to `eslint-plugin-react-hooks` (`rules-of-hooks` error, `exhaustive-deps` warn), `eslint-plugin-jsx-a11y` recommended, `@typescript-eslint/consistent-type-definitions: interface`, `no-restricted-syntax` banning `React.FC` and `confirm`/`alert`/`prompt`, `no-restricted-imports` banning `../../`. **No import ordering.**
- Spec, Phase 1 item 4: the `@/` alias is already present in `tsconfig.strict.json` (`paths`) and `vite.config.ts` (`resolve.alias`). "Confirm, do not re-add. `bun test` resolves `paths` from tsconfig natively, so no test-runner configuration is needed. Nothing is rewritten to `@/` in this phase; the `../../` ban is `warn`."
- Spec, Phase 1 item 7: "where the comment carried a reason, keep the reason and drop the reference ('closing would unmount it' stays; 'per the Task 12 review finding' goes)."
- Spec, Phase 1 item 8: leave the `complexity` warning on `song/SortableLoopCard.tsx`.
- Spec acceptance: "`bun run verify` green with zero ESLint errors. Warnings are expected and counted in the PR description."
- Tests are `bun:test`, no DOM, no testing-library (`.claude/rules/testing.md`).
- Commits use `git add <named files>`, never `-A`. Every commit message ends with the two trailer lines shown in each task.
- The exact strict errors on `main` (5288da1), from `bunx tsc --noEmit -p tsconfig.json --strict`:
  1. `src/audio/engine.ts(1263,19): error TS2769: No overload matches this call.` — `bus.connect(this.dryGain)`; `this.dryGain` is `GainNode | null`.
  2. `src/components/loop/SynthPresetLibrary.tsx(424,7): error TS2322: Type '(e: SynthLibraryEntry, query: string, categoryId: string) => boolean | ""' is not assignable to type '(entry: SynthLibraryEntry, query: string, category: string) => boolean'.` — `e.description && …` yields `""` when `description` is empty.
  3. `src/store/projectDirty.test.ts(27,5): error TS2345: Argument of type 'StateCreator<{ currentProjectId: string | null; … }, [], [...]>' is not assignable to parameter of type 'StateCreator<Partial<AppStore>, [], [["zustand/subscribeWithSelector", never]]>'.` — the initializer's literal type is inferred narrower than `Partial<AppStore>`, so `getState` return types conflict.

---

## Scope decision

One plan, one branch, seven tasks, seven commits. Each task leaves `bun run verify` green so any task can be reviewed and reverted on its own. Order matters: Task 1 (strict) before Task 2 (eslint plugins) keeps the type-check independent of new lint noise; Task 3 (gate) comes after Task 2 so the first `verify` that runs eslint runs the finished config; Tasks 4–6 are source hygiene that the new gate then covers; Task 7 closes the loop on the docs.

## File Structure

Created: none.

Renamed:

| From | To |
| --- | --- |
| `src/utils/projectFile.ts` | `src/utils/projectFileIO.ts` |
| `src/utils/projectFile.test.ts` | `src/utils/projectFileIO.test.ts` |

Modified:

| Path | Change |
| --- | --- |
| `tsconfig.strict.json` | `"strict": true`; drop `"noImplicitAny": false`. |
| `src/audio/engine.ts` | `getSourceBus` guards `dryGain` alongside `ctx`. |
| `src/components/loop/SynthPresetLibrary.tsx` | `filterEntries` returns a real `boolean`. |
| `src/store/projectDirty.test.ts` | `makeStore` initializer annotated `(): Partial<AppStore>`. |
| `eslint.config.js` | react-hooks, jsx-a11y (warn), `consistent-type-definitions`, `no-restricted-syntax`, `../../` ban. |
| `package.json` | devDeps `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`; `verify` runs eslint. |
| `bun.lock` | updated by `bun add -d`. |
| `src/store/transportSlice.ts` | `export const DEFAULT_BPM = 120;` used by the initial state. |
| `src/store/projectFormat.ts` | `factoryProjectContent()` reads `DEFAULT_BPM`. |
| `src/store/projectFormat.test.ts` | asserts factory bpm equals `DEFAULT_BPM`. |
| `src/components/project/ProjectManagerModal.tsx` | import path for the renamed util; comment at line 77. |
| `src/audio/data/vibeEffectChains.ts` | comment at lines 94–95. |
| `src/audio/data/vibeDrumPatterns.ts` | comment at lines 109–110. |
| `CLAUDE.md` | the `verify` / eslint sentence at lines 27–29 and the comment on line 24. |

---

### Task 1: `strict: true` and the three fixes

The spec's *Measurements* table records that `tsconfig.strict.json` has `strict: false` and that `--strict` yields exactly three errors. This task flips the flag and fixes them without changing behaviour.

**Files:**
- Modify: `tsconfig.strict.json:8-9`
- Modify: `src/audio/engine.ts:1257` (`getSourceBus` guard)
- Modify: `src/components/loop/SynthPresetLibrary.tsx:128-131` (`filterEntries` → `matchesSearch`)
- Modify: `src/store/projectDirty.test.ts:27` (`makeStore` initializer)

**Interfaces:**
- Consumes: nothing new.
- Produces: no API change. `getSourceBus(source: string): GainNode` keeps its signature; `filterEntries` keeps `(e: SynthLibraryEntry, query: string, categoryId: string) => boolean`; `makeStore` in the test keeps its return type.

- [ ] **Step 1: Reproduce the three errors before touching anything**

Run: `bunx tsc --noEmit -p tsconfig.json --strict 2>&1 | grep -c "error TS"`
Expected: `3`

- [ ] **Step 2: Flip the compiler flags**

In `tsconfig.strict.json`, replace lines 8–9:

```diff
     "lib": ["ES2022", "DOM", "DOM.Iterable"],
-    "strict": false,
-    "noImplicitAny": false,
+    "strict": true,
     "skipLibCheck": true,
```

Run: `bun run lint 2>&1 | grep -c "error TS"`
Expected: `3` — the same three errors, now from the project's own config.

- [ ] **Step 3: Fix `src/audio/engine.ts:1263` — guard `dryGain` with `ctx`**

`dryGain` is created in `init()` at line 586 right after `ctx`, and the two other methods that touch it (lines 754 and 814) already guard both together. `getSourceBus` guards only `ctx`, so `strict` correctly reports `GainNode | null` at the `connect` call. Match the neighbours:

```diff
   private getSourceBus(source: string): GainNode {
-    if (!this.ctx) throw new Error('AudioContext not initialized');
+    if (!this.ctx || !this.dryGain) throw new Error('AudioContext not initialized');
     let bus = this.sourceBuses.get(source);
```

The `delayNode` / `reverbNode` / `distortionNode` connects on lines 1264–1266 are already inside `if (this.x)` guards and need nothing.

- [ ] **Step 4: Fix `src/components/loop/SynthPresetLibrary.tsx:424` — make `matchesSearch` a boolean**

The `&&` chain at line 131 evaluates to `""` when `e.description` is the empty string, so `matchesSearch` is `string | boolean` and the whole callback fails the `filterEntries` prop type (`ui/PresetLibrary.tsx:66`). Coerce the one operand that is not already a boolean:

```diff
     const matchesSearch =
       query.trim() === '' ||
       e.name.toLowerCase().includes(query.toLowerCase()) ||
-      (e.description && e.description.toLowerCase().includes(query.toLowerCase()));
+      Boolean(e.description && e.description.toLowerCase().includes(query.toLowerCase()));

     return matchesCategory && matchesSearch;
```

Semantics are unchanged: an empty description was already falsy and is now `false`.

- [ ] **Step 5: Fix `src/store/projectDirty.test.ts:27` — annotate the initializer's return type**

`create<Partial<AppStore>>()` fixes the outer state type, but `subscribeWithSelector(...)` infers its own `T` from the arrow's literal (`controlTarget: "synth"`, `dirty: false`, `currentProjectId: string | null` without `undefined`), and that narrower `T` is not assignable back. Give the arrow the type the store expects:

```diff
   const content = factoryProjectContent();
   return create<Partial<AppStore>>()(
-    subscribeWithSelector(() => ({
+    subscribeWithSelector((): Partial<AppStore> => ({
       ...content,
       controlTarget: 'synth',
```

- [ ] **Step 6: Type-check, run the touched tests, and lint imports**

Run: `bun run lint`
Expected: no output, exit 0.

Run: `bun test src/store/projectDirty.test.ts src/audio/engine.test.ts src/components/loop/SynthPresetLibrary.test.tsx`
Expected: every test passes. (If `SynthPresetLibrary.test.tsx` does not exist, run `bun test -t "SynthPresetLibrary"` instead; a `0 tests` result there is fine.)

Run: `bun run eslint`
Expected: exit 0; only the pre-existing `complexity` warning on `src/components/song/SortableLoopCard.tsx` is reported.

- [ ] **Step 7: Verify and commit**

Run: `bun run verify`
Expected: tests pass, `tsc` clean, `check:keys` and `check:drums` pass, build succeeds.

```bash
git add tsconfig.strict.json src/audio/engine.ts src/components/loop/SynthPresetLibrary.tsx src/store/projectDirty.test.ts
git commit -m "chore(tsconfig): enable strict and fix the three errors it reports

engine.getSourceBus now guards dryGain with ctx like its neighbours;
SynthPresetLibrary.filterEntries returns a real boolean; the
projectDirty test store's initializer is annotated Partial<AppStore>
so subscribeWithSelector infers the store's own type.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 2: ESLint — react-hooks, jsx-a11y and the convention rules

Spec D3 lists the only additions allowed; D5 lands them as `warn`. `react-hooks/rules-of-hooks` is `error` from the start (spec, Phase 1 item 2). The three layering blocks stay byte-identical.

**Files:**
- Modify: `package.json` (`devDependencies`) and `bun.lock` — via `bun add -d`
- Modify: `eslint.config.js:1-14` (imports and the global `rules` block)

**Interfaces:**
- Consumes: `eslint-plugin-react-hooks` default export (`plugins` object with `rules`), `eslint-plugin-jsx-a11y` default export (`flatConfigs.recommended`).
- Produces: the ESLint config `bun run eslint` runs. Rules added, all global (every `**/*.{ts,tsx}` file `tseslint.config` already covers):
  - `react-hooks/rules-of-hooks: 'error'`
  - `react-hooks/exhaustive-deps: 'warn'`
  - every `jsx-a11y` recommended rule at `'warn'`
  - `@typescript-eslint/consistent-type-definitions: ['warn', 'interface']`
  - `no-restricted-syntax: 'warn'` for `FC` / `React.FC` type references and bare / `window.` `confirm` `alert` `prompt` calls
  - `no-restricted-imports: 'warn'` for the `../../*` pattern — global block only; the per-path layering blocks keep their own `error` config and, being later in the array, override it for `src/audio/`, `src/store/` and `src/components/` (see Step 4 for how the `../../` ban still reaches those paths).

- [ ] **Step 1: Install the two plugins**

Run: `bun add -d eslint-plugin-react-hooks eslint-plugin-jsx-a11y`
Expected: `package.json` `devDependencies` gains both entries; `bun.lock` updates.

Run: `ls node_modules | grep eslint-plugin`
Expected:
```
eslint-plugin-jsx-a11y
eslint-plugin-react-hooks
```

- [ ] **Step 2: Confirm the flat-config export names before writing the config**

Run: `node -e "import('eslint-plugin-react-hooks').then(m => console.log(Object.keys(m.default.configs)))"`
Expected: an array containing `recommended-latest` and/or `flat` (or `recommended`). The config below does not depend on any of these — it registers the plugin object and names the two rules explicitly — so whichever keys print, continue.

Run: `node -e "import('eslint-plugin-jsx-a11y').then(m => console.log(Object.keys(m.default.flatConfigs), Object.keys(m.default.flatConfigs.recommended.rules).length))"`
Expected: `[ 'recommended', 'strict' ] <N>` where `<N>` is the recommended rule count (around 35–40). If `flatConfigs` is `undefined`, the installed major predates flat-config support: run `bun add -d eslint-plugin-jsx-a11y@latest` and re-check — `flatConfigs` exists from 6.10.

- [ ] **Step 3: Extend `eslint.config.js`**

Replace lines 1–14 (the imports through the end of the global `rules` block) with:

```js
// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Phase 1 of the hygiene plan lands every jsx-a11y rule as `warn`; Phase 2
// (the primitives that fix the offending markup) flips them to `error`.
const jsxA11yAsWarnings = Object.fromEntries(
  Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [rule, 'warn']),
);

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ['**/*.{jsx,tsx}'],
    rules: jsxA11yAsWarnings,
  },
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      complexity: ['warn', 20],
      // A hook called conditionally is a bug, not a style choice — error from day one.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Decision D1: `interface XProps`, never `type XProps = {...}`.
      '@typescript-eslint/consistent-type-definitions': ['warn', 'interface'],
      'no-restricted-syntax': [
        'warn',
        {
          selector: "TSTypeReference[typeName.name='FC']",
          message: 'Use `export function X(props: XProps)` instead of React.FC (decision D1).',
        },
        {
          selector: "TSTypeReference[typeName.property.name='FC']",
          message: 'Use `export function X(props: XProps)` instead of React.FC (decision D1).',
        },
        {
          selector: "CallExpression[callee.name=/^(confirm|alert|prompt)$/]",
          message: 'Native prompts block the audio thread and cannot be styled — use a dialog component.',
        },
        {
          selector: "CallExpression[callee.object.name='window'][callee.property.name=/^(confirm|alert|prompt)$/]",
          message: 'Native prompts block the audio thread and cannot be styled — use a dialog component.',
        },
      ],
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['../../*'],
              message: 'Cross-folder imports use the `@/` alias (decision D2); relative paths only within one folder.',
            },
          ],
        },
      ],
    },
  },
```

Leave everything from the `// Layering rule 1` block to the closing `);` exactly as it is.

Notes on the shape:
- `jsxA11y.flatConfigs.recommended` carries its own `plugins`, `languageOptions` (JSX parser options) and `rules`; spreading it and then overriding `rules` keeps the plugin registration and replaces the severities. Restricting it to `**/*.{jsx,tsx}` keeps the a11y rules off pure `.ts` files.
- `reactHooks` is registered as a plugin object with the two rules named explicitly, so this works whether the installed version exposes `configs['recommended-latest']`, `configs.flat.recommended`, or `configs.recommended`.
- The `// @ts-check` pragma stays. If your editor's TS service reports missing types for `eslint-plugin-jsx-a11y` (it ships no `.d.ts`), that is an editor hint only; `bun run lint` does not type-check `eslint.config.js` (it is not in `tsconfig.json` `include`).

- [ ] **Step 4: Understand — and accept — where the `../../` ban does not reach yet**

ESLint's `no-restricted-imports` is a single rule; a later config object's setting replaces an earlier one's for matching files. The three layering blocks match `src/audio/**`, `src/store/**`, `src/components/**` and set the rule to their own `error` patterns, so inside those paths the `../../*` pattern from the global block is **not** active — it is active for everything else (`scripts/`, `src/*.ts(x)` at the top level, `src/utils/`, `src/pwa/`, `src/types/`, and so on).

This is expected for Phase 1. Phase 3 rewrites the layering blocks for the `features/` + `ui/` layout and adds the `../../` pattern into each block at that time (spec, *ESLint rule matrix*: `no-restricted-imports: ../../` goes to `error` in P3). Do **not** merge the pattern into the existing layering blocks now — the spec says they stay untouched, and merging would need the exemption block at the bottom (which turns the rule `'off'` for the analyser consumers and tests) to be reworked too.

- [ ] **Step 5: Confirm the config loads and count the warnings**

Run: `bun run eslint`
Expected: exit 0 (no errors). A list of warnings — `react-hooks/exhaustive-deps`, `jsx-a11y/*` (icon-only buttons, `<dialog>` without a role, click handlers on non-interactive elements), `@typescript-eslint/consistent-type-definitions` on the two `type XProps` files, `no-restricted-syntax` for `React.FC` in 46 files and for the six `confirm`/`alert` sites in `SynthPresetLibrary.tsx` / `ChordPresetLibrary.tsx`, and the pre-existing `complexity` warning on `SortableLoopCard.tsx`.

If instead ESLint exits non-zero with `Cannot read properties of undefined (reading 'recommended')` or `Key "plugins": Cannot redefine plugin "jsx-a11y"`:
- The first means the installed `eslint-plugin-jsx-a11y` has no `flatConfigs`; run `bun add -d eslint-plugin-jsx-a11y@latest` (see Step 2).
- The second means a plugin object was registered twice under one name; it cannot happen with the snippet above (only the spread config registers `jsx-a11y`), so check for a stray manual `plugins: { 'jsx-a11y': ... }` and remove it.

Run: `bun run eslint 2>&1 | tail -3`
Expected: a summary line of the form `✖ N problems (0 errors, N warnings)`. Copy `N` into the commit body in Step 7.

Run: `bun run eslint 2>&1 | grep -c "react-hooks/rules-of-hooks"`
Expected: `0` — the spec states there are no violations; if this prints anything else, the file it names has a conditional hook call, which is a real bug: fix it in this task and mention it in the commit body.

- [ ] **Step 6: Prove each new rule actually fires**

Create a throwaway file — it is deleted before the commit:

```bash
cat > src/utils/lintProbe.tsx <<'PROBE'
import React from 'react';
import { clampBpm } from '../../src/utils/musicTheory';
type Props = { on: boolean };
export const Probe: React.FC<Props> = ({ on }) => {
  if (on) React.useState(0);
  const ok = window.confirm('x');
  return <div onClick={() => alert(String(clampBpm(1) + Number(ok)))} />;
};
PROBE
bun run eslint src/utils/lintProbe.tsx 2>&1 | grep -oE "(react-hooks/rules-of-hooks|consistent-type-definitions|no-restricted-syntax|no-restricted-imports|jsx-a11y/[a-z-]+)" | sort -u
rm src/utils/lintProbe.tsx
```

Expected (order may differ):
```
@typescript-eslint/consistent-type-definitions
jsx-a11y/click-events-have-key-events
jsx-a11y/no-static-element-interactions
no-restricted-imports
no-restricted-syntax
react-hooks/rules-of-hooks
```

(The `no-restricted-imports` hit comes from `'../../src/utils/musicTheory'` — a `../../` path inside `src/utils/`, which no layering block covers, so the global pattern applies; it resolves back to the real module. `no-restricted-syntax` should appear three times before `sort -u`: `React.FC`, `window.confirm`, `alert`.)

Run: `git status --short`
Expected: only `eslint.config.js`, `package.json`, `bun.lock` — confirm `src/utils/lintProbe.tsx` is gone.

- [ ] **Step 7: Verify and commit**

Run: `bun run verify`
Expected: green (the gate does not yet run eslint — that is Task 3).

```bash
git add eslint.config.js package.json bun.lock
git commit -m "chore(eslint): add react-hooks, jsx-a11y and the convention rules as warnings

react-hooks/rules-of-hooks is error from the start; exhaustive-deps,
every jsx-a11y recommended rule, consistent-type-definitions
(interface), the React.FC / confirm-alert-prompt syntax bans and the
../../ import ban land as warn per decision D5.

bun run eslint: 0 errors, <N> warnings on main at this commit.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

Replace `<N>` with the number from Step 5 before running the command.

---

### Task 3: `verify` runs eslint; confirm the `@/` alias

Spec, Phase 1 items 3 and 4.

**Files:**
- Modify: `package.json:14` (`scripts.verify`)

**Interfaces:**
- Consumes: the `eslint` script already in `package.json`.
- Produces: `verify` = `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build`.

- [ ] **Step 1: Confirm the alias is declared in both places (do not re-add)**

Run: `grep -n '"@/\*"' tsconfig.strict.json && grep -n "'@':" vite.config.ts`
Expected:
```
tsconfig.strict.json:16:      "@/*": ["./src/*"]
vite.config.ts:84:      '@': fileURLToPath(new URL('./src', import.meta.url)),
```
(Line numbers may drift by one after Task 1 removed a line from `tsconfig.strict.json`; the two matches are what matters.)

- [ ] **Step 2: Prove the alias resolves under all three consumers (build, tsc, bun test)**

Create a throwaway test, run it, and delete it:

```bash
cat > src/aliasProbe.test.ts <<'PROBE'
import { expect, test } from 'bun:test';
import { clampBpm } from '@/utils/musicTheory';
test('@/ alias resolves in bun test', () => { expect(typeof clampBpm).toBe('function'); });
PROBE
bun test src/aliasProbe.test.ts && bunx tsc --noEmit -p tsconfig.json && rm src/aliasProbe.test.ts
```

Expected: `1 pass`, `tsc` silent, file removed. `git status --short` shows nothing under `src/`.

- [ ] **Step 3: Edit the gate**

In `package.json`, replace the `verify` line:

```diff
-    "verify": "bun test && bun run lint && bun run check:keys && bun run check:drums && bun run build"
+    "verify": "bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build"
```

- [ ] **Step 4: Verify (now including eslint) and commit**

Run: `bun run verify`
Expected: the eslint step prints the warning list from Task 2 and the summary `(0 errors, N warnings)`; the build step still runs afterwards and succeeds. The build output confirms the `@/` alias (`resolve.alias`) is live in Vite; no source file is rewritten to `@/` in this phase.

```bash
git add package.json
git commit -m "chore(scripts): run eslint inside the verify gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 4: `DEFAULT_BPM` — one constant, two readers

Spec D9: the transport slice is the runtime owner of `bpm`; `factoryProjectContent()` must match it by reading the same constant rather than restating `120`.

**Files:**
- Modify: `src/store/transportSlice.ts:8` (add the export after the `Set`/`Get` aliases) and `:103` (initial state)
- Modify: `src/store/projectFormat.ts:1-7` (import) and `:91` (`factoryProjectContent`)
- Modify: `src/store/projectFormat.test.ts:1-13` (import) and `:113-122` (the factory test)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const DEFAULT_BPM = 120;` from `src/store/transportSlice.ts`. `store/` importing `store/` keeps the layering rules satisfied; `projectFormat.ts` already imports from sibling slice files (`./loopSlice`, `./initialState`).

- [ ] **Step 1: Write the failing assertion first**

In `src/store/projectFormat.test.ts`, add the import after line 12 (`import { INITIAL_EFFECTS } from './initialState';`):

```ts
import { DEFAULT_BPM } from './transportSlice';
```

and in the `factory content is the store defaults with one default loop` test (line 116) change the bpm assertion:

```diff
     const c = factoryProjectContent();
-    expect(c.bpm).toBe(120);
+    expect(c.bpm).toBe(DEFAULT_BPM);
     expect(c.meterId).toBe('4/4');
```

Run: `bun test src/store/projectFormat.test.ts`
Expected: fails to compile/run — `export 'DEFAULT_BPM' not found in './transportSlice'` (Bun reports it as a `SyntaxError` at import time).

- [ ] **Step 2: Export the constant from the slice**

In `src/store/transportSlice.ts`, after line 9 (`type Get = StoreApi<AppStore>['getState'];`) add:

```ts
/** The transport's default tempo; factoryProjectContent() reads it so a new project matches a fresh session. */
export const DEFAULT_BPM = 120;
```

and at line 103 (inside the returned initial state; the line number shifts by the lines just added):

```diff
   return {
-    bpm: 120,
+    bpm: DEFAULT_BPM,
     meterId: DEFAULT_METER_ID,
```

- [ ] **Step 3: Read it from the project format**

In `src/store/projectFormat.ts`, add after line 6 (`import { createDefaultLoop } from './loopSlice';`):

```ts
import { DEFAULT_BPM } from './transportSlice';
```

and in `factoryProjectContent()`:

```diff
 export function factoryProjectContent(): ProjectContent {
   return {
-    bpm: 120,
+    bpm: DEFAULT_BPM,
     meterId: DEFAULT_METER_ID,
```

- [ ] **Step 4: Check for an import cycle**

`transportSlice.ts` imports from `../utils/musicTheory`, `../utils/meter`, `./types`, `./playbackScope` — none of which import `projectFormat.ts`, so no cycle is introduced. Confirm:

Run: `grep -n "projectFormat" src/store/transportSlice.ts src/store/playbackScope.ts src/utils/musicTheory.ts src/utils/meter.ts`
Expected: no output.

- [ ] **Step 5: Test, verify and commit**

Run: `bun test src/store/projectFormat.test.ts src/store/projectDirty.test.ts src/store/store.test.ts`
Expected: all pass.

Run: `bun run verify`
Expected: green; eslint warning count unchanged from Task 2.

```bash
git add src/store/transportSlice.ts src/store/projectFormat.ts src/store/projectFormat.test.ts
git commit -m "refactor(store): DEFAULT_BPM owned by transportSlice, read by factoryProjectContent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 5: Rename `utils/projectFile.ts` → `utils/projectFileIO.ts`

Spec D8: `store/projectFile.ts` owns the format; `utils/projectFile.ts` owns browser I/O and gets the `IO` suffix. Its one non-test importer is `project/ProjectManagerModal.tsx`.

**Files:**
- Rename: `src/utils/projectFile.ts` → `src/utils/projectFileIO.ts`
- Rename: `src/utils/projectFile.test.ts` → `src/utils/projectFileIO.test.ts`
- Modify: `src/utils/projectFileIO.test.ts:2` (its own relative import)
- Modify: `src/components/project/ProjectManagerModal.tsx:7`

**Interfaces:**
- Consumes: nothing new.
- Produces: the same exports (`downloadTextFile`, `readFileAsText`, `slugifyProjectName`, `projectFileName`) from the new path. `src/store/projectFile.ts` and its test (`src/store/projectFile.test.ts:2`, `./projectFile`) are **not** touched.

- [ ] **Step 1: List every importer before moving**

Run: `grep -rn "utils/projectFile'" src; grep -rn "from './projectFile'" src/utils`
Expected:
```
src/components/project/ProjectManagerModal.tsx:7:import { downloadTextFile, projectFileName, readFileAsText } from '../../utils/projectFile';
src/utils/projectFile.test.ts:2:import { downloadTextFile, projectFileName, readFileAsText, slugifyProjectName } from './projectFile';
```

- [ ] **Step 2: Move with `git mv`**

```bash
git mv src/utils/projectFile.ts src/utils/projectFileIO.ts
git mv src/utils/projectFile.test.ts src/utils/projectFileIO.test.ts
```

- [ ] **Step 3: Update the two importers**

`src/utils/projectFileIO.test.ts:2`:

```diff
-import { downloadTextFile, projectFileName, readFileAsText, slugifyProjectName } from './projectFile';
+import { downloadTextFile, projectFileName, readFileAsText, slugifyProjectName } from './projectFileIO';
```

`src/components/project/ProjectManagerModal.tsx:7`:

```diff
-import { downloadTextFile, projectFileName, readFileAsText } from '../../utils/projectFile';
+import { downloadTextFile, projectFileName, readFileAsText } from '../../utils/projectFileIO';
```

(This stays a `../../` path on purpose — nothing is rewritten to `@/` in Phase 1, and the `src/components/**` layering block overrides the global `../../` warning anyway, see Task 2 Step 4.)

- [ ] **Step 4: Confirm nothing still points at the old name**

Run: `grep -rn "utils/projectFile'" src docs/superpowers/plans/2026-09-04-phase1-tooling.md; grep -rn "from './projectFile'" src/utils`
Expected: no output from `src`. (The 2026-09-03 plan and the spec mention the old path historically; leave them.)

- [ ] **Step 5: Test, verify and commit**

Run: `bun test src/utils/projectFileIO.test.ts src/store/projectFile.test.ts`
Expected: both files pass.

Run: `bun run verify`
Expected: green.

```bash
git add src/utils/projectFileIO.ts src/utils/projectFileIO.test.ts src/components/project/ProjectManagerModal.tsx
git commit -m "refactor(utils): rename projectFile to projectFileIO

The store module of the same basename owns the format; this one owns
browser file I/O (decision D8).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

Note `git add` on the renamed paths is enough: `git mv` already staged the rename, and re-adding the new path records the edited content.

---

### Task 6: Drop the three task/phase references from comments

Spec, Phase 1 item 7: keep the reason, drop the history reference.

**Files:**
- Modify: `src/components/project/ProjectManagerModal.tsx:73-78`
- Modify: `src/audio/data/vibeEffectChains.ts:88-96`
- Modify: `src/audio/data/vibeDrumPatterns.ts:104-111`

**Interfaces:**
- Consumes / Produces: comments only; no code changes.

- [ ] **Step 1: Confirm the three sites**

Run: `grep -rniE "task 12|phase 1 (and|precedent)" src`
Expected:
```
src/components/project/ProjectManagerModal.tsx:77:   * is reachable (closing would unmount it, per the Task 12 review finding).
src/audio/data/vibeEffectChains.ts:94: * `resolveProgression` and `drumPatternById`, the phase 1 and phase 3
src/audio/data/vibeDrumPatterns.ts:110: * phase 1 precedent, also returns freshly built objects every call.
```

- [ ] **Step 2: `ProjectManagerModal.tsx` — keep "closing would unmount it"**

```diff
   /**
    * Import may have something the user needs to see — an unavailable-storage
    * caveat, unrecognised references, or both — in which case the project is
    * still installed into the session but the modal stays open so the notice
-   * is reachable (closing would unmount it, per the Task 12 review finding).
+   * is reachable (closing would unmount it).
    */
```

- [ ] **Step 3: `vibeEffectChains.ts` — keep the precedent, drop the phase labels**

```diff
  * Returns a FRESH shallow copy on every call — never the module's own object.
  * A shallow copy is sufficient and correct here: every value in a chain is a
  * scalar (number), so there is no nested structure for a copy to alias.
- * `resolveProgression` and `drumPatternById`, the phase 1 and phase 3
- * precedents, also return freshly built objects every call.
+ * `resolveProgression` and `drumPatternById` follow the same rule and also
+ * return freshly built objects every call.
  */
```

- [ ] **Step 4: `vibeDrumPatterns.ts` — same treatment**

```diff
  * transforms it to a boolean grid via .map(), so the grid in the store shares
  * no array references with the library regardless — but the copy guards the
- * library itself against any direct mutation.) `resolveProgression`, the
- * phase 1 precedent, also returns freshly built objects every call.
+ * library itself against any direct mutation.) `resolveProgression` follows
+ * the same rule and also returns freshly built objects every call.
  */
```

- [ ] **Step 5: Confirm, verify and commit**

Run: `grep -rniE "task [0-9]+|phase [0-9]" src`
Expected: no output. (If a match appears outside the three files above, it is out of this task's scope — note it in the commit body and leave it.)

Run: `bun run verify`
Expected: green.

```bash
git add src/components/project/ProjectManagerModal.tsx src/audio/data/vibeEffectChains.ts src/audio/data/vibeDrumPatterns.ts
git commit -m "docs(comments): drop plan task and phase references, keep the reasons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

### Task 7: CLAUDE.md — the gate now runs eslint

The paragraph at `CLAUDE.md:27-29` says `verify` does not include eslint; after Task 3 that is false, and a false instruction is worse than none.

**Files:**
- Modify: `CLAUDE.md:24` (the command-table comment) and `CLAUDE.md:27-29`

**Interfaces:**
- Consumes / Produces: docs only.

- [ ] **Step 1: Update the command comment**

```diff
-bun run verify         # test + lint + check:keys + check:drums + build (the gate)
+bun run verify         # test + lint + eslint + check:keys + check:drums + build (the gate)
```

- [ ] **Step 2: Replace the eslint caveat**

```diff
-`bun run verify` is the completion gate — run it before claiming work is done. It does **not**
-include `bun run eslint`, so unused variables and imports pass the gate unnoticed; run eslint
-separately whenever you touch imports or delete code.
+`bun run verify` is the completion gate — run it before claiming work is done. It runs
+`bun run eslint`, which must report zero errors; warnings are tolerated until the phase that
+fixes them flips the rule to `error` (see the ESLint rule matrix in
+`docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md`).
```

- [ ] **Step 3: Check nothing else in the repo repeats the stale claim**

Run: `grep -rn "not.*include.*eslint\|eslint.*not.*gate\|eslint.*separately" CLAUDE.md .claude docs/design.md README.md 2>/dev/null`
Expected: no output. (Older plans under `docs/superpowers/plans/` describe the gate as it was when they were written; leave them.)

- [ ] **Step 4: Final verify and commit**

Run: `bun run verify`
Expected: green — tests, `tsc` under `strict`, eslint with `0 errors`, `check:keys`, `check:drums`, build.

Run: `bun run eslint 2>&1 | tail -1`
Expected: `✖ N problems (0 errors, N warnings)` — the same `N` recorded in Task 2's commit (Tasks 4–6 added no warnings). Put this line in the PR description as the Phase 1 baseline.

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): verify now runs eslint

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GfaSnXgbwJGHRwMGkpxKAr"
```

---

## Self-review

**Spec coverage** — every Phase 1 item maps to a task:

| Spec item | Task |
| --- | --- |
| 1. `strict: true`, drop `noImplicitAny: false`, fix the 3 errors | 1 |
| 2. react-hooks + jsx-a11y devDeps; D3 rules; `warn` except `rules-of-hooks` | 2 |
| 3. `verify` includes `bun run eslint` | 3 |
| 4. `@/` alias: confirm, do not re-add; nothing rewritten; `../../` is `warn` | 3 (Steps 1–2), 2 (rule) |
| 5. `DEFAULT_BPM` in `transportSlice`, read by `factoryProjectContent` (D9) | 4 |
| 6. `git mv` `utils/projectFile` → `utils/projectFileIO` + test, update importer (D8) | 5 |
| 7. Remove the three task/phase comments, keep the reason | 6 |
| 8. Leave the `complexity` warning on `SortableLoopCard.tsx` | 2 (untouched, counted) |
| Acceptance: `verify` green, zero ESLint errors, warnings counted | 2 (Step 5), 7 (Step 4) |
| Testing: `bun run eslint` standalone after the phase | 7 (Step 4) |
| Rule matrix, P1 column | 2 (Step 3): `rules-of-hooks` error; `exhaustive-deps`, jsx-a11y, `confirm/alert/prompt`, `React.FC`, `../../`, `consistent-type-definitions` warn |
| CLAUDE.md sentence about eslint not being in the gate | 7 |

**Placeholder scan** — no "TBD", "similar to Task N", or "add appropriate"; the one deliberate template is `<N>` in Task 2's commit body, which Step 5 tells the worker to fill from measured output.

**Name consistency** — `DEFAULT_BPM` (Task 4) is the name spec D9 uses; `projectFileIO` (Task 5) matches D8; the rule ids in Task 2 match the spec's *ESLint rule matrix* rows one-for-one; the three comment sites in Task 6 match the spec's *Measurements* row (`ProjectManagerModal.tsx:77`, `vibeEffectChains.ts:94`, `vibeDrumPatterns.ts:110`).

**Known limitation stated in-plan** — the `../../` ban does not reach `src/audio/`, `src/store/` or `src/components/` in Phase 1 because the path-scoped layering blocks override the global `no-restricted-imports` setting (Task 2 Step 4). The spec keeps those blocks untouched here and reworks them in Phase 3, where the pattern becomes `error`.
