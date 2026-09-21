import { afterEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { audioRecoveryStore } from '@/store/audioRecovery';
import { clearIncident, dismissIncident, incidentStore, publishIncident } from '@/incidents/incidentStore';
import { githubIssueUrl } from '@/incidents/githubReport';
import type { IncidentReportV1 } from '@/incidents/types';
import {
  browserExportDependencies,
  IncidentDialog,
  IncidentWarning,
  openGithubReport,
  runIncidentExport,
} from './IncidentDialog';

function report(overrides: Partial<IncidentReportV1> = {}): IncidentReportV1 {
  return {
    schemaVersion: 1,
    id: 'id-1',
    fingerprint: 'abcd1234',
    kind: 'audio-health',
    severity: 'interrupted',
    occurredAt: Date.now() - 5 * 60_000,
    buildId: 'dev',
    summary: 'Audio playback stopped responding',
    runtime: { engine: 'webkit', platform: 'ios', standalone: false, userAgent: 'x' },
    error: null,
    audio: { generation: 1, samples: [] },
    recoveryAttempts: [],
    ...overrides,
  };
}

const setAudio = (s: Partial<ReturnType<typeof audioRecoveryStore.getState>>) => audioRecoveryStore.setState(s);

afterEach(async () => {
  await clearIncident();
  setAudio({ status: 'healthy', modalOpen: false, evidence: [] });
});

describe('IncidentDialog', () => {
  test('audio incident: safe copy, Recover primary, GitHub secondary, Not Now, public disclosure', () => {
    setAudio({ status: 'unhealthy', modalOpen: true });
    publishIncident(report());
    const html = renderToString(<IncidentDialog />);
    expect(html).toContain('Your project is safe');
    expect(html).toContain('aria-label="Recover audio"');
    expect(html).toContain('btn btn-sm btn-primary');
    expect(html).toContain('btn btn-sm btn-outline">Report on GitHub');
    expect(html).toContain('Not Now');
    expect(html).toContain('GitHub issues are public');
    expect(html).toContain('abcd1234');
    expect(html).toContain('webkit / ios');
    expect(html).toContain('5 min ago');
    expect(html).not.toContain('Reload App');
  });

  test('shows a safe preview only, never raw JSON or a stack', () => {
    setAudio({ status: 'unhealthy', modalOpen: true });
    publishIncident(
      report({ error: { name: 'E', message: 'm', stack: 'at secretFrame', componentStack: null } }),
    );
    const html = renderToString(<IncidentDialog />);
    expect(html).not.toContain('secretFrame');
    expect(html).not.toContain('schemaVersion');
  });

  test('failed recovery offers Retry and Reload App with an alert', () => {
    setAudio({ status: 'failed', modalOpen: true });
    publishIncident(report({ recoveryAttempts: [{ startedAfterIncidentMs: 1, generation: 2, result: 'resume-failed' }] }));
    const html = renderToString(<IncidentDialog />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="Retry"');
    expect(html).toContain('aria-label="Reload App"');
    expect(html).toContain('resume-failed');
  });

  test('recovering disables the action', () => {
    setAudio({ status: 'recovering', modalOpen: true });
    publishIncident(report());
    expect(renderToString(<IncidentDialog />)).toMatch(/<button[^>]*aria-label="Recover audio"[^>]*disabled/);
  });

  test('generic interrupted incident offers Report and Close, no recovery', () => {
    publishIncident(report({ kind: 'render-crash' }));
    const html = renderToString(<IncidentDialog />);
    expect(html).toContain('Solna was interrupted');
    expect(html).toContain('>Close<');
    expect(html).toContain('Report on GitHub');
    expect(html).not.toContain('Recover audio');
    expect(html).not.toContain('Not Now');
  });

  test('an old audio incident with no recovery pending has no Recover action', () => {
    publishIncident(report());
    setAudio({ status: 'healthy', modalOpen: true });
    const html = renderToString(<IncidentDialog />);
    expect(html).not.toContain('Recover audio');
    expect(html).toContain('>Close<');
  });
});

describe('incident export and GitHub helpers', () => {
  test('each action reaches exportIncident with its own action and reports the outcome', async () => {
    const calls: string[] = [];
    const run = async (_r: IncidentReportV1, action: string) => {
      calls.push(action);
      return action === 'share' ? ('shared' as const) : action === 'copy' ? ('copied' as const) : ('downloaded' as const);
    };
    expect(await runIncidentExport(report(), 'share', {}, run)).toBe('Report shared.');
    expect(await runIncidentExport(report(), 'copy', {}, run)).toBe('Report copied to the clipboard.');
    expect(await runIncidentExport(report(), 'download', {}, run)).toBe('Report downloaded.');
    expect(calls).toEqual(['share', 'copy', 'download']);
  });

  test('a dismissed share is silent and other failures say so', async () => {
    const abort = async () => {
      throw Object.assign(new Error('x'), { name: 'AbortError' });
    };
    const boom = async () => {
      throw new Error('x');
    };
    expect(await runIncidentExport(report(), 'share', {}, abort)).toBeNull();
    expect(await runIncidentExport(report(), 'share', {}, boom)).toBe('Could not export the report.');
  });

  test('browser dependencies omit what the browser lacks', () => {
    const deps = browserExportDependencies({} as Navigator);
    expect(deps.share).toBeUndefined();
    expect(deps.writeClipboardText).toBeUndefined();
  });

  test('GitHub action opens the prefilled URL in a new context without opener or referrer', () => {
    const opened: unknown[][] = [];
    const r = report();
    openGithubReport(r, ((...args: unknown[]) => opened.push(args)) as unknown as typeof window.open);
    expect(opened).toEqual([[githubIssueUrl(r), '_blank', 'noopener,noreferrer']]);
  });
});

describe('IncidentWarning', () => {
  test('absent with no incident; present after dismiss; gone after clear', async () => {
    expect(renderToString(<IncidentWarning />)).toBe('');
    publishIncident(report({ kind: 'render-crash' }));
    expect(renderToString(<IncidentWarning />)).toBe('');
    dismissIncident();
    expect(incidentStore.getState().current).not.toBeNull();
    expect(renderToString(<IncidentWarning />)).toContain('aria-label="View incident report"');
    await clearIncident();
    expect(renderToString(<IncidentWarning />)).toBe('');
  });

  test('an audio recovery pending and dismissed reads as needing recovery', () => {
    setAudio({ status: 'unhealthy', modalOpen: false });
    const html = renderToString(<IncidentWarning />);
    expect(html).toContain('aria-label="Audio needs recovery"');
    expect(html).toContain('btn-warning');
  });

  test('absent while the dialog is showing', () => {
    setAudio({ status: 'unhealthy', modalOpen: true });
    publishIncident(report());
    expect(renderToString(<IncidentWarning />)).toBe('');
  });
});

describe('IncidentDialog recovery gating', () => {
  test('a manual report during pending recovery still offers Recover', () => {
    setAudio({ status: 'unhealthy', modalOpen: true });
    publishIncident(report({ kind: 'manual', summary: 'Manual bug report' }));
    expect(renderToString(<IncidentDialog />)).toContain('aria-label="Recover audio"');
  });

  test('with the report discarded, a pending recovery keeps a reachable Recover path', () => {
    setAudio({ status: 'unhealthy', modalOpen: false });
    expect(renderToString(<IncidentWarning />)).toContain('Audio needs recovery');
    setAudio({ status: 'unhealthy', modalOpen: true });
    expect(renderToString(<IncidentDialog />)).toContain('aria-label="Recover audio"');
  });
});
