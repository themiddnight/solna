import { describe, expect, test } from 'bun:test';
import { createMemoryBackend, createProjectStore, PROJECT_SLOT_KEY, QUOTA_MESSAGE } from './projectStore';
import { PROJECT_FORMAT_VERSION, factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
import { createDefaultLoop } from './loopSlice';
import { DEFAULT_LEAD_GATE, type LeadNote } from '../audio/leadMelody';

const body = (name: string, now = 1000): ProjectBody => ({ ...makeEnvelope(name, now), content: factoryProjectContent() });

describe('createProjectStore against the in-memory backend', () => {
  test('an empty slot is not-found — the normal first-run state, not an error', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    const result = await store.load();
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('not-found');
      expect(result.message).toBe('No project is stored on this device yet.');
    }
    expect(store.status()).toBe('ready');
  });

  test('save then load round-trips the whole body through the one slot', async () => {
    const backend = createMemoryBackend();
    const store = createProjectStore(async () => backend);
    const b = { ...body('Alpha'), content: { ...factoryProjectContent(), bpm: 143 } };
    const saved = await store.save(b);
    expect(saved.ok).toBe(true);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.content.bpm).toBe(143);
    expect(loaded.ok && loaded.value.id).toBe(b.id);
    expect(backend.slot.size).toBe(1);
    expect(backend.slot.has(PROJECT_SLOT_KEY)).toBe(true);
  });

  test('a second save overwrites the slot — there is no second row', async () => {
    const backend = createMemoryBackend();
    const store = createProjectStore(async () => backend);
    await store.save(body('First'));
    await store.save(body('Second'));
    expect(backend.slot.size).toBe(1);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.name).toBe('Second');
  });

  test('clear empties the slot; a later load is not-found again', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    await store.save(body('Doomed'));
    const cleared = await store.clear();
    expect(cleared.ok).toBe(true);
    const loaded = await store.load();
    expect(loaded.ok).toBe(false);
    if (loaded.ok === false) expect(loaded.error).toBe('not-found');
  });

  test('a failing open resolves to the degraded state and never throws', async () => {
    const store = createProjectStore(async () => {
      throw new Error('SecurityError: IndexedDB is blocked');
    });
    const load = await store.load();
    expect(load.ok).toBe(false);
    if (load.ok === false) expect(load.error).toBe('unavailable');
    expect(store.status()).toBe('unavailable');
    const save = await store.save(body('X'));
    expect(save.ok).toBe(false);
    if (save.ok === false) expect(save.error).toBe('unavailable');
    const clear = await store.clear();
    expect(clear.ok).toBe(false);
  });

  test('open is attempted once — a second call reuses the outcome', async () => {
    let opens = 0;
    const store = createProjectStore(async () => {
      opens++;
      return createMemoryBackend();
    });
    await store.load();
    await store.load();
    await store.save(body('Y'));
    expect(opens).toBe(1);
  });

  test('QuotaExceededError on save becomes the quota result with the spec message', async () => {
    const backend = createMemoryBackend();
    backend.put = async () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const store = createProjectStore(async () => backend);
    const result = await store.save(body('Big'));
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
    const result = await store.load();
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe('failed');
  });
});

/**
 * The seam: `load` is where a stored body is READ, so it is where the format
 * chain runs. Nothing else reads the slot, so no caller has to remember.
 */
describe('load normalises the body it hands out', () => {
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

  test('a formatVersion-1 body comes back restamped, with its melody reset (not misread) and gated', async () => {
    const b = legacy();
    const store = createProjectStore(async () => createMemoryBackend(b));
    const hit = await store.load();
    expect(hit.ok).toBe(true);
    if (!hit.ok) return;
    expect(hit.value.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    const melody = hit.value.content.loops[0].leadMelodySteps as LeadNote[][];
    expect(melody).toEqual(createDefaultLoop().leadMelodySteps);
    expect(hit.value.content.loops[0].leadGate).toBe(DEFAULT_LEAD_GATE);
  });

  test('a body from a NEWER build is handed back verbatim, not downgrade-stamped', async () => {
    const b = { ...body('Future'), formatVersion: PROJECT_FORMAT_VERSION + 1 };
    const store = createProjectStore(async () => createMemoryBackend(b));
    const hit = await store.load();
    expect(hit.ok && hit.value.formatVersion).toBe(PROJECT_FORMAT_VERSION + 1);
  });
});
