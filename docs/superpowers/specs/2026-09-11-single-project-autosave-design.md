# Single-Project Autosave — Design

> Replace Solna's named-project *library* with a single autosaved project in IndexedDB,
> drawio-style: the app always resumes the one project it was editing, and opening a `.solna`
> file replaces it. This **supersedes the project-library model** of
> `2026-09-03-project-save-load-design.md`. Every decision here came out of a brainstorming
> session and is settled; rationale is recorded inline. Written 2026-09-11 against `main`
> (007da78). No implementation exists yet.

## Goal

Solna is a single-file desktop app in spirit. There is no project list, no rename/delete, no
"Save As" into a library. There is exactly **one project** on the device, autosaved to
IndexedDB, and the `.solna` file is the interchange format.

Concretely, after this ships:

1. The project is **autosaved** to IndexedDB on every content change; there is no explicit Save.
2. **Launching the app resumes that one project** — no list, no first-run prompt.
3. **Opening a `.solna` file replaces the one project** (with a confirm, since the previous
   project is otherwise gone).
4. **Exporting a `.solna` file** is the manual save-to-file action, drawio's "Save As".
5. The project has a **name, editable in the Song layer header**, used as the default export
   filename.

## What survives from the 2026-09-03 spec (unchanged)

The library model is being removed, but everything about *what a project is* stays. The
following sections of `2026-09-03-project-save-load-design.md` remain authoritative and are
**not** re-derived here:

- **File format v1** — the envelope (`formatVersion`, `id`, `name`, `createdAt`, `updatedAt`)
  and the content set (`bpm`, `meterId`, `masterVolume`, `effects`, `loops`). `formatVersion`
  stays the `.solna` interop marker, still stamped on every write and still what
  `parseProjectFile` refuses a *newer* body against.
- **`.solna` is plain JSON** with a `.solna` extension; MIME `application/json`.
- **Excluded fields** — `selectedVibeId`, `activeLoopId`, `metronomeActive` and (still)
  `customSynthPresets` / `customChordProgressions` never travel in a project.
- **Reset rules for excluded fields** — on open/new/replace: `selectedVibeId → null`,
  `activeLoopId → loops[0].id`, `controlTarget` and `metronomeActive` carried over.
- **Library provenance** — `sanitizeContent` runs on *both* readers (`parseProjectFile` and
  `normalizeStoredBody`) and **substitutes** an unknown `chordRhythmId`, `bassPatternId` or
  `soundKit` with the library's fallback (`CHORD_RHYTHMS[0]`, `BASS_PATTERNS[0]`, the default
  kit), so an unknown id never survives a read. That is not a regression: those resolution
  paths already degraded, and substituting is what makes the degradation explicit rather than
  leaving a dangling id for a consumer to trip over. `SynthParams.preset` is a label nobody
  resolves, so it is left verbatim. Consequence, on the record: **`unknownLibraryReferences`
  is defensive-only** — every production path computes it off an already-sanitized body, so it
  returns `[]` and its notice does not fire. `projectSlice.ts`'s call remains the guard it is,
  against a caller that hands the slice an unsanitized body; nothing user-reachable reaches it.
- **Sanitisation family** — `sanitizeContent` / `sanitizeLoops` / `clampFinite` etc. still
  guard every read. A wrong-typed or out-of-range value gets the default; a future
  `formatVersion` is refused; `loops` empty → one `createDefaultLoop()`.
- **Voice-tail cut ordering** — a content install still runs `hardStopAll()` + the two
  `audioEngine.stopSource(…, LOAD_LOOP_RELEASE)` cuts *synchronously before* the `set()`, and
  does not restart players (a freshly loaded project starts stopped). The existing
  `install()` in `projectSlice.ts` already does this; keep it.
- **Storage guard discipline** — IndexedDB and localStorage both probe inside `try`/`catch`;
  failure is a degraded state, never an exception path (see *Error and edge cases*).

## What changes

