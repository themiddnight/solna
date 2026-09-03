import { describe, expect, test } from 'bun:test';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { WriteScheduler } from '../utils/coalescedStorage';
import { createDirtyTracker } from './projectDirty';
import { PROJECT_CONTENT_KEYS, buildProjectContent, factoryProjectContent } from './projectFormat';
import { fingerprintContent } from './projectFingerprint';
import { createDefaultLoop } from './loopSlice';
import type { AppStore } from './types';

/** A scheduler the test drives by hand — the coalescedStorage.test.ts pattern. */
function manualScheduler() {
  const queued = new Map<number, () => void>();
  let next = 1;
  const scheduler: WriteScheduler = {
    schedule: (flush) => { const h = next++; queued.set(h, flush); return h; },
    cancel: (h) => { queued.delete(h); },
  };
  const run = () => { const jobs = [...queued.values()]; queued.clear(); jobs.forEach((j) => j()); };
  return { scheduler, run, size: () => queued.size };
}

/** A minimal store carrying only what the tracker reads and writes. */
function makeStore(identity: { currentProjectId: string | null; projectBaselineHash: string | null }) {
  const content = factoryProjectContent();
  return create<Partial<AppStore>>()(
    subscribeWithSelector(() => ({
      ...content,
      controlTarget: 'synth',
      selectedVibeId: null,
      dirty: false,
      ...identity,
    })),
  ) as unknown as Parameters<typeof createDirtyTracker>[0];
}

const SAVED = { currentProjectId: 'p-1', projectBaselineHash: fingerprintContent(factoryProjectContent()) };
const UNTITLED = { currentProjectId: null, projectBaselineHash: null };

/**
 * Drift guard for the hand-maintained ContentRefs tuple inside the tracker.
 * PROJECT_CONTENT_KEYS is the content set; a key added there but forgotten in
 * the tuple would silently stop dirtying the session — the failure mode is a
 * user losing work to an Open that never raised the guard, which no other test
 * would notice. One changed value per key, each distinct from the factory one.
 */
describe('every PROJECT_CONTENT_KEYS key schedules a pass', () => {
  const changed: Record<(typeof PROJECT_CONTENT_KEYS)[number], unknown> = {
    bpm: 137,
    meterId: '3/4',
    masterVolume: 0.42,
    effects: { ...factoryProjectContent().effects, reverbWet: 0.9 },
    loops: [{ ...createDefaultLoop(), id: 'other' }],
  };

  for (const key of PROJECT_CONTENT_KEYS) {
    test(`${key}`, () => {
      const store = makeStore(SAVED);
      const sched = manualScheduler();
      createDirtyTracker(store, { scheduler: sched.scheduler });
      store.setState({ [key]: changed[key] } as never);
      expect(`${key}: ${sched.size()}`).toBe(`${key}: 1`);
      sched.run();
      expect(`${key}: ${store.getState().dirty}`).toBe(`${key}: true`);
    });
  }
});

describe('createDirtyTracker', () => {
  test('N content writes inside one idle window cost exactly ONE fingerprint computation', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    let computations = 0;
    createDirtyTracker(store, { scheduler: sched.scheduler, fingerprint: (c) => { computations++; return fingerprintContent(c); } });
    for (let i = 0; i < 50; i++) store.setState({ bpm: 100 + i });
    expect(computations).toBe(0);
    expect(sched.size()).toBe(1);
    sched.run();
    expect(computations).toBe(1);
    expect(store.getState().dirty).toBe(true);
  });

  test('excluded keys never schedule a pass', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ controlTarget: 'bass', selectedVibeId: 'cyber-dance' });
    expect(sched.size()).toBe(0);
    expect(store.getState().dirty).toBe(false);
  });

  test('a change that lands back on the baseline stays clean', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ bpm: 121 });
    store.setState({ bpm: 120 });
    sched.run();
    expect(store.getState().dirty).toBe(false);
  });

  test('once dirty, further writes schedule nothing until a new baseline is taken', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ bpm: 121 });
    sched.run();
    expect(store.getState().dirty).toBe(true);
    store.setState({ bpm: 122 });
    expect(sched.size()).toBe(0);
    // A save takes a fresh baseline and clears dirty; tracking resumes.
    store.setState({ projectBaselineHash: fingerprintContent(buildProjectContent(store.getState() as AppStore)), dirty: false });
    store.setState({ bpm: 123 });
    expect(sched.size()).toBe(1);
  });

  test('a fresh default untitled session is not dirty, and no baseline is ever seeded', () => {
    const store = makeStore(UNTITLED);
    const sched = manualScheduler();
    const tracker = createDirtyTracker(store, { scheduler: sched.scheduler });
    tracker.runNow();
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().projectBaselineHash).toBeNull();
  });

  test('an untitled session becomes dirty on ANY content change from the default project', () => {
    for (const change of [
      { bpm: 121 },
      { meterId: '3/4' as const },
      { masterVolume: 0.5 },
      { effects: { ...factoryProjectContent().effects, reverbWet: 0.9 } },
      { loops: [{ ...createDefaultLoop(), chordFeel: 0.9 }] },
    ]) {
      const store = makeStore(UNTITLED);
      const sched = manualScheduler();
      createDirtyTracker(store, { scheduler: sched.scheduler });
      store.setState(change as Partial<AppStore>);
      sched.run();
      expect(store.getState().dirty).toBe(true);
      expect(store.getState().projectBaselineHash).toBeNull();
    }
  });

  test('a migrated pre-upgrade session that differs from the defaults is dirty on the first pass (so the guard fires before Import)', () => {
    const store = makeStore(UNTITLED);
    store.setState({ bpm: 96 }); // "old work" already on screen before the tracker exists
    const sched = manualScheduler();
    const tracker = createDirtyTracker(store, { scheduler: sched.scheduler });
    tracker.runNow();
    expect(store.getState().dirty).toBe(true);
  });

  test('opening a project (id + baseline set, dirty cleared) makes the session clean until it changes', () => {
    const store = makeStore(UNTITLED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ bpm: 96 });
    sched.run();
    expect(store.getState().dirty).toBe(true);
    // What projectSlice.install writes for a saved project:
    const opened = { ...factoryProjectContent(), bpm: 77 };
    store.setState({ ...opened, currentProjectId: 'p-2', projectBaselineHash: fingerprintContent(opened), dirty: false });
    sched.run();
    expect(store.getState().dirty).toBe(false);
    store.setState({ bpm: 78 });
    sched.run();
    expect(store.getState().dirty).toBe(true);
  });

  test('New (reset to default, id and baseline null, dirty false) is clean until it changes', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ bpm: 121 });
    sched.run();
    expect(store.getState().dirty).toBe(true);
    // What projectSlice.newProject writes:
    store.setState({ ...factoryProjectContent(), currentProjectId: null, projectBaselineHash: null, dirty: false });
    sched.run();
    expect(store.getState().dirty).toBe(false);
    store.setState({ bpm: 122 });
    sched.run();
    expect(store.getState().dirty).toBe(true);
  });

  test('runNow runs the pending pass synchronously and cancels the scheduled one', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    const tracker = createDirtyTracker(store, { scheduler: sched.scheduler });
    store.setState({ bpm: 121 });
    tracker.runNow();
    expect(store.getState().dirty).toBe(true);
    expect(sched.size()).toBe(0);
  });

  test('stop unsubscribes', () => {
    const store = makeStore(SAVED);
    const sched = manualScheduler();
    createDirtyTracker(store, { scheduler: sched.scheduler }).stop();
    store.setState({ bpm: 121 });
    expect(sched.size()).toBe(0);
  });
});
