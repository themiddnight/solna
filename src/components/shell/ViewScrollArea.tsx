import React from 'react';
import { useViewScrollMemory } from './useViewScrollMemory';

/**
 * The frame's one vertical scroll container, remembering its position per
 * visible view (R342). Its own component so a view switch re-renders only
 * this wrapper: `children` is the same element from `ShellBody`, so the pages
 * inside are not re-rendered by it.
 *
 * `pb-9` reserves the strip the input dock's toggle floats over. The dock's
 * header is absolutely positioned above the dock body so a collapsed deck
 * costs no layout height, which also means it sits ON TOP of whatever the page
 * has scrolled to its bottom edge — without this padding it covers the last
 * row of chord chips or FX knobs and swallows their clicks.
 */
export function ViewScrollArea({ children }: { children: React.ReactNode }) {
  const { scrollRef } = useViewScrollMemory();
  return (
    <main ref={scrollRef} className="flex-1 min-h-0 relative overflow-y-auto pb-9">
      {children}
    </main>
  );
}
