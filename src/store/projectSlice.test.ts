import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { buildProjectContent, factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
import { fingerprintContent } from './projectFingerprint';
import { createDefaultLoop, DEFAULT_LOOP_ID } from './loopSlice';
import { LOOP_FLAT_KEYS } from './loop';
import type { AppStore } from './types';

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

let storeModule: Promise<typeof import('./store')>;
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new FakeLocalStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  storeModule = import(`./store?bust=${Date.now()}`);
});

/** A fresh slice bound to the live store but to ITS OWN memory backend. */
async function sliceWithBackend(seed: ProjectBody[] = []) {
  const { useAppStore } = await storeModule;
  const { createProjectSlice } = await import('./projectSlice');
  const backend = createMemoryBackend(seed);
  const store = createProjectStore(async () => backend);
  const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, store, () => 5_000);
  useAppStore.setState({ ...slice, currentProjectId: null, projectBaselineHash: null, dirty: false });
  return { useAppStore, backend, slice: useAppStore.getState() as AppStore };
}

const stored = (name: string, bpm: number): ProjectBody => ({
  ...makeEnvelope(name, 1_000),
  content: { ...factoryProjectContent(), bpm, loops: [{ ...createDefaultLoop(), id: `loop-${name}` }] },
});

/** The engine seam: stopSource no-ops before init(), so the spy only records. */
let stopSource: ReturnType<typeof spyOn>;
beforeEach(async () => {
  const { useAppStore } = await storeModule;
  useAppStore.setState({ sequencerPlayer: 'stopped', chordsPlayer: 'stopped', leadPlayer: 'stopped', selectedVibeId: null });
  stopSource = spyOn(audioEngine, 'stopSource').mockImplementation(() => {});
});
afterEach(() => {
  stopSource.mockRestore();
});

describe('openProject', () => {
  test('stops the transport, installs content in one set(), applies the reset rules and takes a baseline', async () => {
    const p = stored('Alpha', 77);
    const { useAppStore, slice } = await sliceWithBackend([p]);
    useAppStore.setState({ sequencerPlayer: 'playing', selectedVibeId: 'cyber-dance', controlTarget: 'bass', metronomeActive: true, activeLoopId: 'foreign', songLoopIndex: 2 });
    let writes = 0;
    const unsub = useAppStore.subscribe((s, prev) => { if (s.bpm !== prev.bpm || s.loops !== prev.loops) writes++; });
    const result = await slice.openProject(p.id);
    unsub();
    expect(result.ok).toBe(true);
    const s = useAppStore.getState();
    expect(writes).toBe(1);
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.playbackScope.kind).toBe('none');
    expect(s.bpm).toBe(77);
    expect(s.activeLoopId).toBe('loop-Alpha');
    expect(s.scaleRoot).toBe(p.content.loops[0].scaleRoot);
    expect(s.selectedVibeId).toBeNull();
    expect(s.controlTarget).toBe('bass');
    expect(s.metronomeActive).toBe(true);
    expect(s.currentProjectId).toBe(p.id);
    expect(s.currentProjectName).toBe('Alpha');
    expect(s.projectBaselineHash).toBe(fingerprintContent(p.content));
    expect(s.dirty).toBe(false);
    expect(s.songLoopIndex).toBeNull();
  });

  test('cuts the chord and bass voices BEFORE the state swap, like loadLoop', async () => {
    const p = stored('Cut', 78);
    const { useAppStore, slice } = await sliceWithBackend([p]);
    const order: string[] = [];
    stopSource.mockImplementation((source: string, release: number) => { order.push(`${source}@${release}`); });
    const unsub = useAppStore.subscribe((s, prev) => { if (s.bpm !== prev.bpm) order.push('set'); });
    await slice.openProject(p.id);
    unsub();
    expect(order).toEqual(['chord@0.02', 'bass@0.02', 'set']);
  });

  test('a missing id is a not-found result, leaves the session untouched and cuts nothing', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    useAppStore.setState({ bpm: 133 });
    const result = await slice.openProject('ghost');
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().bpm).toBe(133);
    expect(stopSource).not.toHaveBeenCalled();
  });
});

