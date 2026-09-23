import React from 'react';
import { useAppStore } from '@/store/store';
import { MobileTabBar } from './MobileTabBar';
import { MobileTopBar } from './MobileTopBar';
import { ShellBody } from './ShellBody';
import type { ShellProps } from './shellProps';

/**
 * The mobile frame (`useLayoutMode() === 'mobile'`, below `md`): the tab bar
 * is its navigation, in place of the desktop Header's tab nav, without
 * touching Workspace or the desktop frame. Same ownership rule: the visible
 * frame only (R316).
 */
export const MobileShell = React.memo(function MobileShell(props: ShellProps) {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  return (
    <>
      {/* Top bar: mark, the layer's field tools, the menu */}
      <MobileTopBar />

      <ShellBody {...props} bottomInset={false} />

      {/* Bottom navigation, last: the thumb's reach, and the frame's one
          consumer of the bottom safe-area inset. */}
      <MobileTabBar activeTab={activeTab} onSelect={setActiveTab} />
    </>
  );
});
