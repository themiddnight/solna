# Dependency Upgrade Research — Solna

Research date: 2026-08-29. Versions verified against the npm registry on this date via `npm view`. All claims are source-cited. This document is **research only** — no `package.json`, config, or source was modified.

The headline finding is that "upgrade everything to latest" is **not a single-pass job**: three upgrades (React 19, TypeScript 6/7, Vite 8) each need small, well-understood source/config changes, and **TypeScript 7 cannot be adopted yet** because the eslint/type-tooling ecosystem (typescript-eslint) does not support the Go-native compiler.

---

## 1. Summary table

| Package | Current | Target | Type | Risk | One-line reason |
|---|---|---|---|---|---|
| react | ^18.3.1 | 19.2.8 | major | **high** | Runtime semantics change (ref cleanup, StrictMode, removed DOM APIs); code scan shows few hits, but runtime needs a manual smoke test. |
| react-dom | ^18.3.1 | 19.2.8 | major | **high** | Same as react; `react-dom/server` `renderToString` is deprecated in 19. |
| @types/react | ^18.3.12 | 19.2.18 | major | med | `FC` no longer implicitly includes `children`; repo appears already compliant but must be confirmed by `tsc`. |
| @types/react-dom | ^18.3.1 | 19.2.5 | major | low | Type-only; `createRoot`/`hydrateRoot` already used. |
| typescript | ^5.7.3 | **6.0.3** (not 7.0.2) | major | med | 6.0 is the JS-compiler "bridge" release; needs `baseUrl` removal + `types:["node"]` + a `vite-env.d.ts`. **7.0.2 blocked** by typescript-eslint peer `<6.1.0` and no stable TS API until 7.1. |
| vite | ^6.1.0 | 8.2.2 | major | **high** | Vite 8 is the Rolldown/Oxc rewrite: `build.rollupOptions`→`build.rolldownOptions`, `manualChunks` deprecated, ESM-only config loading breaks `__dirname`. |
| @vitejs/plugin-react | ^4.3.4 | 6.1.1 | major | med | v6 requires Vite 8 and drops Babel (React Refresh via Oxc); repo has no custom Babel, so it's a clean swap. v5.2.0 is the Vite-7-era alternative. |
| eslint | ^10.9.0 | 10.9.1 | patch | low | Patch; flat config API unchanged. |
| @eslint/js | ^10.0.1 | 10.0.1 | none | low | Already latest. |
| typescript-eslint | ^8.67.0 | 8.68.0 | patch | low (but caps TS) | Patch; peer is `typescript >=4.8.4 <6.1.0` — this is what blocks TS 7. |
| zustand | ^5.0.15 | 5.0.15 | none | low | Already latest; peer `react >=18`, React 19 OK. |
| @dnd-kit/core | ^6.3.1 | 6.3.1 | none | med | Already latest; peer `react >=16.8` allows 19, but verify drag behaviour under React 19 StrictMode. |
| @dnd-kit/sortable | ^10.0.0 | 10.0.0 | none | med | Already latest; `setNodeRef` ref-callback must return `void` under React 19 types. |
| @dnd-kit/utilities | ^3.2.2 | 3.2.2 | none | low | Already latest. |
| daisyui | ^5.7.22 | 5.7.22 | none | low | Already latest; no React peer (CSS-first). |
| tailwindcss | ^4.0.6 | 4.3.3 | minor (4.x) | med | 4.0→4.3 within major 4; theme-token guard scripts should catch any class drift. |
| @tailwindcss/vite | ^4.0.6 | 4.3.3 | minor (4.x) | low | Peer `vite ^5.2 || ^6 || ^7 || ^8` — supports Vite 8. |
| lucide-react | ^0.475.0 | 1.37.0 | major | med | v1 removes brand icons (none used here), flips `aria-hidden` default to true; `LucideIcon` type still exported. |
| tonal | ^6.4.3 | 6.4.3 | none | low | Already latest; no React peer. |
| @types/node | ^22.0.0 | 26.4.0 | major | low–med | Matches the Node v26 runtime; combined with the TS 6 `types:["node"]` change. |

