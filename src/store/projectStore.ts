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
