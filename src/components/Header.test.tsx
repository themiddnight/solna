import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { TabButton, AUTOMATION_TABS, LAYER_META, layerToggleTarget, persistTheme, readStoredTheme, resolveInitialTheme, SONG_NAV_TABS } from './Header';
import { defaultTabForLayer, tabsForLayer } from '../routing/tabRouting';

describe('resolveInitialTheme', () => {
  test('a stored theme always wins over the OS preference', () => {
    expect(resolveInitialTheme('solna-light', false)).toBe('solna-light');
    expect(resolveInitialTheme('solna-dark', true)).toBe('solna-dark');
  });

  test('first visit follows the OS preference', () => {
    expect(resolveInitialTheme(null, true)).toBe('solna-light');
    expect(resolveInitialTheme(null, false)).toBe('solna-dark');
  });

  test('a corrupt or legacy stored value falls back to the OS preference', () => {
    expect(resolveInitialTheme('murva-dark', true)).toBe('solna-light');
    expect(resolveInitialTheme('', false)).toBe('solna-dark');
    expect(resolveInitialTheme('null', false)).toBe('solna-dark');
  });
});

// Storage access itself can throw (Safari private browsing, "block all
// cookies", some embedded webviews) — not merely return null. These stubs
// simulate that failure mode without needing a real blocked browser.
const throwingGetStorage = {
  getItem(): string | null {
    throw new Error('SecurityError: storage is blocked');
  },
};

const throwingSetStorage = {
  setItem(): void {
    throw new Error('SecurityError: storage is blocked');
  },
};

describe('readStoredTheme', () => {
  test('returns the stored value when storage works normally', () => {
    const storage = { getItem: () => 'solna-light' };
    expect(readStoredTheme(storage)).toBe('solna-light');
  });

  test('degrades to null when storage access throws, instead of propagating', () => {
    expect(readStoredTheme(throwingGetStorage)).toBeNull();
  });

  test('returns null with no storage injected and no global (bun test has no localStorage)', () => {
    // Regression: the old `storage = localStorage` default parameter evaluated
    // the property access BEFORE the try/catch ran, so environments without a
    // localStorage global threw a ReferenceError at call time.
    expect(readStoredTheme()).toBeNull();
  });
});

describe('persistTheme', () => {
  test('writes the theme under the storage key when storage works normally', () => {
    const calls: Array<[string, string]> = [];
    const storage = {
      setItem: (key: string, value: string) => {
        calls.push([key, value]);
      },
    };
    persistTheme('solna-light', storage);
    expect(calls).toEqual([['solna_theme', 'solna-light']]);
  });

  test('does not throw when storage access throws (best-effort persistence)', () => {
    expect(() => persistTheme('solna-dark', throwingSetStorage)).not.toThrow();
  });

  test('does not throw with no storage injected and no global (bun test has no localStorage)', () => {
    // Same regression as readStoredTheme: the default parameter must not
    // evaluate localStorage outside the try/catch.
    expect(() => persistTheme('solna-light')).not.toThrow();
  });
});

describe('header tab grouping', () => {
  test('the three playable views carry a transport, synth driving the lead', () => {
    expect(AUTOMATION_TABS.map((t) => t.view)).toEqual(['synth', 'sequencer', 'chords']);
    expect(AUTOMATION_TABS.every((t) => t.module !== undefined)).toBe(true);
    expect(AUTOMATION_TABS[0].module).toBe('lead');
  });

  test('arrange and master fx stand alone, with no transport', () => {
    expect(SONG_NAV_TABS).toEqual(['arrange', 'effects']);
  });

  test('every tab view is still reachable', () => {
    const views = [...SONG_NAV_TABS, ...AUTOMATION_TABS.map((t) => t.view)].sort();
    expect(views).toEqual(['arrange', 'chords', 'effects', 'sequencer', 'synth']);
  });
});

describe('layer toggle', () => {
  test('lists the two layers in order with stable labels', () => {
    expect(LAYER_META.map((l) => l.layer)).toEqual(['loop', 'song']);
    expect(LAYER_META.map((l) => l.label)).toEqual(['Loop', 'Song']);
  });

  test('clicking a different layer navigates to that layer default tab', () => {
    expect(layerToggleTarget('loop', 'song')).toBe('arrange');
    expect(layerToggleTarget('song', 'loop')).toBe('synth');
  });

  test('clicking the current layer is a no-op', () => {
    expect(layerToggleTarget('loop', 'loop')).toBeNull();
    expect(layerToggleTarget('song', 'song')).toBeNull();
  });

  test('every toggle target is a tab inside that layer', () => {
    for (const { layer } of LAYER_META) {
      expect(tabsForLayer(layer)).toContain(defaultTabForLayer(layer));
    }
  });
});

describe('TabButton rendering', () => {
  test('renders with default class (hidden xl:inline) for loop tabs', () => {
    const html = renderToString(
      <TabButton view="synth" activeTab="synth" onSelect={() => {}} />
    );
    expect(html).toContain('id="tab-synth"');
    expect(html).toContain('Synth/Lead');
    expect(html).toContain('class="truncate hidden xl:inline"');
  });

  test('renders song mode tabs (Arrange & Master FX) with tablet-visible sm:inline label', () => {
    const arrangeHtml = renderToString(
      <TabButton
        view="arrange"
        activeTab="arrange"
        onSelect={() => {}}
        labelClassName="truncate sm:inline"
      />
    );
    expect(arrangeHtml).toContain('id="tab-arrange"');
    expect(arrangeHtml).toContain('Arrange');
    expect(arrangeHtml).toContain('class="truncate sm:inline"');

    const fxHtml = renderToString(
      <TabButton
        view="effects"
        activeTab="arrange"
        onSelect={() => {}}
        labelClassName="truncate sm:inline"
      />
    );
    expect(fxHtml).toContain('id="tab-effects"');
    expect(fxHtml).toContain('Master FX');
    expect(fxHtml).toContain('class="truncate sm:inline"');
  });
});
