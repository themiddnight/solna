# ADR-0004: `src/utils/` placement and the MIME-constant inversion

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425). Music Core import
direction per DEV-394.

## Context

`src/utils/` holds helpers used by several layers. It is not one of the four layers
([ADR-0002](0002-four-layer-import-architecture.md)), so its position relative to `data/`,
`musicCore/` and `store/` has to be stated explicitly. Two utilities that save and browse project
files also need the `.solna` and Drive MIME types, which are defined in `src/store/`.

## Decision

`src/utils/` stays outside the chain, above `data/`: it may read `data/` at runtime
(`musicTheory.ts` imports `SCALES`), but nothing in `data/` may read it back except through an
`import type` (e.g. `MeterId`), which is erased at compile.

`src/utils/` may also import `@/musicCore` (`musicTheory.ts`, `noteSpelling.ts`, DEV-394) — never
the reverse: `src/musicCore/` is ESLint-banned from importing `src/utils/`, alongside its
store/components/audio bans ([ADR-0005](0005-music-core-and-tonal-confinement.md)), so this
relationship reads in one direction from either ADR.

**One deliberate inversion is recorded here so a reader does not have to discover it:
`utils/localFileSave.ts` and `utils/driveBrowser.ts` import *types and constants* from
`src/store/`** — the `.solna` MIME type and the Drive MIME type.

## Consequences

- It is an exception because the alternative is duplicating a contract string in two places, where
  the two copies can disagree silently and only one of them is the one `projectFile.ts` actually
  parses against.
- Rejected alternative: the honest fix (a leaf module under `src/utils/` both layers import) was
  considered and rejected, because it would move constants out of already-shipped, already-reviewed
  search-and-save code for a docs-only change.
- It is an import of a *value that never varies*, never a call into the store: no file in
  `utils/` reads store state, subscribes, or names a slice. A `utils/` file that did any of those
  would be a new violation, not an extension of this exception.

## Rules this implies

- **R058** — `src/utils/` sits outside the chain above `data/`: may read `data/` at runtime;
  `data/` reads `utils/` only via `import type`.
- **R059** — `src/utils/` may import `@/musicCore`, never the reverse.
- **R060** — Sole inversion: `utils/localFileSave.ts` and `utils/driveBrowser.ts` import
  types/constants (`.solna` MIME, Drive MIME) from `src/store/`; no `utils/` file reads store
  state, subscribes or names a slice.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 175-189.
