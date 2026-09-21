---
paths:
  - "src/data/**"
---

# Data layer

What may live in `src/data/` and what a file there may do.

- `src/data/` imports nothing at runtime, not even a sibling in `src/data/`; every file is an independent leaf with no evaluation graph. <!-- R020 --> <!-- R025 -->
- It holds factory content only: synth presets, Beat presets, drum grids, chord progressions, chord rhythms, bass patterns, effect chains, scales. <!-- R021 -->
- A data file reads no impure global (`Math`, `Date`, `crypto`, …), declares no function, constructs nothing with `new`, and has no module-scope `let`/`var`. <!-- R022 -->
- It may declare types and `import type` from anywhere. <!-- R023 -->
- Top-level `const` arrow helpers that are literal shorthand (`step()`, `block()`, `strum()`) are allowed only in the same file as the table they build. <!-- R024 -->
- `src/data/dataLayerPurity.test.ts` lints fixture sources through eslint's API and keeps these rules true across tool upgrades; keep it. <!-- R026 -->
- Content belongs here only if adding an entry is an edit to that table and nothing else; `METERS`, `THEME_TOKENS` and `VIEW_META` are registries and stay with the code that reads them. <!-- R027 -->

([ADR-0002](../../docs/decisions/0002-four-layer-import-architecture.md))

- `src/data/`'s ESLint block already forbids every value import, `tonal` included; it needs no separate tonal carve-out. <!-- R052 -->

([ADR-0005](../../docs/decisions/0005-music-core-and-tonal-confinement.md))

- `src/utils/` sits outside the layer chain, above `data/`: it may read `data/` at runtime (`musicTheory.ts` imports `SCALES`); `data/` reads `utils/` only through `import type` (e.g. `MeterId`). <!-- R058 -->

([ADR-0004](../../docs/decisions/0004-utils-placement-and-store-constant-inversion.md))