describe('newProject', () => {
  test('resets content to factory, clears the id, keeps the tab and preferences', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    useAppStore.setState({ bpm: 140, currentProjectId: 'x', currentProjectName: 'X', activeTab: 'effects', selectedVibeId: 'asian-zen', sequencerPlayer: 'playing', songLoopIndex: 1 });
    slice.newProject();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(120);
    expect(s.loops).toHaveLength(1);
    expect(s.activeLoopId).toBe(s.loops[0].id);
    expect(s.currentProjectId).toBeNull();
    expect(s.currentProjectName).toBeNull();
    expect(s.selectedVibeId).toBeNull();
    expect(s.activeTab).toBe('effects');
    expect(s.sequencerPlayer).toBe('stopped');
    expect(s.dirty).toBe(false);
    // Untitled: no baseline — the tracker compares against the default project.
    expect(s.projectBaselineHash).toBeNull();
    expect(s.songLoopIndex).toBeNull();
  });

  test('cuts the chord and bass voices before the reset, like Open', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    const order: string[] = [];
    stopSource.mockImplementation((source: string) => { order.push(source); });
    const unsub = useAppStore.subscribe((s, prev) => { if (s.loops !== prev.loops) order.push('set'); });
    useAppStore.setState({ bpm: 140 });
    slice.newProject();
    unsub();
    expect(order).toEqual(['chord', 'bass', 'set']);
  });
});

describe('saveProject / saveProjectAs', () => {
  test('saveProjectAs mints a record, makes it current and clears dirty', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    useAppStore.setState({ bpm: 99, dirty: true });
    const result = await slice.saveProjectAs('Fresh');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(backend.bodies.get(result.value.id)?.content.bpm).toBe(99);
    expect(result.value.name).toBe('Fresh');
    expect(result.value.createdAt).toBe(5_000);
    expect(result.value.updatedAt).toBe(5_000);
    const s = useAppStore.getState();
    expect(s.currentProjectId).toBe(result.value.id);
    expect(s.currentProjectName).toBe('Fresh');
    expect(s.dirty).toBe(false);
    expect(s.projectList[0].id).toBe(result.value.id);
    expect(s.projectBaselineHash).toBe(fingerprintContent(buildProjectContent(s)));
  });

  test('saveProject writes back silently: same id, same createdAt, new updatedAt', async () => {
    const p = stored('Keep', 80);
    const { useAppStore, backend, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    useAppStore.setState({ bpm: 81, dirty: true });
    const result = await slice.saveProject();
    expect(result.ok).toBe(true);
    const saved = backend.bodies.get(p.id);
    expect(saved?.content.bpm).toBe(81);
    expect(saved?.createdAt).toBe(1_000);
    expect(saved?.updatedAt).toBe(5_000);
    expect(saved?.name).toBe('Keep');
    expect(useAppStore.getState().dirty).toBe(false);
  });

  test('saveProject falls back to the store when a valid currentProjectId is missing from the transient list', async () => {
    const p = stored('Reloaded', 82);
    const { useAppStore, backend, slice } = await sliceWithBackend([p]);
    // Simulate a fresh reload: currentProjectId came back from persistence,
    // but refreshProjects() has not run yet, so projectList is still empty.
    useAppStore.setState({ currentProjectId: p.id, currentProjectName: null, bpm: 83, dirty: true });
    expect(useAppStore.getState().projectList).toEqual([]);
    const result = await slice.saveProject();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(p.id);
    const saved = backend.bodies.get(p.id);
    expect(saved?.content.bpm).toBe(83);
    expect(saved?.createdAt).toBe(1_000);
    expect(useAppStore.getState().dirty).toBe(false);
  });

  test('saveProject without a current project refuses with not-found (the UI prompts for a name)', async () => {
    const { slice } = await sliceWithBackend();
    const result = await slice.saveProject();
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe('not-found');
  });

  test('a failed save never clears dirty', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    backend.put = async () => { throw new DOMException('q', 'QuotaExceededError'); };
    useAppStore.setState({ dirty: true });
    const result = await slice.saveProjectAs('Too Big');
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().dirty).toBe(true);
    expect(useAppStore.getState().currentProjectId).toBeNull();
  });

  test('saveProjectAs from an open project never overwrites the source', async () => {
    const p = stored('Source', 70);
    const { useAppStore, backend, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    useAppStore.setState({ bpm: 71 });
    const result = await slice.saveProjectAs('Source copy');
    expect(result.ok && result.value.id).not.toBe(p.id);
    expect(backend.bodies.get(p.id)?.content.bpm).toBe(70);
  });
});

