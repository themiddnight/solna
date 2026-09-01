import { describe, expect, test } from 'bun:test';
import type { StateStorage } from 'zustand/middleware';
import { createCoalescedStorage, type WriteScheduler } from './coalescedStorage';

/** A storage whose every call is recorded, and which can be made to throw. */
function recordingStorage(opts: { throwOnSet?: boolean } = {}) {
  const data = new Map<string, string>();
  const calls: string[] = [];
  const storage: StateStorage = {
    getItem: (name) => {
      calls.push(`get:${name}`);
      return data.get(name) ?? null;
    },
    setItem: (name, value) => {
      calls.push(`set:${name}`);
      if (opts.throwOnSet) throw new Error('QuotaExceededError');
      data.set(name, value);
    },
    removeItem: (name) => {
      calls.push(`remove:${name}`);
      data.delete(name);
    },
  };
  return { storage, data, calls };
}

/** A scheduler the test drives by hand — no timers, no sleeping. */
function manualScheduler() {
  let next = 1;
  const queued = new Map<number, () => void>();
  const scheduler: WriteScheduler = {
    schedule: (flush) => {
      const handle = next++;
      queued.set(handle, flush);
      return handle;
    },
    cancel: (handle) => {
      queued.delete(handle);
    },
  };
  const run = () => {
    const due = [...queued.values()];
    queued.clear();
    due.forEach((fn) => fn());
  };
  return { scheduler, run, size: () => queued.size };
}

describe('createCoalescedStorage', () => {
  test('setItem buffers instead of writing through', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v1');

    expect(base.calls).toEqual([]);
    expect(storage.pendingNames()).toEqual(['k']);
  });

  test('N writes to one name collapse into one write of the LAST value', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v1');
    storage.setItem('k', 'v2');
    storage.setItem('k', 'v3');
    sched.run();

    expect(base.calls).toEqual(['set:k']);
    expect(base.data.get('k')).toBe('v3');
    expect(storage.pendingNames()).toEqual([]);
  });

  test('one flush is scheduled per burst, not one per write', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v1');
    storage.setItem('k', 'v2');
    storage.setItem('other', 'x');

    expect(sched.size()).toBe(1);
    sched.run();
    expect(base.calls.sort()).toEqual(['set:k', 'set:other']);
  });

  test('getItem reads back a buffered write before it has been flushed', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'pending');

    expect(storage.getItem('k')).toBe('pending');
    expect(base.calls).toEqual([]); // never consulted the base for a buffered name
    expect(storage.getItem('missing')).toBe(null);
    expect(base.calls).toEqual(['get:missing']);
  });

  test('removeItem drops the buffered write and deletes through immediately', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);
    base.storage.setItem('k', 'old');
    base.calls.length = 0;

    storage.setItem('k', 'pending');
    storage.removeItem('k');

    expect(base.calls).toEqual(['remove:k']);
    expect(base.data.has('k')).toBe(false);
    expect(storage.pendingNames()).toEqual([]);
    sched.run();
    expect(base.calls).toEqual(['remove:k']); // the dropped write never lands
  });

  test('flush() writes synchronously and cancels the scheduled callback', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v');
    storage.flush();

    expect(base.data.get('k')).toBe('v');
    expect(sched.size()).toBe(0);
    sched.run();
    expect(base.calls).toEqual(['set:k']); // no second write
  });

  test('flush() with nothing buffered never touches the base', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.flush();

    expect(base.calls).toEqual([]);
  });

  test('discard() drops buffered writes without writing them', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v');
    storage.discard();
    sched.run();

    expect(base.calls).toEqual([]);
    expect(storage.pendingNames()).toEqual([]);
  });

  test('a base whose setItem THROWS never breaks the adapter', () => {
    // Safari private mode / blocked cookies / embedded webviews: setItem
    // throws rather than returning. The buffer must still clear and later
    // writes must keep working.
    const base = recordingStorage({ throwOnSet: true });
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v1');
    expect(() => sched.run()).not.toThrow();
    expect(storage.pendingNames()).toEqual([]);

    storage.setItem('k', 'v2');
    expect(() => storage.flush()).not.toThrow();
    expect(base.calls).toEqual(['set:k', 'set:k']);
  });

  test('a throwing getItem/removeItem is swallowed too', () => {
    const base: StateStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base, sched.scheduler);

    expect(storage.getItem('k')).toBe(null);
    expect(() => storage.removeItem('k')).not.toThrow();
  });

  test('flushing again after a flush is a no-op', () => {
    const base = recordingStorage();
    const sched = manualScheduler();
    const storage = createCoalescedStorage(base.storage, sched.scheduler);

    storage.setItem('k', 'v');
    storage.flush();
    storage.flush();

    expect(base.calls).toEqual(['set:k']);
  });
});
