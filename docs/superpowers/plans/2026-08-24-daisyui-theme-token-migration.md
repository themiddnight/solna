# daisyUI Theme-Token Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every Solva component off the inherited murva palette (raw hex, Tailwind palette classes, `text-white`, `dark:` variants) onto daisyUI semantic tokens, so the `solva-light` theme actually works.

**Architecture:** The two themes are already correct in `src/index.css`; the components simply ignore them. Task 1 completes the theme foundation (missing `success`/`warning`/`error`/`info` tokens, `color-scheme`, tokenized scrollbars, FOUC-preventing head script). Task 2 builds `scripts/themeTokenGuard.ts` — a regex scanner with an `ALLOWLIST` of the 23 currently-dirty files. Every subsequent task deletes its file from that allowlist, watches the guard go red, and refactors until green. The allowlist shrinking to empty in Task 22 is the definition of done, and the guard stays in CI so the rot cannot return.

**Tech Stack:** React 18, Vite 6, Tailwind CSS v4 (CSS-first, no config file), daisyUI 5.7.22, Zustand 5, Tone.js, `bun test`.

**Spec:** `docs/design.md`

**Baseline at plan authoring time (2026-08-24):** `bun test` → 206 pass / 0 fail across 24 files. `bun scripts/check-drum-kit-separation.ts` → passes. `bun scripts/check-key-bindings.ts` → **already broken before this plan begins** (imports `DEFAULT_PADS` and `KEYBOARD_NOTES`, which neither `DrumPads.tsx` nor `SynthView.tsx` exports — `DrumPads.tsx:8` declares a non-exported `PADS`). Task 12 repairs it. Do not treat its failure as a regression you caused.

---
## Global Constraints

These rules apply to **every** task in this plan. Read them once, obey them everywhere.

### Stack rules

- **Tailwind CSS v4, CSS-first configuration.** There is **no** `tailwind.config.js` / `.ts` / `.cjs` in this repo and you must **not** create one. All theme configuration lives in `src/index.css` via `@import "tailwindcss";`, `@plugin "daisyui";` and `@plugin "daisyui/theme" { ... }`. Custom utilities are declared with the v4 `@utility` at-rule, custom variants with `@custom-variant`.
- **daisyUI 5.7.22** is already installed (`package.json` → `"daisyui": "^5.7.22"`). Two themes are registered: `solva-dark` (default) and `solva-light`.
- **No new dependencies.** Do not run `bun add` / `npm i`. Everything needed (React 18, Vite 6, Zustand 5, Tone.js via `src/audio`, `@dnd-kit`, `lucide-react`, `motion`, `tonal`, `@types/node`) is already present. The test runner is Bun's built-in `bun test` — there is no vitest/jest and none may be added.
- **Theme is switched by `document.documentElement.dataset.theme`** (`solva-dark` | `solva-light`), persisted in `localStorage` under the key `solva_theme` by `src/components/Header.tsx:54-70`.

### Canonical role map (use exactly this — no improvising)

| legacy | token |
|---|---|
| `#0B0D19`, `#0E1022`, app/inset bg | `bg-base-200` |
| `#12152A`, `#171B36`, `#171B38`, `#161B36`, `#1A1E38`, `#1A1F3B`, `#1A1F3A`, `#181C35` panels | `bg-base-100` |
| `#1C213E`, `#22284C`, `#22274A`, `#20264A`, `#252B48`, `#151933` hover/inset fills | `bg-base-300` / `hover:bg-base-300` |
| `#252B48`, `#2D355A`, `#3B4371`, `#1E2344` borders | `border-base-300` |
| indigo-* (primary action, playhead, active step) | `primary` (amber) |
| purple-* / pink-* (chords, harmony, filter) | `secondary` (coral) |
| cyan-* / purple-* (LFO, mod, arp, reverb/delay) | `accent` (teal) |
| emerald-* used as "OK/live/saved" | `success` |
| emerald-* used as bass/module accent | `accent` |
| rose-* / red-* (delete, mute-on) | `error` |
| slate-100/200/300 | `text-base-content` |
| slate-400/500 | `text-base-content/60` (or `/50`) |
| `text-white` on a colored fill | matching `*-content` (`text-primary-content` etc.) |
| `bg-black/60`, `bg-black/70` overlay | `modal-backdrop` / `bg-neutral/60` |

### daisyUI component-class map

| hand-rolled markup | daisyUI replacement |
|---|---|
| raw `<button>` | `btn btn-xs` / `btn btn-sm` (+ `btn-ghost` / `btn-primary` / `btn-secondary` / `btn-accent` / `btn-active`) |
| raw `<select>` | `select select-xs` / `select select-sm` + `select-bordered` |
| raw `<input type="text">` | `input input-sm input-bordered` |
| `<input type="range">` | `range range-xs range-primary` / `range-secondary` / `range-accent` |
| hand-rolled panel `<div>` | `card bg-base-100 border border-base-300` wrapping a `card-body` |
| hand-rolled modal | `<dialog className="modal modal-open">` + `<div className="modal-box">` + `<form className="modal-backdrop">` + `<div className="modal-action">` |
| hand-rolled pill / tag `<span>` | `badge badge-sm` (+ `badge-primary` / `badge-secondary` / `badge-accent` / `badge-outline`) |
| hand-rolled toast | `toast` container + `alert alert-success` |
| keycap chip | `kbd kbd-xs` |

### Commands

| purpose | command | expected on success |
|---|---|---|
| Unit + component tests | `bun test` | `0 fail` in the summary line |
| One test file | `bun test scripts/themeTokenGuard.test.ts` | `0 fail` |
| Typecheck | `bun run lint` (= `tsc --noEmit`) | no output, exit 0 |
| ESLint | `bun run eslint` | no output, exit 0 |
| Production build | `bun run build` | `✓ built in …` and a `dist/` folder |
| Theme guard (added in Task 2) | `bun run check:theme` | `theme token guard: 0 violations outside the allowlist` |

Tests live next to their subject as `*.test.ts` / `*.test.tsx` and import `{ describe, expect, test } from 'bun:test'`. Component tests render with `renderToString` from `react-dom/server` and assert on class/text substrings — see `src/components/ChordView.test.tsx` for the house style. Ambient `bun:test` typings live in `src/types/bun-test.d.ts`; if you need a matcher that is not declared there, add the declaration in the same commit.

### Commit convention

Conventional Commits, one commit per task, body ends with the co-author trailer. Always use a HEREDOC so the trailer keeps its own line:

```bash
git commit -F- <<'EOF'
feat(theme): add semantic state colors and pre-paint theme bootstrap

Adds success/warning/error/info (+ -content) to both Solva themes,
replaces hardcoded scrollbar and range-accent hex with theme vars,
defines the missing no-scrollbar utility, and sets data-theme before
first paint so solva-light users no longer see a dark flash.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

## File Structure

### Created by this plan

| File | Responsibility |
|---|---|
| `scripts/themeTokenGuard.ts` | Pure, dependency-free scanner. Exports `Violation`, `RULES`, `ALLOWLIST`, `scanSource()`, `scanRepo()`. Single source of truth for "what counts as a legacy-palette violation". |
| `scripts/themeTokenGuard.test.ts` | TDD harness for the guard: per-rule positive/negative fixtures, an allowlist-rot check, and the repo-wide assertion that every non-allowlisted `src/**/*.{ts,tsx}` file is clean. |
| `src/utils/themeColor.ts` | Runtime reader that resolves a daisyUI CSS custom property (e.g. `--color-primary`) to a canvas-usable color string, so `<canvas>` drawing code stops hardcoding hex. |
| `src/utils/themeColor.test.ts` | Unit tests for `themeColor.ts` (fallbacks, missing-property behaviour, SSR safety). |

### Modified by this plan

| File | Responsibility / what changes |
|---|---|
| `src/index.css` | Task 1. Adds `success`/`warning`/`error`/`info` (+ `-content`) to both `@plugin "daisyui/theme"` blocks, adds `color-scheme`, converts scrollbar + range `accent-color` to theme vars, defines the `@utility no-scrollbar`. |
| `index.html` | Task 1. `selection:*` → semantic tokens; blocking pre-paint theme bootstrap script. |
| `src/App.tsx` | Layout shell: app background / inset wrappers → `bg-base-200`, panel wrappers → `card bg-base-100 border border-base-300`. |
| `src/components/Header.tsx` | Brand gradient, live/recording indicator dot, theme toggle button, scale/root `<select>`s → daisyUI `select` + tokens. |
| `src/components/InstantVibesBar.tsx` | Already token-clean (verified — see Task 2 audit note). Only touched if the vibe-card gradient strings in `src/store/instantVibes.ts` change shape. |
| `src/components/TransportBar.tsx` | Only violation is the undeclared `xs:` breakpoint variant at line 134; either declare an `xs` variant via `@custom-variant` or drop to `sm:`. Plus `<input type="range">` → `range range-xs range-primary`. |
| `src/components/ProjectModal.tsx` | Hand-rolled `fixed inset-0 bg-black/70` overlay → `<dialog className="modal modal-open">` + `modal-box` + `modal-backdrop` + `modal-action`; panel hex → tokens. |
| `src/components/SimpleSynthPanel.tsx` | amber-* → `primary`, cyan-* → `accent`, `dark:` variants removed, pills → `badge badge-sm`. |
| `src/components/EffectsRackView.tsx` | purple-* → `secondary`, cyan-* → `accent`, `dark:` variants removed, effect cards → `card`. |
| `src/components/DrumPads.tsx` | Pad gradient colour table (`DEFAULT_PADS`) → semantic classes; panel hex → tokens; shortcut chips → `kbd kbd-xs`. |
| `src/components/SequencerView.tsx` | Panel hex → tokens; emerald module accent → `accent`; active step / playhead indigo → `primary`. |
| `src/components/ChordView.tsx` | `PILL_BASE` / `LABEL_BASE` constants → tokens; panel hex → tokens; indigo keycap pills → `kbd kbd-xs`; `py-0.2` → `py-0.5`. |
| `src/components/chord/SortableChordCard.tsx` | Card hex + indigo selection ring → `card bg-base-100` + `ring-primary`; `scale-102` → `scale-105`. |
| `src/components/ChordPresetLibrary.tsx` | Category badge table → `badge badge-sm badge-primary`; purple-* → `secondary`; `py-0.2` → `py-0.5`. |
| `src/components/SynthPresetLibrary.tsx` | Category badge table → `badge`; `bg-indigo-500 text-white` → `badge-primary`; border hex → `border-base-300`. |
| `src/components/SynthView.tsx` | Largest file: mode tint table (`synth`/`chord`/`bass`), panel hex, keycap pills, `xs:` variant, `py-0.2`. |
| `src/components/AudioVisualizer.tsx` | Canvas `strokeStyle` / gradient hex + `rgba()` literals → `themeColor()` lookups; status dot emerald → `success`. |
| `src/components/ui/Slider.tsx` | Default `className` hex + `accent-indigo-500` → `range range-xs range-primary`. |
| `src/components/ui/Knob.tsx` | Default needle colour `text-[#877dca]` → `text-primary`; tick hex → `currentColor`/token; `text-slate-400` → `text-base-content/60`. |
| `src/components/ui/ChannelStrip.tsx` | `LABEL_BASE`, strip chrome hex, fader `accent-indigo-500` → tokens + `range`. |
| `src/components/ui/Keyboard.tsx` | White/black key gradients → `base-100`/`base-content` + `primary` for held keys. |
| `src/components/ui/PresetLibrary.tsx` | Search/filter chrome hex → tokens; confirm overlay `z-60 bg-black/70` → `modal` + `modal-backdrop`. |
| `src/components/ui/QuickSavePopover.tsx` | Popover hex + indigo focus ring → `card bg-base-100` + `input input-sm input-bordered` + `btn btn-xs btn-primary`. |
| `src/audio/synthPresets.ts` | `badgeClass` strings (`bg-emerald-500/20 text-emerald-300 …`) → daisyUI `badge` modifier strings. |
| `src/store/initialState.ts` | Track `color` strings (`bg-rose-500`, `bg-amber-500`, …) → semantic (`bg-error`, `bg-primary`, `bg-success`, `bg-accent`, `bg-secondary`). |
| `src/audio/instantVibes.ts` | *(audit addition — see Task 2)* Vibe card `color` hex + `bgGradient`/`borderColor` palette strings → tokens. |
| `src/store/instantVibes.ts` | *(audit addition — see Task 2)* Same vibe-card colour table, duplicated in the store slice. |
| `docs/design.md` | Final task: document the new semantic state colours and the token role map so the spec matches the implementation. |
| `src/types/bun-test.d.ts` | Only if a task uses a matcher not yet declared (e.g. `toMatch`, `toThrow`). Add the declaration in the same commit as its first use. |

### Task ordering & dependencies

```
Task 1  (index.css + index.html)           ── must land first: every later task
   │                                          assumes success/warning/error/info
   │                                          and no-scrollbar exist.
   ▼
Task 2  (scripts/themeTokenGuard.ts + test) ── must land second: it defines the
   │                                          ALLOWLIST that every later task
   │                                          shrinks by exactly one entry.
   ▼
Tasks 3–19 (one file / file-pair each)      ── mostly parallelizable. Each task:
   │        red  = delete its path from ALLOWLIST → `bun test scripts/themeTokenGuard.test.ts` FAILS
   │        green= refactor the file → same command PASSES
   │        Conflicts are limited to the one shared line-range in
   │        scripts/themeTokenGuard.ts (the ALLOWLIST array); rebase, do not merge.
   ▼
Task 20 (delete dead InstantVibe style fields — empties the allowlist)
Task 21 (docs/design.md sync)  →  Task 22 (final sweep + allowlist lockdown + full verification)
```

---

## Task 1: Theme foundation — `src/index.css` + `index.html`

**Files:**
- Modify: `src/index.css` (lines 6-21 `solva-dark` block, 23-38 `solva-light` block, 50-67 scrollbar rules, 69-72 range rule, plus a new `@utility` block at the end)
- Modify: `index.html` (line 12 `</head>`, line 13 `<body class=…>`)
- Test: none (CSS is not unit-testable here) → verification is `bun run build` + the scripted manual browser check in step 1.13

**Interfaces:**
- Consumes: nothing (this is the root of the plan)
- Produces:
  - CSS custom properties `--color-success`, `--color-success-content`, `--color-warning`, `--color-warning-content`, `--color-error`, `--color-error-content`, `--color-info`, `--color-info-content` on both themes → unlocks the utility classes `bg-success`, `text-success`, `alert-success`, `badge-error`, `btn-warning`, `text-info`, … used by Tasks 3-19
  - The `no-scrollbar` utility class → makes `Header.tsx:91`, `Header.tsx:136`, `SynthView.tsx:656`, `InstantVibesBar.tsx:42` actually work
  - `document.documentElement.dataset.theme` set before first paint → `Header.tsx:54` reads a correct initial value instead of always seeing `solva-dark`

### 1.1 — Read the current state

- [ ] Open `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/index.css`. It is 73 lines. Confirm it currently starts with:

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: solva-dark --default, solva-light;
}

@plugin "daisyui/theme" {
  name: "solva-dark";
  default: true;
  --color-base-100: #1C1924;
  --color-base-200: #14121B;
  --color-base-300: #2C2738;
  --color-base-content: #F5EFEB;
  --color-primary: #F59E0B;
  --color-primary-content: #14121B;
  --color-secondary: #FB7185;
  --color-secondary-content: #14121B;
  --color-accent: #2DD4BF;
  --color-accent-content: #14121B;
  --color-neutral: #24202E;
  --color-neutral-content: #F5EFEB;
}
```

- [ ] Confirm there is **no** `color-scheme` declaration and **no** `success`/`warning`/`error`/`info` custom property anywhere:

```bash
grep -nE "color-scheme|--color-(success|warning|error|info)" /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/index.css
```

Expected output: nothing (exit code 1). That is the gap this task closes.

- [ ] Confirm `no-scrollbar` is used but never defined:

```bash
grep -rn "no-scrollbar" /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/index.html
```

Expected output — four **usages**, zero definitions:

```
src/components/Header.tsx:91:        <div className="flex items-center p-0.5 rounded-lg bg-base-200 border border-base-300 overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar gap-0.5 shrink-0">
src/components/Header.tsx:136:        <div className="flex items-center p-0.5 rounded-lg bg-base-200 border border-base-300 overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar gap-0.5 shrink-0">
src/components/SynthView.tsx:656:            <div className="flex items-center gap-1.5 overflow-x-auto pb-0 no-scrollbar">
src/components/InstantVibesBar.tsx:42:          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 px-1 no-scrollbar scroll-smooth flex-1 max-w-full">
```

### 1.2 — Add semantic state colours to `solva-dark`

**Colour reasoning (one line, as required):** each state hue is rotated toward the palette's yellow-red warm axis and the cool ones are desaturated, so no state colour collides with `primary` amber `#F59E0B`, `secondary` coral `#FB7185`, or `accent` teal `#2DD4BF` — success is a *warm* mint (yellower than the teal accent), warning is a pure yellow (not amber), error is a hot orange-red (not the coral pink), and info is a muted dawn-sky blue.

- [ ] In `src/index.css`, replace the `solva-dark` block (lines 6-21) with:

```css
@plugin "daisyui/theme" {
  name: "solva-dark";
  default: true;
  color-scheme: dark;
  --color-base-100: #1C1924;
  --color-base-200: #14121B;
  --color-base-300: #2C2738;
  --color-base-content: #F5EFEB;
  --color-primary: #F59E0B;
  --color-primary-content: #14121B;
  --color-secondary: #FB7185;
  --color-secondary-content: #14121B;
  --color-accent: #2DD4BF;
  --color-accent-content: #14121B;
  --color-neutral: #24202E;
  --color-neutral-content: #F5EFEB;
  --color-success: #5FD08B;
  --color-success-content: #14121B;
  --color-warning: #FACC15;
  --color-warning-content: #14121B;
  --color-error: #F05545;
  --color-error-content: #14121B;
  --color-info: #79A6E0;
  --color-info-content: #14121B;
}
```

`color-scheme: dark` makes the browser render native form controls, the caret, and the default scrollbar in dark chrome, and is what `<input type="range">` and `<select>` fall back to before daisyUI classes apply.

### 1.3 — Add semantic state colours to `solva-light`

- [ ] Replace the `solva-light` block (lines 23-38) with:

```css
@plugin "daisyui/theme" {
  name: "solva-light";
  default: false;
  color-scheme: light;
  --color-base-100: #FFFFFF;
  --color-base-200: #F7F4EF;
  --color-base-300: #E8E2D8;
  --color-base-content: #241E19;
  --color-primary: #D97706;
  --color-primary-content: #FFFFFF;
  --color-secondary: #E11D48;
  --color-secondary-content: #FFFFFF;
  --color-accent: #0D9488;
  --color-accent-content: #FFFFFF;
  --color-neutral: #3D352E;
  --color-neutral-content: #FFFFFF;
  --color-success: #2F8F5B;
  --color-success-content: #FFFFFF;
  --color-warning: #A16207;
  --color-warning-content: #FFFFFF;
  --color-error: #C2321F;
  --color-error-content: #FFFFFF;
  --color-info: #2C6FA8;
  --color-info-content: #FFFFFF;
}
```

Note `--color-warning: #A16207` is a *deeper, yellower* gold than `--color-primary: #D97706`; on white both stay ≥ 4.5:1 for body text and remain distinguishable side by side.

### 1.4 — Verify the tokens compile

- [ ] Run:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run build
```

Expected: a `vite v6.x.x building for production...` banner, then `✓ built in <n>ms`, exit 0. If daisyUI rejects a property name it fails here loudly.

- [ ] Confirm the generated CSS actually contains the new tokens:

```bash
grep -c -- "--color-success" /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/dist/assets/*.css
```

Expected: a number ≥ 2 (one per theme).

### 1.5 — Replace the hardcoded scrollbar hex

- [ ] The current block is (lines 50-67):

```css
/* Custom scrollbars */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: #14121B;
}

::-webkit-scrollbar-thumb {
  background: #2C2738;
  border-radius: 9999px;
}

::-webkit-scrollbar-thumb:hover {
  background: #4A405D;
}
```

Replace it with:

```css
/* Custom scrollbars — theme-driven, so solva-light gets light chrome */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: var(--color-base-200);
}

::-webkit-scrollbar-thumb {
  background: var(--color-base-300);
  border-radius: 9999px;
}

::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklch, var(--color-base-content) 30%, transparent);
}
```

`#14121B` was literally `solva-dark`'s `base-200` and `#2C2738` its `base-300`, so those two are a pure 1:1 swap. `#4A405D` had no token equivalent — it was a lightened `base-300`; the `color-mix` reproduces that "one shade brighter on hover" effect in *both* themes (it darkens in light mode, brightens in dark mode, automatically).

### 1.6 — Replace the range `accent-color`

- [ ] Current (lines 69-72):

```css
/* Range input styling for synth and mixer faders */
input[type="range"] {
  accent-color: #F59E0B;
}
```

Replace with:

```css
/* Range input styling for synth and mixer faders */
input[type="range"] {
  accent-color: var(--color-primary);
}
```

`#F59E0B` was exactly `solva-dark`'s `--color-primary`; in `solva-light` this now correctly becomes `#D97706` instead of staying at the dark-theme amber.

### 1.7 — Define the missing `no-scrollbar` utility

- [ ] Append to the end of `src/index.css`:

```css
/* Hide scrollbars on horizontally-scrolling toolbars (Header tab strips,
   SynthView preset row, InstantVibesBar). Used as `class="no-scrollbar"`;
   Tailwind v4 declares custom utilities with @utility, not @layer utilities. */
@utility no-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }
}
```

- [ ] Verify it emitted:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run build && grep -c "no-scrollbar" dist/assets/*.css
```

Expected: `1` or more. Before this change the count is `0` — Tailwind silently dropped the unknown class.

### 1.8 — Fix the `<body>` selection colours in `index.html`

- [ ] Current line 13:

```html
  <body class="bg-base-200 text-base-content antialiased overflow-x-hidden selection:bg-amber-500 selection:text-white">
```

Replace with:

```html
  <body class="bg-base-200 text-base-content antialiased overflow-x-hidden selection:bg-primary selection:text-primary-content">
```

`amber-500` is the raw Tailwind palette value that `--color-primary` was derived from; `selection:text-white` was unreadable on `solva-light`'s `#D97706` fill anyway — `primary-content` resolves to `#14121B` on dark and `#FFFFFF` on light.

### 1.9 — Add the pre-paint theme bootstrap to `index.html`

The problem: `<html data-theme="solva-dark">` is hardcoded, and `src/components/Header.tsx:64-70` only restores the saved theme inside a `useEffect`. A `solva-light` user therefore sees a full dark repaint on every load.

- [ ] Insert this script immediately **before** the closing `</head>` (currently line 12), after the Google Fonts `<link>`:

```html
    <script>
      // Pre-paint theme bootstrap. Must stay inline and blocking (no defer/async)
      // so data-theme is correct before the first paint — otherwise solva-light
      // users get a dark flash. Header.tsx reads this attribute for its initial
      // React state, so this is also the single source of truth on first render.
      (function () {
        var theme = null;
        try {
          theme = localStorage.getItem('solva_theme');
        } catch (e) {
          // Private mode / blocked storage: fall through to the media query.
          theme = null;
        }
        if (theme !== 'solva-dark' && theme !== 'solva-light') {
          theme =
            window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: light)').matches
              ? 'solva-light'
              : 'solva-dark';
        }
        document.documentElement.dataset.theme = theme;
      })();
    </script>
```

- [ ] Leave `<html lang="en" data-theme="solva-dark">` on line 2 exactly as it is. It is the no-JS fallback; the script overwrites it before paint.

### 1.10 — Typecheck, lint and test

- [ ] Run the three checks. Nothing in this task touches TypeScript, so all three must be unchanged/green:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run lint && bun run eslint && bun test
```

Expected: `bun run lint` prints nothing; `bun run eslint` prints nothing; `bun test` ends with a summary line containing `0 fail`.

### 1.11 — Build

- [ ] Run:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run build
```

Expected: `✓ built in <n>ms`, exit 0.

### 1.12 — Confirm the removed hex are gone

- [ ] Run:

```bash
grep -nE "#14121B|#2C2738|#4A405D|#F59E0B|amber-500|text-white" /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/index.css /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/index.html
```

Expected: **only** the theme-definition lines survive — i.e. matches on `--color-base-200: #14121B;`, `--color-base-300: #2C2738;`, the four `-content: #14121B;` lines and `--color-primary: #F59E0B;` inside the `@plugin "daisyui/theme"` blocks. **Zero** matches in `index.html`, and zero matches for `#4A405D` or `amber-500` anywhere.

### 1.13 — Manual browser verification (required — CSS has no unit test)

- [ ] Start the dev server:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run dev
```

Open the printed `http://localhost:5173` URL. Check exactly these seven things:

1. **No dark flash in light mode.** In DevTools console run `localStorage.setItem('solva_theme','solva-light')` then hard-reload (Cmd+Shift+R). The page must paint light *immediately* — no dark frame at all. Repeat with `'solva-dark'`; it must paint dark immediately.
2. **Theme toggle still works.** Click the theme button in the header (`src/components/Header.tsx:57-62`). `<html>`'s `data-theme` must flip between `solva-dark` and `solva-light` in the Elements panel, and the page must repaint.
3. **Scrollbars follow the theme.** In `solva-light`, scroll any overflowing panel — the scrollbar track must be warm off-white (`#F7F4EF`), not near-black. In `solva-dark` it must be espresso (`#14121B`).
4. **Scrollbar hover.** Hover the scrollbar thumb — it must visibly lighten in dark mode and darken in light mode.
5. **`no-scrollbar` works.** The header tab strip (the row of tab buttons) must have **no** visible scrollbar even when it overflows horizontally on a narrow window (drag the window to ~500px wide). Same for the Instant Vibes bar.
6. **Range faders are amber.** Any `<input type="range">` (transport volume, mixer faders) must be amber in dark mode and the deeper `#D97706` amber in light mode — not the browser default blue.
7. **Selection colour.** Select the project title text in the header. The highlight must be the theme's amber with legible contrasting text in **both** themes.

- [ ] Confirm the new state colours resolve. In the DevTools console run:

```js
['success','warning','error','info'].map(n =>
  [n, getComputedStyle(document.documentElement).getPropertyValue('--color-' + n).trim()]
)
```

Expected in `solva-dark`: `[["success","#5FD08B"],["warning","#FACC15"],["error","#F05545"],["info","#79A6E0"]]` (daisyUI may return them in `oklch(...)` form — any non-empty value is a pass). Expected in `solva-light`: four non-empty values that differ from the dark set.

- [ ] Stop the dev server (Ctrl+C).

### 1.14 — Commit

- [ ] Run:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add src/index.css index.html && git commit -F- <<'EOF'
feat(theme): add semantic state colors and pre-paint theme bootstrap

Add success/warning/error/info (+ -content) to both solva-dark and
solva-light, warm-tinted so none collides with primary amber, secondary
coral or accent teal. Declare color-scheme on each theme so native form
controls render correctly.

Replace the hardcoded scrollbar hex (#14121B/#2C2738/#4A405D) and the
range accent-color (#F59E0B) with theme custom properties, using a
color-mix for the scrollbar hover so it adapts in both themes.

Define the no-scrollbar utility via Tailwind v4 @utility; it was used in
Header, SynthView and InstantVibesBar but declared nowhere, so Tailwind
was silently dropping it.

In index.html, swap selection:bg-amber-500/selection:text-white for
selection:bg-primary/selection:text-primary-content and add a blocking
inline script that resolves solva_theme from localStorage (try/catch),
falling back to prefers-color-scheme then solva-dark, and sets
documentElement.dataset.theme before first paint. This removes the dark
flash solva-light users saw on every load.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF```

---

## Task 2: Theme-token guard script + failing baseline

**Files:**
- Create: `scripts/themeTokenGuard.ts` (the scanner)
- Create: `scripts/themeTokenGuard.test.ts` (the TDD harness)
- Modify: `package.json` (add the `"check:theme"` script)
- Modify: `tsconfig.json` (add `scripts/themeTokenGuard.ts` + `scripts/themeTokenGuard.test.ts` to `include` so `bun run lint` typechecks them)
- Test: `scripts/themeTokenGuard.test.ts`

**Interfaces:**
- Consumes: nothing at runtime. Conceptually consumes the canonical role map from **Global Constraints** — the rules encode "what is still legacy".
- Produces:
  ```ts
  export interface Violation { line: number; rule: string; snippet: string }
  export const RULES: { name: string; pattern: RegExp }[]
  export const ALLOWLIST: readonly string[]
  export function scanSource(relPath: string, source: string): Violation[]
  export function scanRepo(rootDir: string): Map<string, Violation[]>
  ```
  Every subsequent task (3-19) consumes `ALLOWLIST` by deleting exactly one entry from it.

### 2.0 — Audit: establish the real dirty-file list first

The plan brief listed 21 candidate paths and flagged `TransportBar.tsx` and `InstantVibesBar.tsx` as "may be clean". Verify before you hardcode anything.

- [ ] Write a throwaway probe (do **not** commit it) at `/tmp/solva-probe.mjs`:

```js
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const RULES = [
  { name: 'raw-hex', pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { name: 'palette-color', pattern: new RegExp(`\\b(?:${PALETTE})-(?:50|[1-9]00|950)\\b`, 'g') },
  { name: 'absolute-bw', pattern: /\b(?:text|bg|border|fill|stroke|ring|shadow|from|via|to|divide|outline|decoration|accent|caret)-(?:white|black)(?:\/\d{1,3})?\b/g },
  { name: 'dark-variant', pattern: /(?<![\w-])dark:/g },
  { name: 'rgba-literal', pattern: /\brgba?\(/g },
  { name: 'invalid-utility', pattern: /(?<![\w-])(?:-?p[xytblrse]?-0\.2|scale-10[12]|z-6[0-9])|(?<=["'`\s])xs:(?=[a-z[-])/g },
];

const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
  }
})('src');

for (const f of files.sort()) {
  const s = readFileSync(f, 'utf8');
  const hits = new Set();
  for (const r of RULES) {
    r.pattern.lastIndex = 0;
    let m;
    while ((m = r.pattern.exec(s))) hits.add(r.name);
  }
  if (hits.size) console.log(f, [...hits].join(','));
}
```

- [ ] Run it from the repo root:

```bash
node /tmp/solva-probe.mjs
```

**What the audit actually found (already run — expect these 23 lines):**

```
src/audio/instantVibes.ts               raw-hex
src/audio/synthPresets.ts               palette-color
src/components/AudioVisualizer.tsx      raw-hex,rgba-literal,palette-color
src/components/ChordPresetLibrary.tsx   raw-hex,palette-color,absolute-bw,invalid-utility
src/components/ChordView.tsx            raw-hex,palette-color,invalid-utility
src/components/DrumPads.tsx             raw-hex,palette-color
src/components/EffectsRackView.tsx      palette-color,dark-variant
src/components/Header.tsx               palette-color,absolute-bw
src/components/ProjectModal.tsx         raw-hex,palette-color,absolute-bw
src/components/SequencerView.tsx        raw-hex,palette-color
src/components/SimpleSynthPanel.tsx     palette-color,dark-variant
src/components/SynthPresetLibrary.tsx   raw-hex,palette-color,absolute-bw,invalid-utility
src/components/SynthView.tsx            raw-hex,palette-color,absolute-bw,invalid-utility
src/components/TransportBar.tsx         invalid-utility
src/components/chord/SortableChordCard.tsx raw-hex,palette-color,invalid-utility
src/components/ui/ChannelStrip.tsx      raw-hex,palette-color
src/components/ui/Keyboard.tsx          palette-color,absolute-bw
src/components/ui/Knob.tsx              raw-hex,palette-color
src/components/ui/PresetLibrary.tsx     raw-hex,palette-color,absolute-bw,invalid-utility
src/components/ui/QuickSavePopover.tsx  raw-hex,palette-color
src/components/ui/Slider.tsx            raw-hex,palette-color
src/store/initialState.ts               palette-color
src/store/instantVibes.ts               raw-hex
```

Three corrections to the brief's candidate list, all confirmed against the repo:

1. **`src/components/TransportBar.tsx` is NOT palette-clean — keep it allowlisted.** It has zero hex and zero palette classes, but line 134 uses an undeclared breakpoint variant:
   ```tsx
   <span className="text-[10px] text-base-content/50 font-mono hidden xs:inline">BPM</span>
   ```
   Tailwind v4 has no `xs` breakpoint, so `hidden xs:inline` renders as permanently `hidden`. That is the `invalid-utility` rule doing real work.
2. **`src/components/InstantVibesBar.tsx` IS clean — it must NOT be allowlisted.** It was never in the audit output. Leaving it in the allowlist would trip the anti-rot test in step 2.6.
3. **`src/audio/instantVibes.ts` and `src/store/instantVibes.ts` are dirty and were missing from the brief's list.** Both hold the same vibe-card colour table (`color: '#F59E0B'`, `bgGradient: 'from-amber-950/40 via-stone-900/40 to-amber-950/20'`, `borderColor: 'border-amber-500/40'`). They must be allowlisted now and are owned by **Task 20**.

Final allowlist size: **23 paths**.

- [ ] Also confirm the two *false positives* the naive regex would produce are excluded by the refined `invalid-utility` pattern above. `src/utils/knob.ts:25` and `src/utils/knob.test.ts:174` contain the object literal `{ xs: 22, sm: 36, ... }`. The lookahead `(?=[a-z[-])` rejects `xs: 22` (space follows the colon) while accepting `xs:inline`. Verify:

```bash
node -e "
const re=/(?<![\w-])(?:-?p[xytblrse]?-0\.2|scale-10[12]|z-6[0-9])|(?<=[\"'\`\s])xs:(?=[a-z[-])/;
for (const s of ['hidden xs:inline','{ xs: 22 }','py-0.2 rounded','scale-102','z-60','px-1.5','z-50','text-xs'])
  console.log(JSON.stringify(s), re.test(s));
"
```

Expected output exactly:

```
"hidden xs:inline" true
"{ xs: 22 }" false
"py-0.2 rounded" true
"scale-102" true
"z-60" true
"px-1.5" false
"z-50" false
"text-xs" false
```

- [ ] Delete the probe: `rm /tmp/solva-probe.mjs`

### 2.1 — RED: write the per-rule unit tests first

- [ ] Create `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.test.ts` with **only** the `scanSource` fixture tests for now:

```ts
import { describe, expect, test } from 'bun:test';
import { ALLOWLIST, RULES, scanRepo, scanSource } from './themeTokenGuard';

const rulesOf = (source: string) =>
  scanSource('src/components/Fixture.tsx', source).map((v) => v.rule);

describe('scanSource — raw-hex', () => {
  test('flags a hex literal in a Tailwind arbitrary value', () => {
    expect(rulesOf('const c = "bg-[#12152A] border-[#252B48]";')).toContain('raw-hex');
  });

  test('flags a hex literal in an SVG presentation attribute', () => {
    expect(rulesOf('<rect stroke="#252B48" fill="#0B0D19" />')).toContain('raw-hex');
  });

  test('flags a hex literal in a canvas strokeStyle assignment', () => {
    expect(rulesOf("ctx.strokeStyle = '#6ee7b7';")).toContain('raw-hex');
  });

  test('does not flag a semantic class string', () => {
    expect(rulesOf('const c = "bg-base-100 border-base-300";')).not.toContain('raw-hex');
  });
});

describe('scanSource — palette-color', () => {
  test('flags indigo-500', () => {
    expect(rulesOf('const c = "bg-indigo-500 text-slate-400";')).toContain('palette-color');
  });

  test('flags a palette color inside a template literal with an opacity suffix', () => {
    expect(rulesOf('const c = `ring-emerald-500/30 from-rose-500`;')).toContain('palette-color');
  });

  test('does not flag base-100 / base-200 / base-300', () => {
    expect(rulesOf('const c = "bg-base-100 bg-base-200 border-base-300";')).not.toContain(
      'palette-color',
    );
  });

  test('does not flag a bare numeric utility like gap-500 on a non-color word', () => {
    expect(rulesOf('const c = "grid-cols-12 delay-500";')).not.toContain('palette-color');
  });
});

describe('scanSource — absolute-bw', () => {
  test('flags text-white', () => {
    expect(rulesOf('const c = "bg-indigo-600 text-white";')).toContain('absolute-bw');
  });

  test('flags bg-black with an opacity modifier', () => {
    expect(rulesOf('const c = "fixed inset-0 bg-black/70";')).toContain('absolute-bw');
  });

  test('does not flag text-primary-content', () => {
    expect(rulesOf('const c = "bg-primary text-primary-content";')).not.toContain('absolute-bw');
  });

  test('does not flag the word white inside an identifier', () => {
    expect(rulesOf('const whiteKeyIndex = 3;')).not.toContain('absolute-bw');
  });
});

describe('scanSource — dark-variant', () => {
  test('flags a dark: variant', () => {
    expect(rulesOf('const c = "text-purple-600 dark:text-purple-400";')).toContain('dark-variant');
  });

  test('does not flag the substring dark inside darkMode or a URL fragment', () => {
    expect(rulesOf('const darkMode = true; const u = "https://x.dev/dark";')).not.toContain(
      'dark-variant',
    );
  });
});

describe('scanSource — rgba-literal', () => {
  test('flags rgba(', () => {
    expect(rulesOf("ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';")).toContain('rgba-literal');
  });

  test('flags rgb(', () => {
    expect(rulesOf("el.style.color = 'rgb(0 0 0)';")).toContain('rgba-literal');
  });

  test('does not flag oklch() or a CSS var lookup', () => {
    expect(rulesOf("const c = 'oklch(var(--color-primary))';")).not.toContain('rgba-literal');
  });
});

describe('scanSource — invalid-utility', () => {
  test('flags py-0.2 (not a real Tailwind spacing step)', () => {
    expect(rulesOf('const c = "px-1.5 py-0.2 rounded";')).toContain('invalid-utility');
  });

  test('flags scale-102 (not a real Tailwind scale step)', () => {
    expect(rulesOf('const c = "shadow-2xl scale-102";')).toContain('invalid-utility');
  });

  test('flags z-60 (Tailwind tops out at z-50)', () => {
    expect(rulesOf('const c = "fixed inset-0 z-60";')).toContain('invalid-utility');
  });

  test('flags the undeclared xs: breakpoint variant', () => {
    expect(rulesOf('const c = "hidden xs:inline";')).toContain('invalid-utility');
  });

  test('does not flag a size-key object literal that happens to be named xs', () => {
    expect(rulesOf('export const SIZE_PX = { xs: 22, sm: 36, md: 48 };')).not.toContain(
      'invalid-utility',
    );
  });

  test('does not flag valid utilities py-0.5, scale-105, z-50, text-xs', () => {
    expect(rulesOf('const c = "py-0.5 scale-105 z-50 text-xs";')).not.toContain('invalid-utility');
  });
});

describe('scanSource — mechanics', () => {
  test('ignores single-line and block comments', () => {
    const src = [
      '// legacy was bg-[#12152A] with text-white',
      '/* and dark:bg-indigo-500 */',
      'const c = "bg-base-100";',
    ].join('\n');
    expect(scanSource('src/components/Fixture.tsx', src)).toHaveLength(0);
  });

  test('reports a 1-based line number and a trimmed snippet', () => {
    const src = ['const a = 1;', 'const c = "bg-indigo-500";'].join('\n');
    const [violation] = scanSource('src/components/Fixture.tsx', src);
    expect(violation.line).toBe(2);
    expect(violation.snippet).toBe('const c = "bg-indigo-500";');
  });

  test('returns nothing for a *.test.tsx path even when the source is dirty', () => {
    expect(scanSource('src/components/Fixture.test.tsx', 'const c = "text-white";')).toHaveLength(0);
  });

  test('exposes one entry per rule name', () => {
    expect(RULES.map((r) => r.name).sort()).toEqual([
      'absolute-bw',
      'dark-variant',
      'invalid-utility',
      'palette-color',
      'raw-hex',
      'rgba-literal',
    ]);
  });
});
```

- [ ] Run it and watch it fail for the right reason:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
```

Expected: a module-resolution failure — `error: Cannot find module './themeTokenGuard'`. That is the correct red: the test exists, the implementation does not.

### 2.2 — GREEN: implement `scripts/themeTokenGuard.ts`

- [ ] Create `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts`:

```ts
/**
 * Theme token guard.
 *
 * Scans the app source for legacy murva-palette leftovers that break the
 * `solva-light` daisyUI theme: raw hex literals, raw Tailwind palette colors,
 * absolute black/white, `dark:` variants, rgb()/rgba() literals, and a handful
 * of utilities that do not exist in Tailwind v4 (so they silently no-op).
 *
 * Deliberately dependency-free (node:fs / node:path only) so it runs under
 * `bun test`, under `bun run check:theme`, and in CI without a build step.
 *
 * Files still being migrated are listed in ALLOWLIST. Each migration task
 * deletes exactly one entry from that array as its failing-test step.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface Violation {
  /** 1-based line number within the scanned file. */
  line: number;
  /** Name of the RULES entry that matched. */
  rule: string;
  /** The trimmed source line the match occurred on. */
  snippet: string;
}

/** Every raw Tailwind palette family that must not appear in app source. */
const PALETTE_FAMILIES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');

export const RULES: { name: string; pattern: RegExp }[] = [
  {
    // Any hex color literal: Tailwind arbitrary values (bg-[#12152A]), SVG
    // presentation attributes (stroke="#252B48"), canvas fill/strokeStyle.
    name: 'raw-hex',
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    // indigo-500, slate-400, emerald-500/30, from-rose-500, ...
    name: 'palette-color',
    pattern: new RegExp(`\\b(?:${PALETTE_FAMILIES})-(?:50|[1-9]00|950)\\b`, 'g'),
  },
  {
    // text-white, bg-black/70, border-white/10, ring-black, ...
    name: 'absolute-bw',
    pattern:
      /\b(?:text|bg|border|fill|stroke|ring|shadow|from|via|to|divide|outline|decoration|accent|caret)-(?:white|black)(?:\/\d{1,3})?\b/g,
  },
  {
    // The `dark:` variant. daisyUI themes replace it entirely.
    name: 'dark-variant',
    pattern: /(?<![\w-])dark:/g,
  },
  {
    // rgb(...) / rgba(...) literals in canvas and inline-style code.
    name: 'rgba-literal',
    pattern: /\brgba?\(/g,
  },
  {
    // Utilities that do not exist in Tailwind v4 and therefore silently no-op:
    //   py-0.2 / px-0.2 / p-0.2  (spacing steps are .5-based)
    //   scale-101 / scale-102    (scale steps jump 100 -> 105)
    //   z-60..z-69               (z index tops out at z-50)
    //   xs:                      (there is no xs breakpoint)
    // The `xs:` half is written separately with a lookbehind/lookahead so it
    // matches `hidden xs:inline` but NOT the object literal `{ xs: 22 }` used
    // in src/utils/knob.ts.
    name: 'invalid-utility',
    pattern:
      /(?<![\w-])(?:-?p[xytblrse]?-0\.2|scale-10[12]|z-6[0-9])|(?<=["'`\s])xs:(?=[a-z[-])/g,
  },
];

/**
 * Repo-relative paths that are still allowed to contain violations.
 * SHRINKS ONLY. Each migration task deletes its own path here as its red step.
 * Never add a path back, and never add a path that is already clean — the
 * "allowlist contains no already-clean path" test enforces both.
 */
export const ALLOWLIST: readonly string[] = [
  'src/audio/instantVibes.ts',
  'src/audio/synthPresets.ts',
  'src/components/AudioVisualizer.tsx',
  'src/components/ChordPresetLibrary.tsx',
  'src/components/ChordView.tsx',
  'src/components/DrumPads.tsx',
  'src/components/EffectsRackView.tsx',
  'src/components/Header.tsx',
  'src/components/ProjectModal.tsx',
  'src/components/SequencerView.tsx',
  'src/components/SimpleSynthPanel.tsx',
  'src/components/SynthPresetLibrary.tsx',
  'src/components/SynthView.tsx',
  'src/components/TransportBar.tsx',
  'src/components/chord/SortableChordCard.tsx',
  'src/components/ui/ChannelStrip.tsx',
  'src/components/ui/Keyboard.tsx',
  'src/components/ui/Knob.tsx',
  'src/components/ui/PresetLibrary.tsx',
  'src/components/ui/QuickSavePopover.tsx',
  'src/components/ui/Slider.tsx',
  'src/store/initialState.ts',
  'src/store/instantVibes.ts',
];

/** Directories never walked, so hex in docs/ or built CSS in dist/ is ignored. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'docs',
  'build',
  'coverage',
  'public',
  'assets',
  '.git',
  '.worktrees',
  '.serena',
]);

const isTestFile = (relPath: string) => /\.test\.tsx?$/.test(relPath);
const isScannable = (relPath: string) => /\.tsx?$/.test(relPath) && !isTestFile(relPath);

/**
 * Strip `//` line comments and block comments, replacing them with spaces so
 * line numbers and column offsets are preserved. String literals containing
 * `//` (e.g. a URL) are left intact.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i += 1) out += source[i] === '\n' ? '\n' : ' ';
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Scan one file's source. Returns [] for test files (they legitimately assert
 * on legacy class strings) and for anything that is not .ts/.tsx.
 */
export function scanSource(relPath: string, source: string): Violation[] {
  const normalized = relPath.split(sep).join('/');
  if (!isScannable(normalized)) return [];

  const lines = stripComments(source).split('\n');
  const rawLines = source.split('\n');
  const violations: Violation[] = [];

  lines.forEach((line, index) => {
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        violations.push({
          line: index + 1,
          rule: rule.name,
          snippet: (rawLines[index] ?? line).trim(),
        });
      }
    }
  });

  return violations;
}

/**
 * Walk `<rootDir>/src` and scan every non-test .ts/.tsx file.
 * Allowlisted files are omitted from the result entirely, so an empty Map
 * means "every non-exempt file is clean".
 */
export function scanRepo(rootDir: string): Map<string, Violation[]> {
  const allow = new Set(ALLOWLIST);
  const results = new Map<string, Violation[]>();
  const srcRoot = join(rootDir, 'src');

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      const rel = relative(rootDir, abs).split(sep).join('/');
      if (!isScannable(rel) || allow.has(rel)) continue;
      const violations = scanSource(rel, readFileSync(abs, 'utf8'));
      if (violations.length > 0) results.set(rel, violations);
    }
  };

  if (!statSync(srcRoot).isDirectory()) {
    throw new Error(`themeTokenGuard: expected a src/ directory at ${srcRoot}`);
  }
  walk(srcRoot);

  return results;
}

/** Human-readable report used by both the test and `bun run check:theme`. */
export function formatReport(results: Map<string, Violation[]>): string {
  const lines: string[] = [];
  for (const [file, violations] of [...results].sort()) {
    lines.push(file);
    for (const v of violations) {
      lines.push(`  ${String(v.line).padStart(4)}  ${v.rule.padEnd(16)}  ${v.snippet}`);
    }
  }
  return lines.join('\n');
}
```

- [ ] Re-run the unit tests:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
```

Expected: all fixture tests pass, summary line contains `0 fail`.

### 2.3 — Add a CLI entry point

- [ ] Create `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/checkTheme.ts` — a thin runner in the same style as `scripts/check-key-bindings.ts` (plain script, `process.exit(1)` on failure):

```ts
import { ALLOWLIST, formatReport, scanRepo } from './themeTokenGuard';

const root = process.cwd();
const results = scanRepo(root);
const total = [...results.values()].reduce((n, v) => n + v.length, 0);

if (total > 0) {
  console.error(formatReport(results));
  console.error(
    `\ntheme token guard: ${total} violation(s) across ${results.size} file(s) outside the allowlist`,
  );
  process.exit(1);
}

console.log(
  `theme token guard: 0 violations outside the allowlist (${ALLOWLIST.length} file(s) still exempt)`,
);
```

- [ ] Add the script to `package.json`. Change:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "tsc --noEmit",
    "eslint": "eslint ."
  },
```

to:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "tsc --noEmit",
    "eslint": "eslint .",
    "check:theme": "bun run scripts/checkTheme.ts"
  },
```

- [ ] Run it:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run check:theme
```

Expected output exactly:

```
theme token guard: 0 violations outside the allowlist (23 file(s) still exempt)
```

If it instead lists files, the allowlist and the audit in step 2.0 have diverged — fix the allowlist, do not weaken a rule.

### 2.4 — RED: add the repo-wide assertion

- [ ] Append to `scripts/themeTokenGuard.test.ts`:

```ts
describe('scanRepo — every non-allowlisted src file is token-clean', () => {
  test('reports no violations outside the allowlist', () => {
    const results = scanRepo(process.cwd());
    const report = [...results]
      .sort()
      .map(
        ([file, violations]) =>
          `${file}\n` +
          violations.map((v) => `  ${v.line}  ${v.rule}  ${v.snippet}`).join('\n'),
      )
      .join('\n');

    expect(report).toBe('');
  });
});
```

- [ ] Run:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
```

Expected: `0 fail` — the allowlist currently covers every dirty file, so this is green *by construction*. This test is the machine that makes Tasks 3-19 fail on demand.

- [ ] **Prove it can go red.** Temporarily delete `'src/components/ui/Slider.tsx'` from `ALLOWLIST`, re-run, and confirm the failure names the file and its violations:

```
error: expect(received).toBe(expected)
- Expected  ""
+ Received  "src/components/ui/Slider.tsx
+   12  raw-hex  export function Slider({ id, value, min, max, step = 1, onChange, className = 'w-full h-1 bg-[#0B0D19] rounded cursor-pointer accent-indigo-500', title }: SliderProps) {
+   12  palette-color  export function Slider({ ... accent-indigo-500', title }: SliderProps) {"
```

- [ ] Put `'src/components/ui/Slider.tsx'` back and confirm `bun test scripts/themeTokenGuard.test.ts` is green again. **This is the exact red/green loop every one of Tasks 3-19 will run.**

### 2.5 — Guard the allowlist against rotting

An allowlist entry for a file that is already clean is dead weight and hides regressions. Add a test that forbids it.

- [ ] Append to `scripts/themeTokenGuard.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ALLOWLIST hygiene', () => {
  test('every allowlisted path exists on disk', () => {
    const missing = ALLOWLIST.filter((p) => !existsSync(join(process.cwd(), p)));
    expect(missing).toEqual([]);
  });

  test('no allowlisted path is already clean (delete it instead)', () => {
    const alreadyClean = ALLOWLIST.filter((p) => {
      const source = readFileSync(join(process.cwd(), p), 'utf8');
      return scanSource(p, source).length === 0;
    });
    expect(alreadyClean).toEqual([]);
  });

  test('is sorted and free of duplicates', () => {
    expect([...ALLOWLIST]).toEqual([...new Set(ALLOWLIST)].sort());
  });

  test('does not exempt InstantVibesBar, which is already token-clean', () => {
    expect(ALLOWLIST).not.toContain('src/components/InstantVibesBar.tsx');
  });

  test('shrinks to nothing by the end of the migration', () => {
    // Documents the finish line. Task 22 flips this to toHaveLength(0).
    expect(ALLOWLIST.length).toBeLessThanOrEqual(23);
  });
});
```

- [ ] `ALLOWLIST` is `readonly string[]`, so `expect([...ALLOWLIST])` (a mutable copy) is required for `toEqual` against a plain array. `toBeLessThanOrEqual` and `toEqual` are already declared in `src/types/bun-test.d.ts:74,42` — no typings change is needed for this task.

- [ ] Run:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
```

Expected: `0 fail`.

- [ ] **Prove the anti-rot test bites.** Temporarily add `'src/components/InstantVibesBar.tsx'` to `ALLOWLIST` and re-run. Expect **two** failures: the "already clean" test showing `["src/components/InstantVibesBar.tsx"]`, and the explicit `not.toContain` test. Remove it again and confirm green.

### 2.6 — Make `bun run lint` typecheck the new scripts

`tsconfig.json` currently only includes `src/**/*` and `vite.config.ts`, so nothing under `scripts/` is typechecked.

- [ ] Change `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/tsconfig.json` from:

```json
{
  "extends": "./tsconfig.strict.json",
  "include": ["src/**/*", "vite.config.ts"]
}
```

to:

```json
{
  "extends": "./tsconfig.strict.json",
  "include": [
    "src/**/*",
    "vite.config.ts",
    "scripts/themeTokenGuard.ts",
    "scripts/themeTokenGuard.test.ts",
    "scripts/checkTheme.ts"
  ]
}
```

Only the three new files are added — the pre-existing `scripts/check-key-bindings.ts`, `check-drum-kit-separation.ts` and `verify-borrowed.mts` stay out so this change cannot surface unrelated errors.

- [ ] Run:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run lint
```

Expected: no output, exit 0. (`node:fs` / `node:path` resolve because `@types/node@^22` is already a dependency; `bun:test` resolves via the ambient shim in `src/types/bun-test.d.ts`.)

### 2.7 — Full verification

- [ ] Run everything:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test && bun run lint && bun run eslint && bun run check:theme && bun run build
```

Expected, in order:
- `bun test` summary line contains `0 fail` and a pass count that is **higher** than before this task (the guard added ~30 tests)
- `bun run lint` — no output
- `bun run eslint` — no output
- `bun run check:theme` — `theme token guard: 0 violations outside the allowlist (23 file(s) still exempt)`
- `bun run build` — `✓ built in <n>ms`

- [ ] Confirm the guard really does ignore `docs/` and `dist/`. `docs/design.md` contains 14 hex literals and `dist/` contains the compiled theme CSS; neither may appear in the report:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run check:theme | grep -cE "docs/|dist/"
```

Expected: `0`.

- [ ] Confirm test files are ignored. `src/utils/knob.test.ts:174` contains `{ xs: 22, ... }` and several component tests assert on legacy class substrings:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run check:theme | grep -c "\.test\."
```

Expected: `0`.

### 2.8 — Commit

- [ ] Run:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add scripts/themeTokenGuard.ts scripts/themeTokenGuard.test.ts scripts/checkTheme.ts package.json tsconfig.json && git commit -F- <<'EOF'
test(theme): add theme-token guard with a 23-file migration allowlist

Add scripts/themeTokenGuard.ts, a dependency-free scanner over src/**
that flags the six classes of legacy-palette leftovers breaking the
solva-light theme: raw-hex, palette-color, absolute-bw, dark-variant,
rgba-literal and invalid-utility (py-0.2, scale-102, z-60, xs:).

Comments are stripped before scanning and *.test.ts(x) files are skipped,
so tests may keep asserting on legacy class strings. The walk starts at
src/ and skips dist/, docs/, node_modules/ and friends, so documentation
hex and compiled CSS are never scanned. SVG attributes such as
stroke="#252B48" are still caught.

ALLOWLIST holds the 23 files currently dirty; each migration task deletes
exactly one entry as its failing-test step. Hygiene tests forbid a stale
entry, a missing path, duplicates, and re-adding InstantVibesBar (which
an audit confirmed is already token-clean). TransportBar stays exempt
because line 134 uses the undeclared xs: breakpoint variant, and both
instantVibes colour tables were added after the audit found them.

Wire it up as `bun run check:theme` and typecheck the new scripts by
adding them to tsconfig include.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```
## Task 3: Migrate `src/components/ui/Slider.tsx` to a daisyUI `range`

**Files:**
- Modify: `src/components/ui/Slider.tsx` (line 12 — the default `className` parameter)
- Modify: `scripts/themeTokenGuard.ts` (remove one `ALLOWLIST` entry)
- Test: `src/components/ui/Slider.test.tsx` (create)

**Interfaces:**
- *Consumes:* nothing. `Slider` is a leaf primitive with no imports besides React's JSX runtime.
- *Produces:* the `Slider` component, exported as a named export from `src/components/ui/Slider.tsx`, with this exact prop contract (unchanged shape, changed default):
  ```ts
  interface SliderProps {
    id?: string;
    value: number;
    min: number;
    max: number;
    step?: number;              // default 1
    onChange: (value: number) => void;
    className?: string;         // NEW DEFAULT: 'range range-primary range-xs w-full'
    title?: string;
  }
  ```
  **The new default `className` string is exactly `'range range-primary range-xs w-full'`.** Later tasks (TransportBar, ChannelStrip, SequencerView, DrumPads, ChordView, SynthView) either drop their `className` override to inherit this default, or pass one of:
  `'range range-primary range-xs w-full'`, `'range range-secondary range-xs w-full'`, `'range range-accent range-xs w-full'`, optionally with a width override such as `'range range-primary range-xs w-16 sm:w-20'`.
  The component still renders a native `<input type="range">`; nothing about `value`/`onChange`/`step` semantics changes.

### Steps

- [ ] Open `scripts/themeTokenGuard.ts` and find the `ALLOWLIST` array. Delete the line containing `'src/components/ui/Slider.tsx',`.

- [ ] Run the guard test and confirm it goes RED:
  ```bash
  bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: 1 fail. The failure output lists violations for `src/components/ui/Slider.tsx`, including a `raw-hex` violation for `bg-[#0B0D19]` and a `palette-color` violation for `accent-indigo-500`, both on line 12.

- [ ] Create the component test at `src/components/ui/Slider.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { Slider } from './Slider';

  describe('Slider tokens', () => {
    test('defaults to a daisyUI primary range', () => {
      const html = renderToString(
        <Slider min={0} max={1} step={0.01} value={0.5} onChange={() => {}} />,
      );

      expect(html).toContain('type="range"');
      expect(html).toContain('range');
      expect(html).toContain('range-primary');
      expect(html).toContain('range-xs');
      // The legacy murva palette must be gone.
      expect(html).not.toContain('#0B0D19');
      expect(html).not.toContain('accent-indigo-500');
    });

    test('a caller-supplied className fully replaces the default', () => {
      const html = renderToString(
        <Slider
          id="slider-test"
          min={0}
          max={1}
          step={0.01}
          value={0.25}
          onChange={() => {}}
          className="range range-accent range-xs w-16"
          title="Bass Level"
        />,
      );

      expect(html).toContain('range-accent');
      expect(html).toContain('w-16');
      expect(html).not.toContain('range-primary');
      expect(html).toContain('id="slider-test"');
      expect(html).toContain('title="Bass Level"');
    });
  });
  ```

- [ ] Run it and confirm it goes RED:
  ```bash
  bun test src/components/ui/Slider.test.tsx
  ```
  Expected: the first test fails — `expect(html).toContain('range-primary')` fails because the rendered class attribute is still `w-full h-1 bg-[#0B0D19] rounded cursor-pointer accent-indigo-500`.

- [ ] Edit `src/components/ui/Slider.tsx` line 12. Before:
  ```tsx
  export function Slider({ id, value, min, max, step = 1, onChange, className = 'w-full h-1 bg-[#0B0D19] rounded cursor-pointer accent-indigo-500', title }: SliderProps) {
  ```
  After:
  ```tsx
  export function Slider({
    id,
    value,
    min,
    max,
    step = 1,
    onChange,
    className = 'range range-primary range-xs w-full',
    title,
  }: SliderProps) {
  ```
  Leave lines 14–23 (the `<input type="range">` body) exactly as they are — the `range` classes come in through `className`.

- [ ] Also update the `className` doc in the props interface so the contract is discoverable. Replace line 8 of `src/components/ui/Slider.tsx`:
  ```ts
    className?: string;
  ```
  with:
  ```ts
    /**
     * Full class list for the <input type="range">. Defaults to
     * 'range range-primary range-xs w-full'. Callers that need another accent
     * pass the whole daisyUI class list, e.g.
     * 'range range-accent range-xs w-16'.
     */
    className?: string;
  ```

- [ ] Verify GREEN:
  ```bash
  bun test src/components/ui/Slider.test.tsx scripts/themeTokenGuard.test.ts
  ```
  Expected: `4 pass, 0 fail` (2 Slider tests + the guard's tests).

- [ ] Verify types and lint:
  ```bash
  bun run lint && bun run eslint
  ```
  Expected: both exit 0 with no output.

- [ ] Run the full suite so nothing else regressed:
  ```bash
  bun test
  ```
  Expected: 0 fail.

- [ ] Commit:
  ```bash
  git add src/components/ui/Slider.tsx src/components/ui/Slider.test.tsx scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(ui): move Slider default onto daisyUI range tokens

  The Slider default className carried the murva palette
  (bg-[#0B0D19], accent-indigo-500), which does not exist in the
  solva themes and breaks solva-light. Default is now
  'range range-primary range-xs w-full'; callers may still override
  the whole class list to pick range-secondary/range-accent.

  Removes src/components/ui/Slider.tsx from the theme-token guard
  allowlist so regressions fail the build.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: Migrate `src/components/ui/Knob.tsx` off inline SVG hex and narrow its `color` prop

`Knob` paints itself with three inline SVG `stroke="#..."` attributes. Inline presentation attributes are baked into the element and cannot be re-themed by CSS variables, so they must become `className` utilities. The knob's needle/arc color comes from `currentColor`, which is set by the `color` prop on the wrapper `div` — that prop is currently `string`, so every call site can (and does) pass palette classes. Narrowing it to a union of token classes makes the compiler the guard for all call sites.

**Files:**
- Modify: `src/components/ui/Knob.tsx` (line 29 doc comment, line 148 wrapper, lines 152/162 labels, line 179 focus ring, lines 193–204 progress track, lines 221–228 `indicator="none"` ring, lines 245–253 detent tick)
- Modify: `src/components/SequencerView.tsx` (lines 256, 270 — `color` prop only)
- Modify: `src/components/SimpleSynthPanel.tsx` (lines 64, 90, 122, 154 — `color` prop only)
- Modify: `src/components/SynthView.tsx` (lines 782, 794, 806, 853, 866, 881, 918, 931, 944, 957, 981, 996, 1011, 1026, 1076, 1088 — `color` prop only)
- Modify: `src/components/EffectsRackView.tsx` (lines 64, 76, 120, 132, 177, 220, 234, 248 — `color` prop only)
- Modify: `scripts/themeTokenGuard.ts` (remove one `ALLOWLIST` entry)
- Test: `src/components/ui/Knob.test.tsx` (existing file — append a new `describe` block; do not touch the existing layout tests)

**Interfaces:**
- *Consumes:* `src/utils/knob.ts` (`AXIS_PICK_THRESHOLD_PX`, `PROGRESS_ARC_UNITS`, `SIZE_PX`, `angleForT`, `clamp`, `detentAngle`, `dragDeltaT`, `nextKeyValue`, `progressDash`, `snapToStep`, `tToValue`, `valueToT`, and the types `KeyDir`, `KnobIndicator`, `KnobScale`, `KnobSize`). None of this changes.
- *Produces:* a new exported type and the narrowed prop:
  ```ts
  /** The only knob tints allowed by the theme; keeps palette classes out. */
  export type KnobColor =
    | 'text-primary'
    | 'text-secondary'
    | 'text-accent'
    | 'text-success'
    | 'text-error';

  export interface KnobProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;             // default 0
    max?: number;             // default 1
    step?: number;
    scale?: KnobScale;        // default 'linear'
    size?: KnobSize;          // default 'md'
    label?: string;
    color?: KnobColor;        // default 'text-primary'
    format?: (v: number) => string;
    indicator?: KnobIndicator; // default 'progress'
    detent?: number;
    disabled?: boolean;
    id?: string;
    className?: string;
    layout?: 'vertical' | 'horizontal'; // default 'vertical'
  }
  ```
  `Knob`, `KnobColor`, `KnobIndicator`, `KnobScale`, `KnobSize` are all named exports of `src/components/ui/Knob.tsx`. Any later task rendering a `Knob` must pass `color` from that union or omit it (omitting yields `text-primary` amber).

### Steps

- [ ] Open `scripts/themeTokenGuard.ts` and delete the `ALLOWLIST` line containing `'src/components/ui/Knob.tsx',`.

- [ ] Run the guard and confirm RED:
  ```bash
  bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: 1 fail, listing for `src/components/ui/Knob.tsx`: `raw-hex` on lines 29 (`text-[#877dca]` in the comment), 148, 198, 226, 250, and `palette-color` on lines 152, 162, 179, 250 (`#94a3b8` is a slate hex).

- [ ] Append this block to the end of `src/components/ui/Knob.test.tsx` (keep the existing imports and the existing `describe('Knob layout variants', ...)` intact):
  ```tsx
  describe('Knob theme tokens', () => {
    const html = renderToString(
      <Knob
        value={0.5}
        onChange={() => {}}
        label="Cutoff"
        detent={0.5}
        format={(v) => `${v}`}
      />,
    );

    test('uses primary as the default needle tint', () => {
      expect(html).toContain('text-primary');
      expect(html).not.toContain('#877dca');
    });

    test('paints the ring and detent tick with token stroke utilities', () => {
      expect(html).toContain('stroke-base-300');
      expect(html).toContain('stroke-base-content/50');
      expect(html).not.toContain('#252B48');
      expect(html).not.toContain('#94a3b8');
    });

    test('labels and the focus ring use semantic tokens', () => {
      expect(html).toContain('text-base-content/60');
      expect(html).toContain('focus-visible:outline-primary/70');
      expect(html).not.toContain('text-slate-400');
      expect(html).not.toContain('outline-indigo-400');
    });

    test('an explicit token color overrides the default', () => {
      const accent = renderToString(
        <Knob value={0.5} onChange={() => {}} color="text-accent" label="LFO" />,
      );
      expect(accent).toContain('text-accent');
      expect(accent).not.toContain('text-primary');
    });
  });
  ```

- [ ] Confirm RED:
  ```bash
  bun test src/components/ui/Knob.test.tsx
  ```
  Expected: the three token tests fail (`text-primary` not found, `stroke-base-300` not found, `text-base-content/60` not found). The two pre-existing layout tests still pass.

- [ ] Edit `src/components/ui/Knob.tsx`. Replace the `color` line in `KnobProps` (line 29). Before:
  ```ts
    color?: string;  // Tailwind text-* class สีเข็ม + progress arc + ค่า (default text-[#877dca])
  ```
  After:
  ```ts
    /** Needle + progress arc + value tint. Token classes only (default 'text-primary'). */
    color?: KnobColor;
  ```
  And insert the union just above `export interface KnobProps {` (i.e. between line 18 `export type { KnobIndicator, KnobScale, KnobSize };` and line 20):
  ```ts
  /** The only knob tints allowed by the theme; keeps palette classes out. */
  export type KnobColor =
    | 'text-primary'
    | 'text-secondary'
    | 'text-accent'
    | 'text-success'
    | 'text-error';
  ```

- [ ] Replace the wrapper `div` at line 148. Before:
  ```tsx
      <div className={`flex ${layout === 'horizontal' ? 'flex-row items-center gap-2' : 'flex-col items-center gap-1'} ${color ?? 'text-[#877dca]'} ${className ?? ''}`}>
  ```
  After:
  ```tsx
      <div className={`flex ${layout === 'horizontal' ? 'flex-row items-center gap-2' : 'flex-col items-center gap-1'} ${color ?? 'text-primary'} ${className ?? ''}`}>
  ```

- [ ] Replace both label spans. Line 152 before:
  ```tsx
              <span className="text-[10px] text-slate-400 block font-mono">
  ```
  after:
  ```tsx
              <span className="text-[10px] text-base-content/60 block font-mono">
  ```
  Line 162 before:
  ```tsx
          <span className="text-[10px] text-slate-400 block font-mono text-center">
  ```
  after:
  ```tsx
          <span className="text-[10px] text-base-content/60 block font-mono text-center">
  ```

- [ ] Replace the focus ring on the `<svg>` (line 179). Before:
  ```tsx
          className={`block touch-none select-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400/70 ${
  ```
  After:
  ```tsx
          className={`block touch-none select-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary/70 ${
  ```

- [ ] Replace the `indicator="progress"` track circle (lines 193–204). Before:
  ```tsx
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="#252B48"
                strokeWidth="10"
  ```
  After (drop the `stroke` attribute, add `className`):
  ```tsx
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                className="stroke-base-300"
                strokeWidth="10"
  ```

- [ ] Replace the `indicator="none"` ring (lines 221–228). Before:
  ```tsx
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="#252B48"
              strokeWidth="2"
            />
  ```
  After:
  ```tsx
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              className="stroke-base-300"
              strokeWidth="2"
            />
  ```

- [ ] Replace the detent tick line (lines 245–253). Before:
  ```tsx
              <line
                x1="50"
                y1="14"
                x2="50"
                y2="1"
                stroke="#94a3b8"
                strokeWidth="3"
                strokeLinecap="round"
              />
  ```
  After:
  ```tsx
              <line
                x1="50"
                y1="14"
                x2="50"
                y2="1"
                className="stroke-base-content/50"
                strokeWidth="3"
                strokeLinecap="round"
              />
  ```
  Leave the two `stroke="currentColor"` circles/needle (lines 211, 237, 258–259) alone — `currentColor` already resolves to the token set by `color`.

- [ ] Confirm the component test is GREEN and the guard passes:
  ```bash
  bun test src/components/ui/Knob.test.tsx scripts/themeTokenGuard.test.ts
  ```
  Expected: 0 fail.

- [ ] Typecheck — it will now FAIL at the 30 call sites that pass palette strings, which is the point of the narrowed union:
  ```bash
  bun run lint
  ```
  Expected: `error TS2322: Type '"text-pink-400"' is not assignable to type 'KnobColor'` (and equivalents) across `SequencerView.tsx`, `SimpleSynthPanel.tsx`, `SynthView.tsx`, `EffectsRackView.tsx`.

- [ ] Fix the `color` props at every call site with these exact substitutions (touch **only** the `color=` attribute; the rest of those files is migrated by later tasks):
  ```bash
  sed -i '' \
    -e 's/color="text-pink-400"/color="text-secondary"/g' \
    -e 's/color="text-pink-500"/color="text-secondary"/g' \
    -e 's/color="text-indigo-400"/color="text-primary"/g' \
    -e 's/color="text-indigo-500"/color="text-primary"/g' \
    -e 's/color="text-amber-400"/color="text-primary"/g' \
    -e 's/color="text-amber-500"/color="text-primary"/g' \
    -e 's/color="text-emerald-400"/color="text-accent"/g' \
    -e 's/color="text-emerald-500"/color="text-accent"/g' \
    -e 's/color="text-cyan-400"/color="text-accent"/g' \
    -e 's/color="text-cyan-500"/color="text-accent"/g' \
    src/components/SequencerView.tsx \
    src/components/SimpleSynthPanel.tsx \
    src/components/SynthView.tsx \
    src/components/EffectsRackView.tsx
  ```
  Rationale for the mapping, from the canonical role map: indigo/amber = primary action → `primary`; pink = harmony/filter → `secondary`; cyan (LFO/mod) and emerald (module accent) → `accent`.

- [ ] Confirm no palette `color` props survive:
  ```bash
  grep -rn 'color="text-' src | grep -Ev 'text-(primary|secondary|accent|success|error)"'
  ```
  Expected: no output (exit code 1).

- [ ] Verify GREEN end to end:
  ```bash
  bun run lint && bun run eslint && bun test
  ```
  Expected: `lint` and `eslint` silent, `bun test` reports 0 fail.

- [ ] Commit:
  ```bash
  git add src/components/ui/Knob.tsx src/components/ui/Knob.test.tsx scripts/themeTokenGuard.ts src/components/SequencerView.tsx src/components/SimpleSynthPanel.tsx src/components/SynthView.tsx src/components/EffectsRackView.tsx
  git commit -m "$(cat <<'EOF'
  refactor(ui): theme Knob with token strokes and a typed color union

  The knob painted its ring and detent tick with inline SVG stroke
  attributes (#252B48, #94a3b8) that CSS cannot re-theme, and its
  color prop was a bare string, so call sites passed raw palette
  classes. Strokes are now stroke-base-300 / stroke-base-content/50,
  the default tint is text-primary, and color is typed KnobColor so
  the compiler rejects palette strings. Call-site color props are
  remapped to primary/secondary/accent.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: Migrate `src/components/ui/ChannelStrip.tsx` to tokens and give the readout `font-mono`

**Files:**
- Modify: `src/components/ui/ChannelStrip.tsx` (line 5 `LABEL_BASE`, lines 11/16 prop types, line 26 default `sliderClassName`, lines 33–35 label + readout, line 36 container, line 49 readout span)
- Modify: `src/components/ChordView.tsx` (lines 696, 1063, 1066 — the two `ChannelStrip` call sites only)
- Modify: `scripts/themeTokenGuard.ts` (remove one `ALLOWLIST` entry)
- Test: `src/components/ui/ChannelStrip.test.tsx` (create)

**Interfaces:**
- *Consumes:* `Slider` from `./Slider` (Task 3) — a native range input whose full class list is the `className` prop; `Volume2` from `lucide-react`.
- *Produces:*
  ```ts
  type StripAccent =
    | 'text-primary'
    | 'text-secondary'
    | 'text-accent'
    | 'text-success'
    | 'text-error';

  interface ChannelStripProps {
    idPrefix: string;            // layer slug, e.g. "chord" | "bass"; drives id={`slider-${idPrefix}-layer-volume`}
    label: string;               // e.g. "Chord Level"
    volume: number;              // 0..1.5
    accentClass: StripAccent;    // tint of the Volume2 icon
    onVolumeChange: (v: number) => void;
    showReadout?: boolean;       // default true
    sliderClassName?: string;    // default 'range range-xs range-accent'
  }
  ```
  `ChannelStrip` remains the default-style mixer strip used by ChordView's chord and bass layers.

### Steps

- [ ] Open `scripts/themeTokenGuard.ts` and delete the `ALLOWLIST` line containing `'src/components/ui/ChannelStrip.tsx',`.

- [ ] Confirm RED:
  ```bash
  bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: 1 fail, listing `src/components/ui/ChannelStrip.tsx` with `palette-color` on lines 5, 26, 49 and `raw-hex` on lines 26, 36.

- [ ] Create `src/components/ui/ChannelStrip.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { ChannelStrip } from './ChannelStrip';

  describe('ChannelStrip tokens', () => {
    const html = renderToString(
      <ChannelStrip
        idPrefix="chord"
        label="Chord Level"
        volume={0.8}
        accentClass="text-primary"
        onVolumeChange={() => {}}
      />,
    );

    test('uses base tokens for the label, shell and readout', () => {
      expect(html).toContain('text-base-content/50');
      expect(html).toContain('bg-base-200');
      expect(html).toContain('border-base-300');
      expect(html).toContain('text-accent');
      expect(html).not.toContain('#0B0D19');
      expect(html).not.toContain('#171B36');
      expect(html).not.toContain('#2D355A');
      expect(html).not.toContain('text-slate-500');
      expect(html).not.toContain('indigo');
    });

    test('renders a daisyUI range for the fader', () => {
      expect(html).toContain('range');
      expect(html).toContain('range-xs');
      expect(html).toContain('id="slider-chord-layer-volume"');
    });

    test('the percentage in the label is monospaced', () => {
      // The numeric readout must live in its own font-mono span (design.md §
      // numeric readouts), not inline in the prose label.
      expect(html).toContain('<span class="font-mono">(80%)</span>');
    });

    test('showReadout=false hides the trailing percentage', () => {
      const bass = renderToString(
        <ChannelStrip
          idPrefix="bass"
          label="Bass Level"
          volume={0.5}
          accentClass="text-accent"
          onVolumeChange={() => {}}
          showReadout={false}
        />,
      );
      expect(bass).toContain('min-w-8');
      expect(bass).not.toContain('min-w-8 text-right');
    });
  });
  ```
  Note: the last test asserts that the right-hand readout span (which carries `min-w-8 text-right`) is absent; the `expect(bass).toContain('min-w-8')` line is wrong on purpose only if you copy it blindly — delete that line and keep just the `not.toContain` assertion:
  ```tsx
    test('showReadout=false hides the trailing percentage', () => {
      const bass = renderToString(
        <ChannelStrip
          idPrefix="bass"
          label="Bass Level"
          volume={0.5}
          accentClass="text-accent"
          onVolumeChange={() => {}}
          showReadout={false}
        />,
      );
      expect(bass).not.toContain('min-w-8 text-right');
    });
  ```

- [ ] Confirm RED:
  ```bash
  bun test src/components/ui/ChannelStrip.test.tsx
  ```
  Expected: the first and third tests fail (`text-base-content/50` missing; the label currently renders `Chord Level (80%)` as one text node with no `font-mono` span).

- [ ] Edit `src/components/ui/ChannelStrip.tsx`. Replace line 5. Before:
  ```ts
  const LABEL_BASE = "text-[10px] text-slate-500 block mb-1";
  ```
  After:
  ```ts
  const LABEL_BASE = "text-[10px] text-base-content/50 block mb-1";
  ```

- [ ] Replace the props interface (lines 7–17). Before:
  ```ts
  interface ChannelStripProps {
    idPrefix: string;
    label: string;
    volume: number;
    accentClass: string;
    onVolumeChange: (v: number) => void;
    // The original chord panel shows a live % readout; the bass panel does not.
    showReadout?: boolean;
    // The original panels differ only in the slider accent color (indigo vs emerald).
    sliderClassName?: string;
  }
  ```
  After:
  ```ts
  /** Icon tints allowed by the theme; mirrors KnobColor so call sites stay honest. */
  type StripAccent =
    | "text-primary"
    | "text-secondary"
    | "text-accent"
    | "text-success"
    | "text-error";

  interface ChannelStripProps {
    idPrefix: string;
    label: string;
    volume: number;
    accentClass: StripAccent;
    onVolumeChange: (v: number) => void;
    // The chord panel shows a live % readout; the bass panel does not.
    showReadout?: boolean;
    // Full daisyUI class list for the fader, e.g. 'range range-xs range-primary'.
    sliderClassName?: string;
  }
  ```

- [ ] Replace the default on line 26. Before:
  ```tsx
    sliderClassName = "w-full h-1 bg-[#0B0D19] rounded cursor-pointer accent-indigo-500",
  ```
  After:
  ```tsx
    sliderClassName = "range range-xs range-accent",
  ```

- [ ] Replace the label and container (lines 33–36). Before:
  ```tsx
        <label className={LABEL_BASE}>
          {label} ({Math.round(volume * 100)}%)
        </label>
        <div className="flex items-center gap-2 bg-[#171B36] border border-[#2D355A] rounded-lg px-2.5 py-1 text-xs h-[30px]">
  ```
  After:
  ```tsx
        <label className={LABEL_BASE}>
          {label} <span className="font-mono">({Math.round(volume * 100)}%)</span>
        </label>
        <div className="flex items-center gap-2 bg-base-200 border border-base-300 rounded-lg px-2.5 py-1 text-xs h-[30px]">
  ```

- [ ] Replace the readout span (line 49). Before:
  ```tsx
            <span className="text-[10px] text-indigo-300 font-mono min-w-8 text-right">
  ```
  After:
  ```tsx
            <span className="text-[10px] text-accent font-mono min-w-8 text-right">
  ```

- [ ] Confirm GREEN for this file:
  ```bash
  bun test src/components/ui/ChannelStrip.test.tsx scripts/themeTokenGuard.test.ts
  ```
  Expected: 0 fail.

- [ ] Typecheck — it fails at ChordView's two call sites now that `accentClass` is a union:
  ```bash
  bun run lint
  ```
  Expected: `src/components/ChordView.tsx(696,13): error TS2322: Type '"text-indigo-400"' is not assignable to type 'StripAccent'` and the same at line 1063 for `"text-emerald-400"`.

- [ ] Fix the ChordView call sites (only these three attribute lines; the rest of ChordView is a later task). Line 696 before:
  ```tsx
            accentClass="text-indigo-400"
  ```
  after — and add an explicit primary fader so the icon and the fader agree:
  ```tsx
            accentClass="text-primary"
            sliderClassName="range range-xs range-primary"
  ```
  Lines 1063 and 1066 before:
  ```tsx
            accentClass="text-emerald-400"
            onVolumeChange={handleBassVolumeChange}
            showReadout={false}
            sliderClassName="w-full h-1 bg-[#0B0D19] rounded cursor-pointer accent-emerald-500"
  ```
  after:
  ```tsx
            accentClass="text-accent"
            onVolumeChange={handleBassVolumeChange}
            showReadout={false}
            sliderClassName="range range-xs range-accent"
  ```

- [ ] Verify GREEN end to end:
  ```bash
  bun run lint && bun run eslint && bun test
  ```
  Expected: `lint`/`eslint` silent; `bun test` 0 fail.

- [ ] Commit:
  ```bash
  git add src/components/ui/ChannelStrip.tsx src/components/ui/ChannelStrip.test.tsx src/components/ChordView.tsx scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(ui): token-ise ChannelStrip and monospace its level readout

  ChannelStrip hard-coded the murva panel hexes (#171B36, #2D355A,
  #0B0D19) plus slate/indigo palette classes, so it was invisible in
  solva-light. It now uses bg-base-200/border-base-300, a daisyUI
  range fader, and text-accent for the live percentage. The (NN%) in
  the label moves into its own font-mono span per design.md. The
  accentClass prop is narrowed to a token union, and ChordView's two
  call sites are updated to primary (chord) and accent (bass).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: Theme `src/components/ui/Keyboard.tsx` (piano-key tokens + button semantics)

Two problems here. (1) A piano needs a genuinely white white-key and a genuinely black black-key in **both** themes — no daisyUI base token expresses that, because `base-100` flips from `#1C1924` to `#FFFFFF`. So this task introduces four dedicated theme variables in `src/index.css`. (2) The keys are `<div>`s with mouse handlers, no `role`, no `tabIndex`, and no keyboard handler — they are unreachable without a mouse.

**Decision (do not improvise an alternative):** register the key colors as Tailwind v4 theme colors in `src/index.css` via `@theme`, pointing at plain custom properties that each theme block redefines. That yields real utilities — `bg-key-white`, `text-key-white-content`, `bg-key-black`, `text-key-black-content` — usable exactly like any other color utility, with no arbitrary-value syntax in the TSX.

Note on the guard: `scanSource` runs the `raw-hex` rule over source files; hex literals inside `src/index.css` are the legitimate place for theme definitions. Confirm `src/index.css` is not scanned (or is allowlisted) and leave it that way — the four key colors belong there, alongside the existing `--color-base-*` daisyUI declarations.

**Files:**
- Modify: `src/index.css` (after the `solva-light` `@plugin "daisyui/theme"` block ending line 38)
- Modify: `src/components/ui/Keyboard.tsx` (lines 133–158 `ScaleLockedKey`, lines 219–249 black key, lines 252–280 white key)
- Modify: `scripts/themeTokenGuard.ts` (remove one `ALLOWLIST` entry)
- Test: `src/components/ui/Keyboard.tokens.test.tsx` (create — the existing `src/components/ui/Keyboard.test.ts` covers the note-math functions and must not be touched)

**Interfaces:**
- *Consumes:* `getScaleNotes`, `rootSemitone`, `ROOTS` from `../../utils/musicTheory`; `shortcutLabel` from `../../utils/keyboard`.
- *Produces:* unchanged exports — `clampKeyboardOctave(octave: number): number`, `ScaleKeyboardNote` (`{ note: string; label: string; key: string; isBlack: boolean }`), `getScaleLockedKeyboardNotes`, `getScaleLockedKeyboardNotesFlat`, `ScaleLockedKey`, `ScaleLockedKeyboard`, `ChromaticKeyboard`, `getBlackKeyLeftPx`, `getChromaticKeyboardNotes`. Prop shapes are unchanged:
  ```ts
  ScaleLockedKey: { k: ScaleKeyboardNote; isActive: boolean; onNoteOn: (note: string) => void; onNoteOff: (note: string) => void }
  ScaleLockedKeyboard: { rows: { homeRow: ScaleKeyboardNote[]; topRow: ScaleKeyboardNote[] }; activeNotes: Set<string>; onNoteOn: (note: string) => void; onNoteOff: (note: string) => void }
  ChromaticKeyboard: { octaveOffset: number; activeNotes: Set<string>; onNoteOn: (note: string) => void; onNoteOff: (note: string) => void }
  ```
  New global utilities available to any later task: `bg-key-white`, `text-key-white-content`, `border-key-white`, `bg-key-black`, `text-key-black-content`, `border-key-black`.

### Steps

- [ ] Open `scripts/themeTokenGuard.ts` and delete the `ALLOWLIST` line containing `'src/components/ui/Keyboard.tsx',`.

- [ ] Confirm RED:
  ```bash
  bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: 1 fail, listing `src/components/ui/Keyboard.tsx` with `palette-color` violations on lines 147, 149, 150, 154, 233, 235, 236, 242, 245, 267, 269, 270, 276.

- [ ] Add the key-color tokens to `src/index.css`. Insert this immediately after line 38 (the closing `}` of the `solva-light` theme block) and before `@layer base {`:
  ```css
  /* Piano keys are physical objects: white stays white and black stays black in
     both themes, so they cannot ride on base-100/base-content. Registered in
     @theme so Tailwind emits bg-key-white / text-key-black-content utilities,
     with the values indirected through per-theme custom properties. */
  @theme {
    --color-key-white: var(--key-white);
    --color-key-white-content: var(--key-white-content);
    --color-key-black: var(--key-black);
    --color-key-black-content: var(--key-black-content);
  }

  :root,
  [data-theme="solva-dark"] {
    --key-white: #EDE7E1;
    --key-white-content: #14121B;
    --key-black: #241F2E;
    --key-black-content: #EDE7E1;
  }

  [data-theme="solva-light"] {
    --key-white: #FFFFFF;
    --key-white-content: #241E19;
    --key-black: #2A241F;
    --key-black-content: #F7F4EF;
  }
  ```

- [ ] Create `src/components/ui/Keyboard.tokens.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { ChromaticKeyboard, ScaleLockedKey } from './Keyboard';

  const noteOn = () => {};
  const noteOff = () => {};

  describe('Keyboard tokens and semantics', () => {
    const idle = renderToString(
      <ScaleLockedKey
        k={{ note: 'C3', label: 'C3', key: 'KeyQ', isBlack: false }}
        isActive={false}
        onNoteOn={noteOn}
        onNoteOff={noteOff}
      />,
    );
    const active = renderToString(
      <ScaleLockedKey
        k={{ note: 'C3', label: 'C3', key: 'KeyQ', isBlack: false }}
        isActive
        onNoteOn={noteOn}
        onNoteOff={noteOff}
      />,
    );

    test('scale-locked keys render as real buttons', () => {
      expect(idle).toContain('<button');
      expect(idle).toContain('type="button"');
      expect(idle).toContain('id="key-C3"');
    });

    test('an idle white key uses the dedicated piano-white token', () => {
      expect(idle).toContain('bg-key-white');
      expect(idle).toContain('text-key-white-content');
      expect(idle).not.toContain('slate');
      expect(idle).not.toContain('indigo');
    });

    test('an active key is primary amber', () => {
      expect(active).toContain('bg-primary');
      expect(active).toContain('text-primary-content');
      expect(active).not.toContain('indigo');
    });

    test('shortcut hints and borders use tokens', () => {
      expect(idle).toContain('text-primary');
      expect(idle).toContain('border-base-300');
    });

    test('the chromatic keyboard black keys use the piano-black token', () => {
      const html = renderToString(
        <ChromaticKeyboard
          octaveOffset={0}
          activeNotes={new Set<string>()}
          onNoteOn={noteOn}
          onNoteOff={noteOff}
        />,
      );
      expect(html).toContain('bg-key-black');
      expect(html).toContain('text-key-black-content');
      expect(html).toContain('bg-key-white');
      expect(html).toContain('<button');
      expect(html).not.toContain('slate');
      expect(html).not.toContain('indigo');
    });
  });
  ```

- [ ] Confirm RED:
  ```bash
  bun test src/components/ui/Keyboard.tokens.test.tsx
  ```
  Expected: all five tests fail — the markup is still `<div ... class="... border-slate-700 ... from-slate-100 ...">`.

- [ ] Rewrite `ScaleLockedKey`'s returned element (lines 133–158). Before:
  ```tsx
      <div
        id={`key-${k.note}`}
        onMouseDown={() => onNoteOn(k.note)}
        onMouseUp={() => onNoteOff(k.note)}
        onMouseLeave={() => isActive && onNoteOff(k.note)}
        onTouchStart={(e) => {
          e.preventDefault();
          onNoteOn(k.note);
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          onNoteOff(k.note);
        }}
        className={`w-12 h-full rounded-b-md border border-slate-700 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all ${
          isActive
            ? "bg-gradient-to-b from-indigo-200 to-indigo-400 text-slate-950 shadow-inner scale-[0.99]"
            : "bg-gradient-to-b from-slate-100 to-slate-200 text-slate-800 hover:from-white hover:to-slate-100"
        }`}
      >
        <span className="text-[10px] font-mono font-bold">{k.label}</span>
        <span className="text-[9px] font-mono text-indigo-600 uppercase font-semibold">
          {shortcutLabel(k.key)}
        </span>
      </div>
  ```
  After:
  ```tsx
      <button
        type="button"
        id={`key-${k.note}`}
        aria-label={k.note}
        aria-pressed={isActive}
        onMouseDown={() => onNoteOn(k.note)}
        onMouseUp={() => onNoteOff(k.note)}
        onMouseLeave={() => isActive && onNoteOff(k.note)}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onNoteOn(k.note);
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onNoteOff(k.note);
          }
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          onNoteOn(k.note);
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          onNoteOff(k.note);
        }}
        className={`w-12 h-full rounded-b-md border border-base-300 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all select-none ${
          isActive
            ? "bg-primary text-primary-content shadow-inner scale-[0.99]"
            : "bg-key-white text-key-white-content hover:brightness-105"
        }`}
      >
        <span className="text-[10px] font-mono font-bold">{k.label}</span>
        <span className="text-[9px] font-mono text-primary uppercase font-semibold">
          {shortcutLabel(k.key)}
        </span>
      </button>
  ```
  (The gradient is dropped: a flat key colour is what the two theme tokens express, and `hover:brightness-105` keeps the hover affordance without a second colour.)

- [ ] Rewrite the chromatic **black** key (lines 219–248). Before:
  ```tsx
            <div
              key={k.note}
              id={`key-${k.note}`}
              onMouseDown={() => onNoteOn(k.note)}
              onMouseUp={() => onNoteOff(k.note)}
              onMouseLeave={() => isActive && onNoteOff(k.note)}
              onTouchStart={(e) => {
                e.preventDefault();
                onNoteOn(k.note);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                onNoteOff(k.note);
              }}
              className={`absolute z-10 w-9 h-[100px] rounded-b-md border border-slate-900 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all ${
                isActive
                  ? "bg-gradient-to-b from-indigo-500 to-indigo-700 shadow-lg shadow-indigo-500/50 scale-[0.98]"
                  : "bg-gradient-to-b from-slate-800 to-slate-950 hover:bg-slate-800"
              }`}
              style={{
                left: `${getBlackKeyLeftPx(noteIndex)}px`,
              }}
            >
              <span className="text-[9px] font-mono font-bold text-slate-300">
                {k.label}
              </span>
              <span className="text-[8px] font-mono text-indigo-400 uppercase">
                {shortcutLabel(k.key)}
              </span>
            </div>
  ```
  After:
  ```tsx
            <button
              type="button"
              key={k.note}
              id={`key-${k.note}`}
              aria-label={k.note}
              aria-pressed={isActive}
              onMouseDown={() => onNoteOn(k.note)}
              onMouseUp={() => onNoteOff(k.note)}
              onMouseLeave={() => isActive && onNoteOff(k.note)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  onNoteOn(k.note);
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  onNoteOff(k.note);
                }
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                onNoteOn(k.note);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                onNoteOff(k.note);
              }}
              className={`absolute z-10 w-9 h-[100px] rounded-b-md border border-base-300 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all select-none ${
                isActive
                  ? "bg-primary text-primary-content shadow-lg shadow-primary/50 scale-[0.98]"
                  : "bg-key-black text-key-black-content hover:brightness-125"
              }`}
              style={{
                left: `${getBlackKeyLeftPx(noteIndex)}px`,
              }}
            >
              <span className="text-[9px] font-mono font-bold text-key-black-content">
                {k.label}
              </span>
              <span className="text-[8px] font-mono text-primary uppercase">
                {shortcutLabel(k.key)}
              </span>
            </button>
  ```
  Note the label span keeps `text-key-black-content` explicitly so it stays legible even when the key is active-amber — if you prefer inheritance, drop the class; the test only requires `text-key-black-content` to appear somewhere in the chromatic markup.

- [ ] Rewrite the chromatic **white** key (lines 252–280). Before:
  ```tsx
          <div
            key={k.note}
            id={`key-${k.note}`}
            onMouseDown={() => onNoteOn(k.note)}
            onMouseUp={() => onNoteOff(k.note)}
            onMouseLeave={() => isActive && onNoteOff(k.note)}
            onTouchStart={(e) => {
              e.preventDefault();
              onNoteOn(k.note);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              onNoteOff(k.note);
            }}
            className={`w-16 h-full rounded-b-md border border-slate-700 mx-0.5 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all ${
              isActive
                ? "bg-gradient-to-b from-indigo-200 to-indigo-400 text-slate-950 shadow-inner scale-[0.99]"
                : "bg-gradient-to-b from-slate-100 to-slate-200 text-slate-800 hover:from-white hover:to-slate-100"
            }`}
          >
            <span className="text-[10px] font-mono font-bold">
              {k.label}
            </span>
            <span className="text-[9px] font-mono text-indigo-600 uppercase font-semibold">
              {shortcutLabel(k.key)}
            </span>
          </div>
  ```
  After:
  ```tsx
          <button
            type="button"
            key={k.note}
            id={`key-${k.note}`}
            aria-label={k.note}
            aria-pressed={isActive}
            onMouseDown={() => onNoteOn(k.note)}
            onMouseUp={() => onNoteOff(k.note)}
            onMouseLeave={() => isActive && onNoteOff(k.note)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onNoteOn(k.note);
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onNoteOff(k.note);
              }
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              onNoteOn(k.note);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              onNoteOff(k.note);
            }}
            className={`w-16 h-full rounded-b-md border border-base-300 mx-0.5 cursor-pointer flex flex-col justify-end pb-2 items-center transition-all select-none ${
              isActive
                ? "bg-primary text-primary-content shadow-inner scale-[0.99]"
                : "bg-key-white text-key-white-content hover:brightness-105"
            }`}
          >
            <span className="text-[10px] font-mono font-bold">
              {k.label}
            </span>
            <span className="text-[9px] font-mono text-primary uppercase font-semibold">
              {shortcutLabel(k.key)}
            </span>
          </button>
  ```

- [ ] Verify GREEN:
  ```bash
  bun test src/components/ui/Keyboard.tokens.test.tsx src/components/ui/Keyboard.test.ts scripts/themeTokenGuard.test.ts
  ```
  Expected: 0 fail — the pre-existing note-math tests in `Keyboard.test.ts` still pass because none of the exported functions changed.

- [ ] Verify types, lint, and that the CSS still compiles:
  ```bash
  bun run lint && bun run eslint && bun run build
  ```
  Expected: `lint`/`eslint` silent; `vite build` finishes with `✓ built in …` and no Tailwind "unknown utility" warning for `bg-key-white` / `bg-key-black`.

- [ ] Run the full suite:
  ```bash
  bun test
  ```
  Expected: 0 fail.

- [ ] Commit:
  ```bash
  git add src/index.css src/components/ui/Keyboard.tsx src/components/ui/Keyboard.tokens.test.tsx scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(ui): theme the keyboard keys and make them focusable buttons

  Piano keys cannot ride on base-100/base-content: white must stay
  white and black must stay black in both themes. Adds
  --color-key-white/--color-key-black (plus content colors) to
  src/index.css, registered via @theme and redefined per theme, and
  consumes them as bg-key-white / bg-key-black. Active keys become
  primary amber per design.md's active-step convention, and the
  shortcut hints become text-primary.

  The keys were divs with mouse handlers only; they are now
  <button type="button"> with aria-label/aria-pressed and
  space/enter note-on/note-off, so the instrument is playable
  without a mouse.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: Rebuild `src/components/ui/PresetLibrary.tsx` on daisyUI drawer/modal/badge/input

This is the highest-impact file in the section: `ChordPresetLibrary.tsx` and `SynthPresetLibrary.tsx` are thin wrappers that inherit **all** of this chrome, so their later tasks depend on the contract below staying stable.

Two non-obvious decisions, both binding:

1. **Animations.** The file uses `animate-in fade-in slide-in-from-right duration-150 zoom-in-95`, which come from `tailwindcss-animate` — **that package is not installed**, so those classes emit nothing today. Do not add the dependency. Add two hand-written utilities to `src/index.css` and use them; delete every other `animate-in` / `fade-in` / `slide-in-from-*` / `zoom-in-*` / `duration-150` animation class in this file.
2. **Drawer.** Use daisyUI's `drawer drawer-end` with a `checked` `drawer-toggle` input (the component already gates on `isOpen`, so the toggle is permanently checked while mounted) and a `drawer-overlay` label wired to `onClose`.

**Files:**
- Modify: `src/index.css` (append two `@utility` blocks + their `@keyframes`)
- Modify: `src/components/ui/PresetLibrary.tsx` (lines 124–148 variant constants; 150–189 shell/header; 192–197 and 247–252 toasts; 200–253 toolbar; 256–317 inline save form; 321–363 list; 370–466 modal save form)
- Modify: `scripts/themeTokenGuard.ts` (remove one `ALLOWLIST` entry)
- Test: `src/components/ui/PresetLibrary.test.tsx` (create)

**Interfaces:**
- *Consumes:* `lucide-react` icons `Bookmark, Check, Plus, Search, Sparkles, Trash2, X`.
- *Produces:* the exported generic component and its types, **unchanged in shape** — `ChordPresetLibrary` and `SynthPresetLibrary` must keep compiling without edits:
  ```ts
  export interface PresetLibraryEntry { id: string; name: string; category: string; description: string; isFactory?: boolean }
  export interface PresetCategory { id: string; label: string; badgeClass: string; description: string; count?: string; selectLabel?: string }
  export interface PresetSaveDraft { name: string; category: string; description: string; roman?: string }
  export interface PresetLibraryGroup<T extends PresetLibraryEntry> { key: string; className?: string; innerClassName?: string; header?: React.ReactNode; entries: T[] }
  export interface PresetLibraryProps<T extends PresetLibraryEntry> {
    isOpen: boolean; onClose: () => void; title: string;
    headerSubtitle?: string; headerBadge?: string;
    saveButton?: { label: string; title?: string; inToolbar?: boolean; className?: string };
    renderHeaderActions?: React.ReactNode; toolbarActions?: React.ReactNode;
    toast?: string | null; toastPlacement?: 'top' | 'toolbar';
    searchPlaceholder?: string; variant: 'chord' | 'synth';
    entries: T[]; categories: PresetCategory[]; listContainerClass?: string;
    subtitle?: (entry: T) => string;
    renderEntryActions?: (entry: T) => React.ReactNode;
    renderEntry?: (entry: T) => React.ReactNode;
    groupEntries?: (filtered: T[], query: string, category: string) => PresetLibraryGroup<T>[];
    emptyState?: (query: string, category: string, openSave: () => void) => React.ReactNode;
    filterEntries?: (entry: T, query: string, category: string) => boolean;
    footer?: React.ReactNode;
    save: { heading: string; buttonLabel: string; withCategory: boolean; withDescription: boolean; withRoman: boolean; defaultCategory: string; variant: 'modal' | 'inline'; initialName?: string; chordsSummary?: { count: number; text: string } };
    onSelect: (entry: T) => void;
    onDelete?: (id: string) => void;
    onSave: (draft: PresetSaveDraft) => boolean;
  }
  export function PresetLibrary<T extends PresetLibraryEntry>(props: PresetLibraryProps<T>): JSX.Element | null;
  ```
  Behavioural contract the wrappers rely on and this task must preserve: returns `null` when `isOpen` is false; `onSave` returning `false` keeps the save form open; `variant: 'chord'` renders the save form as a centered modal, `variant: 'synth'` renders it inline under the toolbar; `categories[].badgeClass` is applied to the *selected* chip only.
- **Follow-up contract for the wrapper tasks:** `PresetCategory.badgeClass` is still a free-form string, and today the wrappers pass `'bg-indigo-600 text-white'` (`ChordPresetLibrary.tsx:43-51`, `SynthPresetLibrary.tsx:77,87`) and `src/audio/synthPresets.ts` passes `'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'`-style strings. Those are **out of scope here** — the wrapper tasks replace them with `badge-primary` / `badge-accent` / `badge-secondary` class lists. This task must not change the prop's type, or those files stop compiling.

New utilities produced for the whole app: `animate-fade-in`, `animate-slide-in-right`.

### Steps

- [ ] Open `scripts/themeTokenGuard.ts` and delete the `ALLOWLIST` line containing `'src/components/ui/PresetLibrary.tsx',`.

- [ ] Confirm RED:
  ```bash
  bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: 1 fail with a long violation list for `src/components/ui/PresetLibrary.tsx` — `raw-hex` (lines 125, 126, 142, 144, 145, 153, 155, 220, 238, 257, 276, 287, 303, 310, 338, 372, 392, 402, 419, 432, 438, 452), `palette-color` (lines 128–148, 157, 161, 164, 169, 193, 194, 220, 238, 248, 249, 259, 260, 263, 269, 283, 297, 310, 313, 326, 340, 341, 346, 351, 374, 375, 378, 385, 398, 413, 426, 438, 439, 442, 452, 458), `absolute-bw` (`bg-black/60` line 151, `bg-black/70` line 371, and every `text-white`), and `invalid-utility` (`py-0.2` line 141, `z-60` line 371).

- [ ] Add the two animation utilities to `src/index.css`. Append at the end of the file (after the `input[type="range"]` rule):
  ```css
  /* tailwindcss-animate is not a dependency; these two hand-written utilities
     replace the animate-in/fade-in/slide-in-from-right classes the preset
     library used to reference (which emitted nothing). */
  @keyframes solva-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes solva-slide-in-right {
    from { opacity: 0; transform: translateX(1.5rem); }
    to { opacity: 1; transform: translateX(0); }
  }

  @utility animate-fade-in {
    animation: solva-fade-in 150ms ease-out;
  }

  @utility animate-slide-in-right {
    animation: solva-slide-in-right 200ms ease-out;
  }
  ```

- [ ] Create `src/components/ui/PresetLibrary.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { PresetLibrary } from './PresetLibrary';
  import type { PresetLibraryEntry } from './PresetLibrary';

  const entries: PresetLibraryEntry[] = [
    { id: 'p1', name: 'Sunset Pad', category: 'Pop & EDM', description: 'warm', isFactory: false },
  ];

  const categories = [
    { id: 'All', label: 'All', badgeClass: 'badge-primary', description: '', count: '1' },
    { id: 'Pop & EDM', label: 'Pop & EDM', badgeClass: 'badge-primary', description: '' },
  ];

  const render = (variant: 'chord' | 'synth') =>
    renderToString(
      <PresetLibrary
        isOpen
        onClose={() => {}}
        title="Preset Library"
        headerBadge="24 Total"
        headerSubtitle="Key of C"
        toast="Saved!"
        toastPlacement="top"
        variant={variant}
        entries={entries}
        categories={categories}
        saveButton={{ label: 'Save Current', inToolbar: variant === 'synth' }}
        save={{
          heading: 'Save Progression Preset',
          buttonLabel: 'Save',
          withCategory: true,
          withDescription: true,
          withRoman: false,
          defaultCategory: 'Pop & EDM',
          variant: variant === 'chord' ? 'modal' : 'inline',
        }}
        onSelect={() => {}}
        onDelete={() => {}}
        onSave={() => true}
      />,
    );

  describe('PresetLibrary chrome', () => {
    const chord = render('chord');

    test('renders a daisyUI end-drawer instead of a hand-rolled overlay', () => {
      expect(chord).toContain('drawer drawer-end');
      expect(chord).toContain('drawer-toggle');
      expect(chord).toContain('drawer-side');
      expect(chord).toContain('drawer-overlay');
      expect(chord).not.toContain('bg-black/60');
    });

    test('uses base tokens for the shell', () => {
      expect(chord).toContain('bg-base-100');
      expect(chord).toContain('bg-base-200');
      expect(chord).toContain('border-base-300');
      expect(chord).not.toContain('#12152A');
      expect(chord).not.toContain('#252B48');
      expect(chord).not.toContain('#0E1022');
      expect(chord).not.toContain('#0B0D19');
    });

    test('search is a daisyUI input and chips are daisyUI badges/buttons', () => {
      expect(chord).toContain('input input-sm input-bordered');
      expect(chord).toContain('btn btn-xs');
      expect(chord).toContain('badge badge-sm');
    });

    test('the header badge is a monospaced outline badge', () => {
      expect(chord).toContain('badge badge-sm badge-primary badge-outline font-mono');
      expect(chord).toContain('24 Total');
    });

    test('the toast is a daisyUI success alert', () => {
      expect(chord).toContain('alert alert-success');
      expect(chord).toContain('Saved!');
      expect(chord).not.toContain('emerald');
    });

    test('no palette classes, no text-white, no invalid utilities survive', () => {
      for (const bad of ['indigo', 'slate', 'emerald', 'text-white', 'py-0.2', 'z-60', 'animate-in', 'slide-in-from-right']) {
        expect(chord).not.toContain(bad);
      }
    });

    test('the synth variant renders the inline save form path', () => {
      const synth = render('synth');
      expect(synth).toContain('drawer-side');
      expect(synth).not.toContain('indigo');
      expect(synth).not.toContain('#12152A');
    });

    test('isOpen=false still renders nothing', () => {
      const html = renderToString(
        <PresetLibrary
          isOpen={false}
          onClose={() => {}}
          title="Preset Library"
          variant="chord"
          entries={entries}
          categories={categories}
          save={{
            heading: 'x', buttonLabel: 'Save', withCategory: false, withDescription: false,
            withRoman: false, defaultCategory: 'All', variant: 'modal',
          }}
          onSelect={() => {}}
          onSave={() => true}
        />,
      );
      expect(html).toBe('');
    });
  });
  ```

- [ ] Confirm RED:
  ```bash
  bun test src/components/ui/PresetLibrary.test.tsx
  ```
  Expected: 6–7 of the 8 tests fail (only `isOpen=false` passes).

- [ ] Replace the variant-class constants block, lines 123–148. Before:
  ```tsx
    // -- the two originals' chrome variants --
    const toolbarClass = isChord
      ? 'p-3.5 border-b border-[#252B48] space-y-2.5 bg-[#0F1226]'
      : 'p-3 border-b border-[#252B48] space-y-2 bg-[#12152A]';
    const searchIconClass = isChord
      ? 'w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none'
      : 'w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5';
    const clearBtnClass = isChord
      ? 'absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs'
      : 'absolute right-2.5 top-2 text-slate-400 hover:text-slate-200';
    const chipsRowClass = isChord
      ? 'flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none'
      : 'flex gap-1 overflow-x-auto pb-1 scrollbar-none text-[11px]';
    const chipBaseClass = isChord
      ? 'px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer'
      : 'px-2 py-1 rounded-md font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 text-xs';
    const countClass = (selected: boolean) =>
      isChord
        ? 'ml-1 px-1.5 py-0.2 rounded-full bg-indigo-900/80 text-[10px]'
        : `text-[9px] px-1 rounded-full font-mono ${selected ? 'bg-indigo-700 text-white' : 'bg-[#161B36] text-slate-400'}`;
    const closeBtnClass = isChord
      ? 'p-1.5 rounded-lg bg-[#1A1F3B] hover:bg-[#252B48] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer'
      : 'p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#1C213E] transition-colors cursor-pointer';
    const saveButtonClass = saveButton?.className ?? (isChord
      ? 'p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-xs'
      : 'flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 px-3 rounded-lg shadow-md transition-colors cursor-pointer');
  ```
  After:
  ```tsx
    // -- the two variants' chrome; colour now comes entirely from daisyUI --
    const toolbarClass = isChord
      ? 'p-3.5 border-b border-base-300 space-y-2.5 bg-base-200'
      : 'p-3 border-b border-base-300 space-y-2 bg-base-200';
    const searchIconClass = isChord
      ? 'w-3.5 h-3.5 text-base-content/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10'
      : 'w-3.5 h-3.5 text-base-content/60 absolute left-2.5 top-2.5 z-10';
    const clearBtnClass = isChord
      ? 'btn btn-xs btn-ghost btn-circle absolute right-1.5 top-1/2 -translate-y-1/2'
      : 'btn btn-xs btn-ghost btn-circle absolute right-1.5 top-1';
    const chipsRowClass = isChord
      ? 'flex items-center gap-1.5 overflow-x-auto pb-1'
      : 'flex gap-1 overflow-x-auto pb-1 text-[11px]';
    const chipBaseClass =
      'badge badge-sm gap-1 whitespace-nowrap cursor-pointer transition-colors';
    const countClass = (selected: boolean) =>
      `ml-1 px-1.5 py-0.5 rounded-full font-mono text-[10px] ${
        selected ? 'bg-primary-content/20' : 'bg-base-300 text-base-content/60'
      }`;
    const closeBtnClass = 'btn btn-xs btn-ghost btn-circle';
    const saveButtonClass = saveButton?.className ?? (isChord
      ? 'btn btn-xs btn-primary gap-1'
      : 'btn btn-sm btn-primary flex-1 gap-1.5');
  ```

- [ ] Replace the shell and header, lines 150–189. Before:
  ```tsx
      <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
        {/* Sidebar Drawer */}
        <div className="w-full max-w-md h-full bg-[#12152A] border-l border-[#252B48] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
          {/* Drawer Header */}
          <div className="p-4 border-b border-[#252B48] flex items-center justify-between bg-[#0E1022]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  {title}
                  {headerBadge && (
                    <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">
                      {headerBadge}
                    </span>
                  )}
                </h3>
                {headerSubtitle && <p className="text-[11px] text-slate-400">{headerSubtitle}</p>}
              </div>
            </div>
  ```
  After:
  ```tsx
      <div className="drawer drawer-end fixed inset-0 z-50">
        <input
          type="checkbox"
          className="drawer-toggle"
          checked
          readOnly
          aria-hidden="true"
          tabIndex={-1}
        />
        {/* The panel is fixed, so the content column must not eat backdrop clicks. */}
        <div className="drawer-content pointer-events-none" />
        <div className="drawer-side z-50">
          <label
            className="drawer-overlay"
            aria-label="Close preset library"
            onClick={onClose}
          />
          {/* Sidebar Drawer */}
          <aside className="w-full max-w-md h-full bg-base-100 border-l border-base-300 flex flex-col shadow-2xl overflow-hidden animate-slide-in-right">
            {/* Drawer Header */}
            <div className="p-4 border-b border-base-300 flex items-center justify-between bg-base-200">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/20 border border-primary/30 text-primary">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-base-content flex items-center gap-2">
                    {title}
                    {headerBadge && (
                      <span className="badge badge-sm badge-primary badge-outline font-mono">
                        {headerBadge}
                      </span>
                    )}
                  </h3>
                  {headerSubtitle && <p className="text-[11px] text-base-content/60">{headerSubtitle}</p>}
                </div>
              </div>
  ```
  The old markup opened two `<div>`s (overlay + panel); the new markup opens `drawer` → `drawer-side` → `aside`. Re-indent the rest of the drawer body accordingly and make sure the closing tags at the old lines 366–367 become:
  ```tsx
          {/* Footer */}
          {footer}
        </aside>
      </div>
  ```
  with the outer `</div>` at old line 467 closing the `drawer`. Run `bun run lint` after this step alone if the nesting worries you — an unbalanced JSX tree is a hard tsc error.

- [ ] Replace the top toast, lines 192–197. Before:
  ```tsx
          {toastPlacement === 'top' && toast && (
            <div className="mx-4 mt-3 p-2 bg-emerald-950/80 border border-emerald-500/40 rounded-lg text-xs text-emerald-300 flex items-center gap-2 animate-in fade-in">
              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>{toast}</span>
            </div>
          )}
  ```
  After:
  ```tsx
          {toastPlacement === 'top' && toast && (
            <div className="alert alert-success mx-4 mt-3 py-2 text-xs animate-fade-in">
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span>{toast}</span>
            </div>
          )}
  ```

- [ ] Replace the search input, lines 215–221. Before:
  ```tsx
              <input
                type="text"
                placeholder={searchPlaceholder ?? 'Search...'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-[#0B0D19] border border-[#252B48] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
  ```
  After:
  ```tsx
              <input
                type="text"
                placeholder={searchPlaceholder ?? 'Search...'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input input-sm input-bordered w-full pl-8 pr-8 text-xs"
              />
  ```

- [ ] Replace the unselected chip classes, lines 235–239. Before:
  ```tsx
                  className={`${chipBaseClass} ${
                    category === c.id
                      ? c.badgeClass
                      : 'bg-[#0B0D19] hover:bg-[#1A1F3B] text-slate-400 hover:text-slate-200 border border-[#252B48]'
                  }`}
  ```
  After:
  ```tsx
                  className={`${chipBaseClass} ${
                    category === c.id
                      ? c.badgeClass
                      : 'badge-ghost text-base-content/60 hover:text-base-content'
                  }`}
  ```

- [ ] Replace the toolbar toast, lines 247–252. Before:
  ```tsx
            {toastPlacement === 'toolbar' && toast && (
              <div className="bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 animate-in fade-in">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>{toast}</span>
              </div>
            )}
  ```
  After:
  ```tsx
            {toastPlacement === 'toolbar' && toast && (
              <div className="alert alert-success py-1.5 text-xs animate-fade-in">
                <Check className="w-3.5 h-3.5" />
                <span>{toast}</span>
              </div>
            )}
  ```

- [ ] Replace the inline save form, lines 256–317, with the token version (same structure, same handlers):
  ```tsx
          {showSave && save.variant === 'inline' && (
            <form onSubmit={handleSubmitSave} className="p-3 bg-base-200 border-b border-primary/30 space-y-2.5 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-base-content flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5 text-primary" />
                  {save.heading}
                </span>
                <button type="button" onClick={() => setShowSave(false)} className="btn btn-xs btn-ghost btn-circle">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-base-content/60 block mb-1">Preset Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Hyper Saw Lead"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="input input-sm input-bordered w-full text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {save.withCategory && (
                  <div>
                    <label className="text-[10px] uppercase font-bold text-base-content/60 block mb-1">Category</label>
                    <select
                      value={draft.category}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                      className="select select-sm select-bordered w-full text-xs"
                    >
                      {categories.filter((c) => c.id !== 'All').map((c) => (
                        <option key={c.id} value={c.id}>{c.selectLabel ?? c.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {save.withDescription && (
                  <div>
                    <label className="text-[10px] uppercase font-bold text-base-content/60 block mb-1">Description (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Heavy punchy lead tone"
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      className="input input-sm input-bordered w-full text-xs"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowSave(false)} className="btn btn-xs btn-ghost">
                  Cancel
                </button>
                <button type="submit" className="btn btn-xs btn-primary">
                  {save.buttonLabel}
                </button>
              </div>
            </form>
          )}
  ```

- [ ] Replace the empty-state paragraph and the default entry row, lines 326 and 338–355. Before:
  ```tsx
                <p className="text-xs text-slate-500 py-6 text-center">No presets match.</p>
  ```
  After:
  ```tsx
                <p className="text-xs text-base-content/50 py-6 text-center">No presets match.</p>
  ```
  Before:
  ```tsx
                          <div className="flex items-center gap-2 bg-[#171B36] border border-[#2D355A] rounded-lg px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-slate-200 truncate">{entry.name}</div>
                              <div className="text-[10px] text-slate-500 truncate">{subtitle ? subtitle(entry) : entry.description}</div>
                            </div>
                            {renderEntryActions?.(entry)}
                            <button
                              onClick={() => onSelect(entry)}
                              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold px-2.5 py-1 rounded-md cursor-pointer"
                            >
                              <Check className="w-3 h-3" /> Select
                            </button>
                            {!entry.isFactory && onDelete && (
                              <button onClick={() => onDelete(entry.id)} className="text-slate-400 hover:text-red-400 cursor-pointer">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
  ```
  After:
  ```tsx
                          <div className="card card-compact bg-base-100 border border-base-300 flex-row items-center gap-2 px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-base-content truncate">{entry.name}</div>
                              <div className="text-[10px] text-base-content/50 truncate">{subtitle ? subtitle(entry) : entry.description}</div>
                            </div>
                            {renderEntryActions?.(entry)}
                            <button
                              onClick={() => onSelect(entry)}
                              className="btn btn-xs btn-primary gap-1"
                            >
                              <Check className="w-3 h-3" /> Select
                            </button>
                            {!entry.isFactory && onDelete && (
                              <button onClick={() => onDelete(entry.id)} className="btn btn-xs btn-ghost btn-circle text-base-content/60 hover:text-error">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
  ```

- [ ] Replace the whole modal save form, lines 369–466, with a daisyUI `<dialog>` (this also removes the invalid `z-60`; daisyUI's `.modal` already sits above the drawer's `z-50`):
  ```tsx
        {/* Save Progression Modal Dialog (chord variant) */}
        {showSave && save.variant === 'modal' && (
          <dialog className="modal modal-open">
            <div className="modal-box max-w-sm bg-base-100 border border-primary/40 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-base-content flex items-center gap-2">
                  <Bookmark className="w-4 h-4 text-primary" />
                  {save.heading}
                </h4>
                <button onClick={() => setShowSave(false)} className="btn btn-xs btn-ghost btn-circle">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmitSave} className="space-y-3">
                <div>
                  <label className="text-[11px] text-base-content/60 block mb-1">Progression Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. My Epic Verse Flow"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="input input-sm input-bordered w-full text-xs"
                  />
                </div>

                {save.withCategory && (
                  <div>
                    <label className="text-[11px] text-base-content/60 block mb-1">Category</label>
                    <select
                      value={draft.category}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                      className="select select-sm select-bordered w-full text-xs"
                    >
                      {categories.filter((c) => c.id !== 'All').map((c) => (
                        <option key={c.id} value={c.id}>{c.selectLabel ?? c.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {save.withRoman && (
                  <div>
                    <label className="text-[11px] text-base-content/60 block mb-1">Roman numerals (optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. I – V – vi – IV"
                      value={draft.roman ?? ''}
                      onChange={(e) => setDraft({ ...draft, roman: e.target.value })}
                      className="input input-sm input-bordered w-full text-xs font-mono"
                    />
                  </div>
                )}

                {save.withDescription && (
                  <div>
                    <label className="text-[11px] text-base-content/60 block mb-1">Description (Optional)</label>
                    <input
                      type="text"
                      placeholder="Notes about groove, tempo, or feel..."
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      className="input input-sm input-bordered w-full text-xs"
                    />
                  </div>
                )}

                {save.chordsSummary && (
                  <div className="p-2.5 rounded-lg bg-base-200 border border-base-300 text-[11px] text-base-content/60">
                    <span className="font-mono text-primary block mb-0.5">
                      Chords ({save.chordsSummary.count}):
                    </span>
                    <span className="font-mono font-semibold text-base-content">
                      {save.chordsSummary.text}
                    </span>
                  </div>
                )}

                <div className="modal-action">
                  <button
                    type="button"
                    onClick={() => setShowSave(false)}
                    className="btn btn-sm btn-ghost"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-sm btn-primary">
                    {save.buttonLabel}
                  </button>
                </div>
              </form>
            </div>
            <form method="dialog" className="modal-backdrop">
              <button type="button" onClick={() => setShowSave(false)}>close</button>
            </form>
          </dialog>
        )}
  ```
  (The chord-name readout at old line 442 gains `font-mono` — it is a musical readout per design.md. The roman-numeral input gains `font-mono` for the same reason.)

- [ ] Sweep for anything the by-hand pass missed:
  ```bash
  grep -nE '#[0-9A-Fa-f]{6}|indigo|slate|emerald|purple|pink|cyan|rose|text-white|bg-black|py-0\.2|z-60|animate-in|slide-in-from|zoom-in|scrollbar-none' src/components/ui/PresetLibrary.tsx
  ```
  Expected: no output (exit code 1).

- [ ] Verify GREEN:
  ```bash
  bun test src/components/ui/PresetLibrary.test.tsx scripts/themeTokenGuard.test.ts
  ```
  Expected: `9 pass, 0 fail` (8 PresetLibrary tests + the guard).

- [ ] Verify the wrappers still compile untouched, and that the build picks up the new utilities:
  ```bash
  bun run lint && bun run eslint && bun run build
  ```
  Expected: `lint`/`eslint` silent (in particular, no errors in `ChordPresetLibrary.tsx` or `SynthPresetLibrary.tsx`); `vite build` prints `✓ built in …`.

- [ ] Run the full suite:
  ```bash
  bun test
  ```
  Expected: 0 fail.

- [ ] Commit:
  ```bash
  git add src/index.css src/components/ui/PresetLibrary.tsx src/components/ui/PresetLibrary.test.tsx scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(ui): rebuild PresetLibrary on daisyUI drawer, modal and inputs

  The shared preset drawer carried most of the murva palette in one
  file: raw hex panels, indigo buttons, emerald toasts, a bg-black/60
  overlay, a hand-rolled right drawer and a hand-rolled save modal.
  It now uses drawer/drawer-side/drawer-overlay, modal/modal-box/
  modal-backdrop/modal-action, input-bordered, select-bordered,
  badge and alert alert-success, all on base/primary tokens.

  Also fixes three latent bugs: py-0.2 and z-60 were not real
  utilities, and the animate-in/fade-in/slide-in-from-right classes
  came from tailwindcss-animate, which is not installed - replaced by
  hand-written animate-fade-in / animate-slide-in-right utilities in
  src/index.css. Musical readouts gain font-mono.

  The exported PresetLibraryProps contract is unchanged, so
  ChordPresetLibrary and SynthPresetLibrary compile untouched.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8: Migrate `src/components/ui/QuickSavePopover.tsx` and fix the fused-class bug

This component's defaults are the rot's delivery mechanism: every call site that omits `inputClassName` inherits `bg-[#0B0D19] border border-[#2D355A] ... focus:border-indigo-500`. It also contains a real, live bug.

**The bug.** Lines 73 and 80 build their class list as:
```tsx
className={`bg-indigo-600 ... transition-colors shrink-0${buttonClassName}`}
```
There is no space before `${buttonClassName}`. Any caller passing `buttonClassName="cursor-pointer"` produces the single dead class `shrink-0cursor-pointer` — **both** `shrink-0` and `cursor-pointer` are lost. The only current caller (`src/components/SynthView.tsx:702`) passes `" cursor-pointer"` with a hand-inserted leading space, which is exactly the kind of fix that hides the defect from the next caller. Fix the template, keep the prop working.

**Files:**
- Modify: `src/components/ui/QuickSavePopover.tsx` (line 38 `inputClassName` default, line 43 container, lines 44–45 heading, line 49 input, line 59 select, line 62 `selectClassName` — see below, lines 71–83 the two buttons)
- Modify: `scripts/themeTokenGuard.ts` (remove one `ALLOWLIST` entry)
- Test: `src/components/ui/QuickSavePopover.test.tsx` (create)

**Interfaces:**
- *Consumes:* `Bookmark` from `lucide-react`.
- *Produces:*
  ```ts
  interface QuickSavePopoverProps {
    open: boolean;                       // false renders null
    onClose: () => void;
    heading: string;
    placeholder: string;
    saveLabel: string;
    name: string;
    onNameChange: (name: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    categories?: { id: string; label: string }[];
    category?: string;
    onCategoryChange?: (category: string) => void;
    formClassName?: string;   // default 'flex items-center gap-2 flex-1 max-w-md'
    inputClassName?: string;  // default 'input input-sm input-bordered flex-1'
    selectClassName?: string; // NEW, default 'select select-sm select-bordered'
    buttonClassName?: string; // default ''; appended to BOTH buttons with a separating space
  }
  ```
  All four `*ClassName` props remain optional pass-throughs. `buttonClassName` is now joined with a space, so callers pass `"cursor-pointer"`, not `" cursor-pointer"` — both forms work after the fix. The category `<select>` only renders when both `categories` and `onCategoryChange` are provided.
- *Downstream note:* `src/components/SynthView.tsx:700-712` currently passes `inputClassName="flex-1 min-w-[140px] bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"` and `buttonClassName=" cursor-pointer"`. **Task 18 (SynthView) deletes those two call-site overrides** so the synth popover inherits these defaults; this task must leave the props functional so that removal is a pure deletion. Do not edit SynthView here.

### Steps

- [ ] Open `scripts/themeTokenGuard.ts` and delete the `ALLOWLIST` line containing `'src/components/ui/QuickSavePopover.tsx',`.

- [ ] Confirm RED:
  ```bash
  bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: 1 fail, listing `src/components/ui/QuickSavePopover.tsx` with `raw-hex` on lines 38, 43, 62, 80, `palette-color` on lines 38, 43, 44, 45, 62, 73, 80, and `absolute-bw` (`text-white`) on line 73.

- [ ] Create `src/components/ui/QuickSavePopover.test.tsx` — the first test is the regression test for the fused-class bug:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { QuickSavePopover } from './QuickSavePopover';

  const base = {
    open: true,
    onClose: () => {},
    heading: 'Save Custom Preset:',
    placeholder: 'Preset Name...',
    saveLabel: 'Save Patch',
    name: '',
    onNameChange: () => {},
    onSubmit: () => {},
  };

  describe('QuickSavePopover', () => {
    test('buttonClassName is appended with a separating space', () => {
      const html = renderToString(
        <QuickSavePopover {...base} buttonClassName="cursor-pointer" />,
      );
      // Without the space the two classes fuse into one dead class
      // ("shrink-0cursor-pointer") and BOTH are lost.
      expect(html).toContain('shrink-0 cursor-pointer');
      expect(html).not.toContain('shrink-0cursor-pointer');
    });

    test('a leading-space buttonClassName does not double up', () => {
      const html = renderToString(
        <QuickSavePopover {...base} buttonClassName=" cursor-pointer" />,
      );
      expect(html).toContain('cursor-pointer');
      expect(html).not.toContain('shrink-0  cursor-pointer');
    });

    test('defaults use daisyUI card/input/button tokens', () => {
      const html = renderToString(<QuickSavePopover {...base} />);
      expect(html).toContain('card bg-base-100 border border-primary/40');
      expect(html).toContain('input input-sm input-bordered');
      expect(html).toContain('btn btn-sm btn-primary');
      expect(html).toContain('btn btn-sm btn-ghost');
      expect(html).toContain('text-base-content');
      expect(html).toContain('text-primary');
      expect(html).not.toContain('#0B0D19');
      expect(html).not.toContain('#2D355A');
      expect(html).not.toContain('#171B38');
      expect(html).not.toContain('indigo');
      expect(html).not.toContain('slate');
      expect(html).not.toContain('text-white');
    });

    test('the optional category select is a daisyUI select', () => {
      const html = renderToString(
        <QuickSavePopover
          {...base}
          categories={[{ id: 'lead', label: 'Lead' }]}
          category="lead"
          onCategoryChange={() => {}}
        />,
      );
      expect(html).toContain('select select-sm select-bordered');
      expect(html).toContain('Lead');
    });

    test('caller class overrides still win', () => {
      const html = renderToString(
        <QuickSavePopover
          {...base}
          inputClassName="input input-sm input-bordered flex-1 min-w-[140px]"
        />,
      );
      expect(html).toContain('min-w-[140px]');
    });

    test('open=false renders nothing', () => {
      expect(renderToString(<QuickSavePopover {...base} open={false} />)).toBe('');
    });
  });
  ```

- [ ] Confirm RED:
  ```bash
  bun test src/components/ui/QuickSavePopover.test.tsx
  ```
  Expected: the first test fails with the rendered HTML containing `shrink-0cursor-pointer`, and the third fails on `card bg-base-100 border border-primary/40`.

- [ ] Edit `src/components/ui/QuickSavePopover.tsx`. Add the `selectClassName` prop to the interface — insert after line 21 (`inputClassName?: string;`):
  ```ts
    selectClassName?: string;
  ```
  and update the comment block at lines 16–19 to:
  ```ts
    // The two popovers differ in their form/input/button classes: the synth
    // variant is wider (max-w-xl, wrap-capable) and gives the name input a
    // min-w-[140px]. Defaults are the shared daisyUI chrome; every override is
    // appended or replaced verbatim.
  ```

- [ ] Replace the defaults at lines 37–39. Before:
  ```tsx
    formClassName = "flex items-center gap-2 flex-1 max-w-md",
    inputClassName = "flex-1 bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500",
    buttonClassName = "",
  ```
  After:
  ```tsx
    formClassName = "flex items-center gap-2 flex-1 max-w-md",
    inputClassName = "input input-sm input-bordered flex-1",
    selectClassName = "select select-sm select-bordered",
    buttonClassName = "",
  ```

- [ ] Replace the container and heading, lines 42–47. Before:
  ```tsx
      <div className="bg-[#171B38] border border-indigo-500/40 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xl animate-in fade-in">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <Bookmark className="w-4 h-4 text-indigo-400" />
          <span>{heading}</span>
        </div>
  ```
  After:
  ```tsx
      <div className="card bg-base-100 border border-primary/40 rounded-xl p-3.5 flex flex-row flex-wrap items-center justify-between gap-3 shadow-xl animate-fade-in">
        <div className="flex items-center gap-2 text-xs font-semibold text-base-content">
          <Bookmark className="w-4 h-4 text-primary" />
          <span>{heading}</span>
        </div>
  ```
  (`animate-fade-in` is the utility added to `src/index.css` in Task 7. If Task 7 has not landed yet in your working tree, add the `@keyframes solva-fade-in` + `@utility animate-fade-in` block from Task 7 to `src/index.css` now — it is idempotent, and Task 7's step will then be a no-op.)

- [ ] Replace the category select, lines 59–63. Before:
  ```tsx
            <select
              value={category}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="bg-[#0B0D19] border border-[#2D355A] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
  ```
  After:
  ```tsx
            <select
              value={category}
              onChange={(e) => onCategoryChange(e.target.value)}
              className={selectClassName}
            >
  ```

- [ ] Replace both buttons, lines 71–83 — this is the bug fix. Before:
  ```tsx
          <button
            type="submit"
            className={`bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-xs transition-colors shrink-0${buttonClassName}`}
          >
            {saveLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`bg-[#0B0D19] hover:bg-[#1A1F3A] text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-[#252B48] transition-colors shrink-0${buttonClassName}`}
          >
            Cancel
          </button>
  ```
  After:
  ```tsx
          <button
            type="submit"
            className={`btn btn-sm btn-primary shrink-0 ${buttonClassName}`.trim()}
          >
            {saveLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`btn btn-sm btn-ghost shrink-0 ${buttonClassName}`.trim()}
          >
            Cancel
          </button>
  ```
  The separating space is now unconditional; `.trim()` keeps the class attribute clean when `buttonClassName` is the default `""`. A caller that still passes a leading space (SynthView, until Task 18) simply yields one harmless double space inside the attribute, which the second test tolerates by asserting only that `shrink-0  cursor-pointer` with two spaces does not appear — so if you prefer, normalise instead with:
  ```tsx
            className={['btn btn-sm btn-primary shrink-0', buttonClassName].join(' ').replace(/\s+/g, ' ').trim()}
  ```
  Pick the `.trim()` form above unless the second test fails; if it does, switch both buttons to the normalising form and re-run.

- [ ] Also give the text input a `text-xs` so the sizing matches the rest of the toolbar. Line 49–57 after edit:
  ```tsx
          <input
            type="text"
            required
            autoFocus
            placeholder={placeholder}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className={inputClassName}
          />
  ```
  (no class change needed here — the `text-xs` lives in the `inputClassName` default; confirm the default reads `"input input-sm input-bordered flex-1"` and leave it.)

- [ ] Verify GREEN:
  ```bash
  bun test src/components/ui/QuickSavePopover.test.tsx scripts/themeTokenGuard.test.ts
  ```
  Expected: `7 pass, 0 fail` (6 popover tests + the guard).

- [ ] Confirm the existing SynthView call site still typechecks with its (soon-to-be-removed) overrides:
  ```bash
  bun run lint && bun run eslint
  ```
  Expected: both silent. `SynthView.tsx:702`'s `buttonClassName=" cursor-pointer"` still compiles — Task 18 removes it.

- [ ] Run the full suite:
  ```bash
  bun test
  ```
  Expected: 0 fail.

- [ ] Commit:
  ```bash
  git add src/components/ui/QuickSavePopover.tsx src/components/ui/QuickSavePopover.test.tsx scripts/themeTokenGuard.ts src/index.css
  git commit -m "$(cat <<'EOF'
  fix(ui): separate QuickSavePopover's appended button class, theme its chrome

  Both buttons built their class list as `...shrink-0${buttonClassName}`
  with no separating space, so a caller passing "cursor-pointer" got the
  single dead class "shrink-0cursor-pointer" and lost both. The only
  current caller worked around it with a leading space. The template now
  joins with a space and trims, covered by a renderToString regression
  test.

  The component's defaults also carried the murva palette, which every
  call site inherited: the card, name input, category select and both
  buttons now use daisyUI card/input/select/btn tokens, and a new
  selectClassName prop makes the select overridable like the rest.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```
## Task 9: Tokenize `src/components/ProjectModal.tsx` (modal → daisyUI `dialog`/`modal-box`, fix stale export filename)

`src/components/ProjectModal.tsx` is the single most legacy-heavy file in the shell: it never received any of the Solva token work and is still 100% on the pre-Solva murva palette (`bg-black/70`, `bg-[#12152A]`, `bg-[#0B0D19]`, `border-[#2D355A]`, `border-[#252B48]`, `indigo-*`, `slate-*`, `emerald-*`, `purple-*`, `text-white`). In `solva-light` the modal renders a near-black panel with `slate-400` body copy on top of the light `#F7F4EF` app background — it is the most visually broken screen in the app. It is also the last place carrying the dead brand name: the exported JSON file is still named `..._musibox_project.json`.

**Files:**
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/ProjectModal.tsx`
- Create: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/ProjectModal.test.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts` (remove one `ALLOWLIST` entry)

**Interfaces:**
- Consumes: `ProjectState` from `../types`; `scanRepo` / `ALLOWLIST` from `scripts/themeTokenGuard.ts` (Task 2); daisyUI `modal` / `modal-box` / `modal-backdrop` / `modal-action` / `card` / `btn` / `input` component classes; the `success` semantic token added to both themes in `src/index.css` by Task 1.
- Produces: `export function projectFileName(title: string): string` — a pure, DOM-free helper returning the download filename for the JSON export (`"My Song" -> "My_Song_solva_project.json"`). Consumed by `ProjectModal.tsx` itself and by `src/components/ProjectModal.test.tsx`. No other module imports it yet.

### Scope note — "Export Mixdown" is NOT implemented here

`ProjectModal.tsx:140-149` renders a second export button whose `onClick` is a bare `alert('Audio Stems mixdown generated! Exporting project package...')`. It performs no audio rendering whatsoever. **Real audio mixdown/stem rendering is out of scope for this entire theme-migration plan** and is tracked as a separate feature effort. In this task you restyle that button and you leave the `alert(...)` call body byte-for-byte unchanged. Do not add a `// TODO` comment, do not stub a renderer, do not disable the button, do not change its label.

### Steps

- [ ] Open `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts` and find the `ALLOWLIST` array. Delete the line containing `'src/components/ProjectModal.tsx'` (keep every other entry).

- [ ] Run the guard and watch it go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: `1 fail`. The failure message lists `src/components/ProjectModal.tsx` with `raw-hex` violations (`#12152A`, `#2D355A`, `#0B0D19`, `#252B48`, `#1C213E`), `palette-color` violations (`indigo-600`, `indigo-500`, `indigo-400`, `slate-100`, `slate-400`, `slate-200`, `emerald-300`, `emerald-400`, `purple-400`) and an `absolute-bw` violation (`bg-black/70`, `hover:text-white`).

- [ ] Create `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/ProjectModal.test.tsx` with the failing tests:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { ProjectModal, projectFileName } from './ProjectModal';
  import type { ProjectState } from '../types';

  const project: ProjectState = {
    id: 'proj-active',
    title: 'Midnight Drive',
    bpm: 120,
    scaleRoot: 'A',
    scaleType: 'minor',
    synthParams: {} as ProjectState['synthParams'],
    sequencerTracks: [],
    chords: [],
    effects: {} as ProjectState['effects'],
  };

  describe('projectFileName', () => {
    test('uses the solva brand suffix, not the retired musibox one', () => {
      expect(projectFileName('Midnight Drive')).toBe('Midnight_Drive_solva_project.json');
      expect(projectFileName('Midnight Drive')).not.toContain('musibox');
    });

    test('collapses every run of whitespace into single underscores', () => {
      expect(projectFileName('  Lo   Fi  Chill ')).toBe('_Lo_Fi_Chill__solva_project.json');
    });
  });

  describe('ProjectModal theming', () => {
    test('renders as a daisyUI modal on semantic tokens', () => {
      const html = renderToString(
        <ProjectModal
          isOpen
          onClose={() => {}}
          project={project}
          onSaveProject={() => {}}
          onLoadTemplate={() => {}}
        />,
      );

      expect(html).toContain('modal modal-open');
      expect(html).toContain('modal-box');
      expect(html).toContain('modal-backdrop');
      expect(html).toContain('modal-action');
      expect(html).toContain('btn btn-sm btn-circle btn-ghost');
      expect(html).toContain('input input-sm input-bordered');
      expect(html).toContain('btn btn-sm btn-primary');
      expect(html).toContain('text-base-content/60');

      expect(html).not.toContain('bg-black/70');
      expect(html).not.toContain('#12152A');
      expect(html).not.toContain('#0B0D19');
      expect(html).not.toContain('#2D355A');
      expect(html).not.toContain('#252B48');
      expect(html).not.toContain('indigo-');
      expect(html).not.toContain('slate-');
      expect(html).not.toContain('emerald-');
      expect(html).not.toContain('purple-');
    });

    test('renders nothing when closed', () => {
      const html = renderToString(
        <ProjectModal
          isOpen={false}
          onClose={() => {}}
          project={project}
          onSaveProject={() => {}}
          onLoadTemplate={() => {}}
        />,
      );
      expect(html).toBe('');
    });
  });
  ```

- [ ] Run it and watch it go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/ProjectModal.test.tsx
  ```
  Expected: failures. The first is `SyntaxError: Export named 'projectFileName' not found in module '.../src/components/ProjectModal.tsx'` because the helper does not exist yet.

- [ ] Extract the pure filename helper. In `ProjectModal.tsx`, insert this function immediately after the `ProjectModalProps` interface (currently ends at line 11) and before `export const ProjectModal` (line 13):
  ```tsx
  /** Download filename for the JSON project export. Pure: no DOM, unit-testable. */
  export function projectFileName(title: string): string {
    return `${title.replace(/\s+/g, '_')}_solva_project.json`;
  }
  ```

- [ ] Rewire the export handler to use it. Replace line 36:
  ```tsx
  //  before
  downloadAnchor.setAttribute('download', `${title.replace(/\s+/g, '_')}_musibox_project.json`);
  //  after
  downloadAnchor.setAttribute('download', projectFileName(title));
  ```

- [ ] Re-run just the filename tests — they should now pass while the theming test still fails:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/ProjectModal.test.tsx -t projectFileName
  ```
  Expected: `2 pass`.

- [ ] Replace the outer wrapper + modal shell. Lines 44-46 currently read:
  ```tsx
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#12152A] border border-[#2D355A] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
  ```
  Change to:
  ```tsx
  return (
    <dialog className="modal modal-open" aria-label="Project Management and Export">
      <div className="modal-box bg-base-100 border border-base-300 p-0 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
  ```
  The `p-0` is required: `modal-box` ships its own padding, but this modal has a full-bleed header strip that must touch the box edges.

- [ ] Replace the closing tags. Lines 152-155 currently read:
  ```tsx
        </div>
      </div>
    </div>
  );
  ```
  Change to (the backdrop becomes a real sibling `<form>`, which is how daisyUI renders a click-to-dismiss scrim):
  ```tsx
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
  ```

- [ ] Tokenize the modal header strip. Lines 48-56:
  ```tsx
  //  before
  <div className="bg-[#0B0D19] p-4 border-b border-[#252B48] flex items-center justify-between">
    <div className="flex items-center gap-2.5">
      <div className="p-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
        <FolderOpen className="w-5 h-5" />
      </div>
      <div>
        <h3 className="font-bold text-base text-slate-100">Project Management &amp; Export</h3>
        <p className="text-xs text-slate-400">Save your session, load templates, and export audio/MIDI</p>
  //  after
  <div className="bg-base-200 p-4 border-b border-base-300 flex items-center justify-between">
    <div className="flex items-center gap-2.5">
      <div className="p-2 rounded-xl bg-primary/20 border border-primary/30 text-primary">
        <FolderOpen className="w-5 h-5" />
      </div>
      <div>
        <h3 className="font-bold text-base text-base-content">Project Management &amp; Export</h3>
        <p className="text-xs text-base-content/60">Save your session, load templates, and export audio/MIDI</p>
  ```

- [ ] Tokenize the close button. Lines 59-65:
  ```tsx
  //  before
  <button
    id="btn-close-project-modal"
    onClick={onClose}
    className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
  >
  //  after
  <button
    id="btn-close-project-modal"
    onClick={onClose}
    className="btn btn-sm btn-circle btn-ghost"
  >
  ```

- [ ] Tokenize the Project Title card. Lines 71-82:
  ```tsx
  //  before
  <div className="bg-[#0B0D19] border border-[#252B48] rounded-xl p-4 space-y-3">
    <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block">
      Project Title
    </label>
    <div className="flex gap-2">
      <input
        id="input-project-title"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="flex-1 bg-[#12152A] border border-[#2D355A] text-slate-100 text-xs rounded-lg p-2.5 focus:outline-none focus:border-indigo-500"
      />
  //  after
  <div className="card bg-base-200 border border-base-300 p-4 space-y-3">
    <label className="text-xs font-bold text-base-content uppercase tracking-wider block">
      Project Title
    </label>
    <div className="flex gap-2">
      <input
        id="input-project-title"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="input input-sm input-bordered w-full flex-1 text-xs"
      />
  ```

- [ ] Tokenize the Save button. Lines 83-90:
  ```tsx
  //  before
  <button
    id="btn-save-project-action"
    onClick={handleSave}
    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition-all cursor-pointer shadow-md"
  >
    {saved ? <Check className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
  //  after
  <button
    id="btn-save-project-action"
    onClick={handleSave}
    className="btn btn-sm btn-primary gap-1.5 text-xs"
  >
    {saved ? <Check className="w-4 h-4 text-success" /> : <Save className="w-4 h-4" />}
  ```

- [ ] Tokenize the Templates card. Lines 95-99:
  ```tsx
  //  before
  <div className="bg-[#0B0D19] border border-[#252B48] rounded-xl p-4 space-y-2.5">
    <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
  //  after
  <div className="card bg-base-200 border border-base-300 p-4 space-y-2.5">
    <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
      <Sparkles className="w-3.5 h-3.5 text-secondary" />
  ```

- [ ] Tokenize each template tile. Lines 115-118:
  ```tsx
  //  before
  className="p-2.5 rounded-lg bg-[#12152A] hover:bg-[#1C213E] border border-[#252B48] text-left transition-all cursor-pointer"
  >
    <div className="text-xs font-bold text-slate-200">{t.name}</div>
    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{t.bpm} BPM • {t.key}</div>
  //  after
  className="btn btn-ghost h-auto justify-start bg-base-100 border-base-300 hover:bg-base-300 p-2.5 text-left normal-case"
  >
    <div>
      <div className="text-xs font-bold text-base-content">{t.name}</div>
      <div className="text-[10px] text-base-content/60 font-mono mt-0.5">{t.bpm} BPM • {t.key}</div>
    </div>
  ```
  (The extra wrapping `<div>` is needed because `btn` sets `flex-direction: row`; without it the two lines sit side by side. Remember to close it before `</button>` on line 119.)

- [ ] Tokenize the Export card and turn its button row into `modal-action`. Lines 125-130:
  ```tsx
  //  before
  <div className="bg-[#0B0D19] border border-[#252B48] rounded-xl p-4 space-y-2">
    <span className="text-xs font-bold text-slate-200 uppercase tracking-wider block">
      Export Track Stems &amp; Data
    </span>

    <div className="grid grid-cols-2 gap-2">
  //  after
  <div className="card bg-base-200 border border-base-300 p-4 space-y-2">
    <span className="text-xs font-bold text-base-content uppercase tracking-wider block">
      Export Track Stems &amp; Data
    </span>

    <div className="modal-action mt-0 grid grid-cols-2 gap-2">
  ```

- [ ] Tokenize the two export buttons. Lines 131-149:
  ```tsx
  //  before
  <button
    id="btn-export-json"
    onClick={handleExportJSON}
    className="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-[#12152A] hover:bg-[#1C213E] border border-[#252B48] text-slate-200 text-xs font-semibold transition-all cursor-pointer"
  >
    <FileText className="w-4 h-4 text-indigo-400" />
    <span>{exported ? 'Exported JSON!' : 'Export JSON'}</span>
  </button>

  <button
    id="btn-export-stems"
    onClick={() => {
      alert('Audio Stems mixdown generated! Exporting project package...');
    }}
    className="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-[#12152A] hover:bg-[#1C213E] border border-[#252B48] text-slate-200 text-xs font-semibold transition-all cursor-pointer"
  >
    <Download className="w-4 h-4 text-emerald-400" />
  //  after
  <button
    id="btn-export-json"
    onClick={handleExportJSON}
    className="btn btn-sm btn-outline gap-2 text-xs"
  >
    <FileText className="w-4 h-4 text-primary" />
    <span>{exported ? 'Exported JSON!' : 'Export JSON'}</span>
  </button>

  <button
    id="btn-export-stems"
    onClick={() => {
      alert('Audio Stems mixdown generated! Exporting project package...');
    }}
    className="btn btn-sm btn-outline gap-2 text-xs"
  >
    <Download className="w-4 h-4 text-success" />
  ```
  The `alert(...)` line is untouched — mixdown stays a stub, per the scope note above.

- [ ] Run the component tests — GREEN:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/ProjectModal.test.tsx
  ```
  Expected: `4 pass  0 fail`.

- [ ] Run the guard — GREEN:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: `1 pass  0 fail`, no mention of `ProjectModal.tsx`.

- [ ] Typecheck and lint:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run lint && bun run eslint
  ```
  Expected: no output from `tsc --noEmit`, and `eslint .` exits 0.

- [ ] Commit:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
  refactor(ui): move ProjectModal onto daisyUI modal + semantic tokens

  Rewrite the project modal as <dialog class="modal modal-open"> with
  modal-box / modal-backdrop / modal-action, replacing the hand-rolled
  fixed-inset scrim. Every murva hex (#12152A, #0B0D19, #2D355A, #252B48,
  #1C213E) and every palette class (indigo/slate/emerald/purple, text-white)
  becomes a base/primary/secondary/success token, so the modal is legible
  under solva-light.

  Also extract projectFileName() and fix the stale export suffix: exports are
  now named *_solva_project.json instead of *_musibox_project.json.

  Export Mixdown remains an alert() stub; real stem rendering is tracked
  separately and is out of scope for the theme migration.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

## Task 10: Finish the app shell — `Header.tsx`, `InstantVibesBar.tsx`, `TransportBar.tsx`, `App.tsx`

These four files are the closest to compliant already: their surfaces are on `bg-base-100` / `bg-base-200` / `border-base-300` / `text-base-content`. What remains is (a) a handful of leftover raw palette accents in `Header.tsx`, (b) hand-rolled buttons/tabs/selects that should be daisyUI components, (c) two real bugs — a `xs:` breakpoint that does not exist, and dead `animate-in fade-in` classes from a plugin that is not installed — and (d) a theme-rehydration `useEffect` that now races Task 1's `<head>` script.

**Files:**
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/Header.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/InstantVibesBar.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/TransportBar.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/App.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/index.css`
- Create: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/Header.test.tsx`
- Create: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/TransportBar.test.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/InstantVibesBar.test.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts` (remove four `ALLOWLIST` entries)

**Interfaces:**
- Consumes: `useAppStore` from `../store/store`; `ROOTS` / `SCALES` from `../utils/musicTheory`; `INSTANT_VIBES` / `applyInstantVibeToStore` from `../store/instantVibes`; `Slider` from `./ui/Slider` (Task 3 already defaults it to `'range range-primary range-xs w-full'`); the `<head>` theme bootstrap script added to `index.html` by Task 1; the `success`/`warning`/`error` tokens added to both themes by Task 1.
- Produces: `export function resolveInitialTheme(stored: string | null, prefersLight: boolean): 'solva-dark' | 'solva-light'` in `Header.tsx` — pure, DOM-free, consumed by `Header.tsx`'s lazy `useState` initializer, by its rehydration `useEffect`, and by `src/components/Header.test.tsx`. Produces the CSS class `.ambient-wash` in `src/index.css`, consumed by `App.tsx`. Produces the CSS utility `.animate-fade-in` in `src/index.css`, consumed by `InstantVibesBar.tsx`.
- Does NOT produce: any change to `AudioVisualizer`'s `colorTheme` prop union (see the App.tsx note below).

### Scope note — `App.tsx:88` is Task 19's, not this task's

`src/App.tsx:88` passes `colorTheme="indigo"` to `<AudioVisualizer>`. `indigo` is not part of the Solva palette, but the prop's type is declared at `src/components/AudioVisualizer.tsx:12` as `colorTheme?: 'indigo' | 'emerald' | 'amber' | 'cyberpunk'` and the canvas renderers at `AudioVisualizer.tsx:99/101/103/106` switch on those literals. **Do not touch `App.tsx:88` in this task.** Changing the call site before the union and the renderers are updated makes `bun run lint` fail with `Type '"primary"' is not assignable to type '"indigo" | "emerald" | "amber" | "cyberpunk"'`. Task 19 renames the union to `'primary' | 'secondary' | 'accent'`, rewrites the renderers to read the CSS custom properties, and updates both call sites (`App.tsx:88` and `TransportBar.tsx:183`, which currently passes `"amber"`). The same applies to `TransportBar.tsx:183` — leave it alone here.

### Steps — part 1: the theme-resolution helper (Header)

- [ ] Create `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/Header.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { resolveInitialTheme } from './Header';

  describe('resolveInitialTheme', () => {
    test('a stored theme always wins over the OS preference', () => {
      expect(resolveInitialTheme('solva-light', false)).toBe('solva-light');
      expect(resolveInitialTheme('solva-dark', true)).toBe('solva-dark');
    });

    test('first visit follows the OS preference', () => {
      expect(resolveInitialTheme(null, true)).toBe('solva-light');
      expect(resolveInitialTheme(null, false)).toBe('solva-dark');
    });

    test('a corrupt or legacy stored value falls back to the OS preference', () => {
      expect(resolveInitialTheme('murva-dark', true)).toBe('solva-light');
      expect(resolveInitialTheme('', false)).toBe('solva-dark');
      expect(resolveInitialTheme('null', false)).toBe('solva-dark');
    });
  });
  ```

- [ ] Watch it go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/Header.test.tsx
  ```
  Expected: `SyntaxError: Export named 'resolveInitialTheme' not found in module '.../src/components/Header.tsx'`.

- [ ] Add the helper to `Header.tsx`. Insert immediately after the `MASTER_TABS` const (currently ends at line 39) and before `export const Header` (line 41):
  ```tsx
  export type SolvaTheme = 'solva-dark' | 'solva-light';

  const THEME_STORAGE_KEY = 'solva_theme';

  /**
   * Pure theme resolution — no DOM, no localStorage access, unit-testable.
   * Mirrors exactly what the bootstrap <script> in index.html does, so the two
   * can never disagree.
   */
  export function resolveInitialTheme(stored: string | null, prefersLight: boolean): SolvaTheme {
    if (stored === 'solva-dark' || stored === 'solva-light') return stored;
    return prefersLight ? 'solva-light' : 'solva-dark';
  }
  ```

- [ ] Run it GREEN:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/Header.test.tsx
  ```
  Expected: `3 pass  0 fail`.

- [ ] Make the component's state and rehydration idempotent with Task 1's `<head>` script. Replace lines 53-70 of `Header.tsx`:
  ```tsx
  //  before
  const [currentTheme, setCurrentTheme] = React.useState<"solva-dark" | "solva-light">(() => {
    return (document.documentElement.getAttribute("data-theme") as "solva-dark" | "solva-light") || "solva-dark";
  });

  const toggleTheme = () => {
    const next = currentTheme === "solva-dark" ? "solva-light" : "solva-dark";
    setCurrentTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("solva_theme", next);
  };

  React.useEffect(() => {
    const saved = localStorage.getItem("solva_theme") as "solva-dark" | "solva-light";
    if (saved) {
      setCurrentTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);
  ```
  ```tsx
  //  after
  const [currentTheme, setCurrentTheme] = React.useState<SolvaTheme>(() =>
    resolveInitialTheme(
      document.documentElement.getAttribute("data-theme"),
      typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: light)").matches,
    ),
  );

  const toggleTheme = () => {
    const next: SolvaTheme = currentTheme === "solva-dark" ? "solva-light" : "solva-dark";
    setCurrentTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  };

  // The <head> bootstrap script in index.html has already resolved and applied
  // the theme before React mounted (that's what prevents the FOUC). This effect
  // only re-syncs when the DOM and React state disagree — e.g. another tab wrote
  // localStorage, or the OS preference flipped on a first visit with no stored
  // value. It never clobbers an attribute that already matches.
  React.useEffect(() => {
    const resolved = resolveInitialTheme(
      localStorage.getItem(THEME_STORAGE_KEY),
      window.matchMedia("(prefers-color-scheme: light)").matches,
    );
    if (document.documentElement.getAttribute("data-theme") !== resolved) {
      document.documentElement.setAttribute("data-theme", resolved);
    }
    setCurrentTheme((prev) => (prev === resolved ? prev : resolved));
  }, []);
  ```
  Note the `setCurrentTheme((prev) => ...)` guard: returning `prev` unchanged means React bails out of the re-render entirely, so in the common case (script and React agree) the effect is a no-op.

### Steps — part 2: Header markup

- [ ] Delete `'src/components/Header.tsx'` from the `ALLOWLIST` array in `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts`, then watch the guard go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: `1 fail`, listing `src/components/Header.tsx` with `palette-color` hits for `from-amber-500`, `to-rose-500`, `shadow-amber-500/20`, `bg-emerald-400`, `bg-emerald-500`, `text-amber-400`, `text-amber-600` and an `absolute-bw` hit for `text-white`.

- [ ] Make the header a daisyUI `navbar` (design.md §4 item 1 describes it as the top navigation bar). Replace line 73:
  ```tsx
  //  before
  <header className="bg-base-100 border-b border-base-300 px-3 py-2 flex items-center justify-between gap-2 text-sm select-none sticky top-0 z-40">
  //  after
  <header className="navbar min-h-0 bg-base-100 border-b border-base-300 px-3 py-2 flex items-center justify-between gap-2 text-sm select-none sticky top-0 z-40">
  ```
  `min-h-0` is required — daisyUI's `navbar` sets `min-height: 4rem`, which would nearly double the current 44px bar.

- [ ] Tokenize the brand mark. Lines 76-77:
  ```tsx
  //  before
  <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center shadow-md shadow-amber-500/20">
    <Radio className="w-3.5 h-3.5 text-white" />
  //  after
  <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-primary to-secondary flex items-center justify-center shadow-md shadow-primary/20">
    <Radio className="w-3.5 h-3.5 text-primary-content" />
  ```

- [ ] Convert the primary nav to daisyUI tabs. Replace line 91 and lines 110-131:
  ```tsx
  //  before  (line 91)
  <div className="flex items-center p-0.5 rounded-lg bg-base-200 border border-base-300 overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar gap-0.5 shrink-0">
  //  after
  <div role="tablist" className="tabs tabs-box tabs-xs bg-base-200 border border-base-300 p-0.5 overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar gap-0.5 shrink-0">
  ```
  ```tsx
  //  before  (lines 110-118)
  <button
    key={tab.view}
    id={`tab-${tab.view}`}
    onClick={() => setActiveTab(tab.view)}
    className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap relative ${
      activeTab === tab.view
        ? "bg-primary text-primary-content shadow-xs"
        : "text-base-content/70 hover:text-base-content hover:bg-base-300/60"
    }`}
  >
  //  after
  <button
    key={tab.view}
    id={`tab-${tab.view}`}
    role="tab"
    onClick={() => setActiveTab(tab.view)}
    className={`tab gap-1 text-xs font-semibold whitespace-nowrap relative ${
      activeTab === tab.view ? "tab-active" : ""
    }`}
  >
  ```

- [ ] Tokenize the "playing" ping dot. Lines 127-128:
  ```tsx
  //  before
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
  //  after
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
  ```

- [ ] Convert the Master FX tab group identically. Replace line 136 and lines 139-147:
  ```tsx
  //  before  (line 136)
  <div className="flex items-center p-0.5 rounded-lg bg-base-200 border border-base-300 overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar gap-0.5 shrink-0">
  //  after
  <div role="tablist" className="tabs tabs-box tabs-xs bg-base-200 border border-base-300 p-0.5 overflow-x-auto max-w-[50vw] sm:max-w-none no-scrollbar gap-0.5 shrink-0">
  ```
  ```tsx
  //  before  (lines 139-147)
  <button
    key={tab.view}
    id={`tab-${tab.view}`}
    onClick={() => setActiveTab(tab.view)}
    className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer whitespace-nowrap relative ${
      activeTab === tab.view
        ? "bg-primary text-primary-content shadow-xs"
        : "text-base-content/70 hover:text-base-content hover:bg-base-300/60"
    }`}
  >
  //  after
  <button
    key={tab.view}
    id={`tab-${tab.view}`}
    role="tab"
    onClick={() => setActiveTab(tab.view)}
    className={`tab gap-1 text-xs font-semibold whitespace-nowrap relative ${
      activeTab === tab.view ? "tab-active" : ""
    }`}
  >
  ```

- [ ] Convert both scale `<select>`s to daisyUI selects and delete the now-redundant per-`<option>` overrides. Lines 161-186:
  ```tsx
  //  before
  <select
    id="select-master-scale-root"
    value={scaleRoot}
    onChange={(e) => setScaleRoot(e.target.value)}
    className="bg-transparent text-xs font-bold text-primary focus:outline-none cursor-pointer"
    title="Root Note"
  >
    {ROOTS.map((r) => (
      <option key={r} value={r} className="bg-base-100 text-base-content">
        {r}
      </option>
    ))}
  </select>
  <select
    id="select-master-scale-type"
    value={scaleType}
    onChange={(e) => setScaleType(e.target.value)}
    className="bg-transparent text-xs font-bold text-base-content/80 focus:outline-none cursor-pointer max-w-[90px] truncate"
    title="Scale Type"
  >
    {Object.keys(SCALES).map((s) => (
      <option key={s} value={s} className="bg-base-100 text-base-content">
        {SCALES[s].name}
      </option>
    ))}
  </select>
  //  after
  <select
    id="select-master-scale-root"
    value={scaleRoot}
    onChange={(e) => setScaleRoot(e.target.value)}
    className="select select-xs select-ghost font-bold text-primary"
    title="Root Note"
  >
    {ROOTS.map((r) => (
      <option key={r} value={r}>
        {r}
      </option>
    ))}
  </select>
  <select
    id="select-master-scale-type"
    value={scaleType}
    onChange={(e) => setScaleType(e.target.value)}
    className="select select-xs select-ghost font-bold text-base-content/80 max-w-[90px]"
    title="Scale Type"
  >
    {Object.keys(SCALES).map((s) => (
      <option key={s} value={s}>
        {SCALES[s].name}
      </option>
    ))}
  </select>
  ```
  The `bg-base-100 text-base-content` overrides on each `<option>` existed only because the parent used `bg-transparent`, which on some browsers made the native dropdown list inherit a transparent background. `select-ghost` sets a real background on the control, so the overrides are dead weight — delete them.

- [ ] Convert the Projects button. Lines 190-198:
  ```tsx
  //  before
  <button
    id="btn-open-projects"
    onClick={openProjectsModal}
    className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg bg-base-200 border border-base-300 text-base-content hover:bg-base-300 transition-colors cursor-pointer text-xs font-medium"
    title="Projects (Save / Export)"
  >
  //  after
  <button
    id="btn-open-projects"
    onClick={openProjectsModal}
    className="btn btn-sm btn-ghost gap-1 text-xs font-medium"
    title="Projects (Save / Export)"
  >
  ```

- [ ] Convert the theme toggle and tokenize its icons. Lines 201-212:
  ```tsx
  //  before
  <button
    id="btn-toggle-theme"
    onClick={toggleTheme}
    className="flex items-center justify-center p-1.5 rounded-lg bg-base-200 border border-base-300 text-base-content hover:bg-base-300 transition-colors cursor-pointer"
    title={`Switch to ${currentTheme === 'solva-dark' ? 'Light' : 'Dark'} Theme`}
  >
    {currentTheme === 'solva-dark' ? (
      <Sun className="w-4 h-4 text-amber-400" />
    ) : (
      <Moon className="w-4 h-4 text-amber-600" />
    )}
  </button>
  //  after
  <button
    id="btn-toggle-theme"
    onClick={toggleTheme}
    className="btn btn-sm btn-square btn-ghost"
    title={`Switch to ${currentTheme === 'solva-dark' ? 'Light' : 'Dark'} Theme`}
  >
    {currentTheme === 'solva-dark' ? (
      <Sun className="w-4 h-4 text-primary" />
    ) : (
      <Moon className="w-4 h-4 text-primary" />
    )}
  </button>
  ```
  Both arms are now `text-primary`: `primary` already resolves to `#F59E0B` under `solva-dark` and the darker `#D97706` under `solva-light`, so the token reproduces the old amber-400/amber-600 pair automatically.

- [ ] Guard GREEN for Header:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: `1 pass  0 fail`, no `Header.tsx` in the output.

### Steps — part 3: TransportBar, including the real `xs:inline` bug

- [ ] Create `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/TransportBar.test.tsx` with a failing test for the phantom breakpoint:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { TransportBar } from './TransportBar';

  describe('TransportBar', () => {
    test('the BPM label uses a real Tailwind breakpoint, not the phantom xs:', () => {
      const html = renderToString(<TransportBar />);

      // `xs` is not a Tailwind v4 default breakpoint and this repo has no
      // tailwind.config, so `xs:inline` never generates a rule and the label
      // stays display:none at every viewport width.
      expect(html).not.toContain('xs:inline');
      expect(html).toContain('sm:inline');
    });

    test('transport controls are daisyUI buttons on semantic tokens', () => {
      const html = renderToString(<TransportBar />);

      expect(html).toContain('btn btn-sm btn-success');
      expect(html).toContain('btn btn-sm btn-primary');
      expect(html).toContain('input input-xs input-ghost');
      expect(html).toContain('range range-xs range-primary');
    });
  });
  ```

- [ ] Watch it go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/TransportBar.test.tsx
  ```
  Expected: `2 fail`. The first fails on `expect(html).not.toContain('xs:inline')` — the rendered markup contains `hidden xs:inline` from line 134.

- [ ] Fix the breakpoint bug. Line 134:
  ```tsx
  //  before
  <span className="text-[10px] text-base-content/50 font-mono hidden xs:inline">BPM</span>
  //  after
  <span className="text-[10px] text-base-content/50 font-mono hidden sm:inline">BPM</span>
  ```
  Note for later: `src/components/SynthView.tsx:377` carries the identical `hidden xs:inline` bug on its octave label. **Do not fix it here** — `SynthView.tsx` is Task 18's file and touching it now creates a merge conflict with that task's much larger rewrite.

- [ ] Convert the Play All button. Lines 92-99:
  ```tsx
  //  before
  <button
    id="btn-bottom-play-all"
    onClick={onTogglePlayAll}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer shadow-xs ${
      isPlayingAll
        ? "bg-warning text-warning-content shadow-warning/20"
        : "bg-success text-success-content shadow-success/20"
    }`}
    title="Play/Stop All"
  >
  //  after
  <button
    id="btn-bottom-play-all"
    onClick={onTogglePlayAll}
    className={`btn btn-sm gap-1.5 font-bold text-xs ${
      isPlayingAll ? "btn-warning" : "btn-success"
    }`}
    title="Play/Stop All"
  >
  ```

- [ ] Convert the tab-specific Play button and drop the manual disabled styling. Lines 111-121:
  ```tsx
  //  before
  <button
    id="btn-bottom-play"
    onClick={onTogglePlay}
    disabled={isPlayDisabled}
    className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
      isPlayDisabled
        ? "bg-base-300/50 text-base-content/40 border border-base-300 cursor-not-allowed opacity-50"
        : isPlaying
          ? "bg-warning text-warning-content shadow-xs"
          : "bg-primary text-primary-content shadow-xs"
    }`}
    title={`Play/Stop ${currentTabLabel}`}
  >
  //  after
  <button
    id="btn-bottom-play"
    onClick={onTogglePlay}
    disabled={isPlayDisabled}
    className={`btn btn-sm gap-1.5 font-bold text-xs ${
      isPlaying ? "btn-warning" : "btn-primary"
    }`}
    title={`Play/Stop ${currentTabLabel}`}
  >
  ```
  The entire `isPlayDisabled ? "bg-base-300/50 text-base-content/40 border border-base-300 cursor-not-allowed opacity-50"` branch is deleted: daisyUI's `.btn:disabled` already applies a muted `base-200` fill, `base-content/20` text and `cursor: not-allowed`, and the `disabled={isPlayDisabled}` attribute stays, so behaviour is unchanged.

- [ ] Convert the two BPM nudge buttons and the number input. Lines 135-157:
  ```tsx
  //  before
  <button
    onClick={() => setBpm(Math.max(40, bpm - 1))}
    className="p-0.5 text-base-content/70 hover:text-base-content rounded hover:bg-base-300 cursor-pointer"
    title="Decrease BPM"
  >
    <Minus className="w-3 h-3" />
  </button>
  <input
    id="input-transport-bpm"
    type="number"
    min={40}
    max={240}
    value={bpm}
    onChange={(e) => setBpm(Number(e.target.value))}
    className="w-8 bg-transparent text-center font-mono font-bold text-primary focus:outline-none focus:text-base-content text-xs"
  />
  <button
    onClick={() => setBpm(Math.min(240, bpm + 1))}
    className="p-0.5 text-base-content/70 hover:text-base-content rounded hover:bg-base-300 cursor-pointer"
    title="Increase BPM"
  >
    <Plus className="w-3 h-3" />
  </button>
  //  after
  <button
    onClick={() => setBpm(Math.max(40, bpm - 1))}
    className="btn btn-xs btn-square btn-ghost"
    title="Decrease BPM"
  >
    <Minus className="w-3 h-3" />
  </button>
  <input
    id="input-transport-bpm"
    type="number"
    min={40}
    max={240}
    value={bpm}
    onChange={(e) => setBpm(Number(e.target.value))}
    className="input input-xs input-ghost w-12 px-0 text-center font-mono font-bold text-primary text-xs"
  />
  <button
    onClick={() => setBpm(Math.min(240, bpm + 1))}
    className="btn btn-xs btn-square btn-ghost"
    title="Increase BPM"
  >
    <Plus className="w-3 h-3" />
  </button>
  ```
  The width goes `w-8` → `w-12 px-0` because `input-xs` adds horizontal padding that would clip a three-digit BPM like `240`. `font-mono` stays — per docs/design.md §3 every numeric readout is monospaced.

- [ ] Convert the metronome toggle. Lines 161-168:
  ```tsx
  //  before
  <button
    id="btn-transport-metronome"
    onClick={handleToggleMetronome}
    className={`flex items-center gap-1 p-1.5 sm:px-2 sm:py-1 rounded-lg border text-xs cursor-pointer transition-colors ${
      metronomeActive
        ? "bg-primary border-primary text-primary-content shadow-xs"
        : "bg-base-200 border-base-300 text-base-content/70 hover:text-base-content"
    }`}
    title="Metronome"
  >
  //  after
  <button
    id="btn-transport-metronome"
    onClick={handleToggleMetronome}
    className={`btn btn-sm gap-1 text-xs ${
      metronomeActive ? "btn-primary" : "btn-ghost"
    }`}
    title="Metronome"
  >
  ```

- [ ] Convert the visualizer-mode cycle button. Lines 186-192:
  ```tsx
  //  before
  className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-base-300/90 text-base-content hover:text-base-content px-1 py-0.5 rounded text-[9px] flex items-center gap-0.5 border border-base-300 cursor-pointer"
  //  after
  className="btn btn-xs btn-square btn-ghost absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
  ```

- [ ] Fix the master fader className, which omits the `range` base class entirely so daisyUI never styles it. Line 238:
  ```tsx
  //  before
  className="w-14 sm:w-16 h-1.5 bg-base-300 rounded cursor-pointer accent-primary"
  //  after
  className="range range-xs range-primary w-14 sm:w-16"
  ```
  `bg-base-300`, `rounded`, `cursor-pointer` and `accent-primary` all become redundant: `range` paints its own track from `--range-bg`, `range-primary` sets the thumb colour, and daisyUI sets `cursor: pointer` on the control. (The global `input[type="range"] { accent-color: ... }` rule Task 1 tokenized in `src/index.css` still covers any range not carrying the `range` class.)

- [ ] Run the TransportBar tests GREEN:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/TransportBar.test.tsx
  ```
  Expected: `2 pass  0 fail`.

- [ ] Delete `'src/components/TransportBar.tsx'` from `ALLOWLIST` in `scripts/themeTokenGuard.ts` and confirm the guard passes:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: `1 pass  0 fail`. (`xs:inline` was an `invalid-utility` rule hit; it is now gone.)

### Steps — part 4: InstantVibesBar, including the dead `animate-in` classes

- [ ] Decide and record: `InstantVibesBar.tsx:72` uses `animate-in fade-in`. Those class names come from the `tailwindcss-animate` plugin, which is **not** in `package.json` (dependencies are `@dnd-kit/*`, `@tailwindcss/vite`, `daisyui`, `lucide-react`, `motion`, `react`, `react-dom`, `tailwindcss`, `tonal`, `zustand`) and is not registered via `@plugin` in `src/index.css`. The classes therefore generate no CSS and the toast appears instantly with no transition. **The chosen fix is to hand-write the animation in `src/index.css` as a real `@utility`, not to drop it** — the fade communicates that the toast is transient, and the plan adds no dependencies.

- [ ] Add the keyframes and utility at the very end of `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/index.css` (the file currently ends at line 73 with the `input[type="range"] { accent-color: ... }` block Task 1 tokenized):
  ```css
  /* Toast entry animation. Replaces the `animate-in fade-in` classes, which came
     from tailwindcss-animate — a plugin this project does not install. */
  @keyframes solva-fade-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @utility animate-fade-in {
    animation: solva-fade-in 180ms ease-out both;
  }

  /* Ambient background visualizer wash. The old flat `opacity-25` was tuned for
     the espresso backdrop and reads as a dirty smudge on solva-light's #F7F4EF
     paper, so the light theme gets a much weaker wash. */
  .ambient-wash {
    opacity: 0.25;
  }

  [data-theme="solva-light"] .ambient-wash {
    opacity: 0.07;
  }
  ```

- [ ] Append a theming test to the existing `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/InstantVibesBar.test.tsx` (which currently ends at line 36 with the closing `});` of the `selectVibe` describe block). Add these imports at the top, next to the existing ones:
  ```tsx
  import { renderToString } from 'react-dom/server';
  import { InstantVibesBar } from './InstantVibesBar';
  ```
  and append at the bottom:
  ```tsx
  describe('InstantVibesBar markup', () => {
    test('preset buttons are daisyUI buttons and the dead animate-in classes are gone', () => {
      const html = renderToString(<InstantVibesBar />);

      expect(html).toContain('btn btn-xs');
      expect(html).toContain('btn-primary');
      expect(html).toContain('btn-outline');
      expect(html).toContain('btn btn-xs btn-ghost btn-square');
      // tailwindcss-animate is not installed, so these class names generate no CSS.
      expect(html).not.toContain('animate-in');
      expect(html).not.toContain('fade-in ');
    });
  });
  ```

- [ ] Watch it go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/InstantVibesBar.test.tsx
  ```
  Expected: `2 pass  1 fail` — the new test fails on `expect(html).toContain('btn btn-xs')`.

- [ ] Convert the vibe preset buttons. Lines 47-57:
  ```tsx
  //  before
  <button
    key={vibe.id}
    id={`btn-vibe-${vibe.id}`}
    onClick={() => handleSelectVibe(vibe)}
    title={`${vibe.name} (${vibe.bpm} BPM · ${vibe.scaleRoot} ${vibe.scaleType})`}
    className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border cursor-pointer shrink-0 ${
      isSelected
        ? `bg-primary text-primary-content border-primary shadow-sm`
        : 'bg-base-200 border-base-300 text-base-content/80 hover:text-base-content hover:bg-base-300'
    }`}
  >
  //  after
  <button
    key={vibe.id}
    id={`btn-vibe-${vibe.id}`}
    onClick={() => handleSelectVibe(vibe)}
    title={`${vibe.name} (${vibe.bpm} BPM · ${vibe.scaleRoot} ${vibe.scaleType})`}
    className={`btn btn-xs group gap-1.5 font-semibold whitespace-nowrap shrink-0 normal-case ${
      isSelected ? 'btn-primary' : 'btn-outline'
    }`}
  >
  ```

- [ ] Convert the feedback toast. Lines 71-77:
  ```tsx
  //  before
  {feedbackToast && (
    <div className="flex items-center gap-1 bg-success/20 border border-success/40 text-success text-[10px] px-2 py-0.5 rounded-md animate-in fade-in">
      <Check className="w-3 h-3 text-success" />
      <span className="hidden md:inline">{feedbackToast}</span>
      <span className="md:hidden">Loaded</span>
    </div>
  )}
  //  after
  {feedbackToast && (
    <div className="toast toast-top toast-end animate-fade-in">
      <div className="alert alert-success alert-soft py-1 px-2 text-[10px] gap-1">
        <Check className="w-3 h-3" />
        <span className="hidden md:inline">{feedbackToast}</span>
        <span className="md:hidden">Loaded</span>
      </div>
    </div>
  )}
  ```
  `alert-success` already sets the icon and text colour from the `success` token, so the explicit `text-success` on the `<Check>` is dropped.

- [ ] Convert the collapse toggle. Lines 79-83:
  ```tsx
  //  before
  <button
    onClick={() => setIsCollapsed(!isCollapsed)}
    className="p-1 rounded text-base-content/70 hover:text-base-content hover:bg-base-300 transition-colors cursor-pointer"
    title={isCollapsed ? 'Show Vibes' : 'Hide Vibes'}
  >
  //  after
  <button
    onClick={() => setIsCollapsed(!isCollapsed)}
    className="btn btn-xs btn-ghost btn-square"
    title={isCollapsed ? 'Show Vibes' : 'Hide Vibes'}
  >
  ```

- [ ] Run GREEN:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/InstantVibesBar.test.tsx
  ```
  Expected: `3 pass  0 fail`.

- [ ] Delete `'src/components/InstantVibesBar.tsx'` from `ALLOWLIST` in `scripts/themeTokenGuard.ts` and re-run:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: `1 pass  0 fail`.

### Steps — part 5: App.tsx ambient wash

- [ ] Make the ambient visualizer wash theme-aware. Line 83 of `src/App.tsx`:
  ```tsx
  //  before
  <div className="absolute inset-0 pointer-events-none z-0 opacity-25 overflow-hidden">
  //  after
  <div className="ambient-wash absolute inset-0 pointer-events-none z-0 overflow-hidden">
  ```
  `.ambient-wash` was defined in `src/index.css` earlier in this task: 25% opacity under `solva-dark` (identical to today's look) and 7% under `solva-light`, where the dark waveform over `#F7F4EF` paper otherwise reads as a grey smudge across the whole workspace.

- [ ] Confirm `App.tsx:88` still reads `colorTheme="indigo"` and `TransportBar.tsx:183` still reads `colorTheme="amber"`. Both are intentionally untouched — Task 19 changes the prop union and both call sites together:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -n 'colorTheme' src/App.tsx src/components/TransportBar.tsx
  ```
  Expected output:
  ```
  src/App.tsx:88:          colorTheme="indigo"
  src/components/TransportBar.tsx:183:            colorTheme="amber"
  ```

- [ ] Delete `'src/App.tsx'` from `ALLOWLIST` in `scripts/themeTokenGuard.ts`. Run the guard:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: `1 pass  0 fail`. (`colorTheme="indigo"` is a JSX string prop value, not a `class`/`className` token — the guard's `palette-color` rule matches class-attribute contents only, so it does not fire here. If it *does* fire on your build of the guard, put `'src/App.tsx'` back in `ALLOWLIST` with the comment `// removed in Task 19 with the AudioVisualizer colorTheme union` and move on; Task 19 removes it for good.)

- [ ] Full suite, typecheck, lint:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test && bun run lint && bun run eslint
  ```
  Expected: all tests pass, `tsc --noEmit` prints nothing, `eslint .` exits 0.

- [ ] Commit:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
  refactor(ui): finish the app shell on daisyUI components and tokens

  Header: navbar + tabs tabs-box + select-ghost + btn variants; the brand
  gradient, the "playing" ping dot and the theme-toggle icons move from
  amber/rose/emerald palette classes onto primary/secondary/success.

  Theme resolution is extracted as the pure resolveInitialTheme(stored,
  prefersLight) helper, mirroring the index.html bootstrap script so the two
  can't disagree. The rehydration effect is now idempotent — it only writes
  data-theme when the DOM and React state differ — and first visits fall back
  to matchMedia('(prefers-color-scheme: light)').

  TransportBar: btn/input/range components; the disabled Play styling is
  handed to .btn:disabled. Fixes a real bug — the BPM label used `xs:inline`,
  a breakpoint Tailwind v4 does not define and no config adds, so the label
  was permanently hidden. Now `sm:inline`. The master fader was missing the
  `range` base class entirely and so was never styled by daisyUI.

  InstantVibesBar: btn/toast/alert; `animate-in fade-in` came from
  tailwindcss-animate, which is not installed, so it is replaced by a
  hand-written @keyframes + @utility in index.css.

  App: the flat opacity-25 ambient wash becomes the theme-aware .ambient-wash
  class (25% dark, 7% light) so the visualizer stops smudging the light paper.

  AudioVisualizer's colorTheme prop is deliberately untouched at both call
  sites; its union changes in a later task.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

## Task 11: Tokenize `src/components/SimpleSynthPanel.tsx` and `src/components/EffectsRackView.tsx`

Both files are *partially* migrated: every surface already uses `bg-base-100` / `bg-base-200` / `border-base-300` / `text-base-content`. What is left is the accent layer — amber/cyan/pink/emerald/purple/indigo literals — plus a genuinely dangerous pattern: `dark:` variants.

**The `dark:` problem, precisely.** Tailwind's `dark:` variant keys off either the OS `prefers-color-scheme` or a `.dark` class on `<html>`. Solva does neither: it switches themes by setting `data-theme="solva-light"` on `<html>` (see `index.html:2` and `Header.tsx`'s `toggleTheme`). So a user on a dark-mode OS who picks `solva-light` gets light `base-100` cards with `dark:text-amber-300`, `dark:text-purple-300`, `dark:text-cyan-300` labels still active — pale text on white. The fix is not to rewrite the variant; it is to **delete every `dark:` variant in both files**, because the semantic token underneath (`text-primary`, `text-accent`, …) already resolves per theme via the `@plugin "daisyui/theme"` blocks in `src/index.css`.

**Files:**
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/SimpleSynthPanel.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/EffectsRackView.tsx`
- Create: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/SimpleSynthPanel.test.tsx`
- Create: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/EffectsRackView.test.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts` (remove two `ALLOWLIST` entries)

**Interfaces:**
- Consumes: `Knob` from `./ui/Knob` — Task 4 narrowed its `color` prop to the union `'text-primary' | 'text-secondary' | 'text-accent' | 'text-success' | 'text-error'`, so every `color=` value below must be one of exactly those five strings; `SynthParams` from `../types`; `MasterEffects` from `../types`; `useAppStore` from `../store/store`; the `success` token added by Task 1.
- Produces: no new exports. Both components keep their existing signatures — `SimpleSynthPanel: React.FC<{ params: SynthParams; onChangeParams: (p: SynthParams) => void }>` and `EffectsRackView: React.FC` — so `SynthView.tsx` and `App.tsx` need no changes.

### Colour assignment (decided, apply exactly)

| Module | old accent | new token |
|---|---|---|
| SimpleSynthPanel — Tone (brightness/cutoff) | `amber-400/500` | `primary` |
| SimpleSynthPanel — Space (release/tail) | `cyan-500/600/300` | `accent` |
| SimpleSynthPanel — Vibe (detune/movement) | `pink-500/600/300` | `secondary` |
| SimpleSynthPanel — Punch (sub/attack) | `emerald-500/600/300` | `success` |
| SimpleSynthPanel — Auto-Arp | `purple-500/600/300` | `accent` |
| EffectsRackView — rack header | `purple-600/500/400` | `primary` |
| EffectsRackView — Reverb | `cyan-500/600/300` | `accent` |
| EffectsRackView — Delay | `indigo-500/600/300` | `accent` |
| EffectsRackView — Distortion | `amber-500/600/300` | `primary` |
| EffectsRackView — EQ | `emerald-500/600/300` | `secondary` |

Distortion's amber maps to `primary` because amber *is* the primary token (`--color-primary: #F59E0B` in `solva-dark`, `#D97706` in `solva-light`) — never re-declare `amber-500` alongside it.

### Steps — SimpleSynthPanel

- [ ] Delete `'src/components/SimpleSynthPanel.tsx'` from the `ALLOWLIST` array in `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts`, then watch the guard go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: `1 fail` listing `src/components/SimpleSynthPanel.tsx` with `palette-color` hits (`text-amber-400`, `bg-amber-500/10`, `text-amber-500`, `text-cyan-500`, `bg-cyan-500/10`, `text-cyan-600`, `text-pink-500`, `bg-pink-500/10`, `text-pink-600`, `text-emerald-500`, `bg-emerald-500/10`, `text-emerald-600`, `border-purple-500/30`, `text-purple-600`, `text-purple-500`, `bg-purple-600`), `dark-variant` hits at lines 74, 106, 138, 170, 178, 204, 233, and `absolute-bw` hits for `text-white` at 192, 219, 244.

- [ ] Create `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/SimpleSynthPanel.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { SimpleSynthPanel } from './SimpleSynthPanel';
  import type { SynthParams } from '../types';

  const params = {
    filterCutoff: 4000,
    release: 0.3,
    detune: 10,
    subOscVolume: 0.2,
    attack: 0.02,
    sustain: 0.5,
    arpActive: true,
    arpRate: '16n',
    arpMode: 'up',
  } as unknown as SynthParams;

  describe('SimpleSynthPanel theming', () => {
    const html = renderToString(<SimpleSynthPanel params={params} onChangeParams={() => {}} />);

    test('macro cards use card/card-body and semantic accents', () => {
      expect(html).toContain('card bg-base-100');
      expect(html).toContain('card-body');
      expect(html).toContain('text-primary');
      expect(html).toContain('text-accent');
      expect(html).toContain('text-secondary');
      expect(html).toContain('text-success');
      expect(html).toContain('badge badge-sm');
    });

    test('arp controls are daisyUI join groups on the accent token', () => {
      expect(html).toContain('join');
      expect(html).toContain('btn join-item');
      expect(html).toContain('btn-accent');
      expect(html).toContain('text-accent-content');
    });

    test('no dark: variants survive — they key off the OS, not data-theme', () => {
      expect(html).not.toContain('dark:');
    });

    test('no raw palette colours or absolute white survive', () => {
      for (const legacy of ['amber-', 'cyan-', 'pink-', 'emerald-', 'purple-', 'text-white']) {
        expect(html).not.toContain(legacy);
      }
    });
  });
  ```

- [ ] Watch it go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/SimpleSynthPanel.test.tsx
  ```
  Expected: `4 fail` — the first assertion that trips is `expect(html).toContain('card bg-base-100')`.

- [ ] Convert the Tone macro card. Lines 54-77:
  ```tsx
  //  before
  <div className="bg-base-100 border border-base-300 rounded-xl p-3 flex flex-col items-center justify-between text-center shadow-md">
    <div className="flex items-center gap-1 text-xs font-bold text-base-content">
      <Sun className="w-3.5 h-3.5 text-amber-400" />
      <span>Tone</span>
    </div>

    <div className="my-1.5">
      <Knob
        id="simple-macro-tone"
        label=""
        color="text-amber-400"
  //  after
  <div className="card bg-base-100 border border-base-300 shadow-md">
    <div className="card-body p-3 flex flex-col items-center justify-between text-center">
      <div className="flex items-center gap-1 text-xs font-bold text-base-content">
        <Sun className="w-3.5 h-3.5 text-primary" />
        <span>Tone</span>
      </div>

      <div className="my-1.5">
        <Knob
          id="simple-macro-tone"
          label=""
          color="text-primary"
  ```
  …and its pill at line 74:
  ```tsx
  //  before
  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-300 border border-amber-500/20">
    {toneLabel}
  </span>
  //  after
  <span className="badge badge-sm badge-primary badge-soft text-[10px] font-semibold">
    {toneLabel}
  </span>
  ```
  Close the extra `card-body` div before the card's `</div>`.

- [ ] Convert the Space macro card identically, mapping cyan → `accent`. Lines 80-108:
  - line 80 `<div className="bg-base-100 border border-base-300 rounded-xl p-3 flex flex-col items-center justify-between text-center shadow-md">` → `<div className="card bg-base-100 border border-base-300 shadow-md">` + inner `<div className="card-body p-3 flex flex-col items-center justify-between text-center">`
  - line 82 `<Compass className="w-3.5 h-3.5 text-cyan-500" />` → `<Compass className="w-3.5 h-3.5 text-accent" />`
  - line 90 `color="text-cyan-500"` → `color="text-accent"`
  - line 106 `<span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 border border-cyan-500/20">` → `<span className="badge badge-sm badge-accent badge-soft text-[10px] font-semibold">`

- [ ] Convert the Vibe macro card, mapping pink → `secondary`. Lines 112-140:
  - line 112 → `card bg-base-100 border border-base-300 shadow-md` + inner `card-body p-3 flex flex-col items-center justify-between text-center`
  - line 114 `<Waves className="w-3.5 h-3.5 text-pink-500" />` → `text-secondary`
  - line 122 `color="text-pink-500"` → `color="text-secondary"`
  - line 138 `bg-pink-500/10 text-pink-600 dark:text-pink-300 border border-pink-500/20` pill → `badge badge-sm badge-secondary badge-soft text-[10px] font-semibold`

- [ ] Convert the Punch macro card, mapping emerald → `success`. Lines 144-172:
  - line 144 → `card bg-base-100 border border-base-300 shadow-md` + inner `card-body p-3 flex flex-col items-center justify-between text-center`
  - line 146 `<Flame className="w-3.5 h-3.5 text-emerald-500" />` → `text-success`
  - line 154 `color="text-emerald-500"` → `color="text-success"`
  - line 170 `bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20` pill → `badge badge-sm badge-success badge-soft text-[10px] font-semibold`

- [ ] Convert the Auto-Arp card shell and its ON/OFF toggle. Lines 176-197:
  ```tsx
  //  before
  <div className="col-span-2 sm:col-span-1 lg:col-span-1 bg-base-100 border border-purple-500/30 rounded-xl p-3 flex flex-col justify-between shadow-md">
    <div className="flex items-center justify-between border-b border-base-300 pb-1.5">
      <span className="text-xs font-bold text-purple-600 dark:text-purple-300 flex items-center gap-1">
        <Sparkles className="w-3.5 h-3.5 text-purple-500" />
        Auto-Arp
      </span>
      <button
        id="btn-simple-toggle-arp"
        onClick={() => { onChangeParams({ ...params, arpActive: !params.arpActive }); }}
        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase transition-all cursor-pointer ${
          params.arpActive
            ? "bg-purple-600 text-white shadow-xs"
            : "bg-base-200 text-base-content/70 hover:text-base-content border border-base-300"
        }`}
      >
  //  after
  <div className="col-span-2 sm:col-span-1 lg:col-span-1 card bg-base-100 border border-accent/30 shadow-md">
    <div className="card-body p-3 flex flex-col justify-between">
      <div className="flex items-center justify-between border-b border-base-300 pb-1.5">
        <span className="text-xs font-bold text-accent flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          Auto-Arp
        </span>
        <button
          id="btn-simple-toggle-arp"
          onClick={() => { onChangeParams({ ...params, arpActive: !params.arpActive }); }}
          className={`btn btn-xs rounded-full text-[10px] font-bold uppercase ${
            params.arpActive ? "btn-accent text-accent-content" : "btn-outline"
          }`}
        >
  ```

- [ ] Convert the Arp Speed readout and its 3-way selector to a `join`. Lines 202-226:
  ```tsx
  //  before
  <span className="font-mono text-purple-600 dark:text-purple-300 font-bold">
  //  after
  <span className="font-mono text-accent font-bold">
  ```
  ```tsx
  //  before
  <div className="grid grid-cols-3 gap-1">
    {(["8n", "16n", "32n"] as const).map((r) => (
      <button
        key={r}
        onClick={() => onChangeParams({ ...params, arpRate: r })}
        className={`py-0.5 text-[10px] font-semibold rounded transition-all cursor-pointer ${
          (params.arpRate ?? "16n") === r
            ? "bg-purple-600 text-white shadow-xs"
            : "bg-base-200 text-base-content/70 hover:text-base-content border border-base-300"
        }`}
      >
  //  after
  <div className="join w-full">
    {(["8n", "16n", "32n"] as const).map((r) => (
      <button
        key={r}
        onClick={() => onChangeParams({ ...params, arpRate: r })}
        className={`btn btn-xs join-item flex-1 text-[10px] font-semibold ${
          (params.arpRate ?? "16n") === r
            ? "btn-accent text-accent-content"
            : "btn-outline"
        }`}
      >
  ```

- [ ] Convert the Arp Mode readout and its 4-way selector to a `join`. Lines 231-257:
  ```tsx
  //  before
  <span className="capitalize font-mono text-purple-600 dark:text-purple-300 font-bold">
  //  after
  <span className="capitalize font-mono text-accent font-bold">
  ```
  ```tsx
  //  before
  <div className="grid grid-cols-4 gap-1">
    {(["up", "down", "updown", "random"] as const).map((m) => (
      <button
        key={m}
        onClick={() => onChangeParams({ ...params, arpMode: m })}
        className={`py-0.5 text-[10px] font-semibold rounded transition-all cursor-pointer ${
          (params.arpMode ?? "up") === m
            ? "bg-purple-600 text-white shadow-xs"
            : "bg-base-200 text-base-content/70 hover:text-base-content border border-base-300"
        }`}
        title={`Mode: ${m}`}
      >
  //  after
  <div className="join w-full">
    {(["up", "down", "updown", "random"] as const).map((m) => (
      <button
        key={m}
        onClick={() => onChangeParams({ ...params, arpMode: m })}
        className={`btn btn-xs join-item flex-1 text-[10px] font-semibold ${
          (params.arpMode ?? "up") === m
            ? "btn-accent text-accent-content"
            : "btn-outline"
        }`}
        title={`Mode: ${m}`}
      >
  ```
  Remember to close the extra `card-body` wrapper you opened at line 176, before the card's own `</div>` at what is currently line 260.

- [ ] Prove every `dark:` variant is gone from the file:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -c 'dark:' src/components/SimpleSynthPanel.tsx
  ```
  Expected: `0`.

- [ ] Run the tests GREEN:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/SimpleSynthPanel.test.tsx
  ```
  Expected: `4 pass  0 fail`.

### Steps — EffectsRackView

- [ ] Delete `'src/components/EffectsRackView.tsx'` from `ALLOWLIST` in `scripts/themeTokenGuard.ts`, then watch the guard go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: `1 fail` listing `src/components/EffectsRackView.tsx` with `palette-color` hits for `purple-600/500/400`, `cyan-500/600/300`, `indigo-500/600/300`, `amber-500/600/300`, `emerald-500/600/300`, and `dark-variant` hits at lines 21, 51, 107, 165, 207.

- [ ] Create `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/EffectsRackView.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { EffectsRackView } from './EffectsRackView';

  describe('EffectsRackView theming', () => {
    const html = renderToString(<EffectsRackView />);

    test('rack units are daisyUI cards on semantic tokens', () => {
      expect(html).toContain('card bg-base-100');
      expect(html).toContain('card-body');
      expect(html).toContain('text-primary');
      expect(html).toContain('text-accent');
      expect(html).toContain('text-secondary');
    });

    test('bypass switches are daisyUI buttons', () => {
      expect(html).toContain('btn btn-xs');
      expect(html).toContain('btn-active');
      expect(html).toContain('btn-bypass-reverb');
      expect(html).toContain('btn-bypass-delay');
      expect(html).toContain('btn-bypass-distortion');
      expect(html).toContain('btn-bypass-eq');
    });

    test('no dark: variants and no raw palette colours survive', () => {
      expect(html).not.toContain('dark:');
      for (const legacy of ['purple-', 'cyan-', 'indigo-', 'amber-', 'emerald-']) {
        expect(html).not.toContain(legacy);
      }
    });
  });
  ```

- [ ] Watch it go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/EffectsRackView.test.tsx
  ```
  Expected: `3 fail`, first tripping on `expect(html).toContain('card bg-base-100')`.

- [ ] Convert the rack header. Lines 19-24:
  ```tsx
  //  before
  <div className="bg-base-100 border border-base-300 rounded-xl p-3 sm:p-4 flex items-center justify-between shadow-md">
    <div className="flex items-center gap-2.5">
      <div className="p-1.5 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-600 dark:text-purple-400">
  //  after
  <div className="card bg-base-100 border border-base-300 shadow-md">
    <div className="card-body p-3 sm:p-4 flex-row items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 rounded-lg bg-primary/20 border border-primary/30 text-primary">
  ```
  (`card-body` is `display: flex; flex-direction: column` by default — `flex-row` restores the original horizontal layout. Close the extra div before the card's `</div>` at line 28.)

- [ ] Convert the Reverb unit, cyan → `accent`. Lines 33-84:
  ```tsx
  //  before  (33-38)
  <div
    className={`bg-base-100 border rounded-xl p-3 sm:p-4 space-y-3 shadow-md transition-all ${
      effects.reverbBypass
        ? "border-base-300 opacity-60"
        : "border-cyan-500/40 ring-1 ring-cyan-500/20"
    }`}
  >
  //  after
  <div
    className={`card bg-base-100 border shadow-md transition-all ${
      effects.reverbBypass
        ? "border-base-300 opacity-60"
        : "border-accent/40 ring-1 ring-accent/20"
    }`}
  >
    <div className="card-body p-3 sm:p-4 space-y-3">
  ```
  ```tsx
  //  before  (42)
  <Waves className="w-3.5 h-3.5 text-cyan-500" />
  //  after
  <Waves className="w-3.5 h-3.5 text-accent" />
  ```
  ```tsx
  //  before  (45-52)
  <button
    id="btn-bypass-reverb"
    onClick={() => updateFx({ reverbBypass: !effects.reverbBypass })}
    className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer transition-colors ${
      effects.reverbBypass
        ? "bg-base-200 text-base-content/50 border border-base-300"
        : "bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/40"
    }`}
  //  after
  <button
    id="btn-bypass-reverb"
    onClick={() => updateFx({ reverbBypass: !effects.reverbBypass })}
    className={`btn btn-xs gap-1 text-[10px] font-mono font-bold ${
      effects.reverbBypass ? "btn-ghost" : "btn-accent btn-active"
    }`}
  ```
  ```tsx
  //  before  (64 and 75)
  color="text-cyan-500"
  //  after   (both Knobs)
  color="text-accent"
  ```
  Close the `card-body` div before the unit's closing `</div>` at line 86.

- [ ] Convert the Delay unit, indigo → `accent`. Lines 89-140:
  - lines 89-94: `bg-base-100 border rounded-xl p-3 sm:p-4 space-y-3 shadow-md transition-all` → `card bg-base-100 border shadow-md transition-all` + inner `<div className="card-body p-3 sm:p-4 space-y-3">`; `border-indigo-500/40 ring-1 ring-indigo-500/20` → `border-accent/40 ring-1 ring-accent/20`
  - line 98: `<Activity className="w-3.5 h-3.5 text-indigo-500" />` → `text-accent`
  - lines 101-108: bypass button → `className={`btn btn-xs gap-1 text-[10px] font-mono font-bold ${effects.delayBypass ? "btn-ghost" : "btn-accent btn-active"}`}`
  - lines 120 and 132: `color="text-indigo-500"` → `color="text-accent"`

- [ ] Convert the Distortion unit, amber → `primary`. Lines 145-185:
  - lines 145-150: → `card bg-base-100 border shadow-md transition-all` + inner `<div className="card-body p-3 sm:p-4 space-y-3">`; `border-amber-500/40 ring-1 ring-amber-500/20` → `border-primary/40 ring-1 ring-primary/20`
  - line 154: `<Sparkles className="w-3.5 h-3.5 text-amber-500" />` → `text-primary`
  - lines 157-166: bypass button → `className={`btn btn-xs gap-1 text-[10px] font-mono font-bold ${effects.distortionBypass ? "btn-ghost" : "btn-primary btn-active"}`}`
  - line 177: `color="text-amber-500"` → `color="text-primary"`

- [ ] Convert the EQ unit, emerald → `secondary`. Lines 189-257:
  - lines 189-194: → `card bg-base-100 border shadow-md transition-all` + inner `<div className="card-body p-3 sm:p-4 space-y-3">`; `border-emerald-500/40 ring-1 ring-emerald-500/20` → `border-secondary/40 ring-1 ring-secondary/20`
  - line 198: `<Sliders className="w-3.5 h-3.5 text-emerald-500" />` → `text-secondary`
  - lines 201-208: bypass button → `className={`btn btn-xs gap-1 text-[10px] font-mono font-bold ${effects.eqBypass ? "btn-ghost" : "btn-secondary btn-active"}`}`
  - lines 219, 233, 247: `color="text-emerald-500"` → `color="text-secondary"` on all three EQ knobs

- [ ] Prove the `dark:` variants are gone:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -c 'dark:' src/components/EffectsRackView.tsx
  ```
  Expected: `0`.

- [ ] Verify every `Knob color=` value in both files is inside Task 4's five-member union:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -hn 'color="text-' src/components/SimpleSynthPanel.tsx src/components/EffectsRackView.tsx | sort -u
  ```
  Expected: only `text-primary`, `text-secondary`, `text-accent`, `text-success` appear. Any other value makes `bun run lint` fail against the narrowed `KnobProps['color']`.

- [ ] Run tests, guard, typecheck and lint GREEN:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/EffectsRackView.test.tsx src/components/SimpleSynthPanel.test.tsx scripts/themeTokenGuard.test.ts && bun run lint && bun run eslint
  ```
  Expected: `8 pass  0 fail`, `tsc --noEmit` silent, `eslint .` exit 0.

- [ ] Commit:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
  refactor(ui): tokenize SimpleSynthPanel and EffectsRackView accents

  Both files already had tokenized surfaces; this finishes the accent layer.
  Tone/Distortion -> primary, Space/Delay/Reverb/Auto-Arp -> accent,
  Vibe/EQ -> secondary, Punch -> success. Hand-rolled panels become
  card + card-body, macro pills become badge badge-sm, the arp rate and mode
  selectors become join + btn join-item, and every bypass switch becomes
  btn btn-xs (+ btn-active).

  Deletes all seven `dark:` variants in SimpleSynthPanel and all five in
  EffectsRackView. They keyed off the OS colour scheme, while Solva switches
  themes via data-theme on <html> — so a dark-OS user on solva-light got pale
  amber/purple/cyan labels on white cards. The semantic tokens resolve per
  theme on their own, making the variants both wrong and redundant.

  Knob color props now use only the narrowed union from the Knob refactor.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  ```

---

## Task 12: Tokenize `src/components/DrumPads.tsx` and repair its key-binding contract

`src/components/DrumPads.tsx` carries eight hardcoded two-stop gradients drawn from eight *different* Tailwind palettes (rose/red, amber/orange, emerald/teal, cyan/blue, purple/indigo, pink/rose, violet/purple, yellow/amber). Under `solva-light` they stay saturated and clash with the warm paper background; under either theme they have nothing to do with the Solva palette. The wrapper card, the active ring, the shortcut chip and the volume sliders are all still on murva hex.

There is also a broken contract to repair. `scripts/check-key-bindings.ts:1` reads:
```ts
import { DEFAULT_PADS } from '../src/components/DrumPads.tsx';
```
but `DrumPads.tsx:8` declares `const PADS: DrumPad[] = [...]` — module-private, and under a different name. Running the script today fails before it checks anything.

**Files:**
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/DrumPads.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/DrumPads.test.tsx`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts` (remove one `ALLOWLIST` entry)

**Interfaces:**
- Consumes: `DrumPad` from `../types` (fields `id`, `name`, `note`, `color`, `shortcut`, `volume`, `pitch`, `decay` — **the type is not changed by this task**); `Slider` from `./ui/Slider` (Task 3 default `'range range-primary range-xs w-full'`); `triggerPad as triggerDrumPad` from `../audio/playback/drumPlayback`; `isTypingTarget` / `shortcutLabel` from `../utils/keyboard`.
- Produces: `export const DEFAULT_PADS: DrumPad[]` — the array formerly named `PADS`, now exported under the name `scripts/check-key-bindings.ts:1` already imports. `DrumPads` itself keeps its `React.FC` signature, so `SequencerView.tsx:394` needs no change.

### The eight-pad colour assignment (decided, apply exactly)

The `DrumPad.color` field is a plain `string` spliced into a `bg-gradient-to-br` className at line 59, so the whole gradient *plus* the matching text token lives in that one string — no change to the `DrumPad` type is needed. The three semantic ramps rotate in the order primary → secondary → accent, restarting after every three pads, which keeps adjacent pads visually distinct across the 4-column mobile grid and the 8-column desktop grid:

| # | pad id | shortcut (unchanged) | `color` value |
|---|---|---|---|
| 1 | `kick` | `KeyZ` | `from-primary to-primary/60 text-primary-content` |
| 2 | `snare` | `KeyX` | `from-secondary to-secondary/60 text-secondary-content` |
| 3 | `hihat` | `KeyC` | `from-accent to-accent/60 text-accent-content` |
| 4 | `openhat` | `KeyV` | `from-primary to-primary/60 text-primary-content` |
| 5 | `clap` | `KeyM` | `from-secondary to-secondary/60 text-secondary-content` |
| 6 | `lowtom` | `Comma` | `from-accent to-accent/60 text-accent-content` |
| 7 | `hightom` | `Period` | `from-primary to-primary/60 text-primary-content` |
| 8 | `crash` | `Slash` | `from-secondary to-secondary/60 text-secondary-content` |

Every other field — `id`, `name`, `note`, `shortcut`, `volume`, `pitch`, `decay` — is byte-for-byte unchanged. Only `color` moves.

### Steps

- [ ] Confirm the key-binding script is broken *before* you touch anything, so you know the later green is real:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun scripts/check-key-bindings.ts
  ```
  Expected: `SyntaxError: Export named 'KEYBOARD_NOTES' not found in module '.../src/components/SynthView.tsx'` and a non-zero exit. Bun reports the *second* missing import first; `DEFAULT_PADS` is missing too. `KEYBOARD_NOTES` lives in `SynthView.tsx`, which belongs to Task 18 — that task exports it and makes this script runnable end to end. **Do not edit `SynthView.tsx` here.**

- [ ] Delete `'src/components/DrumPads.tsx'` from `ALLOWLIST` in `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts`, then watch the guard go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
  ```
  Expected: `1 fail` listing `src/components/DrumPads.tsx` with `raw-hex` hits (`#12152A`, `#252B48`, `#0B0D19`), `palette-color` hits (`rose-500`, `red-600`, `amber-500`, `orange-600`, `emerald-500`, `teal-600`, `cyan-500`, `blue-600`, `purple-500`, `indigo-600`, `pink-500`, `rose-600`, `violet-500`, `purple-600`, `yellow-400`, `amber-600`, `slate-500`) and `absolute-bw` hits (`text-white`, `ring-white`, `shadow-white/30`, `bg-black/30`, `border-white/20`).

- [ ] Extend `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/DrumPads.test.tsx`. Keep the existing `describe('DrumPads', ...)` block exactly as it is (it guards the header-removal contract) and add a second import plus a second describe block:
  ```tsx
  import { DrumPads, DEFAULT_PADS } from './DrumPads';
  ```
  ```tsx
  describe('DrumPads theming and key-binding contract', () => {
    test('exports DEFAULT_PADS under the name check-key-bindings.ts imports', () => {
      expect(Array.isArray(DEFAULT_PADS)).toBe(true);
      expect(DEFAULT_PADS).toHaveLength(8);
    });

    test('shortcuts are untouched by the colour migration', () => {
      expect(DEFAULT_PADS.map((p) => p.shortcut)).toEqual([
        'KeyZ',
        'KeyX',
        'KeyC',
        'KeyV',
        'KeyM',
        'Comma',
        'Period',
        'Slash',
      ]);
    });

    test('every pad colour is a semantic ramp with a matching content token', () => {
      const allowed = [
        'from-primary to-primary/60 text-primary-content',
        'from-secondary to-secondary/60 text-secondary-content',
        'from-accent to-accent/60 text-accent-content',
      ];
      for (const pad of DEFAULT_PADS) {
        expect(allowed).toContain(pad.color);
      }
    });

    test('the pad grid renders on daisyUI components and semantic tokens', () => {
      const html = renderToString(<DrumPads />);

      expect(html).toContain('card bg-base-100 border border-base-300');
      expect(html).toContain('card-body');
      expect(html).toContain('kbd kbd-xs');
      expect(html).toContain('range range-xs range-primary');
      expect(html).toContain('text-base-content/50');
      expect(html).toContain('ring-primary');

      expect(html).not.toContain('#12152A');
      expect(html).not.toContain('#252B48');
      expect(html).not.toContain('#0B0D19');
      expect(html).not.toContain('text-white');
      expect(html).not.toContain('ring-white');
      expect(html).not.toContain('bg-black/30');
      expect(html).not.toContain('slate-');
    });
  });
  ```

- [ ] Watch it go RED:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/DrumPads.test.tsx
  ```
  Expected: `SyntaxError: Export named 'DEFAULT_PADS' not found in module '.../src/components/DrumPads.tsx'` — the whole file fails to load, which is the correct red for a missing export.

- [ ] Rename and export the pad array, and swap in the semantic ramps. Replace lines 8-17 of `DrumPads.tsx`:
  ```tsx
  //  before
  const PADS: DrumPad[] = [
    { id: 'kick', name: 'Kick Drum', note: 'kick', color: 'from-rose-500 to-red-600', shortcut: 'KeyZ', volume: 0.9, pitch: 0, decay: 0.3 },
    { id: 'snare', name: 'Snare Snap', note: 'snare', color: 'from-amber-500 to-orange-600', shortcut: 'KeyX', volume: 0.85, pitch: 0, decay: 0.2 },
    { id: 'hihat', name: 'Closed Hat', note: 'hihat', color: 'from-emerald-500 to-teal-600', shortcut: 'KeyC', volume: 0.75, pitch: 0, decay: 0.05 },
    { id: 'openhat', name: 'Open Hat', note: 'openhat', color: 'from-cyan-500 to-blue-600', shortcut: 'KeyV', volume: 0.8, pitch: 0, decay: 0.35 },
    { id: 'clap', name: 'Hand Clap', note: 'clap', color: 'from-purple-500 to-indigo-600', shortcut: 'KeyM', volume: 0.85, pitch: 0, decay: 0.2 },
    { id: 'lowtom', name: 'Low Tom', note: 'tom', color: 'from-pink-500 to-rose-600', shortcut: 'Comma', volume: 0.8, pitch: 0, decay: 0.25 },
    { id: 'hightom', name: 'High Tom', note: 'tom', color: 'from-violet-500 to-purple-600', shortcut: 'Period', volume: 0.8, pitch: 4, decay: 0.2 },
    { id: 'crash', name: 'Crash Cymbal', note: 'crash', color: 'from-yellow-400 to-amber-600', shortcut: 'Slash', volume: 0.75, pitch: 0, decay: 0.8 },
  ];
  ```
  ```tsx
  //  after
  /**
   * Exported under this name because scripts/check-key-bindings.ts imports
   * `DEFAULT_PADS` — the shortcut codes here are the source of truth for the
   * drum half of the global key map.
   *
   * `color` holds the full gradient stops plus the matching content token; it is
   * spliced into a `bg-gradient-to-br` className below. Three semantic ramps
   * rotate primary -> secondary -> accent so neighbours stay distinguishable in
   * both the 4-column and the 8-column grid.
   */
  export const DEFAULT_PADS: DrumPad[] = [
    { id: 'kick', name: 'Kick Drum', note: 'kick', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'KeyZ', volume: 0.9, pitch: 0, decay: 0.3 },
    { id: 'snare', name: 'Snare Snap', note: 'snare', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'KeyX', volume: 0.85, pitch: 0, decay: 0.2 },
    { id: 'hihat', name: 'Closed Hat', note: 'hihat', color: 'from-accent to-accent/60 text-accent-content', shortcut: 'KeyC', volume: 0.75, pitch: 0, decay: 0.05 },
    { id: 'openhat', name: 'Open Hat', note: 'openhat', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'KeyV', volume: 0.8, pitch: 0, decay: 0.35 },
    { id: 'clap', name: 'Hand Clap', note: 'clap', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'KeyM', volume: 0.85, pitch: 0, decay: 0.2 },
    { id: 'lowtom', name: 'Low Tom', note: 'tom', color: 'from-accent to-accent/60 text-accent-content', shortcut: 'Comma', volume: 0.8, pitch: 0, decay: 0.25 },
    { id: 'hightom', name: 'High Tom', note: 'tom', color: 'from-primary to-primary/60 text-primary-content', shortcut: 'Period', volume: 0.8, pitch: 4, decay: 0.2 },
    { id: 'crash', name: 'Crash Cymbal', note: 'crash', color: 'from-secondary to-secondary/60 text-secondary-content', shortcut: 'Slash', volume: 0.75, pitch: 0, decay: 0.8 },
  ];
  ```

- [ ] Update the single internal reference. Line 20:
  ```tsx
  //  before
  const [pads, setPads] = useState<DrumPad[]>(PADS);
  //  after
  const [pads, setPads] = useState<DrumPad[]>(DEFAULT_PADS);
  ```

- [ ] Convert the wrapper to a card. Lines 45-46:
  ```tsx
  //  before
  <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 sm:p-4 shadow-md">
    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-2.5">
  //  after
  <div className="card bg-base-100 border border-base-300 shadow-md">
    <div className="card-body p-3 sm:p-4">
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-2.5">
  ```
  Add the matching extra `</div>` before the component's final `</div>` (currently line 95).

- [ ] Convert the pad trigger button and its active ring. Lines 56-63:
  ```tsx
  //  before
  <button
    id={`btn-pad-${pad.id}`}
    onClick={() => triggerPad(pad)}
    className={`relative w-full h-14 sm:h-16 rounded-lg bg-gradient-to-br ${pad.color} p-1.5 sm:p-2 flex flex-col justify-between items-start text-white shadow-sm cursor-pointer transition-all duration-75 ${
      isActive
        ? 'ring-4 ring-white brightness-125 scale-95 shadow-white/30'
        : 'hover:brightness-110 active:scale-95'
    }`}
  >
  //  after
  <button
    id={`btn-pad-${pad.id}`}
    onClick={() => triggerPad(pad)}
    className={`btn relative w-full h-14 sm:h-16 border-0 rounded-lg bg-gradient-to-br ${pad.color} p-1.5 sm:p-2 flex flex-col justify-between items-start shadow-sm transition-all duration-75 ${
      isActive
        ? 'ring-4 ring-primary brightness-125 scale-95 shadow-primary/30'
        : 'hover:brightness-110 active:scale-95'
    }`}
  >
  ```
  `text-white` is deleted because the per-pad `*-content` token now travels inside `pad.color`. `border-0` is needed so daisyUI's default `btn` border does not draw a base-300 hairline over the gradient.

- [ ] Convert the shortcut chip to a `kbd`. Lines 69-71:
  ```tsx
  //  before
  <span className="w-4 h-4 sm:w-5 sm:h-5 rounded bg-black/30 border border-white/20 text-[9px] sm:text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
    {shortcutLabel(pad.shortcut)}
  </span>
  //  after
  <span className="kbd kbd-xs w-4 h-4 sm:w-5 sm:h-5 min-h-0 px-0 text-[9px] sm:text-[10px] font-mono font-bold shrink-0">
    {shortcutLabel(pad.shortcut)}
  </span>
  ```
  `font-mono` is preserved deliberately — docs/design.md §3 puts every key/numeric readout in JetBrains Mono, and `kbd` alone does not force a monospace family in this theme.

- [ ] Tokenize the volume row. Lines 77 and 87:
  ```tsx
  //  before  (77)
  <Volume2 className="w-2.5 h-2.5 text-slate-500 shrink-0" />
  //  after
  <Volume2 className="w-2.5 h-2.5 text-base-content/50 shrink-0" />
  ```
  ```tsx
  //  before  (87)
  className="w-full h-1 bg-[#0B0D19] rounded cursor-pointer"
  //  after
  className="range range-xs range-primary w-full"
  ```

- [ ] Run the component tests GREEN:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/DrumPads.test.tsx
  ```
  Expected: `5 pass  0 fail` (the original header-removal test plus the four new ones).

- [ ] Prove the drum half of the key-binding contract is intact. The full script still cannot run because `KEYBOARD_NOTES` is Task 18's export, so verify the `DEFAULT_PADS` half directly with the same three assertions the script makes over drum codes:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun -e "
  import { DEFAULT_PADS } from './src/components/DrumPads.tsx';
  const codes = DEFAULT_PADS.map((p) => p.shortcut);
  const VALID = /^(Key[A-Z]|Digit[0-9]|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal)\$/;
  console.log('count', codes.length);
  console.log('unique', new Set(codes).size === codes.length);
  console.log('valid', codes.every((c) => VALID.test(c)));
  console.log('codes', codes.join(' '));
  "
  ```
  Expected output:
  ```
  count 8
  unique true
  valid true
  codes KeyZ KeyX KeyC KeyV KeyM Comma Period Slash
  ```

- [ ] Run the whole key-binding script and record that its remaining failure is the *other* file's:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun scripts/check-key-bindings.ts
  ```
  Expected: still `SyntaxError: Export named 'KEYBOARD_NOTES' not found in module '.../src/components/SynthView.tsx'` — and crucially **no longer** a `DEFAULT_PADS` error. Task 18 adds `export` to `KEYBOARD_NOTES` in `SynthView.tsx`, after which this command prints four `PASS` lines and `All key binding checks passed.`

- [ ] Guard, typecheck and lint GREEN:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts && bun run lint && bun run eslint
  ```
  Expected: `1 pass  0 fail` with no `DrumPads.tsx` in the output, `tsc --noEmit` silent, `eslint .` exit 0.

- [ ] Commit:
  ```bash
  cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
  refactor(ui): put the drum pads on semantic ramps and export DEFAULT_PADS

  The eight pads used eight unrelated Tailwind gradients (rose/red,
  amber/orange, emerald/teal, cyan/blue, purple/indigo, pink/rose,
  violet/purple, yellow/amber) that clash with the warm Solva paper under
  solva-light. They now rotate three semantic ramps —
  primary -> secondary -> accent — each carrying its matching *-content text
  token inside the same `color` string, so DrumPad's type is unchanged.

  The wrapper becomes card + card-body, the active ring moves from ring-white
  to ring-primary, the shortcut chip becomes kbd kbd-xs (keeping font-mono per
  the type spec), and the per-pad faders become range range-xs range-primary.

  Renames the private PADS array to the exported DEFAULT_PADS, which is the
  name scripts/check-key-bindings.ts has always imported — that script could
  not load before. All eight shortcut codes are byte-identical; only `color`
  changed. The script's remaining failure is SynthView's unexported
  KEYBOARD_NOTES, fixed in the SynthView task.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  ```
## Task 13: `SequencerView.tsx` + track colors in `initialState.ts` (+ persist migration)

**Files:**
- `src/store/initialState.ts` (edit — lines 41, 50, 59, 68, 77)
- `src/store/migrate.ts` (edit — add track-colour migration)
- `src/store/store.ts` (edit — persist `version: 2` → `3`, call the new migration)
- `src/store/migrate.test.ts` (new)
- `src/components/SequencerView.tsx` (edit — 397 lines)
- `src/components/SequencerView.test.tsx` (new)
- `scripts/themeTokenGuard.ts` (edit — remove three entries from `ALLOWLIST`)

**Interfaces:**
- *Consumes:* `success` / `warning` / `error` / `info` tokens added to both themes in `src/index.css` by Task 1. `Slider`'s new default `className` of `'range range-primary range-xs w-full'` from Task 3 (the `className` prop still overrides it). `Knob`'s narrowed `color` union `'text-primary' | 'text-secondary' | 'text-accent' | 'text-success' | 'text-error'` from Task 4. `scanRepo` / `ALLOWLIST` from `scripts/themeTokenGuard.ts` (Task 2).
- *Produces:* `SequencerTrack.color` is now always one of exactly five daisyUI background tokens — `'bg-error' | 'bg-warning' | 'bg-success' | 'bg-accent' | 'bg-secondary'` — for both fresh state and rehydrated state. Persist schema version is `3`. Task 18 (SynthView) and any later task that reads `sequencerTracks[].color` may rely on that.

### Why the data layer must move first

`SequencerView.tsx` renders `track.color` verbatim in two places:

```tsx
// src/components/SequencerView.tsx:319
<div className={`w-2.5 h-2.5 rounded-full ${track.color}`} />
```

```tsx
// src/components/SequencerView.tsx:375
? `${track.color} shadow-md shadow-indigo-500/20 scale-[0.96]`
```

The class strings themselves live in `src/store/initialState.ts:41,50,59,68,77` as `'bg-rose-500'`, `'bg-amber-500'`, `'bg-emerald-500'`, `'bg-cyan-500'`, `'bg-purple-500'`. The guard's `palette-color` rule flags those literals in `initialState.ts`, so `SequencerView` can never go green while the store still ships raw palette classes.

**Exact 5-track assignment** (hue-preserving, and deliberately *not* `primary` — design.md reserves primary amber for the playhead, which would make the amber track lane indistinguishable from the transport indicator):

| track id | name | old class | new class |
|---|---|---|---|
| `track-kick` | Kick 808 | `bg-rose-500` | `bg-error` |
| `track-snare` | Snare Snap | `bg-amber-500` | `bg-warning` |
| `track-hihat` | Closed Hat | `bg-emerald-500` | `bg-success` |
| `track-openhat` | Open Hat | `bg-cyan-500` | `bg-accent` |
| `track-clap` | Hand Clap | `bg-purple-500` | `bg-secondary` |

**Migration is required.** `src/store/store.ts:115` includes `sequencerTracks: state.sequencerTracks` in `partializeAppState`, so every user with a saved project has the five raw palette strings inside `localStorage` under the persist key. Zustand's `merge` (store.ts:297-300) spreads the persisted array over the defaults, so those old strings survive a rehydrate and reach the DOM at runtime — the light theme would still show hard-coded dark-theme dots. The store already carries `version: 2` and a `migrate` callback (store.ts:269-291), so this task bumps to `version: 3` and remaps in `migrate`.

### Steps

- [ ] **13.1 — Failing guard for the store data file.** Open `scripts/themeTokenGuard.ts`, find the `ALLOWLIST` array, and delete the entry `'src/store/initialState.ts'`. Run:
  ```
  bun test scripts/themeTokenGuard.test.ts
  ```
  Expect a failure naming `src/store/initialState.ts` with five `palette-color` violations (`bg-rose-500`, `bg-amber-500`, `bg-emerald-500`, `bg-cyan-500`, `bg-purple-500`).

- [ ] **13.2 — Failing migration test.** Create `src/store/migrate.test.ts`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { migrateTrackColors, LEGACY_TRACK_COLOR_MAP } from './migrate';

  describe('migrateTrackColors', () => {
    test('rewrites every legacy palette track colour to a semantic token', () => {
      const migrated = migrateTrackColors({
        sequencerTracks: [
          { id: 'track-kick', color: 'bg-rose-500' },
          { id: 'track-snare', color: 'bg-amber-500' },
          { id: 'track-hihat', color: 'bg-emerald-500' },
          { id: 'track-openhat', color: 'bg-cyan-500' },
          { id: 'track-clap', color: 'bg-purple-500' },
        ],
      } as never) as { sequencerTracks: { color: string }[] };

      expect(migrated.sequencerTracks.map((t) => t.color)).toEqual([
        'bg-error',
        'bg-warning',
        'bg-success',
        'bg-accent',
        'bg-secondary',
      ]);
    });

    test('leaves an already-migrated colour alone', () => {
      const migrated = migrateTrackColors({
        sequencerTracks: [{ id: 'track-kick', color: 'bg-error' }],
      } as never) as { sequencerTracks: { color: string }[] };
      expect(migrated.sequencerTracks[0].color).toBe('bg-error');
    });

    test('is a no-op when sequencerTracks is missing or not an array', () => {
      expect(migrateTrackColors({} as never)).toEqual({} as never);
      expect(
        migrateTrackColors({ sequencerTracks: 'nope' } as never)
      ).toEqual({ sequencerTracks: 'nope' } as never);
    });

    test('the map covers exactly the five legacy colours', () => {
      expect(Object.keys(LEGACY_TRACK_COLOR_MAP).sort()).toEqual([
        'bg-amber-500',
        'bg-cyan-500',
        'bg-emerald-500',
        'bg-purple-500',
        'bg-rose-500',
      ]);
    });
  });
  ```
  Run `bun test src/store/migrate.test.ts`. Expect red: `Export named 'migrateTrackColors' not found in module .../migrate.ts`.

- [ ] **13.3 — Implement the migration.** Append to `src/store/migrate.ts` (after `removeLegacyKeys`, end of file at line 84):
  ```ts
  /**
   * v2 → v3: sequencer track colours were raw Tailwind palette classes
   * (`bg-rose-500`, …) baked into persisted state, so a saved project kept
   * dark-theme-only colours after the daisyUI token migration. Remap them onto
   * the semantic ramps; unknown values are left untouched.
   */
  export const LEGACY_TRACK_COLOR_MAP: Record<string, string> = {
    'bg-rose-500': 'bg-error',
    'bg-amber-500': 'bg-warning',
    'bg-emerald-500': 'bg-success',
    'bg-cyan-500': 'bg-accent',
    'bg-purple-500': 'bg-secondary',
  };

  export function migrateTrackColors<T extends object>(state: T): T {
    const tracks = (state as { sequencerTracks?: unknown }).sequencerTracks;
    if (!Array.isArray(tracks)) return state;

    return {
      ...state,
      sequencerTracks: tracks.map((t) => {
        if (!t || typeof t !== 'object') return t;
        const color = (t as { color?: unknown }).color;
        if (typeof color !== 'string') return t;
        const next = LEGACY_TRACK_COLOR_MAP[color];
        return next ? { ...(t as object), color: next } : t;
      }),
    };
  }
  ```
  Run `bun test src/store/migrate.test.ts` → 4 pass.

- [ ] **13.4 — Wire the migration into the persist config.** In `src/store/store.ts`, extend the import on line 16:
  ```ts
  import {
    migrateLegacyPresets,
    migrateTrackColors,
    removeLegacyKeys,
    LEGACY_PERSIST_KEY,
  } from './migrate';
  ```
  Change line 269 `version: 2,` to `version: 3,`. Then replace the body of `migrate` (lines 274-291) so the colour remap runs for every payload older than 3 — note the existing `if (version >= 2) return migrated;` early return must no longer short-circuit past it:
  ```ts
      migrate: (persisted, version) => {
        const migrated = migrateLegacyPresets(
          (persisted ?? {}) as Partial<PersistedState>
        ) as PersistedState;
        // v2 → v3: raw Tailwind track colours become daisyUI semantic tokens.
        const recoloured =
          version >= 3 ? migrated : (migrateTrackColors(migrated) as PersistedState);
        if (version >= 2) return recoloured;
        // v1 persisted `arpActive: true` from an arpeggiator that never
        // produced a note, while that same flag gated the keyboard's direct
        // trigger — so those sessions came back with a silent keyboard. Clear
        // the flag once on the way to v2; the arp can be switched back on.
        const next = { ...recoloured } as Record<string, unknown>;
        for (const key of ['synthParams', 'chordSynthParams', 'bassSynthParams']) {
          const params = next[key];
          if (params && typeof params === 'object' && !Array.isArray(params)) {
            next[key] = { ...(params as object), arpActive: false };
          }
        }
        return next as unknown as PersistedState;
      },
  ```
  Run `bun test src/store/store.test.ts`. The existing suite writes `version: 1` and `version: 2` payloads (store.test.ts:534, 618, 697, 727, 750, 777, 797, 812, 840) — every one must still pass, because a `version: 2` payload now simply gains the colour remap and those tests do not assert on `color`. Expect all green.

- [ ] **13.5 — Recolour the defaults.** In `src/store/initialState.ts` apply five one-line edits: line 41 `color: 'bg-rose-500',` → `color: 'bg-error',`; line 50 `color: 'bg-amber-500',` → `color: 'bg-warning',`; line 59 `color: 'bg-emerald-500',` → `color: 'bg-success',`; line 68 `color: 'bg-cyan-500',` → `color: 'bg-accent',`; line 77 `color: 'bg-purple-500',` → `color: 'bg-secondary',`. Run:
  ```
  bun test scripts/themeTokenGuard.test.ts
  ```
  Expect green for `src/store/initialState.ts` (the file no longer appears in the failure list; other still-allowlisted files are unaffected).

- [ ] **13.6 — Commit the data layer.**
  ```
  git add src/store/initialState.ts src/store/migrate.ts src/store/migrate.test.ts src/store/store.ts scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(store): map sequencer track colours onto daisyUI semantic tokens

  Track colours were raw Tailwind palette classes baked into persisted state,
  so SequencerView could never satisfy the theme-token guard. Kick/snare/hihat/
  openhat/clap now use error/warning/success/accent/secondary, and persist v3
  remaps the five legacy strings for users with a saved project.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **13.7 — Failing guard + failing component test for SequencerView.** Delete `'src/components/SequencerView.tsx'` from `ALLOWLIST` in `scripts/themeTokenGuard.ts`. Create `src/components/SequencerView.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { SequencerView } from './SequencerView';

  describe('SequencerView theming', () => {
    const html = renderToString(<SequencerView />);

    test('panels are daisyUI cards on base tokens', () => {
      expect(html).toContain('card bg-base-100 border border-base-300');
      expect(html).not.toContain('#12152A');
      expect(html).not.toContain('#252B48');
      expect(html).not.toContain('#0B0D19');
    });

    test('toolbar controls use daisyUI btn and select classes', () => {
      expect(html).toContain('btn btn-xs btn-ghost');
      expect(html).toContain('select select-xs select-ghost');
    });

    test('the drum filter type switch is a daisyUI join', () => {
      expect(html).toContain('join');
      expect(html).toContain('btn btn-xs join-item');
    });

    test('step numbers keep font-mono and the downbeat uses accent', () => {
      expect(html).toContain('font-mono');
      expect(html).toContain('text-accent');
    });

    test('track dots render semantic token backgrounds', () => {
      expect(html).toContain('bg-error');
      expect(html).toContain('bg-warning');
      expect(html).toContain('bg-success');
      expect(html).toContain('bg-accent');
      expect(html).toContain('bg-secondary');
    });

    test('no legacy palette utilities survive', () => {
      for (const cls of [
        'emerald-',
        'indigo-',
        'pink-',
        'rose-',
        'slate-',
        'text-white',
      ]) {
        expect(html).not.toContain(cls);
      }
    });
  });
  ```
  Run `bun test scripts/themeTokenGuard.test.ts src/components/SequencerView.test.tsx`. Expect the guard to list `src/components/SequencerView.tsx` with `raw-hex` hits at 123, 144, 150, 159, 167, 176, 187, 196, 205, 215, 226, 245, 285, 298, 314, 317, 377, 378 and `palette-color` / `absolute-bw` hits at 125, 128, 137, 144, 151, 156, 168, 173, 187, 196, 205, 215, 229, 230, 244, 245, 256, 270, 296, 298, 299, 320, 338, 348, 349, 375, 379, 382 — and the component test to fail on `card bg-base-100`.

- [ ] **13.8 — Header card + master volume (lines 123-147).** Replace line 123:
  ```tsx
  <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2.5 shadow-md">
  ```
  with
  ```tsx
  <div className="card bg-base-100 border border-base-300 shadow-md">
    <div className="card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5">
  ```
  and close the extra `</div>` at line 223 (the header block's closing tag becomes `</div>\n</div>`). Replace lines 125-130:
  ```tsx
  <div className="p-1.5 rounded-lg bg-primary/20 border border-primary/30 text-primary">
    <Grid className="w-4 h-4" />
  </div>
  <h2 className="font-bold text-sm sm:text-base text-base-content">
  ```
  Replace line 137 `<Volume2 className="w-3.5 h-3.5 text-emerald-400" />` with `<Volume2 className="w-3.5 h-3.5 text-primary" />`, and line 144 with `className="range range-primary range-xs w-16 sm:w-20"` (Task 3 made that the `Slider` default; the explicit width still has to be passed, and `accent-emerald-500` / `bg-[#0B0D19]` are dropped because `range-primary` colours the thumb).

- [ ] **13.9 — Genre + kit selects (lines 149-181).** Replace both wrapper divs (lines 150 and 167) with `<div className="flex items-center gap-1 bg-base-200 border border-base-300 px-2 py-1 rounded-lg">`. Line 151 `text-indigo-400` → `text-accent`. Line 168 `text-pink-400` → `text-secondary`. Both `<select>` classNames (lines 156 and 173) become `className="select select-xs select-ghost focus:outline-none"`. Delete `className="bg-[#12152A]"` from the two `<option>` elements at lines 159 and 176 entirely — daisyUI's `select` styles the option list, and an option-level background is what breaks `solva-light`:
  ```tsx
  {Object.keys(GENRE_PRESETS).map((g) => (
    <option key={g} value={g}>
      {g}
    </option>
  ))}
  ```
  Re-run `bun test scripts/themeTokenGuard.test.ts` — the 150/156/159/167/173/176 violations are gone; 184-220 and below still listed.

- [ ] **13.10 — The four toolbar buttons (lines 183-221).** All four share the same replacement shape. Lines 187 and 196 (`btn-shift-left`, `btn-shift-right`):
  ```tsx
  className="btn btn-xs btn-ghost btn-square"
  ```
  Lines 205 and 215 (`btn-randomize-grid`, `btn-clear-grid`):
  ```tsx
  className="btn btn-xs btn-ghost gap-1"
  ```
  Each loses `bg-[#1C213E] border border-[#2D355A] text-slate-300 hover:text-white transition-colors cursor-pointer rounded-lg p-1.5` / `px-2 py-1 text-xs font-medium` — `btn` supplies padding, radius, cursor and hover. Re-run the guard: lines 184-220 clear.

- [ ] **13.11 — Drum filter card + join (lines 225-282).** Line 226 → `<div className="card bg-base-100 border border-base-300 shadow-md">` plus an inner `<div className="card-body p-3 sm:p-4">`, closing the extra `</div>` at line 282. Line 229 `text-pink-400` → `text-secondary`. Line 230 `text-slate-300` → `text-base-content`. Replace the grid at line 236 and the buttons at 238-249:
  ```tsx
  <div className="join">
    {(["lowpass", "bandpass", "highpass"] as const).map((t) => (
      <button
        key={t}
        id={`btn-drum-filter-${t}`}
        onClick={() => setDrumFilterType(t)}
        className={`btn btn-xs join-item text-[10px] font-semibold uppercase ${
          drumFilterType === t ? "btn-secondary" : "btn-ghost"
        }`}
      >
        {t === "lowpass" ? "LPF" : t === "bandpass" ? "BPF" : "HPF"}
      </button>
    ))}
  </div>
  ```
  (`btn-secondary` already applies `text-secondary-content`, so the explicit `text-white` at line 244 disappears.) Lines 256 and 270 `color="text-pink-400"` → `color="text-secondary"` — that is a member of Task 4's narrowed union, so `bun run lint` stays clean. Run `bun run lint` → no output.

- [ ] **13.12 — Grid card + step-number header (lines 285-306).** Line 285 → `<div className="card bg-base-100 border border-base-300 shadow-md">` + `<div className="card-body p-3 sm:p-4 overflow-x-auto">`, closing the extra `</div>` at line 391. Replace the three-way class expression at lines 294-300:
  ```tsx
  className={`flex-1 text-center font-mono text-[10px] py-1 rounded transition-all ${
    isCurrent
      ? "bg-primary text-primary-content font-bold shadow-md shadow-primary/50"
      : isDownbeat
        ? "text-accent font-bold bg-base-300/40"
        : "text-base-content/50"
  }`}
  ```
  The playhead takes `primary` (amber) per docs/design.md; the downbeat marker takes `accent` so it stays legible against the playhead.

- [ ] **13.13 — Track lanes (lines 310-360).** Line 314 → `className="flex items-center gap-2 bg-base-200 p-2 rounded-lg border border-base-300 hover:border-primary/40 transition-colors"`. Line 317 → `className="w-40 flex items-center justify-between pr-2 border-r border-base-300"`. Line 320 `text-slate-200` → `text-base-content`. Line 338 → `className="btn btn-ghost btn-xs btn-square hover:text-primary"`. Lines 346-350 (mute toggle):
  ```tsx
  className={`btn btn-ghost btn-xs btn-square ${
    track.muted ? "bg-error/20 text-error border border-error/30" : ""
  }`}
  ```
  Line 319 needs no edit — `track.color` is already `bg-error` / `bg-warning` / `bg-success` / `bg-accent` / `bg-secondary` after step 13.5.

- [ ] **13.14 — Step cells (lines 364-386).** Replace the class expression at lines 373-383:
  ```tsx
  className={`flex-1 h-9 rounded-md transition-all cursor-pointer relative ${
    isActive
      ? `${track.color} shadow-md shadow-primary/20 scale-[0.96]`
      : isBeatGroup
        ? "bg-base-100 hover:bg-base-300 border border-base-300/50"
        : "bg-base-200 hover:bg-base-300 border border-base-300/40"
  } ${isCurrent ? "ring-2 ring-primary brightness-125" : ""}`}
  >
    {isActive && (
      <div className="absolute inset-0 bg-base-content/10 rounded-md animate-pulse" />
    )}
  ```
  The active-step wash was `bg-white/20`; on `solva-light` a white wash over a light fill is invisible, so it becomes `bg-base-content/10`, which inverts with the theme.

- [ ] **13.15 — Verify green.**
  ```
  bun test scripts/themeTokenGuard.test.ts src/components/SequencerView.test.tsx
  bun run lint
  bun run eslint
  ```
  Expect the guard to no longer list `src/components/SequencerView.tsx`, all 6 `SequencerView.test.tsx` tests passing, and no `tsc` / eslint output.

- [ ] **13.16 — Commit.**
  ```
  git add src/components/SequencerView.tsx src/components/SequencerView.test.tsx scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(sequencer): move SequencerView onto daisyUI semantic tokens

  Panels become card/card-body on base-100, toolbar buttons and selects become
  btn/select, the drum filter switch becomes a join, and the playhead takes
  primary amber per docs/design.md. The active-step wash moves from bg-white/20
  to bg-base-content/10 so it is visible on solva-light.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 14: `ChordView.tsx` (~1075 lines, split into five regions)

**Files:**
- `src/components/ChordView.tsx` (edit)
- `src/components/ChordView.test.tsx` (edit — extend, do not rewrite)
- `scripts/themeTokenGuard.ts` (edit — remove one `ALLOWLIST` entry)

**Interfaces:**
- *Consumes:* Task 1's `success`/`error` tokens; Task 3's `Slider` default `'range range-primary range-xs w-full'`; Task 5's narrowed `ChannelStrip` `accentClass` union `'text-primary' | 'text-secondary' | 'text-accent' | 'text-success' | 'text-error'`; Task 2's guard.
- *Produces:* module-level `SELECT_BASE` / `LABEL_BASE` constants (lines 76-77) become daisyUI class strings reused by all six selects and every field label in the file. No other module imports them (they are not exported) — the contract is internal.

### Guard rail: the existing test must stay green

`src/components/ChordView.test.tsx` already exists and asserts on button ids and `title` copy:

```tsx
expect(html).toContain('btn-preview-chord-pattern');
expect(html).toContain('btn-preview-bass-pattern');
expect(html).toContain('Hold to Preview Chord Pattern Loop');
expect(html).toContain('Hold to Preview Bass Pattern Loop');
expect(html).not.toContain('Chord &amp; Bass Pattern Loop');
expect(html).toContain('Hold to Preview Chord');
expect(html).not.toContain('title="Hold to Preview Chord &amp; Bass Pattern"');
```

Nothing in this task touches an `id`, a `title`, or button copy — only `className` values. Run the file before and after every region.

### Steps

- [ ] **14.1 — Baseline the existing test.** Run:
  ```
  bun test src/components/ChordView.test.tsx
  ```
  Expect `1 pass, 0 fail`. Record that number; it must never drop.

- [ ] **14.2 — Failing guard + new theming test.** Delete `'src/components/ChordView.tsx'` from `ALLOWLIST` in `scripts/themeTokenGuard.ts`. Append a second `describe` block to `src/components/ChordView.test.tsx` (keep the existing one untouched, above it):
  ```tsx
  describe('ChordView theming', () => {
    const html = renderToString(<ChordView />);

    test('panels are daisyUI cards on base tokens', () => {
      expect(html).toContain('card bg-base-100 border border-base-300');
      expect(html).toContain('border-primary/30');
      expect(html).toContain('border-accent/30');
    });

    test('every select is a bordered daisyUI select', () => {
      expect(html).toContain('select select-sm select-bordered');
    });

    test('the library counter badge uses a valid padding step', () => {
      expect(html).toContain('badge badge-sm badge-primary font-mono');
      expect(html).not.toContain('py-0.2');
    });

    test('chord chips are keyboard-reachable buttons with font-mono labels', () => {
      expect(html).toContain('btn btn-xs btn-outline');
      expect(html).toContain('font-mono');
    });

    test('no legacy hex or palette utilities survive', () => {
      for (const s of [
        '#12152A',
        '#171B36',
        '#2D355A',
        '#252B48',
        '#0B0D19',
        '#22284C',
        '#1C213E',
        'indigo-',
        'purple-',
        'emerald-',
        'rose-',
        'slate-',
        'text-white',
      ]) {
        expect(html).not.toContain(s);
      }
    });
  });
  ```
  Run `bun test scripts/themeTokenGuard.test.ts src/components/ChordView.test.tsx`. Expect the guard to list `src/components/ChordView.tsx` with ~70 violations and the new `describe` to fail on `card bg-base-100`; the original `describe` still passes.

- [ ] **14.3 — Region A, the two shared constants (lines 76-77).** These collapse six call sites. Replace:
  ```ts
  const SELECT_BASE =
    "bg-[#171B36] border border-[#2D355A] rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-200";
  const LABEL_BASE = "text-[10px] text-slate-500 block mb-1";
  ```
  with
  ```ts
  const SELECT_BASE = "select select-sm select-bordered font-semibold";
  const LABEL_BASE = "label-text text-[10px] text-base-content/60 block mb-1";
  ```
  Then delete the `hover:bg-[#22284C]` override from all six consumers — lines 583, 620, 639, 953, 989 and 1007 each read
  ```tsx
  className={`${SELECT_BASE} cursor-pointer hover:bg-[#22284C]`}
  ```
  and each becomes
  ```tsx
  className={SELECT_BASE}
  ```
  (`select` already sets `cursor-pointer` and a token hover.) Re-run `bun test scripts/themeTokenGuard.test.ts` — 76, 77, 583, 620, 639, 953, 989, 1007 clear.

- [ ] **14.4 — Region A, header card + mute toggles (lines 436-501).** Line 436:
  ```tsx
  <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2.5 shadow-md relative">
  ```
  →
  ```tsx
  <div className="card bg-base-100 border border-base-300 shadow-md relative">
    <div className="card-body p-3 sm:p-4 flex-row flex-wrap items-center justify-between gap-2.5">
  ```
  (close the extra `</div>` where the header block ends, immediately after the save-toast block). Lines 438 and 441:
  ```tsx
  <div className="p-1.5 rounded-lg bg-primary/20 border border-primary/30 text-primary">
    <Music className="w-4 h-4" />
  </div>
  <h2 className="font-bold text-sm sm:text-base text-base-content">
  ```
  Chord mute button, lines 452-456 → `btn`:
  ```tsx
  className={`btn btn-sm gap-1 text-xs font-semibold ${
    chordMuted ? "btn-error btn-outline" : "btn-ghost"
  }`}
  ```
  Line 460 `text-rose-300` → `text-error`; line 462 `text-indigo-300` → `text-primary`. Bass mute button, lines 470-474, identical shape with `bassMuted`; line 478 `text-rose-300` → `text-error`; line 480 `text-emerald-300` → `text-accent` (bass is the accent/teal module per the role map).

- [ ] **14.5 — Region A, save + library buttons and the toast (lines 490-521).** Line 492:
  ```tsx
  className="flex items-center gap-1 bg-[#171B36] hover:bg-[#22284C] text-slate-200 hover:text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#2D355A] transition-colors cursor-pointer shadow-xs"
  ```
  → `className="btn btn-sm btn-ghost gap-1"`. Line 495 `text-indigo-400` → `text-primary`. Line 503 → `className="btn btn-sm btn-primary gap-1"` (drop `bg-indigo-600 hover:bg-indigo-500 text-white`; `btn-primary` supplies `text-primary-content`). Line 508 — this one has a real non-colour bug, `py-0.2` is not on Tailwind's spacing scale so it emits nothing:
  ```tsx
  <span className="bg-indigo-700/80 text-[10px] px-1 py-0.2 rounded font-mono hidden sm:inline">
  ```
  →
  ```tsx
  <span className="badge badge-sm badge-primary font-mono py-0.5 hidden sm:inline">
  ```
  Toast, lines 516-517:
  ```tsx
  <div className="alert alert-success absolute top-full right-4 mt-2 z-20 w-auto py-1.5 px-3 text-xs shadow-lg animate-in fade-in slide-in-from-top-1">
    <Check className="w-3.5 h-3.5" />
  ```
  Re-run `bun test scripts/themeTokenGuard.test.ts src/components/ChordView.test.tsx` — lines 436-521 clear; the original `describe` still passes (`1 pass` in that block).

- [ ] **14.6 — Commit region A.**
  ```
  git add src/components/ChordView.tsx src/components/ChordView.test.tsx scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(chord): tokenize ChordView header and shared select/label constants

  SELECT_BASE and LABEL_BASE become daisyUI class strings, collapsing six
  inline hover overrides. Header panel becomes a card, mute toggles and the
  save/library actions become btn, and the save toast becomes alert-success.
  Also fixes the invalid py-0.2 on the library counter badge.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **14.7 — Region B, progression panel shell (lines 536-562).** Line 536:
  ```tsx
  <div className="bg-[#12152A] border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-transparent rounded-xl p-4 shadow-xl space-y-3">
  ```
  →
  ```tsx
  <div className="card bg-base-100 border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent rounded-xl p-4 shadow-xl space-y-3">
  ```
  Line 537 `border-b border-[#252B48]` → `border-b border-base-300`. Line 539 `text-slate-200` → `text-base-content`. Lines 544-549 (auto-reharmonized pill):
  ```tsx
  <span
    className="badge badge-sm badge-secondary badge-outline gap-1 animate-in fade-in"
    title="Automatically reharmonized to active scale"
  >
    <Sparkles className="w-3 h-3 text-secondary" />
    <span className="font-mono">
      Auto-Reharmonized to {scaleRoot} {scaleType}
    </span>
  ```
  The `{scaleRoot} {scaleType}` readout at line 549 is a musical readout and gains `font-mono` per docs/design.md. Line 557 → `className="btn btn-xs btn-primary gap-1"`.

- [ ] **14.8 — Region B, the two grouped selects and their option overrides (lines 586-609, 956-979).** In the chord preset select, delete the option/optgroup colour overrides at lines 593 and 599-603 — daisyUI's `select` already styles the native list, and a hard-coded `bg-[#12152A]` option is exactly what breaks `solva-light`:
  ```tsx
  <optgroup key={group.category} label={group.label} className="font-bold">
    {group.presets.map((p) => (
      <option
        key={p.id}
        value={p.name}
        className={p.isFactory ? "" : "text-secondary"}
      >
        {!p.isFactory ? `★ ${p.name}` : p.name}
      </option>
    ))}
  </optgroup>
  ```
  Apply the identical replacement in the bass preset select at lines 963 and 969-973.

- [ ] **14.9 — Region B, pattern preview buttons + feel sliders (lines 652-698).** Line 660:
  ```tsx
  className="p-1.5 rounded-lg border border-[#2D355A] bg-[#171B36] hover:bg-[#22284C] text-indigo-400 transition-colors cursor-pointer select-none"
  ```
  → `className="btn btn-xs btn-ghost btn-square text-primary select-none"`. **Do not touch the `id="btn-preview-chord-pattern"` on line 653 or the `title` on line 661** — `ChordView.test.tsx` asserts both. Line 671 (the feel wrapper; `h-[30px]` is an arbitrary value with no token equivalent — use the `h-8` step, a 2px visual change):
  ```tsx
  <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-lg px-2.5 py-1 text-xs h-8">
  ```
  Lines 672 and 685 `text-slate-500` → `text-base-content/60`. Line 682 → `className="range range-xs range-primary w-20"`. Line 696 `accentClass="text-indigo-400"` → `accentClass="text-primary"` (a member of Task 5's union).

- [ ] **14.10 — Region B, re-harmonize + auto-reharmonize buttons (lines 700-753).** Line 716:
  ```tsx
  className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-md transition-colors cursor-pointer"
  ```
  → `className="btn btn-sm btn-secondary gap-1.5"`. Line 719 `<Sparkles className="w-3.5 h-3.5 text-purple-200" />` → `<Sparkles className="w-3.5 h-3.5" />` (`btn-secondary` already sets `text-secondary-content` on its children). Lines 742-746:
  ```tsx
  className={`btn btn-sm gap-1.5 text-xs font-semibold ${
    autoReharmonize ? "btn-secondary btn-outline" : "btn-ghost"
  }`}
  ```
  Line 750:
  ```tsx
  className={`w-3.5 h-3.5 ${autoReharmonize ? "text-secondary" : "text-base-content/50"}`}
  ```
  Re-run `bun test scripts/themeTokenGuard.test.ts src/components/ChordView.test.tsx`. Lines 536-753 clear; the original `describe` still `1 pass`.

- [ ] **14.11 — Commit region B.**
  ```
  git add src/components/ChordView.tsx
  git commit -m "$(cat <<'EOF'
  refactor(chord): tokenize ChordView progression panel and its controls

  Panel gradient moves to primary, selects drop their hard-coded option
  backgrounds, feel sliders become range-primary, and the re-harmonize pair
  become btn-secondary. ChannelStrip accent moves to the narrowed union.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **14.12 — Region C, quick-add palette shell (lines 757-781).** Line 757 → `<div className="bg-base-100 border border-base-300 rounded-lg p-3 space-y-3">`. Lines 759-760:
  ```tsx
  <div className="flex items-center gap-1.5 text-primary font-medium">
    <Sparkles className="w-3.5 h-3.5 text-primary" />
  ```
  Line 766 `text-slate-400` → `text-base-content/60`. Lines 772-776 (7ths/Triads toggle):
  ```tsx
  className={`btn btn-xs text-[10px] font-semibold ${
    use7thsInQuickAdd ? "btn-primary" : "btn-ghost"
  }`}
  ```

- [ ] **14.13 — Region C, in-scale chord chips (lines 792-829) — a11y fix.** The chip is currently a `<div onClick>`, so it is not keyboard-reachable and has no role. Replace lines 793-799 and 802-804:
  ```tsx
  <button
    key={i}
    type="button"
    onClick={() => addDiatonicChord(i)}
    className="btn btn-xs btn-outline group gap-1.5 h-auto py-1 normal-case"
    title={`Click to add ${formatChordLabel(diatonic.root, diatonic.quality)} (${diatonic.degreeName})`}
  >
    <span className="font-mono text-[10px] text-primary font-bold bg-base-300 px-1.5 py-0.5 rounded">
      {diatonic.degreeName}
    </span>
    <span className="font-mono font-semibold">
      {formatChordLabel(diatonic.root, diatonic.quality)}
    </span>
  ```
  The chord label at line 803 gains `font-mono` (musical readout, docs/design.md). The nested preview `<button>` at lines 805-827 must become a `<span role="button" tabIndex={0}>` so it is not a button inside a button — keep every handler and `onClick={(e) => e.stopPropagation()}` exactly as-is, and set line 823 to:
  ```tsx
  className="p-1 text-base-content/60 hover:text-primary transition-colors ml-0.5 rounded hover:bg-base-300 cursor-pointer select-none"
  ```
  Close the outer element with `</button>` instead of `</div>` at line 828.

- [ ] **14.14 — Region C, borrowed chords (lines 834-886) — same shape.** Line 834 `border-t border-[#252B48]/80` → `border-t border-base-300/80`. Lines 836-837 `text-purple-300` / `text-purple-400` → `text-secondary`. Line 840 `text-slate-400` → `text-base-content/60`. Lines 846-854 and 857-859 — the same `<div onClick>` → `<button>` conversion:
  ```tsx
  <button
    key={i}
    type="button"
    onClick={() => addBorrowedChord(borrowed.root, borrowed.quality)}
    className="btn btn-xs btn-outline btn-secondary group gap-1.5 h-auto py-1 normal-case"
    title={`Click to add ${borrowed.label}: ${formatChordLabel(borrowed.root, borrowed.quality)}`}
  >
    <span className="font-mono text-[10px] text-secondary font-bold bg-base-300 px-1.5 py-0.5 rounded">
      {borrowed.label}
    </span>
    <span className="font-mono font-semibold">
      {formatChordLabel(borrowed.root, borrowed.quality)}
    </span>
  ```
  Nested preview element at lines 860-882 → `<span role="button" tabIndex={0}>` with line 878:
  ```tsx
  className="p-1 text-base-content/60 hover:text-secondary transition-colors ml-0.5 rounded hover:bg-base-300 cursor-pointer select-none"
  ```
  Close with `</button>` at line 883. Re-run `bun test scripts/themeTokenGuard.test.ts src/components/ChordView.test.tsx` — lines 757-887 clear.

- [ ] **14.15 — Commit region C.**
  ```
  git add src/components/ChordView.tsx
  git commit -m "$(cat <<'EOF'
  refactor(chord): tokenize the quick-add and borrowed chord palettes

  In-scale and borrowed chord chips become real <button> elements (they were
  <div onClick> and unreachable by keyboard), chord labels gain font-mono per
  docs/design.md, and indigo/purple move to primary/secondary.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **14.16 — Region D, bass module (lines 927-1069).** Line 927:
  ```tsx
  <div className="mt-4 bg-[#12152A] border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-transparent rounded-xl p-4">
  ```
  →
  ```tsx
  <div className="mt-4 card bg-base-100 border border-accent/30 bg-gradient-to-br from-accent/10 to-transparent rounded-xl p-4">
  ```
  Line 929 `text-emerald-300` → `text-accent`. Line 930 `text-slate-500` → `text-base-content/60`. Line 1028:
  ```tsx
  className="p-1.5 rounded-lg border border-[#2D355A] bg-[#171B36] hover:bg-[#22284C] text-emerald-400 transition-colors cursor-pointer select-none"
  ```
  → `className="btn btn-xs btn-ghost btn-square text-accent select-none"`. **Leave `id="btn-preview-bass-pattern"` (line 1021) and `title="Hold to Preview Bass Pattern Loop"` (line 1029) untouched** — both are asserted by the existing test. Line 1039 → `<div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-lg px-2.5 py-1 text-xs h-8">`. Lines 1040 and 1053 `text-slate-500` → `text-base-content/60`. Line 1050 → `className="range range-xs range-accent w-20"`. Line 1063 `accentClass="text-emerald-400"` → `accentClass="text-accent"`. Line 1066 `sliderClassName="w-full h-1 bg-[#0B0D19] rounded cursor-pointer accent-emerald-500"` → `sliderClassName="range range-xs range-accent w-full"`.

- [ ] **14.17 — Full verification.**
  ```
  bun test scripts/themeTokenGuard.test.ts src/components/ChordView.test.tsx
  bun run lint
  bun run eslint
  ```
  Expect the guard to no longer list `src/components/ChordView.tsx`, `ChordView.test.tsx` to report `6 pass, 0 fail` (1 original + 5 new), and no `tsc` / eslint output.

- [ ] **14.18 — Commit region D.**
  ```
  git add src/components/ChordView.tsx scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(chord): tokenize the ChordView bass module

  Bass panel gradient moves from emerald to accent, its feel/level ranges to
  range-accent, and its ChannelStrip accent to the narrowed union. ChordView is
  now fully off the legacy palette and out of the theme-token guard allowlist.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 15: `src/components/chord/SortableChordCard.tsx`

**Files:**
- `src/components/chord/SortableChordCard.tsx` (edit — 213 lines)
- `src/components/chord/SortableChordCard.test.tsx` (new)
- `scripts/themeTokenGuard.ts` (edit — remove one `ALLOWLIST` entry)

**Interfaces:**
- *Consumes:* Task 1's `error` token; Task 2's guard. Rendered by `ChordView.tsx:906-918` with props `chord`, `idx`, `totalChords`, `startBar`, `isActive`, `updateChord`, `removeChord`, `handleCardPreviewMouseDown`, `handleCardPreviewMouseUp` — **the prop signature does not change in this task**.
- *Produces:* nothing new is exported. The three `id` attributes `btn-remove-chord-${chord.id}`, `btn-play-chord-${chord.id}`, `select-chord-root-${chord.id}` / `select-chord-quality-${chord.id}` / `select-chord-bars-${chord.id}` are preserved verbatim.

### Steps

- [ ] **15.1 — Failing guard + failing component test.** Delete `'src/components/chord/SortableChordCard.tsx'` from `ALLOWLIST` in `scripts/themeTokenGuard.ts`. Create `src/components/chord/SortableChordCard.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { SortableChordCard } from './SortableChordCard';

  const chord = {
    id: 'chord-1',
    root: 'A',
    quality: 'min7',
    bars: 1,
    notes: ['A3', 'C4', 'E4', 'G4'],
  };

  const noop = () => {};

  const render = (isActive: boolean) =>
    renderToString(
      <SortableChordCard
        chord={chord}
        idx={0}
        totalChords={4}
        startBar={1}
        isActive={isActive}
        updateChord={noop}
        removeChord={noop}
        handleMoveChord={noop}
        handleCardPreviewMouseDown={noop}
        handleCardPreviewMouseUp={noop}
      />
    );

  describe('SortableChordCard theming', () => {
    test('the card shell is a daisyUI card on base tokens', () => {
      const html = render(false);
      expect(html).toContain('card bg-base-100 border border-base-300');
      expect(html).not.toContain('#0B0D19');
      expect(html).not.toContain('#252B48');
      expect(html).not.toContain('#12152A');
    });

    test('the active state rings primary', () => {
      const html = render(true);
      expect(html).toContain('border-primary ring-2 ring-primary/50 bg-base-200');
      expect(html).toContain('from-primary to-secondary text-primary-content');
    });

    test('bar counter and note readout are mono badges/text', () => {
      const html = render(false);
      expect(html).toContain('badge badge-sm badge-ghost font-mono');
      expect(html).toContain('font-mono');
    });

    test('header controls are daisyUI ghost buttons', () => {
      const html = render(false);
      expect(html).toContain('btn btn-ghost btn-xs');
      expect(html).toContain('hover:text-error');
    });

    test('the three edit selects are bordered daisyUI selects', () => {
      const html = render(false);
      expect(html).toContain('select select-xs select-bordered w-full');
    });

    test('no legacy palette utilities survive', () => {
      const html = render(true);
      for (const s of ['indigo-', 'purple-', 'rose-', 'slate-', 'text-white', 'scale-102']) {
        expect(html).not.toContain(s);
      }
    });
  });
  ```
  Run `bun test scripts/themeTokenGuard.test.ts src/components/chord/SortableChordCard.test.tsx`. Expect the guard to list `src/components/chord/SortableChordCard.tsx` (`raw-hex` at 58, 60, 61, 62, 76, 121, 137, 146, 164, 203; `palette-color` at 60, 61, 62, 71, 76, 85, 94, 102, 120, 127, 131, 139, 157, 194; `absolute-bw` at 85, 94, 120; `invalid-utility` `scale-102` at 62) and the component test to fail on `card bg-base-100`.

- [ ] **15.2 — Card shell (lines 58-62).** Replace:
  ```tsx
  className={`bg-[#0B0D19] border rounded-xl p-4 flex flex-col justify-between space-y-3 transition-colors ${
    isActive
      ? "border-indigo-400 ring-2 ring-indigo-500/50 bg-[#161B36]"
      : "border-[#252B48] hover:border-[#3B4371]"
  } ${isDragging ? "shadow-2xl ring-2 ring-indigo-500 bg-[#161B36]/95 scale-102" : ""}`}
  ```
  with
  ```tsx
  className={`card bg-base-100 border border-base-300 rounded-xl p-4 flex flex-col justify-between space-y-3 transition-colors ${
    isActive
      ? "border-primary ring-2 ring-primary/50 bg-base-200"
      : "border-base-300 hover:border-base-content/30"
  } ${isDragging ? "shadow-2xl ring-2 ring-primary bg-base-200/95 scale-105" : ""}`}
  ```
  **`scale-102` is not a stock Tailwind class** — Tailwind ships `scale-95/100/105/110/125/150`, so `scale-102` currently emits nothing and the drag state has no lift at all today. `scale-105` is the nearest real step; the visual tradeoff is a slightly stronger 5% lift while dragging instead of the intended (never-rendered) 2%.

- [ ] **15.3 — Verify the drag branch still applies.** The `isDragging` branch is the third template slot on line 62 and is driven by `useSortable`. Confirm it is unchanged apart from the class strings:
  ```
  grep -n "isDragging" src/components/chord/SortableChordCard.tsx
  ```
  Expect exactly the pre-existing occurrences — the `zIndex: isDragging ? 50 : 1` on line 51 (inline `style`, untouched) and the class branch on line 62. The `style` object (lines 48-52) and the `{...attributes} {...listeners}` spread on lines 69-70 must not be touched: `@dnd-kit` applies the transform through `style`, so only the visual chrome moved.

- [ ] **15.4 — Header row (lines 67-107).** Line 71 → `className="btn btn-ghost btn-xs btn-square cursor-grab active:cursor-grabbing text-base-content/50 hover:text-base-content focus:outline-none"`. Line 76:
  ```tsx
  <span className="text-[10px] font-mono font-bold text-slate-400 bg-[#1C213E] px-2 py-0.5 rounded">
  ```
  → `<span className="badge badge-sm badge-ghost font-mono font-bold">`. Lines 85 and 94 (`text-slate-400 hover:text-white` — pure white is invisible on `solva-light`) both become `className="btn btn-ghost btn-xs btn-square disabled:opacity-30"`. Line 102 → `className="btn btn-ghost btn-xs btn-square hover:text-error ml-1"`. Leave `id={`btn-remove-chord-${chord.id}`}` on line 100 exactly as-is.

- [ ] **15.5 — Chord trigger pad (lines 118-133).** Lines 118-122:
  ```tsx
  className={`w-full py-4 rounded-lg flex flex-col items-center justify-center transition-all cursor-pointer select-none ${
    isActive
      ? "bg-gradient-to-tr from-primary to-secondary text-primary-content shadow-lg scale-98"
      : "bg-base-200 hover:bg-base-300 text-base-content"
  }`}
  ```
  Lines 125-131 — the note name is the card's primary musical readout and currently has no `font-mono`; add it:
  ```tsx
  <span className="text-2xl font-mono font-black tracking-tight flex items-baseline gap-1">
    {chord.root}
    <span className="text-sm font-semibold text-secondary">
      {formatChordQuality(chord.quality)}
    </span>
  </span>
  <span className="text-[10px] text-base-content/60 font-mono mt-1">
  ```

- [ ] **15.6 — Edit controls (lines 137-209).** Line 137 `border-t border-[#252B48]/60` → `border-t border-base-300/60`. The three labels at lines 139, 157 and 194 all read `className="text-[10px] text-slate-500 block mb-0.5"` → `className="label-text text-[10px] text-base-content/60 block mb-0.5"`. The three selects at lines 146, 164 and 203 all read:
  ```tsx
  className="w-full bg-[#12152A] border border-[#2D355A] text-slate-200 text-xs rounded p-1"
  ```
  and all become
  ```tsx
  className="select select-xs select-bordered w-full"
  ```
  Every colour class is deleted — daisyUI's `select` carries the background, border, text colour and padding; leaving `bg-[#12152A]` would keep a dark box in `solva-light`. The `<optgroup>` / `<option>` children (lines 148-152, 166-189, 205-207) carry no classes and stay untouched.

- [ ] **15.7 — Verify green.**
  ```
  bun test scripts/themeTokenGuard.test.ts src/components/chord/SortableChordCard.test.tsx src/components/ChordView.test.tsx
  bun run lint
  bun run eslint
  ```
  Expect the guard to no longer list `src/components/chord/SortableChordCard.tsx`, 6 passing card tests, `ChordView.test.tsx` still fully green (it renders this card for every chord), and no `tsc` / eslint output.

- [ ] **15.8 — Commit.**
  ```
  git add src/components/chord/SortableChordCard.tsx src/components/chord/SortableChordCard.test.tsx scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(chord): tokenize SortableChordCard

  Card shell becomes a daisyUI card on base tokens, the active/drag rings move
  to primary, the trigger pad gradient to primary→secondary, and the three edit
  selects to select-xs select-bordered. Also replaces the non-existent
  scale-102 drag class with scale-105 and gives the note readout font-mono.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 16: `src/components/ChordPresetLibrary.tsx`

**Files:**
- `src/components/ChordPresetLibrary.tsx` (edit)
- `src/components/ChordPresetLibrary.test.tsx` (new)
- `scripts/themeTokenGuard.ts` (edit — remove one `ALLOWLIST` entry)

**Interfaces:**
- *Consumes:* the `PresetLibrary` contract rebuilt by Task 7 — `src/components/ui/PresetLibrary.tsx` on `drawer` + `modal` + `input`/`select`/`btn`/`badge`, with its variant-class constants (previously lines 124-148) tokenized. **Read `src/components/ui/PresetLibrary.tsx` at execution time** before editing, to confirm the current shape of `PresetCategory` (does it still carry `badgeClass`?), of the `listContainerClass` prop, and of the `variant` prop values. If Task 7 removed `badgeClass` from `PresetCategory`, drop the nine `badgeClass` keys entirely instead of retokenizing them and note that in the commit body.
- *Produces:* `BASE_CHORD_CATEGORIES[].badgeClass` is now `'badge badge-primary'` (a complete daisyUI badge class list, not a colour fragment). Any consumer must render it as the whole `className` plus at most a size modifier.

### Steps

- [ ] **16.1 — Read the Task 7 contract.**
  ```
  sed -n '1,80p' src/components/ui/PresetLibrary.tsx
  grep -n "badgeClass\|listContainerClass\|variant" src/components/ui/PresetLibrary.tsx
  ```
  Note whether `PresetCategory.badgeClass` still exists. The steps below assume it does; if it does not, apply step 16.3 as a deletion.

- [ ] **16.2 — Failing guard + failing component test.** Delete `'src/components/ChordPresetLibrary.tsx'` from `ALLOWLIST` in `scripts/themeTokenGuard.ts`. Create `src/components/ChordPresetLibrary.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { ChordPresetLibrary } from './ChordPresetLibrary';

  const noop = () => {};

  const html = renderToString(
    <ChordPresetLibrary
      isOpen
      onClose={noop}
      currentChords={[
        { id: 'chord-1', root: 'A', quality: 'min7', bars: 1, notes: ['A3', 'C4', 'E4', 'G4'] },
      ]}
      scaleRoot="C"
      scaleType="major"
      autoReharmonize
      synthParams={{}}
      onApplyChords={noop}
    />
  );

  describe('ChordPresetLibrary theming', () => {
    test('template and custom cards are daisyUI cards on base tokens', () => {
      expect(html).toContain('card bg-base-200 border border-base-300');
      expect(html).toContain('hover:border-primary/50');
      expect(html).toContain('hover:border-secondary/50');
    });

    test('tags are daisyUI badges with a valid padding step', () => {
      expect(html).toContain('badge badge-sm');
      expect(html).not.toContain('py-0.2');
    });

    test('card actions are daisyUI buttons', () => {
      expect(html).toContain('btn btn-xs btn-ghost');
      expect(html).toContain('btn btn-xs btn-primary');
      expect(html).toContain('hover:btn-error');
    });

    test('the footer sits on base tokens', () => {
      expect(html).toContain('border-t border-base-300 bg-base-200');
      expect(html).toContain('btn btn-sm btn-ghost');
    });

    test('no legacy hex or palette utilities survive', () => {
      for (const s of [
        '#0B0D19',
        '#252B48',
        '#2D355A',
        '#171B36',
        '#20264A',
        '#1C213E',
        '#0E1022',
        '#1A1F3B',
        'indigo-',
        'purple-',
        'red-',
        'slate-',
        'text-white',
      ]) {
        expect(html).not.toContain(s);
      }
    });
  });
  ```
  Run `bun test scripts/themeTokenGuard.test.ts src/components/ChordPresetLibrary.test.tsx`. Expect the guard to list `src/components/ChordPresetLibrary.tsx` (`palette-color` + `absolute-bw` at 43-51, 273, 286, 288, 302, 303, 321, 328, 329, 333, 336, 339, 340, 350, 364, 387, 390, 394, 395, 399, 403, 407, 408, 432, 440, 464, 472, 481; `raw-hex` at 317, 324, 351, 383, 419, 440, 459, 464, 472, 500; `invalid-utility` `py-0.2` at 324, 328, 390, 394) and the component test red.

- [ ] **16.3 — Category badge classes (lines 42-52).** All nine entries carry the identical `badgeClass: 'bg-indigo-600 text-white'`. Replace every one with `badgeClass: 'badge badge-primary'`:
  ```ts
  const BASE_CHORD_CATEGORIES: PresetCategory[] = [
    { id: 'All', label: 'All', badgeClass: 'badge badge-primary', description: '' },
    { id: 'User', label: 'User', badgeClass: 'badge badge-primary', description: '' },
    { id: 'Pop & EDM', label: 'Pop & EDM', badgeClass: 'badge badge-primary', description: '' },
    { id: 'Jazz & Neo-Soul', label: 'Jazz & Neo-Soul', badgeClass: 'badge badge-primary', description: '' },
    { id: 'Lofi & R&B', label: 'Lofi & R&B', badgeClass: 'badge badge-primary', description: '' },
    { id: 'Anime & J-Pop', label: 'Anime & J-Pop', badgeClass: 'badge badge-primary', description: '' },
    { id: 'Rock & Blues', label: 'Rock & Blues', badgeClass: 'badge badge-primary', description: '' },
    { id: 'Cinematic & Modal', label: 'Cinematic & Modal', badgeClass: 'badge badge-primary', description: '' },
    { id: 'Classical & Baroque', label: 'Classical & Baroque', badgeClass: 'badge badge-primary', description: '' },
  ];
  ```

- [ ] **16.4 — Group headers (lines 273-291).** Line 273 `text-purple-400` → `text-secondary`. Line 286 `text-slate-400` → `text-base-content/60`. Line 288 `text-indigo-400` → `text-primary`.

- [ ] **16.5 — Empty state (lines ~300-308).** Read the block first:
  ```
  sed -n '300,310p' src/components/ChordPresetLibrary.tsx
  ```
  Replace `text-slate-500` with `text-base-content/50` and `text-slate-400` with `text-base-content/60` in it; leave the copy unchanged.

- [ ] **16.6 — Template card (lines 316-372).** Line 317:
  ```tsx
  <div className="p-3 rounded-xl bg-[#0B0D19] border border-[#252B48] hover:border-indigo-500/50 transition-all flex flex-col gap-2 group relative shadow-xs">
  ```
  →
  ```tsx
  <div className="card bg-base-200 border border-base-300 hover:border-primary/50 p-3 rounded-xl transition-all flex flex-col gap-2 group relative shadow-xs">
  ```
  Line 321 → `className="font-bold text-xs text-base-content group-hover:text-primary transition-colors truncate"`. Line 324 (also fixes the invalid `py-0.2`):
  ```tsx
  <span className="badge badge-sm bg-base-300 text-primary font-mono py-0.5 shrink-0">
  ```
  Line 328 → `<span className="badge badge-sm badge-secondary badge-outline py-0.5 gap-0.5">`, and line 329 `<Sparkles className="w-2.5 h-2.5 text-secondary" />`. Line 333 `text-purple-400` → `text-secondary`. Line 336 `text-slate-400` → `text-base-content/60`. Lines 339-340 `text-slate-500` → `text-base-content/50` and the inner `text-slate-300` → `text-base-content`. Audition button, lines 348-352:
  ```tsx
  className={`btn btn-xs ${
    auditioningName === tpl.name
      ? 'btn-primary animate-pulse'
      : 'btn-ghost text-primary'
  }`}
  ```
  Load button, line 364 → `className="btn btn-xs btn-primary gap-1"`.

- [ ] **16.7 — Custom card (lines 382-448).** Line 383 → `className="card bg-base-200 border border-base-300 hover:border-secondary/50 p-3 rounded-xl transition-all flex flex-col gap-2 group relative shadow-xs"`. Line 387 `text-slate-200` → `text-base-content`. Line 390 → `<span className="badge badge-sm badge-secondary badge-outline font-mono py-0.5">`. Line 394 → `<span className="badge badge-sm badge-secondary badge-outline py-0.5 gap-0.5">` with line 395 `<Sparkles className="w-2.5 h-2.5 text-secondary" />`. Line 399 `text-indigo-400` → `text-primary`. Line 403 `text-slate-400` → `text-base-content/60`. Lines 407-408 `text-slate-500` → `text-base-content/50`, inner `text-slate-300` → `text-base-content`. Audition button, lines 416-420:
  ```tsx
  className={`btn btn-xs ${
    auditioningName === e.name
      ? 'btn-secondary animate-pulse'
      : 'btn-ghost text-secondary'
  }`}
  ```
  Load button, line 432 → `className="btn btn-xs btn-primary gap-1"`. Delete button, line 440:
  ```tsx
  className="p-1.5 rounded-lg bg-[#171B36] hover:bg-red-950/80 text-slate-400 hover:text-red-400 border border-[#2D355A] hover:border-red-800/50 transition-colors cursor-pointer"
  ```
  → `className="btn btn-xs btn-ghost hover:btn-error"`.

- [ ] **16.8 — Footer + list container (lines 458-500).** Line 459 → `<div className="p-3 border-t border-base-300 bg-base-200 flex items-center justify-between gap-2">`. Lines 464 and 472 both read `bg-[#1A1F3B] hover:bg-[#252B48] … text-slate-300 hover:text-white … border border-[#2D355A]` and both become `className="btn btn-sm btn-ghost gap-1 hover:text-base-content disabled:opacity-40"` — `hover:text-white` is what breaks the light theme, since white-on-light is unreadable. Line 481 `text-slate-500` → `text-base-content/50`. Line 500 `divide-y divide-[#1C213E]/60` → `divide-y divide-base-300/60`.

- [ ] **16.9 — Verify green.**
  ```
  bun test scripts/themeTokenGuard.test.ts src/components/ChordPresetLibrary.test.tsx
  bun run lint
  bun run eslint
  ```
  Expect the guard to no longer list `src/components/ChordPresetLibrary.tsx`, 5 passing tests, and no `tsc` / eslint output.

- [ ] **16.10 — Commit.**
  ```
  git add src/components/ChordPresetLibrary.tsx src/components/ChordPresetLibrary.test.tsx scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(chord): tokenize ChordPresetLibrary onto daisyUI cards and badges

  All nine category badgeClass values become 'badge badge-primary', template
  and custom cards become card bg-base-200, tags become badges, and the card
  actions become btn-xs. Also fixes the invalid py-0.2 on four tag spans and
  the hover:text-white in the footer, which was unreadable on solva-light.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 17: `src/audio/synthPresets.ts` badge data + `src/components/SynthPresetLibrary.tsx`

**Files:**
- `src/audio/synthPresets.ts` (edit — lines 27, 34, 41, 48, 55, 62, 69, 76, 768, 799)
- `src/audio/synthPresets.test.ts` (new)
- `src/components/SynthPresetLibrary.tsx` (edit)
- `src/components/SynthPresetLibrary.test.tsx` (new)
- `scripts/themeTokenGuard.ts` (edit — remove two `ALLOWLIST` entries)

**Interfaces:**
- *Consumes:* Task 1's `success` token; Task 2's guard; Task 7's rebuilt `PresetLibrary` contract (read `src/components/ui/PresetLibrary.tsx` at execution time to confirm `PresetCategory` still carries `badgeClass` and what `toolbarActions` / `footer` expect).
- *Produces:* **`SynthPresetCategoryMeta.badgeClass` and `CategoryPresetGroup.badgeClass` change shape.** They were colour fragments meant to be combined with the caller's own `rounded border px-1.5 py-0.5` chrome; they are now *complete* daisyUI badge class lists that always start with `badge `. Every consumer must render `badgeClass` as the full class list plus at most a size modifier (`badge-xs` / `badge-sm`) and `font-mono`, and must **not** add `rounded`, `border`, `px-*` or `py-*`. Consumers today: `SynthPresetLibrary.tsx:202`, `SynthPresetLibrary.tsx:272`, `SynthView.tsx:526`, `SynthView.tsx:605`. **Task 18 (SynthView) consumes this same contract** and must update lines 526 and 605 accordingly; this task fixes only the two `SynthPresetLibrary` call sites, so `SynthView.tsx` will temporarily render `badge` classes inside its own chrome — visually acceptable (the badge simply overrides the padding) and it stays on the guard allowlist until Task 18.

### The ten badgeClass values

| line | category | old value | new value |
|---|---|---|---|
| 27 | Bass | `bg-emerald-500/20 text-emerald-300 border-emerald-500/30` | `badge badge-accent` |
| 34 | Lead | `bg-pink-500/20 text-pink-300 border-pink-500/30` | `badge badge-secondary` |
| 41 | Pad | `bg-indigo-500/20 text-indigo-300 border-indigo-500/30` | `badge badge-primary` |
| 48 | Keys | `bg-cyan-500/20 text-cyan-300 border-cyan-500/30` | `badge badge-accent badge-outline` |
| 55 | Pluck | `bg-amber-500/20 text-amber-300 border-amber-500/30` | `badge badge-primary badge-outline` |
| 62 | Brass | `bg-orange-500/20 text-orange-300 border-orange-500/30` | `badge badge-primary badge-soft` |
| 69 | FX | `bg-purple-500/20 text-purple-300 border-purple-500/30` | `badge badge-secondary badge-soft` |
| 76 | User | `bg-violet-500/20 text-violet-300 border-violet-500/30` | `badge badge-success badge-outline` |
| 768 | fallback in `getPresetsGroupedByCategory` | `bg-slate-700/50 text-slate-300 border-slate-600` | `badge badge-ghost` |
| 799 | fallback in `getCategoryMeta` | `bg-slate-700/50 text-slate-300 border-slate-600` | `badge badge-ghost` |

Rationale: `Bass` is the accent/teal module in the role map, `Lead`/`FX` map onto secondary coral (they were pink/purple), `Pad`/`Pluck`/`Brass` onto primary amber (indigo/amber/orange), `Keys` keeps cyan's accent hue with an outline so it reads distinctly from `Bass`, and `User` — the "saved to browser storage" bucket — takes `success`, matching the role map's "emerald as OK/saved". The two unknown-category fallbacks take `badge-ghost`, the only neutral badge in daisyUI and the correct read for "category we do not recognise".

### Steps

- [ ] **17.1 — Failing guard + failing data test.** Delete `'src/audio/synthPresets.ts'` from `ALLOWLIST` in `scripts/themeTokenGuard.ts`. Create `src/audio/synthPresets.test.ts`:
  ```ts
  import { describe, expect, test } from 'bun:test';
  import { SYNTH_CATEGORIES, getCategoryMeta } from './synthPresets';

  const PALETTE =
    /\b(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

  describe('SYNTH_CATEGORIES badge classes', () => {
    test('no category carries a raw Tailwind palette colour', () => {
      for (const meta of SYNTH_CATEGORIES) {
        expect(meta.badgeClass).not.toMatch(PALETTE);
      }
    });

    test('every badgeClass is a complete daisyUI badge class list', () => {
      for (const meta of SYNTH_CATEGORIES) {
        expect(meta.badgeClass.startsWith('badge ')).toBe(true);
      }
    });

    test('the eight categories map onto the documented tokens', () => {
      expect(
        Object.fromEntries(SYNTH_CATEGORIES.map((m) => [m.id, m.badgeClass]))
      ).toEqual({
        Bass: 'badge badge-accent',
        Lead: 'badge badge-secondary',
        Pad: 'badge badge-primary',
        Keys: 'badge badge-accent badge-outline',
        Pluck: 'badge badge-primary badge-outline',
        Brass: 'badge badge-primary badge-soft',
        FX: 'badge badge-secondary badge-soft',
        User: 'badge badge-success badge-outline',
      });
    });

    test('the unknown-category fallback is a neutral badge', () => {
      expect(getCategoryMeta('Nope' as never).badgeClass).toBe('badge badge-ghost');
    });
  });
  ```
  Run `bun test scripts/themeTokenGuard.test.ts src/audio/synthPresets.test.ts`. Expect the guard to list `src/audio/synthPresets.ts` with ten `palette-color` violations at 27, 34, 41, 48, 55, 62, 69, 76, 768, 799, and all four data tests red.

- [ ] **17.2 — Apply the ten badgeClass edits.** Make exactly the ten replacements in the table above in `src/audio/synthPresets.ts`. Verify:
  ```
  grep -n "badgeClass" src/audio/synthPresets.ts
  ```
  Expect ten lines, every value starting with `badge `. Run `bun test scripts/themeTokenGuard.test.ts src/audio/synthPresets.test.ts` → guard no longer lists `src/audio/synthPresets.ts`, 4 data tests pass.

- [ ] **17.3 — Commit the data layer.**
  ```
  git add src/audio/synthPresets.ts src/audio/synthPresets.test.ts scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(audio): make synth category badgeClass a daisyUI badge class list

  The eight category badges and the two unknown-category fallbacks were raw
  Tailwind palette fragments that consumers wrapped in their own chrome. They
  are now complete daisyUI badge class lists on accent/secondary/primary/
  success, guarded by a unit test over the exported category array.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **17.4 — Failing guard + failing component test for SynthPresetLibrary.** Delete `'src/components/SynthPresetLibrary.tsx'` from `ALLOWLIST`. Read the Task 7 contract first:
  ```
  grep -n "badgeClass\|toolbarActions\|footer\|renderEntry" src/components/ui/PresetLibrary.tsx
  ```
  Create `src/components/SynthPresetLibrary.test.tsx`:
  ```tsx
  import { describe, expect, test } from 'bun:test';
  import { renderToString } from 'react-dom/server';
  import { SynthPresetLibrary } from './SynthPresetLibrary';
  import { INITIAL_SYNTH_PARAMS } from '../store/initialState';

  const noop = () => {};

  const html = renderToString(
    <SynthPresetLibrary
      isOpen
      onClose={noop}
      currentParams={INITIAL_SYNTH_PARAMS}
      onSelectPreset={noop}
    />
  );

  describe('SynthPresetLibrary theming', () => {
    test('preset cards sit on base tokens', () => {
      expect(html).toContain('bg-base-200');
      expect(html).toContain('border-base-300');
      expect(html).toContain('hover:border-primary/50');
    });

    test('category badges come through as complete daisyUI badges', () => {
      expect(html).toContain('badge badge-primary');
      expect(html).toContain('badge badge-accent');
    });

    test('sound attribute chips are ghost mono badges', () => {
      expect(html).toContain('badge badge-sm badge-ghost font-mono');
      expect(html).not.toContain('py-0.2');
    });

    test('card actions and footer use daisyUI buttons', () => {
      expect(html).toContain('btn btn-xs btn-ghost');
      expect(html).toContain('btn btn-sm btn-ghost');
      expect(html).toContain('border-t border-base-300 bg-base-200');
    });

    test('the preset card exposes a real button, not a clickable div', () => {
      expect(html).toContain('<button');
      expect(html).toContain('card');
    });

    test('no legacy hex or palette utilities survive', () => {
      for (const s of [
        '#0B0D19',
        '#252B48',
        '#12152A',
        '#161B36',
        '#1E2344',
        '#1A1F3A',
        '#0E1022',
        '#151933',
        'indigo-',
        'pink-',
        'slate-',
        'red-',
        'text-white',
      ]) {
        expect(html).not.toContain(s);
      }
    });
  });
  ```
  Run `bun test scripts/themeTokenGuard.test.ts src/components/SynthPresetLibrary.test.tsx`. Expect the guard to list `src/components/SynthPresetLibrary.tsx` (`palette-color`/`absolute-bw` at 77, 87, 205, 208, 229, 230, 233, 256, 257, 263, 267, 279, 285, 287, 291, 304, 316, 336, 343, 355, 356, 359; `raw-hex` at 200, 257, 286, 290, 304, 316, 336, 343, 355, 359; `invalid-utility` `py-0.2` at 267, 272) and the component test red.

- [ ] **17.5 — Category chips (lines 75-94).** Line 77 and line 87 both read `badgeClass: 'bg-indigo-600 text-white',` → `badgeClass: 'badge badge-primary',`.

- [ ] **17.6 — Group header (lines 199-213).** Line 200 `border-b border-[#1E2344]` → `border-b border-base-300`. Line 202 — the wrapper's own `rounded border px-2 py-0.5` now conflicts with the badge contract and must go:
  ```tsx
  <span className={`${group.badgeClass} badge-sm font-mono font-semibold`}>
  ```
  Line 205 `text-slate-200` → `text-base-content`. Line 208 (`max-w-[160px]` is an arbitrary value with a stock equivalent):
  ```tsx
  <span className="text-[10px] text-base-content/50 truncate max-w-40">
  ```

- [ ] **17.7 — Empty state (lines 228-238).** Line 229 `text-slate-500` → `text-base-content/50`. Line 230 `text-indigo-400` → `text-primary`. Line 233 → `className="link link-primary text-xs"` (drop `text-indigo-400 hover:underline`; `link` supplies the underline-on-hover).

- [ ] **17.8 — Preset card shell + a11y (lines 251-259).** The card is a `<div onClick>` with no role or tab stop — keyboard users cannot select a preset at all. Wrap a real button:
  ```tsx
  <div
    className={`card p-0 border transition-all group relative ${
      isCurrent
        ? 'bg-primary/10 border-primary shadow-md ring-1 ring-primary/50'
        : 'bg-base-200 border-base-300 hover:border-primary/50 hover:bg-base-300'
    }`}
  >
    <button
      type="button"
      onClick={() => onSelectPreset(preset)}
      className="w-full text-left p-3 cursor-pointer"
    >
  ```
  and close it with `</button>` immediately before the card's closing `</div>`. The two action buttons at lines 299-321 must move **outside** that inner `<button>` (nested buttons are invalid HTML) — place them in an absolutely-positioned row on the card: `<div className="absolute top-3 right-3 flex items-center gap-1 shrink-0">`, and drop the now-unnecessary `ev.stopPropagation()` calls on lines 301 and 313.

- [ ] **17.9 — Preset card contents (lines 262-294).** Line 263 → `className="font-semibold text-xs text-base-content truncate group-hover:text-primary transition-colors"`. Line 267 (also fixes `py-0.2`):
  ```tsx
  <span className="badge badge-xs badge-primary py-0.5 font-bold uppercase tracking-wider">
  ```
  Line 271-273 — `badgeClass` is now complete, so the wrapper chrome goes:
  ```tsx
  <span className={`${meta.badgeClass} badge-xs py-0.5 font-mono`}>
  ```
  Line 279 `text-slate-400` → `text-base-content/60`. Line 285 `text-slate-400` → `text-base-content/60`. Lines 286 and 290 both read `bg-[#12152A] px-1.5 py-0.5 rounded border border-[#252B48] flex items-center gap-1` → `badge badge-sm badge-ghost font-mono gap-1`. Line 287 `text-indigo-400` → `text-primary`. Line 291 `text-pink-400` → `text-accent` (the filter chip sits next to the oscillator chip; accent teal keeps the pair distinguishable while secondary coral is reserved for the harmony layer).

- [ ] **17.10 — Card action buttons (lines 299-321).** Line 304:
  ```tsx
  className="p-1.5 rounded-lg bg-[#161B36] hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors border border-[#252B48] cursor-pointer"
  ```
  → `className="btn btn-xs btn-ghost btn-square hover:btn-primary"`. Line 316:
  ```tsx
  className="p-1.5 rounded-lg bg-[#161B36] hover:bg-red-600 text-slate-400 hover:text-white transition-colors border border-[#252B48] cursor-pointer"
  ```
  → `className="btn btn-xs btn-ghost btn-square hover:btn-error"`.

- [ ] **17.11 — Toolbar + footer (lines 331-364).** Lines 336 and 343 both read `px-2.5 py-2 bg-[#0B0D19] hover:bg-[#1A1F3A] … text-slate-300 … border border-[#252B48]` and both become `className="btn btn-sm btn-ghost btn-square disabled:opacity-40"` (the `<label>` on line 342 keeps `cursor-pointer` via `btn`; leave its hidden `<input type="file">` on line 347 untouched). Line 355 → `<div className="p-3 border-t border-base-300 bg-base-200 flex items-center justify-between text-[11px] text-base-content/60">`. Line 359 → `className="btn btn-sm btn-ghost font-medium"`.

- [ ] **17.12 — Verify green.**
  ```
  bun test scripts/themeTokenGuard.test.ts src/audio/synthPresets.test.ts src/components/SynthPresetLibrary.test.tsx
  bun run lint
  bun run eslint
  ```
  Expect the guard to list neither `src/audio/synthPresets.ts` nor `src/components/SynthPresetLibrary.tsx`, 4 + 6 tests passing, and no `tsc` / eslint output. Then run the whole suite to confirm nothing upstream broke:
  ```
  bun test
  ```
  Expect every test green; `src/components/SynthView.tsx` is still on the allowlist and unaffected at runtime because a `badge …` string dropped into its existing wrapper simply overrides the wrapper's padding.

- [ ] **17.13 — Commit.**
  ```
  git add src/components/SynthPresetLibrary.tsx src/components/SynthPresetLibrary.test.tsx scripts/themeTokenGuard.ts
  git commit -m "$(cat <<'EOF'
  refactor(synth): tokenize SynthPresetLibrary onto daisyUI cards and badges

  Consumes the new complete-badge-class contract from synthPresets, drops the
  wrapper chrome around every badgeClass, moves cards onto base-200/base-300
  and actions onto btn-xs. The preset card becomes a real <button> (it was a
  <div onClick> with no tab stop) and the invalid py-0.2 spans are fixed.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```
## Task 18: `src/components/SynthView.tsx` — the last and largest component

**Files:**
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/SynthView.tsx` (1338 lines)
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts` (remove one `ALLOWLIST` entry, step 18.1)
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/ui/Keyboard.tsx` (export `KEYBOARD_NOTES`, step 18.13)
- Test (must stay green, do **not** rewrite): `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/SynthView.test.tsx`
- Test (drives the work): `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.test.ts`

**Interfaces:**
- **Consumes:**
  - `src/index.css` semantic tokens from Task 1 (`success`, `error`, `warning`, `info` + their `-content` pairs) — needed by the ADSR section (`success`) and the save toast (`alert alert-success`).
  - `scripts/themeTokenGuard.ts` from Task 2 — `scanRepo(rootDir)`, `RULES`, `ALLOWLIST`.
  - `src/components/ui/Knob.tsx` from Task 4 — the `color` prop is now the union `'text-primary' | 'text-secondary' | 'text-accent' | 'text-success' | 'text-error'`. Passing `"text-pink-400"` after Task 4 is a **type error**, so `bun run lint` alone will catch a missed knob.
  - `src/components/ui/QuickSavePopover.tsx` from Task 8 — `inputClassName` / `buttonClassName` / `selectClassName` already default to daisyUI classes, and the `shrink-0${buttonClassName}` missing-space bug is fixed. This task therefore *deletes* the call-site overrides rather than rewriting them.
  - `src/audio/synthPresets.ts` from Task 17 — `getCategoryMeta(cat).badgeClass` is now a daisyUI modifier string such as `'badge badge-primary'` (previously `'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'`).
- **Produces:**
  - A fully tokenized `SynthView.tsx` — the final `src/**` file removed from `ALLOWLIST`.
  - `KEYBOARD_NOTES` re-exported from `SynthView.tsx` so `scripts/check-key-bindings.ts` runs again (it is currently broken — see 18.13).

---

### 18.1 — Go red: remove SynthView from the guard allowlist

- [ ] Confirm the file is currently allowlisted:

```bash
grep -n "SynthView" /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts
```

Expected: one line inside the `ALLOWLIST` array, `'src/components/SynthView.tsx',`.

- [ ] Delete exactly that one line from `ALLOWLIST` in `scripts/themeTokenGuard.ts`. Change nothing else in that file.

- [ ] Watch the guard fail:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
```

Expected: `1 fail`, and the failure message lists violations located in `src/components/SynthView.tsx` covering rules `raw-hex`, `palette-color`, `absolute-bw`, and `invalid-utility`.

- [ ] Record the violation count. Run:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun -e "import { scanRepo } from './scripts/themeTokenGuard.ts'; const v = scanRepo(process.cwd()).filter(x => x.file.endsWith('SynthView.tsx')); console.log('SynthView violations:', v.length);"
```

Write the number down (call it `N0`). After **every** region step below you re-run this exact command and the number must be strictly smaller. This is your progress meter for a 1338-line refactor.

- [ ] Confirm the component test currently passes, so you know any later failure is yours:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/SynthView.test.tsx
```

Expected: `4 pass`, `0 fail`. The fourth test is `SynthView still renders`, which does `renderToString(<SynthView />)` and asserts the HTML contains the string `Scale Locked`. **The literal text `Scale Locked (` at line 1257 must survive this whole task.**

- [ ] Commit the red state so the diff of each region is reviewable on its own:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
test(theme): un-allowlist SynthView in the theme token guard

Removes src/components/SynthView.tsx from ALLOWLIST so the guard now
reports its legacy-palette violations. The guard test is red until the
component is fully retokenized in the following commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

### 18.2 — Region 1: the shared `TARGET_STYLES` table (lines 56-70)

This table tints the Pro-mode panels and colors the Synth/Chord/Bass destination buttons. It is at the very top of the file and every panel consumes it via `tintClass`, so do it first.

- [ ] Current code, `src/components/SynthView.tsx:56-70`:

```tsx
// Shared per-destination accent styling for the card tint and selector buttons
const TARGET_STYLES: Record<
  SynthControlTarget,
  { tint: string; activeBtn: string }
> = {
  synth: { tint: "", activeBtn: "bg-slate-600 text-white shadow-xs" },
  chord: {
    tint: "ring-1 ring-indigo-400/40 bg-gradient-to-br from-indigo-500/10 to-transparent",
    activeBtn: "bg-indigo-600 text-white shadow-xs",
  },
  bass: {
    tint: "ring-1 ring-emerald-400/40 bg-gradient-to-br from-emerald-500/10 to-transparent",
    activeBtn: "bg-emerald-600 text-white shadow-xs",
  },
};
```

- [ ] Replace it with:

```tsx
// Shared per-destination accent styling for the card tint and selector buttons.
// synth = neutral (no tint), chord = primary (amber), bass = accent (teal).
const TARGET_STYLES: Record<
  SynthControlTarget,
  { tint: string; activeBtn: string }
> = {
  synth: { tint: "", activeBtn: "btn-active" },
  chord: {
    tint: "ring-1 ring-primary/40 bg-gradient-to-br from-primary/10 to-transparent",
    activeBtn: "btn-primary",
  },
  bass: {
    tint: "ring-1 ring-accent/40 bg-gradient-to-br from-accent/10 to-transparent",
    activeBtn: "btn-accent",
  },
};
```

Note the deliberate role choice: `bass` was emerald, and per the role map emerald means "OK/saved" **only** when it signals state. Here it is a module accent, so it becomes `accent` (teal) and `success` stays reserved for the save toast in 18.5.

- [ ] Re-run the counter from 18.1. Expected: fewer than `N0` (this step removes 6 violations: 3 × `text-white`, `slate-600`, `indigo-400/40`+`indigo-500/10`+`indigo-600`, `emerald-*`).

---

### 18.3 — Region 2: header card + target selector + mode switcher (lines 369-464)

- [ ] Line 372 — the header panel. Before:

```tsx
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-3 sm:p-4 flex flex-col gap-3 shadow-md relative">
```

After (hand-rolled panel → daisyUI `card`; keep the flex column layout on the inner element by using `card-body`):

```tsx
      <div className="card bg-base-100 border border-base-300 shadow-md relative">
        <div className="card-body p-3 sm:p-4 flex flex-col gap-3">
```

**You must add the matching closing `</div>` at line 697** (the `</div>` that currently closes the header card, immediately after the save-toast block). After the edit that region reads:

```tsx
        )}
        </div>
      </div>
```

- [ ] Line 376 — the Target segmented control. Before:

```tsx
          <div className="flex items-center gap-1 bg-[#0B0D19] border border-[#2D355A] rounded-lg p-1">
```

After — a daisyUI `join` so the three buttons read as one control:

```tsx
          <div className="flex items-center gap-1 bg-base-200 border border-base-300 rounded-lg p-1">
```

(Keep the wrapper as a padded strip and use `join` on the buttons only; a raw `join` would fight the leading "Target:" label.)

- [ ] Line 377 — **dead breakpoint bug.** Tailwind v4 in this repo defines no `xs` screen, so `hidden xs:inline` means the label is hidden at *every* width. Task 10 fixed the identical bug in `TransportBar.tsx`; fix it here the same way. Before:

```tsx
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold pl-1 pr-1 hidden xs:inline">
```

After:

```tsx
            <span className="text-[10px] uppercase tracking-wider text-base-content/50 font-semibold pl-1 pr-1 hidden sm:inline">
```

- [ ] Lines 387-397 — the three Target buttons. Before:

```tsx
              <button
                key={target}
                onClick={() => onChangeControlTarget(target)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                  controlTarget === target
                    ? TARGET_STYLES[target].activeBtn
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
```

After:

```tsx
              <button
                key={target}
                onClick={() => onChangeControlTarget(target)}
                className={`btn btn-xs join-item text-[11px] font-semibold ${
                  controlTarget === target
                    ? TARGET_STYLES[target].activeBtn
                    : "btn-ghost text-base-content/60"
                }`}
              >
```

and add `join` to the wrapper opened above so it becomes:

```tsx
          <div className="join flex items-center gap-1 bg-base-200 border border-base-300 rounded-lg p-1">
```

- [ ] Line 404 — the Simple/Pro switcher wrapper. Before:

```tsx
            <div className="flex items-center bg-[#0B0D19] border border-[#2D355A] rounded-lg p-0.5">
```

After:

```tsx
            <div className="join flex items-center bg-base-200 border border-base-300 rounded-lg p-0.5">
```

- [ ] Lines 405-417 — the Simple button. Before:

```tsx
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  synthViewMode === "simple"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
```

After:

```tsx
                className={`btn btn-xs join-item gap-1 text-xs font-semibold ${
                  synthViewMode === "simple"
                    ? "btn-primary"
                    : "btn-ghost text-base-content/60"
                }`}
```

- [ ] Lines 418-430 — the Pro button (purple → `accent`, because Pro mode is the modulation/deep-control mode). Before:

```tsx
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  synthViewMode === "pro"
                    ? "bg-purple-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
```

After:

```tsx
                className={`btn btn-xs join-item gap-1 text-xs font-semibold ${
                  synthViewMode === "pro"
                    ? "btn-accent"
                    : "btn-ghost text-base-content/60"
                }`}
```

- [ ] Line 444 — the Save button. Before:

```tsx
              className="flex items-center gap-1 bg-[#171B36] hover:bg-[#22284C] text-slate-200 hover:text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#2D355A] transition-colors shadow-xs cursor-pointer"
```

After:

```tsx
              className="btn btn-xs btn-ghost gap-1 border border-base-300 text-xs font-semibold"
```

- [ ] Line 447 — the bookmark icon inside it. Before: `<Bookmark className="w-3.5 h-3.5 text-indigo-400" />` → after: `<Bookmark className="w-3.5 h-3.5 text-primary" />`.

- [ ] Line 454 — the Presets button. Before:

```tsx
              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg shadow-sm transition-colors cursor-pointer"
```

After:

```tsx
              className="btn btn-xs btn-primary gap-1 text-xs font-semibold"
```

- [ ] Line 459 — the preset-count chip. It carries **two** bugs: an indigo fill and `py-0.2`, which is not a real Tailwind spacing step (the guard's `invalid-utility` rule flags it). Before:

```tsx
              <span className="bg-indigo-700/80 text-[10px] px-1 py-0.2 rounded font-mono hidden sm:inline">
```

After — a daisyUI badge, `font-mono` kept because it is a numeric readout (design.md §3):

```tsx
              <span className="badge badge-xs badge-primary badge-outline text-[10px] font-mono hidden sm:inline">
```

- [ ] Re-run the counter from 18.1 — it must be strictly lower than after 18.2.

- [ ] `cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/SynthView.test.tsx` → `4 pass`.

- [ ] Commit:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
refactor(synth): tokenize SynthView header, target selector and mode switch

Header panel becomes a daisyUI card, the Target and Simple/Pro segmented
groups become join + btn btn-xs, and the TARGET_STYLES tint table moves
to primary/accent. Also fixes the dead `hidden xs:inline` breakpoint on
the Target label (no xs screen is defined) and the invalid `py-0.2` on
the preset-count chip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

### 18.4 — Region 3: Pro-mode categorized preset bar (lines 466-595)

- [ ] Line 468 — the recessed preset-bar well. Before:

```tsx
          <div className="flex flex-wrap items-center justify-between gap-2.5 bg-[#0B0D19] border border-[#252B48] p-2 rounded-xl">
```

After — this is a *well inside* the header card, so `base-300`, not `base-200`:

```tsx
          <div className="flex flex-wrap items-center justify-between gap-2.5 bg-base-300 border border-base-300 p-2 rounded-xl">
```

- [ ] Line 471 — the "Category:" label. Before: `className="text-[10px] uppercase font-bold text-slate-500 px-1 font-mono"` → after: `className="text-[10px] uppercase font-bold text-base-content/50 px-1 font-mono"`.

- [ ] Lines 496-516 — the category filter buttons and their count chips. Before:

```tsx
                    className={`px-2 py-1 rounded-md font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 text-xs ${
                      isSelected
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-slate-400 hover:text-slate-200 hover:bg-[#1C213E]/80"
                    }`}
                  >
                    <span>{cat.label}</span>
                    <span
                      className={`text-[9px] px-1 rounded-full font-mono ${
                        isSelected
                          ? "bg-indigo-700 text-white"
                          : "bg-[#161B36] text-slate-400"
                      }`}
                    >
```

After:

```tsx
                    className={`btn btn-xs gap-1 font-semibold whitespace-nowrap text-xs ${
                      isSelected
                        ? "btn-primary"
                        : "btn-ghost text-base-content/60 hover:bg-base-300"
                    }`}
                  >
                    <span>{cat.label}</span>
                    <span
                      className={`badge badge-xs text-[9px] font-mono ${
                        isSelected
                          ? "badge-primary badge-outline"
                          : "badge-ghost text-base-content/60"
                      }`}
                    >
```

- [ ] Lines 524-531 — the active-category pill. This consumes Task 17's new `badgeClass`, which is now a daisyUI modifier string (e.g. `'badge badge-primary'`), so the hand-rolled `px-2 py-0.5 rounded border` must go or it will double-style the badge. Before:

```tsx
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold ${activeCategoryMeta.badgeClass}`}
                  title={`Category: ${activeCategoryMeta.label} - ${activeCategoryMeta.description}`}
                >
```

After:

```tsx
                <span
                  className={`badge badge-sm badge-outline text-[10px] font-mono font-semibold ${activeCategoryMeta.badgeClass}`}
                  title={`Category: ${activeCategoryMeta.label} - ${activeCategoryMeta.description}`}
                >
```

- [ ] Lines 534-541 and 585-592 — the prev/next preset steppers. Both currently read:

```tsx
                className="p-1.5 rounded-lg bg-[#12152A] hover:bg-[#1C213E] text-slate-300 hover:text-white border border-[#2D355A] cursor-pointer transition-colors"
```

Replace **both** with:

```tsx
                className="btn btn-xs btn-square btn-ghost border border-base-300"
```

- [ ] Line 544 — the dropdown shell. Before:

```tsx
              <div className="flex items-center gap-1.5 bg-[#12152A] border border-[#2D355A] rounded-lg px-2.5 py-1">
```

After:

```tsx
              <div className="flex items-center gap-1.5 bg-base-100 border border-base-300 rounded-lg px-2.5 py-1">
```

- [ ] Line 545 — the sparkles icon: `text-purple-400` → `text-accent`.

- [ ] Line 550 — the `<select>`. Before:

```tsx
                  className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer pr-2 font-medium max-w-[180px] sm:max-w-[240px] truncate"
```

After — the shell above already supplies the border/background, so use a ghost-ish select that inherits it:

```tsx
                  className="select select-sm select-ghost bg-transparent border-0 text-base-content text-xs focus:outline-none pr-2 font-medium max-w-[180px] sm:max-w-[240px] truncate"
```

- [ ] Line 564 — the `<optgroup>` colour override. Before:

```tsx
                        className="bg-[#12152A] text-indigo-300 font-bold"
```

After:

```tsx
                        className="font-bold"
```

- [ ] Lines 570-574 — the per-`<option>` colour overrides. Native `<option>` styling is unreliable across engines and these hardcode a dark background that is unreadable on `solva-light`; **delete the whole `className` prop.** Before:

```tsx
                          <option
                            key={p.id}
                            value={p.name}
                            className={
                              p.isFactory
                                ? "bg-[#0B0D19] text-slate-200 font-normal"
                                : "bg-[#0B0D19] text-purple-300 font-normal"
                            }
                          >
                            {!p.isFactory ? `★ ${p.name}` : p.name}
                          </option>
```

After:

```tsx
                          <option key={p.id} value={p.name}>
                            {!p.isFactory ? `★ ${p.name}` : p.name}
                          </option>
```

The `★` prefix already distinguishes custom presets, so no information is lost.

- [ ] Re-run the counter from 18.1 — strictly lower.

- [ ] `bun test src/components/SynthView.test.tsx` → `4 pass`.

- [ ] Commit:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
refactor(synth): tokenize the Pro-mode preset bar

Category filters and preset steppers become btn btn-xs, the count chips
and active-category pill become daisyUI badges consuming the new
synthPresets badgeClass shape, and the unreadable hardcoded <option> /
<optgroup> colour overrides are deleted so native menus follow the theme.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

### 18.5 — Region 4: Simple-mode preset row, save toast, QuickSavePopover (lines 597-715)

- [ ] Line 599 — the divider. `border-t border-[#252B48]` → `border-t border-base-300`.

- [ ] Lines 604-608 — the Simple-mode category badge (again Task 17's `badgeClass`). Before:

```tsx
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${activeCategoryMeta.badgeClass}`}
                  >
```

After:

```tsx
                  <span
                    className={`badge badge-sm text-[10px] font-mono font-bold ${activeCategoryMeta.badgeClass}`}
                  >
```

- [ ] Line 610 — the big preset title. Before: `className="text-2xl leading-6 font-extrabold text-white tracking-tight truncate"` → after: `className="text-2xl leading-6 font-extrabold text-base-content tracking-tight truncate"`.

- [ ] Lines 617-624 and 644-651 — the Simple prev/next buttons. Both currently read:

```tsx
                  className="p-2.5 rounded-xl bg-[#0B0D19] hover:bg-[#1C213E] text-slate-300 hover:text-white border border-[#2D355A] cursor-pointer transition-colors"
```

Replace **both** with:

```tsx
                  className="btn btn-sm btn-square btn-ghost border border-base-300"
```

- [ ] Line 635 — the Simple `<select>`. Before:

```tsx
                  className="bg-[#0B0D19] border border-[#2D355A] text-slate-100 text-xs font-semibold rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-indigo-500 cursor-pointer max-w-[200px] truncate"
```

After:

```tsx
                  className="select select-sm select-bordered text-xs font-semibold max-w-[200px] truncate"
```

- [ ] Line 638 — the option override. Before: `<option key={p.id} value={p.name} className="bg-[#12152A]">` → after: `<option key={p.id} value={p.name}>`.

- [ ] Line 657 — the "Sound Style:" label. `text-slate-400` → `text-base-content/60`.

- [ ] Lines 672-679 — the Sound Style chips. Before:

```tsx
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                      isSelected
                        ? "bg-indigo-600 text-white shadow-sm font-semibold"
                        : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                    }`}
```

After:

```tsx
                    className={`btn btn-xs gap-1.5 text-xs font-medium whitespace-nowrap ${
                      isSelected
                        ? "btn-primary font-semibold"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
```

- [ ] Lines 690-696 — the save toast. This is the one place emerald genuinely means "saved OK", so it becomes `toast` + `alert alert-success` per the component map. Before:

```tsx
        {saveToast && (
          <div className="absolute top-full right-4 mt-2 z-20 bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-xs px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>{saveToast}</span>
          </div>
        )}
```

After:

```tsx
        {saveToast && (
          <div className="toast toast-top toast-end absolute top-full right-4 mt-2 z-20">
            <div className="alert alert-success text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-lg">
              <Check className="w-3.5 h-3.5" />
              <span>{saveToast}</span>
            </div>
          </div>
        )}
```

The `<Check>` loses its explicit colour because `alert-success` already sets `--alert-color`'s content colour on its children.

- [ ] Lines 713-714 — the QuickSavePopover call-site overrides. Task 8 already made the component's own defaults daisyUI-correct and fixed its `shrink-0${buttonClassName}` missing-space bug, so these two props are now actively harmful (they reintroduce `bg-[#0B0D19]`, `border-[#2D355A]` and `focus:border-indigo-500`). **Delete both lines.** Before:

```tsx
        formClassName="flex items-center gap-2 flex-1 max-w-xl flex-wrap sm:flex-nowrap"
        inputClassName="flex-1 min-w-[140px] bg-[#0B0D19] border border-[#2D355A] rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
        buttonClassName=" cursor-pointer"
      />
```

After:

```tsx
        formClassName="flex items-center gap-2 flex-1 max-w-xl flex-wrap sm:flex-nowrap"
      />
```

- [ ] Verify the popover still renders sanely by typechecking (both props are optional in Task 8's interface):

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run lint
```

Expected: no output, exit 0.

- [ ] Re-run the counter from 18.1 — strictly lower.

- [ ] Commit:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
refactor(synth): tokenize Simple-mode preset row and save toast

Sound-style chips and steppers become btn btn-xs/btn-sm, the preset
select becomes select select-sm select-bordered, and the hand-rolled
emerald save toast becomes toast + alert alert-success. Drops the
QuickSavePopover call-site overrides now that its defaults are daisyUI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

### 18.6 — Region 5: Simple-mode "switch to Pro" hint (lines 722-738)

Small region, but it is the only remaining Simple-mode markup — clear it before moving into the Pro grid.

- [ ] Lines 723-725. Before:

```tsx
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-[#12152A]/70 border border-[#252B48] px-4 py-2.5 rounded-xl text-xs text-slate-300">
            <div className="flex items-center gap-2 text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
```

After:

```tsx
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-base-100/70 border border-base-300 px-4 py-2.5 rounded-xl text-xs text-base-content">
            <div className="flex items-center gap-2 text-base-content/60">
              <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
```

- [ ] Line 734 — the link button. Before:

```tsx
              className="text-purple-400 hover:text-purple-300 font-bold whitespace-nowrap cursor-pointer transition-colors"
```

After:

```tsx
              className="btn btn-xs btn-link text-accent font-bold whitespace-nowrap no-underline"
```

- [ ] Re-run the counter — strictly lower.

---

### 18.7 — Region 6: Pro grid panel 1, Oscillators (lines 743-815)

All five Pro panels share the identical wrapper string. Do them one panel per step so each is reviewable, and re-run the counter each time.

- [ ] Lines 744-752. Before:

```tsx
          <div
            className={`flex-1 bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md ${tintClass}`}
          >
            <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-indigo-400" />
                1. Oscillators
              </span>
            </div>
```

After:

```tsx
          <div
            className={`card flex-1 bg-base-100 border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-primary" />
                1. Oscillators
              </span>
            </div>
```

and close the extra `card-body` div at line 815 — the `</div>` that ends this panel becomes:

```tsx
            </div>
          </div>
```

- [ ] Line 755 — the Waveform label: `className="text-xs text-slate-400 block mb-1.5 font-medium"` → `className="text-xs text-base-content/60 block mb-1.5 font-medium"`.

- [ ] Lines 761-769 — the four waveform buttons. Before:

```tsx
                      className={`py-1 text-[11px] rounded font-semibold capitalize transition-all cursor-pointer ${
                        params.oscType === w
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                      }`}
```

After:

```tsx
                      className={`btn btn-xs text-[11px] font-semibold capitalize ${
                        params.oscType === w
                          ? "btn-primary"
                          : "btn-ghost border border-base-300 text-base-content/60"
                      }`}
```

- [ ] Lines 782, 794, 806 — the three `Knob` `color` props. Change all three from `color="text-indigo-400"` to `color="text-primary"`. After Task 4 narrowed the prop to a union, leaving even one is a `tsc` error, so verify with:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run lint
```

Expected: no output, exit 0.

- [ ] Re-run the counter — strictly lower.

---

### 18.8 — Region 7: Pro grid panel 2, VCF Filter (lines 816-893)

Pink is the filter/harmony colour → `secondary` (coral).

- [ ] Lines 817-825. Before:

```tsx
          <div
            className={`flex-1 bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md ${tintClass}`}
          >
            <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-pink-400" />
                2. VCF Filter
              </span>
            </div>
```

After (same `card` + `card-body` split, closing the extra div at line 893):

```tsx
          <div
            className={`card flex-1 bg-base-100 border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-secondary" />
                2. VCF Filter
              </span>
            </div>
```

- [ ] Line 828 — the Filter Type label: `text-slate-400` → `text-base-content/60`.

- [ ] Lines 833-841 — the LPF/BPF/HPF buttons. Before:

```tsx
                    className={`py-1 text-[11px] rounded font-semibold uppercase transition-all cursor-pointer ${
                      params.filterType === t
                        ? "bg-pink-600 text-white shadow-sm"
                        : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                    }`}
```

After:

```tsx
                    className={`btn btn-xs text-[11px] font-semibold uppercase ${
                      params.filterType === t
                        ? "btn-secondary"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
```

- [ ] Lines 853, 866, 881 — the three `Knob` `color` props: `color="text-pink-400"` → `color="text-secondary"` (Cutoff, Resonance, Env Mod).

- [ ] `bun run lint` → no output, exit 0. Re-run the counter — strictly lower.

---

### 18.9 — Region 8: Pro grid panel 3, ADSR Envelope (lines 894-1038)

This panel has two sub-groups: AMP/VCA (emerald → `success`, because these are the "envelope is healthy" readouts the design calls ADSR-ok) and FILTER/VCF (pink → `secondary`, matching panel 2).

- [ ] Lines 895-903. Before:

```tsx
          <div
            className={`flex-1 bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3 shadow-md ${tintClass}`}
          >
            <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                3. ADSR Envelope
              </span>
            </div>
```

After (close the extra `card-body` div at line 1038, which currently reads `</div>{" "}`):

```tsx
          <div
            className={`card flex-1 bg-base-100 border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-success" />
                3. ADSR Envelope
              </span>
            </div>
```

Line 1038 becomes:

```tsx
            </div>
          </div>{" "}
```

- [ ] Lines 908-911 — the AMP/VCA sub-heading and its hairline. Before:

```tsx
                <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider">
                  AMP / VCA
                </span>
                <span className="flex-1 h-px bg-[#252B48]" />
```

After:

```tsx
                <span className="text-[10px] font-mono text-success uppercase tracking-wider">
                  AMP / VCA
                </span>
                <span className="flex-1 h-px bg-base-300" />
```

- [ ] Lines 918, 931, 944, 957 — the four AMP knobs: `color="text-emerald-400"` → `color="text-success"` (ATT, DEC, SUS, REL).

- [ ] Lines 971-974 — the FILTER/VCF sub-heading and hairline. Before:

```tsx
                <span className="text-[10px] font-mono text-pink-400 uppercase tracking-wider">
                  FILTER / VCF
                </span>
                <span className="flex-1 h-px bg-[#252B48]" />
```

After:

```tsx
                <span className="text-[10px] font-mono text-secondary uppercase tracking-wider">
                  FILTER / VCF
                </span>
                <span className="flex-1 h-px bg-base-300" />
```

- [ ] Lines 981, 996, 1011, 1026 — the four filter-envelope knobs: `color="text-pink-400"` → `color="text-secondary"`.

- [ ] `bun run lint` → no output, exit 0. Re-run the counter — strictly lower.

- [ ] Commit the three panels done so far:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
refactor(synth): tokenize Oscillator, VCF and ADSR panels

The three panels become daisyUI cards with card-body, their waveform and
filter-type selectors become btn btn-xs, and every Knob color prop moves
to the narrowed union: oscillators -> text-primary, filter -> text-secondary,
amp envelope -> text-success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

### 18.10 — Region 9: Pro grid panel 4, LFO & Octave (lines 1039-1117)

Cyan is the modulation colour → `accent` (teal).

- [ ] Lines 1040-1048. Before:

```tsx
          <div
            className={`flex-1 bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md ${tintClass}`}
          >
            <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                4. LFO & Octave
              </span>
            </div>
```

After (close the extra div at line 1117):

```tsx
          <div
            className={`card flex-1 bg-base-100 border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-accent" />
                4. LFO & Octave
              </span>
            </div>
```

- [ ] Line 1051 — the LFO Destination label: `text-slate-400` → `text-base-content/60`.

- [ ] Lines 1056-1064 — the cutoff/pitch/volume buttons. Before:

```tsx
                    className={`py-1 text-[11px] rounded font-semibold capitalize transition-all cursor-pointer ${
                      params.lfoTarget === t
                        ? "bg-cyan-600 text-white shadow-sm"
                        : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                    }`}
```

After:

```tsx
                    className={`btn btn-xs text-[11px] font-semibold capitalize ${
                      params.lfoTarget === t
                        ? "btn-accent"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
```

- [ ] Lines 1076, 1088 — the two knobs: `color="text-cyan-400"` → `color="text-accent"` (LFO Rate, LFO Depth).

- [ ] Line 1099 — the "Octave Pitch" label: `className="text-xs text-slate-400"` → `className="text-xs text-base-content/60"`.

- [ ] Lines 1102-1110 — the five octave buttons. Note this one uses `hover:text-white`, which the guard's `absolute-bw` rule flags. Before:

```tsx
                    className={`w-6 h-6 rounded text-xs font-mono font-bold flex items-center justify-center transition-colors cursor-pointer ${
                      params.octave === oct
                        ? "bg-indigo-600 text-white"
                        : "bg-[#0B0D19] text-slate-400 hover:text-white border border-[#252B48]"
                    }`}
```

After — `font-mono` is retained because these are numeric octave readouts (design.md §3):

```tsx
                    className={`btn btn-xs btn-square w-6 h-6 min-h-0 text-xs font-mono font-bold ${
                      params.octave === oct
                        ? "btn-primary"
                        : "btn-ghost border border-base-300 text-base-content/60 hover:text-base-content"
                    }`}
```

- [ ] `bun run lint` → no output, exit 0. Re-run the counter — strictly lower.

---

### 18.11 — Region 10: Pro grid panel 5, Arpeggiator (lines 1118-1215)

Purple here is the arp/modulation colour → `accent`.

- [ ] Lines 1119-1126. Before:

```tsx
          <div
            className={`flex-1 bg-[#12152A] border border-[#252B48] rounded-xl p-4 space-y-3.5 shadow-md ${tintClass}`}
          >
            <div className="flex items-center justify-between border-b border-[#252B48] pb-2">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                5. Arpeggiator
              </span>
```

After (close the extra div at line 1215):

```tsx
          <div
            className={`card flex-1 bg-base-100 border border-base-300 shadow-md ${tintClass}`}
          >
            <div className="card-body p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-base-300 pb-2">
              <span className="text-xs font-bold text-base-content uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                5. Arpeggiator
              </span>
```

- [ ] Lines 1136-1140 — the Active/Bypass toggle. Before:

```tsx
                className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  params.arpActive
                    ? "bg-purple-600 text-white shadow-md shadow-purple-500/30"
                    : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                }`}
```

After:

```tsx
                className={`btn btn-xs text-[10px] font-bold uppercase tracking-wider ${
                  params.arpActive
                    ? "btn-accent shadow-md shadow-accent/30"
                    : "btn-ghost border border-base-300 text-base-content/60"
                }`}
```

- [ ] Line 1147 — the Arp Mode label: `text-slate-400` → `text-base-content/60`.

- [ ] Lines 1152-1160 — the four arp-mode buttons. Before:

```tsx
                    className={`py-1 text-[10px] rounded font-semibold capitalize transition-all cursor-pointer ${
                      (params.arpMode ?? "up") === m
                        ? "bg-purple-600 text-white shadow-sm"
                        : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                    }`}
```

After:

```tsx
                    className={`btn btn-xs text-[10px] font-semibold capitalize ${
                      (params.arpMode ?? "up") === m
                        ? "btn-accent"
                        : "btn-ghost border border-base-300 text-base-content/60"
                    }`}
```

- [ ] Line 1170 and line 1192 — the "Rate" and "Octaves" labels. Both currently `className="text-[11px] text-slate-400 block mb-1 font-medium"` → both become `className="text-[11px] text-base-content/60 block mb-1 font-medium"`.

- [ ] Lines 1175-1183 — the 1/16, 1/8, 1/32 rate buttons (step timing → keep `font-mono` per design.md §3). Before:

```tsx
                      className={`px-2 py-1 text-[11px] font-mono rounded font-semibold transition-all cursor-pointer ${
                        (params.arpRate ?? "16n") === r
                          ? "bg-purple-600 text-white"
                          : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                      }`}
```

After:

```tsx
                      className={`btn btn-xs text-[11px] font-mono font-semibold ${
                        (params.arpRate ?? "16n") === r
                          ? "btn-accent"
                          : "btn-ghost border border-base-300 text-base-content/60"
                      }`}
```

- [ ] Lines 1197-1207 — the +1/+2/+3 arp-octave buttons. Before:

```tsx
                      className={`w-7 py-1 text-xs font-mono font-bold rounded transition-all cursor-pointer ${
                        (params.arpOctaves ?? 1) === oct
                          ? "bg-purple-600 text-white"
                          : "bg-[#0B0D19] text-slate-400 hover:text-slate-200 border border-[#252B48]"
                      }`}
```

After:

```tsx
                      className={`btn btn-xs w-7 min-h-0 text-xs font-mono font-bold ${
                        (params.arpOctaves ?? 1) === oct
                          ? "btn-accent"
                          : "btn-ghost border border-base-300 text-base-content/60"
                      }`}
```

- [ ] `bun run lint` → no output, exit 0. Re-run the counter — strictly lower.

- [ ] Commit:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
refactor(synth): tokenize LFO/Octave and Arpeggiator panels

Both become daisyUI cards; LFO destination, arp mode, arp rate and arp
octave selectors become btn btn-xs btn-accent (cyan and purple both map
to accent per the role map). font-mono is preserved on the numeric
octave and step-timing readouts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

### 18.12 — Region 11: interactive keyboard tray (lines 1219-1324)

- [ ] Line 1220 — the keyboard panel. Before:

```tsx
      <div className="bg-[#12152A] border border-[#252B48] rounded-xl p-4 shadow-xl">
```

After (close the extra `card-body` div at line 1324):

```tsx
      <div className="card bg-base-100 border border-base-300 shadow-xl">
        <div className="card-body p-4">
```

- [ ] Line 1223 — the "Interactive Keyboard" heading: `text-slate-300` → `text-base-content`.

- [ ] Lines 1226-1233 — the Audition pill. Before:

```tsx
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                controlTarget === "synth"
                  ? "bg-slate-700/50 border-slate-600 text-slate-200"
                  : controlTarget === "chord"
                    ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
                    : "bg-emerald-600/20 border-emerald-500/40 text-emerald-300"
              }`}
```

After — matches the `TARGET_STYLES` roles set in 18.2 (synth = neutral, chord = primary, bass = accent):

```tsx
            <span
              className={`badge badge-sm badge-outline text-[10px] font-semibold ${
                controlTarget === "synth"
                  ? "badge-neutral"
                  : controlTarget === "chord"
                    ? "badge-primary"
                    : "badge-accent"
              }`}
```

- [ ] Lines 1243-1259 — the Scale-Locked / Chromatic toggle. **The visible text `Scale Locked (${scaleRoot} ${scaleType})` at line 1257 must not change** — `SynthView.test.tsx:65` asserts `expect(html).toContain('Scale Locked')`. Only touch the `className`. Before:

```tsx
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer border ${
                keyboardMode === "scale-locked"
                  ? "bg-indigo-600 border-indigo-500 text-white shadow-xs"
                  : "bg-[#0B0D19] border-[#252B48] text-slate-400 hover:text-slate-200"
              }`}
```

After:

```tsx
              className={`btn btn-xs text-[11px] font-semibold ${
                keyboardMode === "scale-locked"
                  ? "btn-primary"
                  : "btn-ghost border border-base-300 text-base-content/60"
              }`}
```

- [ ] Lines 1264 and 1268 — the active-note readout and the "KB OCT" label. Before:

```tsx
            <div className="text-[11px] font-mono text-slate-500 mr-2">
              {Array.from(activeNotes).join(", ") || "No note"}
            </div>

            <span className="text-[11px] text-slate-500 font-mono mr-1">
              KB OCT
            </span>
```

After:

```tsx
            <div className="text-[11px] font-mono text-base-content/50 mr-2">
              {Array.from(activeNotes).join(", ") || "No note"}
            </div>

            <span className="text-[11px] text-base-content/50 font-mono mr-1">
              KB OCT
            </span>
```

- [ ] Lines 1275 and 1290 — the keyboard octave down/up buttons. Both currently read:

```tsx
              className="w-7 h-7 flex items-center justify-center rounded-md bg-[#0B0D19] border border-[#252B48] text-slate-400 hover:text-white hover:border-indigo-500 hover:bg-indigo-600/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
```

Replace **both** with:

```tsx
              className="btn btn-xs btn-square btn-ghost w-7 h-7 min-h-0 border border-base-300 text-base-content/60 hover:text-base-content hover:border-primary hover:bg-primary/20 disabled:opacity-30"
```

(`disabled:cursor-not-allowed` is dropped because daisyUI's `btn:disabled` already sets it, and the `disabled` attribute at lines 1274/1289 stays untouched.)

- [ ] Lines 1280-1284 — the octave readout. Before:

```tsx
            <div className="min-w-[52px] h-7 flex items-center justify-center rounded-md bg-indigo-600/15 border border-indigo-500/40 px-2">
              <span className="text-xs font-mono font-bold text-indigo-300">
```

After — per the component map, this readout becomes an outlined badge, and `font-mono` stays (numeric octave readout, design.md §3):

```tsx
            <div className="badge badge-primary badge-outline min-w-[52px] h-7 px-2">
              <span className="text-xs font-mono font-bold">
```

- [ ] Line 1300 — the keyboard tray well. This is a recessed well inside a `base-100` card, so `base-300`. Leave `h-[180px]` alone: it is layout, and it pairs with `Keyboard.tsx`'s `h-[100px]` white keys. Before:

```tsx
          className={`flex justify-center relative h-[180px] select-none bg-[#0B0D19] p-2 rounded-lg border border-[#252B48] overflow-x-auto ${
```

After:

```tsx
          className={`flex justify-center relative h-[180px] select-none bg-base-300 p-2 rounded-lg border border-base-300 overflow-x-auto ${
```

- [ ] Close the `card-body` at line 1324. Before:

```tsx
          )}
        </div>
      </div>
```

After:

```tsx
          )}
        </div>
        </div>
      </div>
```

- [ ] Run the component test — this is the region the test actually inspects:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/components/SynthView.test.tsx
```

Expected: `4 pass`, `0 fail`. If `SynthView still renders` fails with a missing `Scale Locked`, you changed the label text at line 1257 — revert that string.

- [ ] Re-run the counter from 18.1. **Expected now: `SynthView violations: 0`.**

- [ ] Run the guard test:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
```

Expected: `0 fail` **if** SynthView was the last allowlisted file; otherwise the failure must no longer mention `SynthView.tsx`.

---

### 18.13 — Repair `scripts/check-key-bindings.ts` (currently broken)

The plan brief says `KEYBOARD_NOTES` is exported from `SynthView.tsx`. **It is not** — verify for yourself:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -rn "KEYBOARD_NOTES" src/ scripts/
```

Expected output:

```
src/components/ui/Keyboard.tsx:101:const KEYBOARD_NOTES = [
src/components/ui/Keyboard.tsx:293:  const whiteKeysBefore = KEYBOARD_NOTES.slice(0, noteIndex).filter(
src/components/ui/Keyboard.tsx:302:  return KEYBOARD_NOTES.map((k) => {
scripts/check-key-bindings.ts:2:import { KEYBOARD_NOTES } from '../src/components/SynthView.tsx';
```

The constant moved to `ui/Keyboard.tsx` in an earlier refactor and was never re-exported, so the check script has been silently dead:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun scripts/check-key-bindings.ts
```

Expected (the current, broken state):

```
SyntaxError: Export named 'KEYBOARD_NOTES' not found in module '.../src/components/SynthView.tsx'.
```

Fix it so this task can actually prove the key-binding data survived the refactor.

- [ ] In `src/components/ui/Keyboard.tsx`, line 101, add the `export` keyword:

```tsx
export const KEYBOARD_NOTES = [
```

- [ ] In `src/components/SynthView.tsx`, extend the existing import block at lines 44-51 to pull the constant in and re-export it, so `scripts/check-key-bindings.ts` keeps working unmodified. Before:

```tsx
import {
  clampKeyboardOctave,
  getScaleLockedKeyboardNotes,
  getScaleLockedKeyboardNotesFlat,
  getChromaticKeyboardNotes,
  ScaleLockedKeyboard,
  ChromaticKeyboard,
} from "./ui/Keyboard";
```

After:

```tsx
import {
  clampKeyboardOctave,
  getScaleLockedKeyboardNotes,
  getScaleLockedKeyboardNotesFlat,
  getChromaticKeyboardNotes,
  ScaleLockedKeyboard,
  ChromaticKeyboard,
} from "./ui/Keyboard";

// Re-exported for scripts/check-key-bindings.ts, which asserts that the synth
// key bindings never collide with the drum-pad shortcuts. The table itself
// lives in ui/Keyboard.tsx; this is the historical import path.
export { KEYBOARD_NOTES } from "./ui/Keyboard";
```

- [ ] Prove the key data is untouched by this whole task:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun scripts/check-key-bindings.ts
```

Expected output:

```
PASS drum pads unique (...)
PASS synth keys unique (KeyA KeyW KeyS KeyE KeyD KeyF KeyT KeyG KeyY KeyH KeyU KeyJ KeyK KeyO KeyL KeyP Semicolon Quote)
PASS no drum/synth overlap (none)
PASS all codes valid KeyboardEvent.code (invalid: none)
All key binding checks passed.
```

Exit code must be 0: `echo $?` → `0`.

---

### 18.14 — Full gate and final commit for Task 18

- [ ] Run every check:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens \
  && bun test \
  && bun run lint \
  && bun run eslint \
  && bun scripts/check-key-bindings.ts \
  && bun run build
```

Expected: `bun test` reports `0 fail`; `bun run lint` prints nothing; `bun run eslint` prints nothing; the key-binding script prints `All key binding checks passed.`; `bun run build` ends with `✓ built in …`.

- [ ] Confirm no legacy tokens survive anywhere in the file:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -nE "#[0-9A-Fa-f]{6}|indigo-|purple-|pink-|emerald-|cyan-|slate-|rose-|text-white|dark:|xs:|py-0\.2" src/components/SynthView.tsx
```

Expected output: nothing (exit code 1).

- [ ] Commit:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
refactor(synth): finish SynthView token migration and repair key-binding check

Keyboard tray becomes a daisyUI card with a base-300 well, the audition
pill and octave readout become badges, and the octave steppers become
btn btn-xs. Also exports KEYBOARD_NOTES from ui/Keyboard.tsx and
re-exports it from SynthView so scripts/check-key-bindings.ts runs again
— it had been throwing a SyntaxError since the constant moved.

SynthView.tsx now reports 0 theme-token-guard violations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 19: `src/utils/themeColor.ts` (new) + `src/components/AudioVisualizer.tsx` + call sites

**Files:**
- Create: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/utils/themeColor.ts`
- Create: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/utils/themeColor.test.ts`
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/AudioVisualizer.tsx` (622 lines)
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/App.tsx` (line 88)
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/components/TransportBar.tsx` (line 183)
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts` (remove one `ALLOWLIST` entry)

**Interfaces:**
- **Consumes:** the CSS custom properties emitted by daisyUI for the active theme — `--color-primary`, `--color-secondary`, `--color-accent`, `--color-base-100/200/300`, `--color-base-content`, `--color-neutral`, `--color-success`, `--color-warning`, `--color-error`, `--color-info` (the last four exist only because of Task 1).
- **Produces:** `src/utils/themeColor.ts` exporting `ThemeToken`, `Rgb`, `parseRgbString`, `resolveThemeRgb`, `rgbToCss`, `createThemePalette`, `subscribeToThemeChange`. Any future `<canvas>` code in this repo must use it instead of hardcoding colors.

**Why a utility at all:** `<canvas>` takes CSS colour *strings*, not Tailwind classes, so `AudioVisualizer` cannot be fixed by class swaps — it has to read the live theme at runtime. daisyUI v5 emits its palette as `oklch(...)`, which some canvas implementations reject outright, so the utility resolves through a probe element and reads back the browser-normalised `rgb()` form.

---

### 19.1 — Red: write `src/utils/themeColor.test.ts` first

**`bun test` runs in Bun, which has no DOM.** There is no `document`, no `window`, no `getComputedStyle`. That is a hard constraint on the design: the only unit-testable parts are the *pure* helpers, so `parseRgbString` and `rgbToCss` are exported separately and every DOM-touching function guards on `typeof document === 'undefined'`.

- [ ] Create `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/utils/themeColor.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  createThemePalette,
  parseRgbString,
  resolveThemeRgb,
  rgbToCss,
  subscribeToThemeChange,
} from './themeColor';

describe('parseRgbString', () => {
  test('parses legacy comma rgb()', () => {
    expect(parseRgbString('rgb(245, 158, 11)')).toEqual({ r: 245, g: 158, b: 11 });
  });

  test('parses legacy comma rgba() and ignores the alpha channel', () => {
    expect(parseRgbString('rgba(245, 158, 11, 0.5)')).toEqual({ r: 245, g: 158, b: 11 });
  });

  test('parses modern space-separated syntax with a slash alpha', () => {
    expect(parseRgbString('rgb(245 158 11 / 0.5)')).toEqual({ r: 245, g: 158, b: 11 });
  });

  test('parses space-separated syntax without alpha', () => {
    expect(parseRgbString('rgb(13 148 136)')).toEqual({ r: 13, g: 148, b: 136 });
  });

  test('clamps out-of-range channels into 0-255', () => {
    expect(parseRgbString('rgb(300, -20, 11)')).toEqual({ r: 255, g: 0, b: 11 });
  });

  test('rounds fractional channels', () => {
    expect(parseRgbString('rgb(244.6 157.5 10.4)')).toEqual({ r: 245, g: 158, b: 10 });
  });

  test('returns null for anything it cannot parse', () => {
    expect(parseRgbString('oklch(0.75 0.18 70)')).toBeNull();
    expect(parseRgbString('')).toBeNull();
    expect(parseRgbString('#F59E0B')).toBeNull();
  });
});

describe('rgbToCss', () => {
  test('emits rgb() when no alpha is given', () => {
    expect(rgbToCss({ r: 245, g: 158, b: 11 })).toBe('rgb(245, 158, 11)');
  });

  test('emits rgba() when an alpha is given', () => {
    expect(rgbToCss({ r: 245, g: 158, b: 11 }, 0.45)).toBe('rgba(245, 158, 11, 0.45)');
  });

  test('emits rgba() for a zero alpha rather than falling back to rgb()', () => {
    expect(rgbToCss({ r: 4, g: 120, b: 87 }, 0)).toBe('rgba(4, 120, 87, 0)');
  });

  test('clamps alpha into 0-1', () => {
    expect(rgbToCss({ r: 0, g: 0, b: 0 }, 1.7)).toBe('rgba(0, 0, 0, 1)');
    expect(rgbToCss({ r: 0, g: 0, b: 0 }, -3)).toBe('rgba(0, 0, 0, 0)');
  });
});

describe('SSR / no-DOM safety', () => {
  test('resolveThemeRgb falls back to the built-in default without a document', () => {
    expect(resolveThemeRgb('--color-primary')).toEqual({ r: 245, g: 158, b: 11 });
  });

  test('createThemePalette returns every token even without a document', () => {
    const palette = createThemePalette();
    expect(palette['--color-primary']).toEqual({ r: 245, g: 158, b: 11 });
    expect(palette['--color-base-content']).toBeDefined();
    expect(palette['--color-error']).toBeDefined();
  });

  test('subscribeToThemeChange returns a no-op unsubscribe without a document', () => {
    const unsubscribe = subscribeToThemeChange(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});
```

- [ ] Verify it is red for the right reason:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/utils/themeColor.test.ts
```

Expected: the run errors with `Cannot find module './themeColor'` — the module does not exist yet.

- [ ] Check the matcher inventory. This test uses `toEqual`, `toBe`, `toBeNull` and `toBeDefined`, all of which are already declared in `src/types/bun-test.d.ts` lines 29-37. **No change to that file is needed.** Confirm:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -nE "toEqual|toBeNull|toBeDefined|toBe\(" src/types/bun-test.d.ts
```

Expected: four matching lines.

---

### 19.2 — Green: implement `src/utils/themeColor.ts`

- [ ] Create `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/src/utils/themeColor.ts`:

```ts
/**
 * Runtime bridge between the daisyUI theme and <canvas>.
 *
 * Canvas drawing takes CSS colour strings, not Tailwind classes, so canvas
 * code cannot be fixed by swapping class names — it has to read the live
 * theme. daisyUI v5 emits its palette as `oklch(...)`, which some canvas
 * implementations refuse to parse, so we resolve every token through a probe
 * element and read back the computed `color`, which every engine normalises
 * to an `rgb()` / `rgba()` string.
 *
 * All DOM-touching functions degrade to the solva-dark defaults when there is
 * no document (Bun's test runner and any SSR render), so this module is safe
 * to import from anywhere.
 */

export type ThemeToken =
  | '--color-primary'
  | '--color-secondary'
  | '--color-accent'
  | '--color-base-100'
  | '--color-base-200'
  | '--color-base-300'
  | '--color-base-content'
  | '--color-neutral'
  | '--color-success'
  | '--color-warning'
  | '--color-error'
  | '--color-info';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const THEME_TOKENS: readonly ThemeToken[] = [
  '--color-primary',
  '--color-secondary',
  '--color-accent',
  '--color-base-100',
  '--color-base-200',
  '--color-base-300',
  '--color-base-content',
  '--color-neutral',
  '--color-success',
  '--color-warning',
  '--color-error',
  '--color-info',
];

/**
 * solva-dark values, mirroring src/index.css. Used when there is no document
 * (bun test / SSR) and when a token resolves to something unparseable.
 */
const FALLBACKS: Record<ThemeToken, Rgb> = {
  '--color-primary': { r: 245, g: 158, b: 11 },
  '--color-secondary': { r: 251, g: 113, b: 133 },
  '--color-accent': { r: 45, g: 212, b: 191 },
  '--color-base-100': { r: 28, g: 25, b: 36 },
  '--color-base-200': { r: 20, g: 18, b: 27 },
  '--color-base-300': { r: 44, g: 39, b: 56 },
  '--color-base-content': { r: 245, g: 239, b: 235 },
  '--color-neutral': { r: 36, g: 32, b: 46 },
  '--color-success': { r: 34, g: 197, b: 94 },
  '--color-warning': { r: 245, g: 158, b: 11 },
  '--color-error': { r: 239, g: 68, b: 68 },
  '--color-info': { r: 56, g: 189, b: 248 },
};

const clampChannel = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Parses both CSS Color 3 (`rgb(1, 2, 3)` / `rgba(1, 2, 3, 0.5)`) and CSS
 * Color 4 (`rgb(1 2 3 / 0.5)`) syntaxes. Alpha is intentionally discarded —
 * callers compose their own alpha via `rgbToCss`. Returns null when the input
 * is not an rgb-family colour (e.g. a raw `oklch()` or a hex string).
 *
 * Pure: no DOM access, so it is unit-testable under `bun test`.
 */
export function parseRgbString(input: string): Rgb | null {
  if (!input) return null;
  const match = /^rgba?\(([^)]+)\)$/i.exec(input.trim());
  if (!match) return null;

  const parts = match[1]
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((p) => p.length > 0);

  if (parts.length < 3) return null;

  const r = Number.parseFloat(parts[0]);
  const g = Number.parseFloat(parts[1]);
  const b = Number.parseFloat(parts[2]);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;

  return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b) };
}

/** Serialises an Rgb back to a canvas-safe CSS string. */
export function rgbToCss({ r, g, b }: Rgb, alpha?: number): string {
  if (alpha === undefined) return `rgb(${r}, ${g}, ${b})`;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Resolves a daisyUI theme token to concrete sRGB. daisyUI v5 emits oklch(),
 * which older canvas implementations reject, so resolve through a probe
 * element and read back the computed `color`, which every engine normalises
 * to rgb().
 */
export function resolveThemeRgb(token: ThemeToken, root?: HTMLElement): Rgb {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return FALLBACKS[token];
  }

  const host = root ?? document.documentElement;
  const raw = window.getComputedStyle(host).getPropertyValue(token).trim();
  if (!raw) return FALLBACKS[token];

  // Fast path: already an rgb-family string.
  const direct = parseRgbString(raw);
  if (direct) return direct;

  // Slow path: oklch()/lab()/color() — let the engine convert it for us.
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.opacity = '0';
  probe.style.pointerEvents = 'none';
  probe.style.color = raw;
  host.appendChild(probe);
  const computed = window.getComputedStyle(probe).color;
  host.removeChild(probe);

  return parseRgbString(computed) ?? FALLBACKS[token];
}

/** Resolves every theme token in one pass. Cache the result; re-run on theme change. */
export function createThemePalette(root?: HTMLElement): Record<ThemeToken, Rgb> {
  const palette = {} as Record<ThemeToken, Rgb>;
  for (const token of THEME_TOKENS) {
    palette[token] = resolveThemeRgb(token, root);
  }
  return palette;
}

/** Fires when documentElement's data-theme changes; returns an unsubscribe fn. */
export function subscribeToThemeChange(cb: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {};
  }
  const observer = new MutationObserver(() => cb());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}
```

- [ ] Go green:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test src/utils/themeColor.test.ts
```

Expected: `13 pass`, `0 fail`.

- [ ] Typecheck and lint:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run lint && bun run eslint
```

Expected: no output from either, exit 0.

- [ ] Commit:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
feat(theme): add themeColor runtime resolver for canvas drawing

Canvas takes CSS colour strings, not Tailwind classes, so canvas code
cannot be migrated by class swaps. themeColor.ts resolves daisyUI theme
tokens to sRGB via a probe element (daisyUI v5 emits oklch(), which some
canvas implementations reject) and exposes a MutationObserver hook for
data-theme changes. Pure parseRgbString/rgbToCss helpers are exported
separately so they are unit-testable under bun test, which has no DOM.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

### 19.3 — Red: un-allowlist AudioVisualizer

- [ ] Delete `'src/components/AudioVisualizer.tsx',` from `ALLOWLIST` in `scripts/themeTokenGuard.ts`.

- [ ] Watch it fail:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
```

Expected: `1 fail`, listing `src/components/AudioVisualizer.tsx` violations under `raw-hex` (the gradient stops and stroke colours), `rgba-literal` (the fill gradients and idle lines), `palette-color` (`bg-emerald-400`, `bg-slate-600`, `bg-indigo-600`, `text-slate-400`) and `absolute-bw` (`text-white`).

- [ ] Record the count:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun -e "import { scanRepo } from './scripts/themeTokenGuard.ts'; const v = scanRepo(process.cwd()).filter(x => x.file.endsWith('AudioVisualizer.tsx')); console.log('AudioVisualizer violations:', v.length);"
```

---

### 19.4 — Rename the `colorTheme` prop and fix every call site in one commit

The prop currently names *palettes* (`'indigo' | 'emerald' | 'amber' | 'cyberpunk'`), which is exactly the coupling that has to die. It becomes a *role*: `'primary' | 'secondary' | 'accent'`.

**What happens to `'cyberpunk'`:** it is deleted outright. It was a three-stop pink→purple→cyan novelty gradient with no equivalent in a two-theme semantic system, and nothing in the repo passes it. Verify:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -rn "cyberpunk" src/
```

Expected: only hits inside `src/components/AudioVisualizer.tsx` — no call site uses it, so removing it breaks nothing.

- [ ] Find every call site:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -rn "colorTheme" src/ | grep -v "AudioVisualizer.tsx"
```

Expected output — note there are **two**, not one:

```
src/App.tsx:88:          colorTheme="indigo"
src/components/TransportBar.tsx:183:            colorTheme="amber"
```

- [ ] `src/components/AudioVisualizer.tsx:12` — before:

```tsx
  colorTheme?: 'indigo' | 'emerald' | 'amber' | 'cyberpunk';
```

after:

```tsx
  /** Semantic role the visualizer paints in. Resolved at runtime from the
   *  active daisyUI theme by src/utils/themeColor.ts. */
  colorTheme?: 'primary' | 'secondary' | 'accent';
```

- [ ] `src/components/AudioVisualizer.tsx:21` — before: `colorTheme = 'indigo',` → after: `colorTheme = 'primary',`.

- [ ] `src/App.tsx:88` — before:

```tsx
          colorTheme="indigo"
```

after:

```tsx
          colorTheme="primary"
```

- [ ] `src/components/TransportBar.tsx:183` — the transport meter was amber, which is exactly `primary` in both Solva themes. Before:

```tsx
            colorTheme="amber"
```

after:

```tsx
            colorTheme="primary"
```

- [ ] Typecheck immediately — this is the moment the build could break, so do not defer it:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run lint
```

Expected at this point: **errors**, because the five `theme === 'emerald' ? … : …` ladders inside the render helpers still compare against removed literals. That is the signal for 19.5. Do not commit yet.

---

### 19.5 — Cache the palette in a ref and invalidate on theme change

- [ ] At the top of `src/components/AudioVisualizer.tsx`, extend the imports. Before (line 1-3):

```tsx
import React, { useRef, useEffect, useState } from 'react';
import { audioEngine } from '../audio/engine';
import { Activity, BarChart2, Waves } from 'lucide-react';
```

After:

```tsx
import React, { useRef, useEffect, useState } from 'react';
import { audioEngine } from '../audio/engine';
import { Activity, BarChart2, Waves } from 'lucide-react';
import {
  createThemePalette,
  rgbToCss,
  subscribeToThemeChange,
  type Rgb,
  type ThemeToken,
} from '../utils/themeColor';
```

- [ ] After the `prevDataRef` declaration (currently line 33), add the palette cache and a role→token resolver:

```tsx
  // Resolved theme colours, cached across frames. The rAF loop runs 60x/sec,
  // and getComputedStyle is a layout-flushing call, so it must never be in it.
  const paletteRef = useRef<Record<ThemeToken, Rgb> | null>(null);
  if (paletteRef.current === null) {
    paletteRef.current = createThemePalette();
  }

  useEffect(() => {
    const refresh = () => {
      paletteRef.current = createThemePalette();
    };
    refresh();
    return subscribeToThemeChange(refresh);
  }, []);
```

- [ ] Inside the main `useEffect` (which starts at line 39), immediately before `const render = () => {`, add the two lookup helpers the render helpers will use:

```tsx
    const ROLE_TOKEN: Record<'primary' | 'secondary' | 'accent', ThemeToken> = {
      primary: '--color-primary',
      secondary: '--color-secondary',
      accent: '--color-accent',
    };

    /** Theme colour for the active role, optionally alpha-composited. */
    const roleColor = (alpha?: number): string => {
      const palette = paletteRef.current ?? createThemePalette();
      return rgbToCss(palette[ROLE_TOKEN[colorTheme]], alpha);
    };

    /** Any theme token, optionally alpha-composited. */
    const tokenColor = (token: ThemeToken, alpha?: number): string => {
      const palette = paletteRef.current ?? createThemePalette();
      return rgbToCss(palette[token], alpha);
    };
```

- [ ] Because `roleColor`/`tokenColor` close over `colorTheme` and the palette ref, the render helpers no longer need their `theme: string` parameter. Delete the `theme` parameter from `renderBars` (line 167), `renderSpectrumWave` (line 241), `renderOscilloscope` (line 351) and `renderAmbientBg` (line 483), and delete the corresponding `colorTheme` argument from the four call sites at lines 99, 101, 103 and 106. After the edit, line 98-107 reads:

```tsx
      if (mode === 'bars') {
        renderBars(ctx, width, height, freqData, bufferLength, isSounding);
      } else if (mode === 'oscilloscope') {
        renderOscilloscope(ctx, width, height, timeData, bufferLength, isSounding);
      } else if (mode === 'ambient-bg') {
        renderAmbientBg(ctx, width, height, freqData, bufferLength, ambientOpacity, isSounding);
      } else {
        // 'wave' spectrum wave
        renderSpectrumWave(ctx, width, height, freqData, bufferLength, isSounding);
      }
```

- [ ] Line 59 — the idle placeholder line, drawn when there is no analyser. This is the single most important contrast fix in the file: `rgba(99, 102, 241, 0.2)` is an indigo at 20% opacity, invisible on `solva-light`'s `#F7F4EF`. Before:

```tsx
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
```

After — bump to 0.35 and use `base-content`, which inverts with the theme:

```tsx
        ctx.strokeStyle = tokenColor('--color-base-content', 0.35);
```

---

### 19.6 — `renderBars` (lines 161-232)

- [ ] Lines 194-213 — the four-way gradient ladder collapses to one role-driven gradient. Before:

```tsx
          const grad = c.createLinearGradient(0, h, 0, 0);
          if (theme === 'emerald') {
            grad.addColorStop(0, '#059669');
            grad.addColorStop(0.7, '#10b981');
            grad.addColorStop(1, '#6ee7b7');
          } else if (theme === 'amber') {
            grad.addColorStop(0, '#d97706');
            grad.addColorStop(0.7, '#f59e0b');
            grad.addColorStop(1, '#fde68a');
          } else if (theme === 'cyberpunk') {
            grad.addColorStop(0, '#ec4899');
            grad.addColorStop(0.5, '#a855f7');
            grad.addColorStop(1, '#38bdf8');
          } else {
            // Default Indigo
            grad.addColorStop(0, '#4338ca');
            grad.addColorStop(0.6, '#6366f1');
            grad.addColorStop(1, '#a5b4fc');
          }
```

After — the original ladders all went dark→saturated→pale bottom-to-top; alpha reproduces that ramp against any backdrop:

```tsx
          const grad = c.createLinearGradient(0, h, 0, 0);
          grad.addColorStop(0, roleColor(0.55));
          grad.addColorStop(0.7, roleColor(0.9));
          grad.addColorStop(1, roleColor(1));
```

- [ ] Line 228 — the peak-hold line. Before:

```tsx
          c.fillStyle = theme === 'cyberpunk' ? '#f43f5e' : '#e0e7ff';
```

After — a peak marker must contrast with the bar under it, so it uses `base-content`, not the role colour:

```tsx
          c.fillStyle = tokenColor('--color-base-content', 0.85);
```

---

### 19.7 — `renderSpectrumWave` (lines 235-342)

- [ ] Lines 270-289 — the area-fill gradient. Before:

```tsx
        const grad = c.createLinearGradient(0, 0, 0, h);
        if (theme === 'emerald') {
          grad.addColorStop(0, 'rgba(16, 185, 129, 0.45)');
          grad.addColorStop(0.5, 'rgba(5, 150, 105, 0.2)');
          grad.addColorStop(1, 'rgba(4, 120, 87, 0.0)');
        } else if (theme === 'amber') {
          grad.addColorStop(0, 'rgba(245, 158, 11, 0.45)');
          grad.addColorStop(0.5, 'rgba(217, 119, 6, 0.2)');
          grad.addColorStop(1, 'rgba(180, 83, 9, 0.0)');
        } else if (theme === 'cyberpunk') {
          grad.addColorStop(0, 'rgba(236, 72, 153, 0.5)');
          grad.addColorStop(0.5, 'rgba(168, 85, 247, 0.25)');
          grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
        } else {
          // Indigo
          grad.addColorStop(0, 'rgba(99, 102, 241, 0.45)');
          grad.addColorStop(0.5, 'rgba(79, 70, 229, 0.2)');
          grad.addColorStop(1, 'rgba(49, 46, 129, 0.0)');
        }
```

After:

```tsx
        const grad = c.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, roleColor(0.45));
        grad.addColorStop(0.5, roleColor(0.2));
        grad.addColorStop(1, roleColor(0));
```

- [ ] Lines 321-338 — the glow shadow and stroke. Before:

```tsx
      c.shadowBlur = isSounding ? 10 : 0;
      c.shadowColor =
        theme === 'emerald'
          ? '#34d399'
          : theme === 'amber'
          ? '#fbbf24'
          : theme === 'cyberpunk'
          ? '#f472b6'
          : '#818cf8';
      c.strokeStyle = isSounding
        ? (theme === 'emerald'
          ? '#6ee7b7'
          : theme === 'amber'
          ? '#fde68a'
          : theme === 'cyberpunk'
          ? '#f9a8d4'
          : '#c7d2fe')
        : 'rgba(99, 102, 241, 0.25)';
```

After:

```tsx
      c.shadowBlur = isSounding ? 10 : 0;
      c.shadowColor = roleColor();
      c.strokeStyle = isSounding
        ? roleColor()
        : tokenColor('--color-base-content', 0.35);
```

---

### 19.8 — `renderOscilloscope` (lines 345-474), including the font fix

- [ ] Line 359 — the dashed axis grid. Before:

```tsx
      c.strokeStyle = 'rgba(99, 102, 241, 0.2)';
```

After:

```tsx
      c.strokeStyle = tokenColor('--color-base-content', 0.25);
```

- [ ] Lines 378-379 — the axis labels. Two fixes: the slate literal becomes theme-aware at a legible alpha, and the generic `monospace` becomes the JetBrains Mono the app actually loads (`index.html:11`, `src/index.css:45-47`; design.md §3 mandates a monospace stack for numeric readouts). Before:

```tsx
      c.fillStyle = 'rgba(148, 163, 184, 0.45)';
      c.font = '8px monospace';
```

After:

```tsx
      c.fillStyle = tokenColor('--color-base-content', 0.6);
      c.font = "8px 'JetBrains Mono', monospace";
```

The alpha rises from 0.45 to 0.6 because `#241E19` text on `#F7F4EF` at 0.45 is a washed-out grey; 0.6 keeps `+1 / 0 / -1` readable in both themes.

- [ ] Lines 416-423 — the `themeColor` local (rename it: it now shadows nothing, but the name is confusing next to the imported module). Before:

```tsx
      const themeColor =
        theme === 'emerald'
          ? '#10b981'
          : theme === 'amber'
          ? '#f59e0b'
          : theme === 'cyberpunk'
          ? '#38bdf8'
          : '#6366f1';
```

After:

```tsx
      const beamColor = roleColor();
```

and update its only use at line 461: `c.shadowColor = themeColor;` → `c.shadowColor = beamColor;`.

- [ ] Lines 434-439 — the dual-sided centre glow fill. Before:

```tsx
        c.fillStyle =
          theme === 'cyberpunk'
            ? 'rgba(56, 189, 248, 0.14)'
            : theme === 'emerald'
            ? 'rgba(16, 185, 129, 0.14)'
            : 'rgba(99, 102, 241, 0.14)';
```

After:

```tsx
        c.fillStyle = roleColor(0.14);
```

- [ ] Lines 462-470 — the beam stroke. Before:

```tsx
      c.strokeStyle = isSounding
        ? (theme === 'emerald'
          ? '#6ee7b7'
          : theme === 'amber'
          ? '#fde68a'
          : theme === 'cyberpunk'
          ? '#7dd3fc'
          : '#c7d2fe')
        : 'rgba(99, 102, 241, 0.35)';
```

After:

```tsx
      c.strokeStyle = isSounding
        ? beamColor
        : tokenColor('--color-base-content', 0.4);
```

---

### 19.9 — `renderAmbientBg` (lines 477-526)

This one paints the full-page atmospheric background behind the whole app (`App.tsx:83-91`), so it is the most visible in `solva-light`.

- [ ] Lines 512-521 — the per-wave gradient. Before:

```tsx
        if (theme === 'cyberpunk') {
          grad.addColorStop(0, `rgba(236, 72, 153, ${waveAlpha})`);
          grad.addColorStop(1, `rgba(56, 189, 248, 0.01)`);
        } else if (theme === 'emerald') {
          grad.addColorStop(0, `rgba(16, 185, 129, ${waveAlpha})`);
          grad.addColorStop(1, `rgba(6, 78, 59, 0.01)`);
        } else {
          grad.addColorStop(0, `rgba(99, 102, 241, ${waveAlpha})`);
          grad.addColorStop(1, `rgba(30, 27, 75, 0.01)`);
        }
```

After — the bottom stop was always a near-transparent dark of the same hue; `base-content` at 0.01 gives the same "fades into the surface" effect and inverts correctly on the light theme:

```tsx
        grad.addColorStop(0, roleColor(waveAlpha));
        grad.addColorStop(1, tokenColor('--color-base-content', 0.01));
```

- [ ] Typecheck now — the `theme` parameter is gone from all four helpers and no ladder remains:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run lint
```

Expected: no output, exit 0. If `theme` is reported as an unused/undefined name, one of the four signatures still declares it.

- [ ] Confirm no drawing literal survives:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -nE "rgba?\([0-9]|#[0-9a-fA-F]{6}" src/components/AudioVisualizer.tsx
```

Expected: nothing (exit code 1).

---

### 19.10 — The JSX chrome (lines 552-620)

- [ ] Lines 93-95 — the imperative sounding-indicator class swap inside the rAF loop. Before:

```tsx
        indicator.className = isSounding
          ? 'w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping'
          : 'w-1.5 h-1.5 rounded-full bg-slate-600';
```

After:

```tsx
        indicator.className = isSounding
          ? 'w-1.5 h-1.5 rounded-full bg-success animate-ping'
          : 'w-1.5 h-1.5 rounded-full bg-base-content/30';
```

Both strings are complete literals, so Tailwind's v4 source scanner picks up `bg-success` and `bg-base-content/30` — do not template them.

- [ ] Lines 572-608 — the mode-switch cluster becomes a daisyUI `join`. Before:

```tsx
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-[#0B0D19]/80 backdrop-blur-xs p-1 rounded-md border border-[#252B48] z-10">
          <button
            onClick={() => setMode('wave')}
            className={`p-1 rounded text-xs transition-colors ${
              mode === 'wave'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Frequency Spectrum Wave"
          >
            <Waves className="w-3 h-3" />
          </button>
          <button
            onClick={() => setMode('bars')}
            className={`p-1 rounded text-xs transition-colors ${
              mode === 'bars'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Spectrum Bars"
          >
            <BarChart2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => setMode('oscilloscope')}
            className={`p-1 rounded text-xs transition-colors ${
              mode === 'oscilloscope'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Oscilloscope Waveform"
          >
            <Activity className="w-3 h-3" />
          </button>
        </div>
```

After:

```tsx
        <div className="join absolute top-1.5 right-1.5 flex items-center gap-1 bg-base-100/80 backdrop-blur-xs p-1 rounded-md border border-base-300 z-10">
          <button
            onClick={() => setMode('wave')}
            className={`btn btn-xs join-item btn-square ${
              mode === 'wave'
                ? 'btn-active bg-accent text-accent-content'
                : 'btn-ghost text-base-content/60'
            }`}
            title="Frequency Spectrum Wave"
          >
            <Waves className="w-3 h-3" />
          </button>
          <button
            onClick={() => setMode('bars')}
            className={`btn btn-xs join-item btn-square ${
              mode === 'bars'
                ? 'btn-active bg-accent text-accent-content'
                : 'btn-ghost text-base-content/60'
            }`}
            title="Spectrum Bars"
          >
            <BarChart2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => setMode('oscilloscope')}
            className={`btn btn-xs join-item btn-square ${
              mode === 'oscilloscope'
                ? 'btn-active bg-accent text-accent-content'
                : 'btn-ghost text-base-content/60'
            }`}
            title="Oscilloscope Waveform"
          >
            <Activity className="w-3 h-3" />
          </button>
        </div>
```

- [ ] Lines 612-618 — the static indicator dot and its caption. The dot's initial class must match the idle branch of the imperative swap above, or the first frame flickers. Before:

```tsx
        <span
          ref={indicatorRef}
          className="w-1.5 h-1.5 rounded-full bg-slate-600"
        />
        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
```

After:

```tsx
        <span
          ref={indicatorRef}
          className="w-1.5 h-1.5 rounded-full bg-base-content/30"
        />
        <span className="text-[9px] font-mono text-base-content/60 uppercase tracking-wider">
```

---

### 19.11 — Green, contrast check, commit

- [ ] Guard must now be clean for this file:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun -e "import { scanRepo } from './scripts/themeTokenGuard.ts'; const v = scanRepo(process.cwd()).filter(x => x.file.endsWith('AudioVisualizer.tsx')); console.log('AudioVisualizer violations:', v.length);"
```

Expected: `AudioVisualizer violations: 0`.

- [ ] Full gate:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens \
  && bun test \
  && bun run lint \
  && bun run eslint \
  && bun run build
```

Expected: `0 fail`, no lint output, no eslint output, `✓ built in …`.

- [ ] **Contrast verification on `solva-light`.** The whole visualizer was designed over a near-black backdrop; two elements are at real risk on `#F7F4EF`. Start the dev server and check them by eye:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run dev
```

Open the printed URL, click the theme toggle in the Header until `<html data-theme="solva-light">` (confirm in DevTools → Elements), then:

  1. **Idle line (was line 59).** Before touching any control — i.e. before an AudioContext exists — the ambient background behind the app must show a faint horizontal rule, not a blank field. Look at the full-page background layer (`App.tsx:83-91`, rendered at `opacity-25`). It should be a visible warm-charcoal hairline. If you cannot see it at all, raise the alpha in the `tokenColor('--color-base-content', 0.35)` call at line 59 to `0.45` and re-check.
  2. **Axis labels (was line 378).** Go to the Master FX view, click the visualizer canvas twice to reach oscilloscope mode, and read the `+1`, ` 0`, `-1` labels at the left edge. They must be legible without leaning in. If they wash out, raise `tokenColor('--color-base-content', 0.6)` at line 378 to `0.75`.
  3. **Peak-hold line** in bars mode: play any drum pad and confirm the thin marker riding above each bar is distinguishable from the bar beneath it in both themes.
  4. Toggle back to `solva-dark` and re-check all three — a fix for light must not blow out dark.

- [ ] Stop the dev server (Ctrl-C) and commit:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
refactor(visualizer): drive AudioVisualizer from live theme tokens

Replaces every canvas hex and rgba() literal with themeColor lookups
cached in a ref and invalidated by a data-theme MutationObserver, so the
visualizer follows solva-light. The colorTheme prop is renamed from
palette names to semantic roles ('primary' | 'secondary' | 'accent');
'cyberpunk' is deleted (no call site used it) and the five
theme === 'x' ladders collapse to one roleColor() call each. Axis labels
switch to JetBrains Mono per design.md section 3, and the idle line,
axis labels and peak markers move to base-content alphas so they stay
legible on the warm-alabaster light theme.

App.tsx and TransportBar.tsx call sites are updated in this same commit
so the build never breaks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 20: Remove dead style fields from `InstantVibe` + flag the forked duplicate

**Files:**
- Modify: `src/store/instantVibes.ts:6-14` (interface) and the four style fields on each of the 6 presets
- Modify: `src/audio/instantVibes.ts` — same edits, to keep the fork byte-comparable
- Modify: `scripts/themeTokenGuard.ts` (remove both paths from `ALLOWLIST`)
- Test: `src/store/instantVibes.test.ts`

**Interfaces:**
- Consumes: `ALLOWLIST` from Task 2.
- Produces: `InstantVibe` without `color`, `bgGradient`, `borderColor`, `textColor`. No consumer changes needed — verified below that nothing renders them.

**Why deletion rather than tokenization.** These four fields are the last `palette-color` violations in the repo, but unlike every other task in this plan they have **no consumer**. `src/components/InstantVibesBar.tsx` is the only importer of `INSTANT_VIBES` and it reads exactly `id`, `name`, `emoji`, `bpm`, `scaleRoot`, `scaleType`, `projectTitle` (lines 11-12, 44-61). Tokenizing `'from-amber-950/40 via-stone-900/40 to-amber-950/20'` into a semantic gradient would produce a string that still nothing reads. YAGNI: delete the fields.

- [ ] **Step 1: Prove the fields are dead**

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens
grep -rn "bgGradient\|borderColor\|textColor" src --include="*.tsx"
grep -rn "vibe\.color\|\.color\b" src/components/InstantVibesBar.tsx
```

Expected: both commands print nothing. If either prints a match, STOP — a consumer exists and this task must tokenize instead of delete. Report the match and do not proceed.

- [ ] **Step 2: Write the failing guard test**

Delete these two lines from the `ALLOWLIST` array in `scripts/themeTokenGuard.ts`:

```ts
  'src/audio/instantVibes.ts',
  'src/store/instantVibes.ts',
```

- [ ] **Step 3: Run the guard to verify it fails**

```bash
bun test scripts/themeTokenGuard.test.ts
```

Expected: FAIL, listing `palette-color` violations at `src/store/instantVibes.ts` lines 124, 125, 126 and the equivalent lines for the other five presets, plus the same set in `src/audio/instantVibes.ts`.

- [ ] **Step 4: Add a regression test that the style fields are gone**

Append to `src/store/instantVibes.test.ts`:

```ts
test('InstantVibe presets carry no presentational fields', () => {
  const FORBIDDEN = ['color', 'bgGradient', 'borderColor', 'textColor'];
  for (const vibe of INSTANT_VIBES) {
    for (const key of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(vibe, key)).toBe(false);
    }
  }
});
```

- [ ] **Step 5: Run it to verify it fails**

```bash
bun test src/store/instantVibes.test.ts
```

Expected: FAIL — `expect(true).toBe(false)` on the `color` key of `lofi-chill`.

- [ ] **Step 6: Delete the four interface fields**

In `src/store/instantVibes.ts`, change lines 6-14 from:

```ts
export interface InstantVibe {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  color: string;
  bgGradient: string;
  borderColor: string;
  textColor: string;
  bpm: number;
```

to:

```ts
export interface InstantVibe {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  bpm: number;
```

Apply the identical edit to `src/audio/instantVibes.ts`.

- [ ] **Step 7: Delete the four fields from all 6 presets in both files**

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens
for f in src/store/instantVibes.ts src/audio/instantVibes.ts; do
  perl -ni -e "print unless /^\s+(color|bgGradient|borderColor|textColor):\s*'/" "$f"
done
grep -c "bgGradient\|borderColor\|textColor" src/store/instantVibes.ts src/audio/instantVibes.ts
```

Expected: both files report `0`.

- [ ] **Step 8: Verify green**

```bash
bun test src/store/instantVibes.test.ts src/audio/instantVibes.test.ts
bun test scripts/themeTokenGuard.test.ts
bun run lint
```

Expected: all PASS. `bun run lint` must report no errors — if `tsc` complains that a preset is missing a property, a field was over-deleted; restore it.

- [ ] **Step 9: Commit**

```bash
git add src/store/instantVibes.ts src/audio/instantVibes.ts src/store/instantVibes.test.ts scripts/themeTokenGuard.ts
git commit -m "$(cat <<'EOF'
refactor: drop unused presentational fields from InstantVibe

color/bgGradient/borderColor/textColor were never read by
InstantVibesBar, the only consumer. Removing them clears the last
palette-color violations from the theme-token guard allowlist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: Flag the fork — do NOT resolve it**

`src/audio/instantVibes.ts` (774 lines) and `src/store/instantVibes.ts` (739 lines) are a **diverged fork**, not a copy. `diff` reports ~120 differing lines. The `audio/` copy is the newer one: it additionally drives the audio engine on load (`audioEngine.init()`, `setClockBpm`, `updateSynthParams` for synth/chord/bass, `setDrumFilter`) and uses different preset content (`'Velvet EP'` where `store/` has `'Dream Keys'`, an extra `delayTime: '8n'`). **The app imports the older `store/` copy** — `InstantVibesBar.tsx:3` is the only import site — so the newer audio-engine wiring is dead code that never runs.

Both files have their own passing test file, which is why CI never caught this.

Do not delete either file and do not switch the import in this plan. Choosing which fork wins changes runtime audio behaviour and preset content, which is a product decision outside a theme migration. Instead, record it:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens
cat >> docs/design.md <<'EOF'

### Known issue: forked Instant Vibes module

`src/audio/instantVibes.ts` and `src/store/instantVibes.ts` are diverged
copies of the same module. Only `store/` is imported (by
`InstantVibesBar.tsx`); the `audio/` copy additionally initialises the
audio engine and carries different preset content, and is dead code.
Resolving the fork is a product decision — it changes which presets and
which engine-sync behaviour ship — and is deliberately out of scope for
the theme-token migration.
EOF
git add docs/design.md
git commit -m "$(cat <<'EOF'
docs: record the forked Instant Vibes module as a known issue

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Report the fork to the user at the end of the plan run so they can decide which copy wins.

---
## Task 21: sync `docs/design.md` with reality

**Files:**
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/docs/design.md` (70 lines)

**Interfaces:**
- **Consumes:** the finished state of `src/index.css` (Task 1), `scripts/themeTokenGuard.ts` (Task 2), and the full component tree as it exists after Tasks 3-19.
- **Produces:** a spec that matches the code, so the next contributor's "source of truth" is actually true. No code changes, no test changes.

The spec has drifted in five distinct ways. Fix each one, and **never** fix drift by changing the code to match the doc unless a step below says so explicitly.

### 20.1 — §3: the font is Figtree, not Inter

- [ ] Prove it before editing:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && sed -n '40,48p' src/index.css && grep -n "fonts.googleapis" index.html
```

Expected: `src/index.css:42` is `font-family: 'Figtree', system-ui, -apple-system, sans-serif;`, and `index.html:11` loads `family=Figtree:ital,wght@0,300..900;1,300..900&family=JetBrains+Mono:wght@400;500;600;700`. Inter is loaded nowhere.

- [ ] `docs/design.md:43` — before:

```markdown
* **Headings & Titles:** Inter / System Sans-Serif with `tracking-tight` for compact musical labels.
```

after:

```markdown
* **Headings & Titles:** **Figtree** (variable, 300-900, loaded from Google Fonts in `index.html`) falling back to `system-ui, -apple-system, sans-serif`, with `tracking-tight` for compact musical labels. Applied to `body` in `src/index.css`.
```

- [ ] `docs/design.md:44` — before:

```markdown
* **Musical Values & BPM:** Monospace font stack (`font-mono`) for numerical readouts (BPM, Filter cutoff, Gain dB, step timing).
```

after:

```markdown
* **Musical Values & BPM:** **JetBrains Mono** (weights 400/500/600/700), bound in `src/index.css` to `code, pre, .font-mono`. Every numeric readout carries `font-mono`: BPM, filter cutoff in Hz, gain in dB, percentages, octave offsets, arp step timing (`1/16`, `1/8`, `1/32`), and the oscilloscope's canvas axis labels, which set `8px 'JetBrains Mono', monospace` directly on the 2D context.
```

### 20.2 — §2: document `neutral` and the state colours

- [ ] Confirm what actually exists:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -nE "^\s+--color-" src/index.css
```

- [ ] In the `solva-dark` bullet list (`docs/design.md:18-24`), append after the Base Content line:

```markdown
* **Neutral (`neutral`):** `#24202E` / content `#F5EFEB` (chrome that must not read as an accent — inactive audition pills, muted chips)
* **Success (`success`):** `#22C55E` — "saved", "envelope OK", live-signal indicator
* **Warning (`warning`):** `#F59E0B` — VU meter upper-mid segments
* **Error (`error`):** `#EF4444` — destructive actions, VU clip segments, mute-on
* **Info (`info`):** `#38BDF8` — neutral informational hints
```

- [ ] In the `solva-light` bullet list (`docs/design.md:29-35`), append after its Base Content line:

```markdown
* **Neutral (`neutral`):** `#3D352E` / content `#FFFFFF`
* **Success (`success`):** `#16A34A`
* **Warning (`warning`):** `#D97706`
* **Error (`error`):** `#DC2626`
* **Info (`info`):** `#0284C7`
```

- [ ] **Before committing, replace every hex above with the value actually written into `src/index.css` by Task 1.** Read the file and copy the literals across; do not trust the placeholders in this plan if they disagree with the CSS. The CSS is the source, the doc is the mirror.

- [ ] Add a closing note to §2:

```markdown
> Both themes are declared CSS-first in `src/index.css` via `@plugin "daisyui/theme" { … }`. There is no `tailwind.config.*` file in this repository and none may be added. The active theme is read from `document.documentElement.dataset.theme` and persisted to `localStorage` under `solva_theme`; `index.html` sets the attribute in a blocking `<head>` script so light-theme users never see a dark first paint.
```

### 20.3 — §4: list the components that actually exist

- [ ] Enumerate them:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && ls src/components src/components/ui src/components/chord
```

- [ ] §4 currently lists 7 components and stops at `EffectsRackView.tsx`. Append these entries after item 7:

```markdown
8. **`ProjectModal.tsx`**: Project save / load / export / import dialog, rendered as a daisyUI `modal` with a `modal-box` and `modal-backdrop`.
9. **`AudioVisualizer.tsx`**: Canvas visualizer with four modes (`wave`, `bars`, `oscilloscope`, `ambient-bg`). Because canvas takes colour strings rather than classes, it reads the live theme through `src/utils/themeColor.ts`; its `colorTheme` prop takes a semantic role (`primary` | `secondary` | `accent`), never a palette name.
10. **`DrumPads.tsx`**: Velocity-sensitive drum pad grid with computer-key shortcuts. Exports `DEFAULT_PADS`, whose `shortcut` codes are asserted collision-free against the synth keyboard by `scripts/check-key-bindings.ts`.
11. **`ChordPresetLibrary.tsx`** / **`SynthPresetLibrary.tsx`**: Searchable, category-filtered preset browsers for chord progressions and synth patches, including user-saved presets from `localStorage`.
12. **`chord/SortableChordCard.tsx`**: A single draggable chord card (`@dnd-kit/sortable`) used by `ChordView`.
13. **`InstantVibesBar.tsx`** *(see §4.1)* and **`useSequencerPlayback.ts`** / **`chord/useChordPlayback.ts`**: playback hooks, not visual components.

### 4.8 The `ui/` primitive layer

Shared, presentation-only controls under `src/components/ui/`. These own the daisyUI class defaults, so feature components should pass **no** colour overrides:

* **`Knob.tsx`** — rotary control. Its `color` prop is a closed union: `'text-primary' | 'text-secondary' | 'text-accent' | 'text-success' | 'text-error'`. Passing a raw palette class is a compile error, which is deliberate.
* **`Slider.tsx`** — wraps `<input type="range">`; defaults to `range range-primary range-xs w-full`.
* **`Keyboard.tsx`** — `ScaleLockedKeyboard` and `ChromaticKeyboard`, plus the `KEYBOARD_NOTES` binding table and the `getBlackKeyLeftPx` geometry helper covered by `SynthView.test.tsx`.
* **`ChannelStrip.tsx`** — mixer channel (fader, mute, solo, pan).
* **`PresetLibrary.tsx`** — the generic library shell both preset browsers build on.
* **`QuickSavePopover.tsx`** — inline name-and-category save form; its `inputClassName` / `buttonClassName` / `selectClassName` props default to daisyUI classes and should be left alone.
```

### 20.4 — §4.3: correct the TransportBar overstatement

- [ ] Read the implementation and confirm the drift for yourself:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && sed -n '132,158p' src/components/TransportBar.tsx && sed -n '202,226p' src/components/TransportBar.tsx
```

Expected: the BPM control at lines 133-157 is a `Minus` button, a `<input type="number" min={40} max={240}>` and a `Plus` button — **there is no tap-tempo affordance anywhere**. The meter at lines 204-225 is a single `Array.from({ length: 10 })` segment bar fed by one scalar `vuLevel` — **it is mono, not stereo**.

- [ ] `docs/design.md:58` — before:

```markdown
3. **`TransportBar.tsx`**: Bottom sticky player controls featuring Play/Stop All, Tab Play, Tap Tempo BPM control, Metronome toggle, real-time stereo VU meter, and Master Output volume fader.
```

after:

```markdown
3. **`TransportBar.tsx`**: Bottom sticky player controls featuring Play/Stop All, Tab Play, a BPM stepper (−/+ buttons around a `40`–`240` number input; there is **no** tap-tempo), a Metronome toggle, a **mono** 10-segment VU meter (green below segment 7, `warning` at 7-8, `error` at 9-10), and the Master Output volume fader.
```

- [ ] Add a "not built" note directly beneath that item, so the two features are recorded as intentional future work rather than silently deleted:

```markdown
   > **Explicitly unbuilt.** Two features described in earlier revisions of this spec were never implemented and are recorded here as future work, not as shipped behaviour:
   > - **Tap Tempo** — a button that derives BPM from the interval between successive clicks. The BPM setter (`setBpm`) already exists in the store, so this is UI-only work.
   > - **Stereo VU** — the meter reads a single scalar level. Making it stereo requires a channel-split analyser in `src/audio/engine.ts` before any UI change is worthwhile.
```

### 20.5 — §4.2: document the InstantVibes id ↔ name drift

- [ ] Confirm the mapping:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -nE "id: '|name: '" src/store/instantVibes.ts | head -14
```

Expected pairs: `lofi-chill`/`Lo-Fi Chill`, `synthwave-80s`/`Synthwave 80s`, `cyber-dance`/`Cyber EDM`, `ambient-chill`/`Deep Ambient`, `hiphop-groove`/`Boom Bap`, `asian-zen`/`Zen Garden`.

- [ ] Append to `docs/design.md`'s item 2 (`InstantVibesBar.tsx`, line 57):

```markdown
   > **Ids drift from display names — do not "fix" this.** Four vibe ids predate their current labels. Project files persist the id, so renaming an id silently breaks every saved project that references it.
   >
   > | id (persisted) | display name |
   > |---|---|
   > | `lofi-chill` | Lo-Fi Chill |
   > | `synthwave-80s` | Synthwave 80s |
   > | `cyber-dance` | **Cyber EDM** |
   > | `ambient-chill` | **Deep Ambient** |
   > | `hiphop-groove` | **Boom Bap** |
   > | `asian-zen` | **Zen Garden** |
   >
   > The table is duplicated in `src/store/instantVibes.ts` and `src/audio/instantVibes.ts`; both copies must stay in sync.
```

### 20.6 — New §6: the role map and the enforced guard

- [ ] Append a new section at the end of `docs/design.md`, after §5:

```markdown
---

## 6. Token Discipline & Enforcement

Solva has exactly two themes, and every surface must work in both. That is only achievable if **no component names a colour**. Components name *roles*; `src/index.css` maps roles to colours; daisyUI swaps the mapping when `data-theme` changes.

### 6.1 Canonical role map

Legacy Murva-era colours and their permanent replacements. When you touch old code, apply this table verbatim — do not improvise a "closer" match.

| legacy value | semantic token |
|---|---|
| `#0B0D19`, `#0E1022` — app / page inset background | `bg-base-200` |
| `#12152A`, `#171B36`, `#171B38`, `#161B36`, `#1A1E38`, `#1A1F3B`, `#1A1F3A`, `#181C35` — panels & cards | `bg-base-100` |
| `#1C213E`, `#22284C`, `#22274A`, `#20264A`, `#151933` — hover fills and recessed wells | `bg-base-300` / `hover:bg-base-300` |
| `#252B48`, `#2D355A`, `#3B4371`, `#1E2344` — borders and hairlines | `border-base-300` / `bg-base-300` |
| `indigo-*` — primary action, active state, playhead | `primary` (Sunrise Amber) |
| `purple-*` / `pink-*` — harmony, chords, filter / VCF | `secondary` (Dawn Coral) |
| `cyan-*` / `purple-*` — LFO, modulation, arpeggiator | `accent` (Fresh Teal) |
| `emerald-*` meaning "OK / saved / envelope healthy" | `success` |
| `emerald-*` used as a module accent (e.g. the bass channel) | `accent` |
| `rose-*` / `red-*` — delete, mute-on, clip | `error` |
| `slate-100` / `slate-200` / `slate-300` | `text-base-content` |
| `slate-400` / `slate-500` | `text-base-content/60` (or `/50`) |
| `text-white` sitting on a coloured fill | the matching `*-content` token |
| `bg-black/60`, `bg-black/70` overlays | `modal-backdrop` / `bg-neutral/60` |

### 6.2 Component classes, not hand-rolled markup

| hand-rolled | daisyUI |
|---|---|
| raw `<button>` | `btn btn-xs` / `btn btn-sm` + `btn-ghost` / `btn-primary` / `btn-secondary` / `btn-accent` / `btn-active` |
| raw `<select>` | `select select-sm select-bordered` |
| raw `<input type="text">` | `input input-sm input-bordered` |
| `<input type="range">` | `range range-xs` + `range-primary` / `range-secondary` / `range-accent` |
| panel `<div>` | `card bg-base-100 border border-base-300` wrapping a `card-body` |
| modal `<div>` | `<dialog className="modal modal-open">` + `modal-box` + `modal-backdrop` + `modal-action` |
| segmented control | `tabs tabs-box`, or `join` + `btn join-item` |
| pill / tag `<span>` | `badge badge-sm` (+ `badge-primary` / `badge-outline` / …) |
| toast `<div>` | `toast` container + `alert alert-success` |
| keycap chip | `kbd kbd-xs` |

### 6.3 The guard

`scripts/themeTokenGuard.ts` is a dependency-free scanner that walks `src/**/*.{ts,tsx}` and reports violations. Its rules:

| rule | catches |
|---|---|
| `raw-hex` | any `#RRGGBB` in a class string or style value |
| `palette-color` | Tailwind palette classes: `indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*` |
| `absolute-bw` | `text-white`, `bg-white`, `text-black`, `bg-black` |
| `dark-variant` | the `dark:` variant, which is meaningless under daisyUI's `data-theme` switching |
| `rgba-literal` | `rgba(…)` / `rgb(…)` with numeric channels, including inside canvas code |
| `invalid-utility` | classes that silently do nothing: `py-0.2`, `scale-102`, `z-60`, `xs:` |

It is enforced by `scripts/themeTokenGuard.test.ts` under `bun test`, and its `ALLOWLIST` is **empty**. A test asserts the allowlist stays empty, so the guard cannot be quietly re-populated to make a build pass. Canvas code, which cannot use classes at all, resolves colours at runtime through `src/utils/themeColor.ts`.
```

### 20.7 — Verify and commit

- [ ] Re-read the finished doc top to bottom and confirm no claim is unverified:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && cat docs/design.md
```

- [ ] Spot-check the three highest-risk claims against the code one final time:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens \
  && grep -n "Figtree" src/index.css index.html \
  && grep -c "tap\|Tap" src/components/TransportBar.tsx \
  && grep -n "ALLOWLIST" scripts/themeTokenGuard.ts
```

Expected: Figtree appears in both files; the tap-tempo grep prints `0`; the `ALLOWLIST` declaration is present. At this point the allowlist is already empty (Task 20 removed the last two entries), so §6.3's claim is true as written. Task 22 then locks it down with a test that fails if anything is ever re-added.

- [ ] Commit:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
docs(design): sync the spec with the implemented system

Corrects section 3 (the app loads Figtree + JetBrains Mono, not Inter),
documents neutral and the success/warning/error/info tokens added to both
themes, and expands section 4 to cover ProjectModal, AudioVisualizer,
DrumPads, the two preset libraries, SortableChordCard and the whole ui/
primitive layer.

Corrects the TransportBar entry, which claimed a Tap Tempo control and a
stereo VU meter; the implementation has a +/- BPM stepper and a mono
10-segment meter. Both are recorded as explicitly-unbuilt future work
rather than deleted. Documents the InstantVibes id/display-name drift as
intentional, since ids are persisted in project files.

Adds section 6 covering the canonical role map, the daisyUI component
map and the themeTokenGuard rules, so the convention is discoverable
rather than tribal knowledge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 22: final sweep, allowlist lockdown, and full verification

**Files:**
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.ts` (`ALLOWLIST` → `[]`)
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/scripts/themeTokenGuard.test.ts` (add the lockdown test)
- Modify: `/Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens/package.json` (add `check:theme` and `verify` scripts)

**Interfaces:**
- **Consumes:** every preceding task. This task adds no new refactoring; if it finds violations, the fix belongs in the task that owns the file.
- **Produces:** `bun run verify` — one command that runs the whole gate — plus a test that makes re-populating `ALLOWLIST` impossible without deleting a test.

> **Verification discipline (superpowers:verification-before-completion).** No claim of "done", "passing", "clean" or "migrated" may be made for this plan until **every** command in 21.2 and 21.3 has actually been run in this session and its output read. Evidence before assertions, always. A green memory of a command from an earlier task does not count; re-run it here.

### 21.1 — Lock the allowlist empty (TDD)

- [ ] Inspect the current allowlist:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun -e "import { ALLOWLIST } from './scripts/themeTokenGuard.ts'; console.log(ALLOWLIST.length, ALLOWLIST);"
```

If it is not `0 []`, some earlier task did not finish. **Stop and finish that task** — do not remove entries here to make this one pass.

- [ ] Add the lockdown test to `scripts/themeTokenGuard.test.ts`. Append inside the existing top-level `describe`:

```ts
  test('ALLOWLIST is empty and stays empty', () => {
    // The migration is complete: every src file must pass the guard on its own
    // merits. Re-adding an entry here is how a theme regression gets shipped,
    // so this test exists specifically to make that a visible, deliberate act.
    expect(ALLOWLIST).toEqual([]);
    expect(ALLOWLIST.length).toBe(0);
  });
```

Confirm `ALLOWLIST` is already among the imports at the top of that file; if not, add it to the existing import from `./themeTokenGuard`.

- [ ] Prove the test actually bites. Temporarily add a bogus entry to `ALLOWLIST` in `scripts/themeTokenGuard.ts`:

```ts
export const ALLOWLIST: readonly string[] = ['src/components/SynthView.tsx'];
```

then run:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
```

Expected: `1 fail` on `ALLOWLIST is empty and stays empty`. **This red step is not optional** — a lockdown test that cannot fail protects nothing.

- [ ] Revert to the empty array:

```ts
export const ALLOWLIST: readonly string[] = [];
```

- [ ] Re-run:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun test scripts/themeTokenGuard.test.ts
```

Expected: `0 fail`.

### 21.2 — Add `check:theme` and a combined `verify` script

- [ ] `package.json` currently has four scripts (lines 6-11):

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "tsc --noEmit",
    "eslint": "eslint ."
  },
```

Replace that block with:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "tsc --noEmit",
    "eslint": "eslint .",
    "check:theme": "bun test scripts/themeTokenGuard.test.ts",
    "check:keys": "bun scripts/check-key-bindings.ts",
    "check:drums": "bun scripts/check-drum-kit-separation.ts",
    "verify": "bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run build"
  },
```

`check:theme` is a named alias for reviewers; `verify` deliberately starts with `bun test`, which already includes the theme guard test, so the guard runs whether or not anyone remembers the alias.

- [ ] Run each new script individually so a failure is attributable:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run check:theme
```

Expected: `0 fail`.

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run check:keys
```

Expected:

```
PASS drum pads unique (...)
PASS synth keys unique (KeyA KeyW KeyS KeyE KeyD KeyF KeyT KeyG KeyY KeyH KeyU KeyJ KeyK KeyO KeyL KeyP Semicolon Quote)
PASS no drum/synth overlap (none)
PASS all codes valid KeyboardEvent.code (invalid: none)
All key binding checks passed.
```

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run check:drums
```

Expected: a long list of `PASS kit "…" overrides …` lines, then `All checks passed.` and exit 0.

### 21.3 — Run the whole gate

- [ ] One command, all of it:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run verify
```

Expected, in order:
  1. `bun test` — every test file, summary line ends `0 fail`.
  2. `bun run lint` — silent, exit 0.
  3. `bun run eslint` — silent, exit 0.
  4. `bun run check:keys` — `All key binding checks passed.`
  5. `bun run check:drums` — `All checks passed.`
  6. `bun run build` — `✓ built in …` followed by the `dist/` asset table.

If any stage fails, `verify` short-circuits there. Fix that stage and re-run the **whole** command; do not resume from the middle.

- [ ] Belt-and-braces repo-wide grep — this catches anything the guard's rule set might not cover:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && grep -rnE "#[0-9A-Fa-f]{6}|(indigo|slate|purple|emerald|pink|cyan|rose)-[0-9]{3}|text-white|bg-white|dark:|py-0\.2|scale-102|z-60|xs:" src/ --include="*.tsx" --include="*.ts" | grep -v ".test."
```

Expected: **no output**. If a line appears, identify which task owns that file and fix it there, then re-run `bun run verify`.

### 21.4 — Manual browser verification, both themes

Automated checks prove the tokens are *used*; only eyes prove the result is *usable*. Do this once per theme, end to end.

- [ ] Start the app:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && bun run dev
```

- [ ] **Cold-start flash check.** Set `localStorage.setItem('solva_theme', 'solva-light')` in the DevTools console, then hard-reload (Cmd-Shift-R). Watch the very first painted frame. **There must be no dark flash** — the `<head>` script added in Task 1 sets `data-theme` before first paint. Repeat with `'solva-dark'` and confirm no white flash. Confirm in Elements that `<html>` carries the expected `data-theme`.

- [ ] Now walk every view. Switch themes with the Header's theme-toggle button and repeat the entire list a second time.

**Header + global chrome (visible in every view)**
  - Brand logo and project title legible; the view tabs (`Synth`, `Step Matrix`, `Chords`, `Master FX`) show a clear active state.
  - Key and Scale `<select>`s: readable text, visible border, and the **native dropdown menu itself** is readable when opened (this is the failure mode the deleted `<option>` colour overrides caused).
  - Full-page ambient visualizer behind everything: present but subtle, never muddying text.
  - Bottom TransportBar: Play/Stop icons, BPM stepper digits, metronome toggle, VU meter segments (drive audio loud enough to reach the `warning` and `error` segments), master fader thumb and track.

**Synth view**
  - Header card: Target `join` (Synth/Chord/Bass) — active pill clearly distinct; the "Target:" label is now **visible** at ≥`sm` width (it was dead before).
  - Simple/Pro switch; Save and Presets buttons; the preset-count badge.
  - Simple mode: big preset title, category badge, prev/next steppers, the preset `<select>` and its open dropdown, the Sound Style chip row, and the "Switch to Pro Mode →" link.
  - Click Save → the toast appears bottom-of-card as a green `alert alert-success` and is readable in **both** themes.
  - Pro mode: all five panel cards (Oscillators, VCF, ADSR, LFO & Octave, Arpeggiator). For each — header icon colour, section border, every selector's active vs inactive state, and every knob's needle/arc colour and its numeric readout.
  - Switch Target to Chord, then Bass: the panel tint ring changes to amber then teal, and the keyboard's Audition badge follows.
  - Keyboard tray: white and black keys both visible against the `base-300` well; press a key and confirm the held-key highlight reads clearly; the octave badge and its −/+ steppers; the active-note readout text.
  - Press `A`, `S`, `D` on the computer keyboard and confirm notes sound and highlight (proves the `KEYBOARD_NOTES` re-export did not disturb the handler wiring).

**Step Matrix view**
  - Track rows and labels; step cells in all three states (off, on, playing); the playhead column; velocity/probability editing affordances; the drum pad grid with its `kbd` shortcut chips; kit selector.

**Chords view**
  - Chord cards, including the selected/ring state and mid-drag appearance; Roman-numeral labels; the add/remove controls; the preset library modal, its search input, category filters and badges.

**Master FX view**
  - Reverb / Delay / Distortion / EQ cards; every `range` slider's track and thumb; numeric readouts; the visualizer panel with `showControls` — click through `wave` → `bars` → `oscilloscope` and check each mode's colours, the oscilloscope's `+1 / 0 / -1` axis labels, the peak-hold markers, and the live-signal dot in both idle and sounding states.

**Modals**
  - Open the Project modal: backdrop dims correctly (not pure black on the light theme), `modal-box` sits on `base-100`, inputs and action buttons are all readable.

- [ ] Any defect found: fix it in the owning file, re-run `bun run verify`, and re-walk the affected view in **both** themes. Repeat until the walk is clean.

- [ ] Stop the dev server.

### 21.5 — Final commit

- [ ] Confirm a clean tree apart from the intended changes:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git status --short && git diff --stat
```

- [ ] Commit:

```bash
cd /Users/Pathompong/Sites/Personal/solva/.claude/worktrees/daisyui-theme-tokens && git add -A && git commit -F- <<'EOF'
chore(theme): empty the guard allowlist and add a combined verify script

Every src file now passes scripts/themeTokenGuard.ts on its own merits,
so ALLOWLIST is emptied and a test asserts it stays empty — re-adding an
entry to silence the guard now requires deleting a test.

Adds check:theme, check:keys, check:drums and a combined `verify` script
that chains bun test, tsc, eslint, both data-integrity checks and the
production build, so the whole gate is one command.

Verified: bun run verify green end to end, plus a manual walk of the
Synth, Step Matrix, Chords and Master FX views in both solva-dark and
solva-light with no dark/light flash on cold reload.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
```

- [ ] **Only now** may the migration be described as complete — and only by citing the output you actually saw from `bun run verify` and the two-theme browser walk.
