import { normalizeStoredBody } from './projectFile';
import { sanitizeSlotRecord, type ProjectSlotRecord } from './projectSource';
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
  getRecord(): Promise<unknown>;
  putRecord(record: ProjectSlotRecord): Promise<void>;
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
  load(): Promise<ProjectStoreResult<ProjectSlotRecord>>;
  save(record: ProjectSlotRecord): Promise<ProjectStoreResult<ProjectSlotRecord>>;
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
    clear: () =>
      run(async (b) => {
        await b.remove();
        return { ok: true as const, value: null };
      }),
  };
}

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
