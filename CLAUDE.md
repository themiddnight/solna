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
bun run verify         # test + lint + eslint + check:keys + check:drums + build (the gate)
```

`bun run verify` is the completion gate — run it before claiming work is done. It runs
`bun run eslint`, which must report zero errors; warnings are tolerated until the phase that
fixes them flips the rule to `error` (see the ESLint rule matrix in
`docs/superpowers/specs/2026-09-04-codebase-hygiene-and-restructure-design.md`).

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
   `presets`, `loop`, `lead`, `project`), with `persist` (key `musibox_project_state_v1`, `partialize` +
   `migrate` in `store.ts`, legacy-key adoption in `migrate.ts`) and `subscribeWithSelector`.
   Bump the persist `version` and add a migration step whenever the persisted shape changes.
3. `src/components/` — dumb views; must not import `audio/engine`. Only `AudioVisualizer.tsx`,
   `ui/VuMeter.tsx` and `ui/AmbientBackdrop.tsx` (read-only analyser consumers) and test files
   are exempt — routing their per-frame analyser reads through the store would mean a store
   write on every animation frame and a re-render of every subscriber.

**The lead melody stores at its own width, and only the lead melody does.** The sequencer,
chord-rhythm and bass grids store every bar at the widest meter's `MAX_STEPS_PER_BAR` and window
it to the active `stepsPerBar`. The lead runs the same non-destructive scheme on a second axis —
it stores at the finest *step resolution* (`LEAD_TICKS_PER_BAR` in `utils/stepResolution.ts`) and
*strides* to the active one — so a `leadMelodySteps` index is a tick, not a 16th, and a
`LeadNote.len` counts ticks. Two consequences: a slot is dormant either because the meter cannot
reach it or because the resolution cannot, and **both tests live in `leadActivePosAt` and nowhere
else**; and a change of view never writes — an explicit edit writes, changing meter or resolution
does not.

**`persist` serialises on every `set()`; only the `localStorage` write is coalesced.** Every
`set()` that touches a key returned by `partialize` re-serialises that slice on the spot. The
write itself goes through `utils/coalescedStorage.ts`, which buffers it to an idle callback and
flushes on `pagehide`/`visibilitychange` — so the serialise cost is still per-`set()`, and
anything driven by a pointer, a clock tick or an animation frame must not write persisted state
directly. Consequence for tests and for reading `localStorage` in a live page: storage lags the
store by up to one idle window; call `flushPersistedWrites()` before asserting on it.

**The shared 16th clock runs if and only if a player holds a subscription.** `subscribeClock`
starts the timer for the first listener and `stopClockTimer` ends it with the last, and nothing
else may start or hold it. The metronome is a **click, not a transport**: `setMetronomeEnabled`
only arms the click that `clockTick` emits, so it sounds while something plays and does nothing
at all otherwise. It once started the clock and blocked the idle suspend, which made the toggle a
second, invisible transport — the grid's playhead ran and the lead recorder quantised against it
with no music playing. Anything that needs a clock must start a player; to record in time to a
click alone, press play on the lead.

**The store→engine bridge** is `src/store/engineSync.ts`: one `subscribeWithSelector`
subscription per engine-settable value with `fireImmediately`, started once by `useEngineSync()`
in `App.tsx`. The `AudioContext` is created on the first user click, after which
`applyEngineSnapshot()` re-applies the whole persisted audio state. **Never call engine setters
from a component** — add the state to a slice and wire it in `engineSync.ts`.

**Storage access is always guarded.** `localStorage` can *throw* (Safari private mode, blocked
cookies, embedded webviews), not just return null — `store.ts` falls back to an in-memory
`StateStorage`, and helpers like `Header.tsx`'s theme functions take an injectable storage param
and read it *inside* a `try`, never in a default-parameter expression.

**Three storage zones, not two.** `localStorage` holds the live session (persist, above);
`sessionStorage` nothing; and **IndexedDB holds the saved project library**, reached only
through `store/projectStore.ts`. That wrapper resolves availability *once, lazily* and turns
every failure into a typed result — a device that cannot store projects is a **normal degraded
state the UI renders, never an exception path**, the same discipline `resolveStorage()` follows.
Bodies and metadata live in **separate object stores** so listing the library never deserialises
a single project body; every write touches both in one transaction. A **project body is the
content set only** (see `PROJECT_CONTENT_KEYS`) — view, session and library state are excluded
by construction — and its `formatVersion` is deliberately **independent of the persist
`version`**: that one bumps for private `localStorage` reshapes, this one only when the content
contract changes, and the persist migration chain must never be used to read a project body.

**`dirty` is derived, never persisted.** One idle pass fingerprints the content set and compares
it to the project's baseline (or, untitled, to the default project) — see `projectDirty.ts`;
computing it per `set()` would fingerprint the whole arrangement on every knob tick. Because
hydration runs synchronously *inside* `create()`, before the tracker exists, `store.ts` schedules
**one pass at boot** — that pass is what makes a reloaded session honest, and without it a
restored session with unsaved work gets no badge and no dirty guard.

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
- **The lead melody's two migration chains each run two upgrades, in order, before their sanitize
  step.** `asLeadNoteMatrix` — the guard both read paths go through — returns `undefined` for the
  pre-DEV-369 `string[][]` shape instead of throwing, and sanitize then substitutes the default, so
  a payload that reaches sanitize un-upgraded comes back blank — no throw, no warning. Within a chain the note-length
  upgrade runs first and the tick widening second, never the other way round: widening a
  `string[][]` payload would leave a shape sanitize still rejects. Persist upgrades live in
  `migrate` (before `merge`); `.solna` upgrades in `migrateProjectBody` (before `sanitizeContent`).
  The two chains share the pure transforms and nothing else — **never merge them.** A persist
  payload is private `localStorage` shape; a project body is an external contract; their versions
  move for different reasons.

## Git conventions

Branch names are `<type>/<issue-code>-<name>`: the type is the conventional-commit type the
branch's work will land as (`feat`, `fix`, `refactor`, `docs`, `chore`), the issue code is the
Linear id lowercased and is omitted entirely when the work has no issue, and the name is a short
kebab-case summary — `feat/dev-369-lead-note-length`, `chore/eslint-guards`. Feature work never
lands as a commit made directly on `main`.

## Repo-local skills and rules

`.claude/skills/` ships two skills worth loading when relevant: `dsp-audio` (read before touching
effect chains, signal routing, or `AudioContext` lifecycle) and `music-theory` (before touching
notes, keyboard, drum pads, sequencer, or chord/bass generation).

`.claude/rules/` holds path-scoped rules that load automatically when you open the files they
cover: `theming.md` (components, `index.css`, `themeColor.ts`), `testing.md` (test files and
`scripts/`), and `note-input.md` (the one dispatcher every played note goes through, and why
previews and sequenced notes stay off it).

`squash-by-logical-change` (consolidating noisy agent-generated commits before review) is a
**global** skill in `~/.claude/skills/`, not part of this repo.
