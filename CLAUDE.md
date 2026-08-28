# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Runtime is **Bun** (test runner + scripts); the app itself is Vite + React 18.

```bash
bun run dev            # Vite dev server on 0.0.0.0:3000
bun run build          # production build
bun run lint           # tsc --noEmit (type-check only)
bun run eslint         # eslint . (import-layering rules live here)
bun test               # all tests
bun test src/audio/engine.test.ts          # one file
bun test -t "reverb decay"                 # one test by name
bun run check:theme    # theme-token guard suite only
bun run check:keys     # drum-pad vs synth key-binding collision check
bun run check:drums    # drum-kit audible-separation check
bun run verify         # test + lint + check:keys + check:drums + build (the gate)
```

`bun run verify` is the completion gate — run it before claiming work is done. Note it does **not** include `bun run eslint`; run that separately when you touch imports.

## Architecture

Single-page audio workstation ("Solna"): four tab views (Synth, Sequencer, Chords, Effects) that stay mounted simultaneously (`activeTab` toggles `block`/`hidden` in `App.tsx`) so audio never stops when switching tabs.

**Three layers, enforced by eslint `no-restricted-imports`:**

1. `src/audio/` — never imports `store/` or `components/`. Pure DSP + a single `audioEngine` singleton built on the **raw Web Audio API** (no Tone.js; `tonal` is used for theory only). All engine setters no-op until `init()` creates the `AudioContext`.
2. `src/store/` — never imports `components/`. One Zustand store composed from slices (`transport`, `musicContext`, `synth`, `chords`, `bass`, `sequencer`, `effects`, `ui`, `presets`), with `persist` (key `musibox_project_state_v1`, **version 5**, `partialize` + `migrate` in `store.ts`, legacy-key adoption in `migrate.ts`) and `subscribeWithSelector`.
3. `src/components/` — dumb views; must not import `audio/engine`. Only `AudioVisualizer.tsx`, `TransportBar.tsx` and `ui/AmbientBackdrop.tsx` (read-only analyser consumers) and test files are exempt — routing their per-frame analyser reads through the store would mean a store write on every animation frame and a re-render of every subscriber.

**The store→engine bridge** is `src/store/engineSync.ts`: one `subscribeWithSelector` subscription per engine-settable value with `fireImmediately`, started once by `useEngineSync()` in `App.tsx`. The `AudioContext` is created on the first user click, after which `applyEngineSnapshot()` re-applies the whole persisted audio state. **Never call engine setters from a component** — add the state to a slice and wire it in `engineSync.ts`.

**Storage access is always guarded.** `localStorage` can *throw* (Safari private mode, blocked cookies, embedded webviews), not just return null — `store.ts` falls back to an in-memory `StateStorage`, and helpers like `Header.tsx`'s theme functions take an injectable storage param and read it *inside* a `try`, never in a default-parameter expression.

## Theming — the hard rule

Two daisyUI themes (`solna-dark`, `solna-light`) declared CSS-first in `src/index.css` via `@plugin "daisyui/theme"`. **There is no `tailwind.config.*` and none may be added.** `index.html` sets `data-theme` in a blocking head script; it persists to `localStorage` under `solna_theme`.

Components name **roles**, never colours. `scripts/themeTokenGuard.ts` scans `src/**/*.{ts,tsx}` and fails the build on: raw hex, Tailwind palette classes (`indigo-*`, `slate-*`, `purple-*`, `emerald-*`, `pink-*`, `cyan-*`, `rose-*`), `text-white`/`bg-black`/etc., the `dark:` variant, `rgb()`/`rgba()` literals, and silently-dead utilities (`py-0.2`, `scale-102`, `z-60`, `xs:`). Its `ALLOWLIST` is empty and the suite has hygiene + shrink tests that make re-populating it fail — fix the code, not the allowlist. Canvas code (which cannot use classes) resolves live theme colours at runtime through `src/utils/themeColor.ts`.

`docs/design.md` is the authoritative spec: §6.1 has the legacy-colour → token map (apply it verbatim, don't improvise), §6.2 the hand-rolled-markup → daisyUI-component map, §4 the per-component contract (e.g. `Knob`'s `color` prop is a closed union by design; `ui/` primitives own their daisyUI class defaults, so feature components pass no colour overrides).

## Testing conventions

Tests are `bun:test` and mostly **pure-logic**: components export their testable helpers (e.g. `resolveInitialTheme`/`persistTheme` from `Header.tsx`, `KEYBOARD_NOTES` from `SynthView.tsx`, `DEFAULT_PADS` from `DrumPads.tsx`) and the `.test.tsx` file imports those rather than rendering React. There is no DOM/testing-library setup — keep new tests in that style.

Two invariant scripts import straight from source and must keep passing: `check-key-bindings.ts` (drum and synth `KeyboardEvent.code` sets are unique, non-overlapping, and well-formed) and `check-drum-kit-separation.ts` (every kit overrides every drum type and parameters spread far enough to be audibly distinct).

## Traps recorded in the spec — don't "fix" these

- **Instant Vibes ids drift from labels** (`cyber-dance` → "Cyber EDM", `ambient-chill` → "Deep Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden"). Ids are persisted in project files; renaming them breaks saved projects. The table lives in `src/store/instantVibes.ts` — the single copy since the `audio/` fork was deleted.
- **Tap Tempo and stereo VU are unbuilt**, not broken — see `docs/design.md` §4 item 3.

## Repo-local skills

`.claude/skills/` ships two skills worth loading when relevant: `dsp-audio` (read before touching effect chains, signal routing, or `AudioContext` lifecycle) and `music-theory` (before touching notes, keyboard, drum pads, sequencer, or chord/bass generation).

`squash-by-logical-change` (consolidating noisy agent-generated commits before review) is a **global** skill in `~/.claude/skills/`, not part of this repo.
