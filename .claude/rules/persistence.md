---
paths:
  - "src/store/store.ts"
  - "src/store/migrate.ts"
  - "src/store/persistStorage.ts"
  - "src/store/sanitize*.ts"
  - "src/store/project*.ts"
  - "src/store/presetsSlice.ts"
  - "src/store/drive*.ts"
  - "src/utils/coalescedStorage.ts"
  - "src/utils/storage.ts"
  - "src/utils/idbPromise.ts"
  - "src/utils/localFileSave.ts"
  - "src/utils/driveBrowser.ts"
  - "src/utils/projectFileIO.ts"
  - "src/components/Header.tsx"
  - "src/components/project/**"
---

# Persistence and storage

The app store, the persist write path, validation on read, storage zones, the project slot, autosave and the Drive token.

## Store

- One Zustand app store composed from the slices `store.ts` lists (that list binds), plus one separate vanilla store, `audioRecovery.ts`, outside the persisted store. <!-- R033 --> ([ADR-0002](../../docs/decisions/0002-four-layer-import-architecture.md))
- `store/driveAuth.ts` holds the only Google access token, in a closure; no getter hands it out. <!-- R036 -->
- No slice reads the token; `driveSignedIn` is a mirror of "an unexpired token is held"; every Drive call acquires one through `withDriveToken` at the moment it needs it; a token never enters a slice or `partialize`. <!-- R037 -->

([ADR-0025](../../docs/decisions/0025-drive-token-in-closure.md))

## Write path and guarded storage

- Persisted values are replaced, never mutated in place: `createDedupedJsonStorage` compares by reference (`store.test.ts` pins this). <!-- R210 -->
- The `localStorage` write goes through `utils/coalescedStorage.ts` (idle callback, flush on `pagehide`/`visibilitychange`). <!-- R211 -->
- Pointer-, clock- or animation-frame-driven code never writes persisted state directly (each such write re-serialises everything). <!-- R212 -->
- Tests and live reads call `flushPersistedWrites()` before asserting on `localStorage`. <!-- R213 -->
- Storage access is guarded: `localStorage` can throw; `store.ts` falls back to an in-memory `StateStorage`; helpers take an injectable storage param read inside a `try`, never in a default-parameter expression (`Header.tsx` theme functions). <!-- R244 -->

([ADR-0022](../../docs/decisions/0022-persist-write-path-and-guarded-storage.md))

## Validation, not migration

- `persist` key `musibox_project_state_v1`; `partialize` + `migrate` in `store.ts`; legacy-key adoption in `migrate.ts`; `subscribeWithSelector`. <!-- R034 -->
- No per-version migration step: `PERSIST_VERSION` is stamped but drives no transform; a persisted shape change validates the key in `merge`'s `sanitizePersistedState`, never bumps the version. <!-- R035 -->
- `sanitizePersistedState` (`store.ts`) and `sanitizeContent` (`projectFile.ts`) validate every key on every read: invalid, missing or not-a-member → default; in-range passes untouched. <!-- R214 -->
- `migrate` in `store.ts` stays identity plus legacy-key adoption (zustand throws without one). <!-- R215 -->
- `PERSIST_VERSION` and `PROJECT_FORMAT_VERSION` are still stamped on every write; `parseProjectFile` refuses a newer `formatVersion`. <!-- R216 -->
- `sanitizeContent` is the only non-test caller of `sanitizeLoops` (loops live in IndexedDB). <!-- R217 -->
- Precondition: solna has no real users. If that lapses, reintroduce chains — one `if (version < N)` guard per shape change, frozen once shipped, persist and project-body chains kept separate. <!-- R218 -->
- Never add a version-gated branch "just in case". <!-- R219 -->
- `toChordItem` (`store/sanitize.ts`) rebuilds a fresh `{id, root, quality, bars, bassNote?}` literal, never casts raw input through. <!-- R072 --> ([ADR-0007](../../docs/decisions/0007-chord-notes-derived-not-stored.md))
- `asLeadNoteMatrix` (`sanitize.ts`) returns `undefined` for the pre-DEV-369 `string[][]` shape (blank payload, no throw, no warning); do not "fix" it. <!-- R259 -->
- A stale-but-valid pre-tick-resolution `LeadNote[][]` passes through unchanged at its written tick density. <!-- R260 -->

([ADR-0023](../../docs/decisions/0023-validation-instead-of-migration.md))

## Storage zones, project slot, autosave

- Four zones: `localStorage` = live session; `sessionStorage` = nothing; IndexedDB = the one project slot, reached only through `store/projectStore.ts`; Google Drive = optional remote, absent when `VITE_GOOGLE_CLIENT_ID` is unset. <!-- R245 -->
- `projectStore` resolves availability once, lazily; every failure is a typed result; a storage-less device is a rendered degraded state, never an exception path. <!-- R246 -->
- IndexedDB has one object store, `project`, with one fixed slot key (`projectStoreIdb.ts`). <!-- R247 -->
- The slot value is `{ body, source }` (`ProjectSlotRecord`, `store/projectSource.ts`); `source` sits beside the body and never reaches `serializeProject` or the `.solna` body. <!-- R248 -->
- `projectSource` is not a localStorage persist key (absent from `partializeAppState` and `PROJECT_CONTENT_KEYS`); it lives in the IDB slot record. <!-- R249 -->
- `sanitizeSlotRecord` reads a pre-source slot as `{ body, source: untitled }`, with no version gate. <!-- R250 -->
- A project body is the `PROJECT_CONTENT_KEYS` content set only (no view, session or library state). <!-- R251 -->
- The `.solna` `formatVersion` is independent of the persist `version`; never read one payload shape as the other; the two never collapse. <!-- R252 -->
- `customSynthPresets`, `customChordProgressions`, `customBeatPresets` are capped at write time, evicting oldest first; never a read-time repair. <!-- R253 -->
- No dirty tracking: `src/store/projectAutosave.ts` holds one `subscribeWithSelector` subscription over `PROJECT_CONTENT_KEYS` + `projectName` with `equalityFn: shallow`. <!-- R254 -->
- A pending autosave is scheduled once per idle window (`idleWriteScheduler`) and flushed on `pagehide`/`visibilitychange`. <!-- R255 -->
- Autosave starts disarmed; `store.ts` arms it in a `finally` after `loadProject()` resolves (an earlier write could overwrite the loaded project). <!-- R256 -->

([ADR-0024](../../docs/decisions/0024-storage-zones-project-slot-autosave.md))