| From (2026-09-03 library model) | To (single project) |
| --- | --- |
| `ProjectStore` exposes `list/get/put/remove` over two object stores (`projects`, `projectMeta`) | `load()/save()/clear()` over one object store, one fixed key |
| Content is protected by the `localStorage` "working buffer"; IndexedDB changes only on explicit Save/Open/Import/Delete | IndexedDB **is** the autosave target; `localStorage` shrinks to session/view prefs + the user library |
| `dirty`, `projectBaselineHash`, `fingerprintContent`, `projectDirty.ts` | Removed entirely — with autosave there is no "unsaved" state |
| Launch rehydrates synchronously from `localStorage` | Launch loads asynchronously from IndexedDB behind a fullscreen loading gate |
| Project name lives in the Project Manager modal; shown read-only on the Song layer | Name is **editable in the Song layer header**; the modal is removed |
| Project Manager modal + list rows + rename/delete/import-id-conflict | One compact entry point (Open / Export / New), no list |
| No top-level error boundary | A React-crash `ErrorBoundary` (daisyUI, DEV-only details) |

## Storage model — a single slot

**One object store, one fixed key.** The body is a `ProjectBody` (envelope + content), the
same shape `serializeProject`/`parseProjectFile` already round-trip. No `projectMeta` store, no
`listMeta`, no `repairOrphans` — there is no list to keep consistent and no orphan to repair.
A single `put(body)` overwrites the slot; a single `get()` reads it; `clear()` deletes it.

**`ProjectStore` interface** collapses to:

```
status(): 'unknown' | 'ready' | 'unavailable'
load(): Promise<ProjectStoreResult<ProjectBody>>   // ok + body, or not-found (empty slot)
save(body): Promise<ProjectStoreResult<ProjectBody>> // put; still maps QuotaExceededError → quota
clear(): Promise<ProjectStoreResult<null>>
```

`ProjectStoreResult` keeps the `ok:false` variants the UI still needs — `unavailable`, `quota`,
`failed` — and gains `not-found` as the *empty slot* result from `load()`, which is the normal
first-run state, not an error.

**`id` is kept but inert.** The single slot still carries the envelope's `id` because
`serializeProject`/`parseProjectFile` and the `.solna` contract expect it. It is minted once on
first run and carried through save/load; opening a `.solna` adopts the file's `id`. No code
depends on its value beyond export round-trip. It is **not** used as the storage key — the
storage key is a fixed constant.

**Availability** is resolved once, lazily, as today (`createProjectStore`'s open-once
memoization). It is now opened on **boot** rather than on first Project Manager open, because
boot is what reads the slot.

## Autosave flow

Autosave reuses the idle-scheduler pattern the working buffer already proved out
(`src/utils/coalescedStorage.ts`: `requestIdleCallback` + timeout fallback, a matching
`cancel`). The `dirtyTracker`'s subscription shape is repurposed: a `subscribeWithSelector`
subscription over the **content keys only** — `bpm`, `meterId`, `masterVolume`, `effects`,
`loops` — schedules one idle write per window. Many `set()`s inside one idle window collapse to
one `save(buildProjectContent(state))`.

**What is removed with `dirty`:**

- `projectBaselineHash` and `currentProjectId` leave the store and `partializeAppState`.
- `fingerprintContent` (`projectFingerprint.ts`) and `projectDirty.ts` are deleted, with their
  tests.
- The boot dirty pass in `store.ts` (the one that made a reloaded session honest) is deleted.
- The `dirty` indicator badge on the Wordmark and every "unsaved changes" surface is deleted.

**Write is coalesced, never per-`set()`.** The same `persist`-serialise constraint from
CLAUDE.md applies in reverse: the write must not run on a pointer drag, a clock tick or an
animation frame. `flushPersistedWrites()` is no longer the localStorage flush name for this —
the IndexedDB write is its own coalesced path, but the same "flush on `pagehide` /
`visibilitychange`" rule applies so a killed tab has already written its last edit.

**A failed autosave never blocks the app.** A `quota` or `failed` result sets
`projectStoreStatus`/`projectNotice`, and that is where the write stops: `write()` fires `save()`
once and clears its buffered handle, so nothing re-schedules on a failed result and **the slot
stays stale until the next content change schedules another write**. That re-attempt is a full
one, because autosave writes the whole content set (`buildProjectContent(state)`) rather than a
delta — whatever the failed write was carrying is included again. There is no user-visible
"Save" to fail; the notice is the only signal, and the live session is never rolled back.

