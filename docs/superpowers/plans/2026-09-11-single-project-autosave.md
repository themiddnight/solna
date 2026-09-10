# Single-Project Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Solna's named-project *library* with one autosaved project in IndexedDB, so launching the app resumes the project it was editing and `.solna` files are the only interchange.

**Architecture:** IndexedDB collapses to a single object store holding one fixed slot. `localStorage` shrinks to session/view prefs plus the user's preset/progression library. An idle-coalesced `subscribeWithSelector` subscription writes the content set on every change, so `dirty` and the whole fingerprint machinery are deleted. Boot becomes asynchronous behind a fullscreen loading gate, with a React error boundary as its counterpart.

**Tech Stack:** TypeScript, React 19, zustand 5 (+ `persist` / `subscribeWithSelector` / `shallow`), daisyUI 5.7, Vite 8, Bun (test runner), IndexedDB via the raw API.

**Spec:** `docs/superpowers/specs/2026-09-11-single-project-autosave-design.md`

## Global Constraints

- `bun run verify` is the completion gate — `test + lint + eslint + check:keys + check:drums + check:contrast + check:levels + build`. Run it before claiming any task is done.
- `bun run check:theme` fails on raw hex, Tailwind palette classes (`bg-gray-900`, `text-indigo-500`, …), `text-white`/`bg-black`, the `dark:` variant, `rgb()`/`rgba()` literals, `font-mono`, and dead utilities (`py-0.2`, `scale-102`, `z-60`, `xs:`). Its `ALLOWLIST` is empty and must stay empty — fix the code, never the allowlist. Components name daisyUI roles and theme tokens only.
- Layering: `src/store/` may import `src/audio/` and `src/data/`; `src/components/` may **not** import `audio/engine`. `import '../../'` is banned (use `@/` or `./`). `React.FC` is banned.
- `persist` serialises on every `set()`; only the `localStorage` write is coalesced. High-frequency state (playhead, knob drag values) must never write persisted state, and the autosave write must be idle-coalesced the same way.
- Storage access is always guarded. `localStorage` and IndexedDB can **throw**, not just return null; a failure is a degraded state the UI renders, never an exception path.
- Tests are `bun:test` with no DOM and no testing-library. zustand's `getServerSnapshot` serves the store's **creation-time** state, so a plain `useAppStore(selector)` under `renderToString` never sees a test's `setState` — use `useLiveStore` where live state must be reachable.
- Every commit message ends with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Branch: `feat/single-project-autosave` off `main`. Feature work never lands directly on `main`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/store/projectStore.ts` | The single-slot `ProjectStore` facade + the in-memory backend |
| `src/store/projectStoreIdb.ts` | The IndexedDB backend: one object store, one fixed key |
| `src/store/projectFormat.ts` | Envelope/content types, `buildProjectContent`, `applyProjectContent`, `factoryProjectContent` |
| `src/store/projectFile.ts` | `.solna` parse/serialize + `sanitizeContent` (unchanged this plan) |
| `src/store/projectSlice.ts` | The project actions: boot load, autosave write, new, open-file, export |
| `src/store/projectAutosave.ts` | **New.** The idle-coalesced writer (replaces `projectDirty.ts`) |
| `src/store/store.ts` | Persist wiring, boot entry point, pagehide/hidden flush |
| `src/components/ProjectLoading.tsx` | **New.** The fullscreen boot gate |
| `src/components/ErrorBoundary.tsx` | **New.** Crash boundary + `ErrorFallback` |
| `src/components/project/ProjectMenu.tsx` | **New.** The Wordmark dropdown: Open / Export / New |
| `src/components/Header.tsx` | Editable `ProjectNameLabel`, Wordmark wiring |

**Deleted:** `src/store/projectDirty.ts`, `src/store/projectFingerprint.ts`, `src/store/projectDirty.test.ts`, `src/store/projectDirtyBoot.test.ts`, `src/store/projectFingerprint.test.ts`, `src/components/project/ProjectManagerModal.tsx`, `ProjectList.tsx`, `ProjectDialogs.tsx`, `projectManagerFlow.ts` and their four test files.

---

### Task 1: Single-slot storage layer

**Files:**
- Modify: `src/store/projectStore.ts`
- Modify: `src/store/projectStoreIdb.ts`
- Test: `src/store/projectStore.test.ts` (rewritten)

**Interfaces:**
- Consumes: `normalizeStoredBody(body: ProjectBody): ProjectBody` from `./projectFile`; `ProjectBody` from `./projectFormat`.
- Produces:
  - `interface ProjectStoreBackend { getBody(): Promise<ProjectBody | undefined>; put(body: ProjectBody): Promise<void>; remove(): Promise<void>; }`
  - `interface ProjectStore { status(): ProjectStoreStatus; load(): Promise<ProjectStoreResult<ProjectBody>>; save(body: ProjectBody): Promise<ProjectStoreResult<ProjectBody>>; clear(): Promise<ProjectStoreResult<null>>; }`
  - `const PROJECT_SLOT_KEY: 'current'`
  - `createProjectStore(openBackend: () => Promise<ProjectStoreBackend>): ProjectStore`
  - `createMemoryBackend(seed?: ProjectBody): ProjectStoreBackend & { slot: Map<string, ProjectBody> }`
  - `openIndexedDbBackend(dbName?: string): Promise<ProjectStoreBackend>`
  - Messages: `QUOTA_MESSAGE`, `UNAVAILABLE_MESSAGE`, `NOT_FOUND_MESSAGE`, `FAILED_MESSAGE`

- [ ] **Step 1: Rewrite the failing test file**

Replace the whole of `src/store/projectStore.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test';
import { createMemoryBackend, createProjectStore, PROJECT_SLOT_KEY, QUOTA_MESSAGE } from './projectStore';
import { PROJECT_FORMAT_VERSION, factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
import { createDefaultLoop } from './loopSlice';
import { DEFAULT_LEAD_GATE, type LeadNote } from '../audio/leadMelody';

const body = (name: string, now = 1000): ProjectBody => ({ ...makeEnvelope(name, now), content: factoryProjectContent() });

describe('createProjectStore against the in-memory backend', () => {
  test('an empty slot is not-found — the normal first-run state, not an error', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    const result = await store.load();
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('not-found');
      expect(result.message).toBe('No project is stored on this device yet.');
    }
    expect(store.status()).toBe('ready');
  });

  test('save then load round-trips the whole body through the one slot', async () => {
    const backend = createMemoryBackend();
    const store = createProjectStore(async () => backend);
    const b = { ...body('Alpha'), content: { ...factoryProjectContent(), bpm: 143 } };
    const saved = await store.save(b);
    expect(saved.ok).toBe(true);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.content.bpm).toBe(143);
    expect(loaded.ok && loaded.value.id).toBe(b.id);
    expect(backend.slot.size).toBe(1);
    expect(backend.slot.has(PROJECT_SLOT_KEY)).toBe(true);
  });

  test('a second save overwrites the slot — there is no second row', async () => {
    const backend = createMemoryBackend();
    const store = createProjectStore(async () => backend);
    await store.save(body('First'));
    await store.save(body('Second'));
    expect(backend.slot.size).toBe(1);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.name).toBe('Second');
  });

  test('clear empties the slot; a later load is not-found again', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    await store.save(body('Doomed'));
    const cleared = await store.clear();
    expect(cleared.ok).toBe(true);
    const loaded = await store.load();
    expect(loaded.ok).toBe(false);
    if (loaded.ok === false) expect(loaded.error).toBe('not-found');
  });

  test('a failing open resolves to the degraded state and never throws', async () => {
    const store = createProjectStore(async () => {
      throw new Error('SecurityError: IndexedDB is blocked');
    });
    const load = await store.load();
    expect(load.ok).toBe(false);
    if (load.ok === false) expect(load.error).toBe('unavailable');
    expect(store.status()).toBe('unavailable');
    const save = await store.save(body('X'));
    expect(save.ok).toBe(false);
    if (save.ok === false) expect(save.error).toBe('unavailable');
    const clear = await store.clear();
    expect(clear.ok).toBe(false);
  });

  test('open is attempted once — a second call reuses the outcome', async () => {
    let opens = 0;
    const store = createProjectStore(async () => {
      opens++;
      return createMemoryBackend();
    });
    await store.load();
    await store.load();
    await store.save(body('Y'));
    expect(opens).toBe(1);
  });

  test('QuotaExceededError on save becomes the quota result with the spec message', async () => {
    const backend = createMemoryBackend();
    backend.put = async () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const store = createProjectStore(async () => backend);
    const result = await store.save(body('Big'));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('quota');
      expect(result.message).toBe(QUOTA_MESSAGE);
    }
  });

  test('any other backend throw becomes a failed result, not a rejection', async () => {
    const backend = createMemoryBackend();
    backend.getBody = async () => {
      throw new Error('boom');
    };
    const store = createProjectStore(async () => backend);
    const result = await store.load();
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe('failed');
  });
});

/**
 * The seam: `load` is where a stored body is READ, so it is where the format
 * chain runs. Nothing else reads the slot, so no caller has to remember.
 */
