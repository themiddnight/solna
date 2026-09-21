# ADR-0024: Four storage zones, one project slot, autosave

**Status:** Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425).

## Context

Solna keeps state in several browser storage mechanisms plus an optional remote, and each has a
different failure mode and a different contract. A project also has to know *where* an explicit
Save writes back — a Drive file, a local file handle, or nowhere yet — without that location
leaking into the portable `.solna` body. Earlier versions tracked "unsaved changes" with
`projectDirty.ts`/`projectFingerprint.ts`.

## Decision

### Four storage zones, not three

`localStorage` holds the live session (persist; see
[ADR-0022](0022-persist-write-path-and-guarded-storage.md) and
[ADR-0023](0023-validation-instead-of-migration.md)); `sessionStorage` nothing; **IndexedDB holds
the one project slot**, reached only through `store/projectStore.ts`; and **Google Drive is the
optional remote source an explicit Save commits to** — absent, not disabled, when
`VITE_GOOGLE_CLIENT_ID` is unset (its token handling is
[ADR-0025](0025-drive-token-in-closure.md)).

That wrapper resolves availability *once, lazily* and turns every failure into a typed result — a
device that cannot store projects is a **normal degraded state the UI renders, never an exception
path**, the same discipline `resolveStorage()` follows.

### One slot, a record of body and source

- The database is **one object store (`project`) holding one fixed slot key**
  (`projectStoreIdb.ts`); its version upgrade drops the old two-store layout, and there is no
  project library listing to keep cheap.
- The slot's value is a **record, `{ body, source }`** (`ProjectSlotRecord` in
  `store/projectSource.ts`): `source` is where an explicit Save writes back — `untitled`, a Drive
  `fileId`, or a local `FileSystemFileHandle` — and it is held **beside** the body, never inside it,
  because a file id is location metadata and a handle is not serialisable, so neither may reach
  `serializeProject`.
- **The source never travels in the `.solna` body**, and **`projectSource` is not a *localStorage*
  persist key** — it is deliberately absent from `partializeAppState` and `PROJECT_CONTENT_KEYS` —
  but it lives in the IndexedDB slot record beside the body, so a reload restores the source from
  the slot record; only the `.solna` file carries no pointer to where it came from.
- `sanitizeSlotRecord` accepts a slot written before sources existed and reads it as
  `{ body, source: untitled }`; there is no version gate for that widening, by the same "no
  migration chains" rule as everything else here.

### The project body and its version

- A **project body is the content set only** (see `PROJECT_CONTENT_KEYS`) — view, session and
  library state are excluded by construction.
- Its `formatVersion` is deliberately **independent of the persist `version`**: that one is stamped
  for private `localStorage` reshapes, this one for the `.solna` content contract, and a body's
  `.solna` shape must never be read by treating it as a `localStorage` payload or vice versa.
  Neither version drives a transform any more, but they still mean different things and must not
  collapse into one — `parseProjectFile` refuses a body whose `formatVersion` is newer than
  `PROJECT_FORMAT_VERSION` regardless of what `PERSIST_VERSION` is doing.
- Each user library array — `customSynthPresets`, `customChordProgressions`, `customBeatPresets`
  (`src/store/presetsSlice.ts`) — is bounded at save time via a write-time cap that evicts the
  oldest entry first once the array would grow past it, never a read-time repair.

### Project content changes are autosaved, not dirty-tracked

- `projectDirty.ts`/`projectFingerprint.ts` are gone (deleted in the same change that added
  continuous IndexedDB autosave) — there is no "unsaved changes" concept left to compute.
- `src/store/projectAutosave.ts` holds one `subscribeWithSelector` subscription over
  `PROJECT_CONTENT_KEYS` (plus `projectName`) with `equalityFn: shallow`, so an entire knob-drag
  gesture collapses to a single pending write rather than firing per `set()`.
- A pending write is scheduled once per idle window (the same `idleWriteScheduler`
  `coalescedStorage.ts` uses) and flushed immediately on `pagehide`/`visibilitychange`, so a killed
  tab never loses its last edit.
- It starts **disarmed**: boot's `loadProject()` reads the IndexedDB slot asynchronously, and a
  write scheduled before that settles could overwrite the freshly-loaded project with placeholder
  boot content — `store.ts` arms it in a `finally` only after `loadProject()` resolves.

## Consequences

- A `.solna` file is portable and location-free; the save target survives reload via the slot
  record only.
- A storage-less device renders a degraded state instead of throwing.
- There is no "unsaved changes" prompt to maintain; the slot always holds the latest content within
  one idle window.
- Anything added to `PROJECT_CONTENT_KEYS` is autosaved and exported; anything that is view,
  session or library state must stay out of it.

## Rules this implies

- **R245** — Four storage zones: `localStorage` = live session; `sessionStorage` = nothing;
  IndexedDB = the one project slot, only via `store/projectStore.ts`; Google Drive = optional
  remote, absent when `VITE_GOOGLE_CLIENT_ID` unset.
- **R246** — `projectStore` resolves availability once, lazily; every failure is a typed result; a
  storage-less device is a rendered degraded state, never an exception path.
- **R247** — IndexedDB: one object store `project`, one fixed slot key (`projectStoreIdb.ts`).
- **R248** — Slot value is `{ body, source }` (`ProjectSlotRecord`, `store/projectSource.ts`);
  `source` is held beside the body and never reaches `serializeProject` / the `.solna` body.
- **R249** — `projectSource` is not a localStorage persist key (absent from `partializeAppState`,
  `PROJECT_CONTENT_KEYS`); it lives in the IDB slot record.
- **R250** — `sanitizeSlotRecord` reads a pre-source slot as `{ body, source: untitled }`, no
  version gate.
- **R251** — A project body is the `PROJECT_CONTENT_KEYS` content set only (no view/session/library
  state).
- **R252** — `.solna` `formatVersion` is independent of the persist `version`; never read one
  payload shape as the other; the two never collapse.
- **R253** — `customSynthPresets`, `customChordProgressions`, `customBeatPresets` are capped at write
  time, evicting oldest first; never a read-time repair.
- **R254** — No dirty tracking; `src/store/projectAutosave.ts` holds one `subscribeWithSelector`
  subscription over `PROJECT_CONTENT_KEYS` + `projectName` with `equalityFn: shallow`.
- **R255** — A pending autosave is scheduled once per idle window (`idleWriteScheduler`) and flushed
  on `pagehide`/`visibilitychange`.
- **R256** — Autosave starts disarmed; `store.ts` arms it in a `finally` after `loadProject()`
  resolves.

## Sources

Pre-restructure `CLAUDE.md` at `02cf1a9b`, lines 857-901.
