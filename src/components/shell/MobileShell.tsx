import React from 'react';
import { useAppStore } from '@/store/store';
import { MobileTabBar } from './MobileTabBar';
import { MobileTopBar } from './MobileTopBar';
import { FeedbackHost } from '@/components/ui/FeedbackHost';
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

      {/* The frame's one feedback host (R330), hung directly under the top
          bar; the desktop frame's sits above the input dock instead. */}
      <FeedbackHost edge="top" />

      {/* The one-row transport; its settings open in a sheet above it (R332).
          The dock's keys fit the width and never scroll (R340). */}
      <ShellBody
        {...props}
        bottomInset={false}
        transportVariant="mobile"
        keyboardVariant="mobile"
        feedbackSlot={false}
      />

      {/* Bottom navigation, last: the thumb's reach, and the frame's one
          consumer of the bottom safe-area inset. */}
      <MobileTabBar activeTab={activeTab} onSelect={setActiveTab} />
    </>
  );
});
