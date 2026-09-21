import { describe, expect, test } from 'bun:test';
import { installGlobalIncidentCapture } from './globalCapture';
import type { DetectedIncidentInput } from './types';

function fakeTarget() {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  return {
    addEventListener: (t: string, l: EventListenerOrEventListenerObject) => {
      const set = listeners.get(t) ?? new Set();
      set.add(l as (e: Event) => void);
      listeners.set(t, set);
    },
    removeEventListener: (t: string, l: EventListenerOrEventListenerObject) => {
      listeners.get(t)?.delete(l as (e: Event) => void);
    },
    fire: (t: string, event: object) => listeners.get(t)?.forEach((l) => l(event as Event)),
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

function setup() {
  const target = fakeTarget();
  const reports: DetectedIncidentInput[] = [];
  const stop = installGlobalIncidentCapture(target, (i) => reports.push(i));
  return { target, reports, stop };
}

describe('installGlobalIncidentCapture', () => {
  test('an error event and an unhandled rejection each produce one sanitized incident', () => {
    const { target, reports } = setup();
    target.fire('error', { error: new Error('boom in /Users/me/song.ts') });
    target.fire('unhandledrejection', { reason: new TypeError('bad') });
    expect(reports).toHaveLength(2);
    expect(reports[0].kind).toBe('unhandled-error');
    expect(reports[0].severity).toBe('degraded');
    expect(reports[0].error?.message).not.toContain('/Users/me');
    expect(reports[1].error?.name).toBe('TypeError');
  });

  test('cancellations, bare messages and duplicate error objects are ignored', () => {
    const { target, reports } = setup();
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    target.fire('unhandledrejection', { reason: abort });
    target.fire('unhandledrejection', { reason: { name: 'popup_closed' } });
    target.fire('error', { error: undefined, message: 'Script error.' });
    target.fire('unhandledrejection', { reason: undefined });
    expect(reports).toHaveLength(0);

    const dup = new Error('same');
    target.fire('error', { error: dup });
    target.fire('unhandledrejection', { reason: dup });
    expect(reports).toHaveLength(1);
  });

  test('cleanup removes both listeners', () => {
    const { target, reports, stop } = setup();
    expect(target.count()).toBe(2);
    stop();
    expect(target.count()).toBe(0);
    target.fire('error', { error: new Error('late') });
    expect(reports).toHaveLength(0);
  });
});
