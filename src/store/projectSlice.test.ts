import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '../audio/engine';
import { setOperationFailureSink } from '@/incidents/operationFailure';
import { createMemoryBackend, createProjectStore } from './projectStore';
import { UNTITLED_SOURCE, type ProjectSlotRecord } from './projectSource';
import { parseProjectFile, unknownLibraryReferences } from './projectFile';
import { buildProjectContent, factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
import { DEFAULT_LOOP_ID, createDefaultLoop } from './loopSlice';
import { LOOP_FLAT_KEYS } from './loop';
import { MAX_STEPS_PER_BAR } from '../utils/timeSignature';
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

// bun runs every file in one process; a leaked `window` crashes axe-core (jsx-a11y) later.
afterAll(() => { Reflect.deleteProperty(globalThis, 'window'); });

/** A fresh slice bound to the live store but to ITS OWN memory backend. */
async function sliceWithBackend(seed?: ProjectBody | ProjectSlotRecord) {
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
    // Boot resumed the same loop, so the vibe it was loaded from stays marked.
    expect(s.selectedVibeId).toBe('cyber-dance');
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
  // sanitizeContent has already resolved an unknown Beat preset id to `null`
  // before this slice ever sees the body. The notice stays live on the
  // openProjectFile path below, which receives the body directly. Whether
  // sanitizeContent should keep library ids verbatim (as the spec's "Library
  // provenance" bullet states) is a sanitize.ts question, not this slice's.
  test('a stored body naming an unknown Beat preset still loads, with the reference already resolved', async () => {
    const p = stored('Alpha', 77);
    p.content.loops[0].beatParams.basePresetId = 'nonexistent-preset';
    const { useAppStore, slice } = await sliceWithBackend(p);
    await slice.loadProject();
    const s = useAppStore.getState();
    expect(s.bpm).toBe(77);
    // The PATCH is kept and only its unresolvable base is dropped — the
    // sanitizer's rule for a stored patch whose origin is gone.
    expect(s.loops[0].beatParams.basePresetId).toBeNull();
    expect(s.loops[0].beatParams.voices.kick).toEqual(p.content.loops[0].beatParams.voices.kick);
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

/** Boot resumes the session, so the Current mark (selectedVibeId) comes back with its loop. */
describe('loadProject (boot) — the vibe the loop came from', () => {
  test('the resumed loop keeps the vibe it was loaded from (the Current mark survives a reload)', async () => {
    const { useAppStore, slice } = await sliceWithBackend(stored('Vibe', 84));
    useAppStore.setState({ activeLoopId: 'loop-Vibe', selectedVibeId: 'lofi-chill' });
    await slice.loadProject();
    expect(useAppStore.getState().selectedVibeId).toBe('lofi-chill');
  });

  test('a persisted vibe whose loop is not the one resumed is dropped', async () => {
    const { useAppStore, slice } = await sliceWithBackend(stored('Vibe', 84));
    useAppStore.setState({ activeLoopId: 'loop-from-a-previous-project', selectedVibeId: 'lofi-chill' });
    await slice.loadProject();
    expect(useAppStore.getState().activeLoopId).toBe('loop-Vibe');
    expect(useAppStore.getState().selectedVibeId).toBeNull();
  });
});

// Split out of the boot describe above: it is the same install, but the four
// custom-pattern keys reach BOTH homes at once — the flat slices the engine
// reads and the loop those slices mirror — which is worth its own failure name
// when the mirroring set's generic key list ever stops carrying one of them.
/**
 * What boot SAYS about the body it just installed. Separate from the install
 * describe above because the notice has one rule of its own: the read's
 * warnings and the body's unresolved references are one sentence, and silence
 * means the project came back whole.
 */
describe('loadProject (boot) — the notice', () => {
  // The defect this pins: the slot read sanitised with no warnings while
  // opening a `.solna` had just learned to warn — so on the first boot after a
  // patch shape change, every track came back at its factory default and the
  // app said nothing. This is the path every session takes.
  test('a stored body whose synth patch cannot be read says so in the boot notice', async () => {
    const p = stored('Stale Sound', 100);
    (p.content.loops[0] as unknown as Record<string, unknown>).synthParams = { engine: 'nope', patch: 7 };
    const { useAppStore, slice } = await sliceWithBackend(p);
    await slice.loadProject();

    // It still loads — the notice is the only signal, never a refusal.
    expect(useAppStore.getState().bpm).toBe(100);
    expect(useAppStore.getState().projectNotice ?? '').toContain('Lead sound (reset to the default)');
  });

  test('a stored body every track of which reads fine leaves the notice empty', async () => {
    const { useAppStore, slice } = await sliceWithBackend(stored('Fine', 101));
    await slice.loadProject();
    expect(useAppStore.getState().projectNotice).toBeNull();
  });
});

describe('loadProject (boot) — the custom pattern spans', () => {
  test('install into loops[] and the flat slices together', async () => {
    const values = new Array<boolean>(MAX_STEPS_PER_BAR * 2).fill(false);
    values[0] = true;
    const holds = new Array<number>(MAX_STEPS_PER_BAR * 2).fill(1);
    holds[0] = 3;
    const p = stored('Spans', 110);
    p.content.loops = [
      {
        ...createDefaultLoop(),
        id: DEFAULT_LOOP_ID,
        customChordLoopLength: 2,
        customChordRhythm: values,
        customChordHoldSteps: holds,
        customBassLoopLength: 2,
      },
    ];

    const { useAppStore, slice } = await sliceWithBackend(p);
    await slice.loadProject();

    const s = useAppStore.getState();
    // Into the flat slices the engine reads...
    expect(s.customChordLoopLength).toBe(2);
    expect(s.customChordRhythm).toHaveLength(MAX_STEPS_PER_BAR * 2);
    expect(s.customChordHoldSteps[0]).toBe(3);
    expect(s.customBassLoopLength).toBe(2);
    expect(s.customBassHoldSteps).toHaveLength(MAX_STEPS_PER_BAR * 2);
    // ...and into the loop those slices mirror, in the same install.
    expect(s.loops[0].customChordLoopLength).toBe(2);
    expect(s.loops[0].customChordHoldSteps[0]).toBe(3);
    expect(s.loops[0].customBassLoopLength).toBe(2);
  });
});

describe('save (autosave write)', () => {
  test('writes the live content under the current envelope and publishes status', async () => {
    const { useAppStore, store, slice } = await sliceWithBackend();
    useAppStore.setState({ bpm: 155 });
    const result = await slice.save();
    expect(result.ok).toBe(true);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.body.content.bpm).toBe(155);
    expect(loaded.ok && loaded.value.body.name).toBe('');
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
    const { useAppStore, store, slice } = await sliceWithBackend(p);
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
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.body.content.bpm).toBe(120);
  });
});

describe('projectInstallCount', () => {
  // A session-only identity for "the project was replaced", which is what a
  // pending loop-delete Undo must be dismissed on: loop ids collide across
  // projects (every fresh project's first loop is `loop-default-1`), so the
  // id check restoreLoop makes cannot tell two projects apart.
  test('every install bumps it, whatever the content', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    const before = useAppStore.getState().projectInstallCount;
    useAppStore.getState().newProject();
    useAppStore.getState().newProject();
    expect(useAppStore.getState().projectInstallCount).toBe(before + 2);
    await slice.openProjectFile(stored('From Disk', 99));
    expect(useAppStore.getState().projectInstallCount).toBe(before + 3);
  });
});

describe('openProjectFile', () => {
  test('adopts the file’s envelope, installs its content and becomes the autosaved project', async () => {
    const { useAppStore, store, slice } = await sliceWithBackend();
    const file = stored('From Disk', 99);
    const result = await slice.openProjectFile(file);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.body.name).toBe('From Disk');
    expect(useAppStore.getState().projectName).toBe('From Disk');
    expect(useAppStore.getState().bpm).toBe(99);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.body.id).toBe(file.id);
  });

  test('an opened file has no vibe, even when its first loop id matches the one in focus', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    useAppStore.setState({ activeLoopId: 'loop-From Disk', selectedVibeId: 'lofi-chill' });
    await slice.openProjectFile(stored('From Disk', 99));
    expect(useAppStore.getState().activeLoopId).toBe('loop-From Disk');
    expect(useAppStore.getState().selectedVibeId).toBeNull();
  });

  // DEFENSIVE CONTRACT — no production caller reaches this. Both readers run
  // `sanitizeContent` before the slice ever sees a body, and `sanitizeLoops`
  // substitutes an unknown `chordRhythmId`/`bassPatternId` with its
  // library fallback, so `unknownLibraryReferences` is empty on every real path
  // and the notice never fires (the spec's "Library provenance" bullet says so).
  // This test hands the slice a RAW, unsanitized body to pin the guard the slice
  // still keeps against such a caller; it asserts a contract, not a behaviour a
  // user can observe. The substitute-and-continue path is what production does.
  test('guards a raw unsanitized body — a notice production cannot produce', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    const file = stored('From Disk', 99);
    file.content.loops[0].chordRhythmId = 'cr-nonexistent';
    await slice.openProjectFile(file);
    const notice = useAppStore.getState().projectNotice ?? '';
    expect(notice).toContain('unrecognised references');
    expect(notice).toContain('chord rhythm "cr-nonexistent"');
  });

  test('a loop based on a SAVED USER preset keeps its base across a slot reload', async () => {
    // The local slot is read on the same machine whose library the base names,
    // so the library travels into the read. Without that, a user preset id is
    // indistinguishable from a dangling one and the loop comes back reading
    // `Custom patch` for a preset the user still has.
    const { useAppStore } = await storeModule;
    const saved = useAppStore.getState().saveCustomBeatPreset('Mine', useAppStore.getState().beatParams);
    const body = stored('With User Beat', 101);
    body.content.loops[0] = {
      ...body.content.loops[0],
      beatParams: { ...body.content.loops[0].beatParams, basePresetId: saved.id },
    };

    const { slice } = await sliceWithBackend(body);
    await slice.loadProject();

    const loop = useAppStore.getState().loops[0];
    expect(loop.beatParams.basePresetId).toBe(saved.id);
    expect(useAppStore.getState().beatParams.basePresetId).toBe(saved.id);

    // ...and the SAME body arriving as a .solna import gets factory ids only,
    // so the identical base reads back as unresolvable with the patch intact.
    const imported = parseProjectFile(JSON.stringify(body));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.body.content.loops[0].beatParams.basePresetId).toBeNull();
    expect(imported.body.content.loops[0].beatParams.voices).toEqual(loop.beatParams.voices);

    useAppStore.getState().deleteCustomBeatPreset(saved.id);
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
    file.content.loops[0].chordRhythmId = 'cr-nonexistent';
    await slice.openProjectFile(file);
    const notice = useAppStore.getState().projectNotice ?? '';
    expect(notice).toContain('storage is unavailable');
    expect(notice).toContain('unrecognised references');
    expect(notice).toContain('chord rhythm "cr-nonexistent"');
  });

  // The defect this pins: parseProjectFile computes a warning set for an
  // incompatible synth patch reset to its track default, and both callers
  // (ProjectMenu's local open, driveSlice's Drive open) used to discard it
  // rather than pass it here — this is the one place both routes install a
  // body, so it is the seam that must carry it through.
  test('importWarnings from the parser reach the same notice unresolved references do', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    const file = stored('From Disk', 99);
    await slice.openProjectFile(file, undefined, ['Lead sound (reset to the default)']);
    const notice = useAppStore.getState().projectNotice ?? '';
    expect(notice).toContain('unrecognised references');
    expect(notice).toContain('Lead sound (reset to the default)');
  });

  test('importWarnings and a failed save both reach the notice, without erasing each other', async () => {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const failed = createProjectStore(async () => { throw new Error('blocked'); });
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, failed, () => 5_000);
    useAppStore.setState({ ...slice, projectName: null });
    await slice.openProjectFile(stored('From Disk', 99), undefined, ['Bass sound (reset to the default)']);
    const notice = useAppStore.getState().projectNotice ?? '';
    expect(notice).toContain('storage is unavailable');
    expect(notice).toContain('unrecognised references');
    expect(notice).toContain('Bass sound (reset to the default)');
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

describe('the project source', () => {
  test('a stored record restores its source, so Save still knows where it writes', async () => {
    const record: ProjectSlotRecord = { body: stored('Resume', 110), source: { kind: 'drive', fileId: 'drive-1' } };
    const { useAppStore, slice } = await sliceWithBackend(record);
    await slice.loadProject();
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-1' });
  });

  test('an empty slot leaves the source untitled', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    await slice.loadProject();
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('a local handle survives the slot round-trip and comes back as the source', async () => {
    const handle = { name: 'sketch.solna', kind: 'file' } as unknown as FileSystemFileHandle;
    const record: ProjectSlotRecord = { body: stored('Resume', 110), source: { kind: 'local', handle } };
    const { useAppStore, slice } = await sliceWithBackend(record);
    await slice.loadProject();
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'local', handle });
  });

  test('openProjectFile adopts the source it was opened from', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    await slice.openProjectFile(stored('FromDrive', 100), { kind: 'drive', fileId: 'drive-9' });
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-9' });
  });

  test('a file picker open is untitled — a File is read-only, so Save must ask where to write', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    await slice.openProjectFile(stored('Picked', 100));
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('newProject drops the source: a new project belongs to no file', async () => {
    const record: ProjectSlotRecord = { body: stored('Old', 100), source: { kind: 'drive', fileId: 'drive-1' } };
    const { useAppStore, slice } = await sliceWithBackend(record);
    await slice.loadProject();
    slice.newProject();
    expect(useAppStore.getState().projectSource).toEqual(UNTITLED_SOURCE);
  });

  test('the autosave writes the current source into the record and never changes it', async () => {
    const { useAppStore, store, slice } = await sliceWithBackend();
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-1' } });
    const result = await slice.save();
    expect(result.ok).toBe(true);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual({ kind: 'drive', fileId: 'drive-1' });
    expect(useAppStore.getState().projectSource).toEqual({ kind: 'drive', fileId: 'drive-1' });
  });

  test('the source is nowhere in the exported body — it does not travel in the file', async () => {
    const { useAppStore, slice } = await sliceWithBackend();
    useAppStore.setState({ projectSource: { kind: 'drive', fileId: 'drive-1' } });
    const serialised = JSON.stringify(slice.exportProjectFile());
    expect(serialised).not.toContain('drive-1');
    // The KEY, not the bare word: a patch legitimately carries
    // `sourcePresetId` (display provenance), so a substring check on
    // 'source' would now pass or fail for reasons that have nothing to do
    // with where the project came from.
    expect(serialised).not.toContain('"source"');
    expect(serialised).not.toContain('projectSource');
  });
});

