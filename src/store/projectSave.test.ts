import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { SAVE_FAILED_MESSAGE, SAVE_HANDLE_DENIED_MESSAGE } from './projectSlice';
import { UNTITLED_SOURCE } from './projectSource';
import type { AppStore } from './types';

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new FakeLocalStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
});

/**
 * A REAL FileSystemFileHandle keeps its methods on the prototype, so the fake
 * does too. That is not a detail: structuredClone — which the memory backend and
 * IndexedDB both go through — copies own properties only and THROWS on a
 * function, so an object literal carrying `createWritable` would not survive the
 * slot write that every save performs.
 */
function fakeHandle(name: string, sink: string[] = []): FileSystemFileHandle {
  const proto = {
    createWritable: async () => ({
      write: async (text: string) => {
        sink.push(text);
      },
      close: async () => {},
    }),
  };
  return Object.assign(Object.create(proto), { name }) as unknown as FileSystemFileHandle;
}

function unpickablePicker(): FileSystemFileHandle {
  const proto = {
    createWritable: async () => {
      throw new DOMException('denied', 'NotAllowedError');
    },
  };
  return Object.assign(Object.create(proto), { name: 'doomed.solna' }) as unknown as FileSystemFileHandle;
}

function deniedHandle(): FileSystemFileHandle {
  const proto = {
    queryPermission: async () => 'prompt' as PermissionState,
    requestPermission: async () => 'denied' as PermissionState,
  };
  return Object.assign(Object.create(proto), { name: 'locked.solna' }) as unknown as FileSystemFileHandle;
}

function setPicker(value: unknown): void {
  Object.defineProperty(globalThis, 'showSaveFilePicker', { value, configurable: true, writable: true });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'showSaveFilePicker');
});

let clock = 5_000;
let instance = 0;

/** The REAL store module, one instance per test — see projectBoot.test.ts for why. */
async function freshSlice() {
  const mod = await import(`./store?save=${instance++}`);
  const { createProjectSlice } = await import('./projectSlice');
  const backend = createMemoryBackend();
  const projectStore = createProjectStore(async () => backend);
  const slice = createProjectSlice(mod.useAppStore.setState, mod.useAppStore.getState, projectStore, () => clock);
  mod.useAppStore.setState({ ...slice, projectName: null });
  return { useAppStore: mod.useAppStore, store: projectStore, slice: mod.useAppStore.getState() as AppStore };
}

describe('saveProject dispatch', () => {
  test('an untitled project routes to Save As, which picks a target', async () => {
    const { useAppStore, slice } = await freshSlice();
    const sink: string[] = [];
    setPicker(async () => fakeHandle('chosen.solna', sink));
    expect(await slice.saveProject()).toEqual({ ok: true, destination: 'local' });
    expect(useAppStore.getState().projectSource.kind).toBe('local');
    expect(sink).toHaveLength(1);
  });

  test('a local source overwrites through its handle and never consults the picker', async () => {
    const { useAppStore, slice } = await freshSlice();
    const sink: string[] = [];
    setPicker(async () => {
      throw new Error('the picker must not be consulted for a project with a target');
    });
    useAppStore.setState({ projectSource: { kind: 'local', handle: fakeHandle('sketch.solna', sink) } });
    expect(await slice.saveProject()).toEqual({ ok: true, destination: 'local' });
    expect(sink).toHaveLength(1);
  });

  test('a drive source delegates Save to the Drive slice', async () => {
    const { useAppStore, slice } = await freshSlice();
    const calls: string[] = [];
    useAppStore.setState({
      projectSource: { kind: 'drive', fileId: 'drive-1' },
      // The one seam a test needs: the slice is dispatching, not writing.
      saveToDrive: async () => {
        calls.push('drive');
        return { ok: true, destination: 'drive' };
      },
    });
    expect(await slice.saveProject()).toEqual({ ok: true, destination: 'drive' });
    expect(calls).toEqual(['drive']);
  });

  test('Save on a local source keeps the id and createdAt and only moves updatedAt', async () => {
    const { useAppStore, slice } = await freshSlice();
    const sink: string[] = [];
    useAppStore.setState({ projectSource: { kind: 'local', handle: fakeHandle('sketch.solna', sink) } });
    const before = slice.exportProjectFile();
    clock = 9_000;
    await slice.saveProject();
    const written = JSON.parse(sink[0]) as { id: string; createdAt: number; updatedAt: number };
    expect(written.id).toBe(before.id);
    expect(written.createdAt).toBe(before.createdAt);
    expect(written.updatedAt).toBe(9_000);
  });

  test('a handle whose write permission was revoked asks once, then reports the denial', async () => {
    const { useAppStore, slice } = await freshSlice();
    useAppStore.setState({ projectSource: { kind: 'local', handle: deniedHandle() } });
    expect(await slice.saveProject()).toEqual({ ok: false, message: SAVE_HANDLE_DENIED_MESSAGE });
  });
});

