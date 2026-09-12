# Project Source and Google Drive — Design

> Extend Solna's single-autosaved-project model with a **file source** — the answer to "where does
> this project live, and where does explicit Save write back to" — and a **Google Drive backend**
> that does draw.io-style open / save / save-as through the Drive API behind a custom, solna-styled
> project list. This **supersedes the non-goals** of
> `2026-09-11-single-project-autosave-design.md`, which deferred any backend, account, and save-as.
> Everything that doc settled about *what a project is* and *how autosave works* is unchanged and
> stays authoritative. Every decision here came out of a brainstorming session and is settled;
> rationale is inline. Written 2026-09-12 against `main` (`cf61641`). No implementation exists yet.
>
> **Revised 2026-09-12 after review.** Three things changed and are marked where they happen: local
> **Open** now goes through `showOpenFilePicker` so that Save genuinely overwrites the file that was
> opened (the `<input>` is only the fallback); the Drive surface is a **flat list of Solna projects**
> with no folder navigation, because `drive.file` cannot see folders the app did not create; and the
> menu gains a **Disconnect Drive** row, without which the sign-out behaviour this design specifies
> had no way to be invoked.

## Goal

Solna gains the save model of a normal desktop app *on top of* its existing autosave, not in
place of it. There is still exactly **one project** on the device, autosaved to IndexedDB and
resumed on launch. What is new is that the project now carries a **source** — the file it came
from, if any — so the user can commit work back to that file explicitly.

Concretely, after this ships:

1. **Autosave is unchanged** — every content change still writes the one project to IndexedDB;
   launch resumes it. This remains the crash-safety / "pick up where I left off" buffer.
2. **Save** writes the project back to **the file it was opened from** — a Google Drive file, or a
   local file — with no dialog. A project with no source behaves as Save As.
3. **Save As** writes to a *new* file (Drive or local) and switches the source to it.
4. **Open** reads a `.solna` from the local device through `showOpenFilePicker`, which hands back a
   **writable** handle so that the next Save overwrites the file that was opened; or from Google
   Drive through an in-app list of the Solna projects this app can see (no Google-hosted picker
   iframe).
5. **Export** stays, as a distinct action: download a copy without changing the source.

**Open → edit → Save overwrites** is the requirement this design exists for, and it is why local
Open goes through `showOpenFilePicker` rather than the `<input type=file>` the previous design
used: an `<input>` hands back a read-only `File`, so a project opened that way has nothing to
overwrite and its first Save would have to ask for a name and create a *second* file. The
`<input>` survives only as the fallback for browsers with no File System Access API, where that
second file is the best the platform allows.

## What survives from 2026-09-11 (unchanged)

The sections below of `2026-09-11-single-project-autosave-design.md` remain authoritative and are
**not** re-derived here:

- **File format v1** — the envelope (`formatVersion`, `id`, `name`, `createdAt`, `updatedAt`) and
  the content set (`bpm`, `meterId`, `masterVolume`, `effects`, `loops`); `.solna` is plain JSON,
  MIME `application/json`; `formatVersion` still stamped and still what `parseProjectFile` refuses
  a *newer* body against.
- **Excluded fields and reset rules** — `selectedVibeId`, `activeLoopId`, `metronomeActive` and the
  two user-library collections never travel in a project; the open/new reset rules stay.
- **Library provenance and the sanitise family** — `sanitizeContent` on both readers, fallback
  substitution, `loops` empty → one default loop, wrong-typed/out-of-range → default.
- **Voice-tail cut ordering** — a content install still cuts audio synchronously before `set()`
  and starts stopped; the existing `install()` path is reused.
- **Storage guard discipline** — IndexedDB and localStorage probe inside `try`/`catch`; failure is
  a degraded state, never an exception.
- **Boot/hydration** — async `load()` behind the fullscreen loading gate; factory content on an
  empty slot.
