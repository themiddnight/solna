import { isDiagnosticSessionV1 } from './session';
import type { DiagnosticSessionV1 } from './types';
import { requestToPromise, transactionDone } from '@/utils/idbPromise';

const DIAGNOSTIC_DB_NAME = 'solna-diagnostics';
const DB_VERSION = 1;
const STORE = 'session';
const SLOT_KEY = 'latest';
const OPEN_TIMEOUT_MS = 10_000;

export interface DiagnosticSessionBackend {
  get(): Promise<unknown>;
  put(session: DiagnosticSessionV1): Promise<void>;
  remove(): Promise<void>;
}

export interface DiagnosticSessionStore {
  load(): Promise<DiagnosticSessionV1 | null>;
  save(session: DiagnosticSessionV1): Promise<void>;
  clear(): Promise<void>;
}

export function createDiagnosticSessionStore(
  openBackend: () => Promise<DiagnosticSessionBackend>,
): DiagnosticSessionStore {
  let opening: Promise<DiagnosticSessionBackend> | null = null;
  const open = () => (opening ??= openBackend());
  return {
    load: async () => {
      const record = await (await open()).get();
      return isDiagnosticSessionV1(record) ? structuredClone(record) : null;
    },
    save: async (session) => (await open()).put(structuredClone(session)),
    clear: async () => (await open()).remove(),
  };
}

function openDiagnosticIndexedDb(): Promise<DiagnosticSessionBackend> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
      request = indexedDB.open(DIAGNOSTIC_DB_NAME, DB_VERSION);
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
    put: async (session) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(session, SLOT_KEY);
      await transactionDone(tx);
    },
    remove: async () => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(SLOT_KEY);
      await transactionDone(tx);
    },
  }));
}

export function createMemoryDiagnosticBackend(seed?: unknown) {
  let value = seed === undefined ? undefined : structuredClone(seed);
  return {
    get: async () => value,
    put: async (session: DiagnosticSessionV1) => { value = structuredClone(session); },
    remove: async () => { value = undefined; },
  } satisfies DiagnosticSessionBackend;
}

export const diagnosticSessionStore = createDiagnosticSessionStore(openDiagnosticIndexedDb);
