import { normalizeStoredBody } from './projectFile';
import type { ProjectBody, ProjectMeta } from './projectFormat';

export interface ProjectStoreBackend {
  /** Metadata only — must not deserialise bodies. */
  listMeta(): Promise<ProjectMeta[]>;
  getBody(id: string): Promise<ProjectBody | undefined>;
  /** Writes `projects` and `projectMeta` in ONE transaction. */
  put(body: ProjectBody): Promise<void>;
  /** Removes from both stores in ONE transaction. */
  remove(id: string): Promise<void>;
  /** Drops any row present in one store but not the other. Key-only. */
  repairOrphans(): Promise<void>;
}

export type ProjectStoreStatus = 'unknown' | 'ready' | 'unavailable';
export type ProjectStoreError = 'unavailable' | 'quota' | 'not-found' | 'failed';
export type ProjectStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProjectStoreError; message: string };

export const QUOTA_MESSAGE = 'There is not enough storage space to save this project';
export const UNAVAILABLE_MESSAGE =
  'Project storage is unavailable on this device (private browsing or blocked site storage).';
export const NOT_FOUND_MESSAGE = 'That project is no longer stored on this device.';
export const FAILED_MESSAGE = 'Project storage failed. Export the session to keep your work.';

export interface ProjectStore {
  status(): ProjectStoreStatus;
  list(): Promise<ProjectStoreResult<ProjectMeta[]>>;
  get(id: string): Promise<ProjectStoreResult<ProjectBody>>;
  put(body: ProjectBody): Promise<ProjectStoreResult<ProjectMeta>>;
  remove(id: string): Promise<ProjectStoreResult<null>>;
}

export function toMeta(body: ProjectBody): ProjectMeta {
  return {
    formatVersion: body.formatVersion,
    id: body.id,
    name: body.name,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
  };
}

function isQuotaError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'QuotaExceededError';
}

/**
 * Wraps a backend so every call resolves to a typed result — an `open()` that
 * throws or rejects is a normal state ('unavailable'), not an exception path,
 * mirroring resolveStorage() in store.ts. Availability is resolved ONCE,
 * lazily, on the first call: probing at module load would cost every launch a
 * database open that most launches never need.
 */
export function createProjectStore(openBackend: () => Promise<ProjectStoreBackend>): ProjectStore {
  let status: ProjectStoreStatus = 'unknown';
  let opening: Promise<ProjectStoreBackend | null> | null = null;

  const open = (): Promise<ProjectStoreBackend | null> => {
    opening ??= (async () => {
      let backend: ProjectStoreBackend;
      try {
        backend = await openBackend();
      } catch {
        status = 'unavailable';
        return null;
      }
      // Availability is decided by the open ALONE. Orphan rows are cosmetic —
      // a meta with no body is one list row that fails to open — so a repair
      // that throws must never cost the whole session its storage.
      status = 'ready';
      try {
        await backend.repairOrphans();
      } catch {
        // ignore
      }
      return backend;
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
    list: () =>
      run(async (b) => {
        const metas = await b.listMeta();
        metas.sort((x, y) => y.updatedAt - x.updatedAt);
        return { ok: true, value: metas };
      }),
    // Every body LEAVES the library through here — open, export, rename and
    // saveProject's existence check all read through get — so the upgrade
    // runs where the body is READ, not at one caller. A body stored before a
    // format bump is otherwise spread straight into the store by
    // openProject/install, or re-stamped as current by a writer that never
    // upgraded its content; both fail silently, by blanking data.
    get: (id) =>
      run(async (b) => {
        const body = await b.getBody(id);
        return body
          ? { ok: true, value: normalizeStoredBody(body) }
          : { ok: false, error: 'not-found', message: NOT_FOUND_MESSAGE };
      }),
    put: (body) =>
      run(async (b) => {
        await b.put(body);
        return { ok: true, value: toMeta(body) };
      }),
    remove: (id) =>
      run(async (b) => {
        await b.remove(id);
        return { ok: true, value: null };
      }),
  };
}

/** Test double and the shape the IndexedDB backend must match. */
export function createMemoryBackend(seed: ProjectBody[] = []) {
  const bodies = new Map<string, ProjectBody>(seed.map((b) => [b.id, b]));
  const metas = new Map<string, ProjectMeta>(seed.map((b) => [b.id, toMeta(b)]));
  const backend: ProjectStoreBackend & { bodies: typeof bodies; metas: typeof metas } = {
    bodies,
    metas,
    listMeta: async () => [...metas.values()],
    getBody: async (id) => bodies.get(id),
    put: async (body) => {
      bodies.set(body.id, structuredClone(body));
      metas.set(body.id, toMeta(body));
    },
    remove: async (id) => {
      bodies.delete(id);
      metas.delete(id);
    },
    repairOrphans: async () => {
      for (const id of [...metas.keys()]) if (!bodies.has(id)) metas.delete(id);
      for (const id of [...bodies.keys()]) if (!metas.has(id)) bodies.delete(id);
    },
  };
  return backend;
}