describe('load normalises the body it hands out', () => {
  const legacy = (): ProjectBody => {
    const loop = { ...createDefaultLoop(), id: 'loop-legacy' } as unknown as Record<string, unknown>;
    loop.leadMelodySteps = [['C4'], []];
    delete loop.leadGate;
    return {
      ...makeEnvelope('Legacy', 1000),
      formatVersion: 1,
      content: { ...factoryProjectContent(), loops: [loop] },
    } as unknown as ProjectBody;
  };

  test('a formatVersion-1 body comes back restamped, with its melody reset (not misread) and gated', async () => {
    const b = legacy();
    const store = createProjectStore(async () => createMemoryBackend(b));
    const hit = await store.load();
    expect(hit.ok).toBe(true);
    if (!hit.ok) return;
    expect(hit.value.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    const melody = hit.value.content.loops[0].leadMelodySteps as LeadNote[][];
    expect(melody).toEqual(createDefaultLoop().leadMelodySteps);
    expect(hit.value.content.loops[0].leadGate).toBe(DEFAULT_LEAD_GATE);
  });

  test('a body from a NEWER build is handed back verbatim, not downgrade-stamped', async () => {
    const b = { ...body('Future'), formatVersion: PROJECT_FORMAT_VERSION + 1 };
    const store = createProjectStore(async () => createMemoryBackend(b));
    const hit = await store.load();
    expect(hit.ok && hit.value.formatVersion).toBe(PROJECT_FORMAT_VERSION + 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectStore.test.ts`
Expected: FAIL — `PROJECT_SLOT_KEY` is not exported, and `store.load` / `store.save` / `store.clear` are not functions.

- [ ] **Step 3: Rewrite `src/store/projectStore.ts`**

Replace the whole file with:

```ts
import { normalizeStoredBody } from './projectFile';
import type { ProjectBody } from './projectFormat';

/**
 * The one slot. The single project is stored under a FIXED key rather than
 * under the envelope's `id`: the id is kept because `.solna`
 * (serializeProject / parseProjectFile) and the murva interop contract expect
 * it, but nothing looks the slot up by it, so opening a file that carries a
 * different id overwrites the same row instead of leaving a second one.
 */
export const PROJECT_SLOT_KEY = 'current';

export interface ProjectStoreBackend {
  getBody(): Promise<ProjectBody | undefined>;
  put(body: ProjectBody): Promise<void>;
  remove(): Promise<void>;
}

export type ProjectStoreStatus = 'unknown' | 'ready' | 'unavailable';
export type ProjectStoreError = 'unavailable' | 'quota' | 'not-found' | 'failed';
export type ProjectStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectStoreError; message: string };

export const QUOTA_MESSAGE = 'There is not enough storage space to save this project';
export const UNAVAILABLE_MESSAGE =
  'Project storage is unavailable on this device (private browsing or blocked site storage). Autosave is off, so export a .solna file to keep your work.';
export const NOT_FOUND_MESSAGE = 'No project is stored on this device yet.';
export const FAILED_MESSAGE = 'Project storage failed. Export the session to keep your work.';

export interface ProjectStore {
  status(): ProjectStoreStatus;
  load(): Promise<ProjectStoreResult<ProjectBody>>;
  save(body: ProjectBody): Promise<ProjectStoreResult<ProjectBody>>;
  clear(): Promise<ProjectStoreResult<null>>;
}

function isQuotaError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'QuotaExceededError';
}

/**
 * Wraps a backend so every call resolves to a typed result — an `open()` that
 * throws or rejects is a normal state ('unavailable'), not an exception path,
 * mirroring resolveStorage() in store.ts. Availability is resolved ONCE,
 * lazily, on the first call; boot is now what makes that first call, so the
 * open still costs nothing until something reads the slot.
 */
export function createProjectStore(openBackend: () => Promise<ProjectStoreBackend>): ProjectStore {
  let status: ProjectStoreStatus = 'unknown';
  let opening: Promise<ProjectStoreBackend | null> | null = null;

  const open = (): Promise<ProjectStoreBackend | null> => {
    opening ??= (async () => {
      try {
        const backend = await openBackend();
        status = 'ready';
        return backend;
      } catch {
        status = 'unavailable';
        return null;
      }
    })();
    return opening;
  };

  const run = async <T>(op: (backend: ProjectStoreBackend) => Promise<ProjectStoreResult<T>>) => {
    const backend = await open();
    if (!backend) return { ok: false as const, error: 'unavailable' as const, message: UNAVAILABLE_MESSAGE };
    try {
      return await op(backend);
    } catch (err) {
      if (isQuotaError(err)) return { ok: false as const, error: 'quota' as const, message: QUOTA_MESSAGE };
      return { ok: false as const, error: 'failed' as const, message: FAILED_MESSAGE };
    }
  };

  return {
    status: () => status,
    load: () =>
      run(async (b) => {
        const body = await b.getBody();
        // Every body LEAVES storage through here, so the format chain runs at
        // the one read site rather than at each caller.
        return body
          ? { ok: true as const, value: normalizeStoredBody(body) }
          : { ok: false as const, error: 'not-found' as const, message: NOT_FOUND_MESSAGE };
      }),
    save: (body) =>
      run(async (b) => {
        await b.put(body);
        return { ok: true as const, value: body };
      }),
    clear: () =>
      run(async (b) => {
        await b.remove();
        return { ok: true as const, value: null };
      }),
  };
}

/** Test double and the shape the IndexedDB backend must match. */
export function createMemoryBackend(seed?: ProjectBody) {
  const slot = new Map<string, ProjectBody>();
  if (seed) slot.set(PROJECT_SLOT_KEY, structuredClone(seed));
  const backend: ProjectStoreBackend & { slot: typeof slot } = {
    slot,
    getBody: async () => slot.get(PROJECT_SLOT_KEY),
    put: async (body) => {
      slot.set(PROJECT_SLOT_KEY, structuredClone(body));
    },
    remove: async () => {
      slot.delete(PROJECT_SLOT_KEY);
    },
  };
  return backend;
}
```

- [ ] **Step 4: Rewrite `src/store/projectStoreIdb.ts`**

Replace the whole file with:

```ts
import type { ProjectStoreBackend } from './projectStore';
import { PROJECT_SLOT_KEY } from './projectStore';
import type { ProjectBody } from './projectFormat';

export const PROJECT_DB_NAME = 'solna-projects';
/**
 * Bumped from 1: the single slot replaces the old two-store library layout
 * outright. Solna has no real users, so the upgrade is a drop — the old
 * `projects` / `projectMeta` stores are not read and not migrated.
 */
export const PROJECT_DB_VERSION = 2;
const SLOT = 'project';

/**
 * How long to wait for an open that never fires an event. Generous on purpose:
 * a cold first-run open on a slow device under storage pressure can take
 * seconds, and timing that out costs the user the session's autosave. Only a
 * genuinely stuck webview should reach this.
 */
const OPEN_TIMEOUT_MS = 10_000;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

/**
 * Opens (and on first use creates) the single-slot database. Rejects — instead
 * of throwing synchronously — when `indexedDB` is missing, blocked or errors on
 * open; createProjectStore turns that rejection into the degraded state, and a
 * stuck open is bounded by a timeout so boot cannot hang forever.
 */
export function openIndexedDbBackend(dbName = PROJECT_DB_NAME): Promise<ProjectStoreBackend> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('indexedDB missing');
      request = indexedDB.open(dbName, PROJECT_DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      // The open is abandoned, but the request is not cancellable: if it does
      // succeed later, nothing would ever close the connection, and a live
      // IDBDatabase holds the version lock against every other tab. Take the
      // result only to close it.
      request.onsuccess = () => request.result.close();
      reject(new Error('indexedDB open timed out'));
    }, OPEN_TIMEOUT_MS);
    request.onupgradeneeded = () => {
      const db = request.result;
      // `deleteObjectStore` before the transactional create/delete rule bites:
      // dropping the old library stores belongs in the same versionchange
      // transaction that declares the new one.
      for (const name of [...db.objectStoreNames]) {
        if (name !== SLOT) db.deleteObjectStore(name);
      }
      if (!db.objectStoreNames.contains(SLOT)) db.createObjectStore(SLOT);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error('indexedDB open failed'));
    };
    request.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('indexedDB open blocked'));
    };
  }).then((db): ProjectStoreBackend => ({
    // A keyPath-less store takes an explicit key on every put; one fixed key
    // means put() overwrites the slot and the store never grows past one row.
    getBody: async () => {
      const tx = db.transaction(SLOT, 'readonly');
      return requestToPromise(tx.objectStore(SLOT).get(PROJECT_SLOT_KEY) as IDBRequest<ProjectBody | undefined>);
    },
    put: async (body) => {
      const tx = db.transaction(SLOT, 'readwrite');
      tx.objectStore(SLOT).put(body, PROJECT_SLOT_KEY);
      await transactionDone(tx);
    },
    remove: async () => {
      const tx = db.transaction(SLOT, 'readwrite');
      tx.objectStore(SLOT).delete(PROJECT_SLOT_KEY);
      await transactionDone(tx);
    },
  }));
}
```

- [ ] **Step 5: Run the storage tests to verify they pass**

Run: `bun test src/store/projectStore.test.ts`
Expected: PASS — 10 tests, 0 failures.

- [ ] **Step 6: Note the known break and confirm the test count**

`bun run lint` will now report errors in `src/store/projectSlice.ts` (it calls the removed `projectStore.list/get/put/remove`) and in `src/store/store.ts` (`toMeta` is gone). **This is expected**; Task 2 resolves it in the very next commit. Do not "fix" it here by keeping a shim.

Run: `bun test src/store/projectStore.test.ts`
Expected: PASS. Do not run `bun run verify` at this point — the tree is mid-change by design.

- [ ] **Step 7: Commit**

```bash
git add src/store/projectStore.ts src/store/projectStoreIdb.ts src/store/projectStore.test.ts
git commit -m "refactor(project-store): collapse the library to a single autosave slot

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Slice collapse

**Files:**
- Modify: `src/store/projectSlice.ts` (rewritten)
- Modify: `src/store/projectFormat.ts` (drop `ProjectMeta`)
- Modify: `src/store/store.ts` (`partializeAppState`, `sanitizePersistedState` — the two removed identity fields only)
- Modify: `src/store/types.ts` (drop `ProjectIdentityState`; drop the two identity fields from `PersistedState`)
- Modify: `src/store/uiSlice.ts` (drop `isProjectManagerOpen` / `setIsProjectManagerOpen`)
- Modify: `src/store/soloNav.test.ts`
- Modify: `src/App.tsx` (drop the `refreshProjects` boot effect and `<ProjectManagerModal />`)
- Modify: `src/components/Header.tsx` (read-only name from `projectName`; Wordmark inert)
- Delete: `src/components/project/ProjectManagerModal.tsx`, `ProjectList.tsx`, `ProjectDialogs.tsx`, `projectManagerFlow.ts`, `ProjectManagerModal.test.tsx`, `ProjectList.test.tsx`, `ProjectDialogs.test.tsx`, `projectManagerFlow.test.ts`
- Test: `src/store/projectSlice.test.ts` (rewritten)

**Interfaces:**
- Consumes: `ProjectStore`, `ProjectStoreResult`, `ProjectStoreStatus`, `createMemoryBackend` (Task 1); `applyProjectContent`, `buildProjectContent`, `factoryProjectContent`, `makeEnvelope`, `newProjectId`, `PROJECT_FORMAT_VERSION`, `ProjectBody`, `ProjectContent` from `./projectFormat`; `unknownLibraryReferences` from `./projectFile`; `resolveActiveLoop`, `loopStatePatch` from `./loop`.
- Produces:
  - `interface ProjectSlice { projectName: string | null; projectStoreStatus: ProjectStoreStatus; projectNotice: string | null; setProjectNotice(notice: string | null): void; setProjectName(name: string): void; loadProject(): Promise<void>; save(): Promise<ProjectStoreResult<ProjectBody>>; newProject(): void; openProjectFile(body: ProjectBody): Promise<ProjectStoreResult<ProjectBody>>; exportProjectFile(): ProjectBody; }`
  - `createProjectSlice(set, get, projectStore, now?: () => number): ProjectSlice`
  - `const INSTALL_RELEASE = 0.02`
  - `export function projectDisplayName(name: string | null): string` (in `src/components/Header.tsx`)

- [ ] **Step 1: Write the failing slice test**

Replace the whole of `src/store/projectSlice.test.ts` with:

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { unknownLibraryReferences } from './projectFile';
import { buildProjectContent, factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
import { DEFAULT_LOOP_ID, createDefaultLoop } from './loopSlice';
import { LOOP_FLAT_KEYS } from './loop';
import type { AppStore } from './types';

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

let storeModule: Promise<typeof import('./store')>;
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new FakeLocalStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  storeModule = import(`./store?bust=${Date.now()}`);
});

/** A fresh slice bound to the live store but to ITS OWN memory backend. */
async function sliceWithBackend(seed?: ProjectBody) {
  const { useAppStore } = await storeModule;
  const { createProjectSlice } = await import('./projectSlice');
  const backend = createMemoryBackend(seed);
  const store = createProjectStore(async () => backend);
  const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, store, () => 5_000);
  useAppStore.setState({ ...slice, projectName: null });
  return { useAppStore, backend, store, slice: useAppStore.getState() as AppStore };
}

const stored = (name: string, bpm: number): ProjectBody => ({
  ...makeEnvelope(name, 1_000),
  content: { ...factoryProjectContent(), bpm, loops: [{ ...createDefaultLoop(), id: `loop-${name}` }] },
});

/** The engine seam: stopSource no-ops before init(), so the spy only records. */
let stopSource: ReturnType<typeof spyOn>;
beforeEach(async () => {
  const { useAppStore } = await storeModule;
  useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped', selectedVibeId: null });
  stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
});
afterEach(() => {
  stopSource.mockRestore();
});

describe('loadProject (boot)', () => {
  test('an empty slot keeps the factory session, leaves the name untitled and writes nothing', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    const before = useAppStore.getState().bpm;
    await slice.loadProject();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(before);
    expect(s.projectName).toBeNull();
    expect(s.projectStoreStatus).toBe('ready');
    expect(s.projectNotice).toBeNull();
    expect(backend.slot.size).toBe(0);
  });

  test('a stored project installs with the reset rules, in one set(), with the voice tails cut first', async () => {
    const p = stored('Alpha', 77);
    const { useAppStore, slice } = await sliceWithBackend(p);
    useAppStore.setState({ sequencerPlayer: 'playing', selectedVibeId: 'cyber-dance', focusTrack: 'bass', metronomeActive: true, songLoopIndex: 2 });
    const order: string[] = [];
    stopSource.mockImplementation(() => { order.push('cut'); });
    const unsub = useAppStore.subscribe((s, prev) => { if (s.bpm !== prev.bpm) order.push('set'); });
    await slice.loadProject();
    unsub();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(77);
    expect(s.selectedVibeId).toBeNull();
    expect(s.activeLoopId).toBe('loop-Alpha');
    expect(s.songLoopIndex).toBeNull();
    expect(s.projectName).toBe('Alpha');
    // The cuts run BEFORE the content set, or engineSync's synchronous
    // subscriptions would let the old project's queued voices ring over it.
    expect(order.indexOf('cut')).toBeLessThan(order.indexOf('set'));
  });

  test('a project with unknown library references still loads, and says so', async () => {
    const p = stored('Alpha', 77);
    p.content.loops[0].soundKit = 'Nonexistent Kit';
    const { useAppStore, slice } = await sliceWithBackend(p);
    await slice.loadProject();
    const notice = useAppStore.getState().projectNotice ?? '';
    expect(notice).toContain('unrecognised references');
    expect(notice).toContain('drum kit "Nonexistent Kit"');
  });

  test('unavailable storage keeps the factory session and sets the degraded notice', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const failed = createProjectStore(async () => { throw new Error('blocked'); });
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, failed, () => 5_000);
    const before = useAppStore.getState().bpm;
    await slice.loadProject();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(before);
    expect(s.projectStoreStatus).toBe('unavailable');
    expect(s.projectNotice).toContain('storage is unavailable');
  });

  test('a persisted activeLoopId naming no loaded loop is pinned to loops[0]', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    useAppStore.setState({ activeLoopId: 'loop-from-a-previous-project' });
    await slice.loadProject();
    expect(useAppStore.getState().activeLoopId).toBe(useAppStore.getState().loops[0].id);
  });
});

