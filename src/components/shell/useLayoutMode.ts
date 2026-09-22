import { useSyncExternalStore } from 'react';

/** Which frame the workspace renders. Width only: no pointer, hover or orientation query. */
type LayoutMode = 'desktop' | 'mobile';

/**
 * Tailwind v4's default `md` breakpoint (48rem; `src/index.css` sets no
 * `--breakpoint-md`), so the mode flips at exactly the edge every `md:` class
 * already uses. A test pins the CSS side.
 */
export const LAYOUT_MODE_QUERY = '(min-width: 48rem)';

type MediaQuery = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
type MatchMedia = (query: string) => MediaQuery;

/**
 * The layout mode as an external store over one MediaQueryList, created on
 * first read so importing this module touches no browser API. With no
 * `matchMedia` (bun test, a non-browser host) the mode is desktop.
 */
export function createLayoutModeSource(matchMedia: MatchMedia | undefined): {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => LayoutMode;
} {
  let list: MediaQuery | null = null;
  const mediaQuery = (): MediaQuery | null => {
    if (!matchMedia) return null;
    list ??= matchMedia(LAYOUT_MODE_QUERY);
    return list;
  };
  return {
    subscribe(onChange) {
      const query = mediaQuery();
      if (!query) return () => {};
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    getSnapshot() {
      const query = mediaQuery();
      return query === null || query.matches ? 'desktop' : 'mobile';
    },
  };
}

const browserSource = createLayoutModeSource(
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? (query) => window.matchMedia(query)
    : undefined,
);

const serverSnapshot = (): LayoutMode => 'desktop';

/**
 * The one layout-mode switch (R315). Never a slice, never persisted, no user
 * override: the viewport decides. `getServerSnapshot` is desktop, so every
 * `renderToString` test renders the desktop frame.
 */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(browserSource.subscribe, browserSource.getSnapshot, serverSnapshot);
}