## Boot / hydration

`create()` no longer rehydrates project content. The store boots with `factoryProjectContent()`
as a placeholder, `App.tsx` renders the fullscreen loading component, and a bootstrap step:

1. `projectStore.load()`.
2. `ok` → `install(body.content, { id, name })` — the existing install path (voice-tail cut +
   reset rules).
3. `not-found` (empty slot) → keep factory content; mint an `id`, leave the name untitled; the
   first autosave writes the slot.
4. `unavailable` → keep factory content, set the degraded-state notice. The app runs; the user
   can still Open/Export files (pure file I/O).

The reveal happens once `load()` settles. The fullscreen loading component is a daisyUI,
theme-token-safe surface (no raw colours) — the app has no logo loader today, so one is added.

## localStorage reduction

`partializeAppState` persists two kinds of keys and nothing else:

- **Session/view prefs** — `focusTrack`, `metronomeActive`, `selectedVibeId`, `activeLoopId`.
- **The user's cross-project library** — `customSynthPresets`, `customChordProgressions`. These
  were never project content (the 2026-09-03 "excluded — user library" rule); localStorage stays
  their home.

Removed from persist: `bpm`, `meterId`, `masterVolume`, `effects`, `loops`,
`currentProjectId`, `projectBaselineHash`.

`activeLoopId` still references a loop in the content that now loads from IndexedDB, so boot
must reconcile it the same way `sanitizePersistedState` does today — pin to `loops[0].id` when
the stored value names no loaded loop. `sanitizePersistedState` / `sanitizeLoops` slim down to
the remaining keys; loop sanitisation still lives in `sanitizeContent` for the `.solna` import
and IndexedDB load path, which is where the content actually enters the store now.