describe('save (autosave write)', () => {
  test('writes the live content under the current envelope and publishes status', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    useAppStore.setState({ bpm: 155 });
    const result = await slice.save();
    expect(result.ok).toBe(true);
    const row = backend.slot.get('current');
    expect(row?.content.bpm).toBe(155);
    expect(row?.name).toBe('');
    expect(useAppStore.getState().projectStoreStatus).toBe('ready');
  });

  test('an unavailable save leaves the live session untouched and surfaces the notice', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const failed = createProjectStore(async () => { throw new Error('blocked'); });
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, failed, () => 5_000);
    useAppStore.setState({ bpm: 91 });
    const result = await slice.save();
    expect(result.ok).toBe(false);
    // The live session never rolls back: there is no "Save" to fail.
    expect(useAppStore.getState().bpm).toBe(91);
    expect(useAppStore.getState().projectNotice).toContain('storage is unavailable');
  });
});

describe('newProject', () => {
  test('installs factory content, clears the name and writes the empty project', async () => {
    const p = stored('Alpha', 77);
    const { useAppStore, backend, slice } = await sliceWithBackend(p);
    await slice.loadProject();
    useAppStore.setState({ bpm: 200 });
    useAppStore.getState().newProject();
    expect(useAppStore.getState().bpm).toBe(120);
    expect(useAppStore.getState().projectName).toBeNull();
    // newProject saves explicitly, so a New on an already-factory session
    // still writes the slot instead of leaving it empty.
    expect(backend.slot.get('current')?.content.bpm).toBe(120);
  });
});

describe('openProjectFile', () => {
  test('adopts the file’s envelope, installs its content and becomes the autosaved project', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    const file = stored('From Disk', 99);
    const result = await slice.openProjectFile(file);
    expect(result.ok).toBe(true);
    expect(useAppStore.getState().projectName).toBe('From Disk');
    expect(useAppStore.getState().bpm).toBe(99);
    expect(backend.slot.get('current')?.id).toBe(file.id);
  });

  test('an empty name in the file reads back as untitled', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    await slice.openProjectFile(stored('', 99));
    expect(useAppStore.getState().projectName).toBeNull();
  });

  test('the file still installs when storage is unavailable — it is just nobody’s project', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const failed = createProjectStore(async () => { throw new Error('blocked'); });
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, failed, () => 5_000);
    const result = await slice.openProjectFile(stored('From Disk', 99));
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().bpm).toBe(99);
    expect(useAppStore.getState().projectName).toBe('From Disk');
  });
});

describe('exportProjectFile', () => {
  test('serialises the live session through the content key allow-list', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    useAppStore.setState({ bpm: 133, selectedVibeId: 'cyber-dance', metronomeActive: true });
    const body = useAppStore.getState().exportProjectFile();
    expect(body.content).toEqual(buildProjectContent(useAppStore.getState()));
    expect(Object.keys(body.content).sort()).toEqual(['bpm', 'effects', 'loops', 'masterVolume', 'meterId']);
    expect('selectedVibeId' in body.content).toBe(false);
  });

  test('an untitled session exports an empty name rather than a placeholder', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    expect(useAppStore.getState().exportProjectFile().name).toBe('');
  });
});