---

## 2. Per-major migration checklists

### 2.1 React 18 → 19

Sources:
- React 19 release post: https://react.dev/blog/2024/04/25/react-19
- React 19 Upgrade Guide: https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- types-react-codemod (`preset-19`): https://github.com/eps1lon/types-react-codemod

Checklist a project must clear:

1. **`ReactDOM.render` / `ReactDOM.hydrate` / `unmountComponentAtNode` removed.** Must use `createRoot`/`hydrateRoot` (`react-dom/client`) and `root.unmount()`. (Upgrade Guide, "Removed deprecated React DOM APIs".) Solna is already clear — `src/main.tsx` uses `createRoot`.
2. **`react-dom/test-utils` changed.** `act` moved to the `react` package; all other `test-utils` exports error when called. Solna's tests import only `react-dom/server` `renderToString`, not `test-utils` — clear.
3. **`propTypes` and `defaultProps` for function components removed** (runtime silently ignores them; use ES default params). Solna has neither — clear.
4. **`element.ref` deprecated** in favour of `element.props.ref`. Solna never accesses `.ref` on elements — clear.
5. **Legacy context (`contextTypes`/`getChildContext`), string refs, module-pattern factories, `React.createFactory`, `react-test-renderer/shallow` removed.** None used — clear.
6. **`forwardRef` no longer needed; `ref` becomes a normal prop** for function components. Not removed in 19 (removal deferred to a future version), so existing `forwardRef` keeps working — but Solna has none, so nothing to do either way.
7. **`<Context>` can be rendered as a provider** (`<Context value>`); `<Context.Provider>` stays supported (future deprecation). Solna has zero `createContext` call sites — clear.
8. **`useRef` now requires an argument** (`useRef()` errors; use `useRef(undefined)`). Solna's ~30 `useRef` calls all pass an initial value or a type argument — clear.
9. **Ref callbacks may now return a cleanup function; returning any other value is a TS error** (fix implicit returns like `ref={c => (x = c)}`). Solna's only callback refs are `ref={setNodeRef}` (dnd-kit, returns `void`) and ref objects (`ref={canvasRef}` etc.) — verify dnd-kit's `setNodeRef` signature under `@types/react` 19 (see §3.4).
10. **`@types/react` 19 changes:** `React.FC` no longer implicitly includes `children`; `ReactElement["props"]` defaults to `unknown` (was `any`); the global `JSX` namespace is scoped to `React.JSX`; `MutableRef` deprecated. (Upgrade Guide, "TypeScript changes"; types-react-codemod `preset-19`.)
11. **`react-dom/server` `renderToString` is deprecated** (legacy). It still works in 19 — Solna's ~17 test files using it keep passing, but may emit deprecation warnings; migrating to `renderToReadableStream` is optional and deferred (see §5).
12. **New JSX transform is required.** Solna already uses `"jsx": "react-jsx"` (tsconfig) — clear.
13. **Runtime-only behaviours to smoke-test:** errors in render are no longer re-thrown (reported to `window.reportError`); ref callbacks are double-invoked on initial mount in dev StrictMode; `useMemo`/`useCallback` may reuse memoised results across StrictMode renders. (Upgrade Guide, "Breaking changes"/"Notable changes".)
14. **Recommended codemod path:** `npx codemod@latest react/19/migration-recipe` and `npx types-react-codemod@latest preset-19 ./src`. Given the scan shows the repo is already compliant on nearly every axis, the codemod is optional.

### 2.2 TypeScript 5.7 → 6.0 (and why not 7.0)

Sources:
- TS native-port announcement (Mar 2025): https://devblogs.microsoft.com/typescript/typescript-native-port/
- TS 6.0 announcement: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- TS 7.0 release (Jul 8, 2026), as covered by InfoQ: https://www.infoq.com/news/2026/08/typescript-7-released/
- typescript-eslint peer range, verified via `npm view typescript-eslint@8.68.0 peerDependencies`

What `typescript@7` is:

