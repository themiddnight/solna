import { describe, expect, test } from 'bun:test';
import { resolveInitialRoute } from './useRouteSync';

describe('resolveInitialRoute', () => {
  test('resolveInitialRoute adopts URL tab and loopId, normalizes a missing tab', () => {
    expect(resolveInitialRoute('/loop', '?tab=chords&loopId=abc')).toEqual({
      tab: 'chords',
      loopId: 'abc',
      needsNormalize: false,
    });
    expect(resolveInitialRoute('/loop', '').tab).toBe('synth');
    expect(resolveInitialRoute('/song', '?tab=arrange').tab).toBe('arrange');
    expect(resolveInitialRoute('/', '?tab=synth').needsNormalize).toBe(true);
  });
});
