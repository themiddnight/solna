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

import { isSongLayer, layerForTab } from '../types';
import {
  parseLayerPath, parseLoopId, resolveRoute, buildRouteUrl,
} from './tabRouting';

test('isSongLayer is true only for arrange and effects', () => {
  expect(isSongLayer('arrange')).toBe(true);
  expect(isSongLayer('effects')).toBe(true);
  expect(isSongLayer('synth')).toBe(false);
  expect(isSongLayer('sequencer')).toBe(false);
  expect(isSongLayer('chords')).toBe(false);
});

test('layerForTab maps the five tabs to loop or song', () => {
  expect(layerForTab('synth')).toBe('loop');
  expect(layerForTab('sequencer')).toBe('loop');
  expect(layerForTab('chords')).toBe('loop');
  expect(layerForTab('arrange')).toBe('song');
  expect(layerForTab('effects')).toBe('song');
});

test('parseLayerPath maps unknown and loop paths to loop, song to song', () => {
  expect(parseLayerPath('/loop')).toBe('loop');
  expect(parseLayerPath('/song')).toBe('song');
  expect(parseLayerPath('/')).toBe('loop');
  expect(parseLayerPath('/anything')).toBe('loop');
});

test('resolveRoute normalizes a missing or layer-mismatched tab to the layer default', () => {
  expect(resolveRoute('/loop', '?tab=sequencer').tab).toBe('sequencer');
  expect(resolveRoute('/loop', '').tab).toBe('synth');            // missing tab → default
  expect(resolveRoute('/loop', '?tab=arrange').tab).toBe('synth'); // arrange on loop layer → default
  expect(resolveRoute('/song', '?tab=effects').tab).toBe('effects');
  expect(resolveRoute('/song', '?tab=chords').tab).toBe('arrange'); // chords on song layer → default
});

test('resolveRoute reports needsNormalize for wrong path, wrong tab, or loopId on song layer', () => {
  expect(resolveRoute('/', '?tab=synth').needsNormalize).toBe(true);
  expect(resolveRoute('/loop', '?tab=arrange').needsNormalize).toBe(true);
  expect(resolveRoute('/song', '?tab=arrange&loopId=x').needsNormalize).toBe(true);
  expect(resolveRoute('/loop', '?tab=synth').needsNormalize).toBe(false);
});

test('parseLoopId extracts the loopId param', () => {
  expect(parseLoopId('?tab=synth&loopId=abc')).toBe('abc');
  expect(parseLoopId('?tab=synth')).toBe(null);
});

test('buildRouteUrl builds a two-path URL and only adds loopId on the loop layer', () => {
  expect(buildRouteUrl('loop', 'synth', 'abc')).toBe('/loop?tab=synth&loopId=abc');
  expect(buildRouteUrl('song', 'arrange')).toBe('/song?tab=arrange');
});