- **Autosave mechanics** — idle-coalesced write over the content keys only, flush on
  `pagehide`/`visibilitychange`, a failed write never blocks the app and never rolls back the live
  session.

## What changes

| From (2026-09-11) | To (this design) |
| --- | --- |
| There is **no explicit Save**; Export is the only manual save-to-file | **Save** commits to the source; **Save As** creates a new file and re-points the source; **Export** is a copy without re-pointing |
| The slot holds a bare `ProjectBody` | The slot holds a **slot record** `{ body, source }` |
| A project has no memory of where it came from | A project carries a **source**: `untitled`, a Drive file id, or a local `FileSystemFileHandle` |
| "Any backend, account, sync, sharing" is a non-goal | A **Google Drive backend** exists (OAuth + Drive API v3); sharing/sync still are not |
| No file browser; Open is a native file `<input>` only | A **Drive project list** (flat: the `.solna` files this app can see) plus `showOpenFilePicker` for local open, with the `<input>` kept only as the no-API fallback |
| Export is a plain `download` of the live session | Local **Save** writes back to the opened file via the File System Access API; `download` is the fallback |

## The source reference (core concept)

`ProjectSource` is a small union, held in the store but **outside `ProjectBody`**:

```ts
type ProjectSource =
  | { kind: 'untitled' }                                  // never saved to a file
  | { kind: 'drive'; fileId: string }                     // commits back to this Drive file
  | { kind: 'local'; handle: FileSystemFileHandle };      // commits back to this local file
```

Two invariants, recorded because each is a trap:

- **The source never travels in the `.solna` file.** `serializeProject` / `parseProjectFile`
  round-trip the `ProjectBody` (envelope + content) only. A Drive `fileId` is location metadata,
  not content, and a local handle is not serialisable — both are the same "not project content"
  judgement the `PROJECT_CONTENT_KEYS` exclusion already makes. Storing them beside the body is
  what keeps `parseProjectFile` unchanged.
- **The source is not the storage key.** The single slot keeps one fixed key, exactly as today.
  The source is a field of the slot's value, not a new key, and not a new object store — the
  multi-store complexity the 2026-09-11 doc removed stays removed.

A `FileSystemFileHandle` is structured-cloneable, so the slot record can live in IndexedDB as a
plain structured value; the handle never passes through `JSON.stringify` because the slot path is
IndexedDB (structured clone), not the `.solna` serialiser.

## Save / Save As / Export semantics

The dispatch is a pure function of `source` — no UI state beyond it:

| `source` | **Save** | **Save As** | **Export** |
| --- | --- | --- | --- |
| `untitled` | = Save As (no target to overwrite) | choose Drive/local, create new, source ← new | download a copy, source unchanged |
| `drive(fileId)` | Drive `files.update` (media) on that id | Drive `files.create` (named in the project-list modal), source ← new id | download a copy, source unchanged |
| `local(handle)` | write serialised body to the handle | `showSaveFilePicker` → new handle, source ← new handle | download a copy, source unchanged |

Envelope hygiene on write (a `.solna` file is a document, and its envelope says so):

- **Save** keeps `id`/`createdAt`, bumps `updatedAt` — it is the same document.
- **Save As** mints a fresh `id`, sets `createdAt = updatedAt = now`, and adopts the chosen name —
  it is a new document, and two files must not share an id.
- **Open** adopts the file's `id`/`name`/`createdAt` as today, **and adopts the file itself as the
  source** — a Drive id, or the handle `showOpenFilePicker` returned. That adoption is what makes
  the next Save an overwrite. The one case that cannot adopt a source is the `<input>` fallback,
  which yields a read-only `File`: that opens as `untitled`.

The name for a Drive save comes from the project name (slugified) + `.solna`; for a local Save As
the OS dialog collects the name, and for a Drive Save As an in-app field does.

## Storage model — the slot record

The single object store, one fixed key, now stores a **slot record**:

```ts
interface ProjectSlotRecord {
  body: ProjectBody;      // unchanged: envelope + content, what autosave/load already move
  source: ProjectSource;  // new: where explicit Save writes
}
```

