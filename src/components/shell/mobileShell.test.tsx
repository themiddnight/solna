import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { layerForTab, type ViewMode } from '@/types';
import { TransportBar } from '@/components/TransportBar';
import { MobileShell } from './MobileShell';
import { MOBILE_TABS, MobileTabBar } from './MobileTabBar';
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
