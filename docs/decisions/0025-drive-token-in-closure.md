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

## Amendment 2026-09-23: remember the account, not the session

A token only lives in the page that acquired it, so every reload left Drive disconnected, and the
first request of the next page opened Google's account chooser again. Three ways out were weighed:

- **Persist the access token** (localStorage) — rejected: it survives at most its one-hour lifetime,
  it is exactly what this ADR exists to prevent, and any XSS would read it.
- **Authorization-code flow with a refresh token** — rejected for now: it needs a backend to hold
  the client secret and the refresh token (httpOnly cookie); solna is a static SPA.
- **Remember the account** — accepted. `driveUser` (`{ email, name }`, identity only) joins
  `partialize`, validated on read by `sanitizeDriveUser`. `createDriveAuth` takes a
  `rememberedAccount` reader and, on a page's first request, sends `prompt: ''` with `login_hint`
  set to the remembered email (no hint when Drive hid it), so GIS reuses the existing grant and the
  popup closes by itself. Google still shows consent if the grant was removed.

Consequences: the request still starts from a click (a popup opened after boot or after an await
is blocked), so the user sees a brief popup once per page or per expired hour. The Drive heading
and **Disconnect** appear from boot for a remembered account; `driveSignedIn` still mirrors only a
held token. Disconnect without a token forgets the account locally only — GIS revoke needs a token,
so the `drive.file` grant stays at Google until the user removes it in their account settings. The
account email is stored in this device's localStorage.

## Rules this implies

- **R036** — `store/driveAuth.ts` holds the only Google access token, in a closure; no getter hands
  it out.
- **R037** — No slice reads the token; `driveSignedIn` is a mirror only; every Drive call acquires
  one via `withDriveToken` when needed; a token never enters a slice/`partialize`.
- **R324** — The connected account (`driveUser`) is remembered across reloads, never the token; a
  page's first request uses `prompt: ''` + `login_hint`, still from a user gesture; only Disconnect
  forgets it.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 107-112.
