import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { layerForTab, type ViewMode } from '@/types';
import { TransportBar } from '@/components/TransportBar';
import { HEADER_TOOLS } from '@/components/header/headerTools';
import { MobileShell } from './MobileShell';
import { DesktopShell } from './DesktopShell';
import { useAppStore } from '@/store/store';
import { MOBILE_TABS, MobileTabBar } from './MobileTabBar';
import { MobileMenuSheet } from './MobileTopBar';
import { mobileHeaderTools } from './useMobileTopBar';
import { SHELL_PROPS } from './shellPropsFixture';

const noop = () => {};
const tabIds = (html: string) => [...html.matchAll(/id="tab-([a-z]+)"/g)].map((m) => m[1]);

describe('the mobile tab bar', () => {
  test('four tabs, loop layer first — the same roster the desktop nav and router use', () => {
    expect(MOBILE_TABS).toEqual(['sound', 'pattern', 'arrange', 'master']);
    expect(MOBILE_TABS.map(layerForTab)).toEqual(['loop', 'loop', 'song', 'song']);
  });

  for (const active of ['sound', 'pattern', 'arrange', 'master'] as ViewMode[]) {
    test(`on ${active}, exactly that tab is current`, () => {
      const html = renderToString(createElement(MobileTabBar, { activeTab: active, onSelect: noop }));
      expect(tabIds(html)).toEqual(['sound', 'pattern', 'arrange', 'master']);
      expect(html.split('aria-current="page"').length - 1).toBe(1);
      expect(html).toMatch(new RegExp(`id="tab-${active}" type="button" aria-current="page" class="dock-active`));
    });
  }

  test('is an in-flow daisyUI dock labelled for assistive tech', () => {
    const html = renderToString(createElement(MobileTabBar, { activeTab: 'sound', onSelect: noop }));
    expect(html).toContain('<nav aria-label="Views" class="dock relative');
    expect(html).toContain('class="dock-label"');
  });
});

describe('one bottom inset per frame', () => {
  test('the transport keeps it by default and drops it on request', () => {
    expect(renderToString(createElement(TransportBar))).toContain('pb-safe sm:pb-safe-lg');
    expect(renderToString(createElement(TransportBar, { bottomInset: false }))).not.toContain('pb-safe');
  });

  test('the mobile shell ends with the tab bar, after an inset-free transport', () => {
    const html = renderToString(createElement(MobileShell, SHELL_PROPS));
    const transport = html.indexOf('id="btn-bottom-transport"');
    const nav = html.indexOf('<nav aria-label="Views"');
    expect(transport).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(transport);
    expect(html).not.toContain('pb-safe');
  });
});

const ids = (tools: readonly { id: string }[]) => tools.map((tool) => tool.id);

describe('the mobile top bar splits HEADER_TOOLS by id', () => {
  test('loop layer: loop picker and key inline; vibes, copy and theme in the menu', () => {
    const { bar, menu } = mobileHeaderTools('loop');
    expect(ids(bar)).toEqual(['loop-selector', 'scale']);
    expect(ids(menu)).toEqual(['vibes', 'loop-copy', 'theme']);
  });

  test('song layer: project name inline; follow, export and theme in the menu', () => {
    const { bar, menu } = mobileHeaderTools('song');
    expect(ids(bar)).toEqual(['project-name']);
    expect(ids(menu)).toEqual(['follow-playhead', 'export', 'theme']);
  });

  test('every tool lands in exactly one place on every layer it is available on', () => {
    for (const layer of ['loop', 'song'] as const) {
      const { bar, menu } = mobileHeaderTools(layer);
      const expected = HEADER_TOOLS.filter((tool) => tool.layers.includes(layer)).map((tool) => tool.id);
      expect([...ids(bar), ...ids(menu)].sort()).toEqual([...expected].sort());
    }
  });
});

