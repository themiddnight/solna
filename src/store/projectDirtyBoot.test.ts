import { beforeAll, describe, expect, test } from 'bun:test';

/**
 * The WIRING test for the boot dirty pass. The unit tests in
 * projectDirty.test.ts drive a hand-built store and a hand-run scheduler; this
 * one proves the real thing: a payload restored by persist hydration — which
 * runs synchronously inside create(), BEFORE the tracker exists — still ends
 * up with `dirty: true` without anybody calling the tracker by hand. Regression
 * guard for a reloaded session that showed no badge and got no dirty guard on
 * Open / Import / New, silently losing restored work.
 */

class FakeLocalStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

const fakeLocalStorage = new FakeLocalStorage();

// The store module must not be imported statically: persist reads storage
// while create() runs, so the fakes go in first (the store.test.ts pattern).
let PERSIST_KEY: string;

beforeAll(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: fakeLocalStorage, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  ({ PERSIST_KEY } = await import('./store'));
});

/** Seeds a persist payload, then evaluates a FRESH store module against it. */
async function bootWith(state: Record<string, unknown>, version: number) {
  fakeLocalStorage.clear();
  fakeLocalStorage.setItem(PERSIST_KEY, JSON.stringify({ state, version }));
  const mod = await import(`./store?dirtyboot=${version}-${Math.random()}`);
  return mod.useAppStore as typeof import('./store').useAppStore;
}

/**
 * The pass rides the same idle scheduler coalescedStorage uses (250 ms, or a
 * real requestIdleCallback where there is one), so poll rather than guess.
 */
async function settled(store: typeof import('./store').useAppStore): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (store.getState().dirty) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return store.getState().dirty;
}

describe('the dirty tracker runs one pass at boot', () => {
  test('a restored v9 session with unsaved work is dirty with no manual pass', async () => {
    const store = await bootWith({ bpm: 96, currentProjectId: null, projectBaselineHash: null }, 9);
    expect(store.getState().bpm).toBe(96);
    expect(await settled(store)).toBe(true);
  });

  test('a restored v8 payload (migrated on the way in) is dirty too', async () => {
    const store = await bootWith({ bpm: 96 }, 8);
    expect(store.getState().bpm).toBe(96);
    expect(await settled(store)).toBe(true);
  });

  test('a restored session identical to the default project stays clean', async () => {
    const store = await bootWith({ bpm: 120, currentProjectId: null, projectBaselineHash: null }, 9);
    expect(await settled(store)).toBe(false);
  });
});
