import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { githubIssueUrl, SOLNA_ISSUES_URL } from './githubReport';
import type { IncidentReportV1 } from './types';

const report: IncidentReportV1 = {
  schemaVersion: 1,
  id: 'id-1',
  fingerprint: 'abcd1234',
  kind: 'audio-health',
  severity: 'interrupted',
  occurredAt: 1_700_000_000_000,
  buildId: 'build-9',
  summary: 'Audio clock stalled',
  runtime: { engine: 'webkit', platform: 'ios', standalone: true, userAgent: 'SECRET-UA' },
  error: { name: 'E', message: 'boom', stack: 'at SECRET_STACK_FRAME', componentStack: null },
  audio: {
    generation: 2,
    samples: [{ elapsedMs: 123456, audioTimeSec: 1, ratio: 0.5, contextState: 'running', visible: true }],
  },
  recoveryAttempts: [{ startedAfterIncidentMs: 5, generation: 2, result: 'resume-failed' }],
};

describe('githubIssueUrl', () => {
  const url = new URL(githubIssueUrl(report));
  const body = url.searchParams.get('body') ?? '';

  test('targets the new-issue form with the bug template', () => {
    expect(SOLNA_ISSUES_URL).toBe('https://github.com/themiddnight/solna/issues/new');
    expect(url.origin + url.pathname).toBe(SOLNA_ISSUES_URL);
    expect(url.pathname).toBe('/themiddnight/solna/issues/new');
    expect(url.searchParams.get('template')).toBe('bug-report.yml');
  });

  test('prefills the issue-form field ids declared in bug-report.yml', () => {
    const yml = readFileSync('.github/ISSUE_TEMPLATE/bug-report.yml', 'utf8');
    for (const id of ['fingerprint', 'build', 'environment', 'recovery']) {
      expect(yml).toContain(`id: ${id}`);
      expect(url.searchParams.get(id)).toBeTruthy();
    }
    expect(url.searchParams.get('fingerprint')).toBe('abcd1234');
    expect(url.searchParams.get('build')).toBe('build-9');
  });

  test('title is bounded and names kind and fingerprint', () => {
    const title = url.searchParams.get('title') ?? '';
    expect(title).toContain('audio-health');
    expect(title).toContain('abcd1234');
    const long = new URL(githubIssueUrl({ ...report, summary: 'x'.repeat(500) }));
    expect((long.searchParams.get('title') ?? '').length).toBeLessThanOrEqual(100);
  });

  test('body carries the summary and states it is public', () => {
    expect(body).toContain('public');
    expect(body).toContain('build-9');
    expect(body).toContain('webkit');
    expect(body).toContain('resume-failed');
    expect(body).toContain('attach');
  });

  test('body carries no samples, stack, user agent or token', () => {
    expect(body).not.toContain('SECRET_STACK_FRAME');
    expect(body).not.toContain('SECRET-UA');
    expect(body).not.toContain('123456');
    expect(body).not.toContain('boom');
    expect(githubIssueUrl(report)).not.toMatch(/token|schemaVersion/i);
  });
});
