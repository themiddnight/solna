import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { createMemoryBackend, createProjectStore, type ProjectStoreBackend } from './projectStore';
import { factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
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

let stopSource: ReturnType<typeof spyOn>;
beforeEach(() => {
  stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
});
afterEach(() => {
  stopSource.mockRestore();
});

const stored = (name: string, bpm: number): ProjectBody => ({
  ...makeEnvelope(name, 1_000),
  content: { ...factoryProjectContent(), bpm },
});

/**
 * The REAL module, one per test. `bootProject` memoizes its promise in a
 * module-level `booting`, so two tests sharing a module instance would share
 * one boot — the second would observe the first's.
 */
let instance = 0;
async function freshApp(seed?: ProjectBody) {
  const mod = await import(`./store?boot=${instance++}`);
  const { createProjectSlice } = await import('./projectSlice');
  const memory = createMemoryBackend(seed);
  const projectStore = createProjectStore(async () => memory);
  const slice = createProjectSlice(
    mod.useAppStore.setState,
    mod.useAppStore.getState,
    projectStore,
    () => 5_000,
  );
  mod.useAppStore.setState({ ...slice, projectName: null });
  // Named bindings, never a spread of the module namespace: a namespace object
  // is not a plain object, and spreading one silently yields no exports.
  return {
    useAppStore: mod.useAppStore,
    bootProject: mod.bootProject,
    projectAutosave: mod.projectAutosave,
    memory,
  };
}

/**
 * The ordering pin, measured on the real `bootProject()` and the real
 * `projectAutosave` — never by re-implementing the try/finally here, which
 * would pass no matter what order the production code used.
 *
 * Two independent discriminators, because the failure mode is a WRITE racing
 * the load:
 *
 * 1. `events` is stamped by the storage boundary the load actually awaits
 *    (`getBody`) and by `projectAutosave.arm` itself. Arming first pushes
 *    'arm' before 'load'.
 * 2. `isScheduled()` is read from inside that awaited boundary, and again
 *    after boot. The install `loadProject` performs IS a content write, so if
 *    autosave were armed while it ran, a write would be pending on return —
 *    which is exactly how a fresh load gets overwritten by the placeholder.
 */
describe('bootProject: load first, arm autosave after', () => {
  async function instrumented(seed?: ProjectBody) {
    const app = await freshApp(seed);
    const { useAppStore, projectAutosave } = app;
    const events: string[] = [];
    const scheduledDuringLoad: boolean[] = [];

    const originalArm = projectAutosave.arm;
    projectAutosave.arm = () => {
      events.push('arm');
      originalArm();
    };

    const backend: ProjectStoreBackend = {
      ...app.memory,
      getBody: async () => {
        events.push('load');
        scheduledDuringLoad.push(projectAutosave.isScheduled());
        const body = await app.memory.getBody();
        scheduledDuringLoad.push(projectAutosave.isScheduled());
        return body;
      },
    };
    const { createProjectSlice } = await import('./projectSlice');
    const store = createProjectStore(async () => backend);
    useAppStore.setState({
      ...createProjectSlice(useAppStore.setState, useAppStore.getState, store, () => 5_000),
      projectName: null,
    });

    return { app, projectAutosave, events, scheduledDuringLoad };
  }

  test('an empty slot: the load is awaited before autosave arms', async () => {
    const { app, projectAutosave, events, scheduledDuringLoad } = await instrumented();
    await app.bootProject();

    expect(events).toEqual(['load', 'arm']);
    expect(scheduledDuringLoad).toEqual([false, false]);
    expect(projectAutosave.isScheduled()).toBe(false);
    expect(app.useAppStore.getState().projectName).toBeNull();
    expect(app.useAppStore.getState().bpm).toBe(factoryProjectContent().bpm);
  });

  test('a stored project: the install happens while DISARMED, so it schedules nothing', async () => {
    const { app, projectAutosave, events, scheduledDuringLoad } =
      await instrumented(stored('Alpha', 77));
    await app.bootProject();

    expect(events).toEqual(['load', 'arm']);
    expect(scheduledDuringLoad).toEqual([false, false]);
    // The install wrote bpm 77 + name 'Alpha' into the store. Had autosave
    // been armed, that content change alone would have queued a write.
    expect(app.useAppStore.getState().bpm).toBe(77);
    expect(app.useAppStore.getState().projectName).toBe('Alpha');
    expect(projectAutosave.isScheduled()).toBe(false);
  });

  test('boot writes no project body of its own', async () => {
    const { app, projectAutosave } = await instrumented(stored('Alpha', 77));
    const saves: string[] = [];
    app.useAppStore.setState({
      save: async () => {
        saves.push('save');
        return { ok: true, value: null } as never;
      },
    });

    await app.bootProject();
    projectAutosave.flush();

    expect(projectAutosave.isScheduled()).toBe(false);
    expect(saves).toEqual([]);
  });

  test('the load is memoized: a second bootProject() re-reads nothing', async () => {
    const { app, events } = await instrumented();
    await Promise.all([app.bootProject(), app.bootProject()]);
    await app.bootProject();

    expect(events).toEqual(['load', 'arm']);
  });
});

/** A smoke test of the pure helper the loading gate renders. */
describe('projectDisplayName on the boot placeholder', () => {
  test('the factory content a booting store holds is the default project', async () => {
    const app = await freshApp();
    const state = app.useAppStore.getState() as AppStore;
    expect(state.bpm).toBe(factoryProjectContent().bpm);
    expect(state.meterId).toBe(factoryProjectContent().meterId);
    expect(state.masterVolume).toBe(factoryProjectContent().masterVolume);
  });
});
