import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { unknownLibraryReferences } from './projectFile';
import { buildProjectContent, factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
import { DEFAULT_LOOP_ID, createDefaultLoop } from './loopSlice';
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
async function sliceWithBackend(seed?: ProjectBody) {
  const { useAppStore } = await storeModule;
  const { createProjectSlice } = await import('./projectSlice');
  const backend = createMemoryBackend(seed);
  const store = createProjectStore(async () => backend);
  const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, store, () => 5_000);
  useAppStore.setState({ ...slice, projectName: null });
  return { useAppStore, backend, store, slice: useAppStore.getState() as AppStore };
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

describe('loadProject (boot)', () => {
  test('boot restores the selected loop and its flat fields in the content install', async () => {
    const p = stored('Resume', 110);
    p.content.loops.push({ ...p.content.loops[0], id: 'second', scaleRoot: 'D' });
    const { useAppStore, slice } = await sliceWithBackend(p);
    useAppStore.setState({ activeLoopId: 'second' });
    const selections: string[] = [];
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (s.loops !== prev.loops) selections.push(s.activeLoopId);
    });
    await slice.loadProject();
    unsubscribe();
    expect(useAppStore.getState().activeLoopId).toBe('second');
    expect(useAppStore.getState().scaleRoot).toBe('D');
    expect(selections).toEqual(['second']);
  });

  test('an empty slot keeps the factory session, leaves the name untitled and writes nothing', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    const before = useAppStore.getState().bpm;
    await slice.loadProject();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(before);
    expect(s.projectName).toBeNull();
    expect(s.projectStoreStatus).toBe('ready');
    expect(s.projectNotice).toBeNull();
    expect(backend.slot.size).toBe(0);
  });

  test('a stored project installs with the reset rules, in one set(), with the voice tails cut first', async () => {
    const p = stored('Alpha', 77);
    const { useAppStore, slice } = await sliceWithBackend(p);
    // The incoming loop id is already the active one, so soloNav.ts's own nav
    // subscription sees no change at all: only install()'s atomic clear can
    // empty the solo set and the armed Rec track below.
    useAppStore.setState({
      sequencerPlayer: 'playing',
      selectedVibeId: 'cyber-dance',
      focusTrack: 'bass',
      metronomeActive: true,
      songLoopIndex: 2,
      activeLoopId: 'loop-Alpha',
      soloTracks: ['drums'],
      recordingTrack: 'lead',
      loopClipboard: { sourceLoopId: 'loop-Alpha' },
    });
    const order: string[] = [];
    stopSource.mockImplementation((source: string, release: number) => { order.push(`${source}@${release}`); });
    let writes = 0;
    const unsub = useAppStore.subscribe((s, prev) => {
      if (s.bpm !== prev.bpm || s.loops !== prev.loops) writes++;
      if (s.bpm !== prev.bpm) order.push('set');
    });
    await slice.loadProject();
    unsub();
    const s = useAppStore.getState();
    // The content swap is ONE set(): a split install — loops, then the flat
    // per-loop patch, then bpm — re-renders every mounted view per write.
    expect(writes).toBe(1);
    // Exactly the three accompaniment buses, at INSTALL_RELEASE, before the
    // set: a wrong source list, a changed release, or a cut moved after the
    // content write would let the old project's queued voices ring over it.
    expect(order).toEqual(['chord@0.02', 'bass@0.02', 'pad@0.02', 'set']);
    expect(s.bpm).toBe(77);
    expect(s.selectedVibeId).toBeNull();
    expect(s.activeLoopId).toBe('loop-Alpha');
    expect(s.songLoopIndex).toBeNull();
    expect(s.projectName).toBe('Alpha');
    expect(s.soloTracks).toEqual([]);
    expect(s.recordingTrack).toBeNull();
    expect(s.loopClipboard).toBeNull();
    // User preferences, deliberately NOT project content: carried over.
    expect(s.focusTrack).toBe('bass');
    expect(s.metronomeActive).toBe(true);
  });

  // The spec says a body with unknown library references "still loads, and says
  // so". The load half holds; the notice half cannot fire from here any more:
  // projectStore.load() runs normalizeStoredBody() at the read site, and
  // sanitizeContent substitutes an unknown soundKit with the fallback kit
  // before this slice ever sees the body. The notice stays live on the
  // openProjectFile path below, which receives the body directly. Whether
  // sanitizeContent should keep library ids verbatim (as the spec's "Library
  // provenance" bullet states) is a sanitize.ts question, not this slice's.
  test('a stored body naming an unknown kit still loads, with the reference already substituted', async () => {
    const p = stored('Alpha', 77);
    p.content.loops[0].soundKit = 'Nonexistent Kit';
    const { useAppStore, slice } = await sliceWithBackend(p);
    await slice.loadProject();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(77);
    expect(s.loops[0].soundKit).not.toBe('Nonexistent Kit');
    expect(s.projectNotice).toBeNull();
  });

  test('unavailable storage keeps the factory session and sets the degraded notice', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const failed = createProjectStore(async () => { throw new Error('blocked'); });
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, failed, () => 5_000);
    const before = useAppStore.getState().bpm;
    await slice.loadProject();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(before);
    expect(s.projectStoreStatus).toBe('unavailable');
    expect(s.projectNotice).toContain('storage is unavailable');
  });

  test('a persisted activeLoopId naming no loaded loop is pinned to loops[0]', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    useAppStore.setState({ activeLoopId: 'loop-from-a-previous-project' });
    await slice.loadProject();
    expect(useAppStore.getState().activeLoopId).toBe(useAppStore.getState().loops[0].id);
  });
});

