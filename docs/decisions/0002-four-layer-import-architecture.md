# ADR-0002: Four import layers enforced by ESLint

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

The app is split into factory content, DSP, state and views. Without an enforced direction the
layers leak into one another: a data table that imports a helper grows an evaluation graph, a DSP
module that reads the store cannot render offline, and a view that calls an engine setter bypasses
the store→engine bridge. The layering is therefore enforced by eslint (`no-restricted-imports`,
plus `no-restricted-globals` and `no-restricted-syntax` for the first layer), not by convention.

## Decision

Four layers, enforced by eslint:

### 1. `src/data/` — imports nothing at runtime, not even a sibling in `src/data/`

Factory content only: synth presets, Beat presets, drum grids, chord progressions, chord rhythms,
bass patterns, effect chains, scales. It reads no impure global (`Math`, `Date`, `crypto`, …),
declares no function, constructs no object with `new`, and holds no module-scope `let`/`var`; it
may declare types and `import type` from anywhere. Top-level `const` arrow helpers that are
shorthand for writing a literal — `step()`, `block()`, `strum()` — are allowed and must sit in the
same file as the table they build. **Every file is an independent leaf**, so the folder has no
evaluation graph and a reviewer with one file open has all of its inputs on screen.
`src/data/dataLayerPurity.test.ts` lints fixture sources through eslint's own API and is what
keeps that true across tool upgrades.

The distinguishing test for what belongs: **adding an entry must be an edit to that table and
nothing else** — which is why `METERS`, `THEME_TOKENS` and `VIEW_META` are registries and stay
where the code that reads them lives.

### 2. `src/audio/` — never imports `store/` or `components/`; may import `data/`

Pure DSP + a single `audioEngine` singleton built on the **raw Web Audio API** (no Tone.js). Music
theory reaches `src/audio/` only through Music Core (`@/musicCore`); `src/audio/` does not import
`tonal` (see [ADR-0005](0005-music-core-and-tonal-confinement.md)). All engine setters no-op until
`init()` creates the `AudioContext`.

One door on that singleton is deliberately open — `createRenderEngine(ctx)`, the offline mixdown
render — and is recorded in [ADR-0021](0021-shared-live-and-offline-render.md).

### 3. `src/store/` — never imports `components/`

One Zustand store composed from the slices `store.ts` composes (the list there binds):
`transport`, `musicContext`, `synth`, `chords`, `bass`, `pad`, `lead`, `fx`, `beat`, `effects`,
`ui`, `presets`, `loop`, `loopCopy`, `project`, `mixdown`, `drive` — plus one separate vanilla
store, `audioRecovery.ts`, for audio-recovery state, kept outside the persisted app store. The app
store uses `persist` (key `musibox_project_state_v1`, `partialize` + `migrate` in `store.ts`,
legacy-key adoption in `migrate.ts`) and `subscribeWithSelector`. How persisted shape changes are
handled (validation, no migration chains) is [ADR-0023](0023-validation-instead-of-migration.md);
where the Google access token lives is [ADR-0025](0025-drive-token-in-closure.md).

### 4. `src/components/` — views plus the live playback controllers; must not import `audio/engine`

The controllers — `useChordPlayback`, `useLeadPlayback`, `useSequencerPlayback`, `useInputDeck`,
`usePlayheadSync` — and the step and playhead pub/subs (`playbackStep.ts`, `playheadBeat.ts`) live
here, reach audio through `audio/playback/playbackEngine`, never `audio/engine`, and are mounted
inside the grids — **a lane sounds because its grid is mounted**, which is one more reason every
view stays mounted ([ADR-0001](0001-always-mounted-views.md)).

Only `AudioVisualizer.tsx`, `ui/VuMeter.tsx`, `ui/GainReductionMeter.tsx` and
`ui/SourceMeter.tsx` (read-only analyser consumers) and test files are exempt — routing their
per-frame analyser reads through the store would mean a store write on every animation frame and a
re-render of every subscriber. The `eslint.config.js` block for those four files turns
`no-restricted-imports` **off entirely**, so it also lifts the tonal and taper bans for them; a
reviewer keeps them free of such imports by hand. The metering side of this exemption is
[ADR-0028](0028-sample-based-metering.md).

