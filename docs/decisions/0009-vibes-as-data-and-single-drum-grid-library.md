# ADR-0009: Vibes are pure data over one drum-grid library

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

**Amended by [ADR-0045](0045-vibe-picker-preview.md):** the strip is gone; vibes are written by `previewVibe` (R086) and the picker loads the preview module lazily (R095).

## Context

An Instant Vibe (a genre chip in the top bar, plus the dice that rerolls it) sets chords, a drum
pattern, effects and more in one gesture. Vibes used to carry a hand-duplicated chip table, a
resolver graph loaded eagerly by the always-mounted bar, a separate drum-grid set per consumer, a
merging drum-pattern write, and a dice that decorated generated drum rows through a density
catalogue and a kick-collision filter.

## Decision

### A vibe is pure data, and every library id in it is written once

`VIBES` in `src/data/vibes.ts` is a list of `VibeSpec` literals that name ids and nothing else;
`resolveVibe` in `src/store/vibes.ts` turns them into a `ResolvedVibe` — the spec plus `chords`,
`drumPattern` and `effects` — and `applyVibeToStore` writes that.

The table resolves nothing at module scope, which is what lets the always-mounted `InstantVibesBar`
import it eagerly with no resolver graph behind it; a single resolver call in that file would put
four library modules back into the eager chunk and bring back the hand-duplicated chip table that
was deleted with it. Each vibe's dice pool is its own explicit arrays (`random.progressions` and
the rest), not the output of a filter over the shared library — so adding a progression never
reaches into a vibe that did not ask for it.

### There is one drum-grid library, not one per consumer

`DRUM_GRIDS` serves both the sequencer's grid menu and the vibes; an entry carries its own `name`,
`meter`, `kit` and `rows`, so a vibe may reference any grid and the menu may offer any grid.

### A drum grid determines the whole pattern

`replaceBeatPattern` looks a row up by Beat voice id and **clears every voice no row names** — so
picking a grid gives you that grid, never that grid plus leftovers. It was `applyDrumPattern` and
it merged, which was invisible while every grid declared every row the five tracks had and became a
bug the moment `tom` and `crash` tracks existed. Clearing goes through `writeStepWindow`, so only
the active window clears and the wider-meter padding survives.

**A grid changes the pattern and never the sound**: `beatPresetId` on a grid entry is provenance
nothing applies, so the Beat patch stays the user's to pick on Sound
([ADR-0010](0010-beat-instrument-three-fields.md)).

**Every row in a grid must name a voice the Beat instrument can play.** The 53 `bass` cells 23
grids used to carry are deleted, not kept as authored intent: `bass` is not a Beat voice — no
`BeatVoices` field, no `triggerDrum` case — and a row that cannot sound is not a rhythm.
`drumGrids.test.ts` now rejects any row name no voice plays, so re-adding one turns the suite red.
Every grid still writes every row its origin group defines, empty or not, because a grid should
state what it plays.

### Provenance is required and governs editing

Each entry also carries a `provenance` — a source URL or the literal `'authored'` — and the
`'authored'` set is an allowlist in `drumGrids.test.ts`, so shipping an unsourced grid is a name a
reviewer sees rather than the default when nobody looked. **Provenance governs editing, not just
disclosure:** a grid carrying a source URL may be re-voiced — a hit moved from one row to another —
because that does not change what the source says was played, but it may never be re-transcribed —
a hit added or moved to a different step — without the URL becoming a lie. Only a
`provenance: 'authored'` grid may gain or move a hit.

### The dice repoints the drum grid; it does not decorate one

All five reroll axes are id pools now (`keys`, `progressions`, `chordRhythms`, `bassPatterns`,
`drumGrids`), and three of the five use `pickDistinct` — `progressions` and `drumGrids` use plain
`pick`, because neither has a `current` in the store to exclude and manufacturing one would fail
silently. A rerolled vibe's `drumGridId` therefore always names the grid actually playing.

The density catalogue and the kick-collision filter that used to sit behind this axis are deleted,
deliberately: they constrained GENERATED rows, and authored grids are curated — a crash on beat 1
over a kick on beat 1 is standard, not a clash, and porting the filter would reject grids for being
correct.

## Consequences

- The eager chunk stays small: the always-mounted bar imports literals only.
- Adding a library entry never changes an existing vibe's dice behaviour.
- Picking a grid is deterministic: the result is exactly that grid in the active window.
- A grid cannot contain an unplayable row, and an unsourced grid is visible in an allowlist.
- The `instant-vibes` repo skill carries the workflow for adding, retuning or debugging a vibe.

## Rules this implies

- **R086** — `VIBES` (`src/data/vibes.ts`) are `VibeSpec` literals naming ids only; `resolveVibe`
  (`store/vibes.ts`) → `ResolvedVibe`; `applyVibeToStore` writes it.
- **R087** — One drum-grid library `DRUM_GRIDS` serves the sequencer menu and vibes; entries carry
  `name`, `meter`, `kit`, `rows`.
- **R088** — `replaceBeatPattern` looks rows up by Beat voice id and clears every voice no row
  names; never merge.
- **R089** — Clearing goes through `writeStepWindow` (active window only; wider-meter padding
  survives).
- **R090** — A grid never changes the sound; a grid's `beatPresetId` is provenance nothing
  applies.
- **R091** — Every grid row names a voice the Beat instrument plays (no `bass`);
  `drumGrids.test.ts` rejects others.
- **R092** — Every grid writes every row its origin group defines, empty or not.
- **R093** — Every grid carries `provenance` (URL or `'authored'`); the `'authored'` set is an
  allowlist in `drumGrids.test.ts`.
- **R094** — A URL-sourced grid may be re-voiced (hit to another row) but never re-transcribed
  (hit added/moved step); only `'authored'` grids gain or move hits.
- **R095** — The vibes table resolves nothing at module scope; no resolver call in
  `InstantVibesBar`.
- **R096** — Each vibe's dice pool is explicit arrays (`random.progressions`, …), never a filter
  over the shared library.
- **R117** — All five reroll axes are id pools (`keys`, `progressions`, `chordRhythms`,
  `bassPatterns`, `drumGrids`); `progressions` and `drumGrids` use `pick`, the other three
  `pickDistinct`.
- **R118** — A rerolled vibe's `drumGridId` names the grid actually playing.
- **R119** — Do not reintroduce the density catalogue / kick-collision filter for authored grids.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 295-329, 388-397.
