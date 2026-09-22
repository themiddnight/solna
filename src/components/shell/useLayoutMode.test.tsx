import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createLayoutModeSource, LAYOUT_MODE_QUERY, useLayoutMode } from './useLayoutMode';

/** A MediaQueryList stand-in: `set` flips `matches` and fires `change`, like a resize across 48rem. */
function fakeMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const queries: string[] = [];
  const list = {
    matches: initial,
    addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
  };
  return {
    queries,
    listeners,
    matchMedia: (query: string) => {
      queries.push(query);
      return list as unknown as MediaQueryList;
    },
    set(matches: boolean) {
      list.matches = matches;
      listeners.forEach((listener) => listener());
    },
  };
}

function Probe() {
  return createElement('span', null, useLayoutMode());
}

describe('layout mode source', () => {
  test('a width at or above md is desktop, below it mobile', () => {
    expect(createLayoutModeSource(fakeMatchMedia(true).matchMedia).getSnapshot()).toBe('desktop');
    expect(createLayoutModeSource(fakeMatchMedia(false).matchMedia).getSnapshot()).toBe('mobile');
  });

  test('a change notifies the subscriber and the next snapshot follows it', () => {
    const fake = fakeMatchMedia(true);
    const source = createLayoutModeSource(fake.matchMedia);
    let calls = 0;
    source.subscribe(() => { calls += 1; });
    fake.set(false);
    expect(calls).toBe(1);
    expect(source.getSnapshot()).toBe('mobile');
  });

  test('unsubscribe removes the listener', () => {
    const fake = fakeMatchMedia(true);
    const unsubscribe = createLayoutModeSource(fake.matchMedia).subscribe(() => {});
    expect(fake.listeners.size).toBe(1);
    unsubscribe();
    expect(fake.listeners.size).toBe(0);
  });

  test('the Tailwind md query is created once, however often it is read', () => {
    const fake = fakeMatchMedia(true);
    const source = createLayoutModeSource(fake.matchMedia);
    source.getSnapshot();
    source.subscribe(() => {})();
    source.getSnapshot();
    expect(fake.queries).toEqual([LAYOUT_MODE_QUERY]);
    expect(LAYOUT_MODE_QUERY).toBe('(min-width: 48rem)');
  });

  test('with no matchMedia the mode is desktop and subscribe is inert', () => {
    const source = createLayoutModeSource(undefined);
    expect(source.getSnapshot()).toBe('desktop');
    expect(() => source.subscribe(() => {})()).not.toThrow();
  });
});

describe('useLayoutMode', () => {
  test('renders desktop under renderToString (the server snapshot)', () => {
    expect(renderToString(createElement(Probe))).toBe('<span>desktop</span>');
  });

  // LAYOUT_MODE_QUERY is Tailwind v4's default `md` (48rem). A `--breakpoint-md`
  // override in the CSS would move every `md:` class and leave the mode behind.
  test('index.css does not override Tailwind md, so the query and md: agree', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    expect(css).not.toContain('--breakpoint-md');
  });
});
