import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isExpectedFailure, reportOperationFailure, setOperationFailureSink } from './operationFailure';
import type { DetectedIncidentInput } from './types';

let received: DetectedIncidentInput[];
beforeEach(() => {
  received = [];
  setOperationFailureSink((input) => received.push(input));
});
afterEach(() => setOperationFailureSink(null));

function named(name: string, message = 'x'): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('reportOperationFailure', () => {
  test('an unexpected failure becomes an operation-failure incident naming only the category', () => {
    reportOperationFailure('project-save', new Error('write failed for /Users/me/My Secret Song.solna'), 'degraded');
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('operation-failure');
    expect(received[0].severity).toBe('degraded');
    expect(received[0].summary).toBe('Unexpected failure during project-save');
    expect(received[0].summary).not.toContain('Secret');
  });

  const EXPECTED: ReadonlyArray<readonly [string, Error]> = [
    ['cancellation', named('AbortError')],
    ['quota', named('QuotaExceededError')],
    ['auth denial', named('access_denied')],
    ['closed sign-in popup', named('popup_closed')],
    ['network failure', new TypeError('Failed to fetch')],
    ['Safari network failure', new TypeError('Load failed')],
  ];
  for (const [label, error] of EXPECTED) {
    test(`${label} never produces an incident`, () => {
      expect(isExpectedFailure(error)).toBe(true);
      reportOperationFailure('mixdown', error, 'degraded');
      expect(received).toHaveLength(0);
    });
  }

  test('an ordinary TypeError is still unexpected', () => {
    expect(isExpectedFailure(new TypeError('x is not a function'))).toBe(false);
  });

  test('is a no-op with no sink and never throws from the sink', () => {
    setOperationFailureSink(null);
    expect(() => reportOperationFailure('boot', new Error('x'), 'fatal')).not.toThrow();
    setOperationFailureSink(() => {
      throw new Error('sink broke');
    });
    expect(() => reportOperationFailure('boot', new Error('x'), 'fatal')).not.toThrow();
  });
});
