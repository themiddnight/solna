import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';

/**
 * A `PersistStorage` that skips the write when nothing persisted changed.
 *
 * zustand's `persist` calls `storage.setItem(name, { state: partialize(...),
 * version })` on EVERY `set()`, including the ones that touch no persisted
 * key — a playhead tick, a MIDI activity blink. `createJSONStorage` then
 * stringifies that fresh wrapper each time. This storage receives the object
 * instead and compares it with the last one it wrote under the same name:
 * same `version`, same key set, and every top-level value `Object.is`-equal
 * means the stored string would be identical, so it neither stringifies nor
 * writes.
 *
 * That comparison is by REFERENCE, so it relies on every writer of a
 * persisted value replacing it rather than mutating it in place — true of
 * every slice today and pinned in `store.test.ts`.
 *
 * Only writes that go through this object are remembered. The first write
 * after boot always happens (nothing is remembered yet), and `removeItem`
 * forgets the name so the next write goes through too.
 *
 * A FAILED write is a limit worth knowing. A `setItem` that throws
 * synchronously is not remembered (the value is recorded only after the
 * underlying call returns), so the next `set()` retries it. But the storage
 * underneath is `coalescedStorage`, which only buffers here and writes to
 * `localStorage` later, swallowing a quota or security error there. That
 * failure never reaches this object, so the value stays remembered, and an
 * unchanged state is not written again until some persisted key changes.
 * Before this dedupe every `set()` retried; now a failed write is retried
 * at the next change to a persisted key.
 *
 * `getItem` parses the way zustand's own `createJSONStorage` does on its
 * synchronous path; the coalesced storage underneath is synchronous.
 */
export function createDedupedJsonStorage<S extends object>(
  storage: StateStorage,
  opts?: { stringify?: (v: unknown) => string },
): PersistStorage<S> {
  const stringify = opts?.stringify ?? ((v: unknown) => JSON.stringify(v));
  const lastWritten = new Map<string, StorageValue<S>>();

  return {
    getItem: (name) => {
      const str = storage.getItem(name);
      if (str instanceof Promise) {
        throw new Error('createDedupedJsonStorage needs a synchronous StateStorage');
      }
      return str === null ? null : (JSON.parse(str) as StorageValue<S>);
    },
    setItem: (name, value) => {
      const previous = lastWritten.get(name);
      if (previous && sameStorageValue(previous, value)) return;
      storage.setItem(name, stringify(value));
      lastWritten.set(name, value);
    },
    removeItem: (name) => {
      lastWritten.delete(name);
      storage.removeItem(name);
    },
  };
}

function sameStorageValue<S extends object>(a: StorageValue<S>, b: StorageValue<S>): boolean {
  if (a.version !== b.version) return false;
  const aState = a.state as Record<string, unknown>;
  const bState = b.state as Record<string, unknown>;
  const aKeys = Object.keys(aState);
  if (aKeys.length !== Object.keys(bState).length) return false;
  return aKeys.every((key) => Object.hasOwn(bState, key) && Object.is(aState[key], bState[key]));
}