- The npm package `typescript@7.0.2` **is** the Go-native compiler (Project Corsa / typescript-go). It still installs a `tsc` binary (`bin/tsc`), so the CLI name does **not** change to `tsgo` at the package level (`tsgo` is the engine codename; `@typescript/native-preview` was the old preview distribution). Verified via `npm view typescript@7.0.2 name bin` → `name='typescript'`, `{ tsc: 'bin/tsc' }`.
- It is a faithful, line-by-line port of the TS 6.0 semantics, so **type-checking behaviour is intended to be identical to 6.0**, but TS 6.0's deprecations become hard errors in 7.0 and new defaults become mandatory: `strict` defaults to `true`, `module` defaults to `esnext`, and options removed include `target: es5`, `downlevelIteration`, `moduleResolution: node/node10/classic`, `amd/umd/systemjs` modules, and **`baseUrl`**.
- **TS 7 does not yet ship a stable programmatic API (expected 7.1)** — so ecosystem tooling that drives the compiler's JS API (typescript-eslint, Volar, webpack loaders, framework tooling) cannot use TS 7 yet and must stay on TS 6. typescript-eslint 8.68 explicitly peers `typescript: ">=4.8.4 <6.1.0"`.
- Migration shim: `@typescript/typescript6` provides a `tsc6` binary for running 6.0 side-by-side with 7.0.

Recommended target: **6.0.3** (latest of the JS-based line, satisfies the typescript-eslint peer). This is a genuine TS 6.0 breaking-change checklist for this repo:

1. **`baseUrl` is deprecated in 6.0 and removed in 7.0.** Solna sets `baseUrl: "."` in `tsconfig.strict.json` — remove it; `paths` works standalone (since TS 4.1). Map entries like `"@/*": ["./src/*"]` need no change.
2. **`types` defaults to `[]` in 6.0** (no automatic `@types` global inclusion). Solna relies on `@types/node` globals (`process.exit` in `scripts/check-key-bindings.ts`, `scripts/check-drum-kit-separation.ts`, `scripts/checkTheme.ts`; `__dirname` in `vite.config.ts`). Fix: add `"types": ["node"]` to `compilerOptions`. (`@types/react` / `@types/react-dom` are still resolved via module imports, unaffected by `types:[]`.)
3. **`noUncheckedSideEffectImports` defaults to `true`.** `src/main.tsx` imports `./index.css` — under 6.0 this errors unless a CSS module declaration exists. Fix: add `src/vite-env.d.ts` with `/// <reference types="vite/client" />` (declares `*.css`).
4. **`esModuleInterop`/`allowSyntheticDefaultImports` can no longer be `false`.** Solna sets both to `true` — clear.
5. **`strict: false` is fine.** Only the default flipped to `true`; an explicit `false` is honoured. Same for `target: ES2022` (default is now `es2025` but explicit values win).
6. `moduleResolution: "bundler"` + `module: "ESNext"` is the recommended combination — already in use.

### 2.3 Vite 6 → 7 → 8

Sources:
- Vite migration index (7→8): https://vite.dev/guide/migration
- Vite 6→7 guide (v7 docs): https://v7.vite.dev/guide/migration
- Vite 8 / Rolldown write-up: https://certificates.dev/blog/migrating-to-vite-8-rolldown
- manualChunks→advancedChunks walkthrough: https://dev.classmethod.jp/articles/vite7-to-vite8-migration-pitfalls/

**Vite 6 → 7:**
- Node.js requirement bumps to **20.19+ / 22.12+** (Node 18 EOL). Solna runs Node v26.3.0 — clear.
- Default `build.target` `'modules'` is removed; new default `'baseline-widely-available'` (Chrome 107/Edge 107/Firefox 104/Safari 16.0). Solna doesn't set `build.target` — behaviour change only (older-browser support dropped).
- `splitVendorChunkPlugin` (long-deprecated) removed; `manualChunks` still valid under `rollupOptions` at this stage.
- Sass legacy API, `transformIndexHtml` hook `enforce`/`transform`, several deprecated type-only props removed — none used by Solna.
- No ESM-only requirement introduced here; `server.allowedHosts` unchanged at this stage.