describe('the loop-mirroring set', () => {
  test('installs the incoming loops array verbatim when loops[0].id equals the current activeLoopId', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const { createLoopMirroringSet } = await import('./loopSync');

    const incoming: ProjectBody = {
      ...makeEnvelope('Mirrored', 1_000),
      content: {
        ...factoryProjectContent(),
        bpm: 143,
        loops: [{ ...createDefaultLoop(), id: DEFAULT_LOOP_ID, scaleRoot: 'D', scaleType: 'Dorian', bassOctave: 3 }],
      },
    };
    const store = createProjectStore(async () => createMemoryBackend(incoming));
    const mirroringSet = createLoopMirroringSet(useAppStore.setState, useAppStore.getState);
    const slice = createProjectSlice(mirroringSet, useAppStore.getState, store, () => 5_000);
    useAppStore.setState({
      ...slice,
      activeLoopId: DEFAULT_LOOP_ID,
      loops: [{ ...createDefaultLoop(), scaleRoot: 'A', scaleType: 'Natural Minor', bassOctave: 2 }],
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
      bassOctave: 2,
    });

    await slice.loadProject();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(143);
    expect(s.loops).toHaveLength(1);
    for (const key of LOOP_FLAT_KEYS) {
      expect(s.loops[0][key]).toEqual(incoming.content.loops[0][key]);
      expect(s[key]).toEqual(s.loops[0][key]);
    }
    expect(unknownLibraryReferences(s.exportProjectFile().content)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectSlice.test.ts`
Expected: FAIL — `slice.loadProject` is not a function; `createProjectSlice` has no `projectName`.

- [ ] **Step 3: Rewrite `src/store/projectSlice.ts`**

Replace the whole file with:

```ts
import type { StoreApi } from 'zustand';
import { audioEngine } from '../audio/engine';
import { ACCOMPANIMENT_SOURCES } from '../audio/playback/playbackEngine';
import type { AppStore } from './types';
import {
  applyProjectContent,
  buildProjectContent,
  factoryProjectContent,
  makeEnvelope,
  newProjectId,
  type ProjectBody,
  type ProjectContent,
  type ProjectEnvelope,
} from './projectFormat';
import { unknownLibraryReferences } from './projectFile';
import { loopStatePatch, resolveActiveLoop } from './loop';
import type { ProjectStore, ProjectStoreResult, ProjectStoreStatus } from './projectStore';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

export interface ProjectSlice {
  /** The envelope's name. null = untitled (never named, or a fresh slot). */
  projectName: string | null;
  projectStoreStatus: ProjectStoreStatus;
  /** A non-blocking toast surface: unknown references, quota, unavailable. */
  projectNotice: string | null;
  setProjectNotice: (notice: string | null) => void;
  setProjectName: (name: string) => void;
  /** Boot: read the one slot and install it (or keep the factory session). */
  loadProject: () => Promise<void>;
  /** The autosave write. Never throws; a failure surfaces as a notice. */
  save: () => Promise<ProjectStoreResult<ProjectBody>>;
  newProject: () => void;
  openProjectFile: (body: ProjectBody) => Promise<ProjectStoreResult<ProjectBody>>;
  exportProjectFile: () => ProjectBody;
}

/**
 * Same instant-but-clickless release loadLoop uses (LOAD_LOOP_RELEASE in
 * loadLoop.ts). Not imported from there: loadLoop imports the store module,
 * and this slice is part of building it.
 */
export const INSTALL_RELEASE = 0.02;

/** Untitled reads as an empty name on disk; `null` is its in-store spelling. */
function normalizeName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The project's envelope, minus the name (which lives in the store so the
 * header can render it). The `id` is kept but INERT: it rides the `.solna`
 * contract and is adopted from an opened file, but the storage slot is a fixed
 * key, so nothing looks a project up by it.
 */
interface SlotIdentity {
  id: string;
  createdAt: number;
}

/**
 * Lifecycle actions. Every path that replaces the live session goes through
 * `install`, in loadLoop's order: hardStopAll (dispatches the reducer's
 * 'stop-all', whose frozen singleton songMode compares by reference) → cut the
 * chord and bass voices → ONE set() carrying the content, the reset rules, the
 * flat per-loop patch and the identity. The cut happens BEFORE the set():
 * engineSync's subscriptions fire synchronously on that write, and a cut after
 * it would race them and let the old project's queued voices ring over the
 * new one. Drums are one-shots; one already-scheduled hit may still land.
 */
export function createProjectSlice(
  set: Set,
  get: Get,
  projectStore: ProjectStore,
  now: () => number = Date.now,
): ProjectSlice {
  let slot: SlotIdentity = { id: newProjectId(), createdAt: now() };

  const install = (content: ProjectContent, identity: ProjectEnvelope): void => {
    get().hardStopAll();
    for (const source of ACCOMPANIMENT_SOURCES) {
      audioEngine.stopSource(source, INSTALL_RELEASE);
    }
    slot = { id: identity.id, createdAt: identity.createdAt };
    set({
      ...applyProjectContent(content),
      // A song-mode cursor into the OLD project's loops[] must not survive
      // the swap: it would index the new project's loops[] instead (out of
      // range, or in range but pointing at the wrong loop) and enterSongIndex
      // is skipped once the cursor is non-null. loadLoop recomputes it on
      // every loops/activeLoopId change; a wholesale content swap has no
      // such recompute, so it is reset here explicitly.
      songLoopIndex: null,
      // A latched track solo is scoped to the surface the user set it on, and a
      // whole-content swap is the most complete surface change there is.
      // soloNav.ts's SOLO_NAV_KEYS cannot catch this on its own: loop ids are
      // not unique across projects, so the incoming project's first loop can
      // carry the same id the outgoing one did (every fresh project's default
      // loop is `loop-default-1`), and this patch writes neither activeTab nor
      // focusTrack. Clearing it here, in the same atomic set() as the content,
      // is what makes the guarantee hold regardless of which loop id lands.
      soloTracks: [],
      // Same reasoning, same atomic patch: the arm is scoped to the loop the
      // user was recording into, and a whole-content swap leaves nothing for
      // it to still name.
      recordingTrack: null,
      projectName: normalizeName(identity.name),
    });
  };

  /** Re-publish availability only when it CHANGED — a store write per autosave would re-render every mounted view. */
  const publishStatus = (): void => {
    const next = projectStore.status();
    if (get().projectStoreStatus !== next) set({ projectStoreStatus: next });
  };

  /**
   * `activeLoopId` is persisted while `loops` now comes from IndexedDB, so a
   * stored value can name a loop the loaded project does not have — the same
   * reconciliation persist `merge` does for a localStorage payload.
   */
  const reconcileActiveLoop = (): void => {
    const { loops, activeLoopId } = get();
    if (loops.some((row) => row.id === activeLoopId)) return;
    const active = resolveActiveLoop(loops, null);
    set({ activeLoopId: active.id, ...loopStatePatch(active) });
  };

  return {
    projectName: null,
    projectStoreStatus: 'unknown',
    projectNotice: null,

    setProjectNotice: (projectNotice) => set({ projectNotice }),

    setProjectName: (name) => set({ projectName: normalizeName(name) }),

    loadProject: async () => {
      const result = await projectStore.load();
      publishStatus();
      if (result.ok === false) {
        if (result.error === 'not-found') {
          // Empty slot: a normal first run. Keep the factory content the
          // slices already booted with — no install, so nothing is announced
          // and the engine is not touched. The first autosave writes the slot.
          slot = { id: newProjectId(), createdAt: now() };
        } else {
          set({ projectNotice: result.message });
        }
        reconcileActiveLoop();
        return;
      }
      const body = result.value;
      install(body.content, body);
      const warnings = unknownLibraryReferences(body.content);
      set({
        projectNotice:
          warnings.length > 0 ? `Opened with unrecognised references: ${warnings.join(', ')}` : null,
      });
      reconcileActiveLoop();
    },

    save: async () => {
      const body: ProjectBody = {
        formatVersion: PROJECT_FORMAT_VERSION,
        id: slot.id,
        name: get().projectName ?? '',
        createdAt: slot.createdAt,
        updatedAt: now(),
        content: buildProjectContent(get()),
      };
      const result = await projectStore.save(body);
      publishStatus();
      // A failed autosave never blocks the app and never rolls the live
      // session back — the notice is the only signal, and the next idle
      // window retries on its own.
      if (result.ok === false) set({ projectNotice: result.message });
      return result;
    },

    newProject: () => {
      install(factoryProjectContent(), makeEnvelope('', now()));
      set({ projectNotice: null });
      // Explicit, not left to the content subscription: New on an
      // already-factory session changes nothing content-wise, so nothing
      // would schedule a write and the slot would stay empty.
      void get().save();
    },

    openProjectFile: async (body) => {
      install(body.content, body);
      const result = await get().save();
      const warnings = unknownLibraryReferences(body.content);
      set({
        projectNotice:
          warnings.length > 0 ? `Opened with unrecognised references: ${warnings.join(', ')}` : null,
      });
      return result;
    },

    exportProjectFile: (): ProjectBody => ({
      formatVersion: PROJECT_FORMAT_VERSION,
      id: slot.id,
      name: get().projectName ?? '',
      createdAt: slot.createdAt,
      updatedAt: now(),
      content: buildProjectContent(get()),
    }),
  };
}
```

**Note the import list:** `PROJECT_FORMAT_VERSION` must be in the `./projectFormat` import at
the top of the file — every builder (`save`, `exportProjectFile`) stamps it. There is no
`envelope()` helper; each action builds its body inline from `slot` and `get().projectName`.

- [ ] **Step 4: Run the slice tests to verify they pass**

Run: `bun test src/store/projectSlice.test.ts`
Expected: PASS — 13 tests, 0 failures.

- [ ] **Step 5: Trim `src/store/projectFormat.ts`**

`ProjectMeta` existed only as a library list row. Delete it — the envelope is `ProjectEnvelope` and `ProjectBody` already extends it:

```ts
// delete this line and its docblock comment
export type ProjectMeta = ProjectEnvelope;
```

- [ ] **Step 6: Trim `src/store/types.ts`**

Delete the `ProjectIdentityState` interface (its docblock is one line):

```ts
/** Persisted project identity — extended by ProjectSlice in projectSlice.ts. */
export interface ProjectIdentityState {
  currentProjectId: string | null;
  projectBaselineHash: string | null;
}
```

Then delete these two lines from `PersistedState`:

```ts
  currentProjectId: string | null;
  projectBaselineHash: string | null;
```

- [ ] **Step 7: Trim `src/store/store.ts`**

In `partializeAppState`, delete the two identity lines:

```ts
    currentProjectId: state.currentProjectId,
    projectBaselineHash: state.projectBaselineHash,
```

In `sanitizePersistedState`, delete the two lines before its `return`:

```ts
  sanitized.currentProjectId = asNullableString(sanitized.currentProjectId);
  sanitized.projectBaselineHash = asNullableString(sanitized.projectBaselineHash);
```

Also remove `asNullableString` from the `./sanitize` import list (it has no other user in this file).

- [ ] **Step 8: Trim `src/store/uiSlice.ts`**

Delete the `isProjectManagerOpen: false,` state field and the `setIsProjectManagerOpen: (isProjectManagerOpen) => set({ isProjectManagerOpen }),` action, and both declarations from `UiSlice` in `src/store/types.ts` (`isProjectManagerOpen: boolean;` and `setIsProjectManagerOpen: (open: boolean) => void;`).

- [ ] **Step 9: Delete the library UI and fix the two call sites**

```bash
git rm src/components/project/ProjectManagerModal.tsx \
       src/components/project/ProjectManagerModal.test.tsx \
       src/components/project/ProjectList.tsx \
       src/components/project/ProjectList.test.tsx \
       src/components/project/ProjectDialogs.tsx \
       src/components/project/ProjectDialogs.test.tsx \
       src/components/project/projectManagerFlow.ts \
       src/components/project/projectManagerFlow.test.ts
```

In `src/App.tsx`: delete the `ProjectManagerModal` import, delete the `<ProjectManagerModal />` element next to `<MidiSettingsModal />`, and delete the whole boot effect that calls `refreshProjects`:

```ts
  // A reloaded session restores `currentProjectId` from persisted state
  // synchronously, but `currentProjectName` is transient — resolved only by
  // refreshProjects() against IndexedDB, which ProjectManagerModal otherwise
  // runs lazily on first open. Without this, the header shows "Unnamed
  // project" for a saved project until the user opens that modal once. Only
  // fired when there is an id to resolve, so a fresh untitled session pays
  // nothing.
  useEffect(() => {
    if (useAppStore.getState().currentProjectId) {
      void useAppStore.getState().refreshProjects();
    }
  }, []);
```

(Task 4 replaces it with the real boot call, behind the loading gate.)

- [ ] **Step 10: Make `ProjectNameLabel` read-only again and the Wordmark inert**

In `src/components/Header.tsx`, replace the `sessionLabel` import with nothing (the module that exported it is gone) and add this exported pure helper above `ProjectNameLabel`:

```ts
/** Untitled has no name to show; the label is the app's only spelling of it. */
export const UNTITLED_PROJECT_LABEL = 'Untitled project';

export function projectDisplayName(name: string | null): string {
  return name ?? UNTITLED_PROJECT_LABEL;
}
```

Replace `ProjectNameLabel`'s props and body:

```tsx
interface ProjectNameLabelProps {
  layer: Layer;
  name: string | null;
}

export function ProjectNameLabel({ layer, name }: ProjectNameLabelProps) {
  if (layer !== 'song') return null;
  const label = projectDisplayName(name);
  return (
    <div className={`hidden sm:flex ${HEADER_FIELD_SHELL}`}>
      <span className={GROUP_LABEL}>Project</span>
      <span
        id="header-project-name"
        title={label}
        className={`text-xs font-semibold truncate max-w-[10rem] ${
          name ? 'text-base-content/80' : 'text-base-content/50 italic'
        }`}
      >
        {label}
      </span>
    </div>
  );
}
```

In the `Header` component body, replace the three live-store reads (`dirty`, `setIsProjectManagerOpen`, `currentProjectId`) plus `currentProjectName` with:

```tsx
  const projectName = useLiveStore((s) => s.projectName);
```

and update the two call sites:

```tsx
        <Wordmark textClassName="hidden sm:inline" onClick={() => {}} />
```

```tsx
        <ProjectNameLabel layer={layer} name={projectName} />
```

`onClick={() => {}}` is a deliberate one-task placeholder — Task 5 replaces the whole thing with `ProjectMenu`. `useLiveStore` stays imported (the `projectName` read uses it).

- [ ] **Step 11: Fix `src/store/soloNav.test.ts`**

Its `baseline` snapshot names the fields `install()` used to write. Delete the four entries that no longer exist — `'currentProjectId'`, `'currentProjectName'`, `'projectBaselineHash'`, `'dirty'` — from the `Pick<...>` union, from the `baseline = { ... }` object literal, and from the restore assignment at the end of the file. Update the comment above `baseline` to read:

```ts
// Covers everything `newProject()` -> `install()` writes, not just
// activeLoopId/loops/playbackScope/bpm: the "project content swap" test below
// drives the real installer, which also touches projectName, songLoopIndex,
// meterId, masterVolume and effects. Bun does not isolate modules per test
// file, so an unrestored write here leaks into whichever file the process runs
// next.
```

Run: `bun test src/store/soloNav.test.ts`
Expected: PASS.

- [ ] **Step 12: Update `src/components/Header.test.tsx`**

Replace the `describe('ProjectNameLabel (song layer only)')` block with:

```tsx
describe('ProjectNameLabel (song layer only)', () => {
  test('a named project shows its name, dimmed but not italic', () => {
    const html = renderToString(<ProjectNameLabel layer="song" name="Lo-Fi Study Session" />);
    expect(html).toContain('id="header-project-name"');
    expect(html).toContain('Lo-Fi Study Session');
    expect(openTagContaining(html, 'id="header-project-name"')).toContain('text-base-content/80');
  });

  test('an untitled session shows UNTITLED_PROJECT_LABEL, italicized', () => {
    const html = renderToString(<ProjectNameLabel layer="song" name={null} />);
    expect(html).toContain(UNTITLED_PROJECT_LABEL);
    expect(openTagContaining(html, 'id="header-project-name"')).toContain('italic');
  });

  test('the loop layer never shows the label, even with a named project', () => {
    const html = renderToString(<ProjectNameLabel layer="loop" name="Lo-Fi Study Session" />);
    expect(html).not.toContain('id="header-project-name"');
  });

  test('it is captioned and framed the way the loop picker is', () => {
    const html = renderToString(<ProjectNameLabel layer="song" name="Lo-Fi Study Session" />);
    expect(html).toContain('>Project<');
    expect(html).toContain(HEADER_FIELD_SHELL);
    expect(html).toContain(GROUP_LABEL);
  });

  test('projectDisplayName names the untitled case and passes a name through', () => {
    expect(projectDisplayName(null)).toBe(UNTITLED_PROJECT_LABEL);
    expect(projectDisplayName('Alpha')).toBe('Alpha');
  });
});
```

Add `projectDisplayName` and `UNTITLED_PROJECT_LABEL` to that file's `./Header` import, and delete the now-unused `ProjectNameLabel` "plain span" test that asserted `toMatch(/^<span/)` against a saved project — the new file keeps a `<span>` for the read-only state, so that assertion still holds; keep it with the new props:

```tsx
  test('the read-only label is a plain span, not a button', () => {
    const html = renderToString(<ProjectNameLabel layer="song" name="Lo-Fi Study Session" />);
    expect(openTagContaining(html, 'id="header-project-name"')).toMatch(/^<span/);
  });
```

- [ ] **Step 13: Run lint and the touched suites**

Run: `bun run lint`
Expected: PASS — no type errors.

Run: `bun test src/store/projectSlice.test.ts src/store/projectStore.test.ts src/store/soloNav.test.ts src/components/Header.test.tsx`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add -A src/store src/components src/App.tsx
git commit -m "refactor(project): collapse the slice to load/save/new/open/export

Removes the library actions, the dirty/baseline identity fields and the
library UI they served.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Persist reduction, dirty removal, autosave

**Files:**
- Create: `src/store/projectAutosave.ts`
- Create: `src/store/projectAutosave.test.ts`
- Modify: `src/store/store.ts`
- Modify: `src/store/types.ts` (`PersistedState`)
- Modify: `src/store/store.test.ts`
- Delete: `src/store/projectDirty.ts`, `src/store/projectFingerprint.ts`, `src/store/projectDirty.test.ts`, `src/store/projectDirtyBoot.test.ts`, `src/store/projectFingerprint.test.ts`

**Interfaces:**
- Consumes: `WriteScheduler`, `idleWriteScheduler` from `../utils/coalescedStorage`; `AppStore` from `./types`; `createProjectAutosave` is wired to `useAppStore` in `store.ts`.
- Produces:
  - `interface ProjectAutosave { arm(): void; disarm(): void; flush(): void; isScheduled(): boolean; }`
  - `createProjectAutosave(api: AutosaveApi, options?: { scheduler?: WriteScheduler }): ProjectAutosave`
  - `export function bootProject(): Promise<void>` (in `store.ts`)
  - `export const projectAutosave: ProjectAutosave` (in `store.ts`)

- [ ] **Step 1: Write the failing autosave test**

Create `src/store/projectAutosave.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createProjectAutosave, type AutosaveApi } from './projectAutosave';
import type { WriteScheduler } from '../utils/coalescedStorage';
import type { AppStore } from './types';

/** A manual scheduler: nothing fires until the test drains it. */
function manualScheduler() {
  const queue: Array<() => void> = [];
  const cancelled: number[] = [];
  const scheduler: WriteScheduler = {
    schedule: (flush) => {
      queue.push(flush);
      return queue.length;
    },
    cancel: (handle) => {
      cancelled.push(handle);
      queue.splice(handle - 1, 1);
    },
  };
  return {
    scheduler,
    cancelled,
    /** Run every queued flush, as one idle window would. */
    drain: () => {
      const drained = queue.splice(0, queue.length);
      for (const flush of drained) flush();
    },
    pending: () => queue.length,
  };
}

function fakeApi(state: Partial<AppStore>) {
  let current = state as AppStore;
  const listeners: Array<() => void> = [];
  const saves: number[] = [];
  const api: AutosaveApi = {
    getState: () => ({ ...current, save: async () => { saves.push(Date.now()); return { ok: true, value: null } as never; } }) as AppStore,
    subscribe: (_selector, listener) => {
      const run = () => listener(undefined as never, undefined as never);
      listeners.push(run);
      return () => {
        const i = listeners.indexOf(run);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
  return {
    api,
    saves,
    setState: (next: Partial<AppStore>) => {
      current = { ...current, ...next } as AppStore;
      for (const run of [...listeners]) run();
    },
  };
}

describe('createProjectAutosave', () => {
  test('is disarmed until arm() — a boot-time write could overwrite a freshly loaded project', () => {
    const { scheduler } = manualScheduler();
    const { api, setState } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    setState({ bpm: 140 });
    expect(autosave.isScheduled()).toBe(false);
    autosave.arm();
    setState({ bpm: 150 });
    expect(autosave.isScheduled()).toBe(true);
  });

  test('many content set()s inside one idle window collapse to exactly one save()', () => {
    const { scheduler, drain } = manualScheduler();
    const { api, setState, saves } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    setState({ bpm: 121 });
    setState({ bpm: 122 });
    setState({ bpm: 123 });
    setState({ loops: [] });
    drain();
    expect(saves).toHaveLength(1);
  });

  test('a non-content set() schedules no write at all', () => {
    const { scheduler, drain } = manualScheduler();
    const { api, setState, saves } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    setState({ focusTrack: 'bass', activeTab: 'arrange', playheadBeat: 3 });
    drain();
    expect(saves).toHaveLength(0);
  });

  test('a name edit is a write trigger — the envelope autosaves with the project', () => {
    const { scheduler, drain } = manualScheduler();
    const { api, setState, saves } = fakeApi({ projectName: null });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    setState({ projectName: 'Alpha' });
    drain();
    expect(saves).toHaveLength(1);
  });

  test('disarm cancels a buffered write instead of letting it land', () => {
    const { scheduler, drain, cancelled } = manualScheduler();
    const { api, setState, saves } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    setState({ bpm: 121 });
    autosave.disarm();
    drain();
    expect(saves).toHaveLength(0);
    expect(cancelled).toHaveLength(1);
  });

  test('flush writes a pending edit immediately and is a no-op when nothing is pending', () => {
    const { scheduler } = manualScheduler();
    const { api, setState, saves } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    autosave.flush();
    expect(saves).toHaveLength(0);
    setState({ bpm: 130 });
    autosave.flush();
    expect(saves).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/store/projectAutosave.test.ts`
Expected: FAIL — `Cannot find module './projectAutosave'`.

- [ ] **Step 3: Write `src/store/projectAutosave.ts`**

```ts
import { shallow } from 'zustand/shallow';
import { idleWriteScheduler, type WriteScheduler } from '../utils/coalescedStorage';
import type { AppStore } from './types';

export interface AutosaveApi {
  getState(): AppStore;
  subscribe<U>(
    selector: (state: AppStore) => U,
    listener: (next: U, prev: U) => void,
    options?: { equalityFn?: (a: U, b: U) => boolean },
  ): () => void;
}

export interface ProjectAutosave {
  /** Start writing on content changes. Called only once boot's load() has settled. */
  arm(): void;
  /** Stop writing and drop any buffered write. */
  disarm(): void;
  /** Write a pending change now (pagehide / hidden), cancelling the idle one. */
  flush(): void;
  /** Test/diagnostic: true while a write is buffered for the next idle window. */
  isScheduled(): boolean;
}

/**
 * The subscription's watched keys — by reference, so `shallow` is enough. It is
 * the CONTENT set plus `projectName`: the name is envelope rather than content,
 * but it must autosave with the project, and routing it through this one
 * subscription is what keeps "edit the name" and "move a knob" the same single
 * coalesced write instead of two racing ones.
 */
type WriteKeys = [number, string, number, AppStore['effects'], AppStore['loops'], string | null];

/**
 * Owns the autosave write. MUST NOT write per set(): a knob drag is 60-120
 * set() calls a second, and serialising the whole arrangement on each one
 * would run on the audio scheduler's thread. So: a subscribeWithSelector
 * subscription over the watched keys marks a write pending and schedules ONE
 * idle callback through the same scheduler coalescedStorage uses; many set()s
 * in a window collapse to one `save()`.
 *
 * It starts DISARMED. Boot's `load()` reads the slot asynchronously, and a
 * write scheduled before that settles could overwrite a freshly-loaded project
 * with the placeholder content the store booted with — see `bootProject` in
 * store.ts, which arms it in a `finally`.
 *
 * The pagehide/hidden flush mirrors coalescedStorage's: a killed tab must have
 * already written its last edit, so `flush()` writes a pending change on the
 * spot rather than waiting out the idle window.
 */
export function createProjectAutosave(
  api: AutosaveApi,
  options: { scheduler?: WriteScheduler } = {},
): ProjectAutosave {
  const scheduler = options.scheduler ?? idleWriteScheduler;
  let handle: number | null = null;
  let armed = false;

  const cancel = (): void => {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  };

  const write = (): void => {
    handle = null;
    if (!armed) return;
    void api.getState().save();
  };

  const schedule = (): void => {
    if (!armed) return;
    if (handle === null) handle = scheduler.schedule(write);
  };

  api.subscribe(
    (s): WriteKeys => [s.bpm, s.meterId, s.masterVolume, s.effects, s.loops, s.projectName],
    schedule,
    { equalityFn: shallow },
  );

  return {
    arm: () => {
      armed = true;
    },
    disarm: () => {
      armed = false;
      cancel();
    },
    flush: () => {
      if (handle === null) return;
      cancel();
      write();
    },
    isScheduled: () => handle !== null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/store/projectAutosave.test.ts`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 5: Delete the fingerprint/dirty machinery**

```bash
git rm src/store/projectDirty.ts src/store/projectDirty.test.ts \
       src/store/projectDirtyBoot.test.ts \
       src/store/projectFingerprint.ts src/store/projectFingerprint.test.ts
```

- [ ] **Step 6: Reduce `partializeAppState` in `src/store/store.ts`**

Replace the function and its docblock with:

```ts
/**
 * Explicit allow-list: session/view prefs plus the user's own library, and
 * NOTHING ELSE. Project content (bpm, meterId, masterVolume, effects, loops) is
 * no longer here — IndexedDB is its home now, written by the autosave path
 * below. What is left is exactly what must survive a reload but is not a
 * project: which track/loop the user was on, the metronome, the last vibe chip,
 * and the cross-project preset/progression library (never project content —
 * the 2026-09-03 "excluded — user library" rule).
 */
export function partializeAppState(state: AppStore): PersistedState {
  return {
    metronomeActive: state.metronomeActive,
    selectedVibeId: state.selectedVibeId,
    focusTrack: state.focusTrack,
    customSynthPresets: state.customSynthPresets,
    customChordProgressions: state.customChordProgressions,
    activeLoopId: state.activeLoopId,
  };
}
```

- [ ] **Step 7: Slim `sanitizePersistedState` and `merge`**

Delete `sanitizeFlatSequencerTracks`, `sanitizeFlatOrderedArrays` and `sanitizeEnumeratedFields` outright, and replace `sanitizePersistedState` with:

```ts
/**
 * Type-guards the parsed persist payload before it reaches the merge. ONLY the
 * keys `partializeAppState` writes are checked — everything else passes through
 * unchanged, so a key added to partialize gets no validation until it is added
 * here too.
 *
 * Musical content is deliberately absent: it no longer travels through
 * localStorage, so `sanitizeContent` (projectFile.ts) is the one reader that
 * validates it, on the `.solna` import and IndexedDB load paths where the
 * content actually enters the store. Repeating the rules here would be a second
 * copy of a rule that now has exactly one entry point.
 */
export function sanitizePersistedState(persisted: unknown): Partial<AppStore> {
  if (typeof persisted !== 'object' || persisted === null) return {};
  const sanitized = { ...(persisted as Record<string, unknown>) };

  sanitized.metronomeActive = asBoolean(sanitized.metronomeActive);
  // Sanitizing here is what removes the bad-value case altogether — see the
  // focusTrack docblock this replaces: a 'drum' value leaking into the synth
  // path is not an error and not a visible mis-render, it silently points
  // every Sound-page knob at the Lead patch.
  sanitized.focusTrack = isMixLayerId(sanitized.focusTrack) ? sanitized.focusTrack : 'synth';
  if (typeof sanitized.selectedVibeId !== 'string' && sanitized.selectedVibeId !== null) {
    delete sanitized.selectedVibeId;
  }
  for (const key of ['customSynthPresets', 'customChordProgressions']) {
    if (!Array.isArray(sanitized[key])) delete sanitized[key];
  }
  // Only the TYPE is checked here. Whether the id names a loop can only be
  // decided once the loops themselves have loaded from IndexedDB, which happens
  // after hydration — `reconcileActiveLoop` in projectSlice.ts owns that.
  if (typeof sanitized.activeLoopId !== 'string') delete sanitized.activeLoopId;

  return sanitized as unknown as Partial<AppStore>;
}
```

Replace `merge` with:

```ts
      merge: (persistedState, currentState) => {
        const sanitized = sanitizePersistedState(persistedState);
        const base = { ...currentState, ...sanitized };
        return { ...base, ...migrateLegacyPresets(base as Partial<PersistedState>) };
      },
```

- [ ] **Step 8: Fix `src/store/store.ts` imports and wire the autosave + boot**

Delete these imports (nothing in the file uses them any more): `DEFAULT_LEAD_GATE`, `DEFAULT_LEAD_STEP_RESOLUTION`, `asFaderDb`, `DEFAULT_BUS_TRIM_DB`, `DEFAULT_FADER_DB`, `loopStatePatch`, `resolveActiveLoop`, `PROJECT_DB_LEVEL_KEYS`, `createDirtyTracker`, `INITIAL_SEQUENCER_TRACKS`, and from `./sanitize` keep only `asBoolean` and `isMixLayerId` (delete `sanitizeSynthParams`, `sanitizeEffectsValue`, `sanitizeLoops`, `asLeadStepResolution`, `clampFinite`, `asNullableString`, `isPatternMode`, `asFilterType`, `isPositiveInteger`, `asLeadNoteMatrix`, `sanitizeSequencerTracks`, `isChordItem`, `isBassStepChoice`, `isRootNote`, `isScaleType`, `isChordRhythmId`, `isBassPatternId`, `asSoundKit`). Delete the `isMeterId` import too. Change the `./types` import to `import type { AppStore, PersistedState } from './types';`.

Add:

```ts
import { createProjectAutosave } from './projectAutosave';
```

Replace the `dirtyTracker` export and the boot pass at the bottom of the file with:

```ts
/** The idle-coalesced autosave writer — see projectAutosave.ts. One per tab. */
export const projectAutosave = createProjectAutosave(useAppStore);

/**
 * Boot: read the one project slot, then arm autosave. Armed in a `finally` so a
 * rejected load still leaves the app writable rather than silently readonly.
 * Memoized — React StrictMode mounts App's effect twice, and a second load
 * would re-install a project over whatever the user had already touched.
 */
let booting: Promise<void> | null = null;
export function bootProject(): Promise<void> {
  booting ??= (async () => {
    try {
      await useAppStore.getState().loadProject();
    } finally {
      projectAutosave.arm();
    }
  })();
  return booting;
}
```

Replace `flushBeforeHide` with:

```ts
/**
 * The buffered writes go out on the way to hidden — both of them. The autosave
 * flush is what makes a killed tab's last edit durable, and the persist flush
 * is the pre-existing session-prefs one.
 */
export function flushBeforeHide(): void {
  projectAutosave.flush();
  flushPersistedWrites();
}
```

- [ ] **Step 9: Trim `PersistedState` in `src/store/types.ts`**

Replace the interface body with:

```ts
export interface PersistedState {
  metronomeActive: boolean;
  selectedVibeId: string | null;
  focusTrack: MixLayerId;
  customSynthPresets: SynthPresetItem[];
  customChordProgressions: CustomChordProgressionItem[];
  activeLoopId: string;
}
```

Update the docblock above it to: `// The exact allow-list shape produced by the persist `partialize` config — this interface and partializeAppState in store.ts must list the same keys. Project content is not here: it is autosaved to IndexedDB, see store/projectAutosave.ts.`

Then remove any `./types` import in `types.ts` that is now unused (`MeterId`, `MasterEffects`, `Loop` — check each; `bun run lint` names the ones to drop).

- [ ] **Step 10: Update `src/store/store.test.ts`**

Delete every describe that hydrates **content** through localStorage and asserts on the sanitizer — the rules they exercised live in `sanitize.ts` and are already covered by `src/store/sanitize.test.ts` and `src/store/projectFile.test.ts`, which do not change. Delete these blocks, by name:

- `'persisted payload sanitization'`
- `'DEV-388: drum kit + drum filter survive a real refresh'`
- `'validation-only persist boundary (DEV-388)'`
- `'sequencerTracks steps width (DEV-388: no more version-based padding)'`
- `'flat (pre-loop) payload: DEV-388 deleted the wrap, so it hydrates flat, not wrapped'`
- `'synth param payload sanitization'`
- `'project identity migration wiring (v8 -> v9)'`
- `'lead melody at an old step resolution (DEV-388: no more widening)'`
- `'pad layer migration wiring (v11 -> v12)'`
- `'drum instrument validation (DEV-388: dropped per-row, not renamed or wiped)'`

Run: `bun test src/store/sanitize.test.ts src/store/projectFile.test.ts`
Expected: PASS — proving the validation rules those blocks re-tested are covered where they now live. If any single rule turns out to have no home there, add that one assertion to `src/store/sanitize.test.ts` rather than keeping a localStorage-shaped copy.

Replace `describe('persist partialize')`'s `persistedKeys` array with:

```ts
    const persistedKeys = [
      'metronomeActive',
      'selectedVibeId',
      'focusTrack',
      'customSynthPresets',
      'customChordProgressions',
      'activeLoopId',
    ];
```

and delete its two now-invalid assertions (`snapshot.loops` / `snapshot.activeLoopId === snapshot.loops[0].id`). Add to the `excludedKeys` array:

```ts
      'bpm',
      'meterId',
      'masterVolume',
      'effects',
      'loops',
      'projectName',
      'projectStoreStatus',
      'projectNotice',
      'currentProjectId',
      'projectBaselineHash',
      'dirty',
      'projectList',
```

Replace `describe('flushBeforeHide')` with:

```ts
describe('flushBeforeHide', () => {
  test('flushes the pending autosave write and the buffered persist write', async () => {
    const { useAppStore, flushBeforeHide, projectAutosave } = await getStore();
    const saves: string[] = [];
    useAppStore.setState({ save: async () => { saves.push('save'); return { ok: true, value: null } as never; } });
    useAppStore.setState({ bpm: 133 });
    expect(projectAutosave.isScheduled()).toBe(true);
    flushBeforeHide();
    expect(saves).toEqual(['save']);
    expect(projectAutosave.isScheduled()).toBe(false);
    expect(fakeLocalStorage.getItem('musibox_project_state_v1')).not.toBeNull();
  });

  test('a hide with nothing pending writes nothing', async () => {
    const { useAppStore, flushBeforeHide, projectAutosave } = await getStore();
    const saves: string[] = [];
    useAppStore.setState({ save: async () => { saves.push('save'); return { ok: true, value: null } as never; } });
    flushBeforeHide();
    expect(saves).toEqual([]);
    expect(projectAutosave.isScheduled()).toBe(false);
  });
});
```

Finally, delete from `src/store/store.test.ts` any import that only the deleted blocks used, and add `bpm`/`meterId`/`masterVolume`/`effects`/`loops` to a new test inside `describe('persist partialize')`:

```ts
  test('the content keys are not persisted at all — IndexedDB owns them now', async () => {
    const { useAppStore, flushPersistedWrites } = await getStore();
    useAppStore.setState({ bpm: 199, masterVolume: -3 });
    flushPersistedWrites();
    const stored = JSON.parse(fakeLocalStorage.getItem('musibox_project_state_v1') ?? '{}');
    expect('bpm' in stored.state).toBe(false);
    expect('loops' in stored.state).toBe(false);
    expect('effects' in stored.state).toBe(false);
  });
```

- [ ] **Step 11: Run the store suites**

Run: `bun test src/store/store.test.ts src/store/projectAutosave.test.ts src/store/migrate.test.ts src/store/sanitize.test.ts`
Expected: PASS.

Run: `bun run lint`
Expected: PASS — 0 errors.

- [ ] **Step 12: Commit**

```bash
git add -A src/store
git commit -m "feat(autosave): write project content on an idle-coalesced subscription

localStorage keeps only session/view prefs and the user library; the
fingerprint and dirty machinery are deleted with the model they served.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Boot / hydration + loading gate

**Files:**
- Create: `src/components/ProjectLoading.tsx`
- Create: `src/components/ProjectLoading.test.tsx`
- Modify: `src/App.tsx`
- Test: `src/store/projectBoot.test.ts` (new — the settle/arm ordering)

**Interfaces:**
- Consumes: `bootProject(): Promise<void>` and `projectAutosave` (Task 3); `ProjectStoreResult`, `createMemoryBackend`, `createProjectStore` (Task 1); `createProjectSlice` (Task 2).
- Produces: `export function ProjectLoading(): JSX.Element`; `export const PROJECT_LOADING_LABEL = 'Loading your project…'`.

- [ ] **Step 1: Write the failing bootstrap test**

Create `src/store/projectBoot.test.ts`:

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { createProjectAutosave } from './projectAutosave';
import { factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
import type { AppStore } from './types';

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

let storeModule: Promise<typeof import('./store')>;
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new FakeLocalStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  storeModule = import(`./store?bust=${Date.now()}`);
});

let stopSource: ReturnType<typeof spyOn>;
beforeEach(() => {
  stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
});
afterEach(() => {
  stopSource.mockRestore();
});

const stored = (name: string, bpm: number): ProjectBody => ({
  ...makeEnvelope(name, 1_000),
  content: { ...factoryProjectContent(), bpm },
});

/**
 * The ordering that matters: autosave must not be armed until `load()` has
 * settled, or a write scheduled during boot could overwrite a freshly-loaded
 * project with the placeholder the store created itself with.
 */
describe('boot: load first, arm autosave after', () => {
  async function settleWith(backend: ReturnType<typeof createMemoryBackend>) {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const store = createProjectStore(async () => backend);
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, store, () => 5_000);
    useAppStore.setState({ ...slice, projectName: null });
    const autosave = createProjectAutosave(useAppStore as never);
    const order: string[] = [];
    return {
      useAppStore,
      order,
      autosave,
      boot: async () => {
        try {
          await useAppStore.getState().loadProject();
          order.push('loaded');
        } finally {
          autosave.arm();
          order.push('armed');
        }
      },
    };
  }

  test('an empty slot leaves the factory session and arms autosave the moment load settles', async () => {
    const { useAppStore, order, boot } = await settleWith(createMemoryBackend());
    await boot();
    expect(order).toEqual(['loaded', 'armed']);
    expect(useAppStore.getState().projectName).toBeNull();
  });

  test('a stored project installs, then autosave arms — never the other way round', async () => {
    const { useAppStore, order, boot } = await settleWith(createMemoryBackend(stored('Alpha', 77)));
    await boot();
    expect(order).toEqual(['loaded', 'armed']);
    expect(useAppStore.getState().bpm).toBe(77);
    expect(useAppStore.getState().projectName).toBe('Alpha');
  });

  test('a disarmed autosave ignores the content writes boot itself makes', async () => {
    const { useAppStore, autosave } = await settleWith(createMemoryBackend(stored('Alpha', 77)));
    const saves: string[] = [];
    useAppStore.setState({ save: async () => { saves.push('save'); return { ok: true, value: null } as never; } });
    await useAppStore.getState().loadProject();
    expect(autosave.isScheduled()).toBe(false);
    expect(saves).toEqual([]);
  });
});

/** A smoke test of the pure helper the loading gate renders. */
describe('projectDisplayName on the boot placeholder', () => {
  test('the factory content a booting store holds is the default project', async () => {
    const { useAppStore } = await storeModule;
    const state = useAppStore.getState() as AppStore;
    expect(state.bpm).toBe(factoryProjectContent().bpm);
    expect(state.meterId).toBe(factoryProjectContent().meterId);
    expect(state.masterVolume).toBe(factoryProjectContent().masterVolume);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/store/projectBoot.test.ts`
Expected: FAIL — `Cannot find module './projectAutosave'` is already gone by now, so the real failure is that `useAppStore.setState({ save })` plus a disarmed autosave behaves as asserted only once Task 3 landed; if the file compiles and passes at this point, that is acceptable — proceed. (This file is a regression pin for the ordering, not new production code.)

- [ ] **Step 3: Write the loading component**

Create `src/components/ProjectLoading.tsx`:

```tsx
export const PROJECT_LOADING_LABEL = 'Loading your project…';

/**
 * The fullscreen gate the app renders until the single project slot has been
 * read. It exists because launch is now ASYNC: the content comes from
 * IndexedDB, so there is a real window in which the store still holds factory
 * content. Rendering the workspace through that window would flash a default
 * project and let a stray edit autosave over the real one.
 *
 * Role and theme tokens only — `bg-base-100` / `text-base-content` — so it
 * passes `bun run check:theme` in both themes, and daisyUI's `loading` spinner
 * so it needs no asset of its own.
 */
export function ProjectLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="h-dvh bg-base-100 text-base-content flex flex-col items-center justify-center gap-4"
    >
      <span className="loading loading-spinner loading-lg text-primary" aria-hidden="true" />
      <p className="text-sm font-semibold text-base-content/70">{PROJECT_LOADING_LABEL}</p>
    </div>
  );
}
```

- [ ] **Step 4: Write the loading component's render test**

Create `src/components/ProjectLoading.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ProjectLoading, PROJECT_LOADING_LABEL } from './ProjectLoading';

describe('ProjectLoading', () => {
  test('announces itself as a polite status region with the loading spinner', () => {
    const html = renderToString(<ProjectLoading />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('loading loading-spinner loading-lg text-primary');
    expect(html).toContain(PROJECT_LOADING_LABEL);
  });
});
```

- [ ] **Step 5: Run both to verify they pass**

Run: `bun test src/components/ProjectLoading.test.tsx src/store/projectBoot.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the gate in `src/App.tsx`**

Add the imports:

```ts
import { useState } from 'react';
import { ProjectLoading } from './components/ProjectLoading';
import { bootProject } from './store/store';
```

In the `App` component body, after the existing hooks and before the `return`, add:

```tsx
  // The project slot is read asynchronously, so the workspace is gated until
  // it settles — rendering it early would flash factory content over the real
  // project, and an edit made in that window would autosave over it.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void bootProject().finally(() => {
      if (!cancelled) setBooted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!booted) return <ProjectLoading />;
```

This early return MUST sit after every hook call in the component — `useEngineSync`, `useRouteSync`, `usePlayheadSync`, `useSongModeSync`, `useSoloNavClear`, `useFocusPanelSync`, `useVibeNavClear`, `useInputDeck`, `useServiceWorkerUpdate`, the `useAppStore` selector and the three `useEffect`s. All of them stay above it.

- [ ] **Step 7: Verify the app builds and the touched suites pass**

Run: `bun test src/store/projectBoot.test.ts src/components/ProjectLoading.test.tsx src/App.test.tsx`
Expected: PASS.

Run: `bun run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/ProjectLoading.tsx src/components/ProjectLoading.test.tsx src/store/projectBoot.test.ts
git commit -m "feat(boot): gate the workspace behind an async project load

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: UI shell — editable name and the project menu

**Files:**
- Create: `src/components/project/ProjectMenu.tsx`
- Create: `src/components/project/ProjectMenu.test.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/components/Header.test.tsx`
- Modify: `src/components/ui/Wordmark.tsx`

**Interfaces:**
- Consumes: `projectDisplayName`, `UNTITLED_PROJECT_LABEL` (Task 2); `setProjectName`, `openProjectFile`, `exportProjectFile`, `newProject`, `setProjectNotice`, `projectNotice` (Task 2); `parseProjectFile`, `serializeProject`, `PROJECT_FILE_ACCEPT`, `PROJECT_FILE_MIME` from `@/store/projectFile`; `downloadTextFile`, `projectFileName`, `readFileAsText` from `@/utils/projectFileIO`; `ConfirmDialog` from `../ui/ConfirmDialog`; `useLiveStore` from `../ui/useLiveStore`.
- Produces: `export type ProjectMenuAction = 'open' | 'export' | 'new'`; `export const PROJECT_MENU_ACTIONS`; `export const REPLACE_CONFIRM_MESSAGE`; `export function ProjectMenu({ textClassName }: { textClassName?: string })`.

- [ ] **Step 1: Write the failing menu test**

Create `src/components/project/ProjectMenu.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ProjectMenu, PROJECT_MENU_ACTIONS, REPLACE_CONFIRM_MESSAGE } from './ProjectMenu';

describe('ProjectMenu', () => {
  test('offers exactly Open, Export and New, in that order', () => {
    expect(PROJECT_MENU_ACTIONS.map((a) => a.action)).toEqual(['open', 'export', 'new']);
  });

  test('the confirm copy says plainly that the project is replaced', () => {
    expect(REPLACE_CONFIRM_MESSAGE).toBe(
      'This replaces your current project. It is autosaved, so the one you are editing now will be gone.',
    );
  });

  // The menu is behind a dropdown that opens on focus, which renderToString
  // never triggers — so the closed state is what is pinned here: the trigger is
  // a labelled button and the file input is present but hidden.
  test('renders a labelled dropdown trigger and a hidden file picker', () => {
    const html = renderToString(<ProjectMenu textClassName="hidden sm:inline" />);
    expect(html).toContain('dropdown');
    expect(html).toContain('aria-label="Project menu"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".solna,.json"');
    expect(html).toContain('hidden sm:inline');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/components/project/ProjectMenu.test.tsx`
Expected: FAIL — `Cannot find module './ProjectMenu'`.

- [ ] **Step 3: Write `src/components/project/ProjectMenu.tsx`**

```tsx
import React, { useRef, useState } from 'react';
import { Download, FilePlus, Upload } from 'lucide-react';
import { PROJECT_FILE_ACCEPT, PROJECT_FILE_MIME, parseProjectFile, serializeProject } from '@/store/projectFile';
import { downloadTextFile, projectFileName, readFileAsText } from '@/utils/projectFileIO';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useLiveStore } from '../ui/useLiveStore';
import { Wordmark } from '../ui/Wordmark';

export type ProjectMenuAction = 'open' | 'export' | 'new';

/** Open and New replace the one autosaved project; Export never touches it. */
export const PROJECT_MENU_ACTIONS: ReadonlyArray<{
  action: ProjectMenuAction;
  label: string;
  icon: typeof Upload;
}> = [
  { action: 'open', label: 'Open .solna', icon: Upload },
  { action: 'export', label: 'Export .solna', icon: Download },
  { action: 'new', label: 'New project', icon: FilePlus },
];

export const REPLACE_CONFIRM_MESSAGE =
  'This replaces your current project. It is autosaved, so the one you are editing now will be gone.';

/**
 * The wordmark IS the project menu. There is no project list any more, so the
 * brand mark is the one place a project-level action can live, and it is
 * present on both layers because a project spans the whole app.
 *
 * Open and New both replace the single autosaved project, which is destructive
 * and irreversible once the slot is overwritten, so both pass through one
 * confirm. Export is the manual save-to-file action and needs none.
 */
export function ProjectMenu({ textClassName }: { textClassName?: string }) {
  const [confirming, setConfirming] = useState<ProjectMenuAction | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openProjectFile = useLiveStore((s) => s.openProjectFile);
  const exportProjectFile = useLiveStore((s) => s.exportProjectFile);
  const newProject = useLiveStore((s) => s.newProject);
  const setProjectNotice = useLiveStore((s) => s.setProjectNotice);

  const report = (message: string | null) => setProjectNotice(message);

  const runExport = () => {
    const body = exportProjectFile();
    try {
      downloadTextFile(projectFileName(body.name), serializeProject(body), PROJECT_FILE_MIME);
      report(null);
    } catch {
      // downloadTextFile's anchor/blob path can throw in a restricted
      // embedding; exporting is best-effort and the live session is untouched.
      report('Could not write the file. Check the browser’s download settings.');
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = parseProjectFile(await readFileAsText(file));
    if (parsed.ok === false) {
      report(parsed.message);
      return;
    }
    const result = await openProjectFile(parsed.body);
    if (result.ok === false && result.error !== 'unavailable') report(result.message);
  };

  const choose = (action: ProjectMenuAction) => {
    if (action === 'export') {
      runExport();
      return;
    }
    setConfirming(action);
  };

  const confirmReplace = () => {
    const action = confirming;
    setConfirming(null);
    if (action === 'open') fileInputRef.current?.click();
    if (action === 'new') newProject();
  };

  return (
    <div className="dropdown">
      <Wordmark textClassName={textClassName} ariaLabel="Project menu" />
      <ul
        tabIndex={0}
        className="dropdown-content menu menu-sm z-50 mt-2 w-44 rounded-box bg-base-100 border border-base-300 p-1 shadow-lg"
      >
        {PROJECT_MENU_ACTIONS.map(({ action, label, icon: Icon }) => (
          <li key={action}>
            <button type="button" id={`project-menu-${action}`} onClick={() => choose(action)}>
              <Icon className="w-4 h-4" aria-hidden="true" />
              {label}
            </button>
          </li>
        ))}
      </ul>
      <input
        ref={fileInputRef}
        type="file"
        accept={PROJECT_FILE_ACCEPT}
        aria-label="Open a .solna project file"
        className="hidden"
        onChange={(e) => void onPickFile(e)}
      />
      {confirming && (
        <ConfirmDialog
          title={confirming === 'open' ? 'Open a project file' : 'Start a new project'}
          message={REPLACE_CONFIRM_MESSAGE}
          confirmLabel={confirming === 'open' ? 'Choose a file' : 'New project'}
          onConfirm={confirmReplace}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `src/components/ui/Wordmark.tsx`**

Replace the props and the component. The `dirty` badge and the "Open Project Manager" aria-label are both gone:

```tsx
interface WordmarkProps {
  /** Hide the "Solna" text and show the logo mark only. */
  markOnly?: boolean;
  className?: string;
  /**
   * Extra classes on the wordmark TEXT only. `markOnly` drops the text from the
   * DOM outright, which a media query cannot undo — this is the hook a caller
   * uses to hide it at one width and show it at another (the navbar passes
   * `hidden sm:inline`, which is what keeps its phone layout down to two rows).
   */
  textClassName?: string;
  /** Overridden by ProjectMenu, which names the control it wraps. */
  ariaLabel?: string;
}

/**
 * The brand wordmark, and — through ProjectMenu — the project menu's trigger.
 * Deliberately NOT a <button>: it is rendered inside daisyUI's `dropdown`,
 * whose open state is driven by `:focus-within`, and a nested button would
 * swallow the focus the dropdown needs.
 */
export function Wordmark({
  markOnly = false,
  className = "",
  textClassName = "",
  ariaLabel,
}: WordmarkProps) {
  return (
    <span
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-2 min-h-11 min-w-11 px-1.5 rounded-box cursor-pointer transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      <img
        src="/assets/favicon.svg"
        alt=""
        className="h-8 w-8"
        draggable={false}
      />
      {!markOnly && (
        <span
          className={`text-2xl font-normal text-primary leading-none ${textClassName}`}
          style={{ letterSpacing: "0.08em" }}
        >
          solna
        </span>
      )}
    </span>
  );
}
```

(`role="button"` on a focusable `<span>` keeps the keyboard semantics; the `indicator` wrapper went with the badge.)

- [ ] **Step 5: Make `ProjectNameLabel` editable in `src/components/Header.tsx`**

Replace the props interface and the component with:

```tsx
interface ProjectNameLabelProps {
  layer: Layer;
  name: string | null;
}

/**
 * The project's name, song layer only, editable in place. Takes `layer` as a
 * prop (rather than reading `activeTab` itself) so it can be unit-tested
 * directly: under `renderToString`, `Header`'s own `activeTab` read is a plain
 * `useAppStore` selector, which serves the store's CREATION-time value and
 * never reflects a test's `setState` (see .claude/rules/testing.md) — there is
 * no way to reach the song layer through a rendered `<Header />` in a test.
 *
 * `draft` is local state, never a store value: a keystroke must not write the
 * store (each write would re-render every mounted view, and the name is
 * envelope rather than content). Commit is Enter or blur; Escape reverts.
 */
export function ProjectNameLabel({ layer, name }: ProjectNameLabelProps) {
  const setProjectName = useLiveStore((s) => s.setProjectName);
  const [draft, setDraft] = React.useState<string | null>(null);
  if (layer !== 'song') return null;
  const label = projectDisplayName(name);
  const value = draft ?? name ?? '';
  const commit = () => {
    setProjectName(value);
    setDraft(null);
  };
  return (
    // Same shell and caption as the loop picker on the other layer, in the same
    // place in the row: each layer opens with what its tabs are editing — a
    // loop there, the project here.
    <div className={`hidden sm:flex ${HEADER_FIELD_SHELL}`}>
      <label className={GROUP_LABEL} htmlFor="header-project-name">
        Project
      </label>
      <input
        id="header-project-name"
        type="text"
        value={value}
        placeholder={UNTITLED_PROJECT_LABEL}
        aria-label="Project name"
        title={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
          }
        }}
        className="input input-xs w-32 max-w-[10rem] text-xs font-semibold bg-transparent border-0 focus:outline-none"
      />
    </div>
  );
}
```

- [ ] **Step 6: Swap the Wordmark for the menu in `Header.tsx`**

Replace the import `import { Wordmark } from "./ui/Wordmark";` with `import { ProjectMenu } from "./project/ProjectMenu";`, delete the now-unused `useLiveStore` `projectName` read if nothing else uses it (the label reads the store itself in Step 5), and replace the call site:

```tsx
        <ProjectMenu textClassName="hidden sm:inline" />
```

Also delete the `const projectName = useLiveStore((s) => s.projectName);` line and the `<ProjectNameLabel layer={layer} name={projectName} />` call site, replacing the latter with:

```tsx
        <ProjectNameLabel layer={layer} />
```

and give `ProjectNameLabel` the store read it now needs, inside the component, before the early return:

```tsx
  const name = useLiveStore((s) => s.projectName);
  const setProjectName = useLiveStore((s) => s.setProjectName);
  const [draft, setDraft] = React.useState<string | null>(null);
  if (layer !== 'song') return null;
```

So `ProjectNameLabelProps` is `{ layer: Layer }` — the name is read live, so a committed edit is visible without a remount.

- [ ] **Step 7: Update `src/components/Header.test.tsx`**

Replace the `describe('ProjectNameLabel (song layer only)')` block with:

```tsx
describe('ProjectNameLabel (song layer only)', () => {
  const initial = useAppStore.getState().projectName;
  afterEach(() => {
    useAppStore.setState({ projectName: initial });
  });

  test('a named project renders an editable input holding the name', () => {
    useAppStore.setState({ projectName: 'Lo-Fi Study Session' });
    const html = renderToString(<ProjectNameLabel layer="song" />);
    expect(html).toContain('id="header-project-name"');
    expect(openTagContaining(html, 'id="header-project-name"')).toMatch(/^<input/);
    expect(html).toContain('value="Lo-Fi Study Session"');
  });

  test('an untitled session shows the untitled placeholder', () => {
    useAppStore.setState({ projectName: null });
    const html = renderToString(<ProjectNameLabel layer="song" />);
    expect(html).toContain(`placeholder="${UNTITLED_PROJECT_LABEL}"`);
    expect(html).toContain('value=""');
  });

  test('the loop layer renders no project-name control at all', () => {
    useAppStore.setState({ projectName: 'Lo-Fi Study Session' });
    const html = renderToString(<ProjectNameLabel layer="loop" />);
    expect(html).not.toContain('id="header-project-name"');
  });

  test('it is captioned and framed the way the loop picker is', () => {
    useAppStore.setState({ projectName: 'Alpha' });
    const html = renderToString(<ProjectNameLabel layer="song" />);
    expect(html).toContain('>Project<');
    expect(html).toContain(HEADER_FIELD_SHELL);
    expect(html).toContain(GROUP_LABEL);
  });

  test('projectDisplayName names the untitled case and passes a name through', () => {
    expect(projectDisplayName(null)).toBe(UNTITLED_PROJECT_LABEL);
    expect(projectDisplayName('Alpha')).toBe('Alpha');
  });
});
```

This block now depends on `useLiveStore` (the component reads `projectName` live), so `useAppStore.setState` before the render IS reflected — the `getServerSnapshot` trap does not apply here. Add `projectDisplayName` and `UNTITLED_PROJECT_LABEL` to the `./Header` import.

- [ ] **Step 8: Run the suites**

Run: `bun test src/components/Header.test.tsx src/components/project/ProjectMenu.test.tsx`
Expected: PASS.

Run: `bun test src/components/ui/` 
Expected: PASS (the Wordmark change touches no test that asserted the `dirty` badge; if one does, delete that assertion — the badge no longer exists).

- [ ] **Step 9: Commit**

```bash
git add src/components/Header.tsx src/components/Header.test.tsx src/components/ui/Wordmark.tsx src/components/project/ProjectMenu.tsx src/components/project/ProjectMenu.test.tsx
git commit -m "feat(ui): edit the project name in the header and open/export/new from the wordmark

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: ErrorBoundary

**Files:**
- Create: `src/components/ErrorBoundary.tsx`
- Create: `src/components/ErrorBoundary.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `class ErrorBoundary extends React.Component<{ children: React.ReactNode; showDetails?: boolean }, { error: Error | null; componentStack: string | null }>` with `static getDerivedStateFromError`, `componentDidCatch`, `reset()`
  - `function ErrorFallback(props: { message: string; stack: string | null; componentStack: string | null; showDetails: boolean; onRetry: () => void })`
  - `const ERROR_TITLE = 'Solna hit an unexpected error.'`

- [ ] **Step 1: Write the failing test**

Create `src/components/ErrorBoundary.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ErrorBoundary, ErrorFallback, ERROR_TITLE } from './ErrorBoundary';

const noop = () => {};

/** React logs a caught render error to console.error; keep the run readable. */
let consoleError: ReturnType<typeof spyOn>;
beforeEach(() => {
  consoleError = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

function Boom(): React.ReactNode {
  throw new Error('kaboom');
}

describe('ErrorFallback', () => {
  test('renders the title, the message and both actions', () => {
    const html = renderToString(
      <ErrorFallback message="kaboom" stack={'Error: kaboom\n  at Boom'} componentStack="\n  in Boom" showDetails={false} onRetry={noop} />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(ERROR_TITLE);
    expect(html).toContain('kaboom');
    expect(html).toContain('>Retry<');
    expect(html).toContain('>Refresh<');
  });

  test('offers no way to delete the project — the single slot is the user’s only copy', () => {
    const html = renderToString(
      <ErrorFallback message="kaboom" stack={null} componentStack={null} showDetails onRetry={noop} />
    );
    expect(html.toLowerCase()).not.toContain('clear storage');
    expect(html.toLowerCase()).not.toContain('delete');
    expect(html.toLowerCase()).not.toContain('reset storage');
  });

  test('the error detail block is DEV-only', () => {
    const dev = renderToString(
      <ErrorFallback message="kaboom" stack="Error: kaboom" componentStack="\n  in Boom" showDetails onRetry={noop} />
    );
    expect(dev).toContain('<details');
    expect(dev).toContain('in Boom');

    const prod = renderToString(
      <ErrorFallback message="kaboom" stack="Error: kaboom" componentStack="\n  in Boom" showDetails={false} onRetry={noop} />
    );
    expect(prod).not.toContain('<details');
    expect(prod).not.toContain('in Boom');
  });
});

describe('ErrorBoundary', () => {
  test('a child that throws during render falls back instead of blanking the app', () => {
    const html = renderToString(
      <ErrorBoundary showDetails={false}>
        <Boom />
      </ErrorBoundary>
    );
    expect(html).toContain(ERROR_TITLE);
    expect(html).toContain('kaboom');
    expect(html).toContain('>Retry<');
  });

  test('a healthy tree renders its children untouched', () => {
    const html = renderToString(
      <ErrorBoundary showDetails={false}>
        <p>all good</p>
      </ErrorBoundary>
    );
    expect(html).toContain('<p>all good</p>');
    expect(html).not.toContain(ERROR_TITLE);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/components/ErrorBoundary.test.tsx`
Expected: FAIL — `Cannot find module './ErrorBoundary'`.

- [ ] **Step 3: Write `src/components/ErrorBoundary.tsx`**

```tsx
import React from 'react';

export const ERROR_TITLE = 'Solna hit an unexpected error.';

export interface ErrorFallbackProps {
  message: string;
  stack: string | null;
  componentStack: string | null;
  /** DEV only. `import.meta.env.DEV` at the App.tsx call site. */
  showDetails: boolean;
  onRetry: () => void;
}

/**
 * The boundary's fallback. A FUNCTION component so it may use hooks later; the
 * class below must not, and that is the whole reason for the split.
 *
 * Deliberately offers no "clear storage": the single project IS the user's only
 * copy, and a crash screen is the worst possible place to hand someone a button
 * that deletes it. Retry re-renders; Refresh restarts the app.
 *
 * Role-based daisyUI tokens only (`bg-base-100`, `text-base-content`,
 * `btn-primary`, `text-error`) — no raw hex and no Tailwind palette class, so
 * it passes `bun run check:theme` in both themes.
 */
export function ErrorFallback({
  message,
  stack,
  componentStack,
  showDetails,
  onRetry,
}: ErrorFallbackProps) {
  return (
    <div
      role="alert"
      className="h-dvh bg-base-100 text-base-content flex flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <h1 className="text-lg font-bold text-error">{ERROR_TITLE}</h1>
      <p className="text-sm text-base-content/70 max-w-md">
        Your project is autosaved, so nothing has been lost. Retrying reloads the interface;
        refreshing starts the app again.
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-sm btn-primary" onClick={onRetry}>
          Retry
        </button>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          Refresh
        </button>
      </div>
      {showDetails && (
        <details className="w-full max-w-2xl text-left">
          <summary className="cursor-pointer text-xs text-base-content/60">Error details</summary>
          <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-base-content/70">
            {message}
            {stack ? `\n\n${stack}` : ''}
            {componentStack ?? ''}
          </pre>
        </details>
      )}
    </div>
  );
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Catches RENDER errors only. Storage failures are not exceptions here —
 * IndexedDB/localStorage unavailability is the degraded-state notice path
 * (`projectNotice`), which the app keeps running through.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(_error: Error, info: React.ErrorInfo): void {
    // Still logged (React logs too): a production report needs the stack, and
    // the DEV-only <details> is a convenience, not the only copy.
    this.setState({ componentStack: info.componentStack ?? null });
  }

  reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): React.ReactNode {
    const { error, componentStack } = this.state;
    if (error) {
      return (
        <ErrorFallback
          message={error.message}
          stack={error.stack ?? null}
          componentStack={componentStack}
          showDetails={this.props.showDetails === true}
          onRetry={this.reset}
        />
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/components/ErrorBoundary.test.tsx`
Expected: PASS — 5 tests, 0 failures.

If `renderToString` rethrows the child error instead of rendering the fallback (it should not — React supports error boundaries in SSR), keep the three `ErrorFallback` tests and delete only the two `ErrorBoundary` tests; do **not** add jsdom or testing-library, and do not weaken the assertion to a try/catch that accepts either behaviour.

- [ ] **Step 5: Wrap the app in `src/App.tsx`**

Rename the existing `export function App()` to `function Workspace()` (body unchanged) and add at the end of the file, before `export default App;`:

```tsx
/**
 * The crash boundary wraps the workspace rather than sitting inside it: an
 * error thrown by Workspace's own render — a slice selector, a theme lookup —
 * could not be caught by a boundary that Workspace rendered itself.
 */
export function App() {
  return (
    <ErrorBoundary showDetails={import.meta.env.DEV === true}>
      <Workspace />
    </ErrorBoundary>
  );
}

export default App;
```

Add `import { ErrorBoundary } from './components/ErrorBoundary';` to the imports.

- [ ] **Step 6: Verify**

Run: `bun test src/components/ErrorBoundary.test.tsx src/App.test.tsx`
Expected: PASS.

Run: `bun run lint && bun run eslint`
Expected: PASS, no warnings.

- [ ] **Step 7: Commit**

```bash
git add src/components/ErrorBoundary.tsx src/components/ErrorBoundary.test.tsx src/App.tsx
git commit -m "feat(error-boundary): catch render crashes without offering to delete the project

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Final gate

**Files:**
- Modify: whatever the gate names.

**Interfaces:**
- Consumes: everything above.
- Produces: a green `bun run verify`.

- [ ] **Step 1: Hunt for dangling references**

Run:

```bash
grep -rn "projectList\|refreshProjects\|saveProjectAs\|renameProject\|deleteProject\|importProject\|exportStoredProject\|buildSessionExport\|projectBaselineHash\|currentProjectId\|currentProjectName\|projectManagerFlow\|isProjectManagerOpen\|fingerprintContent\|isContentDirty\|matchContent\|projectDirty\|dirtyTracker\|\.dirty\b" src/ docs/ --include="*.ts" --include="*.tsx"
```

Expected: no hits outside `docs/superpowers/` (specs and older plans are historical records and stay as written). Fix every hit under `src/` — a leftover reference is exactly the shape this change exists to delete.

- [ ] **Step 2: Run the full gate**

Run: `bun run verify`
Expected: PASS — test, lint, eslint, check:keys, check:drums, check:contrast, check:levels and build all green. `bun run eslint` must report **nothing at all** — no errors and no warnings.

- [ ] **Step 3: Fix stragglers**

The two most likely, with their fixes:

1. **`src/store/soloNav.test.ts`** — if its restore assignment still names a removed field, delete those lines (Task 2 Step 11 covers the `Pick<...>` union and the object literal; the restore assignment at the end of the file is the one most easily missed).
2. **`src/components/Header.test.tsx`** — if any surviving assertion expects the Wordmark's `dirty` badge (`indicator-item status status-warning`) or `aria-label="Open Project Manager"`, delete it: both are gone by design, not by regression.

Re-run after each fix:

Run: `bun test <the failing file>`

- [ ] **Step 4: Run the theme guard on its own**

Run: `bun run check:theme`
Expected: PASS — 0 violations, `ALLOWLIST` still empty. `ErrorBoundary.tsx`, `ProjectLoading.tsx`, `ProjectMenu.tsx` and the edited `Header.tsx`/`Wordmark.tsx` are the files this step is really about.

- [ ] **Step 5: Confirm the spec's removed-test list is actually gone**

Run:

```bash
ls src/store/projectDirty.test.ts src/store/projectDirtyBoot.test.ts src/store/projectFingerprint.test.ts src/components/project/ProjectManagerModal.test.tsx src/components/project/ProjectList.test.tsx src/components/project/projectDialogs.test.tsx 2>&1
```

Expected: every one reports "No such file or directory".

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(project): clear the stragglers left by the single-project move

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 7: Report**

Run: `bun run verify && bun run check:theme`
Expected: PASS. Paste the tail of both into the task summary — this is the completion gate, and "it should be fine" is not a substitute for its output.

---

## Self-review

**Spec coverage.** §Goal items 1–5 → Tasks 3 (autosave), 4 (resume on launch), 5 (Open/Export/new), 5 (editable name). §What survives → untouched files (`projectFile.ts`, `sanitize.ts`) plus a verbatim `install()` in Task 2 Step 3. §Storage model → Task 1. §Autosave flow → Task 3 (`projectAutosave.ts`, the four removals, the failed-write retry via the next subscription fire). §Boot/hydration → Task 4. §localStorage reduction → Task 3 Steps 6–9, with `activeLoopId` reconciliation in Task 2's `reconcileActiveLoop`. §UI shell → Task 5. §ErrorBoundary → Task 6. §Migration → Task 1 Step 4 (`PROJECT_DB_VERSION` 2 + store drop). §Error and edge cases → empty slot (Task 1 test, Task 4 gate), unavailable (Tasks 1/2/4), quota (Task 1 test + Task 3 retry), autosave-vs-boot race (Task 3 `armed` flag + Task 4 test), Open while unavailable (Task 2 test), two tabs (unchanged last-write-wins; no task needed). §Testing delta → each task's test steps.

**One spec sentence with no dedicated task:** the §Error and edge cases row *"Two tabs — last write wins, as today; no cross-tab reconciliation."* There is nothing to build: the single-slot `put` is already last-write-wins with no `storage`-event listener, and the plan adds none.

**Placeholders.** One deliberate interstitial: `Header.tsx`'s `onClick={() => {}}` in Task 2 Step 10, which Task 5 Step 6 replaces with `ProjectMenu` in the commit that adds it. It is called out where it appears, and no other task reads it.

**Type consistency.** `ProjectStore.load/save/clear` (Task 1) are the only storage calls Task 2 makes. `ProjectSlice.save(): Promise<ProjectStoreResult<ProjectBody>>` is what `createProjectAutosave`'s `api.getState().save()` invokes (Task 3). `bootProject` (Task 3) is what `App.tsx` awaits (Task 4). `ProjectMenu` (Task 5) consumes `openProjectFile`/`exportProjectFile`/`newProject`/`setProjectNotice` exactly as Task 2 declares them. `ErrorBoundary`'s `showDetails` (Task 6) is the same prop `ErrorFallback` takes.
