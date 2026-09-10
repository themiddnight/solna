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
