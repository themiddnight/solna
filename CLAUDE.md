# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Do not record version numbers here.** Dependency versions, the persist `version`, file
counts and line numbers all change through routine work and go stale silently. Read
`package.json` / the source instead, and write down the *rule*, not the number. <!-- R001 -->
The same holds for `.claude/rules/` and `docs/decisions/`.

**Where things live.** This file holds commands, the gate, the layer map and one line per
cross-cutting invariant. Normative rules live in `.claude/rules/` (path-scoped: each loads when
you open a file it covers); rationale, history and rejected alternatives live in ADRs under
`docs/decisions/`. **Change a rule → update its rules file AND its ADR in the same change.**
Rule ids (`R###`) are shared across all three.

## Commands

Runtime is **Bun** (test runner + scripts); the app itself is Vite + React. <!-- R002 -->

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
bun run check:drums    # Beat-preset audible-separation check
bun run check:contrast # Beat-voice and module palette AA contrast floor (both themes)
bun run check:levels   # calibration trim table still matches today's Beat-preset defaults
bun run check:dead-code             # unused files, exports, types and dependencies across app + tooling
bun run check:dead-code:production  # strict shipped-code file and dependency graph
bun run verify         # all tests, static/domain checks, both dead-code scans, and the production build
```
<!-- R003 -->

## Completion gate

- `bun run verify` is the completion gate — run it before claiming work is done. <!-- R004 -->
- `bun run eslint` reports **zero errors and zero warnings**. Only `react-hooks/exhaustive-deps`
  and `complexity` may be configured `warn`, because both have legitimate exceptions; no other
  rule may warn. <!-- R005 -->
- **A warning is never ignored.** Never ignore an ESLint warning, and never dismiss one as pre-existing: open the code at each warning and either fix it, when it points at a real defect, or add a line-level `eslint-disable-next-line <rule> -- <reason>` naming why this site is a legitimate exception. Work is done only when `bun run eslint` prints zero errors and zero warnings. Never relax a rule for everybody to
  silence one site. <!-- R264 -->
- Both Knip scans (`check:dead-code`, `check:dead-code:production`) hold a zero-finding
  baseline. <!-- R006 -->

Details: `.claude/rules/boundaries-and-gates.md`; why: `docs/decisions/0029-verify-gate-and-lint-severity.md`.

## Architecture

Single-page audio workstation ("Solna"): two layers (Loop, Song) holding four tab views — Sound
and Pattern on the loop layer, Arrange and Master on the song layer — plus Pattern's four
segments (Lead, FX, Accompaniment, Beat). `Workspace` (`App.tsx`) keeps the coordinators,
`PlaybackHost` and the dialogs; `useLayoutMode()` picks `DesktopShell` or `MobileShell`
(`src/components/shell/`) for the visible frame. <!-- R316 --> Below `md` the mobile frame
navigates by a four-tab bottom bar (the tab implies the layer) and holds the non-field tools and
project actions in a menu sheet. <!-- R318 -->

### Everything stays mounted

- **Every layer, tab view and Pattern segment stays mounted**, gated `block`/`hidden` at three
  levels: `shell/LayerPages.tsx` (`isSongLayer(activeTab)`), `LoopPage.tsx` (`activeTab`),
  `PatternView.tsx` (`segmentForFocus(focusTrack)`). Views stay mounted to keep their UI state
  (scroll, drag, meter history, local state), except across a layout switch (R316). <!-- R014 -->
- Audio never stops when switching tabs: it does not depend on mounting at all (R040). <!-- R015 -->
- High-frequency state (playback step, playhead beat, a knob value mid-drag) stays local to the
  subtree that shows it, **never in a store slice** — a slice write re-renders every mounted
  view. <!-- R016 -->
- Transport controllers are mounted once, in `PlaybackHost`: **a lane sounds because the host is
  mounted, never because its grid is**. <!-- R040 -->

Why: `docs/decisions/0001-always-mounted-views.md`, `docs/decisions/0039-playback-host.md`,
`docs/decisions/0040-layout-shell.md`.

### Layer map

Enforced by eslint `no-restricted-imports` (plus `no-restricted-globals` and
`no-restricted-syntax` for `src/data/`); `eslint.config.js` is the list that binds. <!-- R019 -->

| Layer | Rule | Rules file | ADR |
|---|---|---|---|
| `src/data/` | Imports nothing at runtime, not even a sibling; factory content only. <!-- R020 --> | `data-layer.md` | [0002](docs/decisions/0002-four-layer-import-architecture.md) |
| `src/audio/` | Never imports `store/` or `components/`; may import `data/`. <!-- R028 --> Raw Web Audio API, no Tone.js; music theory only via `@/musicCore`, never `tonal`. <!-- R029 --> No `react`/`react-dom`. <!-- R314 --> | `synth-voices.md`, `playback.md` | [0002](docs/decisions/0002-four-layer-import-architecture.md), [0039](docs/decisions/0039-playback-host.md) |
| `src/store/` | Never imports `components/`. <!-- R032 --> | `persistence.md` | [0002](docs/decisions/0002-four-layer-import-architecture.md) |
| `src/components/` | Views, plus the live playback controllers in `components/playback/` (mounted once by `PlaybackHost`); must not import `audio/engine`. <!-- R038 --> | `components.md`, `playback.md` | [0002](docs/decisions/0002-four-layer-import-architecture.md) |
| `src/musicCore/` | Only `tonalAdapter.ts` imports `tonal`. <!-- R044 --> Imports nothing from `store/`, `components/`, `audio/`, `utils/`. <!-- R050 --> | `music-domain.md` | [0005](docs/decisions/0005-music-core-and-tonal-confinement.md) |
| `src/utils/` | Outside the chain, above `data/`; `data/` reads it only via `import type`. <!-- R058 --> May import `@/musicCore`, never the reverse. <!-- R059 --> | `utils.md`, `data-layer.md`, `boundaries-and-gates.md` | [0004](docs/decisions/0004-utils-placement-and-store-constant-inversion.md) |
| `src/incidents/` | Privacy boundary: no `store/`, `components/` or audio engine import (type-only `@/audio/runtime/*` allowed). <!-- R056 --> | `boundaries-and-gates.md` | [0003](docs/decisions/0003-incidents-privacy-boundary.md) |

### Cross-cutting invariants

- No meter value enters a zustand slice. <!-- R242 --> → `metering.md`, [0028](docs/decisions/0028-sample-based-metering.md)
- No migration chains: persisted state and `.solna` bodies are **validated** on every read
  (`sanitizePersistedState`, `sanitizeContent`), never upgraded. <!-- R214 --> A persisted shape
  change validates the key in `merge`, never bumps the version. <!-- R035 --> Never add a
  version-gated branch "just in case". <!-- R219 --> → `persistence.md`, [0023](docs/decisions/0023-validation-instead-of-migration.md)
- Persisted values are replaced, never mutated in place. <!-- R210 --> Pointer-, clock- or
  frame-driven code never writes persisted state directly. <!-- R212 --> → `persistence.md`, [0022](docs/decisions/0022-persist-write-path-and-guarded-storage.md)
- Storage access is always guarded — `localStorage` can throw. <!-- R244 --> → `persistence.md`, [0022](docs/decisions/0022-persist-write-path-and-guarded-storage.md)
- A sharp name is an identity; everything generated, computed or persisted is `ROOTS`-spelled,
  spelling is display-only. <!-- R064 --> → `music-domain.md`, [0006](docs/decisions/0006-derived-degree-qualities-and-display-spelling.md)
- Nothing outside `src/musicCore/` hand-rolls a note-name regex. <!-- R082 --> → `music-domain.md`, [0005](docs/decisions/0005-music-core-and-tonal-confinement.md)
- Musical intent ≠ derived representation ≠ playable event. <!-- R051 --> → `music-domain.md`, [0005](docs/decisions/0005-music-core-and-tonal-confinement.md)
- The engine takes a frequency (Hz), never a note name. <!-- R176 --> → `synth-voices.md`, [0018](docs/decisions/0018-engine-frequency-boundary.md)
- The shared 16th clock runs iff a player holds a subscription. <!-- R220 --> → `playback.md`, [0026](docs/decisions/0026-clock-and-engine-bridge.md)
- Never call engine setters from a component — add the state to a slice and wire it in
  `src/store/engineSync.ts`. <!-- R224 --> → `playback.md`, [0026](docs/decisions/0026-clock-and-engine-bridge.md)
- Effective track audibility is computed only in `engineSync.ts`. <!-- R160 --> → `loops-and-solo.md`, [0015](docs/decisions/0015-session-only-track-solo.md)
- **Placement, for every new file:** code used by one feature or area stays with it; code used by
  two or more lifts to its layer's shared location. <!-- R276 --> → `components.md`, `utils.md`, [0031](docs/decisions/0031-component-hook-store-selector-and-placement-conventions.md)
- Every overlay is one kind (dock, drawer, bottom sheet, modal, popup) and every transient message
  goes through the one feedback host. <!-- R325 --> <!-- R330 --> A titled overlay pins its header
  and scrolls only its body. <!-- R339 --> → `components.md`, [0044](docs/decisions/0044-secondary-canvas-taxonomy.md)

## Traps — don't "fix" these

- **`renderToString` tests:** `useAppStore.setState(...)` before a render has no effect unless
  the component reads the store the way `ui/BottomInputDock.tsx` does. <!-- R257 --> → `testing.md`
- **Tap Tempo and stereo VU are unbuilt**, not broken — see `docs/design.md` §4 item 3. <!-- R258 -->
- **A pre-DEV-369 `string[][]` lead melody reads back blank**, with no throw and no warning, by
  design → `persistence.md`, [0023](docs/decisions/0023-validation-instead-of-migration.md).

## Git conventions

Branch names are `<type>/<issue-code>-<name>`: the type is the conventional-commit type the
branch's work will land as (`feat`, `fix`, `refactor`, `docs`, `chore`), the issue code is the
Linear id lowercased and is omitted entirely when the work has no issue, and the name is a short
kebab-case summary — `feat/dev-369-lead-note-length`, `chore/eslint-guards`. <!-- R261 --> Feature work never
lands as a commit made directly on `main`. <!-- R262 -->

## Skills, rules and decisions

<!-- R263 -->
**Skills** (`.claude/skills/`, three): `dsp-audio` (effect chains, routing, `AudioContext`
lifecycle, voices, Beat, clock, store→engine), `music-theory` (notes, scales, chords,
bass/rhythm patterns, arp, keyboard map, drum-pad keys), `instant-vibes` (the vibe picker and the
dice). `squash-by-logical-change` is a **global** skill in `~/.claude/skills/`, not part of this repo.

**Rules** (`.claude/rules/`, path-scoped — each loads when you open a file its `paths:` covers; each ends
in a `## Prohibited` checklist derived from its own rules):

| File | Covers |
|---|---|
| `boundaries-and-gates.md` | ESLint severity policy, Knip graphs, import-ban mechanics, analyser exemption, `src/incidents/`, the utils→store constant inversion |
| `data-layer.md` | `src/data/` purity, what belongs there, `utils/` placement |
| `music-domain.md` | Music Core, tonal confinement, chord-quality registry, spelling, derived chord notes, reharmonization, Roman numerals, key change |
| `vibes-and-grids.md` | Vibes as data, the one drum-grid library, provenance, the dice |
| `beat.md` | The Beat instrument's three fields, voices, presets, `check:drums` |
| `pattern-grids.md` | Fixed-width storage, the three step layouts, span editing, custom Chord/Bass patterns |
| `melody-tracks.md` | Lead/FX via `MELODY_TRACKS`, record arm, key changes, borrowed rows |
| `loops-and-solo.md` | Loop content and defaults, atomic loop delete + undo, batch key change, session-only solo, audibility |
| `synth-voices.md` | `VoiceId`/owner, the frequency boundary, polyphony gain, voice lifetime, shared live/offline render, per-track master sends |
| `synth-patch.md` | Engine-tagged complete patches, presets, arp beside the patch, units in field names |
| `persistence.md` | Persist write path, validation not migration, storage zones, project slot, autosave, Drive token |
| `playback.md` | Clock, store→engine bridge, `PlaybackHost`, planned-then-performed playback, song timeline, snapshots, pub/subs |
| `export.md` | The export job: one session-only job, kinds as data, the shared runner, the dialog and the Header trigger; MIDI export (lanes, channels, GM map); stems (dry bus taps, one ZIP) |
| `metering.md` | Sample-based meters, tap point, meter scheduler |
| `theming.md` | Theme tokens and the palette contrast gate |
| `testing.md` | Test conventions, the `renderToString` trap |
| `note-input.md` | The note-input dispatcher and focus-routed input |
| `components.md` | Component logic in a colocated hook, narrow store selectors, placement, the layout shell, `HEADER_TOOLS` and the mobile frame |
| `utils.md` | One theme per `utils/` file, utils layering, placement |

**Decisions:** the ADR index and template are in [`docs/decisions/README.md`](docs/decisions/README.md).
