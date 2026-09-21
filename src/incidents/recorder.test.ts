import { describe, expect, test } from 'bun:test';
import type { AudioClockEvidence } from '@/audio/runtime/healthMonitor';
import { createIncidentRecorder } from './recorder';
import { createIncidentStore } from './storage';
import type { IncidentBackend } from './storage';
import type { RecoveryAttempt, RuntimeProfile } from './types';

const runtime: RuntimeProfile = { engine: 'webkit', platform: 'ios', standalone: true, userAgent: 'UA' };
const sample = (i: number): AudioClockEvidence => ({
  elapsedMs: i, audioTimeSec: i / 10, ratio: 1, contextState: 'running', visible: true,
});
const attempt: RecoveryAttempt = { startedAfterIncidentMs: 5, generation: 2, result: 'recovered' };

function setup() {
  const saved: unknown[] = [];
  const backend: IncidentBackend = {
    get: async () => saved.at(-1),
    put: async (i) => { saved.push(structuredClone(i)); },
    remove: async () => { saved.length = 0; },
  };
  let n = 0;
  const recorder = createIncidentRecorder({
    store: createIncidentStore(async () => backend),
    runtime,
    buildId: 'b1',
    now: () => 1000,
    newId: () => `id-${++n}`,
  });
  return { recorder, saved };
}

const audioInput = { kind: 'audio-health', severity: 'interrupted', summary: 's', error: null, generation: 1 } as const;

describe('incident recorder', () => {
  test('freezes the latest 300 samples in order', () => {
    const { recorder } = setup();
    for (let i = 0; i < 301; i += 1) recorder.recordSample(sample(i));
    const incident = recorder.freezeAudioIncident(audioInput);
    expect(incident.audio?.samples).toHaveLength(300);
    expect(incident.audio?.samples[0]?.elapsedMs).toBe(1);
    expect(incident.audio?.samples[299]?.elapsedMs).toBe(300);
  });

  test('freezing clones input and later samples do not mutate the report', async () => {
    const { recorder, saved } = setup();
    const error = { name: 'E', message: 'm', stack: null, componentStack: null };
    recorder.recordSample(sample(1));
    const incident = recorder.freezeAudioIncident({ ...audioInput, error });
    error.message = 'changed';
    recorder.recordSample(sample(2));
    expect(incident.audio?.samples).toHaveLength(1);
    expect(incident.error?.message).toBe('m');
    await Promise.resolve();
    expect(saved).toHaveLength(1);
  });

  test('a recovery attempt appends only to the matching incident', () => {
    const { recorder } = setup();
    const first = recorder.freezeAudioIncident(audioInput);
    const second = recorder.freezeAudioIncident(audioInput);
    expect(recorder.appendRecoveryAttempt(first.id, attempt)).toBeNull();
    expect(recorder.appendRecoveryAttempt('nope', attempt)).toBeNull();
    expect(recorder.appendRecoveryAttempt(second.id, attempt)?.recoveryAttempts).toEqual([attempt]);
  });

  test('non-audio, non-manual incidents have no audio', () => {
    const { recorder } = setup();
    recorder.recordSample(sample(1));
    expect(recorder.freezeAudioIncident({ ...audioInput, kind: 'render-crash' }).audio).toBeNull();
  });

  test('never schedules a timer', () => {
    const originals = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval };
    let scheduled = 0;
    globalThis.setTimeout = ((...a: Parameters<typeof setTimeout>) => { scheduled += 1; return originals.setTimeout(...a); }) as typeof setTimeout;
    globalThis.setInterval = ((...a: Parameters<typeof setInterval>) => { scheduled += 1; return originals.setInterval(...a); }) as typeof setInterval;
    try {
      const { recorder } = setup();
      recorder.recordSample(sample(1));
      const i = recorder.freezeAudioIncident(audioInput);
      recorder.appendRecoveryAttempt(i.id, attempt);
    } finally {
      globalThis.setTimeout = originals.setTimeout;
      globalThis.setInterval = originals.setInterval;
    }
    expect(scheduled).toBe(0);
  });

  test('a second incident replaces the first in storage', async () => {
    const { recorder, saved } = setup();
    recorder.freezeAudioIncident(audioInput);
    const second = recorder.freezeAudioIncident(audioInput);
    await new Promise((r) => queueMicrotask(() => r(null)));
    expect((saved.at(-1) as { id: string }).id).toBe(second.id);
  });

  test('a manual report carries audio evidence only when samples were recorded', () => {
    const a = setup();
    expect(a.recorder.freezeAudioIncident({ kind: 'manual', severity: 'degraded', summary: 's', error: null, generation: 0 }).audio).toBeNull();
    const b = setup();
    for (let i = 0; i < 400; i++) b.recorder.recordSample(sample(i));
    const report = b.recorder.freezeAudioIncident({ kind: 'manual', severity: 'degraded', summary: 's', error: null, generation: 0 });
    expect(report.audio?.samples).toHaveLength(300);
    const other = setup();
    other.recorder.recordSample(sample(1));
    expect(other.recorder.freezeAudioIncident({ kind: 'unhandled-error', severity: 'degraded', summary: 's', error: null, generation: 0 }).audio).toBeNull();
  });
});
