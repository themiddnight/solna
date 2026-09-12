import { describe, expect, test } from 'bun:test';
import { createMemoryBackend, createProjectStore, PROJECT_SLOT_KEY, QUOTA_MESSAGE } from './projectStore';
import { UNTITLED_SOURCE, type ProjectSlotRecord, type ProjectSource } from './projectSource';
import { PROJECT_FORMAT_VERSION, factoryProjectContent, makeEnvelope, type ProjectBody } from './projectFormat';
import { createDefaultLoop } from './loopSlice';
import { DEFAULT_LEAD_GATE, type LeadNote } from '../audio/leadMelody';

const body = (name: string, now = 1000): ProjectBody => ({ ...makeEnvelope(name, now), content: factoryProjectContent() });
const record = (name: string, source: ProjectSource = UNTITLED_SOURCE, now = 1000): ProjectSlotRecord => ({
  body: body(name, now),
  source,
});

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
    const saved = await store.save({ body: b, source: UNTITLED_SOURCE });
    expect(saved.ok).toBe(true);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.body.content.bpm).toBe(143);
    expect(loaded.ok && loaded.value.body.id).toBe(b.id);
    expect(backend.slot.size).toBe(1);
    expect(backend.slot.has(PROJECT_SLOT_KEY)).toBe(true);
  });

  test('a second save overwrites the slot — there is no second row', async () => {
    const backend = createMemoryBackend();
    const store = createProjectStore(async () => backend);
    await store.save(record('First'));
    await store.save(record('Second'));
    expect(backend.slot.size).toBe(1);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.body.name).toBe('Second');
  });

  test('clear empties the slot; a later load is not-found again', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    await store.save(record('Doomed'));
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
    const save = await store.save(record('X'));
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
    await store.save(record('Y'));
    expect(opens).toBe(1);
  });

  test('QuotaExceededError on save becomes the quota result with the spec message', async () => {
    const backend = createMemoryBackend();
    backend.putRecord = async () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const store = createProjectStore(async () => backend);
    const result = await store.save(record('Big'));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('quota');
      expect(result.message).toBe(QUOTA_MESSAGE);
    }
  });

  test('any other backend throw becomes a failed result, not a rejection', async () => {
    const backend = createMemoryBackend();
    backend.getRecord = async () => {
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
    expect(hit.value.body.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    const melody = hit.value.body.content.loops[0].leadMelodySteps as LeadNote[][];
    expect(melody).toEqual(createDefaultLoop().leadMelodySteps);
    expect(hit.value.body.content.loops[0].leadGate).toBe(DEFAULT_LEAD_GATE);
  });

  test('a body from a NEWER build is handed back verbatim, not downgrade-stamped', async () => {
    const b = { ...body('Future'), formatVersion: PROJECT_FORMAT_VERSION + 1 };
    const store = createProjectStore(async () => createMemoryBackend(b));
    const hit = await store.load();
    expect(hit.ok && hit.value.body.formatVersion).toBe(PROJECT_FORMAT_VERSION + 1);
  });
});

/**
 * The slot VALUE widened from a bare ProjectBody to { body, source }. There is
 * no version gate for it (see the "no migration chains" note in CLAUDE.md) —
 * `sanitizeSlotRecord` recognises both shapes on every read, whatever wrote it.
 */
describe('the slot record', () => {
  test('round-trips a drive source and a local handle beside the body', async () => {
    const backend = createMemoryBackend();
    const store = createProjectStore(async () => backend);
    const handle = { name: 'sketch.solna', kind: 'file' } as unknown as FileSystemFileHandle;

    await store.save(record('Alpha', { kind: 'drive', fileId: 'drive-1' }));
    const withDrive = await store.load();
    expect(withDrive.ok && withDrive.value.source).toEqual({ kind: 'drive', fileId: 'drive-1' });

    await store.save(record('Alpha', { kind: 'local', handle }));
    const withHandle = await store.load();
    expect(withHandle.ok && withHandle.value.source).toEqual({ kind: 'local', handle });
  });

  test('a bare body written before sources existed loads as untitled', async () => {
    const legacy = body('Legacy');
    const store = createProjectStore(async () => createMemoryBackend(legacy));
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual({ kind: 'untitled' });
    expect(loaded.ok && loaded.value.body.name).toBe('Legacy');
  });

  test('a record whose source is unreadable keeps the body and falls back to untitled', async () => {
    const backend = createMemoryBackend();
    backend.slot.set(PROJECT_SLOT_KEY, { body: body('Alpha'), source: { kind: 'drive' } });
    const store = createProjectStore(async () => backend);
    const loaded = await store.load();
    expect(loaded.ok && loaded.value.source).toEqual({ kind: 'untitled' });
    expect(loaded.ok && loaded.value.body.name).toBe('Alpha');
  });

  test('a slot value that is not a body at all is not-found — the empty-slot state', async () => {
    const backend = createMemoryBackend();
    backend.slot.set(PROJECT_SLOT_KEY, 'garbage');
    const store = createProjectStore(async () => backend);
    const loaded = await store.load();
    expect(loaded.ok).toBe(false);
    if (loaded.ok === false) expect(loaded.error).toBe('not-found');
  });

  test('save hands back the record it wrote, source included', async () => {
    const store = createProjectStore(async () => createMemoryBackend());
    const written = record('Alpha', { kind: 'drive', fileId: 'drive-9' });
    const saved = await store.save(written);
    expect(saved.ok && saved.value).toEqual(written);
  });
});
