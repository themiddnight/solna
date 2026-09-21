import { describe, expect, test } from 'bun:test';
import { exportDiagnosticSession } from './exportSession';
import { createDiagnosticSessionStore, createMemoryDiagnosticBackend } from './storage';
import { diagnosticSummary, serializeDiagnosticSession } from './session';
import type { DiagnosticSessionV1 } from './types';

function session(endedAt: number | null = null): DiagnosticSessionV1 {
  return {
    schemaVersion: 1,
    id: 'diag-1000',
    startedAt: 1000,
    endedAt,
    userAgent: 'test',
    standalone: true,
    capabilities: { longTasks: false, heap: false },
    samples: [],
  };
}

describe('diagnostic session storage and schema', () => {
  test('recovers an unfinished one-slot session after a new store instance opens', async () => {
    const backend = createMemoryDiagnosticBackend();
    const first = createDiagnosticSessionStore(async () => backend);
    await first.save(session());

    const recovered = await createDiagnosticSessionStore(async () => backend).load();
    expect(recovered?.endedAt).toBeNull();
    expect(recovered?.id).toBe('diag-1000');
  });

  test('rejects malformed records and clear removes the slot', async () => {
    const backend = createMemoryDiagnosticBackend({ schemaVersion: 9 });
    const store = createDiagnosticSessionStore(async () => backend);
    expect(await store.load()).toBeNull();
    await backend.put({ ...session(), samples: [{}] } as unknown as DiagnosticSessionV1);
    expect(await store.load()).toBeNull();
    await store.save(session(2000));
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  test('serialized JSON is versioned and contains no project or user payload fields', () => {
    const json = serializeDiagnosticSession(session(2000));
    expect(JSON.parse(json).schemaVersion).toBe(1);
    expect(json).not.toContain('projectName');
    expect(json).not.toContain('accessToken');
    expect(json).not.toContain('progression');
    expect(json).not.toContain('notes');
  });
});

describe('diagnostic export', () => {
  test('uses Web Share when a JSON file can be shared', async () => {
    const shared: unknown[] = [];
    const downloaded: unknown[] = [];
    const result = await exportDiagnosticSession(session(2000), {
      share: async (data) => { shared.push(data); },
      canShare: () => true,
      download: (...args) => { downloaded.push(args); },
    });
    expect(result).toBe('shared');
    expect(shared).toHaveLength(1);
    expect(downloaded).toEqual([]);
  });

  test('falls back to a JSON download when file sharing is unavailable', async () => {
    const downloaded: Array<[string, string, string]> = [];
    const result = await exportDiagnosticSession(session(2000), {
      canShare: () => false,
      download: (...args) => { downloaded.push(args); },
    });
    expect(result).toBe('downloaded');
    expect(downloaded[0][0]).toContain('solna-diagnostics-');
    expect(downloaded[0][2]).toBe('application/json');
  });
});

test('summary reports interrupted state and collector p95', () => {
  const value = session();
  value.samples = [1, 5, 3, 2, 4].map((collectorCostMs, index) => ({
    elapsedMs: (index + 1) * 1000,
    route: '/',
    visibility: 'visible',
    viewport: { width: 1, height: 1, dpr: 1 },
    navigation: { activeTab: 'sound', focusTrack: 'synth' },
    transport: {
      bpm: 120,
      meterId: '4/4',
      players: { sequencer: 'stopped', chords: 'stopped', lead: 'stopped', fx: 'stopped' },
    },
    dom: { elements: 10, canvases: 0 },
    audio: {
      contextState: 'running', currentTimeSec: 1, baseLatencySec: null, outputLatencySec: null,
      clock: { listeners: 1, dispatches: 1, stalls: index, maxStallMs: index * 10 },
      voices: { groups: 1, physicalVoices: index, registered: 1, bySource: {} },
    },
    heapUsedBytes: null,
    activity: {
      storeWrites: index,
      playheadWrites: index,
      renders: {},
      eventLoopLag: { over50: 0, over100: 0, over250: 0, maxMs: index * 10 },
      frameGaps: { over50: 0, over100: 0, over250: 0, maxMs: index * 20 },
      longTasks: { supported: false, count: 0, totalMs: 0, maxMs: 0 },
    },
    collectorCostMs,
  }));

  expect(diagnosticSummary(value)).toEqual({
    interrupted: true,
    durationMs: 5000,
    samples: 5,
    collectorP95Ms: 5,
    maxEventLoopLagMs: 40,
    maxFrameGapMs: 80,
    clockStalls: 4,
    maxClockStallMs: 40,
    maxPhysicalVoices: 4,
    totalStoreWrites: 10,
    totalPlayheadWrites: 10,
  });
});
