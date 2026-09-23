import { useSyncExternalStore } from 'react';
import { browserMatchMedia, createMediaQuerySource, type MatchMedia } from '../ui/mediaQuerySource';

/** Which frame the workspace renders. Width only: no pointer, hover or orientation query. */
export type LayoutMode = 'desktop' | 'mobile';

/**
 * The `md` breakpoint as `src/index.css` sets it (46.5rem, the iPad mini's
 * 744px portrait width, not Tailwind's default 48rem), so the mode flips at
 * exactly the edge every `md:` class already uses. A test pins the two together.
 */
export const LAYOUT_MODE_QUERY = '(min-width: 46.5rem)';

/**
 * The layout mode over one media query. With no `matchMedia` (bun test, a
 * non-browser host) the mode is desktop.
 */
export function createLayoutModeSource(matchMedia: MatchMedia | undefined): {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => LayoutMode;
} {
  const source = createMediaQuerySource(LAYOUT_MODE_QUERY, matchMedia);
  return {
    subscribe: source.subscribe,
    getSnapshot: () => (source.matches() === false ? 'mobile' : 'desktop'),
  };
}

const browserSource = createLayoutModeSource(browserMatchMedia);

const serverSnapshot = (): LayoutMode => 'desktop';

/**
 * The one layout-mode switch (R315). Never a slice, never persisted, no user
 * override: the viewport decides. `getServerSnapshot` is desktop, so every
 * `renderToString` test renders the desktop frame.
 */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(browserSource.subscribe, browserSource.getSnapshot, serverSnapshot);
}
