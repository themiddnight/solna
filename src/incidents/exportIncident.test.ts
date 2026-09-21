import { describe, expect, test } from 'bun:test';
import { exportIncident, incidentFileName } from './exportIncident';
import type { IncidentExportDependencies } from './exportIncident';
import type { IncidentReportV1 } from './types';

const report: IncidentReportV1 = {
  schemaVersion: 1,
  id: 'id-1',
  fingerprint: 'abcd1234',
  kind: 'manual',
  severity: 'degraded',
  occurredAt: Date.UTC(2026, 8, 20),
  buildId: 'b1',
  summary: 's',
  runtime: { engine: 'gecko', platform: 'linux', standalone: false, userAgent: 'UA' },
  error: null,
  audio: null,
  recoveryAttempts: [],
};

function harness(overrides: IncidentExportDependencies = {}) {
  const calls: string[] = [];
  const downloads: { name: string; text: string }[] = [];
  const deps: IncidentExportDependencies = {
    download: (name, text) => { calls.push('download'); downloads.push({ name, text }); },
    ...overrides,
  };
  return { calls, downloads, deps };
}

describe('exportIncident', () => {
  test('share wins when the browser can share files', async () => {
    const shared: File[][] = [];
    const { deps, calls } = harness({
      canShare: () => true,
      share: async ({ files }) => { shared.push(files); },
    });
    expect(await exportIncident(report, 'share', deps)).toBe('shared');
    expect(calls).toEqual([]);
    expect(shared[0]?.[0]?.name).toBe('solna-incident-2026-09-20-abcd1234.json');
    expect(JSON.parse(await shared[0]![0]!.text())).toEqual(report);
  });

  test('share falls back to download when files cannot be shared', async () => {
    const { deps, calls } = harness({ canShare: () => false, share: async () => { throw new Error('no'); } });
    expect(await exportIncident(report, 'share', deps)).toBe('downloaded');
    expect(calls).toEqual(['download']);
  });

  test('a dismissed share propagates instead of downloading', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    const { deps, calls } = harness({ canShare: () => true, share: async () => { throw abort; } });
    expect(await exportIncident(report, 'share', deps).catch((e: unknown) => e)).toBe(abort);
    expect(calls).toEqual([]);
  });

  test('copy uses the clipboard only when asked', async () => {
    const written: string[] = [];
    const { deps } = harness({ writeClipboardText: async (t) => { written.push(t); } });
    expect(await exportIncident(report, 'copy', deps)).toBe('copied');
    expect(JSON.parse(written[0]!)).toEqual(report);
    expect(await exportIncident(report, 'download', deps)).toBe('downloaded');
    expect(written).toHaveLength(1);
  });

  test('copy falls back to download when the clipboard is missing or denied', async () => {
    expect(await exportIncident(report, 'copy', harness().deps)).toBe('downloaded');
    const denied = harness({ writeClipboardText: async () => { throw new Error('denied'); } });
    expect(await exportIncident(report, 'copy', denied.deps)).toBe('downloaded');
  });

  test('filename has date and fingerprint and no other data', () => {
    expect(incidentFileName({ ...report, fingerprint: '../ab cd' })).toBe('solna-incident-2026-09-20-abcd.json');
  });

  test('refuses anything but the validated schema', async () => {
    const { deps, calls } = harness();
    const dirty = { ...report, projectName: 'My Song' } as unknown as IncidentReportV1;
    expect(await exportIncident(dirty, 'download', deps).catch((e: unknown) => e)).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });
});