`PERSIST_VERSION` stays, still stamped, still driving no read-time transform (the "no
migration chains" rule). The persist `migrate` stays identity-plus-legacy-key-adoption; nothing
new chains because a persisted key that disappears is simply absent and `merge` defaults it.

## UI shell

**Name.** `ProjectNameLabel` in `src/components/Header.tsx` (Song layer only) becomes an
**editable** field instead of a read-only span. Commit on Enter/blur, cancel on Escape. The
name autosaves with the project (it is envelope, not content, so editing it does not touch the
content autosave path beyond the name). It remains absent from the Loop layer — the loop picker
stays where it is, and no project name is added there.

**Entry point.** The Wordmark button loses its `dirty` badge and no longer opens the Project
Manager modal. It opens a compact menu with three actions, present on both layers (a project
spans the whole app):

- **Open `.solna`** — file picker; parse → confirm-replace → `install` → `save` (the file
  becomes the autosaved project).
- **Export `.solna`** — `serializeProject` of the live session, filename from the name
  (slugified) + `.solna`.
- **New** — confirm-replace → `install(factoryProjectContent())` → autosave the empty project.

`ProjectManagerModal.tsx`, `ProjectList.tsx`, `projectManagerFlow.ts` (the list/rename/delete/
id-conflict logic) are deleted. `projectNotice` stays as the toast surface for
unknown-references / quota / unavailable.

**Confirm-replace.** Both Open and New replace the current (autosaved) project, which is
destructive. A single lightweight confirm — "This replaces your current project." — guards both;
there is no 3-way dirty guard, because there is no unsaved state to choose about.

## ErrorBoundary

A React-crash boundary only, wrapping the app in `App.tsx` (pattern: `src/shared/components/
ErrorBoundary.tsx` in murva, adapted). It catches **render errors**, not storage failures —
IndexedDB/localStorage unavailability remains the degraded-state notice path, not an exception.

Requirements (solna-specific, unlike murva's raw colours):

- daisyUI classes and role-based tokens only — must pass `bun run check:theme` (no `bg-gray-900`,
  no `text-white`, no raw hex).
- Actions: **Retry** (reset boundary state) and **Refresh** (reload). No "clear storage" action:
  the single project is the user's only copy and a boundary must never offer to delete it.
- The error **message** is shown in production as the user-facing clue (a generic "something went wrong" plus the message string, so a bug report can quote the screen). The **stack and component stack** are rendered in a `<details>` block, DEV-only — those are the details that must never leak to a production user.

This is a distinct concern from the storage change; it is specified here because boot/hydration
is the first genuinely async render path and the boundary is the natural counterpart to the
loading gate.

## Migration

Solna has no real users, so there is **no migration of the library**. The old `projects` /
`projectMeta` object stores are dropped and replaced by the single-slot store. Existing
`localStorage` payloads simply lose their content keys on next boot (sanitise-to-default), and
the first autosave repopulates the slot with the current session. No version chain is added —
consistent with the "no migration chains" rule; sanitisation validates on read.

## Error and edge cases (delta)

The 2026-09-03 *Error and edge cases* table still governs malformed files, newer `formatVersion`,
wrong-typed content, empty `loops`, unknown library ids, and quota. Changes and additions:

| Case | Behaviour |
| --- | --- |
| **Empty slot on first run** | `load()` returns `not-found`; boot keeps factory content and mints an `id`. Normal, not an error. |
| **IndexedDB unavailable** | Degraded state: app runs, content stays in the live session only, a notice shows. Open/Export still work (pure file I/O). There is no "Save" to disable — autosave just doesn't persist. |
| **Quota on autosave** | `save()` maps to `quota`; notice surfaces it. The write is not re-scheduled — it re-attempts on the next content change, which covers everything because autosave writes the whole content set. Live session never rolls back. |
| **Autosave write races boot** | Autosave is not armed until boot's `load()` has settled, so a scheduled write can never overwrite a freshly-loaded project before it is revealed. |
| **Open `.solna` while unavailable** | The file still installs into the live session (the 2026-09-03 rule: "the file still opens, with no current project"); the autosave simply cannot persist it, and the notice explains that. |
| **Two tabs** | Last write wins, as today; no cross-tab reconciliation. |

## Testing (delta)

Conventions unchanged (`.claude/rules/testing.md`: `bun:test`, no DOM, pure-logic helpers +
`renderToString`). The 2026-09-03 serialization / reset-rule / provenance / validation /
voice-tail tests still hold against the surviving functions. Removed and added:

- **Removed** — `projectDirty.test.ts`, `projectDirtyBoot.test.ts`,
  `projectFingerprint.test.ts`, and every list/rename/delete/import-id-conflict case in
  `projectSlice.test.ts` and `ProjectManagerModal.test.ts` (the modal test is deleted with the
  modal).
- **`projectStore.test.ts`** — rewritten for `load/save/clear` over the in-memory backend:
  empty-slot `not-found`, save-then-load round-trip, `clear`, quota mapping, unavailable
  (failing `open()` → degraded, never throws), open-once memoization.
- **Autosave** — inject the idle scheduler (the `coalescedStorage.ts` pattern) and assert N
  content `set()`s inside one window produce exactly **one** `save()`; a non-content `set()`
  (e.g. `focusTrack`) schedules none.
- **Boot/hydration** — the bootstrap step against an in-memory backend: empty → factory, ok →
  install with reset rules, unavailable → factory + notice; and that autosave is not armed
  until after the settle.
- **Name edit** — `renderToString` on the editable `ProjectNameLabel` (Song layer) asserting the
  input element; and that the Loop layer renders no project-name control. Mind the zustand
  `getServerSnapshot` trap.
- **ErrorBoundary** — a render test asserting the fallback shows on a thrown child and the DEV
  `<details>` is absent in production mode.

## Non-goals

- Any backend, account, sync, or sharing.
- Project list, rename, delete, save-as, import-id-conflict — the library model.
- Undo/redo, history, or versioned snapshots.
- Cross-tab reconciliation beyond last-write-wins.
- The murva importer / resolved-rendering export flavour (still format-v2 territory).
- Bundling preset/progression libraries into a project (still per-library export).
