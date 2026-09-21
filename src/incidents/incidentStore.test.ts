import { describe, expect, test } from 'bun:test';
import {
  clearIncident, createIncidentState, dismissIncident, hydrateLatestIncident, incidentStore, openIncident,
  publishIncident,
} from './incidentStore';
import type { IncidentStore } from './storage';
import type { IncidentReportV1 } from './types';

function report(id: string): IncidentReportV1 {
  return {
    schemaVersion: 1, id, fingerprint: 'f', kind: 'audio-health', severity: 'interrupted',
    occurredAt: 1, buildId: 'b', summary: 's',
    runtime: { engine: 'webkit', platform: 'ios', standalone: false, userAgent: 'ua' },
    error: null, audio: { generation: 1, samples: [] }, recoveryAttempts: [],
  };
}

function memoryPersistence(initial: IncidentReportV1 | null = null) {
  let saved = initial;
  const p: IncidentStore = {
    load: async () => saved,
    save: async (i) => { saved = i; },
    clear: async () => { saved = null; },
  };
  return { p, get: () => saved };
}

describe('incident state store', () => {
  test('publish stores and opens; dismiss hides but keeps; open restores', () => {
    const s = createIncidentState(memoryPersistence().p);
    s.publishIncident(report('a'));
    expect([s.getState().open, s.getState().current?.id]).toEqual([true, 'a']);
    s.dismissIncident();
    expect([s.getState().open, s.getState().current?.id]).toEqual([false, 'a']);
    s.openIncident();
    expect(s.getState().open).toBe(true);
  });

  test('open with no incident stays closed', () => {
    const s = createIncidentState(memoryPersistence().p);
    s.openIncident();
    expect(s.getState().open).toBe(false);
  });

  test('clear removes memory and persistence', async () => {
    const m = memoryPersistence(report('a'));
    const s = createIncidentState(m.p);
    s.publishIncident(report('a'));
    await s.clearIncident();
    expect(s.getState().current).toBeNull();
    expect(s.getState().open).toBe(false);
    expect(m.get()).toBeNull();
  });

  test('a newer incident replaces the slot', () => {
    const s = createIncidentState(memoryPersistence().p);
    s.publishIncident(report('a'));
    s.dismissIncident();
    s.publishIncident(report('b'));
    expect([s.getState().open, s.getState().current?.id]).toEqual([true, 'b']);
  });

  test('hydrate restores the latest closed, and never overrides a live incident', async () => {
    const s = createIncidentState(memoryPersistence(report('old')).p);
    await s.hydrateLatestIncident();
    expect([s.getState().open, s.getState().current?.id]).toEqual([false, 'old']);

    const live = createIncidentState(memoryPersistence(report('old')).p);
    live.publishIncident(report('new'));
    await live.hydrateLatestIncident();
    expect(live.getState().current?.id).toBe('new');
  });

  test('updateIncident only touches the matching report and keeps open', () => {
    const s = createIncidentState(memoryPersistence().p);
    s.publishIncident(report('a'));
    s.dismissIncident();
    s.updateIncident({ ...report('a'), summary: 'changed' });
    expect([s.getState().open, s.getState().current?.summary]).toEqual([false, 'changed']);
    s.updateIncident({ ...report('zzz'), summary: 'other' });
    expect(s.getState().current?.id).toBe('a');
  });

  test('subscribers are notified once per real transition', () => {
    const s = createIncidentState(memoryPersistence().p);
    let n = 0;
    s.subscribe(() => { n += 1; });
    s.dismissIncident();
    expect(n).toBe(0);
    s.publishIncident(report('a'));
    expect(n).toBe(1);
    s.openIncident();
    expect(n).toBe(1);
    s.dismissIncident();
    s.dismissIncident();
    expect(n).toBe(2);
  });
});

describe('module singleton', () => {
  test('exposes the same transitions the factory does', async () => {
    publishIncident(report('single'));
    expect(incidentStore.getState().open).toBe(true);
    dismissIncident();
    expect(incidentStore.getState().open).toBe(false);
    openIncident();
    expect(incidentStore.getState().current?.id).toBe('single');
    await clearIncident();
    expect(incidentStore.getState().current).toBeNull();
    await hydrateLatestIncident();
    expect(incidentStore.getState().open).toBe(false);
  });

  test('a persistence failure flips storage to memory', () => {
    let notify: () => void = () => undefined;
    const p: IncidentStore = {
      ...memoryPersistence().p,
      subscribeFailure: (l) => { notify = l; return () => undefined; },
    };
    const s = createIncidentState(p);
    expect(s.getState().storage).toBe('ready');
    notify();
    expect(s.getState().storage).toBe('memory');
  });
});
