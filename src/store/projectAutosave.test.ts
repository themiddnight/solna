import { describe, expect, test } from 'bun:test';
import { createProjectAutosave, type AutosaveApi } from './projectAutosave';
import { PROJECT_CONTENT_KEYS, factoryProjectContent } from './projectFormat';
import type { WriteScheduler } from '../utils/coalescedStorage';
import type { AppStore } from './types';

/** A manual scheduler: nothing fires until the test drains it. */
function manualScheduler() {
  const queue: Array<() => void> = [];
  const cancelled: number[] = [];
  const scheduler: WriteScheduler = {
    schedule: (flush) => {
      queue.push(flush);
      return queue.length;
    },
    cancel: (handle) => {
      cancelled.push(handle);
      queue.splice(handle - 1, 1);
    },
  };
  return {
    scheduler,
    cancelled,
    /** Run every queued flush, as one idle window would. */
    drain: () => {
      const drained = queue.splice(0, queue.length);
      for (const flush of drained) flush();
    },
    pending: () => queue.length,
  };
}

function fakeApi(state: Partial<AppStore>) {
  let current = state as AppStore;
  const listeners: Array<() => void> = [];
  const saves: number[] = [];
  const api: AutosaveApi = {
    getState: () => ({ ...current, save: async () => { saves.push(Date.now()); return { ok: true, value: null } as never; } }) as AppStore,
    // Honours the selector and the equalityFn, the way zustand's
    // subscribeWithSelector does: the listener fires only when the SELECTED
    // slice changes. A stub that fired on every set() would not exercise the
    // "non-content set() schedules no write" contract at all.
    subscribe: (selector, listener, options) => {
      let last = selector(current);
      const run = () => {
        const next = selector(current);
        const prev = last;
        const equal = options?.equalityFn
          ? options.equalityFn(next, prev)
          : Object.is(next, prev);
        last = next;
        if (!equal) listener(next, prev);
      };
      listeners.push(run);
      return () => {
        const i = listeners.indexOf(run);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
  return {
    api,
    saves,
    setState: (next: Partial<AppStore>) => {
      current = { ...current, ...next } as AppStore;
      for (const run of [...listeners]) run();
    },
  };
}

describe('createProjectAutosave', () => {
  test('is disarmed until arm() — a boot-time write could overwrite a freshly loaded project', () => {
    const { scheduler } = manualScheduler();
    const { api, setState } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    setState({ bpm: 140 });
    expect(autosave.isScheduled()).toBe(false);
    autosave.arm();
    setState({ bpm: 150 });
    expect(autosave.isScheduled()).toBe(true);
  });

  test('many content set()s inside one idle window collapse to exactly one save()', () => {
    const { scheduler, drain } = manualScheduler();
    const { api, setState, saves } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    setState({ bpm: 121 });
    setState({ bpm: 122 });
    setState({ bpm: 123 });
    setState({ loops: [] });
    drain();
    expect(saves).toHaveLength(1);
  });

  test('a non-content set() schedules no write at all', () => {
    const { scheduler, drain } = manualScheduler();
    const { api, setState, saves } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    setState({ focusTrack: 'bass', activeTab: 'arrange', playheadBeat: 3 });
    drain();
    expect(saves).toHaveLength(0);
  });

  test('a name edit is a write trigger — the envelope autosaves with the project', () => {
    const { scheduler, drain } = manualScheduler();
    const { api, setState, saves } = fakeApi({ projectName: null });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    setState({ projectName: 'Alpha' });
    drain();
    expect(saves).toHaveLength(1);
  });

  test('disarm cancels a buffered write instead of letting it land', () => {
    const { scheduler, drain, cancelled } = manualScheduler();
    const { api, setState, saves } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    setState({ bpm: 121 });
    autosave.disarm();
    drain();
    expect(saves).toHaveLength(0);
    expect(cancelled).toHaveLength(1);
  });

  test('flush writes a pending edit immediately and is a no-op when nothing is pending', () => {
    const { scheduler } = manualScheduler();
    const { api, setState, saves } = fakeApi({ bpm: 120 });
    const autosave = createProjectAutosave(api, { scheduler });
    autosave.arm();
    autosave.flush();
    expect(saves).toHaveLength(0);
    setState({ bpm: 130 });
    autosave.flush();
    expect(saves).toHaveLength(1);
  });
});

/**
 * Exercise each content field independently, with a value distinct from its
 * factory default, so every kind of project edit is covered.
 *
 * `projectName` is deliberately NOT in this table: it is envelope rather than
 * content, so it is not in PROJECT_CONTENT_KEYS at all and its own coverage is
 * the "a name edit is a write trigger" case above.
 */
describe('every PROJECT_CONTENT_KEYS key schedules a write', () => {
  const changed: Record<(typeof PROJECT_CONTENT_KEYS)[number], unknown> = {
    bpm: 137,
    meterId: '3/4',
    masterVolume: 0.42,
    effects: { ...factoryProjectContent().effects, reverbWet: 0.9 },
    loops: [{ ...factoryProjectContent().loops[0], id: 'other' }],
  };
  const initial = { ...factoryProjectContent() } as unknown as Partial<AppStore>;

  for (const key of PROJECT_CONTENT_KEYS) {
    test(`${key}`, () => {
      const { scheduler, drain } = manualScheduler();
      const { api, setState, saves } = fakeApi({ ...initial });
      const autosave = createProjectAutosave(api, { scheduler });
      autosave.arm();
      setState({ [key]: changed[key] } as Partial<AppStore>);
      expect(autosave.isScheduled()).toBe(true);
      drain();
      expect(saves).toHaveLength(1);
    });
  }
});
