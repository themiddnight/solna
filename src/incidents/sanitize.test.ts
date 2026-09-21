import { describe, expect, test } from 'bun:test';
import { incidentFingerprint } from './fingerprint';
import { isIncidentReportV1, sanitizeError } from './sanitize';
import type { IncidentReportV1 } from './types';
import { INCIDENT_KINDS, INCIDENT_SEVERITIES } from './types';

function report(): IncidentReportV1 {
  return {
    schemaVersion: 1,
    id: 'i1',
    fingerprint: 'abcd1234',
    kind: 'audio-health',
    severity: 'interrupted',
    occurredAt: 1,
    buildId: 'b1',
    summary: 'Audio stopped',
    runtime: { engine: 'webkit', platform: 'ios', standalone: true, userAgent: 'UA' },
    error: null,
    audio: { generation: 2, samples: [{ elapsedMs: 1, audioTimeSec: 0.5, ratio: 1, contextState: 'running', visible: true }] },
    recoveryAttempts: [{ startedAfterIncidentMs: 10, generation: 3, result: 'recovered' }],
  };
}

describe('vocabulary', () => {
  test('kinds and severities are closed', () => {
    expect([...INCIDENT_KINDS]).toEqual(['audio-health', 'render-crash', 'unhandled-error', 'operation-failure', 'manual']);
    expect([...INCIDENT_SEVERITIES]).toEqual(['fatal', 'interrupted', 'degraded']);
  });
});

describe('sanitizeError', () => {
  test('strips URL query/hash and local paths and ignores nested objects', () => {
    const error = new Error('failed at https://solna.app/x?token=SECRET#frag reading /Users/alice/Music/My Song.solna');
    error.stack = [
      'Error: boom',
      '    at load (https://solna.app/assets/a.js?v=SECRET:1:2)',
      '    at open (/Users/alice/Sites/solna/src/a.ts:3:4)',
      '    at win (C:\\Users\\bob\\proj\\a.ts:5:6)',
    ].join('\n');
    Object.assign(error, { project: { name: 'SENTINEL_PROJECT' }, token: 'SENTINEL_TOKEN' });
    const clean = sanitizeError(error, '    at Foo (https://solna.app/c.js?x=SECRET:1:1)');
    const json = JSON.stringify(clean);
    for (const leak of ['SECRET', 'alice', 'bob', 'SENTINEL_PROJECT', 'SENTINEL_TOKEN', 'My Song']) {
      expect(json).not.toContain(leak);
    }
    expect(Object.keys(clean).sort()).toEqual(['componentStack', 'message', 'name', 'stack']);
    expect(clean.name).toBe('Error');
    expect(clean.componentStack).toContain('at Foo');
  });

  test('bounds message and stack, and tolerates non-errors', () => {
    const long = new Error('x'.repeat(5000));
    long.stack = Array.from({ length: 100 }, (_, i) => `    at f${i} (a.js:1:1)`).join('\n');
    const clean = sanitizeError(long);
    expect(clean.message.length).toBeLessThanOrEqual(301);
    expect(clean.stack!.split('\n').length).toBeLessThanOrEqual(12);
    expect(sanitizeError(undefined)).toEqual({ name: 'Error', message: '', stack: null, componentStack: null });
    expect(sanitizeError('plain').message).toBe('plain');
    expect(sanitizeError({ name: 'X', message: 'm', nested: { a: 1 } }).name).toBe('X');
  });
});

describe('isIncidentReportV1', () => {
  test('accepts a valid report and rejects extras, bad enums and oversized samples', () => {
    expect(isIncidentReportV1(report())).toBe(true);
    expect(isIncidentReportV1({ ...report(), projectName: 'SENTINEL' })).toBe(false);
    expect(isIncidentReportV1({ ...report(), kind: 'other' })).toBe(false);
    expect(isIncidentReportV1({ ...report(), runtime: { ...report().runtime, extra: 1 } })).toBe(false);
    expect(isIncidentReportV1({ ...report(), recoveryAttempts: [{ startedAfterIncidentMs: 1, generation: 1, result: 'nope' }] })).toBe(false);
    const sample = report().audio!.samples[0]!;
    expect(isIncidentReportV1({ ...report(), audio: { generation: 1, samples: Array(301).fill(sample) } })).toBe(false);
    expect(isIncidentReportV1(null)).toBe(false);
  });

  test('a serialized report holds no sentinel values passed only as raw input', () => {
    const raw = { name: 'Error', message: 'ok', project: 'SENTINEL_PROJECT', note: 'C#4', token: 'SENTINEL_TOKEN' };
    const error = sanitizeError(raw);
    const built: IncidentReportV1 = { ...report(), error };
    const json = JSON.stringify(built);
    expect(json).not.toContain('SENTINEL');
    expect(json).not.toContain('C#4');
    expect(isIncidentReportV1(built)).toBe(true);
  });
});

describe('incidentFingerprint sanity', () => {
  test('is used with sanitized errors', () => {
    const error = sanitizeError(new Error('a'));
    expect(incidentFingerprint({ kind: 'manual', error, runtime: { engine: 'webkit', platform: 'ios' }, buildId: 'b' })).toMatch(/^[0-9a-f]{8}$/);
  });
});
