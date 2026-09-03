import type { ProjectStoreBackend } from './projectStore';
import type { ProjectBody, ProjectMeta } from './projectFormat';
import { toMeta } from './projectStore';

export const PROJECT_DB_NAME = 'solna-projects';
export const PROJECT_DB_VERSION = 1;
const BODIES = 'projects';
const METAS = 'projectMeta';

/**
 * How long to wait for an open that never fires an event. Generous on purpose:
 * a cold first-run open on a slow device under storage pressure can take
 * seconds, and timing that out costs the user their whole project library for
 * the session. Only a genuinely stuck webview should reach this.
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
 * Opens (and on first use creates) the two-store database. Rejects — instead
 * of throwing synchronously — when `indexedDB` is missing, blocked or errors
 * on open; createProjectStore turns that rejection into the degraded state.
 * A stuck open (some webviews never fire any event) is bounded by a timeout so
 * the Project Manager cannot hang forever.
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
      if (!db.objectStoreNames.contains(BODIES)) db.createObjectStore(BODIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(METAS)) db.createObjectStore(METAS, { keyPath: 'id' });
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
    listMeta: async () => {
      const tx = db.transaction(METAS, 'readonly');
      const rows = await requestToPromise(tx.objectStore(METAS).getAll() as IDBRequest<ProjectMeta[]>);
      return rows;
    },
    getBody: async (id) => {
      const tx = db.transaction(BODIES, 'readonly');
      return requestToPromise(tx.objectStore(BODIES).get(id) as IDBRequest<ProjectBody | undefined>);
    },
    put: async (body) => {
      const tx = db.transaction([BODIES, METAS], 'readwrite');
      tx.objectStore(BODIES).put(body);
      tx.objectStore(METAS).put(toMeta(body));
      await transactionDone(tx);
    },
    remove: async (id) => {
      const tx = db.transaction([BODIES, METAS], 'readwrite');
      tx.objectStore(BODIES).delete(id);
      tx.objectStore(METAS).delete(id);
      await transactionDone(tx);
    },
    repairOrphans: async () => {
      // Key-only: getAllKeys never deserialises a body. BOTH reads are issued
      // synchronously on one readonly transaction — awaiting between two
      // requests on the SAME transaction can find it already committed
      // (TransactionInactiveError on older WebKit) — and the deletes then run
      // on a fresh readwrite transaction, opened only when there is work.
      const readTx = db.transaction([BODIES, METAS], 'readonly');
      const bodyRequest = requestToPromise(readTx.objectStore(BODIES).getAllKeys());
      const metaRequest = requestToPromise(readTx.objectStore(METAS).getAllKeys());
      const [bodyKeys, metaKeys] = await Promise.all([bodyRequest, metaRequest]);
      const bodySet = new Set(bodyKeys);
      const metaSet = new Set(metaKeys);
      const staleMetas = metaKeys.filter((key) => !bodySet.has(key));
      const staleBodies = bodyKeys.filter((key) => !metaSet.has(key));
      if (staleMetas.length === 0 && staleBodies.length === 0) return;
      const tx = db.transaction([BODIES, METAS], 'readwrite');
      for (const key of staleMetas) tx.objectStore(METAS).delete(key);
      for (const key of staleBodies) tx.objectStore(BODIES).delete(key);
      await transactionDone(tx);
    },
  }));
}
