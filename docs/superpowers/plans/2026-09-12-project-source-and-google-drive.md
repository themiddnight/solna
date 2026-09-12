# Project Source and Google Drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the single autosaved project a *source* — untitled, a Google Drive file id, or a local `FileSystemFileHandle` — so explicit Save commits back to **the file the project was opened from**, Save As creates a new one, and an in-app list opens and creates Solna projects in Drive.

> **Revised 2026-09-12 after a review of the first draft.** Three things changed, and each one is marked at the task that owns it: local **Open** goes through `showOpenFilePicker` (Task 2, 6) so that Save actually overwrites the file that was opened — the `<input>` is the fallback only; the Drive surface is a **flat list with no folders** (Task 10, 12, 13) because `drive.file` cannot see a folder the app did not create; and the menu gains **Disconnect Drive** (Task 16). Task 18 (docs + `.env.example`) is new. Eight concrete defects in the first draft's code are fixed in place; none of them is called out in prose, because the code below is the plan.

**Architecture:** A `ProjectSource` union lives *beside* the project body, never inside it. The one IndexedDB slot's value widens from a bare `ProjectBody` to a slot record `{ body, source }`, sanitised on read. Save / Save As / Export dispatch purely off `source.kind`. Drive is Google Identity Services (`drive.file` scope, token in memory only) plus the `gapi` client, wrapped in three layers — auth (`driveAuth.ts`), a transport-agnostic operation layer (`driveClient.ts`), and the gapi adapter (`driveGapi.ts`) — so every test runs against an injected stub and never touches Google.

**Tech Stack:** Bun (runtime + `bun:test`), TypeScript, React 19, Zustand 5, daisyUI 5, Web Audio. **No new npm dependency:** GIS and `gapi` are loaded as `<script>` tags from Google's origins under an allowlist.

**Spec:** `docs/superpowers/specs/2026-09-12-project-source-and-google-drive-design.md` — read it alongside this plan; every task's "why" is argued there.

## Global Constraints

- Runtime is **Bun**; the test runner is `bun:test`; `bun run lint` is `tsc --noEmit`.
- `bun run verify` is the completion gate: `bun test && bun run lint && bun run eslint && bun run check:keys && bun run check:drums && bun run check:contrast && bun run check:levels && bun run build`. `bun run eslint` must report **nothing at all** — no errors, no warnings.
- `bun run check:theme` gates every daisyUI/theme surface. Components name **roles** (`bg-base-100`, `text-base-content`), never colours; `scripts/themeTokenGuard.ts` fails on raw hex, Tailwind palette classes, `text-white`, `dark:`, `rgb()`, and dead utilities. Its allowlist is empty — fix the code, not the allowlist.
- **No new runtime dependency.** GIS (`https://accounts.google.com/gsi/client`) and `gapi` (`https://apis.google.com/js/api.js`) are script tags. Drive calls hit `https://www.googleapis.com`. Nothing wider.
- **Layering (eslint-enforced):** `src/data/` imports nothing at runtime; `src/audio/` never imports `store/` or `components/`; `src/store/` never imports `components/`; `src/components/` must not import `audio/engine`. A new `<Button>`-style primitive does not get added — reuse `src/components/ui/`.
- **No `PERSIST_VERSION` bump and no version-gated branch.** The slot value widens from a bare body to `{ body, source }`; the read path sanitises both shapes. `PERSIST_VERSION` (store.ts) and `PROJECT_FORMAT_VERSION` (projectFormat.ts) are markers, not transform triggers.
- **The source never travels in the `.solna` file.** `serializeProject` / `parseProjectFile` round-trip the `ProjectBody` (envelope + content) only, and every task touching the serialiser must leave that true.
- **`projectSource` is not persisted to `localStorage`.** It is not a `partializeAppState` key — the slot record in IndexedDB is its home. Do not add it to `PersistedState`.
- **Drive scope is `https://www.googleapis.com/auth/drive.file` and nothing else**, with `include_granted_scopes: false`. The access token lives in one closure variable in `driveAuth.ts`: never in zustand, never in `localStorage`, never in IndexedDB.
- **Drive MIME is `application/vnd.solna`** (a constant in `driveClient.ts`), distinct from the `application/json` download MIME `PROJECT_FILE_MIME`. `files.list` filters on it.
- **The `.solna` file name is `<slug>.solna`** — always through `projectFileName()` (`src/utils/projectFileIO.ts`), never hand-built.
- Tests: **no DOM, no testing-library**. Prefer pure helpers; use `renderToString` for components. Under `renderToString`, a component reading `useAppStore` directly renders *creation-time* state — read the store through `useLiveStore` (`src/components/ui/useLiveStore.ts`) if a test must set state first. See `.claude/rules/testing.md`.
- Every command below runs from the repo root: `/Users/Pathompong/Sites/Personal/solna`.

## File Structure

**Phase 1 — source reference + local save**

| File | Responsibility |
| --- | --- |
| `src/store/projectSource.ts` *(new)* | The `ProjectSource` union, the pure save dispatch (`saveTarget`), the envelope transitions, and the slot-record shape + its sanitiser. One file to review for "the save model". |
| `src/utils/localFileSave.ts` *(new)* | The File System Access API seam, both directions: capability probes, the `showOpenFilePicker` / `showSaveFilePicker` calls, `getFile()` read, `createWritable` write, permission re-request. Owns every read of `globalThis.showOpenFilePicker` / `globalThis.showSaveFilePicker`. |
| `src/store/projectStore.ts` *(modify)* | The single slot now stores a `ProjectSlotRecord`; `load()` widens a bare body. |
| `src/store/projectStoreIdb.ts` *(modify)* | Same slot, records instead of bodies. No DB version bump — the store already exists. |
| `src/store/projectSlice.ts` *(modify)* | `projectSource` state, the record-writing autosave, `saveProject` / `saveProjectAsLocal`, `saveAsBody` / `adoptSaveAs`, and the source carried through load / open / new. |
| `src/components/project/ProjectMenu.tsx` *(modify)* | Save / Save As menu rows and their dispatch. |

**Phase 2 — Google Drive**

| File | Responsibility |
| --- | --- |
| `src/utils/googleScriptLoader.ts` *(new)* | The origin allowlist and the memoized `<script>` injection for GIS and gapi. |
| `src/store/driveAuth.ts` *(new)* | GIS token client wrapper: `token()`, `invalidate()`, `revoke()`, the one-shot 401 retry (`withDriveToken`), and the error → message mapping. |
| `src/store/driveClient.ts` *(new)* | Drive v3 operations over an injected `DriveTransport`: list children, read+parse a project, create, update. |
| `src/store/driveGapi.ts` *(new)* | The gapi adapter: the multipart body builder and the `gapi.client.request` mapping. |
| `src/utils/driveBrowser.ts` *(new)* | Pure list state: row shaping, newest-first sort, page append with de-duplication, date formatting. **No folder or breadcrumb helpers** — see Task 10 for why `drive.file` rules them out. |
| `src/components/project/DriveFileBrowserModal.tsx` *(new)* | The modal. Presentational: every action arrives as a prop. |
| `src/components/project/SaveAsTargetDialog.tsx` *(new)* | The two-button Drive-or-device chooser. |
| `src/store/driveSlice.ts` *(new)* | `driveSignedIn`, connect / disconnect, list, open, save, save-as. |
| `src/store/store.ts` *(modify)* | Constructs the Drive auth + client + slice; `saveProject`'s drive arm goes live. |
| `src/utils/googleOrigins.test.ts` *(new)* | The source scan that keeps Google origins in the three files allowed to name them. |
| `.env.example` *(new)*, `CLAUDE.md` / `docs/design.md` *(modify)* | Task 19: the one deployment variable, and the architecture notes this work makes stale. |

---

# Phase 1 — Source reference + local save

This phase ships on its own: after Task 7 the app has Save, Save As and Export, with local overwrite where the browser supports it, and no Google dependency at all.

## Task 1: The source union, save dispatch and envelope transitions

**Files:**
- Create: `src/store/projectSource.ts`
- Test: `src/store/projectSource.test.ts`

**Interfaces:**
- Consumes: `PROJECT_FORMAT_VERSION`, `makeEnvelope`, `newProjectId`, `ProjectEnvelope`, `ProjectBody` from `./projectFormat`.
- Produces:
  - `type ProjectSource = { kind: 'untitled' } | { kind: 'drive'; fileId: string } | { kind: 'local'; handle: FileSystemFileHandle }`
  - `const UNTITLED_SOURCE: ProjectSource`
  - `type SaveTarget = { kind: 'save-as' } | { kind: 'drive-update'; fileId: string } | { kind: 'local-write'; handle: FileSystemFileHandle }`, `function saveTarget(source: ProjectSource): SaveTarget`
  - `interface DocumentIdentity { id: string; createdAt: number }`, `function newDocumentIdentity(now: number): DocumentIdentity`
  - `function envelopeForSave(previous: DocumentIdentity, name: string, now: number): ProjectEnvelope`
  - `function envelopeForSaveAs(identity: DocumentIdentity, name: string): ProjectEnvelope` — **two arguments, not three**: a new document's `updatedAt` IS its `createdAt`, so a third `now` would be an unused parameter, and `@typescript-eslint/no-unused-vars` (error, `args: after-used`) fails the gate on it.
  - `interface ProjectSlotRecord { body: ProjectBody; source: ProjectSource }`
  - `function sanitizeProjectSource(raw: unknown): ProjectSource`
  - `function sanitizeSlotRecord(raw: unknown): ProjectSlotRecord | null`

- [ ] **Step 1: Write the failing test**

Create `src/store/projectSource.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  UNTITLED_SOURCE,
  envelopeForSave,
  envelopeForSaveAs,
  newDocumentIdentity,
  sanitizeProjectSource,
  sanitizeSlotRecord,
  saveTarget,
  type ProjectSlotRecord,
} from './projectSource';
import { PROJECT_FORMAT_VERSION, factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';

const body = (name: string, now = 1_000): ProjectBody => ({ ...makeEnvelope(name, now), content: factoryProjectContent() });
const alpha = body('Alpha');
const fakeHandle = { name: 'sketch.solna', kind: 'file' } as unknown as FileSystemFileHandle;

describe('saveTarget', () => {
  test('an untitled project has no target, so Save behaves as Save As', () => {
    expect(saveTarget(UNTITLED_SOURCE)).toEqual({ kind: 'save-as' });
  });

  test('a drive source carries the file id it updates', () => {
    expect(saveTarget({ kind: 'drive', fileId: 'abc' })).toEqual({ kind: 'drive-update', fileId: 'abc' });
  });

  test('a local source carries the handle it writes through', () => {
    expect(saveTarget({ kind: 'local', handle: fakeHandle })).toEqual({ kind: 'local-write', handle: fakeHandle });
  });
});

describe('the envelope transitions', () => {
  test('Save keeps the document identity and only moves updatedAt', () => {
    expect(envelopeForSave({ id: 'project-1', createdAt: 500 }, 'Sketch', 900)).toEqual({
      formatVersion: PROJECT_FORMAT_VERSION,
      id: 'project-1',
      name: 'Sketch',
      createdAt: 500,
      updatedAt: 900,
    });
  });

  test('Save As mints a fresh id and sets createdAt = updatedAt = now', () => {
    const identity = newDocumentIdentity(700);
    expect(identity.createdAt).toBe(700);
    expect(identity.id.startsWith('project-')).toBe(true);
    expect(identity.id).not.toBe(newDocumentIdentity(700).id);
    expect(envelopeForSaveAs(identity, 'Copy')).toEqual({
      formatVersion: PROJECT_FORMAT_VERSION,
      id: identity.id,
      name: 'Copy',
      createdAt: 700,
      updatedAt: 700,
    });
  });
});

describe('sanitizeProjectSource', () => {
  test('anything unreadable is untitled rather than a broken source', () => {
    expect(sanitizeProjectSource(undefined)).toEqual({ kind: 'untitled' });
    expect(sanitizeProjectSource('drive')).toEqual({ kind: 'untitled' });
    expect(sanitizeProjectSource({ kind: 'nope' })).toEqual({ kind: 'untitled' });
    expect(sanitizeProjectSource({ kind: 'drive' })).toEqual({ kind: 'untitled' });
    expect(sanitizeProjectSource({ kind: 'drive', fileId: '' })).toEqual({ kind: 'untitled' });
    expect(sanitizeProjectSource({ kind: 'local', handle: null })).toEqual({ kind: 'untitled' });
  });

  test('a drive id and a handle object both survive', () => {
    expect(sanitizeProjectSource({ kind: 'drive', fileId: 'abc' })).toEqual({ kind: 'drive', fileId: 'abc' });
    expect(sanitizeProjectSource({ kind: 'local', handle: fakeHandle })).toEqual({ kind: 'local', handle: fakeHandle });
  });
});

describe('sanitizeSlotRecord', () => {
  test('a slot record round-trips with its source', () => {
    const record: ProjectSlotRecord = { body: alpha, source: { kind: 'drive', fileId: 'abc' } };
    expect(sanitizeSlotRecord(record)).toEqual(record);
  });

  test('a bare body written before sources existed widens to untitled — no version gate', () => {
    const bare = { ...alpha, formatVersion: 1 };
    expect(sanitizeSlotRecord(bare)).toEqual({ body: bare, source: { kind: 'untitled' } });
  });

  test('an unreadable slot is null, never a half-record', () => {
    expect(sanitizeSlotRecord(undefined)).toBeNull();
    expect(sanitizeSlotRecord('nope')).toBeNull();
    expect(sanitizeSlotRecord({ source: { kind: 'untitled' } })).toBeNull();
  });

  test('a record whose body is not a body is null — the guard is the same on both branches', () => {
    // The trap this pins: recognising a record by `typeof raw.body === 'object'`
    // alone accepts `{ body: {} }`, and an envelope-less body reaches
    // normalizeName(undefined) at install time and throws. A bare body has to
    // carry the envelope keys to be recognised, so a wrapped one does too.
    expect(sanitizeSlotRecord({ body: {}, source: { kind: 'untitled' } })).toBeNull();
    expect(sanitizeSlotRecord({ body: { formatVersion: 1 } })).toBeNull();
  });

  test('a record whose source is unreadable keeps its body and falls back to untitled', () => {
    expect(sanitizeSlotRecord({ body: alpha, source: { kind: 'drive' } })).toEqual({
      body: alpha,
      source: { kind: 'untitled' },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectSource.test.ts`
Expected: FAIL — `Cannot find module './projectSource'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/projectSource.ts`:

```ts
import { PROJECT_FORMAT_VERSION, makeEnvelope, newProjectId, type ProjectBody, type ProjectEnvelope } from './projectFormat';

/**
 * Where an explicit Save writes back to. It is held BESIDE the project body and
 * never inside it: a Drive file id is location metadata and a local handle is
 * not serialisable, so neither may reach serializeProject — the same "not
 * project content" judgement PROJECT_CONTENT_KEYS already makes. Because the
 * slot path is IndexedDB (structured clone), a handle sits in the slot happily;
 * it just never passes through JSON.stringify.
 */
export type ProjectSource =
  | { kind: 'untitled' }
  | { kind: 'drive'; fileId: string }
  | { kind: 'local'; handle: FileSystemFileHandle };

export const UNTITLED_SOURCE: ProjectSource = { kind: 'untitled' };

export type SaveTarget =
  | { kind: 'save-as' }
  | { kind: 'drive-update'; fileId: string }
  | { kind: 'local-write'; handle: FileSystemFileHandle };

/**
 * The whole dispatch, as a function of `source` and nothing else — no UI state,
 * no capability flag. `untitled` has no target to overwrite, so Save on an
 * untitled project IS Save As. Capability (can this browser pick a file at all?)
 * is a separate question the caller answers at the point of writing; folding it
 * in here would make this table untestable without a browser.
 *
 * The route carries its payload (the id, the handle) rather than being a bare
 * string, so the caller that switches on it needs no cast to recover what it
 * already narrowed — see `mergeDrumKit` in CLAUDE.md for the scar that rule
 * comes from.
 */
export function saveTarget(source: ProjectSource): SaveTarget {
  switch (source.kind) {
    case 'untitled':
      return { kind: 'save-as' };
    case 'drive':
      return { kind: 'drive-update', fileId: source.fileId };
    case 'local':
      return { kind: 'local-write', handle: source.handle };
  }
}

/** The identity of a document: an id and when it was born. */
export interface DocumentIdentity {
  id: string;
  createdAt: number;
}

/** A NEW document's identity — used by Save As, which must not reuse an id. */
export function newDocumentIdentity(now: number): DocumentIdentity {
  return { id: newProjectId(), createdAt: now };
}

/**
 * Save: the SAME document. The id and createdAt survive and only updatedAt
 * moves — a `.solna` file is a document and its envelope says so.
 */
export function envelopeForSave(previous: DocumentIdentity, name: string, now: number): ProjectEnvelope {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: previous.id,
    name,
    createdAt: previous.createdAt,
    updatedAt: now,
  };
}

/**
 * Save As: a NEW document — fresh id, the chosen name, and both timestamps at
 * the identity's own `createdAt`. There is deliberately NO `now` parameter: the
 * identity already carries the instant it was minted, a second clock read would
 * let the two timestamps disagree by a few milliseconds, and an unused third
 * argument fails `@typescript-eslint/no-unused-vars` — which is an error here.
 */
export function envelopeForSaveAs(identity: DocumentIdentity, name: string): ProjectEnvelope {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: identity.id,
    name,
    createdAt: identity.createdAt,
    updatedAt: identity.createdAt,
  };
}

/** The one slot's value: the project plus where explicit Save writes it back. */
export interface ProjectSlotRecord {
  body: ProjectBody;
  source: ProjectSource;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Out of range, wrong type, missing or not a member of the union gets untitled.
 * A handle cannot be validated structurally beyond "it is an object" — there is
 * no DOM here and no shape to check — so a broken handle degrades to untitled at
 * the first write, which drops the user into Save As rather than failing.
 */
export function sanitizeProjectSource(raw: unknown): ProjectSource {
  if (!isPlainObject(raw)) return UNTITLED_SOURCE;
  if (raw.kind === 'drive' && typeof raw.fileId === 'string' && raw.fileId.length > 0) {
    return { kind: 'drive', fileId: raw.fileId };
  }
  if (raw.kind === 'local' && isPlainObject(raw.handle)) {
    return { kind: 'local', handle: raw.handle as unknown as FileSystemFileHandle };
  }
  return UNTITLED_SOURCE;
}

/**
 * The slot's read guard, and where the shape widened: a record is recognised by
 * a `body` that LOOKS LIKE A BODY, a bare body by the same test applied to the
 * value itself. Both come back as a record — a slot written before sources
 * existed reads as `{ body, source: untitled }`. There is no version gate here
 * and none may be added: PERSIST_VERSION drives no read-time transform (see the
 * "no migration chains" note in CLAUDE.md), and validation on read is what
 * replaces a chain.
 *
 * `looksLikeBody` is applied to BOTH branches on purpose. Recognising a record
 * by `isPlainObject(raw.body)` alone would accept `{ body: {} }`, and an
 * envelope-less body reaches `normalizeName(undefined)` inside install() and
 * throws — a stricter test on one branch than the other is how that hole gets
 * in. The envelope is not re-validated beyond this; `normalizeStoredBody`
 * sanitises the content at the same read site.
 *
 * `null` means "there is no readable project here" — the not-found path — and is
 * deliberately distinct from "a project with no source", which is a valid slot.
 */
function looksLikeBody(value: unknown): boolean {
  return isPlainObject(value) && typeof value.id === 'string' && 'formatVersion' in value && isPlainObject(value.content);
}

export function sanitizeSlotRecord(raw: unknown): ProjectSlotRecord | null {
  if (!isPlainObject(raw)) return null;
  if (looksLikeBody(raw.body)) {
    return { body: raw.body as unknown as ProjectBody, source: sanitizeProjectSource(raw.source) };
  }
  if (looksLikeBody(raw)) {
    return { body: raw as unknown as ProjectBody, source: UNTITLED_SOURCE };
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/projectSource.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/projectSource.ts src/store/projectSource.test.ts
git commit -m "feat(project): add the source union, save dispatch and slot record

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 2: The local file seam (File System Access API)

**Files:**
- Create: `src/utils/localFileSave.ts`
- Test: `src/utils/localFileSave.test.ts`

**Interfaces:**
- Consumes: `PROJECT_FILE_MIME`, `PROJECT_FILE_EXTENSION` from `../store/projectFile`.
- Produces:
  - `interface FilePickerType { description: string; accept: Record<string, string[]> }`
  - `type ShowSaveFilePicker = (options?: { suggestedName?: string; types?: FilePickerType[] }) => Promise<FileSystemFileHandle>`
  - `type ShowOpenFilePicker = (options?: { multiple?: boolean; types?: FilePickerType[] }) => Promise<FileSystemFileHandle[]>`
  - `const SOLNA_SAVE_TYPE: FilePickerType`, `const SOLNA_OPEN_TYPE: FilePickerType`
  - `function resolveSaveFilePicker(scope: unknown): ShowSaveFilePicker | null`
  - `function resolveOpenFilePicker(scope: unknown): ShowOpenFilePicker | null`
  - `type PickHandleResult = { ok: true; handle: FileSystemFileHandle } | { ok: false; reason: 'unavailable' | 'cancelled' }`
  - `function pickLocalSaveHandle(fileName: string, scope?: unknown): Promise<PickHandleResult>`
  - `function pickLocalOpenHandle(scope?: unknown): Promise<PickHandleResult>`
  - `function readTextFromHandle(handle: FileSystemFileHandle): Promise<string>`
  - `function writeTextToHandle(handle: FileSystemFileHandle, text: string): Promise<void>`
  - `function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean>`
  - `function fileNameWithoutExtension(name: string): string`

**Why the OPEN picker is here at all (the change this revision turns on):** the requirement is that Save overwrites the file the project was opened from. An `<input type=file>` hands back a read-only `File` — there is nothing to overwrite — so a project opened that way can only ever Save As, creating a *second* file. `showOpenFilePicker` returns a `FileSystemFileHandle` instead, which is read through `getFile()` for the parse and then **kept as the source**. The `<input>` stays as the fallback for browsers without the API, and on those the untitled-then-Save-As behaviour is the best the platform offers.

**Why a local structural type for the pickers:** neither `showSaveFilePicker` nor `showOpenFilePicker` is in TypeScript's `lib.dom.d.ts` (verified: `grep -c showSaveFilePicker node_modules/typescript/lib/lib.dom.d.ts` → 0), and neither is `FileSystemHandle.queryPermission`. `FileSystemFileHandle`, `getFile` and `createWritable` **are**. So the pickers and the permission probe get local declarations, and the handle type stays the DOM's own.

- [ ] **Step 1: Write the failing test**

Create `src/utils/localFileSave.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  SOLNA_OPEN_TYPE,
  SOLNA_SAVE_TYPE,
  ensureWritePermission,
  fileNameWithoutExtension,
  pickLocalOpenHandle,
  pickLocalSaveHandle,
  readTextFromHandle,
  resolveSaveFilePicker,
  writeTextToHandle,
} from './localFileSave';

const handle = (name = 'sketch.solna') => ({ name }) as unknown as FileSystemFileHandle;

describe('resolveSaveFilePicker', () => {
  test('a scope without the API resolves to null — the capability probe, not an error', () => {
    expect(resolveSaveFilePicker({})).toBeNull();
    expect(resolveSaveFilePicker(null)).toBeNull();
    expect(resolveSaveFilePicker({ showSaveFilePicker: 'nope' })).toBeNull();
  });

  test('the picker is bound to the scope it was found on', async () => {
    const scope = {
      showSaveFilePicker(this: unknown, options?: unknown) {
        return { self: this, options };
      },
    };
    const pick = resolveSaveFilePicker(scope);
    expect(pick).not.toBeNull();
    expect(await pick!({ suggestedName: 'x.solna' })).toEqual({ self: scope, options: { suggestedName: 'x.solna' } });
  });
});