describe('the menu sheet', () => {
  const sheet = (layer: 'loop' | 'song') =>
    renderToString(createElement(MobileMenuSheet, { tools: mobileHeaderTools(layer).menu, open: false, onClose: noop }));

  test('loop layer: copy, theme and the project rows; no song tools', () => {
    const html = sheet('loop');
    for (const id of ['btn-copy-loop', 'btn-toggle-theme', 'project-menu-new', 'project-menu-save']) expect(html).toContain(`id="${id}"`);
    for (const id of ['btn-export', 'btn-follow-playhead']) expect(html).not.toContain(`id="${id}"`);
  });

  test('song layer: follow, export, theme and the project rows; no loop tools', () => {
    const html = sheet('song');
    for (const id of ['btn-follow-playhead', 'btn-export', 'btn-toggle-theme', 'project-menu-new']) expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain('id="btn-copy-loop"');
  });

  test('is a bottom sheet, with project rows touch-sized and no dialog inside a menu item', () => {
    const html = sheet('song');
    expect(html).toContain('<dialog class="modal modal-bottom"');
    expect(html).toContain('id="project-menu-new" class="min-h-11"');
    // `<li>` or `<li class=…>`, never the SVG `<line>` an icon draws.
    expect(html).not.toMatch(/<li(?:\s[^>]*)?>(?:(?!<\/li>)[\s\S])*<dialog/);
  });

  /**
   * R328: a popup never renders inside a bottom sheet — every tool that
   * reaches the sheet renders inline `row` controls instead. Pinned as a guard
   * rather than a `ScaleMenu` rewrite, since `scale` stays a bar tool (Q1) and
   * no menu row renders one today (§5.2).
   */
  test('no tool routed into the menu renders a popup: no dropdown class, no <details', () => {
    for (const layer of ['loop', 'song'] as const) {
      const html = sheet(layer);
      expect(html).not.toMatch(/\bdropdown\b/);
      expect(html).not.toContain('<details');
    }
  });
});

describe('the mobile frame', () => {
  test('has the menu button and four tabs, and no layer switch or desktop tab nav', () => {
    const html = renderToString(createElement(MobileShell, SHELL_PROPS));
    expect(html).toContain('id="btn-mobile-menu"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(tabIds(html)).toEqual(['sound', 'pattern', 'arrange', 'master']);
    expect(html).not.toContain('id="layer-loop"');
    expect(html).not.toContain('id="layer-song"');
  });

  /** R332, R316: the frame picks the bar; the phone's is one row with its settings in a sheet. */
  test('asks for the one-row transport, its settings sheet inside the bar and above the tab bar', () => {
    const html = renderToString(createElement(MobileShell, SHELL_PROPS));
    const sheet = html.indexOf('<dialog id="sheet-transport"');
    expect(html).toContain('id="btn-transport-sheet"');
    expect(sheet).toBeGreaterThan(html.indexOf('id="btn-transport-sheet"'));
    expect(html.indexOf('<nav aria-label="Views"')).toBeGreaterThan(sheet);
    expect(html.split('id="input-transport-bpm"').length - 1).toBe(1);
    expect(html.indexOf('id="input-transport-bpm"')).toBeGreaterThan(sheet);
  });

  test('the top bar shows the full wordmark, and its field tools keep their desktop heights', () => {
    const html = renderToString(createElement(MobileShell, SHELL_PROPS));
    expect(html).toContain('solna</span>');
    expect(html).toContain('id="btn-app-modal"'); // the wordmark opens the app modal on the phone too
    expect(html).not.toContain('[&amp;_select]:min-h-11');
  });
});

/** R340, R316: the frame picks the keyboard surface, as it picks the transport bar. */
describe('the input dock keyboard follows the frame', () => {
  const chromatic = {
    ...SHELL_PROPS,
    keyboardProps: { ...SHELL_PROPS.keyboardProps, keyboardMode: 'chromatic' as const },
  };
  const renderOpen = (shell: typeof MobileShell) => {
    const before = useAppStore.getState();
    useAppStore.setState({ isInputPanelOpen: true, focusTrack: 'synth', inputTargetPin: null });
    try {
      return renderToString(createElement(shell, chromatic));
    } finally {
      useAppStore.setState({
        isInputPanelOpen: before.isInputPanelOpen,
        focusTrack: before.focusTrack,
        inputTargetPin: before.inputTargetPin,
      });
    }
  };

  test('the mobile frame asks for keys that share the width', () => {
    expect(renderOpen(MobileShell)).toContain('[--chromatic-key-stride:12.5%]');
  });

  test('the desktop frame keeps the fixed-stride keyboard', () => {
    const html = renderOpen(DesktopShell);
    expect(html).toContain('[--chromatic-key-stride:68px]');
    expect(html).not.toContain('[--chromatic-key-stride:12.5%]');
  });
});