**Vite 7 → 8 (the big one — Rolldown/Oxc rewrite):**
- **`build.rollupOptions` renamed to `build.rolldownOptions`** (still auto-converted with a deprecation warning; removed in a future version). Same for `worker.rollupOptions`.
- **`manualChunks` object form removed; function form deprecated** (still works, slated for removal). Replacement: `advancedChunks` groups in `rolldownOptions.output` (name/test/priority/minShareCount/maxSize), or the newer `build.codeSplitting` API. Solna uses **function-form** `manualChunks` in `vite.config.ts` — works but deprecated; migrate to `advancedChunks`.
- **Config files are bundled and loaded as ESM by Rolldown** — `__dirname` is undefined in an ESM-bundled config. Solna's `vite.config.ts` uses `path.resolve(__dirname, './src')` → **hard break**; fix with `import.meta.dirname` (Node ≥20.11) or `fileURLToPath(new URL('./src', import.meta.url))`.
- **CJS interop is now consistent:** for a `"type": "module"` app, a CJS package's `default` import equals `module.exports`. This affects how `import React from 'react'` is resolved. React's main entry is CJS; under the new rule the default import resolves to the module object, which is what Solna already relies on — but the `?commonjs-*` id matching described in the `vite.config.ts` vendor-chunk comment is Rolldown-era-stale and must be re-verified at build time (see §5). Escape hatch: `legacy.inconsistentCjsInterop: true`.
- **esbuild becomes optional**; `transformWithEsbuild` deprecated in favour of `transformWithOxc`. Only relevant if a plugin uses it — Solna doesn't.
- **Browser targets bump** to Chrome 111 / Edge 111 / Firefox 114 / Safari 16.4.
- `'system'`/`'amd'` output formats unsupported; some advanced Rollup hooks (`shouldTransformCachedModule`, `resolveImportMeta`, …) unsupported — none used.
- Node requirement stays 20.19+ / 22.12+; package is now **ESM-only**.
- `import.meta.hot.accept(url)` no longer accepted; `build.rollupOptions.watch.chokidar` removed — not used by Solna.

### 2.4 @vitejs/plugin-react 4 → 6

