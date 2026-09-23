import { describe, expect, test } from 'bun:test';
import { VIBES } from '@/data/vibes';
import { formatKeyLabel } from '@/utils/noteSpelling';
import { PICK_PROMPT, startPickerSession, vibeLoadedFeedback, vibeSummaryLine } from './useVibePicker';

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

/** A promise the test resolves by hand, standing in for the lazy chunk. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * A fake preview module wired the way useVibePicker wires the real one:
 * `begin` holds and suspends, the disposer's `end` cancels only a session
 * that began, and cancelling releases both.
 */
function fakePicker() {
  const log = { begun: 0, cancelled: 0, ready: 0, held: false, suspended: false };
  let session: { snapshot: string } | null = null;
  const module = {
    beginVibePreview: () => { log.begun += 1; log.held = true; log.suspended = true; return 'snapshot'; },
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
  );
  const settle = async () => { chunk.resolve(module); await chunk.promise; await Promise.resolve(); };
  return { log, start, settle };
}

describe('the picker session (Review Focus 3 and 5)', () => {
  test('closed before the lazy module resolves: nothing begins, nothing is held or suspended', async () => {
    const { log, start, settle } = fakePicker();
    const dispose = start();
    dispose();
    await settle();
    expect(log).toEqual({ begun: 0, cancelled: 0, ready: 0, held: false, suspended: false });
  });

  test('a double open (StrictMode mount, cleanup, mount) begins exactly once', async () => {
    const { log, start, settle } = fakePicker();
    start()();
    const dispose = start();
    await settle();
    expect(log.begun).toBe(1);
    expect(log.ready).toBe(1);
    dispose();
    expect(log).toEqual({ begun: 1, cancelled: 1, ready: 1, held: false, suspended: false });
  });

  test('closed after the session began: the disposer cancels it once', async () => {
    const { log, start, settle } = fakePicker();
    const dispose = start();
    await settle();
    expect(log).toEqual({ begun: 1, cancelled: 0, ready: 1, held: true, suspended: true });
    dispose();
    dispose();
    expect(log).toEqual({ begun: 1, cancelled: 1, ready: 1, held: false, suspended: false });
  });
});
