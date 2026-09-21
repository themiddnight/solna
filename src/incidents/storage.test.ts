import { describe, expect, test } from 'bun:test';
import { createIncidentStore } from './storage';
import type { IncidentBackend } from './storage';
import type { IncidentReportV1 } from './types';

function incident(id: string): IncidentReportV1 {
  return {
    schemaVersion: 1, id, fingerprint: 'abcd1234', kind: 'manual', severity: 'degraded', occurredAt: 1,
    buildId: 'b', summary: 's', runtime: { engine: 'webkit', platform: 'ios', standalone: true, userAgent: 'UA' },
    error: null, audio: null, recoveryAttempts: [],
  };
}

function memoryBackend(seed?: unknown): IncidentBackend {
  let value = seed;
  return {
    get: async () => value,
    put: async (i) => { value = structuredClone(i); },
    remove: async () => { value = undefined; },
  };
}

const failing: IncidentBackend = {
  get: async () => { throw new Error('x'); },
  put: async () => { throw new Error('x'); },
  remove: async () => { throw new Error('x'); },
};

describe('incident store', () => {
  test('save, load, replace, clear', async () => {
    const store = createIncidentStore(async () => memoryBackend());
    expect(await store.load()).toBeNull();
    await store.save(incident('a'));
    await store.save(incident('b'));
    expect((await store.load())?.id).toBe('b');
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  test('invalid stored schema loads as null', async () => {
    const store = createIncidentStore(async () => memoryBackend({ id: 'a', extra: true }));
    expect(await store.load()).toBeNull();
  });

  test('open rejection falls back to the in-memory latest incident', async () => {
    const store = createIncidentStore(async () => { throw new Error('no idb'); });
    await store.save(incident('a'));
    expect((await store.load())?.id).toBe('a');
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  test('write rejection keeps the incident in memory', async () => {
    const store = createIncidentStore(async () => failing);
    await store.save(incident('a'));
    expect((await store.load())?.id).toBe('a');
  });

  test('loaded and saved values are clones', async () => {
    const source = incident('a');
    const store = createIncidentStore(async () => memoryBackend());
    await store.save(source);
    source.summary = 'mutated';
    const loaded = await store.load();
    expect(loaded?.summary).toBe('s');
    if (loaded) loaded.summary = 'again';
    expect((await store.load())?.summary).toBe('s');
  });

  test('reports a storage failure to subscribers while still holding the incident in memory', async () => {
    const store = createIncidentStore(async () => { throw new Error('no idb'); });
    let failures = 0;
    store.subscribeFailure?.(() => { failures += 1; });
    const incident = { schemaVersion: 1 } as never;
    await store.save(incident);
    expect(failures).toBe(1);
  });
});