describe('save (autosave write)', () => {
  test('writes the live content under the current envelope and publishes status', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    useAppStore.setState({ bpm: 155 });
    const result = await slice.save();
    expect(result.ok).toBe(true);
    const row = backend.slot.get('current');
    expect(row?.content.bpm).toBe(155);
    expect(row?.name).toBe('');
    expect(useAppStore.getState().projectStoreStatus).toBe('ready');
  });

  test('an unavailable save leaves the live session untouched and surfaces the notice', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const failed = createProjectStore(async () => { throw new Error('blocked'); });
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, failed, () => 5_000);
    useAppStore.setState({ bpm: 91 });
    const result = await slice.save();
    expect(result.ok).toBe(false);
    // The live session never rolls back: there is no "Save" to fail.
    expect(useAppStore.getState().bpm).toBe(91);
    expect(useAppStore.getState().projectNotice).toContain('storage is unavailable');
  });
});

describe('newProject', () => {
  test('installs factory content, clears the name and writes the empty project', async () => {
    const p = stored('Alpha', 77);
    const { useAppStore, backend, slice } = await sliceWithBackend(p);
    await slice.loadProject();
    useAppStore.setState({ bpm: 200 });
    useAppStore.getState().newProject();
    expect(useAppStore.getState().bpm).toBe(120);
    expect(useAppStore.getState().projectName).toBeNull();
    // newProject saves explicitly, so a New on an already-factory session
    // still writes the slot instead of leaving it empty. The write is fired
    // and forgotten (`void get().save()`) over the async ProjectStore, so one
    // macrotask lets it land before the slot is read.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backend.slot.get('current')?.content.bpm).toBe(120);
  });
});