**`eslint.config.js` is the list that binds.** The documentation copy of the analyser allowlist
has drifted behind the config before, so any change is made in the config **and** in the one doc
copy (`.claude/rules/metering.md`), or the allowlist quietly grows without anyone reading it.

### `src/architecture/` — cross-cutting architecture tests

`src/architecture/` holds cross-cutting architecture tests that don't belong to any single layer —
`dependencyLayers.test.ts` proves the Music Core layering and the tonal confinement, with only a
few spot-checks of the four layers above it (the layer bans themselves are proved by
`bun run eslint` over the real tree). A non-test file placed there would fall under the `src/**`
catch-all block like everything else, since the folder has no layering block of its own.

## Consequences

- A data file can be reviewed in isolation: every input is on screen, and the purity test keeps
  the eslint guard armed across tool upgrades.
- Registries whose entries require code elsewhere (`METERS`, `THEME_TOKENS`, `VIEW_META`) do not
  belong in `src/data/` even though they look like tables.
- Audio can be rendered offline and tested without a store, because it never reads one.
- Views reach audio only through `playbackEngine` or through store state wired by `engineSync`
  ([ADR-0026](0026-clock-and-engine-bridge.md)).
- The analyser exemption is a hole in the import gate for four files; it is kept small and
  reviewed by hand.
- Two further boundaries sit beside the four layers: `src/incidents/`
  ([ADR-0003](0003-incidents-privacy-boundary.md)) and `src/utils/`
  ([ADR-0004](0004-utils-placement-and-store-constant-inversion.md)).

## Rules this implies

- **R019** — Four layers enforced by eslint `no-restricted-imports` (+ `no-restricted-globals`,
  `no-restricted-syntax` for `src/data/`).
- **R020** — `src/data/` imports nothing at runtime, not even a sibling in `src/data/`.
- **R021** — `src/data/` holds factory content only (synth presets, Beat presets, drum grids,
  chord progressions, chord rhythms, bass patterns, effect chains, scales).
- **R022** — `src/data/` reads no impure global (`Math`, `Date`, `crypto`, …), declares no
  function, uses no `new`, has no module-scope `let`/`var`.
- **R023** — `src/data/` may declare types and `import type` from anywhere.
- **R024** — Top-level `const` arrow literal-shorthand helpers (`step()`, `block()`, `strum()`)
  are allowed only in the same file as the table they build.
- **R025** — Every `src/data/` file is an independent leaf (no evaluation graph).
- **R026** — `src/data/dataLayerPurity.test.ts` (fixture sources linted through eslint's API)
  keeps R020-R025 true across tool upgrades; keep it.
- **R027** — Belongs in `src/data/` only if adding an entry is an edit to that table and nothing
  else; `METERS`, `THEME_TOKENS`, `VIEW_META` are registries and stay with their readers.
- **R028** — `src/audio/` never imports `store/` or `components/`; may import `data/`.
- **R029** — Audio is raw Web Audio API; no Tone.js.
- **R030** — One `audioEngine` singleton; every engine setter no-ops until `init()` creates the
  `AudioContext`.
- **R032** — `src/store/` never imports `components/`.
- **R033** — One Zustand app store composed from the slices `store.ts` lists (that list binds) +
  one separate vanilla store `audioRecovery.ts`, outside the persisted store.
- **R038** — `src/components/` = views + live playback controllers; must not import
  `audio/engine`.
- **R039** — Controllers (`useChordPlayback`, `useLeadPlayback`, `useSequencerPlayback`,
  `useInputDeck`, `usePlayheadSync`) and pub/subs live in `components/`, reach audio via
  `audio/playback/playbackEngine`, never `audio/engine`.
- **R043** — `eslint.config.js` is the binding list; any change to the analyser allowlist is made
  in the config AND in `.claude/rules/metering.md`.
- **R054** — `src/architecture/` holds cross-cutting architecture tests;
  `dependencyLayers.test.ts` proves Music Core layering + tonal confinement (layer bans are proved
  by `bun run eslint` over the tree).
- **R055** — A non-test file in `src/architecture/` falls under the `src/**` catch-all; the folder
  has no layering block.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 71-89, 94-99, 113-127, 162-167. The clause at
line 88 ("`tonal` is used for theory only") was stale and is corrected above (spec §5 C1).
