import { describe, expect, test } from 'bun:test';
import { newIncidentId } from './newId';

describe('newIncidentId', () => {
  test('uses randomUUID when available', () => {
    expect(newIncidentId({ randomUUID: () => 'a-b-c-d-e' })).toBe('a-b-c-d-e');
  });
  test('falls back without throwing in a non-secure context', () => {
    const a = newIncidentId(undefined as never);
    const b = newIncidentId({} as never);
    expect(a.length).toBeGreaterThan(8);
    expect(a).not.toBe(b);
  });
});
