import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { TabButton } from './Header';
import { persistTheme, readStoredTheme, resolveInitialTheme } from './header/useTheme';
import { projectDisplayName, ProjectNameLabel, UNTITLED_PROJECT_LABEL } from './header/ProjectNameLabel';
import { FollowPlayheadToggle } from './header/FollowPlayheadToggle';
import { ScaleMenu, ScaleSelects } from './header/ScaleMenu';
import { HEADER_TOOLS } from './header/headerTools';
import { ExportButton } from './export/ExportButton';
import { PatternSegmentRow } from './ui/SegmentedControl';
import { LOOP_TABS, SONG_TABS } from '../types';
import { VIEW_ORDER } from './viewMeta';
import { GROUP_LABEL, HEADER_FIELD_SHELL } from './ui/fieldClasses';
import { useAppStore } from '../store/store';

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
  test('the loop layer has exactly two tabs', () => {
    expect(LOOP_TABS).toEqual(['sound', 'pattern']);
  });

  test('the song layer has arrange and the master rack', () => {
    expect(SONG_TABS).toEqual(['arrange', 'master']);
  });

  test('every tab view is still reachable', () => {
    const views = [...SONG_TABS, ...LOOP_TABS].sort();
    expect(views).toEqual(['arrange', 'master', 'pattern', 'sound']);
  });

  // Widened to string on purpose: now that both lists are `as const`, asking
  // whether a loop tab is a song tab is a TYPE error, so the runtime check has
  // to be written against the values rather than the literal types. The
  // compiler catching it first is the point — this stays as the assertion that
  // survives if either list is ever widened back.
  test('the two layer groups are disjoint', () => {
    const songTabs: readonly string[] = SONG_TABS;
    const overlap = LOOP_TABS.filter((view) => songTabs.includes(view));
    expect(overlap).toEqual([]);
  });
});

/**
 * The segment row renders through the same join + btn + btn-active idiom as
 * TabButton, so a substring covering several classes at once is what proves
 * they sit on the SAME element (see .claude/rules/testing.md).
 *
 * PatternSegmentRow reads `focusTrack` through `useLiveStore`, so a test can
 * set focus before rendering and see the active button move (see the
 * `focusTrack` test just below).
 */
describe('PatternSegmentRow', () => {
  const html = renderToString(<PatternSegmentRow />);

  test('renders one button per segment, in registry order', () => {
    expect(html).toContain('id="segment-lead"');
    expect(html).toContain('id="segment-accompaniment"');
    expect(html).toContain('id="segment-beat"');
    expect(html.indexOf('segment-lead')).toBeLessThan(html.indexOf('segment-accompaniment'));
    expect(html.indexOf('segment-accompaniment')).toBeLessThan(html.indexOf('segment-beat'));
  });

  test('the active segment is the primary-filled join item, the others are ghosts', () => {
    expect(html).toContain('btn btn-sm join-item');
    expect(html).toContain('btn-active btn-primary');
    expect(html).toContain('btn-ghost');
  });

  test('every segment label is readable at every width — no xl-only labels here', () => {
    expect(html).toContain('Lead');
    expect(html).toContain('Accompaniment');
    expect(html).toContain('Beat');
    expect(html).not.toContain('hidden xl:inline');
  });

  // The restore is in a `finally`, not a trailing statement: a thrown assertion
  // above it would otherwise leak a non-default `focusTrack` into every test
  // that runs after this one, and the failure would show up somewhere else.
  test('the active button follows focusTrack, and accompaniment covers three focuses', () => {
    try {
      useAppStore.setState({ focusTrack: 'pad' });
      const padHtml = renderToString(<PatternSegmentRow />);
      expect(openTagContaining(padHtml, 'id="segment-accompaniment"')).toContain(
        'aria-current="page"',
      );
      useAppStore.setState({ focusTrack: 'drum' });
      const drumHtml = renderToString(<PatternSegmentRow />);
      expect(openTagContaining(drumHtml, 'id="segment-beat"')).toContain('aria-current="page"');
    } finally {
      useAppStore.setState({ focusTrack: 'synth' });
    }
  });

  test('marks exactly one button as the current page', () => {
    expect(html.split('aria-current="page"').length - 1).toBe(1);
  });
});

