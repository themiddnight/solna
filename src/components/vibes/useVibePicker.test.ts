import { describe, expect, test } from 'bun:test';
import { VIBES } from '@/data/vibes';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { currentVibeId, PICK_PROMPT, startPickerSession, vibeLoadedFeedback, vibeSummaryLine } from './useVibePicker';

const vibe = VIBES[0];
const key = formatKeyLabel(vibe.scaleRoot, vibe.scaleType);

describe('the picker footer and its Use toast', () => {
  test('before any preview the footer prompts', () => {
    expect(vibeSummaryLine(null)).toBe(PICK_PROMPT);
    expect(PICK_PROMPT).toBe('Pick a vibe to hear it on this loop.');
  });

  test('a preview reads name · key · BPM, from what is sounding', () => {
    const spec = { ...vibe, bpm: vibe.bpm + 7 };
    expect(vibeSummaryLine({ base: vibe, spec })).toBe(`${vibe.name} · ${key} · ${vibe.bpm + 7} BPM`);
  });

  test('Use confirms under the one vibe key; a dice variant adds its headline', () => {
    expect(vibeLoadedFeedback({ base: vibe, spec: vibe })).toEqual({
      key: 'vibe', message: `Loaded ${vibe.name} (${vibe.bpm} BPM · Key ${key})`, tone: 'success',
    });
    const rolled = vibeLoadedFeedback({ base: vibe, spec: vibe, reroll: { headline: 'H', detail: 'D' } });
    expect(rolled.detail).toBe('H');
  });
});

describe('the current-vibe mark', () => {
  test('outside a session it is the vibe the store says the loop was loaded from', () => {
    expect(currentVibeId('lofi-chill', null)).toBe('lofi-chill');
    expect(currentVibeId(null, null)).toBeNull();
  });

  test('mid-session the store holds the preview, so the id captured at open answers', () => {
    expect(currentVibeId('synthwave-80s', { vibeId: 'lofi-chill' })).toBe('lofi-chill');
    expect(currentVibeId('synthwave-80s', { vibeId: null })).toBeNull();
  });
});

/** A promise the test resolves by hand, standing in for the lazy chunk. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * A fake preview module wired the way useVibePicker wires the real one:
 * `begin` holds and suspends, the disposer's `end` cancels only a session
 * that began, and cancelling releases both.
 */
function fakePicker({ beginThrows = false } = {}) {
  const log = { begun: 0, cancelled: 0, ready: 0, held: false, suspended: false, failed: 0 };
  let session: { snapshot: string } | null = null;
  const module = {
    beginVibePreview: () => {
      log.begun += 1;
      if (beginThrows) throw new Error('open failed'); // the real one undoes itself before rethrowing
      log.held = true;
      log.suspended = true;
      return 'snapshot';
    },
    cancelVibePreview: () => { log.cancelled += 1; log.held = false; log.suspended = false; },
  };
  const chunk = deferred<typeof module>();
  const start = () => startPickerSession(
    () => chunk.promise,
    (m) => ({ snapshot: m.beginVibePreview() }),
    (s) => { session = s; log.ready += 1; },
    () => {
      const live = session;
      session = null;
      if (live) module.cancelVibePreview();
    },
    () => { log.failed += 1; },
  );
  const flush = async () => { for (let i = 0; i < 3; i += 1) await Promise.resolve(); };
  const settle = async () => { chunk.resolve(module); await flush(); };
  const reject = async () => { chunk.reject(new Error('chunk failed')); await flush(); };
  return { log, start, settle, reject };
}

describe('the picker session (Review Focus 3 and 5)', () => {
  test('closed before the lazy module resolves: nothing begins, nothing is held or suspended', async () => {
    const { log, start, settle } = fakePicker();
    const dispose = start();
    dispose();
    await settle();
    expect(log).toEqual({ begun: 0, cancelled: 0, ready: 0, held: false, suspended: false, failed: 0 });
  });

  test('a double open (StrictMode mount, cleanup, mount) begins exactly once', async () => {
    const { log, start, settle } = fakePicker();
    start()();
    const dispose = start();
    await settle();
    expect(log.begun).toBe(1);
    expect(log.ready).toBe(1);
    dispose();
    expect(log).toEqual({ begun: 1, cancelled: 1, ready: 1, held: false, suspended: false, failed: 0 });
  });

  test('closed after the session began: the disposer cancels it once', async () => {
    const { log, start, settle } = fakePicker();
    const dispose = start();
    await settle();
    expect(log).toEqual({ begun: 1, cancelled: 0, ready: 1, held: true, suspended: true, failed: 0 });
    dispose();
    dispose();
    expect(log).toEqual({ begun: 1, cancelled: 1, ready: 1, held: false, suspended: false, failed: 0 });
  });

  test('the chunk fails to load: nothing begins and the failure is reported once', async () => {
    const { log, start, reject } = fakePicker();
    start();
    await reject();
    expect(log).toEqual({ begun: 0, cancelled: 0, ready: 0, held: false, suspended: false, failed: 1 });
  });

  test('the open throws: no session is kept, nothing stays held, the failure is reported', async () => {
    const { log, start, settle } = fakePicker({ beginThrows: true });
    const dispose = start();
    await settle();
    expect(log).toEqual({ begun: 1, cancelled: 0, ready: 0, held: false, suspended: false, failed: 1 });
    dispose();
    expect(log.cancelled).toBe(0);
  });

  test('a failure after the picker closed is not reported', async () => {
    const { log, start, reject } = fakePicker();
    start()();
    await reject();
    expect(log.failed).toBe(0);
  });
});
