import { describe, expect, test } from 'bun:test';
import type { FingerprintInput } from './fingerprint';
import { incidentFingerprint } from './fingerprint';
import { sanitizeError } from './sanitize';

function input(overrides: Partial<FingerprintInput> = {}, stack = 'Error: a\n    at top (a.js:1:1)'): FingerprintInput {
  const error = new Error('a');
  error.stack = stack;
  return {
    kind: 'render-crash',
    error: sanitizeError(error),
    runtime: { engine: 'webkit', platform: 'ios' },
    buildId: 'b1',
    ...overrides,
  };
}

describe('incidentFingerprint', () => {
  test('equivalent safe inputs match, ignoring message, query strings and lower frames', () => {
    const a = input({}, 'Error: a\n    at top (https://x/a.js?v=1:1:1)\n    at low (a.js:2:2)');
    const b = input({}, 'Error: other text\n    at top (https://x/a.js?v=2:1:1)\n    at different (b.js:9:9)');
    expect(incidentFingerprint(a)).toBe(incidentFingerprint(b));
  });

  test('kind, top frame, runtime and build each change it', () => {
    const base = incidentFingerprint(input());
    expect(incidentFingerprint(input({ kind: 'manual' }))).not.toBe(base);
    expect(incidentFingerprint(input({}, 'Error: a\n    at other (a.js:1:1)'))).not.toBe(base);
    expect(incidentFingerprint(input({ runtime: { engine: 'gecko', platform: 'ios' } }))).not.toBe(base);
    expect(incidentFingerprint(input({ buildId: 'b2' }))).not.toBe(base);
  });

  test('handles a null error', () => {
    expect(incidentFingerprint(input({ error: null }))).toMatch(/^[0-9a-f]{8}$/);
  });
});