describe('TabButton rendering', () => {
  test('every tab shows its label from lg up, its icon alone below', () => {
    for (const view of VIEW_ORDER) {
      const html = renderToString(<TabButton view={view} activeTab="sound" onSelect={() => {}} />);
      expect(html).toContain(`id="tab-${view}"`);
      expect(html).toContain('class="truncate hidden lg:inline"');
    }
  });

  /* The four tabs are the frame's top navigation now that no layer switch
     sits above them, so the active one takes the solid segmented-control
     fill PatternSegmentRow uses. */
  test('the active tab is solid primary, the others are ghosts', () => {
    const active = renderToString(<TabButton view="sound" activeTab="sound" onSelect={() => {}} />);
    expect(active).toContain('btn-active btn-primary');
    const idle = renderToString(<TabButton view="pattern" activeTab="sound" onSelect={() => {}} />);
    expect(idle).toContain('btn-ghost');
    expect(idle).not.toContain('btn-primary');
  });
});

// ProjectNameLabel is rendered directly, standalone, rather than through
// `Header` (see the comment on the component): Header's own `activeTab` read
// is a plain `useAppStore` selector, which under `renderToString` always
// serves the store's CREATION-time value ('sound', a loop tab) regardless of
// `setState` — there is no way to reach the song layer through a rendered
// `<Header />` in this suite.
//
// The name it shows is read through `useLiveStore` (the component owns the
// read now, so a committed edit is visible without a remount), which is also
// what makes `setState({ projectName })` before a render reach it — the
// `getServerSnapshot` trap does not apply to this block.
describe('ProjectNameLabel', () => {
  const initial = useAppStore.getState().projectName;
  afterEach(() => {
    useAppStore.setState({ projectName: initial });
  });

  test('a named project renders an editable input holding the name', () => {
    useAppStore.setState({ projectName: 'Lo-Fi Study Session' });
    const html = renderToString(<ProjectNameLabel />);
    expect(html).toContain('id="header-project-name"');
    expect(openTagContaining(html, 'id="header-project-name"')).toMatch(/^<input/);
    expect(html).toContain('value="Lo-Fi Study Session"');
  });

  test('the only project-name editor remains visible on phone widths', () => {
    const html = renderToString(<ProjectNameLabel />);
    expect(html).toContain('id="header-project-name"');
    expect(html).not.toMatch(/class="[^"]*\bhidden\b/);
  });

  test('an untitled session shows the untitled placeholder', () => {
    useAppStore.setState({ projectName: null });
    const html = renderToString(<ProjectNameLabel />);
    expect(html).toContain(`placeholder="${UNTITLED_PROJECT_LABEL}"`);
    expect(html).toContain('value=""');
  });

  test('it is captioned and framed the way the loop picker is', () => {
    useAppStore.setState({ projectName: 'Alpha' });
    const html = renderToString(<ProjectNameLabel />);
    expect(html).toContain('>Project<');
    expect(html).toContain(HEADER_FIELD_SHELL);
    expect(html).toContain(GROUP_LABEL);
  });

  test('projectDisplayName names the untitled case and passes a name through', () => {
    expect(projectDisplayName(null)).toBe(UNTITLED_PROJECT_LABEL);
    expect(projectDisplayName('Alpha')).toBe('Alpha');
  });
});

// Reads the store through useLiveStore, so unlike the rest of the header its
// live state IS reachable from a test's setState (see ui/useLiveStore.ts).
describe('FollowPlayheadToggle', () => {
  const initial = useAppStore.getState().followPlayhead;
  afterEach(() => {
    useAppStore.setState({ followPlayhead: initial });
  });

  test('following: pressed, and the label offers the way out', () => {
    useAppStore.setState({ followPlayhead: true });
    const html = renderToString(<FollowPlayheadToggle />);
    const tag = openTagContaining(html, 'id="btn-follow-playhead"');
    expect(tag).toContain('aria-pressed="true"');
    expect(tag).toContain('btn-active');
    expect(tag).toContain('click to stop');
  });

  test('not following: unpressed, and the label offers the way in', () => {
    useAppStore.setState({ followPlayhead: false });
    const html = renderToString(<FollowPlayheadToggle />);
    const tag = openTagContaining(html, 'id="btn-follow-playhead"');
    expect(tag).toContain('aria-pressed="false"');
    expect(tag).not.toContain('btn-active');
    expect(tag).toContain('Follow the playing loop');
  });
});

describe('export lives in its own feature folder', () => {
  const header = readFileSync(new URL('./Header.tsx', import.meta.url), 'utf8');
  const tools = readFileSync(new URL('./header/headerTools.ts', import.meta.url), 'utf8');

  test('the tool list takes the export root from src/components/export/', () => {
    expect(tools).toContain("import { ExportButton } from '@/components/export/ExportButton';");
    expect(HEADER_TOOLS.find((tool) => tool.id === 'export')?.Component).toBe(ExportButton);
  });

  test('neither the Header nor its tool list holds export logic', () => {
    for (const src of [header, tools]) {
      for (const symbol of ['startExport', 'cancelExport', 'exportJob', 'downloadBlob', 'mixdownProgressLabel', 'export-menu']) {
        expect(src).not.toContain(symbol);
      }
    }
  });
});

