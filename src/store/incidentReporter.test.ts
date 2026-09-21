import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from '@/audio/engine';
import { incidentPersistence } from '@/incidents/incidentStore';
import { clearIncident, incidentStore, publishIncident } from '@/incidents/incidentStore';
import type { IncidentReportV1 } from '@/incidents/types';
import { audioRecoveryStore } from './audioRecovery';
import { reportGlobalIncident, reportManualIncident } from './incidentReporter';

const held = (overrides: Partial<IncidentReportV1> = {}): IncidentReportV1 => ({
  schemaVersion: 1,
  id: 'old',
  fingerprint: 'oldprint',
  kind: 'audio-health',
  severity: 'interrupted',
  occurredAt: 1,
  buildId: 'dev',
  summary: 'old',
  runtime: { engine: 'webkit', platform: 'ios', standalone: false, userAgent: 'x' },
  error: null,
  audio: { generation: 1, samples: [] },
  recoveryAttempts: [],
  ...overrides,
});

const later = () =>
  reportGlobalIncident({ kind: 'unhandled-error', severity: 'degraded', summary: 'new failure', error: null });

afterEach(async () => {
  await clearIncident();
  audioRecoveryStore.setState({ status: 'healthy', modalOpen: false, evidence: [] });
});

describe('reportDetected replacement rule', () => {
  test('a stale (hydrated) report does not swallow a new distinct incident', () => {
    publishIncident(held());
    audioRecoveryStore.setState({ status: 'healthy' });
    later();
    expect(incidentStore.getState().current?.summary).toBe('new failure');
  });

  test('an unresolved audio incident is not displaced while recovery is owed', () => {
    publishIncident(held());
    audioRecoveryStore.setState({ status: 'unhealthy' });
    later();
    expect(incidentStore.getState().current?.id).toBe('old');
  });

  test('a repeat of the held fingerprint is dropped', () => {
    later();
    const first = incidentStore.getState().current;
    later();
    expect(incidentStore.getState().current).toBe(first);
  });

  test('a repeat of the held fingerprint does not write to storage again', async () => {
    later();
    const save = spyOn(incidentPersistence, 'save');
    later();
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();
  });
});

describe('manual report audio evidence', () => {
  test('carries the engine health samples when available', () => {
    const spy = spyOn(audioEngine, 'getRecentAudioHealthSamples').mockImplementation(() => [
      { elapsedMs: 1, audioTimeSec: 0.1, ratio: 1, contextState: 'running', visible: true },
    ]);
    reportManualIncident('/loop');
    expect(incidentStore.getState().current?.audio?.samples).toHaveLength(1);
    spy.mockRestore();
  });

  test('is null when the engine holds none', () => {
    reportManualIncident('/loop');
    expect(incidentStore.getState().current?.audio).toBeNull();
  });
});