describe('operation failure reporting', () => {
  async function sliceWith(backend: ReturnType<typeof createMemoryBackend>) {
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const store = createProjectStore(async () => backend);
    const slice = createProjectSlice(useAppStore.setState, useAppStore.getState, store, () => 5_000);
    useAppStore.setState({ ...slice, projectName: null });
    return useAppStore.getState() as AppStore;
  }
  afterEach(() => setOperationFailureSink(null));

  test('a generic storage failure on load and on save is reported, with the notice kept', async () => {
    const incidents: string[] = [];
    setOperationFailureSink((input) => incidents.push(input.summary));
    const backend = createMemoryBackend();
    backend.getRecord = async () => { throw new Error('idb exploded'); };
    backend.putRecord = async () => { throw new Error('idb exploded'); };
    const slice = await sliceWith(backend);
    await slice.loadProject();
    await slice.save();
    expect(incidents).toContain('Unexpected failure during project-load');
    expect(incidents).toContain('Unexpected failure during project-save');
    const { useAppStore } = await storeModule;
    expect(useAppStore.getState().projectNotice).not.toBeNull();
  });

  test('quota, unavailable storage and an empty slot are not reported', async () => {
    const incidents: string[] = [];
    setOperationFailureSink((input) => incidents.push(input.summary));
    const quota = createMemoryBackend();
    quota.putRecord = async () => {
      const error = new Error('full');
      error.name = 'QuotaExceededError';
      throw error;
    };
    const slice = await sliceWith(quota);
    await slice.loadProject();
    await slice.save();
    const { useAppStore } = await storeModule;
    const { createProjectSlice } = await import('./projectSlice');
    const unavailable = createProjectStore(async () => { throw new Error('blocked'); });
    const blocked = createProjectSlice(useAppStore.setState, useAppStore.getState, unavailable, () => 5_000);
    await blocked.loadProject();
    expect(incidents).toEqual([]);
  });
});
