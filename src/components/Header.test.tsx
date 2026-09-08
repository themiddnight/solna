import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ProjectNameLabel, TabButton, AUTOMATION_TABS, LAYER_META, layerToggleTarget, persistTheme, readStoredTheme, resolveInitialTheme, SONG_NAV_TABS, ScaleSelects } from './Header';
import { defaultTabForLayer, tabsForLayer } from '../routing/tabRouting';
import { VIEW_ORDER } from './viewMeta';

/** The full opening tag of the element whose markup contains `needle` — pins the tag name, not text position. */
function openTagContaining(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  return html.slice(start, end + 1);
}

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
  test('arrange and master fx stand alone, with no transport', () => {
    expect(SONG_NAV_TABS).toEqual(['arrange', 'master']);
  });

  test('every tab view is still reachable', () => {
    const views = [...SONG_NAV_TABS, ...AUTOMATION_TABS].sort();
    expect(views).toEqual(['arrange', 'master', 'pattern', 'sound']);
  });
});

describe('layer toggle', () => {
  test('lists the two layers in order with stable labels', () => {
    expect(LAYER_META.map((l) => l.layer)).toEqual(['loop', 'song']);
    expect(LAYER_META.map((l) => l.label)).toEqual(['Loop', 'Song']);
  });

  test('clicking a different layer navigates to that layer default tab', () => {
    expect(layerToggleTarget('loop', 'song')).toBe('arrange');
    expect(layerToggleTarget('song', 'loop')).toBe('sound');
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
      <TabButton view="sound" activeTab="sound" onSelect={() => {}} />
    );
    expect(html).toContain('id="tab-sound"');
    expect(html).toContain('Sound');
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
        view="master"
        activeTab="arrange"
        onSelect={() => {}}
        labelClassName="truncate sm:inline"
      />
    );
    expect(fxHtml).toContain('id="tab-master"');
    expect(fxHtml).toContain('Master FX');
    expect(fxHtml).toContain('class="truncate sm:inline"');
  });
});

// ProjectNameLabel takes `layer` as a plain prop rather than reading
// `activeTab` itself (see the comment on the component): Header's own
// `activeTab` read is a plain `useAppStore` selector, which under
// `renderToString` always serves the store's CREATION-time value ('synth',
// a loop tab) regardless of `setState` — there is no way to reach the song
// layer through a rendered `<Header />` in this suite. Testing the label via
// its own props, the same way `TabButton` above is tested standalone, avoids
// that trap entirely.
describe('ProjectNameLabel (song layer only)', () => {
  test('a saved project shows its name, dimmed but not italic', () => {
    const html = renderToString(
      <ProjectNameLabel layer="song" currentProjectId="p1" currentProjectName="Lo-Fi Study Session" />
    );
    expect(html).toContain('id="header-project-name"');
    expect(html).toContain('Lo-Fi Study Session');
    expect(openTagContaining(html, 'id="header-project-name"')).toContain('text-base-content/80');
  });

  test('an untitled session shows the sessionLabel text, italicized', () => {
    const html = renderToString(
      <ProjectNameLabel layer="song" currentProjectId={null} currentProjectName={null} />
    );
    expect(html).toContain('Unsaved session');
    expect(openTagContaining(html, 'id="header-project-name"')).toContain('italic');
  });

  test('the loop layer never shows the label, even with a current project', () => {
    const html = renderToString(
      <ProjectNameLabel layer="loop" currentProjectId="p1" currentProjectName="Lo-Fi Study Session" />
    );
    expect(html).not.toContain('id="header-project-name"');
  });

  test('the label is a plain span, not a button', () => {
    const html = renderToString(
      <ProjectNameLabel layer="song" currentProjectId="p1" currentProjectName="Lo-Fi Study Session" />
    );
    expect(openTagContaining(html, 'id="header-project-name"')).toMatch(/^<span/);
  });
});

/**
 * `viewMeta.VIEW_ORDER` exists for coverage, not for rendering — the nav is
 * driven by `AUTOMATION_TABS` and `SONG_NAV_TABS`, so the two can only be kept
 * in step by hand. This is that hand: the tabs the header actually renders,
 * loop layer then song layer, must be VIEW_ORDER's five views, each exactly
 * once. A view added to one and forgotten in the other fails here rather than
 * going missing from the nav.
 */
describe('the header tabs cover every view', () => {
  const rendered = [...AUTOMATION_TABS, ...SONG_NAV_TABS];

  test('loop tabs then song tabs are VIEW_ORDER, reordered by layer', () => {
    expect([...rendered].sort()).toEqual([...VIEW_ORDER].sort());
    expect(rendered).toEqual(['sound', 'pattern', 'arrange', 'master']);
  });

  test('no view is rendered twice', () => {
    expect(new Set(rendered).size).toBe(rendered.length);
  });
});

describe('key picker', () => {
  test('offers the dual label while storing the sharp name', () => {
    const html = renderToString(<ScaleSelects idPrefix="test" />);
    expect(html).toContain('<option value="C#">C#/Db</option>');
    expect(html).toContain('<option value="C">C</option>');
  });
});

describe('nav tab groups', () => {
  test('lists loop-layer views as plain view ids, with no player module attached', () => {
    expect(AUTOMATION_TABS).toEqual(['sound', 'pattern']);
  });

  test('keeps the two layer groups disjoint', () => {
    const overlap = AUTOMATION_TABS.filter((view) => SONG_NAV_TABS.includes(view));
    expect(overlap).toEqual([]);
  });
});
