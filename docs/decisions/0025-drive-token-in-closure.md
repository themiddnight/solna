# ADR-0025: The Google token lives only in a closure

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

Google Drive is the optional remote an explicit Save commits to (see
[ADR-0024](0024-storage-zones-project-slot-autosave.md)). Drive calls need an OAuth access token.
Everything in the Zustand store is visible in the devtools panel, and any slice key is one edit away
from `partialize` — i.e. from being written to `localStorage`.

## Decision

**`store/driveAuth.ts` holds the only Google access token, in a closure** — no getter hands it out,
and **no slice may read it**:

- `driveSignedIn` in the drive slice is a *mirror* of "an unexpired token is held", not the token.
- Every Drive call acquires one through `withDriveToken` at the moment it needs it.

A token in a slice would be a token in `partialize` the first time someone added it to the list,
and a token in the store is a token in the devtools panel.

## Consequences

- UI can show signed-in state without ever touching the token.
- Adding a Drive operation means wrapping it in `withDriveToken`, never reading a stored token.
- The token cannot leak into persisted state, exported projects or devtools by construction.

## Rules this implies

- **R036** — `store/driveAuth.ts` holds the only Google access token, in a closure; no getter hands
  it out.
- **R037** — No slice reads the token; `driveSignedIn` is a mirror only; every Drive call acquires
  one via `withDriveToken` when needed; a token never enters a slice/`partialize`.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 107-112.