describe('renameProject', () => {
  test('bumps updatedAt, updates the list and the current name, and does not touch dirty', async () => {
    const p = stored('Before', 60);
    const { useAppStore, backend, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    useAppStore.setState({ dirty: true });
    const result = await slice.renameProject(p.id, 'After');
    expect(result.ok).toBe(true);
    expect(backend.bodies.get(p.id)?.name).toBe('After');
    expect(backend.metas.get(p.id)?.updatedAt).toBe(5_000);
    const s = useAppStore.getState();
    expect(s.currentProjectName).toBe('After');
    expect(s.projectList.find((m) => m.id === p.id)?.name).toBe('After');
    expect(s.dirty).toBe(true);
  });
});

describe('deleteProject', () => {
  test('deleting the current project clears the id, marks dirty and leaves content on screen', async () => {
    const p = stored('Doomed', 66);
    const { useAppStore, backend, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    const result = await slice.deleteProject(p.id);
    expect(result.ok).toBe(true);
    expect(backend.bodies.has(p.id)).toBe(false);
    const s = useAppStore.getState();
    expect(s.bpm).toBe(66);
    expect(s.currentProjectId).toBeNull();
    expect(s.currentProjectName).toBeNull();
    expect(s.projectBaselineHash).toBeNull();
    expect(s.dirty).toBe(true);
  });

  test('deleting another project leaves the current one alone', async () => {
    const a = stored('A', 61);
    const b = stored('B', 62);
    const { useAppStore, slice } = await sliceWithBackend([a, b]);
    await slice.openProject(a.id);
    await slice.deleteProject(b.id);
    expect(useAppStore.getState().currentProjectId).toBe(a.id);
    expect(useAppStore.getState().dirty).toBe(false);
  });
});

describe('importProject', () => {
  test('new id: stored, then opened through the Open path', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    useAppStore.setState({ selectedVibeId: 'lofi-chill' });
    const file = stored('Imported', 55);
    const result = await slice.importProject(file, 'new');
    expect(result.ok).toBe(true);
    expect(backend.bodies.has(file.id)).toBe(true);
    const s = useAppStore.getState();
    expect(s.bpm).toBe(55);
    expect(s.selectedVibeId).toBeNull();
    expect(s.currentProjectId).toBe(file.id);
  });

  test('overwrite replaces the stored record with the file', async () => {
    const existing = stored('Old', 50);
    const { backend, slice } = await sliceWithBackend([existing]);
    const file = { ...existing, name: 'From File', updatedAt: 9_000, content: { ...existing.content, bpm: 51 } };
    await slice.importProject(file, 'overwrite');
    expect(backend.bodies.get(existing.id)?.content.bpm).toBe(51);
    expect(backend.bodies.get(existing.id)?.name).toBe('From File');
  });

  test('copy mints a new id, appends " (imported)" and leaves the existing record alone', async () => {
    const existing = stored('Twin', 50);
    const { useAppStore, backend, slice } = await sliceWithBackend([existing]);
    const result = await slice.importProject({ ...existing, content: { ...existing.content, bpm: 52 } }, 'copy');
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) return;
    expect(result.value.id).not.toBe(existing.id);
    expect(result.value.name).toBe('Twin (imported)');
    expect(backend.bodies.get(existing.id)?.content.bpm).toBe(50);
    expect(useAppStore.getState().currentProjectId).toBe(result.value.id);
  });

  test('with storage unavailable the file still opens, with no current project', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const store = createProjectStore(async () => { throw new Error('blocked'); });
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, store, () => 5_000);
    useAppStore.setState({ ...slice, currentProjectId: 'stale' });
    const result = await useAppStore.getState().importProject(stored('Loose', 44), 'new');
    expect(result.ok).toBe(true);
    const s = useAppStore.getState();
    expect(s.bpm).toBe(44);
    expect(s.currentProjectId).toBeNull();
    expect(s.projectBaselineHash).toBeNull();
    // Stored nowhere and different from the default project: unsaved work.
    expect(s.dirty).toBe(true);
    expect(s.projectStoreStatus).toBe('unavailable');
  });
});

