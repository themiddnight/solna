---
paths:
  - "src/data/vibes.ts"
  - "src/data/drumGrids.ts"
  - "src/audio/drumGrids.ts"
  - "src/store/vibe*.ts"
  - "src/components/InstantVibesBar.tsx"
  - "src/components/vibeActions.ts"
---

# Vibes and drum grids

Instant Vibes as data, the one drum-grid library, and the dice. The `instant-vibes` skill carries the workflow.

- `VIBES` (`src/data/vibes.ts`) are `VibeSpec` literals naming ids only; `resolveVibe` (`store/vibes.ts`) turns one into a `ResolvedVibe`; `applyVibeToStore` writes it. <!-- R086 -->
- One drum-grid library, `DRUM_GRIDS`, serves the sequencer's grid menu and the vibes; each entry carries its own `name`, `meter`, `kit`, `rows`. <!-- R087 -->
- `replaceBeatPattern` looks rows up by Beat voice id and clears every voice no row names; never merge (a grid gives exactly that grid). <!-- R088 -->
- Clearing goes through `writeStepWindow`, so only the active window clears and wider-meter padding survives. <!-- R089 -->
- A grid changes the pattern, never the sound: a grid's `beatPresetId` is provenance nothing applies. <!-- R090 -->
- Every grid row names a voice the Beat instrument plays (no `bass`); `drumGrids.test.ts` rejects any other row name. <!-- R091 -->
- Every grid writes every row its origin group defines, empty or not. <!-- R092 -->
- Every grid carries `provenance` (a source URL or `'authored'`); the `'authored'` set is an allowlist in `drumGrids.test.ts`. <!-- R093 -->
- A URL-sourced grid may be re-voiced (a hit moved to another row) but never re-transcribed (a hit added or moved to another step); only `'authored'` grids gain or move hits. <!-- R094 -->
- The vibes table resolves nothing at module scope, and `InstantVibesBar` makes no resolver call (it is eagerly loaded). <!-- R095 -->
- Each vibe's dice pool is explicit arrays (`random.progressions`, …), never a filter over the shared library. <!-- R096 -->
- All five reroll axes are id pools (`keys`, `progressions`, `chordRhythms`, `bassPatterns`, `drumGrids`); `progressions` and `drumGrids` use `pick` (no store `current` to exclude), the other three `pickDistinct`. <!-- R117 -->
- A rerolled vibe's `drumGridId` names the grid actually playing. <!-- R118 -->
- Do not reintroduce the density catalogue or the kick-collision filter; authored grids are curated. <!-- R119 -->

([ADR-0009](../../docs/decisions/0009-vibes-as-data-and-single-drum-grid-library.md))
