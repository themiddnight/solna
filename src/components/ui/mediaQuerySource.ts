type MediaQuery = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
export type MatchMedia = (query: string) => MediaQuery;

/** The browser's `matchMedia`, or undefined with none (bun test, a non-browser host). */
export const browserMatchMedia: MatchMedia | undefined =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? (query) => window.matchMedia(query)
    : undefined;

/**
 * One media query as a `useSyncExternalStore` source. The MediaQueryList is
 * created on first read, so importing touches no browser API and the
 * every-render `getSnapshot` reuses one list. `matches()` is null with no
 * `matchMedia`; each caller picks its own server-side answer.
 */
export function createMediaQuerySource(query: string, matchMedia: MatchMedia | undefined): {
  subscribe: (onChange: () => void) => () => void;
  matches: () => boolean | null;
} {
  let list: MediaQuery | null = null;
  const mediaQuery = (): MediaQuery | null => {
    if (!matchMedia) return null;
    list ??= matchMedia(query);
    return list;
  };
  return {
    subscribe: (onChange) => {
      const current = mediaQuery();
      if (!current) return () => {};
      current.addEventListener('change', onChange);
      return () => current.removeEventListener('change', onChange);
    },
    matches: () => mediaQuery()?.matches ?? null,
  };
}
