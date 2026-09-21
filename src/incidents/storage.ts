import { isIncidentReportV1 } from './sanitize';
import type { IncidentReportV1 } from './types';
import { requestToPromise, transactionDone } from '@/utils/idbPromise';

const DB_NAME = 'solna-incidents';
const DB_VERSION = 1;
const STORE = 'incident';
const SLOT_KEY = 'latest';
const OPEN_TIMEOUT_MS = 10_000;

export interface IncidentBackend {
  get(): Promise<unknown>;
  put(incident: IncidentReportV1): Promise<void>;
  remove(): Promise<void>;
}

export interface IncidentStore {
  load(): Promise<IncidentReportV1 | null>;
  save(incident: IncidentReportV1): Promise<void>;
  clear(): Promise<void>;
  /** Notified when a read or write fell back to memory. Optional so test doubles need not implement it. */
  subscribeFailure?(listener: () => void): () => void;
}

/**
 * One slot, and never an exception path: any storage failure keeps the latest
 * incident in memory so the report can still be shown and exported.
 */
export function createIncidentStore(
  openBackend: () => Promise<IncidentBackend> = openIncidentIndexedDb,
): IncidentStore {
  let opening: Promise<IncidentBackend> | null = null;
  const open = () => (opening ??= openBackend());
  let memory: IncidentReportV1 | null = null;
  const failureListeners = new Set<() => void>();
  const failed = () => failureListeners.forEach((listener) => listener());
  return {
    subscribeFailure: (listener) => {
      failureListeners.add(listener);
      return () => void failureListeners.delete(listener);
    },
    load: async () => {
      try {
        const record = await (await open()).get();
        return isIncidentReportV1(record) ? structuredClone(record) : null;
      } catch {
        failed();
        return memory ? structuredClone(memory) : null;
      }
    },
    save: async (incident) => {
      memory = structuredClone(incident);
      try {
        await (await open()).put(structuredClone(incident));
      } catch {
        failed();
        // Continue in memory.
      }
    },
    clear: async () => {
      memory = null;
      try {
        await (await open()).remove();
      } catch {
        failed();
        // Continue in memory.
      }
    },
  };
}

function openIncidentIndexedDb(): Promise<IncidentBackend> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), OPEN_TIMEOUT_MS);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
    request.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('IndexedDB open blocked'));
    };
  }).then((db) => ({
    get: async () => requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(SLOT_KEY)),
    put: async (incident) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(incident, SLOT_KEY);
      await transactionDone(tx);
    },
    remove: async () => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(SLOT_KEY);
      await transactionDone(tx);
    },
  }));
}