- `ProjectStore` grows `save(record)` in place of `save(body)`; `load()` returns the record;
  `clear()` deletes it. `status()` and the `unavailable`/`quota`/`failed`/`not-found` result
  variants are unchanged.
- **Autosave** builds `{ body: buildProjectContent(state), source }` — it reads the current source
  from the slice and writes the whole record. Autosave never *changes* the source.
- **`source` changes only through explicit user actions** — Open, Save As, New (→ `untitled`), and
  sign-out (→ `untitled` for any `drive` source whose token is gone). A content change alone never
  re-points the source.

## Google Drive backend

**Auth — Google Identity Services, client-side only.** No backend, matching Solna's SPA
architecture. Load `https://accounts.google.com/gsi/client`; `google.accounts.oauth2.initTokenClient`
with the client id and scope `https://www.googleapis.com/auth/drive.file`, then
`requestAccessToken()`. The access token is ~1 hour, kept **in memory only** (never persisted,
never in the store), and re-requested on demand — GIS re-issues silently while its consent cookie
is valid. Sign-out calls `google.accounts.oauth2.revoke`.

**Scope is `drive.file` and nothing else.** It means "see/edit/create/delete only the files this
app created or opened". It is **non-sensitive**, so it needs no restricted-scope security
assessment; publishing the OAuth consent screen to production is a light review, and the Testing
state covers up to 100 users before that.

**What `drive.file` costs, stated plainly, because it decides the whole Drive-surface design.** The app
is invisible to the rest of the user's Drive. `files.list` returns *only* files this app is
authorised for, which in practice means **only files Solna itself created**: the user's folders do
not exist as far as the API is concerned, and neither does a `.solna` someone emailed them and they
uploaded by hand. draw.io lives with the same scope by pairing it with the **Google Picker**, which
is the documented way a user grants per-file access to a file the app did not create — and the
Picker is the Google-hosted iframe (plus the API key) this design set out to avoid. So the trade is
taken in the other direction, and its consequences are accepted rather than worked around:

- **There is no folder navigation.** No breadcrumbs, no drill-in, no "save into this folder". A
  folder Solna did not create cannot be listed, so a browser that offered folders would render an
  empty tree and read as a bug.
- **The Drive surface is a flat list of Solna projects** — every `.solna` this app can see, newest
  first, wherever it happens to live in Drive.
- **The listing query carries no `parents` constraint.** `'root' in parents` would have been wrong
  as well as unnecessary: a user who moves their project into a folder from Drive's own UI would
  otherwise watch it vanish from Solna's list, while `mimeType`-only keeps it listed and keeps Save
  overwriting it.
