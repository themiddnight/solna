import { describe, expect, test } from 'bun:test';
import { createMemoryBackend, createProjectStore, QUOTA_MESSAGE } from './projectStore';
import { PROJECT_FORMAT_VERSION, factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
import { createDefaultLoop } from './loopSlice';
import { DEFAULT_LEAD_GATE } from '../audio/leadMelody';

const body = (name: string, now = 1000): ProjectBody => ({ ...makeEnvelope(name, now), content: factoryProjectContent() });

describe('createProjectStore against the in-memory backend', () => {
  test('put then list returns metadata only, most recently updated first', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    await store.put(body('Old', 1000));
    await store.put(body('New', 2000));
    const list = await store.list();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.map((m) => m.name)).toEqual(['New', 'Old']);
    expect('content' in list.value[0]).toBe(false);
    expect(store.status()).toBe('ready');
  });

  test('get returns the full body and not-found for a missing id', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    const b = body('One');
    await store.put(b);
    const hit = await store.get(b.id);
    expect(hit.ok && hit.value.content.bpm).toBe(120);
    const miss = await store.get('nope');
    expect(miss.ok).toBe(false);
    if (miss.ok === false) expect(miss.error).toBe('not-found');
  });

  test('remove deletes both records', async () => {
    const backend = createMemoryBackend();
    const store = createProjectStore(async () => backend);
    const b = body('Gone');
    await store.put(b);
    await store.remove(b.id);
    expect(backend.bodies.has(b.id)).toBe(false);
    expect(backend.metas.has(b.id)).toBe(false);
  });

  test('a failing open resolves to the degraded state and never throws', async () => {
    const store = createProjectStore(async () => {
      throw new Error('SecurityError: IndexedDB is blocked');
    });
    const list = await store.list();
    expect(list.ok).toBe(false);
    if (list.ok === false) expect(list.error).toBe('unavailable');
    expect(store.status()).toBe('unavailable');
    const put = await store.put(body('X'));
    expect(put.ok).toBe(false);
    if (put.ok === false) expect(put.error).toBe('unavailable');
  });

  test('open is attempted once — a second call reuses the outcome', async () => {
    let opens = 0;
    const store = createProjectStore(async () => {
      opens++;
      return createMemoryBackend();
    });
    await store.list();
    await store.list();
    await store.put(body('Y'));
    expect(opens).toBe(1);
  });

  test('QuotaExceededError on put becomes the quota result with the spec message', async () => {
    const backend = createMemoryBackend();
    backend.put = async () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const store = createProjectStore(async () => backend);
    const result = await store.put(body('Big'));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('quota');
      expect(result.message).toBe(QUOTA_MESSAGE);
    }
  });

  test('any other backend throw becomes a failed result, not a rejection', async () => {
    const backend = createMemoryBackend();
    backend.getBody = async () => {
      throw new Error('boom');
    };
    const store = createProjectStore(async () => backend);
    const result = await store.get('x');
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe('failed');
  });

  test('read-repair drops an orphaned meta row on first open, without reading bodies', async () => {
    const backend = createMemoryBackend();
    const orphan = body('Orphan');
    backend.metas.set(orphan.id, { ...orphan, content: undefined } as never);
    const store = createProjectStore(async () => backend);
    const list = await store.list();
    expect(list.ok && list.value).toEqual([]);
    expect(backend.metas.has(orphan.id)).toBe(false);
  });

  test('a repair that throws is cosmetic: the store is still ready and reads and writes work', async () => {
    const backend = createMemoryBackend();
    backend.repairOrphans = async () => {
      throw new DOMException('inactive', 'TransactionInactiveError');
    };
    const store = createProjectStore(async () => backend);
    const put = await store.put(body('Survivor'));
    expect(put.ok).toBe(true);
    expect(store.status()).toBe('ready');
    const list = await store.list();
    expect(list.ok && list.value.map((m) => m.name)).toEqual(['Survivor']);
  });
});

/**
 * The seam: `get` is where a stored body is READ, so it is where the format
 * chain runs — open, export, rename and saveProject's existence check all go
 * through it and none of them has to remember.
 */
describe('get normalises the body it hands out', () => {
  const legacy = (): ProjectBody => {
    const loop = { ...createDefaultLoop(), id: 'loop-legacy' } as unknown as Record<string, unknown>;
    loop.leadMelodySteps = [['C4'], []];
    delete loop.leadGate;
    return {
      ...makeEnvelope('Legacy', 1000),
      formatVersion: 1,
      content: { ...factoryProjectContent(), loops: [loop] },
    } as unknown as ProjectBody;
  };

  test('a formatVersion-1 body comes back upgraded, gated and restamped', async () => {
    const b = legacy();
    const store = createProjectStore(async () => createMemoryBackend([b]));
    const hit = await store.get(b.id);
    expect(hit.ok).toBe(true);
    if (!hit.ok) return;
    expect(hit.value.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(hit.value.content.loops[0].leadMelodySteps).toEqual([[{ note: 'C4', len: 1 }], []]);
    expect(hit.value.content.loops[0].leadGate).toBe(DEFAULT_LEAD_GATE);
  });

  test('a body from a NEWER build is handed back verbatim, not downgrade-stamped', async () => {
    // `get` cannot report "newer-version", and sanitising would strip the
    // fields that build added and persist the loss on the next save.
    const b = { ...body('Future'), formatVersion: PROJECT_FORMAT_VERSION + 1 };
    const store = createProjectStore(async () => createMemoryBackend([b]));
    const hit = await store.get(b.id);
    expect(hit.ok && hit.value.formatVersion).toBe(PROJECT_FORMAT_VERSION + 1);
  });
});