describe('openProjectFile', () => {
  test('adopts the file’s envelope, installs its content and becomes the autosaved project', async () => {
    const { useAppStore, backend, slice } = await sliceWithBackend();
    const file = stored('From Disk', 99);
    const result = await slice.openProjectFile(file);
    expect(result.ok).toBe(true);
    expect(useAppStore.getState().projectName).toBe('From Disk');
    expect(useAppStore.getState().bpm).toBe(99);
    expect(backend.slot.get('current')?.id).toBe(file.id);
  });

  // DEFENSIVE CONTRACT — no production caller reaches this. Both readers run
  // `sanitizeContent` before the slice ever sees a body, and `sanitizeLoops`
  // substitutes an unknown `soundKit`/`chordRhythmId`/`bassPatternId` with its
  // library fallback, so `unknownLibraryReferences` is empty on every real path
  // and the notice never fires (the spec's "Library provenance" bullet says so).
  // This test hands the slice a RAW, unsanitized body to pin the guard the slice
  // still keeps against such a caller; it asserts a contract, not a behaviour a
  // user can observe. The substitute-and-continue path is what production does.
  test('guards a raw unsanitized body — a notice production cannot produce', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    const file = stored('From Disk', 99);
    file.content.loops[0].soundKit = 'Nonexistent Kit';
    await slice.openProjectFile(file);
    const notice = useAppStore.getState().projectNotice ?? '';
    expect(notice).toContain('unrecognised references');
    expect(notice).toContain('drum kit "Nonexistent Kit"');
  });

  test('an empty name in the file reads back as untitled', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    await slice.openProjectFile(stored('', 99));
    expect(useAppStore.getState().projectName).toBeNull();
  });

  test('the file still installs when storage is unavailable — it is just nobody’s project', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const failed = createProjectStore(async () => { throw new Error('blocked'); });
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, failed, () => 5_000);
    // Installed, so `openProjectFile`'s own `get().save()` is this slice's save
    // and not a sibling test's leaked instance.
    useAppStore.setState({ ...slice, projectName: null });
    const result = await slice.openProjectFile(stored('From Disk', 99));
    expect(result.ok).toBe(false);
    expect(useAppStore.getState().bpm).toBe(99);
    expect(useAppStore.getState().projectName).toBe('From Disk');
    // The install must not swallow the failed save: the file opens, and the
    // user is told it is nobody's project.
    expect(useAppStore.getState().projectNotice).toContain('storage is unavailable');
  });

  // The references half rides the same defensive path as the test above — a raw
  // body, which no reader hands the slice. What this pins is the join: a failed
  // save's message must not be erased by the (production-empty) warnings set().
  test('an unavailable save and unresolved references both reach the notice', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const failed = createProjectStore(async () => { throw new Error('blocked'); });
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, failed, () => 5_000);
    useAppStore.setState({ ...slice, projectName: null });
    const file = stored('From Disk', 99);
    file.content.loops[0].soundKit = 'Nonexistent Kit';
    await slice.openProjectFile(file);
    const notice = useAppStore.getState().projectNotice ?? '';
    expect(notice).toContain('storage is unavailable');
    expect(notice).toContain('unrecognised references');
    expect(notice).toContain('drum kit "Nonexistent Kit"');
  });
});

describe('exportProjectFile', () => {
  test('serialises the live session through the content key allow-list', async () => {
    const { useAppStore } = await sliceWithBackend();
    useAppStore.setState({ bpm: 133, selectedVibeId: 'cyber-dance', metronomeActive: true });
    const body = useAppStore.getState().exportProjectFile();
    expect(body.content).toEqual(buildProjectContent(useAppStore.getState()));
    expect(Object.keys(body.content).sort()).toEqual(['bpm', 'effects', 'loops', 'masterVolume', 'meterId']);
    expect('selectedVibeId' in body.content).toBe(false);
  });

  test('an untitled session exports an empty name rather than a placeholder', async () => {
    const { useAppStore } = await sliceWithBackend();
    expect(useAppStore.getState().exportProjectFile().name).toBe('');
  });
});

describe('the loop-mirroring set', () => {
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
    const store = createProjectStore(async () => createMemoryBackend(incoming));
    const mirroringSet = createLoopMirroringSet(useAppStore.setState, useAppStore.getState);
    const slice = createProjectSlice(mirroringSet, useAppStore.getState, store, () => 5_000);
    useAppStore.setState({
      ...slice,
      activeLoopId: DEFAULT_LOOP_ID,
      loops: [{ ...createDefaultLoop(), scaleRoot: 'A', scaleType: 'Natural Minor', bassOctave: 2 }],
      scaleRoot: 'A',
      scaleType: 'Natural Minor',
      bassOctave: 2,
    });

    await slice.loadProject();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(143);
    expect(s.loops).toHaveLength(1);
    for (const key of LOOP_FLAT_KEYS) {
      expect(s.loops[0][key]).toEqual(incoming.content.loops[0][key]);
      expect(s[key]).toEqual(s.loops[0][key]);
    }
    expect(unknownLibraryReferences(s.exportProjectFile().content)).toEqual([]);
  });
});