/**
 * Order, read off `HEADER_TOOLS`: `Header` itself is never rendered in this
 * suite (its `activeTab` read serves the store's creation-time value under
 * `renderToString` — see the note above), so what the row opens with is pinned
 * as a static property of the tool list instead.
 *
 * The rule is that the layer's SUBJECT — the loop being edited, or the project
 * the arrangement belongs to — comes before the tabs that view it, on both
 * layers. It used to be tabs first, which read as "this view → of some loop".
 */
describe('the tabs lead the header, the subject run follows', () => {
  const src = readFileSync(new URL('./Header.tsx', import.meta.url), 'utf8');
  const navAt = src.indexOf('<ViewNav ');
  const subject = HEADER_TOOLS.filter((tool) => tool.group === 'subject').map((tool) => tool.id);

  // The subject run changes with the layer, so tabs placed after it would
  // slide sideways on every layer crossing.
  test('the Header renders the tab nav, then the subject tools, then the actions', () => {
    expect(navAt).toBeGreaterThan(-1);
    expect(src.indexOf('<HeaderToolRun layer={layer} group="subject" />')).toBeGreaterThan(navAt);
    expect(src.indexOf('<HeaderToolRun layer={layer} group="actions" />')).toBeGreaterThan(
      src.indexOf('<HeaderToolRun layer={layer} group="subject" />'),
    );
  });

  test('there is no layer switch', () => {
    expect(src).not.toContain('id={`layer-');
  });

  // Subject, then what Arrange does with it while it plays, then export, then
  // the key it is in.
  test('the subject run is loop picker, project name, follow toggle, export, key/scale', () => {
    expect(subject).toEqual(['loop-copy', 'loop-selector', 'project-name', 'follow-playhead', 'export', 'scale']);
  });

  test('the copy button sits immediately before the loop selector', () => {
    expect(subject.indexOf('loop-selector')).toBe(subject.indexOf('loop-copy') + 1);
  });
});

/**
 * The header nav is driven by `LOOP_TABS` and `SONG_TABS` (one join each),
 * MobileTabBar by `VIEW_ORDER`, so the two frames can only be kept in step by
 * hand. This is that hand: the tabs the header renders, loop layer then song
 * layer, must be VIEW_ORDER's four views, each exactly once. A view added to one and forgotten in the other fails here rather than
 * going missing from the nav.
 */
describe('the header tabs cover every view', () => {
  const rendered = [...LOOP_TABS, ...SONG_TABS];

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

  // Both copies render — the inline pair from xl up and the dropdown below —
  // each under its own id prefix, so the hidden copy never duplicates an id.
  test('the key/scale menu renders both breakpoint copies', () => {
    const html = renderToString(<ScaleMenu />);
    expect(html).toContain('id="select-master-scale-root"');
    expect(html).toContain('id="select-master-scale-compact-root"');
  });

  // The header pair is FIXED width, and the scale name ellipsises inside it.
  // Both halves are one mechanism, which is why they are one test: daisyUI's
  // `.select` sizes itself (`clamp(3rem, 20rem, 100%)`, `flex-shrink: 1`), so
  // a `min-w-*` let the navbar decide the width AND meant the label never
  // overflowed anything to be clipped against.
  test('the inline pair is fixed width, not min-width', () => {
    const html = renderToString(<ScaleSelects idPrefix="test" />);
    // The two numbers are a design call and get retuned; that each select
    // carries ONE of them, and that neither is a min-width, is the rule.
    const widths = html.match(/\bw-\d+\b/g) ?? [];
    expect(widths).toHaveLength(2);
    expect(html).not.toContain('min-w-');
  });

  // `appearance-none` is load-bearing, not decoration — see HEADER_SELECT's
  // comment. Without it daisyUI opts the select into Chrome's customizable
  // select, whose label is clipped by a `selectedcontent` rule that matches
  // nothing unless the author writes that markup, and the scale name paints
  // over the chevron and out past the border.
  test('both selects opt out of the customizable-select rendering', () => {
    const html = renderToString(<ScaleSelects idPrefix="test" />);
    expect(html.match(/appearance-none/g) ?? []).toHaveLength(2);
  });

  // The dropdown copy has a panel to fill and no navbar to hold still, so it
  // takes the full width instead of the header's two fixed ones.
  test('the stacked copy fills its dropdown instead', () => {
    const html = renderToString(<ScaleSelects idPrefix="test" stacked />);
    expect(html.match(/w-full/g) ?? []).toHaveLength(2);
    expect(html).not.toMatch(/\bw-\d+\b/);
  });
});