Source: plugin-react CHANGELOG — https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/CHANGELOG.md (raw: https://raw.githubusercontent.com/vitejs/vite-plugin-react/main/packages/plugin-react/CHANGELOG.md). Peer/engine data verified via `npm view`.

Version-line reality:
- **4.x (latest 4.7.0):** peer `vite ^4.2 || ^5 || ^6 || ^7`. Babel-based. Solna is on ^4.3.4.
- **5.x (latest 5.2.0):** peer `vite ^4.2 || ^5 || ^6 || ^7 || ^8`; Node `^20.19 || >=22.12`. Babel is still the transform engine for regular Vite; Oxc only on the rolldown-vite path. This is the fallback if you want Vite 8 but want to avoid plugin-react 6.
- **6.x (latest 6.1.1):** peer **`vite ^8.0.0`** ("Vite 7 and below are no longer supported"). **Babel removed entirely** — Vite 8's Oxc handles the React Refresh transform; if you genuinely need Babel you must add `@rolldown/plugin-babel`. `oxc-transform-react` is an **optional** peer used only for opt-in React Compiler support (`react({ compiler: true })`), not required for the default path. Node `^20.19 || >=22.12`.

Solna's exposure: no custom Babel config, no React Compiler — so **plugin-react 6.1.1 on Vite 8 is a clean drop-in**; the only config work is the Vite 8 items in §2.3. If the team wants to land on Vite 8 without the plugin 6 jump, plugin-react 5.2.0 supports Vite 8 as a stopgap.

### 2.5 Third-party React-19 / Vite-8 compatibility (peer-dependency verdicts)

All verified via `npm view <pkg>@<ver> peerDependencies` on 2026-08-29:

| Package (target) | peer range | React 19? | Vite 8? |
|---|---|---|---|
| zustand@5.0.15 | `react >=18`, `@types/react >=18` | ✅ (>=18 includes 19) | n/a |
| @dnd-kit/core@6.3.1 | `react >=16.8`, `react-dom >=16.8` | ✅ | n/a |
| @dnd-kit/sortable@10.0.0 | `react >=16.8`, `@dnd-kit/core ^6.3.0` | ✅ | n/a |
| @dnd-kit/utilities@3.2.2 | `react >=16.8` | ✅ | n/a |
| lucide-react@1.37.0 | `react ^16.5.1 || ^17 || ^18 || ^19` | ✅ | n/a |
| daisyui@5.7.22 | none declared (CSS-first) | ✅ | n/a |
| tailwindcss@4.3.3 | none declared | n/a | n/a |
| @tailwindcss/vite@4.3.3 | `vite ^5.2 || ^6 || ^7 || ^8` | n/a | ✅ |
| tonal@6.4.3 | none declared | n/a | n/a |
| @vitejs/plugin-react@6.1.1 | `vite ^8.0.0` (+optional oxc/babel peers) | n/a | ✅ (requires 8) |

No third-party package pins `react@18` exclusively; nothing blocks React 19 or Vite 8 at the peer level.

---

## 3. Concrete code changes needed (Thread B findings)

Full scan of `src/**/*.{ts,tsx}`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `index.html`. Hits mapped to the migration step that resolves them.

### 3.1 React 19 — already compliant (no change required)

| Pattern | Result |
|---|---|
| `ReactDOM.render`/`hydrate`/`unmountComponentAtNode` | Not present. `src/main.tsx:2,8` already uses `ReactDOM.createRoot` + `root.render` + `<React.StrictMode>`. ✅ |
| `forwardRef` | No hits in `src/`. ✅ |
| `defaultProps` | No hits. ✅ |
| `.ref` direct element access (`props.ref`, `element.ref`) | No hits. ✅ |
| `createContext` / `.Provider` / `.Consumer` | No hits anywhere in `src/`. ✅ |
| `useRef()` with no argument | No hits; all ~30 `useRef` calls pass a value/type arg (e.g. `useRef<HTMLCanvasElement | null>(null)`). ✅ |
| `propTypes` | No hits. ✅ |
| Global `JSX.Element` namespace | No hits (React 19 scopes it to `React.JSX`). ✅ |

### 3.2 React 19 — verify after `@types/react` bump

- **`React.FC` usages (~25 sites)** — under `@types/react` 19, `FC<P>` no longer bakes in `children?: ReactNode`. Affected files include `src/components/ChordView.tsx:169`, `DrumPads.tsx:29`, `AudioVisualizer.tsx:75`, `SynthPresetLibrary.tsx:46`, `ChordPresetLibrary.tsx:56`, `Header.tsx:34,62,143`, `TransportBar.tsx:12`, `SimpleSynthPanel.tsx:13`, `EffectsRackView.tsx:17`, `ui/Field.tsx:23`, `ui/Wordmark.tsx:16`, `ui/PowerToggle.tsx:86`, `InstantVibesBar.tsx:58`, `ui/QuickSavePopover.tsx:26`, `ui/ChannelStrip.tsx:30`, `ui/ViewHeader.tsx:25`, `ui/PlayerTransport.tsx:69`, `ui/MidiIndicator.tsx:5`, `ui/VuMeter.tsx:21`, `ui/MidiSettingsModal.tsx:17`, `sequencer/StepHeader.tsx:14`, `sequencer/TrackRow.tsx:24`. The two components that render children (`Field`, `ViewHeader`) already declare `children` in their Props (`ui/Field.tsx:10`, `ui/ViewHeader.tsx:13`), so **likely zero code changes** — resolve by running `bun run lint` (tsc) after the type bump.
- **`src/components/chord/SortableChordCard.tsx:72` `ref={setNodeRef}`** — dnd-kit callback ref must return `void` under the React 19 ref-cleanup typing rule. Verify `setNodeRef`'s type after `@types/react` 19; expected no change (dnd-kit 6.3.1 is React-19-compatible).
- **`react-dom/server` `renderToString`** in 17 test files (98 grep hits, e.g. `src/components/ui/Knob.test.tsx:2`) — deprecated in 19 but functional; keep for now, revisit when React 20 drops it. (See §5.)

### 3.3 TypeScript 6.0 — required config changes (do these first, they are 5.7-safe too)

| File:line | Change | Resolves |
|---|---|---|
| `tsconfig.strict.json:16` (`"baseUrl": "."`) | **Remove** `baseUrl` (keep `paths`). | TS 6.0 deprecates `baseUrl`; TS 7 removes it. |
| `tsconfig.strict.json` (`compilerOptions`) | **Add `"types": ["node"]`**. | TS 6.0 `types:[]` default otherwise kills `process.exit` in `scripts/check-key-bindings.ts:27`, `scripts/check-drum-kit-separation.ts:67`, `scripts/checkTheme.ts:3,12`, and `__dirname` in `vite.config.ts:38`. |
| new file `src/vite-env.d.ts` | `/// <reference types="vite/client" />` | TS 6.0 `noUncheckedSideEffectImports:true` otherwise errors on `src/main.tsx:4 import './index.css'`. |
| `tsconfig.strict.json` (`"strict": false`, `"target": "ES2022"`, `"moduleResolution": "bundler"`) | Keep as-is (explicit values beat the new defaults). | n/a. |

### 3.4 Vite 8 — required config changes

| File:line | Change | Resolves |
|---|---|---|
| `vite.config.ts:38` (`path.resolve(__dirname, './src')`) | `__dirname` → `import.meta.dirname` (or `fileURLToPath(new URL('./src', import.meta.url))`). | Vite 8 bundles config as ESM; `__dirname` is `undefined`. Hard runtime break. |
| `vite.config.ts:6` `build.rollupOptions` | Rename to `build.rolldownOptions` (deprecated-alias still works, but clean it up). | Vite 8 rename. |
| `vite.config.ts:14-30` `output.manualChunks(id)` function | Migrate to `rolldownOptions.output.advancedChunks` groups (vendor/tonal/dndkit/icons), or keep function form as a deprecated stopgap. | Vite 8: object form removed, function form deprecated. |
| `vite.config.ts:22-26` vendor-chunk comment re `?commonjs-*` ids | Re-verify against Rolldown's CJS handling; the id shape may have changed. | Vite 8 CJS interop rewrite. |
| `vite.config.ts` `server.allowedHosts: true` | Verify still valid in Vite 8 (dev-server option; not flagged as removed, but confirm at upgrade). | Low risk. |

### 3.5 No-change confirmations

- **`eslint.config.js`** — uses flat config `tseslint.config()`; API unchanged across eslint 10.9.1 and typescript-eslint 8.68. No edits needed. (`@eslint/js` 10.0.1 is already latest.)
- **`index.html`** — nothing Vite-specific beyond the standard `<script type="module" src="/src/main.tsx">` and the inline `data-theme` bootstrap (vanilla JS, not React/Vite-coupled). No Tailwind-4.3 exposure.
- **No `tailwind.config.*`** exists — consistent with the repo rule; Tailwind 4 is configured entirely via CSS + `@tailwindcss/vite`, which supports Vite 8.
- **`import React from 'react'` default imports** (5 files, e.g. `src/App.test.tsx` neighbours) — fine under React 19 types (`esModuleInterop`) and under Vite 8's new consistent CJS interop (`type: module` ⇒ `default` = `module.exports`).

---

## 4. Recommended upgrade ORDER

Each step ends with a gate; each step is independently committable. Ordering puts isolated, low-risk bumps first and the two riskiest (React 19 runtime, Vite 8 bundler) later, with `bun run verify` between every step.

| # | Bump(s) | Pre-work / notes | Gate |
|---|---|---|---|
| **A** | eslint 10.9.0→10.9.1, typescript-eslint 8.67→8.68 | None — flat config untouched. | `bun run eslint` |
| **B** | tailwindcss + @tailwindcss/vite 4.0.6→4.3.3 | Verify theme-token guard still green (daisyui classes unchanged). | `bun run verify` + `bun run check:theme` |
| **C** | lucide-react 0.475.0→1.37.0 | No brand icons in `src/` (scan of all `lucide-react` imports: Activity, ArrowRight, AudioWaveform, Bookmark, Check, Chevron*, Clock, Compass, Dices, Download, Flame, Grid, GripVertical, Minus, Music, Play, Plus, Power, Radio, RotateCcw, Search, Sliders, Sparkles, Square, Sun, Trash2, Upload, Volume2, Waves — none brand). Verify `LucideIcon` type export (`src/components/viewMeta.ts:1,13`) and note the `aria-hidden=true` default change. | `bun run verify` |
| **D** | react/react-dom 18.3.1→19.2.8, @types/react 18.3.12→19.2.18, @types/react-dom 18.3.1→19.2.5 | Optional: `npx types-react-codemod@latest preset-19 ./src`. No source edits expected from scan. **Runtime smoke test:** synth/sequencer/chords/effects tabs, drag-and-drop reorder, MIDI, theme flip, first-click audio init. | `bun run verify` + manual smoke |
| **E** | TS 5.7.3→6.0.3 | **First** apply the three §3.3 config edits (vite-env.d.ts, `types:["node"]`, drop `baseUrl`) and confirm they type-check under 5.7; then bump to 6.0.3. **Do not go to 7.0.2** (typescript-eslint peer `<6.1.0`). | `bun run verify` + `bun run eslint` |
| **F** | @types/node 22→26.4.0 | Safe after E (TS 6 + `types:["node"]`). Runtime is already Node 26. | `bun run lint` |
| **G** | vite 6.1.0→8.2.2, @vitejs/plugin-react 4.3.4→6.1.1 | Staged: (1) apply §3.4 config edits, (2) optionally land Vite 7 + plugin-react 4.7.0 first as a waypoint, (3) Vite 8 + plugin-react 6.1.1. React Refresh now via Oxc (no Babel in repo — clean). Verify vendor/tonal/dndkit/icons chunking output and CJS interop. | `bun run verify` + `bun run build` + inspect `dist/` chunks + dev-server smoke |
| **H** | — | Full final gate. | `bun run verify` + `bun run eslint` |

Independent commits: **A, B, C, D, E, F, G** can each be their own commit with the listed gate as the acceptance test. The only hard ordering constraints: `E` requires its config prep first; `G` must come after `D` (plugin-react 6 targets React 19-era refresh and the repo wants React 19 in place before the bundler swap to isolate failure domains) — though `G`-before-`D` is defensible if you prefer bundler-first; keep them in separate commits either way. `F` rides with `E`'s `types:["node"]` change.

**Held items (track, don't force):**
- **typescript 7.0.2** — blocked by typescript-eslint (peer `<6.1.0`) and no stable TS programmatic API until 7.1. Revisit when typescript-eslint ships a v9 supporting TS 7.
- **`react-dom/server` `renderToString`** — deprecated; still works in 19. Migrate test SSR to `renderToReadableStream` only if/when React 20 removes it.

---

## 5. Risks & unknowns

1. **React 19 runtime behaviour (highest risk, not statically decidable).** The code scan is nearly clean, but the following only manifest at runtime and need a manual smoke test: ref-callback double-invocation under StrictMode (dnd-kit drag state), error reporting no longer re-throwing render errors, `useMemo`/`useCallback` reuse across StrictMode renders, and the `element.ref`/ref-cleanup semantics in any library-internal code (zustand 5, dnd-kit 6.3.1, lucide 1.x all declare React-19-compatible peers but peer ranges don't prove runtime correctness).
2. **TS 7 native compiler is a hard "later".** typescript-eslint 8.68 peers `typescript <6.1.0` and the TS 7 release notes state there is no stable programmatic API until 7.1 — every eslint rule that parses TS would break. This is an ecosystem-gated dependency, not a Solna problem. Interim: TS 6.0.3 (bridge release).
3. **TS 6.0 default flips** (`types:[]`, `noUncheckedSideEffectImports:true`, `baseUrl` deprecation) are the concrete landmines — addressed by §3.3. Watch for *other* implicit `@types` globals: a post-bump `tsc --noEmit` will surface any I missed; `skipLibCheck:true` masks some lib-level noise but not missing-global errors.
4. **Vite 8 bundler rewrite.** Function-form `manualChunks` is deprecated (works), but the repo's vendor-chunk strategy was tuned to esbuild/Rollup CJS id shapes (`?commonjs-*`); Rolldown's CJS interop is different and the comment at `vite.config.ts:22-26` may be stale. Plan on inspecting the emitted chunks (`dist/assets/*`) after the bump and re-expressing the split with `advancedChunks` if the vendor/tonal/dndkit/icons grouping regresses. `legacy.inconsistentCjsInterop:true` is the documented escape hatch if default-import interop regresses.
5. **`__dirname` in `vite.config.ts`** is a guaranteed Vite 8 hard break (ESM config loading). Must be fixed in the same commit as the Vite bump.
6. **`renderToString` deprecation.** ~17 test files use `react-dom/server`; they work on 19 with warnings. If CI treats warnings as errors, add the migration to `renderToReadableStream` as a follow-up (the tests render to string synchronously, which is a deliberate pattern — the async replacement needs a test-harness rework; not worth it before React 20).
7. **dnd-kit `setNodeRef` under React 19 types.** If `@types/react` 19 rejects the callback ref's return type, the fix is a wrapper (`ref={(el) => { setNodeRef(el); }}`) at `SortableChordCard.tsx:72`. Low probability; dnd-kit 6.3.1 shipped post-React-19.
8. **Tailwind 4.0→4.3 within-major drift.** daisyui 5.7.22 is pinned to current, but minor Tailwind bumps can alter utility output. The `check:theme` guard suite exists precisely for this — run it, don't assume.
9. **lucide-react `aria-hidden` default change** is a silent accessibility behaviour flip (icons now `aria-hidden` unless given a label). Review icon roles in interactive controls after bumping to 1.37.0.
10. **`@types/node` 22→26** with Node 26 runtime is aligned, but a major-version type bump can surface new typings for globals used in `scripts/`. The `bun run lint` gate after step F is the check.
11. **plugin-react 6 / Oxc refresh** is a different Fast-Refresh implementation than plugin-react 4's Babel one. HMR edge cases (e.g. component state preservation across edits of hook order) should be smoke-tested, not assumed identical.

---

## Source index

- React 19 release: https://react.dev/blog/2024/04/25/react-19
- React 19 upgrade guide: https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- types-react-codemod: https://github.com/eps1lon/types-react-codemod
- TypeScript native port: https://devblogs.microsoft.com/typescript/typescript-native-port/
- TypeScript 6.0: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- TypeScript 7.0 (InfoQ coverage): https://www.infoq.com/news/2026/08/typescript-7-released/
- Vite migration index (7→8): https://vite.dev/guide/migration
- Vite 6→7 (v7 docs): https://v7.vite.dev/guide/migration
- Vite 8 / Rolldown: https://certificates.dev/blog/migrating-to-vite-8-rolldown
- manualChunks→advancedChunks: https://dev.classmethod.jp/articles/vite7-to-vite8-migration-pitfalls/
- @vitejs/plugin-react changelog: https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/CHANGELOG.md
- lucide v1 (InfoQ): https://www.infoq.com/news/2026/06/lucide-v1-icons/
- Peer/engine/version data: verified via `npm view` on 2026-08-29 (react, react-dom, @types/react, @types/react-dom, typescript@5/6/7, vite, @vitejs/plugin-react@4/5/6, eslint, @eslint/js, typescript-eslint, zustand, @dnd-kit/*, daisyui, tailwindcss, @tailwindcss/vite, lucide-react, tonal, @types/node).