describe('Save As (local)', () => {
  test('writes through the picked handle, adopts its name and re-points the source', async () => {
    const { useAppStore, slice } = await freshSlice();
    const sink: string[] = [];
    const handle = fakeHandle('mix.solna', sink);
    setPicker(async () => handle);
    useAppStore.setState({ projectName: 'Sketch' });

    expect(await slice.saveProjectAsLocal()).toEqual({ ok: true, destination: 'local' });

    const after = useAppStore.getState();
    expect(after.projectName).toBe('mix');
    expect(after.projectSource).toEqual({ kind: 'local', handle });
    expect((JSON.parse(sink[0]) as { name: string }).name).toBe('mix');
  });

  test('a new document gets a fresh id and createdAt = updatedAt = now', async () => {
    const { slice } = await freshSlice();
    const sink: string[] = [];
    setPicker(async () => fakeHandle('mix.solna', sink));
    const before = slice.exportProjectFile();
    clock = 7_000;
    await slice.saveProjectAsLocal();
    const written = JSON.parse(sink[0]) as { id: string; createdAt: number; updatedAt: number };
    expect(written.id).not.toBe(before.id);
    expect(written.createdAt).toBe(7_000);
    expect(written.updatedAt).toBe(7_000);
  });

  test('a dismissed picker does nothing at all — no write, no notice, no re-point', async () => {
    const { useAppStore, slice } = await freshSlice();
    setPicker(async () => {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      throw err;
    });
    expect(await slice.saveProjectAsLocal()).toEqual({ ok: true, destination: 'cancelled' });
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('a browser without the API degrades to a download and stays untitled', async () => {
    const { useAppStore, slice } = await freshSlice();
    // No picker is installed, so the probe finds nothing: the capability case,
    // not an error. The store cannot touch `document`, so the CALLER writes the
    // copy — `download` is the instruction, not a failure.
    expect(await slice.saveProjectAsLocal()).toEqual({ ok: true, destination: 'download' });
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('a write that fails leaves the old identity and the old source in place', async () => {
    const { useAppStore, slice } = await freshSlice();
    setPicker(async () => unpickablePicker());
    const before = slice.exportProjectFile();
    expect(await slice.saveProjectAsLocal()).toEqual({ ok: false, message: SAVE_FAILED_MESSAGE });
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
    expect(useAppStore.getState().projectName).toBeNull();
    // The live document did NOT become a new one — the id must not have been
    // adopted before the write succeeded, or the next Save would tell the old
    // file's readers that it is a different document.
    expect(slice.exportProjectFile().id).toBe(before.id);
  });

  test('a denied permission on the picked handle reports the denial and adopts nothing', async () => {
    const { useAppStore, slice } = await freshSlice();
    setPicker(async () => deniedHandle());
    expect(await slice.saveProjectAsLocal()).toEqual({ ok: false, message: SAVE_HANDLE_DENIED_MESSAGE });
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('an adopted Save As is written into the slot, so a reload resumes the same file', async () => {
    const { useAppStore, store, slice } = await freshSlice();
    setPicker(async () => fakeHandle('mix.solna'));
    await slice.saveProjectAsLocal();
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual(useAppStore.getState().projectSource);
  });
});

describe('applyProjectSource', () => {
  test('re-points the source and writes it into the slot', async () => {
    const { useAppStore, store, slice } = await freshSlice();
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-1' } });
    await slice.applyProjectSource(UNTITLED_SOURCE);
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual(UNTITLED_SOURCE);
  });

  test('re-pointing at the source that is already set writes nothing', async () => {
    const { useAppStore, store, slice } = await freshSlice();
    // `showSaveFilePicker` is installed (and afterEach drops it) because a
    // local Save WITHOUT one degrades to a download and leaves the source
    // untitled — not the "honest starting point" this test names. The picker is
    // what makes the source local; without it the read guard in
    // sanitizeProjectSource drops a `local` row whose handle is not an object,
    // so the slot reads back untitled and this assertion fails.
    setPicker(async () => fakeHandle('sketch.solna'));
    await slice.saveProjectAsLocal(); // an honest starting point: a local source
    const handle = (useAppStore.getState().projectSource as { handle: FileSystemFileHandle }).handle;
    // The SAME handle: no write. Asserted through the slot, which is the only
    // observable difference a redundant write would make.
    await slice.applyProjectSource({ kind: 'local', handle });
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual({ kind: 'local', handle });
  });
});