- **Save As creates in My Drive** (no `parents`, Drive's own default). The user can move the file
  afterwards in Drive and it stays listed and stays writable.
- **A `.solna` Solna did not create cannot be opened from Drive.** The path for that file is to
  download it and use local Open, which is a writable path anyway. If opening foreign Drive files
  ever becomes a requirement, the Picker — not a wider scope — is the thing to add; a wider scope
  (`drive.readonly`, `drive`) is restricted, triggers a security assessment, and is not on the table.

**API — Drive v3, no Picker, no API key.** The `gapi` client (`https://apis.google.com/js/api.js`,
`gapi.load('client', …)`) with the token set via `gapi.client.setToken`. The list and the save
paths are four calls:

- `files.list` (`q: mimeType = '<solna-mime>' and trashed = false`, `orderBy: modifiedTime desc`,
  page tokens) — the project list.
- `files.get` (`alt: 'media'`) — read the `.solna` body → `parseProjectFile` → `install`.
- `files.create` (multipart: metadata `{ name, mimeType }` + media) — Save As / first Save.
- `files.update` (multipart: media only) — Save over an existing id.

Files are stored with a dedicated MIME (a constant like `application/vnd.solna`, distinct from the
`application/json` download MIME) so `files.list` returns only Solna files and the content stays
the same JSON. The exact MIME string is an implementation detail; the content is untouched.

**Drive project list.** A modal, opened for **Open from Drive** and for **Save As → Google Drive**.
It lists `.solna` files (name, modified time) with a "Load more" for the next page, and — for Save
As — collects a filename. It is built on daisyUI + role-based tokens and must pass
`bun run check:theme`. No rename/delete/move in v1 (see non-goals).

## Local file backend (File System Access API)

Both ends of the local path go through the File System Access API, because the requirement is that
Save overwrites the file that was opened:

- **Open (local)** calls `showOpenFilePicker` (offering `.solna`, and `.json` for the mobile
  providers that rewrite an unknown extension). It returns a `FileSystemFileHandle`, which is read
  through `handle.getFile()` for the parse **and kept as the `local` source** — so the next Save is
  an overwrite with no dialog. Where the API is absent, the existing `<input type=file>` is the
  fallback: it yields a read-only `File`, the project opens `untitled`, and Save behaves as Save As.
- **Save As (local)** calls `showSaveFilePicker` (prefilled with the project name + `.solna`) to
  obtain a writable `FileSystemFileHandle`; that handle becomes the `local` source and is stored in
  the slot.
- **Subsequent Save** writes to the stored handle silently — the native-app overwrite. A handle from
  `showOpenFilePicker` starts with read permission only, so the first write goes through
  `requestPermission({ mode: 'readwrite' })`; the Save click is the user gesture that allows it, and
  a denial is a notice, never a silent no-op.
- The handle is structured-cloneable, so it persists in IndexedDB across restarts; the browser may
  require a `requestPermission()` on the handle at boot before the first write (a user gesture),
  which the Save action itself provides.
- **Fallback.** Where the File System Access API is unavailable (Safari/Firefox today), local Open
  degrades to the `<input>` and local Save degrades to the existing `download` path — the user
  re-confirms the filename, and the source stays `untitled`. This is a capability probe, not an
  error: the feature works everywhere; silent local overwrite is a Chromium nicety. **On those
  browsers Drive is the only surface that can honour "Save overwrites what I opened"**, which is
  worth saying out loud rather than discovering.

## UI shell

**Entry point.** The Wordmark menu (the 2026-09-11 "Open / Export / New" compact menu) grows to:

- **Open `.solna`** — `showOpenFilePicker`, falling back to the file input.
- **Open from Drive** — the Drive project list; requires sign-in if not connected.
- **Save** — commit to source; when `untitled`, opens the Save-As dialog.
- **Save As** — choose Drive or local, create a new file, re-point the source.
- **Export `.solna`** — download a copy, source unchanged.
- **New** — confirm-replace → factory content, source ← `untitled`.
- **Disconnect Drive** — revoke and sign out. **Shown only while signed in**, because a row that is
  a no-op in the common case is worse than an absent one.

**Drive connection state.** A single sign-in state in the slice (`driveSignedIn: boolean`), set on
token acquisition and cleared on revoke. The connect prompt lives **inside the Drive list modal**
rather than as its own menu row, so the menu has one row per action instead of a row whose meaning
changes with the session; the sign-out row is the exception, because there is no other surface it
could live on. Account email/avatar display is out of scope (it would need an extra scope for v1's
value).

**When Drive is not configured** (no OAuth client id in this deployment) the Drive rows are
**absent, not disabled**: *Open from Drive* and the Drive half of the Save-As chooser do not render
at all. A target that can never work on this build must not be advertised, and the local path is
unaffected.

**Confirm-replace** for Open and New is unchanged (replaces the current project). Save and Save As
are non-destructive to the current project and show no confirm.

## Autosave interaction

Autosave and Save are two different commits and are stated side by side so they are not conflated:

- **Autosave → IndexedDB** is *continuous* and implicit; it is the resume buffer and never fails
  loudly. It writes the slot record but never changes `source`.
- **Save → source file** is *explicit* and occasional; it is the user's commit to a named file. It
  changes `source` only when it had to create a file (untitled → Save As).

A failed Drive/local Save surfaces through the existing `projectNotice` toast; it never rolls back
the live session and never touches the autosaved slot.

## Security & consent

- **Minimal scope** — `drive.file` only; no `drive`, no `userinfo`, no `openid`. The consent screen
  reads as "see/edit the Solna files you open or create in Drive."
- **Token hygiene** — access token in memory only, never in localStorage/IndexedDB/zustand, revoke
  on sign-out, `include_granted_scopes: false` so a token never inherits a broader earlier grant.
  **The honest limit:** `gapi.client.setToken` parks the token on the `gapi` global, so it is
  readable via `gapi.client.getToken()` by anything running on the page. "In memory only" means
  *never written to storage and never in the store* — it does not mean unreachable, and it cannot,
  short of replacing `gapi` with raw `fetch`.
- **Script/connect allowlist** — GIS and `gapi` load from `accounts.google.com` and
  `apis.google.com`; Drive calls hit `www.googleapis.com`. **No CSP ships with this change** and
  that is a deliberate, recorded decision, not an omission: `index.html` runs a blocking inline
  pre-paint theme script, so a `<meta>` CSP would need a hash/nonce for it and getting that wrong
  trades a remote-code guard for a flash of the wrong theme. If a CSP is adopted later it belongs in
  a response header, with `script-src` naming exactly the two script origins and `connect-src`
  exactly `www.googleapis.com`. In its place this change ships a **source scan** that fails the
  suite when a Google origin appears outside the three files that own one, and asserts that
  `vite.config.ts` adds no runtime cache rule for a Google API or script origin — a cached OAuth
  response or a cached `gsi/client` is a sign-in that never expires. That scan must be written so it
  actually matches the way a workbox rule is spelled (a regex literal, with escaped dots), or it
  guards nothing.
- **No secret exists** — an OAuth *web* client has no client secret to leak; the API key the Picker
  path would have needed is not needed at all (no Picker).

## Configuration

The OAuth **web** client id is the one deployment-specific value. It is read from
`VITE_GOOGLE_CLIENT_ID` at build time, documented in a committed `.env.example`, and **absent is a
normal state**: no id → `driveAvailable === false` → every Drive affordance is absent and the app
boots exactly as it does today. There is no secret to protect — an OAuth web client has none — so
the id may live in the built bundle.

The human setup, which no test can cover and which belongs in the repo's docs rather than in a
reviewer's memory: create an OAuth **web** client in Google Cloud Console, add the dev server and
the production origin to *Authorized JavaScript origins* (no redirect URI — GIS uses a popup), set
the consent screen's scope to `drive.file` only, and keep the app in *Testing* (up to 100 users)
until the light review for publishing is worth doing.

## Error and edge cases (delta)

The 2026-09-11 *Error and edge cases* table still governs malformed files, newer `formatVersion`,
empty slots, quota, unavailable storage, and two-tab last-write-wins. Additions:

| Case | Behaviour |
| --- | --- |
| **Save with `untitled` source** | Routes to Save As; no overwrite of anything. |
| **Save As with no Drive connection** | The dialog offers local only (or prompts to connect first); the local path never requires a token. |
| **Drive token expired / revoked** | Next Drive call re-requests via GIS; if the user denies, the action aborts with a notice and `driveSignedIn → false`. A `drive` source that can no longer be reached is not cleared automatically — the user still holds the local session; Save As can re-point it. |
| **Sign out with a `drive` source** | Source reverts to `untitled` (the id is meaningless without a token); the body and autosave are untouched. |
| **Local overwrite unsupported** | `showSaveFilePicker` absent → Save degrades to `download`; source stays `untitled`. Capability probe, not an error. |
| **Local open unsupported** | `showOpenFilePicker` absent → the `<input>` fallback; the project opens `untitled` and its first Save is a Save As. |
| **Handle permission lost at boot, or a handle opened read-only** | `requestPermission({ mode: 'readwrite' })` before the first write, on the Save gesture; denial → notice naming Save As as the way out. The source is **not** cleared — the user may grant it next time. |
| **Drive Save As name collision** | Drive allows same-named files (distinct ids); no conflict prompt in v1 — the new file simply gets its own id. |
| **Drive list is empty on a fresh account** | Expected, not an error: `drive.file` sees only files Solna created, and a new user has none. The empty state says so. |
| **A `.solna` in Drive that Solna did not create** | Invisible to `files.list` under `drive.file` and not openable from Drive. The empty state names the workaround: download it and use local Open. |
| **A Drive project the user moved into a folder** | Still listed and still writable — the query filters on MIME only, never on `parents`. |
| **Drive not configured (no client id)** | Every Drive affordance is absent; nothing asks for a token. Local Save/Save As/Open are unaffected. |
| **A 401 that survives the one silent retry** | The grant is gone, not the token stale: `driveSignedIn → false` and a notice. It must take the same path as an explicit denial — one place decides, and a raw `{ status: 401 }` must not slip past it as a generic failure. |

## Migration

Solna has no real users, so there is **no data migration**. The single slot's value shape widens
from a bare `ProjectBody` to `{ body, source }`; a slot written by the previous shape is recognised
on read (a bare body → wrapped as `{ body, source: { kind: 'untitled' } }`) by the same
sanitise-on-read discipline the "no migration chains" rule mandates — no `PERSIST_VERSION` bump, no
version-gated branch. `formatVersion` in the `.solna` body is untouched: the file format did not
change, only what is stored beside it.

## Testing (delta)

Conventions unchanged (`.claude/rules/testing.md`: `bun:test`, no DOM, pure-logic helpers +
`renderToString`). The 2026-09-11 serialisation / reset-rule / provenance / autosave / boot tests
still hold. Added:

- **Source dispatch** — pure `saveTarget(source)` helper: `untitled` → save-as, `drive` → update,
  `local` → write-to-handle; and the envelope transitions (Save keeps id / Save As mints id).
- **Slot-record sanitise** — a bare `ProjectBody` read → `{ body, source: untitled }`; a record
  round-trips; `source` never appears in `serializeProject` output.
- **Drive client** — `list`/`get`/`create`/`update` against an injected `gapi`-shaped stub (no real
  network); `parseProjectFile` fed by a mocked `files.get` media body; token expiry re-request; the
  listing query carries the MIME and `trashed = false` and **no `parents`**.
- **Drive project list** — `renderToString` + pure helpers (filter to solna MIME, sort by modified,
  page append with de-duplication); the zustand `getServerSnapshot` trap applies. Note that under
  `renderToString` no effect runs, so any "loading" copy a test asserts must be the component's
  *initial* state, not a state an effect sets.
- **FS Access API** — Save writes through a stubbed handle; Open reads through a stubbed handle and
  adopts it as the source; the picker-absent fallbacks yield `download` + `untitled` (save) and the
  `<input>` path (open).

## Non-goals

- Realtime collaboration, sharing, or multi-user Drive permissions.
- Multi-account Google sign-in; account email/avatar display.
- Rename, move, or delete of Drive files inside the list (list + open + create only).
- **Folder navigation in Drive, and choosing a Drive folder to save into** — impossible under
  `drive.file` and cut deliberately rather than shipped as an empty tree (see the scope section).
- **Opening a Drive file Solna did not create** — that is what the Google Picker exists for, and the
  Picker (plus its API key and its Google-hosted iframe) stays out of v1.
- Offline/queued Drive sync or conflict resolution beyond last-write-wins on the same id.
- Drive "open with" / Workspace add-on / Marketplace listing (registering `.solna` to launch Solna
  from Drive's UI).
- Cross-tab reconciliation beyond last-write-wins.
