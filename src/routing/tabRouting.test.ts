import { afterEach, describe, expect, test } from 'bun:test';
import {
  parseTabParam,
  getTabFromUrl,
  pushTabToUrl,
  replaceTabInUrl,
  TAB_VALUES,
} from './tabRouting';
import type { ViewMode } from '../types';

interface FakeWindow {
  location: { search: string };
  history: {
    state: unknown;
    pushState: (...args: unknown[]) => void;
    replaceState: (...args: unknown[]) => void;
  };
  calls: Array<{ method: 'pushState' | 'replaceState'; args: unknown[] }>;
}

function installFakeWindow(search: string): FakeWindow {
  const calls: FakeWindow['calls'] = [];
  const fakeWindow: FakeWindow = {
    location: { search },
    history: {
      state: null,
      pushState: (...args: unknown[]) => calls.push({ method: 'pushState', args }),
      replaceState: (...args: unknown[]) => calls.push({ method: 'replaceState', args }),
    },
    calls,
  };
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
  return fakeWindow;
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true });
});

describe('parseTabParam', () => {
  test('accepts all four valid tab values', () => {
    for (const tab of TAB_VALUES) {
      expect(parseTabParam(`?tab=${tab}`)).toBe(tab);
    }
    // Without the leading '?' too
    expect(parseTabParam('tab=sequencer')).toBe('sequencer');
  });

  test('falls back to synth for an invalid value', () => {
    expect(parseTabParam('?tab=invalid')).toBe('synth');
    expect(parseTabParam('?tab=drums')).toBe('synth');
    expect(parseTabParam('?tab=CHORDS')).toBe('synth'); // case-sensitive
  });

  test('falls back to synth for an empty search string', () => {
    expect(parseTabParam('')).toBe('synth');
  });

  test('falls back to synth for an empty tab value', () => {
    expect(parseTabParam('?tab=')).toBe('synth');
  });

  test('ignores unrelated params and keeps parsing the tab', () => {
    expect(parseTabParam('?foo=1&tab=chords')).toBe('chords');
    expect(parseTabParam('?foo=1')).toBe('synth');
  });
});

describe('getTabFromUrl', () => {
  test('reads the tab from window.location.search', () => {
    installFakeWindow('?tab=sequencer');
    expect(getTabFromUrl()).toBe('sequencer');
  });

  test('falls back to synth when the URL has no tab param', () => {
    installFakeWindow('');
    expect(getTabFromUrl()).toBe('synth');
  });
});

describe('pushTabToUrl / replaceTabInUrl', () => {
  test('pushTabToUrl writes ?tab=<value> and keeps other params', () => {
    const fakeWindow = installFakeWindow('?foo=1');
    pushTabToUrl('chords' as ViewMode);
    expect(fakeWindow.calls).toHaveLength(1);
    expect(fakeWindow.calls[0].method).toBe('pushState');
    expect(fakeWindow.calls[0].args[0]).toBeNull();
    expect(fakeWindow.calls[0].args[2]).toBe('?foo=1&tab=chords');
  });

  test('pushTabToUrl on an empty search writes just the tab param', () => {
    const fakeWindow = installFakeWindow('');
    pushTabToUrl('synth');
    expect(fakeWindow.calls[0].args[2]).toBe('?tab=synth');
  });

  test('replaceTabInUrl replaces the tab while keeping other params', () => {
    const fakeWindow = installFakeWindow('?tab=chords&foo=1');
    replaceTabInUrl('effects');
    expect(fakeWindow.calls).toHaveLength(1);
    expect(fakeWindow.calls[0].method).toBe('replaceState');
    // The 'tab' value is updated in place; 'foo' is untouched
    expect(fakeWindow.calls[0].args[2]).toBe('?tab=effects&foo=1');
  });
});
