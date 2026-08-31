# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Do not record version numbers here.** Dependency versions, the persist `version`, file
counts and line numbers all change through routine work and go stale silently. Read
`package.json` / the source instead, and write down the *rule*, not the number.

## Commands

Runtime is **Bun** (test runner + scripts); the app itself is Vite + React.

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

`bun run verify` is the completion gate — run it before claiming work is done. It does **not**
include `bun run eslint`, so unused variables and imports pass the gate unnoticed; run eslint
separately whenever you touch imports or delete code.

## Architecture

Single-page audio workstation ("Solna"): four tab views (Synth, Sequencer, Chords, Effects) that
stay mounted simultaneously (`activeTab` toggles `block`/`hidden` in `App.tsx`) so audio never
stops when switching tabs. **Consequence:** state that lives in a store slice or high in the tree
re-renders *every* mounted view, not just the visible one. High-frequency state — the current
playback step, a value being dragged on a knob — must therefore stay local to the subtree that
shows it, never in a slice.

**Three layers, enforced by eslint `no-restricted-imports`:**

1. `src/audio/` — never imports `store/` or `components/`. Pure DSP + a single `audioEngine`
   singleton built on the **raw Web Audio API** (no Tone.js; `tonal` is used for theory only).
   All engine setters no-op until `init()` creates the `AudioContext`.
2. `src/store/` — never imports `components/`. One Zustand store composed from slices
   (`transport`, `musicContext`, `synth`, `chords`, `bass`, `sequencer`, `effects`, `ui`,
   `presets`, `loop`), with `persist` (key `musibox_project_state_v1`, `partialize` + `migrate`
   in `store.ts`, legacy-key adoption in `migrate.ts`) and `subscribeWithSelector`. Bump the
   persist `version` and add a migration step whenever the persisted shape changes.
3. `src/components/` — dumb views; must not import `audio/engine`. Only `AudioVisualizer.tsx`,
   `ui/VuMeter.tsx` and `ui/AmbientBackdrop.tsx` (read-only analyser consumers) and test files
   are exempt — routing their per-frame analyser reads through the store would mean a store
   write on every animation frame and a re-render of every subscriber.

**`persist` has no throttle.** Every `set()` that touches a key returned by `partialize`
synchronously serialises that slice and writes `localStorage` on the spot. Anything driven by a
pointer, a clock tick or an animation frame must not write persisted state directly.

**The store→engine bridge** is `src/store/engineSync.ts`: one `subscribeWithSelector`
subscription per engine-settable value with `fireImmediately`, started once by `useEngineSync()`
in `App.tsx`. The `AudioContext` is created on the first user click, after which
`applyEngineSnapshot()` re-applies the whole persisted audio state. **Never call engine setters
from a component** — add the state to a slice and wire it in `engineSync.ts`.

**Storage access is always guarded.** `localStorage` can *throw* (Safari private mode, blocked
cookies, embedded webviews), not just return null — `store.ts` falls back to an in-memory
`StateStorage`, and helpers like `Header.tsx`'s theme functions take an injectable storage param
and read it *inside* a `try`, never in a default-parameter expression.

## Testing — the one trap worth knowing up front

Roughly a third of the suite renders React through `renderToString`, and zustand wires
`getServerSnapshot` to the store's **creation-time** state — so `useAppStore.setState(...)`
before a render has no effect unless the component reads the store the way
`ui/BottomInputDock.tsx` does. Full conventions live in `.claude/rules/testing.md`.

## Traps recorded in the spec — don't "fix" these

- **Instant Vibes ids drift from labels** (`cyber-dance` → "Cyber EDM", `ambient-chill` → "Deep
  Ambient", `hiphop-groove` → "Boom Bap", `asian-zen` → "Zen Garden"). Ids are persisted in
  project files; renaming them breaks saved projects. The table lives in
  `src/store/instantVibes.ts` — the single copy since the `audio/` fork was deleted.
- **Tap Tempo and stereo VU are unbuilt**, not broken — see `docs/design.md` §4 item 3.

## Repo-local skills and rules

`.claude/skills/` ships two skills worth loading when relevant: `dsp-audio` (read before touching
effect chains, signal routing, or `AudioContext` lifecycle) and `music-theory` (before touching
notes, keyboard, drum pads, sequencer, or chord/bass generation).

`.claude/rules/` holds path-scoped rules that load automatically when you open the files they
cover: `theming.md` (components, `index.css`, `themeColor.ts`) and `testing.md` (test files and
`scripts/`).

`squash-by-logical-change` (consolidating noisy agent-generated commits before review) is a
**global** skill in `~/.claude/skills/`, not part of this repo.