describe('pickLocalSaveHandle', () => {
  test('no API reports unavailable so the caller can fall back to download', async () => {
    expect(await pickLocalSaveHandle('x.solna', {})).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('a dismissed picker is a cancel, not a failure', async () => {
    const scope = {
      showSaveFilePicker: async () => {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        throw err;
      },
    };
    expect(await pickLocalSaveHandle('x.solna', scope)).toEqual({ ok: false, reason: 'cancelled' });
  });

  test('a picker that refuses for any other reason is unavailable, never a crash', async () => {
    const scope = {
      showSaveFilePicker: async () => {
        throw new TypeError('blocked by permissions policy');
      },
    };
    expect(await pickLocalSaveHandle('x.solna', scope)).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('a chosen handle comes back with the solna picker type offered', async () => {
    const chosen = handle();
    let seen: unknown;
    const scope = {
      showSaveFilePicker: async (options: unknown) => {
        seen = options;
        return chosen;
      },
    };
    expect(await pickLocalSaveHandle('sketch.solna', scope)).toEqual({ ok: true, handle: chosen });
    expect(seen).toEqual({ suggestedName: 'sketch.solna', types: [SOLNA_SAVE_TYPE] });
  });
});

describe('pickLocalOpenHandle', () => {
  test('no API reports unavailable so the caller can fall back to the file input', async () => {
    expect(await pickLocalOpenHandle({})).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('a dismissed picker is a cancel: the open simply does not happen', async () => {
    const scope = {
      showOpenFilePicker: async () => {
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        throw err;
      },
    };
    expect(await pickLocalOpenHandle(scope)).toEqual({ ok: false, reason: 'cancelled' });
  });

  test('asks for one solna file and unwraps the array the API returns', async () => {
    const chosen = handle('mix.solna');
    let seen: unknown;
    const scope = {
      showOpenFilePicker: async (options: unknown) => {
        seen = options;
        return [chosen];
      },
    };
    expect(await pickLocalOpenHandle(scope)).toEqual({ ok: true, handle: chosen });
    expect(seen).toEqual({ multiple: false, types: [SOLNA_OPEN_TYPE] });
  });

  test('an empty selection is a cancel, not a crash on [0]', async () => {
    expect(await pickLocalOpenHandle({ showOpenFilePicker: async () => [] })).toEqual({
      ok: false,
      reason: 'cancelled',
    });
  });

  test('the open type also accepts .json — the mobile providers that rewrite the extension', () => {
    expect(SOLNA_OPEN_TYPE.accept['application/json']).toEqual(['.solna', '.json']);
    expect(SOLNA_SAVE_TYPE.accept['application/json']).toEqual(['.solna']);
  });
});

describe('readTextFromHandle', () => {
  test('reads through getFile so the same handle can be written back later', async () => {
    const target = {
      getFile: async () => ({ text: async () => '{"a":1}', size: 7 }),
    } as unknown as FileSystemFileHandle;
    expect(await readTextFromHandle(target)).toBe('{"a":1}');
  });

  test('an unreadable handle yields empty text, which parses as malformed', async () => {
    // Same contract as readFileAsText: the caller reports "not a Solna project"
    // rather than catching a DOMException of its own.
    const target = {
      getFile: async () => {
        throw new DOMException('gone', 'NotFoundError');
      },
    } as unknown as FileSystemFileHandle;
    expect(await readTextFromHandle(target)).toBe('');
  });
});

describe('writeTextToHandle', () => {
  test('writes the text and closes the stream, in that order', async () => {
    const calls: string[] = [];
    const target = {
      createWritable: async () => ({
        write: async (text: string) => {
          calls.push(`write:${text}`);
        },
        close: async () => {
          calls.push('close');
        },
      }),
    } as unknown as FileSystemFileHandle;
    await writeTextToHandle(target, '{"a":1}');
    expect(calls).toEqual(['write:{"a":1}', 'close']);
  });

  test('a refused write rejects so the caller can surface a notice', async () => {
    const target = {
      createWritable: async () => ({
        write: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
        close: async () => {},
      }),
    } as unknown as FileSystemFileHandle;
    // `await`, not a bare expect: an un-awaited `.rejects` assertion is a
    // floating promise that passes whatever the code does.
    await expect(writeTextToHandle(target, 'x')).rejects.toThrow('denied');
  });
});

describe('ensureWritePermission', () => {
  test('a granted handle needs no prompt', async () => {
    let prompts = 0;
    const target = {
      queryPermission: async () => 'granted',
      requestPermission: async () => {
        prompts++;
        return 'granted';
      },
    } as unknown as FileSystemFileHandle;
    expect(await ensureWritePermission(target)).toBe(true);
    expect(prompts).toBe(0);
  });

  test('a prompt-state handle is asked once and its answer is the result', async () => {
    const target = {
      queryPermission: async () => 'prompt',
      requestPermission: async () => 'denied',
    } as unknown as FileSystemFileHandle;
    expect(await ensureWritePermission(target)).toBe(false);
  });

  test('a handle without the permission API writes straight through', async () => {
    expect(await ensureWritePermission(handle())).toBe(true);
  });
});

describe('fileNameWithoutExtension', () => {
  test('drops a .solna suffix and keeps the rest', () => {
    expect(fileNameWithoutExtension('my-sketch.solna')).toBe('my-sketch');
    expect(fileNameWithoutExtension('my.sketch.solna')).toBe('my.sketch');
    expect(fileNameWithoutExtension('sketch')).toBe('sketch');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/localFileSave.test.ts`
Expected: FAIL — `Cannot find module './localFileSave'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/localFileSave.ts`:

```ts
import { PROJECT_FILE_EXTENSION, PROJECT_FILE_MIME } from '../store/projectFile';

/**
 * Neither picker is in lib.dom.d.ts, so both are declared here rather than
 * pulled in from `@types/wicg-file-system-access` — solna adds no dependency
 * for two functions, and a structural declaration is exactly as checkable as
 * the ambient one.
 */
export interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

export type ShowSaveFilePicker = (options?: {
  suggestedName?: string;
  types?: FilePickerType[];
}) => Promise<FileSystemFileHandle>;

export type ShowOpenFilePicker = (options?: {
  multiple?: boolean;
  types?: FilePickerType[];
}) => Promise<FileSystemFileHandle[]>;

/** Saving offers one extension; the file solna writes is always `.solna`. */
export const SOLNA_SAVE_TYPE: FilePickerType = {
  description: 'Solna project',
  accept: { [PROJECT_FILE_MIME]: [PROJECT_FILE_EXTENSION] },
};

/**
 * Opening accepts `.json` too, for the same reason PROJECT_FILE_ACCEPT does:
 * some mobile file providers rewrite an extension they do not recognise, and a
 * user who cannot select their own project file has no way forward.
 */
export const SOLNA_OPEN_TYPE: FilePickerType = {
  description: 'Solna project',
  accept: { [PROJECT_FILE_MIME]: [PROJECT_FILE_EXTENSION, '.json'] },
};

/** The capability probe: null means "this browser cannot pick a save target". */
export function resolveSaveFilePicker(scope: unknown): ShowSaveFilePicker | null {
  if (typeof scope !== 'object' || scope === null) return null;
  const candidate = (scope as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  if (typeof candidate !== 'function') return null;
  return (candidate as ShowSaveFilePicker).bind(scope);
}

/** The same probe for the open direction: null means "fall back to the input". */
export function resolveOpenFilePicker(scope: unknown): ShowOpenFilePicker | null {
  if (typeof scope !== 'object' || scope === null) return null;
  const candidate = (scope as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  if (typeof candidate !== 'function') return null;
  return (candidate as ShowOpenFilePicker).bind(scope);
}

export type PickHandleResult =
  | { ok: true; handle: FileSystemFileHandle }
  | { ok: false; reason: 'unavailable' | 'cancelled' };

/**
 * Two failures, two meanings, and the caller must not treat them alike:
 * `unavailable` is the File System Access API being absent or refused (Safari,
 * Firefox, a permissions-policy iframe), which degrades Save to a download and
 * Open to the `<input>`; `cancelled` is the user dismissing the dialog, which
 * does nothing at all. Both are normal outcomes, not errors.
 */
export async function pickLocalSaveHandle(
  fileName: string,
  scope: unknown = globalThis,
): Promise<PickHandleResult> {
  const pick = resolveSaveFilePicker(scope);
  if (!pick) return { ok: false, reason: 'unavailable' };
  try {
    return { ok: true, handle: await pick({ suggestedName: fileName, types: [SOLNA_SAVE_TYPE] }) };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    return { ok: false, reason: name === 'AbortError' ? 'cancelled' : 'unavailable' };
  }
}

/**
 * The handle a local Open keeps. `multiple: false` because one project is open
 * at a time; the API still answers with an ARRAY, and an empty one is treated
 * as a cancel rather than indexed into — a spec-compliant engine will not
 * return `[]`, but a crash on `[0].name` is not the failure mode to pick if one
 * does.
 */
export async function pickLocalOpenHandle(scope: unknown = globalThis): Promise<PickHandleResult> {
  const pick = resolveOpenFilePicker(scope);
  if (!pick) return { ok: false, reason: 'unavailable' };
  try {
    const handles = await pick({ multiple: false, types: [SOLNA_OPEN_TYPE] });
    const handle = handles[0];
    return handle ? { ok: true, handle } : { ok: false, reason: 'cancelled' };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    return { ok: false, reason: name === 'AbortError' ? 'cancelled' : 'unavailable' };
  }
}

/**
 * Read for the parse, through the same handle that will later be written back.
 * Empty text on failure, matching `readFileAsText`: the caller runs it through
 * `parseProjectFile`, which reports "not a Solna project" — one failure surface
 * for every unreadable open, rather than a DOMException at one call site.
 */
export async function readTextFromHandle(handle: FileSystemFileHandle): Promise<string> {
  try {
    return await (await handle.getFile()).text();
  } catch {
    return '';
  }
}

/**
 * Write whole-file. A throw here is a real failure and the caller reports it.
 * The stream is deliberately NOT closed on the failure path: `createWritable`
 * writes to a swap file and only commits on `close()`, so abandoning it leaves
 * the user's existing file exactly as it was — which is the outcome to want.
 */
export async function writeTextToHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

/**
 * Chrome drops write permission across a restart, so a stored handle can be
 * present and unwritable. `queryPermission` / `requestPermission` are not in
 * lib.dom.d.ts either, hence the structural read; a handle that has neither is
 * treated as writable, which is the behaviour of every engine that ships
 * `createWritable` without the permission API.
 */
export async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const probe = handle as unknown as {
    queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  if (typeof probe.queryPermission !== 'function') return true;
  if ((await probe.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (typeof probe.requestPermission !== 'function') return false;
  return (await probe.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** The project name a Save As adopts: the chosen file's name without `.solna`. */
export function fileNameWithoutExtension(name: string): string {
  return name.endsWith(PROJECT_FILE_EXTENSION)
    ? name.slice(0, -PROJECT_FILE_EXTENSION.length)
    : name;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/utils/localFileSave.test.ts`
Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/localFileSave.ts src/utils/localFileSave.test.ts
git commit -m "feat(project): add the File System Access open and save seam

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 3: The slot record through the store and the IndexedDB backend

**Files:**
- Modify: `src/store/projectStore.ts`
- Modify: `src/store/projectStoreIdb.ts`
- Test: `src/store/projectStore.test.ts`

**Interfaces:**
- Consumes: `ProjectSlotRecord`, `sanitizeSlotRecord`, `ProjectSource`, `UNTITLED_SOURCE` from `./projectSource`; `normalizeStoredBody` from `./projectFile`.
- Produces:
  - `interface ProjectStoreBackend { getRecord(): Promise<unknown>; putRecord(record: ProjectSlotRecord): Promise<void>; remove(): Promise<void> }`
  - `interface ProjectStore { status(): ProjectStoreStatus; load(): Promise<ProjectStoreResult<ProjectSlotRecord>>; save(record: ProjectSlotRecord): Promise<ProjectStoreResult<ProjectSlotRecord>>; clear(): Promise<ProjectStoreResult<null>> }`
  - `function createMemoryBackend(seed?: ProjectBody | ProjectSlotRecord)` — the seed accepts the old bare-body shape deliberately, because a test seeding one is pinning the read-widening rule.

**Deliberately unchanged:** `PROJECT_DB_VERSION` stays 2. The object store already exists; only the value written into it changes, so no `onupgradeneeded` work is needed and bumping the version would be a drop of the user's slot for no reason. `createProjectStore`'s once-lazy `open()`, the `isQuotaError` mapping and all four message constants are untouched. `normalizeStoredBody` still runs at the one read site (`load`), now over `record.body`.

- [ ] **Step 1: Write the failing test**

In `src/store/projectStore.test.ts`, apply these mechanical edits (the body/record vocabulary change):

| Find | Replace |
| --- | --- |
| `import { createMemoryBackend, createProjectStore, PROJECT_SLOT_KEY, QUOTA_MESSAGE } from './projectStore';` | `import { createMemoryBackend, createProjectStore, PROJECT_SLOT_KEY, QUOTA_MESSAGE } from './projectStore';`<br>`import { UNTITLED_SOURCE, type ProjectSlotRecord } from './projectSource';` |
| `const body = (name: string, now = 1000): ProjectBody => ...` | unchanged, and add below it:<br>`const record = (name: string, source: ProjectSource = UNTITLED_SOURCE, now = 1000): ProjectSlotRecord => ({ body: body(name, now), source });` |
| `await store.save(b)` (the round-trip test) | `await store.save({ body: b, source: UNTITLED_SOURCE })` |
| `loaded.ok && loaded.value.content.bpm` | `loaded.ok && loaded.value.body.content.bpm` |
| `loaded.ok && loaded.value.id` | `loaded.ok && loaded.value.body.id` |
| `await store.save(body('First'))` / `body('Second')` / `body('Doomed')` / `body('X')` / `body('Y')` / `body('Big')` | `record('First')` / `record('Second')` / `record('Doomed')` / `record('X')` / `record('Y')` / `record('Big')` |
| `loaded.ok && loaded.value.name).toBe('Second')` | `loaded.ok && loaded.value.body.name).toBe('Second')` |
| `backend.put = async () => {` | `backend.putRecord = async () => {` |
| `backend.getBody = async () => {` | `backend.getRecord = async () => {` |
| the two `hit.value.…` / `load normalises` assertions (`createProjectStore(async () => createMemoryBackend(b))` and `hit.value.formatVersion`, `hit.value.content.loops[0]`) | `hit.value.body.formatVersion`, `hit.value.body.content.loops[0]`, and the seeded `b` stays a bare `ProjectBody` — that describe block is now ALSO the widening test, so leave its seed as a bare body on purpose |

Then add this new describe block at the end of the file:

```ts
/**
 * The slot VALUE widened from a bare ProjectBody to { body, source }. There is
 * no version gate for it (see the "no migration chains" note in CLAUDE.md) —
 * `sanitizeSlotRecord` recognises both shapes on every read, whatever wrote it.
 */
describe('the slot record', () => {
  test('round-trips a drive source and a local handle beside the body', async () => {
    const backend = createMemoryBackend();
    const store = createProjectStore(async () => backend);
    const handle = { name: 'sketch.solna', kind: 'file' } as unknown as FileSystemFileHandle;

    await store.save(record('Alpha', { kind: 'drive', fileId: 'drive-1' }));
    const withDrive = await store.load();
    expect(withDrive.ok && withDrive.value.source).toEqual({ kind: 'drive', fileId: 'drive-1' });

    await store.save(record('Alpha', { kind: 'local', handle }));
    const withHandle = await store.load();
    expect(withHandle.ok && withHandle.value.source).toEqual({ kind: 'local', handle });
  });

  test('a bare body written before sources existed loads as untitled', async () => {
    const legacy = body('Legacy');
    const store = createProjectStore(async () => createMemoryBackend(legacy));
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual({ kind: 'untitled' });
    expect(loaded.ok && loaded.value.body.name).toBe('Legacy');
  });

  test('a record whose source is unreadable keeps the body and falls back to untitled', async () => {
    const backend = createMemoryBackend();
    backend.slot.set(PROJECT_SLOT_KEY, { body: body('Alpha'), source: { kind: 'drive' } });
    const store = createProjectStore(async () => backend);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual({ kind: 'untitled' });
    expect(loaded.ok && loaded.value.body.name).toBe('Alpha');
  });

  test('a slot value that is not a body at all is not-found — the empty-slot state', async () => {
    const backend = createMemoryBackend();
    backend.slot.set(PROJECT_SLOT_KEY, 'garbage');
    const store = createProjectStore(async () => backend);
    const loaded = await store.load();
    expect(loaded.ok).toBe(false);
    if (loaded.ok === false) expect(loaded.error).toBe('not-found');
  });

  test('save hands back the record it wrote, source included', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    const written = record('Alpha', { kind: 'drive', fileId: 'drive-9' });
    const saved = await store.save(written);
    expect(saved.ok && saved.value).toEqual(written);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectStore.test.ts`
Expected: FAIL — `Property 'putRecord' does not exist` / `expected { body: … } to equal { … }` — `load()` still returns a bare body.

- [ ] **Step 3: Write the implementation**

In `src/store/projectStore.ts`, replace the imports, the two interfaces, `load`/`save` and `createMemoryBackend`:

```ts
import { normalizeStoredBody } from './projectFile';
import { sanitizeSlotRecord, type ProjectSlotRecord } from './projectSource';
import type { ProjectBody } from './projectFormat';
```

```ts
export interface ProjectStoreBackend {
  getRecord(): Promise<unknown>;
  putRecord(record: ProjectSlotRecord): Promise<void>;
  remove(): Promise<void>;
}
```

```ts
export interface ProjectStore {
  status(): ProjectStoreStatus;
  load(): Promise<ProjectStoreResult<ProjectSlotRecord>>;
  save(record: ProjectSlotRecord): Promise<ProjectStoreResult<ProjectSlotRecord>>;
  clear(): Promise<ProjectStoreResult<null>>;
}
```

Inside `createProjectStore`'s returned object:

```ts
    load: () =>
      run(async (b) => {
        // The slot VALUE widened from a body to a record; the shape test lives
        // in sanitizeSlotRecord, so this is where a pre-source slot widens and
        // there is no version gate anywhere for it.
        const record = sanitizeSlotRecord(await b.getRecord());
        if (!record) return { ok: false as const, error: 'not-found' as const, message: NOT_FOUND_MESSAGE };
        // Every body LEAVES storage through here, so the format pass runs at
        // the one read site rather than at each caller.
        return {
          ok: true as const,
          value: { body: normalizeStoredBody(record.body), source: record.source },
        };
      }),
    save: (record) =>
      run(async (b) => {
        await b.putRecord(record);
        return { ok: true as const, value: record };
      }),
```

And the memory backend:

```ts
/**
 * Test double and the shape the IndexedDB backend must match. The seed accepts
 * a bare `ProjectBody` on purpose: that is the shape a slot written before
 * sources existed carries, and seeding one is how the widening rule is pinned.
 */
export function createMemoryBackend(seed?: ProjectBody | ProjectSlotRecord) {
  const slot = new Map<string, unknown>();
  if (seed) slot.set(PROJECT_SLOT_KEY, structuredClone(seed));
  const backend: ProjectStoreBackend & { slot: typeof slot } = {
    slot,
    getRecord: async () => slot.get(PROJECT_SLOT_KEY),
    putRecord: async (record) => {
      slot.set(PROJECT_SLOT_KEY, structuredClone(record));
    },
    remove: async () => {
      slot.delete(PROJECT_SLOT_KEY);
    },
  };
  return backend;
}
```

In `src/store/projectStoreIdb.ts`, replace the two value-carrying methods (inside the `.then((db): ProjectStoreBackend => ({ … }))` object):

```ts
    // A keyPath-less store takes an explicit key on every put; one fixed key
    // means put() overwrites the slot and the store never grows past one row.
    // The value is the whole record — a FileSystemFileHandle is
    // structured-cloneable, so it rides here and never through JSON.stringify.
    getRecord: async () => {
      const tx = db.transaction(SLOT, 'readonly');
      return requestToPromise(tx.objectStore(SLOT).get(PROJECT_SLOT_KEY) as IDBRequest<unknown>);
    },
    putRecord: async (record) => {
      const tx = db.transaction(SLOT, 'readwrite');
      tx.objectStore(SLOT).put(record, PROJECT_SLOT_KEY);
      await transactionDone(tx);
    },
```

Update the file's import line to `import type { ProjectSlotRecord } from './projectSource';` in place of the `ProjectBody` type import (keep `PROJECT_SLOT_KEY` and `ProjectStoreBackend`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/projectStore.test.ts`
Expected: PASS — 13 tests, including the 5 new ones.

Then confirm nothing else calls the old methods:

Run: `grep -rn "getBody\|putRecord\|\.put(" src --include='*.ts' --include='*.tsx' | grep -v node_modules`
Expected: only `projectStore.ts` / `projectStoreIdb.ts`. Any other hit is a missed rename — fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add src/store/projectStore.ts src/store/projectStoreIdb.ts src/store/projectStore.test.ts
git commit -m "feat(project): store the source beside the body in the one slot

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 4: The source in the slice — boot, open and new carry it

**Files:**
- Modify: `src/store/projectSlice.ts`
- Test: `src/store/projectSlice.test.ts`

**Interfaces:**
- Consumes: `ProjectSlotRecord`, `ProjectSource`, `UNTITLED_SOURCE`, `DocumentIdentity`, `envelopeForSave` from `./projectSource`.
- Produces:
  - `ProjectSlice.projectSource: ProjectSource`
  - `ProjectSlice.loadProject(): Promise<void>` — unchanged signature, now installs the record's source
  - `ProjectSlice.save(): Promise<ProjectStoreResult<ProjectSlotRecord>>` — the autosave write, now writing the whole record
  - `ProjectSlice.openProjectFile(body: ProjectBody, source?: ProjectSource): Promise<ProjectStoreResult<ProjectSlotRecord>>`
  - `createProjectSlice(set, get, projectStore, now?)` — signature unchanged

**Consumes from Task 3:** `projectStore.load()` resolves to `ProjectSlotRecord`, and its `save()` takes one.

**Note on `SlotIdentity`:** the private `SlotIdentity` interface in `projectSlice.ts` is deleted; `slot` is typed `DocumentIdentity` from `projectSource.ts`. They were always the same two fields, and `envelopeForSave` takes the latter.

- [ ] **Step 1: Write the failing test**

In `src/store/projectSlice.test.ts`, first update the harness (two edits):

```ts
// was: import { createMemoryBackend, createProjectStore } from './projectStore';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { UNTITLED_SOURCE, type ProjectSlotRecord } from './projectSource';
```

```ts
/** A fresh slice bound to the live store but to ITS OWN memory backend. */
async function sliceWithBackend(seed?: ProjectBody | ProjectSlotRecord) {
```
(the body of `sliceWithBackend` is unchanged — `createMemoryBackend` takes both shapes.)

Then add this describe block at the end of the file:

```ts
describe('the project source', () => {
  test('a stored record restores its source, so Save still knows where it writes', async () => {
    const record: ProjectSlotRecord = { body: stored('Resume', 110), source: { kind: 'drive', fileId: 'drive-1' } };
    const { useAppStore, slice } = await sliceWithBackend(record);
    await slice.loadProject();
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-1' });
  });

  test('an empty slot leaves the source untitled', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    await slice.loadProject();
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('a local handle survives the slot round-trip and comes back as the source', async () => {
    const handle = { name: 'sketch.solna', kind: 'file' } as unknown as FileSystemFileHandle;
    const record: ProjectSlotRecord = { body: stored('Resume', 110), source: { kind: 'local', handle } };
    const { useAppStore, slice } = await sliceWithBackend(record);
    await slice.loadProject();
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'local', handle });
  });

  test('openProjectFile adopts the source it was opened from', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    await slice.openProjectFile(stored('FromDrive', 100), { kind: 'drive', fileId: 'drive-9' });
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-9' });
  });

  test('a file picker open is untitled — a File is read-only, so Save must ask where to write', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    await slice.openProjectFile(stored('Picked', 100));
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('newProject drops the source: a new project belongs to no file', async () => {
    const record: ProjectSlotRecord = { body: stored('Old', 100), source: { kind: 'drive', fileId: 'drive-1' } };
    const { useAppStore, slice } = await sliceWithBackend(record);
    await slice.loadProject();
    slice.newProject();
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('the autosave writes the current source into the record and never changes it', async () => {
    const { useAppStore, store, slice } = await sliceWithBackend();
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-1' } });
    const result = await slice.save();
    expect(result.ok).toBe(true);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual({ kind: 'drive', fileId: 'drive-1' });
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-1' });
  });

  test('the source is nowhere in the exported body — it does not travel in the file', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-1' } });
    const serialised = JSON.stringify(slice.exportProjectFile());
    expect(serialised).not.toContain('drive-1');
    expect(serialised).not.toContain('source');
  });
});
```

Three existing tests also change, because `load()` now returns a record and `openProjectFile` types a record:

| Test | Edit |
| --- | --- |
| `writes the live content under the current envelope and publishes status` (in `save (autosave write)`) | any `result.value.name` becomes `result.value.body.name`, and the stored-slot read becomes `(await store.load()).value.body` |
| `adopts the file's envelope, installs its content and becomes the autosaved project` (in `openProjectFile`) | `result.value.name` → `result.value.body.name` |
| any assertion reaching `backend.slot.get(PROJECT_SLOT_KEY)` | the value is now a record: read `.body` off it, or assert through `store.load()` |

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectSlice.test.ts`
Expected: FAIL — `projectSource` is `undefined` on the store, and `loadProject` leaves it unset.

- [ ] **Step 3: Write the implementation**

In `src/store/projectSlice.ts`:

1. Replace the `SlotIdentity` interface (and its docblock) with the imported type, and add the imports:

```ts
import {
  UNTITLED_SOURCE,
  envelopeForSave,
  newDocumentIdentity,
  type DocumentIdentity,
  type ProjectSlotRecord,
  type ProjectSource,
} from './projectSource';
```

Delete:

```ts
interface SlotIdentity {
  id: string;
  createdAt: number;
}
```

2. Add `projectSource` to `ProjectSlice` (with its docblock) and change the two signatures:

```ts
  /**
   * Where explicit Save writes back to. Session-plus-slot state, NOT a persist
   * key: it lives in the IndexedDB slot record beside the body (see
   * projectSource.ts) and must never join partializeAppState.
   */
  projectSource: ProjectSource;
```

```ts
  save: () => Promise<ProjectStoreResult<ProjectSlotRecord>>;
  openProjectFile: (body: ProjectBody, source?: ProjectSource) => Promise<ProjectStoreResult<ProjectSlotRecord>>;
```

3. Change the closure variable's type and `install`'s signature:

```ts
  let slot: DocumentIdentity = newDocumentIdentity(now());
```

```ts
  const install = (
    content: ProjectContent,
    identity: ProjectEnvelope,
    activeLoopId: string | null = null,
    source: ProjectSource = UNTITLED_SOURCE,
  ): void => {
```

and inside the single `set()` of `install`, next to `projectName`:

```ts
      // The source is part of what an install replaces: opening a file that
      // came from Drive must not leave the previous project's handle behind, or
      // the first Save would overwrite a file the user never opened.
      projectSource: source,
```

4. Add the initial state value where `projectName: null` sits:

```ts
    projectName: null,
    projectSource: UNTITLED_SOURCE,
```

5. Rewrite `loadProject`'s two branches:

```ts
    loadProject: async () => {
      const result = await projectStore.load();
      publishStatus();
      if (result.ok === false) {
        if (result.error === 'not-found') {
          // Empty slot: a normal first run. Keep the factory content the
          // slices already booted with — no install, so nothing is announced
          // and the engine is not touched. The first autosave writes the slot.
          slot = newDocumentIdentity(now());
          set({ projectSource: UNTITLED_SOURCE });
        } else {
          set({ projectNotice: result.message });
        }
        reconcileActiveLoop();
        return;
      }
      const { body, source } = result.value;
      install(body.content, body, get().activeLoopId, source);
      const warnings = unknownLibraryReferences(body.content);
      set({
        projectNotice:
          warnings.length > 0 ? `Opened with unrecognised references: ${warnings.join(', ')}` : null,
      });
    },
```

6. Rewrite `save` to write the record:

```ts
    save: async () => {
      // The record, not the body: the slot carries the source so a reload
      // resumes a project that still knows which file it belongs to. Autosave
      // READS the source and never changes it — only Open, Save As, New and a
      // Drive sign-out re-point it.
      const record: ProjectSlotRecord = { body: get().exportProjectFile(), source: get().projectSource };
      const result = await projectStore.save(record);
      publishStatus();
      if (result.ok === false) set({ projectNotice: result.message });
      return result;
    },
```

7. `newProject` passes no source (the default `UNTITLED_SOURCE` is the point) and `openProjectFile` takes one:

```ts
    openProjectFile: async (body, source = UNTITLED_SOURCE) => {
      install(body.content, body, null, source);
```

(`newProject` needs no edit: `install(factoryProjectContent(), makeEnvelope('', now()))` already lands on the `UNTITLED_SOURCE` default. Confirm the test above passes rather than adding a redundant argument.)

8. `exportProjectFile` switches from building an envelope inline to `envelopeForSave`:

```ts
    exportProjectFile: (): ProjectBody => ({
      ...envelopeForSave(slot, get().projectName ?? '', now()),
      content: buildProjectContent(get()),
    }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/projectSlice.test.ts src/store/projectBoot.test.ts`
Expected: PASS for both files. `projectBoot.test.ts` seeds `createMemoryBackend(seed)` with a bare body — that path is the widening rule and must keep working; if it fails, the bug is in Task 3, not here.

- [ ] **Step 5: Commit**

```bash
git add src/store/projectSlice.ts src/store/projectSlice.test.ts
git commit -m "feat(project): carry the source through boot, open and new

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 5: `saveProject` and Save As to a local file

**Files:**
- Modify: `src/store/projectSlice.ts`
- Test: `src/store/projectSave.test.ts` (new)

**Interfaces:**
- Consumes: `saveTarget`, `envelopeForSaveAs`, `newDocumentIdentity`, `ProjectSlotRecord`, `ProjectSource`, `UNTITLED_SOURCE` from `./projectSource`; `pickLocalSaveHandle`, `writeTextToHandle`, `ensureWritePermission`, `fileNameWithoutExtension` from `../utils/localFileSave`; `projectFileName` from `../utils/projectFileIO`; `serializeProject` from `./projectFile`.
- Produces:
  - `type ProjectSaveDestination = 'local' | 'drive' | 'download' | 'cancelled'`
  - `type ProjectSaveResult = { ok: true; destination: ProjectSaveDestination } | { ok: false; message: string }`
  - `const SAVE_FAILED_MESSAGE`, `const SAVE_HANDLE_DENIED_MESSAGE`, `const DRIVE_NOT_CONNECTED_MESSAGE`
  - `ProjectSlice.saveProject(): Promise<ProjectSaveResult>` — the dispatch
  - `ProjectSlice.saveProjectAsLocal(): Promise<ProjectSaveResult>`
  - `ProjectSlice.saveAsBody(name: string): { body: ProjectBody; identity: DocumentIdentity }`
  - `ProjectSlice.adoptSaveAs(identity: DocumentIdentity, name: string, source: ProjectSource): Promise<void>`

**The two-phase Save As, and why it is two functions:** the body must be built before the write (it is what gets written) and the identity adopted *after* it (so a failed write cannot leave the live document wearing a new id while the old file still holds the old one). Task 15's Drive Save As calls the same pair.

- [ ] **Step 1: Write the failing test**

Create `src/store/projectSave.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { DRIVE_NOT_CONNECTED_MESSAGE, SAVE_FAILED_MESSAGE, SAVE_HANDLE_DENIED_MESSAGE } from './projectSlice';
import { UNTITLED_SOURCE } from './projectSource';
import type { AppStore } from './types';

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new FakeLocalStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
});

/**
 * A REAL FileSystemFileHandle keeps its methods on the prototype, so the fake
 * does too. That is not a detail: structuredClone — which the memory backend and
 * IndexedDB both go through — copies own properties only and THROWS on a
 * function, so an object literal carrying `createWritable` would not survive the
 * slot write that every save performs.
 */
function fakeHandle(name: string, sink: string[] = []): FileSystemFileHandle {
  const proto = {
    createWritable: async () => ({
      write: async (text: string) => {
        sink.push(text);
      },
      close: async () => {},
    }),
  };
  return Object.assign(Object.create(proto), { name }) as unknown as FileSystemFileHandle;
}

function unpickablePicker(): FileSystemFileHandle {
  const proto = {
    createWritable: async () => {
      throw new DOMException('denied', 'NotAllowedError');
    },
  };
  return Object.assign(Object.create(proto), { name: 'doomed.solna' }) as unknown as FileSystemFileHandle;
}

function deniedHandle(): FileSystemFileHandle {
  const proto = {
    queryPermission: async () => 'prompt' as PermissionState,
    requestPermission: async () => 'denied' as PermissionState,
  };
  return Object.assign(Object.create(proto), { name: 'locked.solna' }) as unknown as FileSystemFileHandle;
}

function setPicker(value: unknown): void {
  Object.defineProperty(globalThis, 'showSaveFilePicker', { value, configurable: true, writable: true });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'showSaveFilePicker');
});

let clock = 5_000;
let instance = 0;

/** The REAL store module, one instance per test — see projectBoot.test.ts for why. */
async function freshSlice() {
  const mod = await import(`./store?save=${instance++}`);
  const { createProjectSlice } = await import('./projectSlice');
  const backend = createMemoryBackend();
  const projectStore = createProjectStore(async () => backend);
  const slice = createProjectSlice(mod.useAppStore.setState, mod.useAppStore.getState, projectStore, () => clock);
  mod.useAppStore.setState({ ...slice, projectName: null });
  return { useAppStore: mod.useAppStore, store: projectStore, slice: mod.useAppStore.getState() as AppStore };
}

describe('saveProject dispatch', () => {
  test('an untitled project routes to Save As, which picks a target', async () => {
    const { useAppStore, slice } = await freshSlice();
    const sink: string[] = [];
    setPicker(async () => fakeHandle('chosen.solna', sink));
    expect(await slice.saveProject()).toEqual({ ok: true, destination: 'local' });
    expect(useAppStore.getState().projectSource.kind).toBe('local');
    expect(sink).toHaveLength(1);
  });

  test('a local source overwrites through its handle and never consults the picker', async () => {
    const { useAppStore, slice } = await freshSlice();
    const sink: string[] = [];
    setPicker(async () => {
      throw new Error('the picker must not be consulted for a project with a target');
    });
    useAppStore.setState({ projectSource: { kind: 'local', handle: fakeHandle('sketch.solna', sink) } });
    expect(await slice.saveProject()).toEqual({ ok: true, destination: 'local' });
    expect(sink).toHaveLength(1);
  });

  test('a drive source reports Drive as unconnected until Phase 2 wires it', async () => {
    const { useAppStore, slice } = await freshSlice();
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-1' } });
    expect(await slice.saveProject()).toEqual({ ok: false, message: DRIVE_NOT_CONNECTED_MESSAGE });
  });

  test('Save on a local source keeps the id and createdAt and only moves updatedAt', async () => {
    const { useAppStore, slice } = await freshSlice();
    const sink: string[] = [];
    useAppStore.setState({ projectSource: { kind: 'local', handle: fakeHandle('sketch.solna', sink) } });
    const before = slice.exportProjectFile();
    clock = 9_000;
    await slice.saveProject();
    const written = JSON.parse(sink[0]) as { id: string; createdAt: number; updatedAt: number };
    expect(written.id).toBe(before.id);
    expect(written.createdAt).toBe(before.createdAt);
    expect(written.updatedAt).toBe(9_000);
  });

  test('a handle whose write permission was revoked asks once, then reports the denial', async () => {
    const { useAppStore, slice } = await freshSlice();
    useAppStore.setState({ projectSource: { kind: 'local', handle: deniedHandle() } });
    expect(await slice.saveProject()).toEqual({ ok: false, message: SAVE_HANDLE_DENIED_MESSAGE });
  });
});

describe('Save As (local)', () => {
  test('writes through the picked handle, adopts its name and re-points the source', async () => {
    const { useAppStore, slice } = await freshSlice();
    const sink: string[] = [];
    const handle = fakeHandle('mix.solna', sink);
    setPicker(async () => handle);
    useAppStore.setState({ projectName: 'Sketch' });

    expect(await slice.saveProjectAsLocal()).toEqual({ ok: true, destination: 'local' });

    const after = useAppStore.getState();
    expect(after.projectName).toBe('mix');
    expect(after.projectSource).toEqual({ kind: 'local', handle });
    expect((JSON.parse(sink[0]) as { name: string }).name).toBe('mix');
  });

  test('a new document gets a fresh id and createdAt = updatedAt = now', async () => {
    const { useAppStore, slice } = await freshSlice();
    const sink: string[] = [];
    setPicker(async () => fakeHandle('mix.solna', sink));
    const before = slice.exportProjectFile();
    clock = 7_000;
    await slice.saveProjectAsLocal();
    const written = JSON.parse(sink[0]) as { id: string; createdAt: number; updatedAt: number };
    expect(written.id).not.toBe(before.id);
    expect(written.createdAt).toBe(7_000);
    expect(written.updatedAt).toBe(7_000);
  });

  test('a dismissed picker does nothing at all — no write, no notice, no re-point', async () => {
    const { useAppStore, slice } = await freshSlice();
    setPicker(async () => {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      throw err;
    });
    expect(await slice.saveProjectAsLocal()).toEqual({ ok: true, destination: 'cancelled' });
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('a browser without the API degrades to a download and stays untitled', async () => {
    const { useAppStore, slice } = await freshSlice();
    // No picker is installed, so the probe finds nothing: the capability case,
    // not an error. The store cannot touch `document`, so the CALLER writes the
    // copy — `download` is the instruction, not a failure.
    expect(await slice.saveProjectAsLocal()).toEqual({ ok: true, destination: 'download' });
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('a write that fails leaves the old identity and the old source in place', async () => {
    const { useAppStore, slice } = await freshSlice();
    setPicker(async () => unpickablePicker());
    const before = slice.exportProjectFile();
    expect(await slice.saveProjectAsLocal()).toEqual({ ok: false, message: SAVE_FAILED_MESSAGE });
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
    expect(useAppStore.getState().projectName).toBeNull();
    // The live document did NOT become a new one — the id must not have been
    // adopted before the write succeeded, or the next Save would tell the old
    // file's readers that it is a different document.
    expect(slice.exportProjectFile().id).toBe(before.id);
  });

  test('a denied permission on the picked handle reports the denial and adopts nothing', async () => {
    const { useAppStore, slice } = await freshSlice();
    setPicker(async () => deniedHandle());
    expect(await slice.saveProjectAsLocal()).toEqual({ ok: false, message: SAVE_HANDLE_DENIED_MESSAGE });
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('an adopted Save As is written into the slot, so a reload resumes the same file', async () => {
    const { useAppStore, store, slice } = await freshSlice();
    setPicker(async () => fakeHandle('mix.solna'));
    await slice.saveProjectAsLocal();
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual(useAppStore.getState().projectSource);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectSave.test.ts`
Expected: FAIL — `export 'SAVE_FAILED_MESSAGE' not found` / `slice.saveProject is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/store/projectSlice.ts`, extend the `projectSource` import with `envelopeForSaveAs` and `saveTarget`, and add:

```ts
import { ensureWritePermission, fileNameWithoutExtension, pickLocalSaveHandle, writeTextToHandle } from '../utils/localFileSave';
import { projectFileName } from '../utils/projectFileIO';
import { serializeProject } from './projectFile';
```

```ts
export type ProjectSaveDestination = 'local' | 'drive' | 'download' | 'cancelled';

/**
 * `download` is an INSTRUCTION, not a failure: the browser has no
 * showSaveFilePicker (Safari, Firefox, a permissions-policy iframe), so the
 * caller must write a copy with downloadTextFile. The store cannot do it —
 * src/store/ does not touch `document`, and a `.solna` copy is exactly what
 * `exportProjectFile` already hands the component layer.
 *
 * `cancelled` is likewise a success with no effect: the user dismissed the
 * picker, so nothing was written and the source did not move.
 */
export type ProjectSaveResult =
  | { ok: true; destination: ProjectSaveDestination }
  | { ok: false; message: string };

export const SAVE_FAILED_MESSAGE = 'Could not write the project file. Your work is still autosaved on this device.';
export const SAVE_HANDLE_DENIED_MESSAGE = 'Write permission for that file was denied. Use Save As to pick another one.';
/**
 * Phase 2 reuses this exact message for its real not-connected case (see the
 * design's "Save As with no Drive connection" row); in Phase 1 a `drive` source
 * cannot exist yet, so this arm is unreachable-but-typed rather than absent.
 */
export const DRIVE_NOT_CONNECTED_MESSAGE = 'Connect Google Drive to save to Drive.';
```

Add the four members to `ProjectSlice`:

```ts
  /** Explicit Save. A pure function of the source — see saveTarget(). */
  saveProject: () => Promise<ProjectSaveResult>;
  /** Save As to this device: pick a target, write it, then re-point. */
  saveProjectAsLocal: () => Promise<ProjectSaveResult>;
  /**
   * The body a Save As writes — built BEFORE the write, adopted after it. Split
   * deliberately: a failed write must leave the live document's identity alone.
   */
  saveAsBody: (name: string) => { body: ProjectBody; identity: DocumentIdentity };
  /** Adopt a Save As that actually landed: identity, name and source, then persist. */
  adoptSaveAs: (identity: DocumentIdentity, name: string, source: ProjectSource) => Promise<void>;
```

Inside `createProjectSlice`, before the returned object:

```ts
  const buildBody = (envelope: ProjectEnvelope): ProjectBody => ({
    ...envelope,
    content: buildProjectContent(get()),
  });

  const writeText = async (handle: FileSystemFileHandle, text: string): Promise<ProjectSaveResult> => {
    try {
      await writeTextToHandle(handle, text);
      return { ok: true, destination: 'local' };
    } catch {
      return { ok: false, message: SAVE_FAILED_MESSAGE };
    }
  };
```

And the actions (placed after `save`, before `newProject`):

```ts
    saveProject: async () => {
      const target = saveTarget(get().projectSource);
      switch (target.kind) {
        case 'save-as':
          // No target to overwrite, so Save IS Save As. Nothing is clobbered.
          return get().saveProjectAsLocal();
        case 'drive-update':
          // Task 15 replaces this arm with the Drive slice's own save (saveToDrive).
          // DRIVE_NOT_CONNECTED_MESSAGE stays: the drive slice reports it for a
          // real not-connected state, and that is the same sentence.
          return { ok: false, message: DRIVE_NOT_CONNECTED_MESSAGE };
        case 'local-write': {
          if (!(await ensureWritePermission(target.handle))) {
            return { ok: false, message: SAVE_HANDLE_DENIED_MESSAGE };
          }
          return writeText(target.handle, serializeProject(get().exportProjectFile()));
        }
      }
    },

    saveProjectAsLocal: async () => {
      const picked = await pickLocalSaveHandle(projectFileName(get().projectName ?? ''));
      if (picked.ok === false) {
        return { ok: true, destination: picked.reason === 'cancelled' ? 'cancelled' : 'download' };
      }
      if (!(await ensureWritePermission(picked.handle))) {
        return { ok: false, message: SAVE_HANDLE_DENIED_MESSAGE };
      }
      const name = fileNameWithoutExtension(picked.handle.name);
      const { body, identity } = get().saveAsBody(name);
      const written = await writeText(picked.handle, serializeProject(body));
      if (written.ok === false) return written;
      await get().adoptSaveAs(identity, name, { kind: 'local', handle: picked.handle });
      return { ok: true, destination: 'local' };
    },

    saveAsBody: (name) => {
      // One clock read, carried by the identity: a document created at
      // 12:00:00.000 and "updated" at 12:00:00.004 is a lie the envelope should
      // not have to tell, and envelopeForSaveAs takes no second `now` for
      // exactly that reason.
      const identity = newDocumentIdentity(now());
      return { body: buildBody(envelopeForSaveAs(identity, name)), identity };
    },

    adoptSaveAs: async (identity, name, source) => {
      slot = identity;
      set({ projectName: normalizeName(name), projectSource: source });
      // Explicit, not left to the autosave subscription: `projectSource` is not
      // a content key, so a re-point that changed no content would otherwise
      // never reach the slot, and a reload would resume a project that forgot
      // which file it belongs to.
      //
      // AWAITED, and that is why this is async: the slot write has to have
      // landed before the action that triggered it resolves, or a caller (or a
      // test) that reads the slot next sees the old source and the ordering
      // depends on how many microtask hops the backend happens to take.
      await get().save();
    },
```

Then rewrite `exportProjectFile` to share `buildBody`:

```ts
    exportProjectFile: (): ProjectBody => buildBody(envelopeForSave(slot, get().projectName ?? '', now())),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/projectSave.test.ts`
Expected: PASS — 12 tests.

Then run the whole project-file group, because Task 4's tests must still hold:

Run: `bun test src/store/projectSlice.test.ts src/store/projectBoot.test.ts src/store/projectAutosave.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/projectSlice.ts src/store/projectSave.test.ts
git commit -m "feat(project): dispatch Save by source and add local Save As

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 6: Open, Save and Save As in the Wordmark menu

**Files:**
- Modify: `src/components/project/ProjectMenu.tsx`
- Test: `src/components/project/ProjectMenu.test.tsx`

**Interfaces:**
- Consumes: `ProjectSlice.saveProject`, `ProjectSlice.saveProjectAsLocal`, `ProjectSlice.exportProjectFile` (Task 5); `ProjectSaveResult` type; `pickLocalOpenHandle`, `readTextFromHandle` from `@/utils/localFileSave` (Task 2); `useLiveStore` from `../ui/useLiveStore`.
- Produces:
  - `type ProjectMenuAction = 'open' | 'save' | 'save-as' | 'export' | 'new'`
  - `const REPLACING_ACTIONS: ReadonlyArray<ProjectMenuAction>`
  - `function replacesProject(action: ProjectMenuAction): boolean`
  - `const PROJECT_MENU_ACTIONS` — five rows, in that order

**Open is the requirement's other half.** Save overwriting the opened file is only true if the open produced something writable, so `confirmReplace`'s `open` arm now tries `pickLocalOpenHandle()` first and installs the parsed body with `{ kind: 'local', handle }` as the source. The `<input>` is reached only when the probe says `unavailable`, and that path still opens `untitled` — which is correct, because a read-only `File` has nothing to write back to. The `<input>`, its ref and `onPickFile` therefore all stay exactly as they are.

**No `Header.tsx` change.** `Header.tsx` already renders `<ProjectMenu textClassName="hidden sm:inline" />` and the project-name chip, and the design adds no source or sign-in affordance to the header — the menu is the whole surface. If you feel the pull to add a "source" badge there, that is out of scope: the design's UI shell section names the menu and nothing else.

- [ ] **Step 1: Write the failing test**

In `src/components/project/ProjectMenu.test.tsx`, replace the import line and the first test, and add two tests:

```ts
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import {
  PROJECT_MENU_ACTIONS,
  ProjectMenu,
  REPLACE_CONFIRM_MESSAGE,
  REPLACING_ACTIONS,
  replacesProject,
} from './ProjectMenu';
```

(`REPLACE_CONFIRM_MESSAGE` is used by the existing confirm-copy test; `REPLACING_ACTIONS` by the new one. Both must be in the import list or `bun run eslint` fails on the undefined reference.)

```ts
  test('offers Open, Save, Save As, Export and New, in that order', () => {
    expect(PROJECT_MENU_ACTIONS.map((a) => a.action)).toEqual(['open', 'save', 'save-as', 'export', 'new']);
  });

  test('only the actions that replace the one autosaved project confirm', () => {
    expect(REPLACING_ACTIONS).toEqual(['open', 'new']);
    expect(replacesProject('open')).toBe(true);
    expect(replacesProject('new')).toBe(true);
    expect(replacesProject('save')).toBe(false);
    expect(replacesProject('save-as')).toBe(false);
    expect(replacesProject('export')).toBe(false);
  });

  test('renders a Save and a Save as row with stable ids', () => {
    const html = renderToString(<ProjectMenu textClassName="hidden sm:inline" />);
    expect(html).toContain('id="project-menu-save"');
    expect(html).toContain('id="project-menu-save-as"');
  });
```

and fix the new test file's import of `REPLACING_ACTIONS` by adding it to the import list above. The existing `the confirm copy says plainly…` and `renders a labelled dropdown trigger…` tests stay as they are.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/project/ProjectMenu.test.tsx`
Expected: FAIL — `expected [ 'open', 'export', 'new' ] to equal [ 'open', 'save', 'save-as', 'export', 'new' ]`.

- [ ] **Step 3: Write the implementation**

In `src/components/project/ProjectMenu.tsx`, replace the imports, the action table and the dispatch:

```tsx
import React, { useRef, useState } from 'react';
import { Download, FileDown, FilePlus, Save, Upload } from 'lucide-react';
import { PROJECT_FILE_ACCEPT, PROJECT_FILE_MIME, parseProjectFile, serializeProject } from '@/store/projectFile';
import type { ProjectSaveResult } from '@/store/projectSlice';
import { pickLocalOpenHandle, readTextFromHandle } from '@/utils/localFileSave';
import { downloadTextFile, projectFileName, readFileAsText } from '@/utils/projectFileIO';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useLiveStore } from '../ui/useLiveStore';
import { Wordmark } from '../ui/Wordmark';

export type ProjectMenuAction = 'open' | 'save' | 'save-as' | 'export' | 'new';

/**
 * Only the actions that REPLACE the one autosaved project confirm. Save writes
 * to a target the user already chose, Save As creates a new file and leaves the
 * current project alone, and Export only reads — none of the three can lose
 * work, so none of them may put a dialog in the way of a deliberate save.
 */
export const REPLACING_ACTIONS: ReadonlyArray<ProjectMenuAction> = ['open', 'new'];

export function replacesProject(action: ProjectMenuAction): boolean {
  return REPLACING_ACTIONS.includes(action);
}

/** Open and New replace the one autosaved project; the other three never touch it. */
export const PROJECT_MENU_ACTIONS: ReadonlyArray<{
  action: ProjectMenuAction;
  label: string;
  icon: typeof Upload;
}> = [
  { action: 'open', label: 'Open .solna', icon: Upload },
  { action: 'save', label: 'Save', icon: Save },
  { action: 'save-as', label: 'Save as…', icon: FileDown },
  { action: 'export', label: 'Export .solna', icon: Download },
  { action: 'new', label: 'New project', icon: FilePlus },
];
```

Add the two store reads next to the existing ones:

```tsx
  const saveProject = useLiveStore((s) => s.saveProject);
  const saveProjectAsLocal = useLiveStore((s) => s.saveProjectAsLocal);
```

Add the result handler below `runExport`, and replace `choose`:

```tsx
  /**
   * The one place a save result becomes UI. `download` is the no-File-System-
   * Access fallback (Safari, Firefox): Save degrades to writing a copy, which is
   * exactly what Export does — so it reuses it rather than duplicating it.
   * `cancelled` is a dismissed picker: nothing happened, so nothing is said.
   */
  const finishSave = (result: ProjectSaveResult) => {
    if (result.ok === false) {
      report(result.message);
      return;
    }
    if (result.destination === 'download') {
      runExport();
      return;
    }
    if (result.destination !== 'cancelled') report(null);
  };

  const runSave = async () => finishSave(await saveProject());
  const runSaveAs = async () => finishSave(await saveProjectAsLocal());

  /**
   * The writable open, and the whole reason Save can overwrite: the picker
   * hands back a handle, the handle is read for the parse and then KEPT as the
   * source. `unavailable` falls through to the `<input>`, which yields a
   * read-only File and therefore an untitled project — the honest degradation,
   * not a silent one. `cancelled` does nothing at all.
   */
  const runOpenLocal = async () => {
    const picked = await pickLocalOpenHandle();
    if (picked.ok === false) {
      if (picked.reason === 'unavailable') fileInputRef.current?.click();
      return;
    }
    const parsed = parseProjectFile(await readTextFromHandle(picked.handle));
    if (parsed.ok === false) {
      report(parsed.message);
      return;
    }
    const result = await openProjectFile(parsed.body, { kind: 'local', handle: picked.handle });
    if (result.ok === false && result.error !== 'unavailable') report(result.message);
  };

  const choose = (action: ProjectMenuAction) => {
    if (replacesProject(action)) {
      setConfirming(action);
      return;
    }
    if (action === 'export') {
      runExport();
      return;
    }
    if (action === 'save') {
      void runSave();
      return;
    }
    void runSaveAs();
  };
```

And `confirmReplace`'s `open` arm goes through the picker instead of straight to the input:

```tsx
  const confirmReplace = () => {
    const action = confirming;
    setConfirming(null);
    if (action === 'open') void runOpenLocal();
    if (action === 'new') newProject();
  };
```

`runExport`, `onPickFile`, the `<input>` and the render body are otherwise unchanged — `onPickFile` is still what the fallback path lands in, and it still opens `untitled` because a `File` is read-only.

**On user activation:** `showOpenFilePicker` and `showSaveFilePicker` both need transient activation, and both are reached from a click with no `await` in front of them (`choose` → `runSave` → `saveProject` → `saveProjectAsLocal` → `pickLocalSaveHandle` runs synchronously up to the picker call; `confirmReplace` → `runOpenLocal` → `pickLocalOpenHandle` likewise). Do not "tidy" an `await` in ahead of those calls — the dialog stops opening and the failure looks like the capability probe.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/project/ProjectMenu.test.tsx`
Expected: PASS — 5 tests.

Then the theme gate, because this file gained classes (`lucide-react` icons only say `className="w-4 h-4"`, already used, but the guard is cheap):

Run: `bun run check:theme`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/project/ProjectMenu.tsx src/components/project/ProjectMenu.test.tsx
git commit -m "feat(project): add Save and Save As to the project menu

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 7: Phase 1 checkpoint

**Files:** none — this task proves the phase ships.

- [ ] **Step 1: Run the whole project group**

Run: `bun test src/store/projectSource.test.ts src/utils/localFileSave.test.ts src/store/projectStore.test.ts src/store/projectSlice.test.ts src/store/projectSave.test.ts src/store/projectBoot.test.ts src/store/projectAutosave.test.ts src/store/projectFile.test.ts src/components/project/ProjectMenu.test.tsx`
Expected: PASS, every file.

- [ ] **Step 2: Run the full gate**

Run: `bun run verify`
Expected: PASS — `bun test`, `tsc --noEmit`, `eslint` (silent), the four `check:*` scripts, and `vite build`.

- [ ] **Step 3: Walk the phase-1 behaviour by hand**

Run: `bun run dev`, then in the browser:

1. New project → edit a knob → the menu's **Save** opens a file picker (Chromium). Save it. Save again: no picker, the same file is overwritten, and the tab title/project name is unchanged.
2. **Save As** → pick a new name → the header name changes to the new file's stem and the next **Save** writes to the new file.
3. **Export .solna** → a download appears and the next **Save** still writes to the picked file.
4. Reload the page → the project resumes, and **Save** still writes to the picked file without asking (this is the slot record's `source` surviving a restart).
5. **The requirement's headline case:** **New project**, then **Open .solna** and choose one of the files from step 1-2. Edit something, then **Save** — the browser asks once for permission to edit that file, and after that the file on disk changes with no dialog and no second file appears next to it. Check the modified time in Finder/Explorer.
6. In Safari or Firefox: **Open .solna** falls back to the file input and the project opens untitled; **Save** downloads a copy and the source stays untitled (Save asks again next time).

- [ ] **Step 4: Commit any fix the walk turns up**

```bash
git add -A
git commit -m "fix(project): correct what the phase 1 walk turned up

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Skip this step if the walk was clean — do not commit an empty diff.

---

# Phase 2 — Google Drive

Phase 2 adds the Drive backend and the project-list modal. Tasks 8-13 build the pieces against injected fakes; Tasks 14-15 wire the store, Task 16 the UI; Task 17 is the source-scan guard that keeps the Google origins where they belong, Task 18 is the deployment variable and the doc sync, and Task 19 is the final gate.

## Task 8: The Google script loader and its origin allowlist

**Files:**
- Create: `src/utils/googleScriptLoader.ts`
- Test: `src/utils/googleScriptLoader.test.ts`

**Interfaces:**
- Produces:
  - `const GOOGLE_SCRIPT_ORIGINS: readonly string[]` — `['https://accounts.google.com', 'https://apis.google.com']`
  - `const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'`
  - `const GAPI_SCRIPT_URL = 'https://apis.google.com/js/api.js'`
  - `function isAllowedGoogleScript(url: string): boolean`
  - `type LoadResult<T> = { ok: true; value: T } | { ok: false; message: string }`
  - `function loadScript(url: string, doc?: ScriptDocument): Promise<LoadResult<null>>`
  - `function loadGis(doc?: ScriptDocument, scope?: unknown): Promise<LoadResult<GisOauth2>>`
  - `function loadGapi(doc?: ScriptDocument, scope?: unknown): Promise<LoadResult<GapiRoot>>`
  - `interface ScriptDocument { createElement(tag: 'script'): ScriptElement; head: { appendChild(node: unknown): void } }`
  - `interface ScriptElement { src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null }`
  - `interface GisOauth2`, `interface GisTokenClient`, `interface GisTokenResponse` — the GIS shapes `driveAuth.ts` consumes
  - `interface GapiRoot { client: GapiClient }`, `interface GapiClient`, `interface GapiRequest`, `interface GapiResponse` — the gapi shapes `driveGapi.ts` consumes (`GapiResponse` carries `body`, which is where an unparsed `vnd.solna` media read actually arrives)

**Why the loader exists rather than two `<script>` tags in `index.html`:** GIS and gapi are big, and a project the user never saves to Drive should not pay for them at boot. Loading on demand also puts the origin allowlist in one reviewable place.

- [ ] **Step 1: Write the failing test**

Create `src/utils/googleScriptLoader.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  GAPI_SCRIPT_URL,
  GIS_LOAD_FAILED_MESSAGE,
  GIS_SCRIPT_URL,
  GOOGLE_SCRIPT_ORIGINS,
  isAllowedGoogleScript,
  loadGapi,
  loadGis,
  loadScript,
} from './googleScriptLoader';

interface FakeScript {
  src: string;
  async: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

/** A document that only records what was appended; the test fires the events. */
function fakeDoc() {
  const appended: FakeScript[] = [];
  return {
    appended,
    doc: {
      createElement: () => ({ src: '', async: false, onload: null, onerror: null }),
      head: { appendChild: (node: unknown) => void appended.push(node as FakeScript) },
    },
  };
}

beforeEach(() => {
  // Each test starts from an empty module-level load cache.
  delete (globalThis as { google?: unknown }).google;
  delete (globalThis as { gapi?: unknown }).gapi;
});

describe('the origin allowlist', () => {
  test('names exactly the two Google origins the design allows', () => {
    expect(GOOGLE_SCRIPT_ORIGINS).toEqual(['https://accounts.google.com', 'https://apis.google.com']);
  });

  test('accepts the two script URLs and nothing wider', () => {
    expect(isAllowedGoogleScript(GIS_SCRIPT_URL)).toBe(true);
    expect(isAllowedGoogleScript(GAPI_SCRIPT_URL)).toBe(true);
    expect(isAllowedGoogleScript('https://accounts.google.com.evil.test/gsi/client')).toBe(false);
    expect(isAllowedGoogleScript('https://www.googleapis.com/drive/v3/files')).toBe(false);
    expect(isAllowedGoogleScript('http://accounts.google.com/gsi/client')).toBe(false);
  });
});

describe('loadScript', () => {
  test('appends an async script for an allowed origin and resolves on load', async () => {
    const { appended, doc } = fakeDoc();
    const pending = loadScript(GIS_SCRIPT_URL, doc);
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe(GIS_SCRIPT_URL);
    expect(appended[0].async).toBe(true);
    appended[0].onload?.();
    expect(await pending).toEqual({ ok: true, value: null });
  });

  test('refuses a URL outside the allowlist without touching the document', async () => {
    const { appended, doc } = fakeDoc();
    const result = await loadScript('https://evil.test/tracker.js', doc);
    expect(result.ok).toBe(false);
    expect(appended).toHaveLength(0);
  });

  test('a script that fails to load is a typed failure, never a rejection', async () => {
    const { appended, doc } = fakeDoc();
    const pending = loadScript(GIS_SCRIPT_URL, doc);
    appended[0].onerror?.();
    const result = await pending;
    expect(result.ok).toBe(false);
  });

  test('with no doc argument it reads globalThis.document, and says unavailable when there is none', async () => {
    // bun:test has no DOM, so this is the no-document branch — and it is the
    // ONLY coverage the un-injected path gets. It exists because the obvious
    // wrong implementation (`globalThis as ScriptDocument`) throws
    // `doc.createElement is not a function` in a real browser, where no test
    // would ever have reached it.
    expect(await loadScript(GIS_SCRIPT_URL)).toEqual({ ok: false, message: GIS_LOAD_FAILED_MESSAGE });
  });
});

describe('loadGis', () => {
  test('resolves the oauth2 object once the script announces it', async () => {
    const { appended, doc } = fakeDoc();
    const scope = { google: { accounts: { oauth2: { initTokenClient: () => ({}), revoke: () => {} } } } };
    const pending = loadGis(doc, scope);
    // The script's onload is what makes the global appear in a real browser.
    appended[0].onload?.();
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(scope.google.accounts.oauth2);
  });

  test('a loaded script that never defines oauth2 is unavailable, not a crash', async () => {
    const { appended, doc } = fakeDoc();
    const pending = loadGis(doc, {});
    appended[0].onload?.();
    const result = await pending;
    expect(result.ok).toBe(false);
  });
});

describe('loadGapi', () => {
  test('offers the client to gapi.load and resolves once it is ready', async () => {
    const { appended, doc } = fakeDoc();
    const client = { request: async () => ({ result: null }) };
    let loadArg = '';
    const scope = {
      gapi: {
        client,
        load: (name: string, callback: () => void) => {
          loadArg = name;
          callback();
        },
      },
    };
    const pending = loadGapi(doc, scope);
    appended[0].onload?.();
    const result = await pending;
    expect(loadArg).toBe('client');
    expect(result.ok && result.value.client).toBe(client);
  });

  test('a scope without gapi.load is unavailable, not a crash', async () => {
    const { appended, doc } = fakeDoc();
    const pending = loadGapi(doc, { gapi: {} });
    appended[0].onload?.();
    const result = await pending;
    expect(result.ok).toBe(false);
  });
});
```

**Note on the module-level load cache:** `loadScript` memoizes per URL so two callers share one `<script>`. Since every test above passes its own `doc`, the cache must be keyed by URL *and* bypassed when a `doc` argument is supplied — the implementation below does exactly that, and it is the only reason the tests can run more than one `loadScript` in a process.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/googleScriptLoader.test.ts`
Expected: FAIL — `Cannot find module './googleScriptLoader'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/googleScriptLoader.ts`:

```ts
/**
 * The allowlist, in code rather than in a build config, because a CSP is not
 * the only thing that has to agree with it: this function is what stops a
 * mistyped URL from being injected at all.
 *
 * CSP note for whoever deploys this: the site ships NO Content-Security-Policy
 * today, and adding a `<meta http-equiv>` one is deliberately NOT part of this
 * change — a meta CSP would need a hash or nonce for index.html's inline
 * pre-paint theme script, and getting that wrong trades a remote-code guard for
 * a flash of the wrong theme. If a CSP is adopted later (header or meta), its
 * `script-src` must list exactly `https://accounts.google.com` and
 * `https://apis.google.com`, and its `connect-src` exactly
 * `https://www.googleapis.com`.
 *
 * PWA note: vite.config.ts runs vite-plugin-pwa with workbox `runtimeCaching`
 * for the two font origins only, and `globPatterns` precaches local build
 * assets only — so nothing here is cached for offline use, which is correct.
 * No rule may ever be added for a Google script or API origin: a Drive response
 * served from cache would present a stale project as if it were the live one.
 * GIS's token client authenticates through a popup and postMessage, not a
 * redirect, so workbox's `navigateFallback: '/index.html'` never intercepts it.
 * `src/utils/googleOrigins.test.ts` (Task 17) is what keeps that true.
 */
export const GOOGLE_SCRIPT_ORIGINS = ['https://accounts.google.com', 'https://apis.google.com'] as const;

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
export const GAPI_SCRIPT_URL = 'https://apis.google.com/js/api.js';

export function isAllowedGoogleScript(url: string): boolean {
  return GOOGLE_SCRIPT_ORIGINS.some((origin) => url.startsWith(`${origin}/`));
}

export type LoadResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface ScriptElement {
  src: string;
  async: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

export interface ScriptDocument {
  createElement(tag: 'script'): ScriptElement;
  head: { appendChild(node: unknown): void };
}

export const GIS_LOAD_FAILED_MESSAGE = 'Could not load the Google Drive client. Check your connection and try again.';

/** One in-flight/resolved load per URL, so two callers share one script tag. */
const loaded = new Map<string, Promise<LoadResult<null>>>();

function inject(url: string, doc: ScriptDocument): Promise<LoadResult<null>> {
  return new Promise((resolve) => {
    const element = doc.createElement('script');
    element.src = url;
    element.async = true;
    element.onload = () => resolve({ ok: true, value: null });
    element.onerror = () => resolve({ ok: false, message: GIS_LOAD_FAILED_MESSAGE });
    doc.head.appendChild(element);
  });
}

/**
 * `doc` is injectable so the suite can run without a DOM, and supplying one
 * BYPASSES the cache — a shared cache keyed by URL alone would make the second
 * test in a file observe the first test's document.
 *
 * The real document is read as `globalThis.document`, NOT `globalThis`: a
 * `ScriptDocument` is `createElement` + `head`, and neither is on the global
 * object. Because every test injects a `doc`, nothing in the suite exercises
 * this line — so it is the one line here that has to be right by reading.
 * A non-browser scope (a test that forgets its `doc`, an SSR pass) reports
 * unavailable rather than throwing.
 */
export function loadScript(url: string, doc?: ScriptDocument): Promise<LoadResult<null>> {
  if (!isAllowedGoogleScript(url)) {
    return Promise.resolve({ ok: false, message: `Refused to load a script from outside the allowlist: ${url}` });
  }
  if (doc) return inject(url, doc);
  const host = (globalThis as { document?: unknown }).document;
  if (typeof (host as ScriptDocument | undefined)?.createElement !== 'function') {
    return Promise.resolve({ ok: false, message: GIS_LOAD_FAILED_MESSAGE });
  }
  let pending = loaded.get(url);
  if (!pending) {
    pending = inject(url, host as ScriptDocument);
    loaded.set(url, pending);
  }
  return pending;
}

// --- Google Identity Services -------------------------------------------------

export interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

export interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

export interface GisOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): GisTokenClient;
  revoke(token: string, done: () => void): void;
}

/**
 * The globals are READ here, after the script's onload, and never imported:
 * GIS installs `google.accounts.oauth2` and gapi installs `gapi` on the window,
 * so there is nothing to import and nothing to type-check against a dependency
 * solna does not have.
 */
export async function loadGis(
  doc?: ScriptDocument,
  scope: unknown = globalThis,
): Promise<LoadResult<GisOauth2>> {
  const script = await loadScript(GIS_SCRIPT_URL, doc);
  if (script.ok === false) return script;
  const oauth2 = (scope as { google?: { accounts?: { oauth2?: GisOauth2 } } }).google?.accounts?.oauth2;
  if (!oauth2 || typeof oauth2.initTokenClient !== 'function') {
    return { ok: false, message: GIS_LOAD_FAILED_MESSAGE };
  }
  return { ok: true, value: oauth2 };
}

// --- gapi ---------------------------------------------------------------------

export interface GapiRequest {
  path: string;
  method: 'GET' | 'POST' | 'PATCH';
  params?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * `result` is gapi's PARSED body — and it is `false` when the response was not
 * JSON by content type. `body` is the raw text and is always present, so it is
 * declared here and preferred when reading media: a `.solna` comes back as
 * `application/vnd.solna`, which gapi does not parse, and a transport that only
 * looked at `result` would report every Drive open as a malformed project.
 */
export interface GapiResponse {
  result: unknown;
  body?: string;
}

export interface GapiClient {
  request(request: GapiRequest): Promise<GapiResponse>;
  setToken(token: { access_token: string } | null): void;
}

export interface GapiRoot {
  client: GapiClient;
  load(name: string, callback: () => void): void;
}

export async function loadGapi(
  doc?: ScriptDocument,
  scope: unknown = globalThis,
): Promise<LoadResult<GapiRoot>> {
  const script = await loadScript(GAPI_SCRIPT_URL, doc);
  if (script.ok === false) return script;
  const gapi = (scope as { gapi?: GapiRoot }).gapi;
  if (!gapi || typeof gapi.load !== 'function') return { ok: false, message: GIS_LOAD_FAILED_MESSAGE };
  const ready = new Promise<void>((resolve) => gapi.load('client', resolve));
  await ready;
  if (!gapi.client || typeof gapi.client.request !== 'function') {
    return { ok: false, message: GIS_LOAD_FAILED_MESSAGE };
  }
  return { ok: true, value: gapi };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/utils/googleScriptLoader.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/googleScriptLoader.ts src/utils/googleScriptLoader.test.ts
git commit -m "feat(drive): load the Google clients through an origin allowlist

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 9: Drive auth — the GIS token client

**Files:**
- Create: `src/store/driveAuth.ts`
- Test: `src/store/driveAuth.test.ts`

**Interfaces:**
- Consumes: `GisOauth2`, `GisTokenResponse`, `LoadResult` from `../utils/googleScriptLoader`.
- Produces:
  - `const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'`
  - `const DRIVE_DENIED_MESSAGE`, `DRIVE_UNAVAILABLE_MESSAGE`, `DRIVE_FAILED_MESSAGE`
  - `class DriveAuthError extends Error { kind: 'denied' | 'unavailable' }`
  - `class DriveUnavailableError extends Error`
  - `function isAuthFailure(err: unknown): boolean`
  - `function driveErrorMessage(err: unknown): string`
  - `interface DriveAuth { token(): Promise<string>; invalidate(): void; revoke(): Promise<void>; signedIn(): boolean }`
  - `interface DriveAuthDeps { loadOauth2: () => Promise<LoadResult<GisOauth2>>; clientId: string; now?: () => number }`
  - `function createDriveAuth(deps: DriveAuthDeps): DriveAuth`
  - `function withDriveToken<T>(auth: DriveAuth, op: (token: string) => Promise<T>): Promise<T>`
  - `function driveClientId(env?: unknown): string`

**The token never leaves this file's closure.** `createDriveAuth` is the only holder; the store mirrors a boolean (`driveSignedIn`) and nothing else. That is the design's token-hygiene rule expressed as a module boundary: there is no getter that would let a slice persist or log the token.

- [ ] **Step 1: Write the failing test**

Create `src/store/driveAuth.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  DRIVE_DENIED_MESSAGE,
  DRIVE_FAILED_MESSAGE,
  DRIVE_SCOPE,
  DRIVE_UNAVAILABLE_MESSAGE,
  DriveAuthError,
  DriveUnavailableError,
  createDriveAuth,
  driveClientId,
  driveErrorMessage,
  isAuthFailure,
  withDriveToken,
} from './driveAuth';
import type { GisOauth2, GisTokenClient, GisTokenResponse } from '../utils/googleScriptLoader';

/** A GIS stand-in: it answers with whatever the test queued and records its config. */
function fakeGis(responses: Array<GisTokenResponse | 'error'> = []) {
  const configs: Array<{ client_id: string; scope: string; include_granted_scopes: boolean }> = [];
  const prompts: Array<{ prompt?: string } | undefined> = [];
  const revoked: string[] = [];
  const oauth2: GisOauth2 = {
    initTokenClient: (config) => {
      configs.push(config);
      return {
        requestAccessToken: (overrides) => {
          prompts.push(overrides);
          const next = responses.shift() ?? { access_token: 'token-1', expires_in: 3600 };
          if (next === 'error') config.error_callback?.({ type: 'access_denied' });
          else config.callback(next);
        },
      } satisfies GisTokenClient;
    },
    revoke: (token, done) => {
      revoked.push(token);
      done();
    },
  };
  return { oauth2, configs, prompts, revoked };
}

const neverLoads = async () => ({ ok: false as const, message: 'offline' });

describe('createDriveAuth', () => {
  test('requests a token and reports signed in', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    expect(auth.signedIn()).toBe(false);
    expect(await auth.token()).toBe('token-1');
    expect(auth.signedIn()).toBe(true);
  });

  test('asks for exactly drive.file, the injected client id, and no inherited grant', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid-42' });
    await auth.token();
    expect(gis.configs[0]).toMatchObject({
      client_id: 'cid-42',
      scope: 'https://www.googleapis.com/auth/drive.file',
      include_granted_scopes: false,
    });
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });

  test('a live token is reused — GIS is not asked twice', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    await auth.token();
    await auth.token();
    expect(gis.configs).toHaveLength(1);
  });

  test('an expired token is re-requested, silently on the second round', async () => {
    let clock = 1_000;
    const gis = fakeGis([{ access_token: 'token-1', expires_in: 60 }, { access_token: 'token-2', expires_in: 60 }]);
    const auth = createDriveAuth({
      loadOauth2: async () => ({ ok: true, value: gis.oauth2 }),
      clientId: 'cid',
      now: () => clock,
    });
    expect(await auth.token()).toBe('token-1');
    clock = 1_000 + 61_000;
    expect(auth.signedIn()).toBe(false);
    expect(await auth.token()).toBe('token-2');
    expect(gis.configs).toHaveLength(2);
    // First acquisition may show consent; every one after it must not.
    expect(gis.prompts[0]).toBeUndefined();
    expect(gis.prompts[1]).toEqual({ prompt: '' });
  });

  test('a denied consent rejects with kind denied and leaves the app signed out', async () => {
    const gis = fakeGis(['error']);
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    // ONE queued response, so exactly one token() call may consume it. Calling
    // token() a second time here would fall through to the fake's default
    // success and assert the opposite of what the test name says.
    const err = await auth.token().catch((thrown: unknown) => thrown);
    expect(err).toBeInstanceOf(DriveAuthError);
    expect((err as DriveAuthError).kind).toBe('denied');
    expect(driveErrorMessage(err)).toBe(DRIVE_DENIED_MESSAGE);
    expect(auth.signedIn()).toBe(false);
  });

  test('a GIS script that will not load is unavailable, not a hang', async () => {
    const auth = createDriveAuth({ loadOauth2: neverLoads, clientId: 'cid' });
    const err = await auth.token().catch((thrown: unknown) => thrown);
    expect(err).toBeInstanceOf(DriveAuthError);
    expect((err as DriveAuthError).kind).toBe('unavailable');
    expect(driveErrorMessage(err)).toBe(DRIVE_UNAVAILABLE_MESSAGE);
  });

  test('revoke hands the token to GIS and forgets it', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    await auth.token();
    await auth.revoke();
    expect(gis.revoked).toEqual(['token-1']);
    expect(auth.signedIn()).toBe(false);
  });

  test('revoke without ever signing in is a no-op, not a crash', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    await auth.revoke();
    expect(gis.revoked).toEqual([]);
  });

  test('invalidate drops the token so the next call asks again', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: 'cid' });
    await auth.token();
    auth.invalidate();
    expect(auth.signedIn()).toBe(false);
    await auth.token();
    expect(gis.configs).toHaveLength(2);
  });
});

describe('isAuthFailure', () => {
  test('recognises the 401 both ways gapi reports one', () => {
    expect(isAuthFailure({ status: 401 })).toBe(true);
    expect(isAuthFailure({ result: { error: { code: 401 } } })).toBe(true);
  });

  test('leaves every other failure alone', () => {
    expect(isAuthFailure({ status: 404 })).toBe(false);
    expect(isAuthFailure(new Error('network'))).toBe(false);
    expect(isAuthFailure(null)).toBe(false);
  });
});

describe('withDriveToken', () => {
  const authWith = (value = 'token-1') => {
    let issued = 0;
    const auth = {
      token: async () => {
        issued++;
        return value;
      },
      invalidate: () => {},
      revoke: async () => {},
      signedIn: () => true,
    };
    return { auth, issued: () => issued };
  };

  test('passes a live token to the operation', async () => {
    const { auth } = authWith();
    expect(await withDriveToken(auth, async (token) => `saw:${token}`)).toBe('saw:token-1');
  });

  test('re-requests once on a 401 — GIS re-issues while its consent cookie holds', async () => {
    const { auth, issued } = authWith();
    let attempts = 0;
    const result = await withDriveToken(auth, async () => {
      attempts++;
      if (attempts === 1) throw { status: 401 };
      return 'recovered';
    });
    expect(result).toBe('recovered');
    expect(attempts).toBe(2);
    expect(issued()).toBe(2);
  });

  test('a second 401 is the grant being gone, and leaves as a DriveAuthError', async () => {
    const { auth, issued } = authWith();
    let attempts = 0;
    const err = await withDriveToken(auth, async () => {
      attempts++;
      throw { status: 401 };
    }).catch((thrown: unknown) => thrown);
    // NOT the raw `{ status: 401 }`: the slice recognises DriveAuthError and
    // nothing else as the signal to drop `driveSignedIn`.
    expect(err).toBeInstanceOf(DriveAuthError);
    expect((err as DriveAuthError).kind).toBe('denied');
    expect(attempts).toBe(2);
    expect(issued()).toBe(2);
  });

  test('a non-auth failure propagates immediately', async () => {
    const { auth, issued } = authWith();
    await expect(
      withDriveToken(auth, async () => {
        throw new DriveUnavailableError('nope');
      }),
    ).rejects.toThrow('nope');
    expect(issued()).toBe(1);
  });
});

describe('driveErrorMessage', () => {
  test('maps each failure kind to its own sentence', () => {
    expect(driveErrorMessage(new DriveAuthError('denied', 'x'))).toBe(DRIVE_DENIED_MESSAGE);
    expect(driveErrorMessage(new DriveAuthError('unavailable', 'x'))).toBe(DRIVE_UNAVAILABLE_MESSAGE);
    expect(driveErrorMessage(new DriveUnavailableError(DRIVE_UNAVAILABLE_MESSAGE))).toBe(DRIVE_UNAVAILABLE_MESSAGE);
    expect(driveErrorMessage(new Error('boom'))).toBe(DRIVE_FAILED_MESSAGE);
  });
});

describe('driveClientId', () => {
  test('reads and trims the Vite env var', () => {
    expect(driveClientId({ VITE_GOOGLE_CLIENT_ID: '  abc.apps.googleusercontent.com ' })).toBe(
      'abc.apps.googleusercontent.com',
    );
  });

  test('an absent or non-string value is an empty id, never undefined', () => {
    // Every case passes its env explicitly. `driveClientId(undefined)` would
    // fall through to the `import.meta.env` DEFAULT, which bun populates from a
    // developer's own `.env` — a test that passes or fails depending on whose
    // machine it runs on.
    expect(driveClientId({})).toBe('');
    expect(driveClientId({ VITE_GOOGLE_CLIENT_ID: 42 })).toBe('');
    expect(driveClientId({ VITE_GOOGLE_CLIENT_ID: '   ' })).toBe('');
  });
});

describe('an unconfigured client id', () => {
  test('is unavailable, not denied — the user refused nothing', async () => {
    const gis = fakeGis();
    const auth = createDriveAuth({ loadOauth2: async () => ({ ok: true, value: gis.oauth2 }), clientId: '' });
    const err = await auth.token().catch((thrown: unknown) => thrown);
    expect((err as DriveAuthError).kind).toBe('unavailable');
    // GIS is never even asked: initTokenClient('') fails inside Google's script
    // and surfaces through error_callback, which would report the deployment's
    // missing configuration as the USER having declined.
    expect(gis.configs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/driveAuth.test.ts`
Expected: FAIL — `Cannot find module './driveAuth'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/driveAuth.ts`:

```ts
import type { GisOauth2, LoadResult } from '../utils/googleScriptLoader';

/**
 * `drive.file` and nothing else. It reads as "only the files this app created or
 * opened", it is NON-SENSITIVE (so no restricted-scope assessment), and it is
 * the whole of draw.io's permission model. Adding `drive`, `userinfo` or
 * `openid` would widen the consent screen for no v1 feature — account email and
 * avatar display are explicitly out of scope.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const DRIVE_DENIED_MESSAGE = 'Google Drive access was not granted.';
export const DRIVE_UNAVAILABLE_MESSAGE = 'Could not load the Google Drive client. Check your connection and try again.';
export const DRIVE_FAILED_MESSAGE = 'Google Drive did not respond. Your project is still autosaved on this device.';

/** The two ways acquiring a token fails, kept apart because the copy differs. */
export class DriveAuthError extends Error {
  constructor(
    readonly kind: 'denied' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

/** The gapi client itself could not be loaded — same sentence, different seam. */
export class DriveUnavailableError extends Error {
  constructor(message: string = DRIVE_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'DriveUnavailableError';
  }
}

/** One place a thrown thing becomes a sentence the toast can show. */
export function driveErrorMessage(err: unknown): string {
  if (err instanceof DriveAuthError) {
    return err.kind === 'denied' ? DRIVE_DENIED_MESSAGE : DRIVE_UNAVAILABLE_MESSAGE;
  }
  if (err instanceof DriveUnavailableError) return err.message;
  return DRIVE_FAILED_MESSAGE;
}

/**
 * gapi reports an expired token as a rejected object, not an Error: either
 * `{ status: 401 }` or `{ result: { error: { code: 401 } } }`. Both are the one
 * condition worth retrying, so both are recognised here.
 */
export function isAuthFailure(err: unknown): boolean {
  const shaped = err as { status?: unknown; result?: { error?: { code?: unknown } } } | null | undefined;
  return (shaped?.status ?? shaped?.result?.error?.code) === 401;
}

export interface DriveAuth {
  /** A live access token, acquiring one if there is none. Rejects with DriveAuthError. */
  token(): Promise<string>;
  /** Forget the current token without telling Google — used after a 401. */
  invalidate(): void;
  /** Sign out: revoke at Google and forget locally. Never throws. */
  revoke(): Promise<void>;
  /** Whether an unexpired token is held. The store mirrors this as `driveSignedIn`. */
  signedIn(): boolean;
}

export interface DriveAuthDeps {
  loadOauth2: () => Promise<LoadResult<GisOauth2>>;
  clientId: string;
  now?: () => number;
}

/** The default GIS lifetime when it does not say. An hour, like the real one. */
const DEFAULT_LIFETIME_SECONDS = 3_600;

/**
 * The ONLY holder of the access token. It is a closure variable: no getter
 * exposes it, nothing persists it, and the store carries a boolean instead.
 */
export function createDriveAuth(deps: DriveAuthDeps): DriveAuth {
  const now = deps.now ?? Date.now;
  let token: { value: string; expiresAt: number } | null = null;
  let oauth2: GisOauth2 | null = null;
  let acquired = false;
  let pending: Promise<string> | null = null;

  const oauth = async (): Promise<GisOauth2> => {
    if (oauth2) return oauth2;
    const loaded = await deps.loadOauth2();
    if (loaded.ok === false) throw new DriveAuthError('unavailable', DRIVE_UNAVAILABLE_MESSAGE);
    oauth2 = loaded.value;
    return oauth2;
  };

  /**
   * `prompt: ''` on every acquisition after the first: the user already granted
   * this scope, so GIS re-issues from its own consent cookie without a second
   * screen. The first call has no prompt override, which is what lets a consent
   * screen appear at all.
   */
  const request = (prompt: string | undefined): Promise<string> => {
    pending ??= (async () => {
      // A deployment with no client id has not been REFUSED anything, so it
      // must not report the denial sentence. Checked before GIS is touched:
      // initTokenClient('') fails inside Google's own script and comes back
      // through error_callback, i.e. as a denial.
      if (deps.clientId.length === 0) throw new DriveAuthError('unavailable', DRIVE_UNAVAILABLE_MESSAGE);
      const client = await oauth();
      return new Promise<string>((resolve, reject) => {
        const deny = () => reject(new DriveAuthError('denied', DRIVE_DENIED_MESSAGE));
        const tokenClient = client.initTokenClient({
          client_id: deps.clientId,
          scope: DRIVE_SCOPE,
          // A fresh token must never silently inherit a broader earlier grant.
          include_granted_scopes: false,
          callback: (response) => {
            if (!response.access_token) {
              deny();
              return;
            }
            const lifetime =
              typeof response.expires_in === 'number' ? response.expires_in : DEFAULT_LIFETIME_SECONDS;
            token = { value: response.access_token, expiresAt: now() + lifetime * 1_000 };
            acquired = true;
            resolve(token.value);
          },
          error_callback: deny,
        });
        if (prompt === undefined) tokenClient.requestAccessToken();
        else tokenClient.requestAccessToken({ prompt });
      });
    })().finally(() => {
      pending = null;
    });
    return pending;
  };

  return {
    token: async () => {
      if (token && token.expiresAt > now()) return token.value;
      return request(acquired ? '' : undefined);
    },
    invalidate: () => {
      token = null;
    },
    revoke: async () => {
      const current = token;
      token = null;
      acquired = false;
      if (!current || !oauth2) return;
      const revoker = oauth2;
      await new Promise<void>((resolve) => {
        try {
          revoker.revoke(current.value, resolve);
        } catch {
          // A revoke that fails locally still signs the app out, which is the
          // part the user asked for; nothing here is worth an error surface.
          resolve();
        }
      });
    },
    signedIn: () => token !== null && token.expiresAt > now(),
  };
}

/**
 * Run a Drive call with a live token, retrying ONCE on a 401. Exactly one retry:
 * the second 401 means the grant is gone rather than the token being stale, and
 * a loop there would hammer the consent screen.
 */
export async function withDriveToken<T>(auth: DriveAuth, op: (token: string) => Promise<T>): Promise<T> {
  const first = await auth.token();
  try {
    return await op(first);
  } catch (err) {
    if (!isAuthFailure(err)) throw err;
    auth.invalidate();
    try {
      return await op(await auth.token());
    } catch (retried) {
      // A 401 that survives a fresh token is the GRANT being gone, not the
      // token being stale — so it leaves here as a DriveAuthError, the one
      // shape the slice recognises as "correct the signed-in mirror". Letting
      // gapi's raw `{ status: 401 }` escape would make it an anonymous failure
      // and leave the menu claiming a connection the user no longer has.
      if (isAuthFailure(retried)) throw new DriveAuthError('denied', DRIVE_DENIED_MESSAGE);
      throw retried;
    }
  }
}

/**
 * The OAuth *web* client id from the Vite env. It is not a secret — an OAuth web
 * client has no secret at all — but it is deployment-specific, so it is read at
 * the one place that builds the auth and an empty id is a normal degraded state
 * (Drive simply reports unavailable) rather than a boot failure.
 */
export function driveClientId(env: unknown = import.meta.env): string {
  const raw = (env as { VITE_GOOGLE_CLIENT_ID?: unknown } | undefined)?.VITE_GOOGLE_CLIENT_ID;
  return typeof raw === 'string' ? raw.trim() : '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/driveAuth.test.ts`
Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/driveAuth.ts src/store/driveAuth.test.ts
git commit -m "feat(drive): add the GIS token client with a memory-only token

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 10: The Drive operation layer

**Files:**
- Create: `src/store/driveClient.ts`
- Test: `src/store/driveClient.test.ts`

**Interfaces:**
- Consumes: `parseProjectFile`, `serializeProject`, `ProjectParseResult` from `./projectFile`; `projectFileName` from `../utils/projectFileIO`; `ProjectBody` from `./projectFormat`.
- Produces:
  - `const SOLNA_DRIVE_MIME = 'application/vnd.solna'`
  - `const DRIVE_PAGE_SIZE = 100`, `const DRIVE_LIST_FIELDS`, `const DRIVE_LIST_ORDER`
  - `interface DriveFileMeta { id: string; name: string; mimeType: string; modifiedTime: string }`
  - `interface DrivePage { files: DriveFileMeta[]; nextPageToken?: string }`
  - `const DRIVE_LIST_QUERY: string`
  - `interface DriveTransport` — the injected seam (`list`, `readText`, `create`, `update`)
  - `interface DriveClient { listProjects; readProject; createProject; updateProject }`
  - `function createDriveClient(transport: DriveTransport): DriveClient`

**Why a separate transport:** `driveClient` never mentions `gapi`, and `driveGapi` never mentions solna's project format. The first is testable with a five-line stub; the second is where Google's request shapes live. Task 11 is the only file that knows both.

**Why there is no folder anything here — read this before "restoring" it.** The scope is `drive.file`, which authorises the app for *files it created or that were handed to it through the Google Picker* and nothing else. The user's folders are not among them: `files.list` cannot return a folder Solna did not create, so a query asking for `application/vnd.google-apps.folder` returns an empty set forever, and a `parents` constraint can only ever name a folder the app cannot see. Three consequences, all of them decisions rather than omissions:

- `DRIVE_LIST_QUERY` is a **constant, not a function of a parent id**: MIME plus `trashed = false`, nothing else.
- Filtering on `'root' in parents` would be actively wrong, not merely useless — a user who drags their project into a folder from Drive's own UI would watch it disappear from Solna's list while Save went on happily overwriting it.
- `createProject` takes **no folder**: a new file lands in My Drive, and the user may move it afterwards without breaking either the listing or Save.

If opening arbitrary Drive files ever becomes a requirement, the answer is the Google Picker (which is how `drive.file` is meant to be widened, one file at a time, with the user choosing), **not** a broader scope — `drive` and `drive.readonly` are restricted scopes and drag a security assessment behind them.

- [ ] **Step 1: Write the failing test**

Create `src/store/driveClient.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  DRIVE_LIST_FIELDS,
  DRIVE_LIST_ORDER,
  DRIVE_LIST_QUERY,
  DRIVE_PAGE_SIZE,
  SOLNA_DRIVE_MIME,
  createDriveClient,
  type DriveTransport,
} from './driveClient';
import { parseProjectFile } from './projectFile';
import { factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';

const body = (name: string, bpm: number): ProjectBody => ({
  ...makeEnvelope(name, 1_000),
  content: { ...factoryProjectContent(), bpm },
});

const meta = (id: string, name: string, mimeType = SOLNA_DRIVE_MIME) => ({
  id,
  name,
  mimeType,
  modifiedTime: '2026-09-12T10:00:00.000Z',
});

function stub(overrides: Partial<DriveTransport> = {}) {
  const calls: Array<[string, unknown]> = [];
  const transport: DriveTransport = {
    list: async (params) => {
      calls.push(['list', params]);
      return { files: [] };
    },
    readText: async (fileId) => {
      calls.push(['readText', fileId]);
      return '';
    },
    create: async (params) => {
      calls.push(['create', params]);
      return meta('new-1', params.name, params.mimeType);
    },
    update: async (params) => {
      calls.push(['update', params]);
      return meta(params.fileId, 'updated.solna', params.mimeType);
    },
    ...overrides,
  };
  return { transport, calls };
}

describe('DRIVE_LIST_QUERY', () => {
  test('asks for solna files anywhere in the Drive, trashed excluded', () => {
    expect(DRIVE_LIST_QUERY).toBe("mimeType = 'application/vnd.solna' and trashed = false");
  });

  test('constrains no parent, so a project the user moved stays listed', () => {
    // Not a style preference: `drive.file` cannot see a folder this app did not
    // create, so `'<id>' in parents` could only ever name an invisible folder —
    // and filtering on 'root' would hide a project the moment the user filed it.
    expect(DRIVE_LIST_QUERY).not.toContain('parents');
    expect(DRIVE_LIST_QUERY).not.toContain('folder');
  });
});

describe('listProjects', () => {
  test('sends the query, the page size, the newest-first order and the fields', async () => {
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.listProjects();
    expect(calls[0]).toEqual([
      'list',
      {
        q: DRIVE_LIST_QUERY,
        pageSize: DRIVE_PAGE_SIZE,
        orderBy: DRIVE_LIST_ORDER,
        fields: DRIVE_LIST_FIELDS,
      },
    ]);
  });

  test('forwards the page token on a second page and omits it on the first', async () => {
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.listProjects();
    await client.listProjects('page-2');
    expect((calls[0][1] as { pageToken?: string }).pageToken).toBeUndefined();
    expect((calls[1][1] as { pageToken?: string }).pageToken).toBe('page-2');
  });
});

describe('readProject', () => {
  test('parses the media body and reports its unknown references', async () => {
    const text = JSON.stringify(body('Remote', 128));
    const { transport } = stub({ readText: async () => text });
    const client = createDriveClient(transport);
    const parsed = await client.readProject('file-1');
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.body.content.bpm).toBe(128);
    expect(parsed.ok && parsed.warnings).toEqual([]);
  });

  test('a Drive file that is not a solna project is malformed, never a throw', async () => {
    const { transport } = stub({ readText: async () => '<html>consent</html>' });
    const client = createDriveClient(transport);
    const parsed = await client.readProject('file-1');
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toBe('malformed');
  });

  test('a newer formatVersion is refused with the newer-version error', async () => {
    const newer = { ...body('Future', 100), formatVersion: 999 };
    const { transport } = stub({ readText: async () => JSON.stringify(newer) });
    const client = createDriveClient(transport);
    const parsed = await client.readProject('file-1');
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.error).toBe('newer-version');
  });
});

describe('createProject', () => {
  test('names the file <slug>.solna with the solna MIME, and picks no folder', async () => {
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.createProject('My Sketch', body('My Sketch', 90));
    const [, params] = calls[0] as [string, { name: string; mimeType: string; text: string }];
    expect(params.name).toBe('my-sketch.solna');
    expect(params.mimeType).toBe(SOLNA_DRIVE_MIME);
    // No `parents`: the file lands in My Drive and the user may move it later.
    // A folder id could only name a folder `drive.file` cannot see.
    expect(params).not.toHaveProperty('parents');
  });

  test('the media it uploads is the same bytes serializeProject produces', async () => {
    const sketch = body('Sketch', 90);
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.createProject('Sketch', sketch);
    const [, params] = calls[0] as [string, { text: string }];
    expect(parseProjectFile(params.text)).toEqual({ ok: true, body: sketch, warnings: [] });
  });

  test('returns the created file metadata', async () => {
    const { transport } = stub();
    const client = createDriveClient(transport);
    const created = await client.createProject('Sketch', body('Sketch', 90));
    expect(created.id).toBe('new-1');
    expect(created.mimeType).toBe(SOLNA_DRIVE_MIME);
  });
});

describe('updateProject', () => {
  test('sends the file id, the solna MIME and the serialised body', async () => {
    const sketch = body('Sketch', 101);
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.updateProject('file-9', sketch);
    const [, params] = calls[0] as [string, { fileId: string; mimeType: string; text: string }];
    expect(params.fileId).toBe('file-9');
    expect(params.mimeType).toBe(SOLNA_DRIVE_MIME);
    expect(parseProjectFile(params.text).ok).toBe(true);
  });

  test('a body with an updated bpm round-trips through the upload', async () => {
    const sketch = body('Sketch', 145);
    const { transport, calls } = stub();
    const client = createDriveClient(transport);
    await client.updateProject('file-9', sketch);
    const [, params] = calls[0] as [string, { text: string }];
    const parsed = parseProjectFile(params.text);
    expect(parsed.ok && parsed.body.content.bpm).toBe(145);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/driveClient.test.ts`
Expected: FAIL — `Cannot find module './driveClient'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/driveClient.ts`:

```ts
import { projectFileName } from '../utils/projectFileIO';
import type { ProjectBody } from './projectFormat';
import { parseProjectFile, serializeProject, type ProjectParseResult } from './projectFile';

/**
 * A dedicated MIME, NOT the `application/json` a download carries: `files.list`
 * filters on it, so the list shows solna projects without a client-side filter,
 * and Drive shows a sane name for a type it has never seen. The content is the
 * same JSON either way — only the metadata differs.
 */
export const SOLNA_DRIVE_MIME = 'application/vnd.solna';
export const DRIVE_PAGE_SIZE = 100;
export const DRIVE_LIST_FIELDS = 'nextPageToken, files(id, name, mimeType, modifiedTime)';
/** Newest first — the order the list renders without offering sorting options. */
export const DRIVE_LIST_ORDER = 'modifiedTime desc';

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

export interface DrivePage {
  files: DriveFileMeta[];
  nextPageToken?: string;
}

/**
 * Every solna project this app can see, wherever it lives. A CONSTANT, not a
 * function of a folder: under `drive.file` the listing already contains only
 * files this app created, so there is nothing to narrow — and narrowing by
 * `'root' in parents` would hide a project the moment the user filed it into a
 * folder from Drive's own UI, while Save carried on overwriting it by id.
 *
 * `trashed = false` because Drive keeps deleted files listable for 30 days and
 * a trashed row in an open dialog reads as a bug.
 */
export const DRIVE_LIST_QUERY = `mimeType = '${SOLNA_DRIVE_MIME}' and trashed = false`;

/**
 * The injected seam. Everything Google-shaped lives behind it — `gapi`'s
 * request envelope, the multipart upload framing, the token header — so this
 * file's tests are a five-line stub and Task 11's are about Google alone.
 */
export interface DriveTransport {
  list(params: {
    q: string;
    pageSize: number;
    orderBy: string;
    fields: string;
    pageToken?: string;
  }): Promise<DrivePage>;
  readText(fileId: string): Promise<string>;
  create(params: { name: string; mimeType: string; text: string }): Promise<DriveFileMeta>;
  update(params: { fileId: string; mimeType: string; text: string }): Promise<DriveFileMeta>;
}

export interface DriveClient {
  listProjects(pageToken?: string): Promise<DrivePage>;
  /** Reads a Drive file and runs it through the SAME parser a local open uses. */
  readProject(fileId: string): Promise<ProjectParseResult>;
  createProject(name: string, body: ProjectBody): Promise<DriveFileMeta>;
  updateProject(fileId: string, body: ProjectBody): Promise<DriveFileMeta>;
}

export function createDriveClient(transport: DriveTransport): DriveClient {
  return {
    listProjects: (pageToken) =>
      transport.list({
        q: DRIVE_LIST_QUERY,
        pageSize: DRIVE_PAGE_SIZE,
        orderBy: DRIVE_LIST_ORDER,
        fields: DRIVE_LIST_FIELDS,
        // Omitted rather than sent empty: gapi would serialise an empty string
        // as a page token and Drive answers that with a 400.
        ...(pageToken ? { pageToken } : {}),
      }),

    readProject: async (fileId) => parseProjectFile(await transport.readText(fileId)),

    // No `parents`: Drive's own default is My Drive, and any folder id this app
    // could name would be one `drive.file` cannot see.
    createProject: (name, body) =>
      transport.create({
        name: projectFileName(name),
        mimeType: SOLNA_DRIVE_MIME,
        text: serializeProject(body),
      }),

    updateProject: (fileId, body) =>
      transport.update({ fileId, mimeType: SOLNA_DRIVE_MIME, text: serializeProject(body) }),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/driveClient.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/driveClient.ts src/store/driveClient.test.ts
git commit -m "feat(drive): add the Drive v3 operation layer

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 11: The gapi adapter (multipart + request mapping)

**Files:**
- Create: `src/store/driveGapi.ts`
- Test: `src/store/driveGapi.test.ts`

**Interfaces:**
- Consumes: `GapiClient`, `GapiRequest`, `GapiRoot` from `../utils/googleScriptLoader`; `DriveAuth`, `DriveUnavailableError`, `withDriveToken` from `./driveAuth`; `DriveFileMeta`, `DrivePage`, `DriveTransport` from `./driveClient`.
- Produces:
  - `const DRIVE_API_BASE = 'https://www.googleapis.com'`, `DRIVE_FILES_PATH = '/drive/v3/files'`, `DRIVE_UPLOAD_PATH = '/upload/drive/v3/files'`, `DRIVE_BOUNDARY = 'solna-drive-boundary'`
  - `const DRIVE_META_FIELDS = 'id, name, mimeType, modifiedTime'`
  - `function multipartBody(parts, boundary?): string`
  - `function createFileBody(metadata: { name; mimeType; parents }, text: string, boundary?): string`
  - `function updateFileBody(text: string, mimeType: string, boundary?): string`
  - `function toDriveFileMeta(result: unknown): DriveFileMeta | null`
  - `function toDrivePage(result: unknown): DrivePage`
  - `function readResultText(result: unknown): string`
  - `function createGapiTransport(getGapi: () => Promise<GapiRoot>, auth: DriveAuth): DriveTransport`

**Deliberate narrowness:** `toDriveFileMeta` requires only an `id`. Drive returns exactly the fields `fields=` asked for, and a lenient echo means a `files.update` whose response omitted a display field cannot be mistaken for a failed save — the write already happened by then. An echo with no `id` at all IS unreadable, and the transport throws rather than handing back a record a Save As would adopt as "nowhere".

- [ ] **Step 1: Write the failing test**

Create `src/store/driveGapi.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  DRIVE_API_BASE,
  DRIVE_BOUNDARY,
  DRIVE_FILES_PATH,
  DRIVE_UPLOAD_PATH,
  createFileBody,
  createGapiTransport,
  multipartBody,
  readResultText,
  toDriveFileMeta,
  toDrivePage,
  updateFileBody,
} from './driveGapi';
import { DriveUnavailableError, driveErrorMessage, type DriveAuth } from './driveAuth';
import { DRIVE_LIST_FIELDS, DRIVE_LIST_ORDER, DRIVE_LIST_QUERY, SOLNA_DRIVE_MIME } from './driveClient';
import type { GapiRequest, GapiResponse, GapiRoot } from '../utils/googleScriptLoader';

function fakeGapi(requestImpl?: (request: GapiRequest) => Promise<GapiResponse>) {
  const calls: GapiRequest[] = [];
  const tokens: Array<{ access_token: string } | null> = [];
  const root: GapiRoot = {
    load: (_name, callback) => callback(),
    client: {
      setToken: (token) => {
        tokens.push(token);
      },
      request: async (request) => {
        calls.push(request);
        return requestImpl ? requestImpl(request) : { result: null };
      },
    },
  };
  return { root, calls, tokens };
}

function fakeAuth() {
  const state = { issued: 0, invalidated: 0, value: 'token-1' };
  const auth: DriveAuth = {
    token: async () => {
      state.issued++;
      return state.value;
    },
    invalidate: () => {
      state.invalidated++;
      state.value = 'token-2';
    },
    revoke: async () => {},
    signedIn: () => true,
  };
  return { auth, state };
}

describe('multipartBody', () => {
  test('frames each part and terminates with the boundary', () => {
    expect(multipartBody([{ contentType: 'application/json', body: '{"a":1}' }])).toBe(
      [
        `--${DRIVE_BOUNDARY}`,
        'Content-Type: application/json',
        '',
        '{"a":1}',
        `--${DRIVE_BOUNDARY}--`,
      ].join('\r\n'),
    );
  });
});

describe('createFileBody', () => {
  test('carries metadata first and media second', () => {
    const body = createFileBody({ name: 'sketch.solna', mimeType: SOLNA_DRIVE_MIME, parents: ['root'] }, '{"v":1}');
    expect(body).toBe(
      [
        `--${DRIVE_BOUNDARY}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        '{"name":"sketch.solna","mimeType":"application/vnd.solna","parents":["root"]}',
        `--${DRIVE_BOUNDARY}`,
        `Content-Type: ${SOLNA_DRIVE_MIME}`,
        '',
        '{"v":1}',
        `--${DRIVE_BOUNDARY}--`,
      ].join('\r\n'),
    );
  });
});

describe('updateFileBody', () => {
  test('carries media only — the metadata already exists on the file', () => {
    expect(updateFileBody('{"v":2}', SOLNA_DRIVE_MIME)).toBe(
      [`--${DRIVE_BOUNDARY}`, `Content-Type: ${SOLNA_DRIVE_MIME}`, '', '{"v":2}', `--${DRIVE_BOUNDARY}--`].join('\r\n'),
    );
  });
});

describe('readResultText', () => {
  test('prefers response.body — the shape a real vnd.solna media read returns', () => {
    // gapi does not parse a content type it does not know, so `result` is
    // `false` and the bytes are in `body`. A transport that read `result` only
    // would turn every Drive open into "not a Solna project".
    expect(readResultText({ result: false, body: '{"a":1}' })).toBe('{"a":1}');
  });

  test('falls back to a parsed object, and to a raw string', () => {
    expect(readResultText({ result: { a: 1 } })).toBe('{"a":1}');
    expect(readResultText({ result: '{"a":1}' })).toBe('{"a":1}');
  });

  test('an empty or unreadable response is an empty string', () => {
    expect(readResultText({ result: null })).toBe('');
    expect(readResultText(undefined)).toBe('');
    expect(readResultText({ result: 7 })).toBe('');
  });
});

describe('toDriveFileMeta', () => {
  test('keeps a full record', () => {
    const meta = { id: 'f1', name: 'a.solna', mimeType: SOLNA_DRIVE_MIME, modifiedTime: '2026-09-12T00:00:00.000Z' };
    expect(toDriveFileMeta(meta)).toEqual(meta);
  });

  test('fills in fields Drive did not echo, so a successful write is not read as a failure', () => {
    expect(toDriveFileMeta({ id: 'f1' })).toEqual({ id: 'f1', name: '', mimeType: '', modifiedTime: '' });
  });

  test('a record with no id is unreadable', () => {
    expect(toDriveFileMeta({ name: 'a.solna' })).toBeNull();
    expect(toDriveFileMeta('nope')).toBeNull();
  });
});

describe('toDrivePage', () => {
  test('drops rows with no id and keeps the rest', () => {
    const page = toDrivePage({ files: [{ id: 'f1', name: 'a' }, { name: 'broken' }, 'junk'] });
    expect(page.files).toHaveLength(1);
    expect(page.files[0].id).toBe('f1');
  });

  test('keeps nextPageToken only when it is a string', () => {
    expect(toDrivePage({ files: [], nextPageToken: 'p2' }).nextPageToken).toBe('p2');
    expect(toDrivePage({ files: [], nextPageToken: 7 }).nextPageToken).toBeUndefined();
    expect(toDrivePage(undefined).files).toEqual([]);
  });
});

describe('createGapiTransport', () => {
  test('lists through the files endpoint with the solna query, as strings', async () => {
    const gapi = fakeGapi(async () => ({ result: { files: [{ id: 'f1', name: 'a.solna' }] } }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    const page = await transport.list({ q: DRIVE_LIST_QUERY, pageSize: 100, orderBy: DRIVE_LIST_ORDER, fields: DRIVE_LIST_FIELDS });

    expect(gapi.tokens).toEqual([{ access_token: 'token-1' }]);
    expect(gapi.calls[0].path).toBe(`${DRIVE_API_BASE}${DRIVE_FILES_PATH}`);
    expect(gapi.calls[0].method).toBe('GET');
    expect(gapi.calls[0].params).toMatchObject({
      q: DRIVE_LIST_QUERY,
      pageSize: '100',
      orderBy: DRIVE_LIST_ORDER,
      fields: DRIVE_LIST_FIELDS,
    });
    expect(gapi.calls[0].params?.pageToken).toBeUndefined();
    expect(page.files[0].id).toBe('f1');
  });

  test('forwards a page token only when one was given', async () => {
    const gapi = fakeGapi();
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    await transport.list({ q: 'q', pageSize: 100, orderBy: 'o', fields: 'f', pageToken: 'p2' });
    expect(gapi.calls[0].params?.pageToken).toBe('p2');
  });

  test('reads media with alt=media and hands back the text gapi could not parse', async () => {
    // The realistic shape: an unparsed body for a vnd.solna content type.
    const gapi = fakeGapi(async () => ({ result: false, body: '{"v":3}' }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    expect(await transport.readText('file-9')).toBe('{"v":3}');
    expect(gapi.calls[0].path).toBe(`${DRIVE_API_BASE}${DRIVE_FILES_PATH}/file-9`);
    expect(gapi.calls[0].params).toEqual({ alt: 'media' });
  });

  test('creates with a multipart upload carrying metadata and media', async () => {
    const gapi = fakeGapi(async () => ({ result: { id: 'new-1', name: 'a.solna', mimeType: SOLNA_DRIVE_MIME, modifiedTime: 'x' } }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    const created = await transport.create({ name: 'a.solna', mimeType: SOLNA_DRIVE_MIME, text: '{"v":1}', parents: ['root'] });

    expect(gapi.calls[0].path).toBe(`${DRIVE_API_BASE}${DRIVE_UPLOAD_PATH}`);
    expect(gapi.calls[0].method).toBe('POST');
    expect(gapi.calls[0].params?.uploadType).toBe('multipart');
    expect(gapi.calls[0].headers?.['Content-Type']).toBe(`multipart/related; boundary=${DRIVE_BOUNDARY}`);
    expect(gapi.calls[0].body).toContain('{"name":"a.solna"');
    expect(gapi.calls[0].body).toContain('{"v":1}');
    expect(created.id).toBe('new-1');
  });

  test('updates with a PATCH to the file path and a media-only body', async () => {
    const gapi = fakeGapi(async () => ({ result: { id: 'file-9' } }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    const updated = await transport.update({ fileId: 'file-9', mimeType: SOLNA_DRIVE_MIME, text: '{"v":2}' });

    expect(gapi.calls[0].path).toBe(`${DRIVE_API_BASE}${DRIVE_UPLOAD_PATH}/file-9`);
    expect(gapi.calls[0].method).toBe('PATCH');
    expect(gapi.calls[0].body).not.toContain('"name"');
    expect(updated).toEqual({ id: 'file-9', name: '', mimeType: '', modifiedTime: '' });
  });

  test('an echo with no id is thrown, not returned as a half record', async () => {
    const gapi = fakeGapi(async () => ({ result: { name: 'a.solna' } }));
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    await expect(transport.update({ fileId: 'f', mimeType: SOLNA_DRIVE_MIME, text: '{}' })).rejects.toThrow(
      'Drive returned a file record with no id',
    );
  });

  test('a 401 is retried once with a fresh token', async () => {
    let attempts = 0;
    const gapi = fakeGapi(async () => {
      attempts++;
      if (attempts === 1) throw { status: 401 };
      return { result: { files: [] } };
    });
    const { auth, state } = fakeAuth();
    const transport = createGapiTransport(async () => gapi.root, auth);
    await transport.list({ q: 'q', pageSize: 100, orderBy: 'o', fields: 'f' });
    expect(attempts).toBe(2);
    expect(state.invalidated).toBe(1);
    expect(gapi.tokens).toEqual([{ access_token: 'token-1' }, { access_token: 'token-2' }]);
  });

  test('a gapi client that will not load fails with the unavailable sentence', async () => {
    const { auth } = fakeAuth();
    const transport = createGapiTransport(async () => {
      throw new DriveUnavailableError();
    }, auth);
    const err = await transport.list({ q: 'q', pageSize: 100, orderBy: 'o', fields: 'f' }).catch((thrown: unknown) => thrown);
    expect(driveErrorMessage(err)).toBe(
      'Could not load the Google Drive client. Check your connection and try again.',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/driveGapi.test.ts`
Expected: FAIL — `Cannot find module './driveGapi'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/driveGapi.ts`:

```ts
import type { GapiClient, GapiRequest, GapiRoot } from '../utils/googleScriptLoader';
import { DriveUnavailableError, withDriveToken, type DriveAuth } from './driveAuth';
import type { DriveFileMeta, DrivePage, DriveTransport } from './driveClient';

/**
 * Absolute paths, not discovery documents: `gapi.client.request` accepts a full
 * URL, and `gapi.client.drive` would need `gapi.client.init` against Drive's
 * discovery doc — an extra load for four endpoints whose paths are fixed.
 */
export const DRIVE_API_BASE = 'https://www.googleapis.com';
export const DRIVE_FILES_PATH = '/drive/v3/files';
export const DRIVE_UPLOAD_PATH = '/upload/drive/v3/files';
export const DRIVE_BOUNDARY = 'solna-drive-boundary';
export const DRIVE_META_FIELDS = 'id, name, mimeType, modifiedTime';

export interface MultipartPart {
  contentType: string;
  body: string;
}

/**
 * A `multipart/related` body. The CRLF framing is not cosmetic — Drive's parser
 * rejects a body whose boundary lines are not CRLF-terminated, and a template
 * literal is the only place this is written.
 */
export function multipartBody(parts: ReadonlyArray<MultipartPart>, boundary: string = DRIVE_BOUNDARY): string {
  const chunks = parts.map((part) => `--${boundary}\r\nContent-Type: ${part.contentType}\r\n\r\n${part.body}\r\n`);
  return `${chunks.join('')}--${boundary}--`;
}

/** Create: metadata first (it names the file), media second. */
export function createFileBody(
  metadata: { name: string; mimeType: string; parents: string[] },
  text: string,
  boundary: string = DRIVE_BOUNDARY,
): string {
  return multipartBody(
    [
      { contentType: 'application/json; charset=UTF-8', body: JSON.stringify(metadata) },
      { contentType: metadata.mimeType, body: text },
    ],
    boundary,
  );
}

/** Update: media only. The name and parents already exist on the file. */
export function updateFileBody(text: string, mimeType: string, boundary: string = DRIVE_BOUNDARY): string {
  return multipartBody([{ contentType: mimeType, body: text }], boundary);
}

/**
 * Only an `id` is required — Drive echoes exactly the fields `fields=` asked
 * for, and treating a missing display field as a failure would report a
 * successful write as an error. A record with no id IS unreadable: a Save As
 * that adopted it would have nowhere to write.
 */
export function toDriveFileMeta(result: unknown): DriveFileMeta | null {
  if (typeof result !== 'object' || result === null) return null;
  const raw = result as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '',
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : '',
    modifiedTime: typeof raw.modifiedTime === 'string' ? raw.modifiedTime : '',
  };
}

/** The listing's result envelope, guarded: a malformed row is dropped, never trusted. */
export function toDrivePage(result: unknown): DrivePage {
  const raw = (result ?? {}) as { files?: unknown; nextPageToken?: unknown };
  const rows = Array.isArray(raw.files) ? raw.files : [];
  const files = rows.map(toDriveFileMeta).filter((meta): meta is DriveFileMeta => meta !== null);
  return typeof raw.nextPageToken === 'string' ? { files, nextPageToken: raw.nextPageToken } : { files };
}

/**
 * Three shapes, one string, because gapi's answer for `alt: 'media'` depends on
 * a content type this app chose to be unusual:
 *
 * - `application/vnd.solna` is not JSON as far as gapi is concerned, so it does
 *   not parse it: `result` is `false` and the bytes are in `response.body`.
 *   THIS is the real path, and reading only `result` reports every Drive open
 *   as a malformed project.
 * - A proxy or a future gapi that does parse it hands back an object.
 * - A plain string is what a hand-written stub returns.
 *
 * All three are accepted rather than losing the project; anything else is ''.
 */
export function readResultText(response: GapiResponse | unknown): string {
  const shaped = response as GapiResponse | null | undefined;
  if (typeof shaped?.body === 'string' && shaped.body.length > 0) return shaped.body;
  const result = shaped?.result;
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && result !== null) return JSON.stringify(result);
  return '';
}

function requireMeta(result: unknown): DriveFileMeta {
  const meta = toDriveFileMeta(result);
  if (!meta) throw new Error('Drive returned a file record with no id');
  return meta;
}

/**
 * The one place a token, a request envelope and Google's error shape meet. Every
 * call goes through `withDriveToken`, so a stale token is retried exactly once
 * wherever it surfaces.
 */
export function createGapiTransport(getGapi: () => Promise<GapiRoot>, auth: DriveAuth): DriveTransport {
  const run = <T>(op: (client: GapiClient) => Promise<T>): Promise<T> =>
    withDriveToken(auth, async (token) => {
      const gapi = await getGapi();
      // gapi carries the token on the client, not per request: set it before
      // every call rather than once at sign-in, because a retry is a new token.
      gapi.client.setToken({ access_token: token });
      return op(gapi.client);
    });

  return {
    list: (params) =>
      run(async (client) => {
        const response = await client.request({
          path: `${DRIVE_API_BASE}${DRIVE_FILES_PATH}`,
          method: 'GET',
          params: {
            q: params.q,
            pageSize: String(params.pageSize),
            orderBy: params.orderBy,
            fields: params.fields,
            ...(params.pageToken ? { pageToken: params.pageToken } : {}),
          },
        });
        return toDrivePage(response.result);
      }),

    readText: (fileId) =>
      run(async (client) => {
        const response = await client.request({
          path: `${DRIVE_API_BASE}${DRIVE_FILES_PATH}/${fileId}`,
          method: 'GET',
          params: { alt: 'media' },
        });
        // The WHOLE response, not `.result` — see readResultText.
        return readResultText(response);
      }),

    create: (params) =>
      run(async (client) => {
        const request: GapiRequest = {
          path: `${DRIVE_API_BASE}${DRIVE_UPLOAD_PATH}`,
          method: 'POST',
          params: { uploadType: 'multipart', fields: DRIVE_META_FIELDS },
          headers: { 'Content-Type': `multipart/related; boundary=${DRIVE_BOUNDARY}` },
          body: createFileBody(
            { name: params.name, mimeType: params.mimeType, parents: params.parents },
            params.text,
          ),
        };
        return requireMeta((await client.request(request)).result);
      }),

    update: (params) =>
      run(async (client) => {
        const request: GapiRequest = {
          path: `${DRIVE_API_BASE}${DRIVE_UPLOAD_PATH}/${params.fileId}`,
          method: 'PATCH',
          params: { uploadType: 'multipart', fields: DRIVE_META_FIELDS },
          headers: { 'Content-Type': `multipart/related; boundary=${DRIVE_BOUNDARY}` },
          body: updateFileBody(params.text, params.mimeType),
        };
        return requireMeta((await client.request(request)).result);
      }),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/driveGapi.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/driveGapi.ts src/store/driveGapi.test.ts
git commit -m "feat(drive): add the gapi transport with multipart uploads

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 12: The Drive project list's pure helpers

**Files:**
- Create: `src/utils/driveBrowser.ts`
- Test: `src/utils/driveBrowser.test.ts`

**Interfaces:**
- Consumes: `SOLNA_DRIVE_MIME` and the `DriveFileMeta` / `DrivePage` types from `../store/driveClient`.
- Produces:
  - `interface DriveBrowserRow { id: string; name: string; modifiedTime: string }`
  - `type DriveListOutcome = { ok: true; page: DrivePage } | { ok: false; message: string }` — the shape both the modal and the drive slice use, so neither imports the other
  - `function toBrowserRows(files: ReadonlyArray<DriveFileMeta>): DriveBrowserRow[]`
  - `function sortBrowserRows(rows: ReadonlyArray<DriveBrowserRow>): DriveBrowserRow[]`
  - `function appendPage(current: DrivePage, next: DrivePage): DrivePage`
  - `function formatModified(iso: string): string`
  - `function defaultSaveName(projectName: string | null): string`
  - `const DRIVE_EMPTY_STATE`, `DRIVE_EMPTY_HINT`, `DRIVE_LOADING_TEXT`, `DRIVE_OPEN_TITLE`, `DRIVE_SAVE_TITLE`

**No crumbs, no folders, no drill-in** — see Task 10 for why `drive.file` makes them unbuildable. A row is a project, the list is flat, and `DriveBrowserRow` has no `kind` because there is only one kind.

**On importing from `src/store/`:** `src/utils/` importing `src/store/` is not restricted by `eslint.config.js` (no rule targets `src/utils/**`), and there is no cycle — `driveClient.ts` imports `utils/projectFileIO`, which imports nothing. The alternative is duplicating the MIME string, which the design names as a contract.

- [ ] **Step 1: Write the failing test**

Create `src/utils/driveBrowser.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  DRIVE_EMPTY_HINT,
  DRIVE_EMPTY_STATE,
  DRIVE_LOADING_TEXT,
  appendPage,
  defaultSaveName,
  formatModified,
  sortBrowserRows,
  toBrowserRows,
} from './driveBrowser';
import { SOLNA_DRIVE_MIME, type DriveFileMeta } from '../store/driveClient';

const meta = (
  id: string,
  name: string,
  modifiedTime: string,
  mimeType: string = SOLNA_DRIVE_MIME,
): DriveFileMeta => ({ id, name, modifiedTime, mimeType });

describe('toBrowserRows', () => {
  test('keeps solna projects and drops anything else', () => {
    const rows = toBrowserRows([
      meta('f1', 'a.solna', '2026-09-02T00:00:00.000Z'),
      meta('x1', 'notes.txt', '2026-09-03T00:00:00.000Z', 'text/plain'),
      // A folder cannot appear under `drive.file` unless this app created one,
      // which it never does — but a row that is not a project is dropped rather
      // than rendered as a button that does nothing.
      meta('d1', 'Sketches', '2026-09-01T00:00:00.000Z', 'application/vnd.google-apps.folder'),
    ]);
    expect(rows.map((row) => row.name)).toEqual(['a.solna']);
  });
});

describe('sortBrowserRows', () => {
  test('newest first, without mutating the input', () => {
    const rows = toBrowserRows([
      meta('f1', 'older.solna', '2026-09-01T00:00:00.000Z'),
      meta('f2', 'newer.solna', '2026-09-05T00:00:00.000Z'),
    ]);
    expect(sortBrowserRows(rows).map((row) => row.id)).toEqual(['f2', 'f1']);
    expect(rows.map((row) => row.id)).toEqual(['f1', 'f2']);
  });

  test('two files with the same timestamp fall back to name order, so the list is stable', () => {
    const rows = toBrowserRows([
      meta('f2', 'b.solna', '2026-09-01T00:00:00.000Z'),
      meta('f1', 'a.solna', '2026-09-01T00:00:00.000Z'),
    ]);
    expect(sortBrowserRows(rows).map((row) => row.id)).toEqual(['f1', 'f2']);
  });
});

describe('appendPage', () => {
  test('accumulates rows and carries the new token', () => {
    const first = { files: [meta('f1', 'a.solna', '2026-09-01T00:00:00.000Z')], nextPageToken: 'p2' };
    const second = { files: [meta('f2', 'b.solna', '2026-09-02T00:00:00.000Z')] };
    const merged = appendPage(first, second);
    expect(merged.files.map((file) => file.id)).toEqual(['f1', 'f2']);
    expect(merged.nextPageToken).toBeUndefined();
  });

  test('a file that appears on both pages is kept once — a save can shift the window', () => {
    const first = { files: [meta('f1', 'a.solna', '2026-09-01T00:00:00.000Z')], nextPageToken: 'p2' };
    const second = { files: [meta('f1', 'a.solna', '2026-09-01T00:00:00.000Z'), meta('f2', 'b.solna', '2026-09-02T00:00:00.000Z')] };
    expect(appendPage(first, second).files.map((file) => file.id)).toEqual(['f1', 'f2']);
  });

  test('a later page wins for a repeated id', () => {
    const first = { files: [meta('f1', 'old name.solna', '2026-09-01T00:00:00.000Z')], nextPageToken: 'p2' };
    const second = { files: [meta('f1', 'new name.solna', '2026-09-02T00:00:00.000Z')] };
    expect(appendPage(first, second).files[0].name).toBe('new name.solna');
  });
});

describe('formatModified', () => {
  test('renders the date part of an ISO timestamp, and a dash for anything unusable', () => {
    expect(formatModified('2026-09-12T10:00:00.000Z')).toBe('2026-09-12');
    expect(formatModified('')).toBe('—');
    expect(formatModified('2026-09')).toBe('—');
  });
});

describe('defaultSaveName', () => {
  test('uses the project name, and untitled when there is none', () => {
    expect(defaultSaveName('My Sketch')).toBe('My Sketch');
    expect(defaultSaveName('   ')).toBe('untitled');
    expect(defaultSaveName(null)).toBe('untitled');
  });
});

describe('the copy', () => {
  test('the empty state is a statement, and names the one thing it cannot show', () => {
    expect(DRIVE_EMPTY_STATE).toBe('No Solna projects in your Drive yet.');
    // The hint is not decoration: `drive.file` hides every file solna did not
    // create, so a user looking at an empty list with their own .solna sitting
    // in Drive needs to be told why, and what to do instead.
    expect(DRIVE_EMPTY_HINT).toBe(
      'Solna only sees files it created here. To open a .solna from somewhere else, download it and use Open .solna.',
    );
    expect(DRIVE_LOADING_TEXT).toBe('Loading…');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/driveBrowser.test.ts`
Expected: FAIL — `Cannot find module './driveBrowser'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/driveBrowser.ts`:

```ts
import { SOLNA_DRIVE_MIME, type DriveFileMeta, type DrivePage } from '../store/driveClient';

/**
 * One row per project. There is deliberately no `kind` and no folder crumb:
 * `drive.file` cannot see a folder this app did not create, so a folder row
 * could never be produced and a breadcrumb could never be navigated. See
 * Task 10 / the design's scope section before adding either back.
 */
export interface DriveBrowserRow {
  id: string;
  name: string;
  modifiedTime: string;
}

/**
 * What a listing call resolves to. It lives here, with the list helpers, so the
 * modal and the drive slice can agree on it without either importing the other.
 */
export type DriveListOutcome = { ok: true; page: DrivePage } | { ok: false; message: string };

export const DRIVE_EMPTY_STATE = 'No Solna projects in your Drive yet.';
/** Why the list may look empty when the user can see a .solna in Drive themselves. */
export const DRIVE_EMPTY_HINT =
  'Solna only sees files it created here. To open a .solna from somewhere else, download it and use Open .solna.';
export const DRIVE_LOADING_TEXT = 'Loading…';
export const DRIVE_OPEN_TITLE = 'Open from Google Drive';
export const DRIVE_SAVE_TITLE = 'Save to Google Drive';

/**
 * The listing's `q` asks for the solna MIME alone, so another type is not an
 * expected case — but a row that is not a project is not openable, and
 * rendering it would be a button that does nothing. It is dropped, and the row
 * count is the only thing that changes.
 */
export function toBrowserRows(files: ReadonlyArray<DriveFileMeta>): DriveBrowserRow[] {
  return files
    .filter((file) => file.mimeType === SOLNA_DRIVE_MIME)
    .map((file) => ({ id: file.id, name: file.name, modifiedTime: file.modifiedTime }));
}

/**
 * Newest first, then name — deliberately the SAME order DRIVE_LIST_ORDER asks
 * Drive for. The client sorts anyway because it is the only side that sees a
 * paginated list whole: page 2 may hold a file newer than anything on page 1,
 * and rendering pages in arrival order would strand it behind a "Load more".
 *
 * ISO-8601 strings compare lexicographically as timestamps, so no Date parsing
 * and no timezone involvement. The name tiebreaker is what makes the order
 * stable for two files saved in the same second.
 */
export function sortBrowserRows(rows: ReadonlyArray<DriveBrowserRow>): DriveBrowserRow[] {
  return [...rows].sort((a, b) => {
    if (a.modifiedTime !== b.modifiedTime) return a.modifiedTime < b.modifiedTime ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Pages are appended, not replaced, and keyed by id: a save between two listings
 * can shift the window so a file appears on both pages, and a duplicate key in
 * a React list is a warning plus a stale row. The later page wins, because it
 * was fetched later.
 */
export function appendPage(current: DrivePage, next: DrivePage): DrivePage {
  const byId = new Map<string, DriveFileMeta>();
  for (const file of [...current.files, ...next.files]) byId.set(file.id, file);
  const files = [...byId.values()];
  return next.nextPageToken === undefined ? { files } : { files, nextPageToken: next.nextPageToken };
}

/**
 * The date part of Drive's RFC 3339 timestamp, UTC and locale-free: a rendered
 * date that depended on the machine's locale or timezone would make the markup
 * test non-deterministic, and the time of day is noise in a file list.
 */
export function formatModified(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : '—';
}

/**
 * Save As's starting name. NOT slugified here: the modal collects a name a
 * person typed, and `createProject` runs it through `projectFileName`, so the
 * slug rule stays in one place.
 */
export function defaultSaveName(projectName: string | null): string {
  const trimmed = (projectName ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'untitled';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/utils/driveBrowser.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/driveBrowser.ts src/utils/driveBrowser.test.ts
git commit -m "feat(drive): add the project list's pure helpers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 13: The Drive project list modal

**Files:**
- Create: `src/components/project/DriveFileBrowserModal.tsx`
- Test: `src/components/project/DriveFileBrowserModal.test.tsx`

**Interfaces:**
- Consumes: `Modal` from `../ui/Modal`; the Task 12 helpers; `DriveFileMeta`, `DrivePage` types from `@/store/driveClient`.
- Produces:
  - `interface DriveFileBrowserModalProps { open; mode: 'open' | 'save-as'; signedIn; initialName; onClose; onConnect; onList; onOpenFile; onSaveAs }`
  - `function browserTitle(mode: 'open' | 'save-as'): string`
  - `function DriveBrowserList({ rows, onOpen }: { rows: DriveBrowserRow[]; onOpen: (fileId: string) => void })`
  - `function DriveFileBrowserModal(props: DriveFileBrowserModalProps)`

**`initialName` is required with no default**, and it lands here rather than in Task 16 because the field is this component's state: a Save As whose name field starts empty asks the user to retype a name the app already knows, and a prop with a default is a call site that can forget it and still look right.

**Presentational by construction:** every Drive call is a prop. The modal never reads the store, so its test needs no `useLiveStore` and no `getServerSnapshot` workaround — and the parent (Task 16) is the only place that knows about the slice.

**`onList` must be referentially stable.** It is in the effect's dependency list; an inline arrow from the parent would re-list on every render. Task 16 wraps it in `useCallback` — do not skip that there.

**`loading` starts `true`, and that is a correctness requirement rather than a preference.** The first listing is kicked off by an effect, `renderToString` runs no effects, and a `useState(false)` would render a modal that says nothing at all on first paint — an empty list that has not been fetched is indistinguishable from an empty Drive. Starting `true` is also the only way the markup test can assert the loading line at all.

- [ ] **Step 1: Write the failing test**

Create `src/components/project/DriveFileBrowserModal.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import {
  DriveBrowserList,
  DriveFileBrowserModal,
  browserTitle,
  type DriveFileBrowserModalProps,
} from './DriveFileBrowserModal';
import { DRIVE_EMPTY_STATE, DRIVE_LOADING_TEXT, toBrowserRows, sortBrowserRows } from '@/utils/driveBrowser';
import { SOLNA_DRIVE_MIME, type DriveFileMeta } from '@/store/driveClient';

const meta = (id: string, name: string, modifiedTime: string, mimeType = SOLNA_DRIVE_MIME): DriveFileMeta => ({
  id,
  name,
  modifiedTime,
  mimeType,
});

const props = (overrides: Partial<DriveFileBrowserModalProps> = {}): DriveFileBrowserModalProps => ({
  open: true,
  mode: 'open',
  signedIn: true,
  initialName: 'Sketch',
  onClose: () => {},
  onConnect: () => {},
  onList: async () => ({ ok: true, page: { files: [] } }),
  onOpenFile: () => {},
  onSaveAs: () => {},
  ...overrides,
});

describe('browserTitle', () => {
  test('names the two modes differently', () => {
    expect(browserTitle('open')).toBe('Open from Google Drive');
    expect(browserTitle('save-as')).toBe('Save to Google Drive');
  });
});

describe('DriveBrowserList', () => {
  const rows = sortBrowserRows(
    toBrowserRows([
      meta('f1', 'older.solna', '2026-09-01T00:00:00.000Z'),
      meta('f2', 'newer.solna', '2026-09-05T00:00:00.000Z'),
    ]),
  );

  test('renders a row per project, newest first', () => {
    const html = renderToString(<DriveBrowserList rows={rows} onOpen={() => {}} />);
    expect(html).toContain('newer.solna');
    expect(html.indexOf('newer.solna')).toBeLessThan(html.indexOf('older.solna'));
  });

  test('shows each row a date, and the empty state when there are none', () => {
    expect(renderToString(<DriveBrowserList rows={rows} onOpen={() => {}} />)).toContain('2026-09-05');
    const empty = renderToString(<DriveBrowserList rows={[]} onOpen={() => {}} />);
    expect(empty).toContain(DRIVE_EMPTY_STATE);
    // The hint is part of the empty state, not a separate feature: without it an
    // empty list looks like a bug to a user who can see their own .solna in Drive.
    expect(empty).toContain('download it and use Open .solna');
  });
});

describe('DriveFileBrowserModal', () => {
  test('signed out: offers to connect and lists nothing', () => {
    const html = renderToString(<DriveFileBrowserModal {...props({ signedIn: false })} />);
    expect(html).toContain('Connect Google Drive');
    expect(html).not.toContain(DRIVE_EMPTY_STATE);
  });

  test('signed in: shows the loading line before the first page lands', () => {
    // renderToString runs no effects, so this is the component's INITIAL state.
    // It is also why `loading` starts true: an unfetched empty list must not
    // render as "you have no projects".
    const html = renderToString(<DriveFileBrowserModal {...props()} />);
    expect(html).toContain(DRIVE_LOADING_TEXT);
    expect(html).not.toContain(DRIVE_EMPTY_STATE);
    expect(html).not.toContain('Connect Google Drive');
  });

  test('open mode has no file-name field; save-as mode does, seeded from the project', () => {
    const open = renderToString(<DriveFileBrowserModal {...props({ mode: 'open' })} />);
    expect(open).not.toContain('File name');
    const saveAs = renderToString(<DriveFileBrowserModal {...props({ mode: 'save-as' })} />);
    expect(saveAs).toContain('File name');
    expect(saveAs).toContain('value="Sketch"');
    expect(saveAs).toContain('Save to Drive');
  });

  // NOT "a closed modal renders nothing": the shared Modal always renders its
  // children inside a <dialog class="modal"> and only the `open` ATTRIBUTE is
  // toggled, by an effect that renderToString never runs. Asserting the shared
  // chrome is therefore the honest test of the closed case — see
  // src/components/ui/Modal.test.tsx, which pins the same class string.
  test('a closed modal still renders the shared box chrome, without modal-open', () => {
    const html = renderToString(<DriveFileBrowserModal {...props({ open: false })} />);
    expect(html).toContain('class="modal"');
    expect(html).toContain('modal-box bg-base-100 border border-base-300 shadow-2xl max-w-2xl space-y-3');
    expect(html).not.toContain('modal-open');
  });
});
```


- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/components/project/DriveFileBrowserModal.test.tsx`
Expected: FAIL — `Cannot find module './DriveFileBrowserModal'`.

- [ ] **Step 3: Write the implementation**

Create `src/components/project/DriveFileBrowserModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import type { DrivePage } from '@/store/driveClient';
import {
  DRIVE_EMPTY_HINT,
  DRIVE_EMPTY_STATE,
  DRIVE_LOADING_TEXT,
  DRIVE_OPEN_TITLE,
  DRIVE_SAVE_TITLE,
  appendPage,
  formatModified,
  sortBrowserRows,
  toBrowserRows,
  type DriveBrowserRow,
  type DriveListOutcome,
} from '@/utils/driveBrowser';
import { Modal } from '../ui/Modal';

export function browserTitle(mode: 'open' | 'save-as'): string {
  return mode === 'save-as' ? DRIVE_SAVE_TITLE : DRIVE_OPEN_TITLE;
}

/**
 * Pure props-to-markup, so it can be rendered and asserted on without a Drive
 * call in sight. The row list is ALREADY sorted by the caller — one order, one
 * place, and `renderToString` can then prove the order in the markup.
 */
export function DriveBrowserList({
  rows,
  onOpen,
}: {
  rows: DriveBrowserRow[];
  onOpen: (fileId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="py-6 text-center space-y-1">
        <p className="text-xs text-base-content/60">{DRIVE_EMPTY_STATE}</p>
        <p className="text-xs text-base-content/50">{DRIVE_EMPTY_HINT}</p>
      </div>
    );
  }
  return (
    <ul className="max-h-72 overflow-y-auto">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            className="btn btn-ghost btn-sm w-full justify-start gap-2 font-normal"
            onClick={() => onOpen(row.id)}
          >
            <FileText className="w-4 h-4 text-base-content/60" aria-hidden="true" />
            <span className="truncate">{row.name}</span>
            <span className="ml-auto text-xs text-base-content/50">{formatModified(row.modifiedTime)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface DriveFileBrowserModalProps {
  open: boolean;
  mode: 'open' | 'save-as';
  signedIn: boolean;
  /** Save As's starting file name, from the project. Required: an empty field would save as `untitled`. */
  initialName: string;
  onClose: () => void;
  onConnect: () => void;
  /** MUST be referentially stable — it is an effect dependency (useCallback). */
  onList: (pageToken?: string) => Promise<DriveListOutcome>;
  onOpenFile: (fileId: string) => void;
  onSaveAs: (name: string) => void;
}

export function DriveFileBrowserModal({
  open,
  mode,
  signedIn,
  initialName,
  onClose,
  onConnect,
  onList,
  onOpenFile,
  onSaveAs,
}: DriveFileBrowserModalProps) {
  const [files, setFiles] = useState<DrivePage['files']>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  // TRUE, not false: the first page is fetched by the effect below, and
  // renderToString runs no effects — an initial `false` renders an empty list
  // that has not been fetched as "you have no projects".
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState(initialName);

  useEffect(() => {
    if (!open || !signedIn) {
      setLoading(false);
      return;
    }
    // A re-open abandons the previous listing's promise; without this the
    // slower of two responses would be the one on screen.
    let cancelled = false;
    setLoading(true);
    setError(null);
    void onList().then((outcome) => {
      if (cancelled) return;
      setLoading(false);
      if (outcome.ok === false) {
        setError(outcome.message);
        return;
      }
      setFiles(outcome.page.files);
      setNextPageToken(outcome.page.nextPageToken);
    });
    return () => {
      cancelled = true;
    };
  }, [open, signedIn, onList]);

  const loadMore = async () => {
    if (nextPageToken === undefined) return;
    setLoading(true);
    const outcome = await onList(nextPageToken);
    setLoading(false);
    if (outcome.ok === false) {
      setError(outcome.message);
      return;
    }
    const merged = appendPage({ files: [...files] }, outcome.page);
    setFiles(merged.files);
    setNextPageToken(merged.nextPageToken);
  };

  return (
    <Modal open={open} onClose={onClose} title={browserTitle(mode)} size="lg" boxClassName="space-y-3">
      {signedIn ? (
        <>
          {error !== null && <p className="text-xs text-error">{error}</p>}
          {loading && <p className="text-xs text-base-content/60">{DRIVE_LOADING_TEXT}</p>}

          {!loading && (
            <DriveBrowserList rows={sortBrowserRows(toBrowserRows([...files]))} onOpen={onOpenFile} />
          )}

          {nextPageToken !== undefined && !loading && (
            <button type="button" className="btn btn-ghost btn-sm w-full" onClick={() => void loadMore()}>
              Load more
            </button>
          )}

          {mode === 'save-as' && (
            <div className="flex items-end gap-2">
              <label className="grow space-y-1">
                <span className="text-xs font-semibold">File name</span>
                <input
                  className="input input-sm w-full text-xs"
                  aria-label="File name"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
              </label>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onSaveAs(saveName)}>
                Save to Drive
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-base-content/70">
            Solna asks for permission to see and edit only the files it creates in your Drive.
          </p>
          <button type="button" className="btn btn-sm btn-primary" onClick={onConnect}>
            Connect Google Drive
          </button>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/project/DriveFileBrowserModal.test.tsx`
Expected: PASS — 6 tests.

Then the theme gate — this file introduces several daisyUI classes:

Run: `bun run check:theme`
Expected: PASS. If it flags a class, replace it with a role-based one; do not touch the guard's allowlist.

- [ ] **Step 5: Commit**

```bash
git add src/components/project/DriveFileBrowserModal.tsx src/components/project/DriveFileBrowserModal.test.tsx
git commit -m "feat(drive): add the Google Drive project list modal

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 14: The Drive slice

**Files:**
- Create: `src/store/driveSlice.ts`
- Test: `src/store/driveSlice.test.ts`
- Modify: `src/store/projectSlice.ts` (add `applyProjectSource`)
- Modify: `src/store/projectSave.test.ts` (add its `applyProjectSource` block — the file was created in Task 5)

**Interfaces:**
- Consumes: `DriveAuth`, `DriveAuthError`, `driveErrorMessage` from `./driveAuth`; `DriveClient`, `DriveFileMeta` from `./driveClient`; `DriveListOutcome` from `../utils/driveBrowser`; `ProjectSaveResult` from `./projectSlice`; `ProjectSource`, `UNTITLED_SOURCE` from `./projectSource`.
- Produces:
  - `const DRIVE_NOT_CONFIGURED_MESSAGE`
  - `interface DriveSliceDeps { auth: DriveAuth; client: DriveClient; available: boolean }`
  - `interface DriveSlice { driveSignedIn; driveAvailable; connectDrive; disconnectDrive; listDriveProjects; openFromDrive; saveToDrive; saveAsToDrive }`
  - `function createDriveSlice(set, get, deps: DriveSliceDeps): DriveSlice`
  - `ProjectSlice.applyProjectSource(source: ProjectSource): void`

**The slice is the ONLY place a Drive error becomes a notice.** Every call the UI makes goes through `guard`, so an expired token, a denied consent screen and a dead network all take one path: `driveSignedIn → false` when the failure is an auth one, a sentence from `driveErrorMessage`, and no throw. The UI therefore never needs a `try`/`catch` around a Drive call, and a rejected promise can never reach a React event handler.

**It never touches the token.** `DriveAuth` is injected and the transport holds it; this slice only asks for results, which is what keeps `bun test` able to exercise every branch without Google.

**On the token itself:** `driveSignedIn` is a MIRROR, refreshed on each outcome. `DriveAuth.signedIn()` is the truth (it knows about expiry), and re-reading it after every call is what keeps the menu honest without a timer.

- [ ] **Step 1: Write the failing test**

Create `src/store/driveSlice.test.ts`:

```ts
import { beforeAll, describe, expect, test } from 'bun:test';
import { DRIVE_DENIED_MESSAGE, DriveAuthError, type DriveAuth } from './driveAuth';
import { SOLNA_DRIVE_MIME, type DriveClient, type DriveFileMeta } from './driveClient';
import { DRIVE_NOT_CONFIGURED_MESSAGE, type DriveSliceDeps } from './driveSlice';
import { MALFORMED_MESSAGE } from './projectFile';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { UNTITLED_SOURCE } from './projectSource';
import type { ProjectBody } from './projectFormat';

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new FakeLocalStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
});

const META: DriveFileMeta = {
  id: 'drive-1',
  name: 'mix.solna',
  mimeType: SOLNA_DRIVE_MIME,
  modifiedTime: '2026-09-12T00:00:00.000Z',
};

function okAuth(): DriveAuth {
  return { token: async () => 'tok', invalidate: () => {}, revoke: async () => {}, signedIn: () => true };
}

function okClient(overrides: Partial<DriveClient> = {}): DriveClient {
  return {
    listProjects: async () => ({ files: [META] }),
    // The FULL ProjectParseResult failure shape — `error` is not optional, and a
    // fake missing it fails `tsc --noEmit` rather than the test it belongs to.
    readProject: async () => ({ ok: false, error: 'malformed', message: MALFORMED_MESSAGE }),
    createProject: async () => META,
    updateProject: async () => META,
    ...overrides,
  };
}

let clock = 5_000;
let instance = 0;

/**
 * The REAL store module, one instance per test, plus a drive slice built on
 * INJECTED fakes — see projectBoot.test.ts for why the module is re-imported:
 * two tests sharing one store module share one set of closured slice state.
 */
async function freshStore(overrides: Partial<DriveSliceDeps> = {}) {
  const mod = await import(`./store?drive=${instance++}`);
  const { createProjectSlice } = await import('./projectSlice');
  const { createDriveSlice } = await import('./driveSlice');
  const projectStore = createProjectStore(async () => createMemoryBackend());
  const project = createProjectSlice(mod.useAppStore.setState, mod.useAppStore.getState, projectStore, () => clock);
  const deps: DriveSliceDeps = { auth: okAuth(), client: okClient(), available: true, ...overrides };
  const drive = createDriveSlice(mod.useAppStore.setState, mod.useAppStore.getState, deps);
  // Only the project and drive slices are replaced; every other slice keeps the
  // module's own instance, which is what the install path expects.
  mod.useAppStore.setState({ ...project, ...drive });
  return { useAppStore: mod.useAppStore, drive, deps };
}

describe('connectDrive', () => {
  test('acquires a token, flips driveSignedIn and clears any notice', async () => {
    const { useAppStore, drive } = await freshStore();
    useAppStore.setState({ projectNotice: 'something old' });
    expect(await drive.connectDrive()).toBe(true);
    expect(useAppStore.getState().driveSignedIn).toBe(true);
    expect(useAppStore.getState().projectNotice).toBeNull();
  });

  test('a denied grant reports Google’s refusal and stays signed out', async () => {
    const { useAppStore, drive } = await freshStore({
      auth: {
        ...okAuth(),
        token: async () => {
          throw new DriveAuthError('denied', DRIVE_DENIED_MESSAGE);
        },
      },
    });
    expect(await drive.connectDrive()).toBe(false);
    expect(useAppStore.getState().driveSignedIn).toBe(false);
    expect(useAppStore.getState().projectNotice).toBe(DRIVE_DENIED_MESSAGE);
  });

  test('an unconfigured deployment never asks for a token at all', async () => {
    const { useAppStore, drive } = await freshStore({
      available: false,
      auth: {
        ...okAuth(),
        token: async () => {
          throw new Error('auth must not be touched when Drive is unavailable');
        },
      },
    });
    expect(await drive.connectDrive()).toBe(false);
    expect(useAppStore.getState().driveAvailable).toBe(false);
    expect(useAppStore.getState().projectNotice).toBe(DRIVE_NOT_CONFIGURED_MESSAGE);
  });
});

describe('listDriveProjects', () => {
  test('hands back the page the client returned', async () => {
    const { drive } = await freshStore();
    expect(await drive.listDriveProjects()).toEqual({ ok: true, page: { files: [META] } });
  });

  test('passes a page token through, and omits it when there is none', async () => {
    const seen: Array<string | undefined> = [];
    const { drive } = await freshStore({
      client: okClient({
        listProjects: async (pageToken) => {
          seen.push(pageToken);
          return { files: [] };
        },
      }),
    });
    await drive.listDriveProjects();
    await drive.listDriveProjects('p2');
    expect(seen).toEqual([undefined, 'p2']);
  });

  test('a transport failure is a message, not a throw', async () => {
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        listProjects: async () => {
          throw new Error('socket closed');
        },
      }),
    });
    const outcome = await drive.listDriveProjects();
    expect(outcome.ok).toBe(false);
    // Nothing was said in the toast: the modal renders the failure in place,
    // because a listing that failed is a panel, not an interruption.
    expect(useAppStore.getState().projectNotice).toBeNull();
  });

  test('an auth failure drops driveSignedIn, so the menu stops claiming a connection', async () => {
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        listProjects: async () => {
          throw new DriveAuthError('denied', DRIVE_DENIED_MESSAGE);
        },
      }),
    });
    useAppStore.setState({ driveSignedIn: true });
    const outcome = await drive.listDriveProjects();
    expect(outcome.ok).toBe(false);
    expect(useAppStore.getState().driveSignedIn).toBe(false);
  });
});

describe('openFromDrive', () => {
  test('installs the file and points the source at it', async () => {
    const { useAppStore } = await freshStore();
    // A REAL body from the one reader that exposes the envelope, so the fixture
    // cannot drift from what a Drive file actually holds.
    const body = useAppStore.getState().exportProjectFile();
    const withFile = await freshStore({
      // `warnings` is part of the success shape and is not optional.
      client: okClient({ readProject: async () => ({ ok: true, body, warnings: [] }) }),
    });
    withFile.useAppStore.setState({ projectName: 'Old name', projectSource: UNTITLED_SOURCE });
    await withFile.drive.openFromDrive('drive-77');
    expect(withFile.useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-77' });
    // The fixture's name is '', an anonymous document, so the project name goes
    // back to null: an open ADOPTS the file's envelope, it does not merge with
    // the session's.
    expect(withFile.useAppStore.getState().projectName).toBeNull();
    expect(withFile.useAppStore.getState().projectNotice).toBeNull();
  });

  test('a malformed file reports the parse message and installs nothing', async () => {
    const { useAppStore, drive } = await freshStore();
    useAppStore.setState({ projectName: 'Keep me' });
    // okClient's default readProject is the malformed result, with the real
    // MALFORMED_MESSAGE rather than a sentence invented here.
    await drive.openFromDrive('drive-1');
    expect(useAppStore.getState().projectName).toBe('Keep me');
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
    expect(useAppStore.getState().projectNotice).toBe(MALFORMED_MESSAGE);
  });

  test('a failed read reports it and installs nothing', async () => {
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        readProject: async () => {
          throw new DriveAuthError('denied', DRIVE_DENIED_MESSAGE);
        },
      }),
    });
    useAppStore.setState({ projectName: 'Keep me', driveSignedIn: true });
    await drive.openFromDrive('drive-1');
    expect(useAppStore.getState().projectName).toBe('Keep me');
    expect(useAppStore.getState().projectNotice).toBe(DRIVE_DENIED_MESSAGE);
    expect(useAppStore.getState().driveSignedIn).toBe(false);
  });
});

describe('saveToDrive', () => {
  test('updates the file the source names and keeps the document identity', async () => {
    const sent: Array<{ fileId: string; body: ProjectBody }> = [];
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        updateProject: async (fileId, body) => {
          sent.push({ fileId, body });
          return META;
        },
      }),
    });
    const before = useAppStore.getState().exportProjectFile();
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-9' } });
    clock = 8_000;
    expect(await drive.saveToDrive()).toEqual({ ok: true, destination: 'drive' });
    expect(sent[0].fileId).toBe('drive-9');
    // A Save is the SAME document being written again: the id and the creation
    // time are what make that true, and only updatedAt may move.
    expect(sent[0].body.id).toBe(before.id);
    expect(sent[0].body.createdAt).toBe(before.createdAt);
    expect(sent[0].body.updatedAt).toBe(8_000);
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-9' });
  });

  test('a failed update reports it and leaves the source alone', async () => {
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        updateProject: async () => {
          throw new Error('503');
        },
      }),
    });
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-9' } });
    const result = await drive.saveToDrive();
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-9' });
    expect(useAppStore.getState().projectNotice).not.toBeNull();
  });

  test('with no drive source there is nothing to update, and it says so', async () => {
    const { useAppStore, drive } = await freshStore();
    const result = await drive.saveToDrive();
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });
});

describe('saveAsToDrive', () => {
  test('creates a new file, re-points the source and adopts the name', async () => {
    const created: Array<{ name: string; body: ProjectBody }> = [];
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        createProject: async (name, body) => {
          created.push({ name, body });
          return META;
        },
      }),
    });
    const before = useAppStore.getState().exportProjectFile();
    useAppStore.setState({ projectName: 'Sketch' });
    clock = 7_000;
    expect(await drive.saveAsToDrive('Remix')).toEqual({ ok: true, destination: 'drive' });
    expect(created[0].name).toBe('Remix');
    // A Save As is a NEW document: its own id, and createdAt = updatedAt = now.
    expect(created[0].body.id).not.toBe(before.id);
    expect(created[0].body.createdAt).toBe(7_000);
    expect(created[0].body.updatedAt).toBe(7_000);
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-1' });
    expect(useAppStore.getState().projectName).toBe('Remix');
  });

  test('a failed create adopts nothing — the live document is untouched', async () => {
    const { useAppStore, drive } = await freshStore({
      client: okClient({
        createProject: async () => {
          throw new Error('403');
        },
      }),
    });
    const before = useAppStore.getState().exportProjectFile();
    useAppStore.setState({ projectName: 'Sketch' });
    const result = await drive.saveAsToDrive('Remix');
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
    expect(useAppStore.getState().projectName).toBe('Sketch');
    // The identity a failed Save As did NOT adopt, checked through the one
    // reader that exposes it.
    expect(useAppStore.getState().exportProjectFile().id).toBe(before.id);
  });
});

describe('disconnectDrive', () => {
  test('revokes, signs out, and reverts a drive source to untitled', async () => {
    let revoked = 0;
    const { useAppStore, drive } = await freshStore({
      auth: { ...okAuth(), revoke: async () => { revoked += 1; } },
    });
    useAppStore.setState({ driveSignedIn: true, projectSource: { kind: 'drive', fileId: 'drive-9' } });
    await drive.disconnectDrive();
    expect(revoked).toBe(1);
    expect(useAppStore.getState().driveSignedIn).toBe(false);
    // The id is meaningless without a token; the body and the autosave are not
    // touched, which is what the design's sign-out row asks for.
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('a local source survives a sign-out — it was never Google’s', async () => {
    const { useAppStore, drive } = await freshStore();
    const handle = { name: 'sketch.solna' } as unknown as FileSystemFileHandle;
    useAppStore.setState({ driveSignedIn: true, projectSource: { kind: 'local', handle } });
    await drive.disconnectDrive();
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'local', handle });
  });
});
```

Add to `src/store/projectSave.test.ts` this block, and extend that file's import from `./projectSource` with `UNTITLED_SOURCE` if it does not already carry it (Task 5's file imports it):

```ts
describe('applyProjectSource', () => {
  test('re-points the source and writes it into the slot', async () => {
    const { useAppStore, store, slice } = await freshSlice();
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-1' } });
    await slice.applyProjectSource(UNTITLED_SOURCE);
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual(UNTITLED_SOURCE);
  });

  test('re-pointing at the source that is already set writes nothing', async () => {
    const { useAppStore, store, slice } = await freshSlice();
    await slice.saveProjectAsLocal(); // an honest starting point: a local source
    const handle = (useAppStore.getState().projectSource as { handle: FileSystemFileHandle }).handle;
    // The SAME handle: no write. Asserted through the slot, which is the only
    // observable difference a redundant write would make.
    await slice.applyProjectSource({ kind: 'local', handle });
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual({ kind: 'local', handle });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/driveSlice.test.ts`
Expected: FAIL — `Cannot find module './driveSlice'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/driveSlice.ts`:

```ts
import type { StoreApi } from 'zustand';
import type { DriveListOutcome } from '../utils/driveBrowser';
import { DriveAuthError, driveErrorMessage, type DriveAuth } from './driveAuth';
import type { DriveClient } from './driveClient';
import { UNTITLED_SOURCE } from './projectSource';
import type { ProjectSaveResult } from './projectSlice';
import type { AppStore } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export const DRIVE_NOT_CONFIGURED_MESSAGE =
  'Google Drive is not configured for this deployment. Saving to this device still works.';

export interface DriveSliceDeps {
  auth: DriveAuth;
  client: DriveClient;
  /** False when VITE_GOOGLE_CLIENT_ID is unset: a normal degraded state, not a boot failure. */
  available: boolean;
}

export interface DriveSlice {
  /** Mirrors DriveAuth.signedIn(). Never persisted — see .claude/rules and the design's token hygiene. */
  driveSignedIn: boolean;
  driveAvailable: boolean;
  /** Ask for a token. Returns whether the app is now connected. */
  connectDrive: () => Promise<boolean>;
  /** Revoke at Google and sign out; a `drive` source reverts to untitled. */
  disconnectDrive: () => Promise<void>;
  /** One page of the project listing, already an outcome rather than a throw. */
  listDriveProjects: (pageToken?: string) => Promise<DriveListOutcome>;
  /** Read, parse and install a Drive file — the same path a local open takes. */
  openFromDrive: (fileId: string) => Promise<void>;
  /** Save the live body over the current `drive` source. */
  saveToDrive: () => Promise<ProjectSaveResult>;
  /** Save As to Drive: create a new file in My Drive, then re-point. No folder — see Task 10. */
  saveAsToDrive: (name: string) => Promise<ProjectSaveResult>;
}

/**
 * The one place a Drive failure becomes either a notice or an outcome. The
 * transport already retried once on a 401 (withDriveToken), so anything that
 * arrives here is final: a `DriveAuthError` means the grant is gone and the
 * sign-in mirror must be corrected, and everything else is a sentence.
 *
 * The mirror is only ever CORRECTED here, never set to true — a token was
 * acquired explicitly by connectDrive, so only the call that asked for one may
 * claim there is one.
 */
export function createDriveSlice(set: Set, get: Get, deps: DriveSliceDeps): DriveSlice {
  const setSignedIn = (signedIn: boolean): void => {
    if (get().driveSignedIn !== signedIn) set({ driveSignedIn: signedIn });
  };

  const guard = async <T>(op: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> => {
    try {
      return { ok: true, value: await op() };
    } catch (err) {
      if (err instanceof DriveAuthError) setSignedIn(false);
      return { ok: false, message: driveErrorMessage(err) };
    }
  };

  return {
    driveSignedIn: false,
    driveAvailable: deps.available,

    connectDrive: async () => {
      if (!deps.available) {
        set({ projectNotice: DRIVE_NOT_CONFIGURED_MESSAGE });
        return false;
      }
      try {
        await deps.auth.token();
        setSignedIn(true);
        set({ projectNotice: null });
        return true;
      } catch (err) {
        setSignedIn(false);
        set({ projectNotice: driveErrorMessage(err) });
        return false;
      }
    },

    disconnectDrive: async () => {
      await deps.auth.revoke();
      setSignedIn(false);
      // The design's sign-out row: the id is meaningless once the token is
      // revoked, so the project falls back to untitled. The body and the
      // autosaved slot are untouched — nothing here costs the user work.
      if (get().projectSource.kind === 'drive') await get().applyProjectSource(UNTITLED_SOURCE);
    },

    listDriveProjects: async (pageToken) => {
      const result = await guard(() => deps.client.listProjects(pageToken));
      // The message is NOT written to projectNotice: a failed listing is
      // rendered inside the modal it belongs to, and a toast over a modal
      // would be the same sentence twice.
      return result.ok ? { ok: true, page: result.value } : { ok: false, message: result.message };
    },

    openFromDrive: async (fileId) => {
      const read = await guard(() => deps.client.readProject(fileId));
      if (read.ok === false) {
        set({ projectNotice: read.message });
        return;
      }
      if (read.value.ok === false) {
        set({ projectNotice: read.value.message });
        return;
      }
      // One install path for every open — local file, Drive file, boot. Only
      // the source differs, and openProjectFile persists it.
      await get().openProjectFile(read.value.body, { kind: 'drive', fileId });
    },

    saveToDrive: async () => {
      const source = get().projectSource;
      if (source.kind !== 'drive') {
        // Unreachable through saveProject, which only routes here for a drive
        // source. Typed rather than asserted, so a future caller that gets it
        // wrong is told so instead of writing to id `undefined`.
        return { ok: false, message: DRIVE_NOT_CONFIGURED_MESSAGE };
      }
      const body = get().exportProjectFile();
      const updated = await guard(() => deps.client.updateProject(source.fileId, body));
      if (updated.ok === false) {
        set({ projectNotice: updated.message });
        return { ok: false, message: updated.message };
      }
      set({ projectNotice: null });
      return { ok: true, destination: 'drive' };
    },

    saveAsToDrive: async (name) => {
      // Built BEFORE the create and adopted after it — the same two-phase Save
      // As the local path uses, for the same reason: a create that fails must
      // not leave the live document wearing an id no file carries.
      const { body, identity } = get().saveAsBody(name);
      const created = await guard(() => deps.client.createProject(name, body));
      if (created.ok === false) {
        set({ projectNotice: created.message });
        return { ok: false, message: created.message };
      }
      await get().adoptSaveAs(identity, name, { kind: 'drive', fileId: created.value.id });
      set({ projectNotice: null });
      return { ok: true, destination: 'drive' };
    },
  };
}
```

In `src/store/projectSlice.ts`, add `applyProjectSource` to the `ProjectSlice` interface (beside `projectSource`):

```ts
  /**
   * Re-point the source WITHOUT touching content, then persist. The one caller
   * is driveSlice.disconnectDrive: a `drive` id is meaningless once the token
   * is revoked. The slot must learn that too, or a reload resumes a project
   * pointing at a file the browser can no longer reach.
   */
  applyProjectSource: (source: ProjectSource) => Promise<void>;
```

and the action, after `adoptSaveAs`:

```ts
    applyProjectSource: async (source) => {
      const current = get().projectSource;
      const unchanged =
        (current.kind === 'untitled' && source.kind === 'untitled') ||
        (current.kind === 'drive' && source.kind === 'drive' && current.fileId === source.fileId) ||
        (current.kind === 'local' && source.kind === 'local' && current.handle === source.handle);
      if (unchanged) return;
      set({ projectSource: source });
      // Explicit, like adoptSaveAs: the source is not a content key, so nothing
      // else would schedule a write and the slot would keep the stale pointer.
      // Awaited, so that a caller which reads the slot next sees this write.
      await get().save();
    },
```

The drive-update arm of `saveProject` is still `return { ok: false, message: DRIVE_NOT_CONNECTED_MESSAGE };` — Task 15 replaces it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/driveSlice.test.ts src/store/projectSave.test.ts`
Expected: PASS — 17 + 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/driveSlice.ts src/store/driveSlice.test.ts src/store/projectSlice.ts src/store/projectSave.test.ts
git commit -m "feat(drive): add the Drive slice over an injected auth and client

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 15: Wiring the Drive slice into the store and Save

**Files:**
- Modify: `src/store/store.ts`
- Modify: `src/store/types.ts`
- Modify: `src/store/projectSlice.ts`
- Modify: `src/store/projectSave.test.ts`

**Interfaces:**
- Consumes: `createDriveAuth`, `driveClientId` from `./driveAuth`; `createDriveClient` from `./driveClient`; `createGapiTransport` from `./driveGapi`; `loadGis`, `loadGapi` from `../utils/googleScriptLoader`; `createDriveSlice` from `./driveSlice`.
- Produces: `AppStore` (and therefore `useAppStore.getState()`) carrying `DriveSlice`, and `saveProject`'s drive arm calling `saveToDrive`.

**Nothing here loads a Google script or asks for a token at import time.** `createDriveAuth` holds a null token until `token()` is called, `createGapiTransport` calls `getGapi()` only on its first request, and both are built at module scope so every call site shares one instance — the token has to be shared, or each surface would acquire its own.

- [ ] **Step 1: Write the failing test**

In `src/store/projectSave.test.ts`, the drive test from Task 5 changes meaning: the arm now delegates. Replace the whole test:

```ts
  test('a drive source delegates Save to the Drive slice', async () => {
    const { useAppStore, slice } = await freshSlice();
    const calls: string[] = [];
    useAppStore.setState({
      projectSource: { kind: 'drive', fileId: 'drive-1' },
      // The one seam a test needs: the slice is dispatching, not writing.
      saveToDrive: async () => {
        calls.push('drive');
        return { ok: true, destination: 'drive' };
      },
    });
    expect(await slice.saveProject()).toEqual({ ok: true, destination: 'drive' });
    expect(calls).toEqual(['drive']);
  });
```

and drop `DRIVE_NOT_CONNECTED_MESSAGE` from that file's import of `./projectSlice` — nothing else in the file uses it, and an unused import fails `bun run eslint`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectSave.test.ts`
Expected: FAIL — `get().saveToDrive is not a function`.

- [ ] **Step 3: Write the implementation**

1. In `src/store/types.ts`, extend `AppStore` and add the import beside the other slice imports:

```ts
import type { DriveSlice } from './driveSlice';
```

```ts
export interface AppStore
  extends TransportSlice,
    MusicContextSlice,
    SynthSlice,
    ChordsSlice,
    BassSlice,
    PadSlice,
    LeadSlice,
    FxSlice,
    SequencerSlice,
    EffectsSlice,
    UiSlice,
    PresetsSlice,
    LoopSlice,
    DriveSlice,
    ProjectSlice {}
```

2. In `src/store/store.ts`, add the imports:

```ts
import { createDriveAuth, driveClientId } from './driveAuth';
import { createDriveClient } from './driveClient';
import { createGapiTransport } from './driveGapi';
import { createDriveSlice } from './driveSlice';
import { loadGapi, loadGis } from '../utils/googleScriptLoader';
```

3. And the module-scope construction, immediately above `export const useAppStore = create<AppStore>()(`:

```ts
/**
 * One auth and one client for the whole app, built once and shared. The token
 * cannot be per-surface: two `DriveAuth` instances would mean two consent
 * prompts and two tokens, and whichever expired first would sign out a session
 * the other was still using.
 *
 * Module scope is safe because neither constructor touches Google — the auth
 * holds no token until `token()` is called and the transport calls `getGapi()`
 * only on its first request, so importing this file still loads nothing.
 */
const driveAuth = createDriveAuth({ loadOauth2: loadGis, clientId: driveClientId() });
const driveClient = createDriveClient(createGapiTransport(loadGapi, driveAuth));
/** Read once: an unset VITE_GOOGLE_CLIENT_ID is a normal degraded state, not a boot failure. */
const DRIVE_AVAILABLE = driveClientId() !== '';
```

4. Add the slice to the composition, after `createProjectSlice` (order does not matter — `get()` is lazy — but keeping the project slice adjacent to the one that re-points it reads better):

```ts
        ...createProjectSlice(setWithLoopMirror, get, projectStore),
        ...createDriveSlice(setWithLoopMirror, get, {
          auth: driveAuth,
          client: driveClient,
          available: DRIVE_AVAILABLE,
        }),
```

5. In `src/store/projectSlice.ts`, replace the drive arm of `saveProject`:

```ts
        case 'drive-update':
          return get().saveToDrive();
```

and delete the now-orphaned comment above it. `DRIVE_NOT_CONNECTED_MESSAGE` stays exported and unimported — driveSlice owns the not-connected sentence now, and Phase 1's constant is what a reader of `projectSave.test.ts` finds. *If `bun run eslint` flags it as unused, delete the constant from `projectSlice.ts`; the export exists for the phase where a `drive` source cannot be reached, and that phase is over.*

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/projectSave.test.ts src/store/driveSlice.test.ts src/store/projectStore.test.ts src/store/projectBoot.test.ts src/store/projectAutosave.test.ts src/store/projectSlice.test.ts`
Expected: PASS.

Then, because the store's composition changed:

Run: `bun run lint`
Expected: PASS.

Run: `bun test`
Expected: PASS — the whole suite. A failure here is the store composition, not the Drive code.

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts src/store/types.ts src/store/projectSlice.ts src/store/projectSave.test.ts
git commit -m "feat(drive): wire the Drive slice into the store and Save

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 16: The UI — Open from Drive, the Save-As target chooser, and Disconnect

**Files:**
- Create: `src/components/project/SaveAsTargetDialog.tsx`
- Test: `src/components/project/SaveAsTargetDialog.test.tsx`
- Modify: `src/components/project/ProjectMenu.tsx`
- Modify: `src/components/project/ProjectMenu.test.tsx`

**Interfaces:**
- Consumes: `Modal`; `defaultSaveName` from `@/utils/driveBrowser`; `DriveFileBrowserModal` (Task 13, already carrying `initialName`); the store's `openFromDrive`, `listDriveProjects`, `saveAsToDrive`, `connectDrive`, `disconnectDrive`, `driveSignedIn`, `driveAvailable`; `ProjectSaveResult` (already imported in Task 6).
- Produces:
  - `SAVE_AS_TITLE`, `SAVE_AS_THIS_DEVICE`, `SAVE_AS_DRIVE`
  - `interface SaveAsTargetDialogProps { open; driveAvailable; onClose; onLocal; onDrive }`
  - `function SaveAsTargetDialog(props): JSX.Element`
  - `ProjectMenuAction` gains `'open-drive'` and `'disconnect-drive'`
  - `function visibleMenuActions(driveAvailable: boolean, driveSignedIn: boolean): typeof PROJECT_MENU_ACTIONS`

**Four decisions this task makes, spelled out because each is visible to the user:**

1. **Save As asks where, then how.** The menu's Save As opens the target chooser, and the Drive option opens the list modal — rather than the modal being the only Save As surface, which would hide the local path behind a Drive dialog.
2. **The connect prompt lives in the modal, not the menu.** "Connect Google Drive" is what the modal shows when signed out; one connect surface, at the moment it is needed. The design agrees, and says so.
3. **Sign-out is a menu row, and it is the only surface it could have.** `disconnectDrive` exists in the slice and reverts a `drive` source to untitled; without a row to invoke it the behaviour is unreachable and the code is dead. It renders **only while signed in**.
4. **The Drive rows are absent when Drive is unconfigured, not disabled.** `visibleMenuActions` is a pure function so that this is testable without a DOM — and so the rule lives in one place rather than in two `&&`s inside the render. Advertising *Open from Drive* on a build with no client id offers the user a modal whose only button can never succeed.

- [ ] **Step 1: Write the failing tests**

Create `src/components/project/SaveAsTargetDialog.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SAVE_AS_DRIVE, SAVE_AS_THIS_DEVICE, SAVE_AS_TITLE, SaveAsTargetDialog } from './SaveAsTargetDialog';

describe('SaveAsTargetDialog', () => {
  test('offers this device always, and Drive only when the deployment has it', () => {
    const full = renderToString(
      <SaveAsTargetDialog open driveAvailable onClose={() => {}} onLocal={() => {}} onDrive={() => {}} />,
    );
    expect(full).toContain(SAVE_AS_THIS_DEVICE);
    expect(full).toContain(SAVE_AS_DRIVE);

    const bare = renderToString(
      <SaveAsTargetDialog open={false} driveAvailable={false} onClose={() => {}} onLocal={() => {}} onDrive={() => {}} />,
    );
    // No client id means no Drive row at all — not a disabled one, which would
    // advertise a target that can never work on this deployment.
    expect(bare).toContain(SAVE_AS_THIS_DEVICE);
    expect(bare).not.toContain(SAVE_AS_DRIVE);
  });

  test('the copy names the dialog and its two targets', () => {
    expect(SAVE_AS_TITLE).toBe('Save as');
    expect(SAVE_AS_THIS_DEVICE).toBe('This device');
    expect(SAVE_AS_DRIVE).toBe('Google Drive');
  });

  test('renders through the shared modal chrome', () => {
    const html = renderToString(
      <SaveAsTargetDialog open driveAvailable onClose={() => {}} onLocal={() => {}} onDrive={() => {}} />,
    );
    expect(html).toContain('modal-box bg-base-100 border border-base-300 shadow-2xl max-w-sm space-y-3');
  });
});
```

In `src/components/project/ProjectMenu.test.tsx`, replace the first test and add three:

```tsx
  test('offers Open, Open from Drive, Save, Save As, Export, New and Disconnect, in that order', () => {
    expect(PROJECT_MENU_ACTIONS.map((a) => a.action)).toEqual([
      'open',
      'open-drive',
      'save',
      'save-as',
      'export',
      'new',
      'disconnect-drive',
    ]);
  });

  test('only Open, Open from Drive and New replace the project', () => {
    expect(REPLACING_ACTIONS).toEqual(['open', 'open-drive', 'new']);
    expect(replacesProject('save')).toBe(false);
    expect(replacesProject('save-as')).toBe(false);
    expect(replacesProject('export')).toBe(false);
    expect(replacesProject('disconnect-drive')).toBe(false);
  });

  // Every row renders into `id={`project-menu-${action}`}`, and two rows both
  // starting with "open" is exactly how a duplicated id would arrive.
  test('no two rows share an element id', () => {
    const ids = PROJECT_MENU_ACTIONS.map((a) => `project-menu-${a.action}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the Drive rows appear only when they can work', () => {
    const actions = (available: boolean, signedIn: boolean) =>
      visibleMenuActions(available, signedIn).map((a) => a.action);
    // No client id: no Drive row at all. A row that opens a modal whose only
    // button can never succeed is worse than an absent one.
    expect(actions(false, false)).toEqual(['open', 'save', 'save-as', 'export', 'new']);
    // Configured but signed out: Open from Drive is offered (the modal is where
    // connecting happens), Disconnect is not — there is nothing to disconnect.
    expect(actions(true, false)).toEqual(['open', 'open-drive', 'save', 'save-as', 'export', 'new']);
    expect(actions(true, true)).toContain('disconnect-drive');
  });
```

and extend the existing markup test with the new row's label:

```tsx
    expect(html).toContain('Open from Drive');
```

(add `visibleMenuActions` to that file's import from `./ProjectMenu`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/components/project/SaveAsTargetDialog.test.tsx src/components/project/ProjectMenu.test.tsx src/components/project/DriveFileBrowserModal.test.tsx`
Expected: FAIL — `Cannot find module './SaveAsTargetDialog'`, and `PROJECT_MENU_ACTIONS` still lists five.

- [ ] **Step 3: Write the implementation**

Create `src/components/project/SaveAsTargetDialog.tsx`:

```tsx
import { Cloud, HardDrive } from 'lucide-react';
import { Modal } from '../ui/Modal';

export const SAVE_AS_TITLE = 'Save as';
export const SAVE_AS_THIS_DEVICE = 'This device';
export const SAVE_AS_DRIVE = 'Google Drive';

export interface SaveAsTargetDialogProps {
  open: boolean;
  /** False when the deployment has no client id: the Drive row is absent, not disabled. */
  driveAvailable: boolean;
  onClose: () => void;
  onLocal: () => void;
  onDrive: () => void;
}

/**
 * The one question Save As asks that its two backends disagree about: WHERE.
 * Which name, and how the write happens, belong to the target — a local picker
 * or the Drive browser — so this dialog is two buttons and nothing else.
 */
export function SaveAsTargetDialog({
  open,
  driveAvailable,
  onClose,
  onLocal,
  onDrive,
}: SaveAsTargetDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={SAVE_AS_TITLE} size="sm" boxClassName="space-y-3">
      <button type="button" className="btn btn-ghost w-full justify-start gap-2 font-normal" onClick={onLocal}>
        <HardDrive className="w-4 h-4 text-base-content/60" aria-hidden="true" />
        {SAVE_AS_THIS_DEVICE}
      </button>
      {driveAvailable && (
        <button type="button" className="btn btn-ghost w-full justify-start gap-2 font-normal" onClick={onDrive}>
          <Cloud className="w-4 h-4 text-base-content/60" aria-hidden="true" />
          {SAVE_AS_DRIVE}
        </button>
      )}
    </Modal>
  );
}
```

In `src/components/project/DriveFileBrowserModal.tsx`, add the prop to the interface:

```tsx
  /**
   * Save As's starting name, from the project (`defaultSaveName`). Required with
   * no default: a caller that forgot it would offer an empty field and silently
   * save as `untitled.solna`.
   */
  initialName: string;
```

destructure it, and seed the field:

```tsx
  const [saveName, setSaveName] = useState(initialName);
```

In `src/components/project/ProjectMenu.tsx`:

1. Extend the imports:

```tsx
import React, { useCallback, useRef, useState } from 'react';
import { Cloud, CloudOff, Download, FileDown, FilePlus, Save, Upload } from 'lucide-react';
import { defaultSaveName } from '@/utils/driveBrowser';
import { DriveFileBrowserModal } from './DriveFileBrowserModal';
import { SaveAsTargetDialog } from './SaveAsTargetDialog';
```

And the row map iterates the filtered list rather than the whole table:

```tsx
        {visibleMenuActions(driveAvailable, driveSignedIn).map(({ action, label, icon: Icon }) => (
```

2. Extend the action union and the two tables:

```tsx
export type ProjectMenuAction =
  | 'open'
  | 'open-drive'
  | 'save'
  | 'save-as'
  | 'export'
  | 'new'
  | 'disconnect-drive';

export const REPLACING_ACTIONS: ReadonlyArray<ProjectMenuAction> = ['open', 'open-drive', 'new'];

export const PROJECT_MENU_ACTIONS: ReadonlyArray<{
  action: ProjectMenuAction;
  label: string;
  icon: typeof Upload;
}> = [
  { action: 'open', label: 'Open .solna', icon: Upload },
  { action: 'open-drive', label: 'Open from Drive', icon: Cloud },
  { action: 'save', label: 'Save', icon: Save },
  { action: 'save-as', label: 'Save as…', icon: FileDown },
  { action: 'export', label: 'Export .solna', icon: Download },
  { action: 'new', label: 'New project', icon: FilePlus },
  { action: 'disconnect-drive', label: 'Disconnect Drive', icon: CloudOff },
];

/**
 * Which rows this session can actually use. A pure function, not two `&&`s in
 * the render: the rule is testable without a DOM and lives in one place.
 *
 * `open-drive` needs a configured deployment but NOT a connection — the modal
 * is where connecting happens. `disconnect-drive` needs an actual connection,
 * because a sign-out row on a signed-out app is a row that does nothing.
 */
export function visibleMenuActions(
  driveAvailable: boolean,
  driveSignedIn: boolean,
): typeof PROJECT_MENU_ACTIONS {
  return PROJECT_MENU_ACTIONS.filter(({ action }) => {
    if (action === 'open-drive') return driveAvailable;
    if (action === 'disconnect-drive') return driveAvailable && driveSignedIn;
    return true;
  });
}

/** Only the three replacing actions ever reach the confirm — see replacesProject. */
export const CONFIRM_TITLE: Record<'open' | 'open-drive' | 'new', string> = {
  open: 'Open a project file',
  'open-drive': 'Open from Google Drive',
  new: 'Start a new project',
};

export const CONFIRM_LABEL: Record<'open' | 'open-drive' | 'new', string> = {
  open: 'Choose a file',
  'open-drive': 'Browse Drive',
  new: 'New project',
};
```

3. Add the state and the store reads:

```tsx
  const [choosingTarget, setChoosingTarget] = useState(false);
  const [browser, setBrowser] = useState<'open' | 'save-as' | null>(null);
```

```tsx
  const driveAvailable = useLiveStore((s) => s.driveAvailable);
  const driveSignedIn = useLiveStore((s) => s.driveSignedIn);
  const connectDrive = useLiveStore((s) => s.connectDrive);
  const disconnectDrive = useLiveStore((s) => s.disconnectDrive);
  const openFromDrive = useLiveStore((s) => s.openFromDrive);
  const listDriveProjects = useLiveStore((s) => s.listDriveProjects);
  const saveAsToDrive = useLiveStore((s) => s.saveAsToDrive);
```

4. Add the Drive save and the two browser callbacks below the existing `runSaveAs`:

```tsx
  const runSaveAsToDrive = async (name: string) => finishSave(await saveAsToDrive(name));

  const runOpenFromDrive = async (fileId: string) => {
    setBrowser(null);
    await openFromDrive(fileId);
  };

  /**
   * Wrapped in useCallback because the modal lists from an effect keyed on it:
   * a fresh arrow each render would re-list on every keystroke in the save-name
   * field. The store's action is stable, so this is stable too.
   */
  const listDrive = useCallback(
    (pageToken?: string) => listDriveProjects(pageToken),
    [listDriveProjects],
  );
```

5. Point `runSaveAs` at the chooser's local arm and extend `choose`:

```tsx
  const choose = (action: ProjectMenuAction) => {
    if (replacesProject(action)) {
      setConfirming(action);
      return;
    }
    if (action === 'export') {
      runExport();
      return;
    }
    if (action === 'save') {
      void runSave();
      return;
    }
    if (action === 'disconnect-drive') {
      // No confirm: it costs no work. The body, the autosaved slot and the
      // local session are untouched — only the Drive pointer and the token go.
      void disconnectDrive();
      return;
    }
    setChoosingTarget(true);
  };
```

6. Extend `confirmReplace`:

```tsx
  const confirmReplace = () => {
    const action = confirming;
    setConfirming(null);
    if (action === 'open') fileInputRef.current?.click();
    if (action === 'open-drive') setBrowser('open');
    if (action === 'new') newProject();
  };
```

7. Replace the `ConfirmDialog` block so the copy comes from the tables:

```tsx
      {confirming !== null && (
        <ConfirmDialog
          title={CONFIRM_TITLE[confirming as 'open' | 'open-drive' | 'new']}
          message={REPLACE_CONFIRM_MESSAGE}
          confirmLabel={CONFIRM_LABEL[confirming as 'open' | 'open-drive' | 'new']}
          onConfirm={confirmReplace}
          onCancel={() => setConfirming(null)}
        />
      )}
```

*The two casts are the price of `confirming: ProjectMenuAction | null`, which the existing code already had. If you prefer no casts, narrow the state to `'open' | 'open-drive' | 'new' | null` — `setConfirming(action)` is only ever called from the `replacesProject(action)` branch, and TypeScript narrows `action` there only if `replacesProject` returns a type predicate. Changing its signature to `action is ReplacingAction` is the honest fix and removes both casts; do that if it compiles cleanly, and leave the casts if it does not.*

8. Render the two dialogs beside the `ConfirmDialog`:

```tsx
      {choosingTarget && (
        <SaveAsTargetDialog
          open
          driveAvailable={driveAvailable}
          onClose={() => setChoosingTarget(false)}
          onLocal={() => {
            setChoosingTarget(false);
            void runSaveAs();
          }}
          onDrive={() => {
            setChoosingTarget(false);
            setBrowser('save-as');
          }}
        />
      )}
      {browser !== null && (
        <DriveFileBrowserModal
          open
          mode={browser}
          signedIn={driveSignedIn}
          initialName={defaultSaveName(projectName)}
          onClose={() => setBrowser(null)}
          onConnect={() => void connectDrive()}
          onList={listDrive}
          onOpenFile={(fileId) => void runOpenFromDrive(fileId)}
          onSaveAs={(name) => {
            setBrowser(null);
            void runSaveAsToDrive(name);
          }}
        />
      )}
```

and add the project name read beside the other store reads:

```tsx
  const projectName = useLiveStore((s) => s.projectName);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/components/project`
Expected: PASS — 3 (SaveAsTargetDialog) + 7 (ProjectMenu) + 6 (DriveFileBrowserModal) + the existing ProjectNotice tests.

Then the gates this task can break:

Run: `bun run check:theme`
Expected: PASS. `SaveAsTargetDialog` introduces `btn btn-ghost w-full justify-start gap-2 font-normal`, `w-4 h-4`, `text-base-content/60` — all present in the repo already. If the guard rejects one, replace it with a role-based class; never add to the guard's allowlist.

Run: `bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/project/SaveAsTargetDialog.tsx src/components/project/SaveAsTargetDialog.test.tsx src/components/project/DriveFileBrowserModal.tsx src/components/project/DriveFileBrowserModal.test.tsx src/components/project/ProjectMenu.tsx src/components/project/ProjectMenu.test.tsx
git commit -m "feat(drive): open and save to Drive from the project menu

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 17: The Google-origin source guard

**Files:**
- Test: `src/utils/googleOrigins.test.ts` (test only — it asserts about files that already exist)

**Interfaces:**
- Consumes: `node:fs`, `node:path`, `bun:test`. Nothing from `src/`.
- Produces: nothing importable. Its job is to fail the suite when a Google origin appears somewhere new.

**Why a source scan rather than a CSP:** `index.html` runs a blocking inline pre-paint theme script, so a `<meta http-equiv="Content-Security-Policy">` would either ban that script or need an `unsafe-inline`, and neither is acceptable for a policy whose whole value is being tight. The design files this under "build-time checklist item" for the same reason. The allowlist is three files, each one an origin's legitimate home:

| File | What it legitimately names |
| --- | --- |
| `src/utils/googleScriptLoader.ts` | the two script URLs (`accounts.google.com`, `apis.google.com`) |
| `src/store/driveAuth.ts` | the `drive.file` scope string (`www.googleapis.com/auth/drive.file`) |
| `src/store/driveGapi.ts` | the API base and the upload path (`www.googleapis.com`) |

Test files are outside the scan entirely — `driveAuth.test.ts` asserts the scope string and `googleScriptLoader.test.ts` asserts a rejected URL, and neither ships.

`vite.config.ts` names **no** Google API origin: its workbox rules cover `fonts.googleapis.com` and `fonts.gstatic.com`, and `fonts.googleapis.com` is excluded by the pattern's lookbehind rather than by an allowlist entry — so if a runtime cache rule is ever added for the Drive API, this test fails instead of the app caching an OAuth response.

**The one detail that decides whether this file guards anything:** a workbox `urlPattern` is a **regex literal**, so it spells the host with escaped dots (`www\.googleapis\.com`). A pattern matching only a bare dot never matches the very file it is aimed at, passes green forever, and reads in review as protection that does not exist. The pattern below therefore matches a dot in both spellings, and a test asserts it against the escaped form explicitly.

- [ ] **Step 1: Write the test**

Create `src/utils/googleOrigins.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');

/**
 * The literals are built from parts ON PURPOSE: this file is scanned by its own
 * rule, and a test that contains the strings it forbids would have to allowlist
 * itself — which is how a guard like this stops being read.
 */
const GOOGLEAPIS = ['goo', 'gleapis.com'].join('');
/**
 * Dots are matched as `[.\\]*\\.` — a literal dot OR an escaped one — because
 * the file this rule most needs to police writes its origins inside REGEX
 * LITERALS: workbox's `urlPattern: /^https:\/\/www\.googleapis\.com\//` spells
 * the host `www\.googleapis\.com`. A pattern that only matched a bare dot
 * passes that file happily and guards exactly nothing, which is the failure
 * mode this scan exists to prevent — so the shape is asserted below rather than
 * assumed.
 *
 * A lookbehind rather than a word boundary distinguishes the two cases that
 * differ by SUBDOMAIN: `fonts.googleapis.com` is a font host vite.config.ts
 * legitimately caches, `www.googleapis.com` is the API.
 */
/** A dot as it may appear in source: bare, or backslash-escaped inside a regex literal. */
const DOT = '\\\\?\\.';
/** `a.b.c` → a pattern matching `a.b.c` AND `a\.b\.c`. */
const host = (dotted: string): string => dotted.split('.').join(DOT);

const FORBIDDEN = new RegExp(
  [
    `(?<!fonts${DOT})${host(GOOGLEAPIS)}`,
    host('accounts.google.com'),
    host('apis.google.com'),
  ].join('|'),
);

/** The three files an origin may live in, and why each one is the right home. */
const ALLOWED = [
  'src/utils/googleScriptLoader.ts',
  'src/store/driveAuth.ts',
  'src/store/driveGapi.ts',
];

/** `fonts.googleapis.com` is a font host, not an API host, and is excluded by the pattern above. */
const FONTS_HOST = ['fonts', GOOGLEAPIS].join('.');

/**
 * `.test.ts(x)` files are EXCLUDED deliberately: a test that asserts ABOUT an
 * origin has to name it, and no test file reaches the bundle. This guard is
 * about what ships.
 */
function sourceFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, into);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) into.push(full);
  }
  return into;
}

function offenders(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return text.split('\n').filter((line) => FORBIDDEN.test(line));
}

describe('Google origins in the source', () => {
  test('appear only in the three files that own them', () => {
    const found = sourceFiles(join(ROOT, 'src'))
      .map((file) => relative(ROOT, file))
      .filter((file) => offenders(join(ROOT, file)).length > 0)
      .sort();
    expect(found).toEqual([...ALLOWED].sort());
  });

  test('the font host is not swept up by the rule, in either spelling', () => {
    // A guard that flagged the font origin would be switched off instead of
    // obeyed, so the exclusion is itself asserted rather than assumed.
    expect(FORBIDDEN.test(`url("https://${FONTS_HOST}/css2?family=Inter")`)).toBe(false);
    expect(FORBIDDEN.test(`urlPattern: /^https:\\/\\/${FONTS_HOST.replace(/\./g, '\\.')}\\//`)).toBe(false);
    expect(FORBIDDEN.test(`https://${GOOGLEAPIS}/drive/v3/files`)).toBe(true);
  });

  test('catches an API origin spelled the way a workbox rule spells it', () => {
    // THE test this guard lives or dies by. A `urlPattern` is a regex literal,
    // so its dots are backslash-escaped — and a rule that only matched a bare
    // dot would pass vite.config.ts forever while guarding nothing at all.
    const escaped = `www.${GOOGLEAPIS}`.replace(/\./g, '\\.');
    expect(FORBIDDEN.test(`urlPattern: /^https:\\/\\/${escaped}\\//`)).toBe(true);
  });

  test('vite.config.ts caches no Google origin', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(config).toContain(FONTS_HOST);
    // No runtime cache rule may name an API or script origin: a cached OAuth
    // response or a cached `gsi/client` is a sign-in that never expires and a
    // policy that can never be tightened.
    expect(offenders(join(ROOT, 'vite.config.ts'))).toEqual([]);
  });

  test('no source asks for a Drive scope wider than drive.file, and the Picker is unused', () => {
    const authPrefix = `${GOOGLEAPIS}/auth/`;
    const scopeLines: string[] = [];
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.includes(`${authPrefix}`)) scopeLines.push(line.trim());
      }
    }
    // Exactly one, in exactly one SHIPPING file: a second scope string anywhere
    // is how a broader grant arrives without anyone deciding to add it. Test
    // files are already excluded by sourceFiles.
    expect(scopeLines).toHaveLength(1);
    expect(scopeLines[0]).toContain(`${authPrefix}drive.file`);

    for (const file of sourceFiles(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      // The Picker is a non-goal: it is a Google-hosted iframe, a second origin,
      // and the API key it needs is the one thing this design removed.
      expect(text).not.toContain(['picker', GOOGLEAPIS].join('.'));
      expect(text).not.toContain(['gapi', 'load'].join('.') + "(" + "'picker'");
    }
  });
});
```

- [ ] **Step 2: Run the test and read the result**

Run: `bun test src/utils/googleOrigins.test.ts`
Expected: PASS — 5 tests, **if** Tasks 8-11 confined their literals as intended.

It is written to be the last word, not the first: if it fails, the fix is to move the literal into whichever of the three files owns it, or to import `DRIVE_SCOPE` from `driveAuth` in the test that needed it. The one legitimate change to `ALLOWED` is a file that genuinely becomes an origin's home — and a reviewer should be able to say which origin and why.

- [ ] **Step 3: Run the whole suite and the theme gate**

Run: `bun test`
Expected: PASS.

Run: `bun run check:theme`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/googleOrigins.test.ts
git commit -m "test(drive): guard the Google origins and the drive.file scope

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 18: The deployment variable and the docs this work makes stale

**Files:**
- Create: `.env.example`
- Modify: `CLAUDE.md`
- Modify: `docs/design.md`

**Why this is a task and not a footnote:** `VITE_GOOGLE_CLIENT_ID` is the only thing standing between a working build and a Drive-less one, and nothing in the repo currently names it — there is no `.env` and no `.env.example` (verified). And `CLAUDE.md` is the file every agent reads first: it describes the project slot, the storage zones and the layering, all three of which this work changes. Leaving it stale is how the next change is planned against a model of the code that no longer holds.

- [ ] **Step 1: The env example**

Create `.env.example`:

```bash
# The OAuth **web** client id for Google Drive (Save to / Open from Drive).
# Not a secret: an OAuth web client has no client secret, and this value ships
# in the built bundle. Leave it unset and solna works exactly as before, with
# every Drive affordance absent rather than disabled.
#
# To create one: Google Cloud Console -> APIs & Services -> Credentials ->
# Create credentials -> OAuth client ID -> Web application. Add the dev server
# origin (http://localhost:3000) and the production origin under
# "Authorized JavaScript origins". Leave "Authorized redirect URIs" EMPTY —
# Google Identity Services uses a popup, not a redirect. On the consent screen,
# add the single scope .../auth/drive.file and nothing else; the app may stay in
# Testing (up to 100 users) indefinitely.
VITE_GOOGLE_CLIENT_ID=
```

Confirm `.env` is already ignored, and add it if it is not:

Run: `git check-ignore -v .env || echo 'MISSING: add .env to .gitignore'`
Expected: a `.gitignore` line. If it prints MISSING, add `.env` and `.env.local` to `.gitignore` in this commit — an `.env.example` that invites a developer to create `.env` must not also invite them to commit it.

- [ ] **Step 2: Update `CLAUDE.md`**

Three statements in `CLAUDE.md` are no longer true after this work. Edit each one where it sits; do not add a changelog section.

| Claim | What it becomes |
| --- | --- |
| The storage section's "**Three storage zones**" | Four: `localStorage` (live session), `sessionStorage` (nothing), IndexedDB (the one project slot), and **Google Drive** (the optional remote source an explicit Save commits to). Add that the slot's value is a **record** `{ body, source }`, that the source never travels in the `.solna` body, and that `projectSource` is not a persist key. |
| `src/utils/` "stays outside the chain, above `data/`" | Still true in spirit, with the one new exception named: `utils/localFileSave.ts` and `utils/driveBrowser.ts` import *types and constants* from `src/store/` (the `.solna` MIME, the Drive MIME). Record it as a deliberate exception with its reason — the alternative is duplicating a contract string — rather than leaving a reader to discover the inversion. **If you would rather not take the exception, the honest alternative is to move those constants into a leaf module under `src/utils/` and have both layers import it; make that call here, once, and write down which way it went.** |
| The layering list's description of `src/store/` | Add that `store/driveAuth.ts` holds the only access token, in a closure, and that no slice may read it — `driveSignedIn` is a mirror, not the token. |

- [ ] **Step 3: Update `docs/design.md`**

Add Save / Save As / Open-from-Drive to whatever section describes what the app can do, and state the two capability facts a reader will otherwise be surprised by: local overwrite needs the File System Access API (Chromium today), and Drive only lists projects solna itself created.

- [ ] **Step 4: Verify and commit**

Run: `bun run verify`
Expected: PASS (no source changed, but `.env.example` should not break the build).

```bash
git add .env.example CLAUDE.md docs/design.md .gitignore
git commit -m "docs(project): document the Drive client id and the new storage model

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Task 19: Final verification

**Files:** none — this task changes no source file. Its deliverable is the proof that the two phases ship together, and a manual checklist for the parts no test can reach (a real Google account, a real file picker).

- [ ] **Step 1: The gate**

Run: `bun run verify`
Expected: PASS — `bun test`, `bun run lint` (tsc), `bun run eslint` (no errors AND no warnings), `check:keys`, `check:drums`, `check:contrast`, `check:levels`, `bun run build`.

`bun run eslint` reporting nothing is the state to keep it in. A `react-hooks/exhaustive-deps` warning from `DriverFileBrowserModal`'s effect means `onList` is not referentially stable: fix it with `useCallback` in ProjectMenu (Task 16 Step 3 item 4) rather than a disable comment.

- [ ] **Step 2: Phase 1, on its own**

Run:

```bash
bun test src/store/projectSource.test.ts src/utils/localFileSave.test.ts src/store/projectStore.test.ts src/store/projectSlice.test.ts src/store/projectBoot.test.ts src/store/projectAutosave.test.ts src/store/projectSave.test.ts src/components/project/ProjectMenu.test.tsx
```

Expected: PASS. Every one of these passes on a machine that has never seen a Google script — which is the shippable checkpoint between the phases, and worth re-proving here.

- [ ] **Step 3: Phase 2, on its own**

Run:

```bash
bun test src/utils/googleScriptLoader.test.ts src/store/driveAuth.test.ts src/store/driveClient.test.ts src/store/driveGapi.test.ts src/utils/driveBrowser.test.ts src/components/project/DriveFileBrowserModal.test.tsx src/store/driveSlice.test.ts src/utils/googleOrigins.test.ts src/components/project/SaveAsTargetDialog.test.tsx
```

Expected: PASS. No test in this list opens a socket, loads a script, or needs a token.

- [ ] **Step 4: The theme gate, explicitly**

Run: `bun run check:theme`
Expected: PASS. Three files added daisyUI classes in this work — `DriveFileBrowserModal.tsx`, `SaveAsTargetDialog.tsx` and `ProjectMenu.tsx`'s new row — and the guard's allowlist must still be empty.

- [ ] **Step 5: The manual smoke pass a human has to do**

No test can do these, because each needs a browser with a real file picker and a real Google account. Run `bun run dev` and work the list in order — it is split deliberately into an unconfigured half and a configured half, because "Drive is not set up" is a supported state and not a broken one.

First, **with `VITE_GOOGLE_CLIENT_ID` unset**, to prove the degraded path is the normal one:

1. Launch with an empty profile. The factory project loads, no notice, and the menu shows **no Drive rows at all** — not disabled ones.
2. Edit something; reload. The edit is back — the autosave path is untouched by this work.
3. Menu → **Save**. The OS save dialog appears prefilled with the project name + `.solna`. Save it.
4. Edit again; **Save**. The file is overwritten with NO dialog — the native-app behaviour, and the one thing only a browser can prove.
5. Reload the page. The project still names the same file: **Save** once more, with no dialog.
6. Menu → **Save As** → *This device* (the dialog offers only this row). Save under a new name: the header's name changes, a second file exists, and the first is untouched.
7. **The requirement's headline case.** Menu → **New project** (confirm), then **Open .solna** and pick the file from step 3. Edit a knob, then **Save**: the browser asks once for permission to edit that file, and after that the file's bytes and modified time change on disk with **no dialog and no second file**. This is the case an `<input type=file>` cannot serve, and the reason `showOpenFilePicker` is in Task 2.
8. Repeat step 7 but **deny** the permission prompt: a notice appears pointing at Save As, the live session is intact, and the file is untouched.

Then set `VITE_GOOGLE_CLIENT_ID` to an OAuth **web** client whose authorized JavaScript origin is the dev server, restart `bun run dev`, and:

9. Menu → **Open from Drive** (the row now exists). The modal opens on *Connect Google Drive*; connect, grant `drive.file` only, and confirm the consent screen asks for nothing wider. On a fresh account the list is then **empty with the hint**, which is correct and not a bug.
10. Menu → **Save As** → *Google Drive*, name it, **Save to Drive**. The file appears in Drive's web UI as an `application/vnd.solna` file in My Drive, and the project's source is now that id.
11. Edit; **Save**. Drive's modified time moves; the file's id does not change; no dialog appears.
12. Reload the page, then **Open from Drive**: the file is listed, opens, and its content matches. Save again — still an overwrite.
13. **In Drive's own web UI, move the file into a folder.** Back in solna, **Open from Drive**: it is still listed (the query filters on MIME, never on `parents`) and Save still overwrites it. This is the case the first draft's `'root' in parents` would have broken.
14. Upload an unrelated `.solna` to Drive by hand and refresh the list: it does **not** appear, and the empty-state hint explains why. Expected under `drive.file` — download it and use **Open .solna** instead.
15. Menu → **Disconnect Drive**. The row disappears, the project's source reverts to untitled, the body and the autosave are untouched, and the next **Save** routes to Save As.
16. In Safari or Firefox, repeat steps 3 and 7: Save downloads a copy and Open falls back to the file input, both leaving the project untitled — the capability probe, not an error.

- [ ] **Step 6: Nothing to commit**

```bash
git status --short
```

Expected: empty. A verification task produces no file; if this shows a modified source file, a task's edit escaped its commit.

## Self-review

Run against `docs/superpowers/specs/2026-09-12-project-source-and-google-drive-design.md` after the plan was complete.

**1. Spec coverage.** Every settled decision in the design maps to a task:

| Design requirement | Task |
| --- | --- |
| `ProjectSource` union; never in `serializeProject`; never a storage key | 1, 4 |
| Save dispatch as a pure function of `source` | 1, 5, 14 |
| Envelope hygiene: Save keeps `id`/`createdAt`, bumps `updatedAt`; Save As mints a fresh id and `createdAt = updatedAt = now` | 1, 5, 14 |
| Slot record `{ body, source }`; bare-body read sanitises to untitled; **no** `PERSIST_VERSION` bump | 1, 3, 4 |
| `ProjectStore` grows `save(record)`, `load()` returns the record, `status()`/result variants unchanged | 3 |
| Autosave writes the whole record and never changes `source` | 4, 5 |
| `source` changes only on Open / Save As / New / sign-out | 4, 5, 14 |
| Local **Open** via `showOpenFilePicker`, keeping the handle as the source | 2, 6 |
| Local Save via `showSaveFilePicker`, silent overwrite afterwards | 5, 6, 16 |
| `download` / `<input>` fallbacks as capability probes; source stays untitled | 2, 5, 6 |
| Handle permission re-request before the first write | 2, 5 |
| GIS token client, `drive.file`, `include_granted_scopes: false`, `prompt: ''`, revoke on sign-out | 9, 14 |
| Token in memory only, never in the store/persist | 9, 14, 15 |
| gapi `files.list` / `get?alt=media` / `create` / `update`; no Picker, no API key | 10, 11, 17 |
| Dedicated MIME `application/vnd.solna` | 10 |
| Flat project list (no folders, no `parents`), open + save-into-My-Drive; `check:theme` | 10, 12, 13 |
| The list renders an empty state, with the `drive.file` hint, rather than an error | 12, 13 |
| Menu: Open, Open from Drive, Save, Save As, Export, New, Disconnect | 6, 16 |
| Drive rows absent — not disabled — when the deployment has no client id | 16 |
| `driveSignedIn` set on token, cleared on revoke; re-request on expiry; a 401 that survives the retry clears it too | 9, 14 |
| Sign-out with a `drive` source reverts to `untitled`, body untouched | 14, 16 |
| A `drive` source that cannot be reached is not cleared automatically | 14 |
| Confirm-replace for Open/New only; Save, Save As and Disconnect never confirm | 6, 16 |
| Failed Save surfaces through `projectNotice`, never rolls back the session | 5, 14 |
| Script/connect allowlist as a source scan, in place of a CSP | 17 |
| `VITE_GOOGLE_CLIENT_ID` documented; absent is a normal degraded state | 9, 15, 18 |
| Testing delta: dispatch, slot sanitise, Drive client against a stub, list helpers, FS Access through stub handles (both directions), the `getServerSnapshot` / no-effects trap | 1, 2, 3, 10, 12, 13, 16 |

One deliberate departure from the design, recorded where it happens rather than here:

- **The OAuth client id comes from `VITE_GOOGLE_CLIENT_ID`.** The design's Configuration section now names the variable, but the plan is what decides it is read once at module scope (Task 15) and that an empty id fails as `unavailable` rather than `denied` (Task 9). No secret is involved — an OAuth web client has none.

**What this revision changed, and why each was not a style call:**

| Change | Why |
| --- | --- |
| Local Open through `showOpenFilePicker` (Tasks 2, 6) | The requirement is that Save overwrites the file that was opened. An `<input>` yields a read-only `File`, so the first draft's local Open could only ever produce a *second* file. |
| The Drive browser flattened; folders and `parents` removed (Tasks 10, 12, 13) | `drive.file` cannot see a folder the app did not create, so the folder UI would have rendered an empty tree forever and `'root' in parents` would have hidden any project the user filed away. |
| A **Disconnect Drive** row (Task 16) | `disconnectDrive` was specified, implemented and tested with no surface that could call it. |
| Drive rows gated on `driveAvailable` (Task 16) | The first draft hid the Drive row in the Save-As chooser but not in the menu, offering an Open flow that could never complete. |
| `readResultText` reads `response.body` (Task 11) | gapi leaves `result` as `false` for a content type it does not parse, and `application/vnd.solna` is one — every Drive open would have been reported as a malformed project. |
| `loadScript` reads `globalThis.document` (Task 8) | `globalThis` has no `createElement`; every test injected a `doc`, so nothing would have caught it before the browser did. |
| A 401 surviving the retry becomes a `DriveAuthError` (Task 9) | Otherwise the one failure that means "the grant is gone" is the one failure that leaves the menu claiming a connection. |
| `envelopeForSaveAs` lost its unused `now` (Task 1) | `@typescript-eslint/no-unused-vars` is an error here, so the first draft failed `bun run verify` at its first task. |
| `sanitizeSlotRecord` guards both branches alike (Task 1) | `{ body: {} }` passed the looser branch and would have thrown inside `install()` on `normalizeName(undefined)`. |
| `adoptSaveAs` / `applyProjectSource` are awaited (Tasks 5, 14) | A fire-and-forget slot write left the "did the source persist?" assertions depending on microtask ordering. |
| The origin scan matches escaped dots (Task 17) | A workbox `urlPattern` is a regex literal; the first draft's pattern could not match one, so the guard was green and empty. |
| Task 18 (env + docs) | `VITE_GOOGLE_CLIENT_ID` appeared only in a manual-test instruction, and `CLAUDE.md`'s storage and layering sections describe a model this work changes. |

**2. Placeholder scan.** No "TBD", no "similar to Task N", no step that describes work without the code that does it. Every test step carries the whole test file, and every implementation step carries the whole function. The three verification-only steps (Task 6 Step 4's theme gate, Task 17 Step 2's "read the result", Task 18's manual pass) state an exact command and an exact expected outcome.

**3. Type consistency across tasks.** Checked against the definitions rather than from memory:

- `ProjectStoreResult<ProjectSlotRecord>` — Task 3 changes `load`/`save`; Task 4's `ProjectSlice.save` and `openProjectFile` return exactly that.
- `saveTarget(source): SaveTarget` — a **route** union carrying its payload (`{ kind: 'local-write'; handle }`, `{ kind: 'drive-update'; fileId }`), so `switch (target.kind)` narrows with no cast.
- `saveAsBody(name)` / `adoptSaveAs(identity, name, source)` — defined in Task 5, called by Task 5's local path and Task 14's Drive path with the same argument order.
- `DriveListOutcome` — defined once in `utils/driveBrowser.ts` (Task 12), returned by `listDriveProjects` (Task 14) and consumed by the modal's `onList` (Task 13, 16).
- `DrivePage` / `DriveFileMeta` — defined in Task 10, used by Task 11's transport, Task 12's helpers and Task 14's slice without a second declaration.
- `ProjectSaveResult` and its `destination` values — `'local' | 'drive' | 'download' | 'cancelled'`; Task 14 returns `'drive'`, Task 5 returns the other three.
- `applyProjectSource` — added in Task 14, called by `driveSlice.disconnectDrive` only.
- `initialName` — added to `DriveFileBrowserModalProps` in Task 16 and passed from ProjectMenu in the same task.

**4. Known limits, on the record.** The Drive path is verified against fakes, so the first real `files.list` against a live account is the manual pass in Task 18 Step 5 — the API shape (v3 `q`, multipart framing, `alt=media`) is asserted from Task 10's and Task 11's tests, not from a network call. `FileSystemFileHandle` persistence across a restart is Chromium-only behaviour exercised at step 5/6 of the smoke pass; Task 2's seam is what makes the degraded path testable everywhere else.

## Execution handoff

Two execution options:

**1. Subagent-driven (recommended)** — a fresh subagent per task, with review between tasks. Each task in this plan is one reviewer-sized unit with its own tests and its own commit, so the checkpoint between tasks is real.

**2. Inline execution** — work the tasks in this session in order, stopping at Task 7 (the Phase 1 checkpoint), because that is the point at which the work is independently shippable.
