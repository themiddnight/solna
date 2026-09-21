import { describe, expect, test } from 'bun:test';
import { createAudioRecovery, type AudioRecoveryDeps } from './audioRecovery';
import type { RecoveryAttempt } from '@/incidents/types';
import type { AudioHealthSnapshot } from '@/audio/runtime/healthMonitor';

const unhealthy: AudioHealthSnapshot = {
  phase: 'unhealthy', lastRatio: 0.2, suspiciousCount: 3, generation: 1, runtimePolicyId: 'default' as never,
};

function harness(overrides: Partial<AudioRecoveryDeps> = {}) {
  const calls: string[] = [];
  const attempts: RecoveryAttempt[] = [];
  let emit: (s: AudioHealthSnapshot) => void = () => {};
  const deps: AudioRecoveryDeps = {
    subscribeHealth: (l) => { emit = l; return () => calls.push('unsub'); },
    getRecentAudioHealthSamples: () => [
      { elapsedMs: 250, audioTimeSec: 0.1, ratio: 0.2, contextState: 'running', visible: true },
    ],
    now: () => 1000,
    freezeIncident: () => { calls.push('evidence'); },
    recordRecoveryAttempt: (a) => { attempts.push(a); },
    hardStopAll: () => calls.push('hardStopAll'),
    recreateRealtimeSession: async () => { calls.push('recreate'); return { ok: true, generation: 2 }; },
    applyEngineSnapshot: () => calls.push('apply'),
    validateRealtimeClock: async () => { calls.push('validate'); return true; },
    ...overrides,
  };
  const c = createAudioRecovery(deps);
  c.startBridge();
  return { c, calls, attempts, emit: (s: AudioHealthSnapshot = unhealthy) => emit(s) };
}

describe('audio recovery controller', () => {
  test('unhealthy captures evidence before hardStopAll and ignores repeats', () => {
    const { c, calls, emit } = harness();
    emit();
    emit();
    expect(calls).toEqual(['evidence', 'hardStopAll']);
    expect(c.store.getState().status).toBe('unhealthy');
    expect(c.store.getState().modalOpen).toBe(true);
    expect(c.store.getState().evidence).toHaveLength(1);
  });

  test('non-unhealthy phases do nothing', () => {
    const { c, calls, emit } = harness();
    emit({ ...unhealthy, phase: 'suspected' });
    expect(calls).toEqual([]);
    expect(c.store.getState().status).toBe('healthy');
  });

  test('recovery runs recreate -> apply -> validate, ends ready and never plays', async () => {
    const { c, calls, emit } = harness();
    emit();
    calls.length = 0;
    await c.recover();
    expect(calls).toEqual(['recreate', 'apply', 'validate']);
    expect(c.store.getState().status).toBe('ready');
    expect(c.store.getState().modalOpen).toBe(false);
  });

  test('the engine is called synchronously within the gesture', () => {
    const { c, calls, emit } = harness();
    emit();
    void c.recover();
    expect(calls).toContain('recreate');
    expect(c.store.getState().status).toBe('recovering');
  });

  test('parallel recover calls hit the engine once', async () => {
    const { c, calls, emit } = harness();
    emit();
    await Promise.all([c.recover(), c.recover()]);
    expect(calls.filter((x) => x === 'recreate')).toHaveLength(1);
  });

  test('failures become failed, and retry is possible', async () => {
    for (const override of [
      { recreateRealtimeSession: async () => ({ ok: false as const, generation: 2, reason: 'resume' as const }) },
      { recreateRealtimeSession: async () => { throw new Error('boom'); } },
      { validateRealtimeClock: async () => false },
    ]) {
      const { c, emit } = harness(override);
      emit();
      await c.recover();
      expect(c.store.getState().status).toBe('failed');
    }
    const { c, emit } = harness({ validateRealtimeClock: async () => false });
    emit();
    await c.recover();
    await c.recover();
    expect(c.store.getState().status).toBe('failed');
  });

  test('dismiss hides the modal but keeps status; reopen shows it again', () => {
    const { c, emit } = harness();
    emit();
    c.dismiss();
    expect(c.store.getState().status).toBe('unhealthy');
    expect(c.store.getState().modalOpen).toBe(false);
    c.reopen();
    expect(c.store.getState().modalOpen).toBe(true);
  });

  test('a later unhealthy after ready is handled again', async () => {
    const { c, calls, emit } = harness();
    emit();
    await c.recover();
    calls.length = 0;
    emit();
    expect(calls).toEqual(['evidence', 'hardStopAll']);
    expect(c.store.getState().status).toBe('unhealthy');
  });

  test('freezes with the snapshot generation and the evidence, once', () => {
    const frozen: unknown[] = [];
    const { emit } = harness({ freezeIncident: (e, g) => { frozen.push([e.length, g]); } });
    emit();
    emit();
    expect(frozen).toEqual([[1, 1]]);
  });

  test('every recovery outcome appends exactly one sanitized attempt', async () => {
    const cases: [Partial<AudioRecoveryDeps>, RecoveryAttempt['result'], number][] = [
      [{}, 'recovered', 2],
      [{ recreateRealtimeSession: async () => ({ ok: false as const, generation: 3, reason: 'resume' as const }) }, 'resume-failed', 3],
      [{ recreateRealtimeSession: async () => ({ ok: false as const, generation: 3, reason: 'construct' as const }) }, 'construct-failed', 3],
      [{ recreateRealtimeSession: async () => ({ ok: false as const, generation: 3, reason: 'build' as const }) }, 'build-failed', 3],
      [{ validateRealtimeClock: async () => false }, 'validate-failed', 2],
      [{ recreateRealtimeSession: () => { throw new Error('secret path /Users/x'); } }, 'construct-failed', 1],
    ];
    for (const [override, result, generation] of cases) {
      let t = 1000;
      const { c, attempts, emit } = harness({ ...override, now: () => (t += 250) });
      emit();
      await c.recover();
      expect(attempts).toEqual([{ startedAfterIncidentMs: 250, generation, result }]);
    }
  });
});