describe('export', () => {
  test('exportStoredProject returns the saved snapshot, not live state', async () => {
    const p = stored('Snap', 40);
    const { useAppStore, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    useAppStore.setState({ bpm: 41 });
    const result = await slice.exportStoredProject(p.id);
    expect(result.ok && result.value.content.bpm).toBe(40);
  });

  test('buildSessionExport returns live state with the current identity and does not touch dirty', async () => {
    const p = stored('Live', 40);
    const { useAppStore, slice } = await sliceWithBackend([p]);
    await slice.openProject(p.id);
    useAppStore.setState({ bpm: 41, dirty: true });
    const body = useAppStore.getState().buildSessionExport('ignored when current', 7_000);
    expect(body.id).toBe(p.id);
    expect(body.name).toBe('Live');
    expect(body.createdAt).toBe(1_000);
    expect(body.updatedAt).toBe(7_000);
    expect(body.content.bpm).toBe(41);
    expect(useAppStore.getState().dirty).toBe(true);
  });

  test('buildSessionExport with no current project mints a fresh id and uses the given name', async () => {
    const { useAppStore } = await sliceWithBackend();
    const body = useAppStore.getState().buildSessionExport('Loose Session', 7_000);
    expect(body.id.startsWith('project-')).toBe(true);
    expect(body.name).toBe('Loose Session');
    expect(body.createdAt).toBe(7_000);
    expect(body.updatedAt).toBe(7_000);
  });
});

describe('refreshProjects', () => {
  test('resolves the current name from the list, and a stale id becomes an unsaved session', async () => {
    const p = stored('Named', 30);
    const { useAppStore, slice } = await sliceWithBackend([p]);
    useAppStore.setState({ currentProjectId: p.id, currentProjectName: null });
    await slice.refreshProjects();
    expect(useAppStore.getState().currentProjectName).toBe('Named');
    expect(useAppStore.getState().projectStoreStatus).toBe('ready');
    useAppStore.setState({ currentProjectId: 'stale-id', projectBaselineHash: 'stale-hash' });
    await slice.refreshProjects();
    expect(useAppStore.getState().currentProjectId).toBeNull();
    // The baseline goes with the id: a hash for a project that is gone can
    // never be matched again, so the session must fall back to the untitled
    // rule rather than staying permanently dirty against a dead baseline.
    expect(useAppStore.getState().projectBaselineHash).toBeNull();
  });
});

/**
 * The seam the slice actually runs on in the app: store.ts hands every slice a
 * `set` wrapped by createLoopMirroringSet, not the raw setState the tests
 * above use. install() writes `loops` AND the flat per-loop keys in one set(),
 * and the incoming loops[0].id can equal the CURRENT activeLoopId (both the
 * default id, the common case for a project saved from a fresh session) — so
 * the mirror sees no activeLoopId move and does have flat keys to mirror. It
 * must not rewrite the incoming array with the OLD project's sound.
 */
describe('openProject through the loop-mirroring set', () => {
  test('installs the incoming loops array verbatim when loops[0].id equals the current activeLoopId', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const { createLoopMirroringSet } = await import('./loopSync');

    const incoming: ProjectBody = {
      ...makeEnvelope('Mirrored', 1_000),
      content: {
        ...factoryProjectContent(),
        bpm: 143,
        loops: [{ ...createDefaultLoop(), id: DEFAULT_LOOP_ID, scaleRoot: 'D', scaleType: 'Dorian', bassOctave: 3 }],
      },
    };
    const store = createProjectStore(async () => createMemoryBackend([incoming]));
    const mirroringSet = createLoopMirroringSet(useAppStore.setState, useAppStore.getState);
    const slice = createProjectSlice(mirroringSet, useAppStore.getState, store, () => 5_000);
    // The pre-open session is on the SAME loop id, with a different sound.
    useAppStore.setState({
      ...slice,
      activeLoopId: DEFAULT_LOOP_ID,
      loops: [{ ...createDefaultLoop(), scaleRoot: 'A', scaleType: 'Natural Minor', bassOctave: 2 }],
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
      bassOctave: 2,
    });

    const result = await (useAppStore.getState() as AppStore).openProject(incoming.id);
    expect(result.ok).toBe(true);
    const s = useAppStore.getState();
    expect(s.bpm).toBe(143);
    expect(s.loops).toHaveLength(1);
    for (const key of LOOP_FLAT_KEYS) {
      expect(s.loops[0][key]).toEqual(incoming.content.loops[0][key]);
      expect(s[key]).toEqual(incoming.content.loops[0][key]);
    }
  });
});
